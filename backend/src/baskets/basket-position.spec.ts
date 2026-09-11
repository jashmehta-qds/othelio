import { describe, expect, it, vi } from 'vitest';
import { AAVE_V3_POOLS } from '../lending/adapters/aave-v3.adapter';
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
  it('reads liquid, receipt, and accrued debt balances at one block with immutable market identity', async () => {
    const { service, observedBlockNumbers } = makeService();
    const result = await service.getPositionSnapshot(basket, 8453);

    expect(result.data.blockNumber).toBe(123);
    expect(result.data.blockHash).toBe(blockHash);
    expect(result.data.tokens).toEqual([expect.objectContaining({
      assetAddress: usdc.toLowerCase(),
      decimals: 6,
      liquidAmountBaseUnits: '100000000',
      priceUsdE8: '100000000',
    })]);
    expect(result.data.markets).toEqual([{
      identity: {
        chainId: 8453,
        basketAddress: basket,
        protocol: 'AAVE_V3',
        marketAddress: AAVE_V3_POOLS[8453],
        assetAddress: usdc.toLowerCase(),
      },
      suppliedAmountBaseUnits: '200000000',
      accruedDebtAmountBaseUnits: '50000000',
    }]);
    expect(observedBlockNumbers.every((number) => number === 123n)).toBe(true);
    expect(result.data.readCompleteness).toBe('PARTIAL');
    expect(result.data.equityUsdE8).toBeNull();
    expect(result.data.issues).toContain('POSITION_DISCOVERY_SCOPED_TO_CONFIGURED_AAVE_V3_POOL');
    expect(result.capabilities.actions.BORROW.enforcement).toEqual({ api: true, onchain: false });
    expect(result.capabilities.authorityMode).toBe('UNRESTRICTED_OWNER');
    expect(result.capabilities.actions.REPAY.availability).toBe('AVAILABLE');
    expect(result.capabilities.actions.RELEASE_COLLATERAL.availability).toBe('CONDITIONAL');
  });

  it('only makes collateral release available for a known supplied position with verified zero debt', async () => {
    const { service } = makeService();
    const result = await service.getPositionSnapshot(basket, 8453);
    const client = (service as any).getClient();
    client.readContract.mockImplementation(async (request: any) => {
      switch (request.functionName) {
        case 'getReservesList': return [usdc];
        case 'ADDRESSES_PROVIDER': return provider;
        case 'getPriceOracle': return oracle;
        case 'BASE_CURRENCY_UNIT': return 100_000_000n;
        case 'getReserveData': return { aTokenAddress: aToken, stableDebtTokenAddress: stableDebt, variableDebtTokenAddress: variableDebt };
        case 'decimals': return 6;
        case 'symbol': return 'USDC';
        case 'getAssetPrice': return 100_000_000n;
        case 'balanceOf': return request.address.toLowerCase() === variableDebt.toLowerCase() || request.address.toLowerCase() === stableDebt.toLowerCase() ? 0n : 100_000_000n;
        default: throw new Error(`unexpected ${request.functionName}`);
      }
    });
    const refreshed = await service.getPositionSnapshot(basket, 8453);
    expect(refreshed.capabilities.actions.RELEASE_COLLATERAL.availability).toBe('AVAILABLE');
  });

  it('keeps a failed debt read unknown instead of reporting zero debt', async () => {
    const { service } = makeService(true);
    const result = await service.getPositionSnapshot(basket, 8453);

    expect(result.data.markets[0].accruedDebtAmountBaseUnits).toBeNull();
    expect(result.data.accruedDebtUsdE8).toBeNull();
    expect(result.data.issues.some((issue) => issue.startsWith('AAVE_DEBT_UNAVAILABLE:'))).toBe(true);
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
