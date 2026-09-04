import { http, createConfig } from 'wagmi';
import { mainnet, base, baseSepolia, foundry } from 'wagmi/chains';
import { injected, metaMask, coinbaseWallet } from 'wagmi/connectors';

export const config = createConfig({
  chains: [foundry, baseSepolia, base],
  connectors: [
    injected(),
    metaMask({ dappName: 'Othelio' }),
    coinbaseWallet({ appName: 'Othelio' }),
  ],
  transports: {
    [foundry.id]: http('http://127.0.0.1:8545'),
    [baseSepolia.id]: http(),
    [base.id]: http(),
  },
});
