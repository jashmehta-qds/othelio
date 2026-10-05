import assert from "node:assert/strict";
import test from "node:test";
import { canvasBackingSize } from "./canvasBackingSize.ts";

test("uses layout dimensions rather than a transformed visual rectangle", () => {
  const canvas = {
    clientWidth: 400,
    clientHeight: 400,
    getBoundingClientRect: () => ({ width: 76, height: 76 }),
  };

  assert.equal(canvasBackingSize(canvas, 2), 720);
});

test("returns zero when the canvas has no layout size", () => {
  assert.equal(canvasBackingSize({ clientWidth: 0, clientHeight: 0 }, 2), 0);
});
