module.exports = {
    uniswapV2Router: '0x072D4706f9A383D5608BD14B09b41683cb95fFd7',
    deployerPrivateKey: (() => { throw new Error("Please specify your private key in config.js"); })(),
    sneezeInitialLiquidity: 50n * 10n**18n,
    sneezeInitialLiquidityBase: 50n * 10n**18n,
};

if (!module.parent) {
    console.log(module.exports);
    const hh = require('hardhat');
    const eth = hh.ethers.formatEther(module.exports.sneezeInitialLiquidityBase.toString());
    console.log(`You will need: ${eth} base tokens to deploy.`);
}