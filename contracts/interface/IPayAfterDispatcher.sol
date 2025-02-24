// SPDX-License-Identifier: MIT OR Apache-2
pragma solidity ^0.8.28;

interface IPayAfterDispatcher {
    event PayAfter(bytes32 dataHash, address signer, uint64 expiration);
    event PayAfterExpired(bytes32 dataHash, address signer);

    error FailedCallNoReason(address contractAddr, bytes4 functionId);
    error FeeNotCovered(uint balance, uint needed);

    function executionHash(bytes32 signatureHash, address sender) external pure returns (bytes32);
    function getSigner() external view returns (address);
    function killTransaction(bytes32 signatureHash) external;
    function executionBlacklist(bytes32 executionHash) external view returns (uint);
    function getRequiredFee() external view returns (uint);
    function dispatch(bytes calldata signedMultiCall, bytes calldata deleteReplays) external;
}