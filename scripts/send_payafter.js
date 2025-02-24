const { ethers } = require('hardhat');

const { getDispatcher } = require('../dist/pollinate').PayAfter;

// 0x50f1b72a387814fadcd82a0df8c988ac5e1f78f62e4cd81f2787dc3dc462260d339f090365b3bc9824f0e75b865692e2f331e632230d04b79629f1eb5e9260971b5B7eC867b9ac2a00015187102492a810849bfc915e8000acAB8A2C6E970AE050C72737F4D9e3F4b090e3a80044a9059cbb000000000000000000000000d62320bd3359a89a7150f4aff108d4916e55e26c0000000000000000000000000000000000000000000000000de0b6b3a7640000acAB8A2C6E970AE050C72737F4D9e3F4b090e3a80044095ea7b30000000000000000000000001431614a5b6c091b8cb78dd84946ce09f7ffc237ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff1431614A5B6C091b8cB78dD84946CE09F7ffc2370024eb586a2b000000000000000000000000acab8a2c6e970ae050c72737f4d9e3f4b090e3a8

async function main() {
    const [user] = await ethers.getSigners();
    console.log('Signing with account:', user.address);

    const deployerBalance = await ethers.provider.getBalance(user.address);
    console.log(`Caller has ${ethers.formatEther(deployerBalance.toString())} ETN`);

    const dispatcher = await getDispatcher(user);
    const tx = await dispatcher.dispatch('0x50f1b72a387814fadcd82a0df8c988ac5e1f78f62e4cd81f2787dc3dc462260d339f090365b3bc9824f0e75b865692e2f331e632230d04b79629f1eb5e9260971b5B7eC867b9ac2a00015187102492a810849bfc915e8000acAB8A2C6E970AE050C72737F4D9e3F4b090e3a80044a9059cbb000000000000000000000000d62320bd3359a89a7150f4aff108d4916e55e26c0000000000000000000000000000000000000000000000000de0b6b3a7640000acAB8A2C6E970AE050C72737F4D9e3F4b090e3a80044095ea7b30000000000000000000000001431614a5b6c091b8cb78dd84946ce09f7ffc237ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff1431614A5B6C091b8cB78dD84946CE09F7ffc2370024eb586a2b000000000000000000000000acab8a2c6e970ae050c72737f4d9e3f4b090e3a8', '0x');
    console.log(tx);
    const recp = await tx.wait();
    console.log(recp);
}
main();