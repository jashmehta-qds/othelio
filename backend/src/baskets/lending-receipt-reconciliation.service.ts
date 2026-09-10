import { Inject, Injectable } from '@nestjs/common';
import { addressSchema, blockHashSchema, chainIdSchema } from '@othelio/shared';
import { Hex, createPublicClient, decodeEventLog, http, parseAbi } from 'viem';
import { DatabaseService } from '../database/database.service';
import type { RequestedLendingAction } from './lending-event.service';

const lendingPoolEvents = parseAbi([
  'event Supply(address indexed reserve,address user,address indexed onBehalfOf,uint256 amount,uint16 indexed referralCode)',
  'event Borrow(address indexed reserve,address user,address indexed onBehalfOf,uint256 amount,uint8 interestRateMode,uint256 borrowRate,uint16 indexed referralCode)',
  'event Repay(address indexed reserve,address indexed user,address indexed repayer,uint256 amount,bool useATokens)',
  'event Withdraw(address indexed reserve,address indexed user,address indexed to,uint256 amount)',
]);

export interface ReceiptLog {
  address: string;
  data: `0x${string}`;
  topics: readonly Hex[];
  logIndex: number;
}

export interface LendingReceipt {
  status: 'success' | 'reverted';
  blockNumber: bigint;
  blockHash: string;
  logs: readonly ReceiptLog[];
}

export interface PendingLendingSubmission {
  operationId: string;
  chainId: number;
  txHash: string;
  basketAddress: string;
  requestedAction: RequestedLendingAction;
  requestedAssetAddress: string;
  requestedProvider: string;
  requestedMarketAddress: string;
}

export type ReceiptReconciliation =
  | { status: 'SUBMITTED' | 'DROPPED' | 'UNKNOWN' | 'CONFIRMED_REVERT' | 'REORG_INVALIDATED' | 'REPLACED'; reason: string; receiptBlockNumber: number | null; receiptBlockHash: string | null; replacementTransactionHash?: string | null; activeTransactionHash?: string }
  | {
      status: 'CONFIRMED_SUCCESS';
      reason: null;
      receiptBlockNumber: number;
      receiptBlockHash: string;
      confirmedAction: RequestedLendingAction;
      confirmedAssetAddress: string;
      confirmedAmount: string;
      confirmedMarketAddress: string;
      receiptLogIndex: number;
      replacementTransactionHash?: string | null;
      activeTransactionHash?: string;
    };

export interface MissingReceiptObservation {
  submittedAt: Date;
  missingObservations: number;
  now: Date;
  dropAfterMs: number;
  requiredMisses: number;
  nodeStillHasTransaction: boolean;
}

/** A missing receipt is ordinary propagation delay until both independent thresholds are met. */
export function statusForMissingReceipt(observation: MissingReceiptObservation): 'SUBMITTED' | 'DROPPED' {
  const oldEnough = observation.now.getTime() - observation.submittedAt.getTime() >= observation.dropAfterMs;
  return !observation.nodeStillHasTransaction && oldEnough && observation.missingObservations >= observation.requiredMisses
    ? 'DROPPED'
    : 'SUBMITTED';
}

export function isSameNonceReplacement(
  original: { chainId: number; senderAddress: string | null; nonce: number | null },
  candidate: { chainId: number; senderAddress: string; nonce: number },
) {
  return original.senderAddress !== null
    && original.nonce !== null
    && original.chainId === candidate.chainId
    && original.senderAddress.toLowerCase() === candidate.senderAddress.toLowerCase()
    && original.nonce === candidate.nonce;
}

export function replacementFromCandidates(
  original: { chainId: number; senderAddress: string | null; nonce: number | null },
  candidates: readonly { hash: string; chainId: number; senderAddress: string; nonce: number }[],
): string | null {
  return candidates.find((candidate) => isSameNonceReplacement(original, candidate))?.hash.toLowerCase() ?? null;
}

export function reconcileLendingReceipt(
  submission: PendingLendingSubmission,
  receipt: LendingReceipt | null,
): ReceiptReconciliation {
  if (!receipt) {
    return { status: 'UNKNOWN', reason: 'Transaction receipt is not currently available.', receiptBlockNumber: null, receiptBlockHash: null };
  }
  const blockNumber = Number(receipt.blockNumber);
  const blockHash = blockHashSchema.parse(receipt.blockHash).toLowerCase();
  if (receipt.status === 'reverted') {
    return { status: 'CONFIRMED_REVERT', reason: 'The confirmed receipt reports a revert.', receiptBlockNumber: blockNumber, receiptBlockHash: blockHash };
  }
  const normalizedProvider = submission.requestedProvider.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (normalizedProvider !== 'AAVE' && normalizedProvider !== 'AAVEV3') {
    return { status: 'UNKNOWN', reason: 'Receipt decoding is unsupported for the requested provider.', receiptBlockNumber: blockNumber, receiptBlockHash: blockHash };
  }

  const basket = submission.basketAddress.toLowerCase();
  const market = submission.requestedMarketAddress.toLowerCase();
  const asset = submission.requestedAssetAddress.toLowerCase();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== market) continue;
    if (log.topics.length === 0) continue;
    try {
      const decoded = decodeEventLog({
        abi: lendingPoolEvents,
        data: log.data,
        topics: [...log.topics] as [Hex, ...Hex[]],
        strict: true,
      }) as {
        eventName: RequestedLendingAction | 'Supply' | 'Borrow' | 'Repay' | 'Withdraw';
        args: Record<string, unknown>;
      };
      const confirmedAction = decoded.eventName.toUpperCase() as RequestedLendingAction;
      const account = String(decoded.args.onBehalfOf ?? decoded.args.user).toLowerCase();
      const confirmedAsset = String(decoded.args.reserve).toLowerCase();
      if (confirmedAction !== submission.requestedAction || account !== basket || confirmedAsset !== asset) continue;
      return {
        status: 'CONFIRMED_SUCCESS',
        reason: null,
        receiptBlockNumber: blockNumber,
        receiptBlockHash: blockHash,
        confirmedAction,
        confirmedAssetAddress: addressSchema.parse(confirmedAsset).toLowerCase(),
        confirmedAmount: String(decoded.args.amount),
        confirmedMarketAddress: addressSchema.parse(log.address).toLowerCase(),
        receiptLogIndex: log.logIndex,
      };
    } catch {
      // Ignore unrelated logs; confirmation requires one exact decoded match.
    }
  }
  return {
    status: 'UNKNOWN',
    reason: 'Confirmed receipt did not contain a lending event matching the requested basket, market, action, and asset.',
    receiptBlockNumber: blockNumber,
    receiptBlockHash: blockHash,
  };
}

@Injectable()
export class LendingReceiptReconciliationService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async reconcile(chainIdInput: number, txHashInput: string, basketAddressInput: string): Promise<ReceiptReconciliation> {
    const chainId = chainIdSchema.parse(chainIdInput);
    const txHash = blockHashSchema.parse(txHashInput).toLowerCase();
    const basketAddress = addressSchema.parse(basketAddressInput).toLowerCase();
    const pending = await this.db.query(
      `SELECT operation_id, chain_id, tx_hash, active_tx_hash, sender_address, tx_nonce,
              submitted_at, missing_receipt_observations, basket_address, requested_action,
              requested_asset_address, requested_provider, requested_market_address
       FROM lending_transaction_lifecycles WHERE chain_id = $1 AND (tx_hash = $2 OR active_tx_hash = $2) AND basket_address = $3`,
      [chainId, txHash, basketAddress],
    );
    if (!pending.rows[0]) throw new Error('Unknown lending transaction submission');
    const row = pending.rows[0];
    const rpcUrl = chainId === 31337
      ? (process.env.ANVIL_RPC_URL ?? 'http://127.0.0.1:8545')
      : (process.env.RPC_URL ?? 'https://mainnet.base.org');
    const client = createPublicClient({ transport: http(rpcUrl) });
    const observedChainId = await client.getChainId().catch(() => null);
    let activeHash = (row.active_tx_hash ?? row.tx_hash).toLowerCase();
    const submission: PendingLendingSubmission = {
      operationId: row.operation_id,
      chainId: Number(row.chain_id),
      txHash: activeHash,
      basketAddress: row.basket_address,
      requestedAction: row.requested_action,
      requestedAssetAddress: row.requested_asset_address,
      requestedProvider: row.requested_provider,
      requestedMarketAddress: row.requested_market_address,
    };
    let result: ReceiptReconciliation;
    if (observedChainId !== chainId) {
      result = {
        status: 'UNKNOWN',
        reason: observedChainId === null
          ? 'RPC chain identity could not be verified.'
          : `RPC chain mismatch: expected ${chainId}, observed ${observedChainId}.`,
        receiptBlockNumber: null,
        receiptBlockHash: null,
      };
    } else {
      // Learn immutable sender/nonce identity lazily so the submission API remains hash-only.
      const transaction = await client.getTransaction({ hash: activeHash as `0x${string}` }).catch(() => null);
      if (transaction && (!row.sender_address || row.tx_nonce === null)) {
        await this.db.query(
          `UPDATE lending_transaction_lifecycles SET sender_address=$3, tx_nonce=$4, updated_at=NOW()
           WHERE chain_id=$1 AND operation_id=$2 AND sender_address IS NULL`,
          [chainId, row.operation_id, transaction.from.toLowerCase(), Number(transaction.nonce)],
        );
        row.sender_address = transaction.from;
        row.tx_nonce = Number(transaction.nonce);
      }
      let receipt = await client.getTransactionReceipt({ hash: activeHash as `0x${string}` }).catch(() => null);
      if (!receipt) {
        const originalHash = row.tx_hash.toLowerCase();
        if (activeHash === originalHash && transaction === null && row.sender_address && row.tx_nonce !== null) {
          const confirmedNonce = await client.getTransactionCount({ address: row.sender_address as `0x${string}`, blockTag: 'latest' }).catch(() => null);
          if (confirmedNonce !== null && Number(confirmedNonce) > Number(row.tx_nonce)) {
            const latestBlock = await client.getBlockNumber().catch(() => null);
            const lookback = Math.max(1, Number(process.env.LENDING_REPLACEMENT_LOOKBACK_BLOCKS ?? 128));
            const candidates: { hash: string; chainId: number; senderAddress: string; nonce: number }[] = [];
            if (latestBlock !== null) {
              for (let offset = 0n; offset < BigInt(lookback) && latestBlock >= offset; offset++) {
                const block = await client.getBlock({ blockNumber: latestBlock - offset, includeTransactions: true }).catch(() => null);
                for (const candidate of block?.transactions ?? []) {
                  if (typeof candidate === 'string') continue;
                  candidates.push({ hash: candidate.hash, chainId, senderAddress: candidate.from, nonce: Number(candidate.nonce) });
                }
              }
            }
            const replacementHash = replacementFromCandidates(
              { chainId, senderAddress: row.sender_address, nonce: Number(row.tx_nonce) }, candidates,
            );
            if (replacementHash) {
              await this.db.query(
                `UPDATE lending_transaction_lifecycles SET status='REPLACED', replacement_tx_hash=$3, active_tx_hash=$3,
                 reason='Original transaction was replaced by a confirmed same-nonce transaction.', updated_at=NOW()
                 WHERE operation_id=$1 AND chain_id=$2 AND active_tx_hash=$4`,
                [row.operation_id, chainId, replacementHash, originalHash],
              );
              activeHash = replacementHash;
              submission.txHash = activeHash;
              receipt = await client.getTransactionReceipt({ hash: activeHash as `0x${string}` }).catch(() => null);
              if (!receipt) {
                return { status: 'REPLACED', reason: 'Replacement transaction was discovered but its receipt is not currently available.', receiptBlockNumber: null, receiptBlockHash: null, replacementTransactionHash: replacementHash, activeTransactionHash: replacementHash };
              }
            }
          }
        }
      }
      if (!receipt) {
        if (activeHash !== row.tx_hash.toLowerCase()) {
          return { status: 'REPLACED', reason: 'Replacement transaction receipt is not currently available.', receiptBlockNumber: null, receiptBlockHash: null, replacementTransactionHash: activeHash, activeTransactionHash: activeHash };
        }
        const misses = Number(row.missing_receipt_observations ?? 0) + 1;
        const status = statusForMissingReceipt({
          submittedAt: new Date(row.submitted_at), missingObservations: misses, now: new Date(),
          dropAfterMs: Number(process.env.LENDING_DROP_AFTER_MS ?? 30 * 60_000),
          requiredMisses: Number(process.env.LENDING_DROP_REQUIRED_MISSES ?? 3),
          nodeStillHasTransaction: transaction !== null,
        });
        await this.db.query(
          `UPDATE lending_transaction_lifecycles SET status=$3, missing_receipt_observations=$4,
           last_observed_at=NOW(), reason=$5, updated_at=NOW() WHERE operation_id=$1 AND chain_id=$2`,
          [row.operation_id, chainId, status, misses, status === 'DROPPED' ? 'Transaction aged out after repeated node misses.' : 'Transaction receipt is not currently available.'],
        );
        return { status, reason: 'Transaction receipt is not currently available.', receiptBlockNumber: null, receiptBlockHash: null, activeTransactionHash: activeHash };
      }
      const canonicalBlock = await client.getBlock({ blockNumber: receipt.blockNumber }).catch(() => null);
      if (!canonicalBlock || canonicalBlock.hash?.toLowerCase() !== receipt.blockHash.toLowerCase()) {
        await this.db.query(`DELETE FROM lending_market_logs WHERE chain_id=$1 AND tx_hash=$2`, [chainId, activeHash]);
        await this.db.query(`UPDATE lending_transaction_lifecycles SET status='REORG_INVALIDATED', reason='Receipt block is no longer canonical.', updated_at=NOW() WHERE operation_id=$1`, [row.operation_id]);
        await this.db.query(`INSERT INTO basket_position_refresh_requests (chain_id,basket_address,block_number,reason) VALUES ($1,$2,$3,'LENDING_RECEIPT_REORG') ON CONFLICT DO NOTHING`, [chainId, row.basket_address, Number(receipt.blockNumber)]);
        return { status: 'REORG_INVALIDATED', reason: 'Receipt block is no longer canonical.', receiptBlockNumber: Number(receipt.blockNumber), receiptBlockHash: receipt.blockHash, activeTransactionHash: activeHash };
      }
      result = reconcileLendingReceipt(submission, receipt && {
        status: receipt.status,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        logs: receipt.logs.map((log) => ({
          address: log.address,
          data: log.data,
          topics: log.topics,
          logIndex: log.logIndex,
        })),
      });
    }

    if (result.status === 'CONFIRMED_SUCCESS') {
      await this.db.query(
        `WITH inserted AS (
           INSERT INTO lending_market_logs
             (chain_id, basket_address, action, asset_address, amount, winning_provider, winning_pool,
              winning_supply_apy, winning_borrow_apy, all_market_quotes, tx_hash, log_index,
              block_number, block_hash, actor_address, created_at)
           VALUES ($1,$2,$3,$4,$5,'AAVE_V3',$7,NULL,NULL,'[]'::jsonb,$8,$9,$10,$11,$2,NOW())
           ON CONFLICT (chain_id, tx_hash, log_index) WHERE tx_hash IS NOT NULL AND log_index IS NOT NULL DO NOTHING
         )
         UPDATE lending_transaction_lifecycles SET status='CONFIRMED_SUCCESS', confirmed_action=$3,
           confirmed_asset_address=$4, confirmed_amount=$5, confirmed_market_address=$7,
           receipt_log_index=$9, receipt_block_number=$10, receipt_block_hash=$11,
           reason=NULL, settled_at=NOW(), updated_at=NOW()
         WHERE operation_id=$12`,
        [chainId, row.basket_address, result.confirmedAction, result.confirmedAssetAddress,
          result.confirmedAmount, null, result.confirmedMarketAddress, activeHash,
          result.receiptLogIndex, result.receiptBlockNumber, result.receiptBlockHash, row.operation_id],
      );
    } else {
      await this.db.query(
        `UPDATE lending_transaction_lifecycles SET status=$3, receipt_block_number=$4,
          receipt_block_hash=$5, reason=$6, settled_at=CASE WHEN $3='CONFIRMED_REVERT' THEN NOW() ELSE NULL END,
           updated_at=NOW() WHERE chain_id=$1 AND (tx_hash=$2 OR active_tx_hash=$2)`,
        [chainId, activeHash, result.status, result.receiptBlockNumber, result.receiptBlockHash, result.reason],
      );
    }
    return activeHash === row.tx_hash.toLowerCase()
      ? result
      : { ...result, replacementTransactionHash: activeHash, activeTransactionHash: activeHash };
  }
}
