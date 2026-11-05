"""Reproducible, causal-feature, yearly walk-forward position study (stdlib)."""
from bisect import bisect_left, bisect_right, insort
from collections import deque
from datetime import date, datetime, timezone
import hashlib
import json
import math
from pathlib import Path
from statistics import median

NAMES = ['바닥','발목','무릎','허벅지','허리','가슴','목','입','눈','정수리']
MODEL_NAMES = {'relative':'세 묶음·VIX 상대 기준','fixed':'세 묶음·VIX 고정 기준',
               'price':'가격만','momentum':'RSI 묶음만','vix':'VIX만', 'extended':'공포탐욕 확장형'}
HORIZONS = [21, 63, 126, 252]


def quantile(values, p):
    values = sorted(values)
    if not values:
        return None
    x = (len(values)-1)*p
    a = int(x)
    return values[a]+(values[min(a+1,len(values)-1)]-values[a])*(x-a)


def rsi(values, period=14):
    result = [None]*len(values)
    gain = loss = 0.0
    for i in range(1,len(values)):
        delta=values[i]-values[i-1]
        up,down=max(0,delta),max(0,-delta)
        if i<=period:
            gain+=up/period;loss+=down/period
        else:
            gain=(gain*(period-1)+up)/period
            loss=(loss*(period-1)+down)/period
        if i>=period:
            result[i]=50 if gain==loss==0 else 100 if loss==0 else 100-100/(1+gain/loss)
    return result


def previous_week_rsi(prices):
    groups=[]
    for row in prices:
        week=date.fromisoformat(row[0]).isocalendar()[:2]
        if not groups or groups[-1][0]!=week:
            groups.append([week,row[1]])
        else:
            groups[-1][1]=row[1]
    values=rsi([g[1] for g in groups])
    by_week={g[0]:values[i-1] if i else None for i,g in enumerate(groups)}
    return [by_week[date.fromisoformat(row[0]).isocalendar()[:2]] for row in prices]


def ranks(values, window=1260):
    """Current observation is never part of its own reference distribution."""
    history,ordered=deque(),[]
    result=[]
    for value in values:
        if value is None:
            result.append(None);continue
        result.append((bisect_left(ordered,value)+bisect_right(ordered,value))/2/len(ordered)*100
                      if len(ordered)>=window else None)
        history.append(value);insort(ordered,value)
        if len(history)>window:
            ordered.pop(bisect_left(ordered,history.popleft()))
    return result


def lagged(series, dates, max_age=5):
    keys=[r[0] for r in series]
    output=[]
    for day in dates:
        i=bisect_left(keys,day)-1
        if i<0 or (date.fromisoformat(day)-date.fromisoformat(keys[i])).days>max_age:
            output.append((None,None))
        else:
            output.append((series[i][1],keys[i]))
    return output


def fixed_vix(value):
    pairs=[(12,90),(20,60),(30,30),(40,10)]
    if value<=12:return 90
    for (a,x),(b,y) in zip(pairs,pairs[1:]):
        if value<=b:return x+(y-x)*(value-a)/(b-a)
    return 10


def features(prices, histories):
    dates=[r[0] for r in prices];close=[r[1] for r in prices]
    daily=rsi(close);weekly=previous_week_rsi(prices)
    draw=[close[i]/max(close[max(0,i-251):i+1])-1 if i>=251 else None for i in range(len(close))]
    distance=[close[i]/(sum(close[i-199:i+1])/200)-1 if i>=199 else None for i in range(len(close))]
    vix=lagged(histories['vix'],dates);fear=lagged(histories.get('fear_greed',[]),dates)
    d_rank,m_rank,r_rank,w_rank,v_rank=map(ranks,[draw,distance,daily,weekly,[v[0] for v in vix]])
    out=[]
    for i,day in enumerate(dates):
        if any(v[i] is None for v in [d_rank,m_rank,r_rank,w_rank,v_rank]):continue
        price=(d_rank[i]+m_rank[i])/2;momentum=(r_rank[i]+w_rank[i])/2;sentiment=100-v_rank[i]
        scores={'relative':(price+momentum+sentiment)/3,
                'fixed':(price+momentum+fixed_vix(vix[i][0]))/3,
                'price':price,'momentum':momentum,'vix':sentiment}
        if fear[i][0] is not None:
            scores['extended']=(price+momentum+(sentiment+fear[i][0])/2)/3
        ma20=sum(close[i-19:i+1])/20
        trend='하락 중' if close[i]<ma20 and daily[i]<daily[i-5] else '회복 중' if close[i]>ma20 and daily[i]>daily[i-5] else '혼조'
        out.append(dict(i=i,date=day,scores=scores,trend=trend,components=dict(price=price,momentum=momentum,fear=sentiment),
            raw=dict(drawdown=draw[i],distance200=distance[i],rsi14=daily[i],weeklyRsi14=weekly[i],vix=vix[i][0],vixDate=vix[i][1],fearGreed=fear[i][0],fearGreedDate=fear[i][1])))
    return out


def thresholds(rows, model, year):
    prior=[r['scores'][model] for r in rows if r['date'][:4]<str(year) and model in r['scores']]
    minimum=504 if model=='extended' else 1260
    return [quantile(prior,j/10) for j in range(1,10)] if len(prior)>=minimum else None


def classify(score, cuts):
    return bisect_right(cuts,score)+1


def outcomes(prices,i):
    if i+1>=len(prices) or len(prices[i+1])<4:return None
    entry=prices[i+1][3]
    if not isinstance(entry,(float,int)) or not math.isfinite(entry) or entry<=0:return None
    returns={str(h):prices[i+h][1]/entry-1 if i+h<len(prices) else None for h in HORIZONS}
    downside=min(0,min(r[1] for r in prices[i+1:i+64])/entry-1) if i+63<len(prices) else None
    return dict(entryDate=prices[i+1][0],entry=entry,returns=returns,downside63=downside)


def walk_forward(rows,prices,model):
    cuts={}
    result=[]
    for row in rows:
        if model not in row['scores']:continue
        year=int(row['date'][:4])
        if year not in cuts:cuts[year]=thresholds(rows,model,year)
        if cuts[year] is None or year<(2024 if model=='extended' else 2000):continue
        output=outcomes(prices,row['i'])
        result.append(dict(i=row['i'],date=row['date'],score=row['scores'][model],stage=classify(row['scores'][model],cuts[year]),
                           trend=row['trend'],outcome=output))
    return result,cuts


def monthly(rows):
    seen=set();result=[]
    for row in rows:
        key=row['date'][:7]
        if key not in seen:
            result.append(row);seen.add(key)
    return result


def stats(rows):
    complete=[r for r in rows if r['outcome'] and r['outcome']['returns']['126'] is not None]
    result={'n':len(complete)}
    six=[r['outcome']['returns']['126'] for r in complete]
    downs=[r['outcome']['downside63'] for r in complete]
    result.update(median6=quantile(six,.5),q25=quantile(six,.25),q75=quantile(six,.75),worst6=min(six) if six else None,
        winRate=sum(v>0 for v in six)/len(six) if six else None,
        medianDownside=quantile(downs,.5),worstDownside=min(downs) if downs else None)
    result['horizons']={}
    for h in HORIZONS:
        values=[r['outcome']['returns'][str(h)] for r in complete if r['outcome']['returns'][str(h)] is not None]
        result['horizons'][str(h)]={'n':len(values),'median':quantile(values,.5)}
    spaced=[];last=-10**9
    for row in complete:
        if row['i']-last>=126:
            spaced.append(row);last=row['i']
    result['spacedCases']=len(spaced)
    result['spacedMedian6']=quantile([r['outcome']['returns']['126'] for r in spaced],.5)
    return result


def summarize(rows):
    samples=monthly(rows)
    stages=[dict(stage=i,label=NAMES[i-1],**stats([r for r in samples if r['stage']==i])) for i in range(1,11)]
    medians=[s['median6'] for s in stages]
    pairs=[(a,b) for a,b in zip(medians,medians[1:]) if a is not None and b is not None]
    lower=stats([r for r in samples if r['stage']<=3]);upper=stats([r for r in samples if r['stage']>=8])
    spread=lower['median6']-upper['median6'] if lower['n'] and upper['n'] else None
    complete=[r for r in samples if r['outcome'] and r['outcome']['returns']['126'] is not None]
    return dict(start=rows[0]['date'] if rows else None,end=complete[-1]['date'] if complete else None,
        baseline=stats(samples),stages=stages,lower=lower,upper=upper,spread=spread,
        orderedPairs=sum(a>=b for a,b in pairs),totalPairs=len(pairs),
        directions={name:stats([r for r in samples if r['stage']<=3 and r['trend']==name]) for name in ['하락 중','혼조','회복 중']},
        eras=[dict(label=label,**stats([r for r in samples if lo<=r['date']<=hi]),
                   lower=stats([r for r in samples if lo<=r['date']<=hi and r['stage']<=3]),
                   upper=stats([r for r in samples if lo<=r['date']<=hi and r['stage']>=8])) for label,lo,hi in
              [('2000~2009','2000','2009-12-31'),('2010~2019','2010','2019-12-31'),('2020년 이후','2020','9999')]])


def build(root=None):
    root=Path(root or Path(__file__).parent)
    data=root/'data'
    price_bytes=(data/'_GSPC.json').read_bytes()
    prices=json.loads(price_bytes)['data']
    inputs_bytes=(data/'position-inputs.json').read_bytes();inputs=json.loads(inputs_bytes)
    if len(prices)<2000 or any(prices[i][0]>=prices[i+1][0] for i in range(len(prices)-1)):
        raise ValueError('Insufficient or unsorted S&P history')
    if any(not isinstance(r[1],(float,int)) or not math.isfinite(r[1]) or r[1]<=0 for r in prices):
        raise ValueError('Invalid S&P close')
    rows=features(prices,inputs['series'])
    if not rows:raise ValueError('No valid feature observations')
    models={};walks={};calibrations={}
    for model in MODEL_NAMES:
        walk,cuts=walk_forward(rows,prices,model);walks[model]=walk;calibrations[model]=cuts
        models[model]={'label':MODEL_NAMES[model],**summarize(walk)}
    # All variants in each comparison must use the same dates and next-open outcomes.
    common=set(r['date'] for r in walks['relative'])
    for name in ['fixed','price','momentum','vix']:
        common &= {r['date'] for r in walks[name]}
    comparison={name:summarize([r for r in walks[name] if r['date'] in common]) for name in ['relative','fixed','price','momentum','vix']}
    extdates={r['date'] for r in walks['extended']}
    extension={name:summarize([r for r in walks[name] if r['date'] in extdates]) for name in ['relative','extended']}
    current=rows[-1];year=int(current['date'][:4]);cuts=calibrations['relative'].get(year)
    latest=None
    if cuts:
        stage=classify(current['scores']['relative'],cuts)
        latest=dict(date=current['date'],stage=stage,label=NAMES[stage-1],score=current['scores']['relative'],trend=current['trend'],
                    components=current['components'],raw=current['raw'],cuts=cuts,referenceYear=year,
                    sourceStale=any(v['status']!='available' for v in inputs['sources'].values()))
    result=dict(version='research-v1',updated=datetime.now(timezone.utc).isoformat(),status='experimental',
        target='S&P 500 가격지수',horizon=126,labels=NAMES,latest=latest,models=models,comparison=comparison,extension=extension,
        sources={'priceSha256':hashlib.sha256(price_bytes).hexdigest(),'inputSha256':hashlib.sha256(inputs_bytes).hexdigest(),
                 'histories':inputs['sources']},samplePolicy='월별 첫 유효 신호 · 6개월 결과 중첩',
        limitations=['실제 당시 발표본이 아닌 현재 확보한 역사 자료 기반','수익률은 배당·비용 제외 가격수익률',
                      '10단계는 위치 분류이며 바닥·고점 적중 확률이 아님','월별 표본도 결과 기간이 겹침','공포탐욕 확장형의 검증 기간이 짧음'])
    (data/'position.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n',encoding='utf-8')
    (data/'position-signals.json').write_text(json.dumps({'version':'research-v1','monthlySignals':monthly(walks['relative'])},
        ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n',encoding='utf-8')
    report=make_report(result)
    (root/'POSITION_RESULTS.md').write_text(report,encoding='utf-8')
    print('Latest position:',latest)
    for name in comparison:
        s=comparison[name]
        print(name,'n=',s['baseline']['n'],'low-high=',s['spread'],'ordered=',s['orderedPairs'],'/',s['totalPairs'])
    return result


def make_report(result):
    pct=lambda v:'—' if v is None else f'{v*100:+.2f}%'
    rate=lambda v:'—' if v is None else f'{v*100:.2f}%'
    s=result['models']['relative'];latest=result['latest']
    lines=['# S&P 500 시장 위치 연구 v1 결과','',f"생성: {result['updated']}",
      '', '**실험적 위치 분류입니다. 바닥·고점 예측 모델로 검증이 완료된 것이 아닙니다.**', '',
      f"현재: {latest['date']} 종가 기준 {latest['stage']}단계 {latest['label']} · {latest['trend']} · 점수 {latest['score']:.2f}",
      '',f"평가 신호: {s['start']} ~ {s['end']}. 주표본은 월별 첫 신호이며 미래 126거래일이 확보된 {s['baseline']['n']}개입니다.",
      '가격·모멘텀·VIX 상대 위치를 동일 비중으로 합성했습니다. 매년 그해 이전 점수로만 경계를 계산했습니다.',
      '진입은 다음 거래일 시가, 결과는 종가·가격수익률입니다. 추가 하락은 이후 63거래일 최저 종가/진입 시가 - 1입니다.',
      '', '| 단계 | 월별 표본 | 간격 126일 이상 사례 | 6개월 중앙값 | 상승 비율 | 추가하락 중앙값 | 최악 추가하락 |',
      '|---|---:|---:|---:|---:|---:|---:|']
    for row in s['stages']:
        lines.append(f"| {row['stage']} {row['label']} | {row['n']} | {row['spacedCases']} | {pct(row['median6'])} | {rate(row['winRate'])} | {pct(row['medianDownside'])} | {pct(row['worstDownside'])} |")
    lines+=['',f"전체 월별 표본 6개월 중앙값: {pct(s['baseline']['median6'])}. 하위 1~3단계: {pct(s['lower']['median6'])}, 상위 8~10단계: {pct(s['upper']['median6'])}.",
      f"낮은 단계일수록 중앙값이 높은 인접 구간: {s['orderedPairs']}/{s['totalPairs']}. 10단계의 세밀한 서열은 이 수치만으로 검증되지 않습니다.",
      '', '## 동일 날짜의 기준 모델 비교', '', '| 모델 | 월별 표본 | 하위 3단계 6개월 중앙값 | 상위 3단계 | 차이 | 인접 순서 일치 |', '|---|---:|---:|---:|---:|---:|']
    for name,row in result['comparison'].items():
        lines.append(f"| {MODEL_NAMES[name]} | {row['baseline']['n']} | {pct(row['lower']['median6'])} | {pct(row['upper']['median6'])} | {pct(row['spread'])} | {row['orderedPairs']}/{row['totalPairs']} |")
    lines+=['','## 공포탐욕 확장형 — 별도 단기 표본','', '| 모델 | 월별 표본 | 하위 3단계 중앙값 | 상위 3단계 | 차이 |','|---|---:|---:|---:|---:|']
    for name,row in result['extension'].items():
        lines.append(f"| {MODEL_NAMES[name]} | {row['baseline']['n']} | {pct(row['lower']['median6'])} | {pct(row['upper']['median6'])} | {pct(row['spread'])} |")
    lines+=['','확장형의 짧은 표본을 기본형 장기 성과와 섞지 않습니다. 결과를 본 후 가중치나 단계 경계를 최적화하지 않았습니다.',
      '', '## 하위 1~3단계의 방향별 관측 결과', '', '| 방향 | 월별 표본 | 6개월 중앙값 | 최악 추가하락 |', '|---|---:|---:|---:|']
    for label,row in s['directions'].items():
        lines.append(f"| {label} | {row['n']} | {pct(row['median6'])} | {pct(row['worstDownside'])} |")
    lines+=['', '이 분할은 설명용이며, 결과를 보고 매매 규칙으로 채택하지 않았습니다.',
      '', '## 시기별 하위/상위 단계 비교', '', '| 기간 | 하위 1~3단계 표본 | 중앙값 | 상위 8~10단계 표본 | 중앙값 |','|---|---:|---:|---:|---:|']
    for row in s['eras']:
        lines.append(f"| {row['label']} | {row['lower']['n']} | {pct(row['lower']['median6'])} | {row['upper']['n']} | {pct(row['upper']['median6'])} |")
    lines+=[
      '', '## 해석 범위','']+['- '+v for v in result['limitations']]+[
      '- 간격을 둔 사례 수도 독립된 위기의 개수나 통계적 유의성을 뜻하지 않습니다.',
      '- 기본형을 미리 지정한 주모델로 유지합니다. 비교표의 최고 성과 모델로 사후 교체하지 않습니다.',
      '- POSITION_METHOD.md와 원자료 해시가 재현 기준입니다. 풋/콜 장기 자료가 부족해 점수에서 제외했습니다.',
      '- 같은 차트의 시장 보조지표는 최신 값이며 이 모델의 1일 지연 입력값과 다를 수 있습니다.','']
    return '\n'.join(lines)


if __name__=='__main__':
    build()
