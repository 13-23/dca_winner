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

  function comparisonAge(current, match) {
    const end = new Date(current.time), start = new Date(match.time);
    const monthEnd = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
    const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() -
      start.getUTCMonth() - Number(end.getUTCDate() < Math.min(start.getUTCDate(), monthEnd));
    if (months < 1) return (current.time - match.time) / day + "일 전";
    return "약 " + [Math.floor(months / 12) || null, months % 12 || null]
      .map((value, index) => value ? value + (index ? "개월" : "년") : "")
      .filter(Boolean).join(" ") + " 전";
  }

  function quoteStatus(asset) {
    const update = asset.quoteUpdate;
    if (!update) return asset.source ? "검색 시세 수집" : "저장 시세 · 최근 갱신 결과 미기록";
    const captured = Date.parse(asset.fetchedAt), attempted = Date.parse(update.attemptedAt);
    if (update.status === "retained" && Number.isFinite(attempted) && !(captured > attempted)) {
      return "갱신 실패 · 이전 시세 유지";
    }
    if (asset.fetchedAt && asset.fetchedAt === update.fetchedAt) {
      if (update.status === "unchanged") return "수집 성공 · 확정 종가 날짜 유지";
      if (update.status === "collected") return "수집 성공";
    }
    return "저장 시세 · 파일의 개별 갱신 결과 미기록";
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {summarize, comparisonAge, quoteStatus};
    return;
  }

  const number = new Intl.NumberFormat("ko-KR", {maximumFractionDigits: 4});
  const percent = new Intl.NumberFormat("ko-KR", {style: "percent", maximumFractionDigits: 2, signDisplay: "exceptZero"});
  const collectedAt = new Intl.DateTimeFormat("ko-KR", {dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul"});
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

  function analysisButton(tab, symbol, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn price-drawdown";
    button.textContent = label;
    button.addEventListener("click", () => window.dispatchEvent(new CustomEvent("pricesummaryopen", {detail: {tab, symbol}})));
    return button;
  }

  function render(panel, assets, {portfolio = false, mdd = null} = {}) {
    panel.hidden = true;
    const body = panel.querySelector("tbody");
    body?.replaceChildren();
    if (!assets.length) return;

    if (portfolio) {
      panel.querySelector("[data-price-context]").textContent =
        "구성 종목별 최신 종가이며 적립 계산 종료일과 다를 수 있습니다. 계산 기간의 혼합 MDD(입금 효과 제외) " +
        (mdd == null ? "자료 없음" : percent.format(mdd)) + ".";
    }

    const rows = assets.map(asset => {
      const stats = summarize(asset);
      if (!body) panel.querySelector("h2").textContent = asset.label || asset.name || asset.symbol;
      let quote, position, valuation, risk;
      if (body) {
        const row = body.insertRow();
        const title = document.createElement("th");
        title.scope = "row";
        title.textContent = asset.label || asset.symbol;
        if (asset.label && asset.label !== asset.symbol) addLine(title, asset.symbol);
        row.append(title);
        [quote, position, valuation, risk] = Array.from({length: 4}, () => row.insertCell());
      } else {
        [quote, position, valuation, risk] = ["quote", "position", "valuation", "risk"]
          .map(key => panel.querySelector("[data-overview-" + key + "]"));
        const ma = panel.querySelector("[data-overview-ma]"), value = panel.querySelector("[data-overview-value-link]");
        ma.replaceChildren();
        value.replaceChildren();
        if (Object.hasOwn(drawdownMarkets, asset.symbol)) {
          ma.append(analysisButton("ma", asset.symbol, "이평선 차트"));
          value.append(analysisButton("value", asset.symbol, "지수 PER·PBR 상세"));
        }
      }
      const unit = asset.symbol.startsWith("^") ? "pt" : asset.currency || "통화 미기재";
      const price = value => number.format(value) + " " + unit;
      quote.textContent = stats ? price(stats.current.price) : "확정 종가 자료 없음";
      let quoteDetails = quote;
      if (!body) {
        const headline = document.createElement("strong");
        headline.textContent = quote.textContent;
        quote.replaceChildren(headline);
        if (stats) {
          const date = document.createElement("span");
          date.className = "overview-date";
          date.textContent = stats.current.date + " 확정 종가";
          quote.append(date);
        }
        const disclosure = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = "시세 출처와 기준";
        disclosure.append(summary);
        quote.append(disclosure);
        quoteDetails = disclosure;
      }
      if (stats) addLine(quoteDetails, stats.current.date + " · " + (crypto(asset) ? "UTC 일봉 종가" : "현지 일봉 종가") + " · " + (asset.currency || "통화 미기재"));
      const source = document.createElement("a");
      const supplemental = asset.supplementalSources || {};
      const naver = stats && supplemental[stats.current.date] === "네이버 금융";
      source.textContent = naver ? "네이버 금융" : "Yahoo Finance";
      source.href = naver ? "https://finance.naver.com/sise/sise_index.naver?code=" +
        (asset.symbol === "^KS11" ? "KOSPI" : "KOSDAQ") :
        "https://finance.yahoo.com/quote/" + encodeURIComponent(asset.symbol) + "/history/";
      source.target = "_blank";
      source.rel = "noopener noreferrer";
      const provenance = document.createElement("small");
      const status = quoteStatus(asset);
      provenance.append(source, " · " + status);
      quoteDetails.append(provenance);
      if (!body && status.startsWith("갱신 실패")) {
        const warning = document.createElement("span");
        warning.className = "overview-date warn";
        warning.textContent = status;
        quote.insertBefore(warning, quoteDetails);
      }
      if (Number.isFinite(Date.parse(asset.fetchedAt))) addLine(quoteDetails, "수집 " + collectedAt.format(new Date(asset.fetchedAt)) + " KST");

      if (asset.quoteUpdate?.status === "retained" && status.startsWith("갱신 실패") &&
          Number.isFinite(Date.parse(asset.quoteUpdate.attemptedAt))) {
        addLine(quoteDetails, "갱신 시도 " + collectedAt.format(new Date(asset.quoteUpdate.attemptedAt)) + " KST");
      }
      if (stats) addLine(quoteDetails, "이력 시작 " + stats.first);
      if (Object.keys(supplemental).length) addLine(quoteDetails, "이력 출처 · Yahoo Finance, 누락일 네이버 금융 보완");

      const match = stats?.comparison;
      position.textContent = match ? match.date + " · " + price(match.price) : "비교 이력 부족";
      if (match) {
        const age = comparisonAge(stats.current, match) + (stats.withinBand ? " 가격대" : " 비교 종가");
        if (body) addLine(position, age);
        else {
          const headline = document.createElement("strong");
          headline.textContent = age;
          position.replaceChildren(headline);
          addLine(position, match.date + " · " + price(match.price));
        }
        addLine(position, (stats.withinBand ? "±1% 내 최근" : "±1% 밖 최인접") + " · 현재 대비 " + percent.format(match.gap));
      }
      const gapLabel = value => value == null ? "이력 부족" : percent.format(value);
      addLine(position, "200일선 " + gapLabel(stats?.dailyGap));
      addLine(position, "60주선 " + gapLabel(stats?.weeklyGap));
      valuation.textContent = stats ? "배수 자료 확인 중…" : "자료 없음";
      risk.textContent = stats?.peakGap != null ? "최근 1년 고점 대비 " + percent.format(stats.peakGap) : "낙폭 이력 부족";
      if (!body && stats?.peakGap != null) {
        const headline = document.createElement("strong");
        headline.textContent = percent.format(stats.peakGap);
        risk.replaceChildren(headline);
        addLine(risk, "최근 1년 고점 대비");
      }
      if (stats?.maxDrawdown != null) {
        addLine(risk, "최대 낙폭 " + percent.format(stats.maxDrawdown));
        addLine(risk, stats.riskStart + " ~ " + stats.current.date);
      }
      risk.append(drawdownLink(asset.symbol));
      return {asset, stats, valuation};
    });
    panel.hidden = false;

    if (rows.some(row => row.stats)) ValuationModel.loadArchive().then(({references, automatic}) => {
      for (const {asset, stats, valuation} of rows) {
        if (!stats) continue;
        const snapshot = ValuationModel.publishedSnapshot(references, automatic?.find(item => item.symbol === asset.symbol), asset.symbol);
        const {per, pbr} = snapshot || {};
        const multiple = value => !ValuationModel.positive(value) ? "자료 없음" : number.format(value) + "배";
        valuation.textContent = snapshot ? "출처 PER " + multiple(per) : "제공 배수 없음";
        if (!snapshot) continue;
        if (body) addLine(valuation, "PBR " + multiple(pbr));
        else {
          const headline = document.createElement("strong");
          const concise = new Intl.NumberFormat("ko-KR", {maximumFractionDigits: 2});
          const show = value => !ValuationModel.positive(value) ? "—" : concise.format(value) + "배";
          headline.textContent = "출처 PER " + show(per);
          valuation.replaceChildren(headline);
          addLine(valuation, "PBR " + show(pbr));
        }
        addLine(valuation, snapshot.asOf + (snapshot.dateBasis ? " " + snapshot.dateBasis : "") + " · " + (snapshot.source || "출처 미기재"));
        addLine(valuation, snapshot.perAverages ? "같은 출처 PER 5년 " + number.format(snapshot.perAverages[5]) +
          "배 · 10년 " + number.format(snapshot.perAverages[10]) + "배" : "과거 배수 비교 자료 없음");
        if (snapshot.estimated || snapshot.status === "stale") {
          addLine(valuation, [snapshot.estimated && "출처 추정치", snapshot.status === "stale" && "이전 자료"].filter(Boolean).join(" · "));
        }
      }
    });
  }

  root.PriceSummary = {render, confirmedRows};
})(typeof window !== "undefined" ? window : globalThis);
