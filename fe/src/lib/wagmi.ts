import { createConfig, createStorage, http } from 'wagmi';
import { base, foundry } from 'wagmi/chains';
import { injected, coinbaseWallet } from 'wagmi/connectors';
import { BASE_FORK_CHAIN_ID } from '@othelio/shared';

const defaultChain = process.env.NEXT_PUBLIC_CHAIN_ID === String(BASE_FORK_CHAIN_ID) ? foundry : base;
const configuredChains = defaultChain.id === foundry.id 
  ? ([foundry, base] as const)
  : ([base, foundry] as const);
const baseRpcUrl = process.env.NEXT_PUBLIC_BASE_RPC_URL;

if (process.env.NODE_ENV === 'production' && !baseRpcUrl) {
  throw new Error('NEXT_PUBLIC_BASE_RPC_URL must be configured for a production Base deployment.');
}

export const config = createConfig({
  // Defer persisted-wallet restoration to wagmi's effect-based hydration.
  // With ssr:false, wagmi calls onMount during render, which updates
  // AuthProvider while Hydrate is still rendering under React 19.
  ssr: true,
  storage: createStorage({ key: 'othelio.wagmi.v1' }),
  chains: configuredChains,
  connectors: [
    // MetaMask, Brave Wallet, and other browser-injected wallets all expose
    // the same EIP-1193 surface. Keep one connector for that provider so the
    // connector which persists a session is also the one that restores it.
    injected({ unstable_shimAsyncInject: 1_000 }),
    coinbaseWallet({ appName: 'Othelio' }),
  ],
  transports: {
    [foundry.id]: http('http://127.0.0.1:8545'),
    [base.id]: http(baseRpcUrl),
  },
});
