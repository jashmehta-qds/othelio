import { BookLevel } from "./useRiskSplitBook";

export interface SingleOrderTradeParams {
  side: "BUY" | "SELL";
  requestedAmountClaims: string;
  selectedOrder: BookLevel | null;
  scenarioPayoffPerClaim: number;
}

export interface SingleOrderTradeResult {
  isValid: boolean;
  orderUnavailable: boolean;
  isCapped: boolean;
  requestedAmountClaims: string;
  effectiveAmountClaims: string;
  availableInOrder: string;
  priceUsd: string;
  totalUsdc: number;
  scenarioWorth: number;
  differenceFromCost: number;
  isMultiLevelSweep: false;
}

/**
 * Selects the best fillable order for a given side.
 * When a user wants to BUY claims, they fill an ASK (maker selling claims).
 * When a user wants to SELL claims, they fill a BID (maker buying claims).
 */
export function pickDefaultOrder(
  side: "BUY" | "SELL",
  bids: BookLevel[],
  asks: BookLevel[],
): BookLevel | null {
  if (side === "BUY") {
    return asks.length > 0 ? asks[0] : null;
  }
  return bids.length > 0 ? bids[0] : null;
}

/**
 * Computes single-order trade execution metrics.
 * Ensures the trade is capped to the selected order's size.
 * Disallows multi-level sweeps until atomic multi-fill is supported.
 */
export function computeSingleOrderTrade(
  params: SingleOrderTradeParams,
): SingleOrderTradeResult {
  const { side, requestedAmountClaims, selectedOrder, scenarioPayoffPerClaim } = params;

  if (!selectedOrder) {
    return {
      isValid: false,
      orderUnavailable: true,
      isCapped: false,
      requestedAmountClaims,
      effectiveAmountClaims: "0",
      availableInOrder: "0",
      priceUsd: "0.00",
      totalUsdc: 0,
      scenarioWorth: 0,
      differenceFromCost: 0,
      isMultiLevelSweep: false,
    };
  }

  const cleanPriceStr = selectedOrder.priceUsd.replace(/[^0-9.]/g, "");
  const priceNum = parseFloat(cleanPriceStr) || 0;
  const availableNum = parseFloat(selectedOrder.amountClaim) || 0;
  const requestedNum = parseFloat(requestedAmountClaims) || 0;

  if (requestedNum <= 0 || availableNum <= 0 || priceNum <= 0) {
    return {
      isValid: false,
      orderUnavailable: false,
      isCapped: false,
      requestedAmountClaims,
      effectiveAmountClaims: "0",
      availableInOrder: selectedOrder.amountClaim,
      priceUsd: cleanPriceStr,
      totalUsdc: 0,
      scenarioWorth: 0,
      differenceFromCost: 0,
      isMultiLevelSweep: false,
    };
  }

  const isCapped = requestedNum > availableNum;
  const effectiveNum = isCapped ? availableNum : requestedNum;
  const effectiveAmountClaims = isCapped
    ? selectedOrder.amountClaim
    : requestedAmountClaims;

  const totalUsdc = effectiveNum * priceNum;
  const scenarioWorth = effectiveNum * scenarioPayoffPerClaim;
  const differenceFromCost =
    side === "BUY" ? scenarioWorth - totalUsdc : scenarioWorth;

  return {
    isValid: true,
    orderUnavailable: false,
    isCapped,
    requestedAmountClaims,
    effectiveAmountClaims,
    availableInOrder: selectedOrder.amountClaim,
    priceUsd: cleanPriceStr,
    totalUsdc,
    scenarioWorth,
    differenceFromCost,
    isMultiLevelSweep: false,
  };
}

/**
 * Formats a dollar difference with + or − sign.
 */
export function formatSignedDifference(val: number): string {
  if (Math.abs(val) < 0.0001) return "$0.00";
  const sign = val > 0 ? "+" : "−";
  return `${sign}$${Math.abs(val).toFixed(2)}`;
}
