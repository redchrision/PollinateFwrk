const Crypto = require('crypto');
const { makeFee } = require('../dist/pollinate.js').PayAfter;

const TU = [
    'seconds',
    'minutes',
    'hours',
    'days',
    'weeks',
    'months',
    'years',
];

const sha256 = (input) => {
    const hash = Crypto.createHash('sha256');
    hash.update(input);
    return hash.digest('hex');
};

const SEED = 'fee_parsing_test';
const CYCLES = 1000;

// 0xb1603400
// 

const PACKED_KILL_FEE = BigInt((255 - 11) << 13);
const PACKED_FEE_WIDTH = BigInt(13+8);

const main = async () => {
    const PayAfterDispatcher = await ethers.getContractFactory("PayAfterDispatcher");
    const pad = await PayAfterDispatcher.deploy();

    // First fee is at byte 72
    const prefix = '0x' + Array(72+1).join('00');

    for (let i = 0; i < CYCLES; i++) {
        const hash = sha256(`${SEED}/${i}`);
        const amt = BigInt('0x' + hash) >> 160n;
        const hashBuf = Buffer.from(hash, 'hex');
        const t = (hashBuf[0] % 127) + 1;
        const tun = hashBuf[1] % TU.length;
        const fee = makeFee(amt).after(t)[TU[tun]];
        // 
        const buf = prefix + fee.toBinary(true).toString(16).padStart(8, '0');
        const seconds = fee.timeSeconds();
        {
            // unpack time test
            let unpacked = await pad.unpackTime(fee.toBinary(true));
            if (seconds !== unpacked) {
                throw new Error(`Unpack wrong time`);
            }
        }
        {
            // Too early test
            const res = await pad.parseFee(buf, seconds - 1n);
            if (res[2] !== BigInt(0xffffffff)) {
                throw new Error(`Fee is effective on second ${seconds - 1n}`);
            }
        }
        const res = await pad.parseFee(buf, seconds);
        const packedFee = res[2];
        const unpacked = await pad.unpackFee(packedFee);
        if (unpacked !== fee.amtRounded()) {
            throw new Error(`Wrong amount`);
        }
        // out.push(`[${seconds},${unpacked}]`);
    }


    const out = [];
    for (let i = 0; i < CYCLES; i++) {
        const hash = sha256(`${SEED}/${i}`);
        const feeBin = BigInt('0x' + hash.slice(0,8));
        let unpackedFee;
        if ((feeBin & ((1n << PACKED_FEE_WIDTH) - 1n)) >= PACKED_KILL_FEE) {
            unpackedFee = (1n << 256n) - 1n
        } else {
            unpackedFee = await pad.unpackFee(feeBin);
        }
        const unpackedTime = await pad.unpackTime(feeBin);
        out.push(['0x' + unpackedFee.toString('16'), Number(unpackedTime)]);
    }
    // console.log(JSON.stringify(out));
    console.log(`Test Values:`);
    console.log(`const SEED: &str = "${SEED}";`);
    console.log(`const CYCLES: usize = ${CYCLES};`);
    console.log(`const RES_HASH: &str = "${sha256(JSON.stringify(out))}";`);
};
main();