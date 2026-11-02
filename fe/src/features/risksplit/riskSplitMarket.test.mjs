import test from "node:test";
import assert from "node:assert/strict";
import { profileForSeries, isOpenSeries, usdFromE8 } from "./riskSplitMarket.ts";

const series = {
  chainId: 8453,
  seriesAddress: "0x1111111111111111111111111111111111111111",
  underlyingAddress: "0x2222222222222222222222222222222222222222",
  protectedTokenAddress: "0x3333333333333333333333333333333333333333",
  upsideTokenAddress: "0x4444444444444444444444444444444444444444",
  settlementAdapterAddress: "0x5555555555555555555555555555555555555555",
  floorPrice: "8500000000",
  capPrice: "12500000000",
  expiryTimestamp: 2000000000,
  isSettled: false,
  settledPrice: null,
  protectedFraction: null,
  upsideFraction: null,
  creationReferencePriceUsdE8: "10000000000",
  creationFeedAddress: "0x6666666666666666666666666666666666666666",
  creationFeedRoundId: "123",
  creationReferenceBlock: 100,
  creationReferenceVerified: true,
};

test("named profiles require matching verified creation terms", () => {
  assert.equal(profileForSeries(series), "15-25");
  assert.equal(profileForSeries({ ...series, floorPrice: "5000000000", capPrice: "15000000000" }), "50-50");
  assert.equal(profileForSeries({ ...series, floorPrice: "7500000000", capPrice: "11000000000" }), "25-10");
  assert.equal(profileForSeries({ ...series, creationReferenceVerified: false }), "other");
  assert.equal(profileForSeries({ ...series, capPrice: "12600000000" }), "other");
});

test("open markets exclude expired, settled and zero-address series", () => {
  assert.equal(isOpenSeries(series, 1900000000), true);
  assert.equal(isOpenSeries(series, 2000000000), false);
  assert.equal(isOpenSeries({ ...series, isSettled: true }, 1900000000), false);
  assert.equal(isOpenSeries({ ...series, seriesAddress: "0x0000000000000000000000000000000000000000" }, 1900000000), false);
});

test("missing price is unavailable rather than zero", () => {
  assert.equal(usdFromE8(null), "—");
  assert.equal(usdFromE8("10000000000"), "$100.00");
});
