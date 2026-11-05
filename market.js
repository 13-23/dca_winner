(function () {
  'use strict';
  const panels = [...document.querySelectorAll('[data-market-panel]')];
  if (!panels.length) return;
  const nf = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const dateFormat = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' });
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels = { fear_greed: '공포·탐욕 지수', vix: 'VIX', put_call: '전체 풋/콜 비율', vix9d: 'VIX9D', vvix: 'VVIX' };
  let snapshot = null, loading = false;
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
  const numeric = value => typeof value === 'number' && Number.isFinite(value);
  const dated = value => validDate(value) ? dateFormat.format(new Date(value+'T00:00:00Z')) : '기준일 없음';
  const age = value => validDate(value) ? (Date.now()-Date.parse(value+'T00:00:00Z'))/86400000 : Infinity;
  const scoreName = value => value < 25 ? '극도의 공포' : value < 45 ? '공포' : value <= 55 ? '중립' : value <= 75 ? '탐욕' : '극도의 탐욕';
  function trustedUrl(value) {
    try { const url = new URL(value); return url.protocol === 'https:' && ['www.cboe.com','www.cnn.com','github.com'].includes(url.hostname) ? url.href : null; }
    catch (_) { return null; }
  }
  function rows() {
    return Object.entries(labels).map(([id,label]) => {
      const raw = snapshot?.items?.find(item => item.id === id) || {};
      const hasValue = numeric(raw.value) && raw.value >= 0 && validDate(raw.asOf) && age(raw.asOf) >= -1 &&
        (id !== 'fear_greed' || raw.value <= 100) && (id !== 'put_call' || raw.value <= 10);
      return {...raw, id, label, value:hasValue ? raw.value : null,
        status:!hasValue ? 'unavailable' : raw.status !== 'available' || age(raw.asOf)>6 ? 'stale' : 'available'};
    });
  }
  function render(panel, index, error = false) {
    const selected = panel.querySelector('select')?.value || 'vix';
    const items = rows();
    const heading = 'market-heading-'+index, select = 'market-series-'+index;
    panel.setAttribute('aria-labelledby', heading);
    panel.removeAttribute('aria-label');
    panel.innerHTML = `<div class="market-heading"><h2 id="${heading}">시장 보조지표</h2><button class="btn market-refresh" type="button" ${loading?'disabled':''}>${loading?'불러오는 중…':'새로고침'}</button></div>
      <div class="market-context"><p class="hint">미국 주식시장 기준입니다. 선택 종목·적립 기간과 별개인 최신 일별 자료이며 실시간 시세는 아닙니다.</p>
      <p class="hint market-updated" role="status" aria-live="polite">${error?'저장된 지표 파일을 읽지 못했습니다. 잠시 후 새로고침해 주세요.':snapshot?.updated?'자료 수집: '+escape(new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Seoul'}).format(new Date(snapshot.updated)))+' KST · 표의 기준일은 미국 시장 날짜입니다.':'지표를 불러오는 중…'}</p></div>
      <div class="tablewrap" role="region" tabindex="0" aria-label="시장 보조지표 표. 좁은 화면에서는 좌우로 스크롤할 수 있습니다."><table class="market-table"><thead><tr><th scope="col">지표</th><th scope="col">최근 값 / 이전 대비</th><th scope="col">기준일 / 출처</th><th scope="col">자료 상태</th></tr></thead><tbody>${items.map(item => {
        const url = trustedUrl(item.url);
        const change = numeric(item.change) && item.status !== 'unavailable' ? (item.change>0?'+':'')+nf.format(item.change) : null;
        return `<tr><th scope="row">${escape(item.label)}<small>${escape(item.description || '')}</small></th>
          <td><span class="market-value">${item.value===null?'—':nf.format(item.value)+(item.unit?' '+escape(item.unit):'')}</span>
          <small>${change===null?'이전 값 없음':change+' · 이전 관측값 대비'}</small>
          ${item.id==='fear_greed'&&item.value!==null?`<small>${scoreName(item.value)}</small><div class="market-scale"><span>공포</span><meter min="0" max="100" value="${item.value}" aria-label="공포·탐욕 점수">${nf.format(item.value)}</meter><span>탐욕</span></div>`:''}</td>
          <td>${escape(dated(item.asOf))}<small>${url?`<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(item.source)}</a>`:'출처 확인 불가'}</small></td>
          <td><span class="market-status ${item.status}">${item.status==='available'?(item.indirect?'아카이브':'수집됨'):item.status==='stale'?'오래된 자료':'수집 불가'}</span></td></tr>`;
      }).join('')}</tbody></table></div>
      <div class="market-history"><div class="field"><label for="${select}">지표별 추이 · 최대 90개 관측값</label><select id="${select}">${items.map(item=>`<option value="${item.id}" ${item.id===selected?'selected':''}>${escape(item.label)}</option>`).join('')}</select></div><figure></figure></div>
      <details><summary>자료를 읽을 때 참고하세요</summary><p>지표마다 발표일과 수집 시각이 다릅니다. 풋/콜비율은 Cboe 전체 상품의 당일 거래량 비율이며, CNN의 5일 평균이나 주식 전용 비율과 비교할 때 기준을 확인해 주세요.</p><p>CNN 직접 수집이 불가능할 때 공포·탐욕은 공개 아카이브를 사용하고 출처에 표시합니다. 갱신 실패 시 이전 기준일을 유지하며 ‘오래된 자료’로 표시합니다. 이 화면의 지표는 과거 적립식 계산 결과에 반영되지 않습니다.</p></details>`;
    panel.querySelector('.market-refresh').addEventListener('click', load);
    panel.querySelector('select').addEventListener('change', () => draw(panel));
    draw(panel);
  }
  function draw(panel) {
    const item = rows().find(row=>row.id===panel.querySelector('select').value);
    const figure = panel.querySelector('figure');
    const history = (Array.isArray(item?.history)?item.history:[])
      .filter(p=>Array.isArray(p)&&validDate(p[0])&&numeric(p[1])&&p[1]>=0&&age(p[0])>=-1)
      .sort((a,b)=>a[0].localeCompare(b[0])).slice(-90);
    if(history.length<2){figure.innerHTML='<p class="hint">추이를 그릴 관측값이 아직 부족합니다. 자동 수집이 이어지면 표시됩니다.</p>';return;}
    const values = history.map(p=>p[1]);
    const min = item.id==='fear_greed'?0:Math.min(...values), max = item.id==='fear_greed'?100:Math.max(...values);
    const pad=(max-min)*.12 || Math.max(max*.05,1), lo=Math.max(0,min-pad), hi=max+pad;
    const width = matchMedia('(max-width:620px)').matches ? 340 : 680, right = width-24;
    const t0=Date.parse(history[0][0]),tn=Date.parse(history.at(-1)[0]);
    const x=date=>62+(Date.parse(date)-t0)/(tn-t0||1)*(right-62);
    const y=value=>160-(value-lo)/(hi-lo)*140;
    const path=history.map(([date,value],i)=>(i?'L':'M')+x(date).toFixed(2)+' '+y(value).toFixed(2)).join(' ');
    const title=item.label+' 관측 추이';
    figure.innerHTML=`<svg viewBox="0 0 ${width} 200" role="img" aria-label="${escape(title)}"><title>${escape(title)}</title>
      ${[lo,(lo+hi)/2,hi].map(value=>`<line x1="62" x2="${right}" y1="${y(value)}" y2="${y(value)}" stroke="var(--line)"/><text x="54" y="${y(value)+4}" text-anchor="end">${nf.format(value)}</text>`).join('')}
      <path d="${path}" stroke="var(--accent)" stroke-width="2" fill="none"/>
      <circle cx="${x(history.at(-1)[0])}" cy="${y(history.at(-1)[1])}" r="3" fill="var(--accent)"/>
      <text x="62" y="188">${escape(history[0][0])}</text><text x="${right}" y="188" text-anchor="end">${escape(history.at(-1)[0])}</text></svg>
      <figcaption>${escape(item.label)} · ${history.length}개 관측값 · 세로축은 해당 지표의 값입니다.${item.status==='stale'?' 오래된 자료가 포함되어 있습니다.':''}</figcaption>`;
  }
  async function load(event) {
    if(loading)return;
    const refreshIndex = event?.currentTarget ? panels.indexOf(event.currentTarget.closest('[data-market-panel]')) : -1;
    loading=true;
    panels.forEach((panel,index)=>render(panel,index));
    let failed=false;
    try {
      const response=await fetch('data/market.json',{cache:'no-cache',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error('Missing data');
      const json=await response.json();
      if(json.market!=='US'||!Array.isArray(json.items)||!Number.isFinite(Date.parse(json.updated)))throw Error('Invalid data');
      snapshot=json;
    } catch (_) { failed=true; if(snapshot)snapshot={...snapshot,items:snapshot.items.map(item=>({...item,status:'stale'}))}; }
    finally {
      loading=false;
      panels.forEach((panel,index)=>render(panel,index,failed));
      if(refreshIndex>=0 && document.activeElement===document.body)panels[refreshIndex].querySelector('.market-refresh').focus();
    }
  }
  let resizing = false;
  addEventListener('resize', () => {
    if(resizing)return;
    resizing=true;
    requestAnimationFrame(()=>{resizing=false;panels.filter(panel=>panel.querySelector('select')).forEach(draw);});
  });
  load();
})();
