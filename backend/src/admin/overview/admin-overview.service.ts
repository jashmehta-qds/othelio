import { Injectable, Logger, Optional } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { RiskSplitService } from '../../risksplit/risksplit.service';
import { adminContracts } from '../admin-deployment';
import { getIndexedProductMetrics } from '../admin-product-metrics';
import { AdminOverviewResponse, TOKEN_FEED_REGISTRY } from '@othelio/shared';
import { createPublicClient, http } from 'viem';
import { rpcUrlForChain } from '../../config/network-runtime';
import { seriesFactoryAbi } from '@othelio/shared';

@Injectable()
export class AdminOverviewService {
  private readonly logger = new Logger(AdminOverviewService.name);

  constructor(
    @Optional() private readonly db?: DatabaseService,
    @Optional() private readonly riskSplitService?: RiskSplitService,
  ) {}

  async getOverview(chainIdInput = 8453): Promise<AdminOverviewResponse> {
    const chainId = Number(chainIdInput);
    const productMetrics = getIndexedProductMetrics(this.db, chainId);

    // 1. Freshness / Block Progress
    let indexerHealth: {
      isFresh: boolean;
      observedHeadBlock: number;
      lastIndexedBlock: number;
      blockLag: number;
      observedHeadAt?: string | null;
    } = {
      isFresh: true,
      observedHeadBlock: 0,
      lastIndexedBlock: 0,
      blockLag: 0,
      observedHeadAt: null,
    };

    if (this.riskSplitService) {
      try {
        indexerHealth = await this.riskSplitService.getIndexerFreshness(chainId);
      } catch (err) {
        this.logger.warn(`Could not get indexer freshness: ${err}`);
      }
    }

    const asOfBlock = indexerHealth.lastIndexedBlock;

    // 2. Active Wallets by Window
    let activeWallets = {
      last24h: 0,
      last7d: 0,
      last30d: 0,
      allTime: 0,
    };

    if (this.db) {
      try {
        const query = `
          WITH all_activity AS (
            SELECT LOWER(actor_address) AS wallet, occurred_at AS ts
            FROM basket_events
            WHERE chain_id = $1 AND actor_address IS NOT NULL
            UNION ALL
            SELECT LOWER(actor_address) AS wallet, occurred_at AS ts
            FROM risk_split_events
            WHERE chain_id = $1 AND actor_address IS NOT NULL
            UNION ALL
            SELECT LOWER(account_address) AS wallet, updated_at AS ts
            FROM account_settings
            WHERE account_address IS NOT NULL
          )
          SELECT
            COUNT(DISTINCT CASE WHEN ts >= NOW() - INTERVAL '24 hours' THEN wallet END)::int AS count_24h,
            COUNT(DISTINCT CASE WHEN ts >= NOW() - INTERVAL '7 days' THEN wallet END)::int AS count_7d,
            COUNT(DISTINCT CASE WHEN ts >= NOW() - INTERVAL '30 days' THEN wallet END)::int AS count_30d,
            COUNT(DISTINCT wallet)::int AS count_all
          FROM all_activity;
        `;
        const res = await this.db.query(query, [chainId]);
        if (res.rows && res.rows[0]) {
          activeWallets = {
            last24h: Number(res.rows[0].count_24h || 0),
            last7d: Number(res.rows[0].count_7d || 0),
            last30d: Number(res.rows[0].count_30d || 0),
            allTime: Number(res.rows[0].count_all || 0),
          };
        }
      } catch (err) {
        this.logger.warn(`Failed to count active wallets: ${err}`);
      }
    }

    // 3. Basket Count
    let basketsCount = 0;
    if (this.db) {
      try {
        const res = await this.db.query('SELECT COUNT(*)::int AS count FROM baskets WHERE chain_id = $1', [chainId]);
        if (res.rows && res.rows[0]) {
          basketsCount = Number(res.rows[0].count || 0);
        }
      } catch (err) {
        this.logger.warn(`Failed to count baskets: ${err}`);
      }
    }

    // 4. Supported Assets Count
    const supportedAssetsCount = Object.keys(TOKEN_FEED_REGISTRY).length;

    // 5. Risk Split Metrics
    let riskSplit = {
      totalSeries: 0,
      openSeries: 0,
      expiredSeries: 0,
      settledSeries: 0,
      totalMintVolumeUnderlying: '0',
      totalRedemptionVolumeUnderlying: '0',
      activeCollateralUnderlying: '0',
      failedSettlementCount: 0,
      indexingAlerts: indexerHealth.isFresh ? 0 : 1,
    };

    if (this.db) {
      try {
        const nowSecs = Math.floor(Date.now() / 1000);
        const seriesRes = await this.db.query(
          `SELECT
             COUNT(*)::int AS total_count,
             COUNT(CASE WHEN NOT is_settled AND expiry_timestamp > $2 THEN 1 END)::int AS open_count,
             COUNT(CASE WHEN NOT is_settled AND expiry_timestamp <= $2 THEN 1 END)::int AS expired_count,
             COUNT(CASE WHEN is_settled THEN 1 END)::int AS settled_count,
             COUNT(CASE WHEN operations_audit_status = 'SETTLEMENT_FAILED' THEN 1 END)::int AS failed_settlement_count
           FROM risk_split_series
           WHERE chain_id = $1`,
          [chainId, nowSecs]
        );

        const seriesRow = seriesRes.rows?.[0];

        const volumeRes = await this.db.query(
          `SELECT
             COALESCE(SUM(CASE WHEN event_type = 'MINTED' THEN amount ELSE 0 END), 0)::text AS mint_volume,
             COALESCE(SUM(CASE WHEN event_type IN ('PAIR_REDEEMED', 'PROTECTED_REDEEMED', 'UPSIDE_REDEEMED') THEN amount ELSE 0 END), 0)::text AS redeem_volume
           FROM risk_split_events
           WHERE chain_id = $1`,
          [chainId]
        );

        const volumeRow = volumeRes.rows?.[0];
        const mintVol = BigInt(volumeRow?.mint_volume || '0');
        const redeemVol = BigInt(volumeRow?.redeem_volume || '0');
        const activeCollateral = mintVol >= redeemVol ? mintVol - redeemVol : 0n;

        riskSplit = {
          totalSeries: Number(seriesRow?.total_count || 0),
          openSeries: Number(seriesRow?.open_count || 0),
          expiredSeries: Number(seriesRow?.expired_count || 0),
          settledSeries: Number(seriesRow?.settled_count || 0),
          totalMintVolumeUnderlying: mintVol.toString(),
          totalRedemptionVolumeUnderlying: redeemVol.toString(),
          activeCollateralUnderlying: activeCollateral.toString(),
          failedSettlementCount: Number(seriesRow?.failed_settlement_count || 0),
          indexingAlerts: indexerHealth.isFresh ? 0 : 1,
        };
      } catch (err) {
        this.logger.warn(`Failed to query risk split metrics: ${err}`);
      }
    }

    // 6. Governed Contracts Info
    const factoryAddress = adminContracts(chainId).riskSplit;
    let factoryOwner: string | null = null;
    let pendingOwner: string | null = null;

    try {
      const rpcUrl = rpcUrlForChain(chainId);
      if (rpcUrl && factoryAddress) {
        const client = createPublicClient({ transport: http(rpcUrl) });
        const [ownerRes, pendingOwnerRes] = await Promise.all([
          client.readContract({ address: factoryAddress, abi: seriesFactoryAbi, functionName: 'owner' }).catch(() => null),
          client.readContract({ address: factoryAddress, abi: seriesFactoryAbi, functionName: 'pendingOwner' }).catch(() => null),
        ]);

        if (ownerRes) factoryOwner = (ownerRes as string).toLowerCase();
        if (pendingOwnerRes && pendingOwnerRes !== '0x0000000000000000000000000000000000000000') {
          pendingOwner = (pendingOwnerRes as string).toLowerCase();
        }
      }
    } catch (err) {
      this.logger.warn(`Failed to inspect onchain factory parameters: ${err}`);
    }

    return {
      asOfBlock,
      indexerHealth,
      activeWallets,
      basketsCount,
      supportedAssetsCount,
      products: await productMetrics,
      riskSplit,
      governedContracts: {
        factory: {
          address: factoryAddress,
          owner: factoryOwner,
          pendingOwner,
        },
      },
    };
  }
}
