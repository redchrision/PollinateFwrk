require("@nomicfoundation/hardhat-toolbox");
const config = require('./config.js');

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    compilers: [
      {
        version: '0.8.28',
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000,
          },
          evmVersion: "paris",
          viaIR: true
        },
      },
      {
        // For testing Uniswap
        version: '0.6.6',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      }
    ],
  },
  networks: {
    electroneum: {
      _url: 'https://rpc.electroneum.com',
      url: 'https://rpc.ankr.com/electroneum',
      accounts: [config.deployerPrivateKey],
    },
  },
  etherscan: {
    apiKey: {
      // Is not required by blockscout. Can be any non-empty string
      electroneum: "x"
    },
    customChains: [
      {
        network: "electroneum",
        chainId: 52014,
        urls: {
          apiURL: "https://blockexplorer.electroneum.com/api",
          browserURL: "https://blockexplorer.electroneum.com/",
        }
      }
    ]
  },
  sourcify: {
    enabled: false
  }
};