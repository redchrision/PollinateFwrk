// SPDX-License-Identifier: MIT OR Apache-2
pragma solidity ^0.8.28;

interface IPeriodic {
    function nectarAvailable() external view returns (uint);
    function periodic() external;
    function postPeriodic() external;
}