import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { decodeFunctionData, zeroAddress } from 'viem';
import { seriesFactoryAbi } from '@othelio/shared';
import { AdminMarketsService } from './admin-markets.service';
import { validateExpiryCalendar } from './calendar.util';

const reviewedFeed = '0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c';
let adapterFeed = reviewedFeed;
let registeredFeed: string | undefined;
let approved = false;
let existing: string = zeroAddress;
let feedAge = 1n;
vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createPublicClient: () => ({
      getBytecode: async () => '0x6000',
      getBlock: async () => ({ number: 12n, timestamp: BigInt(Math.floor(Date.now() / 1000)) }),
      readContract: async ({ functionName }: { functionName: string }) =>
        functionName === 'latestRoundData'
          ? [1n, 50000000000n, 1n, BigInt(Math.floor(Date.now() / 1000)) - feedAge, 1n]
          : functionName === 'priceFeed' ? adapterFeed
          : functionName === 'maxStaleness' ? 3600n
          : functionName === 'decimals' ? 8
          : functionName === 'description' ? 'MSFT / USD'
          : functionName === 'seriesByTermKey' ? existing
          : functionName === 'approvedExpiry' || functionName === 'approvedAdapter' ? approved
          : functionName === 'symbol' ? 'NEWc'
          : functionName === 'getAsset' && registeredFeed
            ? { supported: true, isCoinbaseB20: true, priceFeed: registeredFeed, tokenDecimals: 8, feedDecimals: 8 }
            : false,
    }),
  };
});

describe('AdminMarketsService & Calendar Utilities', () => {
  const msftAddress = '0xB200000000000000000000Ab99cFa739E253872B';
  const priorFactory = process.env.RISK_SPLIT_FACTORY_ADDRESS;
  const priorAdapter = process.env.RISK_SPLIT_SETTLEMENT_ADAPTER;
  const priorRegistry = process.env.ASSET_REGISTRY_ADDRESS;
  beforeEach(() => {
    registeredFeed = reviewedFeed;
    adapterFeed = reviewedFeed;
    approved = false;
    existing = zeroAddress;
    feedAge = 1n;
  });
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
    process.env.RISK_SPLIT_FACTORY_ADDRESS = '0x1111111111111111111111111111111111111111';
    process.env.RISK_SPLIT_SETTLEMENT_ADAPTER = '0x3333333333333333333333333333333333333333';
    process.env.ASSET_REGISTRY_ADDRESS = '0x2222222222222222222222222222222222222222';
  });
  afterAll(() => {
    vi.useRealTimers();
    if (priorFactory === undefined) delete process.env.RISK_SPLIT_FACTORY_ADDRESS;
    else process.env.RISK_SPLIT_FACTORY_ADDRESS = priorFactory;
    if (priorAdapter === undefined) delete process.env.RISK_SPLIT_SETTLEMENT_ADAPTER;
    else process.env.RISK_SPLIT_SETTLEMENT_ADAPTER = priorAdapter;
    if (priorRegistry === undefined) delete process.env.ASSET_REGISTRY_ADDRESS;
    else process.env.ASSET_REGISTRY_ADDRESS = priorRegistry;
  });

  it('refuses a signable preview without deployed factory and adapter configuration', async () => {
    const previousFactory = process.env.RISK_SPLIT_FACTORY_ADDRESS;
    const previousAdapter = process.env.RISK_SPLIT_SETTLEMENT_ADAPTER;
    delete process.env.RISK_SPLIT_FACTORY_ADDRESS;
    delete process.env.RISK_SPLIT_SETTLEMENT_ADAPTER;
    try {
      await expect(new AdminMarketsService().previewMarket({
        underlying: msftAddress,
        floorPercent: 80,
        capPercent: 120,
        expiryTimestamp: Math.floor(new Date('2026-11-06T21:00:00Z').getTime() / 1000),
        chainId: 8453,
      })).rejects.toBeInstanceOf(BadRequestException);
    } finally {
      if (previousFactory === undefined) delete process.env.RISK_SPLIT_FACTORY_ADDRESS;
      else process.env.RISK_SPLIT_FACTORY_ADDRESS = previousFactory;
      if (previousAdapter === undefined) delete process.env.RISK_SPLIT_SETTLEMENT_ADAPTER;
      else process.env.RISK_SPLIT_SETTLEMENT_ADAPTER = previousAdapter;
    }
  });

  it('refuses a market whose settlement adapter uses another token feed', async () => {
    adapterFeed = '0x1111111111111111111111111111111111111111';
    try {
      await expect(new AdminMarketsService().previewMarket({
        underlying: msftAddress,
        floorPercent: 80,
        capPercent: 120,
        expiryTimestamp: Math.floor(new Date('2026-11-20T21:00:00Z').getTime() / 1000),
        chainId: 8453,
      })).rejects.toBeInstanceOf(BadRequestException);
    } finally {
      adapterFeed = '0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c';
    }
  });

  it('previews a newly enabled asset without consulting Coinbase', async () => {
    const token = '0xb200000000000000000000000000000000000999';
    vi.stubEnv('ASSET_REGISTRY_ADDRESS', '0x2222222222222222222222222222222222222222');
    vi.stubEnv('B20_REVIEWED_FEEDS_JSON', JSON.stringify({ [token]: adapterFeed }));
    const fetch = vi.fn().mockRejectedValue(new Error('Metadata unavailable'));
    vi.stubGlobal('fetch', fetch);
    try {
      const service = new AdminMarketsService();
      registeredFeed = undefined;
      const params = {
        underlying: token, floorPercent: 80, capPercent: 120,
        expiryTimestamp: Math.floor(new Date('2026-11-20T21:00:00Z').getTime() / 1000), chainId: 8453,
      };
      await expect(service.previewMarket(params)).rejects.toThrow('registry-enabled');
      registeredFeed = adapterFeed;
      await expect(service.previewMarket(params)).resolves.toMatchObject({ underlying: { symbol: 'NEWc', decimals: 8 } });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      registeredFeed = undefined;
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  it('rejects an expiry on a weekend (Saturday or Sunday)', () => {
    // 2026-11-21 is Saturday. 16:00 ET is 21:00 UTC (after standard time transition on Nov 1).
    const saturdayExpiry = Math.floor(new Date('2026-11-21T21:00:00Z').getTime() / 1000);
    const result = validateExpiryCalendar(saturdayExpiry);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('weekend');
  });

  it('rejects an expiry on a US equity holiday (e.g. Thanksgiving 2026-11-26)', () => {
    // Thanksgiving is 4th Thursday in November: 2026-11-26. 16:00 ET is 21:00 UTC.
    const thanksgivingExpiry = Math.floor(new Date('2026-11-26T21:00:00Z').getTime() / 1000);
    const result = validateExpiryCalendar(thanksgivingExpiry);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Thanksgiving Day');
  });

  it('rejects an expiry outside market close window (e.g. 10:00 AM ET)', () => {
    // 2026-11-20 is Friday. 10:00 AM ET is 15:00 UTC.
    const morningExpiry = Math.floor(new Date('2026-11-20T15:00:00Z').getTime() / 1000);
    const result = validateExpiryCalendar(morningExpiry);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('16:00 ET');
  });

  it('accepts an expiry on a valid Friday at 16:00 ET (4:00 PM)', () => {
    // 2026-11-20 is Friday. 16:00 ET is 21:00 UTC (EST, UTC-5).
    const validFridayExpiry = Math.floor(new Date('2026-11-20T21:00:00Z').getTime() / 1000);
    const result = validateExpiryCalendar(validFridayExpiry);
    expect(result.valid).toBe(true);
    expect(result.sessionCloseDeltaMinutes).toBe(0);
    expect(result.localTimeStr).toContain('2026-11-20 16:00 ET');
  });

  it('shows payoff scenarios but prepares creation only after both approvals', async () => {
    const validFridayExpiry = Math.floor(new Date('2026-11-20T21:00:00Z').getTime() / 1000);
    const service = new AdminMarketsService();

    const params = {
      underlying: msftAddress,
      floorPercent: 80,
      capPercent: 120,
      expiryTimestamp: validFridayExpiry,
      chainId: 8453,
    };
    const preview = await service.previewMarket(params);

    expect(preview.underlying.symbol).toBe('MSFTc');
    expect(preview.floorPrice).toBeDefined();
    expect(preview.capPrice).toBeDefined();
    expect(BigInt(preview.floorPrice) < BigInt(preview.capPrice)).toBe(true);
    expect(preview.payoffScenarios.length).toBe(5);

    expect(preview).toMatchObject({ expiryAlreadyApproved: false, adapterAlreadyApproved: false, transactions: [] });
    approved = true;
    expect((await service.previewMarket(params)).transactions).toMatchObject([{ method: 'createSeries' }]);
  });

  it('blocks duplicate terms already present onchain before the indexer catches up', async () => {
    const validFridayExpiry = Math.floor(new Date('2026-11-06T21:00:00Z').getTime() / 1000);

    existing = '0x7777777777777777777777777777777777777777';
    approved = true;
    await expect(new AdminMarketsService().previewMarket({
        underlying: msftAddress,
        floorPercent: 80,
        capPercent: 120,
        expiryTimestamp: validFridayExpiry,
        chainId: 8453,
      })
    ).resolves.toMatchObject({ duplicateTermsDetected: true, transactions: [] });
  });

  it('encodes both approval and revocation; permits revocation after the adapter feed changes', async () => {
    const service = new AdminMarketsService();
    const params = { underlying: msftAddress, expiryTimestamp: Date.parse('2026-11-20T21:00:00Z') / 1000 };
    for (const enabled of [true, false]) {
      approved = !enabled;
      if (!enabled) adapterFeed = zeroAddress;
      const setup = await service.previewSetup(params);
      expect(setup.transactions).toHaveLength(2);
      for (const tx of setup.transactions) {
        const decoded = decodeFunctionData({ abi: seriesFactoryAbi, data: tx.data! });
        expect(decoded.functionName).toBe(tx.method);
        expect(decoded.args).toMatchObject([msftAddress, expect.anything(), enabled]);
      }
    }
  });

  it('shows independent calendar and adapter blockers and rejects stale reference prices', async () => {
    const service = new AdminMarketsService();
    const expiryTimestamp = Date.parse('2026-11-20T21:00:00Z') / 1000;
    adapterFeed = zeroAddress;
    const setup = await service.previewSetup({ underlying: msftAddress, expiryTimestamp: expiryTimestamp + 86400 });
    expect(setup.expiryBlocker).toContain('weekend');
    expect(setup.adapterBlocker).toContain('do not match');
    expect(setup.transactions).toEqual([]);
    adapterFeed = reviewedFeed;
    feedAge = 3601n;
    await expect(service.previewMarket({ underlying: msftAddress, expiryTimestamp, floorPercent: 80, capPercent: 120 }))
      .rejects.toThrow('fresh');
  });

  it('reads historical Risk Split fixing fields from the indexed schema', async () => {
    const series = '0x7777777777777777777777777777777777777777';
    const service = new AdminMarketsService({
      query: vi.fn().mockImplementation(async (sql: string) => ({ rows: sql.startsWith('SELECT *') ? [{
        series_address: series, underlying_address: msftAddress, floor_price: '40000000000', cap_price: '60000000000',
        expiry_timestamp: Date.parse('2026-10-30T20:00:00Z') / 1000, creation_reference_price_usd_e8: '50000000000',
        creation_feed_round_id: '18446744073709551617', creation_feed_address: reviewedFeed, creation_reference_block: '90',
        is_settled: true, settled_price: '51000000000', settled_round_id: '18446744073709551627', last_indexed_block: 100,
      }] : [] })),
    } as any);
    expect((await service.getMarkets()).data[0]).toMatchObject({
      seriesAddress: series, isExpired: true, isSettled: true, referencePrice: '50000000000',
      referenceRoundId: '18446744073709551617', referenceFeed: reviewedFeed, referenceBlock: 90, lastIndexedBlock: 100,
      settledRoundId: '18446744073709551627',
    });
  });
});
