import { encodeAbiParameters, encodeEventTopics, parseAbi } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import { LendingEventService } from './lending-event.service';
import { LendingReceipt, PendingLendingSubmission, reconcileLendingReceipt, statusForMissingReceipt, isSameNonceReplacement, replacementFromCandidates } from './lending-receipt-reconciliation.service';

const basket = '0x1111111111111111111111111111111111111111';
const asset = '0x2222222222222222222222222222222222222222';
const market = '0x3333333333333333333333333333333333333333';
const txHash = `0x${'4'.repeat(64)}`;
const blockHash = `0x${'5'.repeat(64)}`;
const supplyAbi = parseAbi(['event Supply(address indexed reserve,address user,address indexed onBehalfOf,uint256 amount,uint16 indexed referralCode)']);
const submission: PendingLendingSubmission = {
  operationId: `lending:8453:${txHash}`,
  chainId: 8453,
  txHash,
  basketAddress: basket,
  requestedAction: 'SUPPLY',
  requestedAssetAddress: asset,
  requestedProvider: 'AAVE_V3',
  requestedMarketAddress: market,
};

function supplyReceipt(overrides: Partial<LendingReceipt> = {}): LendingReceipt {
  return {
    status: 'success',
    blockNumber: 42n,
    blockHash,
    logs: [{
      address: market,
      topics: encodeEventTopics({ abi: supplyAbi, eventName: 'Supply', args: { reserve: asset, onBehalfOf: basket, referralCode: 0 } })
        .filter((topic): topic is `0x${string}` => typeof topic === 'string'),
      data: encodeAbiParameters(
        [{ type: 'address' }, { type: 'uint256' }],
        [basket, 73n],
      ),
      logIndex: 7,
    }],
    ...overrides,
  };
}

describe('lending transaction submission', () => {
  it('records a hash as pending without inserting financial history', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{
      status: 'SUBMITTED', submitted_at: '2026-09-09T12:00:00.000Z', settled_at: null,
      receipt_block_number: null, receipt_block_hash: null, reason: null,
    }] }) };
    const result = await new LendingEventService(db as never).recordLendingEvent({
      chainId: 8453, basketAddress: basket, action: 'SUPPLY', assetAddress: asset,
      amount: '999', winningProvider: 'AAVE_V3', winningPool: market, txHash,
    });

    expect(result.lifecycle.status).toBe('SUBMITTED');
    expect(result.lifecycle.action).toBe('SUPPLY');
    expect(db.query.mock.calls[0][0]).toContain('lending_transaction_lifecycles');
    expect(db.query.mock.calls[0][0]).not.toContain('lending_market_logs');
  });
});

describe('receipt-derived lending reconciliation', () => {
  it('requires repeated aged node misses before dropping a submission', () => {
    const base = { submittedAt: new Date('2026-09-09T12:00:00Z'), now: new Date('2026-09-09T13:00:00Z'), dropAfterMs: 30 * 60_000, requiredMisses: 3, nodeStillHasTransaction: false };
    expect(statusForMissingReceipt({ ...base, missingObservations: 1 })).toBe('SUBMITTED');
    expect(statusForMissingReceipt({ ...base, missingObservations: 2 })).toBe('SUBMITTED');
    expect(statusForMissingReceipt({ ...base, missingObservations: 3 })).toBe('DROPPED');
    expect(statusForMissingReceipt({ ...base, missingObservations: 3, nodeStillHasTransaction: true })).toBe('SUBMITTED');
  });

  it('links replacements only by exact chain, sender, and nonce', () => {
    const original = { chainId: 8453, senderAddress: basket, nonce: 7 };
    expect(isSameNonceReplacement(original, { chainId: 8453, senderAddress: basket.toUpperCase(), nonce: 7 })).toBe(true);
    expect(isSameNonceReplacement(original, { chainId: 8453, senderAddress: basket, nonce: 8 })).toBe(false);
    expect(isSameNonceReplacement(original, { chainId: 1, senderAddress: basket, nonce: 7 })).toBe(false);
  });

  it('selects only the exact same-sender same-nonce replacement and is replay-safe', () => {
    const original = { chainId: 8453, senderAddress: basket, nonce: 7 };
    const candidates = [
      { hash: `0x${'6'.repeat(64)}`, chainId: 8453, senderAddress: basket, nonce: 8 },
      { hash: `0x${'7'.repeat(64)}`, chainId: 8453, senderAddress: asset, nonce: 7 },
      { hash: `0x${'8'.repeat(64)}`, chainId: 8453, senderAddress: basket.toUpperCase(), nonce: 7 },
    ];
    expect(replacementFromCandidates(original, candidates)).toBe(candidates[2].hash);
    expect(replacementFromCandidates(original, candidates)).toBe(candidates[2].hash);
  });
  it('uses the confirmed event amount and is stable when replayed', () => {
    const first = reconcileLendingReceipt(submission, supplyReceipt());
    const replay = reconcileLendingReceipt(submission, supplyReceipt());
    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      status: 'CONFIRMED_SUCCESS', confirmedAmount: '73', confirmedAction: 'SUPPLY',
      confirmedMarketAddress: market, confirmedAssetAddress: asset, receiptLogIndex: 7,
    });
  });

  it('makes a confirmed revert explicit', () => {
    expect(reconcileLendingReceipt(submission, supplyReceipt({ status: 'reverted', logs: [] }))).toMatchObject({
      status: 'CONFIRMED_REVERT', receiptBlockNumber: 42,
    });
  });

  it('keeps an unavailable receipt unknown', () => {
    expect(reconcileLendingReceipt(submission, null)).toMatchObject({ status: 'UNKNOWN', receiptBlockNumber: null });
  });

  it.each([
    ['market', { requestedMarketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
    ['basket', { basketAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
    ['action', { requestedAction: 'BORROW' as const }],
    ['asset', { requestedAssetAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
  ])('does not confirm a mismatched %s', (_label, mismatch) => {
    expect(reconcileLendingReceipt({ ...submission, ...mismatch }, supplyReceipt())).toMatchObject({ status: 'UNKNOWN' });
  });
});
