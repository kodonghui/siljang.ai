#!/usr/bin/env bash
# 시험 서버의 기록(KV RECORDS의 rec:* 키)을 내려받는다(TASK-009 뒤 Claude가 TASK-011에 씀).
# 받은 파일은 local/records/<UTC 시각>/에 두고 저장소에 넣지 않는다(.gitignore). 기록은 이미 마스킹돼 있다.
# 필요한 환경 변수: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID. 필요한 파일: deploy.sh가 만든 worker/wrangler.local.jsonc
# 쓰는 법: bash read-records.sh [키 앞부분, 기본 rec:]
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
cd "$here/worker"
export WRANGLER_SEND_METRICS=false
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN 환경 변수가 없음}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID 환경 변수가 없음}"
CONF=wrangler.local.jsonc
[ -f "$CONF" ] || { echo "worker/$CONF가 없음: deploy.sh를 돌린 작업 폴더에서 하세요"; exit 1; }

prefix=${1:-rec:}
out="$here/local/records/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$out"
npx wrangler kv key list --binding RECORDS --remote --prefix "$prefix" -c "$CONF" 2>/dev/null > "$out/keys.json"
n=0
for k in $(jq -r '.[].name' "$out/keys.json"); do
  npx wrangler kv key get "$k" --binding RECORDS --remote -c "$CONF" --text 2>/dev/null > "$out/$(printf '%s' "$k" | tr ':' '_').json"
  n=$((n + 1))
done

# 한 줄 요약(키 차례 = 시각 차례): 기록 키, 종류, 항목, 걸린 ms 또는 콜백 경과 초, 데이터센터, 응답 상태
if [ "$n" -gt 0 ]; then
  for f in $(ls "$out"/rec_*.json | sort); do
    jq -r --arg f "$(basename "$f" .json)" '[$f, .kind, (.item // "-"), ((.durationMs // .elapsedSec // "-") | tostring), (.cf.colo // "-"), ((.response.status // .httpStatus // "-") | tostring)] | @tsv' "$f"
  done > "$out/summary.tsv"
fi
echo "기록 ${n}건 → $out (요약: summary.tsv)"
