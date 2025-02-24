// SPDX-License-Identifier: MIT OR Apache-2
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import "./interface/IPayAfterDispatcher.sol";

contract PayAfterDispatcher is IPayAfterDispatcher {
    // PayAfter Data Format (each cell is 1 byte):
    //      0  1  2  3  4  5  6  7  8  8 10 11 12 13 14 15
    //    +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
    //  0 |                                               |
    //    +                                               +
    // 16 |                                               |
    //    +                  Signature                    +
    // 32 |                                               |
    //    +                                               +
    // 48 |                                               |
    //    +  +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
    // 64 |  |  csum  | timestamp |                       |
    //    +--+--+--+--+--+--+--+--+                       +
    // 80 |                                               |
    //    +          Fee Entries (variable length)        +
    // 96 |                                               |
    //   ~~~                                             ~~~
    // XX |                                               |
    //    +              Payload (variable)               +
    // XX |                                               |
    //    +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
    uint32 constant SIG_START = 0;
    uint32 constant SIG_LEN = 65;

    // The checksum is just the first 3 bytes of the address.
    // This protects against data corruption which causes the
    // sig check to recover the wrong address.
    uint32 constant CSUM_START = SIG_START + SIG_LEN;
    uint32 constant CSUM_LEN = 3;

    // Timestamp is seconds since the epoch
    uint32 constant TS_START = CSUM_START + CSUM_LEN;
    uint32 constant TS_LEN = 4;
    uint32 constant FEE_START = TS_START + TS_LEN;

    /// Private key is `echo 'estimateGas' | sha256sum`
    /// This allows the signer to estimate gas before setting up the fee and signing.
    /// Pollinator implementations MUST refuse any transaction signed with this key.
    address constant public ESTIMATEGAS_ADDRESS =  0x4f4082f93978CCb77661f797cc36521Af262f6B8;

    /// This is an address for which noone has the private key.
    /// If this is the msg.sender, validity checks are skipped, allowing the pollinator
    /// to estimate gas of a transaction which is not yet valid.
    address constant public SIMULATE_ADDRESS =     0x0000000000000000000000000000000000000000;

    struct State {
        /// The sender of the transaction
        address signer;
        uint96 fee;
    }

    // STATE //
    State private self_state;
    /// This is a hashmap of executions that have either been completed, or have
    /// been killed. The key is derived by taking the address concatnated with the
    /// signature hash, i.e.
    /// keccak256(address || MessageHashUtils.toEthSignedMessageHash(keccak256(message)))
    /// This way, if someone claims the right to kill an execution, we hash their address
    /// with the provided hash before storing. Assuming keccak256() collisions to be "impossible"
    /// this gives every user their own namespace in the same mapping.
    mapping(bytes32 => uint) private self_executionBlacklist;
    // END STATE //

    uint constant MINUTE_SEC = 60;
    uint constant HOUR_SEC = MINUTE_SEC * 60;
    uint constant DAY_SEC = HOUR_SEC * 24;
    uint constant WEEK_SEC = DAY_SEC * 7;
    uint constant MONTH_SEC = DAY_SEC * 30;
    uint constant YEAR_SEC = DAY_SEC * 365;
    uint constant PACKED_TIME_UNIT =
        (1          << (32 * 0)) | // second
        (MINUTE_SEC << (32 * 1)) |
        (HOUR_SEC   << (32 * 2)) |
        (DAY_SEC    << (32 * 3)) |
        (WEEK_SEC   << (32 * 4)) |
        (MONTH_SEC  << (32 * 5)) |
        (YEAR_SEC   << (32 * 6)) |
        (10         << (32 * 7));   // We use the 8th slot for a ten second entry which allows
                                    // more advanced wallets to spec times like 3.5minutes
                                    // (21 tensecs). Simple wallets can just use a dropdown of
                                    // the first 7 options (common timespans).

    uint32 constant PACKED_TIME_WIDTH = 7+3;
    /// Packed Time:
    ///  0               1               2               3
    ///  0 1 2 3 4 5 6 7 0 1 2 3 4 5 6 7 0 1 2 3 4 5 6 7 0 1 2 3 4 5 6 7
    /// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
    /// |U| TU  |   Fee Time  |                  Unused                 |
    /// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
    /// * U         -> Unused
    /// * TU        -> Time Unit (second, minute, hour, day, week, month, year)
    /// * Fee Time  -> After this number of time units, this fee will apply
    /// 
    /// @param packedTime Uint32 representation of packed time
    /// @return unpacked time as number of seconds
    function unpackTime(uint32 packedTime) public pure returns (uint64 unpacked) {
        packedTime >>= PACKED_FEE_WIDTH;
        unpacked = packedTime           & ((1<<7) - 1);
        uint32 tu = (packedTime >> 7)   & ((1<<3) - 1);
        unpacked *= uint64(uint32(PACKED_TIME_UNIT >> (32 * tu)));
    }

    uint32 constant PACKED_FEE_WIDTH = 13+8;
    /// The kill fee is the first number that cannot be unpacked as a packed fee
    /// This and anything above this means the transaction is invalidated.
    uint32 constant PACKED_KILL_FEE = (255 - 11) << 13;
    /// Packed Fee:
    ///  0               1               2               3
    ///  0 1 2 3 4 5 6 7 0 1 2 3 4 5 6 7 0 1 2 3 4 5 6 7 0 1 2 3 4 5 6 7
    /// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
    /// |       Unused        |    Fee Exp    |        Fee Base         |
    /// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
    /// * Fee Exp   -> Exponent
    /// * Fee Base  -> Base (fee = Fee Base << Fee Exponent)
    /// 
    /// Providing they are packed cannonically, packed fees can be compared
    /// numerically, i.e. if p1 > p1, unpackFee(p1) > unpackFee(p2).
    ///
    /// @param packedFee Uint32 representation of packed fee
    /// @return unpacked fee rate
    function unpackFee(uint32 packedFee) public pure returns (uint unpacked) {
        require(packedFee & ((1 << PACKED_FEE_WIDTH) - 1) < PACKED_KILL_FEE, "unpackFee overflow");
        unpacked = packedFee             & ((1<<13) - 1);
        unpacked <<= (packedFee >> 13)   & ((1<< 8) - 1);
        return unpacked;
    }

    struct ParseFeeRet {
        /// Absolute number of seconds when the transaction will be invalidated.
        uint64 expiration;
        /// When the transaction was created, seconds since the epoch
        uint64 creationTime;
        /// The most recent fee entry that is from before now, this is the "active" fee.
        /// This is a full fee entry with time component and amount. This MAY be 0xffffffff
        /// in the event that the transaction is not yet valid, in this case, feePacked1
        /// will ALWAYS have a valid fee entry which will be the beginning of validity.
        uint32 feePacked0;
        /// The next up-and-coming fee entry, this is what will be the next active fee.
        /// This MAY be 0xffffffff in the event that there is one and only one fee entry
        /// and that fee entry falls in the past (therefore that fee entry is set to feePacked0).
        uint32 feePacked1;
        /// The memory offset where data begins (after all of the fee entries).
        uint32 dataOffset;
    }

    /// Fee Entry:
    ///  0               1               2               3
    ///  0 1 2 3 4 5 6 7 0 1 2 3 4 5 6 7 0 1 2 3 4 5 6 7 0 1 2 3 4 5 6 7
    /// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
    /// |L|    Packed Time    |               Packed Fee                |
    /// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
    ///
    /// * L           -> 1 if this is the last fee entry
    /// * Packed Time -> Packed amount of seconds after transaction timestamp
    ///                  when this fee entry becomes active.
    /// * Packed Fee  -> The amount of this fee entry.
    ///
    /// Public but not override because it's only accessed when testing.
    ///
    /// @param signedMultiCall The PayAfter signed blob. It's the caller's responsibility to ensure
    ///                        That this is at least FEE_START bytes long.
    /// @param currentTime The current timestamp
    /// @return ret A ParseFeeRet object
    function parseFee(
        bytes calldata signedMultiCall,
        uint64 currentTime
    ) public pure returns (ParseFeeRet memory ret) {
        ret.creationTime = uint64(uint32(bytes4(signedMultiCall[TS_START : TS_START+TS_LEN])));
        // Start off with the kill fee, if there are no fee entries in the past then the transaction
        // is invalid with future expiration, meaning it will be valid in the future.
        uint32 feeEntry = 0;
        ret.feePacked0 = 0xffffffff;
        ret.feePacked1 = 0xffffffff;
        ret.expiration = type(uint64).max;
        for (ret.dataOffset = FEE_START; (feeEntry >> 31) == 0; ret.dataOffset += 4) {
            require(ret.dataOffset + 4 <= signedMultiCall.length, "parseFee() Buffer overflow");
            feeEntry = uint32(bytes4(signedMultiCall[ret.dataOffset : ret.dataOffset + 4]));
            if (ret.expiration < type(uint64).max) {
                // We have reached a kill entry, do not parse anything past this point
                continue;
            }
            uint64 activateTime = ret.creationTime + unpackTime(feeEntry);
            {
                uint32 fp = feeEntry & ((uint32(1) << PACKED_FEE_WIDTH) - 1);
                if (fp >= PACKED_KILL_FEE) {
                    require(fp == PACKED_KILL_FEE, "Invalid fee entry");
                    ret.expiration = activateTime;
                }
            }
            if (activateTime <= currentTime) {
                ret.feePacked0 = feeEntry;
            } else if (ret.feePacked1 == 0xffffffff) {
                ret.feePacked1 = feeEntry;
            }
        }
    }

    function executionHash(bytes32 signatureHash, address sender) public pure override returns (bytes32) {
        return keccak256(abi.encode(sender, signatureHash));
    }

    function getSigner() public view override returns (address) {
        return self_state.signer;
    }

    function killTransaction(bytes32 signatureHash) external override {
        address sender = getSigner();
        if (sender == address(0)) {
            sender = msg.sender;
        }
        bytes32 eh = executionHash(signatureHash, sender);
        // We don't know what when the provided transaction actually expires so we can't
        // safely allow a kill to be removed later, so we have to put U256::MAX so that
        // it remains blacklisted forever.
        self_executionBlacklist[eh] = type(uint).max;
    }

    function executionBlacklist(bytes32 _executionHash) external view override returns (uint) {
        return self_executionBlacklist[_executionHash];
    }

    function getRequiredFee() public view returns (uint) {
        return self_state.fee;
    }

    uint constant SCALE = 1e18;
    function computeRequiredFee(
        ParseFeeRet memory pfr,
        uint block_timestamp
    ) public pure returns (uint ret) {
        // If the transaction is not yet valid (packedFee0 == 0xffffffff), fee is U256::MAX
        // State memory state = self_state;
        if ((pfr.feePacked0 & ((uint32(1)<<PACKED_FEE_WIDTH) - 1)) >= PACKED_KILL_FEE) {
            return type(uint).max;
        }
        // If the transaction has one fee only
        // (packedFee1 == 0xffffffff OR packedFee1 is a kill fee), fee is packedFee0.
        if ((pfr.feePacked1 & ((uint32(1)<<PACKED_FEE_WIDTH) - 1)) >= PACKED_KILL_FEE) {
            return unpackFee(pfr.feePacked0);
        }

        // If packedFee0 and packedFee1 are both configured, perform linear interpolation on the
        // range of fee0 .. fee1 based on the location of block_timestamp in the range of
        // time0 .. time1
        {
            uint64 time0 = pfr.creationTime + unpackTime(pfr.feePacked0);
            uint64 time1 = pfr.creationTime + unpackTime(pfr.feePacked1);
            ret = (block_timestamp - uint(time0)) * SCALE / uint(time1 - time0);
        }

        uint unpacked0 = unpackFee(pfr.feePacked0);
        uint multiply = unpackFee(pfr.feePacked1);
        multiply -= unpacked0;
        ret *= multiply;
        ret /= SCALE;
        ret += unpacked0;

        return ret;
    }

    function dispatchOne(address contractAddr, bytes calldata callData) private {
        (bool success, bytes memory returnData) = contractAddr.call(callData);
        if (!success) {
            // Handling failure, `returnData` might contain revert reason if provided by the called function
            if (returnData.length > 0) {
                // Try to decode the revert reason
                assembly {
                    let revertReasonPtr := add(returnData, 0x20)
                    let revertReasonLen := mload(returnData)
                    revert(revertReasonPtr, revertReasonLen)
                }
            } else {
                revert FailedCallNoReason(contractAddr, bytes4(callData[:4]));
            }
        }
    }
    // Format is: [contractAddr: 20] [callData length: 2 (big endian)] [callData: variable]
    function dispatchMulti(bytes calldata multiCallData) private {
        while (multiCallData.length > 22) {
            // Extract the contract address (20 bytes)
            address contractAddr = address(bytes20(multiCallData[0:20]));

            bytes calldata callData;
            {
                // Extract the length of callData (2 bytes)
                uint length = uint(bytes32(multiCallData[20:22])) >> 240;
                // Slice the callData based on the length
                callData = multiCallData[22 : 22 + length];
                multiCallData = multiCallData[22 + length : ];
            }

            // Call dispatchOne with the extracted address and call data
            dispatchOne(contractAddr, callData);
        }
    }

    function expireOutdated(
        address signer,
        uint64 block_timestamp,
        bytes calldata pollinatorData
    ) private {
        for (; 32 <= pollinatorData.length; pollinatorData = pollinatorData[32 : ]) {
            bytes32 b = bytes32(pollinatorData[ : 32]);
            emit PayAfterExpired(b, signer);
            bytes32 evict_eh = executionHash(b, signer);
            require(self_executionBlacklist[evict_eh] != 0, "No such entry");
            require(block_timestamp > self_executionBlacklist[evict_eh], "Not yet expired");
            delete self_executionBlacklist[evict_eh];
        }
    }

    function dispatch0(
        bytes calldata signedMultiCall,
        bytes calldata pollinatorData
    ) private returns (bytes calldata) {
        // It is required that we have at least one fee entry
        require(signedMultiCall.length >= FEE_START + 4);
        uint64 block_timestamp = uint64(block.timestamp);
        if (msg.sender == SIMULATE_ADDRESS && pollinatorData.length >= 8) {
            block_timestamp = uint64(bytes8(pollinatorData[:8]));
            pollinatorData = pollinatorData[8:];
        }
        ParseFeeRet memory pfr = parseFee(signedMultiCall, block_timestamp);
        require(pfr.feePacked0 < 0xffffffff, "Transaction not yet valid");
        require(pfr.expiration > block_timestamp, "Transaction has expired");

        address signer;
        {
            bytes32 dataHash = keccak256(signedMultiCall[SIG_START+SIG_LEN : ]);
            dataHash = keccak256(abi.encode(dataHash, block.chainid));
            dataHash = MessageHashUtils.toEthSignedMessageHash(dataHash);
            signer = ECDSA.recover(dataHash, signedMultiCall[SIG_START : SIG_START+SIG_LEN]);

            {
                uint24 c = uint24(bytes3(signedMultiCall[CSUM_START : CSUM_START+CSUM_LEN]));
                require(uint24(uint160(signer)) == c, "Corrupt signature");
            }

            if (signer == ESTIMATEGAS_ADDRESS) {
                // In estimateGas mode we use the msg sender so that signing is not required.
                signer = msg.sender;
                // This is a convenience for the pollinator which will fail execution if he is
                // estimating gas on a transaction which was (maliciously) signed using the
                // estimateGas address. This way he knows to discard the transaction and do
                // not under any circumstances send it.
                require(msg.sender != SIMULATE_ADDRESS, "Signed with estimateGas");
            }

            {
                bytes32 eh = executionHash(dataHash, signer);
                require(self_executionBlacklist[eh] == 0 || msg.sender == SIMULATE_ADDRESS,
                        "Already executed or killed");
                self_executionBlacklist[eh] = pfr.expiration;
            }

            emit PayAfter(dataHash, signer, pfr.expiration);
            require(self_state.signer == address(0), "Reentrence");
            self_state.signer = signer;
        }

        {
            uint fee = computeRequiredFee(pfr, block_timestamp);
            require(fee <= type(uint96).max, "Fee cannot be represented");
            self_state.fee = uint96(fee);
        }

        for (; 32 <= pollinatorData.length; pollinatorData = pollinatorData[32 : ]) {
            bytes32 b = bytes32(pollinatorData[ : 32]);
            emit PayAfterExpired(b, signer);
            bytes32 evict_eh = executionHash(b, signer);
            require(self_executionBlacklist[evict_eh] != 0, "No such entry");
            require(block_timestamp > self_executionBlacklist[evict_eh], "Not yet expired");
            delete self_executionBlacklist[evict_eh];
        }

        return signedMultiCall[pfr.dataOffset : ];
    }

    function dispatch1() private {
        uint fee = getRequiredFee();
        if (address(this).balance < fee) {
            revert FeeNotCovered(address(this).balance, fee);
        }
        payable(msg.sender).transfer(fee);
        if (address(this).balance > 0) {
            payable(self_state.signer).transfer(address(this).balance);
        }
        delete self_state;
    }

    // Recover address and dispatch
    function dispatch(bytes calldata signedMultiCall, bytes calldata pollinatorData) external override {
        signedMultiCall = dispatch0(signedMultiCall, pollinatorData);
        dispatchMulti(signedMultiCall);
        dispatch1();
    }

    receive() external payable { }
}