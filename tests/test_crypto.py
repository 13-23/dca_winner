import unittest
from datetime import datetime, timezone
from unittest.mock import patch
import update_data

class CryptoTests(unittest.TestCase):
    def test_daily_source_preserves_weekends_and_drops_incomplete_utc_candle(self):
        class Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return cls(2026, 11, 9, 1, tzinfo=timezone.utc)
        days = [datetime(2026, 11, day, tzinfo=timezone.utc) for day in [6, 7, 8, 9]]
        for symbol in ['BTC-KRW', 'BTC-USD', 'ETH-KRW', 'ETH-USD']:
            payload={'chart':{'result':[{'meta':{'currency':symbol.split('-')[1],'gmtoffset':0},'timestamp':[int(d.timestamp()) for d in days],'indicators':{'quote':[{'close':[100,110,120,90]}]}}]}}
            with patch.object(update_data, 'yahoo', return_value=payload), patch.object(update_data, 'datetime', Clock):
                result=update_data.fetch(symbol)
            self.assertEqual([r[0] for r in result['data']], ['2026-11-06','2026-11-07','2026-11-08'])
            self.assertEqual(result['currency'],symbol.split('-')[1])
