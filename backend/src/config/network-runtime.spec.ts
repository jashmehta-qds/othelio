import { describe, expect, it } from 'vitest';
import { rpcUrlForChain } from './network-runtime';

describe('backend network runtime', () => {
  it('uses the local RPC for the Base fork and Base RPC for mainnet', () => {
    expect(rpcUrlForChain(31337, { ANVIL_RPC_URL: 'http://fork:8545' })).toBe('http://fork:8545');
    expect(rpcUrlForChain(8453, { BASE_RPC_URL: 'https://base.example' })).toBe('https://base.example');
  });

  it('keeps standalone Base launches usable without injected env', () => {
    expect(rpcUrlForChain(8453, {})).toBe('https://mainnet.base.org');
  });

  it('does not resolve unsupported Base Sepolia runtime configuration', () => {
    expect(() => rpcUrlForChain(84532, { BASE_SEPOLIA_RPC_URL: 'https://sepolia.example' })).toThrow(/Unsupported chain ID/);
  });
});
