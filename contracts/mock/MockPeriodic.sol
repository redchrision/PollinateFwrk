// SPDX-License-Identifier: MIT OR Apache-2
pragma solidity ^0.8.28;

import "../BasePeriodic.sol";

contract MockPeriodic is BasePeriodic {
    uint public counter;
    address private immutable self_dispatcher;
    constructor(address dispatcher) BasePeriodic(
        60 * 10,                       // _targetSecondsPerCycle
        100,                           // _cyclesPerRetarget
        1 * 10**18 / uint(2726) / 10   // _initialPayPerPeriod
    ) {
        self_dispatcher = dispatcher;
    }
    function periodic() external override {
        counter++;
    }
    function periodicDispatcher() override public view returns (address payable) {
        return payable(self_dispatcher);
    }
    // Add a default receiver which adds the coins as nectar
    receive() external payable {
        IPeriodicDispatcher(periodicDispatcher()).addNectar{ value: msg.value }(address(this));
    }
}