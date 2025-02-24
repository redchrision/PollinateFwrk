// SPDX-License-Identifier: MIT OR Apache-2
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import "./interface/IPeriodic.sol";
import "./interface/IPeriodicDispatcher.sol";

contract PeriodicDispatcher is IPeriodicDispatcher {
    mapping(address => uint) private self_balances;

    function balanceOf(address ofWhom) public view override returns (uint) {
        return self_balances[ofWhom];
    }

    function addNectar(address forWhom) public payable {
        self_balances[forWhom] += msg.value;
    }

    function dispatch(address periodicContract, uint minNectar) external {
        {
            uint _toPay = IPeriodic(periodicContract).nectarAvailable();
            require(minNectar <= _toPay, "Not enough nectar");
            minNectar = _toPay;
        }

        uint bal = address(this).balance;
        IPeriodic(periodicContract).periodic();
        IPeriodic(periodicContract).postPeriodic();
        bal = address(this).balance - bal + self_balances[periodicContract];

        {
            require(bal >= minNectar, "Not enough balance");
            bal -= minNectar;
            payable(msg.sender).transfer(minNectar);
            self_balances[periodicContract] = bal;
        }

        emit PeriodicPollinated(periodicContract, minNectar);
    }

    receive() external payable { }
}