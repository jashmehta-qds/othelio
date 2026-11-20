import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { addressSchema, assetRegistryAbi, chainIdSchema, CONTRACT_B20_TOKENS } from '@othelio/shared';
import { createPortfolioOnlyCapabilities, BasketDetail, BasketSummary, PortfolioOverview, Freshness, Holding, ActivityEvent, AssetCatalogItem, basketDetailSchema, basketSummarySchema, portfolioOverviewSchema, assetCatalogItemSchema, activityPageSchema } from '@othelio/shared';
import { DatabaseService } from '../database/database.service';
import { BasketQuotePlannerService, BasketQuoteRequest } from './basket-quote-planner.service';
import { LendingEventRequest, LendingEventService } from './lending-event.service';
import { CoinbaseTokenMetadataService } from './coinbase-token-metadata.service';
import { reviewedB20Additions } from '../config/reviewed-b20-feeds';
import { createPublicClient, getAddress, http, isAddress } from 'viem';
import { rpcUrlForChain } from '../config/network-runtime';
import { hasApprovedBasketRoute, resolveBasketRouteRegistry } from '../dex/basket-route-readiness';

@Injectable()
export class BasketsService {
  private readonly coinbaseMetadata = new CoinbaseTokenMetadataService();
  private readonly readCache = new Map<string, { expiresAt: number; value: unknown }>();
  private readonly readCacheTtlMs = 15_000;
  constructor(
    @Inject(DatabaseService)
    private readonly db: DatabaseService,
    @Inject(BasketQuotePlannerService)
    private readonly quotePlanner: BasketQuotePlannerService,
    @Inject(LendingEventService)
    private readonly lendingEvents: LendingEventService,
  ) {}

  private cached<T>(key: string): T | undefined {
    const entry = this.readCache.get(key);
    if (!entry || entry.expiresAt < Date.now()) return undefined;
    return entry.value as T;
  }

  private putCached<T>(key: string, value: T): T {
    this.readCache.set(key, { expiresAt: Date.now() + this.readCacheTtlMs, value });
    return value;
  }

  private decodeActivityCursor(value?: string): { block: number; log: number } | null {
    if (!value) return null;
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { block?: number; log?: number };
      if (!Number.isSafeInteger(parsed.block) || !Number.isSafeInteger(parsed.log) || parsed.block! < 0 || parsed.log! < 0) throw new Error('invalid');
      return { block: parsed.block!, log: parsed.log! };
    } catch { throw new BadRequestException({ error: 'INVALID_ACTIVITY_CURSOR' }); }
  }

  private encodeActivityCursor(block: string | number, log: string | number): string {
    return Buffer.from(JSON.stringify({ block: Number(block), log: Number(log) })).toString('base64url');
  }

  private serializeActivity(row: Record<string, any>): ActivityEvent {
    const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
      ? row.payload
      : {};
    return {
      chainId: Number(row.chain_id),
      txHash: String(row.tx_hash).trim(),
      logIndex: Number(row.log_index),
      blockNumber: Number(row.block_number),
      blockHash: String(row.block_hash).trim(),
      basketAddress: String(row.basket_address).trim().toLowerCase(),
      eventType: String(row.event_type),
      actorAddress: row.actor_address ? String(row.actor_address).trim().toLowerCase() : null,
      payload: { ...payload, executionRoutes: Array.isArray(row.execution_routes) ? row.execution_routes : [] },
      occurredAt: this.iso(row.occurred_at),
    };
  }

  private iso(value: unknown): string {
    return new Date(String(value)).toISOString();
  }

  private freshness(row: Record<string, any>): Freshness {
    const positionBlockNumber = row.position_block_number == null ? null : Number(row.position_block_number);
    const priceBlockNumber = row.price_block_number == null ? null : Number(row.price_block_number);
    const priceCheckedAt = row.price_observed_at ? new Date(String(row.price_observed_at)).getTime() : null;
    const status: Freshness['status'] = positionBlockNumber == null || priceBlockNumber == null ? 'UNAVAILABLE' :
      row.freshness_status === 'DEGRADED' || row.price_worker_error ? 'DEGRADED' :
      priceCheckedAt == null || Date.now() - priceCheckedAt > 60_000 ? 'STALE' : 'FRESH';
    return {
      positionBlockNumber,
      positionBlockHash: row.position_block_hash?.trim?.() ?? null,
      positionObservedAt: row.position_observed_at ? this.iso(row.position_observed_at) : null,
      priceBlockNumber,
      priceBlockHash: row.price_block_hash?.trim?.() ?? null,
      priceObservedAt: row.price_observed_at ? this.iso(row.price_observed_at) : null,
      status,
    };
  }

  private summary(row: Record<string, any>): BasketSummary {
    return {
      chainId: Number(row.chain_id), address: String(row.address).trim().toLowerCase(),
      controller: String(row.controller).trim().toLowerCase(), name: String(row.name), symbol: String(row.symbol),
      createdAt: this.iso(row.created_at),
      totalNavUsdcMicro: row.total_nav_usdc_micro == null ? null : String(row.total_nav_usdc_micro),
      holdingCount: Number(row.holding_count ?? 0), targetCount: Number(row.target_count ?? 0), freshness: this.freshness(row),
    };
  }

  private assetMetadata(addressInput: string): { symbol: string; name: string; decimals: number } | null {
    const address = addressInput.trim().toLowerCase();
    const symbols = ['AAPLc', 'AMZNc', 'COINc', 'CRCLc', 'GOOGLc', 'INTCc', 'METAc', 'MSFTc', 'MSTRc', 'NVDAc', 'SNDKc', 'SPCXc', 'TSLAc'];
    const index = CONTRACT_B20_TOKENS.findIndex((token) => token.toLowerCase() === address);
    if (index >= 0) return { symbol: symbols[index], name: symbols[index].replace('c', ''), decimals: 8 };
    if (address === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913') return { symbol: 'USDC', name: 'USD Coin', decimals: 6 };
    return null;
  }

  /** Set-based latest fact projection used by list and overview reads. */
  async getPortfolioOverview(chainIdInput?: string, controllerInput?: string): Promise<PortfolioOverview> {
    const chainId = chainIdSchema.parse(chainIdInput || '31337');
    const controller = addressSchema.parse(controllerInput).toLowerCase();
    const key = `portfolio-overview:${chainId}:${controller}`;
    const cached = this.cached<PortfolioOverview>(key);
    if (cached) return cached;
    const result = await this.db.query(`
      WITH owner_baskets AS (
        SELECT b.chain_id, b.address, b.controller, b.name, b.symbol, b.created_at,
          (SELECT COUNT(*) FROM basket_assets ba WHERE ba.chain_id=b.chain_id AND ba.basket_address=b.address) AS target_count,
          (SELECT COUNT(*) FROM (SELECT DISTINCT ON (bp.asset_address) bp.quantity_base_units FROM basket_positions bp WHERE bp.chain_id=b.chain_id AND bp.basket_address=b.address ORDER BY bp.asset_address,bp.block_number DESC,bp.position_version DESC,bp.event_log_index DESC,bp.observed_at DESC,bp.block_hash DESC) latest WHERE latest.quantity_base_units > 0) AS holding_count,
          (SELECT (bno.nav_usdc * 1000000)::numeric(78,0)::text FROM basket_nav_observations bno WHERE bno.chain_id=b.chain_id AND bno.basket_address=b.address AND bno.valuation_status='COMPLETE' ORDER BY bno.block_number DESC,bno.kind DESC LIMIT 1) AS total_nav_usdc_micro,
          (SELECT bp.block_number FROM basket_positions bp WHERE bp.chain_id=b.chain_id AND bp.basket_address=b.address ORDER BY bp.block_number DESC,bp.observed_at DESC,bp.block_hash DESC LIMIT 1) AS position_block_number,
          (SELECT bp.block_hash FROM basket_positions bp WHERE bp.chain_id=b.chain_id AND bp.basket_address=b.address ORDER BY bp.block_number DESC,bp.observed_at DESC,bp.block_hash DESC LIMIT 1) AS position_block_hash,
          (SELECT bp.observed_at FROM basket_positions bp WHERE bp.chain_id=b.chain_id AND bp.basket_address=b.address ORDER BY bp.block_number DESC,bp.observed_at DESC,bp.block_hash DESC LIMIT 1) AS position_observed_at,
          (SELECT last_success_block FROM indexer_worker_state WHERE chain_id=b.chain_id AND worker_name='prices') AS price_block_number,
          (SELECT last_success_hash FROM indexer_worker_state WHERE chain_id=b.chain_id AND worker_name='prices') AS price_block_hash,
          (SELECT last_success_at FROM indexer_worker_state WHERE chain_id=b.chain_id AND worker_name='prices') AS price_observed_at,
          (SELECT last_error FROM indexer_worker_state WHERE chain_id=b.chain_id AND worker_name='prices') AS price_worker_error
        FROM baskets b WHERE b.chain_id=$1 AND b.controller=$2
      ), latest_positions AS (
        SELECT DISTINCT ON (bp.basket_address,bp.asset_address) bp.basket_address,bp.asset_address,bp.quantity_base_units,bp.decimals,bp.block_number,bp.block_hash,bp.observed_at
        FROM basket_positions bp JOIN owner_baskets ob ON ob.address=bp.basket_address AND ob.chain_id=bp.chain_id
        ORDER BY bp.basket_address,bp.asset_address,bp.block_number DESC,bp.position_version DESC,bp.event_log_index DESC,bp.event_tx_hash DESC,bp.observed_at DESC,bp.block_hash DESC
      ), latest_prices AS (
        SELECT DISTINCT ON (apo.asset_address) apo.asset_address,apo.price_usd_e8,apo.block_number,apo.block_hash,apo.observed_at
        FROM asset_price_observations apo WHERE apo.chain_id=$1 ORDER BY apo.asset_address,apo.block_number DESC,apo.observed_at DESC,apo.block_hash DESC
      )
      SELECT ob.*, lp.asset_address, lp.quantity_base_units::text, lp.decimals, lp.block_number AS holding_block_number, lp.block_hash AS holding_block_hash, lp.observed_at AS holding_observed_at,
        ap.price_usd_e8::text, ap.block_number AS holding_price_block_number, ap.block_hash AS holding_price_block_hash, ap.observed_at AS holding_price_observed_at,
        acb.quantity_base_units::text AS basis_quantity_base_units, acb.open_basis_usdc_micro::text, acb.accounting_status
      FROM owner_baskets ob LEFT JOIN latest_positions lp ON lp.basket_address=ob.address LEFT JOIN latest_prices ap ON ap.asset_address=lp.asset_address
      LEFT JOIN asset_cost_basis acb ON acb.chain_id=ob.chain_id AND acb.basket_address=ob.address AND acb.asset_address=lp.asset_address
      ORDER BY ob.created_at DESC, ob.address, lp.asset_address`, [chainId, controller]);
    const rows = result.rows;
    const baskets = [...new Map(rows.map((r) => [String(r.address).trim(), this.summary(r)])).values()];
    const aggregate = new Map<string, {
      assetAddress: string; symbol: string | null; decimals: number;
      quantity: bigint; value: bigint; basis: bigint;
      price: string | null; accountingComplete: boolean;
    }>();
    for (const row of rows) {
      if (!row.asset_address || String(row.quantity_base_units) === '0') continue;
      const asset = String(row.asset_address).trim().toLowerCase();
      const metadata = this.assetMetadata(asset);
      const current = aggregate.get(asset) ?? {
        assetAddress: asset, symbol: metadata?.symbol ?? null, decimals: Number(row.decimals ?? metadata?.decimals ?? 0),
        quantity: 0n, value: 0n, basis: 0n,
        price: row.price_usd_e8 == null ? null : String(row.price_usd_e8), accountingComplete: true,
      };
      const quantity = BigInt(row.quantity_base_units);
      const value = row.price_usd_e8 == null ? null :
        quantity * BigInt(row.price_usd_e8) * 1_000_000n / (10n ** BigInt(current.decimals) * 100_000_000n);
      current.quantity += quantity;
      current.value += value ?? 0n;
      if (value === null) current.price = null;
      // Cash is excluded from investment P&L; the indexer intentionally does
      // not create acquisition-basis records for USDC.
      if (metadata?.symbol === 'USDC') current.basis += value ?? 0n;
      else if (row.accounting_status === 'COMPLETE' && row.open_basis_usdc_micro != null &&
        row.basis_quantity_base_units != null && BigInt(row.basis_quantity_base_units) === quantity) {
        current.basis += BigInt(row.open_basis_usdc_micro);
      } else current.accountingComplete = false;
      aggregate.set(asset, current);
    }
    const holdings: Holding[] = [...aggregate.values()].map((h) => ({
      assetAddress: h.assetAddress, symbol: h.symbol, decimals: h.decimals,
      quantityBaseUnits: h.quantity.toString(), priceUsdE8: h.price,
      valueUsdcMicro: h.price === null ? null : h.value.toString(), currentWeightBps: null,
      // Matches basket detail: micro-USDC per whole token, despite the legacy field name.
      averageCostUsdcMicroPerBaseUnit: h.accountingComplete ? (h.basis * 10n ** BigInt(h.decimals) / h.quantity).toString() : null,
      unrealizedPnlUsdcMicro: h.price !== null && h.accountingComplete ? (h.value - h.basis).toString() : null,
      status: h.price === null ? 'UNAVAILABLE' : h.accountingComplete ? 'COMPLETE' : 'PARTIAL',
    }));
    const freshness = this.freshness(rows[0] ?? {});
    const totalNavUsdcMicro = holdings.some((holding) => holding.valueUsdcMicro === null) ? null :
      holdings.reduce((sum, holding) => sum + BigInt(holding.valueUsdcMicro!), 0n).toString();
    return this.putCached(key, portfolioOverviewSchema.parse({ chainId, controller, totalNavUsdcMicro, baskets, holdings, freshness, calculatedAt: new Date().toISOString() })) as PortfolioOverview;
  }

  async getBasketDetail(addressInput: string, chainIdInput?: string, controllerInput?: string): Promise<{ data: BasketDetail }> {
    const chainId = chainIdSchema.parse(chainIdInput || '31337');
    const address = addressSchema.parse(addressInput).toLowerCase();
    if (!controllerInput) throw new BadRequestException({ error: 'CONTROLLER_REQUIRED' });
    const controller = addressSchema.parse(controllerInput).toLowerCase();
    const key = `basket-detail:${chainId}:${address}:${controller ?? '*'}`;
    const cached = this.cached<{ data: BasketDetail }>(key);
    if (cached) return cached;
    const basketResult = await this.db.query(`SELECT b.chain_id,b.address,b.controller,b.name,b.symbol,b.created_at,
      (SELECT COUNT(*) FROM basket_assets ba WHERE ba.chain_id=b.chain_id AND ba.basket_address=b.address) AS target_count,
      (SELECT COUNT(*) FROM (SELECT DISTINCT ON (bp.asset_address) bp.quantity_base_units FROM basket_positions bp WHERE bp.chain_id=b.chain_id AND bp.basket_address=b.address ORDER BY bp.asset_address,bp.block_number DESC,bp.position_version DESC,bp.event_log_index DESC,bp.observed_at DESC,bp.block_hash DESC) latest WHERE latest.quantity_base_units > 0) AS holding_count,
      (SELECT (bno.nav_usdc * 1000000)::numeric(78,0)::text FROM basket_nav_observations bno WHERE bno.chain_id=b.chain_id AND bno.basket_address=b.address AND bno.valuation_status='COMPLETE' ORDER BY bno.block_number DESC,bno.kind DESC LIMIT 1) AS total_nav_usdc_micro,
      (SELECT bp.block_number FROM basket_positions bp WHERE bp.chain_id=b.chain_id AND bp.basket_address=b.address ORDER BY bp.block_number DESC,bp.observed_at DESC,bp.block_hash DESC LIMIT 1) AS position_block_number,
      (SELECT bp.block_hash FROM basket_positions bp WHERE bp.chain_id=b.chain_id AND bp.basket_address=b.address ORDER BY bp.block_number DESC,bp.observed_at DESC,bp.block_hash DESC LIMIT 1) AS position_block_hash,
      (SELECT bp.observed_at FROM basket_positions bp WHERE bp.chain_id=b.chain_id AND bp.basket_address=b.address ORDER BY bp.block_number DESC,bp.observed_at DESC,bp.block_hash DESC LIMIT 1) AS position_observed_at,
      (SELECT last_success_block FROM indexer_worker_state WHERE chain_id=b.chain_id AND worker_name='prices') AS price_block_number,
      (SELECT last_success_hash FROM indexer_worker_state WHERE chain_id=b.chain_id AND worker_name='prices') AS price_block_hash,
      (SELECT last_success_at FROM indexer_worker_state WHERE chain_id=b.chain_id AND worker_name='prices') AS price_observed_at,
      (SELECT last_error FROM indexer_worker_state WHERE chain_id=b.chain_id AND worker_name='prices') AS price_worker_error
      FROM baskets b WHERE b.chain_id=$1 AND b.address=$2 AND ($3::char(42) IS NULL OR b.controller=$3)`, [chainId, address, controller]);
    if (!basketResult.rows[0]) throw new NotFoundException({ error: 'BASKET_NOT_FOUND' });
    const row = basketResult.rows[0];
    const [targets, holdings] = await Promise.all([
      this.db.query('SELECT asset_address,target_weight_bps FROM basket_assets WHERE chain_id=$1 AND basket_address=$2 ORDER BY asset_address', [chainId, address]),
      this.db.query(`SELECT p.asset_address,
                            p.quantity_base_units::text,
                            p.decimals,
                            apo.price_usd_e8::text,
                            apo.block_number AS price_block_number,
                            acb.accounting_status,
                            CASE WHEN acb.quantity_base_units IS NULL OR acb.quantity_base_units = 0 OR acb.accounting_status <> 'COMPLETE' THEN NULL
                                 ELSE TRUNC((acb.open_basis_usdc_micro::numeric * power(10::numeric, p.decimals)) / acb.quantity_base_units::numeric)::numeric(78,0)::text END AS avg_cost_micro_per_base_unit,
                            CASE WHEN apo.price_usd_e8 IS NULL OR acb.accounting_status <> 'COMPLETE' THEN NULL
                                 ELSE TRUNC(((p.quantity_base_units * apo.price_usd_e8 * 1000000)
                                       / (power(10::numeric, p.decimals) * 100000000)) - acb.open_basis_usdc_micro)::numeric(78,0)::text END AS unrealized_pnl_micro
        FROM (SELECT DISTINCT ON (asset_address) asset_address,quantity_base_units,decimals,block_number,block_hash,observed_at FROM basket_positions WHERE chain_id=$1 AND basket_address=$2 ORDER BY asset_address,block_number DESC,position_version DESC,event_log_index DESC,event_tx_hash DESC,observed_at DESC,block_hash DESC) p
        LEFT JOIN LATERAL (SELECT price_usd_e8,block_number FROM asset_price_observations WHERE chain_id=$1 AND asset_address=p.asset_address ORDER BY block_number DESC,observed_at DESC,block_hash DESC LIMIT 1) apo ON TRUE
        LEFT JOIN asset_cost_basis acb ON acb.chain_id=$1 AND acb.basket_address=$2 AND acb.asset_address=p.asset_address
        WHERE p.quantity_base_units > 0 ORDER BY p.asset_address`, [chainId, address]),
    ]);
    const summary = this.summary(row);
    const rawHoldings = holdings.rows.map((h) => {
      const assetAddress = String(h.asset_address).trim().toLowerCase();
      const metadata = this.assetMetadata(assetAddress);
      const value = h.price_usd_e8 == null ? null : (BigInt(h.quantity_base_units) * BigInt(h.price_usd_e8) * 1_000_000n / (10n ** BigInt(Number(h.decimals)) * 100_000_000n));
      const status: Holding['status'] = value == null ? 'UNAVAILABLE' : h.accounting_status === 'COMPLETE' ? 'COMPLETE' : 'PARTIAL';
      return {
        assetAddress,
        symbol: metadata?.symbol ?? null,
        decimals: Number(h.decimals ?? metadata?.decimals ?? 0),
        quantityBaseUnits: String(h.quantity_base_units),
        priceUsdE8: h.price_usd_e8 ?? null,
        valueUsdcMicro: value?.toString() ?? null,
        currentWeightBps: null,
        averageCostUsdcMicroPerBaseUnit: h.avg_cost_micro_per_base_unit ?? null,
        unrealizedPnlUsdcMicro: h.unrealized_pnl_micro ?? null,
        status,
      };
    });
    const total = rawHoldings.reduce((sum, holding) => sum + BigInt(holding.valueUsdcMicro ?? '0'), 0n);
    const mappedHoldings: Holding[] = rawHoldings.map((holding) => ({ ...holding, currentWeightBps: holding.valueUsdcMicro == null || total === 0n ? null : Number(BigInt(holding.valueUsdcMicro) * 10000n / total) }));
    const detailSummary = { ...summary, totalNavUsdcMicro: total.toString() };
    const detail: BasketDetail = { summary: detailSummary, targets: targets.rows.map((t) => ({ assetAddress: String(t.asset_address).trim().toLowerCase(), targetWeightBps: Number(t.target_weight_bps) })), holdings: mappedHoldings, valuation: { totalNavUsdcMicro: total.toString(), status: summary.freshness.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'COMPLETE' }, accounting: { policy: 'WEIGHTED_AVERAGE_PORTFOLIO_ACCOUNTING_NOT_TAX_ADVICE', status: 'UNAVAILABLE', issue: null }, capabilities: createPortfolioOnlyCapabilities(chainId, 'indexed-read-model'), freshness: summary.freshness };
    return this.putCached(key, { data: basketDetailSchema.parse(detail) }) as { data: BasketDetail };
  }

  async getBaskets(chainIdInput?: string, controllerInput?: string) {
    return { data: await this.getBasketSummaries(chainIdInput, controllerInput) };
    /* compatibility implementation is retained for callers using this service directly */
    try {
      const chainId = chainIdSchema.parse(chainIdInput || '31337');
      const controller = controllerInput
        ? addressSchema.parse(controllerInput).toLowerCase()
        : null;

      let sql = `
        SELECT b.chain_id,b.address,b.controller,b.name,b.symbol,b.created_block,b.created_tx,b.created_at,
          (SELECT json_build_object(
                    'total_nav_usdc', bno.nav_usdc,
                    'block_number', bno.block_number,
                    'block_hash', bno.block_hash,
                    'valuation_status', bno.valuation_status
                  )
           FROM basket_nav_observations bno
           WHERE bno.chain_id = b.chain_id AND bno.basket_address = b.address
             AND bno.valuation_status = 'COMPLETE'
           ORDER BY bno.block_number DESC LIMIT 1) as snapshot,
          COALESCE(
            (SELECT json_agg(json_build_object('assetAddress', ba.asset_address, 'targetWeightBps', ba.target_weight_bps, 'updatedBlock', ba.updated_block))
             FROM basket_assets ba 
             WHERE ba.chain_id = b.chain_id AND ba.basket_address = b.address),
            '[]'::json
          ) as assets
        FROM baskets b
        WHERE b.chain_id = $1
      `;
      const params: any[] = [chainId];
      if (controller) {
        sql += ' AND b.controller = $2';
        params.push(controller);
      }
      sql += ' ORDER BY b.created_block DESC LIMIT 100';

      const result = await this.db.query(sql, params);

      return { data: result.rows };
    } catch (err) {
      console.error('ERROR IN GET_BASKETS:', err);
      throw err;
    }
  }

  async getBasketSummaries(chainIdInput?: string, controllerInput?: string): Promise<BasketSummary[]> {
    const chainId = chainIdSchema.parse(chainIdInput || '31337');
    const controller = controllerInput ? addressSchema.parse(controllerInput).toLowerCase() : null;
    const key = `basket-list:${chainId}:${controller ?? '*'}`;
    const cached = this.cached<BasketSummary[]>(key);
    if (cached) return cached;
    const result = await this.db.query(`SELECT b.chain_id,b.address,b.controller,b.name,b.symbol,b.created_at,
      (SELECT COUNT(*) FROM basket_assets ba WHERE ba.chain_id=b.chain_id AND ba.basket_address=b.address) AS target_count,
      (SELECT COUNT(*) FROM (SELECT DISTINCT ON (bp.asset_address) bp.quantity_base_units FROM basket_positions bp WHERE bp.chain_id=b.chain_id AND bp.basket_address=b.address ORDER BY bp.asset_address,bp.block_number DESC,bp.position_version DESC,bp.event_log_index DESC,bp.observed_at DESC,bp.block_hash DESC) latest WHERE latest.quantity_base_units > 0) AS holding_count,
      (SELECT (bno.nav_usdc * 1000000)::numeric(78,0)::text FROM basket_nav_observations bno WHERE bno.chain_id=b.chain_id AND bno.basket_address=b.address AND bno.valuation_status='COMPLETE' ORDER BY bno.block_number DESC,bno.kind DESC LIMIT 1) AS total_nav_usdc_micro,
      (SELECT bp.block_number FROM basket_positions bp WHERE bp.chain_id=b.chain_id AND bp.basket_address=b.address ORDER BY bp.block_number DESC,bp.observed_at DESC,bp.block_hash DESC LIMIT 1) AS position_block_number,
      (SELECT bp.block_hash FROM basket_positions bp WHERE bp.chain_id=b.chain_id AND bp.basket_address=b.address ORDER BY bp.block_number DESC,bp.observed_at DESC,bp.block_hash DESC LIMIT 1) AS position_block_hash,
      (SELECT bp.observed_at FROM basket_positions bp WHERE bp.chain_id=b.chain_id AND bp.basket_address=b.address ORDER BY bp.block_number DESC,bp.observed_at DESC,bp.block_hash DESC LIMIT 1) AS position_observed_at,
      (SELECT last_success_block FROM indexer_worker_state WHERE chain_id=b.chain_id AND worker_name='prices') AS price_block_number,
      (SELECT last_success_hash FROM indexer_worker_state WHERE chain_id=b.chain_id AND worker_name='prices') AS price_block_hash,
      (SELECT last_success_at FROM indexer_worker_state WHERE chain_id=b.chain_id AND worker_name='prices') AS price_observed_at,
      (SELECT last_error FROM indexer_worker_state WHERE chain_id=b.chain_id AND worker_name='prices') AS price_worker_error
      FROM baskets b WHERE b.chain_id=$1 AND ($2::char(42) IS NULL OR b.controller=$2) ORDER BY b.created_block DESC LIMIT 100`, [chainId, controller]);
    return this.putCached(key, result.rows.map((row) => basketSummarySchema.parse(this.summary(row)))) as BasketSummary[];
  }

  async getControllerActivity(chainIdInput: string, controllerInput: string, cursorInput?: string, limitInput?: string) {
    const chainId = chainIdSchema.parse(chainIdInput); const controller = addressSchema.parse(controllerInput).toLowerCase();
    const limit = Math.min(Math.max(Number(limitInput ?? 50), 1), 100);
    if (!Number.isInteger(limit)) throw new BadRequestException({ error: 'INVALID_ACTIVITY_LIMIT' });
    const cursor = this.decodeActivityCursor(cursorInput);
    const result = await this.db.query(`SELECT e.chain_id,e.tx_hash,e.log_index,e.block_number,e.block_hash,e.basket_address,e.event_type,e.actor_address,e.payload,e.occurred_at,
        COALESCE(routes.execution_routes, '[]'::json) AS execution_routes
      FROM basket_events e JOIN baskets b ON b.chain_id=e.chain_id AND b.address=e.basket_address
      LEFT JOIN LATERAL (
        SELECT json_agg(route.payload ORDER BY route.log_index) AS execution_routes
        FROM basket_events route
        WHERE route.chain_id=e.chain_id AND route.basket_address=e.basket_address
          AND route.tx_hash=e.tx_hash AND route.event_type='DEX_ROUTE_EXECUTED'
      ) routes ON TRUE
      WHERE e.chain_id=$1 AND b.controller=$2 AND e.event_type <> 'DEX_ROUTE_EXECUTED' AND ($3::bigint IS NULL OR (e.block_number,e.log_index) < ($3::bigint,$4::integer))
      ORDER BY e.block_number DESC,e.log_index DESC LIMIT $5`, [chainId, controller, cursor?.block ?? null, cursor?.log ?? null, limit + 1]);
    const rawRows = result.rows.slice(0, limit); const rows = rawRows.map((row) => this.serializeActivity(row));
    return activityPageSchema.parse({ data: rows, page: { nextCursor: result.rows.length > limit ? this.encodeActivityCursor(rawRows[rawRows.length - 1].block_number, rawRows[rawRows.length - 1].log_index) : null, hasMore: result.rows.length > limit } });
  }

  async getBasketActivityPage(addressInput: string, chainIdInput: string, controllerInput: string, cursorInput?: string, limitInput?: string) {
    const chainId = chainIdSchema.parse(chainIdInput); const address = addressSchema.parse(addressInput).toLowerCase();
    const controller = addressSchema.parse(controllerInput).toLowerCase();
    const limit = Math.min(Math.max(Number(limitInput ?? 50), 1), 100); const cursor = this.decodeActivityCursor(cursorInput);
    if (!Number.isInteger(limit)) throw new BadRequestException({ error: 'INVALID_ACTIVITY_PAGE' });
    const result = await this.db.query(`SELECT e.chain_id,e.tx_hash,e.log_index,e.block_number,e.block_hash,e.basket_address,e.event_type,e.actor_address,e.payload,e.occurred_at,
        COALESCE(routes.execution_routes, '[]'::json) AS execution_routes
      FROM basket_events e JOIN baskets b ON b.chain_id=e.chain_id AND b.address=e.basket_address
      LEFT JOIN LATERAL (
        SELECT json_agg(route.payload ORDER BY route.log_index) AS execution_routes
        FROM basket_events route
        WHERE route.chain_id=e.chain_id AND route.basket_address=e.basket_address
          AND route.tx_hash=e.tx_hash AND route.event_type='DEX_ROUTE_EXECUTED'
      ) routes ON TRUE
      WHERE e.chain_id=$1 AND e.basket_address=$2 AND b.controller=$3 AND e.event_type <> 'DEX_ROUTE_EXECUTED' AND ($4::bigint IS NULL OR (e.block_number,e.log_index) < ($4::bigint,$5::integer))
      ORDER BY e.block_number DESC,e.log_index DESC LIMIT $6`, [chainId, address, controller, cursor?.block ?? null, cursor?.log ?? null, limit + 1]);
    const rawRows = result.rows.slice(0, limit); const rows = rawRows.map((row) => this.serializeActivity(row));
    return activityPageSchema.parse({ data: rows, page: { nextCursor: result.rows.length > limit ? this.encodeActivityCursor(rawRows[rawRows.length - 1].block_number, rawRows[rawRows.length - 1].log_index) : null, hasMore: result.rows.length > limit } });
  }

  /**
   * Returns only canonical, indexer-pinned valuation observations from basket_nav_observations.
   * At each observation time we use the latest known observation for every basket owned by the
   * controller, which prevents an inactive basket being counted as $0.
   */
  async getValuationHistory(chainIdInput?: string, controllerInput?: string, timeframeInput?: string) {
    const chainId = chainIdSchema.parse(chainIdInput || '31337');
    const controller = addressSchema.parse(controllerInput).toLowerCase();
    const timeframe = timeframeInput || '30D';
    const timeframeConfig = {
      '1D': { milliseconds: 24 * 60 * 60 * 1000 },
      '7D': { milliseconds: 7 * 24 * 60 * 60 * 1000 },
      '30D': { milliseconds: 30 * 24 * 60 * 60 * 1000 },
    } as const;

    if (!(timeframe in timeframeConfig)) {
      throw new BadRequestException({ error: 'INVALID_VALUATION_TIMEFRAME' });
    }

    const cutoff = new Date(Date.now() - timeframeConfig[timeframe as keyof typeof timeframeConfig].milliseconds);
    const result = await this.db.query(
      `WITH owner_baskets AS (
         SELECT address
         FROM baskets
         WHERE chain_id = $1 AND controller = $2
       ),
       latest_before_window AS (
         SELECT DISTINCT ON (bno.basket_address)
           bno.basket_address, bno.block_number, bno.block_timestamp AS observed_at, bno.nav_usdc
         FROM basket_nav_observations bno
         JOIN owner_baskets ob ON ob.address = bno.basket_address
         WHERE bno.chain_id = $1
           AND bno.valuation_status = 'COMPLETE'
           AND bno.nav_usdc IS NOT NULL
           AND bno.block_timestamp < $3
         ORDER BY bno.basket_address, bno.block_timestamp DESC, bno.block_number DESC
       ),
       observation_candidates AS (
         SELECT bno.basket_address, bno.block_number, bno.block_timestamp AS observed_at, bno.nav_usdc
         FROM basket_nav_observations bno
         JOIN owner_baskets ob ON ob.address = bno.basket_address
         WHERE bno.chain_id = $1
           AND bno.valuation_status = 'COMPLETE'
           AND bno.nav_usdc IS NOT NULL
           AND bno.block_timestamp >= $3
           AND bno.block_timestamp <= NOW()
         UNION ALL
         SELECT basket_address, block_number, observed_at, nav_usdc
         FROM latest_before_window
       ),
       timeline AS (
         SELECT DISTINCT observed_at
         FROM observation_candidates
       )
       SELECT timeline.observed_at,
              SUM(latest.nav_usdc)::float8 AS total_nav_usdc,
              MAX(latest.block_number)::text AS block_number,
              COUNT(*)::int AS basket_count
       FROM timeline
       JOIN owner_baskets ob ON TRUE
       JOIN LATERAL (
         SELECT bno.nav_usdc, bno.block_number
         FROM basket_nav_observations bno
         WHERE bno.chain_id = $1
           AND bno.basket_address = ob.address
           AND bno.valuation_status = 'COMPLETE'
           AND bno.nav_usdc IS NOT NULL
           AND bno.block_timestamp <= timeline.observed_at
         ORDER BY bno.block_timestamp DESC, bno.block_number DESC
         LIMIT 1
       ) latest ON TRUE
       GROUP BY timeline.observed_at
       ORDER BY timeline.observed_at ASC`,
      [chainId, controller, cutoff],
    );

    return {
      data: {
        timeframe,
        points: result.rows.map((row) => ({
          observedAt: new Date(row.observed_at).toISOString(),
          totalNavUsdc: Number(row.total_nav_usdc),
          blockNumber: String(row.block_number),
          basketCount: Number(row.basket_count),
        })),
      },
    };
  }

  /**
   * Current weighted-average accounting view. Monetary and token quantities stay
   * decimal strings end-to-end: accounting must never depend on JS float math.
   */
  async getAccountingSummary(addressInput: string, chainIdInput?: string, controllerInput?: string) {
    const { chainId, address, controller } = await this.requireBasketController(addressInput, chainIdInput, controllerInput);
    const result = await this.db.query(
      `SELECT acb.asset_address,
              acb.quantity_base_units::text,
              acb.decimals,
              acb.open_basis_usdc_micro::text,
              acb.accounting_status,
              acb.issue,
              acb.updated_at,
              spot.price_usd_e8::text AS spot_price_usd_e8,
              CASE WHEN spot.price_usd_e8 IS NULL THEN NULL
                   ELSE ((acb.quantity_base_units * spot.price_usd_e8 * 1000000)
                         / (power(10::numeric, acb.decimals) * 100000000))::text END AS spot_value_usdc_micro,
              CASE WHEN acb.quantity_base_units = 0 THEN NULL
                   ELSE (acb.open_basis_usdc_micro / acb.quantity_base_units)::text END AS weighted_average_cost_usdc_micro_per_base_unit,
              CASE WHEN spot.price_usd_e8 IS NULL OR acb.accounting_status <> 'COMPLETE' THEN NULL
                   ELSE (((acb.quantity_base_units * spot.price_usd_e8 * 1000000)
                         / (power(10::numeric, acb.decimals) * 100000000)) - acb.open_basis_usdc_micro)::text END AS unrealised_pnl_usdc_micro
       FROM asset_cost_basis acb
       LEFT JOIN LATERAL (
         SELECT price_usd_e8
         FROM asset_price_observations apo
         WHERE apo.chain_id=acb.chain_id AND apo.asset_address=acb.asset_address
         ORDER BY apo.block_number DESC LIMIT 1
       ) spot ON TRUE
       WHERE acb.chain_id=$1 AND acb.basket_address=$2
       ORDER BY acb.asset_address`,
      [chainId, address],
    );
    return {
      data: {
        chainId,
        basketAddress: address,
        controller,
        accountingPolicy: 'WEIGHTED_AVERAGE_PORTFOLIO_ACCOUNTING_NOT_TAX_ADVICE',
        assets: result.rows.map((row) => ({
          assetAddress: row.asset_address,
          quantityBaseUnits: String(row.quantity_base_units),
          decimals: Number(row.decimals),
          openBasisUsdcMicro: String(row.open_basis_usdc_micro),
          weightedAverageCostUsdcMicroPerBaseUnit: row.accounting_status === 'COMPLETE'
            ? row.weighted_average_cost_usdc_micro_per_base_unit : null,
          spotPriceUsdE8: row.spot_price_usd_e8 ?? null,
          spotValueUsdcMicro: row.accounting_status === 'COMPLETE' ? row.spot_value_usdc_micro : null,
          unrealisedPnlUsdcMicro: row.accounting_status === 'COMPLETE' ? row.unrealised_pnl_usdc_micro : null,
          accountingStatus: row.accounting_status,
          issue: row.issue ?? null,
          updatedAt: new Date(row.updated_at).toISOString(),
        })),
      },
    };
  }

  async getAccountingEvents(addressInput: string, chainIdInput?: string, controllerInput?: string, cursorInput?: string, limitInput?: string) {
    const { chainId, address } = await this.requireBasketController(addressInput, chainIdInput, controllerInput);
    const limit = Math.min(Math.max(Number(limitInput ?? 50), 1), 100);
    if (!Number.isInteger(limit)) throw new BadRequestException({ error: 'INVALID_ACCOUNTING_EVENT_LIMIT' });
    const cursor = cursorInput ? Number(cursorInput) : null;
    if (cursor !== null && (!Number.isSafeInteger(cursor) || cursor < 0)) {
      throw new BadRequestException({ error: 'INVALID_ACCOUNTING_EVENT_CURSOR' });
    }
    const result = await this.db.query(
      `SELECT id::text, tx_hash, log_index, block_number, block_hash, occurred_at, kind, asset_address,
              quantity_base_units::text, decimals, basis_delta_usdc_micro::text, valuation_source, status, issue
       FROM accounting_events
       WHERE chain_id=$1 AND basket_address=$2 AND ($3::bigint IS NULL OR block_number < $3)
       ORDER BY block_number DESC, log_index DESC, created_at DESC
       LIMIT $4`,
      [chainId, address, cursor, limit + 1],
    );
    const rows = result.rows.slice(0, limit);
    return {
      data: {
        events: rows.map((row) => this.serializeAccountingEvent(row)),
        nextCursor: result.rows.length > limit ? String(rows[rows.length - 1].block_number) : null,
      },
    };
  }

  async getAccountingCsv(addressInput: string, chainIdInput?: string, controllerInput?: string) {
    const { chainId, address } = await this.requireBasketController(addressInput, chainIdInput, controllerInput);
    const result = await this.db.query(
      `SELECT tx_hash, log_index, block_number, block_hash, occurred_at, kind, asset_address,
              quantity_base_units::text, decimals, basis_delta_usdc_micro::text, valuation_source, status, issue
       FROM accounting_events WHERE chain_id=$1 AND basket_address=$2
       ORDER BY block_number ASC, log_index ASC, created_at ASC`,
      [chainId, address],
    );
    const headers = ['txHash', 'logIndex', 'blockNumber', 'blockHash', 'occurredAt', 'kind', 'assetAddress', 'quantityBaseUnits', 'decimals', 'basisDeltaUsdcMicro', 'valuationSource', 'status', 'issue'];
    const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    return [
      '# Weighted-average portfolio accounting — not tax advice',
      headers.join(','),
      ...result.rows.map((row) => headers.map((header) => quote(row[this.camelToSnake(header)])).join(',')),
    ].join('\n');
  }

  private async requireBasketController(addressInput: string, chainIdInput?: string, controllerInput?: string) {
    const chainId = chainIdSchema.parse(chainIdInput || '31337');
    const address = addressSchema.parse(addressInput).toLowerCase();
    const controller = addressSchema.parse(controllerInput).toLowerCase();
    const basket = await this.db.query(
      'SELECT 1 FROM baskets WHERE chain_id=$1 AND address=$2 AND controller=$3 LIMIT 1',
      [chainId, address, controller],
    );
    if (basket.rows.length === 0) throw new NotFoundException({ error: 'BASKET_NOT_FOUND_OR_NOT_CONTROLLED' });
    return { chainId, address, controller };
  }

  private serializeAccountingEvent(row: Record<string, unknown>) {
    return {
      id: String(row.id), txHash: String(row.tx_hash), logIndex: Number(row.log_index), blockNumber: String(row.block_number),
      blockHash: String(row.block_hash), occurredAt: this.iso(row.occurred_at), kind: String(row.kind),
      assetAddress: String(row.asset_address), quantityBaseUnits: String(row.quantity_base_units), decimals: Number(row.decimals),
      basisDeltaUsdcMicro: String(row.basis_delta_usdc_micro), valuationSource: String(row.valuation_source), status: String(row.status), issue: row.issue ?? null,
    };
  }

  private camelToSnake(value: string) {
    return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }

  async createBasket(body: {
    chainId?: number;
    address: string;
    controller: string;
    name: string;
    symbol?: string;
    ensDomain?: string;
    createdBlock?: number;
    createdBlockHash?: string;
    createdTx?: string;
    assets?: Array<{ address: string; targetWeightBps: number }>;
  }) {
    const chainId = body.chainId ?? 31337;
    const address = addressSchema.parse(body.address).toLowerCase();
    const controller = addressSchema.parse(body.controller).toLowerCase();
    const name = body.name;
    const symbol = body.symbol ?? 'OTH';
    const ensDomain = body.ensDomain ?? `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}.othelio.eth`;
    const createdBlock = body.createdBlock ?? 1;
    const createdTx = body.createdTx ?? '0x0000000000000000000000000000000000000000000000000000000000000000';
    const createdBlockHash = body.createdBlockHash ?? createdTx;
    const configuredTargets = body.assets === undefined ? null : body.assets.map((asset) => ({
      address: addressSchema.parse(asset.address).toLowerCase(),
      targetWeightBps: asset.targetWeightBps,
    }));
    if (configuredTargets) {
      const uniqueAddresses = new Set(configuredTargets.map((asset) => asset.address));
      const totalWeightBps = configuredTargets.reduce((sum, asset) => sum + asset.targetWeightBps, 0);
      if (
        configuredTargets.length === 0
        || uniqueAddresses.size !== configuredTargets.length
        || configuredTargets.some((asset) => !Number.isInteger(asset.targetWeightBps) || asset.targetWeightBps <= 0 || asset.targetWeightBps > 10_000)
        || totalWeightBps !== 10_000
      ) {
        throw new BadRequestException('Basket target assets must be unique positive integer weights totaling 10000 bps.');
      }
    }

    try {
      await this.db.query(
        `INSERT INTO baskets (chain_id, address, controller, name, symbol, created_block, created_tx, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (chain_id, address) DO UPDATE SET controller = EXCLUDED.controller, name = EXCLUDED.name, created_block = EXCLUDED.created_block, created_tx = EXCLUDED.created_tx`,
        [chainId, address, controller, name, symbol, createdBlock, createdTx],
      );

      await this.db.query(
        `INSERT INTO basket_events (chain_id, tx_hash, log_index, block_number, block_hash, basket_address, event_type, actor_address, payload, occurred_at)
         VALUES ($1, $2, 0, $3, $4, $5, 'CREATED', $6, $7, NOW())
         ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING`,
        [
          chainId,
          createdTx,
          createdBlock,
          createdBlockHash,
          address,
          controller,
          JSON.stringify({ safe: address, owner: controller, name, ensDomain }),
        ],
      );

      if (configuredTargets) {
        await this.db.query(
          `WITH removed AS (
             DELETE FROM basket_assets WHERE chain_id=$1 AND basket_address=$2
           )
           INSERT INTO basket_assets (chain_id, basket_address, asset_address, target_weight_bps, updated_block)
           SELECT $1, $2, target.asset_address, target.target_weight_bps, $5
           FROM UNNEST($3::text[], $4::int[]) AS target(asset_address, target_weight_bps)
           ON CONFLICT (chain_id, basket_address, asset_address) DO UPDATE SET
             target_weight_bps=EXCLUDED.target_weight_bps,
             updated_block=EXCLUDED.updated_block`,
          [
            chainId,
            address,
            configuredTargets.map((asset) => asset.address),
            configuredTargets.map((asset) => asset.targetWeightBps),
            createdBlock,
          ],
        );
      }

      this.readCache.clear();

    } catch (err) {
      if (configuredTargets) throw err;
      console.warn('[BasketsService] Database insert warning (continuing fallback):', err);
    }

    return {
      success: true,
      data: {
        chainId,
        address,
        controller,
        name,
        symbol,
        ensDomain,
        createdBlock,
        createdTx,
      },
    };
  }

  async getBasketByAddress(addressInput: string, chainIdInput?: string) {
    return this.getBasketDetail(addressInput, chainIdInput);
    const chainId = chainIdSchema.parse(chainIdInput);
    let address = addressInput.toLowerCase();

    if (/^0x[a-fA-F0-9]{64}$/.test(addressInput)) {
      const txLookup = await this.db.query(
        'SELECT address FROM baskets WHERE chain_id=$1 AND created_tx=$2 LIMIT 1',
        [chainId, addressInput.toLowerCase()],
      );
      if (txLookup.rows && txLookup.rows.length > 0) {
        address = txLookup.rows[0].address;
      } else {
        const evtLookup = await this.db.query(
          'SELECT basket_address FROM basket_events WHERE chain_id=$1 AND tx_hash=$2 LIMIT 1',
          [chainId, addressInput.toLowerCase()],
        );
        if (evtLookup.rows && evtLookup.rows.length > 0) {
          address = evtLookup.rows[0].basket_address;
        }
      }
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new NotFoundException({ error: 'BASKET_NOT_FOUND' });
    }
    address = address.toLowerCase();

    const [basket, assets, snapshot, positions] = await Promise.all([
      this.db.query('SELECT chain_id,address,controller,name,symbol,created_block,created_tx,created_at FROM baskets WHERE chain_id=$1 AND address=$2', [
        chainId,
        address,
      ]),
      this.db.query(
        'SELECT chain_id,basket_address,asset_address,target_weight_bps,updated_block FROM basket_assets WHERE chain_id=$1 AND basket_address=$2 ORDER BY asset_address',
        [chainId, address],
      ),
      this.db.query(
        "SELECT chain_id,basket_address,block_number,block_hash,block_timestamp,position_block_number,price_block_number,nav_usdc,kind,valuation_status,issue,observed_at FROM basket_nav_observations WHERE chain_id=$1 AND basket_address=$2 AND valuation_status='COMPLETE' ORDER BY block_number DESC, kind DESC LIMIT 1",
        [chainId, address],
      ),
      this.db.query(
        'SELECT DISTINCT ON (asset_address) * FROM basket_positions WHERE chain_id=$1 AND basket_address=$2 ORDER BY asset_address, block_number DESC',
        [chainId, address],
      ).catch(() => ({ rows: [] })),
    ]);

    let basketRow = basket.rows[0];
    if (!basketRow) {
      const createdEvt = await this.db.query(
        "SELECT chain_id,tx_hash,log_index,block_number,block_hash,basket_address,event_type,actor_address,payload,occurred_at FROM basket_events WHERE chain_id=$1 AND basket_address=$2 ORDER BY block_number ASC,log_index ASC LIMIT 1",
        [chainId, address],
      ).catch(() => ({ rows: [] }));

      if (createdEvt.rows && createdEvt.rows.length > 0) {
        const payload = typeof createdEvt.rows[0].payload === 'string'
          ? JSON.parse(createdEvt.rows[0].payload)
          : (createdEvt.rows[0].payload || {});

        const cleanName = payload.name || 'Basket Safe';
        const cleanSymbol = 'OTH';
        const controller = createdEvt.rows[0].actor_address || '0x0000000000000000000000000000000000000000';

        await this.db.query(
          `INSERT INTO baskets (chain_id, address, controller, name, symbol, created_block, created_tx, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT (chain_id, address) DO UPDATE SET name = EXCLUDED.name`,
          [
            chainId,
            address,
            controller,
            cleanName,
            cleanSymbol,
            createdEvt.rows[0].block_number || 1,
            createdEvt.rows[0].tx_hash || '0x0000000000000000000000000000000000000000000000000000000000000000',
          ],
        ).catch(() => null);

        basketRow = {
          chain_id: chainId,
          address,
          controller,
          name: cleanName,
          symbol: cleanSymbol,
          created_block: createdEvt.rows[0].block_number || 1,
          created_tx: createdEvt.rows[0].tx_hash || '0x0000000000000000000000000000000000000000000000000000000000000000',
          created_at: createdEvt.rows[0].occurred_at || new Date().toISOString(),
        };
      } else {
        throw new NotFoundException({ error: 'BASKET_NOT_FOUND' });
      }
    }

    return {
      data: {
        ...basketRow,
        assets: assets.rows,
        snapshot: snapshot.rows[0] ?? null,
        positions: positions.rows ?? [],
      },
    };
  }

  async getBasketActivity(addressInput: string, chainIdInput?: string) {
    const chainId = chainIdSchema.parse(chainIdInput);
    let address = addressInput.toLowerCase();

    if (/^0x[a-fA-F0-9]{64}$/.test(addressInput)) {
      const txLookup = await this.db.query(
        'SELECT address FROM baskets WHERE chain_id=$1 AND created_tx=$2 LIMIT 1',
        [chainId, addressInput.toLowerCase()],
      );
      if (txLookup.rows && txLookup.rows.length > 0) {
        address = txLookup.rows[0].address;
      }
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new NotFoundException({ error: 'BASKET_NOT_FOUND' });
    }
    address = address.toLowerCase();

    const result = await this.db.query(
      "SELECT chain_id,tx_hash,log_index,block_number,block_hash,basket_address,event_type,actor_address,payload,occurred_at FROM basket_events WHERE chain_id=$1 AND basket_address=$2 AND event_type != 'DEX_ROUTE_EXECUTED' ORDER BY block_number DESC, log_index DESC LIMIT 100",
      [chainId, address],
    );

    return { data: result.rows };
  }

  async getAllActivity(chainIdInput?: string) {
    const chainId = chainIdSchema.parse(chainIdInput);

    const result = await this.db.query(
      "SELECT chain_id,tx_hash,log_index,block_number,block_hash,basket_address,event_type,actor_address,payload,occurred_at FROM basket_events WHERE chain_id=$1 AND event_type != 'DEX_ROUTE_EXECUTED' ORDER BY block_number DESC, log_index DESC LIMIT 100",
      [chainId],
    );

    return { data: result.rows };
  }

  async getAssets(chainIdInput?: string | number) {
    return this.getAssetCatalog(chainIdInput);
  }

  private async getAssetCatalog(chainIdInput?: string | number) {
    const chainId = chainIdSchema.parse(String(chainIdInput ?? process.env.CHAIN_ID ?? '8453'));
    const key = `assets:${chainId}`;
    const cached = this.cached<AssetCatalogItem[]>(key);
    if (cached) return { data: cached };
    const result = await this.db.query(`SELECT DISTINCT ON (LOWER(apo.asset_address))
      $1::bigint AS chain_id, LOWER(apo.asset_address) AS asset_address, NULL::text AS symbol, NULL::text AS name,
      NULL::smallint AS decimals, apo.price_usd_e8::text, apo.block_number, TRIM(apo.block_hash) AS block_hash,
      apo.observed_at, CASE WHEN worker.last_success_at > NOW() - INTERVAL '60 seconds' AND worker.last_error IS NULL THEN 'FRESH' ELSE 'STALE' END AS status
      FROM asset_price_observations apo
      LEFT JOIN indexer_worker_state worker ON worker.chain_id=apo.chain_id AND worker.worker_name='prices'
      WHERE apo.chain_id=$1 ORDER BY LOWER(apo.asset_address), apo.block_number DESC`, [chainId]);
    const coinbase = await this.coinbaseMetadata.getAll();
    const additions = new Map(reviewedB20Additions(chainId, coinbase).map((config) => [config.tokenAddress.toLowerCase(), config]));
    const approved = new Set<string>();
    const registry = process.env.ASSET_REGISTRY_ADDRESS || process.env.OTHELIO_ASSET_REGISTRY;
    const indexedAdditions = result.rows.filter((row) => row.status === 'FRESH' && row.price_usd_e8 != null)
      .map((row) => additions.get(String(row.asset_address).trim().toLowerCase()))
      .filter((asset) => asset !== undefined);
    if (indexedAdditions.length && registry && isAddress(registry)) {
      const client = createPublicClient({ transport: http(rpcUrlForChain(chainId)) });
      const routeRegistry = await resolveBasketRouteRegistry(client);
      if (routeRegistry) {
        await Promise.allSettled(indexedAdditions.map(async (asset) => {
          const config = await client.readContract({
            address: getAddress(registry), abi: assetRegistryAbi, functionName: 'getAsset',
            args: [BigInt(chainId), asset.tokenAddress],
          });
          if (config.supported && config.isCoinbaseB20 && config.priceFeed.toLowerCase() === asset.feedAddress.toLowerCase() &&
              config.tokenDecimals === asset.tokenDecimals && config.feedDecimals === asset.feedDecimals &&
              await hasApprovedBasketRoute(client, routeRegistry, chainId, asset.tokenAddress)) {
            approved.add(asset.tokenAddress.toLowerCase());
          }
        }));
      }
    }
    const projectAsset = (row: Record<string, any>): AssetCatalogItem => {
      const address = String(row.asset_address).trim().toLowerCase();
      const fallback = this.assetMetadata(address) ?? additions.get(address);
      const metadata = fallback ? coinbase.get(address) : null;
      return assetCatalogItemSchema.parse({
        chainId, assetAddress: address,
        symbol: metadata?.symbol ?? fallback?.symbol ?? row.symbol,
        name: metadata?.name ?? fallback?.name ?? row.name,
        decimals: metadata?.decimals ?? (fallback && 'decimals' in fallback ? fallback.decimals : undefined) ??
          (row.decimals == null ? null : Number(row.decimals)),
        isin: metadata?.isin ?? null,
        description: metadata?.description ?? null,
        iconUrl: metadata?.iconUrl ?? null,
        multiplier: metadata?.multiplier ?? null,
        coinbaseFirstMintDate: metadata?.firstMintDate ?? null,
        coinbaseTotalSupply: metadata?.totalSupply ?? null,
        coinbaseNavPrice: metadata?.navPrice ?? null,
        coinbaseNavPriceUpdatedAt: metadata?.navPriceUpdatedAt ?? null,
        priceUsdE8: row.price_usd_e8 == null ? null : String(row.price_usd_e8),
        priceBlockNumber: row.block_number == null ? null : Number(row.block_number),
        priceBlockHash: row.block_hash ?? null,
        priceObservedAt: row.observed_at ? this.iso(row.observed_at) : null,
        status: row.status,
        tradeable: row.status !== 'UNAVAILABLE' && row.price_usd_e8 != null &&
          (additions.has(address) ? approved.has(address) : Boolean(fallback)),
      });
    };
    const indexed = result.rows.map(projectAsset);
    const indexedAddresses = new Set(indexed.map((asset) => asset.assetAddress));
    // Show known B20 identities without writing fictitious oracle observations.
    const staged = [...CONTRACT_B20_TOKENS, ...additions.keys()]
      .filter((address) => !indexedAddresses.has(address.toLowerCase()))
      .map((asset_address) => projectAsset({ asset_address, status: 'UNAVAILABLE' }));
    return { data: this.putCached(key, [...indexed, ...staged]) };
  }

  async quoteSwaps(basketAddress: string, body: BasketQuoteRequest) {
    return this.quotePlanner.quoteSwaps(basketAddress, body);
  }

  async recordLendingEvent(body: LendingEventRequest) {
    return this.lendingEvents.recordLendingEvent(body);
  }

  async clearAllBaskets() {
    try {
      await this.db.query('DELETE FROM lending_market_logs').catch(() => null);
      await this.db.query('DELETE FROM asset_cost_basis').catch(() => null);
      await this.db.query('DELETE FROM accounting_events').catch(() => null);
      await this.db.query('DELETE FROM basket_nav_observations');
      await this.db.query('DELETE FROM basket_positions');
      await this.db.query('DELETE FROM asset_price_observations');
      await this.db.query('DELETE FROM basket_events');
      await this.db.query('DELETE FROM basket_assets');
      await this.db.query('DELETE FROM baskets');
      return { success: true, message: 'All baskets wiped successfully' };
    } catch (err) {
      console.error('ERROR IN CLEAR_ALL_BASKETS:', err);
      throw err;
    }
  }
}
