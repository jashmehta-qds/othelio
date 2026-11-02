import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { RiskSplitService, WAD } from './risksplit.service';
import { RiskSplitController } from './risksplit.controller';
import { RiskSplitSeriesModel } from './risksplit.types';

describe('RiskSplit Protocol', () => {
  const floorPrice = 4500000000n; // $45.00 in 8-decimal Chainlink feed format
  const capPrice = 5500000000n;   // $55.00 in 8-decimal Chainlink feed format

  let service: RiskSplitService;
  let controller: RiskSplitController;

  beforeEach(() => {
    service = new RiskSplitService();
    controller = new RiskSplitController(service);
  });

  describe('Mathematical Payoff Calculations (5 Price Regimes)', () => {
    it('Regime 1 (S == 0): protected = 0, upside = 0, fractions = 0', () => {
      const res = service.calculatePayoff(floorPrice, capPrice, 0n);

      expect(res.protectedValue).toBe(0n);
      expect(res.upsideValue).toBe(0n);
      expect(res.protectedFraction).toBe(0n);
      expect(res.upsideFraction).toBe(0n);
      expect(res.protectedFractionWad).toBe(0n);
      expect(res.upsideFractionWad).toBe(0n);
      expect(res.protectedValue + res.upsideValue).toBe(0n);
    });

    it('Regime 2 (S < F): protected absorbs 100% of underlying value, upside = 0', () => {
      const S = 3000000000n; // $30.00 < $45.00
      const res = service.calculatePayoff(floorPrice, capPrice, S);

      expect(res.protectedValue).toBe(S);
      expect(res.upsideValue).toBe(0n);
      expect(res.protectedFraction).toBe(WAD); // 1e18
      expect(res.upsideFraction).toBe(0n);
      expect(res.protectedValue + res.upsideValue).toBe(S);
      expect(res.protectedFraction + res.upsideFraction).toBe(WAD);
    });

    it('Regime 3 (F <= S < 2F): protected = F, upside = S - F', () => {
      // Lower boundary: S = F = $45.00
      const resBoundary = service.calculatePayoff(floorPrice, capPrice, floorPrice);
      expect(resBoundary.protectedValue).toBe(floorPrice);
      expect(resBoundary.upsideValue).toBe(0n);
      expect(resBoundary.protectedFraction).toBe(WAD);
      expect(resBoundary.upsideFraction).toBe(0n);
      expect(resBoundary.protectedValue + resBoundary.upsideValue).toBe(floorPrice);

      // Interior: S = $60.00 (F = $45, 2F = $90)
      const S = 6000000000n;
      const res = service.calculatePayoff(floorPrice, capPrice, S);

      expect(res.protectedValue).toBe(floorPrice); // 4500000000n
      expect(res.upsideValue).toBe(S - floorPrice); // 1500000000n ($15.00)
      // pFrac = F * 1e18 / S = 45 / 60 * 1e18 = 0.75e18
      const expectedProtectedFrac = (floorPrice * WAD) / S;
      expect(res.protectedFraction).toBe(expectedProtectedFrac);
      expect(res.protectedFraction).toBe(750000000000000000n);
      expect(res.upsideFraction).toBe(WAD - expectedProtectedFrac);
      expect(res.upsideFraction).toBe(250000000000000000n);
      expect(res.protectedValue + res.upsideValue).toBe(S);
      expect(res.protectedFraction + res.upsideFraction).toBe(WAD);
    });

    it('Regime 4 (2F <= S < 2C): 50/50 symmetric split between protected and upside', () => {
      // Lower boundary: S = 2F = $90.00
      const S_2F = 2n * floorPrice;
      const resBoundary = service.calculatePayoff(floorPrice, capPrice, S_2F);
      expect(resBoundary.protectedValue).toBe(floorPrice);
      expect(resBoundary.upsideValue).toBe(floorPrice);
      expect(resBoundary.protectedFraction).toBe(WAD / 2n); // 0.5e18
      expect(resBoundary.upsideFraction).toBe(WAD / 2n);
      expect(resBoundary.protectedValue + resBoundary.upsideValue).toBe(S_2F);

      // Interior: S = $100.00 (2F = $90, 2C = $110)
      const S = 10000000000n;
      const res = service.calculatePayoff(floorPrice, capPrice, S);

      expect(res.protectedValue).toBe(5000000000n); // $50.00
      expect(res.upsideValue).toBe(5000000000n);    // $50.00
      expect(res.protectedFraction).toBe(500000000000000000n); // 0.5e18
      expect(res.upsideFraction).toBe(500000000000000000n);
      expect(res.protectedValue + res.upsideValue).toBe(S);
      expect(res.protectedFraction + res.upsideFraction).toBe(WAD);
    });

    it('Regime 5 (S >= 2C): protected capped at C, upside receives remainder S - C', () => {
      // Boundary: S = 2C = $110.00
      const S_2C = 2n * capPrice;
      const resBoundary = service.calculatePayoff(floorPrice, capPrice, S_2C);
      expect(resBoundary.protectedValue).toBe(capPrice); // 5500000000n
      expect(resBoundary.upsideValue).toBe(capPrice);
      expect(resBoundary.protectedFraction).toBe(WAD / 2n);
      expect(resBoundary.upsideFraction).toBe(WAD / 2n);
      expect(resBoundary.protectedValue + resBoundary.upsideValue).toBe(S_2C);

      // Far upside: S = $220.00 (4x Cap)
      const S = 22000000000n;
      const res = service.calculatePayoff(floorPrice, capPrice, S);

      expect(res.protectedValue).toBe(capPrice); // $55.00
      expect(res.upsideValue).toBe(S - capPrice); // $165.00
      // pFrac = C * 1e18 / S = 55 / 220 * 1e18 = 0.25e18
      expect(res.protectedFraction).toBe(250000000000000000n);
      expect(res.upsideFraction).toBe(750000000000000000n);
      expect(res.protectedValue + res.upsideValue).toBe(S);
      expect(res.protectedFraction + res.upsideFraction).toBe(WAD);
    });

    it('preserves conservation of value and fractions across varied price steps', () => {
      const prices = [
        100000000n,   // $1
        2500000000n,  // $25
        4500000000n,  // $45 (F)
        5000000000n,  // $50
        7000000000n,  // $70
        9000000000n,  // $90 (2F)
        10000000000n, // $100
        11000000000n, // $110 (2C)
        15000000000n, // $150
        50000000000n, // $500
      ];

      for (const p of prices) {
        const res = service.calculatePayoff(floorPrice, capPrice, p);
        expect(res.protectedValue + res.upsideValue).toBe(p);
        expect(res.protectedFraction + res.upsideFraction).toBe(WAD);
      }
    });
  });

  describe('Payoff Curve Generation', () => {
    it('generates smooth payoff curve points covering the range up to maxPrice', () => {
      const points = service.generatePayoffCurve(45, 55, 150);
      expect(points.length).toBeGreaterThan(50);

      // First point at 0
      expect(points[0].price).toBe(0);
      expect(points[0].protectedValue).toBe(0);
      expect(points[0].upsideValue).toBe(0);

      // Verify intermediate points maintain total conservation
      for (const pt of points) {
        if (pt.price > 0) {
          expect(pt.protectedValue + pt.upsideValue).toBeCloseTo(pt.price, 2);
        }
      }
    });

    it('returns payoff curve via service getPayoffCurve', async () => {
      const curve = await service.getPayoffCurve(8453, '0x1111111111111111111111111111111111111111');
      expect(curve).not.toBeNull();
      expect(curve?.seriesAddress.toLowerCase()).toBe('0x1111111111111111111111111111111111111111');
      expect(curve?.floorPrice).toBe(45);
      expect(curve?.capPrice).toBe(55);
      expect(curve?.points.length).toBeGreaterThan(0);
    });
  });

  describe('Quotes for Minting, Pair Redemption, and Single Claims', () => {
    const activeSeriesAddress = '0x1111111111111111111111111111111111111111';
    const settledSeriesAddress = '0x6666666666666666666666666666666666666666';

    it('quotes mint action correctly for active series', async () => {
      const amount = '1000000000000000000'; // 1 full underlying token (1e18)
      const quote = await service.getQuote(8453, activeSeriesAddress, 'mint', amount);

      expect(quote.isExecutable).toBe(true);
      expect(quote.action).toBe('mint');
      expect(quote.inputAmount).toBe(amount);
      expect(quote.outputAmount).toBe(amount);
      expect(quote.protectedReceived).toBe(amount);
      expect(quote.upsideReceived).toBe(amount);
    });

    it('rejects mint quote on settled series', async () => {
      const amount = '1000000000000000000';
      const quote = await service.getQuote(8453, settledSeriesAddress, 'mint', amount);

      expect(quote.isExecutable).toBe(false);
      expect(quote.reason).toBe('SERIES_EXPIRED_OR_SETTLED');
      expect(quote.outputAmount).toBe('0');
    });

    it('quotes combineAndRedeem (pair redeem) correctly', async () => {
      const amount = '500000000000000000'; // 0.5 claims
      const quote = await service.getQuote(8453, activeSeriesAddress, 'combineAndRedeem', amount);

      expect(quote.isExecutable).toBe(true);
      expect(quote.action).toBe('combineAndRedeem');
      expect(quote.inputAmount).toBe(amount);
      expect(quote.outputAmount).toBe(amount);
    });

    it('supports alias pairRedeem for combineAndRedeem', async () => {
      const amount = '500000000000000000';
      const quote = await service.getQuote(8453, activeSeriesAddress, 'pairRedeem', amount);

      expect(quote.isExecutable).toBe(true);
      expect(quote.action).toBe('combineAndRedeem');
      expect(quote.outputAmount).toBe(amount);
    });

    it('rejects single claim redemptions prior to series settlement', async () => {
      const amount = '1000000000000000000';
      const protQuote = await service.getQuote(8453, activeSeriesAddress, 'redeemProtected', amount);
      expect(protQuote.isExecutable).toBe(false);
      expect(protQuote.reason).toBe('SERIES_NOT_SETTLED');

      const upQuote = await service.getQuote(8453, activeSeriesAddress, 'redeemUpside', amount);
      expect(upQuote.isExecutable).toBe(false);
      expect(upQuote.reason).toBe('SERIES_NOT_SETTLED');
    });

    it('quotes single claim redemptions accurately on settled series', async () => {
      // settledSeries is settled at $60.00:
      // protectedFraction = 0.75e18, upsideFraction = 0.25e18
      const amount = '1000000000000000000'; // 1 claim token
      const protQuote = await service.getQuote(8453, settledSeriesAddress, 'redeemProtected', amount);

      expect(protQuote.isExecutable).toBe(true);
      expect(protQuote.action).toBe('redeemProtected');
      expect(protQuote.inputAmount).toBe(amount);
      expect(protQuote.outputAmount).toBe('750000000000000000'); // 0.75 underlying

      const upQuote = await service.getQuote(8453, settledSeriesAddress, 'redeemUpside', amount);

      expect(upQuote.isExecutable).toBe(true);
      expect(upQuote.action).toBe('redeemUpside');
      expect(upQuote.inputAmount).toBe(amount);
      expect(upQuote.outputAmount).toBe('250000000000000000'); // 0.25 underlying

      // Combined redemption yields 1 full underlying
      const sumOutputs = BigInt(protQuote.outputAmount) + BigInt(upQuote.outputAmount);
      expect(sumOutputs).toBe(BigInt(amount));
    });

    it('returns not executable for non-existent series or invalid actions/amounts', async () => {
      const badSeries = await service.getQuote(8453, '0x0000000000000000000000000000000000000000', 'mint', '100');
      expect(badSeries.isExecutable).toBe(false);
      expect(badSeries.reason).toBe('SERIES_NOT_FOUND');

      const badAmount = await service.getQuote(8453, activeSeriesAddress, 'mint', '-100');
      expect(badAmount.isExecutable).toBe(false);
      expect(badAmount.reason).toBe('INVALID_AMOUNT');

      const badAction = await service.getQuote(8453, activeSeriesAddress, 'unknownAction', '100');
      expect(badAction.isExecutable).toBe(false);
      expect(badAction.reason).toBe('INVALID_ACTION');
    });
  });

  describe('Database and Fallback Handling', () => {
    it('does not publish sample markets when DB throws', async () => {
      const mockDb = {
        query: vi.fn().mockRejectedValue(new Error('Connection refused')),
      };
      const dbService = new RiskSplitService(mockDb as never);

      await expect(dbService.getSeriesList(8453)).rejects.toThrow('Connection refused');
      expect(mockDb.query).toHaveBeenCalled();
    });

    it('returns an empty live registry without sample markets', async () => {
      const dbService = new RiskSplitService({ query: vi.fn().mockResolvedValue({ rows: [] }) } as never);
      expect(await dbService.getSeriesList(8453)).toEqual([]);
      expect(await dbService.getSeries(8453, '0x1111111111111111111111111111111111111111')).toBeNull();
    });

    it('returns DB rows when database query succeeds', async () => {
      const mockDbRow = {
        chain_id: 8453,
        series_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        underlying_address: '0x2222222222222222222222222222222222222222',
        protected_token_address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        upside_token_address: '0xcccccccccccccccccccccccccccccccccccccccc',
        settlement_adapter_address: '0xdddddddddddddddddddddddddddddddddddddddd',
        floor_price: '4000000000',
        cap_price: '6000000000',
        expiry_timestamp: 1800000000,
        created_block: 21000000,
        created_tx: '0x3000000000000000000000000000000000000000000000000000000000000003',
        is_settled: false,
        settled_price: null,
        protected_fraction: null,
        upside_fraction: null,
        settled_at: null,
        created_at: '2026-10-31T00:00:00.000Z',
      };

      const mockDb = {
        query: vi.fn().mockResolvedValue({ rows: [mockDbRow] }),
      };
      const dbService = new RiskSplitService(mockDb as never);

      const series = await dbService.getSeries(8453, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(series).not.toBeNull();
      expect(series?.seriesAddress).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(series?.floorPrice).toBe('4000000000');
    });

    it('returns user positions from DB or zero defaults when empty', async () => {
      const userAddr = '0x9999999999999999999999999999999999999999';
      const pos = await service.getUserPositions(8453, '0x1111111111111111111111111111111111111111', userAddr);

      expect(pos.userAddress).toBe(userAddr);
      expect(pos.protectedBalance).toBe('0');
      expect(pos.upsideBalance).toBe('0');
    });
  });

  describe('RiskSplitController Endpoints', () => {
    const activeSeriesAddress = '0x1111111111111111111111111111111111111111';

    it('GET /v1/risksplit/series returns series list', async () => {
      const list = await controller.getSeriesList('8453');
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
      expect(list[0].chainId).toBe(8453);
    });

    it('GET /v1/risksplit/series/:seriesAddress returns series details', async () => {
      const series = await controller.getSeries(activeSeriesAddress, '8453');
      expect(series.seriesAddress.toLowerCase()).toBe(activeSeriesAddress.toLowerCase());
      expect(series.floorPrice).toBe('4500000000');
    });

    it('GET /v1/risksplit/series/:seriesAddress throws NotFoundException when series missing', async () => {
      await expect(
        controller.getSeries('0x0000000000000000000000000000000000000000', '8453')
      ).rejects.toThrow(NotFoundException);
    });

    it('GET /v1/risksplit/series/:seriesAddress/payoff returns payoff curve', async () => {
      const payoff = await controller.getPayoff(activeSeriesAddress, '8453');
      expect(payoff.seriesAddress.toLowerCase()).toBe(activeSeriesAddress.toLowerCase());
      expect(payoff.floorPrice).toBe(45);
      expect(payoff.capPrice).toBe(55);
      expect(payoff.points.length).toBeGreaterThan(0);
    });

    it('GET /v1/risksplit/series/:seriesAddress/positions/:userAddress returns position', async () => {
      const userAddr = '0x5555555555555555555555555555555555555555';
      const pos = await controller.getUserPositions(activeSeriesAddress, userAddr, '8453');
      expect(pos.userAddress).toBe(userAddr);
      expect(pos.protectedBalance).toBe('0');
    });

    it('GET /v1/risksplit/series/:seriesAddress/quote returns quote result', async () => {
      const quote = await controller.getQuote(activeSeriesAddress, 'mint', '1000000000000000000', '8453');
      expect(quote.isExecutable).toBe(true);
      expect(quote.action).toBe('mint');
      expect(quote.outputAmount).toBe('1000000000000000000');
    });

    it('GET /v1/risksplit/series/:seriesAddress/quote throws BadRequestException if params missing', async () => {
      await expect(
        controller.getQuote(activeSeriesAddress, '', '1000', '8453')
      ).rejects.toThrow(BadRequestException);
    });

    it('GET /v1/risksplit/series/:seriesAddress/quote throws NotFoundException if series missing', async () => {
      await expect(
        controller.getQuote('0x0000000000000000000000000000000000000000', 'mint', '1000', '8453')
      ).rejects.toThrow(NotFoundException);
    });
  });
});
