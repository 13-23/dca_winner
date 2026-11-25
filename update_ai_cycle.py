"""Collect comparable public Treasury and NVIDIA observations."""
import csv
import datetime as dt
import io
import json
import math
import pathlib
import re
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser

FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10"
TREASURY = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month="
SEC = "https://data.sec.gov"
NEWSROOM = "https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-"
EDGAR = "https://www.sec.gov/Archives/edgar/data/1045810/"
UA = "DCA Winner financial research https://github.com/13-23/dca_winner"
REVENUE = ("RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "Revenues")
BALANCES = {"inventory": ("InventoryNet",), "receivables": ("AccountsReceivableNetCurrent",)}


def get(url):
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=20) as response:
        return response.read()


def yield_pair(observations, source, url):
    rows = sorted((day, value) for day, value in observations.items() if math.isfinite(value) and 0 <= value <= 30)
    latest, value = rows[-1]
    prior, previous = next(row for row in reversed(rows) if row[0] <= latest - dt.timedelta(days=7))
    return {"yield": {"current":value, "previous":previous, "date":latest.isoformat(),
                      "source": f"{source} · {prior.isoformat()} 비교", "url": url}}


def collect():
    today = dt.datetime.now(dt.timezone.utc).date()
    try:
        rows = {}
        months = {today.strftime("%Y%m"), (today.replace(day=1) - dt.timedelta(days=1)).strftime("%Y%m")}
        for month in sorted(months):
            root = ET.fromstring(get(TREASURY + month))
            for entry in root.findall(".//{*}properties"):
                date = entry.findtext("{*}NEW_DATE")
                value = entry.findtext("{*}BC_10YEAR")
                if date and value and date[:10] <= today.isoformat():
                    rows[dt.date.fromisoformat(date[:10])] = float(value)
        return yield_pair(rows, "미 재무부 Daily Treasury Par Yield", TREASURY + max(rows).strftime("%Y%m"))
    except Exception as error:
        print("Treasury feed:", error)
    rows = {}
    for row in csv.DictReader(io.StringIO(get(FRED).decode())):
        try:
            day = dt.date.fromisoformat(row.get("observation_date", row.get("DATE", "")))
            if day <= today:
                rows[day] = float(row["DGS10"])
        except (KeyError, ValueError, TypeError):
            continue
    return yield_pair(rows, "FRED DGS10", "https://fred.stlouisfed.org/series/DGS10")


def facts(cik):
    return json.loads(get(f"{SEC}/api/xbrl/companyfacts/CIK{cik:010d}.json"))["facts"]["us-gaap"]


def series(facts_data, tags, flow=False):
    out = {}
    for tag in tags:
        for row in facts_data.get(tag, {}).get("units", {}).get("USD", []):
            if row.get("form") not in ("10-K", "10-Q", "10-K/A", "10-Q/A"):
                continue
            day = dt.date.fromisoformat(row["end"])
            start = row.get("start")
            if flow:
                if not start or not 75 <= (day - dt.date.fromisoformat(start)).days <= 110:
                    continue
            elif start:
                continue
            if day not in out or row["filed"] > out[day]["filed"]:
                out[day] = row
    return {day: row["val"] for day, row in out.items()}


class Release(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.lines, self.text = [], []
        self.row = None
        self.cell = None
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.row = []
        if self.row is not None and tag in ("td", "th"):
            self.cell = []

    def handle_data(self, data):
        self.text.append(data)
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if self.cell is not None and tag in ("td", "th"):
            self.row.append(" ".join("".join(self.cell).split()))
            self.cell = None
        if tag == "tr" and self.row is not None:
            self.lines.append(self.row)
            self.row = None


def earnings_values(html):
    release = Release(html)
    match = re.search(r"(?:quarter|year) ended\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})",
                      " ".join(" ".join(release.text).split()), re.I)
    if not match:
        raise ValueError("Missing financial period in earnings release")
    period = dt.datetime.strptime(match[1], "%B %d, %Y").date()
    values = {}
    aliases = {"revenue":"revenue", "inventories":"inventory", "accounts receivable, net":"receivables"}
    for row in release.lines:
        cells = [cell for cell in row if cell]
        if not cells or cells[0].lower() not in aliases:
            continue
        metric = aliases[cells[0].lower()]
        numeric = [int(cell.replace(",", "")) for cell in cells[1:]
                   if re.fullmatch(r"(?:\d{1,3}(?:,\d{3})+|\d+)", cell)]
        if metric == "revenue" and not any(cell == "$" for cell in cells[1:]):
            continue
        if metric not in values and numeric:
            values[metric] = numeric[0] * 1_000_000
    if values.keys() != set(aliases.values()):
        raise ValueError("Missing financial values in earnings release")
    return period, values


def supplemental_quarter(last_period):
    recent = json.loads(get(SEC + "/submissions/CIK0001045810.json"))["filings"]["recent"]
    for i, form in enumerate(recent["form"]):
        if form != "8-K" or "2.02" not in recent["items"][i].split(","):
            continue
        filed = dt.date.fromisoformat(recent["filingDate"][i])
        if filed <= last_period:
            return None
        location = EDGAR + recent["accessionNumber"][i].replace("-", "") + "/"
        filing = get(location + recent["primaryDocument"][i]).decode("utf-8")
        exhibit = re.search(r'href="(q[1-4]fy\d+pr\.htm)"', filing, re.I)
        if not exhibit:
            continue
        url = location + exhibit[1]
        period, values = earnings_values(get(url).decode("utf-8"))
        if period > last_period:
            return period, values, url
        return None
    return None


def sec_quarters():
    company = facts(1045810)
    revenue = series(company, REVENUE, True)
    balances = {key: series(company, tags) for key, tags in BALANCES.items()}
    url = "https://data.sec.gov/api/xbrl/companyfacts/CIK0001045810.json"
    latest = max(set(revenue).intersection(*map(set, balances.values())))
    try:
        supplement = supplemental_quarter(latest)
        if supplement:
            period, values, url = supplement
            revenue[period] = values["revenue"]
            for key in balances:
                balances[key][period] = values[key]
    except Exception as error:
        raise RuntimeError("SEC 8-K supplemental release unavailable") from error
    return revenue, balances, "SEC NVIDIA", url


def newsroom_release(candidate):
    year, index = divmod(candidate, 4)
    suffix = ("fourth-quarter-and-fiscal", "first-quarter-fiscal",
              "second-quarter-fiscal", "third-quarter-fiscal")[index]
    url = f"{NEWSROOM}{suffix}-{year + bool(index)}"
    try:
        day, values = earnings_values(get(url).decode("utf-8"))
        expected = dt.date(year, 1 + 3 * index, 25)
        if abs((day - expected).days) <= 15:
            return day, values, url
    except (OSError, ValueError):
        return None
    return None


def newsroom_quarters():
    today = dt.datetime.now(dt.timezone.utc).date()
    quarter = today.year * 4 + (today.month - 1) // 3
    with ThreadPoolExecutor(max_workers=3) as pool:
        releases = list(filter(None, pool.map(newsroom_release, range(quarter, quarter - 7, -1))))
    if not releases:
        raise ValueError("No comparable NVIDIA Newsroom releases")
    revenue = {day: values["revenue"] for day, values, _ in releases}
    balances = {key: {day: values[key] for day, values, _ in releases} for key in BALANCES}
    return revenue, balances, "NVIDIA 공식 실적 발표", max(releases, key=lambda row: row[0])[2]


def nv():
    try:
        return growth_gaps(*sec_quarters())
    except Exception as error:
        print("SEC NVIDIA:", error)
    return growth_gaps(*newsroom_quarters())


def growth_gaps(revenue, balances, source, url):
    result = {}
    for key, balance in balances.items():
        dates = sorted(set(balance) & set(revenue))
        gaps = {}
        for day in dates:
            prior = next((previous for previous in reversed(dates) if 357 <= (day - previous).days <= 371), None)
            if prior is not None and min(balance[prior], revenue[prior]) > 0:
                gaps[day] = 100 * (balance[day] / balance[prior] - revenue[day] / revenue[prior])
        latest, previous = sorted(gaps)[-2:][::-1]
        if not 75 <= (latest - previous).days <= 110:
            raise ValueError("Latest two comparable quarters are not consecutive")
        result[key] = {"current":gaps[latest], "previous":gaps[previous], "date":latest.isoformat(),
                       "source":f"{source} · 전년 동기 대비 · 직전 분기 {previous.isoformat()} 비교", "url":url}
    return result


BIGTECH = (320193, 789019, 1652044, 1018724, 1326801)
CFO = ("NetCashProvidedByUsedInOperatingActivities",)
CAPEX = ("PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets")
CASH = ("CashAndCashEquivalentsAtCarryingValue",)
DEBT_CURRENT = ("LongTermDebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent")
DEBT_LONG = ("LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligationsNoncurrent")


def annual_series(company, tags):
    out = {}
    for tag in tags:
        for row in company.get(tag, {}).get("units", {}).get("USD", []):
            if row.get("form") not in ("10-K", "10-K/A") or not row.get("start"):
                continue
            end = dt.date.fromisoformat(row["end"])
            if not 350 <= (end - dt.date.fromisoformat(row["start"])).days <= 380:
                continue
            if end not in out or row["filed"] > out[end]["filed"]:
                out[end] = row
    return {day: row["val"] for day, row in out.items()}


def bigtech_fcf():
    # Sum each company's latest two completed fiscal years, not quarterly guidance.
    current = previous = 0
    periods = []
    errors = []
    for cik in BIGTECH:
        try:
            company = facts(cik)
            cfo, capex = annual_series(company, CFO), annual_series(company, CAPEX)
            common = sorted(set(cfo) & set(capex))
            if len(common) < 2:
                raise ValueError(f"Insufficient annual periods: CFO={len(cfo)}, CAPEX={len(capex)}, common={len(common)}")
            latest, prior = common[-2:][::-1]
            if not 350 <= (latest - prior).days <= 380:
                raise ValueError("Nonconsecutive fiscal years")
            current += cfo[latest] - capex[latest]
            previous += cfo[prior] - capex[prior]
            periods.append(latest)
        except Exception as error:
            errors.append(f"CIK {cik}: {type(error).__name__}: {error}")
    if errors:
        raise ValueError("; ".join(errors))
    return {"fcf": {"current": current / 1e9, "previous": previous / 1e9,
                    "date": min(periods).isoformat(),
                    "source": "SEC 10-K · AAPL/MSFT/GOOGL/AMZN/META · 최근 2개 회계연도 FCF 합계 · 가장 오래된 결산일 기준",
                    "url": "https://www.sec.gov/edgar/search/"}}


def update(path=pathlib.Path("data/ai-cycle.json")):
    path.parent.mkdir(exist_ok=True)
    old = json.loads(path.read_text()) if path.exists() else {}
    status = {}
    errors = {}
    for keys, collect_source in [(("yield",), collect), (tuple(BALANCES), nv), (("fcf",), bigtech_fcf)]:
        try:
            for key, item in collect_source().items():
                if key in old and item["date"] < old[key]["date"]:
                    status[key] = "retained"
                    continue
                old[key] = item
                status[key] = "ok"
        except Exception as error:
            for key in keys:
                status[key] = "retained" if key in old else "unavailable"
                errors[key] = f"{type(error).__name__}: {error}"
            print(keys, error)
    old.update(_status=status, _errors=errors, _attempted=dt.datetime.now(dt.timezone.utc).isoformat())
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(old, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(path)
    return old


if __name__ == "__main__":
    update()
