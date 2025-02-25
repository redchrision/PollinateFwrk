alloy::sol!(
    #[sol(rpc)]
    #[sol(all_derives)]
    "contracts/interface/IPeriodic.sol"
);

alloy::sol!(
    #[sol(rpc)]
    #[sol(all_derives)]
    "contracts/interface/IPayAfterDispatcher.sol"
);

alloy::sol!(
    #[sol(rpc)]
    #[sol(all_derives)]
    "contracts/interface/IPeriodicDispatcher.sol"
);