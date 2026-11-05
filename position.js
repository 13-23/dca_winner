(function () {
 'use strict';
 const panels=[...document.querySelectorAll('[data-position-panel]')];
 if(!panels.length)return;
 const nf=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2});
 const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const numeric=v=>typeof v==='number'&&Number.isFinite(v);
 const pct=v=>numeric(v)?(v>0?'+':'')+nf.format(v*100)+'%':'자료 없음';
 const rate=v=>numeric(v)?nf.format(v*100)+'%':'자료 없음';
 const interval=(v,signed=false)=>Array.isArray(v)&&v.length===2?'95% 구간 '+(signed?pct(v[0]):rate(v[0]))+' ~ '+(signed?pct(v[1]):rate(v[1])):'95% 구간: 표본 부족';
 const direct={'^GSPC':'sp500','^IXIC':'nasdaq','^NDX':'nasdaq100','^KS11':'kospi','^KQ11':'kosdaq','^DJI':'dow'};
 const benchmarks={SPY:'sp500',VOO:'sp500',SSO:'sp500',UPRO:'sp500',QQQ:'nasdaq100',QLD:'nasdaq100',TQQQ:'nasdaq100',DIA:'dow',
  '133690.KS':'nasdaq100','360750.KS':'sp500','233740.KS':'kosdaq','229200.KS':'kosdaq','069500.KS':'kospi','122630.KS':'kospi'};
 let data=null,symbol=document.querySelector('#preset')?.value||'';
 const states=panels.map((panel,index)=>({panel,index,single:!!panel.closest('#single-results'),key:'',stage:null,manual:false,note:''}));
 function infer(sym){
  if(direct[sym])return {key:direct[sym],note:'선택한 지수 자신의 가격·RSI·실현변동성으로 계산합니다.'};
  if(benchmarks[sym])return {key:benchmarks[sym],note:'이 ETF의 관련 시장을 참고로 표시합니다. 상품 자체나 추종지수와 1:1로 같은 검증은 아닙니다.'};
  if(/\.KS$/.test(sym))return {key:'kospi',note:'국내 종목의 참고 시장으로 코스피를 표시합니다. 선택 종목 자체의 바닥 판정이 아닙니다.'};
  if(/\.KQ$/.test(sym))return {key:'kosdaq',note:'국내 종목의 참고 시장으로 코스닥을 표시합니다. 선택 종목 자체의 바닥 판정이 아닙니다.'};
  return {key:'',note:'이 종목에 단일 지수를 자동 대응하지 않습니다. 비교할 시장을 직접 선택해 주세요.'};
 }
 function context(sym){
  symbol=sym;
  for(const state of states.filter(s=>s.single)){
   Object.assign(state,infer(sym),{stage:null,manual:false});
   if(data)render(state);
  }
 }
 function observation(state){
  const m=data.markets[state.key],row=m.study.stages.find(r=>r.stage===state.stage),panel=state.panel;
  if(!row)return;
  panel.querySelectorAll('[data-stage]').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.stage===state.stage)));
  panel.querySelector('.position-observation-title').textContent=`${m.label} ${row.stage}단계 ${row.label}의 과거 6개월 결과`;
  const pairs=[
   ['진입가 대비 +10% 도달률',rate(row.entryHit10),interval(row.entryHit10CI)],
   ['반등 전략 평균 수익',pct(row.strategyMean),interval(row.strategyMeanCI,true)],
   ['6개월 최저가까지 평균 하락',pct(row.lowMean),'최악 '+pct(row.lowWorst)+' · 전체 6개월 가격 경로'],
   ['6개월 만기 평균 수익',pct(row.endMean),'목표 청산 없이 만기까지 보유한 경우'],
   ['+10% 도달까지 중앙 기간',numeric(row.hitDaysMedian)?nf.format(row.hitDaysMedian)+'일':'도달 사례 없음','목표 도달 사례만의 달력일 기준'],
   ['비중첩 사례의 전략 평균',pct(row.spaced.strategyMean),'창이 겹치지 않는 '+row.spaced.n+'개 · 도달률 '+rate(row.spaced.entryHit10)],
  ];
  panel.querySelector('.position-observations').innerHTML=pairs.map(([name,value,sub])=>`<div><dt>${name}</dt><dd>${value}</dd><small>${escape(sub)}</small></div>`).join('');
  panel.querySelector('.position-samples').textContent=`월별 표본 ${row.n}개 / 비중첩 ${row.spaced.n}개${row.insufficient?' · 표본 부족':''}. 월별 결과는 겹칠 수 있습니다. 구간은 역사 표본의 불확실성이며 미래 확률·수익의 보장이 아닙니다.`;
  panel.querySelector('.position-hindsight').innerHTML=`<h3>사후 최저점에서 계산한 참고치</h3><dl class="position-observations"><div><dt>최저가 후 +10% 반등 관측률</dt><dd>${rate(row.postLowHit10)}</dd><small>완성 표본 ${row.n}개 중 관측 · 후속 관측 불가 ${row.postLowUnobserved}개</small></div><div><dt>최저가 뒤 최대 반등 평균</dt><dd>${pct(row.postLowMean)}</dd><small>후속 종가가 있는 ${row.postLowN}개 사례만의 평균</small></div></dl><p class="hint">6개월 전체 최저가를 미래에 미리 알고 진입한 참고치입니다. 실행 가능한 기대수익이 아닙니다. 최저 거래일 다음 날부터 원래 6개월 만기 안의 최고 종가를 사용하며, 최저가 이후에 새로 6개월을 더 기다리지 않습니다.</p>`;
  panel.querySelector('.position-cases-content').innerHTML=`<p class="hint">이 단계의 최근 완성 사례 최대 5개입니다. 가격은 해당 지수의 포인트이며 미래 최저가 예측이 아닙니다.</p><div class="tablewrap" tabindex="0" role="region" aria-label="과거 신호와 6개월 최저가 실제 사례"><table class="position-cases-table"><thead><tr><th>신호 / 진입</th><th>진입 시가</th><th>6개월 최저가 / 날짜</th><th>+10% 첫 도달</th><th>전략 수익</th><th>사후 저점 반등</th></tr></thead><tbody>${row.examples.map(r=>{const o=r.outcome;return `<tr><th scope="row">${escape(r.date)}<small>${escape(o.entryDate)} 진입</small></th><td>${nf.format(o.entry)}</td><td>${nf.format(o.low)}<small>${escape(o.lowDate)} · ${pct(o.lowReturn)}</small></td><td>${o.targets['10'].hitDate?escape(o.targets['10'].hitDate):'미도달 · 만기 청산'}</td><td>${pct(o.targets['10'].strategyReturn)}<small>${escape(o.targets['10'].exitDate)} · ${nf.format(o.targets['10'].exitPrice)} 청산</small></td><td>${pct(o.postLowRebound)}</td></tr>`;}).join('')}</tbody></table></div><p class="hint">만기: 진입일에서 달력상 6개월 뒤까지. 일별 저가의 최솟값을 사용하며, 최저가 지표는 목표 청산 이후의 가격도 포함할 수 있습니다.</p>`;
 }
 function render(state){
  const {panel,index,key}=state,m=data.markets[key],current=m?.latest,s=m?.study;
  panel.setAttribute('aria-labelledby','position-heading-'+index);
  const intro=`<div class="statement-head"><h2 id="position-heading-${index}">시장별 위치·반등 검증</h2><span class="tag">실험적 분류 · 달력상 6개월</span></div><div class="field position-market-field"><label for="position-market-${index}">비교할 기준시장</label><select id="position-market-${index}"><option value="">시장을 선택하세요</option>${Object.entries(data.markets).map(([k,v])=>`<option value="${k}" ${k===key?'selected':''}>${escape(v.label)}</option>`).join('')}</select><p class="hint position-context">${escape(state.single?state.manual?'수동 선택한 참고 지수입니다. 선택 종목 자체와 다를 수 있습니다.':state.note:'혼합 포트폴리오를 하나의 시장 단계로 합치지 않습니다. 비교할 기준지수를 선택해 주세요.')}</p></div>`;
  if(!current){panel.innerHTML=intro+'<p class="hint" role="status">비교 지수를 선택하면 해당 시장 자신의 이력과 과거 반등 결과를 표시합니다.</p>';bindMarket(state);return;}
  state.stage=state.stage||current.stage;
  const stale=(Date.now()-Date.parse(current.date))/86400000>6;
  const c=data.commonMonths;
  panel.innerHTML=intro+`<p class="position-current">${escape(m.label)} ${current.stage}단계 <strong>${escape(current.label)}</strong><span>${escape(current.trend)}</span></p><p class="hint">${escape(current.date)} 종가 기준${stale?' · 오래된 자료':''} · 검증 ${escape(s.start)} ~ ${escape(s.end)} · ${s.baseline.n}개 월별 표본</p>
   <div class="position-evidence"><strong>단계명은 실제 저점 확인이 아닙니다</strong><p>이 시장의 하위 1~3단계 전략 평균은 ${pct(s.lower.strategyMean)}, 상위 8~10단계는 ${pct(s.upper.strategyMean)}였습니다. 낮은 단계가 항상 유리하다고 가정하지 않습니다.${key==='kospi'?' 현재 코스피 검증은 2009년부터이며 2008년 금융위기를 포함하지 못합니다.':''}</p></div>
   <p class="hint position-rule">반등 전략: 신호 다음 거래일 시가 진입 → 6개월 안에 종가 +10% 도달 확인 후 다음 거래일 시가 청산 → 미도달 시 만기 종가 청산. 단, 만기일은 미리 정한 종가로 청산합니다. 실패 손익과 다음 시가의 가격 변동을 포함하며 배당·비용·환율은 제외합니다.</p>
   <div class="position-scale" role="group" aria-label="단계별 반등 검증 결과 선택">${data.labels.map((name,i)=>`<button type="button" data-stage="${i+1}" aria-pressed="${state.stage===i+1}" class="${current.stage===i+1?'is-current':''}"><span>${i+1}</span>${escape(name)}${current.stage===i+1?'<small>현재</small>':''}</button>`).join('')}</div>
   <div class="position-observation"><h3 class="position-observation-title" aria-live="polite"></h3><dl class="position-observations"></dl><p class="hint position-samples"></p></div><div class="position-hindsight"></div>
   <details class="position-cases"><summary>신호·진입가·6개월 최저가 실제 사례</summary><div class="position-cases-content"></div></details>
   <details class="position-method"><summary>현재 단계와 반등 수치의 계산 근거</summary><div class="tablewrap"><table class="position-feature-table"><thead><tr><th>묶음</th><th>상대 위치</th><th>${escape(m.label)} 실제 입력</th></tr></thead><tbody><tr><th scope="row">가격</th><td>${nf.format(current.components.price)} / 100</td><td>1년 고점 대비 ${pct(current.raw.drawdown)} · 200일선 대비 ${pct(current.raw.distance200)}</td></tr><tr><th scope="row">모멘텀</th><td>${nf.format(current.components.momentum)} / 100</td><td>일봉 RSI ${nf.format(current.raw.rsi14)} · 이전 완료 주 RSI ${nf.format(current.raw.weeklyRsi14)}</td></tr><tr><th scope="row">자체 변동성</th><td>${nf.format(current.components.volatility)} / 100</td><td>20거래일 실현변동성 연환산 ${rate(current.raw.rv20)}</td></tr></tbody></table></div>
    <p class="hint">각 지수 자신의 과거 1,260개 관측값으로 백분위를 계산합니다. 현재 값은 비교 분포에서 제외하며 변동성은 역백분위를 씁니다. 세 묶음을 같은 비중으로 평균한 ${nf.format(current.score)}점을 ${current.referenceYear}년 이전 점수의 10분위 경계에 적용했습니다. 다른 시장의 학습 자료를 섞지 않습니다.</p><p class="hint">가격 수집 시각 ${escape(m.priceHistory.capturedAt || "기록 없음")} · 미확정 봉 ${m.priceHistory.excludedUnconfirmedBars ?? "—"}개 제외 · 원시 OHLC 보완 이력 ${m.priceHistory.ohlcProvenance === "recorded" ? "기록됨" : "미확인"}. 당일 장중 봉을 확정 종가처럼 쓰지 않습니다.</p><p class="hint">표본 점검: 월별 신호 ${m.sampleAudit?.monthlySignals ?? "—"}개 중 6개월 미완성 ${m.sampleAudit?.incompleteSixMonths ?? "—"}개, 완성 구간의 잘못된 OHLC ${m.sampleAudit?.invalidCompletedWindows ?? "—"}개를 제외했습니다.</p><p class="hint">실현변동성 = 최근 20개 일별 로그수익률의 표본 표준편차 × √252. VIX·VXN·VKOSPI와 다른 지표입니다. 미국 VIX나 CNN 점수를 코스피 자체 점수로 대체하지 않으며 v2 공통 점수에도 포함하지 않습니다.</p><p class="hint">반등 도달률 = 진입가 대비 종가 +10%를 한 번 이상 기록한 사례 / 모든 완성 사례. 전략 평균 = 도달 종가 확인 후 다음 거래일 시가(만기일 도달 시 만기 종가), 미도달 시 만기 종가로 청산한 모든 손익의 평균. 95% 구간은 월별 순서를 6개월 블록으로 재추출한 1,000회 결과입니다.</p></details>
   <details class="position-validation"><summary>10단계 전체 결과·목표값 민감도</summary><div class="tablewrap" tabindex="0" role="region" aria-label="시장별 단계 전체 반등 검증"><table class="position-table"><thead><tr><th>단계</th><th>월별 / 비중첩</th><th>+10% 도달률</th><th>전략 평균</th><th>평균 저점 하락</th><th>최악 저점 하락</th></tr></thead><tbody>${s.stages.map(r=>`<tr><th scope="row">${r.stage} ${escape(r.label)}${r.insufficient?'<small>표본 부족</small>':''}</th><td>${r.n} / ${r.spaced.n}</td><td>${rate(r.entryHit10)}</td><td>${pct(r.strategyMean)}</td><td>${pct(r.lowMean)}</td><td>${pct(r.lowWorst)}</td></tr>`).join('')}</tbody></table></div><p class="hint">전체 월별 기준선: +10% 도달률 ${rate(s.baseline.entryHit10)}, 전략 평균 ${pct(s.baseline.strategyMean)}. 목표값별 전체 표본: ${Object.entries(s.baseline.sensitivity).map(([t,r])=>'+'+t+'% 도달률 '+rate(r.hitRate)+' / 전략 평균 '+pct(r.strategyMean)).join('; ')}.</p></details>
   <details class="position-comparison"><summary>같은 기간의 네 시장 비교</summary><p class="hint">${escape(c.start)} ~ ${escape(c.end)}, 공통 ${c.n}개월. 각국의 첫 유효 거래일은 다릅니다. 아래는 각 시장 전체 표본의 기준선이며 현재 단계끼리의 비교가 아닙니다.</p><div class="tablewrap" tabindex="0" role="region" aria-label="공통 기간 시장 비교"><table class="position-table"><thead><tr><th>시장</th><th>월별 표본</th><th>+10% 도달률</th><th>전략 평균</th><th>평균 저점 하락</th></tr></thead><tbody>${Object.entries(c.comparison).map(([k,v])=>`<tr><th scope="row">${escape(data.markets[k].label)}</th><td>${v.baseline.n}</td><td>${rate(v.baseline.entryHit10)}</td><td>${pct(v.baseline.strategyMean)}</td><td>${pct(v.baseline.lowMean)}</td></tr>`).join('')}</tbody></table></div></details>
   <p class="hint">현재 확보한 수정 가능한 역사 자료로 검증했습니다. 단계명·관측률·평균·95% 구간은 앞으로의 바닥이나 수익을 보장하지 않습니다.</p><p class="position-report-links"><a href="POSITION_V2_RESULTS.md" target="_blank" rel="noopener">시장·기간별 전체 보고서</a> · <a href="POSITION_V2_METHOD.md" target="_blank" rel="noopener">정의·계산식·검증 기준</a></p>`;
  bindMarket(state);
  panel.querySelectorAll('[data-stage]').forEach(b=>b.addEventListener('click',()=>{state.stage=+b.dataset.stage;observation(state);}));
  observation(state);
 }
 function bindMarket(state){state.panel.querySelector('select').addEventListener('change',e=>{state.key=e.target.value;state.stage=null;state.manual=true;render(state);state.panel.querySelector('select').focus();});}
 window.addEventListener('positionmarketcontext',e=>context(e.detail.symbol));
 panels.forEach(p=>{p.innerHTML='<h2>시장별 위치·반등 검증</h2><p class="hint" role="status">시장별 검증 자료를 불러오는 중…</p>';});
 fetch('data/position-v2.json',{cache:'no-cache',signal:AbortSignal.timeout(15000)}).then(r=>{if(!r.ok)throw Error('Missing study');return r.json();}).then(json=>{
  if(json.version!=='research-v2'||!json.markets||!Array.isArray(json.labels)||json.labels.length!==10)throw Error('Invalid study');
  data=json;context(document.querySelector('#preset')?.value||symbol);
  states.filter(s=>!s.single).forEach(render);
 }).catch(()=>panels.forEach(p=>{p.innerHTML='<h2>시장별 위치·반등 검증</h2><p class="hint" role="status">자료를 읽지 못해 시장 위치와 반등률을 표시하지 않습니다. 잠시 후 새로고침해 주세요.</p>';}));
})();
