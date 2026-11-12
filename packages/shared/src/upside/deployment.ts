// packages/shared/src/upside/deployment.ts
// Deployment Manifest and Deployment Configurations for Stock Upside Markets

export interface UpsideDeploymentManifest {
  chainId: number;
  networkName: string;
  factoryAddress: `0x${string}`;
  factoryOwner: `0x${string}`;
  assetRegistryAddress: `0x${string}`;
  fixingAdapters: Record<string, `0x${string}`>;
  quoteTokenAddress: `0x${string}`; // USDC
  quoteSymbol: string;
  quoteDecimals: number;
  exchangeProxyAddress: `0x${string}`; // 0x v4 ExchangeProxy
  factoryDeploymentBlock: number;
  deploymentTransaction?: `0x${string}`;
}

export const BASE_MAINNET_REGISTRY = '0x3DB84b8e172A2b8b1634F8C630C6e2acD07424AC' as const;

export const BASE_MAINNET_UPSIDE_TEMPLATE: UpsideDeploymentManifest = {
  chainId: 8453,
  networkName: 'Base Mainnet',
  factoryAddress: '0x0000000000000000000000000000000000000000',
  factoryOwner: '0xECCEc5B076D97d455Ce9416012876BdACC97939a',
  assetRegistryAddress: '0x3DB84b8e172A2b8b1634F8C630C6e2acD07424AC',
  fixingAdapters: {
    MSFTc: '0x0000000000000000000000000000000000000000',
  },
  quoteTokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  quoteSymbol: 'USDC',
  quoteDecimals: 6,
  exchangeProxyAddress: '0xDef1C0ded9bec7F1a1670819833240f027b25EfF',
  factoryDeploymentBlock: 0,
};
