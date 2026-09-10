export interface LendingQuoteParams {
  chainId: number;
  action: 'SUPPLY' | 'BORROW' | 'REINVEST' | 'REPAY' | 'WITHDRAW';
  assetAddress: string;
  amount: string;
  safeAddress: string;
  protocol?: string;
  marketAddress?: string;
}

export interface LendingQuoteResult {
  providerName: string;
  targetPool: string;
  action: 'SUPPLY' | 'BORROW' | 'REINVEST' | 'REPAY' | 'WITHDRAW';
  calldata: string;
  assetAddress: string;
  amount: string;
  supplyApy: number;
  borrowApy: number;
  isAvailable: boolean;
}

export interface ILendingAdapter {
  readonly name: string;
  readonly supportedChainIds: number[];
  getQuote(params: LendingQuoteParams): Promise<LendingQuoteResult>;
}
