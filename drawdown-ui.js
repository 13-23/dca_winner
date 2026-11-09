(function(){
'use strict';
const $=id=>document.getElementById(id),nf=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2});
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=v=>v==null?'—':(v>0?'+':'')+nf.format(v*100)+'%',days=v=>v==null?'—':nf.format(v)+'거래일';
const rate=v=>v==null?'—':nf.format(v*100)+'%';
const tr=values=>'<tr>'+values.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>';
let data=null,loading=false,chart=null,events=[];
try{const s=JSON.parse(localStorage.getItem('drawdown-view-v1')||'{}');if(['all','20','10'].includes(s.window))$('dd-window').value=s.window;if([5,10,15,20,30].includes(+s.level))$('dd-level').value=s.level;}catch(e){}
function selected(){const view=data.views[$('dd-window').value];return {view,level:view.levels.find(x=>x.level===+$('dd-level').value)};}
function render(){
 if(!data)return;const {view,level}=selected(),c=data.current;
 try{localStorage.setItem('drawdown-view-v1',JSON.stringify({window:$('dd-window').value,level:$('dd-level').value}));}catch(e){}
 $('dd-content').hidden=false;
 $('dd-quick').hidden=false;$('dd-quick').textContent='나스닥100 · '+data.asOf+' | 고점 대비 '+pct(c.drawdown)+' | 60주선 대비 '+pct(c.gap60w)+' · 가격 위치이며 저평가 판정은 아닙니다.';
 $('dd-boundary').hidden=!level.carriedIn;$('dd-boundary').textContent=level.carriedIn?'기간 시작 전에 이미 −'+level.level+'%에 진입한 미회복 사건 '+level.carriedIn+'건은 아래 신규 횟수·회복기간·이후 성과의 표본에 포함되지 않습니다. 실제 사건 표의 이월 행과 전체 가용 이력도 확인해 주세요.':'';
 const cards=[['확보된 이력의 고점 대비 낙폭',pct(c.drawdown),'고점일 '+c.peakDate],['고점 미회복 연속 기간',days(c.underwaterDays),'종가가 고점 아래였던 관측 일수'],['200일선 대비 거리',pct(c.gap200),'선 회복은 고점 회복과 다릅니다'],['60주선 대비 거리',pct(c.gap60w),'현재 주는 해당일 종가까지 반영'],['현재 낙폭 이하였던 과거 비중',view.ranks.drawdown.percentile==null?'—':nf.format(view.ranks.drawdown.percentile)+'%',view.ranks.drawdown.n.toLocaleString()+'개 과거 거래일 · 현재일 제외'],['최근 21일 실현변동성',rate(c.volatility21),'일별 수익률 표준편차 · 연율화']];
 $('dd-current').innerHTML=cards.map(([label,value,sub])=>'<div class="kpi"><span class="lbl">'+esc(label)+'</span><span class="val">'+esc(value)+'</span><span class="sub">'+esc(sub)+'</span></div>').join('');
 const age=(Date.now()-Date.parse(data.asOf+'T22:00:00Z'))/86400000;
 $('dd-status').className=age>7?'hint warn':'hint';$('dd-status').textContent=(age>7?'자료가 7일 이상 지났습니다. 현재 시점 판단 전 갱신 상태를 확인하세요. ':'')+'나스닥100 · '+data.asOf+' 확정 종가 기준 · 통계 '+view.start+' ~ '+view.end+' ('+view.sessions.toLocaleString()+'거래일)';
 $('dd-source').textContent='가격 출처: '+data.source+' · 전체 이력 시작 '+data.historyStart+' · 수집 '+data.priceCapturedAt+' · 분석 생성 '+data.generatedAt+'. 전체 이력 이전의 고점은 알 수 없습니다. 200일선 이격의 과거 하위 '+(view.ranks.gap200.percentile==null?'—':nf.format(view.ranks.gap200.percentile))+'%, 60주선 이격의 과거 하위 '+(view.ranks.gap60w.percentile==null?'—':nf.format(view.ranks.gap60w.percentile))+'%에 해당합니다.';
 $('dd-frequency').innerHTML=view.levels.map(x=>tr(['−'+x.level+'%',x.count,nf.format(x.perYear)+'회',x.carriedIn+'건',rate(x.occupancy),x.duration.complete+' / '+x.duration.ongoing,days(x.duration.median),days(x.duration.mean),days(x.duration.max),days(x.duration.kmMedian)])).join('');
 $('dd-ma').innerHTML=view.movingAverages.map(x=>tr([x.name,x.count,rate(x.occupancy),x.observations,x.duration.complete+' / '+x.duration.ongoing,days(x.duration.median),days(x.duration.mean),days(x.duration.max)])).join('');
 $('dd-outcome-title').textContent='고점 대비 −'+level.level+'% 최초 도달 이후의 실제 분포';
 $('dd-forward').innerHTML=level.forward.map(x=>tr([x.months+'개월',x.n,x.incomplete,x.overlapExcluded,pct(x.median),pct(x.p10)+' ~ '+pct(x.p90),rate(x.lossRate),pct(x.worstAdditionalDecline)])).join('');
 events=[...level.events,...level.carriedInEvents].sort((a,b)=>b.signal.localeCompare(a.signal));
 $('dd-events').innerHTML=events.length?events.map(e=>tr([e.signal,e.peak,pct(e.depth),e.recovery||'진행 중',days(e.days),e.carriedIn?'기간 전 진입·이월':'기간 내 신규'])).join(''):tr(['해당하는 사건이 없습니다.','','','','','']);
 $('dd-event-select').replaceChildren();events.forEach((e,i)=>$('dd-event-select').add(new Option(e.signal+' ~ '+(e.recovery||data.asOf)+' · '+(e.carriedIn?'기간 전 진입':'신규')+(e.recovery?'':' · 진행 중'),i)));
 $('dd-single').disabled=$('dd-portfolio').disabled=!events.length;
 $('dd-annual').innerHTML=Object.entries(level.annual).map(([year,count])=>tr([year+(year===view.start.slice(0,4)||year===view.end.slice(0,4)?' (부분 연도 가능)':''),count])).join('');
 draw();
}
function draw(){
 if(!data||$('tab-drawdown').hidden)return;const box=$('dd-chartbox'),cv=$('dd-chart'),W=box.clientWidth,H=box.clientHeight;if(!W||!H)return;
 const {view,level}=selected(),history=data.history.filter(r=>r[0]>=view.start),dpr=devicePixelRatio||1,g=cv.getContext('2d');cv.width=W*dpr;cv.height=H*dpr;g.setTransform(dpr,0,0,dpr,0,0);
 const css=v=>getComputedStyle(document.documentElement).getPropertyValue(v).trim();const p={l:48,r:12,t:16,b:30};
 const bottom=Math.min(-.1,...history.map(r=>r[2])),floor=Math.ceil(-bottom*10)/10,X=i=>p.l+i/Math.max(1,history.length-1)*(W-p.l-p.r),Y=v=>p.t+(-v)/floor*(H-p.t-p.b);
 g.font='11px sans-serif';g.textAlign='right';g.textBaseline='middle';g.lineWidth=1;
 for(let i=0;i<=4;i++){const value=-floor*i/4;g.strokeStyle=css('--line');g.beginPath();g.moveTo(p.l,Y(value));g.lineTo(W-p.r,Y(value));g.stroke();g.fillStyle=css('--muted');g.fillText(pct(value),p.l-5,Y(value));}
 g.beginPath();g.moveTo(X(0),Y(0));history.forEach((r,i)=>g.lineTo(X(i),Y(r[2])));g.lineTo(X(history.length-1),Y(0));g.closePath();g.globalAlpha=.15;g.fillStyle=css('--down');g.fill();g.globalAlpha=1;
 g.beginPath();g.strokeStyle=css('--down');g.lineWidth=1.7;history.forEach((r,i)=>i?g.lineTo(X(i),Y(r[2])):g.moveTo(X(i),Y(r[2])));g.stroke();
 const threshold=-level.level/100;if(threshold>=-floor){g.setLineDash([5,4]);g.strokeStyle=css('--up');g.beginPath();g.moveTo(p.l,Y(threshold));g.lineTo(W-p.r,Y(threshold));g.stroke();g.setLineDash([]);}
 g.fillStyle=css('--muted');g.textAlign='left';g.fillText(history[0][0],p.l,H-8);g.textAlign='right';g.fillText(history.at(-1)[0],W-p.r,H-8);chart={history,p,W};
}
async function load(force=false){
 if(loading)return;if(data&&!force){render();return;}loading=true;$('dd-status').textContent='확정 종가의 하락·회복 통계를 불러오는 중…';$('dd-status').className='hint';
 try{const r=await fetch('data/drawdown.json',{cache:'no-cache'});if(!r.ok)throw Error('통계 파일 조회 실패 ('+r.status+')');const j=await r.json();if(j.version!=='drawdown-v1'||!j.views?.all||!j.history?.length)throw Error('통계 형식을 확인할 수 없습니다.');data=j;render();}
 catch(e){data=null;chart=null;$('dd-content').hidden=true;$('dd-quick').hidden=true;$('dd-status').className='hint warn';$('dd-status').textContent=e.message+' · 시세 업데이트가 완료됐는지 확인하거나 새로 불러오기를 눌러 주세요.';}
 finally{loading=false;}
}
$('dd-chart').addEventListener('pointermove',e=>{if(!chart)return;const {history,p,W}=chart;const x=e.clientX-e.currentTarget.getBoundingClientRect().left,i=Math.max(0,Math.min(history.length-1,Math.round((x-p.l)/(W-p.l-p.r)*(history.length-1)))),row=history[i];$('dd-hover').textContent=row[0]+' · 지수 '+nf.format(row[1])+' · 고점 대비 '+pct(row[2]);});
for(const id of ['dd-window','dd-level'])$(id).addEventListener('change',()=>data&&render());
$('dd-retry').addEventListener('click',()=>load(true));window.addEventListener('drawdownopen',()=>load());
let reviewMode=null,previewRequest=0;
async function preview(){
 const mine=++previewRequest;
 const start=$('dd-review-start').value,end=$('dd-review-end').value,frequency=$('dd-review-frequency').value;
 let valid=!!start&&!!end&&start<=end&&start>=data.historyStart&&end<=data.asOf;
 let note='기간은 '+data.historyStart+' ~ '+data.asOf+' 안에서 시작일이 종료일보다 늦지 않게 선택해 주세요.';
 if(valid&&reviewMode==='single'){
  const detail={days:data.history,start,end,frequency,count:null};window.dispatchEvent(new CustomEvent('drawdownpreview',{detail}));
  valid=detail.count>0;note='나스닥100 거래일 기준 매수 예정 '+detail.count+'회.'+(valid?' 기존 회당 금액을 사용합니다.':' 이 기간에는 매수일이 없습니다. 주기를 매일로 바꾸거나 기간을 늘려 주세요.');
 }else if(valid){
  $('dd-review-apply').disabled=true;$('dd-review-count').textContent='기존 종목·비중과 공통 시세·환율 이력으로 납입 횟수를 확인하는 중…';
  const detail={start,end,frequency};window.dispatchEvent(new CustomEvent('drawdownportfoliopreview',{detail}));
  try{
   if(!detail.result)throw Error('포트폴리오 준비가 완료되지 않았습니다. 다시 시도해 주세요.');
   const result=await detail.result;if(mine!==previewRequest)return;
   note='공통 거래 기간 '+result.start+' ~ '+result.end+' · 납입 예정 '+result.count+'회. 기존 종목·비중·회당 금액을 유지합니다.';
  }catch(error){if(mine!==previewRequest)return;valid=false;note=error.message+' 기간·주기 또는 포트폴리오 조건을 확인해 주세요.';}
 }
 $('dd-review-count').textContent=note;$('dd-review-apply').disabled=!valid;
}
function calculator(mode){
 const event=events[+$('dd-event-select').value];if(!event)return;reviewMode=mode;
 $('dd-review-start').value=event.signal;$('dd-review-end').value=event.recovery||data.asOf;
 $('dd-review-frequency').value=mode==='single'?document.querySelector('#freq [aria-pressed="true"]').dataset.v:$('pf-frequency').value;
 const frequency=$('dd-review-frequency').value;
 const setting=frequency==='month'?'매월 '+$(mode==='single'?'mday':'pf-monthday').selectedOptions[0].text:frequency==='week'?$(mode==='single'?'weekday':'pf-weekday').selectedOptions[0].text:'거래일마다';
 $('dd-review-context').textContent=(mode==='single'?'나스닥100 단일 종목':'기존 혼합 포트폴리오')+' · 현재 주기: '+setting+' · 선택 사건 '+event.signal+' ~ '+(event.recovery||data.asOf);
 preview();$('dd-review').showModal();
}
for(const id of ['dd-review-start','dd-review-end','dd-review-frequency'])$(id).addEventListener('input',preview);
$('dd-review-cancel').addEventListener('click',()=>$('dd-review').close());
$('dd-review').querySelector('form').addEventListener('submit',async e=>{
 e.preventDefault();const expected=previewRequest+1;await preview();if(expected!==previewRequest||!$('dd-review').open||$('dd-review-apply').disabled)return;
 const detail={mode:reviewMode,start:$('dd-review-start').value,end:$('dd-review-end').value,frequency:$('dd-review-frequency').value};
 $('dd-review').close();$('tab-btn-dca').click();if(reviewMode==='single')document.querySelector('#dca-kind [data-v="single"]').click();
 window.dispatchEvent(new CustomEvent('drawdowncalculator',{detail}));
});
$('dd-single').addEventListener('click',()=>calculator('single'));$('dd-portfolio').addEventListener('click',()=>calculator('portfolio'));
new ResizeObserver(draw).observe($('dd-chartbox'));window.addEventListener('themechange',draw);if(!$('tab-drawdown').hidden)load();
})();
