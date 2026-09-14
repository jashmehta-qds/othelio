export const CONTRACT_ADDRESSES = {
  8453: {
    factory: '0xEB3001cF7E87dcCcb944088A4C90eBdA6ef84930' as `0x${string}`,
    module: '0xaF52e7D7a3aa70A33087406665d72b4249F6E550' as `0x${string}`,
    oracle: '0x7bb773006fD109CdFc139c530AdA30bC024D8840' as `0x${string}`,
    registry: '0x59675EAF89150aA8732244986cA32982389a8c87' as `0x${string}`,
    coinbaseRegistry: '0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD' as `0x${string}`,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`,
  },
  84532: {
    factory: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    module: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    oracle: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    registry: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    coinbaseRegistry: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as `0x${string}`,
  },
  31337: {
    factory: '0x21efb0c4fdA036F670A6a2b05b9Cb3bc3FbE006d' as `0x${string}`,
    module: '0x49d7AF0c0A242Ca8178f00cE9dc5800C97d9579F' as `0x${string}`,
    oracle: '0x23D4ae48A1434dA63Cf97efEc10CB6cf2d8b0229' as `0x${string}`,
    registry: '0x36065592975f6CfBE171e57E6743ef2F6FaD0eDc' as `0x${string}`,
    coinbaseRegistry: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`,
    dexRouter: '0xBD606f1dAE0285D55113eFC11501677B2221A4dd' as `0x${string}`,
    aaveAdapter: '0xeb354b33171Ca5072038bCf7d808E6F527BCB15f' as `0x${string}`,
    aerodromeAdapter: '0x21163F943b3b1721af829e95E13BcCBE42D2cC8E' as `0x${string}`,
  },
} as const;

/** Aave reads and typed recovery calls are wired, but product actions stay off until launch review. */
export const AAVE_UI_ENABLED = false;

export const OTHELIO_PORTFOLIO_MODULE_ABI = [
  {
    type: 'function',
    name: 'supplyAave',
    inputs: [
      { name: 'safe', type: 'address' },
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'repayAave',
    inputs: [
      { name: 'safe', type: 'address' },
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'repaid', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'repayAaveFromWallet',
    inputs: [
      { name: 'safe', type: 'address' },
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'repaid', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'withdrawAaveCollateral',
    inputs: [
      { name: 'safe', type: 'address' },
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'minHealthFactor', type: 'uint256' },
    ],
    outputs: [{ name: 'withdrawn', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'fundAerodromePortfolio',
    inputs: [
      { name: 'safe', type: 'address' },
      { name: 'fundingToken', type: 'address' },
      { name: 'totalFundingAmount', type: 'uint256' },
      {
        name: 'routes',
        type: 'tuple[]',
        components: [
          { name: 'kind', type: 'uint8' },
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'firstTickSpacing', type: 'int24' },
          { name: 'secondTickSpacing', type: 'int24' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'minimumAmountOut', type: 'uint256' },
        ],
      },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'rebalanceAerodromePortfolio',
    inputs: [
      { name: 'safe', type: 'address' },
      {
        name: 'routes',
        type: 'tuple[]',
        components: [
          { name: 'kind', type: 'uint8' },
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'firstTickSpacing', type: 'int24' },
          { name: 'secondTickSpacing', type: 'int24' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'minimumAmountOut', type: 'uint256' },
        ],
      },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'approvedDexRoutes',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'allowanceSpender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'withdrawInKind',
    inputs: [
      { name: 'safe', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'tokens', type: 'address[]' },
      { name: 'amounts', type: 'uint256[]' },
      { name: 'remainingTokens', type: 'address[]' },
    ],
    outputs: [{ name: 'remainingNAV', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'enforcesPortfolioOnly',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'supportsBoundedExecution',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'moduleVersion',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'pure',
  },
] as const;

export const OTHELIO_FACTORY_ABI = [
  {
    type: 'function',
    name: 'createBasket',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ name: 'basket', type: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'registerBasket',
    inputs: [
      { name: 'safe', type: 'address' },
      { name: 'owner', type: 'address' },
      { name: 'name', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'basketsOf',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isOthelioBasket',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
] as const;
