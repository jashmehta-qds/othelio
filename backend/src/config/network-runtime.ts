import {
  BASE_FORK_CHAIN_ID,
  BASE_MAINNET_CHAIN_ID,
  networkKindForChainId,
  type SupportedChainId,
} from '@othelio/shared';

type RuntimeEnv = Record<string, string | undefined>;

export function rpcUrlForChain(chainId: number, env: RuntimeEnv = process.env): string | undefined {
  const kind = networkKindForChainId(chainId);
  if (kind === 'base-fork') {
    return env.ANVIL_RPC_URL || env.RPC_URL || 'http://127.0.0.1:8545';
  }
  return env.BASE_RPC_URL;
}

export function supportedRuntimeChainIds(): readonly SupportedChainId[] {
  return [BASE_FORK_CHAIN_ID, BASE_MAINNET_CHAIN_ID];
}
