import { NextResponse } from "next/server";
import { assetPrices } from "@/lib/baskets";

export const revalidate = 60; // 1-minute server-side cache

type PriceCache = {
  timestamp: number;
  data: Record<string, number>;
};

let cache: PriceCache | null = null;
const CACHE_TTL_MS = 60 * 1000; // 1 minute

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

  // Live prices from asset registry / fallback table
  const fetchedPrices: Record<string, number> = {
    ...assetPrices,
  };

  cache = {
    timestamp: now,
    data: fetchedPrices,
  };

  return NextResponse.json(fetchedPrices, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
      "X-Price-Cache": "MISS",
    },
  });
}
