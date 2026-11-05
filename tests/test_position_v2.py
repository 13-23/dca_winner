from datetime import date,timedelta,datetime,timezone
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from market_position_v2 import add_months,rebound_outcome,summary,spaced,block_intervals,native_features,walk_forward,closed_prices
from test_position import prices


def fixture():
    rows=[];day=date(2023,12,29)
    while day<=date(2024,8,1):
        if day.weekday()<5:rows.append([day.isoformat(),100,100,100,105,95,1000])
        day+=timedelta(days=1)
    return rows


class ReboundTests(unittest.TestCase):
    def test_unconfirmed_today_bar_is_not_treated_as_final_close(self):
        p=[['2026-11-04',100],['2026-11-05',101]]
        morning=datetime(2026,11,5,1,29,tzinfo=timezone.utc)
        self.assertEqual(closed_prices(p,'kospi',morning),p[:1])
        self.assertEqual(closed_prices(p,'sp500',morning),p[:1])
        self.assertEqual(closed_prices(p,'kospi',datetime(2026,11,5,8,tzinfo=timezone.utc)),p)
        with self.assertRaises(ValueError):closed_prices(p,'kospi',datetime(2026,11,5))

    def test_price_fetch_records_imputed_ohlc_and_capture_time(self):
        import update_data
        response={'chart':{'result':[{'meta':{'currency':'USD'},'timestamp':[1704153600,1704240000],
          'indicators':{'quote':[{'close':[100,101],'open':[99,100],'high':[102,103],'low':[98,None],'volume':[1000,1000]}]}}]}}
        with patch.object(update_data,'MOCK',False),patch.object(update_data,'yahoo',return_value=response):
            output=update_data.fetch('^GSPC')
        self.assertEqual(output['ohlcEstimatedDates'],['2024-01-03'])
        self.assertIsNotNone(datetime.fromisoformat(output['fetchedAt']).tzinfo)

    def test_calendar_month_end_and_leap_day(self):
        self.assertEqual(add_months('2023-08-31'),'2024-02-29')
        self.assertEqual(add_months('2024-08-31'),'2025-02-28')
        self.assertEqual(add_months('2024-01-31'),'2024-07-31')

    def test_uses_next_open_and_inclusive_target_equality(self):
        p=fixture();p[1][3]=100;p[10][1]=110;p[10][4]=115;p[11][3]=112;p[11][4]=115
        o=rebound_outcome(p,0)
        self.assertEqual(o['entryDate'],p[1][0])
        self.assertTrue(o['targets']['10']['hit'])
        self.assertEqual(o['targets']['10']['hitDate'],p[10][0])
        self.assertEqual(o['targets']['10']['exitDate'],p[11][0])
        self.assertAlmostEqual(o['targets']['10']['strategyReturn'],.12)

    def test_miss_includes_loss_and_future_low_is_not_an_entry(self):
        p=fixture()
        for i in range(2,len(p)):p[i][1]=90;p[i][4]=100;p[i][5]=85
        o=rebound_outcome(p,0)
        self.assertFalse(o['targets']['10']['hit'])
        self.assertAlmostEqual(o['targets']['10']['strategyReturn'],-.1)
        self.assertEqual(o['entry'],100)
        self.assertEqual(o['low'],85)

    def test_true_low_uses_intraday_low_and_only_later_day_closes(self):
        p=fixture();p[20][5]=50;p[20][4]=200;p[21][1]=120;p[21][4]=125
        o=rebound_outcome(p,0)
        self.assertEqual(o['lowDate'],p[20][0])
        self.assertEqual(o['low'],50)
        self.assertAlmostEqual(o['postLowRebound'],1.4)  # 120/50 - 1, not same-day high 200.

    def test_expiry_last_trading_day_and_final_low_censoring(self):
        p=fixture();initial=rebound_outcome(p,0)
        end=next(i for i,r in enumerate(p) if r[0]==initial['endDate'])
        p[end][5]=40
        o=rebound_outcome(p,0)
        self.assertIsNone(o['postLowRebound'])
        self.assertFalse(o['postLowHit10'])
        self.assertEqual(o['endDate'],'2024-07-01')

    def test_incomplete_future_or_invalid_low_is_excluded(self):
        p=fixture()
        self.assertIsNone(rebound_outcome(p[:50],0))
        p[20][5]=None
        self.assertIsNone(rebound_outcome(p,0))

    def test_invalid_entry_outside_actual_daily_range_is_excluded(self):
        p=fixture();p[1][3]=500
        self.assertIsNone(rebound_outcome(p,0))

    def test_subsequent_rebound_average_has_separate_denominator(self):
        o=rebound_outcome(fixture(),0)
        rows=[{'date':'2024-01-01','stage':1,'outcome':o},
              {'date':'2024-02-01','stage':1,'outcome':{**o,'postLowRebound':None,'postLowObserved':False,'postLowHit10':False}}]
        s=summary(rows)
        self.assertEqual(s['n'],2);self.assertEqual(s['postLowN'],1);self.assertEqual(s['postLowUnobserved'],1)

    def test_nonoverlap_uses_calendar_expiry_and_not_stage_day_count(self):
        o=rebound_outcome(fixture(),0)
        rows=[{'outcome':o},{'outcome':{**o,'entryDate':'2024-04-01'}},
              {'outcome':{**o,'entryDate':'2024-07-02','expiry':'2025-01-02'}}]
        self.assertEqual(len(spaced(rows)),2)

    def test_block_bootstrap_is_reproducible_and_bounded(self):
        o=rebound_outcome(fixture(),0)
        rows=[{'stage':i%2+1,'outcome':o} for i in range(24)]
        a=block_intervals(rows,42);b=block_intervals(rows,42)
        self.assertEqual(a,b)
        self.assertEqual(a[1]['entryHit10CI'],[0,0])
        self.assertIsNone(a[10]['entryHit10CI'])

    def test_native_features_are_prefix_invariant(self):
        p=prices(2000)
        prefix=native_features(p[:1800])
        self.assertTrue(prefix)
        self.assertEqual(prefix,[r for r in native_features(p) if r['i']<1800])

    def test_year_boundaries_and_stages_do_not_use_future_outcomes(self):
        rows=[{'i':i,'date':'1999-01-01','score':i%100,'trend':'혼조'} for i in range(1260)]
        rows.append({'i':1260,'date':'2000-01-03','score':10,'trend':'혼조'})
        p=prices(1500);a,cuts=walk_forward(rows,p)
        changed=[{**r,'date':'2026-01-01','score':10000} for r in rows[:50]]
        b,cuts2=walk_forward(rows+changed,p)
        self.assertEqual(cuts[2000],cuts2[2000])
        self.assertEqual(a[0]['stage'],b[0]['stage'])


if __name__=='__main__':unittest.main()
