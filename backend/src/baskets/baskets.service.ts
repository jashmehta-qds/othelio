import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { addressSchema, chainIdSchema } from '@othelio/shared';
import { createPublicClient, decodeEventLog, formatUnits, http, isHash, parseAbi } from 'viem';
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

  async computeLiveBasketSnapshot(basketAddress: string, chainId: number = 31337) {
    try {
      const rpcUrl = process.env.ANVIL_RPC_URL || 'http://127.0.0.1:8545';
      const client = createPublicClient({ transport: http(rpcUrl) });

      const safe = basketAddress.toLowerCase() as `0x${string}`;
      const abi = parseAbi(['function balanceOf(address) view returns (uint256)']);

      const assetList = [
        { symbol: 'NVDAc', address: '0xb20000000000000000000078ee7ce2fE4908108C', price: 125.40, decimals: 18 },
        { symbol: 'AAPLc', address: '0xb200000000000000000000C2e324d24d7eEcd1fb', price: 224.50, decimals: 18 },
        { symbol: 'MSFTc', address: '0xB200000000000000000000Ab99cFa739E253872B', price: 415.20, decimals: 18 },
        { symbol: 'GOOGLc', address: '0xb2000000000000000000002D0BA3164cc74f58B7', price: 175.00, decimals: 18 },
        { symbol: 'AMZNc', address: '0xb200000000000000000000d9192b6B456483C2E8', price: 180.00, decimals: 18 },
        { symbol: 'METAc', address: '0xb2000000000000000000008bC8786B856E61707C', price: 500.00, decimals: 18 },
        { symbol: 'TSLAc', address: '0xb2000000000000000000001e800a7f5189430cD0', price: 250.00, decimals: 18 },
        { symbol: 'COINc', address: '0xb200000000000000000000c85a31389D71F3ecfb', price: 200.00, decimals: 18 },
        { symbol: 'MSTRc', address: '0xb2000000000000000000004884b426556b92883d', price: 135.00, decimals: 18 },
        { symbol: 'CRCLc', address: '0xB20000000000000000000019f6E7C675b73C2e4D', price: 28.50, decimals: 18 },
        { symbol: 'INTCc', address: '0xB2000000000000000000004AFF16039bA04bdFBc', price: 31.20, decimals: 18 },
        { symbol: 'SNDKc', address: '0xb200000000000000000000397293Cb8cda9a10c5', price: 65.00, decimals: 18 },
        { symbol: 'SPCXc', address: '0xb2000000000000000000007b9fcbd005511aCBd5', price: 42.00, decimals: 18 },
        { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', price: 1.00, decimals: 6 },
      ];

      let totalNav = 0;
      const holdings: Record<string, any> = {};

      for (const ast of assetList) {
        try {
          const bal = await client.readContract({
            address: ast.address as `0x${string}`,
            abi,
            functionName: 'balanceOf',
            args: [safe],
          });
          if (bal > 0n) {
            const units = parseFloat(formatUnits(bal, ast.decimals));
            const val = units * ast.price;
            totalNav += val;
            holdings[ast.symbol] = { units, val, price: ast.price };
          }
        } catch (_) {}
      }

      const blockNumber = await client.getBlockNumber().then((b) => Number(b)).catch(() => 1);
      const snapshotObj = {
        total_nav_usdc: Number(totalNav.toFixed(6)),
        block_number: blockNumber,
        holdings,
      };

      await this.db.query(
        `INSERT INTO basket_snapshots (chain_id, basket_address, block_number, block_hash, total_nav_usdc, shares_outstanding, holdings, prices, priced_at)
         VALUES ($1, $2, $3, '0x0', $4, 0, $5, '{}', NOW())
         ON CONFLICT (chain_id, basket_address, block_number) DO UPDATE SET total_nav_usdc = EXCLUDED.total_nav_usdc`,
        [chainId, safe, blockNumber, snapshotObj.total_nav_usdc, JSON.stringify(holdings)],
      ).catch(() => null);

      return snapshotObj;
    } catch (e) {
      return null;
    }
  }

  async confirmRebalance(basketAddressInput: string, body: {
    chainId?: number;
    moduleAddress?: string;
    txHash?: string;
    targetWeights?: Array<{ assetAddress: string; targetWeightBps: number }>;
  }) {
    const chainId = chainIdSchema.parse(body.chainId);
    const basketAddress = addressSchema.parse(basketAddressInput).toLowerCase();
    const moduleAddress = addressSchema.parse(body.moduleAddress).toLowerCase();
    if (!body.txHash || !isHash(body.txHash)) throw new NotFoundException({ error: 'REBALANCE_TRANSACTION_NOT_FOUND' });

    const targets = (body.targetWeights ?? []).map((target) => ({
      assetAddress: addressSchema.parse(target.assetAddress).toLowerCase(),
      targetWeightBps: target.targetWeightBps,
    })).filter((target) => target.targetWeightBps > 0);
    if (
      targets.length === 0
      || new Set(targets.map((target) => target.assetAddress)).size !== targets.length
      || targets.some((target) => !Number.isInteger(target.targetWeightBps))
      || targets.reduce((sum, target) => sum + target.targetWeightBps, 0) !== 10_000
    ) {
      throw new NotFoundException({ error: 'INVALID_REBALANCE_TARGETS' });
    }

    const rpcUrl = chainId === 31337
      ? process.env.ANVIL_RPC_URL || process.env.RPC_URL || 'http://127.0.0.1:8545'
      : chainId === 8453
        ? process.env.BASE_RPC_URL || 'https://mainnet.base.org'
        : process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';
    const receipt = await createPublicClient({ transport: http(rpcUrl) })
      .getTransactionReceipt({ hash: body.txHash })
      .catch(() => null);
    if (!receipt || receipt.status !== 'success' || receipt.to?.toLowerCase() !== moduleAddress) {
      throw new NotFoundException({ error: 'REBALANCE_TRANSACTION_NOT_CONFIRMED' });
    }

    const eventAbi = parseAbi([
      'event BasketRebalanced(address indexed safe,address indexed controller,address[] soldAssets,uint256[] soldAmounts,address[] boughtAssets,uint256[] boughtAmounts,uint256 totalNAV)',
    ]);
    let matchingEvent: { boughtAssets: readonly `0x${string}`[] } | null = null;
    receipt.logs.some((log) => {
      if (log.address.toLowerCase() !== moduleAddress) return false;
      try {
        const decoded = decodeEventLog({ abi: eventAbi, data: log.data, topics: log.topics });
        if (decoded.eventName === 'BasketRebalanced' && decoded.args.safe.toLowerCase() === basketAddress) {
          matchingEvent = { boughtAssets: decoded.args.boughtAssets };
          return true;
        }
        return false;
      } catch {
        return false;
      }
    });
    if (!matchingEvent) throw new NotFoundException({ error: 'REBALANCE_EVENT_NOT_FOUND' });
    const targetSet = new Set(targets.map((target) => target.assetAddress));
    if ((matchingEvent as { boughtAssets: readonly `0x${string}`[] }).boughtAssets.some((asset) => !targetSet.has(asset.toLowerCase()))) {
      throw new NotFoundException({ error: 'REBALANCE_TARGETS_DO_NOT_MATCH_RECEIPT' });
    }

    const addresses = targets.map((target) => target.assetAddress);
    const weights = targets.map((target) => target.targetWeightBps);
    await this.db.query(
      `WITH upserted AS (
         INSERT INTO basket_assets (chain_id, basket_address, asset_address, target_weight_bps, updated_block)
         SELECT $1, $2, LOWER(asset_address), target_weight_bps, $5
         FROM UNNEST($3::text[], $4::int[]) AS target(asset_address, target_weight_bps)
         ON CONFLICT (chain_id, basket_address, asset_address) DO UPDATE
         SET target_weight_bps=EXCLUDED.target_weight_bps, updated_block=EXCLUDED.updated_block
         RETURNING asset_address
       )
       DELETE FROM basket_assets
       WHERE chain_id=$1 AND basket_address=$2 AND NOT (asset_address = ANY($3::text[]))`,
      [chainId, basketAddress, addresses, weights, receipt.blockNumber.toString()],
    );

    return { success: true, data: { basketAddress, txHash: body.txHash, targetWeights: targets } };
  }

  async getBaskets(chainIdInput?: string, controllerInput?: string) {
    try {
      const chainId = chainIdSchema.parse(chainIdInput || '31337');
      const controller = controllerInput
        ? addressSchema.parse(controllerInput).toLowerCase()
        : null;

      let sql = `
        SELECT b.*,
          COALESCE(
            (SELECT json_build_object(
                      'total_nav_usdc', CASE 
                        WHEN bs.total_nav_usdc > 0 THEN bs.total_nav_usdc
                        ELSE COALESCE((be.payload->>'inputAmount')::numeric / 1000000.0, 0)
                      END,
                      'block_number', bs.block_number
                    )
             FROM basket_snapshots bs
             LEFT JOIN basket_events be ON be.chain_id = bs.chain_id AND be.basket_address = bs.basket_address AND be.event_type = 'FUNDED'
             WHERE bs.chain_id = b.chain_id AND bs.basket_address = b.address
             ORDER BY bs.block_number DESC LIMIT 1),
            COALESCE(
              (SELECT json_build_object(
                        'total_nav_usdc', COALESCE((be.payload->>'inputAmount')::numeric / 1000000.0, 0),
                        'block_number', be.block_number
                      )
               FROM basket_events be
               WHERE be.chain_id = b.chain_id AND be.basket_address = b.address AND be.event_type = 'FUNDED'
               ORDER BY be.block_number DESC LIMIT 1),
              NULL
            )
          ) as snapshot,
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

      for (const row of result.rows) {
        const liveSnap = await this.computeLiveBasketSnapshot(row.address, chainId);
        if (liveSnap) {
          row.snapshot = liveSnap;
        }
      }

      return { data: result.rows };
    } catch (err) {
      console.error('ERROR IN GET_BASKETS:', err);
      throw err;
    }
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

      if (body.assets && body.assets.length > 0) {
        for (const asset of body.assets) {
          await this.db.query(
            `INSERT INTO basket_assets (chain_id, basket_address, asset_address, target_weight_bps, updated_block)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (chain_id, basket_address, asset_address) DO UPDATE SET target_weight_bps = EXCLUDED.target_weight_bps`,
            [chainId, address, asset.address.toLowerCase(), asset.targetWeightBps, createdBlock],
          );
        }
      }
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

    const [basket, assets, snapshot, positions, latestEvent] = await Promise.all([
      this.db.query('SELECT * FROM baskets WHERE chain_id=$1 AND address=$2', [
        chainId,
        address,
      ]),
      this.db.query(
        'SELECT * FROM basket_assets WHERE chain_id=$1 AND basket_address=$2 ORDER BY asset_address',
        [chainId, address],
      ),
      this.db.query(
        'SELECT * FROM basket_snapshots WHERE chain_id=$1 AND basket_address=$2 ORDER BY block_number DESC LIMIT 1',
        [chainId, address],
      ),
      this.db.query(
        'SELECT * FROM basket_positions WHERE chain_id=$1 AND basket_address=$2 ORDER BY asset_address',
        [chainId, address],
      ).catch(() => ({ rows: [] })),
      this.db.query(
        "SELECT * FROM basket_events WHERE chain_id=$1 AND basket_address=$2 AND event_type='FUNDED' ORDER BY block_number DESC LIMIT 1",
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

    let finalAssets = assets.rows;
    if (finalAssets.length === 0 && latestEvent.rows && latestEvent.rows.length > 0) {
      const payload = typeof latestEvent.rows[0].payload === 'string'
        ? JSON.parse(latestEvent.rows[0].payload)
        : (latestEvent.rows[0].payload || {});
      const boughtAssets: string[] = payload.boughtAssets || [];
      if (Array.isArray(boughtAssets) && boughtAssets.length > 0) {
        const weightBps = Math.floor(10000 / boughtAssets.length);
        const derived: any[] = [];
        for (const ast of boughtAssets) {
          const astAddr = String(ast).toLowerCase();
          await this.db.query(
            `INSERT INTO basket_assets (chain_id, basket_address, asset_address, target_weight_bps, updated_block)
             VALUES ($1, $2, $3, $4, 1)
             ON CONFLICT (chain_id, basket_address, asset_address) DO UPDATE SET target_weight_bps = EXCLUDED.target_weight_bps`,
            [chainId, address, astAddr, weightBps],
          ).catch(() => null);
          derived.push({
            chain_id: chainId,
            basket_address: address,
            asset_address: astAddr,
            target_weight_bps: weightBps,
          });
        }
        finalAssets = derived;
      }
    }

    const liveSnap = await this.computeLiveBasketSnapshot(address, chainId);

    return {
      data: {
        ...basketRow,
        assets: finalAssets,
        snapshot: liveSnap ?? snapshot.rows[0] ?? null,
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
      'SELECT * FROM basket_events WHERE chain_id=$1 AND basket_address=$2 ORDER BY block_number DESC, log_index DESC LIMIT 100',
      [chainId, address],
    );

    return { data: result.rows };
  }

  async getAllActivity(chainIdInput?: string) {
    const chainId = chainIdSchema.parse(chainIdInput);

    const result = await this.db.query(
      'SELECT * FROM basket_events WHERE chain_id=$1 ORDER BY block_number DESC, log_index DESC LIMIT 100',
      [chainId],
    );

    return { data: result.rows };
  }

  async getAssets() {
    return {
      data: [
        { symbol: "NVDAc", name: "NVIDIA Corp", address: "0xb20000000000000000000078ee7ce2fE4908108C", priceFeed: "0x04689a41629776563E6822F76f2e57D148d28513", price: 125.40, color: "#8aa4ff", isCoinbaseB20: true },
        { symbol: "AAPLc", name: "Apple Inc", address: "0xb200000000000000000000C2e324d24d7eEcd1fb", priceFeed: "0x787f13dEa48Db0897CbCDD985de77809D837F988", price: 224.50, color: "#5371d9", isCoinbaseB20: true },
        { symbol: "MSFTc", name: "Microsoft Corp", address: "0xB200000000000000000000Ab99cFa739E253872B", priceFeed: "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c", price: 415.20, color: "#858b87", isCoinbaseB20: true },
        { symbol: "GOOGLc", name: "Alphabet Inc", address: "0xb2000000000000000000002D0BA3164cc74f58B7", priceFeed: "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2", price: 175.00, color: "#6f8cff", isCoinbaseB20: true },
        { symbol: "AMZNc", name: "Amazon.com Inc", address: "0xb200000000000000000000d9192b6B456483C2E8", priceFeed: "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295", price: 180.00, color: "#b88a58", isCoinbaseB20: true },
        { symbol: "METAc", name: "Meta Platforms", address: "0xb2000000000000000000008bC8786B856E61707C", priceFeed: "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D", price: 500.00, color: "#4e7fff", isCoinbaseB20: true },
        { symbol: "TSLAc", name: "Tesla Inc", address: "0xb2000000000000000000001e800a7f5189430cD0", priceFeed: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4", price: 250.00, color: "#b16f83", isCoinbaseB20: true },
        { symbol: "COINc", name: "Coinbase Global", address: "0xb200000000000000000000c85a31389D71F3ecfb", priceFeed: "0x408e44f504A7371a345F03a73dDC96A4b48e8aa7", price: 200.00, color: "#0052ff", isCoinbaseB20: true },
        { symbol: "MSTRc", name: "MicroStrategy Inc", address: "0xb2000000000000000000004884b426556b92883d", priceFeed: "0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a", price: 135.00, color: "#d94141", isCoinbaseB20: true },
        { symbol: "CRCLc", name: "Circle Internet Financial", address: "0xB20000000000000000000019f6E7C675b73C2e4D", priceFeed: "0x0231cF2635D1E17bB5c2462cc7504Ba1fBd61f33", price: 28.50, color: "#2775ca", isCoinbaseB20: true },
        { symbol: "INTCc", name: "Intel Corp", address: "0xB2000000000000000000004AFF16039bA04bdFBc", priceFeed: "0xAB657C39bac0D5886250D70849e2E3E008F2EECB", price: 31.20, color: "#0071c5", isCoinbaseB20: true },
        { symbol: "SNDKc", name: "SanDisk Corp", address: "0xb200000000000000000000397293Cb8cda9a10c5", priceFeed: "0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA", price: 65.00, color: "#e2231a", isCoinbaseB20: true },
        { symbol: "SPCXc", name: "SpaceX (Destiny Tech100)", address: "0xb2000000000000000000007b9fcbd005511aCBd5", priceFeed: "0x6A634B235903C4ad6376892180d6fF8612e3Fa68", price: 42.00, color: "#3f4652", isCoinbaseB20: true },
        { symbol: "USDC", name: "USD Coin", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", priceFeed: "0x0000000000000000000000000000000000000000", price: 1.00, color: "#8daed0", isCoinbaseB20: false },
      ],
    };
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
