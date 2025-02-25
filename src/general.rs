use std::{collections::HashMap, sync::Arc, time::SystemTime};

use alloy::{
    network::EthereumWallet,
    primitives::{Address, Bytes, B256, U256},
    providers::{
        fillers::{
            BlobGasFiller, ChainIdFiller, FillProvider, GasFiller, JoinFill, NonceFiller, WalletFiller
        },
        Identity, Provider
    },
};
use eyre::{Context, Result};
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, Mutex};

use crate::config::Config;


pub type MyProvider = FillProvider<
    JoinFill<
        JoinFill<Identity,
            JoinFill<GasFiller,
                JoinFill<BlobGasFiller,
                    JoinFill<NonceFiller, ChainIdFiller>,
                >,
            >,
        >,
        WalletFiller<EthereumWallet>,
    >,
    alloy::providers::RootProvider<
        alloy::transports::http::Http<alloy::transports::http::Client>
    >,
    alloy::transports::http::Http<alloy::transports::http::Client>,
    alloy::network::Ethereum
>;

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct StatePeriodic {
    pub last_checked_sec: u64,
    pub last_updated_sec: u64,
    pub last_estimated_gas: u64,
    pub last_available_nectar: U256,
    pub nectar_growth_per_sec: U256,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PayAfterWaiting {
    pub bin: Bytes,
    pub time_to_run: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub enum PayAfterTxnStatus {
    Waiting(PayAfterWaiting),
    Error(Vec<String>),
    Success(B256),
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PayAfterTxn {
    pub signer: Address,
    pub data_hash: B256,
    pub insert_time: u64,
    pub create_time: u64,
    pub status: PayAfterTxnStatus,
}

#[derive(Serialize, Deserialize, Default)]
pub struct State {
    pub periodic_contracts: HashMap<Address, StatePeriodic>,
    pub payafter: HashMap<B256, PayAfterTxn>,
}

pub struct ServerMut {
    pub state: State,
    pub gas_price: u128,
    pub gas_price_last_checked: u64,
    pub send_wakeup: mpsc::Sender<()>,
}

pub struct Server {
    pub m: Mutex<ServerMut>,
    pub cfg: Config,
    pub prov: MyProvider,
    pub minimum_profit: U256,
    pub my_addr: Address,
    pub txn_lock: Mutex<()>,
}

pub async fn gas_price(srv: &Arc<Server>) -> Result<u128> {
    let now = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH)?.as_secs();
    {
        let m = srv.m.lock().await;
        if m.gas_price_last_checked + 60 > now {
            return Ok(m.gas_price);
        }
    }
    let fee = srv.prov.get_max_priority_fee_per_gas().await
        .context("get_max_priority_fee_per_gas()")?;
    {
        let mut m = srv.m.lock().await;
        m.gas_price_last_checked = now;
        m.gas_price = fee;
    }
    Ok(fee)
}