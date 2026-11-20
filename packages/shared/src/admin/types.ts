// packages/shared/src/admin/types.ts
// Shared types for Operator Console (Admin) APIs and UI

export interface AdminChallengeRequest {
  address: string;
  chainId?: number;
}

export interface AdminChallengeResponse {
  nonce: string;
  message: string;
  expiresAt: string;
}

export interface AdminVerifyRequest {
  address: string;
  message: string;
  signature: string;
  chainId?: number;
}

export type AdminCapability = 'assetRegistry' | 'riskSplit' | 'upside';

export interface AdminOperator {
  address: string;
  chainId: number;
  capabilities: Record<AdminCapability, boolean>;
  contracts: Record<AdminCapability, `0x${string}` | null>;
}

export interface AdminVerifyResponse extends AdminOperator {
  token: string;
  expiresAt: string;
}

export interface AdminOverviewResponse {
  asOfBlock: number;
  indexerHealth: {
    isFresh: boolean;
    observedHeadBlock: number;
    lastIndexedBlock: number;
    blockLag: number;
    observedHeadAt?: string | null;
  };
  activeWallets: {
    last24h: number;
    last7d: number;
    last30d: number;
    allTime: number;
  };
  basketsCount: number;
  supportedAssetsCount: number;
  riskSplit: {
    totalSeries: number;
    openSeries: number;
    expiredSeries: number;
    settledSeries: number;
    totalMintVolumeUnderlying: string;
    totalRedemptionVolumeUnderlying: string;
    activeCollateralUnderlying: string;
    failedSettlementCount: number;
    indexingAlerts: number;
  };
  governedContracts: {
    factory: {
      address: string | null;
      owner: string | null;
      pendingOwner?: string | null;
    };
  };
}

export interface AdminAssetItem {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  isCoinbaseB20: boolean;
  totalSupply: string | null;
  priceFeed: {
    address: string;
    decimals: number;
    priceUsdE8: string | null;
    roundId: string | null;
    updatedAt: string | null;
    isFresh: boolean;
  };
  registryStatus: {
    isSupported: boolean;
    isB20: boolean;
  };
  routeStatus: {
    hasRoute: boolean;
  };
  staged: boolean;
  tradeable: boolean;
}

export interface AdminAssetsResponse {
  data: AdminAssetItem[];
  asOfBlock: number;
}

export interface AdminTransactionPreview {
  data?: `0x${string}`;
  description: string;
  target: `0x${string}`;
  chainId: number;
  method: string;
  args: any[];
  value?: string;
  expectedState?: string;
  simulationResult?: {
    success: boolean;
    message?: string;
  };
}

export interface AdminMarketItem {
  seriesAddress: string;
  underlying: {
    address: string;
    symbol: string;
    decimals: number;
  };
  floorPrice: string;
  capPrice: string;
  floorFormatted: string;
  capFormatted: string;
  expiryTimestamp: number;
  expiryIso: string;
  isExpired: boolean;
  referencePrice: string | null;
  referenceRoundId: string | null;
  referenceFeed: string | null;
  referenceBlock: number | null;
  isSettled: boolean;
  settledPrice: string | null;
  settledRoundId: string | null;
  settledFeedUpdatedAt: string | null;
  protectedTokenAddress: string | null;
  upsideTokenAddress: string | null;
  collateralTotal: string;
  openInterest: string;
  operationsAuditStatus: string;
  operationsAuditNote: string | null;
  lastIndexedBlock: number;
}

export interface AdminMarketsResponse {
  data: AdminMarketItem[];
  asOfBlock: number;
}

export interface AdminMarketPreviewRequest {
  underlying: string;
  floorPercent?: number;
  capPercent?: number;
  floorPrice?: string;
  capPrice?: string;
  expiryTimestamp: number;
  settlementAdapter?: string;
  factoryAddress?: string;
  chainId?: number;
}

export interface PayoffScenario {
  spotPrice: string;
  spotRatio: number;
  protectedPayout: string;
  upsidePayout: string;
  regime: string;
}

export interface AdminMarketPreviewResponse {
  underlying: {
    address: string;
    symbol: string;
    decimals: number;
  };
  referenceObservation: {
    roundId: string;
    price: string;
    formattedPrice: string;
    updatedAt: string;
  };
  floorPrice: string;
  capPrice: string;
  floorFormatted: string;
  capFormatted: string;
  expiryTimestamp: number;
  expiryIso: string;
  calendarCheck: {
    valid: boolean;
    timeZone: string;
    localTimeStr: string;
    sessionCloseDeltaMinutes: number;
    note?: string;
  };
  expiryAlreadyApproved: boolean;
  duplicateTermsDetected: boolean;
  payoffScenarios: PayoffScenario[];
  transactions: AdminTransactionPreview[];
}

export interface AdminOperationQueueItem {
  seriesAddress: string;
  underlyingSymbol: string;
  underlyingAddress: string;
  expiryTimestamp: number;
  expiryIso: string;
  isExpired: boolean;
  isSettled: boolean;
  candidateFixingRound?: {
    roundId: string;
    price: string;
    formattedPrice: string;
    updatedAt: string;
    isPreExpiry: boolean;
    isFresh: boolean;
  } | null;
  settlementReady: boolean;
  settlementPreviewTx?: AdminTransactionPreview | null;
  auditStatus: string;
}

export interface AdminRiskSplitIndexerState {
  status: 'ACTIVE' | 'PAUSED';
  isPaused: boolean;
  lastIndexedBlock: number;
  observedHeadBlock: number;
  blockLag: number;
}

export interface AdminOperationsResponse {
  asOfBlock: number;
  riskSplitIndexer?: AdminRiskSplitIndexerState;
  expiryQueue: AdminOperationQueueItem[];
  settlementAuditTrail: Array<{
    seriesAddress: string;
    settledPrice: string;
    settledRoundId: string;
    settledFeedUpdatedAt: string | null;
    txHash?: string | null;
    blockNumber?: number | null;
    auditStatus: string;
  }>;
  incidentAlerts: Array<{
    severity: 'INFO' | 'WARN' | 'ERROR';
    message: string;
    seriesAddress?: string;
    timestamp: string;
  }>;
}

export interface AdminUpsideStrikePreview {
  targetLabel: 'Starting price' | 'Reach' | 'Strong move' | 'Long shot' | 'Custom';
  strikePrice: string;
  strikePriceFormatted: string;
}

export interface AdminUpsideRoundPreviewRequest {
  chainId?: number;
  underlying: string;
  expiryTimestamp: number;
  expectedMove?: string;
  roundStart?: number;
  strikeTick?: string;
  minStrike?: string;
  maxStrike?: string;
}

export interface AdminUpsideRoundPreviewResponse {
  underlying: {
    address: string;
    symbol: string;
    decimals: number;
    feedAddress: string;
  };
  referencePrice: string;
  referencePriceFormatted: string;
  referenceRoundId: string;
  referenceTime: number;
  expectedMove: string;
  expectedMoveFormatted: string;
  roundStart: number;
  expiryTimestamp: number;
  expiryIso: string;
  calendarCheck: {
    valid: boolean;
    sessionCloseDeltaMinutes: number;
    note?: string;
  };
  strikes: AdminUpsideStrikePreview[];
  minStrike: string;
  maxStrike: string;
  strikeTick: string;
  factoryAddress: string;
  transactions: AdminTransactionPreview[];
}

export interface AdminUpsideMarketItem {
  seriesAddress: string;
  roundId: number;
  strikePrice: string;
  strikePriceFormatted: string;
  targetLabel?: string;
  expiryTimestamp: number;
  expiryIso: string;
  isSettled: boolean;
  settledPriceFormatted: string | null;
  upsideTokenAddress: string;
  residualTokenAddress: string;
  creatorAddress: string;
  createdAt: string;
}

export interface AdminUpsideRoundItem {
  roundId: number;
  chainId: number;
  factoryAddress: string;
  underlying: {
    address: string;
    symbol: string;
    decimals: number;
  };
  referencePriceFormatted: string;
  expectedMoveFormatted: string;
  expiryTimestamp: number;
  expiryIso: string;
  isExpired: boolean;
  isSettled: boolean;
  marketsCount: number;
  markets: AdminUpsideMarketItem[];
  createdAt: string;
}
