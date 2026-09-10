export interface SwapQuoteParams {
  chainId: number;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  takerAddress: string;
  slippageBps: number;
}

export interface SwapQuoteResult {
  providerName: '0x' | '1inch' | 'Aerodrome' | 'UniswapV3' | 'Fallback';
  chainId: number;
  sellToken: string;
  buyToken: string;
  sellAmount: bigint;
  routerAddress: string;
  allowanceSpender: string;
  recipientAddress: string;
  dexCalldata: string;
  expectedBuyAmount: bigint;
  minBuyAmount: bigint;
  expiresAt: string;
  estimatedGasUsd: number;
  netBuyAmountUsd: number;
  isAvailable: boolean;
  rawResponse?: unknown;
}

export interface IDexAdapter {
  readonly name: '0x' | '1inch' | 'Aerodrome' | 'UniswapV3' | 'Fallback';
  readonly supportedChainIds: number[];
  getQuote(params: SwapQuoteParams): Promise<SwapQuoteResult | null>;
}
