# TASK-020 끝남 조건과 실제 로그인

main2411f8af8a285175c38c69590e0c50e46d59b0fb923의 Workers 전송 고침 뒤 학원컴 Aside CLI의 기존 카카오 계정으로 새 로그인 한 번을 실행했습니다.2026-11-24 20:24:59 KST 가게 등록 화면 `/owner/shop/new`와 GET `/api/owner/me`200을 확인했습니다.20:25:20에는 화면의 로그아웃으로 로그인 화면에 돌아온 뒤 같은 API401을 확인했습니다. actual-login-result.json에는 안전한 경로·숫자 상태·시각만 남겼습니다.

POST 로그인·DELETE 로그아웃 요청 자체의 HTTP 상태는 관찰하지 않았습니다. 그 상태를200·204로 추정해 실제 결과로 적지 않습니다. 아래 응답별 자동 시험과 UI 성공/내 정보200/로그아웃 뒤401을 구분합니다. 계정·쿠키·토큰·인가 코드/state·프로필 본문은 저장하지 않았고 캡차·인증번호·패스키·신원 확인 화면은 없었습니다. 실제 모델·카카오 메시지·구글·결제 호출0회입니다.

| 조건 | 코드·시험과 실제 근거 |
| --- | --- |
| SPEC-001 #1 가게 없는 계정의 가게 등록 화면 | owner-session.test.ts의 새 계정 경로와 실제 `/owner/shop/new` |
| SPEC-001 #2 다른 브라우저 인가 코드/state 거절·세션0 | owner-login.test.ts·owner-session.test.ts의 state/쿠키/URI/기한/Origin 거절 |
| SPEC-001 #3 다른 가게 기록0·찾을 수 없음 | owner-session.test.ts의 자기 주문/다른 가게·없음·잘못된 ID의 동일404 |
| SPEC-001 #4 MVP 채널 동의/관계 조회/친구 기록 중단·켜진 설정 | owner-login.test.ts의 기본 scope 없음, owner-session.test.ts의 MVP 생성/동시 조회·기존 친구 보존과 명시한 설정 |
| API-078 |200·422·429·default 응답별 계약 시험 |
| API-001 |200·401·422·429·503·default 응답별 계약 시험 |
| API-002 |200·401·default 응답별 계약 시험과 실제 내 정보200/401 |
| API-003 |204·default 응답별 계약 시험과 실제 화면 로그아웃/다음 조회401 |
| DEC-26 30일 연장 | owner-session.test.ts의 같은 쿠키·서버 expires_at 매 요청30일, 정확한 기한 경계401·동시 연장 시각 보존·끝난 세션 부활 없음 |
| 제한 역할 | staging-runtime-role.test.ts의 실제 제한 역할 사장님 생성·30일 연장·내 정보·로그아웃. 실제 스테이징 owner_sessions CRUD 권한 파일 적용은 TASK-028의38개 갱신에서 확인 |

TASK-020 제품 파일은 검증한 main241과 같습니다. 이후 main242의 콜백 고침을 결합했고 현재 이 상태 기록 PR의 app/server·app/web·db·tools는 origin/main과 차이0입니다. 콜백 결합 뒤 전체 통합 검사는 현재 head CI에서 확인합니다. main241 app45382967174/check138406466644/Windows138406466734·db45382967089/PG16 138406465641/PG17 138406465136·배포138408316361이 성공했습니다. 실제 Actions Wrangler 버전00de31c1-992e-4a71-abab-4d1647fee9dc(2026-11-24T11:22:29.606745Z), 전체 태그 일치·활성100%·health200·원격 main 일치를 main241-deployment.json에 보존했습니다. 별도 학원컴 CLI의 활성 태그 재조회나 저장소 활성 태그 직접 조회를 확인했다고 적지 않습니다.

```text
main241 check 작업의 실제 결과:
 Test Files  125 passed (125)
      Tests  2545 passed (2545)
 Test Files  65 passed (65)
      Tests  1570 passed (1570)
✓ built in 387ms
```

이 상태 PR에서 npm ci나 전체 시험을 다시 돌렸다고 쓰지 않습니다. owner-auth의 검토 뒤 관련55개·타입·lint와 실제 어댑터 Workers 재현은 runtime-fetch-checks.md, 전체 통합은 위 main CI로 확인합니다. WBS 원본의 TASK-020만 finished로 바꾸고 기존 구현 완료 표에서 뺍니다. TASK-030의 실제 정상/거부 화면 근거는2026-11-22-screen-proof에 있으며 다른 작업의 미확인 결과를 완료로 바꾸지 않습니다.

## 상태 기록 검사

WBS18개 오류0·형식 다음 lint510파일 오류0을 확인했습니다. stage-checks task020-runtime-finished의 PRD/흐름/사양·ERD15개·사이트맵17개·화면15개·정적 목업/생성 파일 대조가 통과했습니다. 새 화면·계약 변경이 없어 Prism과 새 page-check를 건너뛰었으며 정적 목업은14개 중13통과·1미확인으로 구분합니다. 실제 Aside 로그인 확인과 정적 목업의 미확인을 혼동하지 않습니다.
