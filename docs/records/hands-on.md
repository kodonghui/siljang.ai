# 실제 환경 확인 기록

실제 배포와 계정 연결에서 확인한 결과를 날짜, 도구, 결과 순서로 남깁니다.

## 2026-11-19 · TASK-027 합성 상담 실제 평가

- Node 22.23.4에서 추적을 끈 평가 도구로 두 회사에 합성 상담 사례를 134개씩 보냈습니다. Anthropic 134개와 OpenAI 7개 응답을 얻었습니다. 비용 도구가 집계한 금액은 142.80원입니다. [평가 결과](ai-eval/2026-11-19-eval-20261118T203404Z-d00cea.md)
- OpenAI 스트림 오류 127건을 확인했습니다. 대표 응답은 HTTP 200 안의 `rate_limit_exceeded`와 약 15시간 뒤 재시도 안내였습니다. OpenAI를 다시 실행하고 검토 대상 44건의 사람 판정을 기록하는 일이 남았습니다.

## 2026-11-19 · TASK-008 카카오 시험 Worker

- Wrangler로 카카오 시험 Worker, 마스킹 기록용 KV, 콜백 큐를 배포했습니다. 하위 도메인 DNS가 생긴 뒤 인증서가 적용될 때까지 기다려 외부에서 HTTPS를 확인했습니다.
- OVH에서 `/health` 200과 `ok`, 키 없는 `/skill` 401, 합성 K-01의 200·응답 버전 2.0·바로가기 10개를 확인했습니다. K-01 응답의 기록 키로 Wrangler에서 KV를 읽었습니다. `kind=skill`, `item=K-01`이고 합성 원본 사용자 ID 두 개가 없으며 `uk:` 마스킹 표시가 있었습니다.
- 이 작업의 시험에서는 Worker에 합성 확인용 키를 두었습니다. TASK-007에서 실채널에 연결할 키를 새로 만들고 Aside Vault와 Worker 비밀 값에 둡니다. 실제 카카오 요청은 TASK-009에서 확인합니다.

## 2026-11-19 · TASK-016 스테이징 주소 연결

- 도구와 범위: Wrangler 4.158.0으로 Cloudflare `siljang-staging`을 배포하고 CORTHEX 도메인의 스테이징 주소를 연결했습니다. 기존 앱 코드 `74420fb`를 처음 배포한 뒤 GitHub Actions에 넣은 명령과 같은 옵션으로 배포를 다시 확인했습니다.
- 결과: OVH 두 곳에서 `/`, `/operator/login`, `/manifest.webmanifest`, `/service-worker.js`는 200, `/api/healthz`는 200과 `{"status":"ok"}`, 세션 없는 `/api/operator/me`는 401입니다. 데이터베이스 연결과 로그인 계정은 TASK-170 이후입니다. [스테이징 상태 확인](https://staging.siljang.ai.corthex-hq.com/api/healthz)
- OVH에서 보낸 정상 요청에 대해 Wrangler tail의 `CF-Connecting-IP`와 Cloudflare가 알려 준 요청 출처 IP가 같았습니다. 같은 경로에 임의의 `CF-Connecting-IP`를 넣은 요청은 HTTP 403이었고 Wrangler tail에 도착하지 않았습니다. Cloudflare API의 Pseudo IPv4 설정은 `off`였습니다.
- GitHub 연동 계정은 Actions 변수·비밀 값 조회와 `staging` 환경 생성에 403을 받았습니다. Actions `main` 자동 배포, 1분 외부 감시, 실행기 실패 알림이 남았습니다. Cloudflare API는 방문자 IP 헤더를 제거하는 관리 변환의 설정 조회에 403을 반환했습니다.
