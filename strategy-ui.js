(function () {
  "use strict";
  const inputs = new WeakMap();
  const number = new Intl.NumberFormat("ko-KR", {maximumFractionDigits: 2});
  const percent = new Intl.NumberFormat("ko-KR", {style: "percent", maximumFractionDigits: 2});
  const won = value => number.format(Math.round(value)) + "원";

  const axisNumber = new Intl.NumberFormat("ko-KR", {maximumFractionDigits: 1});
  const svgNS = "http://www.w3.org/2000/svg";
  const graphNode = (tag, values) => {
    const node = document.createElementNS(svgNS, tag);
    for (const [key, value] of Object.entries(values)) node.setAttribute(key, value);
    return node;
  };

  function drawTrend(figure, series) {
    const width = 720, height = 210, inset = 4;
    const peak = Math.max(1, ...series.immediate.map(row => row.value), ...series.reserve.map(row => row.value));
    const step = 10 ** Math.floor(Math.log10(peak));
    const ceiling = Math.ceil(peak / step * 2) * step / 2;
    const first = Date.parse(series.immediate[0].t), last = Date.parse(series.immediate.at(-1).t);
    const plot = figure.querySelector("[data-strategy-plot]");
    const scale = document.createElement("div");
    scale.className = "strategy-plot-scale";
    scale.setAttribute("aria-hidden", "true");
    const svg = graphNode("svg", {viewBox: "0 0 " + width + " " + height, preserveAspectRatio: "none",
      role: "img", "aria-label": "동일한 원화 축에서 즉시 적립과 현금 보유 후 추가 매수의 평가금액 추이 비교"});
    const y = amount => height - inset - amount / ceiling * (height - inset * 2);
    for (const amount of [ceiling, ceiling / 2, 0]) {
      const label = document.createElement("span");
      label.textContent = amount >= 100000000 ? axisNumber.format(amount / 100000000) + "억" :
        amount >= 10000 ? axisNumber.format(amount / 10000) + "만" : axisNumber.format(amount);
      scale.append(label);
      svg.append(graphNode("line", {x1: 0, x2: width, y1: y(amount), y2: y(amount), stroke: "var(--line)"}));
    }
    for (const [key, color, dash] of [["immediate", "var(--accent)", ""], ["reserve", "var(--muted)", "5 4"]]) {
      const points = series[key].map(row => {
        const x = inset + (Date.parse(row.t) - first) / (last - first || 1) * (width - inset * 2);
        return x.toFixed(2) + "," + y(row.value).toFixed(2);
      });
      if (points.length === 1) {
        const [cx, cy] = points[0].split(",");
        svg.append(graphNode("circle", {cx, cy, r: 3, fill: color}));
      } else {
        svg.append(graphNode("polyline", {points: points.join(" "), fill: "none", stroke: color,
          "stroke-width": 2, "stroke-dasharray": dash, "vector-effect": "non-scaling-stroke"}));
      }
    }
    plot.replaceChildren(scale, svg);
    figure.querySelector("[data-strategy-axis]").replaceChildren(...[series.immediate[0].t, series.immediate.at(-1).t].map(date => {
      const label = document.createElement("span");
      label.textContent = date;
      return label;
    }));
  }

  function render(panel) {
    if (!panel.open) return;
    const status = panel.querySelector("[data-strategy-status]");
    const table = panel.querySelector(".tablewrap");
    table.hidden = true;
    const differences = panel.querySelector("[data-strategy-differences]");
    differences.hidden = true;
    const trend = panel.querySelector("[data-strategy-trend]");
    trend.hidden = true;
    const input = inputs.get(panel);
    if (!input) {
      status.textContent = "종목과 환율을 불러온 뒤 비교할 수 있습니다.";
      return;
    }
    const value = name => panel.querySelector('[name="' + name + '"]').valueAsNumber;
    try {
      const options = input();
      const assets = options.assets.map(asset => ({
        ...asset,
        data: PriceSummary.confirmedRows(asset).map(({row}) =>
          Array.isArray(row) ? row : [row.t, row.c, row.a])
      }));
      const result = PortfolioEngine.compareMonthly({
        ...options, assets, includeSeries: true, amount: value("monthlyAmount"), monthday: value("monthlyDay"),
        share: value("reserveShare") / 100, threshold: value("dropThreshold") / 100
      });
      const {immediate, reserve} = result;
      const cells = [
        [won(immediate.value), won(reserve.value)],
        [percent.format(immediate.mdd), percent.format(reserve.mdd)],
        ...["below", "longest"].map(key => [number.format(immediate[key]) + "일", number.format(reserve[key]) + "일"]),
        [won(immediate.cash), won(reserve.cash)],
        [number.format(immediate.releases) + "회", number.format(reserve.releases) + "회"]
      ];
      table.querySelectorAll("tbody tr").forEach((row, i) => {
        row.cells[1].textContent = cells[i][0];
        row.cells[2].textContent = cells[i][1];
      });
      status.textContent = "평가 기간 " + result.start + " ~ " + result.end + " · 각각 " +
        result.contributions + "회 납입 · 총원금 " + won(result.invested);
      const difference = (value, unit, larger, smaller) => {
        const magnitude = Math.abs(value);
        return magnitude ? number.format(magnitude) + unit + " " + (value > 0 ? larger : smaller) : "표시 단위 기준 같음";
      };
      const rows = [
        ["현금 보유 전략의 최종 자산", difference(Math.round(reserve.value) - Math.round(immediate.value), "원", "더 큼", "더 작음")],
        ["최대 낙폭 크기", difference((Math.round(Math.abs(reserve.mdd) * 10000) - Math.round(Math.abs(immediate.mdd) * 10000)) / 100, "%p", "더 큼", "더 작음")],
        ["원금 미달 누적 기간", difference(reserve.below - immediate.below, "일", "더 긺", "더 짧음")]
      ];
      differences.replaceChildren(...rows.map(([label, value]) => {
        const item = document.createElement("div"), term = document.createElement("dt"), detail = document.createElement("dd");
        term.textContent = label;
        detail.textContent = value;
        item.append(term, detail);
        return item;
      }));
      drawTrend(trend, result.series);
      trend.hidden = false;
      differences.hidden = false;
      table.hidden = false;
    } catch (error) {
      status.textContent = error.message;
    }
  }

  window.StrategyUI = {
    update(panel, input) {
      if (!inputs.has(panel)) {
        panel.addEventListener("toggle", () => render(panel));
        panel.addEventListener("input", () => render(panel));
      }
      inputs.set(panel, input);
      render(panel);
    }
  };
})();
