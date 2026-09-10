import { NextResponse } from "next/server";
import { assetPrices } from "@/lib/baskets";

export const revalidate = 60; // 1-minute server-side cache

type PriceCache = {
  timestamp: number;
  data: Record<string, number>;
};

let cache: PriceCache | null = null;
const CACHE_TTL_MS = 60 * 1000; // 1 minute cache TTL

export async function GET() {
  const now = Date.now();

  if (cache && now - cache.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cache.data, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
        "X-Price-Cache": "HIT",
      },
    });
  }

  let livePrices: Record<string, number> = {};

  try {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
    const res = await fetch(`${backendUrl}/v1/baskets/assets/supported`, { cache: "no-store" });
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json?.data)) {
        json.data.forEach((item: any) => {
          if (item.symbol && typeof item.price === "number" && item.price > 0) {
            livePrices[item.symbol] = item.price;
          }
        });
      }
    }
  } catch (err) {
    console.warn("Could not fetch live oracle prices from indexer, falling back to cached prices:", err);
  }

  const updatedPrices: Record<string, number> = {
    ...assetPrices,
    ...(cache?.data || {}),
    ...livePrices,
  };

  cache = {
    timestamp: now,
    data: updatedPrices,
  };

  return NextResponse.json(updatedPrices, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
      "X-Price-Cache": Object.keys(livePrices).length > 0 ? "LIVE" : "FALLBACK_CACHE",
    },
  });
}
