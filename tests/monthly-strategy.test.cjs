const {test} = require('node:test');
const assert = require('node:assert/strict');
const {compareMonthly} = require('../portfolio.js');

const asset = (symbol, rows, weight = 100, currency = 'KRW') => ({
  symbol, currency, weight, data: rows.map(([date, close, adjusted = close]) => [date, close, adjusted])
});
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, actual + ' != ' + expected);

test('same monthly flows fund both strategies; reserve executes at the next close', () => {
  const a = asset('KR', [['2025-12-31', 100], ['2026-01-02', 100], ['2026-01-05', 80],
    ['2026-01-06', 50], ['2026-01-08', 100], ['2026-02-02', 100]]);
  const result = compareMonthly({assets:[a], start:'2026-01-01', end:'2026-02-02',
    amount:100, share:0.5, threshold:0.2, frequency:'day'});
  assert.equal(result.contributions, 2);
  assert.equal(result.invested, 200);
  assert.equal(result.start, '2026-01-02');
  assert.equal(result.immediate.value, 200);
  assert.equal(result.reserve.value, 250);
  assert.equal(result.reserve.cash, 50);
  assert.equal(result.reserve.releases, 1);
  assert.equal(result.immediate.mdd, -0.5);
  assert.equal(result.reserve.mdd, -0.25);
  assert.equal(result.immediate.below, 3);
  assert.equal(result.immediate.longest, 3);
});

test('mixed markets execute per asset, utilize KRW FX and leave final-day signals unfilled', () => {
  const assets = [
    asset('KR', [['2025-12-31',100],['2026-01-02',100],['2026-01-03',80],['2026-01-06',80]], 50),
    asset('US', [['2025-12-31',100],['2026-01-02',100],['2026-01-05',100],['2026-01-06',80]], 50, 'USD')
  ];
  const result = compareMonthly({assets, start:'2026-01-01', end:'2026-01-06',
    fx:{USD:[['2025-12-31',10],['2026-01-05',20],['2026-01-06',10]]}, amount:1000, share:0.5, threshold:0.2});
  assert.equal(result.contributions, 1);
  assert.equal(result.reserve.releases, 1);
  closeTo(result.reserve.cash, 250);
  closeTo(result.reserve.value, 900);
  closeTo(result.immediate.value, 800);
});

test('new threshold crossings rearm and raw closes drive signals in adjusted mode', () => {
  const a = asset('KR', [['2026-01-01',100,50],['2026-01-02',80,50],['2026-01-05',70,50],
    ['2026-02-01',75,50],['2026-02-02',90,50],['2026-02-03',80,50],['2026-02-04',80,50]]);
  const options = {assets:[a], amount:100, share:0.5, threshold:0.2, adjusted:true};
  const result = compareMonthly(options);
  assert.equal(result.reserve.releases, 2);
  assert.equal(result.reserve.cash, 0);
  assert.equal(result.reserve.value, 200);
  assert.equal(result.reserve.below, 0);
  assert.deepEqual(compareMonthly({...options,share:0}).immediate, compareMonthly({...options,share:0}).reserve);
  assert.throws(() => compareMonthly({...options, threshold:0}), /하락 기준/);
});
