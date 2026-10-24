const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const source = html.slice(html.indexOf('function indicators(bars) {'), html.indexOf('function prepare(j) {'));
const indicators = vm.runInNewContext(source + '\nindicators');
const bars = values => values.map(c => ({ c }));
test('indicators wait for 14 changes and 20 closes', () => {
  const result = indicators(bars(Array.from({ length: 20 }, (_, i) => i + 1)));
  assert.ok(result.rsi.slice(0, 14).every(v => v === null));
  assert.equal(result.rsi[14], 100);
  assert.ok(result.bb.slice(0, 19).every(v => v === null));
  assert.notEqual(result.bb[19], null);
});
test('Wilder RSI matches the published reference sequence', () => {
  const closes = [44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28,46.00];
  const { rsi } = indicators(bars(closes));
  assert.ok(Math.abs(rsi[14] - 70.4641350211) < 1e-8);
  assert.ok(Math.abs(rsi[15] - 66.2496185536) < 1e-8);
});
test('RSI handles flat, rising and falling prices without nonfinite values', () => {
  for (const [values, expected] of [
    [Array(30).fill(10), 50],
    [Array.from({length:30}, (_, i) => i + 1), 100],
    [Array.from({length:30}, (_, i) => 30 - i), 0]
  ]) assert.ok(indicators(bars(values)).rsi.slice(14).every(v => v === expected));
});
test('Bollinger bands use rolling population deviation and a 20-close mean', () => {
  const { bb } = indicators(bars(Array.from({length:21}, (_, i) => i + 1)));
  assert.equal(bb[19].mid, 10.5);
  assert.ok(Math.abs(bb[19].upper - (10.5 + 2 * Math.sqrt(33.25))) < 1e-12);
  assert.ok(Math.abs(bb[19].lower - (10.5 - 2 * Math.sqrt(33.25))) < 1e-12);
  assert.equal(bb[20].mid, 11.5);
});
test('short and constant histories do not fabricate bands', () => {
  assert.equal(indicators([]).rsi.length, 0);
  assert.equal(indicators(bars([10])).bb[0], null);
  const band = indicators(bars(Array(20).fill(123))).bb[19];
  assert.equal(band.lower,123);assert.equal(band.mid,123);assert.equal(band.upper,123);
});
