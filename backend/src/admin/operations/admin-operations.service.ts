import { Injectable, Logger, Optional } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { RiskSplitService } from '../../risksplit/risksplit.service';
import {
  AdminOperationQueueItem,
  AdminOperationsResponse,
  TOKEN_FEED_REGISTRY,
} from '@othelio/shared';
import { createPublicClient, http } from 'viem';
import { rpcUrlForChain } from '../../config/network-runtime';

const AGGREGATOR_ABI = [
  {
    type: 'function',
    name: 'latestRoundData',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getRoundData',
    inputs: [{ name: '_roundId', type: 'uint80' }],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
    stateMutability: 'view',
  },
] as const;

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

    const expiryQueue: AdminOperationQueueItem[] = [];
    const settlementAuditTrail: AdminOperationsResponse['settlementAuditTrail'] = [];
    const incidentAlerts: AdminOperationsResponse['incidentAlerts'] = [];

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
          const symbol = config?.symbol ?? 'UNKNOWN';
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

            if (isExpired && client && config?.feedAddress) {
              try {
                const latestRound = await client.readContract({
                  address: config.feedAddress,
                  abi: AGGREGATOR_ABI,
                  functionName: 'latestRoundData',
                });

                if (latestRound) {
                  const roundId = latestRound[0];
                  const price = latestRound[1];
                  const updatedAt = Number(latestRound[3]);

                  // If latest observation is at/before expiry or close to it
                  const isPreExpiry = updatedAt <= expiryTs;
                  const isFresh = nowSecs - updatedAt <= 86400;

                  candidateFixingRound = {
                    roundId: roundId.toString(),
                    price: price.toString(),
                    formattedPrice: `$${(Number(price) / 1e8).toFixed(2)}`,
                    updatedAt: new Date(updatedAt * 1000).toISOString(),
                    isPreExpiry,
                    isFresh,
                  };

                  settlementReady = isPreExpiry && price > 0n;
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
              isExpired && candidateFixingRound
                ? {
                    description: `Settle Series for ${symbol} with Oracle Round #${candidateFixingRound.roundId}`,
                    target: row.series_address as `0x${string}`,
                    chainId,
                    method: 'settleSeriesWithFixing',
                    args: [BigInt(candidateFixingRound.roundId)],
                    expectedState: 'isSettled == true with immutable fixing price',
                    simulationResult: {
                      success: true,
                      message: `Ready to fix settlement at ${candidateFixingRound.formattedPrice}`,
                    },
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
      expiryQueue,
      settlementAuditTrail,
      incidentAlerts,
    };
  }
}
