(function () {
  "use strict";

  function quantile(sorted, fraction) {
    if (!sorted.length) return null;
    const index = (sorted.length - 1) * fraction;
    const lower = Math.floor(index), upper = Math.ceil(index);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  }

  function summarize(data) {
    const view = data.views["20"];
    const current = data.current;
    const level = view.levels.reduce((deepest, candidate) => {
      if (-current.drawdown + 1e-12 < candidate.level / 100) return deepest;
      return !deepest || candidate.level > deepest.level ? candidate : deepest;
    }, null);
    const active = level?.events.find(event => !event.recovery && event.peak === current.peakDate);
    const cases = (level?.forward.find(item => item.months === 3)?.events || [])
      .filter(event => event.signal !== active?.signal && Number.isFinite(event.additionalDecline))
      .slice().sort((a, b) => b.signal.localeCompare(a.signal));
    const declines = cases.map(event => event.additionalDecline).sort((a, b) => a - b);
    return {
      level, cases, median: quantile(declines, .5), p10: declines.length >= 10 ? quantile(declines, .1) : null,
      rarity: view.ranks.drawdown.percentile, periodStart: view.start
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {summarize};
    return;
  }

  const panel = document.getElementById("market-context-card");
  const query = name => panel.querySelector("[data-market-" + name + "]");
  const select = document.getElementById("market-context-case");
  const format = new Intl.NumberFormat("ko-KR", {maximumFractionDigits: 2});
  const percent = value => value == null ? "자료 없음" : format.format(value * 100) + "%";
  const sections = ["position", "value", "history", "actions", "cases", "method"];
  let request = 0, selected = null;

  function metrics(list, pairs) {
    list.replaceChildren(...pairs.map(([label, value]) => {
      const item = document.createElement("div"), term = document.createElement("dt"), detail = document.createElement("dd");
      term.textContent = label;
      detail.textContent = value;
      item.append(term, detail);
      return item;
    }));
  }

  async function show(symbol) {
    const mine = ++request;
    selected = null;
    panel.hidden = !DrawdownData.has(symbol);
    if (panel.hidden) return;
    sections.forEach(name => { query(name).hidden = true; });
    query("date").textContent = "";
    query("note").textContent = "시장 이력 확인 중…";
    try {
      const data = await DrawdownData.get(symbol);
      if (mine !== request) return;
      const {level, cases, median, p10, rarity, periodStart} = summarize(data);
      const current = data.current;
      selected = {data, level, cases};
      query("date").textContent = data.name + " · " + data.asOf + " 확정 종가";
      query("note").textContent = level ? "현재 낙폭이 도달한 비교 기준 −" + level.level + "% · " + periodStart + "부터" :
        "현재 낙폭은 첫 비교 기준인 −5%에 도달하지 않았습니다.";
      metrics(query("position"), [
        ["전체 이력 고점 대비", percent(current.drawdown)],
        ["이 정도 이상 빠졌던 과거 거래일", rarity == null ? "자료 없음" : format.format(rarity) + "%"],
        ["200일선 이격", percent(current.gap200)],
        ["60주선 이격", percent(current.gap60w)]
      ]);
      for (const name of ["position", "value", "actions", "method"]) query(name).hidden = false;
      if (!level) return;
      metrics(query("outcomes"), [
        ["추가 하락 중앙값", percent(median)],
        ["추가 하락 하위 10%", p10 == null ? "표본 부족" : percent(p10)],
        ["비교 사례", format.format(cases.length) + "건"]
      ]);
      query("recovery").textContent = "이전 고점 회복 중앙값 " +
        (level.duration.median == null ? "자료 없음" : format.format(level.duration.median) + "거래일") +
        " · 완료 " + level.duration.complete + "건 · 미회복 " + level.duration.ongoing + "건 (기간 내 최초 도달)";
      query("history").hidden = false;
      query("cases").hidden = !cases.length;
      select.replaceChildren(...cases.map((event, i) => new Option(event.entry + " ~ " + event.end +
        " · 추가 하락 " + percent(event.additionalDecline), String(i))));
    } catch (error) {
      if (mine !== request) return;
      query("note").textContent = "시장 이력을 불러오지 못했습니다. 종목을 다시 선택해 주세요.";
    }
  }

  query("detail").addEventListener("click", () => {
    if (!selected) return;
    window.dispatchEvent(new CustomEvent("drawdownselect", {detail: {
      symbol: selected.data.symbol, period: "20", level: selected.level?.level || 5
    }}));
  });
  query("apply").addEventListener("click", () => {
    const event = selected?.cases[Number(select.value)];
    if (!event) return;
    window.dispatchEvent(new CustomEvent("drawdowncalculator", {detail: {
      mode: "single", symbol: selected.data.symbol, name: selected.data.name,
      start: event.entry, end: event.end, strategy: true
    }}));
  });
  window.addEventListener("positionmarketcontext", event => show(event.detail.symbol));
  show(document.getElementById("preset").value);
})();
