use alloy::signers::{k256::elliptic_curve::rand_core::OsRng, local::coins_bip39::{English, Entropy, Mnemonic}};
use clap::{Parser, Subcommand};
use std::path::PathBuf;
use eyre::Result;

mod abi;
mod config;
mod serve;
mod payafter;
mod periodic;
mod general;
mod fee;
mod util;
mod generate;

#[derive(Parser)]
#[command(name = "pollinated")]
#[command(about = "Pollinate Daemon", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Generates a default configuration file
    Genconf,
    /// Starts the delivery service with a specified config file
    Serve {
        /// Path to the configuration file
        #[arg(value_name = "CONFIG_PATH")]
        config_path: PathBuf,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Genconf => {
            let mne = Mnemonic::<English>::new_from_entropy(
                Entropy::from_rng(16, &mut OsRng::default())?);
            let seed = mne.to_phrase();
            println!(r#"
# List of Periodic smart contracts which we should be watching
periodic_contracts:
  - "0x6f0538Dd18F1A6162aC971539030fc949190BE3A" # SneezeMine

# Minimum amount of profit in whole units of the base token (200k GWEI)
minimum_profit: 0.0002

# Where on the FS to find/store state
state_file: "./state.json"

# RPC server
rpc_server: "https://rpc.electroneum.com"

# Chain ID (used for signature verification)
chain_id: 52014

# Port number to bind webserver
bind_port: 8080

# How often to re-check periodic contracts to see if they qualify for re-running
periodic_recheck_seconds: 60

# Encrypted seed words for wallet, by default these are randomly generated
# But when you start the server, you will be prompted for a passphrase
# These words plus your choice of passphrase will decide what actual address
# your node has.
seed: "{seed}"
"#, );
        }
        Commands::Serve { config_path } => {
            if config_path.exists() {
                serve::serve(config_path).await?;
            } else {
                eprintln!("Error: Config file not found at {}", config_path.display());
                std::process::exit(1);
            }
        }
    }
    Ok(())
}