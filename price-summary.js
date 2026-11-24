(function (root) {
  "use strict";

  const day = 86400000;
  const hour = day / 24;
  const crypto = asset => /^(CCC|CMC)$/i.test(asset.exchange || "") || /^(BTC|ETH)-(KRW|USD)$/.test(asset.symbol);
  const korea = asset => /\.(KS|KQ)$|^\^K[QS]11$/.test(asset.symbol);
  const closeDelay = asset => crypto(asset) ? day : korea(asset) ? 8 * hour : asset.currency === "USD" ? 22 * hour : day;

  function confirmedRows(asset) {
    const captured = Date.parse(asset.fetchedAt);
    if (!Number.isFinite(captured)) return [];
    const delay = closeDelay(asset);
    const closes = new Map();
    for (const row of asset.data) {
      const [date, price] = Array.isArray(row) ? row : [row.t, row.c];
      const time = Date.parse(date);
      if (Number.isFinite(time) && time + delay <= captured && Number.isFinite(price) && price > 0) {
        closes.set(date, {date, time, price, row});
      }
    }
    return [...closes.values()].sort((a, b) => a.time - b.time);
  }

  function summarize(asset) {
    const history = confirmedRows(asset);
    const current = history.at(-1);
    if (!current) return null;

    let recent = null, nearest = null, peak = 0, maxDrawdown = 0, count = 0;
    for (const close of history) {
      const age = (current.time - close.time) / day;
      if (age <= 365) {
        count++;
        peak = Math.max(peak, close.price);
        maxDrawdown = Math.min(maxDrawdown, close.price / peak - 1);
      }
      if (age < 30) continue;
      const gap = close.price / current.price - 1;
      const match = {...close, gap};
      if (Math.abs(gap) <= 0.01 + Number.EPSILON) recent = match;
      if (!nearest || Math.abs(gap) <= Math.abs(nearest.gap)) nearest = match;
    }
    const weeks = new Map();
    for (const close of history) {
      const offset = (new Date(close.time).getUTCDay() + 6) % 7;
      weeks.set(close.time - offset * day, close.price);
    }
    const gapToAverage = (prices, size) => prices.length < size ? null :
      current.price / (prices.slice(-size).reduce((sum, price) => sum + price, 0) / size) - 1;
    return {
      dailyGap: gapToAverage(history.map(close => close.price), 200),
      weeklyGap: gapToAverage([...weeks.values()], 60),
      current, first: history[0].date, comparison: recent || nearest, withinBand: !!recent,
      peakGap: count > 1 ? current.price / peak - 1 : null,
      maxDrawdown: count > 1 ? maxDrawdown : null,
      riskStart: history.find(close => current.time - close.time <= 365 * day).date
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {summarize};
    return;
  }

  const number = new Intl.NumberFormat("ko-KR", {maximumFractionDigits: 4});
  const percent = new Intl.NumberFormat("ko-KR", {style: "percent", maximumFractionDigits: 2, signDisplay: "exceptZero"});
  const collectedAt = new Intl.DateTimeFormat("ko-KR", {dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul"});
  let valuationRequest;

  function read(path) {
    return fetch(path, {cache: "no-cache", signal: AbortSignal.timeout(10000)}).then(response => {
      if (!response.ok) throw Error("자료 조회 실패");
      return response.json();
    });
  }

  function loadValuations() {
    if (!valuationRequest) {
      valuationRequest = Promise.allSettled([read("data/valuation-references.json"), read("data/valuations.json")])
        .then(([references, automatic]) => {
          if (references.status === "rejected" || automatic.status === "rejected") valuationRequest = null;
          return {references: references.value?.trailing, automatic: automatic.value?.items};
        });
    }
    return valuationRequest;
  }

  function addLine(cell, value) {
    const line = document.createElement("small");
    line.textContent = value;
    cell.append(line);
  }

  const drawdownMarkets = {"^GSPC": "S&P 500", "^IXIC": "나스닥 종합", "^DJI": "다우존스", "^NDX": "나스닥100", "^KS11": "코스피", "^KQ11": "코스닥"};
  function drawdownLink(symbol) {
    let market = Object.hasOwn(drawdownMarkets, symbol) ? symbol : "";
    if (["SPY", "VOO", "SSO", "UPRO", "360750.KS"].includes(symbol)) market = "^GSPC";
    if (symbol === "DIA") market = "^DJI";
    if (["QQQ", "QLD", "TQQQ", "133690.KS"].includes(symbol)) market = "^NDX";
    if (["229200.KS", "233740.KS"].includes(symbol) || symbol.endsWith(".KQ")) market = "^KQ11";
    if (!market && symbol.endsWith(".KS")) market = "^KS11";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn price-drawdown";
    button.textContent = market
      ? drawdownMarkets[market] + (market === symbol ? " 하락·회복" : " 참고 분석")
      : "하락·회복 지수 선택";
    button.addEventListener("click", () => window.dispatchEvent(new CustomEvent("drawdownselect", {detail: market})));
    return button;
  }

  function render(panel, assets, {portfolio = false, mdd = null} = {}) {
    panel.hidden = true;
    const body = panel.querySelector("tbody");
    body.replaceChildren();
    if (!assets.length) return;

    panel.querySelector("[data-price-context]").textContent = portfolio
      ? "구성 종목별 최신 종가이며 적립 계산 종료일과 다를 수 있습니다. 계산 기간의 혼합 MDD(입금 효과 제외) " + (mdd == null ? "자료 없음" : percent.format(mdd)) + "."
      : "적립 조건과 별도로 사용할 수 있는 최신 일봉 종가를 표시합니다.";

    const rows = assets.map(asset => {
      const stats = summarize(asset);
      const row = body.insertRow();
      const title = document.createElement("th");
      title.scope = "row";
      title.textContent = asset.label || asset.symbol;
      if (asset.label && asset.label !== asset.symbol) addLine(title, asset.symbol);
      row.append(title);
      const quote = row.insertCell(), position = row.insertCell(), valuation = row.insertCell(), risk = row.insertCell();
      const unit = asset.symbol.startsWith("^") ? "pt" : asset.currency || "통화 미기재";
      const price = value => number.format(value) + " " + unit;
      quote.textContent = stats ? price(stats.current.price) : "확정 종가 자료 없음";
      if (stats) addLine(quote, stats.current.date + " · " + (crypto(asset) ? "UTC 일봉" : "현지 거래일"));
      const source = document.createElement("a");
      source.textContent = "Yahoo Finance";
      source.href = "https://finance.yahoo.com/quote/" + encodeURIComponent(asset.symbol) + "/history/";
      source.target = "_blank";
      source.rel = "noopener noreferrer";
      const provenance = document.createElement("small");
      provenance.append(source, asset.source ? " · 검색 시세" : " · 저장 시세");
      quote.append(provenance);
      if (Number.isFinite(Date.parse(asset.fetchedAt))) addLine(quote, "수집 " + collectedAt.format(new Date(asset.fetchedAt)) + " KST");

      const match = stats?.comparison;
      position.textContent = match ? match.date + " · " + price(match.price) : "비교 이력 부족";
      if (match) addLine(position, (stats.withinBand ? "±1% 내 최근" : "±1% 밖 최인접") + " · 현재 대비 " + percent.format(match.gap));
      if (stats) addLine(position, "시세 이력 " + stats.first + "부터");
      const gapLabel = value => value == null ? "이력 부족" : percent.format(value);
      addLine(position, "200일선 " + gapLabel(stats?.dailyGap));
      addLine(position, "60주선 " + gapLabel(stats?.weeklyGap));
      valuation.textContent = stats ? "배수 자료 확인 중…" : "자료 없음";
      risk.textContent = stats?.peakGap != null ? "고점 대비 " + percent.format(stats.peakGap) : "낙폭 이력 부족";
      if (stats?.maxDrawdown != null) {
        addLine(risk, "최대 낙폭 " + percent.format(stats.maxDrawdown));
        addLine(risk, stats.riskStart + " ~ " + stats.current.date);
      }
      risk.append(drawdownLink(asset.symbol));
      return {asset, stats, valuation};
    });
    panel.hidden = false;

    if (rows.some(row => row.stats)) loadValuations().then(({references, automatic}) => {
      for (const {asset, stats, valuation} of rows) {
        if (!stats) continue;
        const candidates = [references?.[asset.symbol], automatic?.find(item => item.symbol === asset.symbol)];
        const snapshot = candidates.find(item => item?.asOf && item.asOf <= stats.current.date &&
          item.status !== "unavailable" && ValuationModel.positive(item.referencePrice) &&
          (ValuationModel.positive(item.per) || ValuationModel.positive(item.pbr)));
        const {per, pbr} = ValuationModel.evaluate(snapshot, stats.current.price);
        const multiple = value => value == null ? "자료 없음" : number.format(value) + "배";
        valuation.textContent = snapshot ? "PER " + multiple(per) : "제공 배수 없음";
        if (!snapshot) continue;
        addLine(valuation, "PBR " + multiple(pbr));
        addLine(valuation, snapshot.asOf + " · " + (snapshot.source || "출처 미기재"));
        if (snapshot.estimated || snapshot.status === "stale") {
          addLine(valuation, [snapshot.estimated && "출처 추정치", snapshot.status === "stale" && "이전 자료"].filter(Boolean).join(" · "));
        }
      }
    });
  }

  root.PriceSummary = {render, confirmedRows};
})(typeof window !== "undefined" ? window : globalThis);
