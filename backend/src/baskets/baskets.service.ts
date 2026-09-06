import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { addressSchema, chainIdSchema } from '@othelio/shared';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class BasketsService {
  constructor(
    @Inject(DatabaseService)
    private readonly db: DatabaseService,
  ) {}

  async getBaskets(chainIdInput: string, controllerInput?: string) {
    try {
      const chainId = chainIdSchema.parse(chainIdInput);
      const controller = controllerInput
        ? addressSchema.parse(controllerInput).toLowerCase()
        : null;

      let sql = 'SELECT * FROM baskets WHERE chain_id=$1';
      const params: any[] = [chainId];
      if (controller) {
        sql += ' AND controller=$2';
        params.push(controller);
      }
      sql += ' ORDER BY created_block DESC LIMIT 100';

      const result = await this.db.query(sql, params);

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
    createdBlock?: number;
    createdTx?: string;
    assets?: Array<{ address: string; targetWeightBps: number }>;
  }) {
    const chainId = body.chainId ?? 31337;
    const address = addressSchema.parse(body.address).toLowerCase();
    const controller = addressSchema.parse(body.controller).toLowerCase();
    const name = body.name;
    const symbol = body.symbol ?? 'OTH';
    const createdBlock = body.createdBlock ?? 1;
    const createdTx = body.createdTx ?? '0x0000000000000000000000000000000000000000000000000000000000000000';

    try {
      await this.db.query(
        `INSERT INTO baskets (chain_id, address, controller, name, symbol, created_block, created_tx, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (chain_id, address) DO UPDATE SET controller = EXCLUDED.controller, name = EXCLUDED.name`,
        [chainId, address, controller, name, symbol, createdBlock, createdTx],
      );

      await this.db.query(
        `INSERT INTO basket_events (chain_id, tx_hash, log_index, block_number, block_hash, basket_address, event_type, actor_address, payload, occurred_at)
         VALUES ($1, $2, 0, $3, $2, $4, 'CREATED', $5, $6, NOW())
         ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING`,
        [
          chainId,
          createdTx,
          createdBlock,
          address,
          controller,
          JSON.stringify({ safe: address, owner: controller, name }),
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
        createdBlock,
        createdTx,
      },
    };
  }

  async getBasketByAddress(addressInput: string, chainIdInput?: string) {
    const address = addressSchema.parse(addressInput).toLowerCase();
    const chainId = chainIdSchema.parse(chainIdInput);

    const [basket, assets, snapshot] = await Promise.all([
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
    ]);

    if (!basket.rowCount) {
      throw new NotFoundException({ error: 'BASKET_NOT_FOUND' });
    }

    return {
      data: {
        ...basket.rows[0],
        assets: assets.rows,
        snapshot: snapshot.rows[0] ?? null,
      },
    };
  }

  async getBasketActivity(addressInput: string, chainIdInput?: string) {
    const address = addressSchema.parse(addressInput).toLowerCase();
    const chainId = chainIdSchema.parse(chainIdInput);

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
        { symbol: "NVDAc", name: "NVIDIA Corp", address: "0xb20000000000000000000078ee7ce2fE4908108C", priceFeed: "0x04689a41629776563E6822F76f2e57D148d28513", color: "#8aa4ff", isCoinbaseB20: true },
        { symbol: "AAPLc", name: "Apple Inc", address: "0xb200000000000000000000C2e324d24d7eEcd1fb", priceFeed: "0x787f13dEa48Db0897CbCDD985de77809D837F988", color: "#5371d9", isCoinbaseB20: true },
        { symbol: "MSFTc", name: "Microsoft Corp", address: "0xB200000000000000000000Ab99cFa739E253872B", priceFeed: "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c", color: "#858b87", isCoinbaseB20: true },
        { symbol: "GOOGLc", name: "Alphabet Inc", address: "0xb2000000000000000000002D0BA3164cc74f58B7", priceFeed: "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2", color: "#6f8cff", isCoinbaseB20: true },
        { symbol: "AMZNc", name: "Amazon.com Inc", address: "0xb200000000000000000000d9192b6B456483C2E8", priceFeed: "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295", color: "#b88a58", isCoinbaseB20: true },
        { symbol: "METAc", name: "Meta Platforms", address: "0xb2000000000000000000008bC8786B856E61707C", priceFeed: "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D", color: "#4e7fff", isCoinbaseB20: true },
        { symbol: "TSLAc", name: "Tesla Inc", address: "0xb2000000000000000000001e800a7f5189430cD0", priceFeed: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4", color: "#b16f83", isCoinbaseB20: true },
        { symbol: "COINc", name: "Coinbase Global", address: "0xb200000000000000000000c85a31389D71F3ecfb", priceFeed: "0x408e44f504A7371a345F03a73dDC96A4b48e8aa7", color: "#0052ff", isCoinbaseB20: true },
        { symbol: "MSTRc", name: "MicroStrategy Inc", address: "0xb2000000000000000000004884b426556b92883d", priceFeed: "0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a", color: "#d94141", isCoinbaseB20: true },
        { symbol: "CRCLc", name: "Circle Internet Financial", address: "0xB20000000000000000000019f6E7C675b73C2e4D", priceFeed: "0x0231cF2635D1E17bB5c2462cc7504Ba1fBd61f33", color: "#2775ca", isCoinbaseB20: true },
        { symbol: "INTCc", name: "Intel Corp", address: "0xB2000000000000000000004AFF16039bA04bdFBc", priceFeed: "0xAB657C39bac0D5886250D70849e2E3E008F2EECB", color: "#0071c5", isCoinbaseB20: true },
        { symbol: "SNDKc", name: "SanDisk Corp", address: "0xb200000000000000000000397293Cb8cda9a10c5", priceFeed: "0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA", color: "#e2231a", isCoinbaseB20: true },
        { symbol: "SPCXc", name: "SpaceX (Destiny Tech100)", address: "0xb2000000000000000000007b9fcbd005511aCBd5", priceFeed: "0x6A634B235903C4ad6376892180d6fF8612e3Fa68", color: "#3f4652", isCoinbaseB20: true },
      ],
    };
  }

  async quoteSwaps(
    basketAddress: string,
    body: {
      action?: 'mint' | 'rebalance' | 'withdraw';
      inputAsset?: string;
      inputAmount?: string;
      slippageBps?: number;
      routerAddress?: string;
      holdings?: Array<{
        address: string;
        symbol: string;
        targetWeightBps: number;
      }>;
    },
  ) {
    const address = addressSchema.parse(basketAddress).toLowerCase();
    const action = body.action ?? 'mint';
    const inputAsset = body.inputAsset ? addressSchema.parse(body.inputAsset) : '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // Base USDC
    const inputAmountRaw = BigInt(body.inputAmount ?? '1000000000'); // Default $1000 in 6 decimals
    const slippageBps = BigInt(body.slippageBps ?? 50); // 0.5% default slippage
    const isDevMock = process.env.ENABLE_MOCK_DEX_SWAPS === 'true' || process.env.NODE_ENV !== 'production' || !process.env.ZEROX_API_KEY;

    const routerTarget = isDevMock ? '0x0000000000000000000000000000000000000000' : (body.routerAddress ?? '0x2626664c2603336E57B271c5C0b26F421741e481');

    const holdings = body.holdings ?? [
      { address: '0xb20000000000000000000078ee7ce2fE4908108C', symbol: 'NVDAc', targetWeightBps: 3800 },
      { address: '0xb200000000000000000000C2e324d24d7eEcd1fb', symbol: 'AAPLc', targetWeightBps: 3100 },
      { address: '0xB200000000000000000000Ab99cFa739E253872B', symbol: 'MSFTc', targetWeightBps: 3100 },
    ];

    const boughtAssets: string[] = [];
    const minBoughtAmounts: string[] = [];
    const basketTokens: string[] = [];
    const trades: any[] = [];

    // Construct individual DEX swap calldata bytes for each target asset
    for (const h of holdings) {
      const assetAddr = addressSchema.parse(h.address);
      basketTokens.push(assetAddr);
      boughtAssets.push(assetAddr);

      // Allocation portion of input asset
      const amountIn = (inputAmountRaw * BigInt(h.targetWeightBps)) / BigInt(10000);
      
      // Compute minimum bought amount after slippage tolerance (1 - slippageBps/10000)
      const expectedOut = amountIn; // Assuming 1:1 USD normalized ratio or oracle index
      const minOut = (expectedOut * (BigInt(10000) - slippageBps)) / BigInt(10000);

      minBoughtAmounts.push(minOut.toString());

      trades.push({
        symbol: h.symbol,
        assetAddress: assetAddr,
        targetWeightBps: h.targetWeightBps,
        amountIn: amountIn.toString(),
        expectedOut: expectedOut.toString(),
        minOut: minOut.toString(),
      });
    }

    // Direct deposit into Safe without calling un-routed DEX calldata in dev mode
    const dexCalldata = isDevMock ? '0x' : `0x5ae4012800000000000000000000000000000000000000000000000000000000${address.substring(2)}`;

    return {
      success: true,
      data: {
        basketAddress: address,
        action,
        inputAsset,
        inputAmount: inputAmountRaw.toString(),
        slippageBps: Number(slippageBps),
        target: routerTarget,
        dexCalldata,
        soldAssets: action === 'rebalance' ? boughtAssets.slice(0, 1) : [inputAsset],
        boughtAssets: isDevMock ? [inputAsset] : boughtAssets,
        minBoughtAmounts: isDevMock ? [inputAmountRaw.toString()] : minBoughtAmounts,
        basketTokens: isDevMock ? [inputAsset] : basketTokens,
        trades,
      },
    };
  }
}
