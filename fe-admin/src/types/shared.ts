// fe-admin/src/types/shared.ts
// Re-exports for @othelio/shared within fe-admin workspace

export * from '../../../packages/shared/src/risksplit/contracts';
export * from '../../../packages/shared/src/risksplit/venue';
export * from '../../../packages/shared/src/risksplit/deployment';
export * from '../../../packages/shared/src/admin/types';
export * from '../../../packages/shared/src/networks';
export * from '../../../packages/shared/src/primitives';

export const USDC_DECIMALS = 6;
export const DEFAULT_TOKEN_DECIMALS = 18;

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
