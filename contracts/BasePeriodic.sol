// SPDX-License-Identifier: MIT OR Apache-2
pragma solidity ^0.8.28;

import "./interface/IPeriodic.sol";
import "./interface/IPeriodicDispatcher.sol";

abstract contract BasePeriodic is IPeriodic {
    uint64 immutable self_targetSecondsPerCycle;
    uint64 immutable self_cyclesPerRetarget;
    uint64 immutable self_deployTime;

    uint self_currentPayPerPeriod;
    uint64 self_cycles;
    uint64 self_lastRetargetTime;
    uint64 self_lastCycleTime;

    constructor(
        uint64 _targetSecondsPerCycle,
        uint64 _cyclesPerRetarget,
        uint _initialPayPerPeriod
    ) {
        self_targetSecondsPerCycle = _targetSecondsPerCycle;
        self_cyclesPerRetarget = _cyclesPerRetarget;
        self_deployTime = uint64(block.timestamp);

        // This will fail the deployment if self_dispatcher is not a real dispatcher
        IPeriodicDispatcher(periodicDispatcher()).balanceOf(address(0));

        self_currentPayPerPeriod = _initialPayPerPeriod;
        self_cycles = 1;
        self_lastRetargetTime = uint64(block.timestamp);
        self_lastCycleTime = uint64(block.timestamp);
    }

    uint constant SCALE = 1e18;
    function postPeriodic() public {
        require(msg.sender == address(periodicDispatcher()), "Wrong caller");
        if ((self_cycles % self_cyclesPerRetarget) == 0) {
            // It's a retarget
            uint adjustmentFactor;
            {
                uint realTime = block.timestamp - self_lastRetargetTime;
                uint expectedTime = self_targetSecondsPerCycle * self_cyclesPerRetarget;
                // Multiply by SCALE for precision
                adjustmentFactor = (realTime * SCALE) / expectedTime;
            }

            if (adjustmentFactor > SCALE*2) {
                adjustmentFactor = SCALE*2; // Max 2x increase
            } else if (adjustmentFactor < SCALE/2) {
                adjustmentFactor = SCALE/2; // Min 0.5x decrease
            }
            
            // If realTime < expectedTime, increase difficulty (reduce pay)
            // If realTime > expectedTime, decrease difficulty (increase pay)
            self_currentPayPerPeriod = self_currentPayPerPeriod * adjustmentFactor / SCALE;

            // Update last retarget time for next calculation
            self_lastRetargetTime = uint64(block.timestamp);
        }
        self_cycles += 1;
        self_lastCycleTime = uint64(block.timestamp);
    }

    function nectarAvailable() public view returns (uint) {
        uint secs = block.timestamp - self_lastCycleTime;
        uint payPerSecond = self_currentPayPerPeriod / self_targetSecondsPerCycle;
        return secs * payPerSecond;
    }

    function nectarShortfall() public view returns (uint) {
        uint na = nectarAvailable();
        uint bal = IPeriodicDispatcher(periodicDispatcher()).balanceOf(address(this));
        return (bal < na) ? (na - bal) : 0;
    }

    function periodicDispatcher() virtual public view returns (address payable);

    function periodic() virtual external;
}