// SPDX-License-Identifier: MIT OR Apache-2
pragma solidity ^0.8.28;

import "../interface/IPayAfterDispatcher.sol";

contract MockPayAfter {
    address immutable self_dispatcher;

    constructor(address dispatcher) {
        self_dispatcher = dispatcher;
    }

    function msgSender() internal view returns (address) {
        if (msg.sender == self_dispatcher) {
            return IPayAfterDispatcher(self_dispatcher).getSigner();
        } else {
            return address(msg.sender);
        }
    }
}