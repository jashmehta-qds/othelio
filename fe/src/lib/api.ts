import type { ExecutionPlan } from '@/types/shared';

export type StalePriceReferenceWarning = {
  code: 'STALE_PRICE_REFERENCE';
  lastPriceReferenceAt: string;
  assets: Array<{
    assetAddress: string;
    priceUsdE8: string;
    feedUpdatedAt: string;
    ageSeconds: number;
    feedRoundId: string;
    quoteBlock: number;
  }>;
};

export type DustTradesSkippedWarning = {
  code: 'DUST_TRADES_SKIPPED';
  message: string;
  assets: Array<{
    assetAddress: string;
    valueUsd: number;
  }>;
};

export type QuoteWarning = StalePriceReferenceWarning | DustTradesSkippedWarning;
export type PriceReferenceWarning = QuoteWarning;

const localBackendUrl =
  typeof window === 'undefined'
    ? 'http://localhost:3001'
    : `${window.location.protocol}//${window.location.hostname}:3001`;

// `localhost` is correct only when the browser runs on the same machine as
// Next.js. On a phone connected through the LAN URL, it points at the phone;
// derive the host from the page unless a deployment explicitly overrides it.
const configuredBackendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;

if (process.env.NODE_ENV === 'production' && !configuredBackendUrl) {
  throw new Error('NEXT_PUBLIC_BACKEND_URL must be configured for a production deployment.');
}

const API_BASE_URL = configuredBackendUrl || localBackendUrl;

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
      warnings?: PriceReferenceWarning[];
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
  riskTier: string;
  customRiskBuffer: number | null;
  stalePriceTrades: 'allow' | 'warn' | 'reject';
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
