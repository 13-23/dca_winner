import json
import sys
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from drawdown_analysis import build, update, drawdown_cycles, ma_features, runs, duration_summary, forward_summary, add_months


def history(n=500, step=1):
    return [[(date(2000, 1, 1) + timedelta(days=i * step)).isoformat(), 100.0] for i in range(n)]


class DrawdownTests(unittest.TestCase):
    def test_one_threshold_entry_per_unrecovered_high_and_exact_boundary(self):
        dd, cycles = drawdown_cycles([100, 90, 95, 80, 95, 100, 90])
        self.assertEqual(len(cycles), 2)
        self.assertEqual(cycles[0]['crossings'][10], 1)
        self.assertEqual(cycles[0]['crossings'][20], 3)
        self.assertEqual(cycles[0]['recovery_i'], 5)
        self.assertEqual(cycles[1]['crossings'][10], 6)
        self.assertIsNone(cycles[1]['recovery_i'])
        self.assertAlmostEqual(dd[3], -.2)

    def test_period_does_not_reset_the_high_and_carries_old_episodes(self):
        rows = history(500, step=31)
        for row in rows[1:]:
            row[1] = 50
        result = build(rows)
        view = result['views']['10']
        level = next(x for x in view['levels'] if x['level'] == 20)
        self.assertAlmostEqual(result['current']['drawdown'], -.5)
        self.assertEqual(level['count'], 0)
        self.assertEqual(level['carriedIn'], 1)
        self.assertEqual(level['duration']['ongoing'], 0)  # carried-in is separate, not a new episode.
        self.assertEqual(level['occupancy'], 1)

    def test_ma_values_use_only_prices_known_at_each_day(self):
        rows = history(800)
        for i, row in enumerate(rows):
            row[1] += i / 100
        complete = ma_features(rows)
        partial = ma_features(rows[:600])
        self.assertEqual(complete[0][:600], partial[0])
        self.assertEqual(complete[1][:600], partial[1])
        self.assertIsNone(complete[0][198])
        self.assertAlmostEqual(complete[0][199], sum(r[1] for r in rows[:200]) / 200)
        self.assertTrue(any(x is not None for x in complete[1]))

    def test_ma_initial_below_is_left_censored_and_one_day_recovery_splits(self):
        events = runs([100, 90, 100, 90, 100], [None, 95, 95, 95, 95])
        self.assertTrue(events[0]['left_censored'])
        self.assertFalse(events[1]['left_censored'])
        self.assertEqual(events[1]['recovery_i'] - events[1]['start_i'], 1)

    def test_km_includes_censored_events_but_completed_mean_does_not(self):
        result = duration_summary([{'start_i': 0, 'recovery_i': 1}, {'start_i': 0, 'recovery_i': 7}, {'start_i': 7, 'recovery_i': None}], 9)
        self.assertEqual(result['median'], 4)
        self.assertEqual(result['mean'], 4)
        self.assertEqual(result['kmMedian'], 7)
        self.assertEqual(result['ongoing'], 1)
        self.assertIsNone(duration_summary([{'start_i': 0, 'recovery_i': None}], 5)['kmMedian'])

    def test_forward_entries_are_next_close_and_windows_do_not_overlap(self):
        rows = [[(date(2024, 1, 1) + timedelta(days=i)).isoformat(), 100.0] for i in range(120)]
        rows[0][1] = 50  # Signal price must not be used as entry.
        result = forward_summary(rows, [0, 1, 119], 3)
        self.assertEqual(result['n'], 1)
        self.assertEqual(result['overlapExcluded'], 1)
        self.assertEqual(result['incomplete'], 1)
        self.assertEqual(result['events'][0]['entry'], '2024-01-02')
        self.assertEqual(result['events'][0]['end'], '2024-04-02')
        self.assertEqual(result['median'], 0)
        self.assertEqual(result['worstAdditionalDecline'], 0)

    def test_incomplete_horizon_does_not_fabricate_outcomes(self):
        self.assertEqual(forward_summary(history(40), [0], 12)['n'], 0)
        self.assertIsNone(forward_summary(history(40), [0], 12)['lossRate'])
        self.assertEqual(add_months('2023-08-31', 6), '2024-02-29')

    def test_unconfirmed_current_candle_is_not_used(self):
        end = date(2026, 11, 6)
        rows = [[(end - timedelta(days=201-i)).isoformat(), 100] for i in range(202)]
        with tempfile.TemporaryDirectory() as folder:
            p = Path(folder) / '_NDX.json'
            p.write_text(json.dumps({'data': rows, 'fetchedAt': '2026-11-06T20:00:00+00:00'}))
            result = update(folder)
            self.assertEqual(result['asOf'], '2026-11-05')
            self.assertEqual(len(result['sourceSha256']), 64)
            p.write_text(json.dumps({'data': rows}))
            with self.assertRaises(ValueError):
                update(folder)

    def test_invalid_prices_or_duplicate_dates_fail(self):
        with self.assertRaises(ValueError):
            build(history(200))
        for bad in [0, -1, float('nan'), True]:
            rows = history()
            rows[100][1] = bad
            with self.assertRaises(ValueError):
                build(rows)
        rows = history()
        rows[2][0] = rows[1][0]
        with self.assertRaises(ValueError):
            build(rows)


if __name__ == '__main__':
    unittest.main()
