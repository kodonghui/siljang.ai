#!/usr/bin/env bash
# 외부 점검 실패를 기존 gh 인증으로 전달한다. 인증 값·응답 본문·주소를 출력하지 않는다.
set -euo pipefail
umask 077

state_dir=${STATE_DIRECTORY:-${XDG_STATE_HOME:-$HOME/.local/state}/siljang-staging-health}
mkdir -p -- "$state_dir"
exec 9>"$state_dir/notify.lock"
flock --exclusive --wait 10 9

case ${1-} in
  --recovered)
    rm -f -- "$state_dir/last-notified"
    exit 0
    ;;
  '') ;;
  *) exit 64 ;;
esac

now=$(date +%s)
if [[ ! "$now" =~ ^[1-9][0-9]{0,10}$ ]]; then
  printf 'Siljang staging alert failed: invalid clock\n' >&2
  exit 1
fi
previous=0
if [[ -f "$state_dir/last-notified" ]]; then
  read -r previous < "$state_dir/last-notified" || previous=0
fi
if [[ "$previous" =~ ^[1-9][0-9]{0,10}$ ]] && (( now >= previous && now - previous < 3600 )); then
  printf 'Siljang staging alert suppressed: incident already reported\n'
  exit 0
fi

if ! gh workflow run staging-health-alert.yml --repo kodonghui/siljang.ai --ref main \
  -f source=external >/dev/null 2>&1; then
  printf 'Siljang staging alert failed: workflow dispatch failed\n' >&2
  exit 1
fi

temporary=$(mktemp "$state_dir/.last-notified.XXXXXX")
trap 'rm -f -- "$temporary"' EXIT
printf '%s\n' "$now" > "$temporary"
mv -f -- "$temporary" "$state_dir/last-notified"
printf 'Siljang staging alert dispatched\n'
