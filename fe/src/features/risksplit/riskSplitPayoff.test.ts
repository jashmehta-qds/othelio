import test from "node:test";
import assert from "node:assert/strict";
import {
  riskSplitPayoff,
  riskSplitStockFractions,
  formatStockFraction,
  WAD,
} from "./riskSplitPayoff";

test("authoritative payoff preview: five regimes, boundaries, S=0, and conservation", () => {
  const F = BigInt("43537000000"); // $435.37 in E8
  const C = BigInt("65305000000"); // $653.05 in E8
  const TWO = BigInt(2);

  // 1. S = 0 -> (0, 0)
  const zero = riskSplitPayoff(F, C, BigInt(0));
  assert.equal(zero.protectedValueE8, BigInt(0));
  assert.equal(zero.upsideValueE8, BigInt(0));

  // 2. Regime 1: 0 < S < F (e.g. S = 400)
  const low = riskSplitPayoff(F, C, BigInt("40000000000"));
  assert.equal(low.protectedValueE8, BigInt("40000000000"));
  assert.equal(low.upsideValueE8, BigInt(0));
  assert.equal(low.protectedValueE8 + low.upsideValueE8, BigInt("40000000000"));

  // Boundary S = F
  const atF = riskSplitPayoff(F, C, F);
  assert.equal(atF.protectedValueE8, F);
  assert.equal(atF.upsideValueE8, BigInt(0));
  assert.equal(atF.protectedValueE8 + atF.upsideValueE8, F);

  // 3. Regime 2: F <= S < 2F (pinned example: S = 660)
  const mid = riskSplitPayoff(F, C, BigInt("66000000000"));
  assert.equal(mid.protectedValueE8, BigInt("43537000000"));
  assert.equal(mid.upsideValueE8, BigInt("22463000000"));
  assert.equal(mid.protectedValueE8 + mid.upsideValueE8, BigInt("66000000000"));

  // Boundary S = 2F
  const at2F = riskSplitPayoff(F, C, TWO * F);
  assert.equal(at2F.protectedValueE8, F);
  assert.equal(at2F.upsideValueE8, F);
  assert.equal(at2F.protectedValueE8 + at2F.upsideValueE8, TWO * F);

  // 4. Regime 3: 2F <= S < 2C (e.g. S = 1000)
  const highMid = riskSplitPayoff(F, C, BigInt("100000000000"));
  assert.equal(highMid.protectedValueE8, BigInt("50000000000"));
  assert.equal(highMid.upsideValueE8, BigInt("50000000000"));
  assert.equal(highMid.protectedValueE8 + highMid.upsideValueE8, BigInt("100000000000"));

  // Boundary S = 2C
  const at2C = riskSplitPayoff(F, C, TWO * C);
  assert.equal(at2C.protectedValueE8, C);
  assert.equal(at2C.upsideValueE8, C);
  assert.equal(at2C.protectedValueE8 + at2C.upsideValueE8, TWO * C);

  // 5. Regime 4: S >= 2C (e.g. S = 1500)
  const veryHigh = riskSplitPayoff(F, C, BigInt("150000000000"));
  assert.equal(veryHigh.protectedValueE8, C);
  assert.equal(veryHigh.upsideValueE8, BigInt("150000000000") - C);
  assert.equal(veryHigh.protectedValueE8 + veryHigh.upsideValueE8, BigInt("150000000000"));
});

test("display conversion for stock fractions: integer-aware rounding and WAD parity", () => {
  const F = BigInt("43537000000");
  const C = BigInt("65305000000");
  const S = BigInt("66000000000");

  const fractions = riskSplitStockFractions(F, C, S);
  // 435.37 / 660 = ~0.6596515 -> 0.6597
  // 224.63 / 660 = ~0.3403484 -> 0.3403
  assert.equal(fractions.protectedFractionFormatted, "0.6597");
  assert.equal(fractions.upsideFractionFormatted, "0.3403");
  assert.equal(fractions.protectedFractionWad + fractions.upsideFractionWad, WAD);

  // Zero case
  const zeroFrac = riskSplitStockFractions(F, C, BigInt(0));
  assert.equal(zeroFrac.protectedFractionFormatted, "0.0000");
  assert.equal(zeroFrac.upsideFractionFormatted, "0.0000");
  assert.equal(zeroFrac.protectedFractionWad, BigInt(0));
  assert.equal(zeroFrac.upsideFractionWad, BigInt(0));

  // Below floor (S = 400)
  const lowFrac = riskSplitStockFractions(F, C, BigInt("40000000000"));
  assert.equal(lowFrac.protectedFractionFormatted, "1.0000");
  assert.equal(lowFrac.upsideFractionFormatted, "0.0000");
  assert.equal(lowFrac.protectedFractionWad, WAD);
  assert.equal(lowFrac.upsideFractionWad, BigInt(0));

  // Formatter helper with symbol
  assert.equal(formatStockFraction(fractions.protectedFractionFormatted, "MSFTc"), "0.6597 MSFTc");
});
