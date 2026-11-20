import { BadRequestException } from '@nestjs/common';
import { parseAbi, type PublicClient } from 'viem';

export const adminTokenAbi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
]);

const feedAbi = parseAbi([
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() view returns (uint8)',
  'function description() view returns (string)',
]);

export async function readAdminFeed(
  client: PublicClient,
  feed: `0x${string}`,
  block: { number: bigint; timestamp: bigint },
  maxAge = 86400n,
) {
  const query = { address: feed, abi: feedAbi, blockNumber: block.number };
  const [decimals, description, [roundId, price, startedAt, updatedAt, answeredInRound]] = await Promise.all([
    client.readContract({ ...query, functionName: 'decimals' }),
    client.readContract({ ...query, functionName: 'description' }),
    client.readContract({ ...query, functionName: 'latestRoundData' }),
  ]);
  if (roundId === 0n || price <= 0n || startedAt === 0n || startedAt > updatedAt ||
      updatedAt > block.timestamp || block.timestamp - updatedAt > maxAge || answeredInRound < roundId) {
    throw new BadRequestException('The feed does not have a complete, fresh, positive reference round.');
  }
  if (decimals !== 8) throw new BadRequestException('Only 8-decimal USD feeds are supported by the current market and catalog APIs.');
  return { roundId, price, updatedAt, decimals, description };
}
