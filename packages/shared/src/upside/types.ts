// packages/shared/src/upside/types.ts
// Product and Domain Types for Stock Upside Markets

export type UpsideTargetLabel = 'Starting price' | 'Reach' | 'Strong move' | 'Long shot' | 'Custom';

export interface UpsideRound {
  roundId: number;
  underlying: `0x${string}`;
  underlyingSymbol: string;
  underlyingDecimals: number;
  feed: `0x${string}`;
  feedDecimals: number;
  adapter: `0x${string}`;
  referenceRoundId: string;
  referencePrice: string;
  referencePriceFormatted: string;
  referenceTime: number;
  roundStart: number;
  expiryTimestamp: number;
  expectedMove: string;
  expectedMoveFormatted: string;
  provenanceHash: `0x${string}`;
  strikeTick: string;
  minStrike: string;
  maxStrike: string;
  publicCreationEnabled: boolean;
  marketsCount: number;
  createdAt?: string;
}

export interface UpsideMarket {
  seriesAddress: `0x${string}`;
  roundId: number;
  underlying: `0x${string}`;
  underlyingSymbol: string;
  underlyingDecimals: number;
  strikePrice: string;
  strikePriceFormatted: string;
  targetLabel: UpsideTargetLabel;
  expiryTimestamp: number;
  upsideToken: `0x${string}`;
  residualToken: `0x${string}`;
  isSettled: boolean;
  settledPrice?: string;
  settledPriceFormatted?: string;
  settledRoundId?: string;
  settledTimestamp?: number;
  collateralSnapshot?: string;
  totalClaimSupplySnapshot?: string;
  upsideAllocation?: string;
  residualAllocation?: string;
  bestBidUsdc?: string;
  bestBidSize?: string;
  bestAskUsdc?: string;
  bestAskSize?: string;
  totalCollateral?: string;
  claimSupply?: string;
  freshnessBlock?: number;
}

export interface UpsidePosition {
  seriesAddress: `0x${string}`;
  roundId: number;
  underlying: `0x${string}`;
  underlyingSymbol: string;
  strikePrice: string;
  expiryTimestamp: number;
  claimType: 'UPSIDE' | 'RESIDUAL';
  claimTokenAddress: `0x${string}`;
  balanceRaw: string;
  balanceFormatted: string;
  isSettled: boolean;
  claimValueUsdc?: string;
  costBasisUsdc?: string | null;
}

export interface UpsideAssetEligibility {
  token: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  feed: `0x${string}`;
  feedDecimals: number;
  supported: boolean;
  eligibleForUpside: boolean;
  ineligibilityReason?: string;
}
