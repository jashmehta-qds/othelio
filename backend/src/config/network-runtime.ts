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
  // Keep standalone backend/dev launches usable when they are not started by
  // scripts/dev-base-services.sh (which normally injects BASE_RPC_URL). The
  // old Base adapter used this same public fallback; without it every quote
  // attempt is swallowed by the DEX adapter and reported as “no route”.
  return env.BASE_RPC_URL || 'https://mainnet.base.org';
}

export function supportedRuntimeChainIds(): readonly SupportedChainId[] {
  return [BASE_FORK_CHAIN_ID, BASE_MAINNET_CHAIN_ID];
}
