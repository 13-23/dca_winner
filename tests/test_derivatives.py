import datetime as dt
import unittest

from update_derivatives import collect, parse_rows


def row(day, open_interest, long, short, report_type="FutOnly"):
    return {
        "report_date_as_yyyy_mm_dd": day + "T00:00:00.000",
        "futonly_or_combined": report_type,
        "open_interest_all": str(open_interest),
        "lev_money_positions_long": str(long),
        "lev_money_positions_short": str(short),
    }


class DerivativesTests(unittest.TestCase):
    def test_cot_report_calculates_open_interest_and_leveraged_fund_net(self):
        current = parse_rows([
            row("2026-11-10", 1000, 300, 400),
            row("2026-11-17", 1200, 500, 350),
        ], "sp500")
        self.assertEqual(current["openInterest"], 1200)
        self.assertEqual(current["openInterestChange"], 200)
        self.assertEqual(current["net"], 150)
        self.assertEqual(current["netChange"], 250)
        self.assertEqual(current["status"], "순매수 우위")

    def test_cot_parser_rejects_wrong_scope_and_nonweekly_rows(self):
        with self.assertRaises(ValueError):
            parse_rows([row("2026-11-10", 100, 50, 60, "Combined"),
                        row("2026-11-17", 100, 50, 60, "Combined")], "sp500")
        with self.assertRaises(ValueError):
            parse_rows([row("2026-11-03", 100, 50, 60),
                        row("2026-11-17", 100, 50, 60)], "sp500")

    def test_collector_keeps_previous_on_network_failure(self):
        previous = {"id": "sp500", "status": "available", "futuresOnly": {"openInterest": 1}}
        result = collect(lambda _: (_ for _ in ()).throw(OSError("blocked")),
                         now=dt.datetime(2026, 11, 26, tzinfo=dt.timezone.utc), old={"sp500": previous})
        market = next(item for item in result["items"] if item["id"] == "sp500")
        self.assertEqual(market["futuresOnly"], {"openInterest": 1})
        self.assertEqual(market["status"], "retained")
        self.assertEqual(market["combinedStatus"], "unavailable")

    def test_combined_scope_reports_delta_adjusted_open_interest(self):
        result = parse_rows([
            row("2026-11-10", 2000, 500, 450, "Combined"),
            row("2026-11-17", 2100, 550, 400, "Combined"),
        ], "nasdaq100", "Combined")
        self.assertEqual(result["openInterest"], 2100)
        self.assertIn("combined", result["source"])


if __name__ == "__main__":
    unittest.main()
