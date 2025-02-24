const { ethers } = require('hardhat');

const {
    prepareCall,
    signCalls,
    estimateGas,
    makeFee,
    makeInvalid,
    getUniswapV2Helper,
} = require('../dist/pollinate').PayAfter;

const SNEEZE = '0xacAB8A2C6E970AE050C72737F4D9e3F4b090e3a8';
const UNISWAP_HELPER = '0x1431614A5B6C091b8cB78dD84946CE09F7ffc237';

// Send 1 SNZ to the pollinator address
const SEND_TO = '0xd62320bD3359A89A7150F4aFF108D4916E55e26c';
const SEND_AMT = '1';

async function main() {
    const [user] = await ethers.getSigners();
    console.log('Signing with account:', user.address);

    const deployerBalance = await ethers.provider.getBalance(user.address);
    console.log(`Caller has ${ethers.formatEther(deployerBalance.toString())} ETN`);

    const sneeze = await ethers.getContractAt('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20', SNEEZE);
    const uniswapV2Helper = await getUniswapV2Helper(user.provider);

    // Setup the calls
    const calls = [];
    calls.push(await prepareCall(sneeze, "transfer", [SEND_TO, ethers.parseEther(SEND_AMT)]));
    const allow = await sneeze.allowance(await user.getAddress(), UNISWAP_HELPER);
    if (allow < ethers.MaxUint256) {
        calls.push(await prepareCall(sneeze, "approve", [UNISWAP_HELPER, ethers.MaxUint256]));
    }
    calls.push(await prepareCall(uniswapV2Helper, "coverFee", [SNEEZE]));

    // Pre-estimate the gas
    const gas = await estimateGas(user, calls, 4);
    const feeData = await ethers.provider.getFeeData();
    const baseFeePerGas = feeData.maxFeePerGas - feeData.maxPriorityFeePerGas;
    console.log(
        'Gas:', gas,
        'Fee1:', baseFeePerGas*gas,
        'Fee2:', feeData.maxFeePerGas*gas,
        'Fee3:', feeData.maxFeePerGas*gas*3n/2n,
    );

    // Build the fee policy
    const fees = [
        makeFee(baseFeePerGas*gas),
        makeFee(feeData.maxFeePerGas*gas).after(1).minute,
        makeFee(feeData.maxFeePerGas*gas*3n/2n).after(4).minutes,
        makeInvalid().after(10).minutes,
    ];

    // Re-check the gas
    console.log('Gas2:', await estimateGas(user, calls, fees));

    // Sign the calls
    let signed = await signCalls(user, calls, fees);

    console.log(signed);

    // const periodic = await ethers.getContractAt('IPeriodic', '0x4530F744Ca8562619EF75C70C9f88Df7533b2b95');
    // const tx = await periodic.periodic({ gasLimit: 1000000 });
    // console.log(tx);
    // const x = await tx.wait();
    // console.log(x);

    // const dispatcher = await ethers.getContractAt('IPeriodicDispatcher', '0xc87CFdc32244802C03e99870F719f9f92F34750A');
    // const gas = await dispatcher.dispatch.estimateGas(SNEEZE_MINE, 0);
    // console.log('Gas needed to dispatch:', gas);
    // const tx = await dispatcher.dispatch(SNEEZE_MINE, 0, { gasLimit: gas });
    // console.log(tx);
    // const recp = await tx.wait();
    // console.log(recp);
}
main();