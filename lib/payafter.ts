import { ethers, Wallet, Signer } from 'ethers';
import {
    PAYAFTER_DISPATCHER_ADDR,
    PAYAFTER_DISPATCHER_ABI,
    UNISWAPV2_HELPER_ADDR,
    UNISWAPV2_HELPER_ABI,
} from './generate';

export const prepareCall = async (
    contract: ethers.Contract,
    funcName: string,
    args: any[]
): Promise<string> => {
    const buf: string[] = [await contract.getAddress()];
    const encodedData = await contract.interface.encodeFunctionData(funcName, args).slice(2);
    
    // Convert length to hex string
    const lengthHex = (encodedData.length / 2).toString(16).padStart(4, '0');
    
    buf.push(lengthHex);
    buf.push(encodedData);
    return buf.join('');
};

export type FeeEntry_t = {
    amt: bigint; 
    feeTime: number; 
    timeUnit: number; 
};

export type SelectTimeUnit_t = {
    second: Readonly<FeeEntry_t>,
    seconds: Readonly<FeeEntry_t>,
    minute: Readonly<FeeEntry_t>,
    minutes: Readonly<FeeEntry_t>,
    hour: Readonly<FeeEntry_t>,
    hours: Readonly<FeeEntry_t>,
    day: Readonly<FeeEntry_t>,
    days: Readonly<FeeEntry_t>,
    week: Readonly<FeeEntry_t>,
    weeks: Readonly<FeeEntry_t>,
    month: Readonly<FeeEntry_t>,
    months: Readonly<FeeEntry_t>,
    year: Readonly<FeeEntry_t>,
    years: Readonly<FeeEntry_t>,
};

export type InitialFeeTime_t = FeeEntry_t & { after: (feeTime: number) => Readonly<SelectTimeUnit_t> }

export const makeFee = (amt: bigint): Readonly<InitialFeeTime_t> => {
    try { 
        amt = BigInt(amt.toString()) + BigInt(0); 
    } catch (e) {
        throw new Error("makeFee(): amt must be a BigNum");
    }

    const outf = (timeUnit: number) => Object.freeze({
        amt: amt,
        feeTime: feeTime,
        timeUnit: timeUnit
    });

    let feeTime: number;

    return Object.freeze({
        amt,
        feeTime: 0,
        timeUnit: 0,
        after: (feeTimeInput: number) => {
            feeTime = feeTimeInput;
            if (feeTime < 1 || feeTime > 127 || !Number.isInteger(feeTime)) {
                throw new Error("makeFee().after(): feeTime must be an integer between 1 and 127, got: " + feeTime);
            }
            return Object.freeze({
                second: outf(0),
                seconds: outf(0),
                minute: outf(1),
                minutes: outf(1),
                hour: outf(2),
                hours: outf(2),
                day: outf(3),
                days: outf(3),
                week: outf(4),
                weeks: outf(4),
                month: outf(5),
                months: outf(5),
                year: outf(6),
                years: outf(6),
            });
        }
    });
};

export const makeInvalid = (): Readonly<InitialFeeTime_t> => makeFee(BigInt(1) << BigInt(256));

const feeTimeToSeconds = (fee: FeeEntry_t): bigint => {
    const FTM = [
        1,
        60,
        60*60,
        60*60*24,
        60*60*24*7,
        60*60*24*30,
        60*60*24*365,
    ];

    if (fee.timeUnit < 0 || fee.timeUnit >= FTM.length) {
        throw new Error("feeTimeToSeconds: Invalid timeUnit");
    }

    return BigInt(FTM[fee.timeUnit]) * BigInt(fee.feeTime);
};

const makeFeeEntries = (fees: FeeEntry_t[]): string => {
    const out: string[] = [];
    let lastSec: bigint = BigInt(-1);

    for (let i = 0; i < fees.length; i++) {
        const f = fees[i];
        if (typeof f.amt !== 'bigint' || typeof f.feeTime !== 'number' || typeof f.timeUnit !== 'number') {
            if (typeof(f) === 'object' && 'seconds' in f) {
                throw new Error("Invalid fee entry, it looks like you didn't specify the unit, for example " +
                    "makeFee(x).after(3) is invalid, makeFee(x).after(3).days is valid.");
            } else {
                throw new Error("Invalid fee entry: " + f);
            }
        }

        const nextSec = feeTimeToSeconds(f);
        if (nextSec <= lastSec) {
            throw new Error("Each fee entry time must be further in the future than the last, " +
                "for example [ makeFee(x).after(48).hours, makeFee(y).after(1).day ] is invalid. " +
                "Last Seconds: " + lastSec.toString() + ", Next Seconds: " + nextSec.toString());
        }
        lastSec = nextSec;

        let packedFee: number = 0;
        const MAX_VALID_FEE = BigInt(0x1fff) << BigInt(241);
        const PACKED_KILL_FEE = (255 - 11) << 13;
        if (f.amt > MAX_VALID_FEE) {
            if (f.amt === (BigInt(1) << BigInt(256))) {
                packedFee = PACKED_KILL_FEE;
            } else {
                throw new Error("Invalid fee: " + f.amt.toString());
            }
        } else {
            const MAX_FEE_BASE = (BigInt(1) << BigInt(13)) - BigInt(1);
            let feeExp = 0;
            let fee = f.amt;
            while (fee > MAX_FEE_BASE) {
                fee >>= BigInt(1);
                feeExp++;
            }
            packedFee = (feeExp << 13) | Number(fee);
        }

        const packedTime = (f.timeUnit << 7) | f.feeTime;

        const PACKED_FEE_WIDTH = 13 + 8;

        const fee = Buffer.alloc(4);
        fee.writeUInt32BE((packedTime << PACKED_FEE_WIDTH) | packedFee);
        if (i + 1 >= fees.length) {
            fee[0] |= (1 << 7);
        }
        out.push(fee.toString('hex'));
    }
    return out.join('');
};

const hexToBytes = (hex: string): Uint8Array => {
    hex = hex.startsWith('0x') ? hex.slice(2) : hex;
    const array = new Uint8Array(hex.length / 2);
    for (let i = 0; i < array.length; i++) {
        array[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return array;
};

export const signCalls = async (signer: Signer, calls: string[], fees: FeeEntry_t[]): Promise<string> => {
    const csum = (await signer.getAddress()).slice(-6);

    const ts = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');

    if (fees.length < 1) { 
        throw new Error("signCalls() at least one fee specification is required."); 
    }

    const feeEntries = makeFeeEntries(fees);

    const data = calls.map((c) => c.replace(/^0x/, '')).join('');

    const signedData = csum + ts + feeEntries + data;

    const hash = ethers.keccak256('0x' + signedData);
    const signature = await signer.signMessage(hexToBytes(hash.slice(2)));

    return signature + signedData;
};

// echo 'estimateGas' | sha256sum
// address: 0x4f4082f93978CCb77661f797cc36521Af262f6B8
const ESTIMATEGAS_PRIVATE_KEY: string =
    "0x380441db97755d0aadf651d31fa561cc09e20a1a2c94d117d5b234ffc61745c6"; 

export const estimateGasCustom = async (
    signer: ethers.Signer,
    calls: string[],
    fees: number | FeeEntry_t[],
    dispatcher: ethers.Contract
): Promise<bigint> => {
    const fakeSigner = new Wallet(ESTIMATEGAS_PRIVATE_KEY, signer.provider);
    let realFees: FeeEntry_t[];

    if (typeof(fees) === 'number') {
        realFees = [];
        for (let i = 0; i < fees; i++) {
            realFees.push(makeFee(BigInt(1)).after(i+1).seconds);
        }
    } else {
        realFees = fees as FeeEntry_t[];
    }

    const signed = await signCalls(fakeSigner, calls, realFees);
    return await (dispatcher.connect(signer) as ethers.Contract).dispatch.estimateGas(signed, '0x');
};

export const getDispatcher = (provider: ethers.Provider, address?: string) =>
    new ethers.Contract(address || PAYAFTER_DISPATCHER_ADDR, PAYAFTER_DISPATCHER_ABI, provider);

export const getUniswapV2Helper = (provider: ethers.Provider, address?: string) =>
    new ethers.Contract(address || UNISWAPV2_HELPER_ADDR, UNISWAPV2_HELPER_ABI, provider);

export const estimateGas = async (
    signer: ethers.Signer,
    calls: string[],
    fees: number | FeeEntry_t[],
    dispatcherAddress?: string
): Promise<bigint> => await estimateGasCustom(
    signer, calls, fees, getDispatcher(signer.provider, dispatcherAddress));