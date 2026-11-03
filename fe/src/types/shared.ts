export const USDC_DECIMALS = 6;
export const DEFAULT_TOKEN_DECIMALS = 18;

// Keep the frontend compatibility surface backed by the canonical workspace
// network contract. The alias for @othelio/shared points at this file for the
// frontend's existing shared types, so network constants are re-exported here.
export {
  BASE_FORK_CHAIN_ID,
  BASE_MAINNET_CHAIN_ID,
  SUPPORTED_CHAIN_IDS,
  isSupportedChainId,
  networkKindForChainId,
} from '../../../packages/shared/src/networks';
export type {
  NetworkDeploymentAddresses,
  NetworkKind,
  SupportedChainId,
} from '../../../packages/shared/src/networks';

/**
 * Unified helper to convert human-readable amounts (e.g. "100", 100.5) to raw BigInt token amounts
 * given the token's decimal precision (e.g. 6 for USDC, 18 for standard ERC20s).
 */
export function toRawAmount(amount: string | number, decimals: number = 18): bigint {
  const str = String(amount ?? 0).trim();
  if (!str || str === '0' || isNaN(Number(str))) {
    return BigInt(0);
  }

  const [integerPart, fractionalPart = ''] = str.split('.');
  const paddedFraction = fractionalPart.padEnd(decimals, '0').slice(0, decimals);
  const rawStr = (integerPart === '0' ? '' : integerPart) + paddedFraction;
  const cleanRawStr = rawStr.replace(/^0+/, '');

  return BigInt(cleanRawStr || '0');
}

/**
 * Unified helper to convert raw BigInt token amounts back to human-readable strings
 * given the token's decimal precision.
 */
export function fromRawAmount(
  rawAmount: bigint | string | number,
  decimals: number = 18,
  displayDecimals?: number,
): string {
  const rawBigInt = BigInt(rawAmount ?? 0);
  const isNegative = rawBigInt < BigInt(0);
  const absVal = isNegative ? -rawBigInt : rawBigInt;

  const str = absVal.toString().padStart(decimals + 1, '0');
  const integerPart = str.slice(0, str.length - decimals);
  let fractionalPart = str.slice(str.length - decimals);

  if (displayDecimals !== undefined) {
    fractionalPart = fractionalPart.slice(0, displayDecimals);
  }

  const trimmedFraction = fractionalPart.replace(/0+$/, '');
  const result = trimmedFraction ? `${integerPart}.${trimmedFraction}` : integerPart;

  return isNegative ? `-${result}` : result;
}

export const parseTokenAmount = toRawAmount;
export const formatTokenAmount = fromRawAmount;

export type BasketAction =
  | "FUND"
  | "SPOT_REBALANCE"
  | "WITHDRAW_LIQUID"
  | "SUPPLY"
  | "BORROW"
  | "REINVEST"
  | "REPAY"
  | "RELEASE_COLLATERAL";

export interface ActionCapability {
  availability: "AVAILABLE" | "CONDITIONAL" | "DISABLED";
  reason: string;
  policySource: string;
  enforcement: {
    api: boolean;
    onchain: boolean;
  };
}

export interface BasketCapabilities {
  chainId: number;
  deploymentVersion: string;
  authorityMode: "UNRESTRICTED_OWNER" | "RESTRICTED_ACCOUNT" | "UNKNOWN";
  actions: {
    FUND: ActionCapability;
    SPOT_REBALANCE: ActionCapability;
    WITHDRAW_LIQUID: ActionCapability;
    SUPPLY: ActionCapability;
    BORROW: ActionCapability;
    REINVEST: ActionCapability;
    REPAY: ActionCapability;
    RELEASE_COLLATERAL: ActionCapability;
  };
}

export interface PositionIdentity {
  chainId: number;
  basketAddress: `0x${string}`;
  protocol: string;
  marketAddress: `0x${string}`;
  assetAddress: `0x${string}`;
}

export interface TokenPosition {
  assetAddress: `0x${string}`;
  symbol?: string;
  decimals: number;
  liquidAmountBaseUnits: string | null;
  priceUsdE8: string | null;
}

export interface MarketPosition {
  identity: PositionIdentity;
  suppliedAmountBaseUnits: string | null;
  accruedDebtAmountBaseUnits: string | null;
}

export interface PositionSnapshot {
  chainId: number;
  basketAddress: `0x${string}`;
  blockNumber: number;
  blockHash: string;
  observedAt: string;
  tokens: TokenPosition[];
  markets: MarketPosition[];
  grossAssetsUsdE8: string | null;
  accruedDebtUsdE8: string | null;
  equityUsdE8: string | null;
  aaveHealthFactorRay?: string | null;
  readCompleteness: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
  valuationStatus: "COMPLETE" | "PARTIAL" | "UNAVAILABLE" | "STALE";
  issues: string[];
}

export interface SnapshotReference {
  chainId: number;
  basketAddress: `0x${string}`;
  blockNumber: number;
  blockHash: string;
}

export interface ExecutionCall {
  order: number;
  to: `0x${string}`;
  calldata: `0x${string}`;
  valueBaseUnits: string;
}

export interface ExecutionPlan {
  action: BasketAction;
  accountAddress: `0x${string}`;
  chainId: number;
  snapshot: SnapshotReference;
  calls: ExecutionCall[];
  approvals: Array<{
    tokenAddress: `0x${string}`;
    spenderAddress: `0x${string}`;
    maxAmountBaseUnits: string;
  }>;
  limits: Array<{
    assetAddress: `0x${string}`;
    maxInputBaseUnits: string | null;
    minOutputBaseUnits: string | null;
  }>;
  expiresAt: string;
  expectedAfterState: Array<{
    assetAddress: `0x${string}`;
    liquidDeltaBaseUnits: string | null;
  }>;
  simulation: {
    status: "NOT_RUN" | "SUCCEEDED" | "FAILED" | "UNAVAILABLE";
    reason: string | null;
    simulatedAt: string | null;
    blockNumber: number | null;
  };
}

export type TransactionStatus =
  | "AWAITING_APPROVAL"
  | "AWAITING_SIGNATURE"
  | "SUBMITTED"
  | "CONFIRMED_SUCCESS"
  | "CONFIRMED_REVERT"
  | "REPLACED"
  | "DROPPED"
  | "UNKNOWN"
  | "REORG_INVALIDATED";

export interface TransactionLifecycle {
  operationId: string;
  chainId: number;
  accountAddress: `0x${string}`;
  action: BasketAction;
  status: TransactionStatus;
  transactionHash: string | null;
  replacementTransactionHash: string | null;
  submittedAt: string | null;
  settledAt: string | null;
  receiptBlockNumber: number | null;
  receiptBlockHash: string | null;
  canonicalSnapshot: SnapshotReference | null;
  reason: string | null;
}

export * from '../../../packages/shared/src/risksplit/contracts';
export * from '../../../packages/shared/src/risksplit/venue';

