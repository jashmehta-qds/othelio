import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AAVE_V3_POOLS } from './adapters/aave-v3.adapter';
import { LendingController } from './lending.controller';
import { LendingManagerService } from './lending-manager.service';

const baseRequest = {
  chainId: 8453,
  assetAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  amount: '1000000',
  safeAddress: '0x1111111111111111111111111111111111111111',
};

function makeManager() {
  const adapter = {
    name: 'AaveV3',
    supportedChainIds: [8453],
    getQuote: vi.fn().mockResolvedValue({
      providerName: 'AaveV3',
      targetPool: AAVE_V3_POOLS[8453],
      action: 'REPAY',
      calldata: '0x1234',
      assetAddress: baseRequest.assetAddress,
      amount: baseRequest.amount,
      supplyApy: 0,
      borrowApy: 0,
      isAvailable: true,
    }),
  };
  return { manager: new LendingManagerService({ query: vi.fn() } as never, adapter as never), adapter };
}

describe('portfolio-first lending preparation policy', () => {
  it.each(['SUPPLY', 'BORROW', 'REINVEST'] as const)('rejects %s before invoking an adapter', async (action) => {
    const { manager, adapter } = makeManager();
    const controller = new LendingController(manager);

    await expect(controller.getLendingQuote({ ...baseRequest, action })).rejects.toBeInstanceOf(ForbiddenException);
    expect(adapter.getQuote).not.toHaveBeenCalled();
  });

  it('requires an immutable position identity for recovery preparation', async () => {
    const { manager, adapter } = makeManager();

    await expect(manager.getBestLendingQuote({ ...baseRequest, action: 'REPAY' })).rejects.toBeInstanceOf(BadRequestException);
    expect(adapter.getQuote).not.toHaveBeenCalled();
  });

  it('preserves Aave repayment preparation for the exact discovered market', async () => {
    const { manager, adapter } = makeManager();
    const result = await manager.getBestLendingQuote({
      ...baseRequest,
      action: 'REPAY',
      protocol: 'AAVE_V3',
      marketAddress: AAVE_V3_POOLS[8453],
    });

    expect(result.winningQuote?.calldata).toBe('0x1234');
    expect(adapter.getQuote).toHaveBeenCalledOnce();
  });

  it('fails closed for unimplemented recovery protocols', async () => {
    const { manager, adapter } = makeManager();

    await expect(manager.getBestLendingQuote({
      ...baseRequest,
      action: 'WITHDRAW',
      protocol: 'MORPHO_BLUE',
      marketAddress: '0x7777777777777777777777777777777777777777',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(adapter.getQuote).not.toHaveBeenCalled();
  });
});
