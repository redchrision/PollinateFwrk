use alloy::primitives::{bytes::Buf, U256};
use eyre::{bail,Result};

// Time unit constants in seconds
const MINUTE_SEC: u64 = 60;
const HOUR_SEC: u64 = MINUTE_SEC * 60;
const DAY_SEC: u64 = HOUR_SEC * 24;
const WEEK_SEC: u64 = DAY_SEC * 7;
const MONTH_SEC: u64 = DAY_SEC * 30;
const YEAR_SEC: u64 = DAY_SEC * 365;

// Array of time units for easy indexing (replacing PACKED_TIME_UNIT)
const TIME_UNITS: [u64; 8] = [
    1,          // second
    MINUTE_SEC,
    HOUR_SEC,
    DAY_SEC,
    WEEK_SEC,
    MONTH_SEC,
    YEAR_SEC,
    10,
];

// Constants for bit widths
const TIME_UNIT_WIDTH: u32 = 3; // 3 bits for TU (0-6)
const FEE_TIME_WIDTH: u32 = 7;  // 7 bits for Fee Time (0-127)
// const PACKED_TIME_WIDTH: u32 = TIME_UNIT_WIDTH + FEE_TIME_WIDTH; // 10 bits total

/// Unpacks a packed time value into seconds
/// 
/// # Arguments
/// * `packed_time` - A u32 containing packed time data:
///   - Bits 0-6: Fee Time (number of time units)
///   - Bits 7-9: Time Unit (0=second, 1=minute, 2=hour, 3=day, 4=week, 5=month, 6=year)
/// 
/// # Returns
/// * `u64` - The unpacked time in seconds
pub fn unpack_time(mut packed_time: u32) -> u64 {
    packed_time >>= PACKED_FEE_WIDTH;
    // Extract Fee Time (lower 7 bits)
    let fee_time = (packed_time & ((1 << FEE_TIME_WIDTH) - 1)) as u64;

    // Extract Time Unit (next 3 bits, shifted right by 7)
    let tu = (packed_time >> FEE_TIME_WIDTH) & ((1 << TIME_UNIT_WIDTH) - 1);

    // Multiply Fee Time by the appropriate time unit from the array
    fee_time * TIME_UNITS[tu as usize]
}

// Constants for bit widths
const FEE_BASE_WIDTH: u32 = 13; // 13 bits for Fee Base
const FEE_EXP_WIDTH: u32 = 8;   // 8 bits for Fee Exp
const PACKED_FEE_WIDTH: u32 = FEE_BASE_WIDTH + FEE_EXP_WIDTH; // 21 bits total

// Kill fee: anything at or above this invalidates the transaction
const PACKED_KILL_FEE: u32 = (255 - 11) << FEE_BASE_WIDTH;

/// Unpacks a packed fee into its full value
/// 
/// # Arguments
/// * `packed_fee` - A u32 containing packed fee data:
///   - Bits 0-12: Fee Base (13 bits, 0-8191)
///   - Bits 13-20: Fee Exp (8 bits, 0-255)
/// 
/// # Returns
/// * `u64` - The unpacked fee (Fee Base << Fee Exp)
fn unpack_amt(mut packed_fee: u32) -> U256 {
    packed_fee &= (1 << PACKED_FEE_WIDTH) - 1;

    if packed_fee >= PACKED_KILL_FEE {
        return U256::MAX;
    }

    // Extract Fee Base (lower 13 bits)
    let fee_base = (packed_fee & ((1 << FEE_BASE_WIDTH) - 1)) as u64;

    // Extract Fee Exp (next 8 bits, shifted right by 13)
    let fee_exp = packed_fee >> FEE_BASE_WIDTH;

    // Compute fee = Fee Base << Fee Exp
    U256::from(fee_base) << fee_exp
}

pub fn unpack_fee(packed: u32) -> (U256, u64) {
    let amt = unpack_amt(packed);
    let time = unpack_time(packed);
    (amt, time)
}

pub fn get_fees(mut buffer: impl Buf) -> Result<(u64, Vec<(U256, u64)>)> {
    if buffer.remaining() < 68+4 {
        bail!("Buffer overflow");
    }
    buffer.advance(68); // sig and checksum
    let t0 = buffer.get_u32() as u64;
    let mut out = Vec::new();
    loop {
        if buffer.remaining() < 4 {
            bail!("Buffer overflow");
        }
        let fee = buffer.get_u32();
        let (fee_unpacked, time) = unpack_fee(fee);
        out.push((fee_unpacked, time + t0));
        if (fee >> 31) > 0 {
            return Ok((t0, out));
        }
    }
}

#[cfg(test)]
mod tests {
    use alloy::hex;
    use alloy::signers::k256::sha2::Sha256;
    use alloy::signers::k256::sha2::Digest;

    use super::*;

    const SEED: &str = "fee_parsing_test";
    const CYCLES: usize = 1000;
    const RES_HASH: &str = "eb65ae7b3410c05ed843824a33ac89456047375960b9f0fb880d217d470fecc7";
    
    fn sha256(input: &[u8]) -> [u8;32] {
        let mut hasher = Sha256::new();
        hasher.update(input);
        hasher.finalize().into()
    }

    #[test]
    fn test() {
        let mut out_hash = Vec::new();
        for i in 0..CYCLES {
            let input = format!("{}/{}", SEED, i);
            let hash_bytes = sha256(input.as_bytes());
            let num = u32::from_be_bytes(hash_bytes[0..4].try_into().unwrap());
            let (fee, secs) = unpack_fee(num);
            out_hash.push((fee, secs));
        }

        let string = serde_json::to_string(&out_hash).unwrap();
        // println!("{string}");
        let hash_bytes = sha256(string.as_bytes());
        assert_eq!(hex::encode(hash_bytes), RES_HASH);
    }
}