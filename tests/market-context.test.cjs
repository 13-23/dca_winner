const {test} = require('node:test');
const assert = require('node:assert/strict');
const {summarize} = require('../market-context.js');

function data(drawdown, levels) {
  return {current:{drawdown,peakDate:'2026-01-01'},views:{20:{
    levels, ranks:{drawdown:{percentile:9}}, start:'2006-01-01'
  }}};
}

test('uses the deepest reached threshold and removes the current episode', () => {
  const events = Array.from({length:11},(_,i)=>({signal:'2026-02-'+String(i+1).padStart(2,'0'),additionalDecline:-i/100}));
  const level = {level:20, events:[{signal:events[10].signal,peak:'2026-01-01',recovery:null}],
    forward:[{months:3,events}]};
  const result = summarize(data(-0.2,[{level:5},{level:30},level]));
  assert.equal(result.level, level);
  assert.equal(result.cases.length,10);
  assert.equal(result.cases[0],events[9]);
  assert.equal(result.median,-.045);
  assert.ok(Math.abs(result.p10 - (-.081)) < 1e-12);
  assert.equal(result.rarity,9);
});

test('does not invent an event threshold or a quantile for a small sample', () => {
  assert.equal(summarize(data(-.049,[{level:5}])).level,null);
  const thin=summarize(data(-.3,[{level:30,events:[],forward:[{months:3,events:[{signal:'2020-03-01',additionalDecline:-.1}]}]}]));
  assert.equal(thin.median,-.1);
  assert.equal(thin.p10,null);
});
