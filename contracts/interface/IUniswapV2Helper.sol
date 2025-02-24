// SPDX-License-Identifier: MIT OR Apache-2

pragma solidity ^0.8.28;

interface IUniswapV2Helper {
    function coverFeeWithLimit(address token, uint maxTokens) external;
    function coverFee(address token) external;
}