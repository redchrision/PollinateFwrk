use std::{sync::Arc, time::Duration};

use alloy::{
    primitives::{utils::format_ether, Address, U256},
    providers::Provider,
};
use eyre::{Context,Result};

use crate::{
    abi::{IPeriodic, IPeriodicDispatcher},
    generate::PERIODIC_DISPATCHER_ADDR,
    general::{
        gas_price, Server, StatePeriodic
    }, util::now_sec,
};

async fn estimate_gas(srv: &Arc<Server>, addr: &Address) -> Result<u64> {
    println!("estimate_gas()");
    let disp =
        IPeriodicDispatcher::new(PERIODIC_DISPATCHER_ADDR, srv.prov.clone());
    Ok(disp.dispatch(addr.clone(), U256::ZERO).estimate_gas().await
        .context("dispatch().estimate_gas()")?)
}

async fn get_nectar(srv: &Arc<Server>, addr: &Address) -> Result<U256> {
    println!("nectarAvailable()");
    let ip = IPeriodic::new(addr.clone(), srv.prov.clone());
    Ok(ip.nectarAvailable().call().await.context("nectarAvailable()")?._0)
}

async fn is_advantageous(srv: &Arc<Server>, nectar: U256, info: &StatePeriodic) -> Result<bool> {
    let fee = U256::from(info.last_estimated_gas) * U256::from(gas_price(srv).await?);
    Ok(nectar > fee + srv.minimum_profit)
}

async fn check_periodics(srv: &Arc<Server>) -> Result<bool> {
    let now = now_sec();
    let Some((addr, mut info)) = ({
        let m = srv.m.lock().await;
        let mut out = None;
        for (addr, info) in &m.state.periodic_contracts {
            if info.last_checked_sec + srv.cfg.periodic_recheck_seconds < now {
                out = Some((addr.clone(), info.clone()));
                break;
            }
        }
        out
    }) else {
        return Ok(false);
    };

    info.last_checked_sec = now;

    let nectar = if info.last_estimated_gas != 0 && info.last_available_nectar != U256::ZERO {
        if info.nectar_growth_per_sec != U256::ZERO {
            // We have all of the data, if the fee is not enough, we can skip
            let secs = now - info.last_updated_sec;
            info.last_available_nectar + info.nectar_growth_per_sec * U256::from(secs)
        } else {
            let nectar = get_nectar(srv, &addr).await?;
            // This doesn't count as an update
            info.nectar_growth_per_sec = nectar / U256::from(now - info.last_updated_sec);
            nectar
        }
    } else {
        info.last_available_nectar = get_nectar(srv, &addr).await?;
        info.last_estimated_gas = estimate_gas(srv, &addr).await?;
        info.last_updated_sec = now;
        info.nectar_growth_per_sec = U256::ZERO;
        info.last_available_nectar
    };
    
    if !is_advantageous(srv, nectar, &info).await? {
        println!("Not enough nectar to run {addr} yet, has {nectar} but projected cost is {} required profit: {}",
            U256::from(info.last_estimated_gas) * U256::from(gas_price(srv).await?), srv.minimum_profit);
        srv.m.lock().await.state.periodic_contracts.insert(addr, info);
        return Ok(true);
    }

    if nectar != info.last_available_nectar {
        info.last_estimated_gas = estimate_gas(srv, &addr).await?;
        info.last_available_nectar = get_nectar(srv, &addr).await?;
        info.last_updated_sec = now;
        info.nectar_growth_per_sec = U256::ZERO;
        if !is_advantageous(srv, info.last_available_nectar, &info).await? {
            srv.m.lock().await.state.periodic_contracts.insert(addr, info);
            return Ok(true);
        }
    }

    let _l = srv.txn_lock.lock().await;
    println!("Trying Periodic for {}", addr);

    let bal = srv.prov.get_balance(srv.my_addr.clone()).await?;

    let disp =
        IPeriodicDispatcher::new(PERIODIC_DISPATCHER_ADDR, srv.prov.clone());
    let x =
        disp.dispatch(addr.clone(), info.last_available_nectar).send().await
            .context("dispatch()")?
            .with_timeout(Some(Duration::from_secs(60)));
    println!("  - TXID {}", x.tx_hash());
    let recp = x.get_receipt().await?;
    println!("  - Landed in block {}", recp.block_number.unwrap_or(0));

    let bal2 = srv.prov.get_balance(srv.my_addr.clone()).await?;
    if bal2 > bal {
        println!("  - Profit: {}", format_ether(bal2 - bal));
    } else {
        println!("  - Loss: {}", format_ether(bal - bal2));
    }

    Ok(true)
}

pub async fn check_periodics_thread(srv: Arc<Server>) {
    loop {
        match check_periodics(&srv).await {
            Err(e) => {
                println!("Error running check_periodics: {e}");
                for ee in e.chain() {
                    println!("  - {ee}");
                }
                tokio::time::sleep(Duration::from_secs(60)).await;
            }
            Ok(true) => { continue; }
            Ok(false) => {},
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}