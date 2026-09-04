export const CONTRACT_ADDRESSES = {
  8453: {
    factory: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    module: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    guard: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    oracle: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    registry: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    coinbaseRegistry: '0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD' as `0x${string}`,
  },
  84532: {
    factory: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    module: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    guard: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    oracle: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    registry: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    coinbaseRegistry: '0x0000000000000000000000000000000000000000' as `0x${string}`,
  },
  31337: {
    factory: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9' as `0x${string}`,
    module: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0' as `0x${string}`,
    guard: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9' as `0x${string}`,
    oracle: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512' as `0x${string}`,
    registry: '0x5FbDB2315678afecb367f032d93F642f64180aa3' as `0x${string}`,
    coinbaseRegistry: '0x0000000000000000000000000000000000000000' as `0x${string}`,
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
