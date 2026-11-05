"""Refresh only the six study indexes, recording actual fetch/estimated-OHLC metadata."""
import json
from pathlib import Path
from update_data import fetch, file_name


def main():
    folder=Path(__file__).parent/'data';failures=[]
    for symbol in ['^GSPC','^IXIC','^NDX','^KS11','^KQ11','^DJI']:
        try:
            result=fetch(symbol)
            if str(result.get('name','')).startswith('MOCK'):
                raise ValueError('Research requires real source prices')
            path=folder/file_name(symbol);tmp=path.with_suffix('.tmp')
            tmp.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n',encoding='utf-8')
            tmp.replace(path)
            print(symbol,'rows',len(result['data']),'capture',result['fetchedAt'],'estimated OHLC',len(result['ohlcEstimatedDates']))
        except Exception as exc:
            failures.append(symbol);print('Index refresh failed; previous file retained:',symbol,type(exc).__name__)
    if failures:raise RuntimeError('Research price refresh failed: '+','.join(failures))


if __name__=='__main__':main()
