"use client";

import { useQuery } from "@tanstack/react-query";
import { useChainId } from "wagmi";

export interface BookLevel {
  priceUsd: string;
  rawPriceE6: string;
  amountClaim: string;
  totalClaim: string;
  orderCount: number;
  orderHash?: string;
}

export interface BookTrade {
  id: string;
  orderHash: string;
  side: "BUY" | "SELL";
  amountClaim: string;
  amountUsdc: string;
  priceUsd: string;
  txHash: string | null;
  occurredAt: string;
}

export interface BookDepthResponse {
  seriesAddress: string;
  claimType: "PROTECTED" | "UPSIDE";
  claimToken: string;
  quoteToken: string;
  sequence: number;
  asOfBlock: number;
  bids: BookLevel[];
  asks: BookLevel[];
  recentTrades: BookTrade[];
}

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

export function useRiskSplitBook(seriesAddress: string, claimType: "protected" | "upside") {
  const chainId = useChainId();

  const query = useQuery<BookDepthResponse>({
    queryKey: ["risksplit-book", chainId, seriesAddress?.toLowerCase(), claimType],
    queryFn: async () => {
      if (!seriesAddress) throw new Error("Series address is required");
      const res = await fetch(
        `${API_BASE}/v1/risksplit/series/${seriesAddress.toLowerCase()}/books/${claimType}?chainId=${chainId}`
      );
      if (!res.ok) {
        throw new Error(`Failed to load order book (${res.status})`);
      }
      return res.json();
    },
    enabled: Boolean(seriesAddress),
    refetchInterval: 3000, // Refresh every 3 seconds
    staleTime: 2000,
  });

  const bestBid = query.data?.bids?.[0] ?? null;
  const bestAsk = query.data?.asks?.[0] ?? null;

  let spreadUsd: string | null = null;
  if (bestBid && bestAsk) {
    const spreadE6 = BigInt(bestAsk.rawPriceE6) - BigInt(bestBid.rawPriceE6);
    if (spreadE6 >= BigInt(0)) {
      spreadUsd = `$${(Number(spreadE6) / 1e6).toFixed(4)}`;
    }
  }

  return {
    book: query.data ?? null,
    bids: query.data?.bids ?? [],
    asks: query.data?.asks ?? [],
    recentTrades: query.data?.recentTrades ?? [],
    bestBid,
    bestAsk,
    spreadUsd,
    sequence: query.data?.sequence ?? 0,
    asOfBlock: query.data?.asOfBlock ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
