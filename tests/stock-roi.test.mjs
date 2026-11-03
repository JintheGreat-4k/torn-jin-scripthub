import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSource } from './helpers/load-source.mjs';

const L = loadSource('src/modules/stock-roi/logic.js', [
  'fmt$', 'fmtPct', 'parseOverrides', 'prepareData', 'valueBenefit', 'blocksHeld', 'buildRows', 'sortRows', 'DEFAULT_SETTINGS',
]);
const cfg = (o = {}) => ({ ...L.DEFAULT_SETTINGS, ...o });
const stock = (acronym, description, extra = {}) => ({ acronym, benefit: { type: 'active', description, frequency: 7, requirement: 1000, ...extra } });

const DATA = L.prepareData(
  {
    stocks: {
      1: { stock_id: 1, acronym: 'TSB', current_price: 1000, benefit: { type: 'active', frequency: 31, requirement: 3000000, description: '$50,000,000' } },
      2: { stock_id: 2, acronym: 'PAS', current_price: 300, benefit: { type: 'passive', frequency: 0, requirement: 100000, description: '10% discount' } },
    },
    items: { 1: { name: 'Feathery Hotel Coupon', market_value: 12000000 }, 206: { name: 'Xanax', market_value: 800000 } },
  },
  { stocks: { 1: { stock_id: 1, total_shares: 9000000, transactions: { a: { shares: 9000000, bought_price: 900 } } } } },
  { pointsmarket: { 1: { cost: 46000 }, 2: { cost: 45000 } } },
  123,
);

test('prepareData: items by normalized name, cheapest points, user errors', () => {
  assert.equal(DATA.ts, 123);
  assert.equal(DATA.pointsPrice, 45000);
  assert.equal(DATA.items.featheryhotelcoupon.mv, 12000000);
  assert.equal(DATA.stocks.length, 2);
  assert.equal(DATA.userStocks.length, 1);
  const bad = L.prepareData({}, { _err: 'API error 16' }, null, 0);
  assert.deepEqual(bad.userStocks, []);
  assert.equal(bad.userErr, 'API error 16');
  assert.equal(bad.pointsPrice, null);
});

test('valueBenefit: cash, items, points, energy, manual and passive', () => {
  assert.deepEqual(L.valueBenefit(stock('TSB', '$50,000,000'), DATA, cfg()), { value: 50000000, note: 'cash' });
  assert.equal(L.valueBenefit(stock('FHG', '1x Feathery Hotel Coupon'), DATA, cfg()).value, 12000000);
  assert.equal(L.valueBenefit(stock('X', '1x Unknown Thing'), DATA, cfg()).value, null);
  assert.equal(L.valueBenefit(stock('PTS', '100 Points'), DATA, cfg()).value, 4500000);
  assert.equal(L.valueBenefit(stock('PTS', '100 Points'), DATA, cfg({ points: 50000 })).value, 5000000);
  assert.equal(L.valueBenefit(stock('EN', '100 Energy'), DATA, cfg()).value, 320000);   // 800k / 250 * 100
  assert.equal(L.valueBenefit(stock('NV', '50 Nerve'), DATA, cfg()).value, null);
  assert.equal(L.valueBenefit(stock('NV', '50 Nerve'), DATA, cfg({ nerve: 1000 })).value, 50000);
  assert.equal(L.valueBenefit(stock('HRG', '1x Random Property'), DATA, cfg({ property: 300e6 })).value, 300e6);
  assert.deepEqual(L.valueBenefit(stock('TSB', '$1'), DATA, cfg({ overrides: { TSB: 7 } })), { value: 7, note: 'manual' });
  assert.deepEqual(L.valueBenefit(stock('P', 'x', { type: 'passive' }), DATA, cfg()), { value: null, note: 'passive' });
});

test('blocksHeld: requirement doubles per block', () => {
  assert.equal(L.blocksHeld(0, 1000), 0);
  assert.equal(L.blocksHeld(999, 1000), 0);
  assert.equal(L.blocksHeld(1000, 1000), 1);
  assert.equal(L.blocksHeld(2999, 1000), 1);
  assert.equal(L.blocksHeld(3000, 1000), 2);
  assert.equal(L.blocksHeld(7000, 1000), 3);
  assert.equal(L.blocksHeld(5000, 0), 0);
});

test('buildRows: ROI, next block, P/L', () => {
  const [tsb, pas] = L.buildRows(DATA, cfg());
  const yearly = 50e6 * 365 / 31;
  assert.equal(tsb.blocks, 2);                       // 9M shares with 3M requirement = 3M + 6M
  assert.equal(tsb.missing, 12000000);               // 3 blocks need 21M
  assert.equal(tsb.nextCost, 12000000 * 1000);
  assert.ok(Math.abs(tsb.roi - yearly / 3e9) < 1e-12);
  assert.ok(Math.abs(tsb.nextRoi - yearly / 12e9) < 1e-12);
  assert.equal(tsb.pl, 9e6 * 100);
  assert.ok(Math.abs(tsb.income - yearly * 2) < 1e-6);
  assert.equal(pas.isPassive, true);
  assert.equal(pas.roi, null);
  assert.equal(pas.nextRoi, null);
  assert.equal(pas.pl, null);
});

test('parseOverrides', () => {
  assert.deepEqual(L.parseOverrides('HRG=400m, tcc = 60000000; ABC=1.5b\nXYZ=2k'), { HRG: 400e6, TCC: 60e6, ABC: 1.5e9, XYZ: 2000 });
  assert.deepEqual(L.parseOverrides('garbage, =5, A=0'), {});
  assert.deepEqual(L.parseOverrides(''), {});
});

test('sortRows: empty values always last', () => {
  const rows = [{ v: 1 }, { v: null }, { v: 3 }, { v: 2 }];
  assert.deepEqual(L.sortRows([...rows], 'v', -1).map((r) => r.v), [3, 2, 1, null]);
  assert.deepEqual(L.sortRows([...rows], 'v', 1).map((r) => r.v), [1, 2, 3, null]);
});

test('formatters', () => {
  assert.equal(L.fmt$(1234), '$1.2k');
  assert.equal(L.fmt$(-2.5e9), '-$2.50b');
  assert.equal(L.fmt$(null), '–');
  assert.equal(L.fmtPct(0.1234), '12.34%');
});
