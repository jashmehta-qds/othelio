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
  bestBidUsdc?: number | null;
  bestAskUsdc?: number | null;
  bestBidSize?: string | null;
  bestAskSize?: string | null;
  targetLabel?: string;
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
  currentPriceUsd?: number;
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

export interface UpsideOrderBookLevel {
  priceUsd: string;
  rawPriceE6: string;
  amountClaim: string;
  totalClaim: string;
  orderCount: number;
  orderHash?: string;
}

export interface UpsideOrderBookTrade {
  id: string;
  orderHash: string;
  claimType: 'UPSIDE' | 'RESIDUAL';
  side: 'BUY' | 'SELL';
  makerAddress: string;
  takerAddress: string;
  amountClaim: string;
  amountUsdc: string;
  priceUsd: string;
  txHash: string | null;
  occurredAt: string;
}

export interface UpsideOrderBookDepth {
  seriesAddress: string;
  claimType: 'UPSIDE' | 'RESIDUAL';
  claimToken: string;
  quoteToken: string;
  sequence: number;
  asOfBlock: number;
  bids: UpsideOrderBookLevel[];
  asks: UpsideOrderBookLevel[];
  recentTrades: UpsideOrderBookTrade[];
}

export interface UpsideStoredOrderModel {
  orderHash: string;
  chainId: number;
  seriesAddress: string;
  claimType: 'UPSIDE' | 'RESIDUAL';
  claimToken: string;
  quoteToken: string;
  side: 'BUY' | 'SELL';
  makerAddress: string;
  takerAddress: string;
  makerToken: string;
  takerToken: string;
  makerAmount: string;
  takerAmount: string;
  remainingMakerAmount: string;
  remainingTakerAmount: string;
  priceUsd: string;
  priceUsdE6?: string;
  priceFormatted?: string;
  expiryTimestamp: number;
  salt: string;
  orderStatus: string;
  isLocallyHidden: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface UpsideCancelIntentResponse {
  orderHash: string;
  status: 'LOCALLY_HIDDEN';
  cancelTransactionData: {
    to: string;
    data: any;
  };
}

