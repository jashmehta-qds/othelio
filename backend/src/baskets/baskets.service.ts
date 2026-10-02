import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { addressSchema, chainIdSchema } from '@othelio/shared';
import { DatabaseService } from '../database/database.service';
import { BasketQuotePlannerService, BasketQuoteRequest } from './basket-quote-planner.service';
import { LendingEventRequest, LendingEventService } from './lending-event.service';

@Injectable()
export class BasketsService {
  constructor(
    @Inject(DatabaseService)
    private readonly db: DatabaseService,
    @Inject(BasketQuotePlannerService)
    private readonly quotePlanner: BasketQuotePlannerService,
    @Inject(LendingEventService)
    private readonly lendingEvents: LendingEventService,
  ) {}

  async getBaskets(chainIdInput?: string, controllerInput?: string) {
    try {
      const chainId = chainIdSchema.parse(chainIdInput || '31337');
      const controller = controllerInput
        ? addressSchema.parse(controllerInput).toLowerCase()
        : null;

      let sql = `
        SELECT b.*,
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
            (SELECT json_agg(ba.*) 
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
       eligible_observations AS (
         SELECT bno.basket_address, bno.block_number, bno.block_timestamp AS observed_at, bno.nav_usdc
         FROM basket_nav_observations bno
         JOIN owner_baskets ob ON ob.address = bno.basket_address
         WHERE bno.chain_id = $1
           AND bno.valuation_status = 'COMPLETE'
           AND bno.nav_usdc IS NOT NULL
           AND bno.block_timestamp <= NOW()
       ),
       latest_before_window AS (
         SELECT DISTINCT ON (basket_address)
           basket_address, block_number, observed_at, nav_usdc
         FROM eligible_observations
         WHERE observed_at < $3
         ORDER BY basket_address, observed_at DESC, block_number DESC
       ),
       observation_candidates AS (
         SELECT basket_address, block_number, observed_at, nav_usdc
         FROM eligible_observations
         WHERE observed_at >= $3
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
         SELECT eo.nav_usdc, eo.block_number
         FROM eligible_observations eo
         WHERE eo.basket_address = ob.address
           AND eo.observed_at <= timeline.observed_at
         ORDER BY eo.observed_at DESC, eo.block_number DESC
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
      blockHash: String(row.block_hash), occurredAt: new Date(String(row.occurred_at)).toISOString(), kind: String(row.kind),
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

    } catch (err) {
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
      this.db.query('SELECT * FROM baskets WHERE chain_id=$1 AND address=$2', [
        chainId,
        address,
      ]),
      this.db.query(
        'SELECT * FROM basket_assets WHERE chain_id=$1 AND basket_address=$2 ORDER BY asset_address',
        [chainId, address],
      ),
      this.db.query(
        "SELECT * FROM basket_nav_observations WHERE chain_id=$1 AND basket_address=$2 AND valuation_status='COMPLETE' ORDER BY block_number DESC LIMIT 1",
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
        "SELECT * FROM basket_events WHERE chain_id=$1 AND basket_address=$2 ORDER BY block_number ASC LIMIT 1",
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
      "SELECT * FROM basket_events WHERE chain_id=$1 AND basket_address=$2 AND event_type != 'DEX_ROUTE_EXECUTED' ORDER BY block_number DESC, log_index DESC LIMIT 100",
      [chainId, address],
    );

    return { data: result.rows };
  }

  async getAllActivity(chainIdInput?: string) {
    const chainId = chainIdSchema.parse(chainIdInput);

    const result = await this.db.query(
      "SELECT * FROM basket_events WHERE chain_id=$1 AND event_type != 'DEX_ROUTE_EXECUTED' ORDER BY block_number DESC, log_index DESC LIMIT 100",
      [chainId],
    );

    return { data: result.rows };
  }

  private readonly assetPricesCache = new Map<number, { timestamp: number; data: any[] }>();
  private readonly ASSET_PRICE_CACHE_TTL_MS = 60 * 1000; // 1-minute TTL

  async getAssets(chainIdInput?: string | number) {
    const chainId = chainIdInput ? Number(chainIdInput) : Number(process.env.CHAIN_ID || 8453);
    const now = Date.now();
    const cached = this.assetPricesCache.get(chainId);
    if (cached && now - cached.timestamp < this.ASSET_PRICE_CACHE_TTL_MS) {
      return { data: cached.data };
    }

    const staticAssets = [
      { symbol: 'AAPLc', name: 'Apple Inc', address: '0xb200000000000000000000C2e324d24d7eEcd1fb', priceFeed: '0x787f13dEa48Db0897CbCDD985de77809D837F988', defaultPrice: 224.50, color: '#5371d9', isCoinbaseB20: true },
      { symbol: 'AMZNc', name: 'Amazon.com Inc', address: '0xb200000000000000000000d9192b6B456483C2E8', priceFeed: '0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295', defaultPrice: 180.00, color: '#e6a663', isCoinbaseB20: true },
      { symbol: 'GOOGLc', name: 'Alphabet Inc', address: '0xb2000000000000000000002D0BA3164cc74f58B7', priceFeed: '0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2', defaultPrice: 175.00, color: '#6f8cff', isCoinbaseB20: true },
      { symbol: 'METAc', name: 'Meta Platforms', address: '0xb2000000000000000000008bC8786B856E61707C', priceFeed: '0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D', defaultPrice: 500.00, color: '#89b6f8', isCoinbaseB20: true },
      { symbol: 'MSFTc', name: 'Microsoft Corp', address: '0xb200000000000000000000Ab99cFa739E253872B', priceFeed: '0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c', defaultPrice: 415.20, color: '#71bfac', isCoinbaseB20: true },
      { symbol: 'MSTRc', name: 'Strategy Inc', address: '0xb2000000000000000000004884b426556b92883d', priceFeed: '0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a', defaultPrice: 135.00, color: '#d595db', isCoinbaseB20: true },
      { symbol: 'NVDAc', name: 'NVIDIA Corp', address: '0xb20000000000000000000078ee7ce2fE4908108C', priceFeed: '0x04689a41629776563E6822F76f2e57D148d28513', defaultPrice: 125.40, color: '#8aa4ff', isCoinbaseB20: true },
      { symbol: 'USDC', name: 'USD Coin', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', priceFeed: '0x0000000000000000000000000000000000000000', defaultPrice: 1.00, color: '#8daed0', isCoinbaseB20: false },
    ];

    const livePriceMap = new Map<string, number>();
    try {
      const priceRows = await this.db.query(
        `SELECT DISTINCT ON (LOWER(asset_address))
           LOWER(asset_address) AS asset_address,
           price_usd_e8
         FROM asset_price_observations
         WHERE chain_id = $1
         ORDER BY LOWER(asset_address), observed_at DESC`,
        [chainId],
      );
      for (const row of priceRows.rows) {
        if (row.price_usd_e8) {
          livePriceMap.set(row.asset_address.toLowerCase(), Number(row.price_usd_e8) / 1e8);
        }
      }
    } catch {
      // Fallback to default prices if DB query is unavailable
    }

    const data = staticAssets.map((asset) => {
      const livePrice = livePriceMap.get(asset.address.toLowerCase());
      const price = livePrice !== undefined && livePrice > 0 ? livePrice : asset.defaultPrice;
      return {
        symbol: asset.symbol,
        name: asset.name,
        address: asset.address,
        priceFeed: asset.priceFeed,
        price,
        color: asset.color,
        isCoinbaseB20: asset.isCoinbaseB20,
      };
    });

    this.assetPricesCache.set(chainId, { timestamp: now, data });
    return { data };
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
