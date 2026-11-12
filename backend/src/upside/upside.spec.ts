import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UpsideService, WAD } from './upside.service';
import { UpsideMarketModel, UpsideRoundModel } from './upside.types';

describe('UpsideService', () => {
  let service: UpsideService;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
    };
    service = new UpsideService(mockDb);
  });

  describe('calculatePayoff', () => {
    const K = 500_00000000n; // Strike = $500 (8 decimals)

    it('handles zero spot price safely', () => {
      const res = service.calculatePayoff(K, 0n);
      expect(res.upsideValue).toBe(0n);
      expect(res.residualValue).toBe(0n);
      expect(res.upsideFractionWad).toBe(0n);
      expect(res.residualFractionWad).toBe(WAD);
    });

    it('calculates out-of-the-money payoff (S < K)', () => {
      // Spot = $450 (below strike $500)
      const S = 450_00000000n;
      const res = service.calculatePayoff(K, S);

      // Upside receives 0, Residual receives full collateral S
      expect(res.upsideValue).toBe(0n);
      expect(res.residualValue).toBe(S);
      expect(res.upsideFractionWad).toBe(0n);
      expect(res.residualFractionWad).toBe(WAD);
    });

    it('calculates at-the-money payoff (S == K)', () => {
      const res = service.calculatePayoff(K, K);
      expect(res.upsideValue).toBe(0n);
      expect(res.residualValue).toBe(K);
      expect(res.upsideFractionWad).toBe(0n);
      expect(res.residualFractionWad).toBe(WAD);
    });

    it('calculates in-the-money payoff (S > K)', () => {
      // Spot = $600 (above strike $500)
      const S = 600_00000000n;
      const res = service.calculatePayoff(K, S);

      // Upside receives S - K = $100
      expect(res.upsideValue).toBe(100_00000000n);
      // Residual receives capped K = $500
      expect(res.residualValue).toBe(500_00000000n);

      // Fractions sum to exactly WAD (1e18)
      expect(res.upsideFractionWad + res.residualFractionWad).toBe(WAD);
      // Upside fraction = 100 / 600 = 1/6 ~ 0.166666666666666666e18
      const expectedUpside = (100_00000000n * WAD) / S;
      expect(res.upsideFractionWad).toBe(expectedUpside);
    });

    it('calculates deep in-the-money payoff (S = 2K = $1000)', () => {
      const S = 1000_00000000n;
      const res = service.calculatePayoff(K, S);

      // Upside receives 500, Residual receives 500
      expect(res.upsideValue).toBe(500_00000000n);
      expect(res.residualValue).toBe(500_00000000n);
      // Both fractions are exactly 0.5e18
      expect(res.upsideFractionWad).toBe(500000000000000000n);
      expect(res.residualFractionWad).toBe(500000000000000000n);
      expect(res.upsideFractionWad + res.residualFractionWad).toBe(WAD);
    });
  });

  describe('getAssets', () => {
    it('enumerates supported tokens and mirrors registry metadata', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            asset_address: '0xb200000000000000000000ab99cfa739e253872b',
            price_usd_e8: '50000000000',
            observed_at: new Date().toISOString(),
            is_fresh: true,
          },
        ],
      });

      const response = await service.getAssets(8453);
      expect(response.chainId).toBe(8453);
      expect(response.assets.length).toBeGreaterThan(0);

      const msft = response.assets.find(
        (a) => a.tokenAddress.toLowerCase() === '0xb200000000000000000000ab99cfa739e253872b',
      );
      expect(msft).toBeDefined();
      expect(msft?.symbol).toBe('MSFTc');
      expect(msft?.isSupportedInRegistry).toBe(true);
      expect(msft?.isEligibleForUpside).toBe(true);
      expect(msft?.currentPriceUsd).toBe('500');
    });
  });

  describe('getRounds and getMarkets', () => {
    it('returns rounds with formatted reference prices and expected moves', async () => {
      const mockRound: UpsideRoundModel = {
        chainId: 8453,
        roundId: 1,
        factoryAddress: '0x1111111111111111111111111111111111111111',
        underlyingAddress: '0xb200000000000000000000ab99cfa739e253872b',
        feedAddress: '0xeb10a6c9aa7e537aed766c08c35dae35b321b18c',
        adapterAddress: '0x3333333333333333333333333333333333333333',
        referenceRoundId: '100',
        referencePrice: '50000000000',
        referencePriceFormatted: '500.00',
        referenceTime: 1750000000,
        roundStart: 1750000000,
        expiryTimestamp: 1750604800,
        expectedMove: '2500000000',
        expectedMoveFormatted: '25.00',
        provenanceHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        strikeTick: '100000000',
        minStrike: '40000000000',
        maxStrike: '60000000000',
        publicCreationEnabled: false,
        createdBlock: 100,
        createdTx: '0x123',
        createdAt: new Date().toISOString(),
        marketsCount: 4,
      };

      service.setMockRound(mockRound);
      const rounds = await service.getRounds(8453);
      expect(rounds.length).toBe(1);
      expect(rounds[0].roundId).toBe(1);
      expect(rounds[0].referencePriceFormatted).toBe('500.00');
    });

    it('enriches 4 target labels in order: Starting price, Reach, Strong move, Long shot', async () => {
      const mkMarket = (series: string, strike: string): UpsideMarketModel => ({
        chainId: 8453,
        seriesAddress: series,
        roundId: 1,
        factoryAddress: '0x1111',
        underlyingAddress: '0xb200000000000000000000ab99cfa739e253872b',
        upsideTokenAddress: '0xup',
        residualTokenAddress: '0xres',
        strikePrice: strike,
        strikePriceFormatted: (Number(strike) / 1e8).toFixed(2),
        expiryTimestamp: 1750604800,
        isSettled: false,
        settledPrice: null,
        settledPriceFormatted: null,
        settledRoundId: null,
        settledTimestamp: null,
        collateralSnapshot: null,
        totalClaimSupplySnapshot: null,
        upsideAllocation: null,
        residualAllocation: null,
        creatorAddress: '0xcreator',
        createdBlock: 100,
        createdTx: '0x1',
        settledAt: null,
        createdAt: new Date().toISOString(),
      });

      // 4 preset strikes: $500, $512.50, $525, $550
      service.setMockMarket(mkMarket('0x10', '50000000000'));
      service.setMockMarket(mkMarket('0x20', '51250000000'));
      service.setMockMarket(mkMarket('0x30', '52500000000'));
      service.setMockMarket(mkMarket('0x40', '55000000000'));

      const markets = await service.getMarkets(8453, 1);
      expect(markets.length).toBe(4);
      expect(markets[0].targetLabel).toBe('Starting price');
      expect(markets[1].targetLabel).toBe('Reach');
      expect(markets[2].targetLabel).toBe('Strong move');
      expect(markets[3].targetLabel).toBe('Long shot');
    });
  });

  describe('getStockHistory', () => {
    it('returns honest observation points from real database records', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          { observed_at: new Date(1750000000 * 1000).toISOString(), price_usd_e8: '49500000000', block_number: 1000 },
          { observed_at: new Date(1750003600 * 1000).toISOString(), price_usd_e8: '50000000000', block_number: 1010 },
          { observed_at: new Date(1750007200 * 1000).toISOString(), price_usd_e8: '50250000000', block_number: 1020 },
        ],
      });

      const history = await service.getStockHistory(8453, '0xb200000000000000000000ab99cfa739e253872b');
      expect(history.symbol).toBe('MSFTc');
      expect(history.history.length).toBe(3);
      expect(history.history[0].priceUsd).toBe(495);
      expect(history.history[1].priceUsd).toBe(500);
      expect(history.history[2].priceUsd).toBe(502.5);
      expect(history.hasGaps).toBe(false);
    });
  });
});
