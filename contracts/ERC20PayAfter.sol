// SPDX-License-Identifier: MIT OR Apache-2
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./PayAfter.sol";

contract ERC20PayAfter is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    // Override Context in ERC20
    function _msgSender() override internal view returns (address) {
        return PayAfter.msgSender();
    }
}