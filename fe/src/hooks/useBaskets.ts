import { useQuery, useMutation } from '@tanstack/react-query';
import type { BasketCapabilities, PositionSnapshot } from '@othelio/shared';
import { fetchApi } from '@/lib/api';

export interface IndexedBasket {
  chain_id: number;
  address: string;
  controller: string;
  name: string;
  symbol: string;
  created_block: number;
  created_tx: string;
  created_at: string;
  seed_amount?: number;
  value?: number;
  snapshot?: BasketSnapshot | null;
  assets?: BasketAsset[];
}

export interface BasketAsset {
  chain_id: number;
  basket_address: string;
  asset_address: string;
  target_weight_bps: number;
}

export interface BasketSnapshot {
  chain_id: number;
  basket_address: string;
  block_number: number;
  total_nav_usdc: number;
  shares_outstanding: string;
  holdings: any;
  prices: any;
  priced_at: string;
}

export interface BasketDetailsResponse {
  data: IndexedBasket & {
    assets: BasketAsset[];
    snapshot: BasketSnapshot | null;
  };
}

export interface BasketEvent {
  chain_id: number;
  tx_hash: string;
  log_index: number;
  block_number: number;
  block_hash: string;
  basket_address: string;
  event_type: 'FUNDED' | 'CREATED' | 'WEIGHTS_UPDATED' | 'WITHDRAWN' | string;
  actor_address: string;
  payload: any;
  occurred_at: string;
}

export function useBasketsList(chainId = 31337, controller?: string) {
  const query = controller ? `?chainId=${chainId}&controller=${controller}` : `?chainId=${chainId}`;
  return useQuery<{ data: IndexedBasket[] }>({
    queryKey: ['baskets', chainId, controller],
    queryFn: () => fetchApi<{ data: IndexedBasket[] }>(`/v1/baskets${query}`),
  });
}

export function useBasketDetails(address: string, chainId = 31337) {
  return useQuery<BasketDetailsResponse>({
    queryKey: ['basket', address, chainId],
    queryFn: () => fetchApi<BasketDetailsResponse>(`/v1/baskets/${address}?chainId=${chainId}`),
    enabled: Boolean(address),
  });
}

export function useBasketActivity(address: string, chainId = 31337) {
  return useQuery<{ data: BasketEvent[] }>({
    queryKey: ['basket-activity', address, chainId],
    queryFn: () => fetchApi<{ data: BasketEvent[] }>(`/v1/baskets/${address}/activity?chainId=${chainId}`),
    enabled: Boolean(address),
    refetchInterval: 3000,
  });
}

export interface PortfolioPositionsResponse {
  data: PositionSnapshot;
  capabilities: BasketCapabilities;
}

export function usePortfolioPositions(address: string, chainId = 31337) {
  return useQuery<PortfolioPositionsResponse>({
    queryKey: ['basket-positions', address.toLowerCase(), chainId],
    queryFn: () => fetchApi<PortfolioPositionsResponse>(
      `/v1/baskets/${address}/positions?chainId=${chainId}`,
    ),
    enabled: /^0x[a-fA-F0-9]{40}$/.test(address),
    refetchInterval: 15_000,
  });
}

export function useAllActivity(chainId = 31337) {
  return useQuery<{ data: BasketEvent[] }>({
    queryKey: ['all-activity', chainId],
    queryFn: () => fetchApi<{ data: BasketEvent[] }>(`/v1/baskets/activity/all?chainId=${chainId}`),
    refetchInterval: 3000,
  });
}

export function usePrepareOperation() {
  return useMutation({
    mutationFn: async ({
      operation,
      payload,
    }: {
      operation: 'mint' | 'withdraw' | 'rebalance';
      payload: Record<string, any>;
    }) => {
      return fetchApi<{ data: { to: string; calldata: string } }>(`/v1/prepare/${operation}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
  });
}

export interface SupportedAssetResponse {
  symbol: string;
  name: string;
  address: string;
  priceFeed: string;
  color: string;
  isCoinbaseB20: boolean;
}

export function useSupportedAssets() {
  return useQuery<{ data: SupportedAssetResponse[] }>({
    queryKey: ['supported-assets'],
    queryFn: () => fetchApi<{ data: SupportedAssetResponse[] }>('/v1/baskets/assets/supported'),
  });
}

export function useAssetPrices() {
  return useQuery<Record<string, number>>({
    queryKey: ['asset-prices'],
    queryFn: async () => {
      const res = await fetch('/api/prices');
      if (!res.ok) throw new Error('Failed to fetch asset prices');
      return res.json();
    },
    refetchInterval: 60000, // 1-minute interval
    staleTime: 60000,
  });
}
