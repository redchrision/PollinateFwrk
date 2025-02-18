// SPDX-License-Identifier: MIT OR Apache-2
pragma solidity ^0.8.28;

interface IPayAfterDispatcher {
    struct State {
        address signer;
        uint64 expiration;
        uint32 packedFee;
    }

    event PayAfter(bytes32 dataHash, address signer, uint64 expiration);
    event PayAfterExpired(bytes32 dataHash);

    function getSigner() external view returns (address);
    function getPastExecution(bytes32 executionHash) external view returns (State memory);
    function getRequiredFee() external view returns (uint);
    function dispatch(bytes calldata signedMultiCall, bytes calldata deleteReplays) external;
}