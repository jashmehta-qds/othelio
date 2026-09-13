import { CONTRACT_B20_TOKENS } from '@othelio/shared';
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
  const sampleB20TokenB = CONTRACT_B20_TOKENS[12]; // TSLAc

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
    expect(BASE_AERODROME_SLIPSTREAM_ROUTER).toBe('0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5');
    expect(BASE_USDC_ADDRESS).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  });

  it('contains candidate tick spacings [100, 200, 500, 2000] for 13 B20 tokens', () => {
    expect(CONTRACT_B20_TOKENS).toHaveLength(13);
    expect(CANDIDATE_TICK_SPACINGS).toEqual([100, 200, 500, 2000]);
    expect(DEFAULT_AERODROME_SLIPSTREAM_ROUTES).toHaveLength(13 * 4);

    for (const route of DEFAULT_AERODROME_SLIPSTREAM_ROUTES) {
      expect(route.chainId).toBe(8453);
      expect(route.token0).toBe(BASE_USDC_ADDRESS);
      expect([100, 200, 500, 2000]).toContain(route.tickSpacing);
      expect(route.enabled).toBe(true);
      expect(CONTRACT_B20_TOKENS).toContain(route.token1);
    }
  });

  it('loads default candidate routes across tick spacings', () => {
    const routes = getAllAerodromeSlipstreamRoutes();
    expect(routes).toHaveLength(52 + 13);
  });

  it('resolves routes bidirectionally regardless of address case', () => {
    // USDC -> B20
    const forwardRoutes = getAerodromeSlipstreamRoutes(8453, BASE_USDC_ADDRESS, sampleB20TokenA);
    expect(forwardRoutes).toHaveLength(4);

    // B20 -> USDC
    const reverseRoutes = getAerodromeSlipstreamRoutes(8453, sampleB20TokenA, BASE_USDC_ADDRESS);
    expect(reverseRoutes).toHaveLength(4);

    // Lowercase USDC -> Uppercase B20
    const lowerRoutes = getAerodromeSlipstreamRoutes(8453, BASE_USDC_ADDRESS.toLowerCase(), sampleB20TokenA.toLowerCase());
    expect(lowerRoutes).toHaveLength(4);
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
        tickSpacing: 100,
        enabled: false,
      },
    ]);

    const routes = getAerodromeSlipstreamRoutes(8453, BASE_USDC_ADDRESS, sampleB20TokenA);
    expect(routes.map((r) => r.tickSpacing)).not.toContain(100);
    expect(routes).toHaveLength(3);
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
