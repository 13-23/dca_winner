"""Archive full validated histories needed by the reproducible position study."""
import csv
import hashlib
import io
import json
from datetime import datetime, timezone
from pathlib import Path
from update_market import get, day, number, CSV_BASE, ARCHIVE


def clean(raw, date_key, value_key, today, lower='1990-01-01', upper=None):
    reader = csv.DictReader(io.StringIO(raw.decode('utf-8-sig')))
    if not {date_key, value_key} <= set(reader.fieldnames or []):
        raise ValueError('Unexpected source format')
    result = {}
    for row in reader:
        try:
            date, value = day(row[date_key]), number(row[value_key], high=upper)
            if lower <= date <= today and (value > 0 or upper == 100):
                result[date] = value
        except (ValueError, TypeError):
            continue
    if len(result) < 500:
        raise ValueError('Insufficient historical data')
    return [[d, v] for d, v in sorted(result.items())]


def update():
    root = Path(__file__).parent / 'data'
    path = root / 'position-inputs.json'
    try:
        old = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        old = {}
    today = datetime.now(timezone.utc).date().isoformat()
    result = {'updated':datetime.now(timezone.utc).isoformat(), 'series':{}, 'sources':{}}
    for key, url, dk, vk, lower, high in [
        ('vix', CSV_BASE+'VIX_History.csv','DATE','CLOSE','1990-01-01',None),
        ('fear_greed', ARCHIVE,'Date','Fear Greed','2021-02-01',100),
    ]:
        try:
            raw = get(url)
            result['series'][key] = clean(raw, dk, vk, today, lower, high)
            result['sources'][key] = {'url':url,'sha256':hashlib.sha256(raw).hexdigest(),'fetchedAt':result['updated'],'status':'available'}
        except Exception as exc:
            if key not in old.get('series',{}):
                raise RuntimeError('No historical source for '+key) from exc
            result['series'][key] = old['series'][key]
            result['sources'][key] = {**old['sources'][key], 'status':'stale'}
            print('Historical source retained:',key,type(exc).__name__)
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(result, ensure_ascii=False, separators=(',',':'),allow_nan=False)+'\n',encoding='utf-8')
    tmp.replace(path)
    print('Position histories:', {k:len(v) for k,v in result['series'].items()})


if __name__ == '__main__':
    update()
