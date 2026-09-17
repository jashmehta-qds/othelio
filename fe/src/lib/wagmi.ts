import { createConfig, createStorage, http } from 'wagmi';
import { mainnet, base, baseSepolia, foundry } from 'wagmi/chains';
import { injected, coinbaseWallet } from 'wagmi/connectors';

export const config = createConfig({
  // Providers is a client-only boundary and does not receive a server cookie
  // state. Let wagmi restore its persisted state before the first client
  // render instead of delaying it to an SSR hydration pass.
  ssr: false,
  storage: createStorage({ key: 'othelio.wagmi.v1' }),
  chains: [foundry, baseSepolia, base],
  connectors: [
    // MetaMask, Brave Wallet, and other browser-injected wallets all expose
    // the same EIP-1193 surface. Keep one connector for that provider so the
    // connector which persists a session is also the one that restores it.
    injected({ unstable_shimAsyncInject: 1_000 }),
    coinbaseWallet({ appName: 'Othelio' }),
  ],
  transports: {
    [foundry.id]: http('http://127.0.0.1:8545'),
    [baseSepolia.id]: http(),
    [base.id]: http(),
  },
});
