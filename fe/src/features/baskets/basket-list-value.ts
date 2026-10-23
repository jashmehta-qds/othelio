/** Sums all basket valuations across the portfolio, treating unfunded/unvalued baskets as 0. */
export function basketListTotal(baskets: readonly { totalNavUsdcMicro: string | null }[]): number {
  return baskets.reduce((total, basket) => total + (basket.totalNavUsdcMicro !== null ? Number(basket.totalNavUsdcMicro) / 1e6 : 0), 0);
}
