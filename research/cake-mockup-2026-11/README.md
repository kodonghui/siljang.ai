# 09단계 목업 진행분 (2026-11-13, 체크포인트 전에 멈춤)

2026-11-13 10:11 KST에 동희님이 "혹시 잠시만 대기 // 클로드 계정 다른데서 작업하고싶은데"라고 하셔서 09단계(목업)를 멈췄습니다. 그때까지 세션 임시 폴더에만 있던 도구와 캔버스 파일을 이 폴더에 올렸습니다. 경로만 저장소 기준으로 바꿨고 값은 그대로입니다. 지금 상태와 다음 할 일은 [HANDOFF.md](HANDOFF.md)에 있습니다.

- 방향(후보 A 또는 B)은 아직 고르지 않았습니다. 그래서 `docs/09-mockup/`, `design/base.tokens.json`, `.corthex/project.json`의 09 항목, `.corthex/stages.json`의 09 항목은 아직 없습니다.
- 후보 토큰은 [`design/candidates/a.tokens.json`](../../design/candidates/a.tokens.json)과 [`b.tokens.json`](../../design/candidates/b.tokens.json)입니다. 원래 값은 이 폴더의 `make_tokens.py`입니다.
- 그린 아트보드는 3개입니다: 토큰 비교(`Main`), 후보 A와 B의 SCR-001 예약 링크 페이지 360(normal 전체 길이, empty 첫 화면). 나머지 10개는 `canvas.json`에 자리만 있고 파일은 없습니다. 그 10개를 쓰는 `gen.py`는 만들었지만 아직 한 번도 돌리지 않았습니다.

## 파일

| 파일 | 하는 일 | 돌리는 법 (저장소 맨 위에서) |
| --- | --- | --- |
| `make_tokens.py` | 후보 A·B 토큰의 원래 값. DTCG 2025.10 형식으로 씀(색은 `colorSpace`·`components`에 `hex`를 더함, 크기는 `value`·`unit`, 토큰마다 `$type`·`$description`) | `python3 -B research/cake-mockup-2026-11/make_tokens.py [출력 폴더]` (기본 `design/candidates`). 11/13에 저장소의 두 파일과 바이트까지 같게 나오는 것을 확인 |
| `contrast.py`, `contrast_pairs.txt` | WCAG 대비 계산. 한 줄에 `글자색 바탕색 기준 이름`, `//`로 시작하면 주석 | `python3 -B research/cake-mockup-2026-11/contrast.py < research/cake-mockup-2026-11/contrast_pairs.txt` |
| `css_vars.py` | 토큰 파일을 CSS 변수 목록으로 출력(경로를 `-`로 이음, 예: `--color-accent`, `--font-size-body`) | `python3 -B research/cake-mockup-2026-11/css_vars.py design/candidates/a.tokens.json`. 글꼴 이름을 큰따옴표로 내므로 아트보드에 넣을 때는 작은따옴표로 바꿈 |
| `dc2html.py` | 캔버스 아트보드(`*.dc.html`)를 혼자 열리는 HTML로 바꿈(검사용). `{{`가 있으면 멈춤 | `python3 -B research/cake-mockup-2026-11/dc2html.py <아트보드.dc.html> <출력.html>` |
| `check_local.js` | Playwright Chromium으로 HTML을 열어 corthex-uxui의 `page-check.js`(한국어 줄바꿈, 넘침, 글자 대비, 누름 영역)를 돌리고, 결과 JSON과 전체 페이지 PNG를 냄 | `node research/cake-mockup-2026-11/check_local.js <page-check.js> <HTML 절대 경로> <뷰포트 너비> [PNG]`. `page-check.js`는 corthex 플러그인의 `skills/corthex-uxui/scripts/page-check.js`. 뷰포트 너비는 아트보드 너비(Main 2640, A-SCR-001-360 816, B-SCR-001-360 864)로 줌. 360을 주면 아트보드가 화면보다 넓어 page-overflow 오류가 남(휴대폰 프레임 360은 아트보드 안에 있음). `HTTPS_PROXY`가 있으면 그 프록시로 Google Fonts를 받음 |
| `gen.py` | 남은 아트보드 10개(SCR-001 1280, SCR-016 360·1280, SCR-022 360·1280, 각각 A·B)를 토큰 변수만 쓰는 마크업으로 씀 | `python3 -B research/cake-mockup-2026-11/gen.py [이름 ...]`. **아직 돌리지 않음**(문법 검사만 통과). 높이는 이 폴더의 `heights.json`(없으면 1200)에서 읽고 `canvas/project/<이름>.dc.html`에 씀. 토큰 변수는 A·B-SCR-001-360 파일의 루트 `style`에서 가져옴 |
| `canvas/project/` | Claude Design 캔버스(Artifact의 Design 타입) 파일 내보내기: `canvas.json`(보드 13개 배치), `Main.dc.html`, `A-SCR-001-360.dc.html`, `B-SCR-001-360.dc.html` | 새 캔버스를 만들고 이 파일들을 `project/` 아래에 올림(HANDOFF 9절) |
| `HANDOFF.md` | 다른 계정으로 인계: 기준 상태, 01~08 결과, 09 진행분, 남은 일, 프로젝트 메모리 부록 | 읽기 |

## 후보 두 개

| | A 주문서 | B 쇼케이스 |
| --- | --- | --- |
| 생각 | 작업대 위 종이 주문서처럼 얇은 선으로 칸을 나누고 글과 숫자를 촘촘히 보이는 도구형 | 진열장처럼 사진이 먼저 보이고, 넓은 여백과 둥근 카드에 진한 청록 한 색을 넓게(위쪽 띠·메뉴·주요 버튼) 쓰는 가게형 |
| 토큰 | 51개: 색 18, 글자 13, 간격 7, 모서리 3, 선 굵기 2, 크기 8 | 55개: 색 19, 그림자 2, 글자 14, 간격 7, 모서리 4, 선 굵기 2, 크기 7 |
| 주요 색 | 바탕 `#F5F3EE`, 글자 `#1D1C1A`, 주요 `#2B4BA6`(볼펜 남색), 위험 `#B42318` | 바탕 `#F2F5F4`, 글자 `#14201F`, 주요 `#0E5A5C`(진한 청록), 위험 `#B42318` |
| 글꼴 | IBM Plex Sans KR 400·500·600·700, 크기 12·13·15·17·21·26 | 제목 Gothic A1 700·800, 본문 Noto Sans KR 400·500·700, 크기 13·14·16·19·24·32 |
| 간격·모서리 | 간격 2·4·8·12·16·24·32, 모서리 4·6·8 | 간격 4·8·12·16·24·32·48, 모서리 8·12·16·999 |
| 크기 | 누름 영역 44, 버튼 44(큰 버튼 48), 위쪽 막대 52, 1280 메뉴 220, 오른쪽 열 336, 참고 사진 104, 가운데 열 1040 | 누름 영역 44, 버튼 52, 위쪽 막대 60, 1280 메뉴 248, 오른쪽 열 380, 참고 사진 152, 가운데 열 1120 |

## 검사 (2026-11-13 10:2x KST, 이 폴더의 스크립트로 다시 돌림)

- 대비 26쌍(`contrast_pairs.txt`) 모두 기준을 넘습니다. 글자(기준 4.5:1)는 A 13쌍 중 가장 낮은 것이 위험 글자/연한 위험 바탕 5.65, B 9쌍 중 가장 낮은 것이 메뉴의 흐린 글자/주요 색 바탕 6.11입니다. 입력칸 테두리(기준 3:1)는 A 흰 바탕 3.72·종이 바탕 3.35, B 흰 바탕 3.38·바탕 3.08입니다. 이 숫자는 색 쌍 계산이고, 그린 화면에서 테두리를 잰 것은 아닙니다.
- `page-check.js`(Playwright Chromium, 뷰포트는 아트보드 너비, deviceScaleFactor 1):

| 아트보드 | 크기 | 결과 | 오류·경고·알림 | 읽은 글꼴 |
| --- | --- | --- | --- | --- |
| `Main` | 2640×2130 | 통과 | 0·0·2 (orphan-body 1, target-goal 1) | 두 후보의 글꼴 모두 |
| `A-SCR-001-360` | 816×1476 | 통과 | 0·0·0 | IBM Plex Sans KR 400·500·600·700 |
| `B-SCR-001-360` | 864×1988 | 통과 | 0·0·1 (orphan-body) | Gothic A1 800, Noto Sans KR 400·500·700 |

- 세 아트보드 모두 콘솔 오류 0, 가로 넘침 0입니다.
- 측정하지 않은 것(`page-check.js`가 재지 못한다고 내는 7가지): 키보드 포커스 순서와 보임, 세로 글, 이미지 위 글자 대비, 컨트롤 테두리·상태 표시 3:1(위 색 쌍 계산만 함), 스크린 리더가 읽는 순서와 이름, 움직임 줄이기를 켠 실제 화면, Shadow DOM·iframe 안.
- 눈으로 본 것(11/13 오전 기록): A·B-SCR-001-360은 전체 PNG를, `Main`은 네 조각 중 두 조각(A 위쪽, B 아래쪽)만 봤습니다. 새 계정에서는 다시 렌더링해서 봐야 합니다.

## 시안의 글과 숫자

- 06단계 예시([`research/cake-api-2026-11/api_examples.py`](../cake-api-2026-11/api_examples.py))에서 가져왔습니다: 가게 달빛케이크, 주문 K7Q3M9·P4X8N2, 오늘 11월 12일, 가격표(크기·맛·디자인·추가), 가게 정보 6줄.
- 예시와 다르게 둔 것:
  - 그린 것: SCR-001의 포트폴리오 사진을 3장으로 그림(예시 `BOOKING_PAGE`는 2장).
  - `gen.py`에만 있는 것: SCR-022 참고 사진 3장(예시는 1장), SCR-016 '오래된 순', SCR-001 1280의 '가게 카카오톡 채널 상담이 열려요', SCR-022 금액 변경의 '손님 결제 안내에 70,000원 → 75,000원으로 보내요'.
  - 이 글들은 08단계 화면 정의와 아직 대조하지 않았습니다. 정의에 없는 글은 시안에서 빼거나, 정의에 더할지 동희님께 확인합니다.

## 올리지 않은 것

- 렌더링한 HTML과 PNG: 위 명령으로 다시 만들 수 있습니다.
- Design 타입의 안내 글(타입 게시자가 쓴 파일): 새 계정에서 Design 타입으로 캔버스를 만들 때 다시 받습니다.
- 글꼴 확인용 임시 파일(`fonttest.*`).
