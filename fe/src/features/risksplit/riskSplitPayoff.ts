/**
 * Authoritative Risk Split V1 payoff and fraction calculations.
 *
 * Source of truth: contracts/src/risksplit/RiskSplitSeries.sol
 *
 * Piecewise payoff across 5 regimes for fixing S, floor F, cap C:
 *   S = 0        -> (P, U) = (0, 0)
 *   0 < S < F    -> (P, U) = (S, 0)
 *   F <= S < 2F  -> (P, U) = (F, S - F)
 *   2F <= S < 2C -> (P, U) = (S / 2, S / 2)
 *   S >= 2C      -> (P, U) = (C, S - C)
 *
 * Continuous value conservation: P + U = S throughout.
 *
 * Settlement delivers underlying stock fractions, not guaranteed cash.
 * "Protected" is a token parameter label, not an absolute principal floor.
 */

export const WAD = BigInt(10) ** BigInt(18);
const ZERO = BigInt(0);
const TWO = BigInt(2);

export interface RiskSplitPayoffResult {
  protectedValueE8: bigint;
  upsideValueE8: bigint;
}

export interface RiskSplitFractionsResult {
  protectedFractionFormatted: string;
  upsideFractionFormatted: string;
  protectedFractionWad: bigint;
  upsideFractionWad: bigint;
}

/**
 * Computes exact V1 dollar-equivalent payoff values in 8 decimals (matching Chainlink feed scale).
 */
export function riskSplitPayoff(
  floorE8: bigint,
  capE8: bigint,
  fixingE8: bigint,
): RiskSplitPayoffResult {
  if (fixingE8 <= ZERO) {
    return {
      protectedValueE8: ZERO,
      upsideValueE8: ZERO,
    };
  }

  const F = floorE8;
  const C = capE8;
  const S = fixingE8;

  if (S < F) {
    return {
      protectedValueE8: S,
      upsideValueE8: ZERO,
    };
  }

  if (S < TWO * F) {
    return {
      protectedValueE8: F,
      upsideValueE8: S - F,
    };
  }

  if (S < TWO * C) {
    const half = S / TWO;
    return {
      protectedValueE8: half,
      upsideValueE8: S - half,
    };
  }

  return {
    protectedValueE8: C,
    upsideValueE8: S - C,
  };
}

/**
 * Computes underlying stock fractions delivered per claim token at fixing S.
 * Follows contracts/src/risksplit/RiskSplitSeries.sol _applySettlement.
 */
export function riskSplitStockFractions(
  floorE8: bigint,
  capE8: bigint,
  fixingE8: bigint,
  displayDecimals = 4,
): RiskSplitFractionsResult {
  if (fixingE8 <= ZERO) {
    const zeroStr = (0).toFixed(displayDecimals);
    return {
      protectedFractionFormatted: zeroStr,
      upsideFractionFormatted: zeroStr,
      protectedFractionWad: ZERO,
      upsideFractionWad: ZERO,
    };
  }

  let protectedFractionWad: bigint;
  let upsideFractionWad: bigint;

  const F = floorE8;
  const C = capE8;
  const S = fixingE8;

  if (S < F) {
    protectedFractionWad = WAD;
    upsideFractionWad = ZERO;
  } else if (S < TWO * F) {
    let pFrac = (F * WAD) / S;
    if (pFrac > WAD) pFrac = WAD;
    protectedFractionWad = pFrac;
    upsideFractionWad = WAD - pFrac;
  } else if (S < TWO * C) {
    protectedFractionWad = WAD / TWO;
    upsideFractionWad = WAD - (WAD / TWO);
  } else {
    let pFrac = (C * WAD) / S;
    if (pFrac > WAD) pFrac = WAD;
    protectedFractionWad = pFrac;
    upsideFractionWad = WAD - pFrac;
  }

  const factor = BigInt(10) ** BigInt(displayDecimals);
  const roundP = (protectedFractionWad * factor + WAD / TWO) / WAD;
  const roundU = (upsideFractionWad * factor + WAD / TWO) / WAD;

  const fmtP = (Number(roundP) / Number(factor)).toFixed(displayDecimals);
  const fmtU = (Number(roundU) / Number(factor)).toFixed(displayDecimals);

  return {
    protectedFractionFormatted: fmtP,
    upsideFractionFormatted: fmtU,
    protectedFractionWad,
    upsideFractionWad,
  };
}

/**
 * Formats a fractional stock token delivery description.
 */
export function formatStockFraction(
  fractionFormatted: string,
  symbol: string,
): string {
  return `${fractionFormatted} ${symbol}`;
}
