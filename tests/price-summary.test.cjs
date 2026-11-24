const {test} = require('node:test');
const assert = require('node:assert/strict');
const {summarize} = require('../price-summary.js');

const asset = (data, overrides = {}) => ({
  symbol: 'AAPL', currency: 'USD', fetchedAt: '2026-11-24T01:00:00Z', data, ...overrides
});

test('prefers the latest comparable close within 1% and ignores the last 29 calendar days', () => {
  const result = summarize(asset([
    ['2026-11-23', 100, 60], ['2026-11-01', 100], ['2026-10-24', 101],
    ['2026-10-23', 100], ['2026-08-01', 100]
  ]));
  assert.equal(result.current.price, 100);
  assert.equal(result.comparison.date, '2026-10-24');
  assert.equal(result.withinBand, true);
});

test('falls back to the closest historical price and measures both drawdowns', () => {
  const result = summarize(asset([
    ['2025-01-01', 200], ['2026-09-01', 120], ['2026-10-01', 60],
    ['2026-10-20', 90], ['2026-11-23', 100]
  ]));
  assert.equal(result.comparison.date, '2026-10-20');
  assert.equal(result.withinBand, false);
  assert.equal(result.riskStart, '2026-09-01');
  assert.ok(Math.abs(result.peakGap - (-1 / 6)) < 1e-12);
  assert.equal(result.maxDrawdown, -0.5);
});

test('uses the capture time to exclude incomplete US, Korean and crypto bars', () => {
  const data = [{t: '2026-11-23', c: 90}, {t: '2026-11-24', c: 100}];
  for (const [symbol, currency, before, boundary] of [
    ['AAPL', 'USD', '21:59:59', '22:00:00'],
    ['005930.KS', 'KRW', '07:59:59', '08:00:00'],
    ['BTC-USD', 'USD', '23:59:59', null]
  ]) {
    const input = {symbol, currency, fetchedAt: '2026-11-24T' + before + 'Z'};
    const result = summarize(asset(data, input));
    assert.equal(result.current.date, '2026-11-23');
    assert.equal(result.comparison, null);
    assert.equal(result.maxDrawdown, null);
    const fetchedAt = boundary ? '2026-11-24T' + boundary + 'Z' : '2026-11-25T00:00:00Z';
    assert.equal(summarize(asset(data, {...input, fetchedAt})).current.date, '2026-11-24');
  }
  assert.equal(summarize(asset(data, {fetchedAt: undefined})), null);
});
