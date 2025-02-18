// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockWETH is ERC20 {
    constructor() ERC20("Wrapped Ether", "WETH") {}

    // Function to simulate ETH deposit by minting WETH
    function deposit() public payable {
        _mint(msg.sender, msg.value);
    }

    // Function to simulate ETH withdrawal by burning WETH
    function withdraw(uint256 wad) external {
        require(balanceOf(msg.sender) >= wad, "Insufficient balance");
        _burn(msg.sender, wad);
        payable(msg.sender).transfer(wad);
    }

    // Override transferFrom to include a hook for testing
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        super.transferFrom(from, to, amount);
        return true;
    }

    // Override approve to include a hook for testing
    function approve(address spender, uint256 amount) public override returns (bool) {
        super.approve(spender, amount);
        return true;
    }

    // Fallback function to allow ether to be sent directly to the contract
    receive() external payable {
        deposit();
    }
}