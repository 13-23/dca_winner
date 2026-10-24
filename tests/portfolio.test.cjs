const {test}=require('node:test');
const assert=require('node:assert/strict');
const {simulate,compare,metrics,xirr}=require('../portfolio.js');
const dates=['2024-01-02','2024-01-03','2024-01-04'];
const data=(prices,days=dates)=>prices.map((p,i)=>[days[i],p,p,p,p,p,100]);
const asset=(symbol,prices,weight=50,currency='KRW',days=dates)=>({symbol,label:symbol,currency,weight,data:data(prices,days)});
const options=()=>({assets:[asset('A',[100,200,100]),asset('B',[100,100,200])],amount:300,frequency:'day'});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const final=r=>r.series.at(-1);
test('weighted fractional purchases and all-in comparisons use identical cash flows',()=>{
 const {portfolio:p,benchmarks:b}=compare(options());
 near(final(p).invested,900);near(final(p).value,1125);near(p.return,0.25);
 near(p.holdings[0].qty,3.75);near(p.holdings[1].qty,3.75);
 near(final(b[0].result).value,750);near(final(b[1].result).value,1500);
 for(const v of b)assert.deepEqual(v.result.series.map(s=>s.flow),p.series.map(s=>s.flow));
 near(final(p).value,b.reduce((sum,x)=>sum+final(x.result).value/2,0));
});
test('foreign purchases use actual date FX and KRW valuation',()=>{
 const p=simulate({assets:[asset('US',[100,200,100],50,'USD'),asset('KR',[100,100,100])],fx:{USD:data([1000,2000,1000])},amount:100000,frequency:'day'});
 near(p.holdings[0].qty,1.125);near(final(p).value,262500);near(final(p).invested,300000);
 assert.deepEqual(p.transactions.filter(t=>t.symbol==='US').map(t=>t.rate),[1000,2000,1000]);
});
test('holiday contributions remain in KRW and execute on the next actual trading day',()=>{
 const a=asset('KR',[100,100,100],50),b=asset('US',[100,100],50,'USD',[dates[0],dates[2]]);
 const {portfolio:p,benchmarks}=compare({assets:[a,b],fx:{USD:data([1000,2000,3000])},amount:600000,frequency:'day'});
 const fills=p.transactions.filter(t=>t.symbol==='US');
 assert.deepEqual(fills.map(t=>t.t),[dates[0],dates[2]]);near(fills[1].spend,600000);near(fills[1].rate,3000);
 near(p.series[1].value,1500000); // 600k KR holdings + 600k US holdings at changed FX + 300k pending.
 for(const b of benchmarks)assert.deepEqual(b.result.series.map(s=>s.flow),[600000,600000,600000]);
});
test('integer leftovers wait for the next contribution rather than buying on every price dip',()=>{
 const p=simulate({assets:[asset('A',[100,50,50],100)],amount:150,frequency:'month',monthday:2,fractional:false});
 assert.equal(p.transactions.length,1);near(p.holdings[0].qty,1);near(p.holdings[0].cash,50);near(final(p).value,100);
});
test('different market days use prior prices without looking ahead',()=>{
 const p=simulate({assets:[asset('A',[100,100,100]),asset('B',[100,1000],50,'KRW',[dates[0],dates[2]])],amount:200,frequency:'day'});
 near(p.series[1].value,400);near(p.series[2].value,1500);
});
test('common history limits adjust both portfolio and benchmarks',()=>{
 const opts=options();opts.assets[1].data=data([100,200],[dates[1],dates[2]]);opts.start='2020-01-01';opts.end='2025-01-01';
 const {portfolio,benchmarks}=compare(opts);assert.equal(portfolio.start,dates[1]);assert.equal(portfolio.end,dates[2]);
 for(const b of benchmarks){assert.equal(b.result.start,portfolio.start);assert.equal(b.result.end,portfolio.end);}
});
test('month-end and weekly holidays move to the next union trading date',()=>{
 const days=['2024-01-30','2024-02-01','2024-02-02','2024-02-05'];
 const p=simulate({assets:[asset('A',[100,100,100,100],100,'KRW',days)],amount:100,frequency:'month',monthday:31});
 assert.deepEqual(p.transactions.map(t=>t.t),['2024-02-01']);
 const w=simulate({assets:[asset('A',[100,100,100,100],100,'KRW',days)],amount:100,frequency:'week',weekday:3});
 assert.deepEqual(w.transactions.map(t=>t.t),['2024-02-01']);
});
test('adjusted prices are optional and have different quantities',()=>{
 const o={...options(),adjusted:true};for(const a of o.assets)for(const row of a.data)row[2]=row[1]/2;
 near(simulate(o).holdings[0].qty,7.5);near(final(simulate(o)).value,1125);
});
test('cash flows do not mask time-weighted drawdown',()=>{
 const m=metrics([{t:dates[0],flow:100,invested:100,value:100},{t:dates[1],flow:100,invested:200,value:150}]);near(m.mdd,-0.5);
});
test('XIRR matches a known one-year investment and handles same-day cash flows',()=>{
 near(xirr([{t:'2023-01-01',v:-100},{t:'2024-01-01',v:110}]),Math.pow(1.1,365.25/365)-1);
 assert.equal(xirr([{t:dates[0],v:-100},{t:dates[0],v:100}]),null);
});
test('invalid allocations, dates, FX, empty histories and amounts are rejected',()=>{
 for(const assets of [[asset('A',[100,100,100],90)],[asset('A',[100,100,100]),asset('A',[100,100,100])],[asset('A',[100,100,100],-10),asset('B',[100,100,100],110)]])assert.throws(()=>simulate({...options(),assets}));
 for(const amount of [0,-1,Infinity,NaN])assert.throws(()=>simulate({...options(),amount}));
 assert.throws(()=>simulate({...options(),start:'2024-02-30'}));
 assert.throws(()=>simulate({...options(),start:'2025-01-01'}));
 assert.throws(()=>simulate({...options(),assets:[asset('US',[100,100,100],100,'USD')]}));
 assert.throws(()=>simulate({...options(),assets:[]}));
});
