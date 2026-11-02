export interface IndexerFreshness {
  isFresh: boolean;
  observedHeadBlock: number;
  lastIndexedBlock: number;
  blockLag: number;
  observedHeadAt?: string | null;
}

export interface RiskSplitSeriesModel {
  chainId: number;
  seriesAddress: string;
  underlyingAddress: string;
  protectedTokenAddress: string;
  upsideTokenAddress: string;
  settlementAdapterAddress: string;
  floorPrice: string;
  capPrice: string;
  expiryTimestamp: number;
  createdBlock?: number;
  createdTx?: string;
  creationReferencePriceUsdE8?: string | null;
  creationFeedAddress?: string | null;
  creationFeedRoundId?: string | null;
  creationFeedUpdatedAt?: string | null;
  creationReferenceBlock?: number | null;
  creationReferenceVerified?: boolean;
  factoryAddress?: string | null;
  formulaVersion?: number;
  settledRoundId?: string | null;
  settledFeedUpdatedAt?: string | null;
  operationsAuditStatus?: string;
  operationsAuditNote?: string | null;
  lastIndexedBlock?: number;
  asOfBlock?: number;
  indexerFreshness?: IndexerFreshness;
  isSettled: boolean;
  settledPrice: string | null;
  protectedFraction: string | null;
  upsideFraction: string | null;
  settledAt?: string | null;
  createdAt: string;
}

export interface RiskSplitPositionModel {
  chainId: number;
  seriesAddress: string;
  userAddress: string;
  protectedBalance: string;
  upsideBalance: string;
  totalMinted: string;
  totalPairedRedeemed: string;
  totalProtectedRedeemed: string;
  totalUpsideRedeemed: string;
  updatedAt?: string;
}

export interface PayoffCalculation {
  protectedValue: bigint;
  upsideValue: bigint;
  protectedFraction: bigint;
  upsideFraction: bigint;
  protectedFractionWad: bigint;
  upsideFractionWad: bigint;
}

export interface PayoffPoint {
  price: number;
  protectedValue: number;
  upsideValue: number;
  underlyingValue: number;
  protectedFraction?: number;
  upsideFraction?: number;
}

export interface PayoffCurveResponse {
  seriesAddress: string;
  floorPrice: number;
  capPrice: number;
  points: PayoffPoint[];
}

export type RiskSplitAction =
  | 'mint'
  | 'combineAndRedeem'
  | 'pairRedeem'
  | 'redeemProtected'
  | 'redeemUpside';

export interface QuoteResponse {
  action: RiskSplitAction | string;
  inputAmount: string;
  outputAmount: string;
  protectedReceived?: string;
  upsideReceived?: string;
  isExecutable: boolean;
  reason?: string;
}
