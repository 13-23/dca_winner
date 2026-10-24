import html
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from valuation_sources import parse_atom, fetch_multpl, book_period
from update_valuations import update


def feed(value, timestamp='2026-10-23T16:00:00-04:00'):
    content = '<div id="current"><b>Current <span>S&amp;P 500</span>:</b>\n' + str(value) + '\n<span>-0.14 (-0.53%)</span><div id="timestamp">4:00 PM</div></div>'
    return ('<feed xmlns="http://www.w3.org/2005/Atom"><entry><updated>' + timestamp + '</updated><content type="html">' + html.escape(content) + '</content></entry></feed>').encode()


def get_fixture(url):
    if url.endswith('s-p-500-pe-ratio/atom'):
        return feed('26.01')
    if url.endswith('s-p-500-price-to-book/atom'):
        return feed('6.05')
    if url.endswith('s-p-500-historical-prices/atom'):
        return feed('7,681.84')
    return b'<div>Current price to book is based on <a>book value</a> as of September, 2025</div>'


class SourceTests(unittest.TestCase):
    def test_numeric_title_change_and_time_are_not_mistaken_for_the_value(self):
        value, stamp = parse_atom(feed('7,681.84'))
        self.assertEqual(value, 7681.84)
        self.assertEqual(stamp.isoformat(), '2026-10-23T16:00:00-04:00')

    def test_multpl_pairs_same_timestamp_ratios_and_price_and_retains_old_book_period(self):
        row = fetch_multpl(get_fixture)
        self.assertEqual((row['per'], row['pbr'], row['referencePrice']), (26.01, 6.05, 7681.84))
        self.assertEqual(row['asOf'], '2026-10-23')
        self.assertEqual(row['bookValueAsOf'], '2025-09')
        self.assertTrue(row['estimated'])
        self.assertEqual(row['source'], 'Multpl (S&P 500)')

    def test_mismatched_source_timestamps_fail_closed(self):
        def mismatched(url):
            return feed(6.05, '2026-10-22T16:00:00-04:00') if 'price-to-book/atom' in url else get_fixture(url)
        with self.assertRaises(ValueError):
            fetch_multpl(mismatched)

    def test_missing_nonpositive_or_ambiguous_values_are_rejected(self):
        for value in ['N/A', '0', '-1', 'NaN', 'Infinity']:
            with self.assertRaises(ValueError):
                parse_atom(feed(value))
        with self.assertRaises(ValueError):
            parse_atom(b'<html>Changed page</html>')
        self.assertIsNone(book_period(b'<html>No disclosed book period</html>'))

    def test_multpl_is_used_when_yahoo_has_no_index_ratios(self):
        with tempfile.TemporaryDirectory() as folder:
            result = update(folder, lambda _: {'quoteResponse': {'result': []}}, get=get_fixture)
            row = next(x for x in result['items'] if x['symbol'] == '^GSPC')
            self.assertEqual(row['status'], 'available')
            self.assertEqual(row['source'], 'Multpl (S&P 500)')
            self.assertEqual(row['pbr'], 6.05)
            self.assertTrue(all(x['status'] == 'unavailable' for x in result['items'] if x['symbol'] != '^GSPC'))


if __name__ == '__main__':
    unittest.main()
