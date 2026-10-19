import { Logger } from '@nestjs/common';
import { z } from 'zod';

const tokenSchema = z.object({
  contract_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  symbol: z.string().min(1),
  name: z.string().min(1),
  decimals: z.number().int().min(0).max(255),
  isin: z.string().nullish(),
  description: z.string().nullish(),
  icon_url: z.string().url().nullish(),
  multiplier: z.number().finite().nullish(),
  first_mint_date: z.string().datetime().nullish(),
  total_supply: z.union([z.number().finite(), z.string()]).nullish(),
  nav_price: z.union([z.number().finite(), z.string()]).nullish(),
  nav_price_updated_at: z.string().datetime().nullish(),
});

const pageSchema = z.object({
  tokens: z.array(z.unknown()),
  next_page_token: z.string().nullish(),
});

export type CoinbaseTokenMetadata = {
  symbol: string;
  name: string;
  decimals: number;
  isin: string | null;
  description: string | null;
  iconUrl: string | null;
  multiplier: string | null;
  firstMintDate: string | null;
  totalSupply: string | null;
  navPrice: string | null;
  navPriceUpdatedAt: string | null;
};

/** Best-effort, process-local snapshot. Never used as a trading price or eligibility source. */
export class CoinbaseTokenMetadataService {
  private readonly logger = new Logger(CoinbaseTokenMetadataService.name);
  private snapshot = new Map<string, CoinbaseTokenMetadata>();
  private expiresAt = 0;
  private pending: Promise<Map<string, CoinbaseTokenMetadata>> | null = null;

  async getAll(): Promise<Map<string, CoinbaseTokenMetadata>> {
    if (Date.now() < this.expiresAt) return this.snapshot;
    if (this.pending) return this.pending;
    this.pending = this.refresh().finally(() => { this.pending = null; });
    return this.pending;
  }

  private async refresh(): Promise<Map<string, CoinbaseTokenMetadata>> {
    try {
      const next = new Map<string, CoinbaseTokenMetadata>();
      const seenCursors = new Set<string>();
      let cursor: string | null = null;
      for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
        const url = new URL('https://api.coinbase.com/v1/tokenized-stocks');
        url.searchParams.set('page_size', '250');
        if (cursor) url.searchParams.set('page_token', cursor);
        const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
        if (!response.ok) throw new Error(`Coinbase metadata HTTP ${response.status}`);
        const page = pageSchema.parse(await response.json());
        for (const value of page.tokens) {
          const parsed = tokenSchema.safeParse(value);
          if (!parsed.success) continue;
          const token = parsed.data;
          next.set(token.contract_address.toLowerCase(), {
            symbol: token.symbol,
            name: token.name,
            decimals: token.decimals,
            isin: token.isin ?? null,
            description: token.description ?? null,
            iconUrl: token.icon_url ?? null,
            multiplier: token.multiplier == null ? null : String(token.multiplier),
            firstMintDate: token.first_mint_date ?? null,
            totalSupply: token.total_supply == null ? null : String(token.total_supply),
            navPrice: token.nav_price == null ? null : String(token.nav_price),
            navPriceUpdatedAt: token.nav_price_updated_at ?? null,
          });
        }
        cursor = page.next_page_token ?? null;
        if (!cursor) {
          this.snapshot = next;
          this.expiresAt = Date.now() + 10 * 60_000;
          return this.snapshot;
        }
        if (seenCursors.has(cursor)) throw new Error('Coinbase metadata pagination loop');
        seenCursors.add(cursor);
      }
      throw new Error('Coinbase metadata exceeded pagination limit');
    } catch (error) {
      this.logger.warn(`Coinbase metadata refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      this.expiresAt = Date.now() + 60_000;
      return this.snapshot;
    }
  }
}
