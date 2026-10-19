import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoinbaseTokenMetadataService } from './coinbase-token-metadata.service';

const aapl = '0xb200000000000000000000c2e324d24d7eecd1fb';
const msft = '0xb200000000000000000000ab99cfa739e253872b';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Coinbase token metadata', () => {
  it('loads all pages, keys by contract address, and caches the result', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tokens: [{ contract_address: aapl.toUpperCase().replace('0X', '0x'), symbol: 'AAPLc', name: 'Apple Inc.', decimals: 8, isin: 'US0378331005', icon_url: 'https://metadata.coinbase.com/apple.png', multiplier: 1, nav_price: 250.125, nav_price_updated_at: '2026-10-16T12:00:00Z' }], next_page_token: 'cursor' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tokens: [{ contract_address: msft, symbol: 'MSFTc', name: 'Microsoft Corp.', decimals: 8, description: 'Microsoft shares' }], next_page_token: null }) });
    vi.stubGlobal('fetch', fetch);
    const service = new CoinbaseTokenMetadataService();

    const metadata = await service.getAll();
    expect(metadata.get(aapl)).toMatchObject({ isin: 'US0378331005', navPrice: '250.125' });
    expect(metadata.get(msft)).toMatchObject({ description: 'Microsoft shares', navPrice: null });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[1][0])).toContain('page_token=cursor');
    expect(await service.getAll()).toBe(metadata);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the last complete snapshot after a failed refresh', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tokens: [{ contract_address: aapl, symbol: 'AAPLc', name: 'Apple', decimals: 8 }], next_page_token: null }) })
      .mockRejectedValueOnce(new Error('Coinbase unavailable'));
    vi.stubGlobal('fetch', fetch);
    const service = new CoinbaseTokenMetadataService();
    const first = await service.getAll();
    vi.advanceTimersByTime(600_001);
    expect(await service.getAll()).toBe(first);
    expect(first.get(aapl)?.symbol).toBe('AAPLc');
  });

  it('returns an empty map when the initial request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    expect((await new CoinbaseTokenMetadataService().getAll()).size).toBe(0);
  });
});
