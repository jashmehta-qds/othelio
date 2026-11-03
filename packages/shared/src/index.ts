export { addressSchema, chainIdSchema } from "./primitives.js";
export {
  BASE_FORK_CHAIN_ID,
  BASE_MAINNET_CHAIN_ID,
  SUPPORTED_CHAIN_IDS,
  isSupportedChainId,
  networkKindForChainId,
} from "./networks.js";
export type {
  NetworkDeploymentAddresses,
  NetworkKind,
  SupportedChainId,
} from "./networks.js";
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

export const assetRegistryAbi = [
  { type: "function", name: "getSupportedTokens", stateMutability: "view", inputs: [{ name: "chainId", type: "uint256" }], outputs: [{ name: "", type: "address[]" }] },
  { type: "function", name: "getSupportedB20Tokens", stateMutability: "view", inputs: [{ name: "chainId", type: "uint256" }], outputs: [{ name: "", type: "address[]" }] },
  { type: "function", name: "isSupported", stateMutability: "view", inputs: [{ name: "chainId", type: "uint256" }, { name: "token", type: "address" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "getAsset", stateMutability: "view", inputs: [{ name: "chainId", type: "uint256" }, { name: "token", type: "address" }], outputs: [{ name: "", type: "tuple", components: [{ name: "supported", type: "bool" }, { name: "priceFeed", type: "address" }, { name: "tokenDecimals", type: "uint8" }, { name: "feedDecimals", type: "uint8" }, { name: "isCoinbaseB20", type: "bool" }] }] },
] as const;

export const tokenizedAssetConstantsAbi = [
  { type: "function", name: "getB20Tokens", stateMutability: "pure", inputs: [], outputs: [{ name: "tokens", type: "address[13]" }] },
  { type: "function", name: "AAPLc", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "AMZNc", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "COINc", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "CRCLc", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "GOOGLc", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "INTCc", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "METAc", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "MSFTc", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "MSTRc", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "NVDAc", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "SNDKc", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "SPCXc", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "TSLAc", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
] as const;

/**
 * 13 Coinbase B20 token addresses extracted directly from TokenizedAssetConstants.sol contract bytecode.
 */
export const CONTRACT_B20_TOKENS = [
  '0xb200000000000000000000C2e324d24d7eEcd1fb', // AAPLc
  '0xb200000000000000000000d9192b6B456483C2E8', // AMZNc
  '0xb200000000000000000000c85a31389D71F3ecfb', // COINc
  '0xB20000000000000000000019f6E7C675b73C2e4D', // CRCLc
  '0xb2000000000000000000002D0BA3164cc74f58B7', // GOOGLc
  '0xB2000000000000000000004AFF16039bA04bdFBc', // INTCc
  '0xb2000000000000000000008bC8786B856E61707C', // METAc
  '0xB200000000000000000000Ab99cFa739E253872B', // MSFTc
  '0xb2000000000000000000004884b426556b92883d', // MSTRc
  '0xb20000000000000000000078ee7ce2fE4908108C', // NVDAc
  '0xb200000000000000000000397293Cb8cda9a10c5', // SNDKc
  '0xb2000000000000000000007b9fcbd005511aCBd5', // SPCXc
  '0xb2000000000000000000001e800a7f5189430cD0', // TSLAc
] as const;

/**
 * Initial Base launch subset. These assets have a reviewed, executable USDC
 * route in the pinned Aerodrome Slipstream V3 deployment.
 */
export const BASE_LAUNCH_B20_TOKENS = [
  CONTRACT_B20_TOKENS[0], // AAPLc
  CONTRACT_B20_TOKENS[1], // AMZNc
  CONTRACT_B20_TOKENS[4], // GOOGLc
  CONTRACT_B20_TOKENS[6], // METAc
  CONTRACT_B20_TOKENS[7], // MSFTc
  CONTRACT_B20_TOKENS[8], // MSTRc
  CONTRACT_B20_TOKENS[9], // NVDAc
  CONTRACT_B20_TOKENS[10], // SNDKc
  CONTRACT_B20_TOKENS[11], // SPCXc
  CONTRACT_B20_TOKENS[12], // TSLAc
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

export * from "./portfolio.js";
export * from "./risksplit/venue.js";
export * from "./risksplit/contracts.js";
export * from "./admin/types.js";

