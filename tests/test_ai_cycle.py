import datetime as dt
import pathlib
import tempfile
import unittest
from unittest.mock import patch

from update_ai_cycle import earnings_values, update, yield_pair


class AiCycleTests(unittest.TestCase):
    def test_release_uses_financial_statement_values_in_millions(self):
        period, values = earnings_values("""
            <p>Revenue for the quarter ended October 25, 2026.</p>
            <table>
              <tr><td>Revenue</td><td>$115.8</td><td>20</td></tr>
              <tr><td>Revenue</td><td>$</td><td>115,844</td><td>57,006</td></tr>
              <tr><td></td><td>Inventories</td><td>39,724</td></tr>
              <tr><td></td><td>Accounts receivable, net</td><td>81,033</td></tr>
            </table>
        """)
        self.assertEqual(period, dt.date(2026, 10, 25))
        self.assertEqual(values, {
            "revenue": 115_844_000_000,
            "inventory": 39_724_000_000,
            "receivables": 81_033_000_000,
        })

    def test_yield_uses_latest_observation_at_least_a_week_old(self):
        observations = {
            dt.date(2026, 11, 23): 4.92,
            dt.date(2026, 11, 17): 5.07,
            dt.date(2026, 11, 13): 5.12,
        }
        row = yield_pair(observations, "Treasury", "https://home.treasury.gov/")["yield"]
        self.assertEqual(row["previous"], 5.12)
        self.assertIn("2026-11-13", row["source"])

    def test_failed_collection_keeps_previous_data(self):
        point = {"current": 4.92, "previous": 5.12, "date": "2026-11-23"}
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory, "ai-cycle.json")
            with patch("update_ai_cycle.collect", return_value={"yield": point}), \
                 patch("update_ai_cycle.nv", side_effect=OSError("SEC unavailable")):
                update(path)
            with patch("update_ai_cycle.collect", side_effect=OSError("Treasury unavailable")), \
                 patch("update_ai_cycle.nv", side_effect=OSError("SEC unavailable")):
                result = update(path)
            self.assertEqual(result["yield"], point)
            self.assertEqual(result["_status"]["yield"], "retained")
            self.assertEqual(result["_status"]["inventory"], "unavailable")
