"use client";

import { useQuery } from "@tanstack/react-query";
import { useChainId } from "wagmi";
import { bookPollingOptions, type BookPollingMode } from "../markets/bookPolling";

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

export function useRiskSplitBook(seriesAddress: string, claimType: "protected" | "upside", mode: BookPollingMode = "live") {
  const chainId = useChainId();

  const query = useQuery<BookDepthResponse>({
    queryKey: ["risksplit-book", chainId, seriesAddress?.toLowerCase(), claimType],
    queryFn: async ({ signal }) => {
      if (!seriesAddress) throw new Error("Series address is required");
      const res = await fetch(
        `${API_BASE}/v1/risksplit/series/${seriesAddress.toLowerCase()}/books/${claimType}?chainId=${chainId}`,
        { signal },
      );
      if (!res.ok) {
        throw new Error(`Failed to load order book (${res.status})`);
      }
      return res.json();
    },
    enabled: Boolean(seriesAddress),
    ...bookPollingOptions(mode),
  });

  const usableBook = query.isError ? null : query.data ?? null;
  const bestBid = usableBook?.bids?.[0] ?? null;
  const bestAsk = usableBook?.asks?.[0] ?? null;

  let spreadUsd: string | null = null;
  if (bestBid && bestAsk) {
    const spreadE6 = BigInt(bestAsk.rawPriceE6) - BigInt(bestBid.rawPriceE6);
    if (spreadE6 >= BigInt(0)) {
      spreadUsd = `$${(Number(spreadE6) / 1e6).toFixed(4)}`;
    }
  }

  return {
    book: usableBook,
    bids: usableBook?.bids ?? [],
    asks: usableBook?.asks ?? [],
    recentTrades: usableBook?.recentTrades ?? [],
    bestBid,
    bestAsk,
    spreadUsd,
    sequence: usableBook?.sequence ?? 0,
    asOfBlock: usableBook?.asOfBlock ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
