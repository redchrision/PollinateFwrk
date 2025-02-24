use alloy::primitives::Address;

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

// 0xc87CFdc32244802C03e99870F719f9f92F34750A
pub const PERIODIC_DISPATCHER_ADDR: Address = Address::new(
    *b"\xc8\x7C\xFd\xc3\x22\x44\x80\x2C\x03\xe9\x98\x70\xF7\x19\xf9\xf9\x2F\x34\x75\x0A");

// 0x0A5D5350C01522DE37d64392E4af746899143BF9
pub const PAYAFTER_DISPATCHER_ADDR: Address = Address::new(
    *b"\x0A\x5D\x53\x50\xC0\x15\x22\xDE\x37\xd6\x43\x92\xE4\xaf\x74\x68\x99\x14\x3B\xF9");

#[cfg(test)]
mod tests {
    #[test]
    fn test() {
        assert_eq!(&super::PERIODIC_DISPATCHER_ADDR.to_string(), "0xc87CFdc32244802C03e99870F719f9f92F34750A");
        assert_eq!(&super::PAYAFTER_DISPATCHER_ADDR.to_string(), "0x0A5D5350C01522DE37d64392E4af746899143BF9");
    }
}