import type { ExecutionPlan } from '@/types/shared';

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
      basketAddress?: string;
      action?: string;
      inputAsset?: string;
      inputAmount?: string;
      slippageBps?: number;
      target?: string;
      allowanceSpender?: string;
      soldAssets: string[];
      boughtAssets: string[];
      minBoughtAmounts: string[];
      basketTokens: string[];
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
      recipientAddress?: string;
      withdrawValueUsdE8?: string;
      withdrawal?: {
        tokens: string[];
        amounts: string[];
        remainingTokens: string[];
      };
    };
  }>(`/v1/baskets/${basketAddress}/quote-swaps`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function confirmBasketRebalance(
  basketAddress: string,
  body: {
    chainId: number;
    moduleAddress: string;
    txHash: `0x${string}`;
    targetWeights: Array<{ assetAddress: string; targetWeightBps: number }>;
  },
) {
  return fetchApi<{ success: true }>(`/v1/baskets/${basketAddress}/rebalance-confirmation`, {
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

export interface AccountSettings {
  accountAddress: string;
  slippageTolerance: number;
  deadlineMinutes: number;
  mevProtection: boolean;
  riskTier: string;
  customRiskBuffer: number | null;
  updatedAt?: string;
}

export async function fetchAuthNonce(address: string) {
  return fetchApi<{
    success: boolean;
    data: { nonce: string; message: string; expiresAt: string };
  }>(`/v1/auth/nonce?address=${address.toLowerCase()}`);
}

export async function verifyAuthSignature(address: string, message: string, signature: string) {
  return fetchApi<{
    success: boolean;
    data: { token: string; expiresAt: string };
  }>(`/v1/auth/verify`, {
    method: 'POST',
    body: JSON.stringify({ address, message, signature }),
  });
}

export async function fetchAccountSettingsApi(address: string) {
  return fetchApi<{
    success: boolean;
    data: AccountSettings;
  }>(`/v1/settings/${address.toLowerCase()}`);
}

export async function updateAccountSettingsApi(
  address: string,
  settings: Partial<AccountSettings>,
  token?: string,
) {
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return fetchApi<{
    success: boolean;
    data: AccountSettings;
  }>(`/v1/settings/${address.toLowerCase()}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(settings),
  });
}
