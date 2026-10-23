/** A total is only meaningful when every basket has an available valuation. */
export function basketListTotal(baskets: readonly { totalNavUsdcMicro: string | null }[]): number | null {
  if (baskets.some((basket) => basket.totalNavUsdcMicro === null)) return null;
  return baskets.reduce((total, basket) => total + Number(basket.totalNavUsdcMicro) / 1e6, 0);
}
