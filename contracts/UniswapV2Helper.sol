// SPDX-License-Identifier: MIT OR Apache-2
pragma solidity ^0.8.28;

import '@uniswap/swap-router-contracts/contracts/interfaces/IV2SwapRouter.sol';
import '@uniswap/v3-periphery/contracts/interfaces/IPeripheryPayments.sol';
import "@openzeppelin/contracts/interfaces/IERC20.sol";

import "./interface/IPayAfterDispatcher.sol";

// This contract helps you fund a PayAfter transaction by selling tokens on a Uniswap market
contract UniswapV2Helper {
    address immutable self_router;
    address immutable self_dispatcher;
    address immutable self_weth;
    constructor(address uniswapRouter, address dispatcher, address weth) {
        self_router = uniswapRouter;
        self_dispatcher = dispatcher;
        self_weth = weth;
    }

    function coverFeeWithLimit(address token, uint maxTokens) public {
        IPayAfterDispatcher dispatcher = IPayAfterDispatcher(self_dispatcher);
        address signer = dispatcher.getSigner();
        if (maxTokens == 0) {
            maxTokens = IERC20(token).balanceOf(signer);
        }
        require(IERC20(token).transferFrom(signer, address(this), maxTokens), "Transfer failed");
        uint fee = dispatcher.getRequiredFee();
        address router = self_router;
        require(IERC20(token).approve(router, type(uint).max), "Approve failed");

        address[] memory path = new address[](2);
        path[0] = token;
        path[1] = self_weth;
        IV2SwapRouter(router).swapTokensForExactTokens(fee, maxTokens, path, router);
        IPeripheryPayments(router).unwrapWETH9(fee, self_dispatcher);

        require(IERC20(token).transfer(signer, IERC20(token).balanceOf(address(this))), "Refund failed");
    }

    function coverFee(address token) external {
        coverFeeWithLimit(token, 0);
    }
}