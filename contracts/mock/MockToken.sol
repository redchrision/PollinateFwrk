// SPDX-License-Identifier: MIT OR Apache-2
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./MockPayAfter.sol";

contract MockToken is ERC20, MockPayAfter {
    constructor(address dispatcher)
        ERC20("Mock Token", "MCK")
        MockPayAfter(dispatcher)
    {
        _mint(msg.sender, 21000000 * 10**18);
    }

    // Override Context in ERC20
    function _msgSender() override internal view returns (address) {
        return MockPayAfter.msgSender();
    }
}