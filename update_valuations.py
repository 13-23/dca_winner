"""Optional index valuation snapshots. Missing provider values stay missing."""
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

SYMBOLS = ['^KS11', '^KQ11', '^IXIC', '^NDX', '^DJI', '^GSPC']


def positive(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0


def snapshot(row):
    price = row.get('regularMarketPrice')
    stamp = row.get('regularMarketTime')
    if not positive(price) or not positive(stamp):
        return None
    per = row.get('trailingPE')
    pbr = row.get('priceToBook')
    if not positive(per) and not positive(pbr):
        return None
    return {'symbol': row['symbol'], 'referencePrice': price,
            'per': per if positive(per) else None, 'pbr': pbr if positive(pbr) else None,
            'asOf': datetime.fromtimestamp(stamp, timezone.utc).strftime('%Y-%m-%d'),
            'source': 'Yahoo Finance', 'basis': 'TTM', 'status': 'available'}


def update(directory, yahoo, mock=False):
    path = Path(directory) / 'valuations.json'
    try:
        previous = {x['symbol']: x for x in json.loads(path.read_text())['items']}
    except (OSError, ValueError, KeyError, TypeError):
        previous = {}
    rows = {}
    if not mock:
        try:
            payload = yahoo('/v7/finance/quote?symbols=' + quote(','.join(SYMBOLS), safe=','))
            for row in payload.get('quoteResponse', {}).get('result', []):
                if row.get('symbol') in SYMBOLS:
                    item = snapshot(row)
                    if item:
                        rows[row['symbol']] = item
        except Exception as exc:
            print('  valuation source unavailable:', type(exc).__name__)
    items = []
    for symbol in SYMBOLS:
        item = rows.get(symbol)
        if item is None and symbol in previous and not mock:
            item = dict(previous[symbol])
            item['status'] = 'stale' if positive(item.get('per')) or positive(item.get('pbr')) else 'unavailable'
        if item is None:
            item = {'symbol': symbol, 'referencePrice': None, 'per': None, 'pbr': None,
                    'asOf': None, 'source': 'Yahoo Finance', 'basis': 'TTM', 'status': 'unavailable'}
        items.append(item)
    result = {'updated': datetime.now(timezone.utc).isoformat(), 'items': items}
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print('  valuations: %d available, %d stale, %d unavailable' % tuple(sum(x['status'] == s for x in items) for s in ['available', 'stale', 'unavailable']))
    return result
