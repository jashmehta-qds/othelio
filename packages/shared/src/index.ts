export { addressSchema, chainIdSchema } from "./primitives.js";
export const basketFactoryAbi = [
  { type: "event", name: "BasketCreated", inputs: [
    { indexed: true, name: "basket", type: "address" },
    { indexed: true, name: "controller", type: "address" },
    { indexed: false, name: "name", type: "string" },
    { indexed: false, name: "symbol", type: "string" }
  ] }
] as const;
export const basketAbi = [
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{name:"shares",type:"uint256"},{name:"recipient",type:"address"}], outputs: [] },
  { type: "function", name: "redeem", stateMutability: "nonpayable", inputs: [{name:"shares",type:"uint256"},{name:"recipient",type:"address"}], outputs: [] },
  { type: "event", name: "BasketFunded", inputs: [{indexed:true,name:"basket",type:"address"},{indexed:true,name:"funder",type:"address"},{indexed:false,name:"sharesMinted",type:"uint256"},{indexed:false,name:"assets",type:"address[]"},{indexed:false,name:"amounts",type:"uint256[]"}] },
  { type: "event", name: "BasketWithdrawn", inputs: [{indexed:true,name:"basket",type:"address"},{indexed:true,name:"holder",type:"address"},{indexed:true,name:"recipient",type:"address"},{indexed:false,name:"sharesBurned",type:"uint256"},{indexed:false,name:"assets",type:"address[]"},{indexed:false,name:"amounts",type:"uint256[]"}] },
  { type: "event", name: "TargetWeightsUpdated", inputs: [{indexed:true,name:"basket",type:"address"},{indexed:true,name:"controller",type:"address"},{indexed:false,name:"assets",type:"address[]"},{indexed:false,name:"weightsBps",type:"uint16[]"}] },
  { type: "event", name: "ControllerTransferred", inputs: [{indexed:true,name:"basket",type:"address"},{indexed:true,name:"previousController",type:"address"},{indexed:true,name:"newController",type:"address"}] }
] as const;
export const USDC_DECIMALS = 6;
export const DEFAULT_TOKEN_DECIMALS = 18;

/**
 * Unified helper to convert human-readable amounts (e.g. "100", 100.5) to raw BigInt token amounts
 * given the token's decimal precision (e.g. 6 for USDC, 18 for standard ERC20s).
 */
export function toRawAmount(amount: string | number, decimals: number = 18): bigint {
  const str = String(amount ?? 0).trim();
  if (!str || str === '0' || isNaN(Number(str))) {
    return 0n;
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
  const isNegative = rawBigInt < 0n;
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

export * from "./portfolio.js";
