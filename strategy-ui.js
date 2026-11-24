(function () {
  "use strict";
  const inputs = new WeakMap();
  const number = new Intl.NumberFormat("ko-KR", {maximumFractionDigits: 2});
  const percent = new Intl.NumberFormat("ko-KR", {style: "percent", maximumFractionDigits: 2});
  const won = value => number.format(Math.round(value)) + "원";

  function render(panel) {
    if (!panel.open) return;
    const status = panel.querySelector("[data-strategy-status]");
    const table = panel.querySelector(".tablewrap");
    table.hidden = true;
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
        ...options, assets, amount: value("monthlyAmount"), monthday: value("monthlyDay"),
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
