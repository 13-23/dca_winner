#!/usr/bin/env python3
"""Collect daily US-market context. Missing data is never replaced with a score."""
import csv
import io
import json
import math
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen

CNN = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata'
CNN_PAGE = 'https://www.cnn.com/markets/fear-and-greed'
ARCHIVE_PAGE = 'https://github.com/whit3rabbit/fear-greed-data'
ARCHIVE = 'https://raw.githubusercontent.com/whit3rabbit/fear-greed-data/main/datasets/cnn_fear_greed.csv'
CBOE_PAGE = 'https://www.cboe.com/tradable-products/vix/vix-historical-data'
OPTIONS_PAGE = 'https://www.cboe.com/markets/us/options/market-statistics/daily'
OPTIONS_BASE = 'https://cdn.cboe.com/data/us/options/market_statistics/daily/'
CSV_BASE = 'https://cdn-api.cboe.com/api/global/us_indices/daily_prices/'
SPECS = [
    dict(id='fear_greed', label='공포·탐욕 지수', source='CNN', url=CNN_PAGE,
         description='미국 주식시장 심리를 종합한 0~100 점수. 낮을수록 공포, 높을수록 탐욕입니다.', unit='점'),
    dict(id='vix', label='VIX', source='Cboe', url=CBOE_PAGE,
         description='S&P 500 옵션에 반영된 향후 30일 예상 변동성입니다.', unit=''),
    dict(id='put_call', label='전체 풋/콜 비율', source='Cboe', url=OPTIONS_PAGE,
         description='Cboe 전체 상품의 당일 풋 거래량 ÷ 콜 거래량입니다. 주식 전용 비율이나 CNN의 5일 평균과는 다릅니다.', unit='배'),
    dict(id='vix9d', label='VIX9D', source='Cboe', url=CBOE_PAGE,
         description='S&P 500 옵션에 반영된 향후 9일 예상 변동성입니다.', unit=''),
    dict(id='vvix', label='VVIX', source='Cboe', url=CBOE_PAGE,
         description='VIX 옵션에 반영된 VIX 자체의 예상 변동성입니다.', unit=''),
]


def get(url):
    req = Request(url, headers={'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json,text/csv,*/*', 'Referer': CNN_PAGE})
    with urlopen(req, timeout=20) as response:
        return response.read()


def number(value, low=0, high=None):
    if isinstance(value, bool) or value is None:
        raise ValueError('Missing numeric reading')
    value = float(value)
    if not math.isfinite(value) or value < low or (high is not None and value > high):
        raise ValueError('Invalid numeric reading')
    return value


def day(value):
    if isinstance(value, (int, float)):
        # CNN chart timestamps are milliseconds; snapshots may use ISO strings.
        return datetime.fromtimestamp(value / (1000 if value > 1e11 else 1), timezone.utc).date().isoformat()
    text = str(value).strip()
    for fmt in ('%Y-%m-%d', '%m/%d/%Y'):
        try:
            return datetime.strptime(text[:10], fmt).date().isoformat()
        except ValueError:
            pass
    raise ValueError('Missing observation date')


def series(points, today, high=None, allow_zero=True):
    rows = {}
    for date, value in points:
        try:
            date, value = day(date), number(value, high=high)
            if date > today or date < '1990-01-01' or (not allow_zero and value == 0):
                continue
            rows[date] = value
        except (ValueError, TypeError, OverflowError, OSError):
            continue
    return [[date, value] for date, value in sorted(rows.items())][-90:]


def observation(rows):
    if not rows:
        raise ValueError('No dated observations')
    date, value = rows[-1]
    previous = rows[-2][1] if len(rows) > 1 else None
    return dict(value=value, asOf=date, previous=previous,
                change=None if previous is None else value-previous, history=rows)


def parse_csv(raw, symbol, today):
    text = raw.decode('utf-8-sig')
    reader = csv.DictReader(io.StringIO(text))
    fields = reader.fieldnames or []
    if 'DATE' not in fields or not ({'CLOSE', symbol} & set(fields)):
        raise ValueError('Provider did not return the expected CSV')
    rows = series(((r['DATE'], r.get('CLOSE', r.get(symbol))) for r in reader), today, allow_zero=False)
    return observation(rows)


def parse_cnn(raw, today):
    payload = json.loads(raw)
    found = {}
    historical = payload.get('fear_and_greed_historical', {}).get('data', [])
    rows = series(((p.get('x'), p.get('y')) for p in historical), today, high=100)
    current = payload.get('fear_and_greed') or {}
    try:
        date, score = day(current.get('timestamp')), number(current.get('score'), high=100)
        if date <= today and date >= '1990-01-01':
            rows = series([*rows, [date, score]], today, high=100)
    except (ValueError, TypeError, OverflowError, OSError):
        pass
    if rows:
        found['fear_greed'] = observation(rows)
    return found


def parse_archive(raw, today):
    reader = csv.DictReader(io.StringIO(raw.decode('utf-8-sig')))
    if not {'Date', 'Fear Greed'} <= set(reader.fieldnames or []):
        raise ValueError('Invalid archive CSV')
    result = observation(series(((r['Date'], r['Fear Greed']) for r in reader), today, high=100))
    return {**result, 'source': 'CNN · 공개 아카이브', 'url': ARCHIVE_PAGE, 'indirect': True}


def parse_put_call(raw, date):
    payload = json.loads(raw)
    ratio = next(r['value'] for r in payload['ratios'] if r['name'] == 'TOTAL PUT/CALL RATIO')
    volume = next(r for r in payload['SUM OF ALL PRODUCTS'] if r['name'] == 'VOLUME')
    calls, puts = number(volume['call']), number(volume['put'])
    if calls <= 0 or puts <= 0:
        raise ValueError('No option volume')
    ratio = number(ratio, high=10)
    if abs(ratio - puts/calls) > .011:
        raise ValueError('Ratio does not match reported volumes')
    return [day(date), ratio]


def update(folder=None, fetch=get, now=None):
    now = now or datetime.now(timezone.utc)
    today = now.date().isoformat()
    folder = Path(folder or Path(__file__).parent / 'data')
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / 'market.json'
    try:
        old = {i['id']: i for i in json.loads(path.read_text(encoding='utf-8'))['items']}
    except (OSError, ValueError, KeyError, TypeError):
        old = {}
    readings = {}

    def load(name):
        try:
            if name == 'cnn':
                try:
                    result = parse_cnn(fetch(CNN), today)
                    if 'fear_greed' in result:
                        return result
                except Exception as exc:
                    print('CNN direct source unavailable:', type(exc).__name__)
                return {'fear_greed': parse_archive(fetch(ARCHIVE), today)}
            if name == 'put_call':
                points = list(old.get(name, {}).get('history') or [])
                collected = 0
                for offset in range(1, 8):
                    date = now.date() - timedelta(days=offset)
                    if date.weekday() >= 5:
                        continue
                    try:
                        points.append(parse_put_call(fetch(OPTIONS_BASE + date.isoformat() + '_daily_options'), date.isoformat()))
                        collected += 1
                        if collected == 2:
                            break
                    except Exception:
                        continue
                if not collected:
                    raise ValueError('No recent Cboe option statistics')
                return {name: observation(series(points, today, high=10, allow_zero=False))}
            return {name.lower(): parse_csv(fetch(CSV_BASE + name + '_History.csv'), name, today)}
        except Exception as exc:
            print('Market source unavailable:', name, type(exc).__name__)
            return {}

    with ThreadPoolExecutor(max_workers=5) as pool:
        for result in pool.map(load, ['cnn', 'put_call', 'VIX', 'VIX9D', 'VVIX']):
            readings.update(result)
    items = []
    for spec in SPECS:
        key = spec['id']
        item = {**spec, 'value': None, 'asOf': None, 'previous': None,
                'change': None, 'history': [], 'status': 'unavailable'}
        if key in readings:
            item.update(readings[key])
            item['status'] = 'available'
            item['fetchedAt'] = now.isoformat()
        elif old.get(key, {}).get('value') is not None:
            # Revalidate stored values and dates before preserving them.
            try:
                rows = series(old[key].get('history') or [[old[key]['asOf'], old[key]['value']]], today,
                              high=100 if key == 'fear_greed' else 10 if key == 'put_call' else None,
                              allow_zero=key == 'fear_greed')
                item.update(observation(rows))
                item['fetchedAt'] = old[key].get('fetchedAt')
                item['status'] = 'stale'
                if key == 'fear_greed' and old[key].get('indirect'):
                    item.update(source='CNN · 공개 아카이브', url=ARCHIVE_PAGE, indirect=True)
            except (ValueError, KeyError, TypeError):
                pass
        if item['asOf'] and (now.date() - datetime.fromisoformat(item['asOf']).date()).days > 5:
            item['status'] = 'stale'
        items.append(item)
    output = dict(updated=now.isoformat(), market='US', items=items)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(output, ensure_ascii=False, indent=2, allow_nan=False)+'\n', encoding='utf-8')
    temp.replace(path)
    print('Market indicators:', ', '.join(i['id']+'='+i['status'] for i in items))
    return output


if __name__ == '__main__':
    update()
