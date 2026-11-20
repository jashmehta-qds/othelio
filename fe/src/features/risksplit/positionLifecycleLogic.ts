export interface PositionActionStateParams {
  isConnected: boolean;
  chainId: number | undefined;
  nowSeconds: number;
  expiryTimestamp: number;
  isSettled: boolean;
  underlyingBalance: string;
  protectedBalance: string;
  upsideBalance: string;
  underlyingAllowance: string;
  unitsCompatible: boolean;
}

export interface PositionActionState {
  canWrite: boolean;
  guardMessage: string | null;
  canSplit: boolean;
  splitDisabledReason: string | null;
  needsSplitApproval: (amount: string) => boolean;
  canCombine: boolean;
  maxCombinePair: string;
  combineDisabledReason: string | null;
  canRedeem: boolean;
  redeemDisabledReason: string | null;
  canSettle: boolean;
  settleDisabledReason: string | null;
}

export function evaluatePositionActionAvailability(
  params: PositionActionStateParams,
): PositionActionState {
  const {
    isConnected,
    chainId,
    nowSeconds,
    expiryTimestamp,
    isSettled,
    underlyingBalance,
    protectedBalance,
    upsideBalance,
    underlyingAllowance,
    unitsCompatible,
  } = params;

  if (!isConnected) {
    return {
      canWrite: false,
      guardMessage: "Connect a wallet to manage claims.",
      canSplit: false,
      splitDisabledReason: "Wallet not connected",
      needsSplitApproval: () => false,
      canCombine: false,
      maxCombinePair: "0",
      combineDisabledReason: "Wallet not connected",
      canRedeem: false,
      redeemDisabledReason: "Wallet not connected",
      canSettle: false,
      settleDisabledReason: "Wallet not connected",
    };
  }

  if (chainId !== 8453) {
    return {
      canWrite: false,
      guardMessage: "Switch your wallet to Base to manage claims.",
      canSplit: false,
      splitDisabledReason: "Wrong network",
      needsSplitApproval: () => false,
      canCombine: false,
      maxCombinePair: "0",
      combineDisabledReason: "Wrong network",
      canRedeem: false,
      redeemDisabledReason: "Wrong network",
      canSettle: false,
      settleDisabledReason: "Wrong network",
    };
  }

  if (!unitsCompatible) {
    return {
      canWrite: false,
      guardMessage: "Verifying token scales...",
      canSplit: false,
      splitDisabledReason: "Units incompatible",
      needsSplitApproval: () => false,
      canCombine: false,
      maxCombinePair: "0",
      combineDisabledReason: "Units incompatible",
      canRedeem: false,
      redeemDisabledReason: "Units incompatible",
      canSettle: false,
      settleDisabledReason: "Units incompatible",
    };
  }

  const isExpired = expiryTimestamp <= nowSeconds;
  const numUnderlying = parseFloat(underlyingBalance) || 0;
  const numProt = parseFloat(protectedBalance) || 0;
  const numUp = parseFloat(upsideBalance) || 0;
  const numAllowance = parseFloat(underlyingAllowance) || 0;
  const maxPairNum = Math.min(numProt, numUp);
  const maxCombinePair = maxPairNum > 0 ? maxPairNum.toFixed(2) : "0.00";

  // Split: allowed before expiry and before settlement
  let canSplit = false;
  let splitDisabledReason: string | null = null;
  if (isSettled) {
    splitDisabledReason = "Series already settled";
  } else if (isExpired) {
    splitDisabledReason = "Series expired";
  } else if (numUnderlying <= 0) {
    splitDisabledReason = "No stock tokens available in wallet";
  } else {
    canSplit = true;
  }

  const needsSplitApproval = (amountStr: string) => {
    const amt = parseFloat(amountStr) || 0;
    return amt > numAllowance;
  };

  // Combine: allowed before settlement (even if expired!)
  let canCombine = false;
  let combineDisabledReason: string | null = null;
  if (isSettled) {
    combineDisabledReason = "Series already settled; use single-claim redemption.";
  } else if (maxPairNum <= 0) {
    combineDisabledReason = "Requires at least 1 matching Protected + Upside pair.";
  } else {
    canCombine = true;
  }

  // Redeem: unlocked ONLY after series is settled onchain
  let canRedeem = false;
  let redeemDisabledReason: string | null = null;
  if (!isSettled) {
    redeemDisabledReason = "Available after settlement";
  } else if (numProt <= 0 && numUp <= 0) {
    redeemDisabledReason = "No claims to redeem in wallet";
  } else {
    canRedeem = true;
  }

  // Settle: available after expiry and when NOT yet settled
  let canSettle = false;
  let settleDisabledReason: string | null = null;
  if (isSettled) {
    settleDisabledReason = "Series already settled";
  } else if (!isExpired) {
    settleDisabledReason = "Settlement unlocks at expiry";
  } else {
    canSettle = true;
  }

  return {
    canWrite: true,
    guardMessage: null,
    canSplit,
    splitDisabledReason,
    needsSplitApproval,
    canCombine,
    maxCombinePair,
    combineDisabledReason,
    canRedeem,
    redeemDisabledReason,
    canSettle,
    settleDisabledReason,
  };
}
