/** Dollar-equivalent values per claim at expiry; redemption delivers stock tokens.
 * Matches contracts/src/upside/UpsideSeries.sol: U = max(S - K, 0), R = min(S, K).
 */
export function upsideScenario(strike: number, endingPrice: number) {
  const price = Number.isFinite(endingPrice) ? Math.max(0, endingPrice) : 0;
  const target = Number.isFinite(strike) ? Math.max(0, strike) : 0;
  return {
    upside: Math.max(price - target, 0),
    residual: Math.min(price, target),
  };
}
