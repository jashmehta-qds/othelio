import { upsideFactoryAbi, upsidePresetStrikes } from '@othelio/shared';
import { zeroAddress } from 'viem';
import type { usePublicClient, useWriteContract } from 'wagmi';

export async function deployPresetStrikes(
  client: NonNullable<ReturnType<typeof usePublicClient>>,
  account: `0x${string}`,
  address: `0x${string}`,
  roundId: bigint,
  write: ReturnType<typeof useWriteContract>['writeContractAsync'],
  onProgress: (index: number, total: number) => void = () => {},
) {
  const contract = { address, abi: upsideFactoryAbi } as const;
  const round = await client.readContract({ ...contract, functionName: 'getRound', args: [roundId] });
  const strikes = upsidePresetStrikes(round.referencePrice, round.expectedMove, round.strikeTick);
  if (new Set(strikes).size !== 4 || strikes.some((strike) => strike < round.minStrike || strike > round.maxStrike)) {
    throw new Error('The registered round does not fit the four standard presets.');
  }
  for (const [i, strike] of strikes.entries()) {
    onProgress(i + 1, strikes.length);
    const args = [roundId, strike] as const;
    const existing = await client.readContract({ ...contract, functionName: 'marketByRoundAndStrike', args });
    if (existing !== zeroAddress) continue;
    const { request } = await client.simulateContract({ ...contract, functionName: 'createMarket', args, account });
    const hash = await write(request);
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`Strike ${i + 1} reverted. Retry to deploy only missing strikes.`);
  }
}
