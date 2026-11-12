import {
  AdminChallengeResponse,
  AdminVerifyResponse,
  AdminOverviewResponse,
  AdminAssetsResponse,
  AdminMarketsResponse,
  AdminMarketPreviewRequest,
  AdminMarketPreviewResponse,
  AdminOperationsResponse,
  AdminTransactionPreview,
} from '@othelio/shared';

const API_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3000';

class AdminApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
    if (typeof window !== 'undefined') {
      if (token) {
        localStorage.setItem('othelio_admin_token', token);
      } else {
        localStorage.removeItem('othelio_admin_token');
      }
    }
  }

  getToken(): string | null {
    if (!this.token && typeof window !== 'undefined') {
      this.token = localStorage.getItem('othelio_admin_token');
    }
    return this.token;
  }

  private async fetchJson<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let res: Response;
    try {
      res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
    } catch {
      throw new Error(`Cannot reach Othelio API at ${API_BASE_URL}. Check the admin app's NEXT_PUBLIC_BACKEND_URL and backend service.`);
    }

    if (!res.ok) {
      const errorText = await res.text();
      let errorJson: any;
      try {
        errorJson = JSON.parse(errorText);
      } catch {
        // Not JSON
      }
      const error: any = new Error(errorJson?.message || errorJson?.error || `API error ${res.status}: ${errorText}`);
      error.status = res.status;
      throw error;
    }

    return res.json();
  }

  async getChallenge(address: string, chainId?: number): Promise<AdminChallengeResponse> {
    return this.fetchJson<AdminChallengeResponse>('/v1/admin/auth/challenge', {
      method: 'POST',
      body: JSON.stringify({ address, chainId }),
    });
  }

  async verifySignature(address: string, message: string, signature: string, chainId?: number): Promise<AdminVerifyResponse> {
    const res = await this.fetchJson<AdminVerifyResponse>('/v1/admin/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ address, message, signature, chainId }),
    });
    if (res.token) {
      this.setToken(res.token);
    }
    return res;
  }

  async getMe(): Promise<{ address: string; chainId: number; isOwner: boolean; factoryAddress: string }> {
    return this.fetchJson('/v1/admin/auth/me');
  }

  async getOverview(chainId?: number): Promise<AdminOverviewResponse> {
    const q = chainId ? `?chainId=${chainId}` : '';
    return this.fetchJson<AdminOverviewResponse>(`/v1/admin/overview${q}`);
  }

  async getAssets(chainId?: number): Promise<AdminAssetsResponse> {
    const q = chainId ? `?chainId=${chainId}` : '';
    return this.fetchJson<AdminAssetsResponse>(`/v1/admin/assets${q}`);
  }

  async previewEnableAsset(assetAddress: string, chainId?: number): Promise<AdminTransactionPreview[]> {
    return this.fetchJson<AdminTransactionPreview[]>('/v1/admin/assets/preview-enable', {
      method: 'POST',
      body: JSON.stringify({ assetAddress, chainId }),
    });
  }

  async getMarkets(chainId?: number): Promise<AdminMarketsResponse> {
    const q = chainId ? `?chainId=${chainId}` : '';
    return this.fetchJson<AdminMarketsResponse>(`/v1/admin/markets${q}`);
  }

  async previewMarket(params: AdminMarketPreviewRequest): Promise<AdminMarketPreviewResponse> {
    return this.fetchJson<AdminMarketPreviewResponse>('/v1/admin/markets/preview', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async getOperations(chainId?: number): Promise<AdminOperationsResponse> {
    const q = chainId ? `?chainId=${chainId}` : '';
    return this.fetchJson<AdminOperationsResponse>(`/v1/admin/operations${q}`);
  }
}

export const adminApi = new AdminApiClient();
