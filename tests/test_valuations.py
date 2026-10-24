import json
import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from update_valuations import snapshot, update


class ValuationTests(unittest.TestCase):
    def test_source_snapshot_requires_actual_quote_price_and_trailing_values(self):
        row = {'symbol': '^KS11', 'regularMarketPrice': 100, 'regularMarketTime': 1704153600, 'trailingPE': 20, 'priceToBook': 2}
        item = snapshot(row)
        self.assertEqual(item['per'], 20)
        self.assertEqual(item['pbr'], 2)
        self.assertEqual(item['asOf'], '2024-01-02')
        self.assertIsNone(snapshot({**row, 'regularMarketPrice': None}))
        self.assertIsNone(snapshot({**row, 'trailingPE': -2, 'priceToBook': 0}))
        self.assertIsNone(snapshot({'symbol': '^KS11', 'regularMarketPrice': 100, 'regularMarketTime': 1704153600, 'forwardPE': 25}))

    def test_unavailable_values_are_null_and_never_mocked(self):
        with tempfile.TemporaryDirectory() as folder:
            result = update(folder, lambda _: {'quoteResponse': {'result': []}})
            self.assertEqual(len(result['items']), 6)
            self.assertTrue(all(x['per'] is None and x['pbr'] is None and x['status'] == 'unavailable' for x in result['items']))
            result = update(folder, lambda _: self.fail('Mock mode must not call provider'), mock=True)
            self.assertTrue(all(x['per'] is None for x in result['items']))

    def test_failed_refresh_retains_original_date_and_marks_stale(self):
        with tempfile.TemporaryDirectory() as folder:
            old = {'symbol': '^KS11', 'referencePrice': 100, 'per': 20, 'pbr': None, 'asOf': '2024-01-02', 'source': 'Yahoo Finance', 'status': 'available'}
            (Path(folder) / 'valuations.json').write_text(json.dumps({'items': [old]}))
            def fail(_):
                raise RuntimeError('Provider unavailable')
            result = update(folder, fail)
            item = result['items'][0]
            self.assertEqual(item['status'], 'stale')
            self.assertEqual(item['asOf'], '2024-01-02')
            self.assertEqual(item['per'], 20)


if __name__ == '__main__':
    unittest.main()
