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

export async function fetchSwapQuote(basketAddress: string, body: any) {
  return fetchApi<{
    success: boolean;
    data: {
      basketAddress: string;
      action: string;
      inputAsset: string;
      inputAmount: string;
      slippageBps: number;
      target: string;
      dexCalldata: `0x${string}`;
      soldAssets: string[];
      boughtAssets: string[];
      minBoughtAmounts: string[];
      basketTokens: string[];
      trades: any[];
    };
  }>(`/v1/baskets/${basketAddress}/quote-swaps`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
