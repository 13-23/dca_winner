"""Check the public release and the data services used by the calculator."""
import json
import hashlib
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
    summary = get(SITE + 'price-summary.js?v=' + revision)
    if not all(marker in page for marker in ('single-price-summary', 'pf-price-summary', 'data-overview-position', 'crypto-source-note', 'data-strategy-differences', 'dd-episode-summary')) or b'comparisonAge' not in summary:
        raise ValueError('Published price summary is missing')
    if 'single-strategy' not in page or 'pf-strategy' not in page or b'compareMonthly' not in get(SITE + 'strategy-ui.js?v=' + revision):
        raise ValueError('Published monthly strategy comparison is missing')
    if 'market-context-card' not in page or b'additionalDecline' not in get(SITE + 'market-context.js?v=' + revision):
        raise ValueError('Published market context is missing')
    if not all(marker in page for marker in ('tab-dashboard', 'dashboard-markets', 'dashboard-kr-themes', 'dashboard-us-themes', 'dashboard-macro')):
        raise ValueError('Published market dashboard is missing')
    if b'dashboard-columns' not in get(SITE + 'styles.css?v=' + revision) or b'function renderGroup' not in get(SITE + 'dashboard.js?v=' + revision):
        raise ValueError('Published dashboard assets are missing')
    if 'EPS·BPS 충격 시' not in page or b'function assess(' not in get(SITE + 'valuation.js?v=' + revision):
        raise ValueError('Published valuation source guards or sensitivity table is missing')
    index = json.loads(get(SITE + 'data/index.json?v=' + revision))
    kst = timezone(timedelta(hours=9))
    updated = datetime.strptime(index['updated'], '%Y-%m-%d %H:%M KST').replace(tzinfo=kst)
    if datetime.now(kst) - updated > timedelta(days=7) or not index['items']:
        raise ValueError('Default price list is empty or stale')
    study = json.loads(get(SITE + 'data/position-v2.json?v=' + revision))
    if study.get('version') != 'research-v2' or not all(m.get('latest') for m in study['markets'].values()):
        raise ValueError('Market position study is unavailable')
    if 'tab-btn-drawdown' not in page or b'drawdown-v1' not in get(SITE + 'drawdown-ui.js?v=' + revision):
        raise ValueError('Drawdown tab assets are missing')
    markets = [('^NDX', 'drawdown.json', '_NDX.json'), ('^KS11', 'drawdown-kospi.json', '_KS11.json'),
               ('^KQ11', 'drawdown-kosdaq.json', '_KQ11.json'), ('^GSPC', 'drawdown-sp500.json', '_GSPC.json'),
               ('^IXIC', 'drawdown-nasdaq.json', '_IXIC.json'), ('^DJI', 'drawdown-dow.json', '_DJI.json')]
    for symbol, stat_file, price_file in markets:
        stat = json.loads(get(SITE + 'data/' + stat_file + '?v=' + revision))
        raw = get(SITE + 'data/' + price_file + '?v=' + revision)
        if (stat.get('symbol') != symbol or stat.get('version') != 'drawdown-v1' or not stat.get('views', {}).get('20')
                or stat.get('sourceSha256') != hashlib.sha256(raw).hexdigest()
                or stat['asOf'] > json.loads(raw)['data'][-1][0]):
            raise ValueError('Drawdown market/source mismatch: ' + symbol)
    for symbol in ['BTC-KRW', 'BTC-USD', 'ETH-KRW', 'ETH-USD']:
        coin = json.loads(get(SITE + 'data/' + symbol + '.json?v=' + revision))
        if not any(item['symbol'] == symbol for item in index['items']) or coin['currency'] != symbol.split('-')[1]:
            raise ValueError('Crypto listing/currency mismatch: ' + symbol)
        if coin['data'][-1][0] >= datetime.now(timezone.utc).date().isoformat():
            raise ValueError('Crypto UTC candle is not completed: ' + symbol)
        if date.today() - date.fromisoformat(coin['data'][-1][0]) > timedelta(days=7):
            raise ValueError('Crypto history is stale: ' + symbol)
    search = json.loads(get(API + '?action=search&q=PSQ'))
    if not any(row['symbol'] == 'PSQ' for row in search['quotes']):
        raise ValueError('Market search did not return PSQ')
    chart = json.loads(get(API + '?action=chart&symbol=PSQ'))
    if chart['symbol'] != 'PSQ' or chart['currency'] != 'USD' or len(chart['data']) < 100:
        raise ValueError('PSQ price history is unavailable')
    if date.today() - date.fromisoformat(chart['data'][-1][0]) > timedelta(days=7):
        raise ValueError('PSQ price history is stale')
    print('Public release, market dashboard, six drawdown markets, four crypto histories, and external PSQ search/history verified')


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
