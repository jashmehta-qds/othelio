import { UpsideMarketDetail } from "@/features/upside/UpsideMarketDetail";

export default async function UpsideSeriesPage({
  params,
}: {
  params: Promise<{ seriesAddress: string }>;
}) {
  const { seriesAddress } = await params;
  return <UpsideMarketDetail key={seriesAddress} seriesAddress={seriesAddress} />;
}
