import test from "node:test";
import assert from "node:assert/strict";
import {
  pickDefaultOrder,
  computeSingleOrderTrade,
  formatSignedDifference,
} from "./tradeTicketLogic";
import { BookLevel } from "./useRiskSplitBook";

const sampleBids: BookLevel[] = [
  { priceUsd: "$431.50", rawPriceE6: "431500000", amountClaim: "0.80", totalClaim: "0.80", orderCount: 1, orderHash: "0xbid1" },
  { priceUsd: "$429.00", rawPriceE6: "429000000", amountClaim: "1.40", totalClaim: "2.20", orderCount: 1, orderHash: "0xbid2" },
];

const sampleAsks: BookLevel[] = [
  { priceUsd: "$437.20", rawPriceE6: "437200000", amountClaim: "0.60", totalClaim: "0.60", orderCount: 1, orderHash: "0xask1" },
  { priceUsd: "$439.00", rawPriceE6: "439000000", amountClaim: "0.90", totalClaim: "1.50", orderCount: 1, orderHash: "0xask2" },
];

test("best ask selects for Buy and best bid selects for Sell", () => {
  const buyDefault = pickDefaultOrder("BUY", sampleBids, sampleAsks);
  assert.notEqual(buyDefault, null);
  assert.equal(buyDefault?.orderHash, "0xask1");
  assert.equal(buyDefault?.priceUsd, "$437.20");
  assert.equal(buyDefault?.amountClaim, "0.60");

  const sellDefault = pickDefaultOrder("SELL", sampleBids, sampleAsks);
  assert.notEqual(sellDefault, null);
  assert.equal(sellDefault?.orderHash, "0xbid1");
  assert.equal(sellDefault?.priceUsd, "$431.50");
  assert.equal(sellDefault?.amountClaim, "0.80");
});

test("single order trade: caps requested quantity to selected order size and forbids multi-level sweep", () => {
  // User wants to buy 1.2 claims, but the best ask only has 0.60 claims.
  // The system MUST NOT sweep across levels. It caps executable amount to 0.60 and flags cap.
  const trade = computeSingleOrderTrade({
    side: "BUY",
    requestedAmountClaims: "1.2",
    selectedOrder: sampleAsks[0],
    scenarioPayoffPerClaim: 435.37,
  });

  assert.equal(trade.isValid, true);
  assert.equal(trade.isCapped, true);
  assert.equal(trade.effectiveAmountClaims, "0.60");
  assert.equal(trade.availableInOrder, "0.60");
  assert.equal(trade.priceUsd, "437.20");
  // Total USDC = 0.60 * 437.20 = 262.32
  assert.equal(trade.totalUsdc.toFixed(2), "262.32");
  // Scenario worth = 0.60 * 435.37 = 261.22
  assert.equal(trade.scenarioWorth.toFixed(2), "261.22");
  // Difference = 261.22 - 262.32 = -1.10
  assert.equal(trade.differenceFromCost.toFixed(2), "-1.10");
  assert.equal(trade.isMultiLevelSweep, false);
});

test("single order trade with exact or smaller amount", () => {
  const trade = computeSingleOrderTrade({
    side: "BUY",
    requestedAmountClaims: "0.50",
    selectedOrder: sampleAsks[0],
    scenarioPayoffPerClaim: 435.37,
  });

  assert.equal(trade.isValid, true);
  assert.equal(trade.isCapped, false);
  assert.equal(trade.effectiveAmountClaims, "0.50");
  assert.equal(trade.totalUsdc.toFixed(2), "218.60");
  assert.equal(trade.scenarioWorth.toFixed(2), "217.69");
  assert.equal(trade.differenceFromCost.toFixed(2), "-0.91");
});

test("single order trade: no resting order available", () => {
  const trade = computeSingleOrderTrade({
    side: "BUY",
    requestedAmountClaims: "1.0",
    selectedOrder: null,
    scenarioPayoffPerClaim: 435.37,
  });

  assert.equal(trade.isValid, false);
  assert.equal(trade.orderUnavailable, true);
  assert.equal(trade.totalUsdc, 0);
});

test("format signed difference shows plus and minus clearly", () => {
  assert.equal(formatSignedDifference(12.5), "+$12.50");
  assert.equal(formatSignedDifference(-0.91), "−$0.91");
  assert.equal(formatSignedDifference(0), "$0.00");
});
