#!/usr/bin/env bash
# 계정 없이 하는 로컬 시험(TASK-008). wrangler dev(로컬 모드)와 가짜 카카오 서버(test/mock-kakao.mjs)로
# 항목별 답, 콜백(waitUntil·큐 지연), 사진 받기, KV 기록과 마스킹을 본다. 실제 카카오·Cloudflare 계정에는 닿지 않는다.
# 쓰는 법: cd research/kakao-test-2026-11/worker && npm ci && npm run e2e:local
# 필요한 것: node, npx(wrangler는 package.json에 고정), curl, jq, openssl
set -uo pipefail
cd "$(dirname "$0")/.."
export WRANGLER_SEND_METRICS=false

PW=${E2E_WORKER_PORT:-8791}
PM=${E2E_MOCK_PORT:-8792}
W="http://127.0.0.1:$PW"
M="http://127.0.0.1:$PM"
TMP=$(mktemp -d)
SK="local-$(openssl rand -hex 8)"
HK="$(openssl rand -hex 16)"
WPID=""
MPID=""
PASS=0
FAIL=0
CODE=""
TIME=""

# wrangler dev는 자식 프로세스(cli.js, workerd)를 띄우므로 자식까지 멈춤. 멈추지 않으면 다음 시험이 옛 서버에 붙음
killtree() {
  local c
  for c in $(pgrep -P "$1" 2>/dev/null); do killtree "$c"; done
  kill "$1" 2>/dev/null
}
cleanup() {
  [ -n "$WPID" ] && killtree "$WPID"
  [ -n "$MPID" ] && killtree "$MPID"
  wait 2>/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

ok() { PASS=$((PASS + 1)); echo "PASS $*"; }
ng() { FAIL=$((FAIL + 1)); echo "FAIL $*"; }
# expect <이름> <조건 셸 식>: 조건이 참이면 PASS
expect() {
  local name=$1
  shift
  if eval "$*"; then ok "$name"; else ng "$name (code=$CODE time=$TIME body=$(head -c 300 "$TMP/res.body" 2>/dev/null))"; fi
}
# post <견본 파일> <jq 식> [스킬 키, 빈 값이면 헤더 없음]: 견본을 고쳐 /skill로 보냄
post() {
  local base=$1 filter=$2 key=${3-$SK}
  local -a h=(-H "content-type: application/json")
  [ -n "$key" ] && h+=(-H "Siljang-Skill-Key: $key")
  jq "$filter" "test/fixtures/$base" > "$TMP/req.json"
  read -r CODE TIME < <(curl -sS -o "$TMP/res.body" -w '%{http_code} %{time_total}' "${h[@]}" --data-binary @"$TMP/req.json" "$W/skill")
}
text() { jq -r '.template.outputs[0].simpleText.text // empty' "$TMP/res.body" 2>/dev/null; }
get_code() { curl -s -o "$TMP/res.body" -w '%{http_code}' "$1"; }
# wait_for <초> <조건 셸 식>
wait_for() {
  local limit=$1
  shift
  local end=$((SECONDS + limit))
  until eval "$*"; do
    [ "$SECONDS" -ge "$end" ] && return 1
    sleep 1
  done
}

for u in "$W/health" "$M/"; do
  if curl -s -o /dev/null --max-time 2 "$u"; then
    echo "이미 무언가 ${u%/*}에서 답함: 남은 wrangler dev나 가짜 서버를 멈추거나 E2E_WORKER_PORT·E2E_MOCK_PORT를 바꿔요"
    exit 1
  fi
done
node test/mock-kakao.mjs "$PM" "$TMP/callbacks.jsonl" &
MPID=$!
npx wrangler dev -c wrangler.template.jsonc --local --ip 127.0.0.1 --port "$PW" --persist-to "$TMP/state" \
  --var "SKILL_KEY:$SK" --var "HASH_KEY:$HK" --var "EXTRA_IMAGE_HOSTS:127.0.0.1" --show-interactive-dev-session=false > "$TMP/wrangler.log" 2>&1 &
WPID=$!
if ! wait_for 90 'curl -fsS "$W/health" 2>/dev/null | grep -q ok'; then
  echo "wrangler dev가 90초 안에 뜨지 않음"
  tail -40 "$TMP/wrangler.log"
  exit 1
fi
echo "wrangler dev 뜸: $(npx wrangler --version 2>/dev/null | tail -1)"

# 경로와 스킬 키
post skill-basic.json '.' ''
expect "스킬 키 없음 → 401" '[ "$CODE" = 401 ]'
post skill-basic.json '.' 'wrong-key'
expect "스킬 키 틀림 → 401" '[ "$CODE" = 401 ]'
CODE=$(get_code "$W/skill")
expect "GET /skill → 405" '[ "$CODE" = 405 ]'
CODE=$(get_code "$W/nope")
expect "없는 경로 → 404" '[ "$CODE" = 404 ]'

# K-00·K-01·K-02
post skill-basic.json '.userRequest.utterance="아무 말"'
expect "K-00 모르는 말 → 메뉴" '[ "$CODE" = 200 ] && text | grep -q "대본에 없는 말"'
post skill-basic.json '.userRequest.utterance="시험 시작"'
expect "K-01 시험 시작 → 기록 키·바로가기 10개" '[ "$CODE" = 200 ] && text | grep -q "rec:" && jq -e ".template.quickReplies|length==10" "$TMP/res.body" >/dev/null'
post skill-basic.json '.userRequest.utterance="같은 말"'
expect "K-02 같은 말 → 거르기 후보 키·2초 묶음 번호·시각을 뺀 키" '[ "$CODE" = 200 ] && text | grep -q "OPEN-1" && text | grep -q "2초 묶음 번호 끝 4자리: [0-9]\{4\}" && text | grep -q "시각을 뺀 키: dn:"'

# K-03 늦은 답(카카오 제한 5초 앞뒤)
post skill-basic.json '.userRequest.utterance="늦게 4"'
expect "K-03a 4.5초 뒤 답" '[ "$CODE" = 200 ] && awk "BEGIN{exit !($TIME >= 4.4)}"'
post skill-basic.json '.userRequest.utterance="늦게 6"'
expect "K-03b 6초 뒤 답" '[ "$CODE" = 200 ] && awk "BEGIN{exit !($TIME >= 5.9)}"'

# K-04 빈 응답 네 가지
post skill-basic.json '.userRequest.utterance="빈 응답 1"'
expect "K-04-1 outputs 빈 배열" '[ "$CODE" = 200 ] && [ "$(cat "$TMP/res.body")" = "{\"version\":\"2.0\",\"template\":{\"outputs\":[]}}" ]'
post skill-basic.json '.userRequest.utterance="빈 응답 2"'
expect "K-04-2 200 빈 본문" '[ "$CODE" = 200 ] && [ ! -s "$TMP/res.body" ]'
post skill-basic.json '.userRequest.utterance="빈 응답 3"'
expect "K-04-3 template 없음" '[ "$CODE" = 200 ] && [ "$(cat "$TMP/res.body")" = "{\"version\":\"2.0\"}" ]'
post skill-basic.json '.userRequest.utterance="빈 응답 4"'
expect "K-04-4 204" '[ "$CODE" = 204 ]'

# K-05 콜백: 콜백 주소 없음, waitUntil(2초), 큐 지연(27초)
post skill-basic.json '.userRequest.utterance="콜백 시험"'
expect "K-05 콜백 주소 없음 → 안내" '[ "$CODE" = 200 ] && text | grep -q "callbackUrl"'
post skill-callback.json ".userRequest.callbackUrl=\"$M/cb/1\" | .userRequest.utterance=\"콜백 2초\""
expect "K-05 2초: useCallback 답" '[ "$CODE" = 200 ] && jq -e ".useCallback==true and (.template==null)" "$TMP/res.body" >/dev/null'
expect "K-05 2초: 콜백 POST 받음(waitUntil)" 'wait_for 15 "grep -q \"/cb/1\" \"$TMP/callbacks.jsonl\" 2>/dev/null"'
expect "K-05 콜백 본문: 다음 기다림 바로가기(블록+extra.delay)" 'grep "/cb/1" "$TMP/callbacks.jsonl" | jq -e ".body|fromjson|.template.quickReplies|length==4 and all(.action==\"block\" and (.extra.delay|type==\"number\"))" >/dev/null'
post skill-callback.json ".userRequest.callbackUrl=\"$M/cb/2\" | .action.clientExtra={\"delay\":27}"
expect "K-05 27초: useCallback 답(큐로 넘김)" '[ "$CODE" = 200 ] && jq -e ".useCallback==true" "$TMP/res.body" >/dev/null'
QUEUE_SENT=$SECONDS

# K-06 사진 메시지: 주소를 받아 바로 받아 보고 상태·종류·크기만
post skill-basic.json ".userRequest.utterance=\"사진 $M/img/a.jpg?credential=SECRETCRED1234567\""
expect "K-06 사진 받기 200·image/jpeg·2048바이트" '[ "$CODE" = 200 ] && text | grep -q "200 · image/jpeg · 2048바이트"'
# 허용 호스트(카카오 쪽, 로컬은 EXTRA_IMAGE_HOSTS로 127.0.0.1을 더함) 밖은 받지 않음. 리다이렉트도 호스트마다 다시 확인
post skill-basic.json ".userRequest.utterance=\"사진 https://example.invalid/c.jpg\""
expect "K-06 카카오 쪽이 아닌 주소 → 받지 않고 건너뜀" '[ "$CODE" = 200 ] && text | grep -q "건너뜀: 카카오 쪽 호스트가 아님"'
post skill-basic.json ".userRequest.utterance=\"사진 $M/redir/d.jpg\""
expect "K-06 리다이렉트 1번 따라가 받기" '[ "$CODE" = 200 ] && text | grep -q "200 · image/jpeg · 2048바이트" && text | grep -q "리다이렉트 1번"'
post skill-basic.json ".userRequest.utterance=\"사진 $M/redir-out/e.jpg\""
expect "K-06 리다이렉트가 밖으로 가면 건너뜀" '[ "$CODE" = 200 ] && text | grep -q "리다이렉트가 카카오 쪽 밖으로 감"'

# K-07·K-08 후기
REVIEW_FIX='.action.params.photos |= gsub("http://secure.kakaocdn.net/dna/O5UOr/K6auLPnoAf/XXX/img.jpg"; "'"$M"'/img/b.jpg") | .action.detailParams.photos.origin |= gsub("http://secure.kakaocdn.net/dna/O5UOr/K6auLPnoAf/XXX/img.jpg"; "'"$M"'/img/b.jpg") | .action.detailParams.photos.value |= gsub("http://secure.kakaocdn.net/dna/O5UOr/K6auLPnoAf/XXX/img.jpg"; "'"$M"'/img/b.jpg")'
post skill-basic.json '.userRequest.utterance="후기 시험"'
expect "K-07 후기 블록 아님 → 안내" '[ "$CODE" = 200 ] && text | grep -q "파라미터"'
post skill-basic.json '.userRequest.utterance="후기 부탁"'
expect "K-08 후기 블록 모름 → K-07 먼저" '[ "$CODE" = 200 ] && text | grep -q "먼저 K-07"'
post skill-review.json "$REVIEW_FIX"
expect "K-07 후기: 글 길이·사진 1장 받기" '[ "$CODE" = 200 ] && text | grep -q "사진: 1장" && text | grep -q "200 · image/jpeg"'
post skill-basic.json '.userRequest.utterance="후기 부탁"'
ORDER=$(jq -r '.template.outputs[0].textCard.buttons[0].extra.orderNo // empty' "$TMP/res.body")
expect "K-08 후기 부탁 카드: 블록 버튼+extra.orderNo" '[ "$CODE" = 200 ] && [[ "$ORDER" =~ ^T-[0-9A-F]{4}$ ]] && jq -e ".template.outputs[0].textCard.buttons[0].action==\"block\"" "$TMP/res.body" >/dev/null'
post skill-review.json "$REVIEW_FIX | .action.clientExtra={\"orderNo\":\"$ORDER\"}"
expect "K-08b extra가 남은 후기 요청" '[ "$CODE" = 200 ] && text | grep -q "extra가 남았어요" && text | grep -q "$ORDER"'

# K-09·K-10·K-10b·K-11
post skill-basic.json '.userRequest.utterance="봇 ID"'
expect "K-09 봇 ID 꼴" '[ "$CODE" = 200 ] && text | grep -q "hex24"'
post skill-basic.json '.userRequest.utterance="이벤트 시험"'
expect "K-10 REST API 키 없음 → 건너뜀" '[ "$CODE" = 200 ] && text | grep -q "REST API 키가 없어"'
post skill-basic.json ".userRequest.params={\"check\":\"event\",\"sentAt\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\"}"
expect "K-10b 이벤트로 부른 요청" '[ "$CODE" = 200 ] && text | grep -q "K-10b"'
post skill-basic.json '.userRequest.utterance="로그인 시험"'
expect "K-11 REST API 키 없음 → 안내" '[ "$CODE" = 200 ] && text | grep -q "REST API 키가 없어"'
# 로그인 시험 표(K-11 카드에만 붙음)와 서버가 서명한 state. 표·state는 시험 키 HK로 여기서 만들어 봄
hm() { printf '%s' "$1" | openssl dgst -sha256 -hmac "$HK" | awk '{print $NF}'; }
EXP_OK=$(( $(date +%s) + 600 ))
EXP_OLD=$(( $(date +%s) - 60 ))
CODE=$(get_code "$W/login/start?mode=pkce")
expect "GET /login/start 표 없음 → 403(KV 쓰기·인가 주소 없음)" '[ "$CODE" = 403 ]'
CODE=$(get_code "$W/login/start?mode=pkce&t=$EXP_OK-0123456789abcdef0123456789abcdef")
expect "GET /login/start 틀린 표 → 403" '[ "$CODE" = 403 ]'
CODE=$(get_code "$W/login/start?mode=pkce&t=$EXP_OLD-$(hm "login-ticket:$EXP_OLD" | cut -c1-32)")
expect "GET /login/start 지난 표 → 403" '[ "$CODE" = 403 ]'
CODE=$(get_code "$W/login/start?mode=pkce&t=$EXP_OK-$(hm "login-ticket:$EXP_OK" | cut -c1-32)")
expect "GET /login/start 맞는 표, REST API 키 없음 → 503" '[ "$CODE" = 503 ]'
CODE=$(get_code "$W/login/start")
expect "GET /login/start 모드 없음 → 400" '[ "$CODE" = 400 ]'
CODE=$(get_code "$W/login/callback?state=AAAAAAAAAAAAAAAAAAAAAA&code=x")
expect "GET /login/callback 서버가 만들지 않은 state → 400(기록 없음)" '[ "$CODE" = 400 ]'
R22=BBBBBBBBBBBBBBBBBBBBBB
CODE=$(get_code "$W/login/callback?state=$R22$(hm "login-state:$R22" | cut -c1-24)&error=access_denied")
expect "GET /login/callback 서명은 맞고 KV에 없는 state → 400(기록 남김)" '[ "$CODE" = 400 ] && grep -q "찾지 못했어요" "$TMP/res.body"'

# 큐 지연 콜백(27초)이 올 때까지 기다림(보낸 뒤 최대 60초)
left=$((60 - (SECONDS - QUEUE_SENT)))
expect "K-05 27초: 콜백 POST 받음(큐 delaySeconds)" 'wait_for $left "grep -q \"/cb/2\" \"$TMP/callbacks.jsonl\" 2>/dev/null"'
if grep -q "/cb/2" "$TMP/callbacks.jsonl" 2>/dev/null; then
  echo "     큐 콜백 도착: 보낸 뒤 $((SECONDS - QUEUE_SENT))초 안"
fi
sleep 2

# 기록 읽기: dev를 멈춘 뒤 로컬 KV에서
killtree "$WPID"
wait "$WPID" 2>/dev/null
WPID=""
npx wrangler kv key list --binding RECORDS --local --persist-to "$TMP/state" -c wrangler.template.jsonc --prefix rec: > "$TMP/keys.json" 2>"$TMP/kv.err"
: > "$TMP/records.jsonl"
for k in $(jq -r '.[].name' "$TMP/keys.json"); do
  npx wrangler kv key get "$k" --binding RECORDS --local --persist-to "$TMP/state" -c wrangler.template.jsonc --text 2>/dev/null | jq -c . >> "$TMP/records.jsonl"
done
N=$(wc -l < "$TMP/records.jsonl")
echo "     기록 ${N}건: $(jq -s -c 'map(.kind)|group_by(.)|map({key:.[0],value:length})|from_entries' "$TMP/records.jsonl")"
expect "기록 25건 이상" '[ "$N" -ge 25 ]'
expect "로그인 기록은 서명이 맞는 state의 1건만" '[ "$(jq -s "map(select(.kind==\"login_result\" and .stateFound==false and .authError==\"access_denied\"))|length" "$TMP/records.jsonl")" = 1 ] && [ "$(jq -s "map(select(.kind==\"login_result\"))|length" "$TMP/records.jsonl")" = 1 ]'
expect "키 틀린 스킬 요청 기록 2건(IP 없음)" '[ "$(jq -s "map(select(.kind==\"skill_rejected\" and (.headers[\"cf-connecting-ip\"]==null)))|length" "$TMP/records.jsonl")" = 2 ]'
expect "콜백 결과 기록: 가짜 카카오 SUCCESS" 'jq -s -e "map(select(.kind==\"callback_result\" and .httpStatus==200 and .kakao.status==\"SUCCESS\"))|length>=1" "$TMP/records.jsonl" >/dev/null'
expect "스킬 기록 항목: K-01~K-11 모두" '[ "$(jq -s -r "map(select(.kind==\"skill\")|.item)|unique|join(\",\")" "$TMP/records.jsonl")" = "K-00,K-01,K-02,K-03a,K-03b,K-04-1,K-04-2,K-04-3,K-04-4,K-05,K-06,K-07,K-07-setup,K-08,K-08b,K-09,K-10,K-10b,K-11" ]'
expect "스킬 기록마다 후보 키(dk:)·시각을 뺀 키(dn:)·2초 묶음 번호" 'jq -s -e "map(select(.kind==\"skill\"))|all((.dedupKey|startswith(\"dk:\")) and (.dedupNoTimeKey|startswith(\"dn:\")) and (.dedupBucket|type==\"number\"))" "$TMP/records.jsonl" >/dev/null'
expect "사용자 키는 uk: 표시" 'jq -s -e "map(select(.kind==\"skill\"))|all(.payload.userRequest.user.id|startswith(\"uk:\"))" "$TMP/records.jsonl" >/dev/null'
expect "K-09 기록의 답에는 봇 ID 끝 4자 대신 ****" 'jq -s -r "map(select(.item==\"K-09\"))[0].response.body.template.outputs[0].simpleText.text" "$TMP/records.jsonl" | grep -q "끝 4자: \*\*\*\*"'
expect "K-06 기록: 사진 주소는 꼴만, 사진 자체는 없음" 'jq -s -e "map(select(.item==\"K-06\"))[0].extra.photo.found[0].url|test(\"^http://127.0.0.1:[0-9]+/img/a.jpg[?]credential$\")" "$TMP/records.jsonl" >/dev/null'
expect "K-06 기록: 건너뛴 주소도 호스트와 꼴은 남음" 'jq -s -e "map(select(.item==\"K-06\" and .extra.photo.probes[0].skipped==\"host\"))[0].extra.photo.found[0].url|test(\"^https://example.invalid/\")" "$TMP/records.jsonl" >/dev/null'
LEAKS=""
for raw in fakeBotUserKey fakePlusfriendKey01 1234567890 c00000000000000000000001 b00000000000000000000001 010-1234-5678 "010 9876 5432" SECRETCRED1234567 FAKEcredential FAKEsignature FAKEcallbackToken "$SK" "$HK"; do
  grep -qF -- "$raw" "$TMP/records.jsonl" && LEAKS="$LEAKS [$raw]"
done
expect "기록에 가짜 손님 값·비밀 값이 그대로 없음" '[ -z "$LEAKS" ]'
[ -n "$LEAKS" ] && echo "     남은 값:$LEAKS"

echo "결과: PASS $PASS, FAIL $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo "--- wrangler dev 로그 끝(비밀 값 줄은 뺌) ---"
  grep -vF -e "$SK" -e "$HK" "$TMP/wrangler.log" | tail -40
fi
[ "$FAIL" -eq 0 ]
