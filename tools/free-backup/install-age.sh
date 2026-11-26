#!/usr/bin/env bash
# 공식 linux-amd64 배포 파일과 공개 SHA-256을 고정한다(2026-08-29 배포).
set -euo pipefail
umask 077
destination=${1:?설치 디렉터리가 필요합니다}
private=$(mktemp -d)
trap 'rm -rf "$private"' EXIT
curl --fail --location --proto '=https' --tlsv1.2 --silent --show-error \
  https://github.com/FiloSottile/age/releases/download/v1.3.2/age-v1.3.2-linux-amd64.tar.gz \
  -o "$private/age.tar.gz"
(
  cd "$private"
  echo 'cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10  age.tar.gz' | sha256sum --check --status
  tar --extract --gzip --file age.tar.gz --no-same-owner age/age age/age-keygen
)
mkdir -p "$destination"
install -m 0755 "$private/age/age" "$private/age/age-keygen" "$destination/"
"$destination/age" --version
