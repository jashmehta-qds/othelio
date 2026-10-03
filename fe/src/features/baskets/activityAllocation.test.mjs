import assert from "node:assert/strict";
import test from "node:test";
import { allocationChangesForActivity, touchedTargetWeights } from "./activityAllocation.ts";

test("shows only target weights for assets touched by the rebalance", () => {
  const visible = touchedTargetWeights({
    soldAssets: ["0xSOLD", "0xSOLD"],
    boughtAssets: ["0xBought"],
    targetWeights: [
      { assetAddress: "0xSold", weightBps: 0 },
      { assetAddress: "0xBought", weightBps: 6500 },
      { assetAddress: "0xUntouched", weightBps: 3500 },
    ],
  });

  assert.deepEqual(visible, [
    { assetAddress: "0xSold", weightBps: 0 },
    { assetAddress: "0xBought", weightBps: 6500 },
  ]);
});

test("uses the renderer's acquired-assets alias and tolerates absent movement lists", () => {
  const visible = touchedTargetWeights({
    soldAssets: ["0xSold"],
    acquiredAssets: ["0xBought"],
    targetWeights: [
      { assetAddress: "0xSold", weightBps: 2500 },
      { assetAddress: "0xBought", weightBps: 3000 },
      { assetAddress: "0xOther", weightBps: 4500 },
    ],
  });

  assert.deepEqual(visible, [
    { assetAddress: "0xSold", weightBps: 2500 },
    { assetAddress: "0xBought", weightBps: 3000 },
  ]);
  assert.deepEqual(touchedTargetWeights({ targetWeights: [{ assetAddress: "0xOther", weightBps: 10000 }] }), []);
});

test("compares touched targets with the nearest older allocation", () => {
  const changes = allocationChangesForActivity({
    soldAssets: ["0xMSFT"],
    boughtAssets: ["0xAAPL"],
    targetWeights: [
      { assetAddress: "0xMSFT", weightBps: 3398 },
      { assetAddress: "0xAAPL", weightBps: 3306 },
      { assetAddress: "0xUntouched", weightBps: 3296 },
    ],
  }, [
    { targetWeights: [{ assetAddress: "0xUnrelated", weightBps: 10000 }] },
    { targetWeights: [
      { assetAddress: "0xmsft", weightBps: 5000 },
      { assetAddress: "0xaapl", weightBps: 2500 },
    ] },
  ]);

  assert.deepEqual(changes, [
    { assetAddress: "0xMSFT", previousWeightBps: 5000, weightBps: 3398 },
    { assetAddress: "0xAAPL", previousWeightBps: 2500, weightBps: 3306 },
  ]);
});
