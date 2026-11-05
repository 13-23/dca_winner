import math
from pathlib import Path
import sys
import unittest
from datetime import date, timedelta
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from market_position import ranks, rsi, previous_week_rsi, lagged, thresholds, classify, outcomes, features, monthly, stats
from update_position_inputs import clean


def prices(n):
    result=[];day=date(1980,1,1)
    while len(result)<n:
        if day.weekday()<5:
            i=len(result);value=100+i*.1+math.sin(i/13)*4
            result.append([day.isoformat(),value,value,value*.999,value*1.01,value*.99,100])
        day+=timedelta(days=1)
    return result


class PositionTests(unittest.TestCase):
    def test_rsi_wilder_reference_and_constant_price(self):
        close=[44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28]
        self.assertAlmostEqual(rsi(close)[14],70.464135,places=5)
        self.assertEqual(rsi([10]*20)[-1],50)

    def test_percentile_excludes_current_and_future(self):
        self.assertEqual(ranks([1,2,3,100],3),[None,None,None,100])
        full=ranks([1,2,3,4,0,100],3)
        self.assertEqual(full[:5],ranks([1,2,3,4,0],3))

    def test_source_lag_is_strict_and_expires(self):
        self.assertEqual(lagged([['2026-01-02',20],['2026-01-05',30]],['2026-01-02','2026-01-05','2026-01-12']),
                         [(None,None),(20,'2026-01-02'),(None,None)])

    def test_weekly_rsi_does_not_see_current_week_or_future(self):
        p=prices(200)
        modified=[r[:] for r in p]
        for r in modified[150:]:r[1]*=20
        self.assertEqual(previous_week_rsi(p)[:150],previous_week_rsi(modified)[:150])
        self.assertEqual(previous_week_rsi(p)[:150],previous_week_rsi(p[:150]))

    def test_full_features_are_prefix_invariant(self):
        p=prices(2200);series=[[r[0],20+math.sin(i/17)*5] for i,r in enumerate(p)]
        # Same timestamps with a future shock must not change an earlier signal.
        before=features(p[:2000],{'vix':series[:2000]})
        full=features(p,{'vix':series})
        self.assertTrue(before)
        self.assertEqual(before,[r for r in full if r['i']<2000])

    def test_yearly_boundaries_exclude_entire_test_year(self):
        rows=[{'date':'1999-01-01','scores':{'relative':i%100}} for i in range(1260)]
        initial=thresholds(rows,'relative',2000)
        rows+=[{'date':'2000-01-01','scores':{'relative':-10000}},{'date':'2026-01-01','scores':{'relative':10000}}]
        self.assertEqual(initial,thresholds(rows,'relative',2000))
        self.assertEqual(classify(-1,initial),1)
        self.assertEqual(classify(100,initial),10)

    def test_forward_return_uses_next_open_not_signal_close(self):
        p=prices(300);p[1][3]=200;p[126][1]=220;p[3][1]=100
        result=outcomes(p,0)
        self.assertAlmostEqual(result['returns']['126'],.1)
        self.assertEqual(result['downside63'],-.5)
        self.assertIsNone(outcomes(p,299))

    def test_monthly_sampling_and_nonoverlapping_case_counts(self):
        rows=[]
        for i,day in enumerate(['2000-01-03','2000-01-04','2000-02-01','2000-03-01']):
            rows.append({'i':i*100,'date':day,'outcome':{'returns':{'21':.1,'63':.1,'126':.1,'252':None},'downside63':-.1}})
        sample=monthly(rows)
        self.assertEqual(len(sample),3)
        self.assertEqual(stats(sample)['spacedCases'],2)
        self.assertEqual(stats(sample)['horizons']['252']['n'],0)

    def test_input_rejects_block_page_and_insufficient_history(self):
        for raw in [b'<html>Access denied</html>',b'DATE,CLOSE\n11/04/2026,20\n']:
            with self.assertRaises(ValueError):clean(raw,'DATE','CLOSE','2026-11-05')


if __name__=='__main__':unittest.main()
