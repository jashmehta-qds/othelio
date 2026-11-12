import {
  UpsideLimitOrder,
  UpsideSignature,
  SignedUpsideLimitOrder,
  UpsideSweepQuoteRequest,
  UpsideSweepQuoteResponse,
  UpsideSweepQuoteLevel,
} from '@othelio/shared';

export interface UpsideOrderBookLevel {
  priceUsd: string;
  rawPriceE6: string;
  amountClaim: string;
  totalClaim: string;
  orderCount: number;
  orderHash?: string;
}

export interface UpsideOrderBookTrade {
  id: string;
  orderHash: string;
  claimType: 'UPSIDE' | 'RESIDUAL';
  side: 'BUY' | 'SELL';
  makerAddress: string;
  takerAddress: string;
  amountClaim: string;
  amountUsdc: string;
  priceUsd: string;
  txHash: string | null;
  occurredAt: string;
}

export interface UpsideOrderBookDepth {
  seriesAddress: string;
  claimType: 'UPSIDE' | 'RESIDUAL';
  claimToken: string;
  quoteToken: string;
  sequence: number;
  asOfBlock: number;
  bids: UpsideOrderBookLevel[];
  asks: UpsideOrderBookLevel[];
  recentTrades: UpsideOrderBookTrade[];
}

export interface CreateUpsideOrderDto {
  chainId: number;
  seriesAddress: string;
  claimType: 'UPSIDE' | 'RESIDUAL';
  order: UpsideLimitOrder;
  signature: UpsideSignature;
}

export interface UpsideStoredOrderModel {
  orderHash: string;
  chainId: number;
  seriesAddress: string;
  claimType: 'UPSIDE' | 'RESIDUAL';
  claimToken: string;
  quoteToken: string;
  side: 'BUY' | 'SELL';
  makerAddress: string;
  takerAddress: string;
  makerToken: string;
  takerToken: string;
  makerAmount: string;
  takerAmount: string;
  remainingMakerAmount: string;
  remainingTakerAmount: string;
  priceUsdE6: string;
  priceFormatted: string;
  expiryTimestamp: number;
  salt: string;
  verifyingContract: string;
  signature: UpsideSignature;
  orderStatus: string;
  isLocallyHidden: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpsideCancelIntentResponse {
  orderHash: string;
  status: 'LOCALLY_HIDDEN';
  cancelTransactionData: {
    to: string;
    data: any;
  };
}
