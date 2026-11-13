# 09단계 목업 도구

09단계(목업)의 원본과 도구입니다. 후보 비교, 그린 화면과 상태, 검사 결과, 시안의 글과 숫자, 체크포인트 질문은 [`docs/09-mockup/README.md`](../../docs/09-mockup/README.md)에 있습니다.

- 2026-11-13 10:11 KST에 동희님이 "혹시 잠시만 대기 // 클로드 계정 다른데서 작업하고싶은데"라고 하셔서 09단계를 멈추고, 세션 임시 폴더에만 있던 도구와 캔버스 파일을 이 폴더에 올렸습니다(인계 문서 [HANDOFF.md](HANDOFF.md), PR #18). 그때 그린 아트보드는 3개(`Main`, A·B-SCR-001-360)였습니다.
- 같은 날 새 계정에서 캔버스를 새로 만들고(https://claude.ai/artifact/1Jb9SwBK66MzN2dNd3QFma, 비공개) `gen.py`로 나머지 아트보드 10개를 처음 생성했습니다. 아트보드는 13개입니다.
- 2026-11-13 13:41 KST 방향 고르기 체크포인트에서 동희님이 후보 A에 손님 화면의 사진을 크게 두는 방향을 고르셨습니다([docs/09-mockup/README.md](../../docs/09-mockup/README.md) 8-1절). `make_tokens.py`가 그 토큰을 `design/base.tokens.json`으로 쓰고, `.corthex/project.json`에 09 항목(Claude Design 캔버스)을 적었습니다.
- 같은 날 `gen_screens.py`로 화면 49개를 그 방향으로 그렸습니다(보드 98개). 캔버스는 페이지 4개(손님·사장님·운영자 화면, 후보 A·B)에 보드 111개이고, 08단계 화면 정의마다 그 화면의 보드를 링크했습니다.
- 2026-11-13 16:02 KST 토큰 고정 체크포인트에서 동희님이 "지금 값으로 고정 (추천)"과 "밝은 화면 한 가지 (추천)"을 고르셔서 `design/base.tokens.json` 55개를 고정했습니다([docs/09-mockup/README.md](../../docs/09-mockup/README.md) 8-2절). 고정한 뒤 토큰을 바꾸려면 새 결정을 그 절에 적고 해시를 고친 다음 `make_tokens.py`와 `gen_screens.py`로 다시 만듭니다(`check_mockup.py` C13이 해시를 봄).

## 파일

| 파일 | 하는 일 | 돌리는 법 (저장소 맨 위에서) |
| --- | --- | --- |
| `make_tokens.py` | 후보 A·B 토큰과 고른 방향의 토큰(`base`: A에 손님 화면의 사진 크기와 아이콘 크기를 더함, 2026-11-13 16:02 고정)의 원본. DTCG 2025.10 형식으로 씀(색은 `colorSpace`·`components`에 `hex`를 더함, 크기는 `value`·`unit`, 토큰마다 `$type`·`$description`) | `python3 -B research/cake-mockup-2026-11/make_tokens.py [출력 폴더]`. 기본은 후보를 `design/candidates/`에, base를 `design/base.tokens.json`에 씀. 출력 폴더를 주면 세 파일을 모두 그 폴더에 씀 |
| `gen_screens.py` | 고른 방향(A, 손님 화면 사진 크게)의 화면 49개를 그림: 화면마다 normal 360·1280(전체 길이)과 모습이 크게 다른 상태(빈 상태, 오류, 확인 창, 카드 기한, 채널 친구가 아닐 때)의 360 × 800. 08단계 원본(`research/cake-screens-2026-11/screens_*.py`)의 레이아웃 블록과 상태 프레임을 읽고, `gen.py`의 후보 A 부품을 `design/base.tokens.json`의 변수로 그림. 아이콘은 `size.icon-*`. `canvas/project/canvas.json`의 페이지 4개, 화면 보드, 줄 제목과 설명 메모도 씀(후보 보드와 메모는 '후보 A·B' 페이지로 옮기기만 하고 자리는 그대로) | `python3 -B research/cake-mockup-2026-11/gen_screens.py [SCR-001 ...]`. 이름이 없으면 98개 모두. 높이는 `heights.json`에서 읽고 `canvas/project/SCR-0xx-360·1280.dc.html`에 씀 |
| `screen_samples.py` | `gen_screens.py`가 08단계 와이어프레임의 자리 값(가게 이름, 김OO 같은 것) 대신 쓰는 06단계 예시(달빛케이크)의 값과 화면별 문구, 상태별로 덮어쓸 값, 캡션에 붙일 글 | 따로 돌리지 않음(`gen_screens.py`가 불러 씀). 맨 위 설명에 블록 종류별 값의 모양이 있음 |
| `gen.py` | 후보 아트보드 12개 가운데 10개(SCR-001 1280, SCR-016 360·1280, SCR-022 360·1280, 각각 A·B)를 토큰 변수만 쓰는 마크업으로 씀. `A·B-SCR-001-360`과 `Main`은 이전 세션에서 쓴 파일이라 쓰지 않음. 후보 A의 부품(class A)은 `gen_screens.py`도 씀 | `python3 -B research/cake-mockup-2026-11/gen.py [이름 ...]`. 높이는 `heights.json`에서 읽고 `canvas/project/<이름>.dc.html`에 씀. 토큰 변수는 A·B-SCR-001-360 파일의 루트 `style`에서 가져옴 |
| `heights.json` | `gen.py`와 `gen_screens.py`가 쓰는 보드 108개(후보 10개, 화면 98개)의 높이. page-check가 잰 높이 | 내용이 바뀌어 높이가 달라지면(검사 C11이 '그린 크기'와 `$preview`가 다르다고 알려 줌) 고치고 다시 생성함. 후보 보드는 `canvas/project/canvas.json`의 `h`도 같게 고침(화면 보드는 `gen_screens.py`가 씀) |
| `check_mockup.py` | 09단계 검사 14개: 토큰 파일 형식, 아트보드의 토큰 값, 토큰 이름만 씀, 변수 정의, 파일 형식, 캔버스 배치(페이지·줄 제목 자리 포함), 캡션과 제목, 보이는 문구의 출처(값과 출처의 자리 값을 빼고 견줌, 이유를 적은 예외), 금지어, 용어 정리 전의 말, page-check, 아이콘 크기 토큰, 고른 방향과 토큰 고정 기록(고정한 파일의 해시), 화면 정의의 목업 링크 | `python3 -B research/cake-mockup-2026-11/check_mockup.py . [--page-check <page-check.js>]`. 실패가 있으면 1로 끝남. 보드 111개를 모두 page-check하면 몇 분 걸림 |
| `contrast.py`, `contrast_pairs.txt` | WCAG 대비 계산. 한 줄에 `글자색 바탕색 기준 이름`, `//`로 시작하면 주석 | `python3 -B research/cake-mockup-2026-11/contrast.py < research/cake-mockup-2026-11/contrast_pairs.txt` |
| `css_vars.py` | 토큰 파일을 CSS 변수 목록으로 출력(경로를 `-`로 이음, 예: `--color-accent`, `--font-size-body`) | `python3 -B research/cake-mockup-2026-11/css_vars.py design/candidates/a.tokens.json`. 글꼴 이름을 큰따옴표로 내므로 아트보드에 넣을 때는 작은따옴표로 바꿈 |
| `dc2html.py` | 캔버스 아트보드(`*.dc.html`)를 혼자 열리는 HTML로 바꿈(검사용). `{{`가 있으면 멈춤 | `python3 -B research/cake-mockup-2026-11/dc2html.py <아트보드.dc.html> <출력.html>` |
| `check_local.js` | Playwright Chromium으로 HTML을 열어 corthex-uxui의 `page-check.js`(한국어 줄바꿈, 넘침, 글자 대비, 누름 영역)를 돌리고, 결과 JSON과 전체 페이지 PNG를 냄 | `node research/cake-mockup-2026-11/check_local.js <page-check.js> <HTML 절대 경로> <뷰포트 너비> [PNG]`. 뷰포트 너비는 아트보드 너비(`$preview`의 width)로 줌. 360을 주면 아트보드가 화면보다 넓어 page-overflow 오류가 남(휴대폰 프레임 360은 아트보드 안에 있음). `HTTPS_PROXY`가 있으면 그 프록시로 Google Fonts를 받음. `check_mockup.py --page-check`가 아트보드마다 이것을 부름 |
| `export_png.js` | 혼자 열리는 HTML(`dc2html.py`로 만든 것)의 아트보드를 PNG로 저장(사람이 보관할 내보내기). 글꼴을 다 불러온 뒤 찍고, 불러온 글꼴과 오류를 JSON으로 출력 | `node research/cake-mockup-2026-11/export_png.js <HTML 절대 경로> <아트보드 너비> <출력.png> [배율, 기본 2]`. `HTTPS_PROXY`가 있으면 그 프록시로 Google Fonts를 받음 |
| `canvas/project/` | Claude Design 캔버스(Artifact의 Design 타입) 파일 내보내기: `canvas.json`(페이지 4개, 보드 111개 배치, 메모 58개)과 아트보드 111개(후보 13개, 화면 98개). 08단계 생성기(`research/cake-screens-2026-11/build_screens.py`)가 `canvas.json`과 보드 제목을 읽어 화면 정의의 '목업' 줄을 씀 | 바뀐 파일을 같은 Artifact 주소의 `project/` 아래에 올리고, 모두 내려받아 바이트까지 견줌([docs/09-mockup/README.md](../../docs/09-mockup/README.md) 10절) |
| `HANDOFF.md` | 다른 계정으로 인계(2026-11-13 10:45): 기준 상태, 01~08 결과, 09 진행분, 남은 일, 프로젝트 메모리 부록 | 읽기. 그때의 기록이라 고치지 않음 |

## 올리지 않은 것

- 렌더링한 HTML과 PNG: 위 명령으로 다시 만들 수 있습니다.
- Design 타입의 안내 글(타입 게시자가 쓴 파일): 캔버스를 Design 타입으로 만들 때 함께 받습니다.
