#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tickers.json에 있는 종목의 일별 시세를 야후 파이낸스에서 받아 data/ 폴더에 JSON으로 저장합니다.
GitHub Actions가 매일 자동으로 실행하고, 직접 실행해도 됩니다:  python update_data.py

- 표준 라이브러리만 사용 (추가 설치 없음)
- 해외 통화 종목이 있으면 원화 환율(KRW=X 등)도 자동으로 받습니다.
- 어떤 종목이 실패하면 예전 파일을 그대로 두고 다음 종목으로 넘어갑니다.
"""
import gzip, json, math, os, random, sys, time
import http.cookiejar
import xml.etree.ElementTree as ET
import urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
MOCK = os.environ.get("DCA_MOCK") == "1"   # 개발용 가짜 시세
KST = timezone(timedelta(hours=9))
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

_jar = http.cookiejar.CookieJar()
_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_jar))
_crumb = None


def file_name(symbol):
    """페이지(index.html)의 파일 이름 규칙과 같아야 합니다."""
    return "".join(c if c.isalnum() or c in ".-" else "_" for c in symbol) + ".json"


def _get(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9", "Accept-Encoding": "gzip"})
    with _opener.open(req, timeout=30) as r:
        data = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            data = gzip.decompress(data)
        return data


def _refresh_crumb():
    global _crumb
    try:
        _get("https://fc.yahoo.com")
    except Exception:
        pass
    try:
        _crumb = _get("https://query1.finance.yahoo.com/v1/test/getcrumb").decode().strip() or None
    except Exception:
        _crumb = None


def yahoo(path):
    last = None
    for attempt in range(3):
        for host in ("query1", "query2"):
            url = "https://%s.finance.yahoo.com%s" % (host, path)
            if _crumb:
                url += ("&" if "?" in url else "?") + "crumb=" + urllib.parse.quote(_crumb)
            try:
                return json.loads(_get(url).decode("utf-8"))
            except urllib.error.HTTPError as e:
                try:
                    j = json.loads(e.read().decode("utf-8", "replace"))
                    if j.get("chart", {}).get("error"):
                        return j
                except Exception:
                    pass
                last = "HTTP %s" % e.code
            except Exception as e:
                last = str(e)
        _refresh_crumb()
        time.sleep(3 * (attempt + 1))
    raise RuntimeError(last or "unknown error")


KR_INDEX_SYMBOLS = {"^KS11": "KOSPI", "^KQ11": "KOSDAQ"}
NAVER_CHART = "https://fchart.stock.naver.com/sise.nhn"
NAVER_SOURCE = "네이버 금융"


def supplement_kr_index(asset, captured, cached=None):
    code = KR_INDEX_SYMBOLS.get(asset["symbol"])
    if not code:
        return asset
    cutoff = (captured.astimezone(KST) - timedelta(hours=17)).date().isoformat()
    quotes = {row[0]: row for row in asset["data"]}
    sources = {}
    cached = cached or {}
    for row in cached.get("data", []):
        if row[0] not in quotes and row[0] in cached.get("supplementalSources", {}):
            quotes[row[0]] = row
            sources[row[0]] = cached["supplementalSources"][row[0]]
    url = NAVER_CHART + "?" + urllib.parse.urlencode({"symbol":code,"timeframe":"day","count":60,"requestType":0})
    try:
        document = ET.fromstring(_get(url).decode("euc-kr"))
        chart = document.find("chartdata")
        if chart is None or chart.get("symbol") != code:
            raise ValueError("Unexpected Naver index")
        for item in chart.findall("item"):
            day, opening, high, low, close, volume = item.attrib["data"].split("|")
            day = datetime.strptime(day, "%Y%m%d").date().isoformat()
            if day > cutoff or day in quotes:
                continue
            o, h, l, c = map(float, [opening, high, low, close])
            if not (0 < l <= min(o,c) <= max(o,c) <= h < math.inf):
                raise ValueError("Invalid Naver index OHLC")
            quotes[day] = [day,c,c,o,h,l,int(volume)]
            sources[day] = NAVER_SOURCE
    except Exception as error:
        print("  WARN %-12s supplemental index feed: %s" % (asset["symbol"], error))
    return {**asset, "data": [quotes[day] for day in sorted(quotes)], "supplementalSources": sources}


def merge_recent_us(asset, recent):
    cutoff = (datetime.fromisoformat(asset["fetchedAt"]) - timedelta(hours=22)).date().isoformat()
    rows = {row[0]: row for row in asset["data"]}
    overlap = next((row for row in reversed(recent["data"]) if row[0] <= cutoff and row[0] in rows), None)
    if not overlap or any(abs(overlap[i] / rows[overlap[0]][i] - 1) > .005 for i in (1, 2)):
        return asset
    additions = [row for row in recent["data"] if overlap[0] < row[0] <= cutoff and row[0] not in rows]
    if not additions:
        return asset
    rows.update((row[0], row) for row in additions)
    end = {row[0] for row in additions}
    return {**asset, "data": [rows[day] for day in sorted(rows)],
            "ohlcEstimatedDates": sorted(set(asset["ohlcEstimatedDates"]) |
                                         (set(recent["ohlcEstimatedDates"]) & end))}


def supplement_us(asset):
    captured = datetime.fromisoformat(asset["fetchedAt"])
    expected = (captured - timedelta(hours=22)).date()
    while expected.weekday() >= 5:
        expected -= timedelta(days=1)
    latest = confirmed_date(asset)
    if not latest or latest >= expected.isoformat():
        return asset
    try:
        return merge_recent_us(asset, fetch(asset["symbol"], recent=True))
    except Exception as error:
        print("  WARN %-12s short-range Yahoo feed: %s" % (asset["symbol"], error))
        return asset


def fetch(symbol, recent=False):
    if MOCK:
        return mock(symbol)
    now = int(time.time()) + 86400
    path = "/v8/finance/chart/" + urllib.parse.quote(symbol, safe="")
    if recent:
        j = json.loads(_get("https://query1.finance.yahoo.com" + path +
                           "?range=5d&interval=1d&includeAdjustedClose=true"))
    else:
        j = yahoo(path + ("?period1=0&period2=%d&interval=1d&events=div%%2Csplits&includeAdjustedClose=true" % now))
    c = j.get("chart") or {}
    if c.get("error"):
        raise RuntimeError(c["error"].get("description") or c["error"].get("code") or "chart error")
    res = (c.get("result") or [None])[0]
    if not res or not res.get("timestamp"):
        raise RuntimeError("no data")
    meta = res.get("meta", {})
    off = int(meta.get("gmtoffset") or 0)
    ts = res["timestamp"]
    q = (res.get("indicators", {}).get("quote") or [{}])[0]
    close = q.get("close") or []
    opn, high, low, vol = (q.get(k) or [] for k in ("open", "high", "low", "volume"))
    adj = ((res.get("indicators", {}).get("adjclose") or [{}])[0] or {}).get("adjclose") or [None] * len(ts)
    pick = lambda a, i: a[i] if i < len(a) and a[i] is not None and a[i] > 0 else None
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    rows = {}
    estimated_ohlc_dates = []
    for i, t in enumerate(ts):
        cl = pick(close, i)
        if cl is None:
            continue
        o = pick(opn, i) or cl
        h = max(pick(high, i) or cl, o, cl)
        l = min(pick(low, i) or cl, o, cl)
        a = pick(adj, i) or cl
        v = vol[i] if i < len(vol) and vol[i] else 0
        d = (epoch + timedelta(seconds=t + off)).strftime("%Y-%m-%d")
        if (pick(opn, i) is None or pick(high, i) is None or pick(low, i) is None or
                pick(high, i) < max(o, cl) or pick(low, i) > min(o, cl)):
            estimated_ohlc_dates.append(d)
        # [날짜, 종가, 수정종가, 시가, 고가, 저가, 거래량]
        rows[d] = [d, round(cl, 4), round(a, 4), round(o, 4), round(h, 4), round(l, 4), int(v)]
    data = [rows[k] for k in sorted(rows)]
    if symbol in {"BTC-KRW", "BTC-USD", "ETH-KRW", "ETH-USD"}:
        # Crypto trades every day; the provider's UTC candle closes at next midnight.
        today = datetime.now(timezone.utc).date().isoformat()
        data = [row for row in data if row[0] < today]
    if len(data) < 2:
        raise RuntimeError("too few rows")
    captured = datetime.now(timezone.utc)
    asset = {
        "symbol": symbol,
        "name": meta.get("longName") or meta.get("shortName") or symbol,
        "currency": (meta.get("currency") or "USD").upper(),
        "exchange": meta.get("fullExchangeName") or meta.get("exchangeName") or "",
        "fetchedAt": captured.isoformat(),
        "ohlcEstimatedDates": sorted(set(estimated_ohlc_dates)),
        "data": data,
    }
    if recent:
        return asset
    if symbol in KR_INDEX_SYMBOLS:
        try:
            with open(os.path.join(DATA,file_name(symbol)), encoding="utf-8") as f:
                cached = json.load(f)
        except (OSError, ValueError):
            cached = None
        return supplement_kr_index(asset, captured, cached)
    if asset["currency"] == "USD" and not symbol.endswith(("-USD", "=X")):
        return supplement_us(asset)
    return asset


def mock(symbol):
    rnd = random.Random(symbol)
    cur = "KRW" if symbol.endswith((".KS", ".KQ", "-KRW")) or symbol in ("^KS11", "^KQ11", "KRW=X") or symbol.endswith("KRW=X") else "USD"
    p = 1200.0 if symbol == "KRW=X" else (2000.0 if cur == "KRW" else 100.0)
    d, end, data = datetime(2005, 1, 3), datetime(2026, 10, 23), []
    while d <= end:
        if d.weekday() < 5:
            o = p * math.exp(0.003 * rnd.gauss(0, 1))
            p *= math.exp(0.0002 + 0.012 * rnd.gauss(0, 1))
            h = max(o, p) * (1 + abs(0.006 * rnd.gauss(0, 1)))
            l = min(o, p) * (1 - abs(0.006 * rnd.gauss(0, 1)))
            data.append([d.strftime("%Y-%m-%d"), round(p, 4), round(p * 0.98, 4), round(o, 4), round(h, 4), round(l, 4),
                         int(400000 * (1 + abs(rnd.gauss(0, 0.5))))])
        d += timedelta(days=1)
    return {"symbol": symbol, "name": "MOCK " + symbol, "currency": cur, "exchange": "MOCK", "data": data}


def confirmed_date(asset):
    stamp = asset.get("fetchedAt")
    if not stamp:
        return None
    captured = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    symbol, exchange = asset["symbol"], asset.get("exchange", "")
    if exchange.upper() in {"CCC", "CMC"} or symbol in {"BTC-KRW", "BTC-USD", "ETH-KRW", "ETH-USD"}:
        hours = 24
    elif symbol.endswith((".KS", ".KQ")) or symbol in {"^KS11", "^KQ11"}:
        hours = 8
    else:
        hours = 22 if asset["currency"] == "USD" else 24
    cutoff = captured.astimezone(timezone.utc) - timedelta(hours=hours)
    return next((row[0] for row in reversed(asset["data"]) if row[0] <= cutoff.date().isoformat()), None)


def collect_item(ticker, previous, hidden=False):
    symbol = ticker["symbol"]
    path = os.path.join(DATA, file_name(symbol))
    temporary = path + ".tmp"
    previous_close = previous.get("quoteUpdate", {}).get("closeDate") if previous else None
    try:
        asset = fetch(symbol)
        close = confirmed_date(asset)
        if previous_close and (not close or close < previous_close):
            raise ValueError("confirmed close regressed from %s to %s" % (previous_close, close))
        item = {"symbol": symbol, "name": asset["name"], "currency": asset["currency"],
                "first": asset["data"][0][0], "last": asset["data"][-1][0]}
        update = {"status": "unchanged" if close and close == previous_close else "collected",
                  "closeDate": close, "fetchedAt": asset.get("fetchedAt")}
        with open(temporary, "w", encoding="utf-8") as f:
            json.dump(asset, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        os.replace(temporary, path)
    except Exception as error:
        print("  FAIL %-12s %s" % (symbol, error))
        if not previous or not os.path.isfile(path):
            return None
        item = dict(previous)
        update = {**previous.get("quoteUpdate", {}), "status": "retained"}
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    item["label"] = ticker.get("label") or item["name"]
    item["group"] = ticker.get("group") or "기타"
    item["quoteUpdate"] = {**update, "attemptedAt": datetime.now(timezone.utc).isoformat()}
    if ticker.get("aliases"):
        item["aliases"] = ticker["aliases"]
    if hidden:
        item["hidden"] = True
    return item


def main():
    with open(os.path.join(ROOT, "tickers.json"), encoding="utf-8") as f:
        tickers = json.load(f)
    os.makedirs(DATA, exist_ok=True)
    try:
        with open(os.path.join(DATA, "index.json"), encoding="utf-8") as f:
            old = {x["symbol"]: x for x in json.load(f).get("items", [])}
    except Exception:
        old = {}

    items, failed, ok, currencies = [], [], [], set()

    def run(t, hidden=False):
        sym = t["symbol"]
        item = collect_item(t, old.get(sym), hidden)
        if not item or item["quoteUpdate"]["status"] == "retained":
            failed.append(sym)
        else:
            ok.append(sym)
            print("  ok   %-12s %s ~ %s" % (sym, item["first"], item["last"]))
        if not item:
            return None
        items.append(item)
        if not MOCK:
            time.sleep(1)
        return item

    print("시세 받는 중 (%d개)" % len(tickers))
    for t in tickers:
        it = run(t)
        if it and it["currency"] != "KRW":
            currencies.add(it["currency"])
    for cur in sorted(currencies):  # 원화 환산용 환율
        fx = "KRW=X" if cur == "USD" else cur + "KRW=X"
        if not any(x["symbol"] == fx for x in items):
            run({"symbol": fx, "label": "%s/KRW 환율" % cur, "group": "환율"}, hidden=True)

    index = {"updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M") + " KST", "items": items}
    with open(os.path.join(DATA, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    from update_valuations import update as update_valuations
    update_valuations(DATA, yahoo, mock=MOCK)
    print("완료: 성공 %d, 실패 %d%s" % (len(ok), len(failed), (" (" + ", ".join(failed) + ")") if failed else ""))
    if tickers and not any(item for item in items if not item.get("hidden")):
        sys.exit(1)
    if failed:
        print("::warning::시세 수집 실패 %d건. 저장 자료가 있으면 유지하고 종목별 상태를 기록했습니다." % len(failed))


if __name__ == "__main__":
    main()
