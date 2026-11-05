import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from update_market import parse_csv, parse_cnn, parse_archive, parse_put_call, update


NOW = datetime(2026, 11, 5, 2, tzinfo=timezone.utc)


class MarketTests(unittest.TestCase):
    def test_csv_uses_actual_close_and_date_skips_nonfinite_and_future_rows(self):
        data = b'DATE,OPEN,HIGH,LOW,CLOSE\n11/02/2026,1,2,1,17\n11/03/2026,1,2,1,NaN\n11/04/2026,1,2,1,18\n11/06/2026,1,2,1,99\n'
        item = parse_csv(data, 'VIX', '2026-11-05')
        self.assertEqual((item['value'], item['previous'], item['change'], item['asOf']), (18, 17, 1, '2026-11-04'))
        self.assertEqual(parse_csv(b'DATE,VVIX\n11/04/2026,90.41\n', 'VVIX', '2026-11-05')['value'], 90.41)

    def test_block_page_or_missing_column_is_not_numeric_data(self):
        for data in [b'<html>Access denied</html>', b'DATE,OPEN\n11/04/2026,20\n', b'DATE,CLOSE\n11/04/2026,0\n']:
            with self.assertRaises(ValueError):
                parse_csv(data, 'VIX', '2026-11-05')

    def test_cnn_zero_is_real_and_latest_snapshot_replaces_same_day_history(self):
        data = {'fear_and_greed_historical': {'data': [{'x': 1793664000000, 'y': 35}]},
                'fear_and_greed': {'timestamp': '2026-11-03T23:59:59Z', 'score': 0},
                'put_call_options': {'score': 85, 'data': [{'x': 1793664000000, 'y': .8}]}}
        result = parse_cnn(json.dumps(data).encode(), '2026-11-05')
        self.assertEqual(result['fear_greed']['value'], 0)
        self.assertNotIn('put_call', result)  # Do not mix CNN's 5-day series with Cboe's daily ratio.

    def test_cnn_requires_valid_dates_and_range(self):
        for score in [101, -1, float('nan'), None]:
            data = {'fear_and_greed': {'timestamp': '2026-11-03', 'score': score}}
            self.assertEqual(parse_cnn(json.dumps(data).encode(), '2026-11-05'), {})

    def test_archive_preserves_provenance_and_observation_date(self):
        result = parse_archive(b'Date,Fear Greed,Rating\n2026-11-03,19.09,extreme fear\n', '2026-11-05')
        self.assertEqual(result['asOf'], '2026-11-03')
        self.assertTrue(result['indirect'])
        self.assertIn('github.com', result['url'])

    def test_put_call_checks_total_traded_volumes(self):
        payload = {'ratios': [{'name': 'TOTAL PUT/CALL RATIO', 'value': '.86'}],
                   'SUM OF ALL PRODUCTS': [{'name': 'VOLUME', 'call': 100, 'put': 86}]}
        self.assertEqual(parse_put_call(json.dumps(payload).encode(), '2026-11-04'), ['2026-11-04', .86])
        payload['ratios'][0]['value'] = '2'
        with self.assertRaises(ValueError):
            parse_put_call(json.dumps(payload).encode(), '2026-11-04')

    def test_refresh_failure_retains_value_date_and_archive_provenance_as_stale(self):
        def fail(_):
            raise RuntimeError('Offline')
        with tempfile.TemporaryDirectory() as folder:
            old = {'id':'fear_greed','value':19.09,'asOf':'2026-11-03','history':[['2026-11-03',19.09]],'indirect':True}
            (Path(folder)/'market.json').write_text(json.dumps({'items':[old]}))
            result = update(folder, fetch=fail, now=NOW)
            item = result['items'][0]
            self.assertEqual((item['value'], item['asOf'], item['status']), (19.09, '2026-11-03', 'stale'))
            self.assertTrue(item['indirect'])
            self.assertTrue(all(i['value'] is None for i in result['items'][1:]))

    def test_old_success_is_stale_and_empty_success_never_fakes_a_reading(self):
        def fetch(url):
            if url.endswith('_History.csv'):
                return b'DATE,CLOSE\n10/01/2026,20\n'
            raise RuntimeError('Unavailable')
        with tempfile.TemporaryDirectory() as folder:
            result = update(folder, fetch=fetch, now=NOW)
            self.assertEqual(result['items'][1]['status'], 'stale')
            self.assertEqual(result['items'][1]['asOf'], '2026-10-01')
            self.assertEqual(result['items'][0]['status'], 'unavailable')
            self.assertIsNone(result['items'][0]['value'])


if __name__ == '__main__':
    unittest.main()
