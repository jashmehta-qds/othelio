import { RiskSplitMarketDetail } from "@/features/risksplit/RiskSplitMarketDetail";

export default async function RiskSplitSeriesPage({ params }: { params: Promise<{ seriesAddress: string }> }) {
  const { seriesAddress } = await params;
  return <RiskSplitMarketDetail seriesAddress={seriesAddress} />;
}
