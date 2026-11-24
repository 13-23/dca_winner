import hashlib
import json
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
import update_data
from drawdown_analysis import MARKETS


ROOT = Path(__file__).resolve().parents[1] / "data"


class DataAuditTests(unittest.TestCase):
    def test_published_quote_metadata_and_drawdown_inputs_agree(self):
        index = json.loads((ROOT / "index.json").read_text())
        for item in index["items"]:
            with self.subTest(symbol=item["symbol"]):
                asset = json.loads((ROOT / update_data.file_name(item["symbol"])).read_text())
                dates = [r[0] for r in asset["data"]]
                self.assertEqual(dates, sorted(set(dates)))
                self.assertEqual(item["currency"], asset["currency"])
                status = item.get("quoteUpdate", {})
                # A research-only refresh can replace index prices without updating the quote catalog.
                if status.get("fetchedAt") == asset.get("fetchedAt"):
                    self.assertEqual((item["first"], item["last"]), (dates[0], dates[-1]))
                    self.assertEqual(status.get("closeDate"), update_data.confirmed_date(asset))
                self.assertTrue(all(0 < l <= min(c,o) <= max(c,o) <= h and a > 0 and v >= 0
                                    for _,c,a,o,h,l,v in asset["data"]))
        for symbol, (_, source, report, _) in MARKETS.items():
            with self.subTest(symbol=symbol):
                raw = (ROOT / source).read_bytes()
                asset = json.loads(raw)
                stats = json.loads((ROOT / report).read_text())
                self.assertEqual(stats["sourceSha256"], hashlib.sha256(raw).hexdigest())
                self.assertEqual(stats["asOf"], update_data.confirmed_date(asset))

    def test_supplements_only_missing_confirmed_korean_index_sessions(self):
        capture = datetime(2026,11,24,1,53,tzinfo=timezone.utc)
        original = {"symbol":"^KS11","data":[["2026-11-20",4869.96,4869.96,4928.51,4971.31,4831.69,200000]]}
        xml = b"""<protocol><chartdata symbol="KOSPI">
        <item data="20261120|4928.51|4971.31|4831.69|4869.96|206729"/>
        <item data="20261123|4734.9|4759.88|4586.8|4708.54|218577"/>
        <item data="20261124|4880.16|5065.74|4880.16|5039.51|93505"/>
        </chartdata></protocol>"""
        with patch.object(update_data, "_get", return_value=xml):
            merged = update_data.supplement_kr_index(original,capture)
        self.assertEqual(merged["data"][0], original["data"][0])
        self.assertEqual(merged["data"][1][:2], ["2026-11-23",4708.54])
        self.assertEqual(merged["supplementalSources"], {"2026-11-23":"네이버 금융"})
        with patch.object(update_data, "_get", side_effect=OSError("timeout")):
            self.assertEqual(update_data.supplement_kr_index(original,capture,merged), merged)

    def test_short_range_merge_checks_adjustment_and_excludes_provisional_bars(self):
        rows = [["2026-11-20",90,85,90,90,90,10]]
        asset = {"fetchedAt":"2026-11-24T01:53:00+00:00","data":rows,"ohlcEstimatedDates":[]}
        recent = {"data":[*rows,["2026-11-23",100,100,100,100,100,20],
                          ["2026-11-24",110,110,110,110,110,30]],"ohlcEstimatedDates":[]}
        self.assertEqual([row[0] for row in update_data.merge_recent_us(asset,recent)["data"]],
                         ["2026-11-20","2026-11-23"])
        recent["data"][0] = ["2026-11-20",90,80,90,90,90,10]
        self.assertIs(update_data.merge_recent_us(asset,recent),asset)

    def test_verified_historical_corrections_survive_a_new_yahoo_response(self):
        capture = datetime(2026,11,24,1,53,tzinfo=timezone.utc)
        original = {"symbol":"^KS11","data":[["2021-04-23",3181.0801,3181.08,3173.47,3185.97,3146.54,1829400]]}
        verified = json.loads((ROOT / "_KS11.json").read_text())
        with patch.object(update_data, "_get", side_effect=OSError("offline")):
            supplemented = update_data.supplement_kr_index(original,capture,verified)
        self.assertEqual(supplemented["data"][0][:2],["2021-04-23",3186.1])
        self.assertEqual(supplemented["verifiedCorrections"],verified["verifiedCorrections"])
