import test from 'node:test';
import assert from 'node:assert/strict';
import { basketListTotal } from './basket-list-value.ts';

test('unknown basket valuations never appear as a zero or complete total', () => {
  assert.equal(basketListTotal([{ totalNavUsdcMicro: '1000000' }, { totalNavUsdcMicro: null }]), null);
});
test('sums known values and preserves an actual empty portfolio', () => {
  assert.equal(basketListTotal([{ totalNavUsdcMicro: '1250000' }, { totalNavUsdcMicro: '750000' }]), 2);
  assert.equal(basketListTotal([]), 0);
});
