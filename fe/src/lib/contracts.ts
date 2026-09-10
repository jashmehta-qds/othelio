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
    factory: '0x278f041B5Cd23BF69A58FA4A2b4e0072A8B4C109' as `0x${string}`,
    module: '0x5243bd0cd5eaf0fd370adfb30f2febf86d97d534' as `0x${string}`,
    guard: '0x529a992D845557798b7b17646126bd055C654916' as `0x${string}`,
    oracle: '0x542a75D03Ae9968f6f23E8Cb61Bc1877fb47535d' as `0x${string}`,
    registry: '0x079D2B33B99a7c1E532e244f4E14cd56cE601f70' as `0x${string}`,
    coinbaseRegistry: '0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD' as `0x${string}`,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`,
    dexRouter: '0x5faCB5c3a89348Ca89D67559Aa5260c1592C06A9' as `0x${string}`,
    borrowModule: '0xc44435F30e6bAd705136c5E252BA605aA9AdD853' as `0x${string}`,
  },
};

export const OTHELIO_BASKET_MODULE_ABI = [
  {
    inputs: [
      {
        components: [
          { name: 'safe', type: 'address' },
          {
            name: 'legs',
            type: 'tuple[]',
            components: [
              { name: 'target', type: 'address' },
              { name: 'allowanceSpender', type: 'address' },
              { name: 'soldAsset', type: 'address' },
              { name: 'maxSoldAmount', type: 'uint256' },
              { name: 'dexCalldata', type: 'bytes' },
            ],
          },
          { name: 'soldAssets', type: 'address[]' },
          { name: 'maxSoldAmounts', type: 'uint256[]' },
          { name: 'boughtAssets', type: 'address[]' },
          { name: 'minBoughtAmounts', type: 'uint256[]' },
          { name: 'basketTokens', type: 'address[]' },
          { name: 'deadline', type: 'uint256' },
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
          {
            name: 'legs',
            type: 'tuple[]',
            components: [
              { name: 'target', type: 'address' },
              { name: 'allowanceSpender', type: 'address' },
              { name: 'inputAmount', type: 'uint256' },
              { name: 'dexCalldata', type: 'bytes' },
            ],
          },
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
      {
        components: [
          { name: 'safe', type: 'address' },
          { name: 'recipient', type: 'address' },
          { name: 'outAsset', type: 'address' },
          { name: 'minOutAssetAmount', type: 'uint256' },
          { name: 'target', type: 'address' },
          { name: 'allowanceSpender', type: 'address' },
          { name: 'dexCalldata', type: 'bytes' },
          { name: 'soldAssets', type: 'address[]' },
          { name: 'maxSoldAmounts', type: 'uint256[]' },
          { name: 'remainingTokens', type: 'address[]' },
          { name: 'deadline', type: 'uint256' },
        ],
        name: 'p',
        type: 'tuple',
      },
    ],
    name: 'withdrawWithSwaps',
    outputs: [
      { name: 'outAmount', type: 'uint256' },
      { name: 'remainingNAV', type: 'uint256' },
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
  {
    inputs: [
      { name: 'safe', type: 'address' },
      { name: 'aavePool', type: 'address' },
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'supplyToAave',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'safe', type: 'address' },
      { name: 'aavePool', type: 'address' },
      { name: 'debtAsset', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'borrowFromAave',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'safe', type: 'address' },
      { name: 'aavePool', type: 'address' },
      { name: 'debtAsset', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'repayAave',
    outputs: [],
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
      { name: 'name', type: 'string' },
      {
        components: [{ name: 'clientSalt', type: 'bytes32' }, { name: 'mint', type: 'tuple', components: [
          { name: 'safe', type: 'address' }, { name: 'inputAsset', type: 'address' }, { name: 'inputAmount', type: 'uint256' },
          { name: 'legs', type: 'tuple[]', components: [{ name: 'target', type: 'address' }, { name: 'allowanceSpender', type: 'address' }, { name: 'inputAmount', type: 'uint256' }, { name: 'dexCalldata', type: 'bytes' }] },
          { name: 'boughtAssets', type: 'address[]' }, { name: 'minBoughtAmounts', type: 'uint256[]' }, { name: 'basketTokens', type: 'address[]' }, { name: 'deadline', type: 'uint256' },
        ] }],
        name: 'p',
        type: 'tuple',
      },
    ],
    name: 'createAndSeedBasket',
    outputs: [
      { name: 'basket', type: 'address' },
      { name: 'boughtAmounts', type: 'uint256[]' },
      { name: 'totalNAV', type: 'uint256' },
    ],
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
