// SPDX-License-Identifier: MIT OR Apache-2
pragma solidity ^0.8.28;

import "./BasePeriodic.sol";
import "./generate.sol";

abstract contract Periodic is BasePeriodic {
    constructor(
        uint64 _targetSecondsPerCycle,
        uint64 _cyclesPerRetarget,
        uint _initialPayPerPeriod
    ) BasePeriodic(
        _targetSecondsPerCycle,
        _cyclesPerRetarget,
        _initialPayPerPeriod
    ) {
    }

    function periodicDispatcher() override virtual public view returns (address payable) {
        return payable(Generate.PERIODIC_DISPATCHER);
    }
}