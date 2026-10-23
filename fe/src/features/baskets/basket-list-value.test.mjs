import test from 'node:test';
import assert from 'node:assert/strict';
import { basketListTotal } from './basket-list-value.ts';

test('sums known values across baskets and treats unfunded baskets as zero', () => {
  assert.equal(basketListTotal([{ totalNavUsdcMicro: '1000000' }, { totalNavUsdcMicro: null }]), 1);
});
test('sums multiple values and preserves an actual empty portfolio', () => {
  assert.equal(basketListTotal([{ totalNavUsdcMicro: '1250000' }, { totalNavUsdcMicro: '750000' }]), 2);
  assert.equal(basketListTotal([]), 0);
});
