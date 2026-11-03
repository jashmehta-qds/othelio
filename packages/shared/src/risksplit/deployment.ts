// packages/shared/src/risksplit/deployment.ts
// Canonical Risk Split Base Deployment Manifest and Constants

export interface RiskSplitDeploymentManifest {
  chainId: number;
  networkName: string;
  factoryAddress: `0x${string}`;
  factoryOwner: `0x${string}`;
  settlementAdapterAddress: `0x${string}`;
  settlementFeedAddress: `0x${string}`;
  maxStalenessSeconds: number;
  underlyingTokenAddress: `0x${string}`;
  underlyingSymbol: string;
  underlyingDecimals: number;
  quoteTokenAddress: `0x${string}`;
  quoteSymbol: string;
  quoteDecimals: number;
  exchangeProxyAddress: `0x${string}`;
  pilotExposureCapUsdc: number;
  pilotExposureCapClaims: number;
}

export const BASE_MAINNET_RISKSPLIT_MANIFEST: RiskSplitDeploymentManifest = {
  chainId: 8453,
  networkName: 'Base Mainnet',
  factoryAddress: '0x0000000000000000000000000000000000000000', // Pinned upon broadcast
  factoryOwner: '0x0000000000000000000000000000000000000000', // Deployer wallet
  settlementAdapterAddress: '0x0000000000000000000000000000000000000000', // Pinned upon broadcast
  settlementFeedAddress: '0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c', // MSFT/USD Chainlink Feed on Base
  maxStalenessSeconds: 86400, // 24 hours
  underlyingTokenAddress: '0xB200000000000000000000Ab99cFa739E253872B', // Coinbase B20 MSFTc on Base
  underlyingSymbol: 'MSFTc',
  underlyingDecimals: 8,
  quoteTokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Native USDC on Base
  quoteSymbol: 'USDC',
  quoteDecimals: 6,
  exchangeProxyAddress: '0xDef1C0ded9bec7F1a1670819833240f027b25EfF', // 0x v4 ExchangeProxy on Base
  pilotExposureCapUsdc: 5000,
  pilotExposureCapClaims: 50,
};
