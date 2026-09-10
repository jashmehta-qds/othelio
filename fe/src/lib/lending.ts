export type RiskTier = 'safe' | 'normal' | 'risky' | 'custom';

export interface RiskPreference {
  tier: RiskTier;
  bufferPct: number; // Percentage headroom kept below liquidation threshold (e.g. 30 = 30%)
}

// Default thresholds requested by user: Safe 30%, Normal 20%, Risky 10% min
export const RISK_PRESETS: Record<Exclude<RiskTier, 'custom'>, number> = {
  safe: 30.0,
  normal: 20.0,
  risky: 10.0,
};

export function getRiskTierPreference(): RiskPreference {
  if (typeof window === 'undefined') {
    return { tier: 'safe', bufferPct: 30.0 };
  }
  const savedTier = (localStorage.getItem('othelio_risk_tier') as RiskTier) || 'safe';
  const savedBuffer = localStorage.getItem('othelio_risk_buffer_pct');

  if (savedTier === 'custom' && savedBuffer) {
    const num = parseFloat(savedBuffer);
    return { tier: 'custom', bufferPct: !isNaN(num) ? num : 30.0 };
  }

  const bufferPct = RISK_PRESETS[savedTier as keyof typeof RISK_PRESETS] ?? 30.0;
  return { tier: savedTier, bufferPct };
}

export function setRiskTierPreference(tier: RiskTier, customBufferPct?: number): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('othelio_risk_tier', tier);

  if (tier === 'custom' && customBufferPct !== undefined) {
    localStorage.setItem('othelio_risk_buffer_pct', customBufferPct.toString());
  } else {
    const bufferPct = RISK_PRESETS[tier as keyof typeof RISK_PRESETS] ?? 30.0;
    localStorage.setItem('othelio_risk_buffer_pct', bufferPct.toString());
  }
  window.dispatchEvent(new Event('othelio_risk_settings_updated'));
}

export interface LendingVenueQuote {
  providerName: 'AaveV3' | 'CompoundV3' | 'Moonwell' | 'MorphoBlue';
  poolAddress: string;
  supplyApyPct: number;
  borrowApyPct: number;
  maxLtvPct: number; // Base protocol max LTV (e.g. 75%)
  liquidationThresholdPct: number; // Base protocol liquidation threshold (e.g. 80%)
  isRecommended?: boolean;
  isAvailable?: boolean;
}

export const AAVE_V3_POOL_ABI = [
  {
    inputs: [{ name: 'user', type: 'address' }],
    name: 'getUserAccountData',
    outputs: [
      { name: 'totalCollateralBase', type: 'uint256' },
      { name: 'totalDebtBase', type: 'uint256' },
      { name: 'availableBorrowsBase', type: 'uint256' },
      { name: 'currentLiquidationThreshold', type: 'uint256' },
      { name: 'ltv', type: 'uint256' },
      { name: 'healthFactor', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export const AAVE_V3_BASE_POOL_ADDRESS = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5' as const;

export function getRecommendedVenues(
  venues: Omit<LendingVenueQuote, 'isRecommended'>[],
  action: 'BORROW' | 'SUPPLY' = 'SUPPLY'
): LendingVenueQuote[] {
  const availableVenues = venues.filter((v) => v.isAvailable !== false && (v.supplyApyPct > 0 || v.borrowApyPct > 0));
  if (availableVenues.length === 0) {
    return venues.map((v) => ({ ...v, isRecommended: false }));
  }

  let bestIdx = -1;
  let maxNetSpread = -Infinity;

  venues.forEach((v, idx) => {
    if (v.isAvailable !== false) {
      const netSpread = v.supplyApyPct - v.borrowApyPct;
      if (netSpread > maxNetSpread) {
        maxNetSpread = netSpread;
        bestIdx = idx;
      }
    }
  });

  return venues.map((v, idx) => ({
    ...v,
    isRecommended: idx === bestIdx && v.isAvailable !== false,
  }));
}

export async function fetchLiveLendingVenues(
  chainId: number = 31337,
  assetAddress: string = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  amount: string = '100000000',
  action: 'BORROW' | 'SUPPLY' = 'BORROW'
): Promise<LendingVenueQuote[]> {
  try {
    const { fetchApi } = await import('./api');
    const res = await fetchApi<any>('/v1/lending/quote', {
      method: 'POST',
      body: JSON.stringify({
        chainId,
        action,
        assetAddress,
        amount,
        safeAddress: '0x0000000000000000000000000000000000000000',
      }),
    });

    if (res && res.allQuotes && res.allQuotes.length > 0) {
      const parsed = res.allQuotes.map((q: any) => {
        const pName = q.providerName === 'Aave v3' ? 'AaveV3' : q.providerName;
        return {
          providerName: pName as any,
          poolAddress: q.targetPool,
          supplyApyPct: q.supplyApy,
          borrowApyPct: q.borrowApy,
          maxLtvPct: pName === 'MorphoBlue' ? 77.0 : pName === 'AaveV3' ? 75.0 : 70.0,
          liquidationThresholdPct: pName === 'MorphoBlue' ? 82.5 : pName === 'AaveV3' ? 80.0 : 77.5,
          isAvailable: q.isAvailable ?? (q.supplyApy > 0 || q.borrowApy > 0),
        };
      });

      return getRecommendedVenues(parsed, action);
    }
  } catch (err) {
    console.warn('[Lending] Failed to fetch live quotes from backend:', err);
  }

  return [];
}

export async function fetchLiveBasketBreakdown(
  chainId: number = 31337,
  assets: Array<{ address: string; amount?: string }>
): Promise<Record<string, LendingVenueQuote[]>> {
  try {
    const { fetchApi } = await import('./api');
    const res = await fetchApi<any>('/v1/lending/basket-breakdown', {
      method: 'POST',
      body: JSON.stringify({
        chainId,
        assets,
      }),
    });

    if (res && res.breakdown && Array.isArray(res.breakdown)) {
      const map: Record<string, LendingVenueQuote[]> = {};
      res.breakdown.forEach((item: any) => {
        if (item.allVenues && item.allVenues.length > 0) {
          const parsed = item.allVenues.map((q: any) => {
            const pName = q.providerName === 'Aave v3' ? 'AaveV3' : q.providerName;
            return {
              providerName: pName as any,
              poolAddress: q.targetPool,
              supplyApyPct: q.supplyApy,
              borrowApyPct: q.borrowApy,
              maxLtvPct: pName === 'MorphoBlue' ? 77.0 : pName === 'AaveV3' ? 75.0 : 70.0,
              liquidationThresholdPct: pName === 'MorphoBlue' ? 82.5 : pName === 'AaveV3' ? 80.0 : 77.5,
              isAvailable: q.isAvailable ?? (q.supplyApy > 0 || q.borrowApy > 0),
            };
          });
          map[item.assetAddress.toLowerCase()] = getRecommendedVenues(parsed, 'SUPPLY');
        } else if (item.assetAddress) {
          map[item.assetAddress.toLowerCase()] = [];
        }
      });
      return map;
    }
  } catch (err) {
    console.warn('[Lending] Failed to fetch basket breakdown from backend:', err);
  }

  const map: Record<string, LendingVenueQuote[]> = {};
  assets.forEach((a) => {
    if (a.address) {
      map[a.address.toLowerCase()] = [];
    }
  });
  return map;
}

/**
 * Calculates max safe borrow capacity based on collateral NAV, pool liquidation threshold, and risk buffer %
 * Safe (30% buffer) on 80% pool liq threshold -> Max safe LTV = 50%
 */
export function calculateMaxBorrowCapacity(
  collateralNAV: number,
  liquidationThresholdPct: number = 80.0,
  bufferPct: number = 30.0
): { maxAllowedDebt: number; effectiveMaxLtvPct: number } {
  const effectiveMaxLtvPct = Math.max(5.0, liquidationThresholdPct - bufferPct);
  const maxAllowedDebt = (collateralNAV * effectiveMaxLtvPct) / 100;
  return { maxAllowedDebt, effectiveMaxLtvPct };
}

/**
 * Calculates Health Factor = (Collateral NAV * Pool Liquidation Threshold %) / Debt Amount
 * HF >= 1.50 -> Safe (emerald)
 * 1.15 <= HF < 1.50 -> Normal (amber)
 * HF < 1.15 -> Risky (rose)
 */
export function calculateHealthFactor(
  collateralNAV: number,
  debtAmount: number,
  liquidationThresholdPct: number = 80.0
): { healthFactor: number; status: 'safe' | 'normal' | 'risky'; color: string } {
  if (debtAmount <= 0) {
    return { healthFactor: 999.0, status: 'safe', color: '#10b981' };
  }
  const maxLiquidationVal = (collateralNAV * liquidationThresholdPct) / 100;
  const hf = maxLiquidationVal / debtAmount;

  if (hf >= 1.5) {
    return { healthFactor: hf, status: 'safe', color: '#10b981' };
  } else if (hf >= 1.15) {
    return { healthFactor: hf, status: 'normal', color: '#f59e0b' };
  } else {
    return { healthFactor: hf, status: 'risky', color: '#ef4444' };
  }
}
