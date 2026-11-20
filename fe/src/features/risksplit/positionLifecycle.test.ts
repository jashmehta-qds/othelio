import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePositionActionAvailability,
  PositionActionStateParams,
} from "./positionLifecycleLogic";

const baseParams: PositionActionStateParams = {
  isConnected: true,
  chainId: 8453,
  nowSeconds: 1700000000,
  expiryTimestamp: 1700003600, // +1 hr
  isSettled: false,
  underlyingBalance: "1.50",
  protectedBalance: "2.00",
  upsideBalance: "1.00",
  underlyingAllowance: "5.00",
  unitsCompatible: true,
};

test("position lifecycle: active series before expiry allows split and combine, blocks redeem and settle", () => {
  const state = evaluatePositionActionAvailability(baseParams);

  assert.equal(state.canSplit, true);
  assert.equal(state.needsSplitApproval("1.0"), false);
  assert.equal(state.splitDisabledReason, null);

  assert.equal(state.canCombine, true);
  assert.equal(state.maxCombinePair, "1.00"); // min of 2.00 and 1.00

  // Single-claim redemption is locked until settlement
  assert.equal(state.canRedeem, false);
  assert.match(state.redeemDisabledReason ?? "", /Available after settlement/i);

  // Settlement only after expiry
  assert.equal(state.canSettle, false);
});

test("position lifecycle: expired but unsettled series blocks split, allows combine, unlocks settlement", () => {
  const expiredParams: PositionActionStateParams = {
    ...baseParams,
    nowSeconds: 1700005000, // past expiry
  };
  const state = evaluatePositionActionAvailability(expiredParams);

  assert.equal(state.canSplit, false);
  assert.match(state.splitDisabledReason ?? "", /expired/i);

  // Combine matching pair remains allowed before settlement!
  assert.equal(state.canCombine, true);

  // Single-claim redemption still locked until settlement happens
  assert.equal(state.canRedeem, false);

  // Settle is now available
  assert.equal(state.canSettle, true);
});

test("position lifecycle: settled series blocks split and settle, allows single claim redeem", () => {
  const settledParams: PositionActionStateParams = {
    ...baseParams,
    nowSeconds: 1700005000,
    isSettled: true,
  };
  const state = evaluatePositionActionAvailability(settledParams);

  assert.equal(state.canSplit, false);
  assert.equal(state.canSettle, false); // already settled
  assert.equal(state.canCombine, false); // after settlement, redeem individual claims

  // Single claim redeem unlocked
  assert.equal(state.canRedeem, true);
  assert.equal(state.redeemDisabledReason, null);
});

test("position lifecycle: requires approval when underlying allowance is low", () => {
  const lowAllowanceParams: PositionActionStateParams = {
    ...baseParams,
    underlyingAllowance: "0.50",
  };
  const state = evaluatePositionActionAvailability(lowAllowanceParams);

  assert.equal(state.canSplit, true);
  assert.equal(state.needsSplitApproval("1.0"), true);
  assert.equal(state.needsSplitApproval("0.2"), false);
});

test("position lifecycle: wallet disconnected or wrong chain guards all actions", () => {
  const disconnected = evaluatePositionActionAvailability({
    ...baseParams,
    isConnected: false,
  });
  assert.equal(disconnected.canSplit, false);
  assert.equal(disconnected.canCombine, false);
  assert.equal(disconnected.canRedeem, false);
  assert.equal(disconnected.canSettle, false);
  assert.match(disconnected.guardMessage ?? "", /Connect a wallet/i);

  const wrongChain = evaluatePositionActionAvailability({
    ...baseParams,
    chainId: 1, // Ethereum mainnet instead of Base 8453
  });
  assert.equal(wrongChain.canSplit, false);
  assert.match(wrongChain.guardMessage ?? "", /Base/i);
});
