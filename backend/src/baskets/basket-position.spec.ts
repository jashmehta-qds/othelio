import { describe, expect, it, vi } from 'vitest';
import { BasketPositionService } from './basket-position.service';

const basket = '0x1111111111111111111111111111111111111111';
const usdc = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const provider = '0x2222222222222222222222222222222222222222';
const oracle = '0x3333333333333333333333333333333333333333';
const aToken = '0x4444444444444444444444444444444444444444';
const stableDebt = '0x5555555555555555555555555555555555555555';
const variableDebt = '0x6666666666666666666666666666666666666666';
const blockHash = `0x${'a'.repeat(64)}`;

function makeService(variableDebtFails = false, symbol = 'USDC') {
  const observedBlockNumbers: bigint[] = [];
  const client = {
    getBlock: vi.fn().mockResolvedValue({ number: 123n, hash: blockHash, timestamp: 1_789_000_000n }),
    getBytecode: vi.fn().mockResolvedValue('0x6000'),
    readContract: vi.fn(async (request: any) => {
      observedBlockNumbers.push(request.blockNumber);
      switch (request.functionName) {
        case 'getReservesList': return [usdc];
        case 'ADDRESSES_PROVIDER': return provider;
        case 'getPriceOracle': return oracle;
        case 'BASE_CURRENCY_UNIT': return 100_000_000n;
        case 'getReserveData': return {
          aTokenAddress: aToken,
          stableDebtTokenAddress: stableDebt,
          variableDebtTokenAddress: variableDebt,
        };
        case 'getUserAccountData': return [0n, 0n, 0n, 0n, 0n, 3_200_000_000_000_000_000n];
        case 'decimals': return 6;
        case 'symbol': return symbol;
        case 'getAssetPrice': return 100_000_000n;
        case 'balanceOf': {
          if (request.address.toLowerCase() === usdc.toLowerCase()) return 100_000_000n;
          if (request.address.toLowerCase() === aToken.toLowerCase()) return 200_000_000n;
          if (request.address.toLowerCase() === stableDebt.toLowerCase()) return 0n;
          if (request.address.toLowerCase() === variableDebt.toLowerCase()) {
            if (variableDebtFails) throw new Error('debt read failed');
            return 50_000_000n;
          }
          throw new Error('unexpected token');
        }
        default: throw new Error(`unexpected ${request.functionName}`);
      }
    }),
  };
  const db = {
    query: vi.fn().mockResolvedValue({ rows: [{ asset_address: usdc }] }),
  };
  const service = new BasketPositionService(db as never);
  (service as any).getClient = () => client;
  return { service, client, observedBlockNumbers };
}

describe('BasketPositionService', () => {
  it('uses the indexer-observed chain head for action readiness without a second RPC dependency', async () => {
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ next_block: '101', observed_head_block: '103', observed_head_at: new Date() }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const service = new BasketPositionService(db as never);
    (service as any).getClient = vi.fn(() => null);

    await expect(service.assertActionReadiness(8453, basket, [])).resolves.toEqual({ warnings: [] });
    expect((service as any).getClient).not.toHaveBeenCalled();
  });

  it('returns a warning instead of blocking when a usable indexed price reference is old', async () => {
    const feedUpdatedAt = new Date(Date.now() - 2 * 60 * 60 * 1_000);
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ next_block: '101', observed_head_block: '103', observed_head_at: new Date() }] })
        .mockResolvedValueOnce({ rows: [{ asset_address: provider, block_number: '100', feed_updated_at: feedUpdatedAt }] })
        .mockResolvedValueOnce({ rows: [{ asset_address: provider }] })
        .mockResolvedValueOnce({ rows: [{ asset_address: provider, last_checked_block: '100', status: 'CURRENT' }] }),
    };
    const service = new BasketPositionService(db as never);

    await expect(service.assertActionReadiness(8453, basket, [provider])).resolves.toEqual({
      warnings: [{
        code: 'STALE_PRICE_REFERENCE',
        lastPriceReferenceAt: feedUpdatedAt.toISOString(),
        assets: [expect.objectContaining({
          assetAddress: provider,
          feedUpdatedAt: feedUpdatedAt.toISOString(),
        })],
      }],
    });
  });

  it('allows a new target asset without a basket position or reconciliation row', async () => {
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ next_block: '101', observed_head_block: '103', observed_head_at: new Date() }] })
        .mockResolvedValueOnce({ rows: [{ asset_address: provider, block_number: '100', feed_updated_at: new Date() }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const service = new BasketPositionService(db as never);

    await expect(service.assertActionReadiness(8453, basket, [provider])).resolves.toEqual({ warnings: [] });
    expect(db.query).toHaveBeenCalledTimes(3);
  });

  it('still rejects a genuinely lagging indexed checkpoint', async () => {
    const db = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [{ next_block: '101', observed_head_block: '120', observed_head_at: new Date() }],
      }),
    };
    const service = new BasketPositionService(db as never);

    await expect(service.assertActionReadiness(8453, basket, [])).rejects.toMatchObject({
      response: { code: 'INDEXER_LAGGING' },
    });
  });

  it('reads and values liquid balances together with configured Aave positions', async () => {
    const { service, observedBlockNumbers } = makeService();
    const result = await service.getPositionSnapshot(basket, 31337);

    expect(result.data.blockNumber).toBe(123);
    expect(result.data.blockHash).toBe(blockHash);
    expect(result.data.tokens).toEqual([expect.objectContaining({
      assetAddress: usdc.toLowerCase(),
      decimals: 6,
      liquidAmountBaseUnits: '100000000',
      priceUsdE8: '100000000',
    })]);
    expect(result.data.markets).toEqual([expect.objectContaining({
      identity: expect.objectContaining({
        protocol: 'AAVE_V3',
        marketAddress: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
        assetAddress: usdc.toLowerCase(),
      }),
      suppliedAmountBaseUnits: '200000000',
      accruedDebtAmountBaseUnits: '50000000',
    })]);
    expect(observedBlockNumbers.every((number) => number === 123n)).toBe(true);
    expect(result.data.readCompleteness).toBe('COMPLETE');
    expect(result.data.grossAssetsUsdE8).toBe('30000000000');
    expect(result.data.accruedDebtUsdE8).toBe('5000000000');
    expect(result.data.equityUsdE8).toBe('25000000000');
    expect(result.data.aaveHealthFactorRay).toBe('3200000000000000000');
    expect(result.data.issues).not.toContain('POSITION_DISCOVERY_SCOPED_TO_CONFIGURED_AAVE_V3_POOL');
    expect(result.capabilities.actions.BORROW.enforcement).toEqual({ api: true, onchain: false });
    expect(result.capabilities.authorityMode).toBe('UNRESTRICTED_OWNER');
    expect(result.capabilities.actions.REPAY.availability).toBe('AVAILABLE');
    expect(result.capabilities.actions.RELEASE_COLLATERAL.availability).toBe('CONDITIONAL');
  });

  it('omits blank token metadata and reports it instead of failing the snapshot schema', async () => {
    const { service } = makeService(false, '   ');
    const result = await service.getPositionSnapshot(basket, 8453);

    expect(result.data.tokens[0].symbol).toBeUndefined();
    expect(result.data.issues).toContain(`TOKEN_SYMBOL_UNAVAILABLE:${usdc.toLowerCase()}`);
  });

  it('reports malformed request identity as a typed bad request', async () => {
    const { service } = makeService();
    await expect(service.getPositionSnapshot('not-an-address', 0)).rejects.toMatchObject({ status: 400 });
  });

  it('rejects an indexed basket that no longer exists after a local chain reset', async () => {
    const { service, client } = makeService();
    client.getBytecode.mockResolvedValueOnce('0x');

    await expect(service.getPositionSnapshot(basket, 8453)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('BASKET_NOT_DEPLOYED_ON_CHAIN'),
    });
  });

  it('returns an explicit unavailable snapshot when no RPC is configured', async () => {
    const service = new BasketPositionService({ query: vi.fn() } as never);
    const result = await service.getPositionSnapshot(basket, 1);

    expect(result.data.readCompleteness).toBe('UNAVAILABLE');
    expect(result.data.accruedDebtUsdE8).toBeNull();
    expect(result.data.issues).toContain('POSITION_DISCOVERY_NOT_PROOF_OF_ZERO_DEBT');
  });
});
