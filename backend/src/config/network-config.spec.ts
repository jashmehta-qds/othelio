import { describe, expect, it } from 'vitest';
import {
  BASE_FORK_CHAIN_ID,
  BASE_MAINNET_CHAIN_ID,
  SUPPORTED_CHAIN_IDS,
  isSupportedChainId,
  networkKindForChainId,
} from '@othelio/shared';

describe('shared network contract', () => {
  it('supports only the local Base fork and Base mainnet', () => {
    expect(BASE_FORK_CHAIN_ID).toBe(31337);
    expect(BASE_MAINNET_CHAIN_ID).toBe(8453);
    expect(SUPPORTED_CHAIN_IDS).toEqual([31337, 8453]);
    expect(isSupportedChainId(31337)).toBe(true);
    expect(isSupportedChainId(8453)).toBe(true);
    expect(isSupportedChainId(84532)).toBe(false);
  });

  it('classifies supported networks exactly', () => {
    expect(networkKindForChainId(31337)).toBe('base-fork');
    expect(networkKindForChainId(8453)).toBe('base-mainnet');
    expect(() => networkKindForChainId(84532)).toThrow(/Unsupported chain ID/);
  });
});
