"""Check the public release and the data services used by the calculator."""
import json
import os
import time
from datetime import date, datetime, timedelta, timezone
from urllib.request import Request, urlopen


SITE = 'https://13-23.github.io/dca_winner/'
API = 'https://dca-winner-market.vercel.app/api/quotes'


def get(url):
    with urlopen(Request(url, headers={'Cache-Control': 'no-cache'}), timeout=30) as response:
        return response.read()


def check():
    revision = os.environ.get('SITE_REVISION', '')
    release = json.loads(get(SITE + 'release.json?v=' + revision))
    if revision and release['revision'] != revision:
        raise ValueError('Published release is not the revision built by this run')
    page = get(SITE + '?v=' + revision).decode()
    if 'pf-search' not in page or 'data-position-panel' not in page or 'mdd-guide' not in page:
        raise ValueError('Published calculator features are missing')
    index = json.loads(get(SITE + 'data/index.json?v=' + revision))
    kst = timezone(timedelta(hours=9))
    updated = datetime.strptime(index['updated'], '%Y-%m-%d %H:%M KST').replace(tzinfo=kst)
    if datetime.now(kst) - updated > timedelta(days=7) or not index['items']:
        raise ValueError('Default price list is empty or stale')
    study = json.loads(get(SITE + 'data/position-v2.json?v=' + revision))
    if study.get('version') != 'research-v2' or not all(m.get('latest') for m in study['markets'].values()):
        raise ValueError('Market position study is unavailable')
    search = json.loads(get(API + '?action=search&q=PSQ'))
    if not any(row['symbol'] == 'PSQ' for row in search['quotes']):
        raise ValueError('Market search did not return PSQ')
    chart = json.loads(get(API + '?action=chart&symbol=PSQ'))
    if chart['symbol'] != 'PSQ' or chart['currency'] != 'USD' or len(chart['data']) < 100:
        raise ValueError('PSQ price history is unavailable')
    if date.today() - date.fromisoformat(chart['data'][-1][0]) > timedelta(days=7):
        raise ValueError('PSQ price history is stale')
    print('Public release, default prices, position study, and external PSQ search/history verified')


if __name__ == '__main__':
    for attempt in range(5):
        try:
            check()
            break
        except (OSError, ValueError, KeyError) as exc:
            if attempt == 4:
                raise
            print(f'Attempt {attempt + 1}: {exc}; waiting for publication or provider recovery', flush=True)
            time.sleep(15)
