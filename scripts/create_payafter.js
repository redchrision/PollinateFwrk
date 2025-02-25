const { ethers } = require('hardhat');

const {
    prepareCall,
    signCalls,
    estimateGas,
    makeFee,
    makeInvalid,
    getUniswapV2Helper,
} = require('../dist/pollinate').PayAfter;

const SNEEZE = '0x9E5Ca6fdf143616b065e20d5B8ca4127e7d43CC6';
const UNISWAP_HELPER = '0xF6F3552fa5a5601b44b0F4b62a3C47Fc7AD1E6AD';

// Send 1 SNZ to the pollinator address
const SEND_TO = '0xd62320bD3359A89A7150F4aFF108D4916E55e26c';
const SEND_AMT = '0.01';


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function postPayAfter(txn) {
    try {
        const response = await fetch('http://127.0.0.1:8080/api/v1/payafter', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ txn }),
        });
        const result = await response.json();
        console.log('PayAfter Response:', result);
    } catch (error) {
        console.error('Error:', error);
    }
}

async function getAddressPayAfters(address) {
    const url = `http://127.0.0.1:8080/api/v1/address-payafters/${address}`;

    try {
        const response = await fetch(url, {
            method: 'GET' // Default, but explicit for clarity
        });
        const result = await response.json();
        console.log('Your PayAfters:', result);
    } catch (error) {
        console.error('Error:', error);
    }
}

async function main() {
    const [user] = await ethers.getSigners();
    console.log('Signing with account:', user.address);

    const deployerBalance = await ethers.provider.getBalance(user.address);
    console.log(`Caller has ${ethers.formatEther(deployerBalance.toString())} ETN`);

    const sneeze = await ethers.getContractAt('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20', SNEEZE);
    const uniswapV2Helper = await getUniswapV2Helper(user.provider);

    const userSneezes = await sneeze.balanceOf(await user.getAddress());
    console.log(`Caller has ${ethers.formatEther(userSneezes)} sneeze`);
    if (userSneezes < ethers.parseEther(SEND_AMT)) {
        throw new Error("Not enough balance to send");
    }

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
        makeFee(feeData.maxFeePerGas*gas).after(10).seconds,
        makeFee(feeData.maxFeePerGas*gas*3n/2n).after(30).seconds,
        makeFee(feeData.maxFeePerGas*gas*4n).after(5).minutes,
        makeInvalid().after(10).minutes,
    ];

    // Re-check the gas
    console.log('Gas2:', await estimateGas(user, calls, fees));

    // Sign the calls
    let signed = await signCalls(user, calls, fees);

    console.log(signed);

    await postPayAfter(signed);

    for (;;) {
        await getAddressPayAfters(user.address);
        await sleep(3000);
    }
}
main();