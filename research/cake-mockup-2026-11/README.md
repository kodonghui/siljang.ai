# 09단계 목업 도구

09단계(목업)의 원본과 도구입니다. 후보 비교, 그린 화면과 상태, 검사 결과, 시안의 글과 숫자, 체크포인트 질문은 [`docs/09-mockup/README.md`](../../docs/09-mockup/README.md)에 있습니다.

- 2026-11-13 10:11 KST에 동희님이 "혹시 잠시만 대기 // 클로드 계정 다른데서 작업하고싶은데"라고 하셔서 09단계를 멈추고, 세션 임시 폴더에만 있던 도구와 캔버스 파일을 이 폴더에 올렸습니다(인계 문서 [HANDOFF.md](HANDOFF.md), PR #18). 그때 그린 아트보드는 3개(`Main`, A·B-SCR-001-360)였습니다.
- 같은 날 새 계정에서 캔버스를 새로 만들고(https://claude.ai/artifact/1Jb9SwBK66MzN2dNd3QFma, 비공개) `gen.py`로 나머지 아트보드 10개를 처음 생성했습니다. 지금 아트보드는 13개이고, 방향(후보 A 또는 B)은 아직 고르지 않았습니다. 그래서 `design/base.tokens.json`과 `.corthex/project.json`의 09 항목은 아직 없습니다.

## 파일

| 파일 | 하는 일 | 돌리는 법 (저장소 맨 위에서) |
| --- | --- | --- |
| `make_tokens.py` | 후보 A·B 토큰의 원본. DTCG 2025.10 형식으로 씀(색은 `colorSpace`·`components`에 `hex`를 더함, 크기는 `value`·`unit`, 토큰마다 `$type`·`$description`) | `python3 -B research/cake-mockup-2026-11/make_tokens.py [출력 폴더]` (기본 `design/candidates`) |
| `gen.py` | 아트보드 12개 가운데 10개(SCR-001 1280, SCR-016 360·1280, SCR-022 360·1280, 각각 A·B)를 토큰 변수만 쓰는 마크업으로 씀. `A·B-SCR-001-360`과 `Main`은 이전 세션에서 쓴 파일이라 쓰지 않음 | `python3 -B research/cake-mockup-2026-11/gen.py [이름 ...]`. 높이는 `heights.json`에서 읽고 `canvas/project/<이름>.dc.html`에 씀. 토큰 변수는 A·B-SCR-001-360 파일의 루트 `style`에서 가져옴 |
| `heights.json` | `gen.py`가 쓰는 아트보드 10개의 높이. page-check가 잰 높이 | 내용이 바뀌어 높이가 달라지면 고치고, `canvas/project/canvas.json`의 `h`도 같게 고침 |
| `check_mockup.py` | 09단계 검사 14개: 토큰 파일 형식, 아트보드의 토큰 값, 토큰 이름만 씀, 변수 정의, 파일 형식, 캔버스 배치, 캡션과 제목, 보이는 문구의 출처, 금지어, 용어 정리 전의 말, page-check, 아이콘 크기 토큰, 고른 방향 기록, 화면 정의의 목업 링크 | `python3 -B research/cake-mockup-2026-11/check_mockup.py . [--page-check <page-check.js>]`. 실패가 있으면 1로 끝남 |
| `contrast.py`, `contrast_pairs.txt` | WCAG 대비 계산. 한 줄에 `글자색 바탕색 기준 이름`, `//`로 시작하면 주석 | `python3 -B research/cake-mockup-2026-11/contrast.py < research/cake-mockup-2026-11/contrast_pairs.txt` |
| `css_vars.py` | 토큰 파일을 CSS 변수 목록으로 출력(경로를 `-`로 이음, 예: `--color-accent`, `--font-size-body`) | `python3 -B research/cake-mockup-2026-11/css_vars.py design/candidates/a.tokens.json`. 글꼴 이름을 큰따옴표로 내므로 아트보드에 넣을 때는 작은따옴표로 바꿈 |
| `dc2html.py` | 캔버스 아트보드(`*.dc.html`)를 혼자 열리는 HTML로 바꿈(검사용). `{{`가 있으면 멈춤 | `python3 -B research/cake-mockup-2026-11/dc2html.py <아트보드.dc.html> <출력.html>` |
| `check_local.js` | Playwright Chromium으로 HTML을 열어 corthex-uxui의 `page-check.js`(한국어 줄바꿈, 넘침, 글자 대비, 누름 영역)를 돌리고, 결과 JSON과 전체 페이지 PNG를 냄 | `node research/cake-mockup-2026-11/check_local.js <page-check.js> <HTML 절대 경로> <뷰포트 너비> [PNG]`. 뷰포트 너비는 아트보드 너비(`$preview`의 width)로 줌. 360을 주면 아트보드가 화면보다 넓어 page-overflow 오류가 남(휴대폰 프레임 360은 아트보드 안에 있음). `HTTPS_PROXY`가 있으면 그 프록시로 Google Fonts를 받음. `check_mockup.py --page-check`가 아트보드마다 이것을 부름 |
| `canvas/project/` | Claude Design 캔버스(Artifact의 Design 타입) 파일 내보내기: `canvas.json`(보드 13개 배치)과 아트보드 13개 | 바뀐 파일만 같은 Artifact 주소의 `project/` 아래에 올리고, 모두 내려받아 바이트까지 견줌([docs/09-mockup/README.md](../../docs/09-mockup/README.md) 10절) |
| `HANDOFF.md` | 다른 계정으로 인계(2026-11-13 10:45): 기준 상태, 01~08 결과, 09 진행분, 남은 일, 프로젝트 메모리 부록 | 읽기. 그때의 기록이라 고치지 않음 |

## 올리지 않은 것

- 렌더링한 HTML과 PNG: 위 명령으로 다시 만들 수 있습니다.
- Design 타입의 안내 글(타입 게시자가 쓴 파일): 캔버스를 Design 타입으로 만들 때 함께 받습니다.
