"""Market-native, calendar-six-month rebound research. No fitted outcome weights."""
from bisect import bisect_right
from calendar import monthrange
from datetime import date, datetime, timezone, timedelta
import hashlib
import json
import math
from pathlib import Path
from random import Random
from statistics import mean, stdev
from market_position import NAMES, quantile, rsi, previous_week_rsi, ranks, monthly, classify

MARKETS = {
 'sp500':('S&P 500','^GSPC','_GSPC','USD'),
 'nasdaq':('나스닥 종합','^IXIC','_IXIC','USD'),
 'nasdaq100':('나스닥100','^NDX','_NDX','USD'),
 'kospi':('코스피','^KS11','_KS11','KRW'),
 'kosdaq':('코스닥','^KQ11','_KQ11','KRW'),
 'dow':('다우존스','^DJI','_DJI','USD'),
}
CORE=['sp500','nasdaq','nasdaq100','kospi']


def closed_prices(prices, key, captured):
    """Conservative final-bar cutoff: KR 17:00 KST; US 22:00 UTC (after EST/EDT close)."""
    if captured.tzinfo is None:raise ValueError('Capture time must be timezone-aware')
    hour=8 if key in ['kospi','kosdaq'] else 22
    return [r for r in prices if datetime.fromisoformat(r[0]+'T'+f'{hour:02d}'+':00:00+00:00')<=captured]


def add_months(iso, months=6):
    d=date.fromisoformat(iso);total=d.year*12+d.month-1+months;y,m=divmod(total,12);m+=1
    return date(y,m,min(d.day,monthrange(y,m)[1])).isoformat()


def native_features(prices):
    close=[r[1] for r in prices];daily=rsi(close);weekly=previous_week_rsi(prices)
    logs=[None]+[math.log(close[i]/close[i-1]) for i in range(1,len(close))]
    rv=[stdev(logs[i-19:i+1])*math.sqrt(252) if i>=20 else None for i in range(len(close))]
    draw=[close[i]/max(close[i-251:i+1])-1 if i>=251 else None for i in range(len(close))]
    distance=[close[i]/mean(close[i-199:i+1])-1 if i>=199 else None for i in range(len(close))]
    dr,mr,rr,wr,vr=map(ranks,[draw,distance,daily,weekly,rv]);result=[]
    for i,row in enumerate(prices):
        if any(a[i] is None for a in [dr,mr,rr,wr,vr]):continue
        components={'price':(dr[i]+mr[i])/2,'momentum':(rr[i]+wr[i])/2,'volatility':100-vr[i]}
        ma20=mean(close[i-19:i+1])
        trend='하락 중' if close[i]<ma20 and daily[i]<daily[i-5] else '회복 중' if close[i]>ma20 and daily[i]>daily[i-5] else '혼조'
        result.append(dict(i=i,date=row[0],score=mean(components.values()),trend=trend,components=components,
          raw={'close':close[i],'drawdown':draw[i],'distance200':distance[i],'rsi14':daily[i],'weeklyRsi14':weekly[i],'rv20':rv[i]}))
    return result


def rebound_outcome(prices, signal, dates=None):
    dates=dates or [r[0] for r in prices];entry_i=signal+1
    if entry_i>=len(prices):return None
    expiry=add_months(dates[entry_i])
    if dates[-1]<expiry:return None
    end=bisect_right(dates,expiry)-1
    window=prices[entry_i:end+1]
    if not window:return None
    entry=window[0][3] if len(window[0])>3 else None
    if not isinstance(entry,(int,float)) or not math.isfinite(entry) or entry<=0:return None
    if any(len(r)<6 or not all(isinstance(r[k],(int,float)) and math.isfinite(r[k]) and r[k]>0 for k in [1,4,5]) or
           r[5]>r[4] or r[1]<r[5]-1e-6 or r[1]>r[4]+1e-6 for r in window):
        return None
    if not window[0][5]-1e-6<=entry<=window[0][4]+1e-6:return None
    low_i=min(range(len(window)),key=lambda i:window[i][5]);low=window[low_i][5]
    later=window[low_i+1:]
    after=max(r[1] for r in later)/low-1 if later else None
    target_results={}
    for target in [.05,.10,.20]:
        hit_i=next((i for i,r in enumerate(window) if r[1]/entry-1>=target-1e-12),None)
        hit=window[hit_i] if hit_i is not None else None
        # A close-based trigger cannot know its closing price before that close.
        # Execute at the following open; the precommitted expiry closes regardless.
        exit_row=window[hit_i+1] if hit_i is not None and hit_i<len(window)-1 else window[-1]
        exit_price=exit_row[3] if hit_i is not None and hit_i<len(window)-1 else exit_row[1]
        if not isinstance(exit_price,(int,float)) or not math.isfinite(exit_price) or exit_price<=0:return None
        target_results[str(int(target*100))]=dict(hit=hit is not None,
          hitDate=hit[0] if hit else None,exitDate=exit_row[0],exitPrice=exit_price,strategyReturn=exit_price/entry-1,
          hitDays=(date.fromisoformat(hit[0])-date.fromisoformat(window[0][0])).days if hit else None)
    return dict(entryDate=window[0][0],entry=entry,expiry=expiry,endDate=window[-1][0],endReturn=window[-1][1]/entry-1,
      low=low,lowDate=window[low_i][0],lowReturn=low/entry-1,postLowRebound=after,
      postLowObserved=after is not None,postLowHit10=after is not None and after>=.10-1e-12,targets=target_results)


def walk_forward(rows, prices):
    cuts={};result=[];dates=[r[0] for r in prices]
    for row in rows:
        year=int(row['date'][:4])
        if year not in cuts:
            prior=[r['score'] for r in rows if r['date'][:4]<str(year)]
            cuts[year]=[quantile(prior,p/10) for p in range(1,10)] if len(prior)>=1260 else None
        if year<2000 or cuts[year] is None:continue
        result.append({**row,'stage':classify(row['score'],cuts[year]),'outcome':rebound_outcome(prices,row['i'],dates)})
    return result,cuts


def spaced(rows):
    result=[];end='0000'
    for row in rows:
        if row['outcome']['entryDate']>end:
            result.append(row);end=row['outcome']['expiry']
    return result


def summary(rows, include_spaced=True):
    rows=[r for r in rows if r['outcome'] is not None]
    o=[r['outcome'] for r in rows];n=len(o)
    means=lambda values:mean(values) if values else None
    values=[r['targets']['10']['strategyReturn'] for r in o]
    rebounds=[r['postLowRebound'] for r in o if r['postLowRebound'] is not None]
    s=dict(n=n,entryHit10=means([r['targets']['10']['hit'] for r in o]),
      strategyMean=means(values),strategyMedian=quantile(values,.5),strategyQ25=quantile(values,.25),strategyQ75=quantile(values,.75),
      strategyWorst=min(values) if values else None,endMean=means([r['endReturn'] for r in o]),
      endMedian=quantile([r['endReturn'] for r in o],.5),endWinRate=means([r['endReturn']>0 for r in o]),
      lowMean=means([r['lowReturn'] for r in o]),lowMedian=quantile([r['lowReturn'] for r in o],.5),
      lowWorst=min([r['lowReturn'] for r in o]) if o else None,
      postLowMean=means(rebounds),postLowMedian=quantile(rebounds,.5),postLowHit10=means([r['postLowHit10'] for r in o]),
      postLowN=len(rebounds),postLowUnobserved=n-len(rebounds),
      hitDaysMedian=quantile([r['targets']['10']['hitDays'] for r in o if r['targets']['10']['hit']],.5),
      sensitivity={t:dict(hitRate=means([r['targets'][t]['hit'] for r in o]),
                         strategyMean=means([r['targets'][t]['strategyReturn'] for r in o])) for t in ['5','10','20']})
    if include_spaced:
        nonoverlap=spaced(rows);s['spaced']=summary(nonoverlap,False)
        s['insufficient']=n<12 or len(nonoverlap)<5
    return s


def block_intervals(samples, seed, reps=1000):
    """Resample full chronological monthly sequence before conditioning on stage."""
    n=len(samples);rng=Random(seed);draws={i:{'hit':[],'mean':[]} for i in range(11)}
    if not n:return {}
    for _ in range(reps):
        indices=[]
        while len(indices)<n:
            start=rng.randrange(n);indices.extend((start+j)%n for j in range(6))
        counts=[0]*11;wins=[0]*11;sums=[0.0]*11
        for idx in indices[:n]:
            row=samples[idx];s=row['stage'];o=row['outcome'];hit=o['targets']['10']['hit'];ret=o['targets']['10']['strategyReturn']
            for key in [0,s]:counts[key]+=1;wins[key]+=hit;sums[key]+=ret
        for key in range(11):
            if counts[key]:draws[key]['hit'].append(wins[key]/counts[key]);draws[key]['mean'].append(sums[key]/counts[key])
    return {key:{'entryHit10CI':[quantile(v['hit'],.025),quantile(v['hit'],.975)] if len(v['hit'])>=800 else None,
                 'strategyMeanCI':[quantile(v['mean'],.025),quantile(v['mean'],.975)] if len(v['mean'])>=800 else None,
                 'bootstrapValid':len(v['hit'])} for key,v in draws.items()}


def study(rows, seed, bootstrap=True):
    # Monthly first valid signal is selected BEFORE maturity filtering.
    samples=[r for r in monthly(rows) if r['outcome'] is not None]
    intervals=block_intervals(samples,seed) if bootstrap else {}
    stages=[]
    for i in range(1,11):
        selected=[r for r in samples if r['stage']==i]
        s=summary(selected)
        ci=intervals.get(i,{}) if not s['insufficient'] else {'entryHit10CI':None,'strategyMeanCI':None}
        stages.append(dict(stage=i,label=NAMES[i-1],**s,**ci,
          examples=[{'date':r['date'],'outcome':r['outcome']} for r in selected[-5:]]))
    baseline={**summary(samples),**intervals.get(0,{})}
    return dict(start=samples[0]['date'] if samples else None,end=samples[-1]['date'] if samples else None,
      baseline=baseline,stages=stages,
      lower=summary([r for r in samples if r['stage']<=3]),upper=summary([r for r in samples if r['stage']>=8]),
      eras=[dict(label=label,**summary([r for r in samples if lo<=r['date']<=hi]),
                 lower=summary([r for r in samples if lo<=r['date']<=hi and r['stage']<=3]),
                 upper=summary([r for r in samples if lo<=r['date']<=hi and r['stage']>=8])) for label,lo,hi in
        [('2000~2009','2000','2009-12-31'),('2010~2019','2010','2019-12-31'),('2020년 이후','2020','9999')]],
      directions={d:summary([r for r in samples if r['stage']<=3 and r['trend']==d]) for d in ['하락 중','혼조','회복 중']})


def build(root=None):
    root=Path(root or Path(__file__).parent);data=root/'data';markets={};walks={};cases={}
    index=json.loads((data/'index.json').read_text(encoding='utf-8'))
    legacy_capture=datetime.strptime(index['updated'],'%Y-%m-%d %H:%M KST').replace(tzinfo=timezone(timedelta(hours=9)))
    for key,(label,symbol,file,currency) in MARKETS.items():
        raw=(data/(file+'.json')).read_bytes();payload=json.loads(raw)
        if str(payload.get('name','')).startswith('MOCK'):raise ValueError('Synthetic data cannot produce a market study')
        captured=datetime.fromisoformat(payload['fetchedAt']) if payload.get('fetchedAt') else legacy_capture
        prices=closed_prices(payload['data'],key,captured)
        estimated=set(payload.get('ohlcEstimatedDates',[]))
        prices=[r[:] for r in prices]
        for r in prices:
            if r[0] in estimated:r[5]=None  # Exclude imputed OHLC windows instead of treating replacements as real lows.
        if len(prices)<3000 or any(prices[i][0]>=prices[i+1][0] for i in range(len(prices)-1)):
            raise ValueError('Insufficient/unsorted history: '+key)
        if any(not isinstance(r[1],(int,float)) or not math.isfinite(r[1]) or r[1]<=0 for r in prices):
            raise ValueError('Invalid market close: '+key)
        feats=native_features(prices);walk,cuts=walk_forward(feats,prices);walks[key]=walk
        latest=None
        if walk:
            row=walk[-1];latest={k:row[k] for k in ['date','score','trend','stage','components','raw']}
            latest.update(label=NAMES[row['stage']-1],cuts=cuts[int(row['date'][:4])],referenceYear=int(row['date'][:4]))
        seed=1701+sum(map(ord,key))
        markets[key]=dict(label=label,symbol=symbol,currency=currency,latest=latest,study=study(walk,seed),
          priceHistory=dict(first=prices[0][0],last=prices[-1][0],rawLast=payload['data'][-1][0],rows=len(prices),
            excludedUnconfirmedBars=len(payload['data'])-len(prices),capturedAt=captured.isoformat(),
            ohlcProvenance='recorded' if 'ohlcEstimatedDates' in payload else 'legacy-unknown',estimatedOHLC=len(estimated),
            sha256=hashlib.sha256(raw).hexdigest(),source='Yahoo Finance · 프로젝트 일별 OHLC'))
        candidates=monthly(walk)
        immature=[r for r in candidates if r['i']+1>=len(prices) or add_months(prices[r['i']+1][0])>prices[-1][0]]
        markets[key]['sampleAudit']=dict(monthlySignals=len(candidates),incompleteSixMonths=len(immature),
          invalidCompletedWindows=len(candidates)-len(immature)-markets[key]['study']['baseline']['n'])
        cases[key]=[{k:r[k] for k in ['date','stage','score','trend','outcome']} for r in monthly(walk)]
    common=None
    for key in CORE:
        months={r['date'][:7] for r in monthly(walks[key]) if r['outcome'] is not None}
        common=months if common is None else common&months
    comparison={key:study([r for r in walks[key] if r['date'][:7] in common],1701+sum(map(ord,key)),False) for key in CORE}
    output=dict(version='research-v2',updated=datetime.now(timezone.utc).isoformat(),labels=NAMES,markets=markets,
      primaryTarget=.10,horizon='달력상 6개월',execution='target-close-confirmation-next-open; precommitted-expiry-close',bootstrap=dict(repetitions=1000,blockMonths=6,confidence=.95),
      commonMonths=dict(n=len(common),start=min(common) if common else None,end=max(common) if common else None,comparison=comparison),
      limitations=['월별 표본도 6개월 결과 기간이 겹침','현재 확보한 수정 가능한 역사 자료 기반',
                  '최저가 뒤 최대 반등은 미래 최저가를 알아야 하는 사후 참고치','관측률·평균·95% 구간은 미래 성과 보장이 아님',
                  '가격지수 시뮬레이션이며 배당·비용·환율 제외'])
    (data/'position-v2.json').write_text(json.dumps(output,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n',encoding='utf-8')
    (data/'position-v2-signals.json').write_text(json.dumps(dict(version='research-v2',markets=cases),ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n',encoding='utf-8')
    (root/'POSITION_V2_RESULTS.md').write_text(report(output),encoding='utf-8')
    for key,m in markets.items():
        s=m['study'];print(key,'stage',m['latest']['stage'] if m['latest'] else None,'n',s['baseline']['n'],
            'entryHit10',s['baseline']['entryHit10'],'mean',s['baseline']['strategyMean'],
            'low-stage mean',s['lower']['strategyMean'],'high-stage mean',s['upper']['strategyMean'])
    return output


def report(data):
    pct=lambda v:'—' if v is None else f'{v*100:+.2f}%'
    rate=lambda v:'—' if v is None else f'{v*100:.1f}%'
    ci=lambda v:'—' if not v else f'{v[0]*100:.1f}% ~ {v[1]*100:.1f}%'
    lines=['# 시장별 6개월 반등 연구 v2','',f"생성: {data['updated']}",'',
      '**관측 비율은 확정된 미래 확률이 아닙니다. 저점 뒤 반등 폭과 신호 진입 전략의 손익을 구분합니다.**','',
      '공통 기본형: 각 지수 자신의 가격 위치·일봉/이전 완료 주 RSI·20일 실현변동성. 시장별 과거 5년 백분위, 동일 비중, 매년 이전 연도까지만으로 10단계 경계 계산.',
      '신호 다음 거래일 시가 진입. 달력상 6개월 내 종가 +10% 도달 확인 후 다음 거래일 시가 청산, 미도달 또는 만기일 도달 시 사전 지정한 만기 종가 청산. 아래 평균은 실패 사례도 포함하며 비용·배당·환율을 제외합니다.',
      '최저가는 6개월 안의 일별 저가 최솟값. 최저가 뒤 반등은 그 다음 거래일부터 같은 만기까지의 최고 종가 기준 사후 참고치입니다.',
      '95% 구간은 월별 순서의 6개월 원형 이동블록 부트스트랩 1,000회입니다. 비중첩 사례 결과도 따로 표시합니다.','']
    for key,m in data['markets'].items():
        s=m['study'];latest=m['latest'];b=s['baseline']
        lines += [f"## {m['label']} ({m['symbol']})",'',
          f"원자료: {m['priceHistory']['first']} ~ {m['priceHistory']['last']}, {m['priceHistory']['rows']}거래일. 검증 월별 표본: {s['start']} ~ {s['end']}, {b['n']}개.",
          f"가격 수집시각: {m['priceHistory']['capturedAt']}. 미확정 봉 제외 {m['priceHistory']['excludedUnconfirmedBars']}개. OHLC 보완 이력: {m['priceHistory']['ohlcProvenance']} ({m['priceHistory']['estimatedOHLC']}일).",
          f"제외: 아직 6개월 미완성 {m['sampleAudit']['incompleteSixMonths']}개, 완성 창의 잘못된 OHLC {m['sampleAudit']['invalidCompletedWindows']}개.",
          f"현재: {latest['date']} {latest['stage']}단계 {latest['label']} · {latest['trend']}." if latest else '현재 단계 산출 요건 미충족.',
          f"전체 기준선: +10% 도달률 {rate(b['entryHit10'])}, 반등 전략 평균 {pct(b['strategyMean'])}, 최저가까지 하락 평균 {pct(b['lowMean'])}.",'',
          '| 단계 | 월별 / 비중첩 | +10% 도달률 [95%] | 전략 평균 [95%] | 전략 최악 | 최저가 하락 평균 / 최악 | 사후 저점반등 평균 (표본) |',
          '|---|---:|---:|---:|---:|---:|---:|']
        for r in s['stages']:
            lines.append(f"| {r['stage']} {r['label']}{' · 표본 부족' if r['insufficient'] else ''} | {r['n']} / {r['spaced']['n']} | {rate(r['entryHit10'])} [{ci(r.get('entryHit10CI'))}] | {pct(r['strategyMean'])} [{ci(r.get('strategyMeanCI'))}] | {pct(r['strategyWorst'])} | {pct(r['lowMean'])} / {pct(r['lowWorst'])} | {pct(r['postLowMean'])} ({r['postLowN']}) |")
        lines += ['', '| 단계 | 저점 후 +10% 관측률 | 후속 관측 불가 | 만기 평균 | 비중첩 +10% 도달률 | 비중첩 전략 평균 |', '|---|---:|---:|---:|---:|---:|']
        for r in s['stages']:
            lines.append(f"| {r['stage']} {r['label']} | {rate(r['postLowHit10'])} | {r['postLowUnobserved']} | {pct(r['endMean'])} | {rate(r['spaced']['entryHit10'])} | {pct(r['spaced']['strategyMean'])} |")
        lines += ['', '### 목표값 민감도 — 전체 월별 표본', '', '| 목표 | 도달률 | 미도달 손익 포함 전략 평균 |','|---|---:|---:|']
        for target,row in b['sensitivity'].items():lines.append(f"| +{target}% | {rate(row['hitRate'])} | {pct(row['strategyMean'])} |")
        lines += ['', '### 시기별 하위·상위 단계', '', '| 기간 | 전체 표본 | 하위 1~3 표본 / 전략 평균 | 상위 8~10 표본 / 전략 평균 |','|---|---:|---:|---:|']
        for row in s['eras']:lines.append(f"| {row['label']} | {row['n']} | {row['lower']['n']} / {pct(row['lower']['strategyMean'])} | {row['upper']['n']} / {pct(row['upper']['strategyMean'])} |")
        lines += ['', '### 낮은 단계의 방향별 결과', '', '| 방향 | 월별 표본 | +10% 도달률 | 전략 평균 |','|---|---:|---:|---:|']
        for label,row in s['directions'].items():lines.append(f"| {label} | {row['n']} | {rate(row['entryHit10'])} | {pct(row['strategyMean'])} |")
        lines.append('')
    c=data['commonMonths'];lines += ['## 공통 달의 시장 비교','',f"{c['start']} ~ {c['end']}, 공통 {c['n']}개월. 각국 첫 거래일은 다릅니다.",'',
      '| 시장 | 표본 | +10% 도달률 | 전략 평균 | 최저가 하락 평균 | 만기 평균 |','|---|---:|---:|---:|---:|---:|']
    for key,s in c['comparison'].items():
        b=s['baseline'];lines.append(f"| {data['markets'][key]['label']} | {b['n']} | {rate(b['entryHit10'])} | {pct(b['strategyMean'])} | {pct(b['lowMean'])} | {pct(b['endMean'])} |")
    lines+=['','## 해석과 재현','']+['- '+v for v in data['limitations']]+[
      '- +10% 미도달 사례도 전략 평균에 포함합니다. 최저가가 만기 마지막 날이면 이후 반등은 미관측이며 성공으로 세지 않습니다.',
      '- 사후 저점 반등 평균은 후속 종가가 존재하는 사례만 분모로 사용합니다. 전략 기대수익과 다릅니다.',
      '- 표본 부족은 월별 12개 미만 또는 비중첩 5개 미만입니다. 비중첩 사례도 동일 위기/시장 국면을 완전히 독립으로 만들지 못합니다.',
      '- POSITION_V2_METHOD.md, market_position_v2.py, 원자료 SHA256 및 data/position-v2-signals.json으로 계산을 재현할 수 있습니다.',
      '- v1의 VIX 기본 점수와 다른 공통 기본형입니다. 서로 다른 버전의 성과를 같은 모델로 합치지 않습니다.','']
    lines.insert(-1,'- 이미 알려진 역사 자료를 보고 설계한 연구이므로 연도별 순차 계산만으로 완전히 미사용한 외부 검증·실거래 전방 검증을 대신하지 못합니다.')
    return '\n'.join(lines)


if __name__=='__main__':build()
