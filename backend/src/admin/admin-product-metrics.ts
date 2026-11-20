import { AdminProductMetric, AdminSeriesMetric, assetRegistryAbi, TOKEN_FEED_REGISTRY } from '@othelio/shared';
import { createPublicClient, formatUnits, getAddress, http, isAddress } from 'viem';
import { DatabaseService } from '../database/database.service';
import { reviewedB20FeedAdditions } from '../config/reviewed-b20-feeds';
import { rpcUrlForChain } from '../config/network-runtime';
import { adminContracts } from './admin-deployment';

const marketProducts = {
  'Risk Split': {
    table: 'risk_split_series', events: 'risk_split_events', positions: 'risk_split_positions',
    firstClaim: 'protected_balance', secondClaim: 'upside_balance',
    pairExit: 'PAIR_REDEEMED', claimExits: "'PROTECTED_REDEEMED', 'UPSIDE_REDEEMED'",
    feed: 'm.creation_feed_address', joins: '',
  },
  Upside: {
    table: 'upside_markets', events: 'upside_events', positions: 'upside_positions',
    firstClaim: 'upside_balance', secondClaim: 'residual_balance',
    pairExit: 'PAIR_WITHDRAWN', claimExits: "'UPSIDE_REDEEMED', 'RESIDUAL_REDEEMED'",
    feed: 'r.feed_address', joins: 'JOIN upside_rounds r ON r.chain_id = m.chain_id AND r.round_id = m.round_id',
  },
} as const;

type MarketProduct = keyof typeof marketProducts;
const catalog = new Map(Object.values(TOKEN_FEED_REGISTRY).map((asset) => [asset.tokenAddress.toLowerCase(), asset]));
const dollarScale = 8;
const maxPriceAge = 24 * 60 * 60 * 1000;

interface MarketMetricRow {
  series_address: string;
  underlying_address: string;
  expected_feed: string | null;
  price_feed: string | null;
  price: string | null;
  feed_updated_at: Date | null;
  collateral_raw: string;
  missing_redemptions: number;
  holders: number;
  first_claim: string;
  second_claim: string;
}

export function valueIndexedCollateral(row: MarketMetricRow, now: number, reviewedDecimals?: number) {
  const collateral = BigInt(row.collateral_raw);
  if (collateral < 0n || row.missing_redemptions > 0) {
    return { collateral: null, usdE8: null, issue: 'Indexed collateral flows are incomplete.' };
  }
  if (collateral === 0n) return { collateral, usdE8: 0n, issue: null };
  const asset = catalog.get(row.underlying_address.toLowerCase());
  const feed = row.expected_feed?.toLowerCase() ?? asset?.feedAddress.toLowerCase();
  const priceTime = row.feed_updated_at ? +new Date(row.feed_updated_at) : NaN;
  const price = BigInt(row.price ?? 0);
  const decimals = asset?.tokenDecimals ?? reviewedDecimals;
  if (decimals === undefined || !feed || row.price_feed?.toLowerCase() !== feed || price <= 0n || !Number.isFinite(priceTime)) {
    return { collateral, usdE8: null, issue: 'Compatible indexed price or verified token decimals unavailable.' };
  }
  if (priceTime > now || now - priceTime > maxPriceAge) {
    return { collateral, usdE8: null, issue: 'Indexed oracle price is stale or future-dated.' };
  }
  return { collateral, usdE8: collateral * price / 10n ** BigInt(decimals), issue: null };
}

async function additionalTokenDecimals(chainId: number, rows: MarketMetricRow[]) {
  const decimals = new Map<string, number>();
  const assets = new Map<string, string>();
  for (const row of rows) {
    const address = row.underlying_address.toLowerCase();
    const feed = row.expected_feed?.toLowerCase();
    if (!catalog.has(address) && feed && isAddress(address) && row.price_feed?.toLowerCase() === feed &&
        BigInt(row.collateral_raw) > 0n) assets.set(address, feed);
  }
  if (!assets.size) return decimals;
  const { assetRegistry } = adminContracts(chainId);
  const rpcUrl = rpcUrlForChain(chainId);
  if (!assetRegistry || !rpcUrl) return decimals;
  const reviewed = reviewedB20FeedAdditions(chainId);
  const client = createPublicClient({ transport: http(rpcUrl, { timeout: 4000, retryCount: 0 }) });
  await Promise.all([...assets].map(async ([address, feed]) => {
    if (reviewed.get(address)?.toLowerCase() !== feed) return;
    const asset = await client.readContract({ address: assetRegistry, abi: assetRegistryAbi, functionName: 'getAsset',
      args: [BigInt(chainId), getAddress(address)] }).catch(() => null);
    if (asset?.isCoinbaseB20 && asset.priceFeed.toLowerCase() === feed && asset.feedDecimals === 8 &&
        asset.tokenDecimals > 0 && asset.tokenDecimals <= 18) decimals.set(address, asset.tokenDecimals);
  }));
  return decimals;
}

async function readMarketMetrics(db: DatabaseService, chainId: number, product: MarketProduct) {
  const source = marketProducts[product];
  return db.query<MarketMetricRow>(`
    WITH flows AS (
      SELECT series_address,
        COALESCE(SUM(CASE WHEN event_type = 'MINTED' THEN amount
          WHEN event_type = '${source.pairExit}' THEN -amount
          WHEN event_type IN (${source.claimExits}) THEN -underlying_amount END), 0) AS collateral_raw,
        COUNT(*) FILTER (WHERE event_type IN (${source.claimExits}) AND underlying_amount IS NULL)::int AS missing_redemptions
      FROM ${source.events} WHERE chain_id = $1 GROUP BY series_address
    ), holdings AS (
      SELECT series_address,
        COUNT(*) FILTER (WHERE ${source.firstClaim} > 0 OR ${source.secondClaim} > 0)::int AS holders,
        SUM(${source.firstClaim}) AS first_claim, SUM(${source.secondClaim}) AS second_claim
      FROM ${source.positions} WHERE chain_id = $1 GROUP BY series_address
    ), latest_prices AS (
      SELECT DISTINCT ON (asset_address) asset_address, feed_address, price_usd_e8, feed_updated_at
      FROM asset_price_observations WHERE chain_id = $1
      ORDER BY asset_address, block_number DESC
    )
    SELECT m.series_address, m.underlying_address, ${source.feed} AS expected_feed,
      p.feed_address AS price_feed, p.price_usd_e8::text AS price, p.feed_updated_at,
      COALESCE(f.collateral_raw, 0)::text AS collateral_raw, COALESCE(f.missing_redemptions, 0) AS missing_redemptions,
      COALESCE(h.holders, 0) AS holders, COALESCE(h.first_claim, 0)::text AS first_claim,
      COALESCE(h.second_claim, 0)::text AS second_claim
    FROM ${source.table} m ${source.joins}
    LEFT JOIN flows f ON f.series_address = m.series_address
    LEFT JOIN holdings h ON h.series_address = m.series_address
    LEFT JOIN latest_prices p ON p.asset_address = m.underlying_address
    WHERE m.chain_id = $1`, [chainId]);
}

async function indexerIssue(db: DatabaseService, chainId: number, product: AdminProductMetric['product']) {
  if (product === 'Risk Split' && ['false', '0'].includes(process.env.RISK_SPLIT_INDEXING_ENABLED ?? '')) {
    return 'Risk Split indexing is paused.';
  }
  const worker = product === 'Risk Split' ? 'risksplit' : product === 'Upside' ? 'upside' : 'events';
  const { rows: [state] } = await db.query<{ current: boolean }>(`
    SELECT head.observed_head_at BETWEEN NOW() - INTERVAL '10 minutes' AND NOW()
      AND head.observed_head_block - worker.last_success_block <= 50
      AND head.last_error IS NULL AND worker.last_error IS NULL AS current
    FROM indexer_worker_state head JOIN indexer_worker_state worker ON worker.chain_id = head.chain_id
    WHERE head.chain_id = $1 AND head.worker_name = 'events' AND worker.worker_name = $2`, [chainId, worker]);
  return state?.current ? null : 'Event indexer freshness is unavailable or lagging.';
}

export async function getIndexedSeriesMetrics(db: DatabaseService, chainId: number, product: MarketProduct) {
  const [{ rows }, issue] = await Promise.all([readMarketMetrics(db, chainId, product), indexerIssue(db, chainId, product)]);
  const now = Date.now();
  const decimals = issue ? new Map<string, number>() : await additionalTokenDecimals(chainId, rows);
  return new Map(rows.map((row): [string, AdminSeriesMetric] => {
    const value = valueIndexedCollateral(row, now, decimals.get(row.underlying_address.toLowerCase()));
    return [row.series_address, {
      holderWallets: row.holders, firstClaimBalanceRaw: row.first_claim, secondClaimBalanceRaw: row.second_claim,
      collateralRaw: value.collateral?.toString() ?? null,
      tvlUsd: !issue && value.usdE8 !== null ? formatUnits(value.usdE8, dollarScale) : null,
      valuationIssue: issue ?? value.issue,
    }];
  }));
}

async function getMarketProduct(db: DatabaseService, chainId: number, product: MarketProduct): Promise<AdminProductMetric> {
  const { positions } = marketProducts[product];
  const [{ rows }, wallets, indexIssue] = await Promise.all([
    readMarketMetrics(db, chainId, product),
    db.query<{ wallets: number }>(`SELECT COUNT(DISTINCT user_address)::int AS wallets
      FROM ${positions} WHERE chain_id = $1 AND user_address <> '0x0000000000000000000000000000000000000000'`, [chainId]),
    indexerIssue(db, chainId, product),
  ]);
  let tvl = 0n;
  let missing = 0;
  const now = Date.now();
  const decimals = indexIssue ? new Map<string, number>() : await additionalTokenDecimals(chainId, rows);
  for (const row of rows) {
    const value = valueIndexedCollateral(row, now, decimals.get(row.underlying_address.toLowerCase()));
    if (value.usdE8 === null) missing++;
    else tvl += value.usdE8;
  }
  const issue = indexIssue ?? (missing ? `No fresh, complete valuation for ${missing} indexed market(s).` : null);
  return { product, indexedWallets: wallets.rows[0]?.wallets ?? null,
    tvlUsd: issue ? null : formatUnits(tvl, dollarScale), valuationIssue: issue };
}

async function getBasketProduct(db: DatabaseService, chainId: number): Promise<AdminProductMetric> {
  const [nav, issue] = await Promise.all([
    db.query<{ wallets: number; tvl: string; missing: number }>(`
      WITH latest AS (
        SELECT DISTINCT ON (basket_address) basket_address, nav_usdc, valuation_status, block_timestamp
        FROM basket_nav_observations WHERE chain_id = $1
        ORDER BY basket_address, block_number DESC, observed_at DESC, kind
      )
      SELECT COALESCE(SUM(l.nav_usdc), 0)::text AS tvl,
        COUNT(*) FILTER (WHERE l.nav_usdc IS NULL OR l.valuation_status <> 'COMPLETE'
          OR l.block_timestamp NOT BETWEEN NOW() - INTERVAL '24 hours' AND NOW())::int AS missing,
        (SELECT COUNT(DISTINCT actor_address)::int FROM basket_events
          WHERE chain_id = $1 AND event_type IN ('CREATED', 'FUNDED', 'WITHDRAWN')) AS wallets
      FROM baskets b LEFT JOIN latest l ON l.basket_address = b.address WHERE b.chain_id = $1`, [chainId]),
    indexerIssue(db, chainId, 'Baskets'),
  ]);
  const row = nav.rows[0];
  const valuationIssue = issue ?? (!row || row.missing > 0 ? 'Latest basket NAV is stale or incomplete.' : null);
  return { product: 'Baskets', indexedWallets: row?.wallets ?? null,
    tvlUsd: valuationIssue ? null : row.tvl, valuationIssue };
}

export async function getIndexedProductMetrics(db: DatabaseService | undefined, chainId: number): Promise<AdminProductMetric[]> {
  return Promise.all((['Baskets', 'Risk Split', 'Upside'] as const).map(async (product) => {
    try {
      if (db) return await (product === 'Baskets' ? getBasketProduct(db, chainId) : getMarketProduct(db, chainId, product));
    } catch {
      // Keep other products and governance actions available during an indexer/database outage.
    }
    return { product, indexedWallets: null, tvlUsd: null, valuationIssue: 'Indexed data unavailable.' };
  }));
}
