import test from "node:test";
import assert from "node:assert/strict";
import { upsideScenario } from "./upsideScenario";

test("upside pays the size of the move, not a fixed yes/no prize", () => {
  assert.deepEqual(upsideScenario(100, 80), { upside: 0, residual: 80 });
  assert.deepEqual(upsideScenario(100, 100), { upside: 0, residual: 100 });
  assert.deepEqual(upsideScenario(100, 120), { upside: 20, residual: 100 });
  assert.deepEqual(upsideScenario(100, 150), { upside: 50, residual: 100 });
});

test("both claims together conserve the stock value, including a worthless stock", () => {
  for (const price of [0, 0.01, 85, 99.99, 100, 100.01, 200, 10000]) {
    const { upside, residual } = upsideScenario(100, price);
    assert.ok(Math.abs(upside + residual - price) < 0.000001);
    assert.ok(upside >= 0 && residual >= 0);
  }
});
