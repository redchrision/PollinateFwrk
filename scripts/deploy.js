const Fs = require('fs');
const { ethers, artifacts, run } = require('hardhat');
const config = require('../config');

const GENERATE = [
    './contracts/generate.sol',
    './lib/generate.ts',
]

const SPECS = {
    PeriodicDispatcher: ["0xc87CFdc32244802C03e99870F719f9f92F34750A",true],
    PayAfterDispatcher: ["0x0A5D5350C01522DE37d64392E4af746899143BF9",true],
    UniswapV2Helper: ["0x1431614A5B6C091b8cB78dD84946CE09F7ffc237",true],
    Sneeze: ["0xacAB8A2C6E970AE050C72737F4D9e3F4b090e3a8",true],
    SneezeMine: ["0x4530F744Ca8562619EF75C70C9f88Df7533b2b95",true],
};
let LP_TOKEN = '';
LP_TOKEN = "0x99802D0b04D007794833272B45Cabd975e837c32";

async function deployOne0(name, args) {
    if (!ethers.isAddress(SPECS[name][0])) {
        console.log(`Deploying contract ${name} with ${JSON.stringify(args)}`);
        const dp = await ethers.deployContract(name, args);
        await dp.waitForDeployment();
        SPECS[name][0] = await dp.getAddress();
        console.log(`${name} has address ${SPECS[name][0]}`);
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