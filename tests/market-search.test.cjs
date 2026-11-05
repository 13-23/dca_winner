const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').split('<!--API--><script>')[1].split('</script><!--/API-->')[0];
function api(remote){const context={window:{},fetch:async url=>url==='data/index.json'?{ok:true,json:async()=>({items:[{symbol:'SPY',label:'S&P500',aliases:['미국']} ]})}:remote(url)};vm.runInNewContext(source,context);return context.window.API;}
test('market search merges external assets and deduplicates cached symbols',async()=>{
 const a=api(async()=>({ok:true,json:async()=>({quotes:[{symbol:'SPY'},{symbol:'SPYG',name:'growth'}]})}));
 assert.deepEqual(Array.from((await a.search('SPY')).quotes,x=>x.symbol),['SPY','SPYG']);
});
test('external chart loads directly without requiring index membership',async()=>{
 let called;const a=api(async url=>{called=url;return {ok:true,json:async()=>({symbol:'196170.KQ',data:[['2026-01-02',100]]})};});
 assert.equal((await a.getChart('196170.KQ')).symbol,'196170.KQ');assert.match(called,/action=chart&symbol=196170.KQ/);
});
test('remote outage reports partial search and never disguises failure as no matches',async()=>{
 const a=api(async()=>{throw Error('offline');});
 assert.match((await a.search('SPY')).warning,/저장된/);
 await assert.rejects(()=>a.search('unknown'),/offline/);
});
test('backend rejects URL-like symbols before making any upstream request',async()=>{
 const {lookup}=await import('../api/quotes.mjs');
 await assert.rejects(()=>lookup('chart','https://example.com'),/종목 코드/);
 await assert.rejects(()=>lookup('unknown','AAPL'),/검색어/);
});
test('backend preserves adjusted closes, local trading dates and missing OHLC',async()=>{
 const {lookup}=await import('../api/quotes.mjs'), original=global.fetch;
 global.fetch=async()=>({ok:true,json:async()=>({chart:{result:[{meta:{symbol:'TEST',currency:'KRW',gmtoffset:32400},timestamp:[Date.UTC(2026,0,1,16)/1000],indicators:{quote:[{close:[100],open:[null],high:[110],low:[95],volume:[20]}],adjclose:[{adjclose:[98]}]}}]}})});
 try{const j=await lookup('chart','TEST');assert.deepEqual(j.data,[['2026-01-02',100,98,null,110,95,20]]);assert.equal(j.currency,'KRW');}finally{global.fetch=original;}
});
test('domestic search maps each Korean listing to its own Yahoo exchange suffix',async()=>{
 const {lookup}=await import('../api/quotes.mjs'),original=global.fetch;
 global.fetch=async url=>{assert.match(url,/m.stock.naver.com/);return {ok:true,json:async()=>({result:{items:[{code:'066570',name:'LG전자',typeName:'코스피'},{code:'196170',name:'알테오젠',typeName:'코스닥'}]}})};};
 try{const j=await lookup('search','국내테스트');assert.deepEqual(j.quotes.map(x=>x.symbol),['066570.KS','196170.KQ']);}finally{global.fetch=original;}
});
