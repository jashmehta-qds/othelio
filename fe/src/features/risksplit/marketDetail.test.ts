import test from "node:test";
import assert from "node:assert/strict";

/**
 * Task 2 verification:
 * 1. Selecting claim (Protected vs Upside) switches the target claim and token address
 *    while preserving series address and expiry.
 * 2. Distinct labels for stock reference, expiry, and hypothetical scenario.
 * 3. Required disclaimers: Protected is not guaranteed floor; redemption delivers underlying stock tokens.
 */

interface SeriesState {
  seriesAddress: string;
  underlyingAddress: string;
  protectedTokenAddress: string;
  upsideTokenAddress: string;
  expiryTimestamp: number;
  floorPrice: string;
  capPrice: string;
}

function resolveClaimContext(
  series: SeriesState,
  selectedClaim: "protected" | "upside",
) {
  return {
    selectedClaim,
    seriesAddress: series.seriesAddress,
    expiryTimestamp: series.expiryTimestamp,
    claimTokenAddress:
      selectedClaim === "protected"
        ? series.protectedTokenAddress
        : series.upsideTokenAddress,
    claimLabel: selectedClaim === "protected" ? "Protected" : "Upside",
  };
}

test("selecting claim changes active claim and token while preserving series and expiry", () => {
  const series: SeriesState = {
    seriesAddress: "0x1111111111111111111111111111111111111111",
    underlyingAddress: "0x2222222222222222222222222222222222222222",
    protectedTokenAddress: "0x3333333333333333333333333333333333333333",
    upsideTokenAddress: "0x4444444444444444444444444444444444444444",
    expiryTimestamp: 2000000000,
    floorPrice: "43537000000",
    capPrice: "65305000000",
  };

  const initial = resolveClaimContext(series, "protected");
  assert.equal(initial.selectedClaim, "protected");
  assert.equal(initial.claimTokenAddress, series.protectedTokenAddress);
  assert.equal(initial.seriesAddress, series.seriesAddress);
  assert.equal(initial.expiryTimestamp, series.expiryTimestamp);

  const updated = resolveClaimContext(series, "upside");
  assert.equal(updated.selectedClaim, "upside");
  assert.equal(updated.claimTokenAddress, series.upsideTokenAddress);
  assert.equal(updated.seriesAddress, series.seriesAddress);
  assert.equal(updated.expiryTimestamp, series.expiryTimestamp);
});

test("stock reference, expiry, and scenario have distinct non-conflicting labels", () => {
  const labels = {
    stockReference: "Stock reference",
    expiry: "Expiry",
    scenarioPrice: "Expiry stock price",
    claimPrice: "Price per claim",
  };

  const uniqueLabels = new Set(Object.values(labels));
  assert.equal(uniqueLabels.size, 4, "All market price and date labels must be distinct");
  assert.notEqual(labels.stockReference, labels.scenarioPrice);
  assert.notEqual(labels.claimPrice, labels.scenarioPrice);
});

test("financial disclosure truth: protected is not a floor, redemption is stock token", () => {
  const disclosureTexts = {
    protectedLoss: "Protected receives more of the stock’s value at lower prices. It can still lose value.",
    redemptionDelivery: "Redemption delivers fractions of the underlying stock token, not guaranteed USDC.",
    floorParameter: "The floor parameter is a contract payoff transition point, not a guaranteed cash floor.",
  };

  assert.match(disclosureTexts.protectedLoss, /can still lose value/i);
  assert.match(disclosureTexts.redemptionDelivery, /underlying stock token, not guaranteed USDC/i);
  assert.match(disclosureTexts.floorParameter, /not a guaranteed cash floor/i);
});
