import { assetRegistryAbi, BASE_MAINNET_CHAIN_ID, TOKEN_FEED_REGISTRY } from '@othelio/shared';
import { getAddress, isAddress, parseAbi, zeroAddress, type Address, type PublicClient } from 'viem';
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

const labelsAbi = parseAbi(['function symbol() view returns (string)', 'function name() view returns (string)']);

export async function describeReviewedB20(
  chainId: number,
  tokenAddress: Address,
  feedAddress: Address,
  client: PublicClient | null,
  registry: Address | null,
  metadata?: CoinbaseTokenMetadata,
) {
  const feedDecimals = 8;
  const asset = client && registry ? await client.readContract({
    address: registry, abi: assetRegistryAbi, functionName: 'getAsset', args: [BigInt(chainId), tokenAddress],
  }).catch(() => null) : null;
  const enabled = asset?.supported && asset.isCoinbaseB20 && asset.priceFeed.toLowerCase() === feedAddress.toLowerCase()
    && asset.feedDecimals === feedDecimals && asset.tokenDecimals <= 18 ? asset : null;
  const tokenDecimals = enabled?.tokenDecimals ?? metadata?.decimals;
  if (tokenDecimals === undefined) return null;

  const [symbol, name] = metadata ? [metadata.symbol, metadata.name] : await Promise.all([
    client?.readContract({ address: tokenAddress, abi: labelsAbi, functionName: 'symbol' }).catch(() => null),
    client?.readContract({ address: tokenAddress, abi: labelsAbi, functionName: 'name' }).catch(() => null),
  ]);
  return {
    tokenAddress, feedAddress, feedDecimals,
    symbol: symbol || tokenAddress, name: name || symbol || tokenAddress,
    tokenDecimals,
    registryEnabled: enabled !== null,
  };
}
