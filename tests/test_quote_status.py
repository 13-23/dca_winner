import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import update_data


class QuoteStatusTests(unittest.TestCase):
    def test_unchanged_confirmed_date_and_fetch_failure_are_distinct(self):
        ticker = {"symbol": "QQQ"}
        first = {"symbol": "QQQ", "name": "QQQ", "currency": "USD",
                 "fetchedAt": "2026-11-23T23:00:00Z",
                 "data": [["2026-11-23", 600]]}
        next_run = {**first, "fetchedAt": "2026-11-24T20:00:00Z",
                    "data": [*first["data"], ["2026-11-24", 601]]}
        with tempfile.TemporaryDirectory() as directory, patch.object(update_data, "DATA", directory):
            path = Path(directory) / "QQQ.json"
            with patch.object(update_data, "fetch", return_value=first):
                collected = update_data.collect_item(ticker, None)
            self.assertEqual(collected["quoteUpdate"]["status"], "collected")
            with patch.object(update_data, "fetch", return_value=next_run):
                unchanged = update_data.collect_item(ticker, collected)
            self.assertEqual(unchanged["quoteUpdate"]["status"], "unchanged")
            self.assertEqual(unchanged["quoteUpdate"]["closeDate"], "2026-11-23")
            saved = path.read_bytes()
            with patch.object(update_data, "fetch", side_effect=OSError("unavailable")):
                retained = update_data.collect_item(ticker, unchanged)
            self.assertEqual(retained["quoteUpdate"]["status"], "retained")
            self.assertEqual(retained["quoteUpdate"]["fetchedAt"], next_run["fetchedAt"])
            self.assertEqual(path.read_bytes(), saved)
