import { JsonFragment } from '@ethersproject/abi';

export const UNISWAPV2_HELPER_ADDR =
    '0x69733fC2968C52836c5914846dCA0598167F345D'; // $$UniswapV2Helper::ADDRESS$$
export const UNISWAPV2_HELPER_ABI: JsonFragment[] =
    // $$UniswapV2Helper::ABI_BEGIN$$
[{"inputs":[{"internalType":"address","name":"uniswapV2Router","type":"address"},{"internalType":"address","name":"dispatcher","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[{"internalType":"address","name":"token","type":"address"}],"name":"coverFee","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"token","type":"address"},{"internalType":"uint256","name":"maxTokens","type":"uint256"}],"name":"coverFeeWithLimit","outputs":[],"stateMutability":"nonpayable","type":"function"}]
    // $$UniswapV2Helper::ABI_END$$
    ;

export const PERIODIC_DISPATCHER_ADDR =
    '0xbB07E62daD1cF13261b9812aB93585230Ce31F52'; // $$PeriodicDispatcher::ADDRESS$$
export const PERIODIC_DISPATCHER_ABI: JsonFragment[] =
    // $$PeriodicDispatcher::ABI_BEGIN$$
[{"inputs":[{"internalType":"address","name":"forWhom","type":"address"}],"name":"addNectar","outputs":[],"stateMutability":"payable","type":"function"},{"inputs":[{"internalType":"address","name":"ofWhom","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"periodicContract","type":"address"},{"internalType":"uint256","name":"minNectar","type":"uint256"}],"name":"dispatch","outputs":[],"stateMutability":"nonpayable","type":"function"},{"stateMutability":"payable","type":"receive"}]
    // $$PeriodicDispatcher::ABI_END$$
    ;

export const PAYAFTER_DISPATCHER_ADDR =
    '0x26399ABC180Ebc22a957Dbcf9Ec2070bfD806d70'; // $$PayAfterDispatcher::ADDRESS$$
export const PAYAFTER_DISPATCHER_ABI: JsonFragment[] =
    // $$PayAfterDispatcher::ABI_BEGIN$$
[{"inputs":[],"name":"ECDSAInvalidSignature","type":"error"},{"inputs":[{"internalType":"uint256","name":"length","type":"uint256"}],"name":"ECDSAInvalidSignatureLength","type":"error"},{"inputs":[{"internalType":"bytes32","name":"s","type":"bytes32"}],"name":"ECDSAInvalidSignatureS","type":"error"},{"inputs":[{"internalType":"address","name":"contractAddr","type":"address"},{"internalType":"bytes4","name":"functionId","type":"bytes4"}],"name":"FailedCallNoReason","type":"error"},{"inputs":[{"internalType":"uint256","name":"balance","type":"uint256"},{"internalType":"uint256","name":"needed","type":"uint256"}],"name":"FeeNotCovered","type":"error"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"bytes32","name":"dataHash","type":"bytes32"},{"indexed":false,"internalType":"address","name":"signer","type":"address"},{"indexed":false,"internalType":"uint64","name":"expiration","type":"uint64"}],"name":"PayAfter","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"bytes32","name":"dataHash","type":"bytes32"}],"name":"PayAfterExpired","type":"event"},{"inputs":[{"internalType":"bytes","name":"signedMultiCall","type":"bytes"},{"internalType":"bytes","name":"pollinatorData","type":"bytes"}],"name":"dispatch","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes32","name":"executionHash","type":"bytes32"}],"name":"getPastExecution","outputs":[{"components":[{"internalType":"address","name":"signer","type":"address"},{"internalType":"uint64","name":"expiration","type":"uint64"},{"internalType":"uint32","name":"packedFee","type":"uint32"}],"internalType":"struct IPayAfterDispatcher.State","name":"","type":"tuple"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"getRequiredFee","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"getSigner","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes","name":"signedMultiCall","type":"bytes"},{"internalType":"uint64","name":"currentTime","type":"uint64"}],"name":"parseFee","outputs":[{"internalType":"uint32","name":"feePacked","type":"uint32"},{"internalType":"uint32","name":"dataOffset","type":"uint32"},{"internalType":"uint64","name":"expiration","type":"uint64"}],"stateMutability":"pure","type":"function"},{"inputs":[{"internalType":"uint32","name":"packedFee","type":"uint32"}],"name":"unpackFee","outputs":[{"internalType":"uint256","name":"unpacked","type":"uint256"}],"stateMutability":"pure","type":"function"},{"stateMutability":"payable","type":"receive"}]
    // $$PayAfterDispatcher::ABI_END$$
    ;