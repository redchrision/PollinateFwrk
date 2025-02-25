const Fs = require('fs');
const { ethers, artifacts, run } = require('hardhat');
const config = require('../config');

const GENERATE = [
    './contracts/generate.sol',
    './lib/generate.ts',
    './src/generate.rs',
]

const SPECS = {
    PeriodicDispatcher: ["0x8B8b47d1637835eA002074FeBF0CDA85540F7432",true],
    PayAfterDispatcher: ["0xdCA2C12fD72710C5048cDE3Fe1223C4Da1865099",true],
    UniswapV2Helper: ["0xF6F3552fa5a5601b44b0F4b62a3C47Fc7AD1E6AD",true],

    Sneeze: ["0x9E5Ca6fdf143616b065e20d5B8ca4127e7d43CC6",true],
    SneezeMine: ["0x6f0538Dd18F1A6162aC971539030fc949190BE3A",true],
};
let LP_TOKEN = '';
LP_TOKEN = "0x480d752b4e3948Be7234117802A1eABC199f6757";


let hasDeployed = false;
async function deployOne0(name, args) {
    if (!ethers.isAddress(SPECS[name][0])) {
        console.log(`Deploying contract ${name} with ${JSON.stringify(args)}`);
        const dp = await ethers.deployContract(name, args);
        await dp.waitForDeployment();
        SPECS[name][0] = await dp.getAddress();
        console.log(`${name} has address ${SPECS[name][0]}`);
        hasDeployed = true;
    }
    if (!SPECS[name][1]) {
        console.log(`Uploading ${name} for verification`);
        await run('verify', { address: SPECS[name][0], constructorArgsParams: args });
        SPECS[name][1] = true;
    }
    console.log(`${name}: ${JSON.stringify(SPECS[name])}`);
    return SPECS[name][0];
}

async function deployOne(name, args) {
    if (!SPECS[name]) {
        SPECS[name] = [];
    }
    for (;;) {
        try {
            return await deployOne0(name, args);
        } catch (e) {
            console.log(`Failed deploy of ${name}: ${e}: Retry in 5 seconds`);
            console.log(`${name}: ${JSON.stringify(SPECS[name])}`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

async function template() {
    const abis = {};
    for (let key in SPECS) {
        const addr = SPECS[key][0];
        if (!ethers.isAddress(addr)) { throw new Error(`${key} has no address`); }
        abis[key] = (await artifacts.readArtifact(key)).abi;
    }
    for (let file of GENERATE) {
        const data = Fs.readFileSync(file, 'utf8');
        const out = [];
        let abi = '';
outer:
        for (let line of data.split('\n')) {
            if (abi) {
                if (line.indexOf(`$$${abi}::ABI_END$$`) > -1) {
                    out.push(line);
                    abi = '';
                }
                continue;
            }
            for (let key in SPECS) {
                if (line.indexOf(`$$${key}::ABI_BEGIN$$`) > -1) {
                    out.push(line);
                    out.push(JSON.stringify(abis[key]));
                    abi = key;
                    continue outer;
                } else if (line.indexOf(`$$${key}::ADDRESS$$`) > -1) {
                    out.push(line.replace(/0x[0-9a-fA-F]{40}/, SPECS[key][0]));
                    continue outer;
                }
            }
            out.push(line);
        }
        Fs.writeFileSync(file, out.join('\n'), 'utf8');
    }
}

const getLPTokenContract = async (token) => {
    const uniswapV2Router = await ethers.getContractAt('IUniswapV2Router01', config.uniswapV2Router);
    console.log('UniswapV2Router address : ', await uniswapV2Router.getAddress());
    const weth = await uniswapV2Router.WETH();
    console.log(`Uniswap WETH address: ${weth}`);
    const factory = await uniswapV2Router.factory();
    const uniswapV2Factory = await ethers.getContractAt('UniswapV2Factory', factory);
  
    console.log('UniswapV2Factory address : ', await uniswapV2Factory.getAddress());
  
    await token.approve(await uniswapV2Router.getAddress(), config.sneezeInitialLiquidity);
  
    const tx = await uniswapV2Router.addLiquidityETH(
        await token.getAddress(),
        config.sneezeInitialLiquidity,
        0,
        0,
        ethers.ZeroAddress,
        '0xffffffffffffffff',
        { value: config.sneezeInitialLiquidityBase }
    );
    await tx.wait();
  
    const lpTokenAddress = await uniswapV2Factory.getPair(weth, await token.getAddress());
    const lpToken = await ethers.getContractAt('UniswapV2Pair', lpTokenAddress);
    console.log(`const LP_TOKEN = "${await lpToken.getAddress()}";`);
  
    return lpToken;
};

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log('Deploying contracts with the account:', deployer.address);

    const deployerBalance = await ethers.provider.getBalance(deployer.address);
    console.log(`Deployer has ${ethers.formatEther(deployerBalance.toString())} ETN`);

    await deployOne("PeriodicDispatcher", []);
    const padAddr = await deployOne("PayAfterDispatcher", []);
    await deployOne("UniswapV2Helper", [ config.uniswapV2Router, padAddr ]);
    await template();
    if (hasDeployed) {
        console.log("Generated files updated, please re-run deploy");
        return;
    }
    const sneezeAddr = await deployOne("Sneeze", []);
    const sneeze = await ethers.getContractAt('Sneeze', sneezeAddr);
    if (!LP_TOKEN) {
        await getLPTokenContract(sneeze);
    }
    const sneezeMineAddr = await deployOne("SneezeMine", [await sneeze.getAddress(), config.uniswapV2Router]);
    const bal = await sneeze.balanceOf(deployer.address);
    console.log(`Sneeze balance is ${bal}`);
    await sneeze.transfer(sneezeMineAddr, bal);
}
main();