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

export const UPSIDE_BATCH_FILL_ROUTER_ABI = [
  {
    type: 'function',
    name: 'batchFillLimitOrders',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'orders',
        type: 'tuple[]',
        components: [
          { name: 'makerToken', type: 'address' },
          { name: 'takerToken', type: 'address' },
          { name: 'makerAmount', type: 'uint128' },
          { name: 'takerAmount', type: 'uint128' },
          { name: 'takerTokenFeeAmount', type: 'uint128' },
          { name: 'maker', type: 'address' },
          { name: 'taker', type: 'address' },
          { name: 'sender', type: 'address' },
          { name: 'feeRecipient', type: 'address' },
          { name: 'pool', type: 'bytes32' },
          { name: 'expiry', type: 'uint64' },
          { name: 'salt', type: 'uint256' },
        ],
      },
      {
        name: 'signatures',
        type: 'tuple[]',
        components: [
          { name: 'signatureType', type: 'uint8' },
          { name: 'v', type: 'uint8' },
          { name: 'r', type: 'bytes32' },
          { name: 's', type: 'bytes32' },
        ],
      },
      { name: 'takerTokenFillAmounts', type: 'uint128[]' },
      { name: 'revertIfIncomplete', type: 'bool' },
    ],
    outputs: [
      { name: 'takerTokenFilledAmounts', type: 'uint128[]' },
      { name: 'makerTokenFilledAmounts', type: 'uint128[]' },
    ],
  },
] as const;

export function buildBatchFillLimitOrdersTx(
  routerAddress: `0x${string}`,
  orders: UpsideLimitOrder[],
  signatures: UpsideSignature[],
  takerTokenFillAmounts: bigint[],
  revertIfIncomplete = true,
) {
  return {
    to: routerAddress,
    data: {
      abi: UPSIDE_BATCH_FILL_ROUTER_ABI,
      functionName: 'batchFillLimitOrders',
      args: [orders, signatures, takerTokenFillAmounts, revertIfIncomplete],
    },
  };
}
