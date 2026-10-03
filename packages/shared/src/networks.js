"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUPPORTED_CHAIN_IDS = exports.BASE_MAINNET_CHAIN_ID = exports.BASE_FORK_CHAIN_ID = void 0;
exports.isSupportedChainId = isSupportedChainId;
exports.networkKindForChainId = networkKindForChainId;
exports.BASE_FORK_CHAIN_ID = 31337;
exports.BASE_MAINNET_CHAIN_ID = 8453;
exports.SUPPORTED_CHAIN_IDS = [
    exports.BASE_FORK_CHAIN_ID,
    exports.BASE_MAINNET_CHAIN_ID,
];
function isSupportedChainId(value) {
    return exports.SUPPORTED_CHAIN_IDS.includes(value);
}
function networkKindForChainId(chainId) {
    if (chainId === exports.BASE_FORK_CHAIN_ID)
        return 'base-fork';
    if (chainId === exports.BASE_MAINNET_CHAIN_ID)
        return 'base-mainnet';
    throw new Error(`Unsupported chain ID: ${chainId}`);
}
