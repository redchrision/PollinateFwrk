const Fs = require('fs');
const { ethers, artifacts, web3, run } = require('hardhat');

const GENERATE = [
    './contracts/generate.sol',
    './lib/generate.ts',
]

// https://blockexplorer.electroneum.com/address/0x072D4706f9A383D5608BD14B09b41683cb95fFd7?tab=read_contract#address-tabs
const UNISWAPV2_ROUTER_ADDR = '0x072D4706f9A383D5608BD14B09b41683cb95fFd7';
const SPECS = {

};

async function deployOne0(name, args) {
    if (!ethers.isAddress(SPECS[name][0])) {
        const dp = await ethers.deployContract(name, args);
        await dp.waitForDeployment();
        SPECS[name][0] = await dp.getAddress();
        console.log(`${name} has address ${SPECS[name][0]}`);
    }
    if (!SPECS[name][1]) {
        console.log(`Uploading ${name} for verification`);
        await run('verify', { address: dpAddress, constructorArgsParams: args });
        SPECS[name][1] = true;
    }
}

async function deployOne(name, args) {
    if (!SPECS[name]) {
        SPECS[name] = [];
    }
    for (;;) {
        try {
            await deployOne0(name, args);
            console.log(`Spec updated: ${JSON.stringify(SPECS[name])}`);
        } catch (e) {
            console.log(`Failed deploy of ${name}: ${e}: Retry in 5 seconds`);
            console.log(`Spec is currently: ${JSON.stringify(SPECS[name])}`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

async function template() {
    const ABIS = {};
    for (let key in SPECS) {
        const addr = SPECS[key][0];
        if (!ethers.isAddress(addr)) { throw new Error(`${key} has no address`); }
        ABIS[key] = await artifacts.readArtifact(key).abi;
    }
    for (let file of GENERATE) {
        const data = await Fs.readFile(file, 'utf8');
        const out = [];
        let abi = '';
outer:
        for (let line in data.split('\n')) {
            if (abi) {
                if (line.contains(`$$${abi}::ABI_END$$`)) {
                    out.push(line);
                    abi = '';
                }
                continue;
            }
            for (let key in SPECS) {
                if (line.contains(`$$${key}::ABI_BEGIN$$`)) {
                    out.push(line);
                    out.push(ABIS[key]);
                    abi = key;
                    continue outer;
                } else if (line.contains(`$$${key}::ADDRESS$$`)) {
                    out.push(line.replace(/0x[0-9a-fA-F]{40}/, SPECS[key][0]));
                    continue outer;
                }
            }
            out.push(line);
        }
        await Fs.writeFile(file, out.join('\n'), 'utf8');
    }
}


// 1. PeriodicDispatcher
// 2. PayAfterDispatcher
// 3. UniswapV2Helper
//
// 3. generate.sol
// 5. Sneeze
// 6. SneezeMarket
// 7. SneezeMine
// 8. Tx everything to SneezeMine
// 9. generate.ts
// 10. rebuild webpack


// After deploy, then example


async function main() {
    const [deployer] = await ethers.getSigners();
    console.log('Deploying contracts with the account:', deployer.address);

    // Check balance first
    const deployerBalance = await ethers.provider.getBalance(deployer.address);
    console.log(`Deployer has ${web3.utils.fromWei(deployerBalance.toString())} ETH`);

    await deployOne("PeriodicDispatcher", []);
    await deployOne("PayAfterDispatcher", []);
    await deployOne("UniswapV2Helper", [ UNISWAPV2_ROUTER_ADDR, SPECS['PayAfterDispatcher'][0] ]);
    await template();

    
}
main();