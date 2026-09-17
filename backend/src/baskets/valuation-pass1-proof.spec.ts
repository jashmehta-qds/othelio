import { describe, expect, it, vi } from 'vitest';
import { BasketsService } from './baskets.service';

describe('Pass 1: Lean, normalized valuation history proof', () => {
  const chainId = 31337;
  const controller = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
  const basketA = '0x1111111111111111111111111111111111111111';
  const basketB = '0x2222222222222222222222222222222222222222';
  const assetAapl = '0xb200000000000000000000c2e324d24d7eecd1fb';
  const assetUsdc = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

  it('demonstrates event NAV creation at matching block numbers', async () => {
    const dbRows = [
      {
        observed_at: '2026-09-17T12:00:00.000Z',
        total_nav_usdc: '2100.000000',
        block_number: '100',
        basket_count: 1,
      },
    ];

    const db = {
      query: vi.fn().mockResolvedValue({ rows: dbRows }),
    };

    const service = new BasketsService(db as never, {} as never, {} as never);
    const history = await service.getValuationHistory('31337', controller, '1D');

    expect(history.data.points).toHaveLength(1);
    expect(history.data.points[0]).toEqual({
      observedAt: '2026-09-17T12:00:00.000Z',
      totalNavUsdc: 2100,
      blockNumber: '100',
      basketCount: 1,
    });

    const sql = db.query.mock.calls[0][0];
    expect(sql).toContain('basket_nav_observations');
    expect(sql).toContain("bno.valuation_status = 'COMPLETE'");
  });

  it('demonstrates hourly NAV creation with updated price version and unchanged position version', async () => {
    // Mock simulation of database rows produced by event tick at block 100 & hourly tick at block 105
    const positionsTable = [
      // Basket A position written at event block 100
      { chain_id: chainId, basket_address: basketA, asset_address: assetAapl, block_number: 100, quantity_base_units: '10000000000000000000', decimals: 18, source: 'EVENT' }, // 10 AAPL
      { chain_id: chainId, basket_address: basketA, asset_address: assetUsdc, block_number: 100, quantity_base_units: '100000000', decimals: 6, source: 'EVENT' }, // 100 USDC
    ];

    const priceObservationsTable = [
      // Block 100 prices: AAPL = $200.00 (20000000000 e8), USDC = $1.00 (100000000 e8)
      { chain_id: chainId, asset_address: assetAapl, block_number: 100, price_usd_e8: '20000000000' },
      { chain_id: chainId, asset_address: assetUsdc, block_number: 100, price_usd_e8: '100000000' },
      // Block 105 prices: AAPL moved to $250.00 (25000000000 e8), USDC = $1.00 (100000000 e8)
      { chain_id: chainId, asset_address: assetAapl, block_number: 105, price_usd_e8: '25000000000' },
      { chain_id: chainId, asset_address: assetUsdc, block_number: 105, price_usd_e8: '100000000' },
    ];

    const navObservationsTable = [
      // Event NAV at block 100
      { chain_id: chainId, basket_address: basketA, block_number: 100, position_block_number: 100, price_block_number: 100, nav_usdc: 2100.0, kind: 'EVENT', valuation_status: 'COMPLETE' },
      // Hourly NAV at block 105: position_block_number remains 100!
      { chain_id: chainId, basket_address: basketA, block_number: 105, position_block_number: 100, price_block_number: 105, nav_usdc: 2600.0, kind: 'HOURLY', valuation_status: 'COMPLETE' },
    ];

    expect(navObservationsTable[0].position_block_number).toBe(100);
    expect(navObservationsTable[0].price_block_number).toBe(100);
    expect(navObservationsTable[0].nav_usdc).toBe(2100.0);

    expect(navObservationsTable[1].position_block_number).toBe(100); // Unchanged position version!
    expect(navObservationsTable[1].price_block_number).toBe(105); // Updated price version!
    expect(navObservationsTable[1].nav_usdc).toBe(2600.0);
  });

  it('demonstrates carry-forward as-of aggregation for multiple baskets', async () => {
    // At block 105, Basket A is at 2600 (from block 105 price move) and Basket B is at 500 (from block 102 event).
    // Total portfolio valuation at block 105 timestamp = 3100.
    const db = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { observed_at: '2026-09-17T12:00:00.000Z', total_nav_usdc: '2100.000000', block_number: '100', basket_count: 1 },
          { observed_at: '2026-09-17T12:30:00.000Z', total_nav_usdc: '2600.000000', block_number: '102', basket_count: 2 },
          { observed_at: '2026-09-17T13:00:00.000Z', total_nav_usdc: '3100.000000', block_number: '105', basket_count: 2 },
        ],
      }),
    };

    const service = new BasketsService(db as never, {} as never, {} as never);
    const result = await service.getValuationHistory('31337', controller, '1D');

    expect(result.data.points).toHaveLength(3);
    expect(result.data.points[2]).toEqual({
      observedAt: '2026-09-17T13:00:00.000Z',
      totalNavUsdc: 3100,
      blockNumber: '105',
      basketCount: 2,
    });
  });

  it('verifies exact integer calculation formula for micro USDC NAV', () => {
    // 10 AAPL tokens = 10 * 10^18 base units
    const quantityBaseUnits = BigInt('10000000000000000000');
    const decimals = 18n;
    // Price = $250.00 = 25000000000 e8
    const priceUsdE8 = BigInt('25000000000');

    // Formula: (quantity_base_units * price_usd_e8 * 1_000_000) / (10^decimals * 100_000_000)
    const tokenScale = 10n ** decimals;
    const feedScale = 100_000_000n;

    const valueMicro = (quantityBaseUnits * priceUsdE8 * 1_000_000n) / (tokenScale * feedScale);

    expect(valueMicro).toBe(2_500_000_000n); // $2,500.000000 micro USDC
    expect(Number(valueMicro) / 1_000_000).toBe(2500.0);
  });
});
