// SPDX-License-Identifier: MIT OR Apache-2
pragma solidity ^0.8.24;

import "./MockPayAfter.sol";

import "hardhat/console.sol";

contract MockCallable is MockPayAfter {
    uint public total;
    address public lastCaller;

    constructor (address dispatcher) MockPayAfter(dispatcher) {}

    function callMeMaybe(uint val) external {
        console.log("MockCallable called with %d", val);
        console.logAddress(msgSender());
        lastCaller = msgSender();
        total += val;
    }
}