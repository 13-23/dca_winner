(function () {
  "use strict";
  const $ = id => document.getElementById("iv-" + id);
  const tab = document.getElementById("tab-value");
  const model = window.ValuationModel;
  const storageKey = "index-valuation-v1";
  const number = new Intl.NumberFormat("ko-KR", {maximumFractionDigits: 2});
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  let manual = {}, days = [], automatic = null, request = 0, loaded = false;
  let snapshotRequest, referenceRequest, references = {}, warning = "";

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && typeof saved === "object" && !Array.isArray(saved)) manual = saved;
  } catch {}

  function manualKey() {
    const symbol = $("index").value;
    return $("basis").value === "forward" ? symbol + ":forward" : symbol;
  }

  function snapshot() {
    const symbol = $("index").value, basis = $("basis").value;
    return manual[manualKey()] || references[basis]?.[symbol] || (basis === "trailing" ? automatic : null);
  }

  function readJson(path) {
    return fetch(path, {cache: "no-cache"}).then(response => {
      if (!response.ok) throw Error("지수 배수 자료를 불러오지 못했습니다.");
      return response.json();
    });
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
    const prefix = $("basis").value === "forward" ? "선행 " : "";
    const normalized = model.evaluate(base, last?.[1]);
    const metrics = [["최근 종가", last?.[1], ""]];
    metrics.push([prefix + "PER · 최근 종가 환산", normalized.per, "배"], [prefix + "PBR · 최근 종가 환산", normalized.pbr, "배"]);
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
    const provenance = [];
    if (base) {
      provenance.push(manual[manualKey()] ? "직접 입력" : base.estimated ? "자동 수집 · 제공처 추정치" : "공개 기준 자료");
      provenance.push("출처 기준 지수값 " + number.format(base.referencePrice) + " · PER " + (model.positive(base.per) ? number.format(base.per) + "배" : "없음") + " · PBR " + (model.positive(base.pbr) ? number.format(base.pbr) + "배" : "없음"));
      if (base.bookValueAsOf) provenance.push("장부가 기준 " + base.bookValueAsOf);
      if (last && model.positive(base.referencePrice)) provenance.push("출처 기준값과 최근 종가 차이 " + number.format((last[1] / base.referencePrice - 1) * 100) + "% · 동일 EPS·BPS를 가정해 위 배수를 환산했습니다");
    }
    $("provenance").textContent = provenance.join(" · ");
    $("provenance").hidden = !base;
    $("scenario-note").textContent = "가격 시나리오: 빈 배수 칸은 출처 기준 배수의 80%·100%·120%입니다. 같은 기준 가격에서 환산하므로 기본 PER·PBR 선은 겹칩니다. 두 개의 독립적인 저평가 근거나 역사적 적정가 밴드가 아닙니다. 직접 배수를 입력해 가정을 바꿀 수 있습니다.";

    const sources = $("sources");
    sources.replaceChildren();
    for (const [label, address] of Object.entries(base?.sourceUrls || {})) {
      if (typeof address !== "string" || !address.startsWith("https://")) continue;
      if (sources.childNodes.length) sources.append(" · ");
      const link = document.createElement("a");
      link.href = address;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = label + " 원문";
      sources.append(link);
    }
    sources.hidden = !sources.childNodes.length;
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
    const rows = bands.length ? bands.map(line => [prefix + line.type + " " + number.format(line.multiple) + "배", number.format(line.price)]) : [["표시할 가격선 없음", "—"]];
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
    snapshotRequest ||= readJson("data/valuations.json").catch(() => {
      snapshotRequest = null;
      return null;
    });
    referenceRequest ||= readJson("data/valuation-references.json").catch(() => {
      referenceRequest = null;
      return null;
    });
    const [prices, snapshots, published] = await Promise.allSettled([window.API.getChart(symbol), snapshotRequest, referenceRequest]);
    if (current !== request) return;
    days = prices.status === "fulfilled" ? prices.value.data.filter(row => datePattern.test(row[0]) && model.positive(row[1])) : [];
    automatic = snapshots.status === "fulfilled" ? snapshots.value?.items?.find(item => item.symbol === symbol && model.positive(item.referencePrice)) : null;
    if (published.status === "fulfilled" && published.value) references = published.value;
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
    manual[manualKey()] = {asOf, source, referencePrice, per: model.positive(per) ? per : null, pbr: model.positive(pbr) ? pbr : null, basis: "직접 입력"};
    $("input-status").textContent = save() ? "이 지수의 기준값을 저장했습니다." : "이 화면에 적용했습니다. 브라우저에 저장하지 못했습니다.";
    render();
  });
  $("reset").addEventListener("click", () => {
    delete manual[manualKey()];
    $("input-status").textContent = save() ? "직접 입력값을 지웠습니다." : "이 화면에서 지웠습니다. 브라우저 저장값은 수정하지 못했습니다.";
    fillForm();
    render();
  });
  $("index").addEventListener("change", load);
  $("basis").addEventListener("change", () => {
    $("input-status").textContent = "";
    fillForm();
    render();
  });
  for (const field of ["range", "per-on", "pbr-on", "per-levels", "pbr-levels"]) $(field).addEventListener("input", render);
  new ResizeObserver(() => { if (loaded && !tab.hidden) render(); }).observe($("chart"));
  window.addEventListener("indexvaluationopen", () => { if (!loaded) load(); });
  if (!tab.hidden) load();
})();
