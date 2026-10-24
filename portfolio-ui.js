(function(){
'use strict';
const $=id=>document.getElementById(id), storeKey='dca-portfolio-v1';
const num=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2}), qty=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:6});
const won=n=>Math.round(n).toLocaleString('ko-KR')+'원', percent=n=>n==null?'—':(n>0?'+':'')+num.format(n*100)+'%';
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let entries=[{symbol:'QQQ',weight:50},{symbol:'SPY',weight:50}], list=[], active=false, request=0, result=null, shown=100, timer=null;
const cache=new Map();
let saved=null;try{saved=JSON.parse(localStorage.getItem(storeKey)||'null');}catch(e){}
const fields=['start','end','frequency','monthday','weekday','amount'];
for(let i=1;i<=31;i++){$('pf-monthday').add(new Option(i===31?'말일':i+'일',i));}
if(saved){if(Array.isArray(saved.entries)&&saved.entries.length&&saved.entries.length<=10)entries=saved.entries.map(e=>({symbol:String(e.symbol),weight:Number(e.weight)}));for(const f of fields)if(saved[f]!=null)$('pf-'+f).value=saved[f];$('pf-fractional').checked=saved.fractional!==false;$('pf-adjusted').checked=!!saved.adjusted;}
function save(){try{const v={entries,active,fractional:$('pf-fractional').checked,adjusted:$('pf-adjusted').checked};for(const f of fields)v[f]=$('pf-'+f).value;localStorage.setItem(storeKey,JSON.stringify(v));}catch(e){}}
function total(){const sum=entries.reduce((s,e)=>s+(Number.isFinite(e.weight)?e.weight:0),0);$('pf-total').textContent='합계 '+num.format(sum)+'%';$('pf-total').className=Math.abs(sum-100)>1e-6?'hint warn':'hint';$('pf-add').disabled=entries.length>=Math.min(10,list.length);}
function renderRows(){
 const box=$('pf-assets');box.replaceChildren();
 entries.forEach((entry,i)=>{
  const row=document.createElement('div');row.className='pf-row';
  const symbol=document.createElement('select');symbol.setAttribute('aria-label',(i+1)+'번째 종목');
  const groups=new Map();for(const t of list){if(!groups.has(t.group)){const g=document.createElement('optgroup');g.label=t.group||'기타';groups.set(t.group,g);symbol.append(g);}groups.get(t.group).append(new Option(t.label||t.name||t.symbol,t.symbol));}
  symbol.value=entry.symbol;symbol.title=symbol.selectedOptions[0]?.textContent||entry.symbol;symbol.addEventListener('change',()=>{entry.symbol=symbol.value;symbol.title=symbol.selectedOptions[0]?.textContent||entry.symbol;changed();});
  const weight=document.createElement('input');weight.type='number';weight.min='0.01';weight.max='100';weight.step='any';weight.value=entry.weight;weight.setAttribute('aria-label',(i+1)+'번째 비중 (%)');weight.addEventListener('input',()=>{entry.weight=+weight.value;changed();});
  const remove=document.createElement('button');remove.type='button';remove.className='btn';remove.textContent='삭제';remove.setAttribute('aria-label',(i+1)+'번째 종목 삭제');remove.disabled=entries.length===1;remove.addEventListener('click',()=>{entries.splice(i,1);renderRows();changed();});
  row.append(symbol,weight,remove);box.append(row);
 });total();
}
function conditions(){ $('pf-week-field').hidden=$('pf-frequency').value!=='week';$('pf-month-field').hidden=$('pf-frequency').value!=='month'; }
function changed(){conditions();total();save();result=null;$('pf-results').hidden=true;$('pf-status').className='hint';$('pf-status').textContent='입력 변경 · 계산 대기 중…';request++;clearTimeout(timer);if(active)timer=setTimeout(calculate,250);}
async function load(symbol){if(cache.has(symbol))return cache.get(symbol);const j=await API.getChart(symbol);cache.set(symbol,j);return j;}
async function calculate(){
 const mine=++request;clearTimeout(timer);save();$('pf-results').hidden=true;$('pf-status').className='hint';$('pf-status').textContent='시세와 환율을 불러오는 중…';result=null;
 try{
  const amount=+$('pf-amount').value;
  if(!entries.length||entries.some(e=>!Number.isFinite(e.weight)||e.weight<=0)||Math.abs(entries.reduce((s,e)=>s+e.weight,0)-100)>1e-6)throw Error('종목별 비중을 입력해 합계를 100%로 맞춰 주세요.');
  if(new Set(entries.map(e=>e.symbol)).size!==entries.length)throw Error('같은 종목은 한 번만 선택해 주세요.');
  if(!Number.isFinite(amount)||amount<=0)throw Error('회당 총 투자금은 0보다 큰 숫자로 입력해 주세요.');
  const assets=await Promise.all(entries.map(async e=>{const j=await load(e.symbol);const item=list.find(t=>t.symbol===e.symbol);return {...j,weight:e.weight,label:item?.label||j.name||e.symbol};}));
  const fx={};await Promise.all([...new Set(assets.map(a=>a.currency).filter(c=>c!=='KRW'))].map(async c=>{fx[c]=(await load(c==='USD'?'KRW=X':c+'KRW=X')).data;}));
  if(mine!==request)return;
  result=PortfolioEngine.compare({assets,fx,amount,start:$('pf-start').value,end:$('pf-end').value,frequency:$('pf-frequency').value,weekday:+$('pf-weekday').value,monthday:+$('pf-monthday').value,fractional:$('pf-fractional').checked,adjusted:$('pf-adjusted').checked});
  shown=100;render();$('pf-status').textContent='계산 완료 · '+result.portfolio.contributions+'회 납입';
 }catch(e){if(mine!==request)return;result=null;$('pf-results').hidden=true;$('pf-status').className='hint warn';$('pf-status').textContent=e.message;}
}
const kpi=(label,v)=>'<div class="kpi"><span class="lbl">'+label+'</span><span class="val">'+v+'</span></div>';
function render(){
 const p=result.portfolio,last=p.series[p.series.length-1],cash=p.holdings.reduce((s,h)=>s+h.cash,0);
 $('pf-results').hidden=false;
 $('pf-kpis').innerHTML=kpi('총 투자 원금',won(last.invested))+kpi('현재 평가금액',won(last.value))+kpi('손익',won(p.profit))+kpi('수익률',percent(p.return))+kpi('연환산 수익률 (XIRR)',percent(p.xirr))+kpi('MDD (입금 효과 제외)',percent(p.mdd))+kpi('미투자 원화 잔액',won(cash));
 const indexNote=p.holdings.some(h=>h.symbol.startsWith('^'))?' 지수는 직접 매수할 수 없어 지수 값을 1주 가격으로 가정합니다.':'';
 const adjusted=($('pf-start').value&&p.start!==$('pf-start').value)||($('pf-end').value&&p.end!==$('pf-end').value);
 $('pf-period').textContent=(adjusted?'공통 데이터·거래일에 맞춰 기간을 조정했습니다. ':'')+'계산 기간: '+p.start+' ~ '+p.end+' · 원화 기준 · '+($('pf-adjusted').checked?'수정주가로 배당 재투자 가정':'배당 미포함')+' · 수수료·세금 미포함. 매일 매수는 한국·미국 중 어느 시장이든 거래일인 날마다 납입합니다. 각 시장 종가는 현지 날짜 기준이며 장중 동시 평가가 아닙니다.'+indexNote;
 const rows=[{label:'혼합 포트폴리오',result:p},...result.benchmarks];
 $('pf-comparison').innerHTML=rows.map(b=>{const r=b.result,l=r.series[r.series.length-1];return '<tr><td>'+escape(b.label)+'</td><td>'+won(l.value)+'</td><td>'+won(r.profit)+'</td><td>'+percent(r.return)+'</td><td>'+percent(r.xirr)+'</td><td>'+percent(r.mdd)+'</td></tr>';}).join('');
 $('pf-holdings').innerHTML=p.holdings.map(h=>'<tr><td>'+escape(h.label)+'</td><td>'+num.format(h.weight)+'% / '+num.format(h.actualWeight)+'%</td><td>'+won(h.invested)+'</td><td>'+won(h.value)+'</td><td>'+won(h.profit)+'</td><td>'+percent(h.return)+'</td><td>'+qty.format(h.qty)+'</td><td>'+num.format(h.average)+' '+escape(h.currency)+'</td><td>'+won(h.cash)+'</td></tr>').join('');
 renderTransactions();draw();
}
function renderTransactions(){if(!result)return;const tx=result.portfolio.transactions;$('pf-transactions').innerHTML=tx.slice().reverse().slice(0,shown).map(t=>'<tr><td>'+t.t+'</td><td>'+escape(t.symbol)+'</td><td>'+qty.format(t.qty)+'</td><td>'+num.format(t.price)+'</td><td>'+num.format(t.rate)+'</td><td>'+won(t.spend)+'</td></tr>').join('');$('pf-tx-count').textContent='총 '+tx.length.toLocaleString()+'건 · 최근순';$('pf-more').hidden=tx.length<=shown;}
function color(i){const keys=['--accent','--ma5','--ma20','--ma90','--ma120','--ma60','--ma200','--down','--up','--muted','--ink'];return getComputedStyle(document.documentElement).getPropertyValue(keys[i%keys.length]).trim();}
let chartGeometry=null;
function draw(){
 if(!active||!result)return;const box=$('pf-chartbox'),cv=$('pf-chart'),W=box.clientWidth,H=box.clientHeight;if(!W)return;
 const dpr=devicePixelRatio||1;cv.width=W*dpr;cv.height=H*dpr;const g=cv.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,W,H);
 const lines=[{label:'혼합 포트폴리오',series:result.portfolio.series},...result.benchmarks.map(b=>({label:b.label,series:b.result.series}))];
 let max=1;for(const l of lines)for(const s of l.series)max=Math.max(max,s.value,s.invested);
 max*=1.08;const axis=v=>num.format(v/(v>=1e8?1e8:1e4))+(v>=1e8?'억':'만');g.font='11px sans-serif';
 const labelWidth=Math.max(...[0,1,2,3,4].map(i=>g.measureText(axis(max*i/4)).width));
 const pad={l:Math.ceil(labelWidth)+12,r:12,t:14,b:30},n=lines[0].series.length,X=i=>pad.l+(n===1?0.5:i/(n-1))*(W-pad.l-pad.r),Y=v=>H-pad.b-v/max*(H-pad.t-pad.b);
 g.font='11px sans-serif';g.textAlign='right';g.textBaseline='middle';
 for(let i=0;i<=4;i++){const v=max*i/4;g.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--line');g.beginPath();g.moveTo(pad.l,Y(v));g.lineTo(W-pad.r,Y(v));g.stroke();g.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--muted');g.fillText(axis(v),pad.l-6,Y(v));}
 const base=lines[0].series;g.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--invest');g.lineWidth=1;g.setLineDash([4,3]);g.beginPath();base.forEach((s,i)=>i?g.lineTo(X(i),Y(s.invested)):g.moveTo(X(i),Y(s.invested)));g.stroke();g.setLineDash([]);
 for(let index=lines.length-1;index>=0;index--){const l=lines[index];g.strokeStyle=color(index);g.lineWidth=index===0?3:1.5;g.beginPath();l.series.forEach((s,i)=>i?g.lineTo(X(i),Y(s.value)):g.moveTo(X(i),Y(s.value)));g.stroke();}
 g.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--muted');g.textBaseline='bottom';g.textAlign='left';g.fillText(base[0].t,pad.l,H-3);g.textAlign='right';g.fillText(base[n-1].t,W-pad.r,H-3);
 $('pf-legend').innerHTML='<span style="--c:var(--invest)">누적 원금</span>'+lines.map((l,i)=>'<span style="--c:'+color(i)+'">'+escape(l.label)+'</span>').join('');
 chartGeometry={lines,X,pad,W};
}
$('pf-chart').addEventListener('pointermove',e=>{if(!result||!chartGeometry)return;const {lines,pad,W}=chartGeometry,n=lines[0].series.length,x=e.clientX-e.currentTarget.getBoundingClientRect().left,i=Math.max(0,Math.min(n-1,Math.round((x-pad.l)/(W-pad.l-pad.r)*(n-1))));$('pf-hover').textContent=lines[0].series[i].t+' · '+lines.map(l=>l.label+' '+won(l.series[i].value)).join(' / ');});
$('pf-more').addEventListener('click',()=>{shown+=100;renderTransactions();});
$('pf-add').addEventListener('click',()=>{const item=list.find(t=>!entries.some(e=>e.symbol===t.symbol));if(item&&entries.length<10){entries.push({symbol:item.symbol,weight:0});renderRows();changed();}});
$('pf-calculate').addEventListener('click',()=>{cache.clear();calculate();});
for(const f of [...fields,'fractional','adjusted'])$('pf-'+f).addEventListener('input',changed);
async function mode(portfolio){active=portfolio;$('single-mode').hidden=active;$('portfolio-mode').hidden=!active;for(const b of $('dca-kind').querySelectorAll('button'))b.setAttribute('aria-pressed',String((b.dataset.v==='portfolio')===active));save();if(active){try{const index=await API.index();list=index.items.filter(t=>!t.hidden);if(!list.length)throw Error('사용할 수 있는 종목이 없습니다.');renderRows();calculate();}catch(e){$('pf-status').className='hint warn';$('pf-status').textContent='시세 목록을 불러오지 못했습니다: '+e.message;}}}
$('dca-kind').addEventListener('click',e=>{const b=e.target.closest('button');if(b)mode(b.dataset.v==='portfolio');});
new ResizeObserver(()=>draw()).observe($('pf-chartbox'));window.addEventListener('themechange',draw);
conditions();if(saved?.active)mode(true);
})();
