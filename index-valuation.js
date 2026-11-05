(function () {
  "use strict";
  const $ = id => document.getElementById("iv-" + id);
  const tab = document.getElementById("tab-value");
  const model = window.ValuationModel;
  const storageKey = "index-valuation-v1";
  const number = new Intl.NumberFormat("ko-KR", {maximumFractionDigits: 2});
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  let manual = {}, days = [], automatic = null, request = 0, loaded = false;
  let snapshotRequest, warning = "";

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && typeof saved === "object" && !Array.isArray(saved)) manual = saved;
  } catch {}

  function snapshot() {
    return manual[$("index").value] || automatic;
  }

  function draw(series, bands) {
    const box = $("chart");
    if (!series.length) { box.replaceChildren(); return; }
    const width = Math.max(280, box.clientWidth), height = 300;
    const left = 64, right = width - 14, top = 12, bottom = height - 32;
    const values = [...series.map(row => row[1]), ...bands.map(line => line.price)];
    const min = Math.min(...values), max = Math.max(...values);
    const pad = Math.max((max - min) * 0.06, max * 0.001);
    const low = Math.max(0, min - pad), high = max + pad;
    const y = value => bottom - (value - low) / (high - low) * (bottom - top);
    const x = index => left + index / Math.max(1, series.length - 1) * (right - left);
    const points = series.map((row, i) => x(i).toFixed(2) + "," + y(row[1]).toFixed(2)).join(" ");
    const guides = Array.from({length: 5}, (_, i) => {
      const value = low + (high - low) * i / 4;
      return `<line x1="${left}" x2="${right}" y1="${y(value)}" y2="${y(value)}" stroke="var(--line)"/><text x="${left - 6}" y="${y(value) + 4}" text-anchor="end">${number.format(Math.round(value))}</text>`;
    }).join("");
    const overlay = bands.map(line => {
      const per = line.type === "PER";
      return `<line x1="${left}" x2="${right}" y1="${y(line.price)}" y2="${y(line.price)}" stroke="${per ? "var(--ma5)" : "var(--ma200)"}" stroke-dasharray="${per ? "8 4" : "2 4"}"><title>${line.type} ${number.format(line.multiple)}배 · ${number.format(line.price)}</title></line>`;
    }).join("");
    box.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="지수 종가와 PER·PBR 환산 가격선 차트">${guides}${overlay}<polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="2"/><text x="${left}" y="${height - 8}">${series[0][0]}</text><text x="${right}" y="${height - 8}" text-anchor="end">${series.at(-1)[0]}</text></svg>`;
  }

  function render() {
    const last = days.at(-1), base = snapshot();
    const metrics = [["최근 종가", last?.[1], ""]];
    metrics.push(["기준 PER", base?.per, "배"], ["기준 PBR", base?.pbr, "배"]);
    $("metrics").replaceChildren(...metrics.map(([label, value, unit]) => {
      const cell = document.createElement("div");
      const title = document.createElement("span"), data = document.createElement("strong");
      title.textContent = label;
      data.textContent = model.positive(value) ? number.format(value) + unit : "자료 없음";
      cell.append(title, data);
      return cell;
    }));
    const priceNote = last ? "종가 " + last[0] + " · " : "";
    const sourceNote = base?.asOf && base?.source
      ? (base.status === "stale" ? "이전 자료 · " : "") + base.asOf + " · " + base.source + (base.basis ? " · " + base.basis : "")
      : "지수 배수 자료 없음. 기준값을 입력하면 가격선을 표시합니다.";
    $("status").textContent = warning || priceNote + sourceNote;
    let bands = [];
    const errors = [];
    for (const type of ["per", "pbr"]) {
      if (!$(type + "-on").checked || !model.positive(base?.[type])) continue;
      try {
        const input = $(type + "-levels").value.trim();
        const levels = input ? model.multiples(input) : [0.8, 1, 1.2].map(factor => base[type] * factor);
        bands.push(...model.bands(base, last?.[1], type === "per" ? levels : [], type === "pbr" ? levels : []));
      } catch (error) { errors.push(type.toUpperCase() + " · " + error.message); }
    }
    bands = bands.filter(line => model.positive(line.price));
    $("band-error").textContent = errors.join(" ");
    $("band-error").hidden = !errors.length;
    const rows = bands.length ? bands.map(line => [line.type + " " + number.format(line.multiple) + "배", number.format(line.price)]) : [["표시할 가격선 없음", "—"]];
    $("bands").replaceChildren(...rows.map(values => {
      const row = document.createElement("tr");
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    }));
    if (!last) { draw([], []); return; }
    const cutoff = new Date(last[0]);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - Number($("range").value));
    draw(days.filter(row => Date.parse(row[0]) >= cutoff.getTime()), bands);
  }

  function fillForm() {
    const base = snapshot();
    $("date").value = base?.asOf || days.at(-1)?.[0] || "";
    $("price").value = base?.referencePrice ?? days.at(-1)?.[1] ?? "";
    for (const field of ["per", "pbr", "source"]) $(field).value = base?.[field] ?? "";
  }

  async function load() {
    loaded = true;
    const symbol = $("index").value, current = ++request;
    days = [];
    automatic = null;
    warning = "지수 시세를 불러오는 중…";
    $("input-status").textContent = "";
    fillForm();
    render();
    $("form").querySelector("button[type=submit]").disabled = true;
    $("reset").disabled = true;
    snapshotRequest ||= fetch("data/valuations.json", {cache: "no-cache"}).then(response => {
      if (!response.ok) throw Error("지수 배수 자료를 불러오지 못했습니다.");
      return response.json();
    }).catch(() => {
      snapshotRequest = null;
      return null;
    });
    const [prices, snapshots] = await Promise.allSettled([window.API.getChart(symbol), snapshotRequest]);
    if (current !== request) return;
    days = prices.status === "fulfilled" ? prices.value.data.filter(row => datePattern.test(row[0]) && model.positive(row[1])) : [];
    automatic = snapshots.status === "fulfilled" ? snapshots.value?.items?.find(item => item.symbol === symbol && model.positive(item.referencePrice)) : null;
    warning = days.length ? "" : "지수 시세를 불러오지 못했습니다. 지수를 다시 선택해 주세요.";
    $("form").querySelector("button[type=submit]").disabled = false;
    $("reset").disabled = false;
    fillForm();
    render();
  }

  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(manual));
      return true;
    } catch { return false; }
  }

  $("form").addEventListener("submit", event => {
    event.preventDefault();
    const asOf = $("date").value, source = $("source").value.trim();
    const referencePrice = $("price").valueAsNumber;
    const per = $("per").valueAsNumber, pbr = $("pbr").valueAsNumber;
    if (!datePattern.test(asOf) || !source || !model.positive(referencePrice) || !(model.positive(per) || model.positive(pbr))) {
      $("input-status").textContent = "기준일, 출처, 양수인 기준 지수값과 PER 또는 PBR을 입력해 주세요.";
      return;
    }
    manual[$("index").value] = {asOf, source, referencePrice, per: model.positive(per) ? per : null, pbr: model.positive(pbr) ? pbr : null, basis: "직접 입력"};
    $("input-status").textContent = save() ? "이 지수의 기준값을 저장했습니다." : "이 화면에 적용했습니다. 브라우저에 저장하지 못했습니다.";
    render();
  });
  $("reset").addEventListener("click", () => {
    delete manual[$("index").value];
    $("input-status").textContent = save() ? "직접 입력값을 지웠습니다." : "이 화면에서 지웠습니다. 브라우저 저장값은 수정하지 못했습니다.";
    fillForm();
    render();
  });
  $("index").addEventListener("change", load);
  for (const field of ["range", "per-on", "pbr-on", "per-levels", "pbr-levels"]) $(field).addEventListener("input", render);
  new ResizeObserver(() => { if (loaded && !tab.hidden) render(); }).observe($("chart"));
  window.addEventListener("indexvaluationopen", () => { if (!loaded) load(); });
  if (!tab.hidden) load();
})();
