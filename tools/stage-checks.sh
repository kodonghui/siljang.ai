#!/bin/bash
# 01~10단계의 검사 9개를 돌리고 검사마다 한 줄로 요약한다.
#
# 사용: bash tools/stage-checks.sh [이름] [--no-api] [--no-browser]
#   이름     출력 폴더 이름(기본 now). 검사마다 <검사>.txt가
#            ${STAGE_CHECKS_OUT:-${TMPDIR:-/tmp}/stage-checks}/<이름>/ 아래에 남는다.
#   --no-api 06 계약 검사(api)를 건너뛴다. api는 Prism 목 서버를 다시 띄우고 오래 걸린다.
#   --no-browser 정적 목업 검사만 한다. 실제 브라우저 page-check는 미확인으로 남긴다.
# 끝 상태: 검사 하나라도 종료 코드가 0이 아니면 1. prd·flows는 종료 코드가 늘 0이라
#   출력의 PROBLEMS·AVOIDED WORDS 수가 0이 아니어도 실패로 치고, 그 줄에 '실패'를 붙인다.
#
# 미리 있어야 하는 것
#   - PostgreSQL 16이 127.0.0.1:54329에서 돎(erd·api 검사가 user=postgres로 붙음, 비밀번호 없음, 로컬에서만 받음).
#     이 작업 컨테이너에서 띄운 명령(데이터 폴더가 없으면 먼저 initdb로 만듦):
#       su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/pgcheck/data -o '-p 54329 -k /var/lib/postgresql/pgcheck -c listen_addresses=127.0.0.1' -l /var/lib/postgresql/pgcheck/log.txt start"
#   - 저장소 뿌리의 .venv-api(06 검사의 Python 환경, .gitignore에 있음):
#       python -m venv .venv-api && .venv-api/bin/pip install -r research/cake-api-2026-11/requirements.txt
#   - Node와 npx(api 검사가 Prism 목 서버 @stoplight/prism-cli@5.14.2를 127.0.0.1:4010에 띄움).
#   - CORTHEX 검사 스크립트(corthex-uxui의 page-check.js, corthex-hub의 hub.py·sitemap.py). 먼저 환경 변수
#     PAGE_CHECK·CORTHEX_HUB·CORTHEX_HUB_SITEMAP을 보고, 없으면 저장소의 사본 tools/corthex/(README.md)를,
#     사본도 없으면 ${CORTHEX_PLUGINS:-~/.claude/plugins/synced} 아래의 플러그인을 쓴다. 못 찾으면 그 검사가 실패로 나온다.
#
# 2026-11-15까지는 작업 세션의 scratchpad에 있던 checks.sh로 돌렸다. 이 파일이 그 사본이고 결과 줄의 꼴이 같다.

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd) || exit 2
cd "$ROOT" || exit 2

NAME=now
NO_API=0
# --no-browser: 정적 목업 검사는 하되 브라우저 page-check를 실행하지 않는다.
NO_BROWSER=0
for a in "$@"; do
  case "$a" in
    --no-api) NO_API=1 ;;
    --no-browser) NO_BROWSER=1 ;;
    -*) echo "모르는 옵션: $a" >&2; exit 2 ;;
    *) NAME=$a ;;
  esac
done

O=${STAGE_CHECKS_OUT:-${TMPDIR:-/tmp}/stage-checks}/$NAME
mkdir -p "$O" || exit 2
DB="host=127.0.0.1 port=54329 user=postgres"
PLUG=${CORTHEX_PLUGINS:-$HOME/.claude/plugins/synced}
# 찾는 차례: 환경 변수 → 저장소 사본(tools/corthex/) → 플러그인.
# 플러그인 폴더 이름은 플러그인 버전에 따라 바뀐다(corthex, corthex~g2 등). 그래서 glob으로 찾는다.
first() { local p; for p in "$@"; do [ -n "$p" ] && [ -f "$p" ] && { echo "$p"; return; }; done; }
PC=$(first "${PAGE_CHECK:-}" "$ROOT/tools/corthex/page-check.js" \
  "$(ls "$PLUG"/*/corthex*/skills/corthex-uxui/scripts/page-check.js 2>/dev/null | head -1)")
HUB=$(first "${CORTHEX_HUB:-}" "$ROOT/tools/corthex/hub/hub.py" \
  "$(ls "$PLUG"/*/corthex-nexus*/skills/corthex-hub/scripts/hub.py 2>/dev/null | head -1)")
HUBSM=$(first "${CORTHEX_HUB_SITEMAP:-}" "$ROOT/tools/corthex/hub/sitemap.py" \
  "$(ls "$PLUG"/*/corthex-nexus*/skills/corthex-hub/scripts/sitemap.py 2>/dev/null | head -1)")

FAIL=0
run() {
  local name=$1; shift
  "$@" > "$O/$name.txt" 2>&1
  local rc=$?
  [ $rc -ne 0 ] && FAIL=1
  # prd·flows 검사기는 문제가 있어도 종료 코드가 0이고 'PROBLEMS (n)'·'AVOIDED WORDS (n)'만 찍는다.
  # 그 수가 0이 아니면 실패로 친다(종료 코드만 보면 놓침).
  local p a mark=""
  p=$(grep -E '^PROBLEMS \([0-9]+\)' "$O/$name.txt" | tail -1 | grep -oE '[0-9]+')
  a=$(grep -E '^AVOIDED WORDS \([0-9]+\)' "$O/$name.txt" | tail -1 | grep -oE '[0-9]+')
  if [ -n "$p$a" ]; then
    if [ "${p:-0}" != 0 ] || [ "${a:-0}" != 0 ]; then FAIL=1; mark=" 실패"; fi
    echo "$name exit=$rc$mark :: PROBLEMS ${p:-?} · AVOIDED WORDS ${a:-?}"
  else
    echo "$name exit=$rc :: $(grep -E '^(검사 [0-9]+개|오류 [0-9]+|problems|문제)' "$O/$name.txt" | tail -1)"
  fi
}

echo "$(TZ=Asia/Seoul date '+%Y-%m-%d %H:%M:%S KST') start, head $(git rev-parse --short=7 HEAD), out $O"
run prd python3 -B research/cake-prd-2026-11/check_prd.py docs/02-prd/requirements.md docs/01-domain/domain.md
run flows python3 -B research/cake-flow-2026-11/check_flows.py docs/03-user-flow docs/02-prd/requirements.md docs/01-domain/domain.md
run spec python3 -I research/cake-spec-2026-11/build_spec.py .
run erd python3 -B research/cake-erd-2026-11/check_erd.py . --db "$DB"
if [ $NO_API -eq 0 ]; then
  # 목 서버는 지금의 계약을 읽어야 하므로 다시 띄운다.
  pkill -f 'prism mock' 2>/dev/null; pkill -f 'prism-cli' 2>/dev/null
  for i in $(seq 1 15); do curl -s -o /dev/null http://127.0.0.1:4010/ || break; sleep 1; done
  (npx -y @stoplight/prism-cli@5.14.2 mock api/openapi.yaml -p 4010 > "$O/prism.log" 2>&1 &)
  for i in $(seq 1 90); do curl -s -o /dev/null http://127.0.0.1:4010/ && break; sleep 2; done
  run api timeout 1200 .venv-api/bin/python -B research/cake-api-2026-11/check_api.py . --db "$DB" --mock http://127.0.0.1:4010
else
  echo "api skipped (--no-api)"
fi
run sitemap python3 -B research/cake-sitemap-2026-11/check_sitemap.py . --hub "$HUBSM"
run screens python3 -B research/cake-screens-2026-11/check_screens.py . --hub "$HUB"
if [ $NO_BROWSER -eq 0 ]; then
  run mockup python3 -B research/cake-mockup-2026-11/check_mockup.py . --page-check "$PC"
else
  echo "mockup browser skipped (--no-browser); page-check remains unverified"
  run mockup python3 -B research/cake-mockup-2026-11/check_mockup.py .
fi
run wbs python3 -I research/cake-wbs-2026-11/build_wbs.py .
echo "$(TZ=Asia/Seoul date '+%H:%M:%S KST') end"
exit $FAIL
