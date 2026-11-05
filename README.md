# 투자 도구 (적립식 평단 계산기 · 이평선 지지·저항)

GitHub Pages로 올리는 웹 버전입니다. 시세는 GitHub Actions가 **매일 두 번 자동으로** 야후 파이낸스에서 받아 `data/` 폴더에 저장하고, 페이지는 그 파일을 읽어 계산합니다.

- 평일 16:10 (한국장 마감 후)
- 화~토 06:20 (미국장 마감 후)

## 파일 구성

## 종목 검색과 추가

KORU, 카카오(035720.KS), 네이버(035420.KS), LG생활건강(051900.KS)을 종목 목록에 포함합니다. 검색창에서 한글명, 영문명, 6자리 국내 코드, 티커로 찾고 결과를 클릭하거나 Enter로 첫 결과를 선택할 수 있습니다. 공백은 무시하며 정확히 일치하는 결과를 먼저 표시합니다.

신규 종목은 `tickers.json`에 `symbol`, `label`, `group`을 추가합니다. 선택 항목 `aliases` 배열에 별칭을 넣으면 검색에도 사용됩니다. main 브랜치의 종목 목록이 변경되면 시세 수집이 자동 실행됩니다. 수집에 성공한 종목부터 사이트 목록에 표시됩니다.

화면에서 미등록 종목까지 바로 추가하는 후속 기능은 종목 검색 서비스와 서버 측 시세 수집이 필요합니다. GitHub Pages만 유지하려면 종목 추가 요청을 모아 검토 후 목록에 반영하는 방식이 적합합니다. 사용자 브라우저에 GitHub 쓰기 토큰을 저장하지 않습니다.

| 파일 | 하는 일 |
|---|---|
| `index.html` | 화면 (적립식 계산기 + 이평선 탭) |
| `styles.css` | 공통 디자인, 밝은·어두운 테마, 모바일 레이아웃 |
| `market.js`, `update_market.py` | 시장 보조지표 표시 및 일별 수집 |
| `tickers.json` | 업데이트할 종목 목록 |
| `update_data.py` | 시세를 받아 `data/`에 저장하는 스크립트 |
| `.github/workflows/update-data.yml` | 매일 자동 실행 설정 |
| `data/` | 시세 파일 (처음 실행하면 자동으로 생깁니다) |

## 포트폴리오 적립식 계산

계산기에서 **포트폴리오**를 선택하고 종목별 비중 합계를 100%로 맞춥니다. 최대 10개 종목, 공통 납입금·시작일·종료일·매수 주기를 설정할 수 있습니다. 매번 납입금만 비중대로 나누며 기존 보유분을 매도하거나 리밸런싱하지 않습니다.

- 모든 종목·환율의 공통 데이터 기간을 사용하며, 기간 조정 시 화면에 안내합니다.
- 해외 종목은 실제 매수일 환율로 매수하고 평가일 환율로 원화 환산합니다.
- 시장별 휴장일에는 배정금을 원화로 대기시킨 뒤 다음 거래일에 매수합니다. 정수 주 잔액은 원화로 다음 납입 회차에 이월합니다.
- 매일 매수는 선택한 시장 중 어느 곳이든 거래일인 날마다 납입합니다. 한국·미국 종가는 각 시장의 현지 날짜 기준이며 장중 동시 평가가 아닙니다.
- 비교 차트는 같은 날짜·총 납입금으로 각 종목에 전액 투자한 경우를 표시합니다. 수수료·세금은 제외하며 수정주가는 선택할 수 있습니다.
- 입력값과 계산 방식은 브라우저에 저장합니다. 단일 종목 계산과 이평선 차트도 계속 사용할 수 있습니다.

`portfolio.js`는 계산 로직, `portfolio-ui.js`는 화면입니다. 추가 패키지 설치 없이 `node --test tests/*.test.cjs`로 계산 테스트를 실행할 수 있습니다.

## 시장 보조지표

원금·평가금액 차트 아래에서 미국 시장의 공포·탐욕 지수, VIX, 전체 풋/콜비율, VIX9D, VVIX를 확인합니다. 단일 종목과 포트폴리오 화면 모두 같은 최신 자료를 사용합니다. 선택 종목이나 과거 적립 기간에 맞춘 수치가 아니며 계산 결과에도 반영하지 않습니다.

- VIX·VIX9D·VVIX: [Cboe 일별 CSV](https://www.cboe.com/tradable-products/vix/vix-historical-data).
- 전체 풋/콜비율: [Cboe 당일 전체 상품 옵션 통계](https://www.cboe.com/markets/us/options/market-statistics/daily). 발표 비율과 풋/콜 거래량이 일치하는지 검증합니다. CNN의 5일 평균 또는 주식 전용 비율과 혼용하지 않습니다.
- 공포·탐욕: [CNN](https://www.cnn.com/markets/fear-and-greed) 직접 수집을 먼저 시도합니다. 불가능하면 [공개 CNN 아카이브](https://github.com/whit3rabbit/fear-greed-data)를 사용하고 화면에 아카이브 출처를 표시합니다.
- 각 지표의 실제 기준일, 이전 관측값 대비 변화, 출처와 상태를 표시합니다. 추이 선택창은 확보한 최대 90개 관측값을 보여주며 풋/콜비율은 수집이 이어지면서 이력이 누적됩니다.
- 갱신 실패 시 이전 기준일과 값을 유지하고 오래된 자료로 표시합니다. 5일이 넘은 관측값도 오래된 자료로 취급합니다. 값이 없으면 수집 불가로 표시하며 임의의 점수로 채우지 않습니다.

기존 시세 업데이트 작업이 `update_market.py`를 함께 실행해 `data/market.json`을 갱신합니다. Actions 수동 실행 시 `market_only`를 켜면 보조지표만 갱신합니다. 웹 화면의 새로고침은 저장된 JSON을 다시 읽으며 외부 기관의 실시간 자료를 직접 요청하지 않습니다. 로컬에서는 `python update_market.py`로 수집할 수 있습니다. Python 표준 라이브러리만 사용합니다.

## 시장 위치 연구 — 실험적 10단계

바닥·발목·무릎·허벅지·허리·가슴·목·입·눈·정수리의 10단계를 표시하고, 단계를 누르면 해당 단계에서 출발한 과거 수익률과 추가 하락을 확인할 수 있습니다. 현재 단계는 미국 S&P 500 기준이며 선택한 개별 종목의 매매 신호가 아닙니다.

`POSITION_METHOD.md`는 분석 전에 고정한 규칙입니다. 가격·일봉/이전 완료 주 RSI·VIX 상대 위치를 동일 비중으로 합산하고, 매년 그 이전 점수로 경계를 정합니다. 외부 보조지표는 최소 1거래일 지연합니다. 다음 거래일 시가 진입과 미래 126거래일 종가 수익률로 순차 평가합니다. 공포탐욕 확장형은 2024년 이후 공통 날짜에서 별도로 비교하며, 풋/콜은 이력이 부족해 점수에 포함하지 않습니다.

첫 검증에서 낮은 단계가 이후 수익률 우위를 보인다는 가설은 지지되지 않았습니다. 화면에 판별력 미확인을 표시하며, 관측된 상승 비율을 미래 확률로 표현하지 않습니다. 월별 표본도 수익률 기간이 겹치고 현재 확보한 수정 가능한 과거 자료를 사용하므로 실제 당시 발표본을 이용한 실거래 검증과 다릅니다.

- `update_position_inputs.py`: Cboe VIX 전체 이력과 2021년 이후 CNN 공개 아카이브 확보. 원자료 해시·출처·수집 상태 보존.
- `market_position.py`: 표준 라이브러리만으로 재현 가능한 순차 검증 및 최신 단계 계산.
- `data/position.json`: 화면용 요약. `data/position-signals.json`: 기본형 월별 신호와 결과.
- `POSITION_RESULTS.md`: 단계별·비교군별·방향별·시기별 전체 결과.
- `position.js`: 실험 표시, 현재 단계, 단계별 관측 통계와 계산 근거.

재계산: `python update_position_inputs.py`, `python market_position.py`. 기존 시세 업데이트 Actions에도 연결되어 있습니다. 과거 수익률 계산은 배당·수수료·세금을 제외합니다. 추가 하락은 진입 후 63거래일 최저 **종가**를 진입 **시가**와 비교한 손실이며 MDD나 장중 최저 손실과 다릅니다.

## PER · PBR 밸류에이션

이평선 화면에서 최신 종가를 기준으로 환산한 PER·PBR과 고정 가격 밴드를 볼 수 있습니다. PER 밴드는 `기준 지수값 ÷ 기준 PER × 목표 PER`, PBR 밴드는 `기준 지수값 ÷ 기준 PBR × 목표 PBR`로 계산합니다. 기준일의 EPS/BPS를 고정한 참고 가격선이며, 과거 실제 PER/PBR 시계열이나 적정가격 판정이 아닙니다.

`update_valuations.py`가 Yahoo Finance에서 제공되는 지수별 실적 기준 PER와 PBR을 수집하고, S&P 500은 Yahoo 제공값이 없으면 Multpl 공개 Atom 피드를 사용해 `data/valuations.json`에 저장합니다. Multpl의 PER·PBR·지수값은 원문 타임스탬프가 모두 같을 때만 함께 사용하며, 출처 추정치임과 공개된 BPS 보고 기준월을 화면에 표시합니다. `valuation_sources.py`가 이 소스의 수집·검증을 담당합니다. 자동 제공 카드에는 출처 배수를 그대로 표시하고 차트 종가로 환산한 배수는 별도로 안내합니다. 같은 날짜의 출처 지수값과 차트 시세가 0.5% 넘게 다르면 차이도 알립니다. KRX 데이터 요청은 로그인이 필요하며, 현재 확인한 Nasdaq 공개 팩트시트에는 PER·PBR이 없어 다른 지수는 검증 가능한 값이 없으면 자료 없음으로 유지합니다. 가격·기준일·배수가 제공되지 않으면 자료 없음으로 표시합니다. 갱신 실패 시 이전 기준일을 유지하고 오래된 값임을 표시합니다. 지수별 자동 제공이 보장되지 않으며, 이때는 같은 출처·기준일에서 확인한 지수값과 배수를 직접 입력할 수 있습니다. 직접 입력값은 지수별로 현재 브라우저에만 저장됩니다. ETF 값을 지수 값으로 대체하지 않습니다.

검증: `node --test tests/*.test.cjs`, `python3 -m unittest discover -s tests -p 'test_*.py'`.

## 처음 설정하기 (10분)

### 1. 저장소 만들기
github.com 오른쪽 위 **+ → New repository**
- 이름: 예) `invest-tools`
- **Public** 선택 (무료 GitHub Pages는 공개 저장소에서만 됩니다)
- 나머지는 그대로 두고 **Create repository**

### 2. 파일 올리기
만든 저장소 화면에서 **uploading an existing file** 링크(또는 **Add file → Upload files**)를 누르고,
`index.html`, `styles.css`, `market.js`, `update_market.py`, `position.js`, `market_position.py`, `update_position_inputs.py`, `POSITION_METHOD.md`, `portfolio.js`, `portfolio-ui.js`, `valuation.js`, `tickers.json`, `update_data.py`, `update_valuations.py`, `valuation_sources.py`, `README.md`, `.nojekyll` 파일를 끌어다 놓은 뒤 **Commit changes**.

### 3. 자동 실행 설정 파일 만들기
`.github` 폴더는 숨김 폴더라 끌어다 놓기로는 잘 안 올라갑니다. 직접 만드는 게 확실해요.
1. **Add file → Create new file**
2. 파일 이름 칸에 `.github/workflows/update-data.yml` 을 그대로 입력 (슬래시를 치면 폴더가 자동으로 만들어집니다)
3. 받은 묶음의 `update-data.yml (자동실행 설정 - 3단계에서 복사용).txt` 파일을 메모장으로 열어 내용 전부 복사해 붙여넣기
4. **Commit changes**

### 4. 시세 처음 받기
1. 저장소 위쪽 **Actions** 탭
2. 왼쪽 **시세 업데이트** → 오른쪽 **Run workflow** → 초록 **Run workflow**
3. 1~2분 뒤 초록 체크가 뜨면 성공. 저장소에 `data` 폴더가 생깁니다.

> 실패(빨간 X)하면 **Settings → Actions → General → Workflow permissions**에서
> **Read and write permissions**를 선택하고 Save한 뒤 다시 실행해 보세요.

### 5. 웹페이지 켜기
1. **Settings → Pages**
2. Source: **Deploy from a branch**, Branch: **main** / **(root)** → **Save**
3. 2~3분 뒤 같은 화면 위쪽에 주소가 나옵니다: `https://아이디.github.io/invest-tools/`

이제 그 주소를 폰이나 PC 어디서든 열면 됩니다. 이후로는 아무것도 안 해도 매일 시세가 갱신돼요.

## 종목 추가하기
GitHub에서 `tickers.json`을 열고 연필 아이콘(Edit)을 눌러 한 줄 추가한 뒤 Commit하세요.

```json
{ "symbol": "035420.KS", "label": "NAVER", "group": "개별 종목" },
```

- 국내 코스피 종목은 `.KS`, 코스닥은 `.KQ`를 붙입니다.
- 줄 끝 쉼표에 주의하세요. 마지막 줄에는 쉼표가 없어야 합니다.
- 바로 보고 싶으면 Actions에서 **Run workflow**를 한 번 누르면 됩니다.
- `group`에 쓴 이름이 그대로 종목 선택 목록의 묶음 이름이 됩니다.

## 알아둘 점
- `index.html`을 내 컴퓨터에서 더블클릭해서 열면 시세 파일을 못 읽습니다. GitHub Pages 주소로 열어 주세요.
- 저장소가 60일 넘게 아무 변화가 없으면 GitHub가 예약 실행을 멈출 수 있습니다. 매일 시세가 커밋되므로 보통은 문제없지만, 멈췄다면 Actions 탭에서 다시 켜면 됩니다.
- 시세 출처는 야후 파이낸스이며 개인 참고용입니다. 투자 판단의 근거로 삼기 전에 증권사 시세와 대조해 보세요.
