import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { UpsideService } from '../../upside/upside.service';
import {
  AdminTransactionPreview,
  AdminUpsideMarketItem,
  AdminUpsideRoundItem,
  AdminUpsideRoundPreviewRequest,
  AdminUpsideRoundPreviewResponse,
  AdminUpsideStrikePreview,
  TOKEN_FEED_REGISTRY,
  upsideFactoryAbi,
} from '@othelio/shared';
import {
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  getAddress,
  isAddress,
  parseAbi,
} from 'viem';
import { rpcTransportForChain } from '../../config/network-runtime';

const CHAINLINK_AGGREGATOR_ABI = parseAbi([
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() view returns (uint8)',
]);

@Injectable()
export class AdminUpsideService {
  private readonly logger = new Logger(AdminUpsideService.name);

  constructor(
    @Optional() private readonly db?: DatabaseService,
    @Optional() private readonly upsideService?: UpsideService,
  ) {}

  private createClient(chainId: number) {
    const transport = rpcTransportForChain(chainId);
    if (!transport) return null;
    return createPublicClient({ transport });
  }

  getFactoryAddress(chainId: number): `0x${string}` {
    const envAddr = process.env.UPSIDE_FACTORY_ADDRESS?.trim();
    if (envAddr && isAddress(envAddr) && !/^0x0{40}$/i.test(envAddr)) {
      return getAddress(envAddr);
    }
    throw new ServiceUnavailableException(`Upside factory is not configured for chain ${chainId}. Deploy it and set UPSIDE_FACTORY_ADDRESS.`);
  }

  getAdapterAddress(chainId: number): `0x${string}` {
    const envAddr = process.env.UPSIDE_SETTLEMENT_ADAPTER_ADDRESS?.trim();
    if (envAddr && isAddress(envAddr) && !/^0x0{40}$/i.test(envAddr)) {
      return getAddress(envAddr);
    }
    throw new ServiceUnavailableException(`Upside adapter is not configured for chain ${chainId}. Deploy it and set UPSIDE_SETTLEMENT_ADAPTER_ADDRESS.`);
  }

  async previewRound(dto: AdminUpsideRoundPreviewRequest): Promise<AdminUpsideRoundPreviewResponse> {
    const chainId = dto.chainId || 8453;
    const nowSecs = Math.floor(Date.now() / 1000);
    if (dto.expiryTimestamp <= nowSecs) {
      throw new BadRequestException('Expiry timestamp must be strictly in the future');
    }
    const factoryAddress = this.getFactoryAddress(chainId);
    const adapterAddress = this.getAdapterAddress(chainId);
    const client = this.createClient(chainId);
    if (!client) throw new ServiceUnavailableException(`No RPC configured for chain ${chainId}`);
    for (const [label, address] of [['Upside factory', factoryAddress], ['Upside adapter', adapterAddress]] as const) {
      let code: string | undefined;
      try {
        code = await client.getCode({ address });
      } catch {
        throw new ServiceUnavailableException(`Could not verify ${label} deployment on chain ${chainId}. Check the configured RPC.`);
      }
      if (!code || code === '0x') {
        throw new ServiceUnavailableException(`${label} at ${address} has no contract code on chain ${chainId}. Check the configured deployment address.`);
      }
    }
    const underlyingNorm = dto.underlying.toLowerCase();

    // Verify token catalog
    const config = Object.values(TOKEN_FEED_REGISTRY).find(
      (c) => c.tokenAddress.toLowerCase() === underlyingNorm,
    );

    const underlyingAddress = config ? getAddress(config.tokenAddress) : getAddress(dto.underlying);
    const symbol = config?.symbol || 'ASSET';
    const decimals = config?.tokenDecimals || 8;
    const feedAddress = config?.feedAddress || '0x0000000000000000000000000000000000000000';

    let referenceRoundId = '100';
    let referencePriceBig = 500_00000000n; // $500 default
    let referenceTime = Math.floor(Date.now() / 1000);

    // Try reading live Chainlink feed
    if (client && feedAddress && feedAddress !== '0x0000000000000000000000000000000000000000') {
      try {
        const roundData = await client.readContract({
          address: getAddress(feedAddress),
          abi: CHAINLINK_AGGREGATOR_ABI,
          functionName: 'latestRoundData',
        });
        if (roundData[1] > 0n) {
          referenceRoundId = roundData[0].toString();
          referencePriceBig = roundData[1];
          referenceTime = Number(roundData[3]);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message.replace(/https?:\/\/[^\s)\]}]+/g, '[RPC URL]').slice(0, 500) : 'Unknown RPC error';
        this.logger.warn(`Failed reading live Chainlink feed ${feedAddress}: ${reason}`);
      }
    }

    // Or check DB price observations
    if (this.db) {
      try {
        const dbRes = await this.db.query(
          `SELECT price_usd_e8, observed_at FROM asset_price_observations
           WHERE chain_id = $1 AND LOWER(asset_address) = $2
           ORDER BY observed_at DESC LIMIT 1`,
          [chainId, underlyingNorm],
        );
        if (dbRes?.rows?.[0]) {
          referencePriceBig = BigInt(dbRes.rows[0].price_usd_e8);
          referenceTime = Math.floor(new Date(dbRes.rows[0].observed_at).getTime() / 1000);
        }
      } catch (err) {
        this.logger.warn(`Failed DB query for asset price: ${err}`);
      }
    }

    // Calendar check: Expiry must be in future

    // Default expected move: 5% of reference price, rounded to 1e8 ($1.00)
    let expectedMoveBig: bigint;
    if (dto.expectedMove) {
      expectedMoveBig = BigInt(dto.expectedMove);
    } else {
      expectedMoveBig = (referencePriceBig * 5n) / 100n;
      // Round to nearest dollar (1e8)
      expectedMoveBig = (expectedMoveBig / 100000000n) * 100000000n;
      if (expectedMoveBig <= 0n) expectedMoveBig = 500000000n; // $5.00 min
    }

    const strikeTickBig = dto.strikeTick ? BigInt(dto.strikeTick) : 100000000n; // $1.00
    const minStrikeBig = dto.minStrike
      ? BigInt(dto.minStrike)
      : referencePriceBig > expectedMoveBig * 2n
      ? referencePriceBig - expectedMoveBig * 2n
      : referencePriceBig / 2n;
    const maxStrikeBig = dto.maxStrike ? BigInt(dto.maxStrike) : referencePriceBig + expectedMoveBig * 4n;

    // Calculate 4 standard strikes:
    // 1. Starting price: K0 = P0
    // 2. Reach: K1 = P0 + 0.5 * expectedMove
    // 3. Strong move: K2 = P0 + 1.0 * expectedMove
    // 4. Long shot: K3 = P0 + 2.0 * expectedMove
    const k0 = referencePriceBig;
    const k1 = referencePriceBig + expectedMoveBig / 2n;
    const k2 = referencePriceBig + expectedMoveBig;
    const k3 = referencePriceBig + expectedMoveBig * 2n;

    const strikes: AdminUpsideStrikePreview[] = [
      {
        targetLabel: 'Starting price',
        strikePrice: k0.toString(),
        strikePriceFormatted: (Number(k0) / 1e8).toFixed(2),
      },
      {
        targetLabel: 'Reach',
        strikePrice: k1.toString(),
        strikePriceFormatted: (Number(k1) / 1e8).toFixed(2),
      },
      {
        targetLabel: 'Strong move',
        strikePrice: k2.toString(),
        strikePriceFormatted: (Number(k2) / 1e8).toFixed(2),
      },
      {
        targetLabel: 'Long shot',
        strikePrice: k3.toString(),
        strikePriceFormatted: (Number(k3) / 1e8).toFixed(2),
      },
    ];

    const roundStart = dto.roundStart || nowSecs;
    const provenanceHash = `0x${'a'.repeat(64)}` as `0x${string}`;

    // Round configuration tuple for UpsideFactory.registerRound
    const roundConfig = {
      underlying: underlyingAddress,
      feed: getAddress(feedAddress),
      adapter: adapterAddress,
      referenceRoundId: BigInt(referenceRoundId),
      referencePrice: referencePriceBig,
      referenceTime: BigInt(referenceTime),
      roundStart: BigInt(roundStart),
      expiryTimestamp: BigInt(dto.expiryTimestamp),
      expectedMove: expectedMoveBig,
      provenanceHash,
      strikeTick: strikeTickBig,
      minStrike: minStrikeBig,
      maxStrike: maxStrikeBig,
      publicCreationEnabled: Boolean(dto.publicCreationEnabled),
    };

    encodeFunctionData({
      abi: upsideFactoryAbi,
      functionName: 'registerRound',
      args: [roundConfig],
    });

    const transactions: AdminTransactionPreview[] = [
      {
        description: `Register Upside Round: ${symbol} expiring ${new Date(dto.expiryTimestamp * 1000).toISOString().slice(0, 10)} (P0: $${(Number(referencePriceBig) / 1e8).toFixed(2)}, expectedMove: $${(Number(expectedMoveBig) / 1e8).toFixed(2)})`,
        target: factoryAddress,
        chainId,
        method: 'registerRound',
        args: [Object.fromEntries(
          Object.entries(roundConfig).map(([key, value]) => [key, typeof value === 'bigint' ? value.toString() : value]),
        )],
        expectedState: 'totalRounds increments by 1',
      },
    ];

    // Calendar check (e.g. standard equity expiry window ~ 16:00 ET)
    const expiryDate = new Date(dto.expiryTimestamp * 1000);
    const dayOfWeek = expiryDate.getUTCDay(); // 0 = Sun, 6 = Sat
    let calendarValid = true;
    let calendarNote: string | undefined;

    if (dayOfWeek === 0 || dayOfWeek === 6) {
      calendarValid = false;
      calendarNote = 'Selected expiry falls on a weekend when US equity markets and Chainlink stock feeds are closed.';
    }

    return {
      underlying: {
        address: underlyingAddress,
        symbol,
        decimals,
        feedAddress,
      },
      referencePrice: referencePriceBig.toString(),
      referencePriceFormatted: (Number(referencePriceBig) / 1e8).toFixed(2),
      referenceRoundId,
      referenceTime,
      expectedMove: expectedMoveBig.toString(),
      expectedMoveFormatted: (Number(expectedMoveBig) / 1e8).toFixed(2),
      roundStart,
      expiryTimestamp: dto.expiryTimestamp,
      expiryIso: expiryDate.toISOString(),
      calendarCheck: {
        valid: calendarValid,
        sessionCloseDeltaMinutes: 0,
        note: calendarNote,
      },
      strikes,
      minStrike: minStrikeBig.toString(),
      maxStrike: maxStrikeBig.toString(),
      strikeTick: strikeTickBig.toString(),
      publicCreationEnabled: Boolean(dto.publicCreationEnabled),
      factoryAddress,
      transactions,
    };
  }

  async getRounds(chainIdInput = 8453): Promise<AdminUpsideRoundItem[]> {
    const chainId = Number(chainIdInput);
    const nowSecs = Math.floor(Date.now() / 1000);

    if (this.db) {
      try {
        const query = `
          SELECT r.*,
                 COUNT(m.series_address)::int as markets_count
          FROM upside_rounds r
          LEFT JOIN upside_markets m ON r.chain_id = m.chain_id AND r.round_id = m.round_id
          WHERE r.chain_id = $1
          GROUP BY r.chain_id, r.round_id
          ORDER BY r.round_id DESC
        `;
        const res = await this.db.query(query, [chainId]);
        if (res?.rows) {
          const items: AdminUpsideRoundItem[] = [];
          for (const row of res.rows) {
            const underlyingAddr = (row.underlying_address || '').toLowerCase();
            const config = Object.values(TOKEN_FEED_REGISTRY).find(
              (c) => c.tokenAddress.toLowerCase() === underlyingAddr,
            );
            const symbol = config?.symbol || 'ASSET';
            const decimals = config?.tokenDecimals || 8;
            const expiry = Number(row.expiry_timestamp);

            const marketsRes = await this.db.query(
              `SELECT * FROM upside_markets WHERE chain_id = $1 AND round_id = $2 ORDER BY strike_price ASC`,
              [chainId, row.round_id],
            );

            const markets: AdminUpsideMarketItem[] = (marketsRes.rows || []).map((m: any) => ({
              seriesAddress: m.series_address,
              roundId: Number(m.round_id),
              strikePrice: m.strike_price.toString(),
              strikePriceFormatted: (Number(m.strike_price) / 1e8).toFixed(2),
              expiryTimestamp: expiry,
              expiryIso: new Date(expiry * 1000).toISOString(),
              isSettled: Boolean(m.is_settled),
              settledPriceFormatted: m.settled_price ? (Number(m.settled_price) / 1e8).toFixed(2) : null,
              upsideTokenAddress: m.upside_token_address,
              residualTokenAddress: m.residual_token_address,
              creatorAddress: m.creator_address,
              createdAt: new Date(m.created_at).toISOString(),
            }));

            items.push({
              roundId: Number(row.round_id),
              chainId,
              factoryAddress: row.factory_address,
              underlying: {
                address: row.underlying_address,
                symbol,
                decimals,
              },
              referencePriceFormatted: (Number(row.reference_price) / 1e8).toFixed(2),
              expectedMoveFormatted: (Number(row.expected_move) / 1e8).toFixed(2),
              expiryTimestamp: expiry,
              expiryIso: new Date(expiry * 1000).toISOString(),
              isExpired: nowSecs >= expiry,
              isSettled: Boolean(row.is_settled),
              marketsCount: Number(row.markets_count || 0),
              publicCreationEnabled: Boolean(row.public_creation_enabled),
              markets,
              createdAt: new Date(row.created_at).toISOString(),
            });
          }
          return items;
        }
      } catch (err) {
        this.logger.warn(`Failed DB query for admin upside rounds: ${err}`);
      }
    }

    return [];
  }

  async getMarkets(chainIdInput = 8453, roundId?: number): Promise<AdminUpsideMarketItem[]> {
    const chainId = Number(chainIdInput);

    if (this.db) {
      try {
        let query = `SELECT * FROM upside_markets WHERE chain_id = $1`;
        const params: any[] = [chainId];
        if (roundId !== undefined) {
          query += ` AND round_id = $2`;
          params.push(roundId);
        }
        query += ` ORDER BY round_id DESC, strike_price ASC`;

        const res = await this.db.query(query, params);
        if (res?.rows) {
          return res.rows.map((m: any) => ({
            seriesAddress: m.series_address,
            roundId: Number(m.round_id),
            strikePrice: m.strike_price.toString(),
            strikePriceFormatted: (Number(m.strike_price) / 1e8).toFixed(2),
            expiryTimestamp: Number(m.expiry_timestamp),
            expiryIso: new Date(Number(m.expiry_timestamp) * 1000).toISOString(),
            isSettled: Boolean(m.is_settled),
            settledPriceFormatted: m.settled_price ? (Number(m.settled_price) / 1e8).toFixed(2) : null,
            upsideTokenAddress: m.upside_token_address,
            residualTokenAddress: m.residual_token_address,
            creatorAddress: m.creator_address,
            createdAt: new Date(m.created_at).toISOString(),
          }));
        }
      } catch (err) {
        this.logger.warn(`Failed DB query for admin upside markets: ${err}`);
      }
    }

    return [];
  }

  togglePublicCreationTx(chainId: number, roundId: number, enabled: boolean): AdminTransactionPreview {
    const factoryAddress = this.getFactoryAddress(chainId);
    const txData = encodeFunctionData({
      abi: upsideFactoryAbi,
      functionName: 'setPublicCreationEnabled',
      args: [BigInt(roundId), enabled],
    });

    return {
      description: `${enabled ? 'Enable' : 'Disable'} public strike creation for Round #${roundId}`,
      target: factoryAddress,
      chainId,
      method: 'setPublicCreationEnabled',
      args: [roundId, enabled],
      expectedState: `Round #${roundId} publicCreationEnabled == ${enabled}`,
    };
  }
}
