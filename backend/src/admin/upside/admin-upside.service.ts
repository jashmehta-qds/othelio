import { BadRequestException, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import {
  type AdminTransactionPreview,
  type AdminUpsideMarketItem,
  type AdminUpsideRoundItem,
  type AdminUpsideRoundPreviewRequest,
  type AdminUpsideRoundPreviewResponse,
  assetRegistryAbi,
  gridCeil,
  gridFloor,
  TOKEN_FEED_REGISTRY,
  upsideFactoryAbi,
  upsideFixingAdapterAbi,
  upsidePresetStrikes,
} from '@othelio/shared';
import { createPublicClient, encodeFunctionData, getAddress, http, isAddress, maxUint256, zeroAddress, zeroHash } from 'viem';
import { rpcUrlForChain } from '../../config/network-runtime';
import { adminContracts, settlementAdapterForFeed } from '../admin-deployment';
import { adminTokenAbi, readAdminFeed } from '../admin-oracle';
import { validateWeeklyUpsideExpiry } from '../markets/calendar.util';

function positiveAmount(value: string | undefined, fallback: bigint): bigint {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[0-9]{1,78}$/.test(value) || BigInt(value) <= 0n || BigInt(value) > maxUint256) {
    throw new BadRequestException('Use positive integer amounts in 8-decimal USD units.');
  }
  return BigInt(value);
}

@Injectable()
export class AdminUpsideService {
  private readonly logger = new Logger(AdminUpsideService.name);

  constructor(@Optional() private readonly db?: DatabaseService) {}

  private getFactoryAddress(chainId: number) {
    const address = adminContracts(chainId).upside;
    if (!address) throw new ServiceUnavailableException('Upside factory is not configured.');
    return address;
  }

  async previewRound(dto: AdminUpsideRoundPreviewRequest): Promise<AdminUpsideRoundPreviewResponse> {
    const chainId = dto.chainId ?? 8453;
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(dto.expiryTimestamp) || dto.expiryTimestamp <= now || dto.expiryTimestamp > 253402300799) {
      throw new BadRequestException('Expiry timestamp must be strictly in the future.');
    }
    const calendarCheck = validateWeeklyUpsideExpiry(dto.expiryTimestamp, now);
    if (!calendarCheck.valid) throw new BadRequestException(calendarCheck.error);
    if (typeof dto.underlying !== 'string' || !isAddress(dto.underlying) || dto.underlying.toLowerCase() === zeroAddress) {
      throw new BadRequestException('Select a valid underlying address.');
    }

    const factoryAddress = this.getFactoryAddress(chainId);
    const rpcUrl = rpcUrlForChain(chainId);
    if (!rpcUrl) throw new ServiceUnavailableException('Upside RPC is not configured.');
    const client = createPublicClient({ transport: http(rpcUrl) });
    const underlying = getAddress(dto.underlying);
    const { symbol, asset, adapter, reference, blockTime } = await (async () => {
      try {
        const block = await client.getBlock();
        const blockNumber = block.number;
        if (blockNumber === null) throw new Error('No confirmed block');
        const registry = await client.readContract({
          address: factoryAddress, abi: upsideFactoryAbi, functionName: 'assetRegistry', blockNumber,
        });
        const asset = await client.readContract({
          address: registry, abi: assetRegistryAbi, functionName: 'getAsset',
          args: [BigInt(chainId), underlying], blockNumber,
        });
        if (!asset.supported || !asset.isCoinbaseB20 || asset.priceFeed === zeroAddress || asset.feedDecimals !== 8 || asset.tokenDecimals > 18) {
          throw new BadRequestException('Select a supported B20 asset with an 8-decimal registry feed.');
        }
        const adapter = settlementAdapterForFeed(
          asset.priceFeed,
          'UPSIDE_SETTLEMENT_ADAPTERS_JSON',
          'UPSIDE_SETTLEMENT_ADAPTER_ADDRESS',
          'UPSIDE_ADAPTER_ADDRESS',
        );
        if (!adapter) throw new ServiceUnavailableException('No Upside settlement adapter is configured for this feed.');
        const adapterQuery = { address: adapter, abi: upsideFixingAdapterAbi, blockNumber };
        const [symbol, adapterFeed, adapterDecimals, maxStaleness] = await Promise.all([
          client.readContract({ address: underlying, abi: adminTokenAbi, functionName: 'symbol', blockNumber }),
          client.readContract({ ...adapterQuery, functionName: 'priceFeed' }),
          client.readContract({ ...adapterQuery, functionName: 'decimals' }),
          client.readContract({ ...adapterQuery, functionName: 'maxStaleness' }),
        ]);
        if (adapterFeed.toLowerCase() !== asset.priceFeed.toLowerCase() || adapterDecimals !== asset.feedDecimals || maxStaleness <= 0n) {
          throw new BadRequestException('The Upside settlement adapter does not match the registry feed.');
        }
        const reference = await readAdminFeed(client, asset.priceFeed, { number: blockNumber, timestamp: block.timestamp },
          maxStaleness < 86400n ? maxStaleness : 86400n);
        return { symbol, asset, adapter, reference, blockTime: Number(block.timestamp) };
      } catch (err) {
        if (err instanceof BadRequestException || err instanceof ServiceUnavailableException) throw err;
        throw new ServiceUnavailableException('Could not verify the registry, settlement adapter, or live reference feed.');
      }
    })();

    const roundStart = dto.roundStart ?? Math.max(now, blockTime);
    if (!Number.isSafeInteger(roundStart) || roundStart < Number(reference.updatedAt) || roundStart >= dto.expiryTimestamp) {
      throw new BadRequestException('Round start must be at or after the reference update and before expiry.');
    }
    const dollar = 100000000n;
    const tick = positiveAmount(dto.strikeTick, dollar);
    const expectedMove = positiveAmount(dto.expectedMove, gridCeil(reference.price / 20n || 1n, dollar));
    const presets = upsidePresetStrikes(reference.price, expectedMove, tick);
    const minStrike = positiveAmount(dto.minStrike,
      gridFloor(reference.price > expectedMove * 2n ? reference.price - expectedMove * 2n : reference.price / 2n, tick) || tick);
    const maxStrike = positiveAmount(dto.maxStrike, gridCeil(reference.price + expectedMove * 4n, tick));
    if (minStrike > maxStrike || minStrike % tick !== 0n || maxStrike % tick !== 0n || maxStrike > maxUint256 ||
        new Set(presets).size !== presets.length || presets.some((strike) => strike < minStrike || strike > maxStrike)) {
      throw new BadRequestException('The strike grid must fit four distinct presets inside the bounds. Increase the expected move or use a smaller tick.');
    }
    const config = {
      underlying,
      feed: asset.priceFeed,
      adapter,
      referenceRoundId: reference.roundId,
      referencePrice: reference.price,
      referenceTime: reference.updatedAt,
      roundStart: BigInt(roundStart),
      expiryTimestamp: BigInt(dto.expiryTimestamp),
      expectedMove,
      provenanceHash: zeroHash,
      strikeTick: tick,
      minStrike,
      maxStrike,
    };
    const formatted = (amount: bigint) => (Number(amount) / 1e8).toFixed(2);
    return {
      underlying: { address: underlying, symbol, decimals: asset.tokenDecimals, feedAddress: asset.priceFeed },
      referencePrice: reference.price.toString(),
      referencePriceFormatted: formatted(reference.price),
      referenceRoundId: reference.roundId.toString(),
      referenceTime: Number(reference.updatedAt),
      expectedMove: expectedMove.toString(),
      expectedMoveFormatted: formatted(expectedMove),
      roundStart,
      expiryTimestamp: dto.expiryTimestamp,
      expiryIso: new Date(dto.expiryTimestamp * 1000).toISOString(),
      calendarCheck,
      strikes: presets.map((strike, i) => ({
        targetLabel: (['Starting price', 'Reach', 'Strong move', 'Long shot'] as const)[i],
        strikePrice: strike.toString(),
        strikePriceFormatted: formatted(strike),
      })),
      minStrike: minStrike.toString(),
      maxStrike: maxStrike.toString(),
      strikeTick: tick.toString(),
      factoryAddress,
      transactions: [{
        description: `Register ${symbol} Upside round`,
        target: factoryAddress,
        chainId,
        method: 'registerRound',
        args: [Object.fromEntries(Object.entries(config).map(([key, value]) =>
          [key, typeof value === 'bigint' ? value.toString() : value]))],
        data: encodeFunctionData({ abi: upsideFactoryAbi, functionName: 'registerRound', args: [config] }),
        expectedState: 'RoundRegistered emitted with the assigned round ID',
      }],
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
}
