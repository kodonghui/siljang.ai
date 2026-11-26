# 진단의 인증 전달 경로 제거

보안 발견4710116447은 기능 브랜치가 고친 진단 코드에도 staging Cloudflare 인증이 전달된다는 지적입니다. 기존 환경의 브랜치 정책은 없음이고 main 보호도 false였습니다. 환경 보호 설정 PUT은403 Resource not accessible by integration으로 거절돼 적용하지 못했습니다. 다른 계정/비밀 값 목록/권한 우회는 시도하지 않았습니다.

새 인증을 받는 진단 job·purpose 입력·실행 그룹을 제거하고 staging-health-alert.yml을 origin/main의 원본 개체로 복원합니다. 원본의 외부 경보·인증 없는 동작을 보존합니다. 직접 Wrangler 인증으로 사용할 CLI 도구와 분류/출력 경계 시험, 이미 관찰한 실제42703 근거는 남깁니다. 현재 환경의 토큰9109와 학원컴 연결 중단 때문에 직접 CLI를 다시 실행하지 않았습니다. 앞 GHA 관찰을 새 main의 인증 경로 성공으로 세지 않습니다.

남은 관리자 설정은 [staging 환경](https://github.com/kodonghui/siljang.ai/settings/environments)에서 배포 브랜치를 main만 허용하고 [main 보호](https://github.com/kodonghui/siljang.ai/settings/branches)를 적용하는 것입니다. 인증의 저장소/환경 배치도 값 없이 확인합니다. 학원컴 Aside 연결이 회복되면 Codex가 처리합니다. 이번 변경에서 이 기존 설정을 보호됨으로 주장하지 않습니다. 인증을 받는 수동 진단을 다시 추가하려면 이 제한과 고정 main 소스·비주류 브랜치 거절/정상 관찰을 먼저 검증합니다.

직접 CLI의 실행 환경은 Linux/Node22입니다. 앱 의존성을 설치하고 올바른 Wrangler 인증을 준비한 뒤 app/server에서 다음처럼 실행합니다. 새 인증을 화면에서 읽어 옮기지 않고 기존 비밀 값 규칙을 따릅니다. 원시 tail을 별도로 출력하지 않습니다. Windows에서는 순수 분류10개만 검사했으며 프로세스 그룹을 쓰는 CLI의 실행은 확인하지 않았습니다.

```sh
cd app/server
node ../../tools/staging-monitor/read-job-logs.mjs
```
