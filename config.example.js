module.exports = {
    uniswapV2Router: '0x072D4706f9A383D5608BD14B09b41683cb95fFd7',
    deployerPrivateKey: (() => { throw new Error("Please specify your private key in config.js"); })(),
    sneezeInitialLiquidity: 50n * 10n**18n,
    sneezeInitialLiquidityBase: 50n * 10n**18n,
    // Only needed if you want to run ./scripts/sneeze_faucet.js
    sneezeFaucet: {
        imapConfig: {
            user: '',
            password: '',
            host: '',
            port: 993,
            tls: true,
            tlsOptions: { rejectUnauthorized: false },
        },
        smtpConfig: {
            host: 'smtp.gmail.com', // Replace with your SMTP server host
            port: 587, // Port (587 for TLS, 465 for SSL)
            secure: false, // Use TLS (false for port 587, true for port 465)
            auth: {
                user: 'your-email@gmail.com', // Your email address
                pass: 'your-app-specific-password' // Your email password or app-specific password
            }
        },
        fromLine: 'SneezeIt Bot <sneeze-it@cjdns.fr>',
        tokenAddress: '0x9E5Ca6fdf143616b065e20d5B8ca4127e7d43CC6',
        amountToSend: '13.37',
    },
};

if (!module.parent) {
    console.log(module.exports);
    const hh = require('hardhat');
    const eth = hh.ethers.formatEther(module.exports.sneezeInitialLiquidityBase.toString());
    console.log(`You will need: ${eth} base tokens to deploy.`);
}