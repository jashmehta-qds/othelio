import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AdminAssetsService } from './admin-assets.service';

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createPublicClient: () => ({
      readContract: async ({ functionName }: { functionName: string }) =>
        functionName === 'isSupported'
          ? true
          : [1n, 50000000000n, 0n, BigInt(Math.floor(Date.now() / 1000)), 1n],
    }),
  };
});

describe('AdminAssetsService', () => {
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
});
