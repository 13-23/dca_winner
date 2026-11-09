const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const source = html.split('<!--API--><script>')[1].split('</script><!--/API-->')[0];
const items = JSON.parse(fs.readFileSync(path.join(root, 'tickers.json'), 'utf8'));
const context = { window: {}, fetch: async () => ({ ok: true, json: async () => ({ items }) }) };
vm.runInNewContext(source, context);
test('search resolves Korean names, bare codes, English aliases and spaces', async () => {
  for (const [query, symbol] of [['카카오', '035720.KS'], ['035420', '035420.KS'], ['naver', '035420.KS'], ['LG 생활 건강', '051900.KS'], ['엘지생활건강', '051900.KS'], ['koru', 'KORU']]) {
    assert.equal((await context.window.API.search(query)).quotes[0].symbol, symbol);
  }
});
test('empty and unknown queries return no matches', async () => {
  for (const q of ['', '  ', 'unknown-symbol']) assert.equal((await context.window.API.search(q)).quotes.length, 0);
});

test('Korean crypto queries distinguish quote currencies and English tickers',async()=>{
 for(const [q,symbol] of [['비트코인 원화','BTC-KRW'],['비트코인 달러','BTC-USD'],['이더리움 원화','ETH-KRW'],['이더리움 달러','ETH-USD'],['ETH-USD','ETH-USD']])assert.equal((await context.window.API.search(q)).quotes[0].symbol,symbol);
});
