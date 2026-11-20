import { RiskSplitMarketDetail } from "@/features/risksplit/RiskSplitMarketDetail";

export default async function RiskSplitSeriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ seriesAddress: string }>;
  searchParams: Promise<{ side?: string }>;
}) {
  const { seriesAddress } = await params;
  const { side } = await searchParams;
  return (
    <RiskSplitMarketDetail
      key={`${seriesAddress}-${side}`}
      seriesAddress={seriesAddress}
      initialClaim={side === "upside" ? "upside" : "protected"}
    />
  );
}
