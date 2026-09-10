import type { ExecutionPlan } from '@othelio/shared';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

export async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.message || `API Error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

export async function fetchSwapQuote(basketAddress: string, body: unknown) {
  return fetchApi<{
    success: boolean;
    executionAllowed?: boolean;
    data: {
      basketAddress: string;
      action: string;
      inputAsset: string;
      inputAmount: string;
      slippageBps: number;
      target: string;
      allowanceSpender?: string;
      dexCalldata: `0x${string}`;
      soldAssets: string[];
      boughtAssets: string[];
      minBoughtAmounts: string[];
      basketTokens: string[];
      trades: unknown[];
      preparationReason?: string;
      plan?: ExecutionPlan;
      module?: {
        address: string;
        moduleVersion: number;
        supportsBoundedExecution: boolean;
      };
      route?: {
        provider: string;
        target: string;
        calldata: `0x${string}`;
        allowanceSpender: string;
        recipient: string;
        sellAsset: string;
        buyAsset: string;
        maxSellAmount: string;
        minBuyAmount: string;
        expiresAt: string;
      };
      rebalance?: {
        soldAssets: string[];
        maxSoldAmounts: string[];
        boughtAssets: string[];
        minBoughtAmounts: string[];
        basketTokens: string[];
        deadline: string;
      };
    };
  }>(`/v1/baskets/${basketAddress}/quote-swaps`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function fetchLendingMarkets(chainId: number = 31337) {
  return fetchApi<{
    success: boolean;
    data: unknown[];
  }>(`/v1/lending/markets?chainId=${chainId}`);
}

export async function recordLendingSubmission(
  basketAddress: string,
  body: {
    chainId: number;
    action: 'REPAY' | 'WITHDRAW';
    assetAddress: string;
    amount: string;
    winningProvider: string;
    winningPool: string;
    txHash: `0x${string}`;
  },
) {
  return fetchApi<{ success: true; lifecycle: { status: string } }>(
    `/v1/baskets/${basketAddress}/lending-log`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}
