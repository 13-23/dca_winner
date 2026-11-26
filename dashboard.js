(() => {
  "use strict";
  const $ = selector => document.querySelector(selector);
  const nf = new Intl.NumberFormat("ko-KR", {maximumFractionDigits:2});
  const date = new Intl.DateTimeFormat("ko-KR", {timeZone:"UTC",year:"numeric",month:"2-digit",day:"2-digit"});
  const stamp = new Intl.DateTimeFormat("ko-KR", {timeZone:"Asia/Seoul",dateStyle:"medium",timeStyle:"short"});
  const escape = value => String(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const groups = [
    {title:"한국시장",symbols:["^KS11","^KQ11","069500.KS","229200.KS"],names:{"069500.KS":"KODEX 200 · ETF","229200.KS":"코스닥150 · ETF"}},
    {title:"미국시장",symbols:["^GSPC","^DJI","^IXIC","^NDX"]},
    {title:"디지털자산",symbols:["BTC-KRW","BTC-USD","ETH-KRW","ETH-USD"]}
  ];
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
    const formatted=symbol.startsWith("^") ? nf.format(current[1])+" pt" : unit+nf.format(current[1]);
    const age=(Date.now()-Date.parse(current[0]+"T00:00:00Z"))/86400000;
    const status=metadata.quoteUpdate.status==="retained"?"이전 수집값":age>5?"기준일 확인":"종가 확정";
    const tab=symbol.startsWith("^")?"tv":"dca";
    const denomination=symbol.startsWith("^")?"지수 포인트":metadata.currency;
    return `<a class="snapshot-row" href="#${tab}" data-open-market="${escape(symbol)}" aria-label="${escape(alias||metadata.label)} 상세 보기"><div><strong>${escape(alias||metadata.label)}</strong><small>${escape(current[0])} · ${escape(denomination)} · ${status}</small></div><div class="snapshot-value"><b>${escape(formatted)}</b><small class="${change>0?"positive":change<0?"negative":""}">${change>0?"+":""}${nf.format(change)}%</small></div></a>`;
  }
  function symbolName(item){return item?.label||item?.symbol||"시장 지표";}
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
  function renderLeaders(container, symbols, indexItems, assets) {
    const rows=symbols.map(symbol=>{
      const metadata=indexItems.find(item=>item.symbol===symbol), data=assets[symbol]?.data;
      if(!metadata||!data||data.length<2||!metadata.quoteUpdate?.closeDate)return null;
      const idx=data.findIndex(row=>row[0]===metadata.quoteUpdate.closeDate);
      if(idx<1)return null;
      const change=(data[idx][1]/data[idx-1][1]-1)*100;
      return {metadata,change,day:data[idx][0]};
    }).filter(Boolean).sort((a,b)=>b.change-a.change);
    container.innerHTML=rows.map(row=>`<div class="theme-row"><span><strong>${escape(row.metadata.label)}</strong><small>${row.day} · ${row.metadata.currency}</small></span><b class="${row.change>0?"positive":"negative"}">${row.change>0?"+":""}${nf.format(row.change)}%</b></div>`).join("")||'<p class="hint">표시할 데이터가 없습니다.</p>';
  }
  function renderMacro(snapshot, ai) {
    const data=(snapshot?.items||[]).filter(item=>["vix","fear_greed"].includes(item.id));
    const rate=ai?.yield;
    if(rate)data.push({id:"yield",label:"미국 10년물",value:rate.current,asOf:rate.date,unit:"%",source:rate.source});
    $("#dashboard-macro").innerHTML=data.map(item=>`<div class="macro-row"><span><strong>${escape(labels[item.id]||item.label)}</strong><small>${escape(item.asOf||"기준일 없음")} · ${escape(item.source||"출처")} · ${item.status==="stale"?"갱신 지연":"수집값"}</small></span><b>${Number.isFinite(item.value)?nf.format(item.value)+(item.unit?" "+escape(item.unit):""):"—"}</b></div>`).join("")||'<p class="hint">시장 지표 파일을 불러오지 못했습니다.</p>';
  }
  async function load() {
    const status=$("#dashboard-updated");
    status.textContent="자료를 불러오는 중…";
    try {
      const index=await fetch("data/index.json",{cache:"no-cache"}).then(response=>{if(!response.ok)throw Error();return response.json()});
      const leaderSymbols=["069500.KS","229200.KS","133690.KS","360750.KS","SPY","QQQ","DIA"];
      const quoteItems=index.items.filter(item=>groups.some(group=>group.symbols.includes(item.symbol))||leaderSymbols.includes(item.symbol));
      const assets=Object.fromEntries(await Promise.all(quoteItems.map(async item=>{
        try {return [item.symbol,await fetch("data/"+item.symbol.replace(/[^A-Za-z0-9.\\-]/g,"_")+".json",{cache:"no-cache"}).then(response=>{if(!response.ok)throw Error();return response.json()})];}
        catch(_){return [item.symbol,null];}
      })));
      $("#dashboard-markets").replaceChildren(...groups.map((group,position)=>renderGroup(group,position,index.items,assets)));
      renderLeaders($("#dashboard-kr-themes"),["069500.KS","229200.KS","133690.KS","360750.KS"],index.items,assets);
      renderLeaders($("#dashboard-us-themes"),["SPY","QQQ","DIA"],index.items,assets);
      let market=null,ai=null;
      try{market=await fetch("data/market.json",{cache:"no-cache"}).then(response=>response.ok?response.json():null)}catch(_){}
      try{ai=await fetch("data/ai-cycle.json",{cache:"no-cache"}).then(response=>response.ok?response.json():null)}catch(_){}
      renderMacro(market,ai);
      status.textContent=`전체 수집 ${index.updated} · KST`;
      $("#dashboard-note").textContent="각 종목은 마지막 확정 종가 기준입니다. 화면 갱신 시각과 거래일 기준일은 다를 수 있으며, ETF 변동은 해당 ETF 수익률로 지수와 다를 수 있습니다.";
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
