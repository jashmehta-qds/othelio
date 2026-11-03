import { ZeroExLimitOrder, ZeroExSignature } from '@othelio/shared';

export interface OrderBookLevel {
  priceUsd: string;
  rawPriceE6: string;
  amountClaim: string;
  totalClaim: string;
  orderCount: number;
}

export interface OrderBookTrade {
  id: string;
  orderHash: string;
  side: 'BUY' | 'SELL';
  amountClaim: string;
  amountUsdc: string;
  priceUsd: string;
  txHash: string | null;
  occurredAt: string;
}

export interface OrderBookDepth {
  seriesAddress: string;
  claimType: 'PROTECTED' | 'UPSIDE';
  claimToken: string;
  quoteToken: string;
  sequence: number;
  asOfBlock: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  recentTrades: OrderBookTrade[];
}

export interface CreateOrderRequest {
  order: ZeroExLimitOrder;
  signature: ZeroExSignature;
  chainId: number;
  seriesAddress: string;
  claimType: 'PROTECTED' | 'UPSIDE';
}

export interface BuildFillTxRequest {
  takerTokenFillAmount: string;
  takerAddress: string;
}

export interface StoredOrderModel {
  orderHash: string;
  chainId: number;
  seriesAddress: string;
  claimType: 'PROTECTED' | 'UPSIDE';
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
  signature: ZeroExSignature;
  orderStatus: string;
  isLocallyHidden: boolean;
  createdAt: string;
  updatedAt: string;
}
