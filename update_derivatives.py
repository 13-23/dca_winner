#!/usr/bin/env python3
"""Collect weekly CFTC index-futures positioning and open interest."""
import datetime as dt
import json
import math
import pathlib
import urllib.parse
import urllib.request

API = "https://publicreporting.cftc.gov/resource/gpe5-46if.json"
COMBINED_API = "https://publicreporting.cftc.gov/resource/yw9f-hn96.json"
SOURCE = "CFTC Traders in Financial Futures · futures only"
COMBINED_SOURCE = "CFTC Traders in Financial Futures · futures-and-options combined"
SOURCE_URL = "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"
MARKETS = {
    "sp500": "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE",
    "nasdaq100": "NASDAQ-100 Consolidated - CHICAGO MERCANTILE EXCHANGE",
}


def fetch(url):
    request = urllib.request.Request(url, headers={
        "User-Agent": "DCA Winner research contact github.com/13-23/dca_winner",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(request, timeout=20) as response:
        return response.read()


def finite_int(row, key):
    value = float(row[key])
    if not math.isfinite(value) or value < 0 or not value.is_integer():
        raise ValueError("Invalid CFTC contract count: " + key)
    return int(value)


def parse_rows(rows, market, expected_type="FutOnly"):
    rows = sorted(rows, key=lambda row: row["report_date_as_yyyy_mm_dd"])
    if len(rows) < 2:
        raise ValueError("CFTC series needs two weekly observations")
    current, previous = rows[-1], rows[-2]
    current_date = dt.date.fromisoformat(current["report_date_as_yyyy_mm_dd"][:10])
    previous_date = dt.date.fromisoformat(previous["report_date_as_yyyy_mm_dd"][:10])
    if not 5 <= (current_date - previous_date).days <= 10:
        raise ValueError("CFTC observations are not consecutive weekly reports")
    if current.get("futonly_or_combined") != expected_type:
        raise ValueError("Unexpected CFTC report scope")

    interest = finite_int(current, "open_interest_all")
    prior_interest = finite_int(previous, "open_interest_all")
    long = finite_int(current, "lev_money_positions_long")
    short = finite_int(current, "lev_money_positions_short")
    previous_net = finite_int(previous, "lev_money_positions_long") - finite_int(previous, "lev_money_positions_short")
    net = long - short
    return {
        "id": market,
        "label": "S&P 500 E-mini 선물" if market == "sp500" else "나스닥100 선물",
        "reportType": "CFTC Leveraged Funds · " + ("선물 전용" if expected_type == "FutOnly" else "선물·옵션 합산"),
        "asOf": current_date.isoformat(),
        "previousAsOf": previous_date.isoformat(),
        "openInterest": interest,
        "openInterestChange": interest - prior_interest,
        "leveragedFundsLong": long,
        "leveragedFundsShort": short,
        "net": net,
        "netPercentOpenInterest": 100 * net / interest if interest else None,
        "netChange": net - previous_net,
        "status": "순매수 우위" if net > 0 else "순매도 우위" if net < 0 else "순포지션 균형",
        "source": SOURCE if expected_type == "FutOnly" else COMBINED_SOURCE,
        "url": SOURCE_URL,
    }


def collect(fetcher=fetch, now=None, old=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    old = old or {}
    output = {"updated": now.isoformat(), "source": SOURCE, "url": SOURCE_URL, "items": []}
    for key, market in MARKETS.items():
        params = urllib.parse.urlencode({
            "$limit": "4",
            "$where": "market_and_exchange_names='" + market + "'",
            "$order": "report_date_as_yyyy_mm_dd DESC",
        })
        item = dict(old.get(key) or {"id": key, "status": "unavailable"})
        try:
            rows = json.loads(fetcher(API + "?" + params))
            latest = parse_rows(rows, key)
            age = (now.date() - dt.date.fromisoformat(latest["asOf"])).days
            item = {**item, "futuresOnly": latest,
                    "status": "stale" if age > 14 else "available", "fetchedAt": now.isoformat()}
        except Exception as error:
            print("CFTC futures series unavailable:", key, type(error).__name__)
            item["status"] = "retained" if item.get("futuresOnly") else "unavailable"
        try:
            rows = json.loads(fetcher(COMBINED_API + "?" + params))
            combined = parse_rows(rows, key, "Combined")
            age = (now.date() - dt.date.fromisoformat(combined["asOf"])).days
            item["combined"] = combined
            item["combinedStatus"] = "stale" if age > 14 else "available"
        except Exception as error:
            print("CFTC combined series unavailable:", key, type(error).__name__)
            item["combinedStatus"] = "retained" if item.get("combined") else "unavailable"
        output["items"].append(item)
    return output


def update(path=pathlib.Path("data/derivatives.json"), fetcher=fetch, now=None):
    try:
        old = {item["id"]: item for item in json.loads(path.read_text(encoding="utf-8")).get("items", [])}
    except (OSError, ValueError, TypeError):
        old = {}
    result = collect(fetcher, now, old)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(path)
    return result


if __name__ == "__main__":
    update()
