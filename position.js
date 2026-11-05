(function () {
  'use strict';
  const panels=[...document.querySelectorAll('[data-position-panel]')];
  if(!panels.length)return;
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const nf=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2});
  const pct=value=>typeof value==='number'&&Number.isFinite(value)?(value>0?'+':'')+nf.format(value*100)+'%':'자료 없음';
  const rate=value=>typeof value==='number'?nf.format(value*100)+'%':'자료 없음';
  let data=null;
  function observations(panel,stage){
    const row=data.models.relative.stages.find(r=>r.stage===stage);
    if(!row)return;
    panel.querySelectorAll('[data-stage]').forEach(button=>button.setAttribute('aria-pressed',String(+button.dataset.stage===stage)));
    panel.querySelector('.position-observation-title').textContent=`${row.stage}단계 ${row.label}에서 출발한 과거 관측 결과`;
    const pairs=[['6개월 수익률 중앙값',pct(row.median6)],['6개월 후 상승 비율',rate(row.winRate)],
      ['3개월 추가하락 중앙값',pct(row.medianDownside)],['3개월 최악 추가하락',pct(row.worstDownside)]];
    panel.querySelector('.position-observations').innerHTML=pairs.map(([label,value])=>`<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
    panel.querySelector('.position-samples').textContent=`월별 표본 ${row.n}개 · 해당 단계 내 126거래일 간격 사례 ${row.spacedCases}개. 표본은 서로 겹칠 수 있으며 위 비율은 미래 상승 확률이 아닙니다.`;
  }
  function render(panel,index){
    const current=data.latest,study=data.models.relative;
    const stale=current.sourceStale||(Date.now()-Date.parse(current.date))/86400000>6;
    panel.setAttribute('aria-labelledby','position-heading-'+index);
    panel.innerHTML=`<div class="statement-head"><h2 id="position-heading-${index}">시장 위치 · 실험적 분류</h2><span class="tag">S&amp;P 500 · 약 6개월</span></div>
      <p class="position-current">현재 ${current.stage}단계 <strong>${escape(current.label)}</strong><span>${escape(current.trend)}</span></p>
      <p class="hint">${escape(current.date)} 종가 기준 · ${stale?'자료가 오래되었거나 갱신에 실패했습니다.':'가격·모멘텀·VIX 세 묶음의 상대 위치입니다.'} 한국 시장·개별 종목의 위치 판정이 아닙니다.</p>
      <div class="position-evidence"><strong>과거 검증: 바닥·고점 판별력 미확인</strong><p>2000년 이후 월별 표본 ${study.baseline.n}개에서 하위 1~3단계의 6개월 수익률 중앙값은 ${pct(study.lower.median6)}, 상위 8~10단계는 ${pct(study.upper.median6)}였습니다. 낮은 단계가 이후 성과 우위를 뜻하지 않았습니다.</p></div>
      <div class="position-scale" role="group" aria-label="10단계별 과거 관측 결과 선택">${data.labels.map((name,i)=>`<button type="button" data-stage="${i+1}" aria-pressed="${current.stage===i+1}" class="${current.stage===i+1?'is-current':''}"><span>${i+1}</span>${escape(name)}${current.stage===i+1?'<small>현재</small>':''}</button>`).join('')}</div>
      <div class="position-observation"><h3 class="position-observation-title" aria-live="polite"></h3><dl class="position-observations"></dl><p class="hint position-samples"></p></div>
      <details class="position-method"><summary>현재 단계의 계산 근거</summary><div class="tablewrap"><table class="position-feature-table"><thead><tr><th>묶음</th><th>상대 위치 점수</th><th>사용한 값</th></tr></thead><tbody>
        <tr><th scope="row">가격</th><td>${nf.format(current.components.price)} / 100</td><td>1년 고점 대비 ${pct(current.raw.drawdown)} · 200일선 대비 ${pct(current.raw.distance200)}</td></tr>
        <tr><th scope="row">모멘텀</th><td>${nf.format(current.components.momentum)} / 100</td><td>일봉 RSI ${nf.format(current.raw.rsi14)} · 이전 완료 주 RSI ${nf.format(current.raw.weeklyRsi14)}</td></tr>
        <tr><th scope="row">공포</th><td>${nf.format(current.components.fear)} / 100</td><td>VIX ${nf.format(current.raw.vix)} · ${escape(current.raw.vixDate)} 자료</td></tr>
      </tbody></table></div><p class="hint">세 묶음을 같은 비중으로 합산한 점수 ${nf.format(current.score)}를 ${current.referenceYear}년 시작 전 자료로 정한 경계에 적용했습니다. 보조지표는 최소 1거래일 지연하므로 아래 최신 지표와 값이 다를 수 있습니다.</p>
      <p class="hint">공포탐욕은 별도 확장형으로 비교 중이며 현재 기본 점수에는 포함하지 않습니다. 풋/콜비율도 장기 이력이 부족해 점수에서 제외했습니다.</p></details>
      <details class="position-validation"><summary>10단계 전체 검증 결과</summary><p class="hint">${escape(study.start)} ~ ${escape(study.end)} 신호 · 다음 거래일 시가 진입 · 126거래일 후 종가 · 배당·비용 제외. 추가하락은 이후 63거래일 최저 종가 기준입니다.</p>
      <div class="tablewrap" role="region" tabindex="0" aria-label="단계별 과거 성과 표"><table class="position-table"><thead><tr><th>단계</th><th>월별 표본</th><th>6개월 중앙값</th><th>상승 비율</th><th>중간 50% 수익률</th><th>최악 추가하락</th></tr></thead><tbody>${study.stages.map(row=>`<tr><th scope="row">${row.stage} ${escape(row.label)}</th><td>${row.n}</td><td>${pct(row.median6)}</td><td>${rate(row.winRate)}</td><td>${pct(row.q25)} ~ ${pct(row.q75)}</td><td>${pct(row.worstDownside)}</td></tr>`).join('')}</tbody></table></div>
      <p class="hint">낮은 단계일수록 수익률 중앙값이 높았던 인접 구간은 ${study.orderedPairs}/${study.totalPairs}개입니다. 10단계의 세밀한 서열과 바닥 판별 정확도는 확인되지 않았습니다. 자료는 실제 당시 발표본 전체가 보존된 데이터가 아니며, 과거 자료의 수정 가능성과 결과 기간 중첩이 있습니다.</p>
      <p><a href="POSITION_RESULTS.md" target="_blank" rel="noopener">비교 모델·기간별 연구 결과</a> · <a href="POSITION_METHOD.md" target="_blank" rel="noopener">계산·검증 기준</a></p></details>`;
    panel.querySelectorAll('[data-stage]').forEach(button=>button.addEventListener('click',()=>observations(panel,+button.dataset.stage)));
    observations(panel,current.stage);
  }
  panels.forEach(panel=>{panel.innerHTML='<h2>시장 위치 연구</h2><p class="hint" role="status">과거 검증 결과를 불러오는 중…</p>';});
  fetch('data/position.json',{cache:'no-cache',signal:AbortSignal.timeout(15000)}).then(response=>{
    if(!response.ok)throw Error('No position data');return response.json();
  }).then(json=>{
    if(json.version!=='research-v1'||!json.latest||!Array.isArray(json.labels)||json.labels.length!==10||
      !Number.isInteger(json.latest.stage)||json.latest.stage<1||json.latest.stage>10||!json.models?.relative?.stages)throw Error('Invalid position data');
    data=json;panels.forEach(render);
  }).catch(()=>panels.forEach(panel=>{panel.innerHTML='<h2>시장 위치 연구</h2><p class="hint" role="status">검증 자료를 읽을 수 없어 현재 단계는 표시하지 않습니다. 잠시 후 페이지를 새로고침해 주세요.</p>';}));
})();
