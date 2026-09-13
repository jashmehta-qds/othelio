export interface SwapQuoteParams {
  chainId: number;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  takerAddress: string;
  slippageBps: number;
}

export type AerodromeRouteKind = 'DIRECT' | 'VIA_USDC';

export interface SwapQuoteResult {
  providerName: 'Aerodrome';
  kind: AerodromeRouteKind;
  chainId: number;
  sellToken: string;
  buyToken: string;
  sellAmount: bigint;
  routerAddress: string;
  allowanceSpender: string;
  recipientAddress: string;
  tickSpacing: number;
  firstTickSpacing: number;
  secondTickSpacing: number;
  expectedBuyAmount: bigint;
  minBuyAmount: bigint;
  expiresAt: string;
  estimatedGasUsd: number;
  netBuyAmountUsd: number;
  isAvailable: boolean;
  rawResponse?: unknown;
}

export interface IDexAdapter {
  readonly name: 'Aerodrome';
  readonly supportedChainIds: number[];
  getQuote(params: SwapQuoteParams): Promise<SwapQuoteResult | null>;
}
