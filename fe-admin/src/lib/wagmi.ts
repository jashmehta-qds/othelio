import { createConfig, createStorage, http } from 'wagmi';
import { base, foundry } from 'wagmi/chains';
import { injected, coinbaseWallet } from 'wagmi/connectors';

const isFork = process.env.NEXT_PUBLIC_CHAIN_ID === '31337';
const defaultChain = isFork ? foundry : base;
const configuredChains = isFork ? ([foundry, base] as const) : ([base, foundry] as const);
const baseRpcUrl = process.env.NEXT_PUBLIC_BASE_RPC_URL?.trim() || 'https://mainnet.base.org';

export const config = createConfig({
  ssr: true,
  storage: createStorage({ key: 'othelio.admin.wagmi.v1' }),
  chains: configuredChains,
  connectors: [
    injected({ unstable_shimAsyncInject: 1_000 }),
    coinbaseWallet({ appName: 'Othelio Operator Console' }),
  ],
  transports: {
    [foundry.id]: http('http://127.0.0.1:8545'),
    [base.id]: http(baseRpcUrl),
  },
});
