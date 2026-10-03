import { useQuery, useMutation } from '@tanstack/react-query';
import { useAccount, useChainId, useReadContract } from 'wagmi';
import type { BasketCapabilities, PositionSnapshot } from '@/types/shared';
import type {
  AssetCatalogItem,
  ActivityEvent,
  ActivityPage,
  BasketDetail as SharedBasketDetail,
  BasketSummary,
  Holding as SharedHolding,
  PortfolioOverview as SharedPortfolioOverview,
} from '../../../packages/shared/src/portfolio';
import { fetchApi } from '@/lib/api';
import { CONTRACT_ADDRESSES } from '@/lib/contracts';

export type IndexedBasket = BasketSummary;

export interface BasketAsset {
  chain_id: number;
  basket_address: string;
  asset_address: string;
  target_weight_bps: number;
  updated_block: number | string;
  assetAddress?: string;
  targetWeightBps?: number;
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
  valuation_scope?: 'LEGACY' | 'END_OF_BLOCK_SPOT';
  valuation_source?: 'LEGACY_EVENT' | 'INDEXER_BLOCK_PINNED';
  valuation_status?: 'COMPLETE' | 'UNAVAILABLE';
}

export interface BasketDetailsResponse {
  data: SharedBasketDetail;
}
export type IndexedHolding = SharedHolding;
export type PortfolioOverview = SharedPortfolioOverview;

export type BasketEvent = ActivityEvent;

export type ValuationTimeframe = '1D' | '7D' | '30D';

export interface PortfolioValuationPoint {
  observedAt: string;
  totalNavUsdc: number;
  blockNumber: string;
  basketCount: number;
}

export interface PortfolioValuationHistoryResponse {
  data: {
    timeframe: ValuationTimeframe;
    points: PortfolioValuationPoint[];
  };
}

const DEFAULT_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 31337);

export function useBasketsList(chainId = DEFAULT_CHAIN_ID, controller?: string) {
  const query = controller ? `?chainId=${chainId}&controller=${controller}` : `?chainId=${chainId}`;
  return useQuery<{ data: IndexedBasket[] }>({
    queryKey: ['baskets', chainId, controller],
    queryFn: () => fetchApi<{ data: IndexedBasket[] }>(`/v1/baskets${query}`),
    // A controller address is the client-side session boundary. Never load the
    // unfiltered basket index into the browser while a wallet is disconnected.
    enabled: Boolean(controller),
  });
}

export function useBasketDetails(address: string, chainId = DEFAULT_CHAIN_ID, controller?: string, pendingTransaction = false) {
  return useQuery<BasketDetailsResponse>({
    queryKey: ['basket', address, chainId, controller?.toLowerCase()],
    queryFn: () => fetchApi<BasketDetailsResponse>(`/v1/baskets/${address}?chainId=${chainId}&controller=${encodeURIComponent(controller!)}`),
    enabled: Boolean(address && controller),
    refetchInterval: pendingTransaction ? 2_000 : 30_000,
  });
}

export function useBasketActivity(address: string, chainId = DEFAULT_CHAIN_ID, controller?: string, pendingTransaction = false) {
  return useQuery<ActivityPage>({
    queryKey: ['basket-activity', address, chainId, controller?.toLowerCase()],
    queryFn: () => fetchApi<ActivityPage>(`/v1/baskets/${address}/activity?chainId=${chainId}&controller=${encodeURIComponent(controller!)}`),
    enabled: Boolean(address && controller),
    refetchInterval: pendingTransaction ? 2_000 : 30_000,
  });
}

export interface PortfolioPositionsResponse {
  data: PositionSnapshot;
  capabilities: BasketCapabilities;
}

export interface AccountingAssetSummary {
  assetAddress: string;
  quantityBaseUnits: string;
  decimals: number;
  openBasisUsdcMicro: string;
  weightedAverageCostUsdcMicroPerBaseUnit: string | null;
  spotPriceUsdE8: string | null;
  spotValueUsdcMicro: string | null;
  unrealisedPnlUsdcMicro: string | null;
  accountingStatus: 'COMPLETE' | 'INCOMPLETE';
  issue: string | null;
  updatedAt: string;
}

export interface AccountingSummaryResponse {
  data: {
    chainId: number;
    basketAddress: string;
    controller: string;
    accountingPolicy: 'WEIGHTED_AVERAGE_PORTFOLIO_ACCOUNTING_NOT_TAX_ADVICE';
    assets: AccountingAssetSummary[];
  };
}

export function usePortfolioPositions(address: string, chainId = DEFAULT_CHAIN_ID, enabled = true) {
  return useQuery<PortfolioPositionsResponse>({
    queryKey: ['basket-positions', address.toLowerCase(), chainId],
    queryFn: () => fetchApi<PortfolioPositionsResponse>(
      `/v1/baskets/${address}/positions?chainId=${chainId}`,
    ),
    enabled: enabled && /^0x[a-fA-F0-9]{40}$/.test(address),
    refetchInterval: 15_000,
  });
}

export function useAccountingSummary(address: string, chainId = DEFAULT_CHAIN_ID, controller?: string) {
  return useQuery<AccountingSummaryResponse>({
    queryKey: ['basket-accounting-summary', address.toLowerCase(), chainId, controller?.toLowerCase()],
    queryFn: () => fetchApi<AccountingSummaryResponse>(
      `/v1/baskets/${address}/accounting-summary?chainId=${chainId}&controller=${encodeURIComponent(controller!)}`,
    ),
    enabled: Boolean(controller) && /^0x[a-fA-F0-9]{40}$/.test(address),
    refetchInterval: 15_000,
  });
}

export function useAllActivity(chainId = DEFAULT_CHAIN_ID, enabled = true) {
  const { address } = useAccount();
  return useQuery<ActivityPage>({
    queryKey: ['all-activity', chainId, address?.toLowerCase()],
    queryFn: () => fetchApi<ActivityPage>(`/v1/activity?chainId=${chainId}&controller=${encodeURIComponent(address!)}`),
    enabled: enabled && Boolean(address),
    refetchInterval: 30_000,
  });
}

export function usePortfolioOverview(chainId = DEFAULT_CHAIN_ID, controller?: string) {
  return useQuery<{ data: PortfolioOverview }>({
    queryKey: ['portfolio-overview', chainId, controller?.toLowerCase()],
    queryFn: () => fetchApi<{ data: PortfolioOverview }>(
      `/v1/portfolio/overview?chainId=${chainId}&controller=${encodeURIComponent(controller!)}`,
    ),
    enabled: Boolean(controller),
    refetchInterval: 30_000,
  });
}

export function usePortfolioValuationHistory(
  chainId = DEFAULT_CHAIN_ID,
  controller?: string,
  timeframe: ValuationTimeframe = '30D',
) {
  return useQuery<PortfolioValuationHistoryResponse>({
    queryKey: ['portfolio-valuation-history', chainId, controller, timeframe],
    queryFn: () => fetchApi<PortfolioValuationHistoryResponse>(
      `/v1/baskets/valuation-history?chainId=${chainId}&controller=${encodeURIComponent(controller!)}&timeframe=${timeframe}`,
    ),
    enabled: Boolean(controller),
    refetchInterval: 30_000,
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

export type SupportedAssetResponse = AssetCatalogItem;

export function useSupportedAssets() {
  return useQuery<{ data: SupportedAssetResponse[] }>({
    queryKey: ['supported-assets', DEFAULT_CHAIN_ID],
    queryFn: () => fetchApi<{ data: SupportedAssetResponse[] }>(`/v1/assets?chainId=${DEFAULT_CHAIN_ID}`),
  });
}

const usdcAbi = [{ inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' }] as const;

export function useWalletUsdcBalance() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId() || DEFAULT_CHAIN_ID;
  const usdcAddress = CONTRACT_ADDRESSES[chainId as keyof typeof CONTRACT_ADDRESSES]?.usdc;
  return useReadContract({
    address: usdcAddress as `0x${string}` | undefined,
    abi: usdcAbi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(isConnected && address && usdcAddress),
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
    },
  });
}
