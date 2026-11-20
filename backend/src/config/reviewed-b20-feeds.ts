import { BASE_MAINNET_CHAIN_ID, TOKEN_FEED_REGISTRY } from '@othelio/shared';
import { getAddress, isAddress, zeroAddress, type Address } from 'viem';
import type { CoinbaseTokenMetadata } from '../baskets/coinbase-token-metadata.service';

export function reviewedB20FeedAdditions(chainId: number): Map<string, Address> {
  const entries = new Map<string, Address>();
  const raw = process.env.B20_REVIEWED_FEEDS_JSON;
  if (chainId !== BASE_MAINNET_CHAIN_ID || !raw) return entries;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('B20_REVIEWED_FEEDS_JSON must map Base token addresses to reviewed feed addresses.');
  }
  const existing = new Set(Object.values(TOKEN_FEED_REGISTRY).map((asset) => asset.tokenAddress.toLowerCase()));
  for (const [token, feed] of Object.entries(parsed)) {
    if (!isAddress(token) || typeof feed !== 'string' || !isAddress(feed) || feed.toLowerCase() === zeroAddress ||
        token.toLowerCase() === zeroAddress || existing.has(token.toLowerCase()) || entries.has(token.toLowerCase())) {
      throw new Error('Invalid or duplicate reviewed Base B20 token/feed pair.');
    }
    entries.set(token.toLowerCase(), getAddress(feed));
  }
  return entries;
}

export function reviewedB20Additions(chainId: number, metadata: Map<string, CoinbaseTokenMetadata>) {
  return Array.from(reviewedB20FeedAdditions(chainId)).flatMap(([token, feedAddress]) => {
    const asset = metadata.get(token);
    return asset ? [{
      tokenAddress: getAddress(token), feedAddress, symbol: asset.symbol, name: asset.name,
      tokenDecimals: asset.decimals, feedDecimals: 8,
    }] : [];
  });
}
