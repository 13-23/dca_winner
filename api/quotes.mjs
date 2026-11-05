// Fixed upstreams only: never accepts a user-supplied URL.
const cache = new Map();
export async function yahoo(path) {
  for (const host of ['query1', 'query2']) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com${path}`, {
        headers: {'User-Agent':'Mozilla/5.0', Accept:'application/json'}, signal:AbortSignal.timeout(12000)
      });
      if (r.ok) return await r.json();
    } catch {}
  }
  throw Error('시세 제공처에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
}
export async function lookup(action, value) {
  value = String(value || '').trim();
  if (!['search','chart'].includes(action) || !value || value.length > 64) throw Error('검색어나 종목 코드를 확인해 주세요.');
  if(action==='chart' && !/^[A-Za-z0-9^][A-Za-z0-9.^=\-]{0,31}$/.test(value)) throw Error('올바른 종목 코드를 입력해 주세요.');
  const key=action+':'+value, hit=cache.get(key);
  if(hit && hit.until>Date.now()) return hit.data;
  let data;
  if(action==='search') {
    const korean=/[가-힣]/.test(value)||/^\d{6}$/.test(value);
    let domestic=[];
    if(korean){
      try{
        const r=await fetch('https://m.stock.naver.com/front-api/search/autoComplete?query='+encodeURIComponent(value)+'&target=stock',{signal:AbortSignal.timeout(10000)});
        if(r.ok){const j=await r.json();domestic=(j.result?.items||j.items||[]).filter(x=>/^[0-9A-Z]{6}$/.test(x.code)&&/코스피|코스닥|KOSPI|KOSDAQ/i.test(x.typeName||x.typeCode||'')).map(x=>({symbol:x.code+(/코스닥|KOSDAQ/i.test(x.typeName||x.typeCode)?'.KQ':'.KS'),name:x.name,type:'EQUITY',exchange:x.typeName||x.typeCode}));}
      }catch{}
    }
    const j=domestic.length?{quotes:[]}:await yahoo('/v1/finance/search?q='+encodeURIComponent(value)+'&quotesCount=20&newsCount=0&listsCount=0');
    data={quotes:(j.quotes||[]).filter(x=>x.symbol && ['EQUITY','ETF','INDEX','MUTUALFUND'].includes(x.quoteType)).map(x=>({symbol:x.symbol,name:x.longname||x.shortname||x.symbol,type:x.quoteType,exchange:x.exchDisp||x.exchange||''}))};
    data.quotes.unshift(...domestic);
    // Korean numeric codes are ambiguous across markets: verify both exchanges.
    if(/^\d{6}$/.test(value) && !domestic.length) {
      const found=await Promise.allSettled(['.KS','.KQ'].map(async suffix=>{
        const j=await lookup('chart',value+suffix);
        return {symbol:j.symbol,name:j.name,type:'EQUITY',exchange:suffix==='.KS'?'KOSPI':'KOSDAQ'};
      }));
      data.quotes=found.filter(x=>x.status==='fulfilled').map(x=>x.value);
    }
  } else {
    const j=await yahoo('/v8/finance/chart/'+encodeURIComponent(value)+'?period1=0&period2='+Math.floor(Date.now()/1000+86400)+'&interval=1d&events=div%2Csplits&includeAdjustedClose=true');
    const result=j.chart?.result?.[0];
    if(!result?.timestamp?.length) throw Error('해당 종목의 일별 시세가 없습니다. 종목 코드와 시장을 확인해 주세요.');
    const m=result.meta,q=result.indicators.quote[0],adj=result.indicators.adjclose?.[0]?.adjclose||[];
    const rows=result.timestamp.map((t,i)=>[new Date((t+(m.gmtoffset||0))*1000).toISOString().slice(0,10),q.close[i],adj[i]??q.close[i],q.open?.[i]??null,q.high?.[i]??null,q.low?.[i]??null,q.volume?.[i]??null]).filter(x=>Number.isFinite(x[1])&&x[1]>0);
    if(!rows.length) throw Error('사용할 수 있는 종가가 없습니다.');
    data={symbol:m.symbol||value,name:m.longName||m.shortName||value,currency:m.currency,exchange:m.exchangeName,fetchedAt:new Date().toISOString(),source:'Yahoo Finance',data:rows};
  }
  if(cache.size>200) cache.delete(cache.keys().next().value);
  cache.set(key,{until:Date.now()+(action==='chart'?900000:300000),data});
  return data;
}
export async function GET(request) {
  const url=new URL(request.url),action=url.searchParams.get('action'),value=url.searchParams.get(action==='chart'?'symbol':'q');
  try {return Response.json(await lookup(action,value),{headers:{'Cache-Control':'public, s-maxage=300, stale-while-revalidate=600','Access-Control-Allow-Origin':'*'}});}
  catch(e){return Response.json({error:e.message},{status:502,headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});}
}
