# 실제 환경 확인 기록

실제 배포와 계정 연결에서 확인한 결과를 날짜, 도구, 결과 순서로 남깁니다.

## 2026-11-19 · TASK-183 Cloudflare Images WebP 회전

- Cloudflare Images 대시보드에서 시험 전 무료 포함량 5,000건 중 사용량 0건을 확인했습니다. Wrangler 4.158.0에서 `dev --remote`로 별도의 미리보기 Worker에 Images 바인딩을 연결했습니다. [Images 바인딩 문서](https://developers.cloudflare.com/images/optimization/binding/)
- 24×16 정적 파일은 16×24, 4,000×3,000 정적 파일은 3,000×4,000, 24×16 애니메이션은 16×24로 회전했습니다. 모두 HTTP 200과 `image/webp`였습니다. Pillow로 입력 알파 채널을 회전해 출력과 비교했고, 모든 프레임이 일치했습니다. 애니메이션은 2프레임, 지연 80·120ms, 반복 값 3을 유지했습니다.
- `curl`의 각 전체 응답 시간은 0.921·0.785·0.259초였습니다. 큰 크기의 합성 입력은 압축 후 1,022바이트였습니다. 큰 압축 파일, 모든 방향, 실제 사용자 사진 경로와 CPU·메모리 사용량은 미확인입니다.

## 2026-11-19 · TASK-014 구글 OAuth 시험 설정

- Aside에서 구글 클라우드 `Siljang` 프로젝트를 만들었습니다. 같은 프로젝트의 Billing에서 연결된 결제 계정이 없음을 확인했습니다.
- Google Auth Platform의 앱 이름은 `Siljang`, Audience는 `External`·`Testing`입니다. Data Access에서 `https://www.googleapis.com/auth/drive.file`이 비민감 범위 한 개이고 민감·제한 범위가 비어 있음을 확인했습니다. [Drive API 범위](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- Verification Center는 현재 `Testing` 상태에서 검증이 필요 없다고 표시했습니다. OAuth 클라이언트 생성과 파일을 선택하는 실제 시험은 TASK-156에서 진행합니다.

## 2026-11-19 · TASK-010 카카오 스킬 발신 검증 문의

- Aside에서 `봇 생성하기` → `스킬 등록 및 관리`로 ‘오픈빌더 스킬 요청의 발신 검증 문의’를 보냈습니다. 10:05:48 KST에 ‘문의가 정상적으로 접수되었습니다. 확인후 이메일로 답변드리겠습니다.’ 화면을 확인했습니다. [카카오 문의처](https://cs.kakao.com/requests?service=169)
- 보낸 본문

  > 카카오톡 채널 봇(오픈빌더)의 스킬 서버를 만들고 있습니다. 스킬 서버가 받은 요청이 카카오에서 보낸 것인지 확인할 방법이 있는지 문의드립니다. (1) 스킬 요청에 서명(예: HMAC)을 붙이는 기능이 있는지, (2) 스킬 요청을 보내는 카카오 서버의 출처 IP 목록을 받을 수 있는지, (3) 둘 다 없다면 스킬의 헤더값 입력 말고 권하시는 방법이 있는지 알려 주세요.

- 답 기다림. 답변은 TASK-011에서 06 OPEN-10에 반영합니다.

## 2026-11-19 · TASK-170 무료 MVP 개발 환경

- Aside의 Cloudflare `Workers plans`에서 `Free`가 `Current plan`으로 표시됐습니다. 같은 계정에 `siljang-staging`과 기존 스테이징 주소가 있습니다. Wrangler 4.158.0 `whoami`와 `hyperdrive list`가 성공했습니다.
- Supabase 대시보드 진입에 필요한 GitHub Mobile 확인 요청을 다시 발송했습니다. 서울 `ap-northeast-2` 프로젝트와 무료 할당량 확인이 남았습니다.

## 2026-11-19 · TASK-016 외부 감시와 배포 환경

- SSH 별칭 `ko-family`에서 systemd 사용자 서비스와 1분 타이머를 설치했습니다. `systemd-analyze --user verify`가 성공했고, `systemctl --user is-active`와 `is-enabled`가 각각 `active`와 `enabled`였습니다.
- `journalctl --user -u siljang-staging-health.service`에서 09:54와 09:55 KST의 `Siljang staging health check passed: HTTP 200, status=ok`를 확인했습니다. 스테이징의 비인증 API 응답 401과 시험 서버의 JSON이 아닌 응답 200은 수동 시험에서 실패로 판정했습니다. [스테이징 상태 확인](https://staging.siljang.ai.corthex-hq.com/api/healthz)
- Aside에서 `Rules` → `Settings` → `Managed Transforms`의 `Remove visitor IP headers` 스위치가 꺼진 상태임을 확인했습니다. Wrangler `versions view`의 스테이징 배포 태그는 `a038cdfc20e40c17a6ad93fe29309addce572989`였습니다.
- GitHub CLI로 `staging` 환경을 만들고 `CLOUDFLARE_ACCOUNT_ID`가 목록에 있는 것을 확인했습니다. `CLOUDFLARE_API_TOKEN`과 `SILJANG_STAGING_DOMAIN`, main 자동 배포와 장애 알림 전달은 확인이 남았습니다.

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
