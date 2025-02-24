// SPDX-License-Identifier: MIT OR Apache-2
pragma solidity ^0.8.28;

interface IPeriodicDispatcher {
    event PeriodicPollinated(address, uint);
    function addNectar(address forWhom) external payable;
    function balanceOf(address ofWhom) external view returns (uint);
    function dispatch(address periodicContract, uint minNectar) external;
}