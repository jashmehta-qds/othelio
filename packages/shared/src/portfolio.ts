import { z } from "zod";

import { addressSchema, chainIdSchema } from "./primitives.js";

export const baseUnitAmountSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const nullableBaseUnitAmountSchema = baseUnitAmountSchema.nullable();
export const blockHashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
export const calldataSchema = z.string().regex(/^0x(?:[a-fA-F0-9]{2})*$/);

export const positionIdentitySchema = z.object({
  chainId: chainIdSchema,
  basketAddress: addressSchema,
  protocol: z.string().min(1),
  marketAddress: addressSchema,
  assetAddress: addressSchema,
});
export type PositionIdentity = z.infer<typeof positionIdentitySchema>;

export const aerodromeRouteKindSchema = z.enum(["DIRECT", "VIA_USDC"]);
export type AerodromeRouteKind = z.infer<typeof aerodromeRouteKindSchema>;

export const aerodromeRouteSchema = z.object({
  kind: aerodromeRouteKindSchema,
  tokenIn: addressSchema,
  tokenOut: addressSchema,
  firstTickSpacing: z.number().int(),
  secondTickSpacing: z.number().int(),
  amountIn: baseUnitAmountSchema,
  minimumAmountOut: baseUnitAmountSchema,
});
export type AerodromeRoute = z.infer<typeof aerodromeRouteSchema>;

export const tokenPositionSchema = z.object({
  assetAddress: addressSchema,
  symbol: z.string().min(1).optional(),
  decimals: z.number().int().min(0).max(255),
  liquidAmountBaseUnits: nullableBaseUnitAmountSchema,
  priceUsdE8: nullableBaseUnitAmountSchema,
});
export type TokenPosition = z.infer<typeof tokenPositionSchema>;

export const marketPositionSchema = z.object({
  identity: positionIdentitySchema,
  suppliedAmountBaseUnits: nullableBaseUnitAmountSchema,
  accruedDebtAmountBaseUnits: nullableBaseUnitAmountSchema,
});
export type MarketPosition = z.infer<typeof marketPositionSchema>;

export const positionSnapshotSchema = z.object({
  chainId: chainIdSchema,
  basketAddress: addressSchema,
  blockNumber: z.number().int().nonnegative(),
  blockHash: blockHashSchema,
  observedAt: z.string().datetime(),
  tokens: z.array(tokenPositionSchema),
  markets: z.array(marketPositionSchema),
  grossAssetsUsdE8: nullableBaseUnitAmountSchema,
  accruedDebtUsdE8: nullableBaseUnitAmountSchema,
  equityUsdE8: nullableBaseUnitAmountSchema,
  /** Raw Aave health factor scaled by 1e18, when the configured pool can be read. */
  aaveHealthFactorRay: nullableBaseUnitAmountSchema.optional(),
  readCompleteness: z.enum(["COMPLETE", "PARTIAL", "UNAVAILABLE"]),
  valuationStatus: z.enum(["COMPLETE", "PARTIAL", "UNAVAILABLE", "STALE"]),
  issues: z.array(z.string()).default([]),
});
export type PositionSnapshot = z.infer<typeof positionSnapshotSchema>;

export const basketActionSchema = z.enum([
  "FUND",
  "SPOT_REBALANCE",
  "WITHDRAW_LIQUID",
  "SUPPLY",
  "BORROW",
  "REINVEST",
  "REPAY",
  "RELEASE_COLLATERAL",
]);
export type BasketAction = z.infer<typeof basketActionSchema>;

export const actionCapabilitySchema = z.object({
  availability: z.enum(["AVAILABLE", "CONDITIONAL", "DISABLED"]),
  reason: z.string().min(1),
  policySource: z.string().min(1),
  enforcement: z.object({
    api: z.boolean(),
    onchain: z.boolean(),
  }),
});
export type ActionCapability = z.infer<typeof actionCapabilitySchema>;

export const basketCapabilitiesSchema = z.object({
  chainId: chainIdSchema,
  deploymentVersion: z.string().min(1),
  authorityMode: z.enum(["UNRESTRICTED_OWNER", "RESTRICTED_ACCOUNT", "UNKNOWN"]),
  actions: z.object({
    FUND: actionCapabilitySchema,
    SPOT_REBALANCE: actionCapabilitySchema,
    WITHDRAW_LIQUID: actionCapabilitySchema,
    SUPPLY: actionCapabilitySchema,
    BORROW: actionCapabilitySchema,
    REINVEST: actionCapabilitySchema,
    REPAY: actionCapabilitySchema,
    RELEASE_COLLATERAL: actionCapabilitySchema,
  }),
});
export type BasketCapabilities = z.infer<typeof basketCapabilitiesSchema>;

const conditionalProductCapability = (reason: string): ActionCapability => ({
  availability: "CONDITIONAL",
  reason,
  policySource: "PORTFOLIO_ONLY_DEFAULT",
  enforcement: { api: false, onchain: false },
});

const disabledProductCapability = (reason: string): ActionCapability => ({
  availability: "DISABLED",
  reason,
  policySource: "PORTFOLIO_ONLY_DEFAULT",
  enforcement: { api: false, onchain: false },
});

export function createPortfolioOnlyCapabilities(
  chainId: number,
  deploymentVersion: string,
): BasketCapabilities {
  return {
    chainId: chainIdSchema.parse(chainId),
    deploymentVersion,
    authorityMode: "UNRESTRICTED_OWNER",
    actions: {
      FUND: conditionalProductCapability("Available after portfolio funding checks pass."),
      SPOT_REBALANCE: conditionalProductCapability("Available for verified liquid positions and executable quotes."),
      WITHDRAW_LIQUID: conditionalProductCapability("Available for verified liquid balances with explicit limits."),
      SUPPLY: disabledProductCapability("New lending supply is not offered in the portfolio-only release."),
      BORROW: disabledProductCapability("New borrowing is not offered in the portfolio-only release."),
      REINVEST: disabledProductCapability("Borrow-and-reinvest is not offered in the portfolio-only release."),
      REPAY: conditionalProductCapability("Existing debt remains eligible for recovery after its market identity is verified."),
      RELEASE_COLLATERAL: conditionalProductCapability("Existing collateral may be released within verified protocol limits."),
    },
  };
}

export function createUnknownDeploymentCapabilities(chainId: number): BasketCapabilities {
  const unavailable = (reason: string): ActionCapability => ({
    availability: "DISABLED",
    reason,
    policySource: "UNKNOWN_DEPLOYMENT",
    enforcement: { api: false, onchain: false },
  });
  const recovery = (reason: string): ActionCapability => ({
    availability: "CONDITIONAL",
    reason,
    policySource: "UNKNOWN_DEPLOYMENT",
    enforcement: { api: false, onchain: false },
  });

  return {
    chainId: chainIdSchema.parse(chainId),
    deploymentVersion: "unknown",
    authorityMode: "UNKNOWN",
    actions: {
      FUND: unavailable("Deployment capabilities must be identified before preparing funding."),
      SPOT_REBALANCE: unavailable("Deployment capabilities must be identified before preparing a rebalance."),
      WITHDRAW_LIQUID: unavailable("Deployment capabilities must be identified before preparing a liquid withdrawal."),
      SUPPLY: unavailable("New lending supply is disabled for an unknown deployment."),
      BORROW: unavailable("New borrowing is disabled for an unknown deployment."),
      REINVEST: unavailable("Borrow-and-reinvest is disabled for an unknown deployment."),
      REPAY: recovery("Discover the existing market and account authority before preparing repayment."),
      RELEASE_COLLATERAL: recovery("Discover the existing market and account authority before releasing collateral."),
    },
  };
}

export const snapshotReferenceSchema = positionSnapshotSchema.pick({
  chainId: true,
  basketAddress: true,
  blockNumber: true,
  blockHash: true,
});
export type SnapshotReference = z.infer<typeof snapshotReferenceSchema>;

export const executionCallSchema = z.object({
  order: z.number().int().nonnegative(),
  to: addressSchema,
  calldata: calldataSchema,
  valueBaseUnits: baseUnitAmountSchema,
});

export const executionPlanSchema = z.object({
  action: basketActionSchema,
  accountAddress: addressSchema,
  chainId: chainIdSchema,
  snapshot: snapshotReferenceSchema,
  calls: z.array(executionCallSchema),
  approvals: z.array(z.object({
    tokenAddress: addressSchema,
    spenderAddress: addressSchema,
    maxAmountBaseUnits: baseUnitAmountSchema,
  })),
  limits: z.array(z.object({
    assetAddress: addressSchema,
    maxInputBaseUnits: nullableBaseUnitAmountSchema,
    minOutputBaseUnits: nullableBaseUnitAmountSchema,
  })),
  expiresAt: z.string().datetime(),
  expectedAfterState: z.array(z.object({
    assetAddress: addressSchema,
    liquidDeltaBaseUnits: z.string().regex(/^-?(0|[1-9][0-9]*)$/).nullable(),
  })),
  simulation: z.object({
    status: z.enum(["NOT_RUN", "SUCCEEDED", "FAILED", "UNAVAILABLE"]),
    reason: z.string().nullable(),
    simulatedAt: z.string().datetime().nullable(),
    blockNumber: z.number().int().nonnegative().nullable(),
  }),
});
export type ExecutionPlan = z.infer<typeof executionPlanSchema>;

export const transactionStatusSchema = z.enum([
  "AWAITING_APPROVAL",
  "AWAITING_SIGNATURE",
  "SUBMITTED",
  "CONFIRMED_SUCCESS",
  "CONFIRMED_REVERT",
  "REPLACED",
  "DROPPED",
  "UNKNOWN",
  "REORG_INVALIDATED",
]);
export type TransactionStatus = z.infer<typeof transactionStatusSchema>;

export const transactionLifecycleSchema = z.object({
  operationId: z.string().min(1),
  chainId: chainIdSchema,
  accountAddress: addressSchema,
  action: basketActionSchema,
  status: transactionStatusSchema,
  transactionHash: blockHashSchema.nullable(),
  replacementTransactionHash: blockHashSchema.nullable(),
  submittedAt: z.string().datetime().nullable(),
  settledAt: z.string().datetime().nullable(),
  receiptBlockNumber: z.number().int().nonnegative().nullable(),
  receiptBlockHash: blockHashSchema.nullable(),
  canonicalSnapshot: snapshotReferenceSchema.nullable(),
  reason: z.string().nullable(),
});
export type TransactionLifecycle = z.infer<typeof transactionLifecycleSchema>;

// Read models are deliberately separate from database rows. Decimal and token
// amounts remain strings at the API boundary so callers never lose precision.
export const freshnessSchema = z.object({
  positionBlockNumber: z.number().int().nonnegative().nullable(),
  positionBlockHash: blockHashSchema.nullable(),
  positionObservedAt: z.string().datetime().nullable(),
  priceBlockNumber: z.number().int().nonnegative().nullable(),
  priceBlockHash: blockHashSchema.nullable(),
  priceObservedAt: z.string().datetime().nullable(),
  status: z.enum(["FRESH", "STALE", "DEGRADED", "UNAVAILABLE"]),
});
export type Freshness = z.infer<typeof freshnessSchema>;

export const basketSummarySchema = z.object({
  chainId: chainIdSchema,
  address: addressSchema,
  controller: addressSchema,
  name: z.string(),
  symbol: z.string(),
  createdAt: z.string().datetime(),
  totalNavUsdcMicro: baseUnitAmountSchema.nullable(),
  holdingCount: z.number().int().nonnegative(),
  targetCount: z.number().int().nonnegative(),
  freshness: freshnessSchema,
});
export type BasketSummary = z.infer<typeof basketSummarySchema>;

export const holdingSchema = z.object({
  assetAddress: addressSchema,
  symbol: z.string().nullable(),
  decimals: z.number().int().min(0).max(255),
  quantityBaseUnits: baseUnitAmountSchema,
  priceUsdE8: baseUnitAmountSchema.nullable(),
  valueUsdcMicro: baseUnitAmountSchema.nullable(),
  currentWeightBps: z.number().int().nonnegative().nullable(),
  averageCostUsdcMicroPerBaseUnit: baseUnitAmountSchema.nullable(),
  unrealizedPnlUsdcMicro: z.string().regex(/^-?(0|[1-9][0-9]*)$/).nullable(),
  status: z.enum(["COMPLETE", "PARTIAL", "UNAVAILABLE", "STALE"]),
});
export type Holding = z.infer<typeof holdingSchema>;

export const basketDetailSchema = z.object({
  summary: basketSummarySchema,
  targets: z.array(z.object({ assetAddress: addressSchema, targetWeightBps: z.number().int().min(0).max(10000) })),
  holdings: z.array(holdingSchema),
  valuation: z.object({ totalNavUsdcMicro: baseUnitAmountSchema.nullable(), status: z.enum(["COMPLETE", "PARTIAL", "UNAVAILABLE", "STALE"]) }),
  accounting: z.object({ policy: z.string(), status: z.enum(["COMPLETE", "INCOMPLETE", "UNAVAILABLE"]), issue: z.string().nullable() }),
  capabilities: basketCapabilitiesSchema,
  freshness: freshnessSchema,
});
export type BasketDetail = z.infer<typeof basketDetailSchema>;

export const portfolioOverviewSchema = z.object({
  chainId: chainIdSchema,
  controller: addressSchema,
  totalNavUsdcMicro: baseUnitAmountSchema.nullable(),
  baskets: z.array(basketSummarySchema),
  holdings: z.array(holdingSchema),
  freshness: freshnessSchema,
  calculatedAt: z.string().datetime(),
});
export type PortfolioOverview = z.infer<typeof portfolioOverviewSchema>;

export const assetCatalogItemSchema = z.object({
  chainId: chainIdSchema,
  assetAddress: addressSchema,
  symbol: z.string().nullable(),
  name: z.string().nullable(),
  decimals: z.number().int().min(0).max(255).nullable(),
  priceUsdE8: baseUnitAmountSchema.nullable(),
  priceBlockNumber: z.number().int().nonnegative().nullable(),
  priceBlockHash: blockHashSchema.nullable(),
  priceObservedAt: z.string().datetime().nullable(),
  status: z.enum(["FRESH", "STALE", "DEGRADED", "UNAVAILABLE"]),
});
export type AssetCatalogItem = z.infer<typeof assetCatalogItemSchema>;

export const cursorPageSchema = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

/** Activity adapter contract consumed by the existing web activity rows. */
export const activityEventSchema = z.object({
  chainId: chainIdSchema,
  txHash: z.string().min(1),
  logIndex: z.number().int().nonnegative(),
  blockNumber: z.number().int().nonnegative(),
  blockHash: blockHashSchema,
  basketAddress: addressSchema,
  eventType: z.string().min(1),
  actorAddress: addressSchema.nullable(),
  payload: z.unknown(),
  occurredAt: z.string().datetime(),
});
export type ActivityEvent = z.infer<typeof activityEventSchema>;
export const activityPageSchema = z.object({ data: z.array(activityEventSchema), page: cursorPageSchema });
export type ActivityPage = z.infer<typeof activityPageSchema>;
