// SPDX-License-Identifier: MIT OR Apache-2
pragma solidity ^0.8.28;

import "../ERC20PayAfter.sol";

contract Sneeze is ERC20PayAfter {
    string constant public SNEEZE = "Achoo";
    constructor() ERC20PayAfter("Sneeze Token", "SNZ") {
        _mint(msg.sender, 21000000 * 10**18);
    }
}