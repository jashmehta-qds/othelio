import { Injectable, Logger, Optional } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { RiskSplitService } from '../../risksplit/risksplit.service';
import {
  AdminOperationQueueItem,
  AdminOperationsResponse,
  settlementAdapterAbi,
  TOKEN_FEED_REGISTRY,
} from '@othelio/shared';
import { createPublicClient, http, isAddress, zeroAddress } from 'viem';
import { rpcUrlForChain } from '../../config/network-runtime';

@Injectable()
export class AdminOperationsService {
  private readonly logger = new Logger(AdminOperationsService.name);

  constructor(
    @Optional() private readonly db?: DatabaseService,
    @Optional() private readonly riskSplitService?: RiskSplitService,
  ) {}

  async getOperations(chainIdInput = 8453): Promise<AdminOperationsResponse> {
    const chainId = Number(chainIdInput);

    let asOfBlock = 0;
    let isIndexerFresh = true;
    let blockLag = 0;

    if (this.riskSplitService) {
      try {
        const freshness = await this.riskSplitService.getIndexerFreshness(chainId);
        asOfBlock = freshness.lastIndexedBlock;
        isIndexerFresh = freshness.isFresh;
        blockLag = freshness.blockLag;
      } catch {
        asOfBlock = 0;
      }
    }

    const isRiskSplitPaused =
      process.env.RISK_SPLIT_INDEXING_ENABLED === 'false' ||
      process.env.RISK_SPLIT_INDEXING_ENABLED === '0';

    let riskSplitLastBlock = 0;
    let riskSplitHeadBlock = 0;
    let riskSplitLag = 0;

    if (this.db) {
      try {
        const rsStateRes = await this.db.query(
          `SELECT next_block, observed_head_block
           FROM indexer_worker_state
           WHERE chain_id = $1 AND worker_name = 'risksplit'
           LIMIT 1`,
          [chainId],
        );
        if (rsStateRes?.rows?.length > 0) {
          const row = rsStateRes.rows[0];
          riskSplitLastBlock = row.next_block == null ? 0 : Math.max(0, Number(row.next_block) - 1);
          riskSplitHeadBlock = row.observed_head_block == null ? riskSplitLastBlock : Number(row.observed_head_block);
          riskSplitLag = Math.max(0, riskSplitHeadBlock - riskSplitLastBlock);
        }
      } catch (err) {
        this.logger.warn(`Failed to query risksplit worker state: ${err}`);
      }
    }

    const riskSplitIndexer = {
      status: isRiskSplitPaused ? ('PAUSED' as const) : ('ACTIVE' as const),
      isPaused: isRiskSplitPaused,
      lastIndexedBlock: riskSplitLastBlock,
      observedHeadBlock: riskSplitHeadBlock,
      blockLag: riskSplitLag,
    };

    const expiryQueue: AdminOperationQueueItem[] = [];
    const settlementAuditTrail: AdminOperationsResponse['settlementAuditTrail'] = [];
    const incidentAlerts: AdminOperationsResponse['incidentAlerts'] = [];

    if (isRiskSplitPaused) {
      incidentAlerts.push({
        severity: 'INFO',
        message: `Risk Split indexing is currently PAUSED (RISK_SPLIT_INDEXING_ENABLED=false). Resume cursor preserved at #${riskSplitLastBlock}.`,
        timestamp: new Date().toISOString(),
      });
    }

    // Add indexer alert if lagging
    if (!isIndexerFresh) {
      incidentAlerts.push({
        severity: 'WARN',
        message: `Indexer lag detected: ${blockLag} blocks behind chain head. Operations data may be delayed.`,
        timestamp: new Date().toISOString(),
      });
    }

    if (this.db) {
      try {
        const res = await this.db.query(
          `SELECT * FROM risk_split_series WHERE chain_id = $1 ORDER BY expiry_timestamp ASC`,
          [chainId]
        );

        const nowSecs = Math.floor(Date.now() / 1000);
        const rpcUrl = rpcUrlForChain(chainId);
        const client = rpcUrl ? createPublicClient({ transport: http(rpcUrl) }) : null;

        for (const row of res.rows || []) {
          const underlyingAddr = (row.underlying_address || '').toLowerCase();
          const config = Object.values(TOKEN_FEED_REGISTRY).find(
            (c) => c.tokenAddress.toLowerCase() === underlyingAddr
          );
          const expectedFeed = row.creation_feed_address?.trim().toLowerCase() ?? config?.feedAddress.toLowerCase();
          const symbol = config?.symbol ?? underlyingAddr;
          const expiryTs = Number(row.expiry_timestamp);
          const isExpired = nowSecs >= expiryTs;
          const isSettled = Boolean(row.is_settled);

          if (isSettled) {
            settlementAuditTrail.push({
              seriesAddress: row.series_address,
              settledPrice: row.settled_price ? `$${(Number(row.settled_price) / 1e8).toFixed(2)}` : '0',
              settledRoundId: row.settled_round_id ? row.settled_round_id.toString() : '0',
              settledFeedUpdatedAt: row.settled_feed_updated_at ? new Date(row.settled_feed_updated_at).toISOString() : null,
              auditStatus: row.operations_audit_status || 'NORMAL',
            });
          } else {
            // Queue item
            let candidateFixingRound: AdminOperationQueueItem['candidateFixingRound'] = null;
            let settlementReady = false;

            if (isExpired && client && expectedFeed && isAddress(expectedFeed) &&
                expectedFeed !== zeroAddress && row.settlement_adapter_address) {
              try {
                const fixing = await client.readContract({
                  address: row.settlement_adapter_address,
                  abi: settlementAdapterAbi,
                  functionName: 'getFixingRound',
                  args: [BigInt(expiryTs)],
                });
                if (fixing && fixing.feed.toLowerCase() === expectedFeed && fixing.decimals === 8) {
                  const updatedAt = Number(fixing.updatedAt);
                  candidateFixingRound = {
                    roundId: fixing.roundId.toString(),
                    price: fixing.price.toString(),
                    formattedPrice: `$${(Number(fixing.price) / 1e8).toFixed(2)}`,
                    updatedAt: new Date(updatedAt * 1000).toISOString(),
                    isPreExpiry: true,
                    isFresh: true,
                  };
                  settlementReady = isIndexerFresh && fixing.price > 0n;
                }
              } catch (err) {
                this.logger.warn(`Failed to inspect fixing candidate round for ${row.series_address}: ${err}`);
              }
            }

            // If expired more than 2 hours without settlement, raise alert
            if (isExpired && nowSecs - expiryTs > 7200) {
              incidentAlerts.push({
                severity: 'WARN',
                message: `Series ${row.series_address} (${symbol}) expired over 2 hours ago and remains unsettled.`,
                seriesAddress: row.series_address,
                timestamp: new Date().toISOString(),
              });
            }

            // Settlement preview transaction
            const settlementPreviewTx =
              isExpired && settlementReady && candidateFixingRound
                ? {
                    description: `Settle Series for ${symbol} with Oracle Round #${candidateFixingRound.roundId}`,
                    target: row.settlement_adapter_address as `0x${string}`,
                    chainId,
                    method: 'settleSeries',
                    args: [row.series_address, candidateFixingRound.roundId],
                    expectedState: 'isSettled == true with immutable fixing price',
                  }
                : null;

            expiryQueue.push({
              seriesAddress: row.series_address,
              underlyingSymbol: symbol,
              underlyingAddress: row.underlying_address,
              expiryTimestamp: expiryTs,
              expiryIso: new Date(expiryTs * 1000).toISOString(),
              isExpired,
              isSettled,
              candidateFixingRound,
              settlementReady,
              settlementPreviewTx,
              auditStatus: row.operations_audit_status || 'NORMAL',
            });
          }
        }
      } catch (err) {
        this.logger.warn(`Failed to build operations response: ${err}`);
      }
    }

    return {
      asOfBlock,
      riskSplitIndexer,
      expiryQueue,
      settlementAuditTrail,
      incidentAlerts,
    };
  }
}
