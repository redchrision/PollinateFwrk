use std::{convert::Infallible, path::PathBuf, sync::Arc};

use alloy::{
    hex,
    network::EthereumWallet,
    primitives::{
        utils::{format_ether, parse_ether},
        Address,
        B256,
    },
    providers::{
        Provider,
        ProviderBuilder
    }, signers::{
        k256::elliptic_curve::rand_core::OsRng,
        local::{
            coins_bip39::{English, Entropy, Mnemonic},
            MnemonicBuilder
        }
    }, transports::http::reqwest::Url
};
use eyre::Result;
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, Mutex};
use warp::Filter;

use crate::{
    config::Config,
    err_is_400,
    general::{
        PayAfterTxnStatus,
        Server,
        ServerMut,
        State
    },
    payafter::{
        check_payafter_thread,
        discover_txn,
        parse_transaction,
        DiscoverTxnRes
    },
    periodic::check_periodics_thread,
    util::{reply_with, vstr_from_error},
};

#[derive(Serialize, Deserialize)]
struct PayAfterPost {
    txn: String,
}

#[derive(Serialize, Deserialize, Default)]
struct PayAfterRes {
    create_time: Option<u64>,
    txid: Option<B256>, // fully succeeded
    wait_until: Option<u64>, // accepted, will post later
    data_hash: Option<B256>,
    error: Option<Vec<String>>,
}

async fn api_payafter(
    q: PayAfterPost,
    srv: Arc<Server>,
) -> Result<Box<dyn warp::Reply>, Infallible> {
    let txn = err_is_400!(hex::decode(&q.txn));
    let txn = match parse_transaction(&srv.cfg, txn.into()) {
        Ok(txn) => txn,
        Err(e) => {
            return reply_with(&PayAfterRes{
                error: Some(vstr_from_error(e)),
                ..Default::default()
            });
        }
    };
    let data_hash = txn.data_hash.clone();
    let create_time = Some(txn.create_time);
    reply_with(&match discover_txn(&srv, txn).await {
        Ok(x) => {
            let mut par = PayAfterRes{
                data_hash: Some(data_hash),
                create_time,
                ..Default::default()
            };
            match x {
                DiscoverTxnRes::SentTxid(txid) => {
                    par.txid = Some(txid);
                    par
                }
                DiscoverTxnRes::WaitUntil(time) => {
                    par.wait_until = Some(time);
                    par
                }
            }
        },
        Err(e) => {
            PayAfterRes{
                data_hash: Some(data_hash),
                create_time,
                error: Some(vstr_from_error(e)),
                ..Default::default()
            }
        }
    })
}

async fn api_address_payafters(
    addr: Address,
    srv: Arc<Server>,
) -> Result<Box<dyn warp::Reply>, Infallible> {
    let m = srv.m.lock().await;
    let v = m.state.payafter.iter()
        .filter(|(_, pa)|pa.signer == addr)
        .map(|(id, pa)|PayAfterRes{
            create_time: Some(pa.create_time),
            txid: if let PayAfterTxnStatus::Success(txid) = &pa.status {
                Some(*txid)
            } else {
                None
            },
            wait_until: if let PayAfterTxnStatus::Waiting(wait) = &pa.status {
                Some(wait.time_to_run)
            } else {
                None
            },
            data_hash: Some(*id),
            error: if let PayAfterTxnStatus::Error(e) = &pa.status {
                Some(e.clone())
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    reply_with(&v)
}

pub async fn serve(config_path: PathBuf) -> Result<()> {
    let cfg = tokio::fs::read_to_string(config_path).await?;
    let cfg: Config = serde_yaml::from_str(&cfg)?;
    let mut state = if tokio::fs::try_exists(&cfg.state_file).await? {
        let state = tokio::fs::read_to_string(&cfg.state_file).await?;
        serde_json::from_str::<State>(&state)?
    } else {
        State::default()
    };

    for addr in &cfg.periodic_contracts {
        if !state.periodic_contracts.contains_key(addr) {
            state.periodic_contracts.insert(addr.clone(), Default::default());
        }
    }

    let minimum_profit = parse_ether(&cfg.minimum_profit)?;
    let rpc_server: Url = cfg.rpc_server.parse()?;

    let pass = match rpassword::prompt_password("Enter pollinator wallet password: ") {
        Ok(password) => password,
        Err(error) => {
            eprintln!("Error reading password: {}", error);
            return Ok(());
        }
    };

    Mnemonic::<English>::new_from_entropy(Entropy::from_rng(32, &mut OsRng::default())?);

    let wallet = MnemonicBuilder::<English>::default()
        .phrase(&cfg.seed)
        .index(0)?
        .password(pass)
        .build()?;
    let my_addr = wallet.address();
    println!("Pollinator address: {my_addr}");
    let wallet = EthereumWallet::from(wallet);

    let prov  = ProviderBuilder::new()
        .with_recommended_fillers()
        .wallet(wallet)
        .on_http(rpc_server);

    let bal = prov.get_balance(my_addr.clone()).await?;
    println!("Pollinator balance: {}", format_ether(bal));

    let (send_wakeup, recv_wakeup) = mpsc::channel(8);

    let srv = Arc::new(Server{
        m: Mutex::new(ServerMut {
            state,
            gas_price: 0,
            gas_price_last_checked: 0,
            send_wakeup,
        }),
        minimum_profit,
        cfg,
        prov,
        my_addr,
        txn_lock: Default::default(),
    });

    tokio::task::spawn(check_periodics_thread(Arc::clone(&srv)));

    tokio::task::spawn(check_payafter_thread(Arc::clone(&srv), recv_wakeup));

    let api = {
        let server = Arc::clone(&srv);
        warp::path!("api" / "v1" / "payafter")
            .and(warp::post())
            .and(warp::body::json())
            .and(warp::any().map(move || Arc::clone(&server)))
            .and_then(api_payafter)
    };
    let api = api.or({
        warp::path!("api" / "v1" / "payafter")
            .and(warp::options())
            .and_then(||async { reply_with(&serde_json::Value::Null) })
    });

    let api = api.or({
        let server = Arc::clone(&srv);
        warp::path!("api" / "v1" / "address-payafters" / Address)
            .and(warp::get())
            .and(warp::any().map(move || Arc::clone(&server)))
            .and_then(api_address_payafters)
    });

    warp::serve(api).bind(([127, 0, 0, 1], srv.cfg.bind_port)).await;

    Ok(())
}