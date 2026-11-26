(() => {
  "use strict";
  const $ = selector => document.querySelector(selector);
  const nf = new Intl.NumberFormat("ko-KR", {maximumFractionDigits:2});
  const won = new Intl.NumberFormat("ko-KR", {maximumFractionDigits:0});
  const date = new Intl.DateTimeFormat("ko-KR", {timeZone:"UTC",year:"numeric",month:"2-digit",day:"2-digit"});
  const stamp = new Intl.DateTimeFormat("ko-KR", {timeZone:"Asia/Seoul",dateStyle:"medium",timeStyle:"short"});
  const escape = value => String(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const groups = [
    {title:"한국시장",symbols:["^KS11","^KQ11","069500.KS","229200.KS"],names:{"069500.KS":"KODEX 200 · ETF","229200.KS":"코스닥150 · ETF"}},
    {title:"미국시장",symbols:["^GSPC","^DJI","^IXIC","^NDX"]},
    {title:"디지털자산",symbols:["BTC-KRW","BTC-USD","ETH-KRW","ETH-USD"]}
  ];
  const themes = {
    korea:[
      {name:"반도체",symbols:["005930.KS","000660.KS"]},
      {name:"인터넷·플랫폼",symbols:["035420.KS","035720.KS"]},
      {name:"화장품·생활소비재",symbols:["051900.KS"]}
    ],
    us:[
      {name:"반도체",symbols:["NVDA","AMD","AVGO"]},
      {name:"대형 플랫폼·클라우드",symbols:["AAPL","MSFT","GOOGL","AMZN","META"]}
    ]
  };
  const labels = {fear_greed:"공포·탐욕",vix:"VIX",vix9d:"VIX9D",vvix:"VVIX",put_call:"풋/콜 비율"};
  const tvSymbols={"^KS11":"KRX:KOSPI","^KQ11":"KRX:KOSDAQ","^IXIC":"NASDAQ:IXIC","^NDX":"NASDAQ:NDX","^DJI":"DJ:DJI","^GSPC":"SP:SPX"};
  const currency = {KRW:"₩",USD:"$",JPY:"¥",EUR:"€"};
  function priceRow(item, asset, metadata, alias) {
    const rows = asset?.data;
    if (!Array.isArray(rows) || rows.length < 2 || !metadata?.quoteUpdate?.closeDate) return `<article class="snapshot-row unavailable"><div><strong>${escape(alias || metadata?.label || symbolName(item))}</strong><small>자료 확인 필요</small></div><b>—</b></article>`;
    const end = rows.findIndex(row=>row[0]===metadata.quoteUpdate.closeDate);
    if(end<1)return `<article class="snapshot-row unavailable"><div><strong>${escape(alias || metadata.label)}</strong><small>확정 종가 없음</small></div><b>—</b></article>`;
    const current=rows[end], previous=rows[end-1];
    if (!Number.isFinite(current[1]) || !Number.isFinite(previous[1]) || previous[1]===0) return "";
    const change=(current[1]/previous[1]-1)*100, symbol=metadata.symbol;
    const unit=currency[metadata.currency] || "";
    const formatted=symbol.startsWith("^") ? nf.format(current[1])+" pt" : unit+(metadata.currency==="KRW"?won:nf).format(current[1]);
    const age=(Date.now()-Date.parse(current[0]+"T00:00:00Z"))/86400000;
    const status=metadata.quoteUpdate.status==="retained"?"이전 수집값":age>5?"기준일 확인":"종가 확정";
    const tab=symbol.startsWith("^")?"tv":"dca";
    const denomination=symbol.startsWith("^")?"지수 포인트":metadata.currency;
    return `<a class="snapshot-row" href="#${tab}" data-open-market="${escape(symbol)}" aria-label="${escape(alias||metadata.label)} 상세 보기"><div><strong>${escape(alias||metadata.label)}</strong><small>${escape(current[0])} · ${escape(denomination)} · ${status}</small></div><div class="snapshot-value"><b>${escape(formatted)}</b><small class="${change>0?"positive":change<0?"negative":""}">${change>0?"+":""}${nf.format(change)}%</small></div></a>`;
  }
  function symbolName(item){return typeof item==="string"?item:item?.label||item?.symbol||"시장 지표";}
  function renderGroup(group, index, indexItems, assets) {
    const records=group.symbols.map(symbol=>{
      const metadata=indexItems.find(item=>item.symbol===symbol);
      return priceRow(symbol,assets[symbol],metadata,group.names?.[symbol]);
    }).join("");
    const panel=document.createElement("section");
    panel.className="dashboard-market";
    panel.innerHTML=`<header><span class="market-number">0${index+1}</span><h2>${group.title}</h2><span class="hint">${group.title==="한국시장"?"KRW · 지수 포인트":group.title==="미국시장"?"USD · 지수 포인트":"KRW / USD"}</span></header><div>${records}</div>`;
    return panel;
  }
  function renderThemes(container, buckets, indexItems, assets) {
    const rows=buckets.map(bucket=>{
      const members=bucket.symbols.map(symbol=>{
        const metadata=indexItems.find(item=>item.symbol===symbol), data=assets[symbol]?.data;
        return metadata&&Array.isArray(data)?{symbol,metadata,data}:null;
      }).filter(Boolean);
      if(members.length!==bucket.symbols.length)return {name:bucket.name,missing:bucket.symbols.length-members.length};
      const common=members.map(member=>new Set(member.data.map(row=>row[0]))).reduce((days,next)=>new Set([...days].filter(day=>next.has(day))));
      const dates=[...common].sort();
      if(dates.length<2)return {name:bucket.name,missing:bucket.symbols.length};
      const current=dates.at(-1),previous=dates.at(-2);
      const changes=members.map(member=>{
        const currentClose=member.data.find(row=>row[0]===current)?.[1];
        const previousClose=member.data.find(row=>row[0]===previous)?.[1];
        return currentClose>0&&previousClose>0?100*(currentClose/previousClose-1):null;
      });
      if(changes.some(change=>!Number.isFinite(change)))return {name:bucket.name,missing:bucket.symbols.length};
      return {name:bucket.name,day:current,change:changes.reduce((total,value)=>total+value,0)/changes.length,members:members.map(member=>member.metadata.label)};
    });
    container.innerHTML=rows.map(row=>row.missing?`<div class="theme-row"><span><strong>${escape(row.name)}</strong><small>구성 종목 ${row.missing}개 자료 누락 · 평균 계산 보류</small></span><b>—</b></div>`:`<div class="theme-row"><span><strong>${escape(row.name)}</strong><small>${escape(row.members.join(" · "))} · ${row.day} · 동일가중</small></span><b class="${row.change>0?"positive":row.change<0?"negative":""}">${row.change>0?"+":""}${nf.format(row.change)}%</b></div>`).join("");
  }
  function statusFor(item, marketItems=[]) {
    if(item.status==="unavailable")return "자료 없음";
    if(item.status==="stale"||item.status==="retained")return "이전 수집값 · 확인 필요";
    if(item.id==="vix")return item.value<15?"내재변동성 낮은 구간":item.value<20?"보통 변동성 구간":item.value<30?"변동성 상승 구간":"높은 변동성 구간";
    if(item.id==="fear_greed")return item.value<25?"극도의 공포":item.value<45?"공포":item.value<=55?"중립":item.value<=75?"탐욕":"극도의 탐욕";
    if(item.id==="put_call")return item.value>1?"풋 거래량이 콜보다 많음":item.value<1?"콜 거래량이 풋보다 많음":"풋·콜 거래량 비슷";
    if(item.id==="yield")return `${item.change>0?"7일 전보다 상승":item.change<0?"7일 전보다 하락":"7일 전과 동일"} · 금리 방향 참고`;
    if(item.id==="vix9d"){
      const vix=marketItems.find(row=>row.id==="vix")?.value;
      return Number.isFinite(vix)?item.value>vix?"9일 변동성 > VIX · 단기 우려가 상대적으로 높음":item.value<vix?"9일 변동성 < VIX · 단기 우려가 상대적으로 낮음":"9일·30일 변동성 비슷": "기준일 기준 관측값";
    }
    if(item.id==="vvix")return item.change>0?"전일 상승 · VIX 옵션 변동성 확대":item.change<0?"전일 하락 · VIX 옵션 변동성 축소":"전일과 비슷한 수준";
    return "기준일 기준 관측값";
  }
  function renderMacro(snapshot, ai, derivatives) {
    const data=(snapshot?.items||[]).filter(item=>["vix","fear_greed"].includes(item.id));
    const rate=ai?.yield;
    if(rate)data.push({id:"yield",label:"미국 10년물",value:rate.current,previous:rate.previous,change:rate.current-rate.previous,asOf:rate.date,unit:"%",source:rate.source,status:ai._status?.yield==="retained"?"stale":"available"});
    const listed=data.map(item=>`<div class="macro-row"><span><strong>${escape(labels[item.id]||item.label)}</strong><small>${escape(item.asOf||"기준일 없음")} · ${escape(item.source||"출처")} · ${escape(statusFor(item,snapshot?.items||[]))}</small></span><b>${Number.isFinite(item.value)?nf.format(item.value)+(item.unit?" "+escape(item.unit):""):"—"}</b></div>`).join("");
    const futures=(derivatives?.items||[]).map(item=>{
      const future=item.futuresOnly||{}, combined=item.combined||{};
      const oiChange=future.openInterestChange, netChange=future.netChange, combinedOiChange=combined.openInterestChange;
      const oiStatus=!Number.isFinite(oiChange)?"미결제약정 변화 자료 없음":oiChange>0?"미결제약정 증가 · 계약 수 확대":oiChange<0?"미결제약정 감소 · 계약 수 축소":"미결제약정 보합";
      const combinedOiSummary=!Number.isFinite(combinedOiChange)?"주간 변화 없음":`주간 ${combinedOiChange>0?"+":""}${nf.format(combinedOiChange)}계약`;
      const netStatus=item.status==="retained"?"마지막 수집값 · 새 보고서 대기":item.status==="stale"?"보고서 기준일 오래됨":item.status==="unavailable"?"자료 수집 불가":item.status;
      const changeText=Number.isFinite(netChange)?`순포지션 ${netChange>0?"+":""}${nf.format(netChange)}계약 주간 변화`:"";
      const combinedStatus=item.combinedStatus==="available"?"옵션 포함 환산 OI":item.combinedStatus==="stale"?"옵션 포함 OI 갱신 지연":item.combinedStatus==="retained"?"옵션 포함 OI 이전 보고서 유지":"옵션 포함 OI 자료 없음";
      return `<div class="macro-row futures-row"><span><strong>${escape(future.label||item.label)} · 미결제약정</strong><small>${escape(future.asOf||"기준일 없음")} 화요일 기준 · ${escape(netStatus)}</small><small>선물 전용 OI ${Number.isFinite(future.openInterest)?nf.format(future.openInterest)+"계약":"—"} (${escape(oiStatus)}) · 선물·옵션 합산 등가 OI ${Number.isFinite(combined.openInterest)?nf.format(combined.openInterest)+"계약":"—"} (${escape(combinedOiSummary)})</small><small>레버리지 펀드 ${escape(future.status||"포지션 자료 없음")} · 순포지션 ${Number.isFinite(future.net)?nf.format(future.net)+"계약":"—"} (${Number.isFinite(future.netPercentOpenInterest)?nf.format(future.netPercentOpenInterest)+"% of OI":"—"}) · ${changeText}</small><small>${escape(combinedStatus)} · 옵션은 선물 환산값</small></span></div>`;
    }).join("");
    const optionItems=(snapshot?.items||[]).filter(item=>["put_call","vix9d","vvix"].includes(item.id));
    const options=optionItems.map(item=>`<div class="macro-row"><span><strong>${escape(labels[item.id]||item.label)} · 옵션</strong><small>${escape(item.asOf||"기준일 없음")} · ${escape(item.source||"출처")} · ${escape(statusFor(item))}</small></span><b>${Number.isFinite(item.value)?nf.format(item.value)+(item.unit?" "+escape(item.unit):""):"—"}</b></div>`).join("");
    $("#dashboard-macro").innerHTML=listed+`<h3 class="macro-subhead">선물 포지션·미결제약정 · CFTC</h3>${futures||'<p class="hint">선물 포지션 자료를 불러오지 못했습니다.</p>'}<h3 class="macro-subhead">옵션 심리 · Cboe</h3>${options||'<p class="hint">옵션 자료를 불러오지 못했습니다.</p>'}<p class="hint derivatives-guide">VIX 구간은 참고용 설명 기준입니다. CFTC 포지션은 매주 화요일 기준 주간 자료입니다. 옵션 포함 OI는 옵션을 선물 등가로 환산한 값이며 실제 옵션 계약 수와 다릅니다. OI 증감만으로 방향을 판단할 수 없습니다. 풋/콜은 Cboe 전체 상품 당일 거래량 비율이며 매수·매도 방향을 뜻하지 않습니다. <a href="https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm" target="_blank" rel="noopener noreferrer">CFTC 원자료</a> · <a href="https://www.cboe.com/markets/us/options/market-statistics/daily" target="_blank" rel="noopener noreferrer">Cboe 옵션 원자료</a></p>`;
  }
  async function load() {
    const status=$("#dashboard-updated");
    status.textContent="자료를 불러오는 중…";
    try {
      const index=await fetch("data/index.json",{cache:"no-cache"}).then(response=>{if(!response.ok)throw Error();return response.json()});
      const themeSymbols=[...themes.korea,...themes.us].flatMap(theme=>theme.symbols);
      const quoteItems=index.items.filter(item=>groups.some(group=>group.symbols.includes(item.symbol))||themeSymbols.includes(item.symbol));
      const assets=Object.fromEntries(await Promise.all(quoteItems.map(async item=>{
        try {return [item.symbol,await fetch("data/"+item.symbol.replace(/[^A-Za-z0-9.\\-]/g,"_")+".json",{cache:"no-cache"}).then(response=>{if(!response.ok)throw Error();return response.json()})];}
        catch(_){return [item.symbol,null];}
      })));
      $("#dashboard-markets").replaceChildren(...groups.map((group,position)=>renderGroup(group,position,index.items,assets)));
      renderThemes($("#dashboard-kr-themes"),themes.korea,index.items,assets);
      renderThemes($("#dashboard-us-themes"),themes.us,index.items,assets);
      let market=null,ai=null,derivatives=null;
      try{market=await fetch("data/market.json",{cache:"no-cache"}).then(response=>response.ok?response.json():null)}catch(_){}
      try{ai=await fetch("data/ai-cycle.json",{cache:"no-cache"}).then(response=>response.ok?response.json():null)}catch(_){}
      try{derivatives=await fetch("data/derivatives.json",{cache:"no-cache"}).then(response=>response.ok?response.json():null)}catch(_){}
      renderMacro(market,ai,derivatives);
      status.textContent=`전체 수집 ${index.updated} · KST`;
      $("#dashboard-note").textContent="테마 변동은 표시 구성 종목의 같은 거래일 종가 수익률을 동일가중 평균한 참고값이며 배당을 반영하지 않습니다. 시장별 기준일과 전체 수집 시각은 다를 수 있습니다.";
      document.querySelectorAll("[data-open-market]").forEach(link=>link.addEventListener("click",event=>{
        event.preventDefault(); const symbol=link.dataset.openMarket;
        if(symbol.startsWith("^")){document.querySelector('#tv-symbol').value=tvSymbols[symbol];document.querySelector('#tv-symbol').dispatchEvent(new Event("change"));document.getElementById("tab-btn-tv").click();}
        else{document.getElementById("tab-btn-dca").click();document.querySelector('#preset').value=symbol;document.querySelector('#preset').dispatchEvent(new Event("change"));}
      }));
    } catch(_) {status.textContent="가격 데이터를 불러오지 못했습니다.";$("#dashboard-markets").innerHTML='<p class="hint">시세 목록을 읽을 수 없습니다. 잠시 후 다시 확인해 주세요.</p>';}
  }
  document.addEventListener("DOMContentLoaded",load);
  window.addEventListener("dashboardrefresh",load);
})();
