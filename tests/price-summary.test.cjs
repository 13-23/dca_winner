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

test('200-day and 60-week gaps use current confirmed close and the previous 59 weekly closes', () => {
  const rows = Array.from({length: 420}, (_, index) => [
    new Date(Date.UTC(2025, 0, 6 + index)).toISOString().slice(0, 10), 100
  ]);
  rows.pop();
  rows.at(-1)[1] = 200;
  rows.push(['2026-03-01', 500]);
  const result = summarize(asset(rows, {symbol:'BTC-USD', fetchedAt:'2026-03-01T00:00:00Z'}));
  assert.equal(result.current.price, 200);
  assert.equal(result.dailyGap, 200 / 100.5 - 1);
  assert.equal(result.weeklyGap, 200 / ((59 * 100 + 200) / 60) - 1);
  const short = summarize(asset(rows.slice(-10), {symbol:'BTC-USD', fetchedAt:'2026-03-01T00:00:00Z'}));
  assert.equal(short.dailyGap, null);
  assert.equal(short.weeklyGap, null);
});

test('comparison age uses complete calendar months including month-end dates', () => {
  const {comparisonAge} = require('../price-summary.js');
  const date = value => ({time: Date.parse(value)});
  assert.equal(comparisonAge(date('2026-11-20'), date('2024-08-20')), '약 2년 3개월 전');
  assert.equal(comparisonAge(date('2026-06-30'), date('2026-05-31')), '약 1개월 전');
  assert.equal(comparisonAge(date('2026-08-30'), date('2026-07-31')), '30일 전');
});

test('status differentiates successful no-new-close, retained data and a newer source file', () => {
  const {quoteStatus} = require('../price-summary.js');
  const fetchedAt = '2026-11-24T08:00:00Z', attemptedAt = '2026-11-24T08:01:00Z';
  assert.match(quoteStatus({fetchedAt, quoteUpdate:{status:'unchanged', fetchedAt, attemptedAt}}), /확정 종가 날짜 유지/);
  const quoteUpdate = {status:'retained', fetchedAt, attemptedAt};
  assert.match(quoteStatus({fetchedAt, quoteUpdate}), /갱신 실패/);
  assert.match(quoteStatus({fetchedAt:'2026-11-24T09:00:00Z', quoteUpdate}), /미기록/);
  assert.match(quoteStatus({fetchedAt}), /미기록/);
  assert.match(quoteStatus({fetchedAt, source:'Yahoo Finance'}), /검색 시세/);
});
