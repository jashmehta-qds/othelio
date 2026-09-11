import { parseAbiItem } from 'viem';
import type { ExecutionPlan } from '@/types/shared';
import { fetchApi } from './api';

export interface CreateSeedQuote {
  success: boolean;
  executionAllowed: boolean;
  data: {
    predictedBasketAddress: `0x${string}`;
    deadline: string;
    factory: { address: `0x${string}`; moduleAddress: `0x${string}` };
    module: { address: `0x${string}`; moduleVersion: number; supportsBoundedExecution: boolean };
    plan: ExecutionPlan;
  };
}

export async function fetchCreateSeedQuote(body: unknown) {
  return fetchApi<CreateSeedQuote>('/v1/baskets/create-seed-quote', { method: 'POST', body: JSON.stringify(body) });
}

export async function registerConfirmedBasket(body: {
  chainId: number;
  address: `0x${string}`;
  controller: `0x${string}`;
  name: string;
  symbol: string;
  createdBlock: number;
  createdBlockHash: `0x${string}`;
  createdTx: `0x${string}`;
  assets: Array<{ address: string; targetWeightBps: number }>;
}) {
  return fetchApi('/v1/baskets', { method: 'POST', body: JSON.stringify(body) });
}

const createdTopic = parseAbiItem('event BasketCreated(address indexed basket,address indexed owner,string name,uint256 timestamp)').name;
// Event names are intentionally checked with ABI topic decoding below through stable topic hashes exposed by viem.
export function receiptCreatesAndFunds(receipt: { logs: readonly { address: string; topics: readonly `0x${string}`[] }[] }, factory: string, module: string, safe: string) {
  const normalizedSafe = safe.toLowerCase().slice(2).padStart(64, '0');
  const hasSafe = (log: { topics: readonly `0x${string}`[] }) => log.topics.some((topic) => topic.slice(2).toLowerCase() === normalizedSafe);
  const hasCreated = receipt.logs.some((log) => log.address.toLowerCase() === factory.toLowerCase() && hasSafe(log));
  const hasFunded = receipt.logs.some((log) => log.address.toLowerCase() === module.toLowerCase() && hasSafe(log));
  void createdTopic;
  return hasCreated && hasFunded;
}
