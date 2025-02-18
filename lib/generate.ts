import { Interface } from '@ethersproject/abi';
type AbiJson = Interface['fragments'];

export const UNISWAPV2_HELPER_ADDR =
    '0x0000000000000000000000000000000000000000'; // $$UniswapV2Helper::ADDRESS$$
export const UNISWAPV2_HELPER_ABI: AbiJson = [/*$$UniswapV2Helper::ABI$$*/];

export const PERIODIC_DISPATCHER_ADDR =
    '0x0000000000000000000000000000000000000000'; // $$PeriodicDispatcher::ADDRESS$$
export const PERIODIC_DISPATCHER_ABI: AbiJson = [/*$$PeriodicDispatcher::ABI$$*/];

export const PAYAFTER_DISPATCHER_ADDR =
    '0x0000000000000000000000000000000000000000'; // $$PayAfterDispatcher::ADDRESS$$
export const PAYAFTER_DISPATCHER_ABI: AbiJson = [/*$$PayAfterDispatcher::ABI$$*/];