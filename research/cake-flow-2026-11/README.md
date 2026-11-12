# 설계 단계 도구와 근거 파일

2026-11-12 09:17 동희님 말씀("깃에 올려서줘야지")에 따라, 이전 계정의 저장소 밖(프로젝트 공유 폴더와 Claude 작업 공간)에만 있던 파일을 이 저장소의 `research/` 아래에 올렸습니다. 공유 폴더에 있던 파일은 공유 폴더와 같은 경로에 올렸으므로, 저장소 문서가 가리키는 `research/...` 경로가 이제 저장소 안에서 열립니다. 03단계는 main `f47a808`에서 끝났고, 지금 상태와 검사 결과는 [HANDOFF.md](HANDOFF.md)에 있습니다.

## 03단계 사용자 흐름 (`research/cake-flow-2026-11/`)

| 파일 | 하는 일 | 돌리는 법 |
| --- | --- | --- |
| `check_flows.py` | 03단계 검사: 필수 요구사항이 흐름에 있는지, 갈림길·시작·끝·실패 길, 걸음의 REQ 번호와 색, 제외된 요구사항을 쓰는 걸음, 피할 말, ID 참조. 1판~3판 요구사항 파일을 모두 읽음(3판은 2026-11-12 PR #4를 합치며 돌려 봄) | 저장소 맨 위에서 `python research/cake-flow-2026-11/check_flows.py docs/03-user-flow docs/02-prd/requirements.md docs/01-domain/domain.md`. `--fill`은 흐름 파일의 '채우는 요구사항' 줄을 그림의 REQ 번호로 다시 쓰고, `--appendix`는 README 7절 표를 출력합니다. |
| `render_check.js` | 흐름 파일의 Mermaid 그림을 브라우저에서 그려 오류와 상자 수를 셈 | 한 폴더에 `npm i mermaid@12.3.0`(또는 10.9.3)을 받고 Playwright가 있는 곳에서 `node render_check.js <node_modules/mermaid/dist/mermaid.min.js> docs/03-user-flow <출력 폴더> [shots]`. `shots`를 주면 그림마다 PNG를 남깁니다. |
| `HANDOFF.md` | 다른 계정으로 넘김: 지금 상태, 고친 것, 검사 결과, 다음 할 일 | 읽기 |

### `notion-sync/`: Notion 표에 옮기고 대조한 도구

Notion MCP로 표를 채울 때 쓴 것입니다. 앞의 둘은 다시 쓸 수 있고, 나머지는 2026-11-11 작업 기록으로 둡니다.

| 파일 | 하는 일 | 상태 |
| --- | --- | --- |
| `extract.py` | 흐름 파일 14개에서 Notion 줄 값(행위자·컨텍스트·시작·끝·요구사항·후보)과 본문을 뽑아 JSON으로 씀. 본문의 코드 밖 `~`는 `\~`로 바꿈 | `python extract.py docs/03-user-flow flows.json` |
| `payload.py` | `flows.json`과 README 3·4절 표로 Notion create-pages 입력(흐름·후보·읽은 방식)을 만듦 | 맨 위 두 경로가 Claude 작업 공간과 저장소 위치로 고정되어 있어 고쳐 써야 함 |
| `verify_inputs.py` | Claude 대화 기록(JSONL)에 남은 create-pages 입력을 흐름 파일과 글자 단위로 대조 | 그 대화 기록이 있는 세션에서만 돎 |
| `verify_fetch.py` | 대화 기록에 남은 Notion fetch 결과(저장된 본문)를 흐름 파일과 대조 | 위와 같음 |
| `add_links.py` | 흐름 파일에 Notion 줄 주소, README 앞머리와 1절 칸, `project.json`의 `link`를 넣음 | 한 번 쓰고 끝남(커밋 `b573b22`) |
| `proj_next.py` | Notion 프로젝트 행의 '다음 행동'에 03단계 확인 지점 문장을 넣을 값을 만듦 | 한 번 쓰고 끝남 |

## 다른 단계 파일

| 파일 | 무엇 | 가리키는 문서 |
| --- | --- | --- |
| `research/cake-prd-2026-11/check_prd.py` | 02단계 요구사항 검사(3판까지 읽음, 3판은 2026-11-12에 돌려 봄). `python research/cake-prd-2026-11/check_prd.py docs/02-prd/requirements.md docs/01-domain/domain.md` | `docs/02-prd/requirements.md` 7절·8절 |
| `research/cake-prd-2026-11/picture_check.py` | 허브의 01단계 그림 해석기로 domain.md를 읽어 경고를 셈. `python picture_check.py <corthex-hub scripts 폴더> <저장소>` | 없음(02단계 작업 도구) |
| `research/cake-domain-2026-11/pc-check-2026-11-11.md` | 01단계 공개 원문 확인 기록(법 조문, 가게 공지, 경쟁 도구) | `docs/01-domain/domain.md` 0절, `docs/02-prd/requirements.md` 0절 |
| `research/cake-domain-2026-11/study-retro-notes-2026-11-11.md` | 01단계 Notion 회고·스터디 분석 노트 | `docs/01-domain/domain.md` 0절 |
| `research/ai-booking-pivot-2026-11/payments_legal_kr_us.md` | 피벗 연구의 결제·법 조사(2026-11-06) | `docs/02-prd/requirements.md` 0절 |

## 올리지 않은 것

- Mermaid 패키지(약 260MB)와 그림 스크린샷, 허브 스냅숏, `flows.json` 같은 중간 파일: 위 도구로 다시 만들 수 있습니다.
- README 7절 부록의 초안(`appendix.md`): README 7절과 글자까지 같습니다.
- 공유 폴더의 다른 연구 파일(`research/ai-booking-pivot-2026-11/`의 나머지 6개, `research/biz-registration-2026-11/`, `research/cake-domain-2026-11/langchain09-pc-notes-2026-11-11.md`): 저장소 문서가 경로로 가리키지 않아 올리지 않았습니다.
