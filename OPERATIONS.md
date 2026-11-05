# DCA Winner 운영 안내

공개 화면: [GitHub Pages](https://13-23.github.io/dca_winner/) · 작업 이력: [GitHub Actions](https://github.com/13-23/dca_winner/actions) · 검색 서비스: Vercel `dca-winner-market`, `/api/quotes`.

## 화면과 데이터 배포

- 수정 사항을 PR로 올리면 계산·검색 자동 검사가 실행됩니다. `main`에 병합하면 통과한 코드를 GitHub Pages에 배포합니다. Pages의 게시 방식은 **GitHub Actions**입니다. 브라우저는 `release.json`에서 현재 공개된 저장소 버전을 확인할 수 있습니다.
- `시세 업데이트`는 평일 17:10과 화~토 07:10(한국 시간)에 시작하도록 예약되어 있습니다. 장 마감뿐 아니라 연구에서 미확정 봉을 제외하는 기준 시각도 지난 뒤에 실행합니다. 휴장일에는 새 거래일이 추가되지 않으며, Actions가 시작을 지연할 수 있습니다.
- 데이터 수집과 시장별 검증이 끝나면 `main`의 데이터와 보고서를 갱신합니다. 성공한 데이터 갱신은 별도 `사이트 검사 및 배포` 실행을 시작하므로, 봇이 올린 시세도 공개 사이트에 반영됩니다. 배포 후 공개 버전, 기본 시세, 시장 검증 자료, PSQ 검색·시세를 점검합니다.
- 수동 실행은 저장소 **Actions → 시세 업데이트 → Run workflow → main**을 사용합니다. 배포만 다시 하려면 **사이트 검사 및 배포 → Run workflow → main**입니다. 두 작업은 별개이며 배포 확인 단계가 실패해도 직전의 정상 페이지를 삭제하지 않습니다.

## 종목과 조회 서비스

- 기본 목록은 `tickers.json`입니다. PR로 종목을 추가하고 병합하면 시세를 수집한 뒤 목록이 갱신됩니다. 검색으로 추가한 포트폴리오 종목·비중은 사용자 브라우저에 보관합니다.
- `api/quotes.mjs`가 검색과 추가 시세를 제공합니다. Yahoo Finance(검색·일별 시세), 네이버 증권(국내 한글명·코드 검색)을 사용합니다. 제공처가 제한하거나 데이터를 지원하지 않으면 오류를 표시하며 저장 시세는 계속 사용할 수 있습니다.
- Vercel 프로젝트의 **Settings → Git**에 `13-23/dca_winner`를 연결하고 Production Branch를 `main`으로 두면 조회 서비스 변경도 배포됩니다. 이전 성공 배포와 비교해 `api/` 또는 `vercel.json` 변경이 없는 경우는 새 빌드를 건너뜁니다. Git 연결이 끊겼다면 GitHub의 Vercel 앱에 해당 저장소 접근 권한이 있는지 확인합니다.
- 연결 없이 수동으로 복구할 때는 해당 프로젝트에 `api/quotes.mjs`와 `vercel.json`을 소스로 배포하고, 프로덕션 주소의 `?action=search&q=PSQ`와 `?action=chart&symbol=PSQ`를 확인합니다. 서비스 주소를 변경하면 `index.html`과 `scripts/check_production.py`를 함께 갱신합니다.

## 장애 시 확인 순서

1. **시세 날짜가 오래됨**: `시세 업데이트`의 첫 실패 단계를 확인합니다. 시장 휴장이나 종가 확정 제외인지 살피고, 제공처 오류가 해소된 뒤 `main`에서 다시 실행합니다.
2. **시세는 갱신됐지만 화면에 안 보임**: `사이트 검사 및 배포`의 배포 및 공개 확인 단계와 `release.json` 버전을 확인합니다.
3. **기본 목록은 되지만 외부 종목만 안 됨**: Vercel `dca-winner-market`의 최신 정상 배포 및 런타임 로그, PSQ 검색·시세 응답을 확인합니다.
4. **코드 수정 후 문제가 발생함**: 영향을 준 변경만 되돌리는 PR을 만들어 검사를 통과한 뒤 배포합니다. 조회 서비스는 Vercel의 직전 정상 배포를 복구할 수 있습니다.

로컬 검사: `python -m unittest discover -s tests -p 'test_*.py'`, `node --test tests/*.test.cjs`. 공개 배포 확인: `python scripts/check_production.py`.
