"""Observed index drawdown/MA episodes. No fitted forecasts or fair-value score."""
from bisect import bisect_left, bisect_right
from collections import deque
from datetime import date, datetime, timezone
from calendar import monthrange
from pathlib import Path
from statistics import mean, median, stdev
import hashlib
import json
import math

LEVELS = [5, 10, 15, 20, 30]
MARKETS = {
    '^NDX': ('나스닥100', '_NDX.json', 'drawdown.json', 22),
    '^KS11': ('코스피', '_KS11.json', 'drawdown-kospi.json', 8),
    '^KQ11': ('코스닥', '_KQ11.json', 'drawdown-kosdaq.json', 8),
}


def quantile(values, p):
    a = sorted(values)
    if not a:
        return None
    x = (len(a) - 1) * p
    lo = int(x)
    return a[lo] + (a[min(lo + 1, len(a) - 1)] - a[lo]) * (x - lo)


def add_months(day, months):
    d = date.fromisoformat(day)
    y, m = divmod(d.year * 12 + d.month - 1 + months, 12)
    m += 1
    return date(y, m, min(d.day, monthrange(y, m)[1])).isoformat()


def ma_features(rows):
    prices = [r[1] for r in rows]
    sma, weekly = [], []
    total = 0
    prior_weeks = deque(maxlen=59)
    week = None
    previous_close = None
    for i, (day, price, *_) in enumerate(rows):
        total += price
        if i >= 200:
            total -= prices[i - 200]
        sma.append(total / 200 if i >= 199 else None)
        key = date.fromisoformat(day).isocalendar()[:2]
        if week is not None and key != week:
            prior_weeks.append(previous_close)
        weekly.append((sum(prior_weeks) + price) / 60 if len(prior_weeks) == 59 else None)
        week, previous_close = key, price
    return sma, weekly


def drawdown_cycles(prices):
    peak, peak_i = prices[0], 0
    cycle, result, dd = None, [], []
    for i, price in enumerate(prices):
        if price >= peak:
            if cycle is not None:
                cycle['recovery_i'] = i
                result.append(cycle)
                cycle = None
            peak, peak_i = price, i
            dd.append(0.0)
            continue
        decline = price / peak - 1
        dd.append(decline)
        if cycle is None:
            cycle = {'peak_i': peak_i, 'start_i': i, 'recovery_i': None, 'trough_i': i, 'depth': decline, 'crossings': {}}
        if decline < cycle['depth']:
            cycle.update(trough_i=i, depth=decline)
        for level in LEVELS:
            if decline <= -level / 100 + 1e-12 and level not in cycle['crossings']:
                cycle['crossings'][level] = i
    if cycle is not None:
        result.append(cycle)
    return dd, result


def runs(prices, averages):
    result, active = [], None
    for i, (price, average) in enumerate(zip(prices, averages)):
        if average is None:
            continue
        if price < average:
            if active is None:
                active = {'start_i': i, 'recovery_i': None, 'left_censored': i == 0 or averages[i - 1] is None}
        elif active is not None:
            active['recovery_i'] = i
            result.append(active)
            active = None
    if active is not None:
        result.append(active)
    return result


def duration_summary(events, last_i):
    complete = [e['recovery_i'] - e['start_i'] for e in events if e['recovery_i'] is not None]
    observed = [(e['recovery_i'] - e['start_i'], True) if e['recovery_i'] is not None else (last_i - e['start_i'] + 1, False) for e in events]
    survival, risk, km_median = 1.0, len(observed), None
    for t in sorted({t for t, _ in observed}):
        deaths = sum(day == t and done for day, done in observed)
        censored = sum(day == t and not done for day, done in observed)
        if risk:
            survival *= 1 - deaths / risk
        if km_median is None and survival <= .5:
            km_median = t
        risk -= deaths + censored
    return {'complete': len(complete), 'ongoing': len(events) - len(complete),
            'median': median(complete) if complete else None, 'mean': mean(complete) if complete else None,
            'p90': quantile(complete, .9), 'max': max(complete) if complete else None,
            'kmMedian': km_median}


def forward_summary(rows, triggers, months):
    dates = [r[0] for r in rows]
    values, incomplete, overlapping, accepted_until = [], 0, 0, -1
    for signal in sorted(triggers):
        entry = signal + 1  # Signal close is known; next session close is the reference entry.
        if entry >= len(rows):
            incomplete += 1
            continue
        target = add_months(dates[entry], months)
        if target > dates[-1]:
            incomplete += 1
            continue
        end = bisect_right(dates, target) - 1
        if entry <= accepted_until:
            overlapping += 1
            continue
        price = rows[entry][1]
        values.append({'signal': dates[signal], 'entry': dates[entry], 'end': dates[end],
                       'return': rows[end][1] / price - 1,
                       'additionalDecline': min(r[1] for r in rows[entry:end + 1]) / price - 1})
        accepted_until = end
    outcomes = [x['return'] for x in values]
    return {'months': months, 'n': len(values), 'incomplete': incomplete, 'overlapExcluded': overlapping,
            'median': median(outcomes) if outcomes else None, 'mean': mean(outcomes) if outcomes else None,
            'p10': quantile(outcomes, .1), 'p90': quantile(outcomes, .9),
            'lossRate': sum(x < 0 for x in outcomes) / len(outcomes) if outcomes else None,
            'worstAdditionalDecline': min((x['additionalDecline'] for x in values), default=None), 'events': values}


def build(rows, symbol="^NDX"):
    if symbol not in MARKETS:
        raise ValueError("Unsupported drawdown market")
    if len(rows) < 201:
        raise ValueError('At least 201 confirmed daily closes are required')
    if any(not isinstance(r[1], (int, float)) or isinstance(r[1], bool) or not math.isfinite(r[1]) or r[1] <= 0 for r in rows):
        raise ValueError('Prices must be finite and positive')
    dates = [r[0] for r in rows]
    if dates != sorted(set(dates)):
        raise ValueError('Dates must be unique and increasing')
    for day in dates:
        if date.fromisoformat(day).isoformat() != day:
            raise ValueError('Invalid ISO date')
    prices = [r[1] for r in rows]
    sma, weekly = ma_features(rows)
    dd, cycles = drawdown_cycles(prices)
    gaps = [[price / average - 1 if average else None for price, average in zip(prices, line)] for line in [sma, weekly]]
    ma_runs = [runs(prices, line) for line in [sma, weekly]]
    last_i, as_of = len(rows) - 1, dates[-1]
    current_cycle = cycles[-1] if cycles and cycles[-1]['recovery_i'] is None else None
    current = {'close': prices[-1], 'drawdown': dd[-1], 'gap200': gaps[0][-1], 'gap60w': gaps[1][-1],
               'peakDate': dates[current_cycle['peak_i']] if current_cycle else dates[-1],
               'underwaterDays': last_i - current_cycle['start_i'] + 1 if current_cycle else 0,
               'volatility21': stdev([prices[i] / prices[i - 1] - 1 for i in range(last_i - 20, last_i + 1)]) * math.sqrt(252)}
    views = {}
    for key, start in [('all', dates[0]), ('20', add_months(as_of, -240)), ('10', add_months(as_of, -120))]:
        start_i = bisect_left(dates, start)
        first = dates[start_i]
        years = ((date.fromisoformat(as_of) - date.fromisoformat(first)).days + 1) / 365.2425
        levels = []
        for level in LEVELS:
            events, carried = [], []
            for cycle in cycles:
                trigger = cycle['crossings'].get(level)
                if trigger is not None and trigger >= start_i:
                    events.append({'start_i': trigger, 'recovery_i': cycle['recovery_i'], 'cycle': cycle})
                elif trigger is not None and trigger < start_i and (cycle['recovery_i'] is None or cycle['recovery_i'] >= start_i):
                    carried.append({'signal': dates[trigger], 'peak': dates[cycle['peak_i']], 'trough': dates[cycle['trough_i']], 'depth': cycle['depth'], 'recovery': dates[cycle['recovery_i']] if cycle['recovery_i'] is not None else None, 'days': (cycle['recovery_i'] if cycle['recovery_i'] is not None else len(rows)) - trigger, 'carriedIn': True})
            triggers = [e['start_i'] for e in events]
            annual = {str(y): 0 for y in range(int(first[:4]), int(as_of[:4]) + 1)}
            for i in triggers:
                annual[dates[i][:4]] += 1
            details = [{'signal': dates[e['start_i']], 'peak': dates[e['cycle']['peak_i']], 'trough': dates[e['cycle']['trough_i']],
                        'depth': e['cycle']['depth'], 'recovery': dates[e['recovery_i']] if e['recovery_i'] is not None else None,
                        'days': (e['recovery_i'] if e['recovery_i'] is not None else len(rows)) - e['start_i']} for e in events]
            levels.append({'level': level, 'count': len(events), 'perYear': len(events) / years,
                           'occupancy': sum(d <= -level / 100 + 1e-12 for d in dd[start_i:]) / (len(rows) - start_i),
                           'duration': duration_summary(events, last_i), 'annual': annual, 'events': details, 'carriedIn': len(carried), 'carriedInEvents': carried,
                           'forward': [forward_summary(rows, triggers, m) for m in [3, 6, 12]]})
        averages = []
        for label, line, events in zip(['200일선', '60주선'], [sma, weekly], ma_runs):
            selected = [e for e in events if e['start_i'] >= start_i and not e['left_censored']]
            valid = [(price, average) for price, average in zip(prices[start_i:], line[start_i:]) if average is not None]
            averages.append({'name': label, 'count': len(selected), 'occupancy': sum(p < a for p, a in valid) / len(valid) if valid else None,
                             'observations': len(valid), 'duration': duration_summary(selected, last_i)})
        ranks = {}
        for name, series in [('drawdown', dd), ('gap200', gaps[0]), ('gap60w', gaps[1])]:
            history = [v for v in series[start_i:last_i] if v is not None]
            now = series[-1]
            ranks[name] = {'percentile': sum(v <= now for v in history) / len(history) * 100 if history and now is not None else None, 'n': len(history)}
        views[key] = {'start': first, 'end': as_of, 'sessions': len(rows) - start_i, 'years': years,
                      'levels': levels, 'movingAverages': averages, 'ranks': ranks}
    return {'version': 'drawdown-v1', 'symbol': symbol, 'name': MARKETS[symbol][0], 'asOf': as_of,
            'historyStart': dates[0], 'source': 'Yahoo Finance · 저장된 일별 종가', 'current': current, 'views': views,
            'history': [[d, round(p, 4), round(decline, 7)] for d, p, decline in zip(dates, prices, dd)]}


def update(directory, symbol="^NDX"):
    name, source_file, output_file, close_hour = MARKETS[symbol]
    directory = Path(directory)
    path = directory / source_file
    raw = path.read_bytes()
    payload = json.loads(raw)
    rows = payload['data']
    # Conservative close cutoffs: US 22:00 UTC, Korea 08:00 UTC (17:00 KST).
    stamp = payload.get('fetchedAt')
    if not stamp:
        raise ValueError(symbol + ' capture timestamp is missing; refresh research prices first')
    captured = datetime.fromisoformat(stamp.replace('Z', '+00:00'))
    if captured.tzinfo is None:
        raise ValueError('Capture timestamp must include a timezone')
    rows = [r for r in rows if datetime.fromisoformat(r[0] + f'T{close_hour:02d}:00:00+00:00') <= captured]
    result = build(rows, symbol)
    result.update(generatedAt=datetime.now(timezone.utc).isoformat(), priceCapturedAt=stamp, sourceSha256=hashlib.sha256(raw).hexdigest())
    (directory / output_file).write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    print('Drawdown analysis:', name, result['asOf'], len(rows), 'confirmed closes')
    return result


if __name__ == '__main__':
    for symbol in MARKETS:
        update(Path(__file__).parent / 'data', symbol)
