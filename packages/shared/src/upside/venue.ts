// packages/shared/src/upside/venue.ts
// 0x Protocol Limit Order Venue & Sweep Execution Types for Stock Upside Markets

export interface UpsideLimitOrder {
  makerToken: `0x${string}`;
  takerToken: `0x${string}`;
  makerAmount: string;
  takerAmount: string;
  maker: `0x${string}`;
  taker: `0x${string}`;
  pool: `0x${string}`;
  expiry: string;
  salt: string;
  feeRecipient: `0x${string}`;
  takerTokenFeeAmount: string;
  sender: `0x${string}`;
}

export interface UpsideSignature {
  signatureType: number; // 2 = EIP712
  v: number;
  r: `0x${string}`;
  s: `0x${string}`;
}

export interface SignedUpsideLimitOrder {
  order: UpsideLimitOrder;
  signature: UpsideSignature;
  orderHash: `0x${string}`;
  chainId: number;
  seriesAddress: `0x${string}`;
  claimType: 'UPSIDE' | 'RESIDUAL';
  side: 'BUY' | 'SELL';
  priceUsdc: number;
  remainingMakerAmount: string;
  remainingTakerAmount: string;
  fillableClaimUnits: string;
  orderStatus: 'FILLABLE' | 'FILLED' | 'CANCELLED' | 'EXPIRED';
  createdAt: string;
}

export interface UpsideSweepQuoteLevel {
  orderHash: `0x${string}`;
  maker: `0x${string}`;
  unitPriceUsdc: number;
  claimUnits: string;
  usdcCost: string;
}

export interface UpsideSweepQuoteRequest {
  seriesAddress: `0x${string}`;
  claimType: 'UPSIDE' | 'RESIDUAL';
  side: 'BUY' | 'SELL'; // BUY sweeps asks; SELL sweeps bids
  requestedUnits: string;
  takerAddress: `0x${string}`;
  maxSlippageBps?: number;
}

export interface UpsideSweepQuoteResponse {
  seriesAddress: `0x${string}`;
  claimType: 'UPSIDE' | 'RESIDUAL';
  side: 'BUY' | 'SELL';
  requestedUnits: string;
  executableUnits: string;
  totalCostUsdc: string;
  averagePriceUsdc: number;
  levels: UpsideSweepQuoteLevel[];
  quoteExpiry: number;
  bookSequence: number;
  orders: UpsideLimitOrder[];
  signatures: UpsideSignature[];
  takerTokenFillAmounts: string[];
  revertIfIncomplete: boolean;
  transactionData?: `0x${string}`;
  to?: `0x${string}`;
  value?: string;
}
