#!/usr/bin/env bash
# 카카오 시험 서버 배포(TASK-008). TASK-170(Cloudflare 계정·API 토큰) 뒤에 Claude가 돌린다.
# 만드는 것(처음 한 번): KV 이름공간 siljang-kakao-test-records, 큐 siljang-kakao-test-callbacks, Worker siljang-kakao-test(workers.dev 주소)
# 남기는 파일: worker/wrangler.local.jsonc(KV ID가 든 설정, .gitignore로 저장소에 넣지 않음)
# 시험 주소·계정 ID·KV ID는 화면에만 나오고 저장소·기록에는 적지 않는다.
# 필요한 환경 변수(반복 0 안내서 3절): CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, KAKAO_TEST_SKILL_KEY
#   있으면 더 넣음: KAKAO_TEST_DOMAIN(하위 도메인), KAKAO_TEST_REST_API_KEY(K-10·K-11), KAKAO_TEST_CLIENT_SECRET(K-11)
# 지우는 법: README.md 6절
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
cd "$here/worker"
mkdir -p "$here/local"
export WRANGLER_SEND_METRICS=false
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN 환경 변수가 없음(반복 0 안내서 3절)}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID 환경 변수가 없음(반복 0 안내서 3절)}"
: "${KAKAO_TEST_SKILL_KEY:?KAKAO_TEST_SKILL_KEY 환경 변수가 없음(반복 0 안내서 3절)}"
for cmd in node npx jq openssl curl; do command -v "$cmd" >/dev/null || { echo "$cmd가 없음"; exit 1; }; done

KV_TITLE=siljang-kakao-test-records
QUEUE=siljang-kakao-test-callbacks
CONF=wrangler.local.jsonc
domain=${KAKAO_TEST_DOMAIN:-}
deploy_args=(-c "$CONF")
if [ -n "$domain" ]; then
  if [[ ! "$domain" =~ ^[a-z0-9-]+(\.[a-z0-9-]+)+$ ]]; then
    echo 'KAKAO_TEST_DOMAIN에는 스킴과 경로를 뺀 도메인 이름을 넣으세요.' >&2
    exit 1
  fi
  deploy_args+=(--domain "$domain")
fi

npm ci --no-audit --no-fund
npm run check

# KV 이름공간 ID: 제목이 KV_TITLE로 끝나는 것(wrangler 판에 따라 앞에 Worker 이름이 붙을 수 있음)
kv_id() {
  npx wrangler kv namespace list 2>/dev/null | jq -r --arg t "$KV_TITLE" '[.[] | select(.title == $t or (.title | endswith("-" + $t)))][0].id // empty'
}

id=$(kv_id)
if [ -z "$id" ]; then
  npx wrangler kv namespace create "$KV_TITLE" >/dev/null
  id=$(kv_id)
fi
[ -n "$id" ] || { echo "KV 이름공간 ID를 찾지 못함: npx wrangler kv namespace list로 확인"; exit 1; }
queues=$(npx wrangler queues list)
if ! grep -q "$QUEUE" <<< "$queues"; then
  npx wrangler queues create "$QUEUE" >/dev/null
fi
sed "s/REPLACE_WITH_KV_ID/$id/" wrangler.template.jsonc > "$CONF"
echo "만든 설정: worker/$CONF(저장소에 넣지 않음)"

# 배포. 비밀 값이 없는 동안에는 /skill이 503(실패하면 닫힘)이라 먼저 올려도 됨
npx wrangler deploy "${deploy_args[@]}" | tee "$here/local/deploy.log" >/dev/null || { cat "$here/local/deploy.log"; exit 1; }
if [ -n "$domain" ]; then
  url="https://$domain"
else
  url=$(grep -m1 -oE 'https://[A-Za-z0-9.-]+\.workers\.dev' "$here/local/deploy.log" || true)
fi

# 비밀 값은 표준 입력으로만(명령 줄·화면·파일에 남기지 않음)
printf '%s' "$KAKAO_TEST_SKILL_KEY" | npx wrangler secret put SKILL_KEY -c "$CONF" >/dev/null
# HASH_KEY(마스킹 HMAC 키)는 처음 한 번만 만든다. 바꾸면 전에 남긴 기록과 사용자 표시를 견줄 수 없음. 값은 Cloudflare 밖에 남지 않음
if ! npx wrangler secret list -c "$CONF" 2>/dev/null | grep -q '"HASH_KEY"'; then
  openssl rand -hex 32 | tr -d '\n' | npx wrangler secret put HASH_KEY -c "$CONF" >/dev/null
fi
if [ -n "${KAKAO_TEST_REST_API_KEY:-}" ]; then
  printf '%s' "$KAKAO_TEST_REST_API_KEY" | npx wrangler secret put KAKAO_REST_API_KEY -c "$CONF" >/dev/null
fi
if [ -n "${KAKAO_TEST_CLIENT_SECRET:-}" ]; then
  printf '%s' "$KAKAO_TEST_CLIENT_SECRET" | npx wrangler secret put KAKAO_CLIENT_SECRET -c "$CONF" >/dev/null
fi

# 확인: 살아 있음, 스킬 키 없는 요청은 401
if [ -n "$url" ]; then
  health=$(curl --max-time 10 --retry 4 --retry-all-errors -fsS "$url/health")
  nokey=$(curl --max-time 10 -sS -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' --data '{}' "$url/skill")
  printf '확인: /health 성공 %s, 키 없는 /skill HTTP %s\n' "$([ "$health" = ok ] && echo yes || echo no)" "$nokey"
  [ "$health" = ok ] && [ "$nokey" = 401 ] || exit 1
  echo "시험 주소(저장소·기록에 적지 않음): $url"
  echo "  스킬 URL·Test URL: $url/skill, 헤더 이름: Siljang-Skill-Key"
  echo "  카카오 로그인 리다이렉트 URI: $url/login/callback"
else
  echo "배포 출력에서 workers.dev 주소를 찾지 못함: local/deploy.log를 보세요(새 계정은 workers.dev 하위 도메인을 먼저 정해야 할 수 있음)"
  exit 1
fi
