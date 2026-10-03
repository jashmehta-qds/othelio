import test from "node:test";
import assert from "node:assert/strict";
import { deriveBasketDetailState } from "./basket-detail-state.ts";

const base = {
  isWalletRestoring: false,
  isConnected: true,
  isLoading: false,
  isError: false,
  isIndexed: false,
};

test("reports wallet restoration before other states", () => {
  assert.equal(deriveBasketDetailState({ ...base, isWalletRestoring: true }), "restoring");
});

test("reports disconnected when the query is disabled without a wallet", () => {
  assert.equal(deriveBasketDetailState({ ...base, isConnected: false }), "disconnected");
});

test("reports loading while basket data is being queried", () => {
  assert.equal(deriveBasketDetailState({ ...base, isLoading: true }), "loading");
});

test("reports query errors after loading completes", () => {
  assert.equal(deriveBasketDetailState({ ...base, isError: true }), "error");
});

test("reports indexing after a successful query without indexed data", () => {
  assert.equal(deriveBasketDetailState(base), "indexing");
});

test("reports ready when indexed data exists", () => {
  assert.equal(deriveBasketDetailState({ ...base, isIndexed: true }), "ready");
});

test("keeps cached indexed data ready during a failed background refetch", () => {
  assert.equal(deriveBasketDetailState({ ...base, isIndexed: true, isError: true }), "ready");
});
