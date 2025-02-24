use alloy::primitives::Address;
use serde::Deserialize;

#[derive(Deserialize,Default)]
pub struct Config {
    /// List of Periodic smart contracts which we should be watching
    pub periodic_contracts: Vec<Address>,
    /// Minimum amount of profit in whole units of the base token
    pub minimum_profit: String,
    /// Where on the FS to find/store state
    pub state_file: String,
    /// RPC server
    pub rpc_server: String,
    /// Chain ID, used for signature verification
    pub chain_id: u32,
    /// Port to bind the webserver
    pub bind_port: u16,
    /// How often to re-check periodic contracts to see if they qualift for re-running
    pub periodic_recheck_seconds: u64,
    /// Encryted seed words for wallet
    pub seed: String,
}