import { BASE_LAUNCH_B20_TOKENS, CONTRACT_B20_TOKENS } from '@othelio/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BASE_AERODROME_SLIPSTREAM_ROUTER,
  BASE_USDC_ADDRESS,
  CANDIDATE_TICK_SPACINGS,
  DEFAULT_AERODROME_SLIPSTREAM_ROUTES,
  getAerodromeSlipstreamRoute,
  getAerodromeSlipstreamRoutes,
  getAllAerodromeSlipstreamRoutes,
  loadRoutes,
} from './aerodrome-slipstream-routes';

describe('aerodrome-slipstream-routes', () => {
  const originalEnv = process.env.AERODROME_SLIPSTREAM_ROUTES_JSON;
  const sampleB20TokenA = CONTRACT_B20_TOKENS[0]; // AAPLc
  const sampleB20TokenB = BASE_LAUNCH_B20_TOKENS[1]; // AMZNc

  beforeEach(() => {
    delete process.env.AERODROME_SLIPSTREAM_ROUTES_JSON;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.AERODROME_SLIPSTREAM_ROUTES_JSON = originalEnv;
    } else {
      delete process.env.AERODROME_SLIPSTREAM_ROUTES_JSON;
    }
  });

  it('exports valid Aerodrome router and Base USDC constants', () => {
    expect(BASE_AERODROME_SLIPSTREAM_ROUTER).toBe('0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F');
    expect(BASE_USDC_ADDRESS).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  });

  it('contains the reviewed executable pool for each launch asset', () => {
    expect(CONTRACT_B20_TOKENS).toHaveLength(13);
    expect(BASE_LAUNCH_B20_TOKENS).toHaveLength(7);
    expect(CANDIDATE_TICK_SPACINGS).toEqual([1, 10, 50, 100, 200, 500, 2000]);
    expect(DEFAULT_AERODROME_SLIPSTREAM_ROUTES).toHaveLength(7);

    for (const route of DEFAULT_AERODROME_SLIPSTREAM_ROUTES) {
      expect(route.chainId).toBe(8453);
      expect(route.token0).toBe(BASE_USDC_ADDRESS);
      expect(route.tickSpacing).toBe(10);
      expect(route.enabled).toBe(true);
      expect(BASE_LAUNCH_B20_TOKENS).toContain(route.token1);
    }
  });

  it('loads reviewed Base routes for both Base runtime environments', () => {
    const routes = getAllAerodromeSlipstreamRoutes();
    expect(routes).toHaveLength(7 + 7);
    expect(routes.filter((route) => route.chainId === 31337)).toHaveLength(7);
  });

  it('resolves routes bidirectionally regardless of address case', () => {
    // USDC -> B20
    const forwardRoutes = getAerodromeSlipstreamRoutes(8453, BASE_USDC_ADDRESS, sampleB20TokenA);
    expect(forwardRoutes).toHaveLength(1);

    // B20 -> USDC
    const reverseRoutes = getAerodromeSlipstreamRoutes(8453, sampleB20TokenA, BASE_USDC_ADDRESS);
    expect(reverseRoutes).toHaveLength(1);

    // Lowercase USDC -> Uppercase B20
    const lowerRoutes = getAerodromeSlipstreamRoutes(8453, BASE_USDC_ADDRESS.toLowerCase(), sampleB20TokenA.toLowerCase());
    expect(lowerRoutes).toHaveLength(1);
  });

  it('returns empty array for unreviewed token pairs', () => {
    const randomAddress = '0x1111111111111111111111111111111111111111';
    expect(getAerodromeSlipstreamRoutes(8453, BASE_USDC_ADDRESS, randomAddress)).toHaveLength(0);
    expect(getAerodromeSlipstreamRoutes(8453, sampleB20TokenA, sampleB20TokenB)).toHaveLength(0);
  });

  it('allows disabling a default route via AERODROME_SLIPSTREAM_ROUTES_JSON', () => {
    process.env.AERODROME_SLIPSTREAM_ROUTES_JSON = JSON.stringify([
      {
        chainId: 8453,
        token0: BASE_USDC_ADDRESS,
        token1: sampleB20TokenA,
        tickSpacing: 10,
        enabled: false,
      },
    ]);

    const routes = getAerodromeSlipstreamRoutes(8453, BASE_USDC_ADDRESS, sampleB20TokenA);
    expect(routes).toHaveLength(0);
  });

  it('allows adding a new verified route via AERODROME_SLIPSTREAM_ROUTES_JSON', () => {
    const customToken = '0x9999999999999999999999999999999999999999';
    process.env.AERODROME_SLIPSTREAM_ROUTES_JSON = JSON.stringify([
      {
        chainId: 8453,
        token0: BASE_USDC_ADDRESS,
        token1: customToken,
        tickSpacing: 50,
        enabled: true,
      },
    ]);

    const route = getAerodromeSlipstreamRoute(8453, BASE_USDC_ADDRESS, customToken);
    expect(route).not.toBeNull();
    expect(route?.tickSpacing).toBe(50);
  });

  it('throws on malformed AERODROME_SLIPSTREAM_ROUTES_JSON', () => {
    process.env.AERODROME_SLIPSTREAM_ROUTES_JSON = '{"not": "an array"}';
    expect(() => loadRoutes()).toThrow('AERODROME_SLIPSTREAM_ROUTES_JSON must be an array.');

    process.env.AERODROME_SLIPSTREAM_ROUTES_JSON = JSON.stringify([
      {
        chainId: 1, // Invalid chainId
        token0: BASE_USDC_ADDRESS,
        token1: sampleB20TokenA,
        tickSpacing: 100,
        enabled: true,
      },
    ]);
    expect(() => loadRoutes()).toThrow('Invalid Aerodrome Slipstream route manifest entry.');
  });
});
