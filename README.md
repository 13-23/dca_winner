# 투자 도구 (적립식 평단 계산기 · 이평선 지지·저항)

GitHub Pages로 올리는 웹 버전입니다. 시세는 GitHub Actions가 **매일 두 번 자동으로** 야후 파이낸스에서 받아 `data/` 폴더에 저장하고, 페이지는 그 파일을 읽어 계산합니다.

- 평일 16:10 (한국장 마감 후)
- 화~토 06:20 (미국장 마감 후)

## 파일 구성

| 파일 | 하는 일 |
|---|---|
| `index.html` | 화면 (적립식 계산기 + 이평선 탭) |
| `tickers.json` | 업데이트할 종목 목록 |
| `update_data.py` | 시세를 받아 `data/`에 저장하는 스크립트 |
| `.github/workflows/update-data.yml` | 매일 자동 실행 설정 |
| `data/` | 시세 파일 (처음 실행하면 자동으로 생깁니다) |

## 처음 설정하기 (10분)

### 1. 저장소 만들기
github.com 오른쪽 위 **+ → New repository**
- 이름: 예) `invest-tools`
- **Public** 선택 (무료 GitHub Pages는 공개 저장소에서만 됩니다)
- 나머지는 그대로 두고 **Create repository**

### 2. 파일 올리기
만든 저장소 화면에서 **uploading an existing file** 링크(또는 **Add file → Upload files**)를 누르고,
`index.html`, `tickers.json`, `update_data.py`, `README.md` 네 개를 끌어다 놓은 뒤 **Commit changes**.

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
