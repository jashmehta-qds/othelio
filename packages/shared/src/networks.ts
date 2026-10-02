export const BASE_FORK_CHAIN_ID = 31337 as const;
export const BASE_MAINNET_CHAIN_ID = 8453 as const;

export const SUPPORTED_CHAIN_IDS = [
  BASE_FORK_CHAIN_ID,
  BASE_MAINNET_CHAIN_ID,
] as const;

export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];
export type NetworkKind = 'base-fork' | 'base-mainnet';

export type NetworkDeploymentAddresses = {
  factory: `0x${string}`;
  module: `0x${string}`;
  oracle: `0x${string}`;
  registry: `0x${string}`;
  usdc: `0x${string}`;
};

export function isSupportedChainId(value: number): value is SupportedChainId {
  return (SUPPORTED_CHAIN_IDS as readonly number[]).includes(value);
}

export function networkKindForChainId(chainId: number): NetworkKind {
  if (chainId === BASE_FORK_CHAIN_ID) return 'base-fork';
  if (chainId === BASE_MAINNET_CHAIN_ID) return 'base-mainnet';
  throw new Error(`Unsupported chain ID: ${chainId}`);
}
