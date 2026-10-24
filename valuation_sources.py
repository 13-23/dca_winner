"""Read public valuation data without replacing index values with ETF proxies."""
import math
import re
import xml.etree.ElementTree as ET
from datetime import datetime
from html.parser import HTMLParser

MULTPL = 'https://www.multpl.com/'
PAGES = {'per': 's-p-500-pe-ratio', 'pbr': 's-p-500-price-to-book', 'price': 's-p-500-historical-prices'}
ATOM = {'a': 'http://www.w3.org/2005/Atom'}
MONTHS = {name: i + 1 for i, name in enumerate(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'])}


class CurrentValue(HTMLParser):
    def __init__(self):
        super().__init__()
        self.depth = 0
        self.values = []

    def handle_starttag(self, tag, attrs):
        if self.depth:
            self.depth += 1
        elif tag == 'div' and dict(attrs).get('id') == 'current':
            self.depth = 1

    def handle_endtag(self, tag):
        if self.depth:
            self.depth -= 1

    def handle_data(self, value):
        # Only direct text in #current, excluding title, change and timestamp.
        if self.depth == 1 and re.fullmatch(r'\s*\d[\d,]*(?:\.\d+)?\s*', value):
            self.values.append(float(value.replace(',', '')))


def parse_atom(payload):
    root = ET.fromstring(payload)
    entries = root.findall('a:entry', ATOM)
    if len(entries) != 1:
        raise ValueError('Expected one current valuation entry')
    stamp = entries[0].findtext('a:updated', namespaces=ATOM)
    updated = datetime.fromisoformat(stamp.replace('Z', '+00:00'))
    if updated.tzinfo is None:
        raise ValueError('Source timestamp lacks timezone')
    parser = CurrentValue()
    parser.feed(entries[0].findtext('a:content', namespaces=ATOM) or '')
    if len(parser.values) != 1 or not math.isfinite(parser.values[0]) or parser.values[0] <= 0:
        raise ValueError('No unique positive current source value')
    return parser.values[0], updated


def book_period(payload):
    text = re.sub(r'<[^>]+>', ' ', payload.decode('utf-8'))
    match = re.search(r'book value\s+as of\s+([A-Za-z]+),?\s+(\d{4})', text, re.I)
    if match and match[1].title() in MONTHS:
        return '%s-%02d' % (match[2], MONTHS[match[1].title()])
    return None


def fetch_multpl(get):
    values = {key: parse_atom(get(MULTPL + page + '/atom')) for key, page in PAGES.items()}
    if len({stamp for _, stamp in values.values()}) != 1:
        raise ValueError('PER, PBR and index price have different source timestamps')
    stamp = values['price'][1]
    try:
        period = book_period(get(MULTPL + PAGES['pbr']))
    except Exception:
        period = None
    return {'symbol': '^GSPC', 'referencePrice': values['price'][0],
            'per': values['per'][0], 'pbr': values['pbr'][0],
            'asOf': stamp.strftime('%Y-%m-%d'), 'sourceTimestamp': stamp.isoformat(),
            'source': 'Multpl (S&P 500)', 'sourceUrls': {key: MULTPL + page for key, page in PAGES.items()},
            'basis': 'TTM as-reported; latest reported book value',
            'estimated': True, 'bookValueAsOf': period, 'status': 'available'}
