// SPDX-License-Identifier: MIT OR Apache-2
pragma solidity ^0.8.28;

import "../sneezetoken/SneeseMine.sol";

contract MockSneezeMine is SneezeMine {
    address immutable self_periodicDispatcher;

    constructor(
        IERC20 _sneeze,
        IUniswapV2Router01 _uniswap,
        address _periodicDispatcher
    ) SneezeMine(_sneeze, _uniswap) {
        self_periodicDispatcher = _periodicDispatcher;
    }

    function periodicDispatcher() override public view returns (address payable) {
        return payable(self_periodicDispatcher);
    }
}