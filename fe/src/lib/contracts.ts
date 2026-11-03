import { BASE_FORK_CHAIN_ID, BASE_MAINNET_CHAIN_ID } from '@othelio/shared';

type BaseDeploymentAddresses = {
  factory?: string;
  module?: string;
  oracle?: string;
  registry?: string;
};

function requireBaseDeploymentAddress(value: string | undefined, name: string): `0x${string}` {
  if (!value) {
    throw new Error(`${name} must be configured for the Base deployment.`);
  }
  return value as `0x${string}`;
}

export function getBaseDeploymentAddresses(values: BaseDeploymentAddresses) {
  return {
    factory: requireBaseDeploymentAddress(values.factory, 'NEXT_PUBLIC_FACTORY_ADDRESS'),
    module: requireBaseDeploymentAddress(values.module, 'NEXT_PUBLIC_MODULE_ADDRESS'),
    oracle: requireBaseDeploymentAddress(values.oracle, 'NEXT_PUBLIC_ORACLE_ADDRESS'),
    registry: requireBaseDeploymentAddress(values.registry, 'NEXT_PUBLIC_ASSET_REGISTRY_ADDRESS'),
  };
}

const baseDeploymentAddresses = getBaseDeploymentAddresses({
  // Keep these references statically named so Next.js inlines them in the client bundle.
  factory: process.env.NEXT_PUBLIC_FACTORY_ADDRESS || '0xAd21D1aACF2B3c84608e69eAa87B798d27A3915D',
  module: process.env.NEXT_PUBLIC_MODULE_ADDRESS || '0x245836a679b69e16617e2055d8d809EA5858c81C',
  oracle: process.env.NEXT_PUBLIC_ORACLE_ADDRESS || '0xF80bfa9608dD9BCBC7ed270Fa341C7C423CA2DF7',
  registry: process.env.NEXT_PUBLIC_ASSET_REGISTRY_ADDRESS || '0x3DB84b8e172A2b8b1634F8C630C6e2acD07424AC',
});

const forkDeploymentAddresses = getBaseDeploymentAddresses({
  factory: process.env.NEXT_PUBLIC_FORK_FACTORY_ADDRESS || process.env.NEXT_PUBLIC_FACTORY_ADDRESS,
  module: process.env.NEXT_PUBLIC_FORK_MODULE_ADDRESS || process.env.NEXT_PUBLIC_MODULE_ADDRESS,
  oracle: process.env.NEXT_PUBLIC_FORK_ORACLE_ADDRESS || process.env.NEXT_PUBLIC_ORACLE_ADDRESS,
  registry: process.env.NEXT_PUBLIC_FORK_ASSET_REGISTRY_ADDRESS || process.env.NEXT_PUBLIC_ASSET_REGISTRY_ADDRESS,
});

export const CONTRACT_ADDRESSES = {
  [BASE_MAINNET_CHAIN_ID]: {
    ...baseDeploymentAddresses,
    coinbaseRegistry: baseDeploymentAddresses.registry,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`,
  },
  [BASE_FORK_CHAIN_ID]: {
    ...forkDeploymentAddresses,
    coinbaseRegistry: forkDeploymentAddresses.registry,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`,
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
    outputs: [{ name: 'remainingListedAssetsNavUsdc', type: 'uint256' }],
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
export const RISK_SPLIT_SERIES_ABI = [
  {
    type: 'function',
    name: 'underlying',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'protectedToken',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'upsideToken',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'floorPrice',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'capPrice',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'expiry',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isSettled',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'settledPrice',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'protectedFraction',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'upsideFraction',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'mint',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'combineAndRedeem',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'redeemProtected',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'redeemUpside',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'settleSeriesWithFixing',
    inputs: [{ name: 'roundId', type: 'uint80' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

export {
  ZERO_EX_EXCHANGE_PROXY_BASE,
  ZERO_EX_LIMIT_ORDER_ABI,
  seriesFactoryAbi,
} from '@othelio/shared';

export const SETTLEMENT_ADAPTER_ABI = [
  {
    type: 'function',
    name: 'settleSeries',
    inputs: [{ name: 'series', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'maxStaleness',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getSettlementPrice',
    inputs: [],
    outputs: [
      { name: 'price', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
    ],
    stateMutability: 'view',
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
