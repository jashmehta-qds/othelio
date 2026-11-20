import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeFunctionData } from 'viem';
import { upsideFactoryAbi } from '@othelio/shared';
import { AdminUpsideService } from './admin-upside.service';

const underlying = '0xb200000000000000000000ab99cfa739e253872b';
const factory = '0x1111111111111111111111111111111111111111';
const adapter = '0x2222222222222222222222222222222222222222';
const feed = '0x3333333333333333333333333333333333333333';
const registry = '0x4444444444444444444444444444444444444444';
const now = Date.parse('2026-06-12T18:00:00Z') / 1000;
const expiry = Date.parse('2026-06-12T20:00:00Z') / 1000;
const { readContract, getBlock } = vi.hoisted(() => ({ readContract: vi.fn(), getBlock: vi.fn() }));

vi.mock('viem', async (importOriginal) => ({
  ...await importOriginal<typeof import('viem')>(),
  createPublicClient: () => ({ readContract, getBlock }),
}));

describe('AdminUpsideService', () => {
  const service = new AdminUpsideService();
  const dto = { underlying, expiryTimestamp: expiry, expectedMove: '2000000000' };
  let updatedAt: bigint;
  let adapterFeed: string;
  let supported: boolean;
  let answeredInRound: bigint;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now * 1000);
    vi.stubEnv('CHAIN_ID', '8453');
    vi.stubEnv('UPSIDE_FACTORY_ADDRESS', factory);
    vi.stubEnv('UPSIDE_SETTLEMENT_ADAPTER_ADDRESS', adapter);
    updatedAt = BigInt(now - 90);
    adapterFeed = feed;
    supported = true;
    answeredInRound = 5n;
    getBlock.mockResolvedValue({ number: 99n, timestamp: BigInt(now) });
    readContract.mockImplementation(async ({ functionName }) => {
      switch (functionName) {
        case 'assetRegistry': return registry;
        case 'getAsset': return { supported, isCoinbaseB20: true, priceFeed: feed, tokenDecimals: 8, feedDecimals: 8 };
        case 'symbol': return 'MSFTc';
        case 'priceFeed': return adapterFeed;
        case 'maxStaleness': return 3600n;
        case 'decimals': return 8;
        case 'description': return 'MSFT Total Return / USD';
        case 'latestRoundData': return [5n, 500_37000000n, updatedAt - 10n, updatedAt, answeredInRound];
        default: throw new Error(functionName);
      }
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it('returns serializable, ABI-encoded calldata with grid-aligned bounds and distinct presets', async () => {
    const preview = JSON.parse(JSON.stringify(await service.previewRound(dto)));
    expect(preview.referencePrice).toBe('50037000000');
    expect(preview.referenceRoundId).toBe('5');
    expect(preview.strikes.map((strike: { strikePriceFormatted: string }) => strike.strikePriceFormatted))
      .toEqual(['500.00', '510.00', '520.00', '540.00']);
    const [transaction] = preview.transactions;
    expect(transaction.target).toBe(factory);
    const decoded = decodeFunctionData({ abi: upsideFactoryAbi, data: transaction.data });
    expect(decoded.functionName).toBe('registerRound');
    if (decoded.functionName !== 'registerRound') throw new Error('Unexpected method');
    const [config] = decoded.args;
    expect(config.minStrike % config.strikeTick).toBe(0n);
    expect(config.maxStrike % config.strikeTick).toBe(0n);
    expect(config.referenceRoundId).toBe(5n);
    expect(config.referenceTime).toBe(updatedAt);
    expect(config.feed).toBe(feed);
  });

  it('rejects stale, incomplete, and unavailable feeds instead of preparing placeholder calldata', async () => {
    updatedAt = BigInt(now - 3601);
    await expect(service.previewRound(dto)).rejects.toThrow('fresh');
    updatedAt = BigInt(now - 60);
    answeredInRound = 4n;
    await expect(service.previewRound(dto)).rejects.toThrow('complete');
    getBlock.mockRejectedValueOnce(new Error('RPC unavailable'));
    await expect(service.previewRound(dto)).rejects.toThrow('Could not verify');
  });

  it('rejects a mismatched adapter, unsupported underlying, or invalid grid', async () => {
    adapterFeed = registry;
    await expect(service.previewRound(dto)).rejects.toThrow('does not match');
    adapterFeed = feed;
    supported = false;
    await expect(service.previewRound(dto)).rejects.toThrow('supported B20');
    supported = true;
    await expect(service.previewRound({ ...dto, strikeTick: '0' })).rejects.toThrow('positive');
    await expect(service.previewRound({ ...dto, strikeTick: '5000000000' })).rejects.toThrow('four distinct');
  });

  it('rejects past, holiday, early-close and incorrectly DST-adjusted expiries', async () => {
    await expect(service.previewRound({ ...dto, expiryTimestamp: now })).rejects.toThrow('future');
    await expect(service.previewRound({ ...dto, expiryTimestamp: Date.parse('2026-06-19T20:00:00Z') / 1000 }))
      .rejects.toThrow('holiday');
    await expect(service.previewRound({ ...dto, expiryTimestamp: Date.parse('2026-11-27T21:00:00Z') / 1000 }))
      .rejects.toThrow('full trading day');
    await expect(service.previewRound({ ...dto, expiryTimestamp: expiry + 3600 })).rejects.toThrow('close window');
    expect(readContract).not.toHaveBeenCalled();
  });
});
