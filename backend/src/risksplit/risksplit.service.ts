import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  RiskSplitSeriesModel,
  RiskSplitPositionModel,
  PayoffCalculation,
  PayoffPoint,
  PayoffCurveResponse,
  QuoteResponse,
} from './risksplit.types';

export const WAD = 1000000000000000000n; // 1e18

@Injectable()
export class RiskSplitService {
  private readonly logger = new Logger(RiskSplitService.name);

  // In-memory fallback for local dev/testing
  private mockSeries: Map<string, RiskSplitSeriesModel> = new Map();
  private mockPositions: Map<string, RiskSplitPositionModel> = new Map();

  constructor(@Optional() @Inject(DatabaseService) private readonly db?: DatabaseService) {
    if (process.env.NODE_ENV === 'test') this.seedMockData();
  }

  seedMockData() {
    // Active series
    const activeSeries: RiskSplitSeriesModel = {
      chainId: 8453, // Base mainnet
      seriesAddress: '0x1111111111111111111111111111111111111111',
      underlyingAddress: '0x2222222222222222222222222222222222222222', // MSFTc
      protectedTokenAddress: '0x3333333333333333333333333333333333333333',
      upsideTokenAddress: '0x4444444444444444444444444444444444444444',
      settlementAdapterAddress: '0x5555555555555555555555555555555555555555',
      floorPrice: '4500000000', // $45.00 (8 decimals)
      capPrice: '5500000000',   // $55.00 (8 decimals)
      expiryTimestamp: Math.floor(Date.now() / 1000) + 7 * 86400,
      createdBlock: 20000000,
      createdTx: '0x1000000000000000000000000000000000000000000000000000000000000001',
      isSettled: false,
      settledPrice: null,
      protectedFraction: null,
      upsideFraction: null,
      settledAt: null,
      createdAt: new Date().toISOString(),
    };
    this.mockSeries.set(activeSeries.seriesAddress.toLowerCase(), activeSeries);

    // Settled series (settled at $60.00: F=$45, C=$55, S=$60 -> F <= S < 2F)
    // protectedFraction = 45 / 60 = 0.75e18 = 750000000000000000
    // upsideFraction = 15 / 60 = 0.25e18 = 250000000000000000
    const settledSeries: RiskSplitSeriesModel = {
      chainId: 8453,
      seriesAddress: '0x6666666666666666666666666666666666666666',
      underlyingAddress: '0x2222222222222222222222222222222222222222',
      protectedTokenAddress: '0x7777777777777777777777777777777777777777',
      upsideTokenAddress: '0x8888888888888888888888888888888888888888',
      settlementAdapterAddress: '0x5555555555555555555555555555555555555555',
      floorPrice: '4500000000',
      capPrice: '5500000000',
      expiryTimestamp: Math.floor(Date.now() / 1000) - 86400,
      createdBlock: 19000000,
      createdTx: '0x2000000000000000000000000000000000000000000000000000000000000002',
      isSettled: true,
      settledPrice: '6000000000',
      protectedFraction: '750000000000000000',
      upsideFraction: '250000000000000000',
      settledAt: new Date(Date.now() - 86400 * 1000).toISOString(),
      createdAt: new Date(Date.now() - 8 * 86400 * 1000).toISOString(),
    };
    this.mockSeries.set(settledSeries.seriesAddress.toLowerCase(), settledSeries);
  }

  setMockSeries(series: RiskSplitSeriesModel) {
    this.mockSeries.set(series.seriesAddress.toLowerCase(), series);
  }

  setMockPosition(pos: RiskSplitPositionModel) {
    const key = `${pos.chainId}:${pos.seriesAddress.toLowerCase()}:${pos.userAddress.toLowerCase()}`;
    this.mockPositions.set(key, pos);
  }

  clearMockData() {
    this.mockSeries.clear();
    this.mockPositions.clear();
  }

  /**
   * Exact research paper payoff formula across all 5 price regimes:
   * - If S == 0: protected = 0, upside = 0 (protectedFraction = 0, upsideFraction = 0)
   * - If S < F: protected = S, upside = 0 (protectedFraction = 1e18, upsideFraction = 0)
   * - If F <= S < 2F: protected = F, upside = S - F (protectedFraction = F * 1e18 / S, upsideFraction = 1e18 - protectedFraction)
   * - If 2F <= S < 2C: protected = S / 2, upside = S / 2 (protectedFraction = 0.5e18, upsideFraction = 0.5e18)
   * - If S >= 2C: protected = C, upside = S - C (protectedFraction = C * 1e18 / S, upsideFraction = 1e18 - protectedFraction)
   */
  calculatePayoff(floorPrice: bigint, capPrice: bigint, price: bigint): PayoffCalculation {
    const F = floorPrice;
    const C = capPrice;
    const S = price;

    if (S === 0n) {
      return {
        protectedValue: 0n,
        upsideValue: 0n,
        protectedFraction: 0n,
        upsideFraction: 0n,
        protectedFractionWad: 0n,
        upsideFractionWad: 0n,
      };
    }

    if (S < F) {
      return {
        protectedValue: S,
        upsideValue: 0n,
        protectedFraction: WAD,
        upsideFraction: 0n,
        protectedFractionWad: WAD,
        upsideFractionWad: 0n,
      };
    }

    if (S < 2n * F) {
      const pFrac = (F * WAD) / S;
      const protectedFrac = pFrac > WAD ? WAD : pFrac;
      const upsideFrac = WAD - protectedFrac;
      return {
        protectedValue: F,
        upsideValue: S - F,
        protectedFraction: protectedFrac,
        upsideFraction: upsideFrac,
        protectedFractionWad: protectedFrac,
        upsideFractionWad: upsideFrac,
      };
    }

    if (S < 2n * C) {
      const halfWad = WAD / 2n;
      const protectedVal = S / 2n;
      const upsideVal = S - protectedVal;
      return {
        protectedValue: protectedVal,
        upsideValue: upsideVal,
        protectedFraction: halfWad,
        upsideFraction: halfWad,
        protectedFractionWad: halfWad,
        upsideFractionWad: halfWad,
      };
    }

    // S >= 2C
    const pFrac = (C * WAD) / S;
    const protectedFrac = pFrac > WAD ? WAD : pFrac;
    const upsideFrac = WAD - protectedFrac;
    return {
      protectedValue: C,
      upsideValue: S - C,
      protectedFraction: protectedFrac,
      upsideFraction: upsideFrac,
      protectedFractionWad: protectedFrac,
      upsideFractionWad: upsideFrac,
    };
  }

  generatePayoffCurve(floorPrice: number, capPrice: number, maxPrice?: number): PayoffPoint[] {
    const max = maxPrice || Math.max(capPrice * 2.5, 150);
    const step = max > 0 ? max / 60 : 1;
    const points: PayoffPoint[] = [];

    const floorBig = BigInt(Math.round(floorPrice * 1e8));
    const capBig = BigInt(Math.round(capPrice * 1e8));

    for (let p = 0; p <= max + step / 2; p += step) {
      const priceBig = BigInt(Math.round(p * 1e8));
      const res = this.calculatePayoff(floorBig, capBig, priceBig);
      points.push({
        price: Number(p.toFixed(2)),
        protectedValue: Number((Number(res.protectedValue) / 1e8).toFixed(4)),
        upsideValue: Number((Number(res.upsideValue) / 1e8).toFixed(4)),
        underlyingValue: Number(p.toFixed(2)),
        protectedFraction: Number(res.protectedFraction) / Number(WAD),
        upsideFraction: Number(res.upsideFraction) / Number(WAD),
      });
    }

    return points;
  }

  async getSeriesList(chainId: number, underlying?: string): Promise<RiskSplitSeriesModel[]> {
    if (this.db) {
      try {
        let query = 'SELECT * FROM risk_split_series WHERE chain_id = $1';
        const params: any[] = [chainId];
        if (underlying) {
          query += ' AND LOWER(underlying_address) = LOWER($2)';
          params.push(underlying);
        }
        query += ' ORDER BY expiry_timestamp ASC';
        const res = await this.db.query(query, params);
        return res.rows.map(this.mapSeriesRow);
      } catch (err) {
        this.logger.error(`Failed DB query for series list: ${err}`);
        throw err;
      }
    }

    return Array.from(this.mockSeries.values()).filter(
      (s) => s.chainId === chainId && (!underlying || s.underlyingAddress.toLowerCase() === underlying.toLowerCase())
    );
  }

  async getSeries(chainId: number, seriesAddress: string): Promise<RiskSplitSeriesModel | null> {
    const norm = seriesAddress.toLowerCase();
    if (this.db) {
      try {
        const res = await this.db.query(
          'SELECT * FROM risk_split_series WHERE chain_id = $1 AND LOWER(series_address) = $2',
          [chainId, norm]
        );
        return res.rows.length > 0 ? this.mapSeriesRow(res.rows[0]) : null;
      } catch (err) {
        this.logger.error(`Failed DB query for series ${norm}: ${err}`);
        throw err;
      }
    }

    return this.mockSeries.get(norm) || null;
  }

  async getPayoffCurve(chainId: number, seriesAddress: string, maxPrice?: number): Promise<PayoffCurveResponse | null> {
    const series = await this.getSeries(chainId, seriesAddress);
    if (!series) return null;

    const rawFloor = Number(series.floorPrice);
    const rawCap = Number(series.capPrice);

    // Normalize prices: if > 1e6, assume 8 decimals (standard Chainlink price feed), else raw dollar units
    const floor = rawFloor > 1e6 ? rawFloor / 1e8 : rawFloor;
    const cap = rawCap > 1e6 ? rawCap / 1e8 : rawCap;
    const points = this.generatePayoffCurve(floor, cap, maxPrice);

    return {
      seriesAddress: series.seriesAddress,
      floorPrice: floor,
      capPrice: cap,
      points,
    };
  }

  async getUserPositions(
    chainId: number,
    seriesAddress: string,
    userAddress: string
  ): Promise<RiskSplitPositionModel> {
    const key = `${chainId}:${seriesAddress.toLowerCase()}:${userAddress.toLowerCase()}`;
    if (this.db) {
      try {
        const res = await this.db.query(
          'SELECT * FROM risk_split_positions WHERE chain_id = $1 AND LOWER(series_address) = $2 AND LOWER(user_address) = $3',
          [chainId, seriesAddress.toLowerCase(), userAddress.toLowerCase()]
        );
        if (res?.rows && res.rows.length > 0) {
          const row = res.rows[0];
          return {
            chainId,
            seriesAddress: row.series_address.trim(),
            userAddress: row.user_address.trim(),
            protectedBalance: row.protected_balance ? row.protected_balance.toString() : '0',
            upsideBalance: row.upside_balance ? row.upside_balance.toString() : '0',
            totalMinted: row.total_minted ? row.total_minted.toString() : '0',
            totalPairedRedeemed: row.total_paired_redeemed ? row.total_paired_redeemed.toString() : '0',
            totalProtectedRedeemed: row.total_protected_redeemed ? row.total_protected_redeemed.toString() : '0',
            totalUpsideRedeemed: row.total_upside_redeemed ? row.total_upside_redeemed.toString() : '0',
            updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
          };
        }
      } catch (err) {
        this.logger.warn(`Failed DB query for user position: ${err}. Falling back to memory.`);
      }
    }

    return (
      this.mockPositions.get(key) || {
        chainId,
        seriesAddress,
        userAddress,
        protectedBalance: '0',
        upsideBalance: '0',
        totalMinted: '0',
        totalPairedRedeemed: '0',
        totalProtectedRedeemed: '0',
        totalUpsideRedeemed: '0',
      }
    );
  }

  async getQuote(
    chainId: number,
    seriesAddress: string,
    action: string,
    inputAmount: string
  ): Promise<QuoteResponse> {
    const series = await this.getSeries(chainId, seriesAddress);
    if (!series) {
      return {
        action,
        inputAmount,
        outputAmount: '0',
        isExecutable: false,
        reason: 'SERIES_NOT_FOUND',
      };
    }

    if (!inputAmount || !/^\d+$/.test(inputAmount) || BigInt(inputAmount) <= 0n) {
      return {
        action,
        inputAmount,
        outputAmount: '0',
        isExecutable: false,
        reason: 'INVALID_AMOUNT',
      };
    }

    const now = Math.floor(Date.now() / 1000);
    const amountBig = BigInt(inputAmount);
    const normAction = action.toLowerCase();

    if (normAction === 'mint') {
      if (series.isSettled || now >= series.expiryTimestamp) {
        return {
          action: 'mint',
          inputAmount,
          outputAmount: '0',
          isExecutable: false,
          reason: 'SERIES_EXPIRED_OR_SETTLED',
        };
      }
      return {
        action: 'mint',
        inputAmount,
        outputAmount: inputAmount,
        protectedReceived: inputAmount,
        upsideReceived: inputAmount,
        isExecutable: true,
      };
    }

    if (normAction === 'combineandredeem' || normAction === 'pairredeem' || normAction === 'burn') {
      return {
        action: 'combineAndRedeem',
        inputAmount,
        outputAmount: inputAmount,
        isExecutable: true,
      };
    }

    if (normAction === 'redeemprotected' || normAction === 'protected') {
      if (!series.isSettled || !series.protectedFraction) {
        return {
          action: 'redeemProtected',
          inputAmount,
          outputAmount: '0',
          isExecutable: false,
          reason: 'SERIES_NOT_SETTLED',
        };
      }
      const frac = BigInt(series.protectedFraction);
      const output = (amountBig * frac) / WAD;
      return {
        action: 'redeemProtected',
        inputAmount,
        outputAmount: output.toString(),
        isExecutable: true,
      };
    }

    if (normAction === 'redeemupside' || normAction === 'upside') {
      if (!series.isSettled || !series.upsideFraction) {
        return {
          action: 'redeemUpside',
          inputAmount,
          outputAmount: '0',
          isExecutable: false,
          reason: 'SERIES_NOT_SETTLED',
        };
      }
      const frac = BigInt(series.upsideFraction);
      const output = (amountBig * frac) / WAD;
      return {
        action: 'redeemUpside',
        inputAmount,
        outputAmount: output.toString(),
        isExecutable: true,
      };
    }

    return {
      action,
      inputAmount,
      outputAmount: '0',
      isExecutable: false,
      reason: 'INVALID_ACTION',
    };
  }

  private mapSeriesRow(row: any): RiskSplitSeriesModel {
    return {
      chainId: Number(row.chain_id),
      seriesAddress: row.series_address.trim(),
      underlyingAddress: row.underlying_address.trim(),
      protectedTokenAddress: row.protected_token_address?.trim() || '',
      upsideTokenAddress: row.upside_token_address?.trim() || '',
      settlementAdapterAddress: row.settlement_adapter_address.trim(),
      floorPrice: row.floor_price.toString(),
      capPrice: row.cap_price.toString(),
      expiryTimestamp: Number(row.expiry_timestamp),
      createdBlock: row.created_block ? Number(row.created_block) : 0,
      createdTx: row.created_tx ? row.created_tx.trim() : undefined,
      creationReferencePriceUsdE8: row.creation_reference_price_usd_e8?.toString() ?? null,
      creationFeedAddress: row.creation_feed_address?.trim() ?? null,
      creationFeedRoundId: row.creation_feed_round_id?.toString() ?? null,
      creationFeedUpdatedAt: row.creation_feed_updated_at ? new Date(row.creation_feed_updated_at).toISOString() : null,
      creationReferenceBlock: row.creation_reference_block == null ? null : Number(row.creation_reference_block),
      creationReferenceVerified: Boolean(row.creation_reference_verified),
      isSettled: Boolean(row.is_settled),
      settledPrice: row.settled_price ? row.settled_price.toString() : null,
      protectedFraction: row.protected_fraction ? row.protected_fraction.toString() : null,
      upsideFraction: row.upside_fraction ? row.upside_fraction.toString() : null,
      settledAt: row.settled_at ? new Date(row.settled_at).toISOString() : null,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    };
  }
}
