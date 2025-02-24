// SPDX-License-Identifier: MIT OR Apache-2
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router01.sol";

import "../ERC20PayAfter.sol";
import "../Periodic.sol";

contract SneezeMine is Periodic {

    // Bitcoin numbers, except we compute a per-minute payout
    // because if we restrict calls to >= the target time, Periodic can't
    // ever pay enough fees to get the time to reach its target.
    uint64 constant HALVING_SEC = 60*60*24*365*4;
    uint256 constant INITIAL_PAYOUT = 5 * 10**18;
    uint64 constant MIN_SEC_PER_PAYOUT = 60;

    uint constant GEWI = 10**9;

    IERC20 immutable sneeze;
    IUniswapV2Router01 immutable uniswap;
    uint64 immutable launchTime;

    uint64 lastPayoutTime;

    constructor(
        IERC20 _sneeze,
        IUniswapV2Router01 _uniswap
    ) Periodic(
        60 * 10,                       // Target cycle time is 10 minutes
        100,                           // Retarget every 100 cycles
        331712 * GEWI * 2              // Initial gas estimation from testing shows 331712 gas,
                                       // Gas cost from block explorer is 1 GWEI,
                                       // double it for safety margin.
    ) {
        sneeze = _sneeze;
        uniswap = _uniswap;
        launchTime = uint64(block.timestamp);
        lastPayoutTime = uint64(block.timestamp);
    }

    function periodic() external override {
        // 1. Compute the amount of the token to yield
        uint amt = INITIAL_PAYOUT >> ((block.timestamp - launchTime) / HALVING_SEC);
        {
            uint payouts = (block.timestamp - lastPayoutTime) / MIN_SEC_PER_PAYOUT;
            if (payouts == 0) {
                return;
            }
            lastPayoutTime = uint64(block.timestamp);
            amt *= payouts;
        }

        // 2. find out how much additional ETH is needed
        uint shortfall = nectarShortfall();

        address[] memory path = new address[](2);
        path[0] = address(sneeze);
        path[1] = uniswap.WETH();

        // 3. Auth the sneeze market to use up to amt
        sneeze.approve(address(uniswap), amt);

        // 4. Swap to get that amount of ETH -> payto the dispatcher
        if (shortfall > 0) {
            uint balance = sneeze.balanceOf(address(this));
            uniswap.swapTokensForExactETH(shortfall, amt, path, periodicDispatcher(), block.timestamp);
            amt -= (balance - sneeze.balanceOf(address(this)));
        }

        // 5. Swap half of our amt
        {
            uint balance = sneeze.balanceOf(address(this));
            uniswap.swapExactTokensForETH(amt / 2, 0, path, address(this), block.timestamp);
            amt -= (balance - sneeze.balanceOf(address(this)));
        }

        // 6. deposit ETH + remaining half and burn the tokens
        uniswap.addLiquidityETH{value: address(this).balance}(
            address(sneeze), amt, 0, 0, address(0), block.timestamp);

        // 7. Sweep any dust ETH into the dispatcher to pay future periodic costs
        if (address(this).balance > 0) {
            periodicDispatcher().transfer(address(this).balance);
        }
    }

    receive() external payable { }
}