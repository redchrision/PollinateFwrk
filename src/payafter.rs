use std::{sync::Arc, time::Duration};

use alloy::hex;
use alloy::primitives::{eip191_hash_message, Bytes, PrimitiveSignature};
use alloy::primitives::keccak256;
use alloy::{
    primitives::{utils::format_ether, Address, B256, U256},
    providers::Provider,
};
use alloy_sol_types::SolValue;
use eyre::{bail, Result};
use tokio::select;
use tokio::sync::mpsc;

use crate::general::{PayAfterTxn, PayAfterTxnStatus, PayAfterWaiting};
use crate::util::vstr_from_error;
use crate::{
    abi::IPayAfterDispatcher,
    generate::PAYAFTER_DISPATCHER_ADDR,
    config::Config, general::{
        gas_price,
        MyProvider,
        Server,
    }, util::now_sec,
};

const TIME_SKEW: u64 = 2;

/// This address substitutes msg.sender for the signer so for us, it's always invalid
const ESTIMATE_GAS_ADDR: Address =
    Address::new(hex!("0x4f4082f93978CCb77661f797cc36521Af262f6B8"));

pub struct Transaction {
    /// Transaction binary
    pub bin: Bytes,

    pub create_time: u64,

    /// The hash used for signing the transaction
    pub data_hash: B256,

    /// Signer address
    pub signer: Address,

    pub estimated_gas: Option<u64>,

    pub fees: Vec<(U256, u64)>
}
impl Transaction {
    pub fn when_valid(&self) -> u64 {
        self.fees.iter()
            .next()
            .map(|(amt,when)|if *amt < U256::MAX { *when } else { u64::MAX })
            .unwrap_or(u64::MAX)
    }
    pub fn when_expires(&self) -> u64 {
        self.fees.iter()
            .find(|(amt, _)|*amt == U256::MAX)
            .map(|(_,when)|*when)
            .unwrap_or(u64::MAX)
    }
    pub fn when_is_fee_at_least(&self, min_fee: U256) -> Option<u64> {
        for (i, (fee, time)) in self.fees.iter().enumerate() {
            if *fee < min_fee {
                continue;
            }
            if i == 0 {
                return Some(*time);
            }
            let (f_minus_one, t_minus_one) = self.fees[i-1];

            // Linear interpolation to figure out time in the range of t_minus_one..time
            // from min_fee's location in the range f_minus_one..fee
            let f0 = f_minus_one;         // U256
            let f1 = *fee;                // U256
            let t0 = U256::from(t_minus_one); // Convert u64 to U256
            let t1 = U256::from(*time);   // Convert u64 to U256
            let f_target = min_fee;       // U256

            let time_diff = t1 - t0;      // U256
            let fee_diff = f1 - f0;       // U256
            let fee_progress = f_target - f0; // U256

            // t = t0 + (f_target - f0) * (t1 - t0) / (f1 - f0)
            let interpolated_time = t0 + (fee_progress * time_diff) / fee_diff;

            // Convert back to u64; assumes time fits (max ~584 billion seconds)
            return Some(interpolated_time.to());
        }
        None
    }
}

pub fn parse_transaction(config: &Config, bin: Bytes) -> Result<Transaction>
{
    const SIG_START: usize = 0;
    const SIG_LEN: usize = 65;
    const CSUM_START: usize = SIG_START + SIG_LEN;
    const CSUM_LEN: usize = 3;

    let (signer, data_hash) = {
        // Extract signature (65 bytes from SIG_START)
        let signature = PrimitiveSignature::try_from(&bin[SIG_START..SIG_START + SIG_LEN])?;

        // Compute data hash: keccak256 of data after signature, then Ethereum signed message hash
        let data = &bin[SIG_START + SIG_LEN..];
        let data_hash = keccak256(data);
        let data_hash = keccak256((data_hash, U256::from(config.chain_id)).abi_encode());
        let data_hash = eip191_hash_message(&data_hash);
        let signer = signature.recover_address_from_prehash(&data_hash)?;
        (signer, data_hash)
    };

    if &signer.0.0[17..] != &bin[CSUM_START .. CSUM_START+CSUM_LEN] {
        bail!("Corrupted signature");
    }

    if signer == ESTIMATE_GAS_ADDR {
        bail!("Signed using the estimateGas key");
    }

    // A kill fee is shown as U256::MAX
    let (create_time, fees) = crate::fee::get_fees(&bin[..])?;

    Ok(Transaction{
        create_time,
        bin,
        data_hash,
        signer,
        estimated_gas: None,
        fees,
    })
}

async fn is_dead(txn: &Transaction, provider: MyProvider) -> Result<bool> {
    let contract = IPayAfterDispatcher::new(PAYAFTER_DISPATCHER_ADDR, provider);
    let eh = keccak256((&txn.data_hash, &txn.signer).abi_encode());
    let x: U256 = contract.executionBlacklist(eh).call().await?._0;
    Ok(x > U256::ZERO)
}

async fn simulate_txn(txn: &Transaction, provider: MyProvider, at_time: u64) -> Result<u64> {
    let contract =
        IPayAfterDispatcher::new(PAYAFTER_DISPATCHER_ADDR, provider.clone());
    let time = at_time.to_be_bytes();
    let call = contract.dispatch(
        txn.bin.clone().into(),
        time.into(),
    );
    let mut tx_request = call.into_transaction_request();
    tx_request.from = Some(Address::ZERO);
    let gas = provider.estimate_gas(&tx_request).await?;
    Ok(gas)
}

async fn estimate_gas(txn: &Transaction, provider: MyProvider) -> Result<u64> {
    let contract =
        IPayAfterDispatcher::new(PAYAFTER_DISPATCHER_ADDR, provider);
    let gas = contract.dispatch(
        txn.bin.clone().into(),
        [].into(),
    ).estimate_gas().await?;
    Ok(gas)
}

async fn run_txn(txn: &Transaction, srv: &Arc<Server>) -> Result<B256> {
    let contract =
        IPayAfterDispatcher::new(PAYAFTER_DISPATCHER_ADDR, srv.prov.clone());

    let gp = gas_price(srv).await?;
    let tx = contract.dispatch(
        txn.bin.clone().into(),
        [].into(),
    ).max_priority_fee_per_gas(gp).send().await?;

    let _l = srv.txn_lock.lock().await;
    println!("Trying PayAfter for {}", txn.data_hash);
    let bal = srv.prov.get_balance(srv.my_addr.clone()).await?;

    let tx = tx.with_timeout(Some(Duration::from_secs(60)));
    let txid = *tx.tx_hash();
    println!("  - TXID {}", txid);
    let recp = tx.get_receipt().await?;
    println!("  - In block {}", recp.block_number.unwrap_or(0));

    let bal2 = srv.prov.get_balance(srv.my_addr.clone()).await?;
    if bal2 > bal {
        println!("  - Profit: {}", format_ether(bal2 - bal));
    } else {
        println!("  - Loss: {}", format_ether(bal - bal2));
    }
    Ok(txid)
}

async fn accept_txn(srv: &Arc<Server>, txn: &Transaction, time_to_run: u64) -> Result<()> {
    let mut m = srv.m.lock().await;
    m.state.payafter.insert(txn.data_hash, PayAfterTxn{
        create_time: txn.create_time,
        signer: txn.signer.clone(),
        data_hash: txn.data_hash,
        insert_time: now_sec(),
        status: PayAfterTxnStatus::Waiting(PayAfterWaiting { bin: txn.bin.clone(), time_to_run }),
    });
    let _ = m.send_wakeup.send(()).await;
    Ok(())
}

pub enum DiscoverTxnRes {
    SentTxid(B256),
    WaitUntil(u64),
}

pub async fn discover_txn(srv: &Arc<Server>, mut txn: Transaction) -> Result<DiscoverTxnRes> {
    let now = now_sec() - TIME_SKEW;
    if txn.when_expires() <= now {
        bail!("Transaction has expired");
    }
    let dead = is_dead(&txn, srv.prov.clone()).await?;
    if dead {
        bail!("Transaction already run or killed");
    }
    let gas = match if txn.when_valid() < now {
        // Run a gas estimation directly since it's more exact
        println!("Run estimate_gas on {}", txn.data_hash);
        estimate_gas(&txn, srv.prov.clone()).await
    } else {
        println!("Run simulate_txn on {}", txn.data_hash);
        simulate_txn(&txn, srv.prov.clone(), txn.when_valid()).await
    } {
        Ok(gas) => gas,
        Err(e) => bail!("Transaction failed simulation: Error: {e}"),
    };
    txn.estimated_gas = Some(gas);
    println!("Txn {} has estimated gas: {}", txn.data_hash, gas);
    let min_payout =
        U256::from(gas) * U256::from(gas_price(srv).await?) + srv.minimum_profit;
    let time_to_run = match txn.when_is_fee_at_least(min_payout) {
        Some(t) => t,
        None => bail!("Transaction never pays minimum fee"),
    };
    println!("Expected min payoout for txn: {} is {}", txn.data_hash, min_payout);
    accept_txn(srv, &txn, time_to_run).await?;
    if time_to_run <= now {
        println!("Running {}", txn.data_hash);
        let txid = run_txn(&txn, srv).await?;
        Ok(DiscoverTxnRes::SentTxid(txid))
    } else {
        println!("Staging {} until {}", txn.data_hash, time_to_run);
        Ok(DiscoverTxnRes::WaitUntil(time_to_run))
    }
}

async fn get_ready_txn(srv: &Arc<Server>) -> (Option<PayAfterTxn>, u64) {
    let now = now_sec() - TIME_SKEW;
    let m = srv.m.lock().await;
    let mut shortest_time = u64::MAX;
    for (_, p) in &m.state.payafter {
        if let PayAfterTxnStatus::Waiting(w) = &p.status {
            if w.time_to_run <= now {
                return (Some(p.clone()), w.time_to_run);
            } else if w.time_to_run < shortest_time {
                shortest_time = w.time_to_run;
            }
        };
    }
    (None, shortest_time)
}

pub async fn check_payafter_thread(srv: Arc<Server>, mut recv_wakeup: mpsc::Receiver<()>) {
    // Walk over our list of txns, if there's one which is ready to be run, re-discover it
    loop {
        let (pat, wait_until) = get_ready_txn(&srv).await;
        let now = now_sec() - TIME_SKEW;
        let Some(mut pat) = pat else {
            select! {
                _ = recv_wakeup.recv() => {},
                _ = tokio::time::sleep(Duration::from_secs(wait_until - now)) => {},
            }
            continue;
        };
        let PayAfterTxnStatus::Waiting(w) = &pat.status else { panic!(); };
        let txn = match parse_transaction(&srv.cfg, w.bin.clone()) {
            Ok(txn) => txn,
            Err(e) => {
                println!("Error in stored payafter: {}: {}", pat.data_hash, e);
                pat.status = PayAfterTxnStatus::Error(vstr_from_error(e));
                pat.insert_time = now;
                let mut m = srv.m.lock().await;
                m.state.payafter.insert(pat.data_hash, pat);
                continue;
            }
        };
        println!("PayAfter: (re)discover_txn {}", txn.data_hash);
        match discover_txn(&srv, txn).await {
            Ok(DiscoverTxnRes::SentTxid(txid)) => {
                pat.status = PayAfterTxnStatus::Success(txid);
            }
            Ok(DiscoverTxnRes::WaitUntil(time)) => {
                pat.status = PayAfterTxnStatus::Waiting(PayAfterWaiting{ bin: w.bin.clone(), time_to_run: time });
            }
            Err(e) => {
                println!("Error in stored payafter: {}: {}", pat.data_hash, e);
                pat.status = PayAfterTxnStatus::Error(vstr_from_error(e));
            }
        }
        pat.insert_time = now;
        let mut m = srv.m.lock().await;
        m.state.payafter.insert(pat.data_hash, pat);
    }
}

#[cfg(test)]
mod tests {
    use alloy::{hex, primitives::{Address, B256, U256}};

    use crate::{config::Config, payafter::{parse_transaction, Transaction}};

    #[test]
    fn test_parse_txn() {
        // data_hash0 0x7f890a6b9009e36d4de04628574fa89cfef8e6b22f621bc780773a69aa21a272                                                                                                     
        // data_hash1 0x58fbf1a73229d295063c4ccfd6125266144115a0535f0bc852e80bef1401432d                                                                                                     
        // addr 0x70997970C51812dc3A010C7d01b50e0d17dc79C8                                                                                                                                   
        // csum dc79C8
        let txn = hex!(
            "a2584b9ef213ad607dacb2db90a7ce5645d27468dd2009cfc18c1016d5ec17e9"
            "63b1c1376a531c63fca4f7c121e4c677b680f531e9e65538864cc78f4366745d"
            "1cdc79C867bb960900000001214000022165fbc1a29e80009fE46736679d2D9a"
            "65F0992F2272dE9f3c7fa6e00044a9059cbb000000000000000000000000f39f"
            "d6e51aad88f6f4ce6ab8827279cfffb922660000000000000000000000000000"
            "00000000000000000002b5e3af16b18800009fE46736679d2D9a65F0992F2272"
            "dE9f3c7fa6e00044095ea7b30000000000000000000000002279b7a0a67db372"
            "996a5fab50d91eaa73d2ebe6ffffffffffffffffffffffffffffffffffffffff"
            "ffffffffffffffffffffffff2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6"
            "0024eb586a2b0000000000000000000000009fe46736679d2d9a65f0992f2272"
            "de9f3c7fa6e0"
        );
        let txn = parse_transaction(
            &Config{ chain_id: 31337, ..Default::default() },
            txn.into(),
        ).unwrap();

        // The fee on this txn indicated expiration after 20 hours.
        assert!(txn.when_expires() - txn.when_valid() == 20*60*60);
    }

    #[test]
    fn test_when_is_fee_at_least() {
        let tx = Transaction {
            fees: vec![
                (U256::from(100), 1000),
                (U256::from(200), 2000),
                (U256::from(300), 3000),
            ],
            create_time: 0,
            bin: [].into(),
            data_hash: B256::ZERO,
            signer: Address::ZERO,
            estimated_gas: None,
        };

        // Test case 1: Interpolated time between 100 and 200
        assert_eq!(
            tx.when_is_fee_at_least(U256::from(150)),
            Some(1500),
            "Should interpolate to 1500 when min_fee is 150"
        );

        // Test case 2: First fee meets threshold
        assert_eq!(
            tx.when_is_fee_at_least(U256::from(50)),
            Some(1000),
            "Should return first time (1000) when min_fee is 50"
        );

        // Test case 3: No fee meets threshold
        assert_eq!(
            tx.when_is_fee_at_least(U256::from(400)),
            None,
            "Should return None when min_fee is 400"
        );

        println!("All tests passed!"); // Optional confirmation
    }
}