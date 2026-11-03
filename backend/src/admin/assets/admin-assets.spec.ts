import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AdminAssetsService } from './admin-assets.service';

describe('AdminAssetsService', () => {
  it('lists candidate B20 assets with decimals, price feeds, and readiness status', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            asset_address: '0xb200000000000000000000ab99cfa739e253872b', // MSFTc
            price_usd_e8: '50000000000',
            round_id: '18446744073709555000',
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

    const service = new AdminAssetsService(mockDb as any, mockRiskSplitService as any);
    const result = await service.getAssets(8453);

    expect(result.asOfBlock).toBe(12345);
    expect(result.data.length).toBe(13);

    const msft = result.data.find((a) => a.symbol === 'MSFTc');
    expect(msft).toBeDefined();
    expect(msft?.decimals).toBe(8);
    expect(msft?.priceFeed.decimals).toBe(8);
    expect(msft?.priceFeed.priceUsdE8).toBe('50000000000');
    expect(msft?.tradeable).toBe(true);
  });

  it('previews registry enablement transaction for a candidate asset', async () => {
    const service = new AdminAssetsService();
    const msftAddress = '0xB200000000000000000000Ab99cFa739E253872B';

    const previews = await service.previewEnableAsset(msftAddress, 8453);
    expect(previews.length).toBe(1);
    expect(previews[0].method).toBe('addAsset');
    expect(previews[0].args[0].toLowerCase()).toBe(msftAddress.toLowerCase());
    expect(previews[0].simulationResult?.success).toBe(true);
  });

  it('rejects an unsupported token address in previewEnableAsset', async () => {
    const service = new AdminAssetsService();
    await expect(service.previewEnableAsset('0x1234567890123456789012345678901234567890', 8453)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });
});
