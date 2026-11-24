# TASK-028 실제 역할 점검의 멤버십 되돌리기

학원컴 Aside에서 실제 siljang-dev를 갱신한 결과는 마이그레이션38개와 새 순번·열·인덱스 존재였습니다. 원래 쓰기 점검은42501·allowed_writes false·blocked_writes0, rollback_verified와 role_restored true였습니다. 읽기 전용 확인에서 필요한 열 권한·public USAGE는 모두 true, 현재 편집기의 can_set_runtime_role false·rolcreaterole true·직접 admin_option true였습니다. 관리자 옵션과 SET 옵션은 별개입니다. 기존 서버 역할의 앱 쓰기 실패로 단정하지 않습니다.

도구는 접속 사용자와 현재 역할이 같은 연결만 받습니다. 기존 비관리자 서버 역할과 편집기의 직접 admin_option을 확인한 경우에만 내부 저장점에서 현재 접속자를 권한 부여자로 하는 멤버십 행을 추가하거나 바꿉니다. 임시 GRANT는 INHERIT FALSE·SET TRUE이고 관리자 옵션이 없으면42501로 끝납니다. 이 저장점은 성공 때 예상한 예외로, 실패 때 예외 처리로 항상 되돌립니다. 업무 테이블 권한을 넓히거나 실제 행을 남기지 않습니다. 역할과 SET 복구 불리언, 고정 failure_step과 SQLSTATE만 반환하며 계정·역할 이름·SQL 본문·키·업무 행은 반환하지 않습니다.

실제 접속자와 같은 LOGIN·NOINHERIT·CREATEROLE 시험 계정을 별도 연결로 만들었습니다. 직접 ADMIN true/SET false, ADMIN false/SET false, 역할 전환 뒤 INSERT 부족, 원래 SET true, 없는 대상의5개 경계를 확인합니다. 성공과 실패 뒤 실제 pg_auth_members의 ADMIN/INHERIT/SET 전체 옵션, SET 가능 여부와 합성 가게0행을 대조합니다. 기존 실제 서버 역할 시험19개도 함께 돌렸습니다.

```text
수정 전: Test Files 1 failed (1), Tests 3 failed (3)
수정 후: Test Files 2 passed (2), Tests 24 passed (24)
npm run typecheck: exit 0
Checked 511 files. No fixes applied.
```

새 빈 PostgreSQL 전체 시험·CI·리뷰는 다음 단계입니다. 이 도구 고침의 실제 스테이징 실행은 아직 하지 않았습니다. 의존성은 같은 package-lock의 TASK-028 worker-fetch에서 npm ci한161개11초 캐시를 읽기 전용으로 재사용했으며 이 작업에서 npm ci를 새로 실행했다고 적지 않습니다. 실제 모델·카카오 메시지·구글·결제 호출0회입니다. README351·fix-log643 예약 번호를 유지합니다.

## 최종 전체 검사

로컬 원본74e115c8ae83719e21a57a02e935e555d6b8928c·공개d50a2248927c30cadcc88874e837295b4d64f9f2·동일 트리8c717b4ff78c35fa33c7268999e86fc4a01936c9의 새 빈 PostgreSQL에38개 이행을 적용했습니다. 서버126파일2550개·웹65파일1570개·Vite1.13초·두 Worker 빌드가 모두 종료0입니다. full-source.json에 원본과 결과를 연결했습니다. 이후 문서 고침에서 전체 시험을 다시 했다고 적지 않습니다.

main2411f8af8a의 app45382967174·db45382967089·배포138408316361 성공과 실제 Actions Wrangler 태그·버전00de31c1-992e-4a71-abab-4d1647fee9dc·활성100%·health200·원격 SHA 일치를 확인했습니다(main241-deployment.json). 실제 학원컴 Aside 카카오 로그인/가게 등록 화면·내 정보200·화면 로그아웃 뒤401도 확인했고 TASK-020 완료 기록은 별도 PR에서 다룹니다. 이 역할 점검 도구의 실제 실행은 검토와 main 반영 뒤이며 아직 성공으로 세지 않습니다.

## Claude 검토4건 처리

검토7130429499의 낮음4건과 보안0건을 확인했습니다.

1. 멤버십 확인·임시 GRANT·역할 전환을 check_membership/grant_set_option/set_runtime_role로 나눴습니다. temporary_grant_applied는 임시 GRANT 실행 여부만 나타내며 저장점의 되돌리기와 구분합니다.
2. session_user와 current_user가 다르면 합성 쓰기 전에 check_session·42501로 거절합니다. 먼저 SET ROLE한 실제 별도 LOGIN 연결을 회귀로 추가했습니다. 이 도구는 같은 접속 사용자/현재 역할에서 실행해야 합니다.
3. 기존 grantor와 다르면 임시 멤버십 행이 하나 더 생길 수 있음을 바로잡았습니다. INHERIT FALSE·SET TRUE를 명시하고 관리자 옵션을 새로 주지 않습니다. 성공·실패 뒤 전체 ADMIN/INHERIT/SET 행이 원본과 같은지 시험했습니다.
4. app/README351의 상대 링크를 ../docs/records 경로로 고쳤습니다.

검토 고침 전 새 회귀는5실패·1통과(6개), 고침 뒤 관련2파일25개·타입·형식 다음 lint511파일이 통과했습니다. 앞의 로컬2550개 전체 검사 원본은 이 검토 고침 전입니다. 최신 통합은 현재 head app/db CI로 확인합니다. 실제 학원컴에서는 아직 이 도구를 실행하지 않았습니다.
