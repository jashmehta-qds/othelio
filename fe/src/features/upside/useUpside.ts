'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { fetchApi } from '@/lib/api';
import {
  UpsideAssetsResponse,
  UpsideMarketModel,
  UpsideRoundModel,
  UpsideStockHistoryResponse,
  UpsideOrderBookDepth,
  UpsideStoredOrderModel,
  UpsideSweepQuoteRequest,
  UpsideSweepQuoteResponse,
  UpsidePositionModel,
} from '@/types/shared';

export function useUpsideAssets(chainId: number = 8453) {
  return useQuery<UpsideAssetsResponse>({
    queryKey: ['upside-assets', chainId],
    queryFn: () => fetchApi<UpsideAssetsResponse>(`/v1/upside/assets?chainId=${chainId}`),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

export function useUpsideRounds(chainId: number = 8453) {
  return useQuery<{ data: UpsideRoundModel[] }>({
    queryKey: ['upside-rounds', chainId],
    queryFn: () => fetchApi<{ data: UpsideRoundModel[] }>(`/v1/upside/rounds?chainId=${chainId}`),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}

export function useUpsideMarkets(chainId: number = 8453, roundId?: number) {
  return useQuery<{ data: UpsideMarketModel[] }>({
    queryKey: ['upside-markets', chainId, roundId],
    queryFn: () => {
      const q = roundId !== undefined ? `?chainId=${chainId}&roundId=${roundId}` : `?chainId=${chainId}`;
      return fetchApi<{ data: UpsideMarketModel[] }>(`/v1/upside/markets${q}`);
    },
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
}

export function useUpsideStockHistory(chainId: number = 8453, assetAddress?: string) {
  return useQuery<UpsideStockHistoryResponse>({
    queryKey: ['upside-stock-history', chainId, assetAddress?.toLowerCase()],
    queryFn: () => fetchApi<UpsideStockHistoryResponse>(`/v1/upside/stocks/${assetAddress}/history?chainId=${chainId}`),
    enabled: Boolean(assetAddress),
    staleTime: 30_000,
  });
}

export function useUpsideOrderbook(
  chainId: number = 8453,
  seriesAddress?: string,
  claimType: 'UPSIDE' | 'RESIDUAL' = 'UPSIDE',
) {
  const query = useQuery<UpsideOrderBookDepth>({
    queryKey: ['upside-orderbook', chainId, seriesAddress?.toLowerCase(), claimType],
    queryFn: () =>
      fetchApi<UpsideOrderBookDepth>(
        `/v1/upside/orderbook/${seriesAddress}/${claimType}?chainId=${chainId}`,
      ),
    enabled: Boolean(seriesAddress),
    staleTime: 2_000,
    refetchInterval: 3_000,
  });
  return {
    ...query,
    // Keep the failure visible through background retries until a fetch succeeds.
    isUnavailable: query.isError || query.errorUpdatedAt > query.dataUpdatedAt,
  };
}

export function useUpsideUserOrders(chainId: number = 8453, userAddress?: string) {
  return useQuery<{ data: UpsideStoredOrderModel[] }>({
    queryKey: ['upside-user-orders', chainId, userAddress?.toLowerCase()],
    queryFn: () =>
      fetchApi<{ data: UpsideStoredOrderModel[] }>(
        `/v1/upside/orderbook/user/${userAddress}?chainId=${chainId}`,
      ),
    enabled: Boolean(userAddress),
    staleTime: 3_000,
    refetchInterval: 5_000,
  });
}

export function useUpsideUserPositions(chainId: number = 8453, userAddress?: string) {
  return useQuery<{ data: UpsidePositionModel[] }>({
    queryKey: ['upside-user-positions', chainId, userAddress?.toLowerCase()],
    queryFn: () =>
      fetchApi<{ data: UpsidePositionModel[] }>(
        `/v1/upside/positions/${userAddress}?chainId=${chainId}`,
      ),
    enabled: Boolean(userAddress),
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
}

export async function fetchSweepQuote(
  chainId: number,
  seriesAddress: string,
  req: UpsideSweepQuoteRequest,
): Promise<UpsideSweepQuoteResponse> {
  return fetchApi<UpsideSweepQuoteResponse>(
    `/v1/upside/orderbook/${seriesAddress}/quote?chainId=${chainId}`,
    {
      method: 'POST',
      body: JSON.stringify(req),
    },
  );
}

export async function submitLimitOrder(
  chainId: number,
  seriesAddress: string,
  claimType: 'UPSIDE' | 'RESIDUAL',
  order: any,
  signature: any,
) {
  return fetchApi('/v1/upside/orderbook/orders', {
    method: 'POST',
    body: JSON.stringify({
      chainId,
      seriesAddress,
      claimType,
      order,
      signature,
    }),
  });
}

export async function submitCancelIntent(orderHash: string, userAddress: string) {
  return fetchApi<{ orderHash: string; status: string; cancelTransactionData: { to: string; data: string } }>(
    `/v1/upside/orderbook/orders/${orderHash}/cancel-intent`,
    {
      method: 'POST',
      body: JSON.stringify({ userAddress }),
    },
  );
}
