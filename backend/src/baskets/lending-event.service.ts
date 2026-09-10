import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  TransactionLifecycle,
  addressSchema,
  baseUnitAmountSchema,
  blockHashSchema,
  chainIdSchema,
  transactionLifecycleSchema,
} from '@othelio/shared';
import { z } from 'zod';
import { DatabaseService } from '../database/database.service';

export type RequestedLendingAction = 'SUPPLY' | 'BORROW' | 'REPAY' | 'WITHDRAW';
const requestedLendingActionSchema = z.enum(['SUPPLY', 'BORROW', 'REPAY', 'WITHDRAW']);

export interface LendingEventRequest {
  chainId: number;
  basketAddress: string;
  action: RequestedLendingAction;
  assetAddress: string;
  amount: string;
  winningProvider: string;
  winningPool: string;
  txHash: string;
}

const lifecycleAction = {
  SUPPLY: 'SUPPLY',
  BORROW: 'BORROW',
  REPAY: 'REPAY',
  WITHDRAW: 'RELEASE_COLLATERAL',
} as const;

@Injectable()
export class LendingEventService {
  constructor(
    @Inject(DatabaseService)
    private readonly db: DatabaseService,
  ) {}

  async recordLendingEvent(body: LendingEventRequest): Promise<{ success: true; lifecycle: TransactionLifecycle }> {
    const chainId = chainIdSchema.parse(body.chainId);
    const action = requestedLendingActionSchema.parse(body.action);
    const basketAddress = addressSchema.parse(body.basketAddress).toLowerCase();
    const assetAddress = addressSchema.parse(body.assetAddress).toLowerCase();
    const marketAddress = addressSchema.parse(body.winningPool).toLowerCase();
    const txHash = blockHashSchema.parse(body.txHash).toLowerCase();
    const amount = baseUnitAmountSchema.parse(body.amount);
    const provider = body.winningProvider.trim();
    if (!provider) throw new BadRequestException('winningProvider is required');
    const operationId = `lending:${chainId}:${txHash}`;

    const result = await this.db.query(
      `INSERT INTO lending_transaction_lifecycles
       (operation_id, chain_id, tx_hash, basket_address, requested_action,
        requested_asset_address, requested_amount, requested_provider, requested_market_address, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'SUBMITTED')
       ON CONFLICT (chain_id, tx_hash) DO UPDATE SET updated_at = NOW()
       WHERE lending_transaction_lifecycles.basket_address = EXCLUDED.basket_address
         AND lending_transaction_lifecycles.requested_action = EXCLUDED.requested_action
         AND lending_transaction_lifecycles.requested_asset_address = EXCLUDED.requested_asset_address
         AND lending_transaction_lifecycles.requested_amount = EXCLUDED.requested_amount
         AND lending_transaction_lifecycles.requested_provider = EXCLUDED.requested_provider
         AND lending_transaction_lifecycles.requested_market_address = EXCLUDED.requested_market_address
       RETURNING status, submitted_at, settled_at, receipt_block_number, receipt_block_hash, reason`,
      [operationId, chainId, txHash, basketAddress, action, assetAddress, amount, provider, marketAddress],
    );
    if (!result.rows[0]) {
      throw new BadRequestException('Transaction hash is already registered with different lending details');
    }
    const row = result.rows[0];
    const lifecycle = transactionLifecycleSchema.parse({
      operationId,
      chainId,
      accountAddress: basketAddress,
      action: lifecycleAction[action],
      status: row.status,
      transactionHash: txHash,
      replacementTransactionHash: null,
      submittedAt: new Date(row.submitted_at).toISOString(),
      settledAt: row.settled_at ? new Date(row.settled_at).toISOString() : null,
      receiptBlockNumber: row.receipt_block_number === null ? null : Number(row.receipt_block_number),
      receiptBlockHash: row.receipt_block_hash,
      canonicalSnapshot: null,
      reason: row.reason,
    });
    return { success: true, lifecycle };
  }
}
