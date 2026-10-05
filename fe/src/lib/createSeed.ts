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

export function extractCreatedBasketAddress(
  receipt: { logs: readonly { address: string; topics: readonly `0x${string}`[] }[] },
  factory: string
): `0x${string}` | null {
  const factoryLog = receipt.logs.find(
    (log) => log.address.toLowerCase() === factory.toLowerCase() && log.topics.length >= 2
  );
  if (!factoryLog || !factoryLog.topics[1]) return null;
  return `0x${factoryLog.topics[1].slice(26)}` as `0x${string}`;
}
import { fetchApi } from './api';
