import { Injectable } from '@nestjs/common';
import { IDexAdapter, SwapQuoteParams, SwapQuoteResult } from '../interfaces/dex-adapter.interface';

@Injectable()
export class FallbackAdapter implements IDexAdapter {
  readonly name = 'Fallback' as const;
  readonly supportedChainIds = [31337, 8453, 84532, 1];

  async getQuote(_params: SwapQuoteParams): Promise<SwapQuoteResult | null> {
    // Price estimates are useful for display, but fabricated router calldata is
    // never an executable quote. Callers must surface route unavailability.
    return null;
  }
}
