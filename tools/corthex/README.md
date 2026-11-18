# tools/corthex: CORTHEX 검사 스크립트 사본

CORTHEX 플러그인이 없는 환경(예: Codex)에서도 이 저장소의 검사를 같은 방식으로 돌리기 위한 사본이다. 2026-11-18 KST에 Claude 조정 세션이 그때 설치된 플러그인에서 그대로 복사했다. 내용은 고치지 않았다.

| 파일 | 원본 | 플러그인 버전 | 쓰는 곳 |
| --- | --- | --- | --- |
| `page-check.js` | corthex `skills/corthex-uxui/scripts/page-check.js` | corthex 0.12.1 | `tools/stage-checks.sh`의 mockup 검사, `app/web/scripts/page-check.mjs`(웹 견본) |
| `term-check.py` | corthex `skills/corthex/scripts/term-check.py` | corthex 0.12.1 | 한국어 문서·기록·PR 본문의 용어 검사(작업 원칙 9) |
| `hub/*.py` | corthex-nexus `skills/corthex-hub/scripts/` 전부 | corthex-nexus 0.5.0 | `tools/stage-checks.sh`의 sitemap 검사(`hub/sitemap.py`)와 screens 검사(`hub/hub.py`, 같은 폴더의 동반 모듈을 이름으로 불러옴) |

- **라이선스:** Apache License 2.0이다(`LICENSE`, `NOTICE`). 저작권자는 kodonghui다.
- **찾는 순서:** `tools/stage-checks.sh`와 `page-check.mjs`는 먼저 환경 변수(`PAGE_CHECK`)나 명령 옵션을 본다. 없으면 이 폴더의 사본을 쓰고, 사본도 없으면 `~/.claude/plugins/synced`(또는 `CORTHEX_PLUGINS`) 아래의 플러그인을 찾는다.
- **새로 고칠 때:** 플러그인의 새 버전을 쓰려면 같은 파일을 통째로 다시 복사하고, 위 표의 버전과 날짜를 고친다. 이 사본을 손으로 고치지 않는다. 고칠 것은 플러그인 쪽에서 고친다.
- **용어 검사 쓰는 법:**
  - 종료 코드 0은 깨끗함, 1은 후보 있음이다.
  - 걸린 말이 문맥상 맞으면 그대로 두고 이유를 적는다.
  - 저장소의 금지어 검사(build_wbs 검사 14, check_prd·check_flows의 AVOIDED WORDS, check_screens의 OLD_TERMS)가 먼저다.

```bash
python3 -I tools/corthex/term-check.py '<파일>'
```
