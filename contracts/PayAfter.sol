// SPDX-License-Identifier: MIT OR Apache-2
pragma solidity ^0.8.28;

import "./interface/IPayAfterDispatcher.sol";
import "./generate.sol";

library PayAfter {
    function msgSender() internal view returns (address) {
        if (msg.sender == Generate.PAYAFTER_DISPATCHER) {
            return IPayAfterDispatcher(Generate.PAYAFTER_DISPATCHER).getSigner();
        } else {
            return address(msg.sender);
        }
    }
}