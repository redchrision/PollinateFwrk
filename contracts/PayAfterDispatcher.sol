// SPDX-License-Identifier: MIT OR Apache-2

pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import "./interface/IPayAfterDispatcher.sol";

import "hardhat/console.sol";

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

    // Private key is `echo 'estimateGas' | sha256sum`
    address constant ESTIMATEGAS_ADDRESS = 0x4f4082f93978CCb77661f797cc36521Af262f6B8;

    // STATE //
    State private self_state;
    mapping(bytes32 => State) private self_pastExecutions;
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
        (YEAR_SEC   << (32 * 6));

    uint32 constant PACKED_TIME_WIDTH = 7+3;
    /// Packed Time:
    ///  0               1               2               3
    ///  0 1 2 3 4 5 6 7 0 1 2 3 4 5 6 7 0 1 2 3 4 5 6 7 0 1 2 3 4 5 6 7
    /// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
    /// |                    Unused                 | TU  |   Fee Time  |
    /// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
    /// * TU        -> Time Unit (second, minute, hour, day, week, month, year)
    /// * Fee Time  -> After this number of time units, this fee will apply
    /// 
    /// @param packedTime Uint32 representation of packed time
    /// @return unpacked time as number of seconds
    function unpackTime(uint32 packedTime) internal pure returns (uint64 unpacked) {
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
        unpacked = packedFee             & ((1<<13) - 1);
        unpacked <<= (packedFee >> 13)   & ((1<< 8) - 1);
        return unpacked;
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
    /// If Fee Exp == 255, this is a kill entry which is used to create a
    /// deadline afterwhich the transaction becomes invalid.
    ///
    /// @param signedMultiCall The PayAfter signed blob
    /// @param currentTime The current timestamp
    /// @return feePacked The fee that must be paid
    /// @return dataOffset The offset of the beginning of the payload
    /// @return expiration The expiration time of the txn
    function parseFee(
        bytes calldata signedMultiCall,
        uint64 currentTime
    ) public pure returns (
        uint32 feePacked,
        uint32 dataOffset,
        uint64 expiration
    ) {
        uint64 creationTime = uint64(uint32(bytes4(signedMultiCall[TS_START : TS_START+TS_LEN])));
        // Start off with the kill fee, if there are no fee entries in the past then the transaction
        // is invalid with future expiration, meaning it will be valid in the future.
        feePacked = PACKED_KILL_FEE;
        uint32 feeEntry = 0;
        expiration = type(uint64).max;
        for (dataOffset = FEE_START; (feeEntry >> 31) == 0; dataOffset += 4) {
            require(dataOffset + 4 <= signedMultiCall.length, "parseFee() Buffer overflow");
            feeEntry = uint32(bytes4(signedMultiCall[dataOffset : dataOffset + 4]));
            if (expiration <= currentTime) {
                // Our transaction is killed
                // just walk the list until the end to get a correct dataOffset
                feePacked = PACKED_KILL_FEE;
                continue;
            }
            uint64 activateTime = creationTime + unpackTime(feeEntry >> PACKED_FEE_WIDTH);
            uint32 fp = feeEntry & ((uint32(1) << PACKED_FEE_WIDTH) - 1);
            if (activateTime <= currentTime) {
                feePacked = fp;
            }
            if (fp >= PACKED_KILL_FEE) {
                expiration = activateTime;
            }
        }
    }

    function getPastExecution(bytes32 executionHash) external view override returns (State memory) {
        return self_pastExecutions[executionHash];
    }

    function getSigner() external view override returns (address) {
        return self_state.signer;
    }

    function getRequiredFee() external view override returns (uint) {
        return unpackFee(self_state.packedFee);
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
                revert("Call failed without revert reason");
            }
        }
    }
    // Format is: [contractAddr: 20] [callData length: 2 (big endian)] [callData: variable]
    function dispatchMulti(bytes calldata multiCallData, uint offset) private {
        while (offset < multiCallData.length) {
            // Extract the contract address (20 bytes)
            address contractAddr = address(bytes20(multiCallData[offset : offset + 20]));
            offset += 20;

            bytes calldata callData;
            {
                // Extract the length of callData (2 bytes)
                uint length = uint(bytes32(multiCallData[offset : offset + 2])) >> 240;
                offset += 2;

                // Slice the callData based on the length
                callData = multiCallData[offset : offset + length];
                offset += length;
            }

            // Call dispatchOne with the extracted address and call data
            dispatchOne(contractAddr, callData);
        }
    }

    error FeeNotCovered(uint balance, uint needed);

    // Recover address and dispatch
    function dispatch(bytes calldata signedMultiCall, bytes calldata pollinatorData) external override {
        uint32 offset = 0;
        {
            State memory st;

            bytes32 dataHash = MessageHashUtils.toEthSignedMessageHash(
                keccak256(signedMultiCall[SIG_START+SIG_LEN : ]));
            st.signer = ECDSA.recover(dataHash, signedMultiCall[SIG_START : SIG_START+SIG_LEN]);

            {
                uint24 csum = uint24(bytes3(signedMultiCall[CSUM_START : CSUM_START+CSUM_LEN]));
                require(uint24(uint160(st.signer)) == csum, "Wrong address recovered");
            }

            if (st.signer == ESTIMATEGAS_ADDRESS) {
                // In estimateGas mode we use the msg sender so that signing is not required.
                st.signer = msg.sender;
            }

            for (; offset + 32 <= pollinatorData.length; offset += 32) {
                bytes32 b = bytes32(pollinatorData[offset : offset + 32]);
                require(self_pastExecutions[b].signer == st.signer, "Wrong signer");
                require(block.timestamp > self_pastExecutions[b].expiration, "Not yet expired");
                delete self_pastExecutions[b];
                emit PayAfterExpired(b);
            }

            (st.packedFee, offset, st.expiration) = parseFee(signedMultiCall, uint64(block.timestamp));
            require(st.packedFee < PACKED_KILL_FEE, "Deadline expired");

            require(self_state.signer == address(0), "Reentrence");

            require(self_pastExecutions[dataHash].signer == address(0), "Already executed");
            self_pastExecutions[dataHash] = st;
            self_state = st;
            emit PayAfter(dataHash, st.signer, st.expiration);
        }

        dispatchMulti(signedMultiCall, offset);

        {
            uint fee = unpackFee(self_state.packedFee);
            if (address(this).balance < fee) {
                revert FeeNotCovered(address(this).balance, fee);
            }
            payable(msg.sender).transfer(fee);
        }
        if (address(this).balance > 0) {
            payable(self_state.signer).transfer(address(this).balance);
        }
        delete self_state;
    }

    receive() external payable { }
}