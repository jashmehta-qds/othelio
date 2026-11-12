export interface UpsideRoundModel {
  chainId: number;
  roundId: number;
  factoryAddress: string;
  underlyingAddress: string;
  feedAddress: string;
  adapterAddress: string;
  referenceRoundId: string;
  referencePrice: string;
  referencePriceFormatted: string;
  referenceTime: number;
  roundStart: number;
  expiryTimestamp: number;
  expectedMove: string;
  expectedMoveFormatted: string;
  provenanceHash: string;
  strikeTick: string;
  minStrike: string;
  maxStrike: string;
  publicCreationEnabled: boolean;
  createdBlock: number;
  createdTx: string;
  createdAt: string;
  marketsCount?: number;
}

export interface UpsideMarketModel {
  chainId: number;
  seriesAddress: string;
  roundId: number;
  factoryAddress: string;
  underlyingAddress: string;
  upsideTokenAddress: string;
  residualTokenAddress: string;
  strikePrice: string;
  strikePriceFormatted: string;
  expiryTimestamp: number;
  isSettled: boolean;
  settledPrice: string | null;
  settledPriceFormatted: string | null;
  settledRoundId: string | null;
  settledTimestamp: number | null;
  collateralSnapshot: string | null;
  totalClaimSupplySnapshot: string | null;
  upsideAllocation: string | null;
  residualAllocation: string | null;
  creatorAddress: string;
  createdBlock: number;
  createdTx: string;
  settledAt: string | null;
  createdAt: string;
  // Live depth & pricing
  bestBidUsdc?: number | null;
  bestAskUsdc?: number | null;
  bestBidSize?: string | null;
  bestAskSize?: string | null;
  targetLabel?: string; // e.g. "Starting Price", "Reach", "Strong Move", "Long Shot"
}

export interface UpsidePositionModel {
  chainId: number;
  seriesAddress: string;
  userAddress: string;
  upsideBalance: string;
  residualBalance: string;
  totalMinted: string;
  totalPairWithdrawn: string;
  totalUpsideRedeemed: string;
  totalResidualRedeemed: string;
  costBasisUsdc?: string | null;
  updatedAt?: string;
  // Enriched market info
  strikePrice?: string;
  expiryTimestamp?: number;
  isSettled?: boolean;
  underlyingSymbol?: string;
}

export interface UpsideAssetItem {
  tokenAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  feedAddress: string;
  feedDecimals: number;
  isSupportedInRegistry: boolean;
  isEligibleForUpside: boolean;
  ineligibilityReason?: string;
  currentPriceUsd?: string;
  priceUpdatedAt?: string;
  isFreshPrice?: boolean;
}

export interface UpsideAssetsResponse {
  chainId: number;
  registryAddress: string;
  asOfBlock: number;
  assets: UpsideAssetItem[];
}

export interface UpsideStockHistoryPoint {
  timestamp: number;
  priceUsd: number;
  blockNumber?: number;
  source: 'chainlink' | 'db_observation';
}

export interface UpsideStockHistoryResponse {
  assetAddress: string;
  symbol: string;
  history: UpsideStockHistoryPoint[];
  asOf: string;
  hasGaps: boolean;
}

export interface ContinuousPayoffCalculation {
  strikePrice: bigint;
  spotPrice: bigint;
  upsideValue: bigint;      // max(S - K, 0)
  residualValue: bigint;    // min(S, K)
  upsideFractionWad: bigint;   // (upsideValue * 1e18) / spotPrice (or 0 if spot=0)
  residualFractionWad: bigint; // 1e18 - upsideFractionWad (or 1e18 if spot=0)
}
