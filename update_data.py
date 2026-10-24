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


def fetch(symbol):
    if MOCK:
        return mock(symbol)
    now = int(time.time()) + 86400
    j = yahoo("/v8/finance/chart/%s?period1=0&period2=%d&interval=1d&events=div%%2Csplits&includeAdjustedClose=true"
              % (urllib.parse.quote(symbol, safe=""), now))
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
        # [날짜, 종가, 수정종가, 시가, 고가, 저가, 거래량]
        rows[d] = [d, round(cl, 4), round(a, 4), round(o, 4), round(h, 4), round(l, 4), int(v)]
    data = [rows[k] for k in sorted(rows)]
    if len(data) < 2:
        raise RuntimeError("too few rows")
    return {
        "symbol": symbol,
        "name": meta.get("longName") or meta.get("shortName") or symbol,
        "currency": (meta.get("currency") or "USD").upper(),
        "exchange": meta.get("fullExchangeName") or meta.get("exchangeName") or "",
        "data": data,
    }


def mock(symbol):
    rnd = random.Random(symbol)
    cur = "KRW" if symbol.endswith((".KS", ".KQ")) or symbol in ("^KS11", "^KQ11", "KRW=X") or symbol.endswith("KRW=X") else "USD"
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
        try:
            out = fetch(sym)
            with open(os.path.join(DATA, file_name(sym)), "w", encoding="utf-8") as f:
                json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
            item = {"symbol": sym, "label": t.get("label") or out["name"], "name": out["name"],
                    "group": t.get("group") or "기타", "currency": out["currency"],
                    "first": out["data"][0][0], "last": out["data"][-1][0]}
            ok.append(sym)
            print("  ok   %-12s %s ~ %s (%d일)" % (sym, item["first"], item["last"], len(out["data"])))
        except Exception as e:
            failed.append(sym)
            print("  FAIL %-12s %s" % (sym, e))
            if sym not in old or not os.path.exists(os.path.join(DATA, file_name(sym))):
                return None
            item = dict(old[sym])  # 예전 파일 유지
            item.update({"label": t.get("label") or item.get("label"), "group": t.get("group") or item.get("group")})
        if hidden:
            item["hidden"] = True
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
    if failed and len(failed) >= len(tickers):
        sys.exit(1)  # 전부 실패하면 Actions에 오류로 표시


if __name__ == "__main__":
    main()
