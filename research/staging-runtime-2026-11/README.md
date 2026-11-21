# TASK-173 스테이징 갱신 SQL

`update-2026-11-21.sql`은 생성 파일입니다. 직접 고치지 않고 아래 명령으로 만듭니다.

```bash
python3 -I tools/build-staging-db-update.py --source-commit 62bccdafc8ca61fc91ead6b489bf4e2258d31ba6 --role siljang_runtime --cleanup-ops-id 41065619-7ed5-41ea-a8b1-4ab1df712e57 --output research/staging-runtime-2026-11/update-2026-11-21.sql
```

- 원본 SQL 커밋: `62bccdafc8ca61fc91ead6b489bf4e2258d31ba6`
- 생성 파일 SHA-256: `f8842ca77189e7886ebf3ea0ce81d646f6fd029b7d98dd50d2692ac3d28f0542`
- 대상: 기존 서울 Free 개발 프로젝트의 원장 0001~0022와 서버 역할. 새 프로젝트·역할·키를 만들지 않습니다.
- 원장의 순서·중복·모르는 파일과 적용된 파일의 해시, 역할 제한과 접속기록 권한을 검사한 뒤 0023~0025와 로그인·콜백의 최소 권한을 한 트랜잭션으로 적용합니다.
- 기존 운영 기록은 ID·종류·0건·숫자 시험 표시가 모두 같은 합성 행 한 건만 지웁니다. 다른 운영 기록은 지우지 않고 서버 역할에 운영 기록의 수정·삭제 권한을 주지 않습니다.
- 오류가 나면 적용 전체를 되돌립니다. 같은 파일 재실행은 이미 적용한 DDL을 다시 실행하지 않습니다. 마지막 결과는 COMMIT 뒤의 조회입니다.

로컬 PostgreSQL 16.15에서 갱신 시험은 먼저 3개 실패였고 구현 뒤 3개 통과입니다. 22건→25건과 반복, 예전 해시 차이의 중단, 원장 없는 중간 DDL 충돌의 전체 되돌리기를 확인했습니다. 별도 제한 역할 시험 4개도 통과합니다. 전체 서버 996개·웹 237개·Node 설정 도구 8개와 format·lint·typecheck·build가 통과했습니다.

이 기록 시점에는 스테이징에 적용하기 전입니다. 실제 관리자 적용과 큐·Cron 결과는 `docs/records/hands-on.md`에 이어서 적습니다. 연결 문자열이나 비밀 값은 이 파일에 넣지 않습니다.
