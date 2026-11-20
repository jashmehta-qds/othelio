import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AdminAssetsService } from './admin-assets.service';

const newToken = '0xb200000000000000000000000000000000000999';
const newFeed = '0x3333333333333333333333333333333333333333';
let initialized = true;
let feedAge = 60n;
const now = BigInt(Math.floor(Date.now() / 1000));
vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createPublicClient: () => ({
      getBlock: async () => ({ number: 1n, timestamp: now }),
      readContract: async ({ functionName }: { functionName: string }) => {
        switch (functionName) {
          case 'getAsset': return { supported: false, isCoinbaseB20: false };
          case 'isB20': return true;
          case 'isB20Initialized': return initialized;
          case 'decimals': return 8;
          case 'totalSupply': return 1000000000n;
          case 'description': return 'Total Return / USD';
          case 'latestRoundData': return [1n, 50000000000n, now - feedAge - 1n, now - feedAge, 1n];
          default: throw new Error(functionName);
        }
      },
    }),
  };
});

describe('AdminAssetsService', () => {
  beforeEach(() => {
    vi.stubEnv('CHAIN_ID', '8453');
    vi.stubEnv('ASSET_REGISTRY_ADDRESS', '0x3DB84b8e172A2b8b1634F8C630C6e2acD07424AC');
    vi.stubEnv('OTHELIO_ASSET_REGISTRY', undefined);
    vi.stubEnv('B20_REVIEWED_FEEDS_JSON', undefined);
    initialized = true;
    feedAge = 60n;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it('lists candidate B20 assets with decimals, price feeds, and readiness status', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            asset_address: '0xb200000000000000000000ab99cfa739e253872b', // MSFTc
            price_usd_e8: '50000000000',
            feed_round_id: '18446744073709555000',
            observed_at: new Date().toISOString(),
            is_fresh: true,
          },
        ],
      }),
    };

    const mockRiskSplitService = {
      getIndexerFreshness: vi.fn().mockResolvedValue({
        lastIndexedBlock: 12345,
      }),
    };

    const priorRegistry = process.env.ASSET_REGISTRY_ADDRESS;
    process.env.ASSET_REGISTRY_ADDRESS = '0x3DB84b8e172A2b8b1634F8C630C6e2acD07424AC';
    const service = new AdminAssetsService(mockDb as any, mockRiskSplitService as any);
    const result = await service.getAssets(8453);
    if (priorRegistry === undefined) delete process.env.ASSET_REGISTRY_ADDRESS;
    else process.env.ASSET_REGISTRY_ADDRESS = priorRegistry;

    expect(result.asOfBlock).toBe(12345);
    expect(result.data.length).toBe(13);

    const msft = result.data.find((a) => a.symbol === 'MSFTc');
    expect(msft).toBeDefined();
    expect(msft?.decimals).toBe(8);
    expect(msft?.priceFeed.decimals).toBe(8);
    expect(msft?.priceFeed.priceUsdE8).toBe('50000000000');
    expect(msft?.tradeable).toBe(false); // Route approval has not been verified onchain.
  });

  it('refuses an asset transaction when the registry is not configured', async () => {
    const service = new AdminAssetsService();
    const msftAddress = '0xB200000000000000000000Ab99cFa739E253872B';
    const previous = process.env.ASSET_REGISTRY_ADDRESS;
    delete process.env.ASSET_REGISTRY_ADDRESS;
    delete process.env.OTHELIO_ASSET_REGISTRY;
    try {
      await expect(service.previewEnableAsset(msftAddress, 8453)).rejects.toBeInstanceOf(BadRequestException);
    } finally {
      if (previous === undefined) delete process.env.ASSET_REGISTRY_ADDRESS;
      else process.env.ASSET_REGISTRY_ADDRESS = previous;
    }
  });

  it('prepares the real registry configure call', async () => {
    const previous = process.env.ASSET_REGISTRY_ADDRESS;
    process.env.ASSET_REGISTRY_ADDRESS = '0x3DB84b8e172A2b8b1634F8C630C6e2acD07424AC';
    try {
      const previews = await new AdminAssetsService().previewEnableAsset('0xB200000000000000000000Ab99cFa739E253872B', 8453);
      expect(previews[0].method).toBe('configure');
      expect(previews[0].args[0]).toBe(8453);
      expect(previews[0].args[3]).toBe(true);
      expect(previews[0].args[6]).toBe(true);
      expect(previews[0].target.toLowerCase()).toBe(process.env.ASSET_REGISTRY_ADDRESS.toLowerCase());
    } finally {
      if (previous === undefined) delete process.env.ASSET_REGISTRY_ADDRESS;
      else process.env.ASSET_REGISTRY_ADDRESS = previous;
    }
  });

  it('rejects an unsupported token address in previewEnableAsset', async () => {
    const service = new AdminAssetsService();
    await expect(service.previewEnableAsset('0x1234567890123456789012345678901234567890', 8453)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it('stages and prepares calldata for an additional reviewed B20 but does not approve a route', async () => {
    vi.stubEnv('B20_REVIEWED_FEEDS_JSON', JSON.stringify({ [newToken]: newFeed }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      tokens: [{ contract_address: newToken, symbol: 'NEWc', name: 'New Stock', decimals: 8 }],
    }) }));
    const service = new AdminAssetsService();
    const { data } = await service.getAssets();
    expect(data.find((asset) => asset.symbol === 'NEWc')).toMatchObject({ staged: true, tradeable: false });
    const previews = await service.previewEnableAsset(newToken);
    expect(previews).toHaveLength(1);
    expect(previews[0]).toMatchObject({ method: 'configure', args: [8453, expect.stringMatching(/^0xb200/i), newFeed, true, 8, 8, true] });

    initialized = false;
    await expect(service.previewEnableAsset(newToken)).rejects.toThrow('not an initialized');
    initialized = true;
    feedAge = 86401n;
    await expect(service.previewEnableAsset(newToken)).rejects.toThrow('fresh');
  });
});
