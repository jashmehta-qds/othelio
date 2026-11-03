"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AssetCatalogItem } from "../../../../packages/shared/src/portfolio";
import { fetchApi } from "@/lib/api";
import type { RiskSplitSeriesData } from "./useRiskSplit";
import { isOpenSeries, profileForSeries, type RiskProfile } from "./riskSplitMarket";

export interface RiskSplitMarket {
  series: RiskSplitSeriesData;
  asset: AssetCatalogItem | null;
  profile: RiskProfile;
}

const RISK_SPLIT_CHAIN_ID = 8453;

export function useRiskSplitMarkets() {
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const interval = window.setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 30_000);
    return () => window.clearInterval(interval);
  }, []);
  const catalogQuery = useQuery<{ data: AssetCatalogItem[] }>({
    queryKey: ["risk-split-assets", RISK_SPLIT_CHAIN_ID],
    queryFn: () => fetchApi(`/v1/assets?chainId=${RISK_SPLIT_CHAIN_ID}`),
  });
  const seriesQuery = useQuery<RiskSplitSeriesData[]>({
    queryKey: ["risk-split-series", RISK_SPLIT_CHAIN_ID],
    queryFn: () => fetchApi(`/v1/risksplit/series?chainId=${RISK_SPLIT_CHAIN_ID}`),
    refetchInterval: 30_000,
  });
  const assets = useMemo(() => catalogQuery.data?.data ?? [], [catalogQuery.data]);
  const markets = useMemo(() => (seriesQuery.data ?? [])
    .filter((series) => isOpenSeries(series, nowSeconds))
    .map((series) => ({
    series,
    asset: assets.find((asset) => asset.assetAddress.toLowerCase() === series.underlyingAddress.toLowerCase()) ?? null,
    profile: profileForSeries(series),
  })), [seriesQuery.data, assets, nowSeconds]);
  return {
    markets,
    assets,
    isLoading: seriesQuery.isLoading,
    isError: seriesQuery.isError,
    refetch: () => { void catalogQuery.refetch(); void seriesQuery.refetch(); },
  };
}
