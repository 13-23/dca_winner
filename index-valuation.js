(function () {
  "use strict";
  const $ = id => document.getElementById("iv-" + id);
  const tab = document.getElementById("tab-value");
  const model = window.ValuationModel;
  const storageKey = "index-valuation-v1";
  const number = new Intl.NumberFormat("ko-KR", {maximumFractionDigits: 2});
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  let manual = {}, days = [], automatic = null, request = 0, loaded = false;
  let references = {}, warning = "";

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
    return manual[manualKey()] || model.publishedSnapshot(references, automatic, symbol, basis);
  }

  function draw(series, bands, from) {
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
    const start = series.findIndex(row => row[0] >= from);
    const overlay = start < 0 ? "" : bands.map(line => {
      const per = line.type === "PER";
      const color = per ? "var(--ma5)" : "var(--ma200)";
      const title = "<title>" + line.type + " " + number.format(line.multiple) + "배 · " + number.format(line.price) + "</title>";
      return start === series.length - 1
        ? `<circle cx="${x(start)}" cy="${y(line.price)}" r="4" fill="${color}">${title}</circle>`
        : `<line x1="${x(start)}" x2="${x(series.length-1)}" y1="${y(line.price)}" y2="${y(line.price)}" stroke="${color}" stroke-dasharray="${per ? "8 4" : "2 4"}">${title}</line>`;
    }).join("");
    box.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="지수 종가와 PER·PBR 환산 가격선 차트">${guides}${overlay}<polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="2"/><text x="${left}" y="${height - 8}">${series[0][0]}</text><text x="${right}" y="${height - 8}" text-anchor="end">${series.at(-1)[0]}</text></svg>`;
  }

  function render() {
    const last = days.at(-1), base = snapshot();
    const prefix = $("basis").value === "forward" ? "선행 " : "";
    const manualInput = !!manual[manualKey()];
    const eligibility = model.assess(base, days, manualInput);
    const metrics = [["최근 종가", last?.[1], ""]];
    const label = manualInput ? "입력값" : "출처값";
    metrics.push([prefix + "PER · " + label, base?.per, "배"], [prefix + "PBR · " + label, base?.pbr, "배"]);
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
      ? (base.status === "stale" ? "이전 자료 · " : "") + base.asOf + (base.dateBasis ? " " + base.dateBasis : "") + " · " + base.source + (base.basis ? " · " + base.basis : "")
      : "지수 배수 자료 없음. 기준값을 입력하면 가격선을 표시합니다.";
    $("status").textContent = warning || priceNote + sourceNote;
    const provenance = [];
    if (base) {
      if (model.positive(base.referencePrice)) provenance.push("출처 기준 지수 " + number.format(base.referencePrice) + " pt");
      if (base.bookValueAsOf) provenance.push("장부가 기준 " + base.bookValueAsOf);
      if (eligibility.anchor) provenance.push("같은 날 차트 종가 " + number.format(eligibility.anchor) + " pt");
      if (base.perAverages) provenance.push("같은 출처 PER 평균 · 5년 " + number.format(base.perAverages[5]) + "배 · 10년 " + number.format(base.perAverages[10]) + "배");
    }
    $("provenance").textContent = provenance.join(" · ");
    $("provenance").hidden = !provenance.length;
    $("scenario-note").textContent = eligibility.reason
      ? model.reasons[eligibility.reason]
      : "직접 입력한 배수만 " + eligibility.from + "부터 표시합니다. 이익·장부가가 달라지면 같은 배수의 환산 가격도 바뀝니다.";

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
      if (eligibility.reason || !$(type + "-on").checked || !model.positive(base?.[type])) continue;
      try {
        const input = $(type + "-levels").value.trim();
        if (!input) continue;
        const levels = model.multiples(input);
        bands.push(...model.bands(base, last?.[1], type === "per" ? levels : [], type === "pbr" ? levels : []));
      } catch (error) { errors.push(type.toUpperCase() + " · " + error.message); }
    }
    bands = bands.filter(line => model.positive(line.price));
    $("band-error").textContent = errors.join(" ");
    $("band-error").hidden = !errors.length;
    const rows = bands.length ? bands.map(line => {
      const delta = (line.price / last[1] - 1) * 100;
      return [prefix + line.type + " " + number.format(line.multiple) + "배", number.format(line.price),
        (delta > 0 ? "+" : "") + number.format(delta) + "%", number.format(line.price * (line.type === "PER" ? .8 : .9))];
    }) : [["표시할 가격선 없음", "—", "—", "—"]];
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
    draw(days.filter(row => Date.parse(row[0]) >= cutoff.getTime()), bands, eligibility.from);
  }

  function fillForm() {
    const candidate = snapshot();
    const base = model.assess(candidate, days, !!manual[manualKey()]).reason ? null : candidate;
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
    const [prices, archive] = await Promise.allSettled([window.API.getChart(symbol), model.loadArchive()]);
    if (current !== request) return;
    days = prices.status === "fulfilled" ? PriceSummary.confirmedRows(prices.value).map(({date,price}) => [date,price]) : [];
    automatic = archive.value?.automatic?.find(item => item.symbol === symbol);
    references = archive.value?.references || {};
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
    const entry = {asOf, source, referencePrice, per: model.positive(per) ? per : null, pbr: model.positive(pbr) ? pbr : null, basis: "직접 입력"};
    const assessment = model.assess(entry, days, true);
    if (assessment.reason) { $("input-status").textContent = model.reasons[assessment.reason]; return; }
    manual[manualKey()] = entry;
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
  window.addEventListener("indexvaluationopen", event => {
    const index = $("index");
    if (event.detail && index.value !== event.detail) {
      index.value = event.detail;
      load();
    } else if (!loaded) load();
  });
  if (!tab.hidden) load();
})();
