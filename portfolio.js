/* Portfolio calculations use KRW cash, actual fill-day FX and no sales/rebalancing. */
(function (root) {
'use strict';
const dayMs = 86400000;
const iso = d => d.toISOString().slice(0, 10);
const date = t => new Date(t + 'T00:00:00Z');
function lower(a, t) { let l=0,r=a.length; while(l<r){const m=(l+r)>>1;if(a[m]<t)l=m+1;else r=m;}return l; }
function targets(start,end,frequency,weekday,monthday) {
  const out=[];let d=date(start), stop=date(end);
  if(frequency==='day') return null;
  if(frequency==='week') {
    while(d.getUTCDay()!==weekday)d.setUTCDate(d.getUTCDate()+1);
    for(;d<=stop;d.setUTCDate(d.getUTCDate()+7))out.push(iso(d));
  } else {
    for(let y=d.getUTCFullYear(),m=d.getUTCMonth();;m++) {
      if(m===12){y++;m=0;} const t=iso(new Date(Date.UTC(y,m,Math.min(monthday,new Date(Date.UTC(y,m+1,0)).getUTCDate()))));
      if(t>end)break;if(t>=start)out.push(t);
    }
  }
  return out;
}
function xirr(flows) {
  if(flows.length<2 || flows[0].t===flows[flows.length-1].t)return null;
  const first=date(flows[0].t).getTime();
  const years=flows.map(x=>(date(x.t)-first)/dayMs/365.25);
  const f=r=>flows.reduce((s,x,i)=>s+x.v/Math.pow(1+r,years[i]),0);
  let lo=-0.999999,hi=1,fl=f(lo),fh=f(hi);
  while(fl*fh>0 && hi<1e6){hi=hi*2+1;fh=f(hi);}
  if(!Number.isFinite(fl)||!Number.isFinite(fh)||fl*fh>0)return null;
  for(let i=0;i<180;i++){const mid=(lo+hi)/2,fm=f(mid);if(Math.abs(fm)<1e-7||hi-lo<1e-12)return mid;if(fl*fm>0){lo=mid;fl=fm;}else hi=mid;}return(lo+hi)/2;
}
function metrics(series) {
  let nav=1,peak=1,mdd=0;const flows=[];
  series.forEach((s,i)=>{if(s.flow)flows.push({t:s.t,v:-s.flow});if(i&&series[i-1].value>0)nav*=(s.value-s.flow)/series[i-1].value;peak=Math.max(peak,nav);mdd=Math.min(mdd,nav/peak-1);});
  const last=series[series.length-1];flows.push({t:last.t,v:last.value});
  return {mdd,xirr:xirr(flows),profit:last.value-last.invested,return:last.value/last.invested-1};
}
function simulate(options) {
  const {assets,fx={},amount,frequency='month',weekday=1,monthday=1,fractional=true,adjusted=false}=options;
  if(!Array.isArray(assets)||!assets.length)throw Error('종목을 한 개 이상 선택해 주세요.');
  if(new Set(assets.map(a=>a.symbol)).size!==assets.length)throw Error('같은 종목을 중복해서 선택할 수 없습니다.');
  if(!Number.isFinite(amount)||amount<=0)throw Error('회당 총 투자금은 0보다 큰 숫자로 입력해 주세요.');
  if(assets.some(a=>!Number.isFinite(a.weight)||a.weight<=0)||Math.abs(assets.reduce((s,a)=>s+a.weight,0)-100)>1e-6)throw Error('각 비중은 0보다 커야 하며 합계는 100%여야 합니다.');
  if(!['day','week','month'].includes(frequency)||!Number.isInteger(weekday)||weekday<1||weekday>5||!Number.isInteger(monthday)||monthday<1||monthday>31)throw Error('매수 주기와 날짜를 확인해 주세요.');
  const histories=assets.map(a=>a.data);
  for(const a of assets){if(!a.data?.length)throw Error(a.symbol+' 시세가 없습니다.');if(a.currency!=='KRW'){if(!fx[a.currency]?.length)throw Error(a.currency+' 환율 데이터가 없습니다.');histories.push(fx[a.currency]);}}
  const first=histories.reduce((v,h)=>h[0][0]>v?h[0][0]:v,'0000-01-01');
  const last=histories.reduce((v,h)=>h[h.length-1][0]<v?h[h.length-1][0]:v,'9999-12-31');
  for(const t of [options.start,options.end].filter(Boolean))if(!/^\d{4}-\d{2}-\d{2}$/.test(t)||!Number.isFinite(date(t).getTime())||iso(date(t))!==t)throw Error('유효한 시작일과 종료일을 입력해 주세요.');
  const start=options.start&&options.start>first?options.start:first,end=options.end&&options.end<last?options.end:last;
  if(start>end)throw Error('선택한 기간에 모든 종목·환율의 공통 데이터가 없습니다.');
  const calendar=(options.calendar || [...new Set(assets.flatMap(a=>a.data.map(r=>r[0])))]).filter(t=>t>=start&&t<=end).sort();
  if(!calendar.length)throw Error('선택한 기간에 거래일이 없습니다.');
  const wanted=targets(start,end,frequency,weekday,monthday);
  const dates=new Set(options.contributionDates || (wanted===null?calendar:wanted.map(t=>calendar[lower(calendar,t)]).filter(Boolean)));
  if(!dates.size)throw Error('이 기간에는 매수일이 없습니다. 기간이나 주기를 바꿔 주세요.');
  const dateSets=assets.map(a=>new Set(a.data.map(r=>r[0])));
  const px=assets.map(a=>{let i=0;return t=>{while(i+1<a.data.length&&a.data[i+1][0]<=t)i++;return a.data[i][adjusted?2:1];};});
  const rates={};for(const [cur,rows] of Object.entries(fx)){let i=0;rates[cur]=t=>{while(i+1<rows.length&&rows[i+1][0]<=t)i++;return rows[i][1];};}
  const state=assets.map(a=>({symbol:a.symbol,label:a.label||a.symbol,currency:a.currency,weight:a.weight,qty:0,cash:0,invested:0,purchaseCost:0,due:false}));
  const series=[],transactions=[];let invested=0;
  for(const t of calendar){
    const flow=dates.has(t)?amount:0;invested+=flow;let value=0;
    state.forEach((s,i)=>{
      if(flow){const budget=flow*s.weight/100;s.cash+=budget;s.invested+=budget;s.due=true;}
      const rate=s.currency==='KRW'?1:rates[s.currency](t),price=px[i](t);
      if(!Number.isFinite(rate)||rate<=0||!Number.isFinite(price)||price<=0)throw Error(s.symbol+' 가격·환율 데이터가 유효하지 않습니다.');
      if(dateSets[i].has(t)&&s.due){
        s.due=false;
        const q=fractional?s.cash/(rate*price):Math.floor(s.cash/(rate*price));
        if(q>0){const spend=q*price*rate;s.qty+=q;s.cash=Math.max(0,s.cash-spend);s.purchaseCost+=q*price;transactions.push({t,symbol:s.symbol,qty:q,price,rate,spend});}
      }
      s.price=price;s.rate=rate;s.value=s.qty*price*rate+s.cash;value+=s.value;
    });
    series.push({t,flow,invested,value});
  }
  const result={series,transactions,holdings:state,start:calendar[0],end:calendar[calendar.length-1],requestedStart:options.start,requestedEnd:options.end,contributions:dates.size};
  Object.assign(result,metrics(series));const total=series[series.length-1].value;
  state.forEach(s=>{s.actualWeight=total?s.value/total*100:0;s.profit=s.value-s.invested;s.return=s.invested?s.profit/s.invested:0;s.average=s.qty?s.purchaseCost/s.qty:0;});
  return result;
}
function compare(options) {
  const portfolio=simulate(options);
  const calendar=portfolio.series.map(s=>s.t),contributionDates=portfolio.series.filter(s=>s.flow>0).map(s=>s.t);
  const benchmarks=options.assets.map(a=>({symbol:a.symbol,label:a.label||a.symbol,result:simulate({...options,assets:[{...a,weight:100}],start:portfolio.start,end:portfolio.end,calendar,contributionDates})}));
  return {portfolio,benchmarks};
}
const api={simulate,compare,metrics,xirr};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PortfolioEngine=api;
})(typeof window!=='undefined'?window:globalThis);
