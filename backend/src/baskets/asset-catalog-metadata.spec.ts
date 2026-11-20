import { afterEach, describe, expect, it, vi } from 'vitest';
import { BasketsService } from './baskets.service';

const { readContract, hasApprovedBasketRoute } = vi.hoisted(() => ({
  readContract: vi.fn(),
  hasApprovedBasketRoute: vi.fn(),
}));
vi.mock('viem', async (importOriginal) => ({
  ...await importOriginal<typeof import('viem')>(),
  createPublicClient: () => ({ readContract }),
}));
vi.mock('../dex/basket-route-readiness', () => ({
  resolveBasketRouteRegistry: async () => '0x2222222222222222222222222222222222222222',
  hasApprovedBasketRoute,
}));

const aapl = '0xb200000000000000000000c2e324d24d7eecd1fb';
const crcl = '0xb20000000000000000000019f6e7c675b73c2e4d';
const tsla = '0xb2000000000000000000001e800a7f5189430cd0';
const usdc = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe('asset catalog Coinbase enrichment', () => {
  it('adds metadata only to indexed assets without replacing their price or status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tokens: [
      { contract_address: aapl, symbol: 'AAPLc', name: 'Apple Inc.', decimals: 8, isin: 'US0378331005', description: 'Apple stock', icon_url: 'https://metadata.coinbase.com/apple.png', multiplier: 1, first_mint_date: '2026-09-03T18:11:07Z', total_supply: 2931.4761505, nav_price: 250.125, nav_price_updated_at: '2026-10-16T12:00:00Z' },
      { contract_address: crcl, symbol: 'CRCLc', name: 'Circle', decimals: 8, icon_url: 'https://metadata.coinbase.com/circle.png' },
      { contract_address: tsla, symbol: 'TSLAc', name: 'Tesla', decimals: 8, icon_url: 'https://metadata.coinbase.com/tesla.png' },
    ], next_page_token: null }) }));
    const db = { query: vi.fn().mockResolvedValue({ rows: [
      { asset_address: aapl, price_usd_e8: '24500000000', block_number: 123, block_hash: `0x${'a'.repeat(64)}`, observed_at: '2026-10-16T12:01:00Z', status: 'FRESH' },
      { asset_address: usdc, price_usd_e8: '100000000', block_number: 123, block_hash: `0x${'a'.repeat(64)}`, observed_at: '2026-10-16T12:01:00Z', status: 'FRESH' },
    ] }) };
    const service = new BasketsService(db as never, {} as never, {} as never);

    const { data } = await service.getAssets('8453');
    expect(data[0]).toMatchObject({ assetAddress: aapl, name: 'Apple Inc.', isin: 'US0378331005', description: 'Apple stock', coinbaseTotalSupply: '2931.4761505', coinbaseNavPrice: '250.125', priceUsdE8: '24500000000', status: 'FRESH', tradeable: true });
    expect(data[1]).toMatchObject({ assetAddress: usdc, isin: null, coinbaseNavPrice: null, priceUsdE8: '100000000', tradeable: true });
    expect(data).toHaveLength(14); // 13 known B20 assets plus indexed USDC
    expect(data.find((asset) => asset.assetAddress === crcl)).toMatchObject({ symbol: 'CRCLc', iconUrl: 'https://metadata.coinbase.com/circle.png', priceUsdE8: null, status: 'UNAVAILABLE', tradeable: false });
    expect(data.find((asset) => asset.assetAddress === tsla)).toMatchObject({ symbol: 'TSLAc', iconUrl: 'https://metadata.coinbase.com/tesla.png', priceUsdE8: null, status: 'UNAVAILABLE', tradeable: false });
    expect(data.filter((asset) => asset.assetAddress === aapl)).toHaveLength(1);
  });

  it('lists reviewed additions before indexing and never infers tradeability from an observation alone', async () => {
    const added = '0xb200000000000000000000000000000000000999';
    vi.stubEnv('B20_REVIEWED_FEEDS_JSON', JSON.stringify({ [added]: '0x3333333333333333333333333333333333333333' }));
    vi.stubEnv('ASSET_REGISTRY_ADDRESS', undefined);
    vi.stubEnv('OTHELIO_ASSET_REGISTRY', undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      tokens: [{ contract_address: added, symbol: 'NEWc', name: 'New Stock', decimals: 8 }],
    }) }));
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const staged = await new BasketsService(db as never, {} as never, {} as never).getAssets('8453');
    expect(staged.data.find((asset) => asset.assetAddress === added))
      .toMatchObject({ symbol: 'NEWc', tradeable: false, priceUsdE8: null });
    db.query.mockResolvedValue({ rows: [{
      asset_address: added, status: 'FRESH', price_usd_e8: '50000000000',
      block_number: 123, block_hash: `0x${'a'.repeat(64)}`, observed_at: '2026-10-16T12:01:00Z',
    }] });
    const indexed = await new BasketsService(db as never, {} as never, {} as never).getAssets('8453');
    expect(indexed.data.find((asset) => asset.assetAddress === added))
      .toMatchObject({ symbol: 'NEWc', tradeable: false, priceUsdE8: '50000000000' });
  });

  it.each([
    { matchesFeed: true, approvedRoute: true, tradeable: true },
    { matchesFeed: false, approvedRoute: true, tradeable: false },
    { matchesFeed: true, approvedRoute: false, tradeable: false },
  ])('uses the registry and route despite a cold metadata outage (%j)', async ({ matchesFeed, approvedRoute, tradeable }) => {
    const token = '0xb200000000000000000000000000000000000999';
    const feed = '0x3333333333333333333333333333333333333333';
    vi.stubEnv('B20_REVIEWED_FEEDS_JSON', JSON.stringify({ [token]: feed }));
    vi.stubEnv('ASSET_REGISTRY_ADDRESS', '0x4444444444444444444444444444444444444444');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Metadata unavailable')));
    readContract.mockImplementation(async ({ functionName }) => {
      if (functionName === 'getAsset') return {
        supported: true, isCoinbaseB20: true, tokenDecimals: 8, feedDecimals: 8,
        priceFeed: matchesFeed ? feed : '0x5555555555555555555555555555555555555555',
      };
      if (functionName === 'symbol') return 'NEWc';
      if (functionName === 'name') return 'New Stock';
    });
    hasApprovedBasketRoute.mockResolvedValue(approvedRoute);
    const db = { query: vi.fn().mockResolvedValue({ rows: [{
      asset_address: token, symbol: null, name: null, status: 'FRESH', price_usd_e8: '50000000000',
      block_number: 123, block_hash: `0x${'a'.repeat(64)}`, observed_at: '2026-10-16T12:01:00Z',
    }] }) };
    const { data } = await new BasketsService(db as never, {} as never, {} as never).getAssets('8453');
    expect(data.find((asset) => asset.assetAddress === token)).toMatchObject({
      symbol: matchesFeed ? 'NEWc' : null, decimals: matchesFeed ? 8 : null, priceUsdE8: '50000000000',
      coinbaseNavPrice: null, tradeable,
    });
  });
});
