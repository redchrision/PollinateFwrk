const { ethers } = require('hardhat');

const SNEEZE_MINE = '0x4530F744Ca8562619EF75C70C9f88Df7533b2b95';

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log('Calling contracts with the account:', deployer.address);

    const deployerBalance = await ethers.provider.getBalance(deployer.address);
    console.log(`Caller has ${ethers.formatEther(deployerBalance.toString())} ETN`);

    // const periodic = await ethers.getContractAt('IPeriodic', '0x4530F744Ca8562619EF75C70C9f88Df7533b2b95');
    // const tx = await periodic.periodic({ gasLimit: 1000000 });
    // console.log(tx);
    // const x = await tx.wait();
    // console.log(x);

    const dispatcher = await ethers.getContractAt('IPeriodicDispatcher', '0xc87CFdc32244802C03e99870F719f9f92F34750A');
    const gas = await dispatcher.dispatch.estimateGas(SNEEZE_MINE, 0);
    console.log('Gas needed to dispatch:', gas);
    const tx = await dispatcher.dispatch(SNEEZE_MINE, 0, { gasLimit: gas });
    console.log(tx);
    const recp = await tx.wait();
    console.log(recp);
}
main();