export const CONTRACT_ADDRESSES = {
  8453: {
    factory: '0xEB3001cF7E87dcCcb944088A4C90eBdA6ef84930' as `0x${string}`,
    module: '0xaF52e7D7a3aa70A33087406665d72b4249F6E550' as `0x${string}`,
    guard: '0xc58663959d51A10fb0404D4A71eD5144208dD09e' as `0x${string}`,
    oracle: '0x7bb773006fD109CdFc139c530AdA30bC024D8840' as `0x${string}`,
    registry: '0x59675EAF89150aA8732244986cA32982389a8c87' as `0x${string}`,
    coinbaseRegistry: '0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD' as `0x${string}`,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`,
  },
  84532: {
    factory: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    module: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    guard: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    oracle: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    registry: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    coinbaseRegistry: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as `0x${string}`,
  },
  31337: {
    factory: '0x3265d5204f6967C7AF1Fd74ca229D80Bba7ea47F' as `0x${string}`,
    module: '0x6C74A834F48f2f336ff367f3DC517D97C873D4CC' as `0x${string}`,
    guard: '0x0F77E8e097eBE24161439F05a282F39618869Cd5' as `0x${string}`,
    oracle: '0x7F453D9218bD894d25a531CEd22145c4D7d346F6' as `0x${string}`,
    registry: '0x560CC3C1afC967a1415B248449042F036Cf9eb3e' as `0x${string}`,
    coinbaseRegistry: '0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD' as `0x${string}`,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`,
  },
};

export const OTHELIO_BASKET_MODULE_ABI = [
  {
    inputs: [
      {
        components: [
          { name: 'safe', type: 'address' },
          { name: 'target', type: 'address' },
          { name: 'dexCalldata', type: 'bytes' },
          { name: 'soldAssets', type: 'address[]' },
          { name: 'boughtAssets', type: 'address[]' },
          { name: 'minBoughtAmounts', type: 'uint256[]' },
          { name: 'basketTokens', type: 'address[]' },
        ],
        name: 'p',
        type: 'tuple',
      },
    ],
    name: 'rebalance',
    outputs: [
      { name: 'soldAmounts', type: 'uint256[]' },
      { name: 'boughtAmounts', type: 'uint256[]' },
      { name: 'totalNAV', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { name: 'safe', type: 'address' },
          { name: 'inputAsset', type: 'address' },
          { name: 'inputAmount', type: 'uint256' },
          { name: 'target', type: 'address' },
          { name: 'dexCalldata', type: 'bytes' },
          { name: 'boughtAssets', type: 'address[]' },
          { name: 'minBoughtAmounts', type: 'uint256[]' },
          { name: 'basketTokens', type: 'address[]' },
        ],
        name: 'p',
        type: 'tuple',
      },
    ],
    name: 'fundWithSwaps',
    outputs: [
      { name: 'boughtAmounts', type: 'uint256[]' },
      { name: 'totalNAV', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'safe', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'tokens', type: 'address[]' },
      { name: 'amounts', type: 'uint256[]' },
      { name: 'remainingTokens', type: 'address[]' },
    ],
    name: 'withdrawInKind',
    outputs: [{ name: 'remainingNAV', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

export const OTHELIO_FACTORY_ABI = [
  {
    inputs: [{ name: 'name', type: 'string' }],
    name: 'createBasket',
    outputs: [{ name: 'basket', type: 'address' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'safe', type: 'address' },
      { name: 'owner', type: 'address' },
      { name: 'name', type: 'string' },
    ],
    name: 'registerBasket',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'owner', type: 'address' }],
    name: 'basketsOf',
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;
