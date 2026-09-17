import { CONTRACT_B20_TOKENS } from '@othelio/shared';
import { isAddress } from 'viem';

export const BASE_AERODROME_SLIPSTREAM_ROUTER = '0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5';
export const BASE_USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
/** Local-only MockDEXRouter installed by the Anvil fixture process when chainId is 31337. */
export const LOCAL_AERODROME_SLIPSTREAM_ROUTER = '0xBD606f1dAE0285D55113eFC11501677B2221A4dd';

export const CANDIDATE_TICK_SPACINGS = [100, 200, 500, 2000] as const;

export interface AerodromeSlipstreamRoute {
  chainId: 31337 | 8453;
  token0: string;
  token1: string;
  tickSpacing: number;
  enabled: boolean;
}

/**
 * Reviewed default Aerodrome Slipstream routes on Base Mainnet (chainId 8453).
 * Sourced directly from contract B20 constants across candidate tick spacings [100, 200, 500, 2000].
 */
export const DEFAULT_AERODROME_SLIPSTREAM_ROUTES: AerodromeSlipstreamRoute[] = CONTRACT_B20_TOKENS.flatMap((tokenAddress) =>
  CANDIDATE_TICK_SPACINGS.map((tickSpacing) => ({
    chainId: 8453 as const,
    token0: BASE_USDC_ADDRESS,
    token1: tokenAddress,
    tickSpacing,
    enabled: true,
  }))
);

/**
 * Explicit local-development manifest. These routes target only the deployed
 * MockDEXRouter and must never be promoted to a production chain.
 */
export const LOCAL_AERODROME_SLIPSTREAM_ROUTES: AerodromeSlipstreamRoute[] = CONTRACT_B20_TOKENS.map((tokenAddress) => ({
  chainId: 31337,
  token0: BASE_USDC_ADDRESS,
  token1: tokenAddress,
  tickSpacing: 100,
  enabled: true,
}));

function key(chainId: number, tokenA: string, tokenB: string, tickSpacing?: number) {
  const pair = [tokenA.toLowerCase(), tokenB.toLowerCase()].sort().join(':');
  return tickSpacing !== undefined ? `${chainId}:${pair}:${tickSpacing}` : `${chainId}:${pair}`;
}

export function loadRoutes(): Map<string, AerodromeSlipstreamRoute> {
  const routes = new Map<string, AerodromeSlipstreamRoute>();

  // Populate default reviewed routes across tick spacings
  for (const route of DEFAULT_AERODROME_SLIPSTREAM_ROUTES) {
    routes.set(key(route.chainId, route.token0, route.token1, route.tickSpacing), route);
  }
  for (const route of LOCAL_AERODROME_SLIPSTREAM_ROUTES) {
    routes.set(key(route.chainId, route.token0, route.token1, route.tickSpacing), route);
  }

  // Allow runtime overrides via environment variable
  const raw = process.env.AERODROME_SLIPSTREAM_ROUTES_JSON;
  if (!raw) return routes;

  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('AERODROME_SLIPSTREAM_ROUTES_JSON must be an array.');

  for (const candidate of parsed) {
    const route = candidate as Partial<AerodromeSlipstreamRoute>;
    if (
      (route.chainId !== 8453 && route.chainId !== 31337) ||
      !isAddress(route.token0 ?? '') ||
      !isAddress(route.token1 ?? '') ||
      !Number.isInteger(route.tickSpacing) ||
      route.tickSpacing === 0
    ) {
      throw new Error('Invalid Aerodrome Slipstream route manifest entry.');
    }
    const routeKey = key(route.chainId, route.token0!, route.token1!, route.tickSpacing);
    if (route.enabled === false) {
      routes.delete(routeKey);
    } else if (route.enabled === true) {
      routes.set(routeKey, route as AerodromeSlipstreamRoute);
    } else {
      throw new Error('Invalid Aerodrome Slipstream route manifest entry: enabled flag must be boolean.');
    }
  }

  return routes;
}

export function getAerodromeSlipstreamRoutes(chainId: number, tokenIn: string, tokenOut: string): AerodromeSlipstreamRoute[] {
  const allRoutes = Array.from(loadRoutes().values());
  const inLower = tokenIn.toLowerCase();
  const outLower = tokenOut.toLowerCase();

  return allRoutes.filter(
    (r) =>
      r.chainId === chainId &&
      r.enabled &&
      ((r.token0.toLowerCase() === inLower && r.token1.toLowerCase() === outLower) ||
        (r.token0.toLowerCase() === outLower && r.token1.toLowerCase() === inLower))
  );
}

export function getAerodromeSlipstreamRoute(chainId: number, tokenIn: string, tokenOut: string): AerodromeSlipstreamRoute | null {
  const candidates = getAerodromeSlipstreamRoutes(chainId, tokenIn, tokenOut);
  return candidates.length > 0 ? candidates[0] : null;
}

export function getAllAerodromeSlipstreamRoutes(): AerodromeSlipstreamRoute[] {
  return Array.from(loadRoutes().values());
}
