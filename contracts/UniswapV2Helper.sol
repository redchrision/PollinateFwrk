// SPDX-License-Identifier: MIT OR Apache-2

pragma solidity ^0.8.28;

import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router01.sol";
import "@openzeppelin/contracts/interfaces/IERC20.sol";

import "./interface/IPayAfterDispatcher.sol";

// This contract helps you fund a PayAfter transaction by selling tokens on a UniswapV2 market
contract UniswapV2Helper {
    address self_router;
    address self_dispatcher;
    constructor(address uniswapV2Router, address dispatcher) {
        self_router = uniswapV2Router;
        self_dispatcher = dispatcher;
    }

    function coverFeeWithLimit(address token, uint maxTokens) public {
        IPayAfterDispatcher dispatcher = IPayAfterDispatcher(self_dispatcher);
        address signer = dispatcher.getSigner();
        if (maxTokens == 0) {
            maxTokens = IERC20(token).balanceOf(signer);
        }
        require(IERC20(token).transferFrom(signer, address(this), maxTokens), "Transfer failed");
        uint fee = dispatcher.getRequiredFee();
        IUniswapV2Router01 router = IUniswapV2Router01(self_router);
        require(IERC20(token).approve(address(router), type(uint).max), "Approve failed");

        address[] memory path = new address[](2);
        path[0] = token;
        path[1] = router.WETH();
        router.swapTokensForExactETH(fee, maxTokens, path, address(dispatcher), block.timestamp);

        require(IERC20(token).transfer(signer, IERC20(token).balanceOf(address(this))), "Refund failed");
    }

    function coverFee(address token) external {
        coverFeeWithLimit(token, 0);
    }
}