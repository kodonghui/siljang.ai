# 작업 규칙 기록

이 프로젝트를 고치고 검사하면서 Claude가 배운 작업 규칙의 기록입니다. 2026-11-13 설계 재검토 고치기([PR #27](https://github.com/kodonghui/siljang.ai/pull/27))부터 PR마다 한 단락을 남겼고, 단락 안의 규칙에 (1)부터 번호를 붙였습니다.

- 새 규칙은 이 파일 끝에 다음 번호로 더합니다. 앞의 번호와 글은 바꾸지 않고, 고칠 것이 있으면 새 번호의 규칙으로 적습니다.
- 2026-11-15까지는 작업 세션의 임시 폴더(scratchpad)에 있던 `fix_log.md`에 남겼고, 이 파일은 그 사본입니다(2026-11-15, 규칙 (1)\~(244)). 이제는 이 파일이 원본입니다.
- 안의 `scratchpad/…` 경로와 `checks.sh`는 그때 작업 세션의 임시 폴더에 있던 것이라 지금은 없을 수 있습니다. 단계 검사는 이제 [`tools/stage-checks.sh`](../../tools/stage-checks.sh)로 돌립니다.
- 옮기면서 바꾼 것은 둘입니다. 임시 폴더의 긴 경로를 `scratchpad/…`로 줄였고, GitHub에서 물결표 둘이 취소선으로 읽히지 않게 코드 밖의 물결표를 `\~`로 적었습니다.

## PR A — H1·H2 환불 길 (2026-11-13)

https://github.com/kodonghui/siljang.ai/pull/27, 합친 커밋 a49a837c6584c51f7e8da078e413532641d835a1. 동희님 2026-11-13 20:59 결정 카드 '추천안대로 (추천)'. 지적별로 고친 것: RB-01 결제 확인 요청 중 취소 → REQ-167·168, 할 일 `arrival_check`('들어온 입금 대조') → SCR-029 '들어옴(금액)'(SPEC-071, API-059 `arrived`). RC-05 받은 금액 = 결제 안내의 들어온 금액 합(REQ-165, `payment_requests.arrived_amount`·`arrived_at`, API-049 `confirmedAmount`·`unconfirmedAmount`·`minAmount`). RD-02 닫힘·기한 지남 결제 안내의 '들어옴'과 환불 원인 `over_received`, `refunds.payment_request_id`(REQ-166). RA-15 제작 전 결제 확인 취소(REQ-169, SPEC-070, `payments.voided_at`·`void_reason`, API-059 `void`, `payments_one_live_per_request` 부분 유일 인덱스가 `payments_one_per_request`를 바꿈). RA-01 환불 하한 `refunds_floor_chk`·422 `below_calculated`(REQ-170), 계좌 묻기(REQ-171), 보냄 안내·장부(REQ-172), 할 일 `refund_send`·24시간 다시 알림(REQ-173), 금액이 내려간 변경의 환불(REQ-174). RE-02 `refund_send` → SCR-026과 서버 안의 일. RE-03 API-061 `customerNotice` `sent`·`deferred`와 SCR-026 `sent_deferred`. RE-04 '환불 없음'은 계산값 0원일 때만, 정하면 SCR-021로. 새 ID: REQ-165\~174, SPEC-070·071, 마이그레이션 `db/migrations/0002_refund_path.sql`, 도구 `research/cake-erd-2026-11/erd_editor_sync.py`. 제외: REQ-086(→165), REQ-151(→168). 검사(`checks.sh prA` 출력): prd 문제 0·금지어 0; flows 문제 0·금지어 0·필수 115/121; spec 오류 0·SPEC 71·기능 필수 112/112; erd 14/14(규칙 테스트 99/99 막힘); api 17/17(A13 깨지는 변화 7개 모두 목록에, M1 요청 786); sitemap 17/17(S11 71/71, S14 허용 예외 73); screens 15/15(C11 허용 예외 678); mockup 14/14(C11 아트보드 111). 22:42와 22:47(합치기 전) 두 번 돌려 같은 숫자. --compare: DDL 104,900자, 차이 0줄. check_flows.py를 고친 이유: 새로 둔 절 제목 '확정한 뒤 고친 것'의 '확정'은 용어집이 TERM-011(수락)의 금지어로 두는 낱말이지만 이 제목은 단계 문서를 마친 일을 말하므로 ALLOW에 `확정한 뒤 고친`을 더함. 같은 까닭으로 check_sitemap.py S14와 check_screens.py C11의 ALLOW에도 더함. check_sitemap.py S11은 `SPEC-0[0-6]\d`로만 골라 SPEC-070부터를 세지 않던 버그라 04단계 SPEC 표의 행을 세게 고침. 남은 것: 06단계 Schemathesis(12-2) 다시 돌리지 않음, 09단계 보드는 다시 그리지 않음(레이아웃을 안 바꿈, C8 통과로 봄); checks.sh의 Prism 다시 띄우기가 안 됨: `pkill -f 'prism-cli'`가 12:16(UTC)에 npx로 띄운 Prism(명령줄 `.bin/prism mock`)을 못 끄고 새 Prism은 EADDRINUSE로 죽음. 옛 Prism이 `api/openapi.yaml`이 바뀌면 다시 읽어(base/prism.log 'Restarting Prism', 마지막 13:40:28) M1은 지금 계약으로 돌았음. 같이 쓰는 스크립트라 고치지 않았고, pkill 패턴을 `prism mock`으로 바꾸기를 권함; 03 README 7절 표에는 REQ-158\~164 행이 원래 없음(6절 글로만 설명). 다음 PR이 알 것: (1) 다이어그램은 `erd_editor_sync.py . --write`로만(ERD Editor MCP 편집 도구, `erd_import_*`·`--build`·손으로 쓴 JSON 금지), E1 통과 확인. (2) PostgreSQL은 한 행의 CHECK를 이름 차례로 보므로, 규칙 테스트는 막을 제약이 이름 차례로 먼저 걸리게 값을 고름. (3) 마이그레이션의 COMMENT 줄은 schema.sql에서 그대로 옮김. (4) 깨지는 변화는 `api_catalog.py`의 `BREAKING_CHANGES`에 더하고 지난 항목은 지우지 않음. (5) check_api A13 전에 로컬 `main`을 origin/main에 맞춤(`git branch -f main origin/main`). (6) 들어온 돈을 맞춰 보는 일은 '들어온 입금 대조'로 씀('입금'은 허용된 꼴로만: 들어온 입금·입금 대조 등). 옛 할 일 이름 '취소 뒤 입금'도 '취소 뒤 들어온 입금'으로 바꿈(0001은 그대로). (7) 쓰기 API에 새 2xx 예시 이름을 더하면 `screens_common.py` OK_TEXT에 그 문구를 더함. (8) 새 단계 문서 절 '확정한 뒤 고친 것'은 위 세 검사의 ALLOW로 통과함. check_mockup.py C9와 notion/scan.py는 check_sitemap.py의 ALLOW를 가져다 쓰므로 함께 그 제목을 허용함. (9) SPEC은 SPEC-072부터, REQ는 REQ-175부터, 마이그레이션은 0003부터.

## PR B — H11·H12·H6 주문자·입금자 정보, 잠금 번호, 제작 목록 (2026-11-13)

https://github.com/kodonghui/siljang.ai/pull/28, 합친 커밋 0153ea9ac38ccc1d4bf27711cf71c95478b6aaa7(가지 커밋 3b81173·0d12c5c·598a74f·7b6aa7c·da20aa3(코디네이터의 중간 저장)·36c9395·0abf33b를 squash). 동희님 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)'·'추천안대로 (추천)'. 지적별로 고친 것: RB-02 주문자 이름·연락처를 주문 요청 확인 카드 앞에서 AI를 거치지 않는 '주문자 정보' 블록으로 받음(둘 다 필수, REQ-175, SPEC-072, `confirm_cards.kind` 'orderer_info'와 draft_chk·order_chk, 스킬 결과 `orderer_saved`·`input_invalid`, SCR-004 상태 `orderer`), AI `draft_patch`에서 customer_name·customer_phone을 빼고 AI 모델에 보내지 않음(REQ-178, SPEC-021). RD-16 입금자 이름은 결제 확인 요청 카드의 '입금자 이름이 달라요' → '입금자 이름' 블록(빈 값이면 주문자 이름, REQ-176, SPEC-033, SCR-006 상태 `depositor`), 처리방침 항목 목록(SPEC-010). RC-01 `orders`·`change_requests`에 `lock_version integer NOT NULL DEFAULT 1 CHECK (>= 1)`, 모든 쓰기가 `lock_version = lock_version + 1 … WHERE lock_version = 읽은 값`, DEC-05 revision = lock_version(05 README A6·E15에 행 잠금만 쓰는 방법 대신 고른 이유), 규칙 테스트 `expect_stale` 3개와 두 세션 경합 D5. RD-08 API-051 `ProductionDay` 요약에 designOption·extras·allergyAnswer·excludedIngredients·referencePhotoCount(REQ-177, SPEC-050), SCR-030 정의와 보드. 새 ID: REQ-175\~178, SPEC-072, 마이그레이션 `db/migrations/0003_order_input_lock.sql`, 검사 D5, 결정 E15, 상태 이름 `orderer`·`depositor`, 스킬 블록 파라미터 customer_name·customer_phone·depositor_name. 제외한 ID 없음. 검사(`checks.sh prB` 출력, 23:39\~23:44 KST): prd 행 178·문제 0·금지어 0; flows 문제 0·금지어 0·필수 119/125·전체 161/174; spec 오류 0·SPEC 72·기능 157/157·기능 필수 115/115; erd 15/15(규칙 테스트 105, 늦은 쓰기 3개 0행, D5 옛 방식 덮어씀·잠금 번호 0행); api 17/17(A13 깨지는 변화 0, M1 요청 788); sitemap 17/17(S11 72/72); screens 15/15(C11 허용 예외 763); mockup 14/14(page-check 아트보드 111개 오류 0). 문서 숫자를 고친 뒤 prd·flows·spec·screens·mockup(page-check 없이)·api(목 없이)를 다시 돌려 같은 숫자. --compare: DDL 105,657자, 차이 0줄. 검사 스크립트를 고친 이유: check_erd.py는 D4가 `expect_stale`도 세게 하고 D5(두 psql 세션 경합: S1 결제 확인이 1.5초 쉬고 커밋, S2 손님 취소)를 더함. 05 README 8절에 출력을 옮기자 scan.py가 D5 문구의 '확정이 남음'을 TERM-011(수락)의 금지어로 잡아 '결제 확인이 남음'으로 바꿈. erd_editor_sync.py는 새 컬럼의 DEFAULT를 다이어그램에 옮기지 않아 --compare가 2줄 달랐으므로 `erd_change_column_default`로 기본값을 맞추게 함. check_mockup.py C8은 08 정의의 가린 이름('이OO')이 출처 자리 값으로 빠지지 않아 '입금자 이지우(주문자 이름)'가 실패했으므로 PLACEHOLDER에 `[가-힣]OO`를 더함(09 README 7절의 '자리 값(김OO 같은 것)' 설명대로). 남은 것: 캔버스(Artifact) 다시 올리기(뒤의 동기화 작업), `orderer`·`depositor` 상태 보드는 KEY_STATES 밖이라 안 그림, SCR-004 360 contrast-image 경고 1→2개(둘째 프레임 '주문 내용', 눈으로 확인 안 함), 06 Schemathesis(12-2) 다시 안 돌림, 앱이 모든 쓰기에 lock_version을 쓰는지는 10단계에서. 다음 PR이 알 것: (10) 늦은 쓰기 테스트는 `pg_temp.expect_stale(이름, 앞 문장 배열, 늦은 문장)`, 규칙 테스트에서 orders·change_requests를 쓰는 UPDATE는 `lock_version = lock_version + 1`을 함께 씀. (11) D5가 `check_erd.py --db`에 있고, 05 README 8절 코드 블록은 출력 그대로라 다시 돌리면 '기다림 n초'와 E1 시각까지 다시 옮김. (12) 다이어그램 sync 뒤 `erd_editor_sync.py . --compare --db "host=127.0.0.1 port=54329 user=postgres"`로 차이 0줄 확인(--db 없으면 사용법만 찍고 종료 코드 2). (13) 새 스킬 결과는 `api_catalog.SKILL_OUTCOMES`와 `screens_common.OUTCOME_TEXT`에, 06과 문구가 다르면 `OUTCOME_CHANGED`에도. 새 카드 상태 이름은 `screens_common.STATE_INFO`에. (14) 새 SPEC은 07 `sitemap.yaml`의 화면 `specs`에 넣어야 S11과 08 C15가 통과. (15) integer 컬럼(lock_version 등)을 원본으로 하는 문자열 필드에는 `col=`을 달지 않음(D1이 계약 값을 그 컬럼에 넣어 봄). (16) 09 보드 고치기: `screen_samples.py` → `gen_screens.py SCR-…` → `scratchpad/prB/pc.sh 보드…`(그 보드만 page-check, 2분 안)로 높이를 재고 `heights.json` 고친 뒤 다시 그림. 표 셀 리스트의 `(글, None)` 항목은 span 없이 앞 글과 붙으므로 둘째 줄은 `("muted", 글)` 꼴로. 전체 check_mockup은 4분쯤이라 백그라운드로, 기다릴 때는 `timeout 115 tail --pid=PID -f /dev/null`(sleep은 막힘). (17) '확정'은 '주문이 확정' 같은 허용 꼴만 scan.py를 통과함. (18) PR C의 카카오 채널 연결(H8)에서 새 블록 '주문자 정보'·'입금자 이름'의 블록 ID를 정함. (19) SPEC은 SPEC-073부터, REQ는 REQ-179부터, 마이그레이션은 0004부터.

## PR C — H7·H8·H9 카카오 먼저 보내기 길, 버튼 블록 ID, 주문 요청 카드의 규정 글 (2026-11-14)

https://github.com/kodonghui/siljang.ai/pull/29, 합친 커밋 3c49e3eb667f2d568f7ad1a0e0f3aa2400f16a59(가지 커밋 71cbf40·47ab17d·b41f2bb·54d992f·de2e1f0(코디네이터의 중간 저장)·d3f413f·113f745·7603fa2를 squash, 첫 합치기 호출은 네트워크 오류로 안 됨을 origin/main으로 확인하고 다시 호출). 동희님 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)'·'추천안대로 (추천)'. 지적별로 고친 것: RD-01 가게 채널을 우리 카카오 디벨로퍼스 앱에, 가게 봇마다 우리 월렛을 연결하고 우리 앱 키로 가게 봇의 Event API(`siljang_notice`, params에는 안내 키만)를 부름, 건당 15원(부가세 별도)은 우리가 냄(DEC-20). 안내 블록이 부르는 새 스킬 API-073(`notice_shown`·`notice_test`·`notice_gone`, 안내를 못 만들면 500). 연결 뒤 시험 안내(REQ-180), 먼저 보내기를 못 쓰거나 카카오가 못 전하면 다음 대화 때(REQ-181), taskId 발송 결과 조회(1분·5분·30분 뒤)로 닿은 것만 '보냄'(REQ-182, `notifications`·`owner_alerts`의 `confirming`·`kakao_task_id`·`requested_at`·`delivery_checked_at`·`fail_code`, E18·A20). 개발 전 시험은 OPEN-9. RD-10 사장님 알림은 우리 서비스 채널 봇이 Event API로 appUserId(`owners.kakao_account_id`)에(REQ-183이 REQ-115를 바꿈, DEC-21, E17), `owners.alert_user_key`와 그 UNIQUE를 지움, 친구 여부는 로그인 때 채널 관계 조회(`plusfriends`)·1분 뒤 Admin 키 다시 조회·발송 결과(`alert_friend_checked_at`). RA-10 첫째(Event API 조건과 닿았는지)는 위 둘로, 둘째(결제 기한을 안내가 닿은 때부터 셀지)는 M2. RD-04 `kakao_channels`의 `card_block_id`·`orderer_block_id`·`depositor_block_id`·`review_block_id`·`verified_blocks`·`test_user_key`·`event_*`와 `kakao_channels_blocks_chk`·`kakao_channels_event_chk`(E16·A19), API-030\~032 `blockIds`·`verifiedBlocks`·`eventStatus`·`eventCheckedAt`·`eventFailReason`, 409 `channel_setup_incomplete`, 시험 버튼(`clientExtra.check`)의 `block_verified`와 넷째의 `channel_linked`, API-070 테스트 메시지의 `channel_test_card`, SCR-041 블록 ID 필드·n/4·`event-off`·`blocks_changed`·`event_recheck`. PR B의 '주문자 정보'·'입금자 이름' 블록 ID는 `orderer_block_id`·`depositor_block_id`로 받음(규칙 (18) 마침). RD-03 주문 요청 카드(API-070 `card_shown`, API-071 `orderer_saved`·`card_stale`·`card_expired`)는 출력 셋 안에서 규정 글(simpleText 하나나 둘, 조문마다 한 줄, 끝에 청약철회 제한 문장)을 먼저, 요약 textCard를 끝에(DEC-22), 새 카드의 알림 말은 카드 설명 맨 위, API-021 422 `exceeds_card_limit`(REQ-184, A21), 08 W6을 이 차례로. 새 ID: REQ-179\~184, 마이그레이션 `db/migrations/0004_kakao_event_path.sql`, API-073, DEC-20\~22, OPEN-9, 05 앱 규칙 A19\~A21·결정 E16\~E18, 오류 코드 `channel_setup_incomplete`, 필드 오류 사유 `exceeds_card_limit`, 스킬 결과 `channel_test_card`·`block_verified`·`notice_shown`·`notice_test`·`notice_gone`(`channel_linked`는 뜻을 고침), 응답 예시 `blocks_changed`·`event_recheck`·`event_checking`·`event_unavailable`, 상태 이름 `event-off`, 03 FL-001 노드 B11. 새 SPEC·테이블 없음. 제외: REQ-115(→183). 지운 컬럼: `owners.alert_user_key`. 검사(`checks.sh prC` 출력, 2026-11-14 02:26\~02:31 KST): prd 행 184·문제 0·금지어 0; flows 문제 0·금지어 0·필수 124/130·전체 166/179; spec 오류 0·SPEC 72·기능 162/162·기능 필수 120/120; erd 15/15(규칙 테스트 113, D5 통과); api 17/17(A13 깨지는 변화 8개 모두 목록에, M1 요청 806, A5 예시 730); sitemap 17/17(S8 노드 302, S10 73/73); screens 15/15(C6 응답 행 792, C11 허용 예외 785); mockup 14/14(page-check 아트보드 111개 오류 0, C9 허용 예외 177, contrast-image 경고 24개 = 고른 방향 15 + 후보 9). 문서 커밋 뒤 check_erd 다시 15/15. --compare(`erd_editor_build.py`): DDL 108,676자, 차이 0줄(05 README의 108,674자는 b41f2bb에서 블록 설명 낱말을 고치기 전 숫자라 고침). build_api.py를 고친 이유: 계약 `info.description`의 '`x-corthex.id`(API-001\~072)'가 생성기 안에 글자로 박혀 있어 API-073을 더하면 범위가 틀리므로 그 글자만 API-001\~073으로(생성 로직은 그대로, A0 통과). 검사 스크립트·생성기를 고친 이유: check_screens.py는 screens_common과 따로 자기 `SKILL_APIS`를 가져 API-073을 더해야 C6이 안내 스킬 결과의 상태를 화면에 정하게 함. gen_screens.py는 `scr041_empty`가 그림 원본이라 08 정의(1\~5단계, 블록 ID 필드 넷)에 맞춤. 결정과 다르게 한 것(가장 가까운 일관된 고침): (a) 결정 카드의 '월렛 하나'는 카카오 월렛 문서(연결 대기 월렛만 봇 하나에 연결)에 맞춰 가게 봇마다 우리 월렛 하나(DEC-20). (b) API-073은 안내를 못 만들면 500(DEC-07 '스킬은 늘 200'의 예외)으로 카카오가 보내지 않게 함. (c) 시험 안내 다시 보내기는 새 API 없이 API-032 `event_recheck`. (d) 같은 봇의 블록 ID만 바꾸면 유일 인덱스 `kakao_channels_bot_active_uq` 때문에 새 행 대신 그 연결을 pending으로 되돌림, 그동안 손님 메시지는 not_accepting. (e) 확정된 08 W6을 DEC-22 차례로 고침, W3 상태 목록은 PR B처럼 그대로. (f) 08 kakao_long 첫 행에 확인한 카카오 한도를 적어 카카오 화면 13개 모두가 바뀜. (g) API-073을 SCR-003·005·011에, SPEC-008을 SCR-003에(07 확정본을 고침, SCR-019는 DEC-21로 API 없음 그대로). 남은 것: OPEN-9(가게가 줄 권한, 개발 전 시험 채널, 안 되면 모든 가게를 다음 대화 때만), 캔버스(Artifact) 다시 올리기, `event-off`·`checking` 보드 안 그림(KEY_STATES 밖), RA-10 둘째(M2), 06 Schemathesis(12-2) 다시 안 돌림, '입금 알리기'(허용 꼴이 아님)는 main에 이미 있어 손대지 않음, 05 README의 'DB' 36곳(scan.py)은 main에 이미 있음. 다음 PR이 알 것: (20) 다이어그램 비교는 `erd_editor_build.py . --compare --db "host=127.0.0.1 port=54329 user=postgres"`(규칙 (12)의 `erd_editor_sync.py --compare`는 틀린 이름, sync는 `--write`만). E1은 다이어그램 파일의 마지막 커밋 시각을 찍으므로(커밋 전이면 '커밋 전 파일 시각') 05 README 8절에 옮길 출력은 다이어그램을 커밋한 뒤에 돌림. (21) 금지어: '입금 알리기'는 허용 꼴이 아님, 'DB'는 '데이터베이스', '어드민'은 쓰지 않고 'Admin 키', '부르지 않'은 '호출하지 않'. (22) Edit 도구는 old_string 줄 끝 공백을 잘라 맞지 않을 수 있으니 파이썬 replace 스크립트로 고침. (23) 새 카카오 스킬 API는 `screens_common.SKILL_APIS`와 `check_screens.py`의 `SKILL_APIS` 둘 다에. (24) check_mockup C8의 출처는 08 SCR 문서, `research/cake-screens-2026-11/*.py`, 06 README, `api_examples.py`이고, `copy_ok`는 보드 문구를 ' · ', ' → ', ', ', '\~', '/', ': '로 나눈 조각도 출처에서 찾음. (25) 360 이름·값 표(gen_screens `kvx`)에서 16자 넘는 영문·숫자 값은 값이 그것만일 때 작은 글씨 한 줄로 그려짐. 다른 글과 섞으면 줄 끝에서 갈라져 latin-split·orphan 경고. (26) page-check의 contrast-image는 고정 막대(머리 막대, 아래 버튼 줄) 뒤에 놓인 글자에서 남. 확인은 `scratchpad/prC/probe.js`처럼 글자 가운데의 `elementFromPoint`로. (27) README 숫자를 고치면 C9(09)·C11(08)의 허용 예외 수가 그 글로 바뀌므로 README를 쓴 뒤 다시 돌려 숫자를 맞춤. (28) 다음 번호: REQ-185, SPEC-073, 마이그레이션 0005, API-074, DEC-23, OPEN-10, 05 앱 규칙 A22·결정 E19.

## PR D — H3 보관과 지우기, 상담 끝남, 보관 기록 (2026-11-14)

https://github.com/kodonghui/siljang.ai/pull/30, 합친 커밋 a8d368a85b3efe34635b65f679efe9528b1f7587(가지 커밋 c4ee422 02\~04·a1c46a2 05·0798979 05 문서·73bc0ce 06·2847dba 08·09·1a4a098 07 문서와 05 6절 한 행을 squash). 동희님 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)'·'추천안대로 (추천)'. 기간은 잠정, 5-2 질문 7의 답으로 다시 봄. 법 원문(전자상거래법 시행령 제6조①, 법 제6조②, 개인정보 보호법 제21조①③)은 법령 사이트 점검 중이라 다시 대조하지 못해 검토자가 인용한 글(reviews/A-01-02.md RA-06)을 근거로 적음. 지적별로 고친 것: RC-02 상담이 다룬 주문이 모두 끝나고 끊김 시간이 지나면 상담 끝남(`consultations.status = 'ended'`, `ended_at`, `consultations_ended_chk`), 다음 말은 고지부터 새 상담(REQ-189, SPEC-025·017·018, 04 1-1, API-043 `ended`). RB-09 `orders.finished_at`(인도·취소·환불과 그 주문의 신고·변경 요청·결제 안내가 모두 닫힘, `orders_finished_chk`)부터 30일 뒤 주문의 개인정보를 지우고 `personal_data_purged_at`(REQ-185, REQ-144 제외), 닫히고 30일이 지나고 다룬 주문이 모두 보관 기록이 된 상담의 대화·사진·초안·마스킹 원본 값·에스컬레이션 건을 지우고 상담 행은 `deleted`로 남김(REQ-186, REQ-143 제외). RA-06 계약·결제 기록 5년·문제 신고 기록 3년을 보관 기록 `kept_records`(TBL-052: 주문자 이름, 끝난 시각, `contract_keep_until`, `issue_keep_until`, `issue_purged_at`)로 나누고 화면·손님 내 주문·AI가 읽지 않음(REQ-187, A22, 06 5절 '보관 기록', API-044 목록에서 빠지고 API-045와 하위 기록은 404), 3년 뒤 신고 설명·사진(`issue_details.content_purged_at`), 5년 뒤 보관 기록 행을 지움(REQ-188). RC-04 입금자 이름·환불 계좌·확인 카드 `payload`·변경 `changes`·할 일 `detail`·안내 글(`notifications`)·문구·디자인 설명·알레르기 답·빼야 할 재료·참고 사진·신고 설명과 사진·마스킹 원본 값·카카오 사용자 키(REQ-190, `customers.purged_at`, `customers_purged_chk`)까지 규칙이 있음. RC-03 묶인 사장님 알림은 지우지 않고 `owner_alerts.owner_task_id`만 비움. 지우기는 05 README 6절의 다섯 차례(주문 30일 → 상담 30일 → 신고 3년 → 보관 기록 5년 → 손님 키)와 `ops_events` `purge_run`. 새 ID: REQ-185\~190, TBL-052 `kept_records`, 마이그레이션 `db/migrations/0005_retention_split.sql`, 05 앱 규칙 A22·결정 E19, 상담 상태 `ended`, 규칙 테스트 도우미 `expect_left`, 제약 8개(`customers_purged_chk`·`consultations_ended_chk`·`orders_finished_chk`·`orders_purged_chk`·`issue_details_purged_chk`·`kept_records_keep_chk`·`kept_records_issue_purged_chk`·`kept_records_order_uq`). 제외: REQ-143(→186), REQ-144(→185). 새 SPEC·API·DEC·OPEN 없음. 검사(`checks.sh prD` 출력, 2026-11-14 04:27\~04:32 KST): prd 행 190·문제 0·금지어 0; flows 문제 0·금지어 0·필수 129/135·전체 170/183; spec 오류 0·SPEC 72·기능 166/166·기능 필수 125/125; erd 15/15(규칙 테스트 140 = 막힘 118 + 늦은 쓰기 0행 3 + 지우기 결과 19); api 17/17(A13 깨지는 변화 0, A13 밖 목록 1개 더함, M1 요청 806, A5 예시 730); sitemap 17/17(S8 노드 306 = 화면 189·분기 47·서버 처리 36·외부 11·종료 23, S10 73/73, S11 72/72); screens 15/15(C6 792, C8 1611, C11 785); mockup 14/14(C9 177, contrast-image 15 + 후보 9 그대로). 그 뒤 07 README 9절·13절과 05 README 6절 표 한 행을 더하고 sitemap(04:34)·screens·erd를 다시 돌려 같은 결과. --compare(`erd_editor_build.py`, 04:06 KST): DDL 112,305자, 차이 0줄. 검사 스크립트·도구를 고친 이유: check_erd.py D4가 `expect_left`(지우기를 돌린 뒤 남는 행·값)도 세게 함. erd_editor_sync.py는 `erd_add_table`이 새 테이블을 그룹 상자 밖 빈 곳에 두므로 `place_new_tables`(그룹 상자 안에서 같은 그룹 테이블의 오른쪽·아래의 겹치지 않는 첫 자리, 사이 60, 없으면 알림)를 더함(`kept_records`는 x 2137, y 4144). 다이어그램 편집 92 + 자리 1 + 2단계 3 + 3단계 2, 마지막 쓰기 없는 실행 0. 결정과 다르게 한 것(가장 가까운 일관된 고침): (a) 주문자 이름은 30일에 지우지 않고 보관 기록으로 옮김(법 제6조②가 성명 보존을 허용, 이름 없는 5년 기록은 분쟁 때 누구의 주문인지 못 맞춤). 연락처는 지움. (b) '상담을 문의마다 나눔'은 메시지에 주문 컬럼을 두는 대신 다룬 주문이 모두 끝나면 상담을 끝내고 다음 말을 새 상담으로(E19의 대안 비교). 주문이 열린 동안의 새 문의는 같은 상담에 이어짐. (c) 주문 내용 버전은 계약 기록이라 남기되 문구·디자인 설명(이름이 들어갈 수 있는 글)은 30일에 비움. (d) 5년 뒤 주문·결제·환불 행은 개인정보 없이 남고(가게별 숫자), 3년 뒤 신고 행과 처리 결과도 설명·사진 없이 남음. (e) '나누어 보관'은 다른 데이터베이스가 아니라 `kept_records` 테이블 + `personal_data_purged_at` 표시 + 앱 규칙 A22(읽지 않음). (f) 사장님 알림은 지우지 않고 연결만 비움(글이 없음). (g) 06은 하위 기록 API마다 적지 않고 5절 공통 규칙 '보관 기록'과 API-044·045 설명으로. 남은 것: 보관 기록을 법이 정한 목적으로 꺼내 보는 길은 H4(PR D2, 운영자 열람), RA-06 넷째(손님의 열람·삭제 요청, 가게가 그만둘 때)는 이번 밖이라 후기·사진 게시 동의·`kakao_channels.test_user_key`는 05 README 6절 '남는 것' 표에 이유만, 캔버스(Artifact) 다시 올리기(SCR-018-360 포함), 06 Schemathesis(12-2) 다시 안 돌림, law.go.kr 원문 대조, 05 README의 새 'DB' 2곳은 8절 check_erd 출력 그대로. 다음 PR이 알 것: (29) 지우기 결과 테스트는 `pg_temp.expect_left(이름, 값 하나를 돌려주는 쿼리, 기대 값)`(되돌리지 않으므로 뒤 테스트가 그 상태를 봄), D4가 셈. (30) 외래 키가 모두 RESTRICT(미룰 수 없음)라 지우기 차례가 어긋나면 그 문장이 바로 실패. 지우기 차례를 바꾸면 05 README 6절·FL-014·SPEC-065·`api_catalog.JOBS` SPEC-065를 함께 고침. (31) 새 개인정보 컬럼은 05 README 6절(지우는 차례나 '남는 것' 표)·REQ-185 목록·SPEC-065에 규칙을 둠(RC-04). (32) 보관 기록이 된 주문(`orders.personal_data_purged_at` 있음)과 그 하위 기록은 화면·AI·API가 읽지 않음(A22): 주문이나 하위 기록을 읽는 새 API는 404 `not_found`, 목록에서는 뺌. (33) 상담 상태는 open·awaiting_owner·dropped·ordered·ended·deleted, `ended` 뒤 손님의 다음 말은 새 상담(고지부터). (34) 새 테이블은 `erd_editor_sync.py . --write`가 `place_new_tables`로 자리를 잡음(자리가 없으면 알림만, 그때는 그룹 상자를 넓힘). (35) H4(D2)는 `kept_records`를 꺼내 보는 길(운영자 열람, 기록 남김)을 정함. (36) 다음 번호: REQ-191, SPEC-073, 마이그레이션 0006, TBL-053, API-074, DEC-23, OPEN-10, 05 앱 규칙 A23·결정 E20.

## PR D2 — H4 계좌 암호화, 운영자의 가린 값과 사유 열기, 접속기록, 예금주 확인 (2026-11-14)

https://github.com/kodonghui/siljang.ai/pull/31, 합친 커밋 017e78235a2c66fc2ebd251b891185a362508329(가지 커밋 b848019 02\~04·e8fff2d 05·27f707a 05 문서·1bd8b14 06·47a96ea 07·f7b9cf0 08·9a24039 08·09 중간 저장(정지 훅이 돌아 조정 세션이 커밋)·7ed303e 09·d20ef33 고친 기록 한 행을 squash). 동희님 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)'·'추천안대로 (추천)'. 법 근거는 「개인정보의 안전성 확보조치 기준」(고시 제2026-9호) 제7조②·⑥, 제8조①\~③을 2026-11-13 11:18 law.go.kr 원문으로 읽음(11-14에는 사이트 점검으로 다시 대조하지 못함). 지적별로 고친 것: RC-10 가게 계좌·환불 계좌·마스킹 원본 값(전화번호·계좌번호)은 앱이 AES-256-GCM으로 암호화한 text 봉투 `v키버전:base64url(nonce‖암호문‖태그)`와 끝 4자리만 둠(REQ-191, E20, `payment_accounts.account_number_enc`·`account_last4`, `refunds.refund_account_enc`·`refund_account_last4`, `masked_values.original_enc`·`value_hmac`·`last4`). 같은 값 찾기는 HMAC-SHA256(`masked_values_value_uq`를 (상담, 종류, 해시)로). 평문 형식 CHECK는 06 API 검증으로 옮김(암호문 컬럼에는 `x-corthex-column` 없음). 결제 안내 글(`notifications.body`)에는 계좌 자리만 두고 보일 때 채움(SPEC-032, API-073). RC-09 카드번호는 끝 4자리만, 주민등록번호처럼 보이는 숫자와 긴 숫자는 원래 값을 두지 않음(REQ-192, `masked_values_kept_chk`·`masked_values_last4_chk`), 사장님 화면의 대화도 카드번호는 플레이스홀더와 끝 4자리, 긴 숫자는 플레이스홀더만(API-041·043, SCR-017·018). RA-16 운영자는 SCR-050·API-074\~076에서 가린 값만 보고(REQ-194), 원래 값·보관 기록은 사유 5\~200자를 적어 API-077로 하나씩 엶(REQ-195, SPEC-073, 오류 409 `original_not_kept`·`original_erased`). 사장님·운영자의 손님 개인정보 읽기·바꾸기·열기마다 접속기록 한 행을 같은 트랜잭션에서 남기고 못 남기면 500(REQ-196, SPEC-074, A24, E21, TBL-053 `access_logs`, 함수 `access_logs_guard()`와 트리거 둘이 고치기·지우기·비우기를 막고 2년 지난 행만 지우게 함, 지우기 여섯째 차례). 영업 신고 확인에 결제 계좌 예금주가 대표자·상호와 같은지(`holder_checked_by`·`holder_checked_at`), 계좌가 없으면 409 `payment_account_missing`(REQ-197, A25, SCR-048 `empty`). 계좌를 바꾸면 사장님 알림 `payment_account_changed`(계좌번호 없음)와 바꾼 뒤 결제 안내부터 새 계좌(REQ-198), 확인된 가게가 다른 예금주로 바꾸면 409 `holder_not_verified`(REQ-199). 새 ID: REQ-191\~199, SPEC-073·074, TBL-053, 마이그레이션 `db/migrations/0006_account_encryption_access_log.sql`, API-074\~077, 05 앱 규칙 A23\~A25·결정 E20·E21, SCR-050 가게 기록 보기, 오류 코드 4개(`payment_account_missing`·`holder_not_verified`·`original_not_kept`·`original_erased`), 규칙 테스트 17개(05 README 11절). 제외·없앤 것: REQ-137(→REQ-193), 컬럼 `payment_accounts.account_number`·`refunds.refund_account_number`·`masked_values.original_value`, 제약 `masked_values_card_last4_chk`. 새 DEC·OPEN 없음(DEC-19의 근거를 REQ-193\~195로). 검사(`checks.sh prD2` 출력, 2026-11-14 06:19\~06:23 KST): prd 행 199·문제 0·금지어 0; flows 문제 0·금지어 0·필수 138/144·전체 178/191; spec 오류 0·SPEC 74·기능 171/171·기능 필수 130/130; erd 15/15(규칙 테스트 157 = 막힘 134 + 늦은 쓰기 0행 3 + 지우기 결과 20, D2 마이그레이션 6개, D3 CHECK 333); api 17/17(A13 깨지는 변화 1개가 목록에, A13 밖 2개는 손으로 목록에, A5 예시 776, A6 440, A7 테이블.컬럼 91, D1 값 5041, M1 요청 852); sitemap 17/17(S8 노드 320 = 화면 200·분기 49·서버 처리 37·외부 11·종료 23, S10 77/77, S11 74/74); screens 15/15(C6 826, C8 1676, C11 785); mockup 14/14(아트보드 113, C7 캡션 221, C8 문구 5575·값 뺌 579·예외 10, C9 180, C12 437, C14 50/50, contrast-image 23 + 후보 9). --compare(`erd_editor_build.py`, 05:30 KST): DDL 116,284자, 차이 0줄(CHECK는 원래 다이어그램에 없음, 트리거·함수는 보지 않음). 다이어그램 편집 1단계 128 + 새 테이블 자리 2 + 2단계 17 + 3단계 메모 1, 마지막 쓰기 없는 실행 0. 검사 스크립트·도구를 고친 이유: erd_editor_sync.py는 새 테이블의 편집이 한 묶음 100개를 넘어 MCP가 거부했으므로 `run_batches`가 새 테이블을 늘 새 묶음에서 시작하게 하고, 공통 그룹 상자에 빈 곳이 없었으므로 `place_new_tables`가 상자를 아래로 늘리게 함. build_api.py는 `info.description`의 SPEC·API 범위(SPEC-001\~074, API-001\~077)와 태그 '운영자'의 설명만. check_screens.py는 C1 이름의 화면 수(49 → 50), build_screens.py는 머리말의 수만. gen_screens.py는 머리말·범례의 수(50개, 보드 100개), `parent_menu`에 (50, 50, '영업 신고 확인')(없으면 SCR-050을 그리지 못함), 캡션 설명 셋(SCR-048 `empty`, SCR-050 `empty`·`confirm`). check_mockup.py는 머리말의 '고른 방향으로 그린 49개 화면'을 50개로 고친 것뿐: SCR-050을 더해 설명이 틀리게 되었기 때문이고 검사 규칙·예외는 그대로(14개, 같은 결과). check_erd.py는 그대로(D2는 처음부터 함수·트리거를 견주고, 이번에 처음 함수 1개·트리거 2개가 생김). 결정과 다르게 하거나 더한 것(가장 가까운 일관된 고침): (a) REQ-199(확인된 뒤 다른 예금주로 바꾸지 못함)는 추천안에 없던 것으로, 예금주 확인을 계좌를 바꾼 뒤에도 지키려고 더함. (b) 접속기록은 운영자만이 아니라 사장님의 손님 개인정보 읽기·바꾸기도 남기고(제8조①), 1년이 아니라 2년(알레르기 답이 민감정보일 때를 대비, 5-2 질문 4). (c) 전화번호 원래 값도 암호화, 긴 숫자는 끝 4자리도 두지 않음. (d) 접속기록 지키기는 데이터베이스 역할이 아니라 트리거(역할은 배포 환경에서 만들어 스키마·테스트로 보이지 않음), 암호문은 bytea가 아니라 text 봉투(E20·E21에 대안 비교). (e) 환불 '보냄'의 계좌 번호 형식을 숫자 10\~16자리로 좁힘(깨지는 변화, A13이 찾지 않아 06 11절에 손으로). (f) FL-001에 계좌 등록 기다림(W2). (g) SCR-050은 사이트맵 S3(트리 차례 = 번호 차례) 때문에 운영자 루트 SCR-046의 마지막 자식에 두고 SCR-048의 '가게 기록 보기'로 엶. (h) SCR-048 `empty`가 계좌 없음(`no_account`)과 409 `payment_account_missing`을 함께 맡음(SCR-026처럼 '아직 없음'). SCR-050은 새 상태 없이 기존 상태로: `original_not_kept`→error, `original_erased`→stale, 지운 상담→empty, API-077 200→done(f_box), 사유 창→confirm. (i) SCR-050 목록은 5열(주문번호·상태·날짜·손님·연락처), 금액은 고른 기록 쪽에만. '날짜'는 주문이면 픽업 시각, 보관 기록이면 끝난 날. 보관 기록 줄의 손님·연락처는 비우고 '보관 기록 열기'는 고른 기록 쪽. (j) API-077도 요청 키를 받고, 같은 키로 다시 오면 다시 열어 같은 응답과 접속기록 한 행을 더 남김(요청 키 기록에 값을 두지 않으므로). 남은 것: 접속기록을 보는 화면과 살피는 주기(제8조②, 출시 전 내부 관리계획), 키를 두는 곳과 키 바꾸기(10단계 배포), 운영 데이터가 생긴 뒤의 옮기기(앱이 평문을 암호화해 채운 뒤 옛 컬럼을 지움, 0006 머리에 적음), law.go.kr 원문 다시 대조, 캔버스(Artifact) 다시 올리기(SCR-048 둘, SCR-050 둘이 아직 없음), 06 Schemathesis(12-2). 다음 PR이 알 것: (37) 다이어그램에 새 테이블을 더하면 `run_batches`가 그 테이블을 새 묶음에서 시작하고(한 묶음 100개 한도), 그룹 상자에 자리가 없으면 `place_new_tables`가 상자를 아래로 늘림. (38) 규칙 테스트의 암호문은 시험용 봉투 'v1:TEST…'와 sha256('hmac-test-N')만 씀(진짜 키·암호문 없음). (39) 접속기록 지우기는 `least(now_at, now()) - interval '2 years'`(트리거가 now()로 2년을 보므로 시험 시각이 미래여도 막히지 않게). (40) 새 트리거·함수는 `schema.sql`과 마이그레이션 양쪽에 두고 D2가 견줌. 다이어그램은 트리거를 담지 못해 메모 '접속기록 트리거는 db/schema.sql에만'으로 적음. (41) 암호문 컬럼에는 `x-corthex-column`을 달지 않고 형식은 API가 봄(A7 테이블.컬럼 91개). (42) 손님 개인정보를 돌려주거나 바꾸는 새 API는 같은 트랜잭션에서 `access_logs` 한 행을 남기고(SPEC-074, 06 5절 '접속기록'), 운영자 API는 가린 값만 돌려줌(원래 값은 API-077). (43) 07 사이트맵의 새 화면은 트리 맨 뒤에 두고 `opens`로 이음(S3). (44) gen_screens `parent_menu`는 새 SCR 번호를 덮어야 함. (45) check_mockup C8의 출처에 screen_samples.py는 없음: 보드에 그리는 말은 08 글(또는 06 예시)에 그대로 있어야 함. (46) 1280 목록+상세에서 `ratio: even`과 6열 표는 한국어 머리글이 갈라짐(hangul-split): `main`과 5열 이하. (47) 360 카드는 열 이름을 값의 이름표로 쓰므로 다른 종류의 줄(보관 기록 같은)도 열 뜻에 맞는 값만 넣고 나머지는 '—'. (48) 결과 프레임(f_result)은 레이아웃에 폼이나 버튼이 있어야 함, 없으면 f_box. (49) '아직 없음'을 뜻하는 409는 `empty`로 매핑할 수 있음(SCR-026, SCR-048). (50) 화면 수를 적은 곳(check_screens C1, build_screens·gen_screens·check_mockup 머리말, gen_screens LEGEND, 09 README 1·2·3·5-1·6·10절과 폴더 README)은 화면을 더할 때 함께 고침. (51) 다음 번호: REQ-200, SPEC-075, 마이그레이션 0007, TBL-054, API-078, DEC-23, OPEN-10, 05 앱 규칙 A26·결정 E22, SCR-051.

## PR E — H5·H10 알레르기 정보 따로 동의, 사진마다 게시 동의 (2026-11-14)

https://github.com/kodonghui/siljang.ai/pull/32, 합친 커밋 ac9cf891889502f10293347d26b9c8f81bca3c51(가지 커밋 855d84f 02\~04·633d0c7 05 중간 저장(정지 훅이 돌아 조정 세션이 커밋)·358ea9e 05·0abf686 05 문서·018195a 06·3ec17d6 06 문서·5700077 07·08·09 중간 저장(조정 세션이 커밋)·fcafec4 07\~09 문서·f169626 고친 기록 한 행을 squash). 동희님 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)'·'추천안대로 (추천)'. H5는 잠정(5-2 질문 4의 답으로 다시 봄), H10은 잠정(5-2 질문 6의 답으로 다시 봄). 법 근거 개인정보 보호법 제23조①은 재검토 때 원문으로 읽은 것이고 이번에 다시 대조하지 않음. 지적별로 고친 것: RA-02 AI 상담은 알레르기를 묻지 않고 대화 속 알레르기 말을 초안에 넣지 않음(REQ-200, AI-1 `draft_patch`에서 `allergy_answer`를 뺌). 초안이 다 차면 주문자 정보·주문 요청 카드 앞에 알레르기 정보 카드(쓰는 목적·받는 항목·보는 사람·지우는 때, 동의하지 않을 수 있음과 그 결과, 버튼 '동의하고 알려 주기'·'동의 안 함', REQ-201, SPEC-075). '동의하고 알려 주기'는 AI를 거치지 않는 '알레르기 답' 블록(파라미터 `allergy_answer` 1\~200자, '없음'도 답)으로 받고 동의(동의 글 버전·시각)와 답을 한 트랜잭션으로 초안에(`allergy_saved`, REQ-202), '동의 안 함'은 거부를 남기고 빼야 할 재료만으로(`allergy_declined`, REQ-203). 알레르기 답은 AI·로그·사장님 알림에 없음(REQ-204). 동의 단계는 배포 설정으로 끌 수 있고 끄면 `not_required`와 알레르기 답 블록 버튼만(REQ-205). 버튼 블록이 다섯(REQ-206, `kakao_channels.allergy_block_id`, `blockIds.allergyAnswer`, 시험 버튼 다섯, 사유 후보 `allergy_block`). 컬럼: `order_drafts`·`order_details`의 `allergy_consent`·`allergy_consent_version`·`allergy_consent_at`(주문 내용 버전은 NOT NULL, 초안은 비어 있을 수 있음), CHECK `*_allergy_consent_chk`·`*_allergy_answer_chk`(동의 없는 알레르기 답을 막음). 30일 지우기는 알레르기 답만 지우고 동의의 답·버전·시각은 남김(SPEC-065). RE-01·RA-14·RB-16·RC-11 주문 요청 때의 사진 게시 동의를 없앰(`Order.photoConsent`, 버튼 '사진 게시도 동의하고 요청'·`confirm_with_photo_consent`, 요약 카드 줄). 완성 사진 안내가 사진 게시 동의를 한 문장으로 묻고(무엇을·어디에·언제든 철회, 버튼 '올려도 돼요'·'안 돼요', 30분) 누른 답을 사진마다(`photo_consents.completion_photo_id`, `photo_consent_saved`, REQ-207, SPEC-053), 후기 사진도 같은 한 문장으로 사진마다(REQ-208, API-072). 철회는 완성 사진·후기 사진 모두, 올라 있는 포트폴리오 항목을 먼저 내린 뒤(REQ-209, SPEC-063). `portfolio_items`는 `consent_live`와 복합 외래 키 셋으로 그 사진의 동의이면서 동의함·철회 안 함인 동안만 있음(A26, E22). 가게가 도안으로 올린 견본 사진은 동의 없이 가격표에(REQ-210). 새 ID: REQ-200\~210, SPEC-075, 마이그레이션 `db/migrations/0007_consent_allergy_photo.sql`, 05 앱 규칙 A26·결정 E22, 카드 종류 `allergy_info`·`photo_consent`, 스킬 결과 `allergy_saved`·`allergy_declined`·`photo_consent_saved`(카드 결과 23개, 스킬 결과 47개), 블록 이름 `allergy_answer`, 블록 파라미터 `allergy_answer`, 사유 후보 `allergy_block`, 응답 필드 `OrderDetailsVersion.allergyConsent`·`ProductionDay.items[].summary.allergyConsent`·`Production.completionPhotos[].consent`, 08 상태 `allergy`(SCR-004)·`photo-consent`(SCR-011). 없앤 ID: REQ-013(→REQ-200)·REQ-096(→REQ-207)·REQ-097(→REQ-209)·REQ-179(→REQ-206), `Order.photoConsent`, 고를 값 `confirm_with_photo_consent`, 주문 요청 때의 동의 종류 `order`. 검사(`checks.sh prE`, 2026-11-14 08:01\~08:06 KST, 모두 통과): prd 행 210·문제 0·금지어 0, flows 문제 0·금지어 0·필수 143/149, spec SPEC 75·기능 177/177·기능 필수 134/134·오류 0, erd 15/15(D2 마이그레이션 7개, D3 외래 키 116·CHECK 345·UNIQUE 75, D4 규칙 테스트 175개, 컬럼 654), api 17/17(A3 SPEC 75, A5 예시 782, A6 440, A7 92컬럼 137자리, A9 61, A13 2, D1 값 5104·글자 수 CHECK 33컬럼, M1 855), sitemap 17/17(S7 SPEC 75, S8 노드 326: 화면 205·분기 50, S11 75/75, S14 허용 예외 75), screens 15/15(C4 193·147, C5 351·상태 이름 27, C6 844(카카오 스킬 230), C8 1712, C9 702, C10 손님 문구 47(같음 36·바꿈 6·설명 5), C11 809), mockup 14/14(C8 문구 5575·값을 빼고 맞춤 573, C9 185, 아트보드 113 오류 0, 화면 보드 contrast-image 23 + 후보 9). 검사 스크립트·도구는 고치지 않음(build_api.py는 `info.description`의 SPEC 범위 글자만 SPEC-001\~075). 결정과 다르게 하거나 더한 것(가장 가까운 일관된 고침): (a) SPEC-075는 '동의하고 알려 주기'를 누르면 동의를 남기고 블록을 연다고 적었지만, 카카오 블록 버튼은 블록을 열 뿐 스킬을 따로 호출하지 않으므로 동의와 답이 알레르기 답 블록의 스킬 호출 한 번(API-071)으로 와서 한 트랜잭션으로 남음. 답 없이 나가면 아무것도 남지 않고 다음에 알레르기 정보 카드를 다시 보냄(06 README 15절). (b) 동의 안 함은 추천안대로 주문을 이어감(RA-02가 권한 '사장님께 넘김' 아님). (c) REQ-205는 배포 설정(컬럼 없음, 답 `not_required`). (d) 완성 사진 동의는 안내 하나에 한 문장, 사진마다 남김, 카드 30분. (e) `photo_consent_saved`는 H8의 `depositor`처럼 API-071이 있는 카드 화면(SCR-004·006·008·009·010·013)에서 '-' 행, SCR-011에 상태 `photo-consent`를 더함. SCR-011 사이트맵 API에 API-071을 더하지 않고 새 화면도 없음. (f) `allergy_saved`·`allergy_declined`는 SCR-004에서만 `orderer`로, 다른 카드 화면은 '-'. (g) 새 상태 `allergy`·`photo-consent`는 KEY_STATES 밖이라 09 보드 없음. (h) A13이 찾는 깨지는 변화 2개(`Order.photoConsent` 없앰, `OrderDetailsVersion.allergyConsent` 꼭 있는 필드로)와 A13이 찾지 않는 7개를 06 11절에 손으로. (i) 요약 카드에 알레르기 답이나 '알레르기 정보 동의 안 함', 제작 목록·주문 상세는 '알레르기: 동의 안 함(빼야 할 재료만 받음)'으로 '없음'과 구별. (j) REQ-207은 '선택 기능' 형태(완성 사진 보내기를 켠 가게). 남은 것: 동의하지 않은 완성 사진을 언제 지울지(5-2 질문 6과 함께), 01 `domain.md` 용어(PR J), 캔버스(Artifact) 다시 올리기(SCR-002·004·012·030·041 보드 열 개가 고침 전의 판), 06 Schemathesis(12-2), 법 원문 다시 대조. 다음 PR이 알 것: (52) 규칙 테스트에 컬럼을 넣을 때 INSERT 문을 손으로 세지 말고 파서로 컬럼 목록과 값 목록을 함께 고침(문자열 안의 쉼표·괄호를 건너뜀). (53) '살아 있는 동의' 패턴: 부모 `photo_consents`에 CHECK로 늘 '동의함·철회 안 함'과 같게 둔 `publishable`과 UNIQUE (shop_id, id, publishable)를, 자식 `portfolio_items`에 `consent_live`(올라 있는 동안 true, 내리면 NULL)와 (shop_id, photo_consent_id, consent_live) → (shop_id, id, publishable) 복합 외래 키를 두면 올린 채로는 철회를 쓰지 못해 '먼저 내리고 철회'를 데이터베이스가 지킴(NULL인 외래 키는 보지 않음). 그 사진의 동의인지는 (shop_id, id, 사진 id) 복합 외래 키로. (54) NOT NULL 위반을 기대하는 규칙 테스트는 제약 이름이 아니라 'column "x"' 문구로 맞춤. (55) 다이어그램(`schema.erd.json`)을 고친 커밋 뒤에 `check_erd.py`를 다시 돌려 E1의 시각까지 05 README에 옮김. (56) A5는 계약에 없는 스킬 결과 이름의 예시를 막음: 새 결과는 `SKILL_OUTCOMES`·`CARD_OUTCOMES`·예시를 함께 더함. (57) A13은 최상위 스키마의 필드 추가·삭제만 찾음: 중첩 필드·enum 값·요청 필드·응답 구성 변화는 `BREAKING_CHANGES`에 손으로. (58) 다른 화면의 카드에서 나오는 스킬 결과는 그 카드를 가진 화면에 상태를 두고, 같은 API를 쓰는 다른 화면들은 '-' 행에 그 상태를 적음(H8·H10). (59) Prism 목 서버는 `api/openapi.yaml`이 바뀌면 스스로 다시 읽음. 떠 있는지는 `ss`가 아니라 `pgrep -af prism`으로 봄. (60) check_screens C4: 데이터 출처의 API ID는 '의 '가 앞에 붙으면 그 화면의 API로(SCR-003의 API-070), 아니면 이 화면의 API여야 함. 이 화면에 없는 API의 결과는 'API-071'을 쓰지 말고 '카드 스킬 결과 이름'으로 적음. (61) README에 '예약 링크' 같은 허용 예외 말이 든 글을 더하면 S14·C11·C9의 허용 예외 수가 바뀜: 글을 쓴 뒤 다시 돌린 숫자를 적음. (62) `git stash push --keep-index`는 스테이지하지 않은 다른 파일까지 치움. 생성기가 원본을 읽는 중이면 옛 원본으로 그려지니 쓰지 말고, 보드가 원본과 같은지는 `gen_screens.py`를 모두 다시 돌려 해시를 견줌. (63) 다음 번호: REQ-211, SPEC-076, 마이그레이션 0008, TBL-054, API-078, DEC-23, OPEN-10, 05 앱 규칙 A27·결정 E23, SCR-051.

## PR F — M1·M2·M3·M9·M10 기다림의 끝, 결제 기한 시작, 휴무일·다 찬 날, 상태 전이, 꼭 가야 하는 안내 (2026-11-14)

https://github.com/kodonghui/siljang.ai/pull/33, 합친 커밋 bf07b520f3c8ae1e0aac985825cd1d66adb68b0e(가지 커밋 69f48ce 02\~04·d120096 05 중간 저장·f5c0d22 05·b8937e7 05 README 8절·e53e40d 06·3478469 08·a6a0eec 06·08 README 중간 저장(컨테이너 다시 시작 전, 조정 세션이 커밋)·70cd3fd 06·08 검사 시각과 09 README·e84bc7f 05 README 근거를 RC-17로·69cf387 고친 기록 한 행을 squash). 동희님 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)'·'추천안대로 (추천)'. 첫 PR F 작업 세션은 컨테이너가 다시 시작되며 멈췄고, 커밋은 남아 있어 마침 세션이 `git log`·`git diff ac9cf89..HEAD`로 한 일을 되살려 남은 것만 마침(PostgreSQL은 조정 세션이 다시 띄움). 지적별로 고친 것: RB-03 기다림마다 끝, 맞춤 주문 요청은 그 픽업 날짜의 주문 마감(요청 때 이미 지났으면 픽업 일시), 변경 요청은 변경 마감, 에스컬레이션 건은 7일에 '답 없어 닫힘'과 손님 알림 한 번(REQ-213·214·216), 결제 확인 요청·맞추는 중·환불 결정에도 다시 알림과 지연 안내 한 번씩(REQ-215), 결제 기한 지남 주문을 사장님이 픽업 일시까지 고르지 않으면 결제 없어 취소(REQ-217). RA-17 답 없는 맞춤 주문 요청·변경 요청의 자동 닫힘(05 `orders.cancel_kind` `no_answer`와 `orders_no_answer_chk`, `change_requests.status`·`handoffs.status` `closed_no_answer`, `handoffs.closed_at`, 알림 종류 `no_answer_closed`). RB-08 결제 기한을 전해진 때부터 세고 상한(그날 주문 마감, 이미 지났으면 픽업 일시, 차액 결제는 변경 마감)을 넘지 않음(REQ-087 → REQ-218, `payment_requests.delivered_at`·`due_cap_at`과 CHECK 둘·인덱스, E23·A28). RE-08 상한이 지난 뒤 전하는 결제 안내는 계좌 없이 '결제 기한이 지나 사장님이 확인하고 있어요'만, 결제 기한 지난 주문 목록에 전해진 시각(06 `OrderSummary.paymentNotice`, 08 SCR-005 등). RD-07 `isFriend`가 true가 아니면 친구 아님(REQ-219). RA-04 REQ-040 → REQ-222(결제 확인 요청·맞추는 중 동안은 자리를 풀지 않음), REQ-160 → REQ-223(결제 기한 상한까지만 지킴), REQ-080 → REQ-224(필수). RA-11 마감된 날은 자리를 잡지 않고 손님에게 알린 뒤 에스컬레이션(REQ-048 → REQ-225), 사장님이 고르는 날이 다 찼으면 초과 확인(REQ-226, `overbooking`). RB-04 휴무일은 손님이 고른 주문 요청만 막고(REQ-037 → REQ-220) 사장님이 고르는 수락·변경·재제작·연장은 확인 뒤 마감 후 추가 수락(REQ-221, `closed_day`). RB-05 결제 기한 연장은 픽업 일시가 지났을 때만 막고 주문 마감이 지났으면 `past_cutoff` 확인, 추가로 받지 않으면 FL-007 D3로(SPEC-038). RB-19 상태 머신 1-1\~1-8의 빈 전이(사장님 답 기다림 중의 주문 요청, 결제 기한 지남에서의 취소, 미수령의 폐기, '미입금' 표시 뒤 다시 확인 요청 없음, 변경 요청의 답 없어 닫힘, 그날 자리에 종료된 자리도 셈 `slot_holds_day_live_idx`, 1-7 '할 일에 남음'을 '지연'에 합침 `owner_tasks.wait_status`에서 `parked` 없앰). RC-17 받음·미수령 주문과 제작 행 시각의 짝을 커밋 때 봄(`orders_production_sync_check()`, 지연 제약 트리거 둘, A27). RB-20 1-2 전이 이름 '인도함', G1 오타, SPEC-015 둘째 수락 기준. RA-03 문의 끊김은 열린 에스컬레이션 건과 다룬 주문이 없는 상담만 닫고(REQ-019 → REQ-211) 막는 것은 다시 상담하라고 권하는 안내뿐(REQ-021 → REQ-212). 새 ID: REQ-211\~226, 마이그레이션 0008, 05 앱 규칙 A27·A28, 결정 E23, 규칙 테스트 10개(175 → 185). 제외: REQ-019·021·037·040·048·080·087·160. 없앤 값 `OwnerTask.waitStatus`의 `parked`. 새 SPEC·TBL·API·SCR·DEC·OPEN 없음. 검사(checks.sh prF 09:45\~09:50 KST와 prF2 09:52\~09:56 KST, 8개 출력 파일이 서로 같음, 모두 종료 코드 0): prd REQ rows 226, PROBLEMS 0; flows PROBLEMS 0, Must 153/158(없는 것 REQ-161·169·158·164·145), all 194/206; spec 오류 0, SPEC 75, 기능 185/185, 기능 필수 143/143; erd 15/15, D2 마이그레이션 8, D4 규칙 테스트 185, E1 테이블 53·컬럼 657·관계 116·인덱스 77(다이어그램 2026-11-14T00:09:27+00:00); api 17/17, A5 예시 792(+09:00 시각 752), A6 447, A13 깨지는 변화 5, M1 요청 865, D1 값 5104; sitemap 17/17(숫자 그대로); screens 15/15, C4 데이터 196·액션 147, C6 응답 행 851, C8 참조 1728, C10 확인 문구 7·손님 문구 47, C11 허용 예외 810; mockup 14/14, C8 값을 빼고 맞춘 것 567(573에서), C9 허용 예외 185, C11 아트보드 113. e84bc7f 뒤 check_erd만 다시 돌려 15/15, 출력이 prF2와 같음. scan.py로 단계 문서를 ac9cf89 판과 견줘 금지어 수가 늘어난 파일 없음(295 → 288, 모두 검사가 허용하는 꼴). 결정과 다르게 하거나 더한 것: (a) 추천안에 없던 REQ-217(결제 기한 지남 주문의 결제 없어 취소)을 더함, 사장님의 고르기도 기다림이고 픽업 일시가 지나면 연장을 막아 남는 길이 취소뿐이라서(requirements.md 11절). (b) 문제 신고·맞추는 중·환불 결정은 돈이나 보상이 걸려 자동으로 닫지 않고 지연 뒤 할 일 목록에 남김. (c) RA-17 둘째(사장님이 채널 친구가 아님)는 PR C의 REQ-183·SPEC-067로 다뤄 그대로, PR C가 남긴 RA-10 둘째는 REQ-218로 닫음. (d) 채널 추가는 주문 요청 확인 카드에서 권하되 조건으로 두지 않음(REQ-121, SPEC-028). (e) M9는 요구사항을 바꾸지 않고 04 상태 머신과 05 규칙에서 고침. (f) 첫 작업 세션이 05 README 11절의 짝 트리거 행 근거를 'M9(RB-20)'으로 적었던 것을 지적 원문(RC-17은 짝, RB-20은 1-2 전이 이름)과 견줘 RC-17로 고침(e84bc7f). (g) 05 README 8절 검사 블록은 09:09 판을 그대로 둠, 지금 출력과 다른 것은 D5의 기다림 1.5초와 1.4초뿐. (h) 09 원본과 보드는 그대로: `gen_screens.py`로 100개를 다시 그려 같아 다시 그린 보드·캔버스 다시 올리기 없음, 09 README에는 검사 숫자(C8 573 → 567)와 12절 기록만. 07은 원본과 숫자가 그대로라 기록 없음. (i) GitHub MCP의 PR 만들기가 본문 끝 두 줄을 자기 꼬리말로 바꿔, `update_pull_request`로 두 줄을 다시 넣음(다시 읽어 남은 것을 확인). 남은 것: PR #33에 Codex 자동 검토가 합칠 때 돌고 있었음(e84bc7f 기준, 그때 의견 없음) — 의견이 오면 다음 PR에서 봄. 04 3절 R14(기한 전에 입금했다고 말한 손님의 자리를 사장님이 고를 때까지 지킴)는 04 체크포인트 때의 결정 기록이라 그대로 두었고 지금 규칙은 1-3과 8절(REQ-223의 상한)에 있음 — PR J 앞뒤 맞추기에서 3절에 '버전 5에서 바뀜' 표시를 둘지 봄. Notion 기록은 이 세션에서 하지 않음(조정 세션 몫). 다음 PR이 알 것: (64) 작업 세션이 멈추면 `git log`·`git diff <base>..HEAD`의 stat부터 읽어 되살림. 반쯤 쓴 문서에 `@@T06@@` 같은 시각 자리가 남을 수 있으니 `grep -rn '@@T'`로 찾고, 그 숫자가 지금 검사 출력과 같은지 본 뒤 그 검사를 돌린 시각으로 채움. (65) 08 정의만 바뀌고 09 원본(`screen_samples.py`·`gen_screens.py`)이 그대로면 `gen_screens.py`로 100개를 다시 그려 같은지 보고, 같으면 09 README에는 검사 숫자와 12절 기록만, 캔버스 다시 올리기 없음. (66) 문서에 지적 ID를 적을 때는 `finding.py`로 그 지적의 '위치'·'고치는 방향'을 보고 맞춤. 같은 묶음 안의 지적이 섞이기 쉬움(M9: RB-19 빈 전이, RC-17 짝 트리거, RB-20 1-2 전이 이름과 문장). (67) 두 테이블에 걸친 짝 규칙은 양쪽 테이블에 `CREATE CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED`를 두고 같은 검사 함수를 부름(커밋 때 봄). 규칙 테스트는 `pg_temp.expect_fail`에 여러 문장 배열로. 다이어그램에 담지 못하는 트리거는 `erd_editor_sync.py`의 트리거 메모로. (68) GitHub MCP `create_pull_request`는 본문 끝 두 줄을 자기 꼬리말로 바꿀 수 있음: 만든 뒤 `update_pull_request`로 같은 본문을 다시 보내고 `pull_request_read get`으로 끝 두 줄을 확인. (69) 다음 번호: REQ-227, SPEC-076, 마이그레이션 0009, TBL-054, API-078, DEC-23, OPEN-10, 05 앱 규칙 A29·결정 E24, SCR-051.

## PR X — Codex 후속: 더 들어온 금액의 환불 계산값, 환불 상한 1억 원, 지울 사진 파일, 운영자의 대화 글 (2026-11-14)

https://github.com/kodonghui/siljang.ai/pull/34, 합친 커밋 d2177a72a8bcec844a1c421c0aa21f6eff50d92b(가지 커밋 f63d57a 02\~04·f3c7ed6 05·fc37e64 05 다이어그램 커밋 뒤 검사 결과·c5dc081 06\~09·f8b0bc8 고친 기록 한 행을 squash). 근거: 합친 PR에 해결되지 않고 남은 Codex 자동 검토 의견 넷(https://github.com/kodonghui/siljang.ai/pull/27#discussion_r4564156224, https://github.com/kodonghui/siljang.ai/pull/27#discussion_r4564156241, https://github.com/kodonghui/siljang.ai/pull/30#discussion_r4567801476, https://github.com/kodonghui/siljang.ai/pull/31#discussion_r4568849791)을 지금 main 원본과 대조해 넷 모두 맞음. 지키게 한 결정: 동희님 2026-11-13 20:59 결정 카드 '추천안대로 (추천)'의 H1(더 들어온 금액은 넘은 몫을 환불)·H3(지난 기록의 사진 파일도 지움)·H4(운영자에게는 가린 값만). 고친 것: (1) 취소 뒤 들어온 입금·더 들어온 금액의 계산값 = 그 결제 안내의 들어온 금액 - 결제 확인을 취소하지 않은 확인된 결제(SPEC-016, API-049 설명과 예시 `over_received` 차액 20,000원에 21,000원 → 1,000원), 05 BEFORE 트리거 `refunds_unconfirmed`(A29, ERRCODE check_violation, 결제 안내가 없거나 다른 가게 것이면 그냥 통과시켜 `refunds_request_chk`·FK 테스트가 제 이름으로 막힘). (2) `refunds.amount`·`calculated_amount`와 06 환불 금액 필드 한도 1,000만 → 1억 원(넓힘이라 깨지는 변화 목록에 넣지 않음, 06 README 11절에 이유). (3) 새 테이블 `file_deletions`(TBL-054, E24): 사진 행을 지우는 트랜잭션에서 저장 위치를 넣고 저장소에서 지운 뒤에만 뺌, 실패는 `attempts`·`last_tried_at`(둘은 함께), 운영 기록 detail에 files·files_left, 05 README 6절·FL-014·SPEC-065·api_catalog.JOBS SPEC-065를 함께 고침(규칙 30). (4) REQ-227: 운영자 상담 보기는 메시지마다 발신자·시각·종류·글자 수·사진 수만(`OperatorMessage.textLength`), 대화 글은 API-077 `consultation_text`(상담 ID, 보고 있는 페이지의 `cursor`, 20개까지, `OperatorMessageText`)로 사유를 적어 열고 `access_logs.target_kind` `consultation_text`(action open_original), 지운 상담은 409 `original_erased`. 깨지는 변화 3개(A13): `OperatorMessage.textMasked` 없앰, `OperatorMessage.textLength`·`OriginalValue.consultationText` 더함. 새 ID: REQ-227, TBL-054, 마이그레이션 0009, 05 앱 규칙 A29, 결정 E24. 규칙 테스트 185 → 198(막힘 168, 늦은 쓰기 3, 받아야 할 쓰기 2, 지우기 결과 25). 07은 sitemap.yaml의 SCR-050 note만 바뀌고 note가 생성 파일에 없어 `build_sitemap.py --write`가 0개를 다시 만듦. 08은 SCR-025(`API-049#200:over_received`)·SCR-050. 09는 `gen_screens.py`로 100개를 다시 그려 같아 기록만(규칙 65). 검사(checks.sh prX 10:56\~11:01 KST, 8개 모두 종료 코드 0): prd REQ rows 227, PROBLEMS 0; flows PROBLEMS 0, Must 154/159, all 195/207; spec 오류 0, SPEC 75, 기능 186/186, 기능 필수 144/144; erd 15/15, D2 마이그레이션 9, D4 규칙 테스트 198, E1 테이블 54·컬럼 664·관계 117·인덱스 77(다이어그램 2026-11-14T01:36:25+00:00); api 17/17, A5 예시 795·시각 759, A6 447, A13 3, D1 5106, M1 867; sitemap 17/17(숫자 그대로); screens 15/15, C6 853, C8 1730; mockup 14/14, C8 5575·567. 의견 스레드 넷은 합친 뒤 해결로 닫음(넷 모두 맞음이라 답글 없음). PR 본문은 `update_pull_request`로 다시 보내 끝 두 줄을 확인(규칙 68; 이번에는 확인을 `gh api`로 읽었는데, 다음에는 `pull_request_read get`으로). Notion 기록은 이 세션에서 하지 않음(조정 세션 몫). 다음 PR이 알 것: (70) 받아야 하는 쓰기는 `pg_temp.expect_ok(이름, 문장 배열)`: 문장을 돌리고 `SET CONSTRAINTS ALL IMMEDIATE` 뒤 되돌리며 막히면 실패로 남김. `check_erd.py` D4는 `expect_(fail|stale|left|ok)`를 셈. (71) `scan.py`에는 저장소 경로를 절대 경로(/home/user/siljang.ai)로 넘김. '.'이면 스크래치 폴더에서 `check_mockup`을 못 찾음. (72) 다른 테이블 행에 따라 달라지는 한도(환불 계산값 ≤ 들어온 금액 - 확인된 결제)는 CHECK가 아니라 BEFORE 트리거로 두고, 참조 행이 없으면 통과시켜 FK·CHECK가 제 이름으로 막게 함. (73) 06에 응답 예시 이름을 더하면 08 `screens_common.py`의 `OK_TEXT`에 (API, 예시) 행을 더하고, 기본 상태가 아니면 그 화면 `resp`에 이음(C6이 행을 셈). (74) 응답 스키마에서 필드를 없애거나 꼭 있는 필드를 더하면 A13 문자열('필드 없앰: 스키마.필드', '꼭 넣을 필드 더함: 스키마.필드') 그대로 BREAKING_CHANGES에 적음. 보낸 값을 그대로 돌려주는 고를 값 더함과 한도 넓힘은 넣지 않고 06 README 11절에 이유. (75) 다음 번호: REQ-228, SPEC-076, 마이그레이션 0010, TBL-055, API-078, DEC-23, OPEN-10, 05 앱 규칙 A30·결정 E25, SCR-051.

## PR G1 — M4·M13 환불 계산의 차례, 차액 돌려주기, 다른 금액의 사유, 재제작 주문의 돈과 후기 (2026-11-14)

https://github.com/kodonghui/siljang.ai/pull/35, 합친 커밋 fcdf67e7c2adeddcd080ca2eae44bd9d82c6998d(가지 커밋 03a7238 02\~04·b1a77b4 05·a6a86d1 05 8절 검사 결과·79bb22d 06 중간 저장(턴 한도, 조정 세션이 커밋)·7d956da 06·08·09·2e98421 06·08 재제작 주문의 변경 요청·28a3e56 고친 기록 한 행·c5ea51d Codex 의견·1dfced7 문서 검사 결과 중간 저장(턴 한도, 조정 세션이 커밋)을 squash, 합친 트리가 1dfced7과 같음). 동희님 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)'. M4·M13에는 'Claude 추천'이 없어 검토자의 '고치는 방향'대로. PR A(환불 길, 계산값 아래로 못 내림)와 PR X(더 들어온 금액의 몫, 상한 1억 원, `refunds_unconfirmed`) 위에 쌓음. 지적별로 고친 것: RB-06 SPEC-016 계산 차례 ① 바탕 = 받은 금액 - 이미 정한 환불 - 따로 정할 환불 ② 맞춤 재료 주문·제작 시작 전이면 제작 전 비율, 뒤면 기준 픽업 일시까지 남은 시간(1시간 미만 버림)이 든 단계의 비율(단계가 없는 운영규정 버전은 제작 전 비율) ③ 고정 취소 수수료를 먼저 뺌(바탕보다 크면 0원, 음수 없음) ④ 비율을 곱하고 원 미만 버림 ⑤ 0원 이상 바탕 이하, 수락 기준 더함. SPEC-005 단계 행은 0시간부터 끝없음까지 빈 구간·겹침 없이(06 API-021 422 `gap`·`overlaps`·`required`). SPEC-042·045·047 금액이 내려간 변경은 '차액 돌려주기'(일부 환불) 하나(05 `refunds_change_decision_chk`, 06 API-050 `full`은 422 `not_allowed`). 05 A30(계산값의 차례), 06 `RefundBasis` 필드 4개(`excludedAmount`·`preProductionRefundPct`·`pickupBasisAt`·`remakeOrder`)와 예시 `after_start`(15,500원). RC-18 원 미만 버림과 수수료를 먼저 뺌을 SPEC-016, 05 `refunds.calculated_amount`·`operating_rules.pre_production_refund_pct`·`refund_tiers.hours_before_min` 설명, 06 `RefundPreview.calculatedAmount` 설명에. RE-16 수수료는 저장 때 계약 한도 0원\~1,000만 원만 보고 주문 금액과는 계산 때 견줌(SPEC-005·016), 08 SCR-038 한도, SCR-025 '수수료가 바탕보다 커서 0원'. RC-14·RD-19 계산값과 다른 환불의 사유는 1\~200자 꼭(PR A의 아래로 못 내림 규칙 때문에 보상이 아니면 높은 금액만 다름). 보상의 환불은 고른 금액이 계산값이라 사유 없음: 05 `refunds_override_chk` 그대로·설명 고침, 06 `RefundInput.overrideReason`(빠지면 `/overrideReason` required), `CompensationInput.refundOverrideReason` 없앰, 08 SCR-025·027. RB-17 재제작 주문은 결제 없는 주문이라 받은 금액·한도·환불 계산·장부를 원래 주문에서: 재제작 주문의 환불은 재제작 주문의 `orderId`로 미리 보고 정하되 원래 주문에 남김(`order`는 원래 주문, `basis.remakeOrder`가 재제작 주문, 예시 `remake_cancel`), 재제작 주문의 변경 요청은 금액이 그대로일 때만(API-063 `amountDelta` 0만, 422 `not_allowed`, SCR-024), 재제작 주문에 들어온 신고의 `paidAmount`는 원래 주문 것(API-065), 재제작 주문의 장부 쓰기는 원래 주문 행에 '재제작'으로(A14), 후기 부탁은 보내기 전에 문제 신고를 다시 보고 재제작 주문도 0건(SPEC-061). 05 트리거 `orders_remake_root`(재제작의 재제작도 돈을 낸 원래 주문을 가리킴)·`payment_requests_remake`·`refunds_remake`·`ledger_rows_remake`, A31. 04 SPEC-016·046·047·048·059·060·061·064와 1-2, 06 API-048·049·050·063·065, 서버 안의 일 SPEC-061·064, 08 SCR-009·011·024·025·027. Codex 자동 검토 의견 하나(https://github.com/kodonghui/siljang.ai/pull/35#discussion_r4571233614, P2, 2e98421 기준): 재제작 주문의 새 픽업 일시는 보상을 정한 뒤 60일 안이라 원래 주문이 끝나고 30일 뒤 먼저 지워질 수 있음 — 원본과 대조해 맞음. 같은 PR에서 원래 주문은 그 재제작 주문이 모두 끝날 때까지 끝나지 않고, 끝난 재제작 주문을 다시 열면 원래 주문도 다시 엶(SPEC-025·060·065와 수락 기준 2개, 05 함수 `orders_remake_finish_check()`와 지연 제약 트리거 `orders_remake_finish`, `orders.finished_at` 설명, A22·A31, 03 FL-014 예외 경로 한 줄, 02 11절 한 문장, 06 JOBS SPEC-065). 스레드는 합치기 전에 해결로 닫음(맞음이라 답글 없음). 1dfced7의 Codex 코드 검토·보안 검토는 의견 없이 끝남(PR 댓글의 Codex Review Summary). 새 ID: 마이그레이션 0010(CHECK 1, 함수 3, 트리거 5(지연 제약 트리거 1), 설명 14), 05 앱 규칙 A30·A31. 새 REQ·SPEC·TBL·API·SCR·DEC·OPEN과 제외한 ID 없음. 규칙 테스트 198 → 207(막아야 할 쓰기 7, 받아야 할 쓰기 2). 깨지는 변화 A13 5개와 A13 밖 4개(API-050 `full`, API-021 단계별 환불 규칙, API-063 재제작 주문의 `amountDelta`, 재제작 주문의 `paidAmount`·`order`). 07 그대로. 09는 `gen_screens.py`로 100개를 다시 그려 같아 README 12절 기록만(규칙 65). 검사(checks.sh prG1 12:51\~12:56 KST, 1dfced7, 8개 모두 종료 코드 0, 단계 문서의 12:46\~12:47 기록과 같고 다른 것은 05 D5의 기다림 1.4초·1.5초뿐): prd REQ rows 227, PROBLEMS 0; flows PROBLEMS 0, Must 154/159, all 195/207; spec 오류 0, SPEC 75, 기능 186/186, 기능 필수 144/144, 예외 [상태] 125(122); erd 15/15, D2 마이그레이션 10·함수 6·트리거 10, D4 규칙 테스트 207(막힘 175, 늦은 쓰기 3, 받아야 할 쓰기 4, 지우기 결과 25), CHECK 355, S4 데이터 909건·컬럼 445개, E1 테이블 54·컬럼 664·관계 117·인덱스 77(다이어그램 2026-11-14T03:45:57+00:00); api 17/17, A5 예시 797·시각 763, A6 447, A7 136자리, A13 5, M1 요청 869, D1 5106; sitemap 17/17(숫자 그대로); screens 15/15, C6 응답 행 855, C8 참조 1732, C11 허용 예외 810; mockup 14/14, C8 문구 5575·값을 빼고 맞춘 것 567, C9 허용 예외 185. `erd_editor_build.py --compare` 차이 0. scan.py로 바꾼 단계 문서 17개와 SQL을 d2177a7 판과 견줘 늘어난 파일은 새 0010 하나(0 → 1, `schema.sql`에서 옮긴 `ledger_writes.event_kind` 설명, `schema.sql`은 29 → 29). PR 본문은 `update_pull_request`로 다시 보내 `pull_request_read get`으로 끝 두 줄을 확인(규칙 68). Notion 기록은 이 세션에서 하지 않음(조정 세션 몫). 결정과 다르게 하거나 더한 것: (a) 단계별 환불이 없는 운영규정 버전은 제작 뒤 취소에도 제작 전 비율, 화면은 저장 전에 알리기만(막지 않아 확인 창·409 없음). (b) 재제작 주문의 변경 요청 금액 0은 06의 422로 막고 05는 결제 안내·환불·장부 트리거로 돈의 행만 막음(변경 요청 행에 CHECK 없음, A31), 변경 요청 응답에 재제작 주문 표시가 없어 SCR-024는 서버의 답으로 알림. (c) SCR-009 취소 결과의 '확인된 결제가 있으면'을 '받은 금액이 있으면'으로(SPEC-046). (d) Codex 의견: REQ-185의 글은 그대로 두고 '그 주문의 신고가 닫힘'을 보상인 재제작 주문이 끝남까지로 읽어 04·05에 적음, FL-014는 다이어그램 그대로 예외 경로 글만. 남은 것: REQ-185 글에 재제작 주문을 넣을지는 PR J 앞뒤 맞추기에서 봄. M5·M6은 PR G2. 다음 PR이 알 것: (76) 고치는 방향의 열쇠말(예: '사유 1\~200자', '수수료 상한', '원 미만')을 04 → 05 CHECK·설명 → 06 required·422 포인터·예시 → 08 폼 한도·결과 문구로 `grep -rn`해 한 번에 맞춤; 필드를 꼭 받게 바꾸면 06 `required`와 422 `/필드` 예시, 08 입력 검증 행까지. (77) 한 행이 다른 행의 돈을 남기는 짝(재제작 주문 → 원래 주문)은 남기는 쪽이 받는 쪽보다 늦게 끝나면 안 됨: 끝남·지우기 조건에 짝을 넣고 양쪽 행을 보는 지연 제약 트리거(`orders_remake_finish`)로. 규칙 테스트에서 끝난 행이 필요한 '다시 엶' 테스트는 지우기 준비의 `SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;` 뒤, `purge_run` 앞에 둠(지운 뒤에는 `orders_purged_chk`가 다시 엶을 막음). (78) 편집 스크립트는 다시 돌려도 같게: `edit()`가 새 글이 이미 있으면 넘기고, 앵커는 PR마다 다른 글을 넣어 한 번만 나오게(PR X와 PR G1 블록의 같은 문장에 두 번 맞음). 중간에 멈추면 손으로 고치지 말고 고친 스크립트를 다시 돌림. (79) scan.py 출력은 줄 앞에 빈칸이 없을 수 있어 `grep -c "TERM-"`로 셈. 새 마이그레이션이 `schema.sql` 설명을 옮겨 허용된 꼴의 금지어가 늘면 `schema.sql` 수가 그대로인지 보고 PR에 적음. (80) Codex는 밀 때마다 다시 봄: 합치기 전에 `get_review_comments`의 스레드와 함께 `get_comments`의 Codex Review Summary(code_review의 commit_sha가 머리 커밋이고 has_any_findings false)를 봄. 이 PR에 온 맞는 의견은 같은 PR에서 고치고 스레드를 해결로 닫음. (81) 요구사항 글을 바꾸지 않고 04·05에서 좁히거나 넓혀 읽으면 02 11절과 PR '결정과 다르게 하거나 더한 것'에 적음(REQ-185). (82) 다음 번호: REQ-228, SPEC-076, 마이그레이션 0011, TBL-055, API-078, DEC-23, OPEN-10, 05 앱 규칙 A32·결정 E25, SCR-051.

PR G2(설계 재검토 M5·M6: 손님의 새 금액 확인, 차액 결제의 가장자리, 금액 방향 고르기, 기본 디자인 범위, '부터'·'범위' 견적의 최종 금액): https://github.com/kodonghui/siljang.ai/pull/36, 합친 커밋 c896b2055217894f4c271fabebb1709b2b18ccb7(가지 커밋 818ad14 02\~04·7832704 05·54653b0 05 8절 검사 출력·959ac73 06·4438cdf 06 깨지는 변화의 화면 ID·85a2921 07·0d834eb 06 `ChangeRequest.orderAmount`와 금지어·02877ac 08·26725cc 09와 08·09 README·c978781 고친 기록 한 행·ef9ed3f 08 README 9절 숫자를 squash, 합친 트리가 머리 커밋과 같음). 동희님 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)'. M5·M6에는 'Claude 추천'이 없어 검토자의 '고치는 방향'대로. PR A·PR F·PR G1 위에 쌓음. 지적별로 고친 것: RA-08 정한 금액이 손님이 본 금액(확정은 그 금액, '부터'는 아래 끝, '범위'는 위 끝)보다 높은 맞춤 주문 수락과 금액이 오르는 변경 수락은 결제 안내가 새 금액 확인 카드부터 감(REQ-231(REQ-155를 바꿈)·232·233, SPEC-076, 05 결제 안내 컬럼 넷 `needs_amount_confirm`·`amount_confirmed_at`·`amount_declined_at`·`amount_card_id`와 CHECK 여섯(E25), 06 API-046·058·071 `amount_confirm` 카드와 결과 `amount_confirmed`·`amount_declined`, 08 SCR-005 새 상태 `amount-confirm`). 확인한 때가 전해진 시각이고 결제 기한은 그때부터, 확인 전의 결제 기한은 결제 기한 상한(맞춤)이나 변경 마감(차액). 받지 않으면 맞춤 주문은 손님 취소, 변경은 '차액 없어 닫힘'(새 상태 없음). RB-07 변경 마감이 지난 변경 요청의 수락·거절은 409 `invalid_state`(SPEC-042), 다르게 들어온 차액은 SPEC-035의 금액 불일치 길로 맞추고 '대조 완료'로 반영하거나 '변경 닫기'(06 API-059 `close_change`·`change_closed`)로 변경 요청만 닫고 들어온 금액은 '더 들어온 금액' 환불(REQ-235), 차액을 기다리는 동안 옛 날의 확정된 자리는 그대로·새 날 자리는 차액 결제 기한까지 잡음(REQ-234, Claude가 더함, 05 부분 UNIQUE 둘과 트리거 `slot_holds_pair`, E26), 닿지 않던 변경 상태 '오래된 버전'(`stale`)과 할 일·오류 코드 `stale_change`를 뺌, 결제 확인 취소(SPEC-070)는 열리거나 반영된 변경 요청이나 정한 환불이 있으면 막음. RE-17 06 `ChangeDecisionInput.amountDirection`(same·up·down)과 양수 `amountDifference`(DEC-23, 서버가 부호를 붙여 `amountDelta`), `ChangeRequest.orderAmount`(화면의 결과 한 줄), 08 SCR-024 '그대로 · 올라감 · 내려감'·차이 금액·결과 한 줄. RA-07 사장님이 가격표의 옵션·도안마다 기본 디자인 범위를 정해 그 버전에 남기고(REQ-228, 05 `price_options.in_standard`·`designs.in_standard`, CHECK `price_options_standard_fixed_chk`·`quotes_standard_fixed_chk`, A32), 주문 종류는 AI가 아니라 가게 규칙이 그 범위로 가름(REQ-229, SPEC-013·027, AI-1, 08 SCR-036). RB-18 '부터'·'범위' 견적의 맞춤 주문은 최종 금액(아래 끝 이상, 422 `below_quote_min`)을 넣는 '금액 변경 수락'으로만, '수락'은 '확정' 견적에만(REQ-230), 요청한 견적은 표시 그대로(`PaymentRequest.requestedQuote`, REQ-231). 새 ID: REQ-228\~235, SPEC-076, 마이그레이션 0011, 05 앱 규칙 A32·결정 E25·E26, 06 DEC-23, 08 상태 `amount-confirm`. 뺀 ID: REQ-155(→ REQ-231), 변경 상태 `stale`, 할 일·오류 코드 `stale_change`. 규칙 테스트 207 → 221. 깨지는 변화 A13 12개와 A13 밖 5개. 07 SCR-005·016·022·024·029·036(할 일 유형 15 → 14, 노드 326 → 333). 08 SCR-003\~011·013·016·019\~024·028·029·036, 상태 이름 27 → 28. 09 SCR-022·024 보드 4개 다시 그림: SCR-022는 `gen_screens.py`의 맞춤 보드(CUSTOM)라 08 정의를 다시 만들어도 그림이 그대로여서 `scr022`가 08의 폼·결과 한 줄·버튼 줄을 `render_block`으로 그리게 고침, 높이는 page-check로 재서 `heights.json`(SCR-022 360 1256 → 1559, 1280 982 → 1305, SCR-024 360 912 → 1059, 1280 892 → 1050), `canvas.json`은 두 화면 높이와 아래 줄 y. 09 C8이 처음에 실패(후보 시안 A·B SCR-022 360의 옛 정의 문구 '바꾼 금액'·'요청 금액 70,000원 · 1원\~1,000만 원'): 후보 시안은 다시 그리지 않고 `check_mockup.py`에 후보 시안에서만 받는 `CANDIDATE_COPY`를 두고 '손님 결제 안내에'·'으로 보내요'도 옮김(예외 10 → 12). 검사(checks.sh prG2 15:59\~16:04 KST, 26725cc, 8개 모두 종료 코드 0, 그 뒤 08 README 9절 숫자를 고치고 16:06에 08을 다시 돌려 같음): prd REQ rows 235, PROBLEMS 0; flows PROBLEMS 0, Must 162/167, all 202/214; spec 오류 0, SPEC 76, 기능 193/193, 기능 필수 152/152, 예외 [상태] 139; erd 15/15, D2 마이그레이션 11·함수 7·트리거 11, D3 CHECK 363, D4 규칙 테스트 221(늦은 쓰기 3, 받아야 할 쓰기 5, 지우기 결과 25), S4 데이터 964건·컬럼 449개, E1 테이블 54·컬럼 668·관계 118·인덱스 77(다이어그램 2026-11-14T05:25:28+00:00); api 17/17, A5 예시 801·시각 797, A6 446, A7 136자리, A13 12, M1 요청 872, D1 5106; sitemap 17/17, S8 노드 333·화면 212, S13 할 일 유형 14, S14 허용 예외 76; screens 15/15, C4 데이터 201·액션 151, C5 그린 상태 354·상태 이름 28, C6 응답 행 896, C8 참조 1791, C11 허용 예외 838; mockup 14/14, C8 문구 5608·값을 빼고 맞춘 것 549·이유를 적은 예외 12·접근성 이름 18, C9 허용 예외 185, C11 contrast-image 25(SCR-024 360 2개 더함: 확인 창 프레임의 막과 아래 버튼 줄에 덮인 '거절 사유'·'바로 반영해요'). scan.py로 바꾼 문서·SQL 41개를 fcdf67e 판과 견줘 늘어난 파일은 새 0011 하나(0 → 4, `schema.sql` 설명을 옮긴 것, `schema.sql`은 30 → 30). PR 본문은 `create_pull_request`가 끝 두 줄을 바꿔 `update_pull_request`로 다시 보내고 `pull_request_read get`으로 확인(규칙 68). Codex: PR을 연 지 17분이 지나도 자동 검토의 요약 댓글이 없어 16:17 KST에 '@codex review' 댓글(꼬리말 포함)로 요청했고, 머리 커밋 ef9ed3f의 코드 검토가 의견 없이 끝남(Codex Review Summary has_any_findings false, 스레드 0, 'Didn't find any major issues'). 수동 요청이라 보안 검토는 돌지 않음. Notion 기록은 이 세션에서 하지 않음(조정 세션 몫). 결정과 다르게 하거나 더한 것: (a) 손님의 확인은 손님이 본 금액보다 높을 때만. (b) 아래 끝 규칙은 '부터'·'범위' 견적에만, 알레르기 답만으로는 맞춤으로 가르지 않음(TERM-038은 PR J). (c) 받지 않음은 새 상태 없이 손님 취소·'차액 없어 닫힘'. (d) 확인 전에 사장님이 '입금됨'·'대조 완료'를 고르면 그 시각을 손님의 확인으로. (e) REQ-234는 Claude가 더함. (f) SPEC-070 결제 확인 취소를 열리거나 반영된 변경 요청·정한 환불이 있으면 막음. (g) `in_standard` 기본값 true, 데이터베이스는 확인 필요를 '금액 > 요청 금액'으로만 보고 범위 견적의 위 끝은 앱 규칙(A32), 닫힌 자리의 풀린 사유 `change_closed`. (h) 06 `ChangeRequest.orderAmount` 더함. (i) 08 새 상태는 `amount-confirm` 하나, SCR-005의 시간 지난 새 금액 카드는 `expired`가 아니라 지금 값의 새 카드. (j) SCR-024 금액 방향은 처음 고른 값 없음(09 보드만 '그대로'). 남은 것: 캔버스(Artifact)의 SCR-022·024 다시 올리기, SCR-005의 `amount-confirm`·`done`·`permission`은 09에서 그리지 않음, `OrderSummary.paymentNotice`에 확인 기다림 표시가 없어 SCR-020은 '아직 못 전함', Schemathesis 다시 돌리지 않음, 01 용어(TERM-038 등)는 PR J. 다음 PR이 알 것: (83) 09의 맞춤 보드(`gen_screens.py` CUSTOM: SCR-001·016·022)는 A 방향 시안의 부품으로 그려 08 정의를 다시 만들어도 그림이 바뀌지 않음. 08에서 그 화면의 레이아웃·버튼이 바뀌면 그 함수를 고쳐 08 블록을 `render_block`으로 그리고, 보드 100개를 다시 그려 바뀐 보드만 바뀌는지 봄. (84) 후보 시안(A-·B-)은 방향을 고른 기록이라 다시 그리지 않음. 08 정의에서 후보 시안의 문구가 없어져 09 C8이 실패하면 `CANDIDATE_COPY`(후보 시안에서만 받음)에 이유와 함께 더하고 09 README 7절에 적음. (85) 08에 새 상태를 만들 때 09가 그리는 상태(normal과 empty·error·confirm·expired·not-sent·deferred) 안의 이름이면 보드를 그려야 하므로, 그릴 생각이 없으면 그 밖의 이름을 쓰고 09 README 12절 '그리지 않은 것'에 적음. (86) 08 C11·09 C9의 허용 예외 수는 한 낱말을 금지한 TERM마다 셈(예: '입금'·'확정'은 두 번)이라 미리 셈하지 말고, README를 마지막으로 고친 뒤 검사를 다시 돌려 그 출력의 수와 시각을 적음(15:54 출력 834와 전체 검사 838이 달라 다시 돌림). (87) 바꾼 문서의 금지어 수를 main 판과 견줄 때는 `git worktree add <scratch>/mainwt main`으로 main을 따로 꺼내 scan.py의 첫 인수로 주고(그 안의 `check_mockup`을 읽음) 끝나면 `git worktree remove`. (88) `gh`는 검색에만 쓰고 PR 읽기·쓰기는 GitHub MCP로. (89) Codex 자동 검토가 PR을 연 뒤 몇 분 안에 요약 댓글(Codex Review Summary)을 남기지 않으면 '@codex review' 댓글(꼬리말 포함)로 요청하고, 요약의 code_review commit_sha가 머리 커밋이고 has_any_findings가 false인지 본 뒤 합침(수동 요청은 보안 검토를 돌리지 않음). (90) 다음 번호: REQ-236, SPEC-077, 마이그레이션 0012, TBL-055, API-078, DEC-24, OPEN-10, 05 앱 규칙 A33·결정 E27, SCR-051.

PR H1(설계 재검토 M7·M17: 요청 키의 지문·처리 상태·다시 읽은 처음 결과, 이벤트 키 형식과 대상마다 하나, 덧붙은 질문·날짜마다 따로 두는 마감된 날 질문·한 번만 쓰는 추가 수락, 초안의 날짜와 시각, 더하는 옵션 연결 테이블): https://github.com/kodonghui/siljang.ai/pull/37, 합친 커밋 da0a7f57254220bf095c5da63b5cef4a5616ff13(가지 커밋 eaef7c0 05·6f4d33a 05 새 테이블 자리·a62a361 05 README·10dba32 06·eb2b032 04·08·5242833 05 후속(금지어 고침 포함) 중간 저장(턴 한도, 조정 세션이 커밋)·7a46d66 05 README 8·9·11절·d3b2950 고친 기록 한 행·93d281f 05 장부 쓰기 키(Codex 의견)·10bdec2 05 8·9절 검사 출력과 고친 기록 행을 squash, 합친 트리가 머리 커밋 10bdec2와 같음). 동희님 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)'. M7·M17에는 'Claude 추천'이 없어 검토자의 '고치는 방향'대로. PR F·PR G1·PR G2 위에 쌓음. 지적별로 고친 것: RC-16 요청 키(TBL-050)에 요청 지문 `request_hash`(명령·경로의 ID·본문을 정한 차례로 이은 HMAC-SHA256)·`state`(처리 중·끝남)·`processing_expires_at`(받은 때 + 60초)·`response_status`(200\~499)·`response_code`·`response_ref`·`done_at`과 `request_keys_state_chk`, `response_body`를 뺌(E27), 06 DEC-04(같은 키에 다른 지문 422 `idempotency_key_reused`, 처리 중 409 `request_in_progress`, 60초가 지나면 같은 지문의 다음 요청이 이어받음, 다시 오면 같은 상태 코드·결과 종류와 그 기록을 지금 다시 읽은 본문에 `Idempotency-Replayed: true`, 422·5xx는 남기지 않음), SPEC-065 지우기 일곱 차례(하루 지난 요청 키, 초안의 더하는 옵션과 덧붙은 질문). RD-05 05 4절 A33과 키 형식 표 7가지(가게마다 `(shop_id, 키)` UNIQUE), 컬럼 설명, 06 DEC-04가 이 형식을 가리킴. RC-06 환불의 대상마다 UNIQUE 넷(`refunds_cancelled_uq`·`_change_uq`·`_issue_uq`·`_request_uq`), `refunds.cancelled_order_id`와 함수 `refunds_cancelled_check()`·트리거 `refunds_cancelled`, `orders.confirmed_payment_id`(주문을 확정한 결제)와 `orders_confirmed_payment_chk`, 함수 `confirmed_payment_live_check()`와 지연 제약 트리거 `orders_confirmed_payment_live`·`payments_confirmed_void`(E29). RC-08 새 테이블 `handoff_questions`(TBL-055: 사유·손님 말·관련 주문, 같은 말은 한 번), 마감된 날 질문은 상담과 날짜마다 따로 건(`handoffs_one_open_day_per_consultation`), `handoffs.day_used_order_id`(추가 수락은 주문 요청 하나에만, E28·A34), SPEC-022·023, 06 `CustomerLine.reason`·`order`·`Handoff.dayUsedOrder`·API-041·042, 08 SCR-017. RC-13 `order_drafts.pickup_day`·`pickup_time`과 `order_drafts_pickup_time_chk`(E30), SPEC-020, 06 AI 출력 `draft_patch.pickup_day`·`pickup_time`. RC-12 연결 테이블 `order_draft_extras`(TBL-056)·`order_detail_extras`(TBL-057)가 같은 가격표 버전의 '더하는 옵션'만 외래 키로 받고, 주문·확인 카드·손님 안내가 상담을 (가게, 상담, 손님)으로 참조(`consultations_customer_key`, E30), 계약 모양은 그대로. 마이그레이션 0012, 테이블 57, 규칙 테스트 221 → 257(DEC-04 6·M7 10·G2 3·M17 17), 06 깨지는 변화 6개(A13 3개, 손으로 3개). 08 README 12절에 PR G2의 M5·M6 기록이 두 번(같은 글) 들어가 있어 하나로 줄임(C11 허용 예외 838 → 834). Codex 자동 검토 의견 하나(https://github.com/kodonghui/siljang.ai/pull/37#discussion_r4572803814, P2, 7a46d66 기준): 장부 쓰기 키 `ledger:{대상 ID}:{이벤트 종류}`의 대상을 주문으로 읽으면 같은 주문의 두 번째 변경과 재제작 주문의 만듦·다음 일이 첫 키에 막혀 장부가 고쳐지지 않음 — 원본(SPEC-045·060·064, `ledger_writes.event_kind`)과 대조해 맞음. 결제 확인 취소 뒤 다른 결제로 주문을 확정함과 한 주문의 환불 둘도 같은 꼴이라 함께 고침: 대상을 그 일을 만든 기록(주문을 확정한 결제·적용된 변경 요청·환불·확인을 취소한 결제, 끝 상태는 주문)으로, 재제작은 `ledger:{대상 ID}:remake:{재제작 주문의 일}`, A33에 '대상은 그 일을 만든 기록'. 보안 검토는 의견 없이 끝남. 고친 뒤 머리 커밋 10bdec2의 Codex 코드 검토는 의견 없이 끝남(has_any_findings false), 보안 검토도 끝남, 스레드는 해결로 바꿈(댓글 없음). 결정과 다르게 하거나 더한 것: (a) '처음 결과를 그대로'는 같은 상태 코드·결과 종류와 처음 결과가 가리킨 기록을 지금 다시 읽은 본문으로 좁힘(처음 본문을 남기면 이름·연락처가 지우기 밖에 남음), 처리 중 기한 60초와 이어받기. (b) 취소 환불은 취소한 주문마다 하나(M13대로 재제작 주문의 환불을 원래 주문에 남기므로 취소한 주문 컬럼을 따로 둠). (c) 주문을 확정한 결제와 지연 제약 트리거 둘을 더함. (d) 마감된 날 질문은 덧붙이지 않고 날짜마다 따로 건, 추가 수락 하나는 주문 요청 하나에만(좁힘). (e) 옵션 그룹 외래 키는 더하는 옵션에만, '덧붙은 질문의 손님 말이 같은 상담의 메시지'는 앱 규칙(A34). (f) 03 FL-014는 개인정보를 지우는 차례가 아니라 고치지 않음(규칙 (30)·(31)과 다름). (g) `order_drafts_pickup_time_chk`를 더하고 `request_keys.created_at`에는 인덱스를 두지 않음. (h) 장부 쓰기 키의 대상(Codex 의견). 손님 안내·할 일·사장님 알림 키는 형식 표를 고치지 않고 A33의 '대상은 그 일을 만든 기록'으로만 읽게 함(좁힘). 도구를 고친 까닭: `check_erd.py` — D5(두 세션이 같은 주문에 결제 확인과 손님 취소를 동시에 씀)의 준비가 결제 없이 주문을 'confirmed'로 바꿔 새 CHECK `orders_confirmed_payment_chk`(주문 확정 뒤 상태의 주문은 주문을 확정한 결제가 있음)에 막혀, 준비에 가게·결제 안내·확인된 결제(`RACE_SHOP`·`RACE_PAYMENT`)를 넣고 확인 쓰기가 `confirmed_payment_id`도 채우게 함, D5 설명의 '확정'도 허용 꼴로. `erd_editor_sync.py` — 새 테이블 셋이 그룹 상자 밖에 놓이고 상자 아래가 다른 그룹에 막혀, `place_new_tables`가 왼쪽 위 꼭짓점으로 상자 안인지 보고(`erd_list` 너비는 어림), 남은 테이블을 `todo`로 모아 상자 밖에 있던 것도 옮기고, 아래가 막히면 오른쪽으로 늘리며, 옮김이 다 끝난 뒤 상자를 구성원 경계(여백 24)로 맞춤. `TRIGGER_TEXT`에 새 함수 둘과 허용 꼴의 '확정'. 검사(2026-11-14 18:35\~18:40 KST, 머리 커밋 10bdec2, `checks.sh prH1b`): 8개 모두 종료 코드 0. prd 행 235, flows 필수 162/167·유효 202/214, spec 오류 0(상태 140·반복 57·입력 51), erd 15/15(규칙 테스트 257, 마이그레이션 12, CHECK 376, 함수 9·트리거 14, S4 998건·컬럼 468, E1 57·692·128·83), api 17/17(A13 3, A5 801·797, A6 446, A7 136자리, M1 872, D1 5106), sitemap 17/17, screens 15/15(C11 834), mockup 14/14(C9 185, C8 5608·예외 12). 견주기(18:34 KST) DDL 133,919자, 양쪽에만 0줄. Codex 의견을 고치기 전 7a46d66의 전체 검사(18:16\~18:22)와 숫자가 같음. 금지어: 바꾼 파일 22개 가운데 `schema.sql` 30 → 29·05 README 34 → 33·`rule_tests.sql` 13 → 12, 새 마이그레이션 0, 나머지 18개 같음, 새로 보이는 것은 05 README 8절 출력 그대로인 D2·D3 줄뿐. 남은 것: 들어온 입금의 환불을 정한 뒤 같은 결제 안내에 또 들어온 금액을 돌려주는 길(`refunds_request_uq`, 열린 문제), 03 FL-014 글 그대로, 앱 규칙 A33·A34는 앱이 없어 테스트하지 못함, Schemathesis 다시 돌리지 않음, 캔버스(Artifact)·Notion 뷰는 바꾸지 않음, 09 보드는 화면 배치가 그대로라 다시 그리지 않음. 다음 PR이 알 것: (91) `erd_list`의 테이블 너비는 어림이라 새 테이블이 그룹 상자 안인지 볼 때는 왼쪽 위 꼭짓점으로 보고, 상자 크기는 옮김이 다 끝난 뒤 구성원 경계에 여백 24로 맞춤(`place_new_tables`). (92) NULL일 수 있는 두 값을 CHECK에서 견줄 때는 `IS NOT DISTINCT FROM`(`=`는 NULL이면 CHECK를 통과시킴). (93) 규칙 테스트에서 새 가격표 버전을 쓰려면 지금 가격표를 먼저 내림(`price_lists_one_current`). (94) 주문을 'confirmed' 뒤 상태로 쓰는 준비(규칙 테스트·`check_erd.py` D5)에는 주문을 확정한 결제(`confirmed_payment_id`)가 있어야 함. (95) `spec_rows.py`의 예외 줄은 6칸, 수락 기준 줄은 5칸 들여씀 — 고치기 스크립트의 앞뒤 글을 그대로 맞춤. (96) 옛 Prism이 `node …/prism mock`으로 남아 `pkill -f prism-cli`에 안 걸리면 포트 4010을 쓰는 PID를 끔(EADDRINUSE). (97) 새 글의 '확정'은 허용 꼴로('확정시킨'·'확정 뒤'·'확정은/이' 대신 '주문을 확정한'·'주문 확정 뒤'·'주문 확정은'), '확정한 것'은 옛말 '정한 것'에, '자리 잡기'는 옛말(가예약)에 걸림. 기록·주석·PR 본문에 금지 꼴을 인용하지 않음. (98) 재검토 README '고친 기록' 행은 PR 번호가 생긴 뒤 더하고, PR 본문의 검사 결과는 그 뒤 커밋까지 포함한 전체 검사로 적음. (99) 기록을 더하는 스크립트는 marker로 한 번만 넣는지 봄(08 README 12절에 같은 기록이 두 번 있었음). (100) 이벤트 키의 대상은 그 일을 만든 기록(A33): 새 키 형식을 정할 때는 그 종류가 한 대상에 두 번 생기는지(두 번째 변경, 결제 확인 취소 뒤 다시 확인, 재제작 주문의 여러 일) 먼저 봄. (101) Codex는 밀 때마다 다시 봄: 고친 뒤 몇 분 기다려 머리 커밋의 요약과 스레드를 보고, 오지 않으면 그대로 합치고 보고(댓글로 부르지 않음). (102) 다음 번호: REQ-236, SPEC-077, 마이그레이션 0013, TBL-058, API-078, DEC-24, OPEN-10, 05 앱 규칙 A35·결정 E31, SCR-051.

PR H2(설계 재검토 M16·M18: AI-1 데이터 다루기·55초 기한·차례 안 호출 순번과 상한, 한 번 보이는 스킬 키와 바꾸기·연결 문구·선점 30분, 본문·쿼리 ID의 같은 422, 사장님 로그인 state·PKCE): https://github.com/kodonghui/siljang.ai/pull/38, 합친 커밋 fb09089902d3b9d926a897eef25545322a891b27(가지 커밋 1f51e6d 02\~04·a87c050 05·e021f8e 05 기록·a539fa6 06·07·08·09 중간 저장(턴 한도, 조정 세션이 커밋)·6d41f61 05\~09 기록과 검사·5260ecc 고친 기록 한 행을 squash). 동희님 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)'. M16·M18에는 'Claude 추천'이 없어 검토자의 '고치는 방향'대로. PR H1 위에 쌓음. 지적별로 고친 것: RB-14 04 AI-1 '데이터 다루기'에 후보 셋(Anthropic·OpenAI·Google 유료 API)의 학습·보관·보관 안 함·처리 지역(2026-11-14 각 회사 공식 문서)과 Claude 추천, 모델 회사는 동희님이 10단계 전에 정함(06 OPEN-7). '시간과 다시 하기': 받은 때부터 55초, 다시 하기는 남은 기한 21초 넘을 때만·다시 쓰기는 20초 넘을 때만이라 20초 호출은 한 차례에 많아야 둘. REQ-142를 제외하고 REQ-236(그 주문의 상세·제작 목록에만, 주문 요청 뒤 같은 상담의 AI 입력에서 그 차례까지 뺌, 12단계 테스트 기준), SPEC-021, FL-004 K6, 08 SCR-030. RD-15 06 OPEN-2: 콜백 문서는 본문(callbackUrl valid time: 5min)과 오류 표(5분이내) 모두 5분(2026-11-14 다시 확인, '1분' 0건), 55초는 그보다 짧고 실제 시간은 개발 전 시험. API-070 `ai_timeout`, 08 SCR-003. RC-07 05 `ai_calls.attempt`의 위 끝(3)을 없애 차례 안 순번(1부터), `call_kind`(first·after_tool·retry·regenerate)와 `ai_calls_kind_chk`(처음은 순번 1에만)·`ai_calls_attempt_uq`, `fallback_reason`에 `call_limit`. 한 차례 호출 8번 상한은 앱 규칙 A35(SPEC-020 한도 예외, 06 `ai_limit_reached`). RD-06 06 API-079 스킬 키 바꾸기(`keep_24h` 기본·`revoke_now`), `SkillSetup.headerValue`를 없애고 `keyVersion`·`keyIssuedAt`·`previousKeyValidUntil`, 새 키는 API-031 `created`와 API-079 응답에만(`skillKey`), 연결 문구 `proofPhrase`('연결 ' 뒤 숫자 6자리)·`claimExpiresAt`(30분), DEC-08, OPEN-10(요청 출처), 05 `kakao_channels.skill_key_version`·`skill_key_issued_at`·`previous_key_until`·`claim_expires_at`과 `kakao_channels_prev_key_chk`·`kakao_channels_claim_chk`(A36), REQ-237·238, SPEC-008·017, FL-001 B8, 07·08 SCR-041(새 데이터 행 둘과 액션 '스킬 키 바꾸기', 확인 창 없이 화면 안의 고르기)·SCR-003·007, 09 SCR-041-360 보드의 글 하나. RD-09 06 DEC-02(본문·쿼리의 ID가 없거나 다른 가게·주문 것이면 422 `validation_failed`의 새 사유 `reference_not_found`, 올린 파일 ID는 올린 사장님만 `upload_not_found`), API-017·049·050·052·068·077의 422 예시, API-068의 404를 없앰, SPEC-068, 08 SCR-044. RD-11 06 API-078 사장님 로그인 시작(nonce 쿠키 `siljang_login` 10분, 서명한 state, PKCE S256 `code_challenge`, 돌아올 주소는 서버 설정 목록만 422), `OwnerSessionInput.state` 필수, API-001은 state가 맞지 않으면 카카오를 호출하지 않고 401 `kakao_login_failed`, DEC-10에 Origin 확인, OPEN-11(PKCE), SPEC-001, 07·08 SCR-014. 숫자: 마이그레이션 0013, 컬럼 692 → 697, CHECK 376 → 381, 규칙 테스트 257 → 272(REQ-237 5·REQ-238 4·AI-1 6), API 77 → 79, 응답 382 → 391, 필드 오류 사유 23 → 24, 열린 질문 9 → 11, 스키마 138 → 142, 06 깨지는 변화 9개(A13)와 손으로 4개. Codex 자동 검토: 코드 검토(6d41f61, 20:01 KST)는 의견 없이 끝남(has_any_findings false), 보안 검토(6d41f61, 20:07 KST)도 의견 없이 끝남, 리뷰 스레드 없음, 머리 커밋 5260ecc(고친 기록 한 행)에는 새 검토가 오지 않아 규칙 (101)대로 그대로 합침(댓글 없음). PR 본문은 만든 도구가 끝 두 줄을 자기 꼬리말로 바꿔, 본문을 고쳐 두 줄을 되돌림(update_pull_request). 결정과 다르게 하거나 더한 것: (a) 옛 키는 바꾼 뒤 24시간 받는 것이 기본, 바로 끊기는 고름(검토자의 '바로 거절'만이면 배포하는 동안 손님 메시지가 끊김). (b) 스킬 키와 연결 문구는 해시로도 저장하지 않고 서버 시크릿과 연결 ID·버전(문구는 연결 확인 시작 시각)으로 다시 만듦. (c) 카카오 PKCE는 OIDC 디스커버리에만 있어 OPEN-11, 받지 않으면 state만. (d) 연결 문구로도 요청 출처는 증명하지 못해 OPEN-10. (e) 본문·쿼리 ID는 422 `reference_not_found` 하나로(경로 ID는 404). (f) 한 차례 호출 8번 상한(A35, 데이터베이스가 막지 않음). (g) 기한 55초(문서 5분보다 짧게). (h) 08 SCR-041의 스킬 키 바꾸기는 새 `confirm` 상태 대신 화면 안의 고르기(규칙 (85)). 검사(2026-11-14 19:59\~20:04 KST, 머리 커밋 5260ecc, `checks.sh prH2b`): 8개 모두 종료 코드 0. prd 행 238, flows 필수 164/169·유효 204/216, spec 오류 0(상태 142·입력 53·노출 42·대상 21·접근 19·한도 13), erd 15/15(규칙 테스트 272, 마이그레이션 13, CHECK 381, 컬럼 697, S4 1006건·컬럼 474), api 17/17(API 79, A13 9, A5 820·825, A6 457, A7 137자리, A8 누구나 5, A9 75, A10 11, M1 891, D1 5106), sitemap 17/17(S7 API 79, S10 79/79, S14 76), screens 15/15(C4 204·152, C6 909, C8 1810, C11 834), mockup 14/14(C9 185, C8 5608·549·예외 12). README 검사 기록 전(19:47\~19:52, prH2a)과 뒤(19:52\~19:57 6d41f61, prH2)와 숫자가 같음. 견주기(19:14 KST) DDL 134,849자, 양쪽에만 0줄. 금지어: 바꾼 파일 36개와 고친 기록 README 모두 main(da0a7f5) 판과 같은 수, 새 마이그레이션 0013은 0. 남은 것: OPEN-7(모델 회사, 동희님이 10단계 전에), OPEN-10(스킬 요청 출처를 카카오에 문의), OPEN-11(시험 앱으로 PKCE), OPEN-2(실제 채널의 콜백 시간), 앱 규칙 A35·A36은 앱이 없어 테스트하지 못함, Schemathesis 다시 돌리지 않음, 캔버스(Artifact)의 SCR-041-360 보드와 Notion 뷰는 바꾸지 않음. 다음 PR이 알 것: (103) `build_erd.py`가 schema.sql의 컬럼 설명(COMMENT)을 다시 쓰므로, 마이그레이션의 같은 COMMENT는 build 뒤 schema.sql에서 그대로 옮김(D2가 카탈로그의 설명까지 견줌). (104) PostgreSQL은 한 행의 CHECK를 이름 차례로 봄: 규칙 테스트의 준비 행과 막힐 행은 기대한 제약보다 이름이 앞서는 다른 CHECK(예: `kakao_channels_claim_chk`)를 먼저 만족해야 기대한 이름에 막힘. (105) `check_api.py`는 `.venv-api`의 파이썬으로 `--db`와 `--mock http://127.0.0.1:4010`(Prism 5.14.2)을 함께 줘야 D1·M1까지 돔(`checks.sh`가 함). (106) 새 OPEN의 `where`에 적은 API마다 그 API 설명에 'Open:' 문장이 있어야 A10을 지남. (107) A13은 main의 openapi.yaml과 견줘 필드 더하기·없애기·필수 바뀜·응답 코드 없애기만 찾음. 뜻이 바뀐 결과·오류 코드와 새 필드 오류 사유는 손으로 목록에 적음. (108) `scan.py`는 `python3 -B <scratch>/notion/scan.py <루트> <파일>`. main 판은 `git worktree add --detach <scratch>/mainwt origin/main`의 같은 파일로 견주고, 합친 뒤 worktree를 지움. (109) 바깥 서비스가 문서 한 곳(카카오 PKCE는 OIDC 디스커버리)에만 적은 기능은 확정하지 않고 OPEN으로 두며, 받지 않을 때의 길(state만)을 함께 적음. (110) 긴 UTF-8 줄에 `rev`(`awk … | rev` 포함)를 쓰면 멈춤(두 번 TaskStop). 줄 끝은 파이썬으로 읽음. (111) 03 노드 글을 바꾸면 `build_sitemap.py . --write`가 FL 문서의 07 화면 표를 다시 만들어 FL 파일도 바뀜(S16·S17). (112) 08 글을 바꿀 때 09 보드가 그 상태(normal·empty·error·confirm·expired·not-sent·deferred)를 그리면 `gen_screens.py SCR-xxx`로 다시 그리고 `pc.sh <보드>`로 잼(C8은 보드의 글이 08·06 원본에 있어야 지남). 그리지 않는 상태(checking·done 등)의 글은 보드와 상관없음. (113) 새 동작에 확인 창이 필요해 보여도 새 `confirm` 상태는 09 보드를 늘리므로(규칙 (85)) 화면 안의 고르기로 두고 '결정과 다르게'에 적음. (114) 배치 하나(특히 06\~09처럼 파일이 많은 것)가 끝나면 검사 전이라도 바로 커밋·밀기(턴 한도에 걸리면 조정 세션이 중간 저장으로 커밋함). (115) `create_pull_request`는 본문 끝의 두 줄(🤖 Generated with …와 세션 주소)을 자기 꼬리말로 바꿈: 만든 뒤 `update_pull_request`로 본문을 다시 넣고 `get`으로 끝 두 줄을 확인. (116) 다음 번호: REQ-239, SPEC-077, 마이그레이션 0014, TBL-058, API-080, DEC-24, OPEN-12, 05 앱 규칙 A37·결정 E31, SCR-051.

PR I1(설계 재검토 M11·M14: 전자상거래법 표시 항목과 가게 설정, [#39](https://github.com/kodonghui/siljang.ai/pull/39), squash 33f1c7c, 2026-11-14 22:01 KST): M11(RA-05)·M14(RB-12)를 동희님 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)'대로 검토자의 고치는 방향을 따라 고침(두 묶음에 Claude 추천 없음). 같은 차례의 M12(RA-13, RB-15)·M15(RB-13)는 조정 세션의 말대로 PR I2로 나눔. 고친 것: 02 REQ-239(가게 신원 정보를 제13조① 그대로, 필수)·240(규정 글 끝의 미성년자 계약 취소 고지)·241(내 주문 기록)·242(확정 안내에 결제가 확인된 금액과 가게 신원)·243(기다리는 시간·문의 끊김 시간·하루 AI 비용 한도·후기 부탁 시각과 쓰는 때)·244(등록 뒤 가게 정보 바로 고침)·245(상호·대표자·사업자등록번호는 증빙 사진과 변경 요청, 운영자 확인 뒤에만), REQ-106·108 제외. 03 FL-001 A1·C3, FL-002 새 G1·G2·E4·B1·D5·B2·B3·E5와 C1, FL-003 A1, FL-006 O6, FL-007 P9, FL-008 C2. 04 새 SPEC-077·078과 SPEC-002·003·005·007·011·017·024·025·028·036·040·061·066. 05 마이그레이션 `0014_shop_identity_settings.sql`(`shops` 컬럼 3·CHECK 4, `owner_alerts_kind_check` 다시 만듦, 새 테이블 `shop_identity_changes` TBL-058: 컬럼 14·외래 키 2·CHECK 11·부분 인덱스 2), 규칙 테스트 10개, A37, E31, 다이어그램 동기화. 06 API-080 `requestIdentityChange`·081 `listIdentityChanges`·082 `reviewIdentityChange`, 오류 코드 `identity_change_pending`, 스키마 6개, `ShopUpdate` 필드 5개. `build_api.py`를 고친 까닭: 머리말 `INFO_DESCRIPTION`에 SPEC·API 범위가 'SPEC-001\~076'·'API-001\~079'처럼 글자로 있어 'SPEC-001\~078'·'API-001\~082'로 고침(A0는 생성 결과와 파일만 견주어 고치지 않아도 지나지만 머리말이 틀린 채 남음). 07 SCR-034·035·047·048의 SPEC·API, 08 SCR-001·004·005·007·011·015·033·034·035·038·047·048, 09 보드 17개(SCR-001-1280과 SCR-004·007·011·015·034·035·047·048의 360·1280). 마무리 커밋 121fb77: 09 README C9 185 → 187(12절에 더한 글의 두 곳, 처음 기록은 그 글을 쓰기 전 숫자였음), `api_examples.py` 주석 '확정할 때' → '주문 확정 때', 재검토 README '고친 기록' #39 행(PR을 만든 뒤 번호로, 규칙 (98)). 09 보드 넷(SCR-011-360, SCR-048-360, SCR-034-1280, SCR-035-1280)을 Chromium으로 다시 그려 봄: 새 글·필드가 보이고 넘침·겹침 없음. Codex: 코드 검토(fca054c, 21:55 KST) 의견 없음(has_any_findings false), 보안 검토(fca054c, 21:57 KST) 완료·의견 없음, 리뷰 스레드 없음, 머리 커밋 121fb77에는 새 검토가 오지 않아 규칙 (101)대로 합침(댓글 없음). 본문 끝 두 줄은 `update_pull_request`로 되돌리고 `get`으로 확인(규칙 (115)). 결정과 다르게 하거나 더한 것: (a) 확정 안내(검토자의 다섯째)는 고치는 방향에 없었지만 같은 지적이라 고침(REQ-242). (b) 상호·대표자·사업자등록번호는 REQ-197·199가 기대는 값이라 가게 설정에서 받지 않고 변경 요청과 운영자의 반영·보류로만(REQ-245, Claude가 더함). (c) 변경 요청이 확인을 기다리는 동안 영업 신고 확인됨은 409 `identity_change_pending`. (d) 변경 요청은 새 화면 없이 SCR-035·047·048, 반영은 확인 창. (e) 09는 열리는 폼(SCR-035)과 있을 때만 보이는 상자(SCR-048)를 normal 보드에 그리지 않음. (f) M14의 범위·기본값은 05·06단계에 있던 값 그대로. 검사(2026-11-14 21:54\~21:59 KST, 머리 커밋 121fb77, `checks.sh prI1`; 앞 커밋 fca054c의 21:39\~21:45 결과는 `checks/prI1_fca054c`, 숫자 같음): 8개 모두 종료 코드 0. prd 행 245, flows 필수 170/175·유효 209/221(FL-002 노드 33, 분기 85·끝 37), spec 오류 0(SPEC 78, 기능 200/200, 기능 필수 160/160, 상태 150·입력 57·반복 59·동시 27·노출 44·화면 25·외부 39·접근 20), erd 15/15(규칙 테스트 282, 마이그레이션 14, CHECK 396, 컬럼 714, S4 1062건·컬럼 492, 테이블 58·관계 130·인덱스 83), api 17/17(API 82, A13 10, A5 860·852, A6 480, A7 151자리, A8 5, A9 84, A10 11, A11 23, M1 933, D1 5605), sitemap 17/17(S7 API 82, S10 82/82, S11 78/78, S8 노드 341, S14 78), screens 15/15(C4 215·158, C6 942, C8 1857, C11 854), mockup 14/14(C8 5824·556·예외 12·접근성 이름 18, C9 187, C11 113개 오류 0, contrast-image 32). 재검토 전(`base/*.txt`, 2026-11-13)과 견주면 REQ 행 164 → 245, SPEC 69 → 78, TBL 51 → 58, 컬럼 585 → 714, CHECK 275 → 396, 규칙 테스트 87 → 282, API 72 → 82, 예시 701 → 860, 노드 291 → 341, C4 172·132 → 215·158, C6 740 → 942, C8 참조 1515 → 1857, 09 문구 5337 → 5824, C9 158 → 187, 아트보드 111 → 113이고, 늘어난 것은 모두 고친 묶음이 더한 ID·행·예시·보드임. 견주기(20:49 KST) DDL 138,455자, 양쪽에만 0줄. 금지어: 바꾼 파일 47개를 main(fb09089) 판과 견주니 늘어난 11개와 새 0014의 새 곳은 모두 법 이름 '전자상거래법'의 '거래'(TERM-049). 남은 것: REQ-239\~242는 5-2 질문 2·3·7(중개자 여부, 확정 안내의 서면 충분성, 기록 보존 기간)이 정해지면 다시 봄, 10단계에서 가게 행이 있으면 사업장 주소·전자우편주소를 받는 마이그레이션을 0014 앞에, 앱 규칙 A37은 앱이 없어 테스트하지 못함, Schemathesis 다시 돌리지 않음, 캔버스(Artifact)의 17개 보드와 Notion 뷰는 바꾸지 않음, PR I2(M12·M15). 다음 PR이 알 것: (117) check_mockup C9는 `docs/09-mockup/README.md`도 세므로, 09 README에 검사 기록을 쓴 뒤 전체 검사를 다시 돌려 그 숫자를 적음. 숫자를 고칠 때 금지어(허용 예외 포함, 예: '확정 안내')를 새로 쓰지 않음(쓰면 수가 또 바뀜). (118) 08 액션 이름은 09 보드 접근성 이름(`aria-label`)의 출처라 이름을 바꾸면 C8이 실패함: 이름은 두고 결과 글에 덧붙임. (119) A 방향 부품이 `gen.py`의 상수를 읽는 곳(`gen.A.aside`의 `SHOP_INFO`)은 `gen_screens.py`에서 `gen.SHOP_INFO = SHOP_INFO`로 바꿔 그림(후보 시안 A·B는 `gen.py`가 따로 그려 그대로). (120) 조건부 UI(링크를 누르면 열리는 폼, 있을 때만 보이는 상자와 버튼 줄)는 `screen_samples.py`의 블록 값에 `"hidden": True`를 주어 normal 보드에 그리지 않고(`btns`도 받음) 09 README '그리지 않은 것'에 적음. (121) `build_api.py`의 `INFO_DESCRIPTION`에 SPEC·API 범위가 글자로 있음: 새 SPEC·API를 더하면 검사가 지나도 이 두 범위를 함께 고치고 PR 본문에 까닭을 적음. (122) `scan.py`는 법 이름 '전자상거래법'의 '거래'(TERM-049)도 셈: 법 이름으로 늘어난 수는 PR에 그대로 적고 고치지 않음(단계 검사는 허용). (123) 09 보드를 눈으로 볼 때는 `dc2html.py`로 바꾼 뒤 `$preview`의 너비(프레임을 나란히 둔 판 너비, 예: SCR-011-360은 1208px)로 전체 길이 스크린숏을 찍음(보드 이름의 360·1280은 프레임 너비라 그 너비로 찍으면 첫 프레임만 보임). 도우미: `prI/shots2/shot.js`(`T=<폴더> node shot.js 이름:너비 …`), `prI/pcw.sh <루트> <보드…>`(보드별 page-check 경고). (124) 다음 번호: REQ-246, SPEC-079, 마이그레이션 0015, TBL-059, API-083, DEC-24, OPEN-12, 05 앱 규칙 A38·결정 E32, SCR-051. 오류 코드는 37개(`identity_change_pending`까지).

PR I2(설계 재검토 M12: 문제 종류와 보상 없음의 기준, 그 밖의 보상, 신고 기한, 신고의 본인 확인과 선물 받은 사람의 신고, [#40](https://github.com/kodonghui/siljang.ai/pull/40), squash 02a66d0, 2026-11-14 23:54 KST): 가지 커밋 163eab0 02·03·594b7ed 04·b1b2b9a 05·199af67 05 검사 결과와 다이어그램 견준 결과·420974f 06 중간 저장(턴 한도, 조정 세션이 커밋)·372974e 06 README·06acb97 07·08·0a5be3b 09·effd4a6 고친 기록 #40 행·94eda4b Codex 의견(관련 주문이 있는 다른 카카오 사용자 건을 주문마다 따로)·4d9c144 09 README 중간 저장(조정 세션의 종료 훅)·71fba2a 04·05·06·08 검사 기록 중간 저장(턴 한도, 조정 세션)·0837e6f 09 README 검사 기록을 squash(합친 트리가 머리 커밋과 같음). M12(RA-13, RB-15)를 동희님 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)'대로 고침. RA-13은 검토자의 고치는 방향대로, RB-15는 고치는 방향이 '사용자 결정'이라 Claude가 정하고 요구사항 출처에 'Claude 추천(RB-15), 동희님 확인 요청'(조정 세션이 PR 보고 때 확인 요청). PR I1 위에 쌓음. PR 제목은 조정 세션이 준 그대로(검토자의 말 '배상'이 들어 있음), 저장소 문서·고친 기록 행·본문은 용어집 말 '보상'(TERM-033). 고친 것: RA-13 02 REQ-073을 제외하고 REQ-246(보상 다섯)·247(문제 종류 상함·변질·이물·그 밖, 사장님만 고름)·248(상함·변질·이물에 보상 없음이면 저장 전에 소비자분쟁해결기준과 위험, 사유 1\~200자)·249(그 밖의 보상은 한 일 1\~200자와 금액 0원\~1억 원(선택)만, 환불·장부 없음, 손님 안내 '사장님이 직접 연락해 보상을 처리해 드려요')·250(기한을 이유로 신고를 막지 않음, '기한 뒤'는 사장님 화면에만, 템플릿 조문 '받은 뒤 24시간 안에 알려 주시면 빨리 확인할 수 있어요'), 03 FL-011 I12·D4·I13, 04 SPEC-059·057·058·005와 1-6, 05 `issue_reports.problem_kind`·`no_compensation_reason`·`other_compensation_note`·`other_compensation_amount`·`notes_purged_at`과 CHECK, A38, 06 `CompensationInput.problemKind`(필수)·`noCompensationReason`·`otherCompensationNote`·`otherCompensationAmount`, 보상 `other_compensation`, 확인할 것 `no_compensation_standard`, API-020 조문 글, 08 SCR-027·010·038·011, 09 SCR-027 보드 2개. RB-15 02 REQ-062·063을 제외하고 REQ-251(변경·취소·신고는 같은 카카오 사용자만)·252(다른 사용자에게는 없는 주문번호와 같은 답)·253(사정을 말할 때만 에스컬레이션)·254(사장님이 그 건에서 받은 주문의 문제 신고로 남김), 03 FL-011 DU·U1·DU2·E2·U2·DU3·U3과 FL-008·009의 D0·C1·X1·X4 새 번호, 04 새 SPEC-079와 SPEC-040·022·023·046·065·069·076, 05 `issue_reports.reported_by`·`handoff_id`, 외래 키 `issue_reports_handoff_fk`(대상 UNIQUE `handoffs_order_scope`, `RESTRICT`)·UNIQUE `issue_reports_handoff_uq`, `card_id` NOT NULL을 풂, 지우기 2단계가 건을 지우기 전에 신고의 `handoff_id`를 비우고 3단계가 사유와 한 일을 비움, E32, 06 새 API-083 `reportIssueFromHandoff`(201 `created`·200 `unchanged`, 404, 409 `version_conflict`·`invalid_state`, 422 `/description`)와 `Handoff.issueReport`, DEC-24(그 신고는 보상 안내 없음, 환불 안내는 주문자에게 지금 규칙대로, 기한은 그 건이 생긴 시각부터, 할 일은 올리되 사장님 알림·지연 안내 없음), API-041·070·071의 뜻, 07 SCR-017(FL-011, SPEC-079, API-083)·SCR-027(SPEC-079), 08 SCR-017(남긴 신고 행과 '이 주문의 문제 신고로 남기기')·SCR-007(같은 답 4말풍선). 숫자: REQ 행 245 → 254, SPEC 78 → 79, 컬럼 714 → 721, CHECK 396 → 410, 외래 키 130 → 131, 인덱스 83 → 84, 규칙 테스트 282 → 303(Codex 의견 3개 포함), 제약 밖 인덱스 63 → 64(부분 46 → 47, Codex 의견), API 82 → 83, 스키마 148 → 150, 응답 409 → 416, 확인할 것 7 → 8, 결정 23 → 24, 노드 341 → 351, 06 깨지는 변화 8개(A13)와 손으로 4개. 09를 고친 까닭: 문제 종류 고르기가 더해져 SCR-027-360 confirm 프레임(360 × 800)에서 바닥 버튼(보상 정하기) 밑으로 잘린 '재제작' 라디오를 page-check가 target-size 오류로 셈(잘린 글자도 보이는 것으로 봄). 신고 표를 빼 그리면 라디오가 확인 창 버튼 밑에 깔려 오류 4개라 버리고, `gen_screens.py`의 `phone()`이 상태 견본의 `"inert": True`를 받아 확인 창 뒤 머리 막대·본문·바닥 버튼에 `inert`를 붙이게 함(SCR-027 confirm에만, page-check는 inert 안의 누름 영역을 세지 않음, contrast-image 32 → 31). 고르기가 둘이라 보상 고르기의 묶음 이름은 견본 블록 `title`('보상'). 높이는 고치기 전 판(`git show HEAD:`)을 같은 방법으로 재어 heights.json과 같음을 먼저 보고(1121·1198) 새 보드를 잼(360 1121 → 1364, 1280 1198 → 1441). 보드 100개를 다시 그려 SCR-027 2개만 바뀜. Codex: 보안 검토(0a5be3b) 의견 없음. 코드 검토(0a5be3b) P2 1건 'Allow issue reports from appended other-user questions'([스레드](https://github.com/kodonghui/siljang.ai/pull/40#discussion_r4573944173), `api_ops.py` 841줄): 다른 사유의 열린 건이 있는 상담에서 받은 사람의 사정이 덧붙은 질문으로 남으면 API-083이 건의 사유로 409 `invalid_state`를 주고 SCR-017도 남기기를 숨기며, 열린 건 하나 인덱스 때문에 따로 건도 못 엶. 맞아서 같은 PR에서 고침(94eda4b): 마감된 날 질문처럼 관련 주문이 있는 다른 카카오 사용자의 사정은 상담과 주문마다 따로 건. 04 SPEC-022·079와 인수 기준 1개(원천 `spec_rows.py`), 05 0015에서 `handoffs_one_open_per_consultation`을 `reason <> 'closed_day' AND (reason <> 'other_user' OR order_id IS NULL)`로 다시 만들고 `handoffs_one_open_other_user_per_order`(상담·주문, 주문이 있는 열린 `other_user` 건)를 더함, 규칙 테스트 3개(받아야 할 쓰기 1·막아야 할 쓰기 2), `erd_editor_sync.py --write` after 스크립트 1편집(다시 돌리면 0, `--compare` 차이 0줄), A34·A38·E32와 README 1·8·9·11절 숫자, 06 API-041·070·083 설명과 깨지는 변화 목록의 API-070 행, 08 SCR-017 `normal`. 관련 주문이 없으면 지금처럼 덧붙음. 스레드는 댓글 없이 해결로 닫음. 고친 뒤 새 의견 없음. PR 본문은 짧게 만든 뒤 `update_pull_request`로 다시 보내 `get`으로 끝 두 줄 확인(규칙 (115)). 결정과 다르게 하거나 더한 것: (a) '그 밖의 보상'(용어집), 손님 안내 고정 문구. (b) 기준과 위험은 보상 없음을 고른 저장 때의 확인 창(`no_compensation_standard`)에서만. (c) 신고의 에스컬레이션 건 외래 키는 `SET NULL` 대신 `RESTRICT`와 지우기 2단계의 비우기(E32), 사유·한 일은 3년 뒤 3단계에서 비우고 `notes_purged_at`. (d) 주문번호가 없어도 사정을 말하면 같은 말로 에스컬레이션하고 관련 주문을 비움(있는지가 드러나지 않게). (e) 받은 사람의 신고는 기한을 그 건이 생긴 시각부터, 할 일은 올리되 사장님 알림·SPEC-024 안내 없음, 같은 주문의 열린 신고가 있으면 첫 신고에 연결, 건은 열린 채로(답할 때 닫힘), 08은 새 상태 없이 `normal`. (f) 06 `Handoff.issueReport`를 더함, API-083은 이미 남긴 건이면 `baseRevision`과 상관없이 200 `unchanged`. (g) 06 새 예시는 따로 둔 신고(`ISSUE_FOREIGN`·`ISSUE_SPOILED`). (h) 09 SCR-027 confirm의 `inert`와 보상 고르기의 묶음 이름. (i) Codex 의견으로 관련 주문이 있는 다른 카카오 사용자의 사정을 상담과 주문마다 따로 건으로 둠(덧붙은 질문에서 남기는 길은 건 하나에 신고가 여럿이 되어 고르지 않음, E32의 다른 길). 검사(2026-11-14 23:44\~23:49 KST, 머리 커밋 0837e6f, `checks.sh prI2f`, 04·05·06·08 기록은 Codex 의견을 고친 뒤 23:41\~23:43의 출력): 8개 모두 종료 코드 0. prd 행 254, 문제 0; flows 필수 176/181·유효 215/227, 문제 0; spec 오류 0(SPEC 79, 기능 206/206, 기능 필수 166/166, 상태 155·입력 59·반복 60·동시 28·노출 48·화면 26·외부 40·접근 21·대상 22); erd 15/15(규칙 테스트 303(늦은 쓰기 3·받아야 할 쓰기 19·지우기 결과 28), 마이그레이션 15, CHECK 410, 외래 키 131, UNIQUE 89, 컬럼 721, S4 1083건·컬럼 499, E1 테이블 58·관계 131·인덱스 84·부분·식 인덱스 48, 다이어그램 2026-11-14T14:40:51+00:00, 견주기 23:43 DDL 140,368자·양쪽에만 0줄); api 17/17(API 83, A5 881·876, A6 490, A7 104(157자리), A8 5, A9 88, A10 11, A11 24, A13 8, M1 953, D1 5885); sitemap 17/17(S7 SPEC 79·API 83, S8 351(화면 224·분기 53·서버 처리 37·외부 11·종료 26), S10 83/83, S11 79/79, S14 78); screens 15/15(C4 218·160, C5 354·28, C6 957, C8 1880, C10 확인 문구 8·손님 문구 49, C11 854); mockup 14/14(C8 문구 5839·값을 빼고 맞춘 것 556·예외 12, C9 187, C11 아트보드 113 오류 0, contrast-image 32 → 31). 금지어: scan.py로 09 README를 앞 판과 견줘 0 → 0, 고친 기록 README는 PR I1 행의 '전자상거래법' 1곳 그대로, Codex 의견으로 고친 줄 48줄은 0곳, 05 README는 고치기 전과 같은 34곳(검사 출력을 그대로 옮긴 '빈 DB' 2곳 포함), PR 본문은 조정 세션이 준 제목 아래 절 이름 'Claude가 정한 것' 1곳. 남은 것: 동희님 확인(RB-15: REQ-251\~254, SPEC-079, API-083, DEC-24, E32, FL-011 분기, SPEC-040을 좁힘), 앱 규칙 A38은 앱이 없어 테스트하지 못함, Schemathesis 다시 돌리지 않음, 09는 보상 없음 확인 창·그 밖의 보상의 한 일 필드·SCR-017의 남기기를 그리지 않음, 캔버스(Artifact)의 SCR-027 보드 2개와 Notion 뷰는 바꾸지 않음, M15(RB-13)는 다음 PR. 다음 PR이 알 것: (125) 09 상태 프레임(360 × 800)에서 바닥 버튼·확인 창 버튼 밑으로 잘린 작은 누름 영역(라디오·체크박스)은 page-check target-size 오류가 됨: 블록을 빼거나 글을 늘려 자리를 맞추지 말고(깨지기 쉬움) 확인 창 프레임이면 그 상태 견본에 `"inert": True`(창 뒤 화면 inert). (126) 09 폼에 고르기가 둘 이상이면 `options`에 없는 고르기는 묶음 이름이 없음: 견본 블록 `title`이 그 고르기의 legend가 됨(블록 제목과 같은 글). (127) 09 보드 높이를 잴 때는 고치기 전 판(`git show HEAD:<보드>`)을 같은 `dc2html.py` → `check_local.js`(뷰포트는 `gen_screens.py`가 찍는 판 너비)로 먼저 재어 `heights.json` 값과 같은지 봄. (128) `sitemap.yaml`의 화면 키 들여쓰기는 깊이마다 다름(SCR-027은 14칸): 고치기 스크립트의 앵커를 그 화면의 줄에서 그대로 복사. (129) PR은 짧은 본문으로 먼저 만들어 번호를 얻고 → 고친 기록 행 커밋 → 09 README 검사 기록을 쓰는 명령에서 `checks.sh`를 바로 띄워 기록의 시각이 검사 시작과 같게 → 끝나면 그 README를 커밋하고 본문을 채움(규칙 (98)·(117)을 한 번의 전체 검사로). (130) 조정 세션이 준 PR 제목·절 이름에 금지어가 있으면 그대로 두고, 저장소 문서와 고친 기록 행은 용어집 말로 쓰고 PR 본문에 까닭을 적음. (131) 에스컬레이션 건 단위의 새 명령(예: API-083)은 같은 사정이 덧붙은 질문(`handoff_questions`)으로 들어오는 길에서도 닿는지 봄: 닿지 않으면 마감된 날 질문처럼 열린 건 하나 인덱스에서 빼고 따로 건의 부분 UNIQUE 인덱스를 더함(이 PR의 Codex 의견). (132) 04 spec.md의 SPEC 표는 `research/cake-spec-2026-11/spec_rows.py`에서 `build_spec.py . --write`로 만들어짐: spec.md의 SPEC 행을 직접 고치면 다음 쓰기에서 지워지므로 원천을 고침(표 밖의 글과 확정한 뒤 고친 것 표는 spec.md에서). (133) 조정 세션의 종료 훅이 같은 작업 트리에서 중간 저장 커밋을 하므로, 커밋·푸시 전에 `git log -1`·`git status`로 머리를 보고 쓰던 파일이 이미 커밋됐는지 확인함(squash라 중간 커밋은 그대로 둠). (134) 다음 번호: REQ-255, SPEC-080, 마이그레이션 0016, TBL-059, API-084, DEC-25, OPEN-12, 05 앱 규칙 A39·결정 E33, SCR-051. 오류 코드는 37개 그대로.

PR I3(설계 재검토 M15: 필수 요구사항마다 수락 기준, 동의하지 않는 버튼, 경로를 늘어놓은 기준, [#41](https://github.com/kodonghui/siljang.ai/pull/41), squash 82d72bb, 2026-11-15 00:19 KST): 가지 커밋 9192f54 04 꼬리표·새 기준·9e066f5 `build_spec.py`·spec.md·350bf55 고친 기록 #41 행·a537931 고친 기록 행의 새 기준 수을 squash(합친 트리가 머리 커밋과 같음). M15(RB-13)를 동희님 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)'대로, 'Claude 추천'이 없어 검토자의 고치는 방향대로 고침. PR I2 위에 쌓음. 04만 바뀜(02·03·05\~09 그대로). 방법: 대조 스크립트 `scratchpad/prI3/ac_map.py`(`python3 -I ac_map.py <저장소> [rows|sum|missing]`, 필수 요구사항마다 SPEC 행과 지금 수락 기준을 늘어놓고 수를 셈)를 먼저 만들고, 행 묶음마다 결정을 `map_a~d.py`(TAGS: 기준 번호마다 확인하는 REQ, NEW: 새 기준과 REQ, REPLACE: 바꿀 기준 글, REQ_ADD: 행에 이을 REQ)에 적은 뒤 `edit_rows.py <저장소> --write`로 `spec_rows.py`를 한 번에 고침(다시 돌리면 '바뀜 없음', 02a66d0의 `spec_rows.py`에서 다시 돌려도 같은 결과). 고친 것: (1) 수락 기준 줄 끝 ' (확인: REQ-…)' 241개(그 행의 요구사항 가운데서, 옛 꼴 '(REQ-…)' 22개를 옮김). (2) 새 수락 기준 29개: 22개가 확인하는 기준이 없던 필수 23개(REQ-004·009·023·024·029·030·036·051·053·058·076·084·089·100·111·117·135·138·141·146·171·190·246, SPEC-011의 한 기준이 REQ-023·024를 함께)를 확인, 7개는 기존 기준이 일부만 확인하던 REQ-039·130·158·187·188·201·228과 권장 REQ-236. 행: SPEC-001·002·004·005·007·010·011·013·015·017·020(3)·021(3)·024·028·029·031·032·047·049·051·052·059·065(2)·075. (3) SPEC-029 #1을 "'규정에 동의하고 주문 요청'을 누르면"으로, 새 #3 '안 할래요' → 주문 요청·내용 확인·규정 동의 0건, 초안 그대로(REQ-053). 체크박스 말은 앞 PR에서 이미 빠져 있었음. (4) SPEC-036 #2 '어떤 경로로도'를 네 경로(주문 상세 열기, 손님의 결제 확인 요청, 금액 불일치·미입금 표시, 장부 쓰기 다시 돎)로(REQ-060). '어떤 경로'·'어느 경로'·'모든 경로'·'어떤 방법으로도'·'어디서도'는 이제 0건. (5) SPEC-077의 req에 REQ-163(기존 #3이 '(REQ-243, REQ-163)'으로 확인하던 것, 꼬리표는 행의 요구사항 안에서만이라). (6) 기준을 더하거나 바꾼 25행과 SPEC-077의 상태에 M15. (7) `build_spec.py`: 꼬리표 정규식 `r" \(확인: (REQ-\d{3}(?:, REQ-\d{3})*)\)$"`, 줄 끝이 아닌 꼬리표·옛 꼴·행에 없는 REQ·같은 REQ 두 번은 오류, 우선순위 필수이고 상태가 '확정'으로 시작하는 요구사항에 확인하는 수락 기준이 없으면 '확인하는 수락 기준이 없는 필수 요구사항' 오류, spec.md의 `<!-- AC-EXEMPT -->` 표를 읽어 예외로 둠(표의 REQ가 필수가 아니거나 이미 확인 기준이 있거나 이유가 없으면 오류), 부록 표에 '수락 기준' 열(`SPEC-029 #3`, 표의 REQ는 '수락 기준 없이 둠(위 표)', 필수 아닌 것은 '없음'), 출력 두 줄. (8) spec.md 0-3 표기, 6절 검사 결과, 8절 한 행, 부록의 '수락 기준 없이 두는 필수 요구사항' 표(REQ-145 하나: 출시 전 평가 세트로 재는 비기능, SPEC 없음)와 '요구사항 → SPEC과 수락 기준' 머리말. 숫자: 필수이고 확정인 요구사항 181개, 고치기 전 기계 대조 0·손 대조로 기존 기준이 확인 157·확인 기준 없음 23·SPEC 없음 1(REQ-145) → 고친 뒤 확인 기준 있음 180·없이 둠 1·없음 0, 수락 기준 273 → 302, 꼬리표 있는 기준 0 → 241, 꼬리표가 가리킨 요구사항 182(필수 180과 권장 REQ-163·236). 음성 시험: `build_spec.py` 복사본과 고친 `spec_rows.py` 복사본(REQ-053 꼬리표를 뺌, 행에 없는 REQ-999, 옛 꼴 '(REQ-060)', 같은 REQ 두 번)으로 돌려 오류 5개(표 없음 포함)를 냄. 금지어: scan.py로 `spec_rows.py` 더한 줄과 뺀 줄을 견줘 새로 생긴 것 0(처음 판의 '입금했다며'·'문구 틀'을 '입금했다고'·'안내 글'로 고친 뒤), 고친 기록 행 0곳, spec.md·`build_spec.py`의 손으로 쓴 줄은 요구사항 상태 '확정' 5곳(지시문의 말, 수락 TERM-011의 피할 말과 다른 뜻), PR 본문도 같은 '확정' 2곳. Codex: 코드 검토(9e066f5) 의견 없음, 보안 검토(9e066f5) 의견 없음(뒤 커밋 350bf55·a537931은 재검토 README의 고친 기록 행만). 검사(2026-11-15 00:12\~00:17 KST, 커밋 350bf55의 트리(머리 a537931과 재검토 README 한 줄만 다름), `checks.sh prI3`): 8개 모두 종료 코드 0. prI2f 출력과 견줘 spec에 두 줄(필수 요구사항 대조, 꼬리표 수)이 더해지고, api A13 깨지는 변화 8 → 0(main이 I2를 담음), erd는 동시 쓰기 기다림 1.4초 → 1.5초와 E1 다이어그램 파일 날짜 표시(합친 커밋 시각)만 다르고, prd·flows·sitemap·screens·mockup는 같음. prd 행 254, 문제 0; flows 필수 176/181·유효 215/227, 문제 0; spec 오류 0(SPEC 79, 기능 206/206, 기능 필수 166/166, 필수 대조 180/181·없이 둠 1·없음 0, 수락 기준 302·꼬리표 241, 예외 종류 수 그대로); erd 15/15(규칙 테스트 303, 마이그레이션 15, CHECK 410, 외래 키 131, 컬럼 721); api 17/17(API 83, A5 881·876, A6 490, A7 104(157자리), A11 24, A13 0, M1 953, D1 5885); sitemap 17/17; screens 15/15; mockup 14/14(C8 문구 5839·값을 빼고 맞춘 것 556·예외 12, C9 187, C11 아트보드 113 오류 0). 결정과 다르게 하거나 더한 것: (a) 꼬리표 꼴 ' (확인: REQ-…)'와 행의 요구사항 안에서만 고름(부록의 SPEC 열과 수락 기준 열이 어긋나지 않게). (b) SPEC-077에 REQ-163을 이음. (c) REQ-145는 기준을 지어 붙이지 않고 표로(평가 세트 전체의 결과라 한 행의 동작이 아님). (d) 상태 M15는 기준을 더하거나 바꾼 행에만, 꼬리표만 붙인 행은 그대로. (e) 권장 REQ-236(검토자가 짚은 REQ-142의 새 번호)에도 기준을 더함. (f) 꼬리표 없는 기준 61개는 필수가 아닌 요구사항이나 예외·화면 동작의 기준이라 그대로. 남은 것: 수락 기준을 테스트로 옮기는 것은 12단계, REQ-145는 12단계 QA 평가 세트, Notion 04 뷰는 바꾸지 않음. 조정 세션이 준 다음 규칙 번호 (134)는 PR I2 단락의 '다음 번호' 항목이 이미 써서 이 단락은 (135)부터. 다음 PR이 알 것: (135) 04 수락 기준 줄 끝의 ' (확인: REQ-…)'는 `build_spec.py`가 읽음: 새 수락 기준을 쓰면 그 기준이 직접 확인하는 요구사항을 붙이고, 필수 요구사항을 더하거나 바꾸면 그것을 직접 확인하는 수락 기준도 더해야 spec 검사가 지남(없으면 '확인하는 수락 기준이 없는 필수 요구사항' 오류). (136) 꼬리표의 REQ는 그 행의 req에 있어야 함: 다른 행이 맡은 요구사항을 확인하는 기준이면 그 행의 req에 잇거나 꼬리표에서 뺌. (137) 수락 기준으로 확인할 수 없는 필수 요구사항만 spec.md 부록의 '수락 기준 없이 두는 필수 요구사항' 표(`<!-- AC-EXEMPT -->`, 손으로 쓰는 표)에 이유와 함께 둠. 그 REQ에 꼬리표가 생기면 표에서 빼야 함(빼지 않으면 오류). (138) 부록 '수락 기준' 열의 #n은 행 안의 차례라, 기준을 가운데에 끼우거나 지우면 그 행 뒤 기준의 번호가 밀림: 새 기준은 행 끝에 더하고, 지우면 부록이 다시 만들어짐을 확인. (139) 수락 기준 글에도 금지어 규칙이 같음: '입금'은 허용 꼴('입금했다고'·'들어온 입금'·'입금 대조'·'입금이 확인'·'입금자'·'입금됨'·'미입금', `check_sitemap.py`), '틀'은 옛 말. `edit_rows.py`처럼 NEW 글을 고칠 때는 이미 더해진 판에 새 글이 하나 더 붙으므로, 원천을 앞 판으로 되돌리고 스크립트를 다시 돌림. (140) fix_log의 '다음 번호' 항목도 규칙 번호를 하나 씀: 다음 단락의 규칙은 그 다음 번호부터. (141) 다음 번호: REQ-255, SPEC-080, 마이그레이션 0016, TBL-059, API-084, DEC-25, OPEN-12, 05 앱 규칙 A39·결정 E33, SCR-051, 규칙 (142).

PR J1(설계 재검토 M19·M20: 필드 옆 입력 오류, 되돌릴 수 없는 액션의 확인 창, 주문 취소 버튼 이름, 알림만 가는 종류, 목업이 빠뜨린 블록, [#42](https://github.com/kodonghui/siljang.ai/pull/42), squash 0587fa3, 2026-11-15 01:24 KST): 가지 커밋 c50541d 08·3e2af8a 04와 SCR-019 몸이 불편하다는 말·8682ab6 09 보드 26개·0e926d2 08·09 README·e369b3d 고친 기록 #42 행·783859a 04 6절과 09 README 검사 시각을 squash(합친 트리가 머리 커밋과 같음). M19(RE-05·RE-06·RE-07)·M20(RE-09·RE-10·RB-23)을 동희님 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)'대로, 'Claude 추천'이 없어 검토자의 고치는 방향대로 고침(RE-06은 지시서가 정한 길 (1) 화면이 여는 확인 창, RE-09는 SPEC-067 표와 SCR-019 알림 말풍선). PR I3 위에 쌓음. 04·08·09만 바뀜(02·03·05·06·07 그대로). 고친 것: RE-05 08 SCR-015·032·033·034·036·038·040의 `error`를 `field` 프레임으로(넣은 값은 그대로, 그 밖의 저장 실패 `E_SAVE`도), 불러오기 실패는 새 상태 `load-failed`(SCR-032·033·034·036·038·040, 각 화면 GET의 `#default:internal`을 덮어씀. SCR-015는 GET이 없음), `build_screens.py`의 `field` 프레임이 필드가 없으면 같은 이름의 목록 제목 아래에 사유. RE-06 새 상태 `confirm-notify`(SCR-022·023·024·025·027·029·031, `s_notify`: 무엇이 손님에게 가는지 한 줄, '돌아가기'와 동작 이름, 서버 확인이 필요하면 다음에 `confirm`), SCR-027은 보상을 미리 고르지 않음. RE-07 SCR-009 '주문 취소하기'·'취소 안 함'(손님 말도), SCR-023 '주문 취소', 확인 창 닫기 '돌아가기'(`f_dialog` 기본값, SCR-021·048·050), 08 README 5절. 06 예시에는 취소 카드 버튼 글이 없어 06 그대로. RE-09·RB-23 04 새 1-9절(할 일 14종 = 06 `OwnerTask.kind` = 05 `owner_tasks.kind`, 알림만 가는 것 다섯 = 05 `owner_alerts.kind`의 `order_cancelled`·`change_not_applied`·`payment_account_changed`·`health_concern`·`identity_change_applied`/`on_hold`, 할 일과 함께 가는 알림 다섯), SPEC-067 전제·주 동작·예외 하나·수락 기준 하나(확인: REQ-233), 8절 한 행, 6절. 08 SCR-019 알림 말풍선(카드 제목 '알림'), SCR-016 알림 줄은 사장님 알림 목록 API가 없어 두지 않음(08 README 12절). RE-10 08 SCR-038 조문 목록(`RULE_CLAUSES` 9개)과 '조문 추가', SCR-043#empty `result` 프레임의 조건 7개. 09 `gen_screens.py`: `KEY_STATES`에 `confirm-notify`, `field` 프레임(`content()`가 오류 블록까지 내림, `T.field`의 위험 색 테두리·`aria-invalid`·사유 줄 `T.ferr`, 목록은 견본 `bad` 행), `T.form`의 `hide`·`start`, 숨긴 제목 kv의 링크('버전 이력'), `scr043_empty`, 캡션 `STATE_NOTE`와 '오류가 난 곳까지 내린 모습'. `screen_samples.py`: SCR-009·015·019·027·032·033·034·036·038·040. 보드 26개(SCR-009·019·023·027·036·038의 360·1280, SCR-015·021·022·024·025·029·031·032·033·034·040·043·048·050의 360), 100개를 다시 그려도 이 26개만. 높이 8개(SCR-015 360 1645→1666, 027 360 1364→1189·1280 1441→1266, 034 360 2028→2069, 036 360 1127→1224·1280 993→1049, 038 360 1302→2598·1280 1336→2135). 고치기 전 판(SCR-034 360, SCR-038 1280)을 먼저 재어 `heights.json`과 같음을 봄(규칙 (127)). 검사 8개 모두 종료 코드 0: `checks.sh prJ1f`(2026-11-15 01:17\~01:23 KST, 머리 783859a의 트리): prd·flows 문제 0(출력 그대로), spec 오류 0(수락 기준 302 → 303, 확인 꼬리표 241 → 242, 예외 '상태' 155 → 156), erd 15/15, api 17/17, sitemap 17/17(출력 그대로), screens 15/15(데이터 218 → 220행, 그린 상태 354 → 367, 상태 이름 28 → 30, 프레임 708 → 734, 허용 예외 854 → 901곳), mockup 14/14(C7 캡션 221 → 228, C8 문구 5839 → 6388·값을 빼고 맞춘 것 556 → 570, C9 187 → 201, C11 오류 0·고른 방향 보드의 contrast-image 31 → 45, C12 아이콘 437 → 457). 그 앞의 `prJ1`(01:09\~01:14 KST, e369b3d에 09 README 검사 시각만 더한 트리)과는 erd 기다림 시간 표시만 다름. Codex 코드·보안 검토(783859a) 의견 없음, 리뷰 스레드 0개. 결정과 다르게 하거나 더한 것: `load-failed`는 09가 그리지 않는 상태라 09 README 12절 '그리지 않은 것'(규칙 (85)), 지적에 없던 `health_concern` 알림도 1-9절 표와 SCR-019에, 확인 창은 화면마다 한 프레임만 그림. 남은 것: SCR-019 '영업 신고가 확인됐어요' 알림은 05 `owner_alerts.kind`에 종류가 없음(이번 지적 밖, PR 본문에 적음). 규칙: (142) 08에 새 상태 이름을 만들 때 09 `KEY_STATES`에 넣을지 먼저 정함: 넣으면 그 상태가 있는 화면마다 360 보드에 프레임이 하나 늘어 너비만 늘고(높이는 캡션 줄 수가 바뀔 때만), 바뀐 보드를 `git status`로 보고 page-check로 잼. 넣지 않으면 09 README 12절 '그리지 않은 것'. (143) 09 오류 프레임(08 `field`)은 `content()`가 오류가 난 블록(앞의 `h` 포함)까지 내린 모습으로 그림: 폼은 오류 필드 바로 앞 필드부터(`start`), 목록은 견본의 `bad` 행에 위험 색 테두리. 오류를 그리는 필드 종류는 text·number·date·time만(그 밖은 `SystemExit`): 다른 종류에 오류를 두면 `T.field`를 먼저 넓힘. (144) 견본 상태의 `blocks`는 한 단계만 합침: `pick`·`values` 같은 사전은 바꿀 키만 주고, `hide` 같은 목록은 통째로 바뀜. 라디오 `pick`이 `None`이면 아무것도 고르지 않은 모습. (145) 09 README 5-1절의 '그린 상태' 수는 360 보드의 상태 프레임 수(= 5-1 표의 상태 수, `canvas.json` 보드 제목에서 셈)로 셈. C7 캡션 수에는 후보 보드의 캡션도 들어 있어 맞지 않음. (146) 이름을 따옴표로 넣는 글 템플릿(`s_notify`)의 조사 을/를은 받침으로 고름(`'환불 결정'을`): 템플릿을 새로 만들면 받침 있는 이름으로 한 번 봄. (147) `heights.json`은 키 순서를 그대로 두고 값만 바꿈(`sort_keys` 쓰지 않음, 후보 보드 키가 섞여 있어 정렬하면 바꾸지 않은 행이 diff에 나옴). (148) 04 6절처럼 검사 숫자를 적는 줄은 그 검사만 먼저 돌려 적고 커밋한 뒤 `checks.sh`를 띄움: 도는 동안 문서를 고치면 그 뒤에 돈 검사는 섞인 트리를 본 것이라 머리 트리에서 다시 돌림(J1은 6절 줄을 `prJ1`이 도는 중에 써서 `prJ1f`로 다시 돌림). (149) 다음 번호: REQ-255, SPEC-080, 마이그레이션 0016, TBL-059, API-084, DEC-25, OPEN-12, 05 앱 규칙 A39·결정 E33, SCR-051, 규칙 (150).
PR J2(설계 재검토 남은 빈 곳: 정한 환불 뒤 더 들어온 돈, 손님 확인 기다림 표시, 영업 신고 확인 알림, 새 상태의 목업 보드, [#43](https://github.com/kodonghui/siljang.ai/pull/43), squash cc7f622, 2026-11-15 02:35 KST): 가지 커밋 a219e86 04·61d082b 05 마이그레이션 0016·f9bef1f 05 검사 결과·9655eac 06·30f68e1 08·3277039 09 보드 중간 저장(조정 세션, 내용 그대로)·a03c362 09 손님 카드 상태 다섯과 검사 숫자·80e2493 Codex P2와 08 '목업' 줄·4553257 검사 기록 시각을 squash(합친 트리가 머리 커밋과 같음). 동희님 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)'대로, 'Claude 추천'이 없어 검토자의 고치는 방향대로 고침. PR J1 위에 쌓음. 04·05·06·08·09가 바뀜(02·03·07 그대로, 새 REQ 없음: REQ-165·166이 덮음). 고친 것: (1) 정한 환불 뒤 더 들어온 돈: 05 `refunds.counted_arrived_amount`(그 환불이 셈한 그 결제 안내의 들어온 금액 합, 비면 트리거가 지금 값으로 채움), `refunds_request_uq`를 (결제 안내, 셈한 금액)으로, `refunds_request_chk`(취소 환불도 결제 안내를 가질 수 있음)·`refunds_counted_chk`, `refunds_unconfirmed_check()`(결제 안내 행을 잠그고, 앞 환불보다 적게 셈하면 막고, 들어온 입금의 환불 계산값 ≤ 셈한 금액 - max(확인된 결제, 앞 환불이 셈한 금액)), 마이그레이션 0016, 규칙 테스트 303 → 309(막아야 할 쓰기 253 → 258, 받아야 할 쓰기 19 → 20), 컬럼 721 → 722, CHECK 410 → 412. 04 SPEC-016(계산값 식)·047(반복 예외)·070(더 들어온 금액이 있으면 결제 확인 취소 막음)·071(확인된 결제 안내에도 '들어옴', 다시 남기면 더함, 결제 확인 요청 중이거나 맞추는 중에 취소한 주문의 취소 환불도 그 결제 안내의 들어온 금액을 셈함), 수락 기준 다섯. 06 API-049·050·059 설명과 예시 `over_received_again`·`arrived_again`. 08 SCR-025·029(`OK_TEXT`의 `arrived_again`). (2) SCR-020: 06 꼭 넣을 필드 `paymentNotice.awaitingAmountConfirm`(A13이 안쪽 필드 변화를 찾지 않아 깨지는 변화 넷을 `BREAKING_CHANGES`에 손으로, 예시 `awaiting_amount_confirm`), 08 SCR-020 '손님 확인 기다림'. (3) SCR-019 영업 신고 확인 알림: 더 작은 쪽으로 08만 고침('영업 신고가 확인됐어요'를 빼고 확인됨은 SCR-035에서 봄. 04 1-9절 표·SPEC-003은 이미 보류만 알려 그대로). (4) 09: `KEY_STATES`에 `allergy`·`orderer`(SCR-004)·`amount-confirm`(SCR-005)·`depositor`(SCR-006)·`photo-consent`(SCR-011), `STATE_NOTE`, `screen_samples.py`, 360 보드 4개(높이 SCR-004·005·006 912, SCR-011 1031), 그리지 않은 것은 이유와 함께 09 README 12절, 09 README 1절 프레임 수 199 → 211(J1 뒤 고치지 않았던 것). 검사 8개 모두 종료 코드 0: `checks.sh prJ2f`(2026-11-15 02:28\~02:34 KST, 머리 4553257의 트리): prd·flows·sitemap 출력이 prJ1f와 같음, spec 오류 0(수락 기준 303 → 308, 확인 꼬리표 242 → 247, 꼬리표가 가리킨 요구사항 182 그대로), erd 15/15(README 8절에 옮긴 출력과 기다림 시간 1.4초 → 1.5초만 다름), api 17/17(예시 886, 성공 응답 시각 902, 목 서버 요청 956), screens 15/15(응답 행 957 → 960, 참조 1897 → 1901, 허용 예외 901 → 909, 그린 상태 367, 생성 파일 52), mockup 14/14(C7 캡션 228 → 233, C8 문구 6388 → 6473·값을 빼고 맞춘 것 570 → 576, C9 201 → 209, C11 contrast-image 45, C12 아이콘 457 → 469). 그 앞의 `prJ2`(a03c362의 트리)는 08 C13 실패(09 보드가 바뀌어 SCR-004·005·006·011의 '목업' 줄이 바뀜)로 다시 생성하고, Codex 의견을 먼저 고치려고 mockup 전에 멈춤. Codex: PR을 연 때의 머리 코드 검토(2026-11-15 02:14 KST)에 P2 하나(맞추는 중에 취소한 주문의 취소 환불이 결제 안내를 셈하지 않아, 닫힌 결제 안내에 또 들어온 입금을 돌려줄 때 다르게 들어온 금액까지 다시 돌려줌). 80e2493에서 고침(04 SPEC-071 본 흐름과 수락 기준 하나, 05 `refunds.payment_request_id` 설명·`refunds_request_chk`와 트리거 주석·마이그레이션 0016의 같은 설명·README A29·11절, 다이어그램 설명은 `erd_editor_sync.py`로. DB는 이미 허용하고 막아 제약·규칙 테스트는 그대로)하고 스레드 해결(댓글 없음). 머리 4553257 코드 검토 의견 없음, 보안 검토 완료(의견 없음). 결정과 다르게 하거나 더한 것: 지시의 예 '보내지 않은 환불은 결제 안내마다 하나' 대신 셈한 들어온 금액 컬럼과 (결제 안내, 셈한 금액)마다 환불 하나, 확인됨 결제 안내에도 '들어옴'(더 들어온 금액이 있으면 결제 확인 취소 막음), SCR-019는 08만(더 작은 쪽), 새 REQ 없음, 09 1절 수 고침, Codex P2를 같은 PR에서 고침. 규칙: (150) 06에 새 응답 예시를 더하면 그 API를 부르는 08 화면의 `resp`에 그 예시를 두고, 성공 예시면 `screens_common.OK_TEXT`에 화면에 보이는 글을 적음(없으면 `build_screens.py`가 '화면에 보이는 것이 없음'으로 멈춤). (151) 09 보드를 다시 그리면(`KEY_STATES`·견본) 08 화면 정의의 '목업' 줄이 `canvas.json`의 그린 상태를 읽어 바뀌므로 `build_screens.py . --write`를 다시 돌려 같은 PR에 넣음(C13). J2는 `checks.sh`의 C13 실패로 알았음. (152) `KEY_STATES`로 프레임이 늘면 09 README 1절의 아트보드·프레임 수와 상태별 수, 5-1절 표와 '그린 상태' 수도 함께 고침(J1 뒤 199로 남았던 것을 J2에서 211로). (153) 09 캡션은 `text-wrap: balance`라 상태 이름의 하이픈(`photo-consent`)에서 줄이 나뉠 수 있음: 렌더해 보고 나뉘면 `STATE_NOTE`를 늘려 ' · ' 뒤에서 나뉘게 한 뒤 높이를 다시 잼. (154) 09 견본 대화의 사람 이름·값은 C8 출처(08 정의·06 예시 이름 등)에서 고름(입금자는 06 `SKILL_DEPOSITOR`의 이름). 09 README 기록에도 용어집 금지어를 옮겨 쓰지 않음(C9가 README도 봄). (155) 결제 안내의 들어온 금액을 셈하는 규칙을 바꿀 때는 결제 안내 상태 여섯(나감·확인 요청됨·맞추는 중·확인됨·기한 지남·닫힘)마다 '취소 → 환불 결정 → 또 들어옴' 차례를 한 번씩 셈해 봄: 맞추는 중은 취소 전에 이미 들어온 금액이 있어 취소 환불이 그 결제 안내를 셈해야 함(Codex P2). (156) 05 다이어그램을 바꾸면 E1이 보이는 시각은 그 파일을 마지막으로 고친 커밋의 시각이라, 다이어그램을 고친 커밋을 먼저 하고 그 시각을 README 8절 E1 줄에 적은 커밋을 따로 한 뒤 `checks.sh`를 띄움. (157) 다음 번호: REQ-255, SPEC-080, 마이그레이션 0017, TBL-059, API-084, DEC-25, OPEN-12, 05 앱 규칙 A39·결정 E33, SCR-051, 규칙 (158).

PR J3(설계 재검토 M8: 앞 단계 문서 되돌리기(01 도메인·03 플로우·04 8절)와 단계 사이 앞뒤 맞추기, [#44](https://github.com/kodonghui/siljang.ai/pull/44), squash 823d137, 2026-11-15 03:28 KST): 가지 커밋 0891bad 01·8e4114d 03·0dcabd3 04·dcc3a20 05 마이그레이션 0017·a121f7c 06·08과 05 검사 기록·f6420ea 02·27a4813 검사 기록 시각과 07 기록·재검토 README 행·291b010 Codex P2를 squash(합친 트리가 머리 커밋과 같음). 동희님 2026-11-13 20:59 결정 카드 '모두 지금 고침 (추천)'대로, 'Claude 추천'이 없어 검토자의 고치는 방향대로 고침(RB-10은 지시대로 길 (1), RE-15는 둘째 길). PR J2 위에 쌓음. 01·02·03·04·05·06·07·08이 바뀜(09 그대로, 새 REQ 없음, 요구사항 문장 그대로). 고친 것: (1) RA-12: 01 `domain.md` 새 절 3-8 '요구사항 버전 2\~5에서 되돌린 것'(9항목: 가예약 해제의 예외, 결제 기한과 상한, 예약 링크 조건의 결제 수단, 지연 안내와 사장님 알림·할 일 목록 14종, 장부의 인도·미수령, 완성 표시, 기본 디자인 범위(TERM-038·039), 사진마다 게시 동의, 보관·지우기와 문제 신고), 2-1에 도메인 이벤트 63 '결제 수단 등록됨'·64 '결제 확인 취소됨', 고친 곳마다 '버전 N 되돌림', 상태 줄. (2) RB-10 길 (1): 03 FL-001 S(REQ-158)·D7(결제 받을 계좌, REQ-164), FL-004 D6·K14(AI 비용 한도, REQ-163), FL-006 O17, FL-007 P11(REQ-161)·D8(사장님이 손님과 정한 뒤 고름)·E1(가게 사정으로 취소, 외부 → 종료)·P14(결제 확인 취소, REQ-169), FL-008 D4(REQ-162), FL-013 L5(REQ-159), 03 README 2·6·7·8절, 07 화면 표 다시 만듦(노드 351 → 355, 화면 224 → 227). check_flows 필수 176/181 → 180/181(밖은 출시 조건 REQ-145). (3) RB-11: 04 SPEC-017(요청 키·빈 응답은 확인 전 가정, OPEN-1·4)·027(퀵 여부 E7)·052(픽업 장소와 빈 경우 E14·DEC-13)·062(후기 블록 DEC-18)·065(E11), 2절 G2, 3절 R14 '버전 5에서 바뀜', 5절 AI-1(DEC-17), 8절 행과 그 아래 '뒤 단계 결정으로 바뀐 행' 표(E5·E7·E8·E11·E14·DEC-08·13·17·18·OPEN-1·4), 수락 기준 308 → 311(확인 꼬리표 247 → 248). (4) RC-15: 05 A10에 결제 수단(`payment_accounts`, `payment_accounts_one_current`), `erd_map.py` SPEC-010 → `payment_accounts.retired_at`, SPEC-065 → `quotes.draft_id`·`ai_tool_calls.called_at`(데이터 1084 → 1087, 대응 컬럼 500 → 502), 6절 8번째 차례(상담이 열려 있어도 30일 지난 `ai_tool_calls` 지움, E11이 가리킴), 인덱스 `ai_tool_calls_called_idx`(마이그레이션 0017, 다이어그램은 `erd_editor_sync.py`로 인덱스 하나), `purge_run`에 같은 차례와 `expect_left` 둘(규칙 테스트 309 → 311), `schema.sql` 머리말(SPEC-001\~079, REQ-001\~254), README 상태 줄(마이그레이션 0014\~0017)·1절 수(인덱스 64 → 65, 1062건·492개 → 1087건·502개)·2절 읽은 버전. 같은 차례를 04 SPEC-065(주 동작과 수락 기준 하나)와 06 `api_catalog.py` SPEC-065 작업 글('여덟 차례')에 맞춤. (5) RE-15 둘째 길: 손님 문구의 출처를 08 README 5절 한 곳으로 정해 08 README 5절 머리말·06 README 7절 머리말에 적고 06 결과 표·예시 글은 참고용 뼈대로 그대로(바꾸면 08 C10이 견주는 뼈대가 바뀜), SPEC-035 금액 불일치 안내는 04·SCR-011·SCR-029가 이미 같음. (6) RA-22: 02 12절 '용어 정리(2026-11-12)'(바꾼 TERM 10개의 지금 이름, 예전 이름은 금지어라 01 3-7을 가리킴), 8\~11절 '고치지 않고'에 예외 표시, REQ-160의 SPEC 목록(찾은 곳 SPEC-015·033과 받은 SPEC-015·033·034를 나눠 적음), 01·02 머리말에 `synced_at`을 그대로 둔 까닭(사람이 보는 곳을 맞출 때 고침). (7) RB-22: 02 7절 표 위에 버전 1 시점, 04 6절 버전 3 표에 '그때 값'. 'PR J로' 남긴 것 넷: #32 01 용어 → 3-8, #33 R14 표시 → (3), #35 REQ-185 글 → 글은 그대로 두고 '신고가 닫힘'은 재제작 주문이 끝남까지라는 읽기를 02 11절·01 3-8의 9에, #36 TERM-038 → 3-8. 검사 8개 모두 종료 코드 0: `checks.sh prJ3`(2026-11-15 03:17\~03:22 KST, 머리 f6420ea의 트리): prd 행 254·문제 0·금지어 0, flows 필수 180/181(밖은 REQ-145)·전체 222/227·문제 0, spec 오류 0(수락 기준 311, 꼬리표 248), erd 15/15(마이그레이션 17개, index 213, 규칙 테스트 311, 지우기 결과 30, 다이어그램 인덱스 86, README 8절에 옮긴 출력과 같음), api 17/17(API 83, 예시 886, 성공 응답 시각 902, A13 main과 견준 깨지는 변화 0, 목 서버 요청 956), sitemap 17/17(S8 노드 355만 바뀜), screens 15/15(prJ2f와 같음), mockup 14/14. 그 뒤 문서 시각과 07 README 기록만 바꿔 sitemap·screens를 다시 돌림(17·15 통과), `build_api.py`는 원본과 같음. Codex: PR을 연 때의 머리 f6420ea 코드 검토에 P2 하나(01의 결제 기한 상한에 REQ-218의 '이미 지났으면 픽업 일시'가 빠져 주문 마감 뒤 받은 주문의 결제 기한이 지난 시각이 됨). 291b010에서 3-8의 2·CTX-004 결제 규칙·TERM-030 세 곳을 REQ-218과 같게 고치고 check_prd·check_flows를 다시 돌림(문제 0, 필수 180/181), 스레드 해결(댓글 없음). 머리 291b010 코드 검토 의견 없음, 보안 검토 완료(의견 없음, 리뷰 스레드는 해결한 하나뿐). 결정과 다르게 하거나 더한 것: RA-22의 'synced_at을 고침'은 하지 않고 까닭과 맞출 때를 머리말에(Miro·Notion을 다시 대조하지 않았음), RC-15를 고치며 04 SPEC-065·06 작업 글·규칙 테스트 둘을 더함, 05 README 1절 수와 상태 줄의 마이그레이션 목록(M11\~J2 동안 고쳐지지 않았던 것), 02 12절은 예전 이름을 적지 않음. 규칙: (158) 05 6절(지우기 차례)을 바꾸면 `rule_tests.sql`의 `pg_temp.purge_run`을 같은 차례로 고치고 `expect_left`를 더하며(README가 '그대로 씀'이라 적음), 차례 수를 적은 04 SPEC-065 주 동작과 06 `api_catalog.py` SPEC-065 작업 글도 함께 맞춤('일곱 차례'가 세 곳에 있었음). (159) 다른 단계의 규칙을 01 `domain.md`에 요약해 되돌릴 때는 그 REQ 문장의 괄호 예외(예: REQ-218의 '이미 지났으면 픽업 일시')까지 옮김. 요약이 예외를 떨어뜨리면 원본끼리 어긋남(Codex P2). (160) 금지어가 된 예전 용어 이름은 새 절에 다시 적지 않음(scan.py 수가 늘어남): 대조표는 01 3-7을 가리킴. 표에 'DB'·'확정' 같은 말도 늘지 않게 '데이터베이스'·'마친'으로. (161) 05 README 1절의 수(대응 건수·컬럼, 제약 밖 인덱스, 마이그레이션 범위, 규칙 테스트와 지우기 결과)와 상태 줄의 마이그레이션 목록은 묶음마다 check_erd 출력과 `schema.sql`에서 다시 옮김. (162) 03 플로우에 노드를 더하면 `build_sitemap.py`가 07 표·수를 고치지만 07 README 9절(S8 노드 수 검사)과 13절(새 노드의 화면) 기록은 손으로 더함. (163) 다음 번호: REQ-255, SPEC-080, 마이그레이션 0018, TBL-059, API-084, DEC-25, OPEN-12, 05 앱 규칙 A39·결정 E33, SCR-051, 규칙 (164).

PR K1(설계 재검토 낮음: 01\~04 글, 요구사항 REQ-255\~262·용어 TERM-075\~086·04 출처 열과 플로우 대조 검사, [#45](https://github.com/kodonghui/siljang.ai/pull/45), squash 0709e8e, 2026-11-15 04:20 KST): 가지 커밋 31c4d88 01·02·edcb813 03·3b53270 04·2ea145c 재검토 README 행·6175cd2 02 검사 표·0a8a4f8 05 마이그레이션 0018·c464f6a 05 검사 기록을 squash(합친 트리가 머리 커밋과 같음). 동희님 2026-11-13 20:59 결정 카드 '높음·중간 뒤에 따로 고침 (추천)'대로, 'Claude 추천'이 없어 검토자의 고치는 방향대로 고침. 먼저 지금 main(823d137)으로 지적마다 이미 고쳤는지 봄: 이미 고침 0(RA-21의 REQ-080 부분만 PR #33의 REQ-224), 고침 11, 고치지 않음 1(RB-25, 새 규칙이라 동희님 결정). 01·02·03·04·05가 바뀜(06\~09 그대로). 고친 것: (1) RA-09(추적): 뒤 단계가 메운 손님 명령의 확인 버튼(SPEC-069)과 스킬 키(DEC-08)를 REQ-255·256(필수)으로, 03 FL-004 K1·FL-006 O8·FL-007 P4·FL-008 C4·FL-009 X4·FL-011 I3, 04 SPEC-069·017. (2) RA-18: REQ-001 → REQ-257(새 상담마다 AI 상담 고지), 01 예시 '새 상담', 03 FL-003 A4·FL-004 K4. (3) RA-19: 01 '별표 Ⅱ 2. 식료품(제빵류)'. (4) RA-20: 01 타임라인 E, 후기 규칙(받은 주문만), CTX-006·007 외부 시스템 패턴, 구글 캘린더 '다음 버전', 의존 표·다이어그램에 카카오톡 채널 → CTX-006·007. (5) RA-21: 권장 REQ-033·118·183 → 필수 REQ-258·259·260(같은 문장), 복합 7행은 다음 버전(02 11절), 01 7-5절 용어. (6) RA-23: 02 5-2 질문 3(예약기반 음식점 40%)·8(별표 17 제2호 다목·라목)·9(AI 기본법 제31조②)·10(정보통신망법 제50조①), 4-2. (7) RA-24: REQ-261(가예약된 주문이나 확정된 주문이 있는 날을 바꾸기 전 확인, 필수)·REQ-262(상담 하나의 AI 비용 상한 1,000원, 권장), 4-1 '결제 확인', 03 FL-002 C1·FL-004 D6·K14, 04 SPEC-007·017. (8) RB-21: 01 7-5절 TERM-075\~086, 04 SPEC-031·036 '결제 기다림'. (9) RB-24: SPEC-029 주문번호 형식(영문 대문자·숫자 6\~8자의 무작위 값), SPEC-021은 주문번호를 마스킹하지 않음. (10) RB-26: 04 출처 열(플로우 더함 7, 뺌 4, 본문 인용 20행), `build_spec.py` 검사 셋(고치기 전 main에서 9·6·20 → 0). (11) RC-19: SPEC-013·029·004에서 합계 0원 견적과 주문 요청을 막음(05 CHECK는 K2). 번호 바꿈은 02·03·04 원본만(05\~09와 지난 기록은 그대로). 04 바뀐 37행의 상태 열에 'K1', 8절 행, 6절 검사 단락(04:03), 02 11절 K1 검사 표(04:06). 05: 01에 더한 용어 열둘 때문에 첫 `checks.sh prK1`(04:06\~04:12, 머리 6175cd2)의 erd S7이 실패(나머지 용어는 05 컬럼·테이블 설명에 TERM 번호) → 이미 있는 컬럼 아홉·테이블 하나의 설명에 번호만 더함(마이그레이션 0018, `erd_editor_sync.py --write` 편집 10개, 다시 돌린 실행 편집 0개, `--compare` 차이 0줄), `check_erd.py` 15/15(04:13, README 8절), README 상태 줄·1절·2절·11절. 검사 8개 모두 종료 코드 0: `checks.sh prK1b`(2026-11-15 04:14\~04:19 KST, 머리 c464f6a의 트리): prd 행 262·문제 0·금지어 0, flows 필수 186/187(밖은 REQ-145)·전체 226/231·문제 0, spec 오류 0(수락 기준 319, 꼬리표 254, 가리킨 요구사항 189, 새 검사 셋 0·0·0: 짝 322·연결 152), erd 15/15(마이그레이션 18개, 규칙 테스트 311, 용어집 86개·나머지 용어 35개, README 8절의 04:13 단독 출력과 D5 기다린 시간 1.5초/1.4초만 다름), api 17/17(API 83, 예시 886, A13 main과 견준 깨지는 변화 0, 목 서버 요청 956, 통과 줄은 prJ3와 같음), sitemap 17/17(S8 노드 355 그대로), screens 15/15, mockup 14/14. 금지어 수(scan.py): domain 610 → 611(TERM-082 이름), requirements 140 → 146(법령 인용 배달 2·보증금 1·예약 2, K1 검사 표의 '확정' 1, '입금 확인' 고침 -2), spec 63 그대로, 05 README 35 → 36(TERM-082 이름). Codex: PR을 연 때의 머리 3b53270(01\~04) 코드 검토 의견 없음, 보안 검토 완료(의견 없음). 그 뒤 커밋 넷(2ea145c·6175cd2·0a8a4f8·c464f6a)은 자동 검토가 다시 돌지 않음(댓글로 부르지 않음), 리뷰 스레드 0. 결정과 다르게 하거나 더한 것: 05를 고침(01 용어가 S7에 걸려서, 테이블·컬럼·제약은 그대로), RB-26의 근거 없는 연결은 이유를 적지 않고 뺌, RC-19는 05 CHECK 대신 04 견적 단계에서 막음(검토자의 둘째 길), SPEC-021·013의 수락 기준 둘은 꼬리표 없이(그 REQ를 맡지 않음). 규칙: (164) 01 용어집에 TERM을 더하면 05 `check_erd.py` S7이 그 번호를 05 컬럼·테이블 설명(또는 헤더 주석·'테이블 없음' 행)에서 찾으므로 같은 PR에서 05 설명에 번호를 더하고, `build_erd.py --write`·COMMENT ON 마이그레이션·`erd_editor_sync.py --write`로 맞춤. 01\~04만 고치는 PR도 `check_erd.py`를 먼저 돌려 봄. (165) 요구사항 번호를 바꾸는 정규식은 `\b` 대신 `(?!\d)`로 끝을 막음: 'REQ-183이'처럼 한글 조사가 붙으면 `\b`가 맞지 않아 바꾸지 못한 곳이 남음. (166) `build_spec.py`의 RB-26 검사 셋이 오류로 막으므로 03 노드에 REQ를 더하거나 SPEC 본문이 REQ를 인용하면 그 SPEC의 fl·req 열을 함께 고침. (167) 'Claude 추천'이 없는 낮음에서 새 규칙이 필요한 지적은 고치지 않음으로 두고, Claude 추천·주된 반론·정하면 할 일을 PR 본문과 보고에 적어 결정 카드로 넘김. (168) 다음 번호: REQ-263, SPEC-080, 마이그레이션 0019, TBL-059, API-084, DEC-25, OPEN-12, 05 앱 규칙 A39·결정 E33, SCR-051, TERM-087, 규칙 (169).

PR K2(설계 재검토 낮음: 05\~06, 고지 때의 처리방침 버전·쌓이는 기록·예시 맞춤·목록 순서·상담 대화·사진 빈도 한도·후기 extra 가정, [#46](https://github.com/kodonghui/siljang.ai/pull/46), squash 8abf726, 2026-11-15 05:28 KST): 가지 커밋 f21c937 05·479714c 06·3a65347 04·08·bfa6551 06 설명의 요구사항 번호와 재검토 README 행·fb2fd15 Codex P2를 squash(합친 트리가 머리 커밋과 같음). 동희님 2026-11-13 20:59 결정 카드 '높음·중간 뒤에 따로 고침 (추천)'대로, 'Claude 추천'이 없어 검토자의 고치는 방향대로 고침. 먼저 지금 main(0709e8e)으로 지적마다 이미 고쳤는지 봄: 이미 고침 0(RC-21의 `request_keys` 보관 기간 부분만 PR #37), 고침 8(RD-20은 확인 전 가정), 고치지 않음 0. RB-25는 K1이 남긴 대로 손대지 않음(동희님 결정). 04·05·06·08과 재검토 README가 바뀜(01·02·03·07·09 그대로, 새 REQ·SPEC·TBL·API·화면 없음). 고친 것: (1) RC-20: `consultations.ai_disclosed_policy_version`(FK → `privacy_policies(shop_id, version)`, 고지 시각과 짝 CHECK, 마이그레이션 0019), 05 결정 E33·앱 규칙 A39, 04 SPEC-018 주 동작·수락 기준 #1. 고지의 링크는 늘 가장 최근 버전이고 고지 때 게시된 버전은 이 컬럼으로 앎(Codex P2를 고친 뒤의 글). 06 계약에는 두지 않음(사장님 화면이 읽지 않음). 위탁 동의 이력 행은 E33에 다음 마이그레이션 후보로. (2) RC-21: 05 6절 '남는 것'에 `ops_events`(숫자만 남고 지우지 않음과 그 이유)와 11단계에서 지우기 SQL과 함께 더할 인덱스 다섯(`orders(shop_id, consultation_id)`·`notifications(consultation_id)`·`confirm_cards(consultation_id)`·`issue_photos(message_id)`·`request_keys(created_at)`). (3) RD-12: API-048·059·063 예시의 위쪽 기록을 order 안 목록과 같은 상태로, `cancelled_unpaid`의 `confirmedAt` 비움. `check_api.py` A5에 대조 셋(같은 ID는 같은 status·revision, 확정 시각이 있는 주문(재제작 밖)에 확인된 결제, 명령 결과의 위쪽 기록이 같은 주문의 목록에 있음). 고치기 전 main 계약에 돌리면 15곳(API-048 1, API-059 10, API-063 4). (4) RD-13: 목록을 주는 API 14개 설명에 '순서:', DEC-14에 정렬 규칙과 나누지 않는 목록 다섯의 예외(버전 목록 둘 API-018·022, 범위가 정해진 목록 셋 API-028·051·067), `check_api.py` A11(고치기 전 main에서 14 + 5 = 19곳), 예시 순서(API-040 할 일, API-044 주문). (5) RD-14: `simpleImage.altText` 1\~1,000자 → 1\~50자(꼭 넣는 값은 그대로, API-070\~072). (6) RD-17: (a) API-043이 그 상담의 손님 안내(`notifications`)를 시각 순으로 섞어 줌(author `owner`·`notice`, delivery `sending`·`event_api`, 예시 `with_owner_reply`, 08 SCR-018 라벨), (b) `ConsultationMessage.text`·`CustomerLine.text` 4,000 → 100,000자(SPEC-017이 1,000자 넘는 글도 기록에 남김). (7) RD-18: API-007 429 `rate_limited`(사장님마다 1분 30번, 1시간 안 쓰지 않은 올린 파일 50개, 06 DEC-16에 행), 08 SCR-015·030·035·036 `resp`에 그 429. (8) RD-20(확인 전 가정): API-072 OPEN-12(후기 블록의 스킬 요청에 extra가 남는다고 가정, 남지 않으면 그 사용자에게 가장 최근 보낸 후기 부탁의 주문에 붙임, 개발 전 시험 채널에서 확인), 06 README 9절 열린 질문 표와 13절 '개발 전에 정할 것'(열린 질문 12개), 04 SPEC-062 예외와 8절 '06단계 OPEN-12' 행. K1이 넘긴 것: (a) RC-19 05 CHECK `orders_amount_paid_chk`(재제작이 아닌 주문은 1원 이상), (b) 주문번호 CHECK 6\~12 → 6\~8자(SPEC-029, 06 `ORDER_NO`), (c) 05 머리말·2절 REQ-001\~262(REQ-255\~262 대조, 새 테이블·컬럼 없음)와 K1이 바꾼 번호 셋(033→258, 118→259, 183→260)을 05·06의 지금 설명에서 새 번호로(지난 기록은 그대로, REQ-001은 05·06 지금 설명에 없었음). 05 규칙 테스트 311 → 315, 06 깨지는 변화 가운데 A13이 찾지 않는 5개(상담 대화에 섞은 안내의 author·delivery 값, 글 한도, 주문번호 6\~8자, altText 1\~50자, 사진 429)는 06 README 11절 목록에. 검사 8개 모두 종료 코드 0: `checks.sh prK2`(2026-11-15 05:02\~05:07 KST, 머리 bfa6551), Codex 의견을 고친 뒤 `checks.sh prK2b`(05:12\~05:17, 머리 fb2fd15), 합치기 직전 `checks.sh prK2f`(05:19\~05:24, 머리 fb2fd15): prd 행 262·문제 0·금지어 0, flows 필수 186/187(밖은 REQ-145)·전체 226/231·문제 0, spec 오류 0(수락 기준 319, 꼬리표 254, 가리킨 요구사항 189, 짝 322·연결 152·0), erd 15/15(마이그레이션 19개, 규칙 테스트 315, 다이어그램 `--compare` 차이 0줄, DDL 141,639자), api 17/17(예시 888, 성공 응답 시각 934, 오류 예시 491, 열린 질문 12, 목록 API 14, A13 main과 견준 깨지는 변화 0, 목 서버 요청 958), sitemap 17/17(S8 노드 355), screens 15/15(C6 응답 행 965, C11 912), mockup 14/14. 금지어 수(scan.py)는 main과 같음: 05 README 36, 06 README 43, `openapi.yaml` 47, spec 63, 08 README 0, 재검토 README 1. Codex: PR을 연 때의 머리 3a65347 코드 검토에 P2 하나(05 A39가 '고지 글의 링크도 그 버전'이라 했으나 06 API-039는 늘 가장 최근 버전만 주고 지난 버전 주소가 없음). fb2fd15에서 버전 주소를 더하지 않고 05 A39·E33·컬럼 설명(0019의 COMMENT ON 포함)·04 SPEC-018·06 API-039를 '고지 때 게시된 가장 최근 버전을 남기고 링크는 늘 가장 최근 버전'으로 맞춤(검토자의 고치는 방향은 고지 때의 버전을 남기는 것이라 버전 주소가 필요하지 않고, 지난 처리방침을 손님에게 보이는 것은 새 요구사항), 스레드 해결(댓글 없음). 머리 fb2fd15 코드 검토 의견 없음, 보안 검토 완료(의견 없음), 검토 스레드는 해결한 하나뿐. 결정과 다르게 하거나 더한 것: RC-21은 이미 고친 `request_keys` 밖의 쌓이는 기록을 적음(인덱스는 검토자 말대로 11단계에서 더함), RD-12 대조 셋째를 더함, RD-13은 커서 목록 6개가 아니라 목록 API 14개 모두와 범위 목록 셋을 DEC-14 예외로, RD-17은 (a)·(b) 둘 다(자르지 않음), RD-18 한도 숫자는 Claude가 정함(되돌릴 수 있음), RD-20은 04 SPEC-062 예외와 8절 행을 더함, RC-20은 06 계약에 두지 않음, Codex P2는 기능을 더하지 않고 글을 맞춤. K3로 넘김: 08 SCR-019 지금 설명 두 곳(`screens_owner_a.py` 191·203행, 생성된 SCR-019.md 13·40행)의 REQ-183 → REQ-260, 07 README 입력 표의 요구사항 범위(지금 'REQ-001\~164(4차 개정)'). 규칙: (169) 편집 스크립트의 멱등 가드는 새 글이 이미 있는지(`new in s`)만 보고(규칙 (78)), 뒤 커밋이 같은 글을 다시 고치면 앞 스크립트 맨 위에 '이미 바뀜' 가드를 두어 다시 돌려도 assert가 깨지지 않게 함. (170) 06 설명의 열린 질문은 한 문장으로 쓰고 끝에 괄호로 OPEN ID를 둠: `check_api.py` A10이 'Open:' 문장 끝의 '(OPEN-n)'을 찾아 두 문장으로 나누면 실패. (171) 06에 응답(새 예시 이름, 429 같은 새 상태 코드)을 더하면 그 API를 쓰는 08 화면마다 `resp`에 상태 대응을 더하고(C6·C13) 같은 PR에서 `build_screens.py --write`와 `check_screens.py --hub`를 돌림. (172) 손으로 쓴 README 글도 08 C11 허용 예외 수와 scan.py 금지어 수를 바꾸므로 기록을 쓴 뒤 검사와 scan.py를 다시 돌려 그 숫자를 옮김. 새 글에는 맨 '확정' 대신 '확정 안내'·'확정 시각'처럼 써서 수를 main과 같게 둠. (173) 요구사항 번호가 바뀌면 지금 설명(생성기 원본과 손 절의 현재 글)만 새 번호로 고치고 지난 기록(고친 기록 표·이력 행)은 그대로 둠. 찾을 때는 `REQ-183([^0-9]|$)`처럼 끝을 막고(규칙 (165)), 넘긴 단계 밖에 남은 곳은 다음 PR에 넘김. (174) 한 단계의 글이 다른 단계의 동작을 약속하면(예: '고지 글의 링크도 그 버전') 06 API·08 화면 계약에 그 동작이 있는지 대조하고, 없으면 기능을 새로 더하지 않고 검토자의 고치는 방향이 요구하는 만큼 글을 맞춤(Codex P2). (175) 다음 번호: REQ-263, SPEC-080, 마이그레이션 0020, TBL-059, API-084, DEC-25, OPEN-13, 05 앱 규칙 A40·결정 E34, SCR-051, TERM-087, 규칙 (176).

PR K3(설계 재검토 낮음: 07\~09, 바로 이동과 사이트맵 opens·머리말의 다른 경로·누르는 곳 44px·상태 프레임의 값과 기본값·완성 실행 취소·로그인 만료 때 넣던 값·남은 상태 기록, [#47](https://github.com/kodonghui/siljang.ai/pull/47), squash e4067ce, 2026-11-15 06:25 KST): 가지 커밋 23276aa 07·fe65ea1 08·da436c4 09·ed5c890 08·09 README 중간 저장(조정 세션이 턴 한도로 멈춘 작업 트리를 그대로 커밋)·d443b79 README 기록과 검사 숫자·7738339 재검토 README 행을 squash(합친 트리가 머리 커밋과 같음). 동희님 2026-11-13 20:59 결정 카드 '높음·중간 뒤에 따로 고침 (추천)'대로, 'Claude 추천'이 없어 검토자의 고치는 방향대로 고침. 먼저 지금 main(8abf726)으로 지적마다 이미 고쳤는지 봄: 이미 고침 0(RE-13의 SCR-027 부분만 PR #42 J1에서 보상을 미리 고르지 않게 함), 고침 6(RE-12·13·14·18·19·20), 고치지 않음 1(RE-11, 09 체크포인트에서 받은 범위라 기록만). K2가 넘긴 둘(SCR-019 지금 설명의 REQ-183 → REQ-260, 07 README 입력 표의 요구사항 범위)도 고침. RB-25는 손대지 않음(동희님 결정). 07·08·09와 재검토 README가 바뀜(01\~06 그대로, 새 번호 없음). 고친 것: (1) RE-19: 08 정의의 '(SCR-xxx)' 바로 이동 가운데 사이트맵에 없던 16개를 화면 11개의 `opens`에(SCR-014→035, 015→016, 016→015, 017→027, 019→021, 021→018·029, 025→026, 027→026, 029→021·023·025, 043→001·033, 045→021·044), SCR-043 '조건 누르기'는 화면마다 괄호 꼴로, SCR-047 '가게 누르기'의 SCR-050은 SCR-048에서 여는 화면이라 괄호 없이 고쳐 씀. 08 C4가 액션·응답 표의 괄호 ID를 상위·하위·`opens`·`opens_by_task`·`opens_by_banner`와 견줌(자기 자신과 카카오 대화 화면은 뺌, 70곳). (2) RE-14: 머리말 '다른 경로'(`also_paths`가 있는 SCR-014·037·039·042·050), C2가 견줌(둘째 경로가 없으면 줄도 없어야 함). (3) RE-18: SCR-030 '완성'·'실행 취소'·`done`에 손님에게 보낸 사진은 되돌릴 수 없음과 다시 완성해도 사진 안내는 한 번(SPEC-053). 사진 보내기를 5분 미루는 다른 길은 04·06 동작을 바꿔 쓰지 않음. (4) RE-20: SCR-015 `permission`의 넣던 글 값(사진·동의 체크 빼고)은 그 탭의 세션 저장소에만, 남길 때의 사장님 계정과 같은 카카오 계정일 때만 되살리고 등록 성공·로그아웃·1시간 뒤 지움. (5) RE-13: 09 빈 상태의 머리·요약 값(SCR-030 '그날 픽업 0건', SCR-031 '0건', SCR-032 머리 값 없음, SCR-038 버전 '없음'·이력 링크 없음), 상자 프레임(찾을 수 없음·불러오기 실패)은 머리 값 없이(검토자가 짚은 빈 상태 밖으로 넓힘), SCR-007 빈 상태는 08 새 프레임 종류 `chat=`(`f_chat_only`, normal 대화 없이 그 상태의 대화 전체)로 주문 카드 없이, 정의의 기본값(SCR-015 동의 비움, SCR-024 고르기 전·'차이 금액'과 결과 줄 숨김·'수락' 막힘(`gen.py` A 버튼 모양 `off`와 `disabled`, 확인 창 두 프레임은 '그대로'를 고른 뒤), SCR-029 360 바닥 버튼 셋 세로(`stack`, 각 48px), SCR-045 후기 사진 둘 같은 게시 동의). (6) RE-12: 09 탭 최소 너비 `size.target`·좌우 여백 `space.sm`·탭 사이 `space.xs`, 시스템 말풍선 링크 `inline-flex`·최소 높이 `size.target`, 입력 요소가 필드의 위아래 테두리를 덮어(margin-block -1px) 필드 전체 44px. 검토자의 measure.js로 260곳(글 입력 155, 라디오·체크박스 76, 탭 25, 링크 4) → 76곳(라벨이 높이 44px로 감싼 라디오 73·체크박스 3). (7) RE-11: 09 README 1절·5-1절에 그리지 않은 상태 206개의 내역(permission 44·stale 44·loading 38·done 31·submitting 25·rate-limited 6·load-failed 6·화면 고유 12: SCR-003 fixed-answer·handed-over·link-test, SCR-004 day-full, SCR-007 handed-over, SCR-024 awaiting-payment, SCR-029 mismatch, SCR-035·048 on-hold, SCR-041 checking·event-off, SCR-042 reconnect. 08 상태 표와 보드 캡션을 견줘 셈), 9절 6번에 10단계 WBS 할 일(화면 고유 상태 먼저, '상태 공통 부품' 보드 한 장, 후보 둘은 세 화면뿐, 사진 자리는 회색), 9절 5번과 1절의 '다음'을 재검토 뒤로. 09 보드 51개를 다시 그림(입력 필드가 있는 보드가 많아서, 100개를 모두 다시 그려도 이 51개만 바뀜), `heights.json` SCR-024 360 1,059 → 940·1280 1,050 → 931, `canvas.json` 아래 줄 y 119px 위로. 검사: checks.sh 8개 종료 코드 0(prd·flows·spec·api 출력은 K2 뒤와 같음, erd는 ERD Editor 파일 시각만 다름, sitemap 17/17·S14 허용 예외 79 → 84, screens 15/15·C4 바로 이동 70·C11 912 → 906, mockup 14/14·문구 6,473 → 6,418·값을 뺀 576 → 564·C9 209 → 208·contrast-image 45 → 42·간격 알림 62 → 60·목표 알림 화면 보드 38 → 13). 금지어 수(scan.py)는 main과 같음: 07 README 18, 08 README 0, 09 README 0, 재검토 README 1. 새 검사의 음성 시험: 다른 경로를 틀리게 하면 C2, SCR-043 opens에서 SCR-033을 빼면 C4가 실패. 처음 돌렸을 때 걸린 것: check_mockup C8(SCR-038 빈 상태의 '없음(템플릿 기본값)'이 출처에 없음 → '없음'), C10(`gen_screens.py` 주석의 '칸' → '입력 필드'), C11(SCR-024 그린 높이 → `heights.json`). 편집 스크립트 edit08.py의 가드(`new in s and old not in s`)가 옛 글이 새 글 안에 들어 있을 때 다시 돌리면 글을 두 번 넣어, 파일을 되돌리고 가드를 `new in s`만으로(규칙 (169)) 고쳐 다시 돌림. 눈으로 본 것: SCR-003·007·024·029·030·031·036·038·045의 360 PNG. Codex: PR을 연 머리 d443b79의 코드 검토 의견 없음, 보안 검토 완료(의견 없음), 검토 스레드 0. 합친 뒤 가지와 로컬 main을 e4067ce로 맞추고 main 작업 트리(scratchpad/mainwt)를 지움. 결정과 다르게 하거나 더한 것: RE-13을 상자 프레임의 머리 값까지 넓힘, RE-19에 C4 검사를 더함, RE-12를 잴 때 새로 찾은 SCR-032-1280 캘린더 날짜 버튼(43.6px, 검토자의 측정은 반올림해 44px로 봄)은 검토자가 짚지 않아 그대로(개발 때 1280 캘린더 열 너비로), RE-18은 글로만(04·06 동작 그대로), RE-20은 사진과 동의 체크를 남기지 않음. 규칙: (176) 08 정의의 액션·응답 표에서 괄호로 단 화면 ID는 '이 화면에서 바로 이동'이라 C4가 사이트맵의 상위·하위·`opens`·`opens_by_task`·`opens_by_banner`와 견줌. 새 바로 이동을 쓰면 같은 PR에서 `sitemap.yaml`의 `opens`에 더하고 `build_sitemap.py --write`·`build_screens.py --write`를 돌림. 다른 화면에서 여는 화면은 괄호 없이 씀. (177) 09 상태 프레임은 normal의 머리 값과 블록을 물려받으므로, 그 상태에서 달라지는 값(빈 상태의 건수·버전·링크, 정의의 기본값)은 `screen_samples.py`의 `states.<상태>`로 주고 상자 프레임은 머리 값을 그리지 않음. 견본의 짧은 값도 C8 출처 대조를 받으므로 출처에 있는 글(예: '없음')을 씀. (178) 09 생성기 주석도 C10(용어 정리 전의 말)을 받으므로 주석에도 '필드·셀·영역'을 씀. (179) page-check를 보드 하나에 따로 돌릴 때는 뷰포트를 `$preview`의 아트보드 너비로 줌(360·1280을 주면 page-overflow 오류가 생김). main과 숫자를 견줄 때는 바뀐 보드만 main 작업 트리와 이 가지에서 같은 방법으로 돌려 차이를 셈. (180) README 기록에 화면·버튼 이름('입금됨', '예약 링크' 같은)을 쓰면 07 S14·09 C9 허용 예외 수도 바뀜(규칙 (172)를 07·09로 넓힘). 검사 숫자 줄에는 그 낱말을 쓰지 않고, 기록을 쓴 뒤 검사를 다시 돌려 숫자를 옮김. (181) 다음 번호: REQ-263, SPEC-080, 마이그레이션 0020, TBL-059, API-084, DEC-25, OPEN-13, 05 앱 규칙 A40·결정 E34, SCR-051, TERM-087, 규칙 (182).

설계 재검토 고치기 끝: 높음 12·중간 20묶음·낮음 27개, PR #27\~#47. 남은 것: (1) RB-25(결제 전 주문으로 여러 날 자리를 붙잡는 한도, 새 규칙) 동희님 결정, (2) 열린 질문 OPEN-7(AI 회사·모델, 동희님이 10단계 전에 고름)과 OPEN-2·9·10·11·12(개발 전에 실제 카카오로 시험), (3) 사람이 보는 뷰 동기화(Notion 기록, 09 캔버스(Artifact)의 바뀐 보드, 07 사이트맵 뷰 등), (4) Schemathesis(06 계약 시험), (5) 법령 원문 다시 확인(H3·H5·H10의 법률 검토 질문 7·4·6 포함), (6) 09 README 9절 6번의 그리지 않은 상태(10단계 WBS), (7) SCR-032-1280 캘린더 날짜 버튼 너비(개발 때).

PR D(동희님 결정 반영, [#48](https://github.com/kodonghui/siljang.ai/pull/48), 합친 SHA 220f09d): 동희님 2026-11-15 14:19 KST Claude Code 채팅의 결정 카드 셋을 01\~09에 반영. OPEN-7 "둘 다 시험해 평가로 고름 (추천)" → REQ-266·06 DEC-25(OPEN-7을 닫음, 모델 호출 한 곳에서 배포 설정으로 Anthropic·OpenAI 가운데 한 회사, 12단계 평가를 지나는 가장 싼 모델, 보관 안 함은 개발 전에 두 회사 모두에 신청, 허가 전 처리방침은 30일 보관, Google 뺌). RB-25 "가게가 한도를 정함" → REQ-263\~265, SPEC-021·022·023·029·030·077, 마이그레이션 0020(`shops.awaiting_payment_limit` 0\~10 기본 2, `handoffs` 사유 `order_limit`·`limit_decision`·`limit_accept_expires_at`·`limit_used_order_id`), A40·E34, 06 `awaitingPaymentLimit`·`Handoff.limit*`·`awaitingPaymentOrders`·`HandoffAnswerInput.limitDecision`·스킬 결과 `order_limit_reached`, 08 SCR-017·034·카드 화면 일곱·SCR-011, 09 SCR-002·034 보드 4개. RB-15 "지금대로 둠 (추천)" → 동작 그대로, '확인 요청' 표시마다 확정 기록을 덧붙임. Claude 기본값: 한도 상한 10건, 넘겨 받은 기한 24시간. 커밋: cf0c784(01·02), b66956c(03), 49909fd(04), 4808577·3292d35(05), a87323d(조정 세션 중간 저장, 06)·edd9dd9(06 README), cd47db5(조정 세션 중간 저장, 03·07·08·09), 659e406(07·08·09 기록, SCR-034 높이), PR을 연 뒤 57941e9(재검토 README의 PR 번호)·9a50544(09 기록의 견본 설명)·013c98f(03 README의 PR I2 기록에 RB-15 결정). 검사: `checks.sh prDec`(15:17 KST 시작, 머리 659e406) 8개 모두 종료 코드 0 — prd 문제 0·금지어 0(요구사항 266, 유효 235, 필수 191), flows 문제 0·금지어 0(필수 190/191, 전체 230/235), spec 오류 0(수락 기준 328), erd 15/15(마이그레이션 20, 규칙 테스트 324), api 17/17(예시 893, A13 깨지는 변화 5 모두 목록에, 목 서버 요청 961), sitemap 17/17(노드 357), screens 15/15(응답 행 974), mockup 14/14(문구 6,424). 처음 다시 그렸을 때 09 C11이 SCR-034 그린 높이(2,156·2,203)가 `$preview`(2,069·2,116)와 달라 `heights.json`을 page-check 값으로 고치고 `gen_screens.py`로 `canvas.json`의 아래 줄 자리까지 맞춤. 이전에 '확정함'으로 고쳐 쓴 RB-15 확인이 03 S17·07 S14에 금지어로 걸려 단계마다 허용 꼴로 다시 씀. 합치기 직전 `checks.sh prDecF`(15:28\~15:32 KST, 머리 013c98f) 8개 모두 종료 코드 0(출력은 같고 03 허용 꼴 '확정)' 하나 늚). Codex: PR을 연 머리 659e406의 코드 검토 의견 없음, 보안 검토 완료(의견 없음), 검토 스레드 0. 합친 뒤 가지(force-with-lease)와 로컬 main을 220f09d로 맞춤(합친 트리는 013c98f와 같음). 규칙: (182) '확정' 허용 꼴은 검사마다 다름: 03 `check_flows.py`는 '확정)'·'확정했'·'확정하'·'확정이'·'확정된'·'확정까지'·'확정으로'·'확정할'·따옴표 안의 '확정'(‘확정함’·‘확정을’은 안 됨), 07 `check_sitemap.py`는 '확정하'·'확정된'·'확정 |'·'추천대로 확정'(‘확정했’·‘확정함’은 안 됨), 08 `check_screens.py`는 '확정했'·'확정함'·'확정을'·'확정('. 결정 확인을 여러 단계에 덧붙일 때는 그 단계 검사의 허용 목록을 먼저 보고 꼴을 고름(`scan.py`는 09의 합집합이라 이것만으로는 모자람). (183) 조정 세션이 턴 한도나 중지 훅 때문에 중간 저장 커밋을 만들 수 있으므로, 이어 받을 때는 `git log -3`로 머리를 보고 그 위에 커밋(합칠 때 squash). (184) 검사 시각은 자리표시(`@@…@@`)로 쓰고 `checks.sh`를 띄우기 직전에 KST 시각으로 채운 뒤 `grep -rn "@@" docs`로 남은 것이 없는지 봄. PR 번호처럼 PR을 연 뒤에야 아는 값은 PR을 연 뒤의 커밋으로 채움. (185) 결정으로 '확인 요청' 표시를 닫을 때는 `grep -rn "Claude 추천이라" docs research db api`로 남은 표시를 모두 찾아 덧붙임(이번에 03 README 8절의 PR I2 기록 하나를 PR을 연 뒤에 찾음). 이미 적용한 마이그레이션의 머리말(0015)은 고치지 않고 새 마이그레이션(0020) 머리말에 적음. (186) README 기록에 보드의 견본을 적을 때는 `screen_samples.py`의 그 화면 값을 보고 씀(이번에 SCR-017 견본을 '마감된 날 건'으로 잘못 적었다가 '먹어도 되는지 묻는 건'으로 고침). (187) 다음 번호: REQ-267, SPEC-080, 마이그레이션 0021, TBL-059, API-084, DEC-26, OPEN-13, 05 앱 규칙 A41·결정 E35, SCR-051, TERM-087, 규칙 (188).

뷰 맞춤 기록(사람이 보는 뷰 맞춤 기록과 저장소 진행 기록, [#49](https://github.com/kodonghui/siljang.ai/pull/49), 합친 SHA da7f7fc): 동희님 2026-11-15 15:26·15:27 KST Claude Code 채팅 지시(15:27 말 그대로, 줄바꿈은 ' / ': "야 노션 권한요청 작작해 / 깃으로 관리하고 최종만 노션ㄷ에 올리라고 미로보드 관련해서도 일단 깃에서 관리해")에 따라 저장소만 고침(Artifact 게시·Notion·Miro 호출 0). (1) `docs/records/progress.md` 새 파일(최신이 위, 11/15 단락 넷: 재검토 고치기 끝 06:25, 결정 셋과 PR #48 15:33, 지시와 멈춘 Notion 맞춤 15:27(표 6개 속성 69행 API 22·DEC 9·E 6·ERR 17·HOT 8·READ 7, 본문 TBL-028 1행, 새 행 0, 근거 `view/v1r/ledger.json`), 이 PR 16:17). `.corthex/project.json` records를 kind git·location `docs/records/`로(계약 project.md의 records 필드는 kind·location뿐이라 지시와 Notion 기록 데이터베이스 주소는 note에). (2) `view/miro_steps.md` → `docs/01-domain/miro-steps.md`(220f09d `domain.md` 줄 링크 77개, 큰 diff 파일 없음), `domain.md` 머리말 10줄 끝에 '보드는 2026-11-12 10:05 모습 그대로, 그 뒤 바뀐 것은 단계 목록이 원본' 한 문장. `run.py --write` 안 돌림. (3) 02·03·04에 'Notion은 일의 끝에 한 번, 11/15에는 표 6개 69행만 맞춤' 한 문장(synced_at 그대로). (4) 06\~09 README에 e4067ce로 올린 시각·버전(06 14:57 `1794722233-42e3`, 07 15:03 `1794722613-f2d3`, 08 15:04 `1794722641-887c`, 09 15:08 `1794722890-7446`)과 PR #48 차이(06·08·09)는 끝에 한 번, 07 페이지는 PR #48에서 바뀌지 않음. 06 README 12-2는 220f09d의 Schemathesis(15:40, 4019번 포트): API 83, 사례 1,875(14.51초, 종료 코드 1), 예시 단계 65 통과·18 건너뜀(조회 15·로그아웃 2·사진 업로드 1), 실패 151 = ST401 71·ST204 72·ST105 8 모두 목 서버의 한계, 계약 쪽 0, 로그인 필요 76 가운데 71은 ST401·5는 경고, 예시만 따로 210 사례에 401 응답 205·401·403만 받은 API 60·성공 5는 로그인 없는 API 5. (5) `viewer.html` 머리말 `{{…}}` 자리와 `build_viewer.py`가 원본에서 셈(계약 0.1.0, '2026-11-12 확정 · 2026-11-15 고침', API 83·응답 417·오류 코드 37·결정 사항 25·열린 질문 11), 06 README 35줄·`api_ops.py` 82 → 83, 06 README 3절에 세는 방법. (6) 재검토 README '고친 기록' 뒤 한 단락. 커밋: 7b86b01(진행 기록·project.json), 9c4386b(Miro 단계 목록), e11f54f(02\~04), 565e17c(06\~09 README·Schemathesis), deb9c63(06 생성기), 1659882(재검토 README), PR을 연 뒤 167b8a5(PR 번호·기록 시각·검사 숫자)·98a1e95(검사 시각을 실제 분으로, Codex 결과). 검사: `checks.sh prRec`(16:02\~16:07 KST, 머리 1659882) 8개 모두 종료 코드 0 — prd 문제 0·금지어 0(요구사항 266, 유효 235, 필수 191), flows 문제 0·금지어 0(필수 190/191, 전체 230/235), spec 오류 0(수락 기준 328), erd 15/15(마이그레이션 20, 규칙 테스트 324), api 17/17(예시 893, A13 깨지는 변화 0, 목 서버 요청 961), sitemap 17/17(노드 357, S14 허용 예외 85), screens 15/15(응답 행 974, C11 허용 예외 908), mockup 14/14(문구 6,424, C9 허용 예외 208). prDecF와 견주면 erd E1 파일 시각(squash 커밋 220f09d의 시각)·D5 기다린 시간, api A13 5 → 0만 다름. `prRecF`(16:12\~16:17, 머리 167b8a5)·`prRecG`(16:17\~16:22, 머리 98a1e95)도 8개 모두 종료 코드 0, 출력 같음(D5 시간만 다름). 금지어(`scan.py`): 고친 13개 파일은 main과 수가 같고 `progress.md` 0, `miro-steps.md` 37곳은 옛 말→새 말 목록과 보드 이름. 허브 스냅숏: 항목 562·알림 2(그 전부터 있던 06 파일 크기, `db/schema.sql:54`)는 main과 같음, 01 읽은 파일 1 → 2, 항목 95 그대로. Codex: PR을 연 머리 1659882의 코드 검토 의견 없음, 보안 검토 완료(의견 없음), 검토 스레드 0. 합친 뒤 가지(force-with-lease)와 로컬 main을 da7f7fc로 맞춤(합친 트리는 98a1e95와 같음). 규칙: (188) 단계 폴더(허브가 읽는 `docs/01-domain/` 같은 곳)에 새 파일을 둘 때는 허브가 항목이나 복사 시각으로 읽는 꼴을 피함: 머리말에 `synced_at` 같은 복사 시각 키를 쓰지 않고, ID로 시작하는 제목과 머리가 'id'·'key'·'아이디'·'번호'·'키'이거나 ' id'로 끝나는 표 열을 쓰지 않음. 넣은 뒤 `hub.py --home <임시> snapshot --path <폴더> --print --json`을 main 작업 트리와 이 가지에서 돌려 항목 수·알림·복사 시각이 같은지 봄. (189) 2026-11-15 동희님 지시로 진행 기록은 저장소 `docs/records/progress.md`(최신이 위)에 남기고 Notion·Artifact·Miro는 일의 끝에 한 번만 호출함. PR마다 그 PR의 단락(한 일·이유·결과·확인한 것·다음 행동)을 같은 PR에 넣고, PR 번호·기록 시각·검사 숫자는 규칙 (184)대로 PR을 연 뒤 채움. (190) 사람이 보는 페이지에 보이는 숫자는 생성기가 원본에서 세어 넣게 함(Swagger 페이지 머리말이 손으로 적은 API 72로 남아 있었음). 템플릿에서 손으로 적은 숫자를 찾으면 자리표시로 바꾸고, 자리가 하나씩인지와 남은 자리가 없는지를 생성기가 확인. (191) Schemathesis는 `view/stvenv`(Schemathesis 4.33.2)와 Prism 심볼릭 링크 `view/st/v2mock`으로 4019번 포트에서 돌림(`checks.sh`의 `pkill -f 'prism mock'`에 잡히지 않게). 숫자는 전체 실행의 출력(`out.txt`)과 예시 단계만 따로 돌린 ndjson(`ex_events.ndjson`)에서 옮기고, 로그인이 필요한 API가 성공 응답을 보지 못한 한계를 함께 적음. (192) 내 글에서 `scan.py`가 잡는 말과 바꿀 말: 'DB'(TERM-028 금지어) → 데이터베이스, '틀' → 템플릿, '부르다·부르지' → 호출, '칸' → 열, '판' → 버전. 금지어는 파일마다 main과 수를 견줘 늘어난 곳만 봄. (193) PR을 합친 뒤 첫 검사에서 erd E1의 파일 시각(그 파일의 마지막 커밋이 squash 커밋이 됨)과 api A13(main과 견준 깨지는 변화가 main에 들어가 0이 됨)이 바뀌는 것은 숫자 차이로 보지 않고 사유를 적음. (194) 검사 시각 자리표시는 초가 30을 넘으면 다음 분까지 기다린 뒤 채우고 바로 `checks.sh`를 띄움(이번에 16:11에 채우고 16:12:00에 시작해 커밋을 하나 더 하고 검사를 다시 돌림). (195) 다음 번호: REQ-267, SPEC-080, 마이그레이션 0021, TBL-059, API-084, DEC-26, OPEN-13, 05 앱 규칙 A41·결정 E35, SCR-051, TERM-087, 규칙 (196).

PR W(10단계 WBS 초안: 작업 169개, 반복 계획, 개발 전 확인, [#50](https://github.com/kodonghui/siljang.ai/pull/50), 합친 SHA 2f175c3, 2026-11-15 17:04 KST): 입력 main da7f7fc(01\~09 산출물은 읽기만). 가지 커밋 9120f9f(1/3 원본 wbs_rows.py·생성기 build_wbs.py·wbs.md)·e761bf4(2/3 README·생성 절 다섯·project.json 10-wbs·진행 기록)·0fe905e(3/3 PR 번호·기록 시각·검사 시작 시각)·9b64eb0(checks.sh 결과)를 squash(합친 트리는 9b64eb0과 같음). 결과(build_wbs.py 출력): 작업 169개 · 크기 합 235일 · 반복 9개 · 동희님 11개 · Claude 158개 · SPEC 79개 · 수락 기준 328개 · API 83개 · 화면 50개(상태 367개, 09에서 그린 161개, 그리지 않은 206개) · 테이블 58개 · 앱 규칙 40개 · 공통 규칙 9개 · 열린 질문 11개. 반복별 작업(크기 합): 0 14(11.5, 동희님 10)·1 17(26)·2 31(43)·3 28(44.5)·4 25(35.5)·5 16(22)·6 24(30)·7 6(13)·8 8(9.5, 동희님 1). 가장 긴 앞선 작업 줄 43.5일(작업 26개, TASK-001 → … → TASK-142). 반복 1은 모두 TASK-015를 거쳐 TASK-002(스택 고르기)를 기다림. 스택: 언어 A(Python FastAPI 서버 + TypeScript React 웹) 추천, 반론 B(TypeScript 하나, 두 회사 SDK·비동기는 B도 같아 A의 이점은 기존 Python 도구 하나). 배포 셋(Cloud Run·Cloud SQL asia-northeast3 / ECS on Fargate·RDS ap-northeast-2 / Supabase ap-northeast-2와 컨테이너 서버)은 TASK-001에서 월 비용 범위를 확인한 뒤 추천. 사실 11개는 2026-11-15 curl로 공식 문서를 열어 확인(README 6-4). 검사: build_wbs.py 15개 오류 0(16:57, 합친 뒤 main에서도 오류 0), `checks.sh prW`(16:58:28\~17:03:24, 머리 0fe905e) 9개 모두 종료 코드 0, 01\~09 검사 8개 출력은 prRecG(98a1e95)와 걸린 시간만 다름. 그 뒤 커밋 9b64eb0은 docs/10-wbs/README.md·docs/records/progress.md만 바꿨고 8개 검사는 두 파일을 읽지 않음(검사 스크립트를 grep으로 확인), wbs만 다시 돌려 오류 0. 허브 스냅숏(16:55, 합친 뒤 main에서도 같음): 항목 562 → 731(task 169), 경고 2 → 32(missing-upstream 'links no spec' 30: 반복 0 14·반복 1 9·반복 8 7), 정보 1, 오류 0. scan.py: README·progress.md 0, wbs.md 2(05 A1 제목과 SPEC-033 이름을 옮긴 것), project.json 12 = main 12. Codex: e761bf4에서 코드 검토 의견 없음, 보안 검토 완료, 검토 스레드 0, CI 없음. 합친 뒤 가지(force-with-lease)와 로컬 main을 2f175c3로 맞춤, 임시 worktree(prW/mainwt) 지움. 호출 안 함: Notion·Artifact·Miro·GitHub 이슈와 댓글. 규칙: (196) 10단계 WBS의 원본은 `research/cake-wbs-2026-11/wbs_rows.py`이고 `docs/10-wbs/wbs.md`와 README 생성 절 다섯(counts·inputs·iterations·before-dev·checks)은 `python3 -I research/cake-wbs-2026-11/build_wbs.py . --write`로만 만듦. 01\~09 원본(spec_rows·schema.sql·openapi.yaml·sitemap.yaml·screens_*·gen_screens.py KEY_STATES·05 README A 표·domain.md 금지어·requirements.md)을 바꾸는 PR은 같은 PR에서 이것을 돌림: 응답 코드·상태 수·수락 기준 수가 wbs.md에 생성돼 있어 안 돌리면 checks.sh의 wbs가 '생성 절이 원본과 다름'으로 실패함. 새 SPEC·API·SCR·TBL·A·G·OPEN·SPEC 밖 유효 REQ를 만들면 그것을 맡는 작업을 끝 번호(TASK-170\~)로 더하거나 기존 작업에 붙임(없으면 검사가 잡음). (197) 화면이 부르는 API를 뒤 반복의 작업이 만들면 화면 작업에 `later_api`로 빼고 그 반복에 `only_api` 화면 작업을 둠(SCR-017·API-083, SCR-021·API-048). 그러지 않으면 자동 앞선 작업이 반복을 거꾸로 걸어 검사 13이 실패함. 같은 SPEC을 출처 맨 앞에 둔 서버 작업이 둘이면 `ac`로 수락 기준을 나눔. 스킬 결과 코드는 그 API와 SPEC을 함께 가진 작업이 받으므로 스킬 결과를 내는 작업의 `api`에 API-070\~073 가운데 해당 API를 둠(완성 표시 작업에 API-071이 빠져 검사 3이 잡았음). (198) build_wbs.py의 금지어 검사는 02·03 허용 꼴(ALLOW)과 08·09 옛 용어(`check_screens.OLD_TERMS`)를 쓰고 README 손글(생성 절·주소·코드 글자 제외)과 반복 설명까지 봄. 09 C9(`scan.py`)와 허용이 달라 따옴표 말 '입금했어요'는 C9가 잡으므로 새 글에는 도메인 용어(결제 확인 요청)를 씀. '까닭'·'흐름'·'저절로'·'피할 말'은 옛 용어(→ 이유·플로우·자동으로·금지어). (199) 허브 스냅숏 견줌의 기준: 10-wbs가 생겨 항목 731(task 169), 경고 32(이 가운데 'links no spec' 30개는 SPEC 행이 아닌 요구사항·열린 질문·결정·규칙에서 나온 작업이라 그대로 둠, README 7절). 다음 PR은 이 수와 견줌. (200) 공식 문서 주소가 옮겨 감: docs.anthropic.com/en/api/client-sdks → platform.claude.com/docs/en/cli-sdks-libraries/overview, cloud.google.com/run·sql/docs → docs.cloud.google.com/…. 사실을 적을 때 `curl -sS -L -w '%{url_effective}'`의 마지막 주소를 적고, 확인한 문자열을 grep으로 봄. (201) foreground `sleep`이 막혀 있으므로 백그라운드로 띄운 검사는 `timeout 900 tail --pid=<PID> -f /dev/null`로 기다림. 검사 결과 한 줄은 `prW/checks_line.py <출력 폴더> <요약 파일>`이 출력에서만 만듦. (202) 다음 번호: REQ-267, SPEC-080, 마이그레이션 0021, TBL-059, API-084, DEC-26, OPEN-13, 05 앱 규칙 A41·결정 E35, SCR-051, TERM-087, TASK-170, 규칙 (203).

## PR S — 기술 스택 제안, 로그인 유지 시간 DEC-26, 사장님·운영자 앱 형태 (2026-11-15)

[PR #51](https://github.com/kodonghui/siljang.ai/pull/51)을 squash로 합침(main `001c159`, 브랜치 reset·force-with-lease·`git branch -f main origin/main`). 고친 것: 10 tech-stack.md(새, 0\~10절), 06 DEC-26(OPEN-5 닫음), 02 REQ-267·268과 01·03·04 기록, WBS TASK-170\~181·반복 9, README 6·7·9절, progress.md 단락 셋. checks.sh 9개 모두 0(18:15 KST, 머리 `097d714`). Codex 의견 P2 하나(복구 시험 TASK-165가 TASK-175를 기다리지 않음)를 고치고 build_wbs만 다시 돌림, 스레드 해결. 보안 검토 의견 없음. 중간에 턴 한도로 멈춰 조정 세션이 WIP 커밋 `203066b`로 남은 변경을 저장했음. (203) checks.sh의 허브 경로는 `plugins/synced/*/corthex-nexus*/skills/corthex-hub/scripts/`(플러그인 폴더 이름이 바뀌어 glob으로 찾음). (204) 10단계 손글 문서(README·tech-stack.md·작업 글·반복 설명)는 build_wbs 검사 14가 금지어를 봄: '스케줄'(TERM-048 → 타이머·Cron 같은 고유 이름), '재고'(→ 다시 봄·재어 봄), 옛 용어 '부르지 않'(→ 호출하지 않), '푸시'(TERM-054·035 → 알림·앱 알림·웹 알림(Web Push)·Push Notifications 플러그인). 공식 문서의 말도 우리 글에서는 용어집 말로 옮김. (205) wbs_rows.py의 `finished='YYYY-MM-DD, 근거'`가 끝난 작업 표시이고, 끝난 작업의 앞선 작업도 모두 끝나야 함(검사 15). (206) Hyperdrive는 읽기 캐시가 기본으로 켜져 쓴 뒤 읽기가 옛 값을 볼 수 있어 우리 구성에서는 끔(tech-stack.md 3절·8-1). (207) PostgreSQL 17 시험: embedded-postgres의 17.x 바이너리를 `/var/lib/postgresql/pg17native`에 풀고 su postgres로 54330에 띄워 `check_erd.py --db`를 돌림, 끝나면 `pg_ctl ... stop`(이 PR 끝에 멈춤). PG16 54329는 checks.sh용으로 둠. (208) 새 REQ를 더할 때 같은 PR에서: 필수인데 SPEC이 없으면 04 spec.md AC-EXEMPT 표에 행(build_spec이 잡음), `build_spec.py . --write`로 REQ-MAP, 03 README 2절 표와 수·7절 부록(`check_flows.py --appendix` 출력대로), 02 0-2 결정 표·1-2 범위·버전 5 표·결정 반영 검사 표, 01 0-1과 3-8, 03·04 6절·8절 기록, 10 build_wbs 검사 11(SPEC 밖 유효 REQ마다 작업). (209) 시각은 `TZ=Asia/Seoul date`로 KST(컨테이너 date는 UTC, 검사 파일 시각도 UTC). (210) 동희님 말을 따옴표로 옮길 때 '어플'처럼 용어집에 없는 말은 그대로 둠(02·03·scan.py가 잡지 않음). '고객'처럼 금지어가 든 다른 글은 기록에 옮기지 않고 풀어 씀. (211) 추천안에 매인 작업(TASK-170\~175·179)에 기대는 스택 무관 작업(TASK-165)은 끝난 조건에 '스택을 다르게 고르면'을 적음. Codex는 PR을 연 뒤 3분쯤 코드 검토, 5분쯤 보안 검토를 마침(이번 PR). 고친 커밋을 올린 뒤 다시 도는지는 보지 않고 합침. (212) 다음 번호: REQ-269, SPEC-080, 마이그레이션 0021, TBL-059, API-084, DEC-27, OPEN-13, 05 앱 규칙 A41·결정 E35, SCR-051, TERM-087, TASK-182, 반복 10, 규칙 (213).
[PR #52](https://github.com/kodonghui/siljang.ai/pull/52)(R0a, 10단계 체크포인트 통과 기록)을 squash로 합침(main `6fd3d29`, 2026-11-15 18:47 KST, 브랜치 reset·force-with-lease·`git branch -f main origin/main`, 합친 트리가 머리 `d30025d`와 같음). 가지 커밋 e2a8d30(TASK-002 finished, README 상태·1·4·5·6·9-3·10절, tech-stack.md 상태·결정 줄, build_wbs.py 허용 꼴, project.json note, progress.md 단락)·d30025d(검사 결과와 PR 번호). checks.sh 9개 모두 0(18:41 KST, 머리 `e2a8d30`, 수는 PR #51과 같음). Codex 코드 검토 의견 없음·보안 검토 끝남(PR을 연 뒤 1\~2분). 합친 뒤 바로 SendMessage(to main) 'R0a 합침 6fd3d29…'. (213) build_wbs.py는 10 README 손글의 '확정'(TERM-011 수락의 금지어)을 잡음. 상태 줄은 '확정' 대신 '체크포인트 통과', 반영 열은 '정함'. 동희님 답을 말 그대로 옮긴 "확정하고 반복 0 시작 (추천)"만 README 허용 꼴(`r'"확정하고 반복 0 시작'`)로 더함. 허용 꼴은 앞뒤 12자 창 안에서 맞춰 보므로 긴 꼴(`\(추천\)"`까지)은 창을 넘어 맞지 않음. progress.md는 어느 검사도 읽지 않아 답을 그대로 둠. (214) 이 fork에서는 Agent(web-fetch) 호출이 '하위 에이전트 깊이 1' 제한으로 막힘. WebFetch 도구도 없어 공식 문서는 Bash curl로 받음(프록시 통과). developers.cloudflare.com(`…/index.md`)·platform.claude.com(`….md`)·developers.openai.com(`….md`)·kakaobusiness.gitbook.io(`….md`)는 마크다운 판이 있고, supabase.com·support.google.com은 HTML을 글로 바꿔 읽음(`scratchpad/tools/h2t.py`, 새 scratchpad). 다음 번호는 (212)와 같고 규칙만 (215)부터.

[PR #53](https://github.com/kodonghui/siljang.ai/pull/53)(R0b, 반복 0 안내서: 동희님 몫 10개의 차례와 하는 법)을 squash로 합침(main `2c8dd0a`, 2026-11-15 19:33 KST, 브랜치 reset·force-with-lease·`git branch -f main origin/main`, 합친 트리가 머리 `4658e0c`와 같음). 가지 커밋 f7fc6fe(안내서 초안)·2611048(build_wbs.py 안내서 검사, 안내서 고침, README 1·5·8절·9-3 링크, 7절 생성 절, project.json note)·804aa83(README 7절 결과 줄, progress.md 단락)·4658e0c(3절 토큰 문구). checks.sh 9개 모두 0(19:27\~19:32 KST, 머리 `2611048`, 01\~09 수는 PR #51과 같음), wbs 검사 17개 · 오류 0. 뒤 두 커밋은 기록과 문구라 build_wbs.py만 다시 돌림(17개 · 오류 0). Codex 코드 검토 의견 없음·보안 검토 끝남(2611048 기준, PR을 연 뒤 1\~3분). (215) 손으로 쓴 문서를 10단계에 더하면 build_wbs.py 금지어 검사(14)에 넣고(주소·백틱 뺌), 원본과 어긋날 수 있는 수·표·ID는 대조 검사로 묶음. 안내서 검사(16): 첫 반복의 남은 동희님 몫마다 4절 `### 4-n. TASK-xxx`와 `- ①`\~`- ⑥`, 1절 표 `| n | TASK-xxx `, 끝난 몫은 5절 표 `| TASK-xxx |`, 첫머리 '동희님인 작업 N개 가운데 끝난 M개 … 뺀 K개', 적힌 TASK·REQ·OPEN·DEC·API·TBL ID. 동희님 몫이 끝나면 wbs_rows.py finished와 함께 안내서 첫머리 수와 5절 표를 고쳐야 검사가 지남(4절 절은 남겨도 됨). 새 검사는 일부러 틀린 글(금지어, ④ 빼기, 수·표·절 ID 바꾸기)을 넣어 잡는지 보고 되돌림. 검사 수가 바뀌면 `--write`로 README 7절 생성 절을 다시 만들고 project.json note의 검사 수도 고침. (216) 다른 회사 화면의 이름은 백틱으로 감싸 금지어 검사에서 뺌(`챗봇 관리자센터`, `고객센터`). '칸'은 옛 용어(필드·셀·영역)라 '두는 곳', '비밀번호 관리자'는 '관리자'가 걸려 '비밀번호 관리 앱'. (217) 앞선 요약에 '확인함'으로 적힌 사실도 저장한 원문 글에서 다시 찾지 못하면 '확인 못 함'으로 둠. Cloudflare Zero Trust 무료 사용자 50명: 요금제 페이지(www.cloudflare.com/plans/zero-trust-services/)의 표가 스크립트로 그려져 내려받은 HTML에 숫자가 없음(2026-11-15 두 번 받음). 카카오 Event API의 '친구에게만'은 광고성 메시지의 조건이고, appUserId로는 개발 채널에 못 보냄. (218) Claude Code 클라우드 환경 문서(code.claude.com/docs/en/cloud-environments.md, 새 scratchpad web4/ccenv.md): Environment variables는 그 환경을 쓰는 누구나 읽고, 프록시가 붙일 수 있는 키는 Network secrets(Allowed websites·Custom headers, Pro·Max·Ultra·Team·Enterprise)를 권함. 이미 열린 세션은 VM이 다시 시작될 때(몇 분 쉰 뒤 다음 메시지) 새 값을 읽음. wrangler를 Network secret만으로 돌리는 길은 확인 못 함. (219) 이 fork의 Bash는 `sleep 60; cat …`처럼 긴 sleep 뒤 명령을 막음. 기다릴 때는 포그라운드 `until grep -q … ; do sleep 3; done`(timeout 지정) 한 번이나 run_in_background. 다음 번호는 (212)와 같고 규칙만 (220)부터.

[PR #54](https://github.com/kodonghui/siljang.ai/pull/54)(K8, 카카오 시험 서버와 시험 대본: TASK-008, 배포는 TASK-170 뒤)을 squash로 합침(main `8daf615`, 2026-11-15 20:54 KST, 브랜치 reset·force-with-lease·`git branch -f main origin/main`, 합친 트리가 머리 `699b51c`와 같음). 가지 커밋 6b0cd56(Worker·단위 시험)·1be265a(로컬 시험·deploy.sh·read-records.sh)·1bb28eb(대본·서버 README·검사 14·안내서 링크)·d7ffbc0(사진은 카카오 쪽 호스트만, 로컬 시험 정리)·0dc6692(로그인 표·서명 state·키 없이 닿는 기록 한도)·686a7d7(progress.md·10 README 결과 줄)·b92b4d2(Codex P2: PKCE 판단)·032edb4(턴 한도로 조정 세션이 WIP 저장한 K-02 코드)·a4fe23c(K-02 기록과 수)·699b51c(checks 머리). checks.sh 9개 모두 0(20:49\~20:54 KST, 머리 `a4fe23c`, 01\~09 수는 PR #51과 같음. 20:14 `1bb28eb`·20:31 `0dc6692`에서도 0), 699b51c는 build_wbs.py만(17개 · 오류 0). 단위 시험 41개, 로컬 시험 50개(1분 40초). Codex 코드 검토 P2 둘(0dc6692의 PKCE 판단, b92b4d2의 K-02 2초 묶음)을 고치고 스레드를 해결로 표시, a4fe23c의 코드·보안 검토는 지적 없음. 배포·Notion·Artifact·Miro·GitHub 댓글 없음. (220) Node 22의 타입 지우기로 `node --test test/*.test.ts`를 돌리려면 import에 `.ts`를 붙이고(tsconfig `allowImportingTsExtensions`·`verbatimModuleSyntax`·noEmit), enum·namespace·매개변수 속성처럼 지울 수 없는 TS 문법을 쓰지 않음. (221) wrangler 4의 `kv key list/get`은 `--local`이나 `--remote`를 꼭 줌. 로컬 KV는 dev와 같은 `--persist-to`로, dev를 멈춘 뒤 읽음. `wrangler dev --local`(Miniflare)은 큐 `delaySeconds`와 127.0.0.1로의 fetch가 되어 계정 없이 콜백·사진 받기를 가짜 서버로 시험할 수 있음. 비밀 값 대신 `--var KEY:VALUE`로 무작위 시험 키를 넣음. (222) `npx wrangler dev`의 PID만 kill하면 자식(cli.js·workerd)이 남아 포트를 붙잡고, 다음 시험이 옛 서버(옛 키)에 붙어 모두 401이 됨(35개 FAIL). 자식까지 멈추는 killtree(`pgrep -P`), 시작 전 포트가 비었는지 확인, INT·TERM 트랩을 둠. 실패가 한꺼번에 같은 꼴(401)이면 먼저 남은 프로세스(`ps`, 포트)를 봄. (223) 대화창 글의 주소로 서버가 요청하는 기능은 허용 호스트(카카오 쪽 도메인)만 받고, 리다이렉트는 `redirect: "manual"`로 직접 따라가며 호스트마다 다시 확인(SSRF). 키 없이 닿는 경로는 HMAC 표(`/login/start`), 서버가 서명한 state(`/login/callback`), 인스턴스당 기록 한도(키 틀린 `/skill`·오류)로 KV 쓰기와 REST API 키 노출을 막음. 카카오 REST API 키는 로그인 인가 주소의 `client_id`로 드러나는 값이면서 Event API `KakaoAK` 인증에도 쓰임. (224) 시험 판정은 실패를 한 가지로 묶지 않음. PKCE 검사 여부는 RFC 7636 4.6의 `invalid_grant`(4xx)만 거절로 보고, 서버 오류·다른 OAuth 오류·보내기 실패는 '알 수 없음'으로 두어 판단하지 않음(Codex P2). (225) 시각을 묶음 번호로 내린 키(floor(ms/2000))는 '2초 안이면 같음'이 아님. 경계에 걸치면 몇 ms 차이로도 다름. 대본의 기대 결과는 묶음 번호와 시각을 뺀 키로 적음(Codex P2). (226) build_wbs 검사 14: 카카오 화면 이름 '채널 커스텀 유효성 테스트'의 '커스텀'은 TERM-038의 금지어라 백틱으로 감쌈. 옛 용어 '보낸 쪽'은 '출처', '저절로'·'칸'은 쓰지 않음(코드 주석·시험 이름도 맞춤). UUID의 꼴은 하이픈 때문에 b64url로 나옴. (227) 카카오 문서(2026-11-15 다시 봄): 콜백은 5분·한 번(조정 세션 지시의 '1분'과 달라 문서를 따르고 보고함), 테스트 환경(`봇테스트`·`채널 커스텀 유효성 테스트`)의 콜백 토큰은 'Invalid callback token for testing purposes.', Event API는 설정 뒤 배포해야 보냄, 배포는 시작하면 못 멈추고 최대 30분. 그래서 K-05·K-10은 봇 배포가 들 수 있고 그때 확인 요청. (228) PR에 새 커밋을 올리면 Codex 코드·보안 검토가 'New commits'로 다시 돎(코드 약 3분, 보안 약 5\~7분). 고친 커밋을 올린 뒤 그 머리의 검토가 끝나고 지적이 없을 때 합침. 기록만 바꾼 마지막 커밋은 기다리지 않음. 다음 규칙 번호는 (229)부터.

[PR #55](https://github.com/kodonghui/siljang.ai/pull/55)(L, 법령 원문 다시 확인: TASK-012)을 squash로 합침(main `c0ab1d9`, 2026-11-15 21:08 KST, 브랜치 reset·force-with-lease·`git branch -f main origin/main`, 합친 트리가 머리 `35e8053`와 같음). 가지 커밋 04b3d59(02·05 고칠 글 a\~m, 02 상태 줄 한 문장과 13절)·7b2bfd0(TASK-012 finished, `build_wbs.py . --write`로 끝난 작업 4개, 반복 0 안내서 1절 표·2-1 그림·4-10 ②)·35e8053(progress.md 21:00 무렵 단락, 10 README 7절 결과 줄). 조사는 main `6fd3d29` 기준이고 원문은 19:12\~19:24 KST에 받음(새 scratchpad `law012/`의 raw·tools·result.md). 02와 05 README는 8daf615까지 바뀌지 않아 old 글이 그대로 한 번씩 있었음. 조문 36개(11개 판)에서 어긋난 인용 0, 빠진 조건 2곳(5-2 질문 3의 '취소 피해가 큰 곳', REQ-201의 '또는 제17조②'), 낡은 메모 10곳(02 7, 05 README 3). checks.sh 9개 모두 0(21:01\~21:06 KST, 머리 `7b2bfd0`, 01\~09 수는 PR #51과 같음), 35e8053은 build_wbs.py만(17개 · 오류 0). Codex 코드 검토 지적 없음·보안 검토 끝남(7b2bfd0, PR을 연 뒤 1\~2분). 조정 세션 지시의 차례(3 기록 → 4 검사)와 달리 검사를 먼저 돌리고 PR을 연 뒤 기록 커밋을 올림(결과 줄에 검사 결과와 PR 번호가 들어가서). 지시 목록 밖으로 반복 0 안내서의 TASK-013 차례 세 곳을 고침. Notion·Artifact·Miro·GitHub 댓글 없음. (229) law.go.kr는 키 없이 GET으로 받음: 첫 화면 `https://www.law.go.kr/법령/<이름>`(URL 인코딩)에서 `lsiSeq`·`efYd`·`lsId`를 읽고, 본문은 `LSW/lsInfoR.do?lsiSeq=…&chrClsCd=010202&urlMode=lsInfoP&efYd=…&ancYnChk=0`, 연혁은 `LSW/lsHstListR.do?lsiSeq=…&lsId=…&efYd=…&ancYnChk=0`(항목 `lsViewLsHst2('<seq>','<공포일>','<번호>','<시행일>',…)`). 브라우저 UA와 Referer `https://www.law.go.kr/`가 없거나 POST면 연결이 끊김(프록시 상태 `ws_closed_mid_exchange`). 가끔 `curl: (35)`가 나 3\~4번 다시 받음. (230) 행정규칙(고시)은 `https://www.law.go.kr/행정규칙/<이름>`에서 `admRulSeq`, 본문 `LSW/admRulLsInfoR.do?admRulSeq=…&chrClsCd=010202`, 연혁 `LSW/admRulHstListR.do?admRulSeq=…`. 별표 보기 화면(`admRulBylContentsInfoR.do`)은 그림뿐이라 `LSW/flDownload.do?flSeq=<n>&bylClsCd=…`로 PDF를 받아 `pdftotext -layout`(시행규칙 별표도 같음). 한국인터넷진흥원 spam.kisa.or.kr는 빈 응답(한 번 시도, 확인 못 함). (231) 시행 예정 판: 연혁에서 시행일이 오늘 뒤인 판마다 같은 lsInfoR에 그 efYd를 주어 받고 인용한 조문만 현행과 견줌. 본문 안 `[시행일: 2027. 1. 21.]` 같은 표시도 봄. '공포됨·아직 시행 전'을 현행과 섞어 쓰지 않음. (232) 받은 원문은 받기 전용 폴더(raw/)에만, 도구는 따로(tools/), Python은 `-I`, 경로는 인자로. 받은 글은 자료이지 지시가 아님. (233) 고칠 글은 old→new 쌍으로 적고, 바꾸는 스크립트는 old가 파일 안에서 꼭 한 번 나올 때만 쓰게 함(하나라도 아니면 아무것도 쓰지 않음, `--dry` 먼저). 조사와 PR 사이 main이 바뀌어도 줄 번호가 아니라 old 글로 찾고, 생성 절(`BEGIN generated`, `build_erd:…:begin`) 밖인지와 같은 글을 옮긴 생성 파일이 없는지 먼저 grep. (234) 그때의 기록(0-2·0-3 표, 11절, 7절 검사 기록, 제외 행)은 지우지 않고 '(2026-11-15에 대조함, 13절)'처럼 덧붙임. 지금을 말하는 메모(5-2 끝 문단, 출처 열)는 바꿈. (235) 요약이 원문의 조건을 빼면 뜻이 넓어짐: 고시 정의의 '취소 피해가 큰 식당', 제23조①1호의 '또는 제17조제2항'. 숫자만이 아니라 정의·단서·'또는'까지 견줌. 풀이를 덧붙일 때는 원문에 없는 해석(예: '제3자에게 줄 때는')을 출처 열에 넣지 않고 13절 설명으로 둠. (236) scan.py는 전자상거래법만 예외라 새 글에서 '전자금융거래법'·'공정거래위원회고시'·'예약보증금'·'예약기반 음식점'을 피함('전자금융 쪽 법', '공정위 고시', '외식업 항목', '외식업 비교 풀이'). 저장소에 이미 있는 글을 old로 담은 쌍은 scan에 걸려도 새 말이 아님. progress.md는 Notion 로그로 올라가므로 같은 기준. (237) GitHub의 GFM은 물결표(\~) 하나로도 취소선을 만들 수 있어, 새 글의 한 문단에는 범위 물결표를 하나만 두고 나머지는 '부터 … 까지'로 씀. (238) 10 README 7절 결과 줄과 progress.md 단락에는 checks.sh 결과와 PR 번호가 들어가므로, 내용 커밋 뒤 검사를 돌리는 동안 PR을 열어(Codex가 함께 돎) 검사가 끝나면 기록 커밋을 올리고 PR 본문의 검사 절을 고침. 다음 규칙 번호는 (239)부터.

[PR #56](https://github.com/kodonghui/siljang.ai/pull/56)(L, 법률 질문 문서: TASK-013 준비)을 squash로 합침(main `a115743`, 2026-11-15 22:00 KST, 브랜치 reset·force-with-lease·`git branch -f main origin/main`, 합친 트리가 머리 `ab369c5`와 같음, 브랜치 upstream은 `git branch -u origin/claude/serene-dijkstra-6edbbk`로 되돌림). 가지 커밋 fad286b(문서, build_wbs.py 검사 14·17, README 7절 생성 절, project.json)·5029cd4(안내서 1절 10행·4-10 ②③⑥, 10 README 1·5·8절, progress.md 단락)·6605a55(0절 한 문단의 물결표 둘)·f118c41(인용 속 호 번호 이스케이프)·d85c77a(progress.md PR 링크·검사 줄, README 7절 결과 줄)·36522b3(Codex P2: 대화에 스스로 적은 알레르기 말, 질문 4를 차례 6으로, 안내서 ⑥)·ab369c5(기록을 마지막 내용 머리로). checks.sh 9개 모두 0(21:54\~21:59 KST, 머리 `36522b3`, 01\~09 수는 PR #51과 같음. 21:40 `5029cd4`, 21:45 `f118c41`에서도 0), ab369c5는 build_wbs.py만(18개 · 오류 0). Codex 코드 검토: f118c41에 P2 하나(질문 5의 '알레르기 답은 보내지 않습니다'가 대화 속 알레르기 말을 빠뜨림), 36522b3에서 고치고 스레드를 해결로 표시, 36522b3의 코드 검토 지적 없음·보안 검토 끝남. 차례 2, 1, 5, 8, 3, 4, 11, 12, 7, 9, 6, 10, 13(1부터 6까지 출시 전 권함). PDF는 새 scratchpad `legal/legal-questions-2026-11-15.pdf`(A4 16쪽), 원본 html을 main의 문서에서 다시 뽑아 cmp로 같음을 확인. Notion·Artifact·Miro·GitHub 댓글·외부 전송 없음. (239) build_wbs.py `banned(label, text, allow_more)`의 문서별 허용 꼴은 ALLOW에 없는 말에도 들어야 함: `pats = ALLOW.get(w, []) + (allow_more or {}).get(w, [])`, `if pats and any(...)`. 법률 질문 문서는 LAW_NAMES로 '거래'를 전자상거래·전자금융거래·공정거래위원회 안에서만 허용. 전문가에게 보낼 글이라 법령·기관의 정식 이름을 그대로 두며, scan.py로 훑으면 인용 밖에서 그 4곳(공정거래위원회 3, 전자금융거래법 1)과 전자상거래법이 걸리는 것이 정상. progress.md·README처럼 Notion으로 갈 글에는 (236)을 그대로 적용('공정위', '전자금융 쪽 법'). (240) 조문 원문은 `>` 인용 상자에 두고 금지어 검사에서 인용 줄을 뺌(`re.sub(r"(?m)^\s*>.*$", " ", …)`). 인용 속 '2. …', '10. …' 같은 호 번호는 마크다운 번호 목록이 되어 1부터 다시 매겨지므로 `2\.`처럼 이스케이프하고 호마다 빈 `>` 줄로 문단을 나눔(나누지 않으면 한 문단으로 붙음). `pandoc -f gfm -t html5`로 인용 안에 `<ol>`이 없는지 확인. (241) 새 손글의 금지어 함정: '엄격한 쪽'은 OLD_TERM '한 쪽'에, '부르지 않'과 '피할 말'(→ 금지어)도 OLD_TERM에 걸림. '약관 동의', '가격 안내', '금액 계산', 'AI 판단', '상담원', '유예'는 용어집 금지어. 따옴표로 '거래'라는 말 자체를 적는 것도 걸림. (242) 외부 전문가용 문서의 사실은 설계의 예외까지 적음: '알레르기 답은 AI에 보내지 않음'이 맞는 것은 전용 입력의 답뿐이고, 손님이 대화에 스스로 적은 말은 대화라 AI로 감(REQ-204 출처 열, SPEC-020 예외 줄). 쓰기 전에 그 주제의 REQ 출처 열과 SPEC 예외 줄을 grep. 예외 때문에 잠정안이 더 엄격하지 않게 되면 2절의 차례와 분류도 함께 고침(질문 4를 11에서 6으로, 안내서 ⑥과 진행 기록도). (243) PDF: pandoc gfm → html5 본문, Node Playwright(`chromium.launch()` 옵션 없음)가 인쇄 CSS와 file:// 나눔고딕 @font-face를 씌워 `page.pdf`(A4, preferCSSPageSize, 바닥글은 ASCII만). 나눔고딕에는 ①\~⑥·Ⅱ·業이 없어 WenQuanYi Zen Hei로 대신 그려짐(fc-query charset, pdffonts로 확인). 8자 이하 표 셀은 nowrap, `p > strong:only-child`는 글자 형제가 있으면 inline(:only-child는 요소만 셈). 확인은 pdfinfo 쪽 수, pdftotext로 쪽마다 질문 위치, pdftoppm -r 72 쪽 이미지와 deviceScaleFactor 1 화면을 직접 봄. 내용이 바뀌면 다시 만들고, 합친 뒤 main의 문서에서 원본 html을 다시 뽑아 cmp. (244) checks.sh가 도는 동안이나 PR을 연 뒤 내용을 고치면 마지막 내용 머리에서 다시 돌리고, 결과 줄·진행 기록·PR 본문의 머리와 시각을 그 실행으로 바꿈(앞선 실행은 '…에서도 0'으로 남김). 커밋 전 `grep -n "~"`로 한 문단의 물결표 둘을 찾음((237)의 재발). 다음 규칙 번호는 (245)부터.

[PR #57](https://github.com/kodonghui/siljang.ai/pull/57)(chore, 단계 검사 실행기와 작업 규칙 기록을 저장소로)을 squash로 합침(main `d24f430`, 2026-11-15 22:35 KST 무렵, 브랜치 reset·force-with-lease·`git branch -f main origin/main`, 합친 트리는 브랜치 마지막 커밋 `b092cb0`과 같음). 더한 것: `tools/stage-checks.sh`(scratchpad `checks.sh`의 사본. 저장소 뿌리를 스크립트 위치로 찾고, 출력은 `${STAGE_CHECKS_OUT:-${TMPDIR:-/tmp}/stage-checks}/<이름>`, `--no-api`), `docs/records/fix-log.md`(규칙 (1)\~(244), 이제 원본). Codex P2(prd·flows 검사기가 문제가 있어도 종료 코드 0)를 `0c60627`에서 고치고 스레드를 해결로 표시, `0c60627` 재검토 지적 없음. `prA2`(22:25, 머리 `0c60627`) 검사 9개 모두 0. (245) prd·flows 검사기(check_prd.py·check_flows.py)는 문제가 있어도 종료 코드가 0이고 `PROBLEMS (n)`·`AVOIDED WORDS (n)`만 찍음. 실행기는 두 수를 읽어 0이 아니면 그 줄에 '실패'를 붙이고 끝 상태 1. 검사 도구를 옮기거나 고치면 일부러 깨뜨린 사본(임시 작업 트리)에서 실패가 실패로 나오는지 봄. (246) 작업 규칙은 이 파일 끝에 다음 번호로 더함(scratchpad 사본은 더 쓰지 않음). 커밋 전에 모델 이름, 토큰·키 꼴(`node tools/check-no-keys.mjs --repo`), 메일 주소, 계정·세션 ID 꼴, 서버 주소를 찾고, 코드 밖 물결표는 `\~`로 적음.

[PR #58](https://github.com/kodonghui/siljang.ai/pull/58)(TASK-015 개발 저장소 뼈대, REQ-135, 11단계 시작). 합친 커밋은 다음 단락에 적음. 더한 것: `app/`(npm workspaces, server는 Workers의 Hono, web은 React·Vite, 설계 메모 `app/README.md`), `tools/check-no-keys.mjs`, `.github/workflows/app.yml`, `.corthex/project.json`의 `11-development`, TASK-015 끝남 표시(GitHub Actions run 43721029115·43721343956 성공 뒤). Codex P2(JSON처럼 따옴표 친 이름 뒤의 키 값을 놓침)를 `b616486`에서 고치고 스레드를 해결로 표시. (247) Node 22에 딸린 npm 10.9는 vitest 4.1과 vite 8을 처음 풀 때 `Cannot read properties of null (reading 'edgesOut')`(arborist `#loadPeerSet`)로 멈춤. vite 8의 선택 피어 `@vitejs/devtools`를 따라가면 `@vitejs/devtools-vitest`의 피어 `vitest@*`가 5.x로 풀려 4.1과 부딪힘. vitest 5.1.0으로 바꾸면 npm 10으로 풀림. `legacy-peer-deps`는 쓰지 않음. npm 11.21.2는 풀지만 허용 목록 없이는 install 스크립트(esbuild·workerd)를 돌리지 않음. vitest-pool-workers 0.23.0은 아직 vitest 4.1만 받으므로 Workers 런타임 시험은 TASK-171·173에서 정함. (248) lockfile은 `npm install --before=2026-11-08T00:00:00Z`로 만듦(전이 의존성까지 나온 지 일주일 넘은 판). package.json은 정확한 판, CI는 `npm ci`. `npm ls vite`로 vite가 하나(deduped)인지 봄(vitest 4일 때는 8.3.8을 따로 끌어왔음). (249) 서버 타입: src는 `wrangler types --include-env=false src/worker-runtime.d.ts`가 만드는 Workers 런타임 형식만 봄(`types: []`, 625KB, 무시 목록, typecheck가 매번 만듦). 시험은 `tsconfig.test.json`(include는 test/**와 vitest.config.ts만, `types: ["node"]`)이라 런타임 형식과 Node 형식이 한 프로그램에서 겹치지 않음. nodejs_compat을 켜면 wrangler가 @types/node를 요구하므로 데이터베이스 드라이버를 붙이는 TASK-171·173까지 끔. 타입 검사가 잡는지 틀린 파일(형식 오류, src의 `node:fs` import)을 잠깐 넣어 봄. (250) Hono의 Bindings는 `interface`가 아니라 `type`으로 씀. interface에는 암묵적 색인 서명이 없어 `Readonly<Record<string, unknown>>` 인자에 넘길 수 없음. settings의 `AppEnv`와 겹치지 않게 Hono 환경 형식은 `HonoEnv`. (251) Biome 2.6에서 `linter.rules.recommended`는 낡은 꼴(`biome ci`가 정보로 알림)이라 `npx biome migrate --write`로 `"preset": "recommended"`. Python으로 쓴 JSON은 `npx biome check --write .`로 형식을 맞춘 뒤 `biome ci`. Biome는 app/ 안만 봄. (252) GitHub Actions의 run은 `shell: bash`를 적어야 `-e -o pipefail`로 돎(적지 않으면 `bash -e`뿐이라 `명령 | tee 로그`가 실패를 삼킴). `defaults.run`에 shell과 working-directory를 둠. 액션은 커밋 SHA로 고정하고 태그를 주석으로, `permissions: contents: read`, checkout은 `persist-credentials: false`, 작업에 비밀 값을 넘기지 않음. 이 세션의 토큰으로 `.github/workflows/*` push가 받아들여짐(2026-11-15). (253) 키 검사기는 찾은 값을 찍지 않고 '파일:줄: 꼴 이름'만 씀. 시험과 자체 시험의 가짜 키는 실행 중에 이어 붙여 만들어(`sk-${"ant"}-…`) 저장소 글에 키 꼴이 없음. 없는 파일·인자 없음은 끝 상태 2(CI에서 glob이 깨지면 실패). 이름 넣기 꼴은 따옴표 친 이름·대소문자·이중 JSON까지 받고, 코드의 이름 참조(`env.X`)와 example·fake 같은 예시 값은 뺌. 꼴을 넓히면 먼저 `--repo`로 저장소에서 새로 걸리는 줄을 봄(이번에 4줄: 06 예시 비밀번호 2, 카카오 시험 서버의 env 참조 1·가짜 토큰 1, 모두 빼는 꼴에 듦). (254) Worker 확인은 `timeout 60 npx wrangler dev --port 8787 --ip 127.0.0.1`을 뒤에서 띄우고 curl로 `/api/healthz`, 없는 `/api/…`(404 Problem), 화면 주소를 본 뒤 pkill. 화면 주소의 SPA index.html은 `Sec-Fetch-Mode: navigate` 헤더가 있어야 나옴. (255) 글에 적는 TASK 번호는 wbs_rows.py에서 grep으로 확인함. 키 없는 AI 일의 `ai_unavailable`은 TASK-026(모델 호출 한 곳)인데 처음에 TASK-024(접속기록)로 적었음. (256) 시험 이름에도 금지어를 쓰지 않음('빈 칸' → '공백만'). (257) TASK 끝남 표시는 PR에서 GitHub Actions가 실제로 성공한 뒤에만 적음(check run의 conclusion과 작업 로그 끝의 시험 수까지 봄). 표시 전에 고침 커밋이 있으면 그 커밋의 성공도 봄. (258) 단계 검사는 작업 트리를 읽음. 커밋하지 않은 고침이 있으면 결과 줄의 머리 SHA와 내용이 다르므로, 기록에 적는 실행은 고침을 커밋한 뒤의 머리에서 다시 돌림. 다음 규칙 번호는 (259)부터.

[PR #58](https://github.com/kodonghui/siljang.ai/pull/58)을 squash로 합침(main `1b1c17b`, 2026-11-15 23:04 KST 무렵, 브랜치 reset·force-with-lease·`git branch -f main origin/main`). 합친 뒤 main에서 돈 run 43722314812(app) 성공. [PR #59](https://github.com/kodonghui/siljang.ai/pull/59)(TASK-017 마이그레이션 20개와 규칙 테스트를 CI에서, 04 공통 규칙 G3). 합친 커밋은 다음 단락에 적음. 더한 것: `.github/workflows/db.yml`(PostgreSQL 16.15 서비스 컨테이너에서 마이그레이션 → 규칙 테스트 → `check_erd.py` → 로그 키 검사), `tools/db-migrate.sh`, `tools/db-rule-tests.sh`, `db/README.md`, `check_erd.py` D5의 입력 처리, WBS 옮김(TASK-017의 '스테이징에도 같은 버전' → TASK-174, 10 README 10절), TASK-017 끝남 표시(db run 43723637548 성공 뒤, 표시한 `644ed41`의 run 43724159123·43724159146도 성공). Codex 코드·보안 검토는 `fdc2820`에서 지적 없음. `d2b`(23:24, 머리 `644ed41`) 검사 9개 모두 0. (259) GitHub ubuntu-24.04 러너의 python3는 3.12(2026-11-15에 3.12.3)이고 로컬은 3.13. `Popen`의 stdin을 직접 닫은 뒤 `communicate()`를 부르면 3.12는 닫힌 stdin을 flush하다 `ValueError: I/O operation on closed file`로 멈춤(3.13은 넘어감). 다 쓴 뒤 `flush()`만 하고 닫기는 `communicate()`에 맡김(psql은 줄마다 바로 돌림). 검사 도구를 CI로 옮기면 먼저 로컬의 `python3.12`로 돌려 봄. (260) CI의 PostgreSQL은 서비스 컨테이너로 띄우고 공식 이미지의 정확한 부 버전 태그와 index digest를 함께 적음. digest는 hub.docker.com 태그 API의 `digest`와 registry HEAD의 `docker-content-digest`(OCI image index)가 같은지 보고, 태그의 `last_updated`로 나온 지 일주일 넘은 이미지를 고름((248)과 같은 기준). 러너의 psql은 그대로 씀. `POSTGRES_HOST_AUTH_METHOD: trust`는 그 작업 안의 시험 서버에만 쓰고 주석에 '시험용, 비밀 값 아님'을 적음. (261) `tools/db-migrate.sh`는 적용한 판을 남기지 않으므로 빈 데이터베이스에만 씀(public에 테이블이 있으면 끝 상태 2). 번호가 0001부터 빈틈없이 이어지는지 먼저 봄. `check_erd.py` D2는 실패해도 뒤 파일을 계속 적용해 오류를 모으므로, '실패하면 그 파일에서 멈춤'은 실행기가 따로 맡음. 판을 남기며 이어서 적용하는 방법은 스테이징이 생기는 TASK-174에서 정함. (262) 검사를 깨뜨려 볼 때는 그 검사가 실제로 보는 것을 고름. 규칙 테스트는 `rule_tests.sql`의 `expect_fail('…', '<제약>'` 줄에서 제약 이름을 grep해 지움. 기대 목록에 없는 제약(`orders_cancel_chk`)을 지우면 324개가 그대로 지나 깨뜨린 것이 아님. (263) 체크포인트를 지난 뒤 끝난 조건을 다른 작업으로 옮기면 10 README 10절 표(날짜·고친 것·이유와 근거·PR)에 한 행을 더하고, 옮겨 받는 작업의 끝난 조건에 '(날짜 TASK-xxx에서 옮김)'을 붙임. 작업 수·크기 합이 그대로인지 build_wbs 첫 줄로 봄. 표에 적을 PR 번호는 PR을 열기 전에 list_pull_requests·list_issues의 마지막 번호로 미리 봄(이슈가 없으면 마지막 PR 번호 + 1). (264) `get_job_logs`의 tail_lines는 끝에서부터 셈. 서비스 컨테이너가 있는 작업은 끝에 컨테이너 로그가 100줄 넘게 붙으므로, 앞 단계의 줄(판·마이그레이션)을 보려면 tail_lines를 넉넉히(이번에 185줄) 줌. 다음 규칙 번호는 (265)부터.

[PR #59](https://github.com/kodonghui/siljang.ai/pull/59)를 squash로 합침(main `493f7da`, 2026-11-15 23:32 KST 무렵, 브랜치 reset·force-with-lease·`git branch -f main origin/main`). 합친 뒤 main에서 돈 run 43724907189(app)·43724907195(db) 성공. [PR #60](https://github.com/kodonghui/siljang.ai/pull/60)(TASK-018 공통 요청 처리, 04 공통 규칙 G2·G6·G8·G9, 05 TBL-050·051, 06 DEC-02·DEC-04). 합친 커밋은 다음 단락에 적음. 더한 것: `app/server/src/`의 `db.ts`·`request-key.ts`·`time.ts`·`confirm-card.ts`·`ops-events.ts`·`body.ts`·`types/pg.d.ts`(새)와 `problem.ts`·`app.ts`·`log.ts`·`settings.ts`(고침), 시험 5파일과 `test/support/db.ts`, `.github/workflows/app.yml`의 PostgreSQL 서비스와 마이그레이션 단계, `app/README.md` 4·5·7·12·13 고침과 14\~17, 의존성 `pg` 8.23.1·`ajv` 8.20.0·`ajv-formats` 3.0.1, TASK-018 끝남 표시(app run 43727657069·43728118926 성공 뒤, 세 번째 고침 뒤 끝남 글의 서버 시험 수를 155개로 `61dca20`). Codex 코드 검토 P2 둘(본문 한도를 다 읽은 뒤에 셈, 동시 트랜잭션 둘이 한 트랜잭션으로 섞임)을 `0bf936c`에서, 뒤에 낸 세 번째 P2(UTC보다 앞선 시간대에서 두 번 있는 시각이 뒤의 것으로 나옴)를 `99c1d4e`에서 고치고 세 스레드를 해결로 표시, 보안 검토 지적 없음. `d3b`(00:09, 머리 `95ef74a`)와 `d3c`(00:22, 머리 `61dca20`) 검사 9개 모두 0. (265) Workers의 호환 날짜가 2026-08-04 이후면 `nodejs_compat`·`nodejs_compat_v2`가 기본으로 켜짐(Cloudflare Hyperdrive 'Connect to PostgreSQL' 문서, 2026-10-23 고침, 2026-11-15 확인). (249)의 '드라이버를 붙이는 TASK-171·173까지 끔'은 호환 날짜 2026-11-01에서는 맞지 않았음. 호환 플래그를 더하거나 미루기 전에 그 호환 날짜의 기본값을 문서에서 봄. pg를 묶은 뒤에도 `wrangler types --include-env=false`와 typecheck가 그대로 지남. (266) 드라이버는 Hyperdrive 문서가 '권함'으로 적은 것을 고르고, 문서의 고친 날짜와 확인 날짜를 함께 적음. `@types/pg`는 Node 형식을 끌고 와 src의 Workers 형식만 보는 typecheck((249))를 깨므로, 쓰는 부분만 적은 `src/types/pg.d.ts`를 두고 시험 tsconfig의 include에도 넣음. pg의 다른 API를 쓰면 이 파일에 더함. (267) pg는 `date`(OID 1082)·`timestamp`(1114)를 프로세스 시간대로 JS Date로 바꾸므로, 글 그대로 받는 파서를 Client의 `types`로 줌(전역 `types.setTypeParser`는 쓰지 않음). `timestamptz`는 절대 시각이라 Date 그대로. (268) 요청 키의 '내 처리' 표시는 `processing_expires_at::text`(마이크로초까지)를 표로 쓰고, 끝남·지우기는 `processing_expires_at = $표::timestamptz` 조건이며 0행이면 자기 트랜잭션을 되돌림. 이어받기 시험에서 남이 가진 행의 기한을 손으로 바꾸면 그 요청의 표가 무효가 되어 다른 길을 시험하게 되므로, 기한이 지난 처리 중 행을 지문과 함께 직접 넣어(가진 요청 없음) 시험함. (269) 데이터베이스 시험은 `TEST_DATABASE_URL`이 없으면 로컬에서 건너뛰고, CI는 `REQUIRE_DATABASE_TESTS=1`로 건너뛰지 않고 실패하게 함. 바꾸면 세 경우(있음·없음·없음과 `REQUIRE_DATABASE_TESTS=1`)를 다 돌려 봄. 환경 변수 이름에도 금지어를 넣지 않음. 데이터베이스 시험이 실제로 돌았는지는 CI 작업 로그 끝의 파일별 시험 수로 봄. (270) Workers 런타임 확인은 `wrangler dev <임시 스크립트> --var 이름:값`으로 띄워 로컬 PostgreSQL에 직접 붙여 봄(Hyperdrive 없음, 비밀번호 없는 로컬 시험 서버만). 임시 스크립트는 확인 뒤 지우고 wrangler 프로세스가 남지 않았는지 봄. (271) 시각 시험의 기대값은 손으로 따로 셈하고, 경계(남은 시간 = 그날 남은 시간)는 양쪽(+90분·+91분)을 둠. 처음에 13:30 + 90분(답하는 시간 13:00\~14:00)을 다음 날 13:00으로 잘못 적어 시험이 틀렸음(코드가 맞고 다음 날 14:00). (272) 06 오류 목록은 손으로 쓴 목록이라 계약과 같은지 시험이 봄(코드 이름·상태·말, 필드 사유, 확인 종류). 응답 모양은 Ajv 2020에 계약 전체를 `addSchema(contract, "openapi")`로 넣고 `openapi#/components/schemas/Problem`으로 검사. `ajv-formats`는 ESM에서 `addFormats(ajv)`로 부름(`.default`가 아님). (273) 공통 층의 한도와 잠금은 '다 받은 뒤'가 아니라 '받는 동안' 지킴. 본문 한도는 스트림을 읽으며 세고 넘으면 cancel(Content-Length는 앞에서 한 번 더), 공유 자원의 표시(트랜잭션 중)는 await 전에 세우고 실패하면 거둠. 동시성을 고칠 때는 고치기 전 코드에서 실패하는 시험(`Promise.allSettled`로 둘을 동시에)을 먼저 만들어 봄. (274) PostgreSQL 기본 로그 설정은 제약 위반의 DETAIL에 넣은 행의 값을 서버 로그에 남김(GitHub Actions가 작업 로그 끝에 서비스 컨테이너 로그를 붙여 시험 값이 보임). 앱의 응답·로그(G6)와는 별개이고, CI의 로그 키 검사는 `ci-logs/*.log`만 봄. 운영 데이터베이스의 로그 설정은 TASK-174 때 함께 보도록 넘김(작업 행은 바꾸지 않음). (275) 벽시계 → UTC 바꾸기는 처음 어림한 시차 하나에서 시작하지 않고, 벽시계 값의 하루 앞·뒤 시차 둘로 후보를 만들어 다시 같은 벽시계가 되는 것 중 가장 이른 것을 고름(맞는 것이 없으면 없는 시각이라 경계 앞의 시차로 셈). 처음 어림에서 시작하면 UTC보다 앞선 시간대(베를린·시드니)에서 어림이 이미 경계 뒤의 시차를 집어 두 번 있는 시각의 뒤의 것이 나왔음(뉴욕만 시험해 못 봄). 서머타임 시험은 UTC보다 앞선 곳·뒤진 곳·30분만 바뀌는 곳(로드하우)을 함께 두고, 손으로 센 값과 반대쪽 바꾸기(toShopLocal)로 만든 '가장 이른 시각' 둘 다로 봄. 다음 규칙 번호는 (276)부터.

[PR #60](https://github.com/kodonghui/siljang.ai/pull/60)을 squash로 합침(main `a5b66cf`, 2026-11-16 00:33 KST 무렵, 브랜치 reset·force-with-lease·`git branch -f main origin/main`). 합친 뒤 main에서 돈 run 43730539920(app)·43730539917(db) 성공. [PR #61](https://github.com/kodonghui/siljang.ai/pull/61)(TASK-019 가게별 기록 나누기, 04 SPEC-068 수락 기준 1·2·G1, 05 A9·E1, 06 DEC-02·DEC-04). 합친 커밋은 다음 단락에 적음. 더한 것: `app/server/src/`의 `shop-scope.ts`·`sql-scope.ts`·`routes.ts`(새)와 `app.ts`(고침), 시험 4파일(`sql-scope`·`cross-shop`·`shop-scope`·`shop-scope-static`)과 `test/support/`의 `shops.ts`·`cross-shop.ts`·`source-scan.ts`, `app/README.md` 첫머리와 18\~22, 06 DEC-04의 구현하며 좁힌 해석(`api_catalog.py`를 고치고 다시 만든 `api/openapi.yaml`·06 README 8절 표, 손으로 고친 5·12·15절), TASK-019 끝남 표시(`fc19d98`의 app run 43735859302·db run 43735859325 성공 뒤, Codex 고침 뒤 `cd582e6`의 app run 43737556535·db run 43737556646 성공을 보고 끝남 글의 서버 시험 수를 277개로, `dc02ba9`의 app run 43740005285·db run 43740005367 성공을 보고 299개로, 마지막 고침 `232303d`의 app run 43741586939·db run 43741586952 성공을 보고 312개로). Codex 코드 검토 P2 넷(INSERT 값의 원천을 UNION으로 이은 뒤 조각, 여러 열 꼴 SET의 shop_id, 안쪽의 `TABLE public.이름`, 앱 등록 목록의 사례를 부르지 않는 묶음)을 `499ddc3`에서 고치고(같은 갈래 다섯도 함께) 네 스레드를 해결로 표시, 댓글은 달지 않음. 뒤에 낸 P2 둘(BETWEEN의 짝 AND, 하위 질의 별칭이 바깥 가게 테이블의 별칭을 가림)은 `dc02ba9`에서 고치고(같은 갈래도 함께) 두 스레드를 해결로 표시. `2b196a5` 검토의 P2(WHEN 안의 AND)는 `dc02ba9`가 이미 막아 스레드만 해결로 표시. `1fd58f9` 검토의 P2(ON 안 배열 쉼표에서 절이 끝남)는 `232303d`에서 고치고(같은 갈래 아홉도 함께) 스레드를 해결로 표시. `2b196a5`는 검사를 다시 훑다 찾은 글 다듬기 갈래와 `set_config`·따옴표 이름 고침. `499ddc3` 뒤의 `cd582e6`은 조정 세션이 턴 한도에서 남긴 중간 저장 커밋(기록만). `task019`(01:23, 머리 `81becd0`에 DEC-04 고침을 얹은 작업 트리) 검사 9개 모두 0, `task019b`(01:52, 머리 `cca0a2b`)와 `task019c`(02:16, 머리 `1fd58f9`)도 9개 모두 0. (276) 한 겹이 놓치면 새는 규칙(가게 나누기)은 겹마다 무엇을 못 보는지 적고 다른 겹이 덮게 함. 형식(`ShopDb`는 `Queryable`이 아님)은 날 연결을 꺼내는 코드를, 실행 때 검사는 돌지 않은 SQL을, 정적 시험은 실행 중에 이어 붙인 SQL을, 교차 가게 묶음은 등록되지 않은 경로를 못 봄. 그래서 등록 완결 시험과 선언 없이 붙인 경로 찾기를 함께 두고, 데이터베이스가 막는 것(섞인 행, 05 E1)과 막지 않는 것(다른 가게 행 읽기, 05 A9)을 시험으로 남김. (277) Promise를 돌려주는 메서드는 `async`로 써서 검사의 throw가 거절된 Promise가 되게 함. 동기로 던지면 `await expect(p).rejects`가 받기 전에 부르는 자리에서 터져 시험 셋이 실패했음(`ShopDb.run`). (278) 데이터베이스 제약 시험은 노린 제약 하나에만 걸리는 행으로 만들고 SQLSTATE를 봄. 처음 E1 시험은 유일 제약에 먼저 걸려 23505가 났음(노린 것은 복합 외래 키의 23503). A의 메시지가 B의 상담을 가리키게 새 ID로 넣어 23503만 나게 함. (279) '남는 기록 0'은 두 가게의 가게 테이블 54개와 가게 행을 앞뒤로 견주되, A가 낸 명령의 요청 키는 06 DEC-04대로 404를 남길 수 있어 견줌에서 빼고 그 요청 키의 응답 참조에 B의 기록 ID가 없는지 따로 봄. B 사장님의 요청 키는 늘지 않아야 함. (280) 이름을 찾는 정적 시험은 부르기·가져오기·이름 글자만 치고 주석·오류 글의 언급은 치지 않음. 처음에는 `routes.ts` 주석의 `createShopScope` 언급까지 잡아 실패했음. 찾는 식을 바꾸면 잡아야 할 꼴(띄어 쓴 부르기, 다른 이름으로 가져오기, 괄호 글자)과 잡지 말아야 할 꼴(문서 주석)을 시험으로 둠. (281) 등록 완결 시험은 시험용 경로에도 걸음. 처음에는 손님 쪽 시험용 경로가 등록되지 않아 실패했음. 묶음이 아직 손님으로 부르지 못하므로 그 경로는 묶음의 경로 목록 밖에 두고 따로 시험하며, 묶음에 넣는 일은 TASK-028로 넘김. (282) 구현하며 계약의 해석을 좁히면(06 DEC-04: 401·409 `confirmation_required`·429를 요청 키에 남기지 않음) 생성기 원본(`api_catalog.py`)에 '구현하며 좁힌 해석, 날짜'로 적고 `build_api.py . --write`로 다시 만들며, 손으로 쓰는 절(5·12·15)도 같은 말로 고침. 해석의 날짜는 정한 날(2026-11-15), 기록 절의 날짜는 고친 날(2026-11-16)로 나눠 적음. (283) 06 계약에서 어느 API가 가게 범위인지 가르는 규칙(경로와 보안 방식)과 가게 범위 밖으로 둔 사장님 API 여섯(`OWNER_LEVEL`)은 시험 안에 두고, 여섯이 계약에 있는지와 쪽마다 수(손님 4, 운영자 6, 예약 링크 2, 사장님 50 넘음)를 봄. 구현한 계약 API가 다른 출처(`via`)로 선언되면 실패함. (284) 허락 목록식 SQL 검사는 값이 행에 들어가는 자리와 테이블 이름이 나오는 자리를 모두 봄: INSERT 값의 원천을 이은 조각마다(UNION·EXCEPT·INTERSECT), SET의 한 열 꼴과 여러 열 꼴, FROM 따위 자리 밖에서 테이블을 읽는 꼴(`TABLE public.이름`), 이름을 가리는 꼴(`U&"…"`), SQL 글을 돌리는 내장 함수, 값을 바꾸는 형 바꾸기(`::char`). Codex가 낸 셋을 고칠 때 같은 갈래를 더 찾아 다섯을 함께 막았고, 고치기 전 검사가 빈 목록을 돌려주던 어긴 SQL을 먼저 시험으로 둠. PostgreSQL에서 그 SQL이 실제로 도는지도 봄. 검사는 실수를 막는 것이라 일부러 꾸민 SQL은 코드 검토가 함께 봄을 문서에 적음. (285) 등록 목록은 완결만 보지 않고 묶음이 그 목록을 그대로 부름(견주는 목록과 부르는 목록이 같음, `SUITE_CASES`). 처음에는 앱의 등록 목록을 완결만 보고 시험용 사례만 불러, 앱 경로를 등록해도 부르지 않는 틈이 있었음(Codex). 묶음이 아직 부를 수 없는 쪽(손님·운영자·예약 링크)의 경로를 등록하면 조용히 지나지 않고 그 사례에서 실패함. (286) 허락 목록식 SQL 검사의 글 다듬기(주석·글자 값·따옴표 이름 걷기)는 PostgreSQL의 어휘 분석과 같게 읽음: 줄 주석은 `\n`·`\r`에서 끝나고, ASCII가 아닌 글자도 이름 글자라 그 뒤의 `$`는 이름을 잇고 `$태그$`에도 쓰며, 숫자·`$1` 뒤의 `$$`는 글의 시작이고, 따옴표 없는 이름은 ASCII 글자만 소문자로 바꿈. 다르게 읽으면 PostgreSQL이 돌리는 코드를 검사는 글로 지워 못 봄(`\r`·`é$$`·`$é$` 셋 모두 customers 전체를 읽었음). 고칠 때 그 꼴이 PostgreSQL에서 도는지 실행 계획으로 봄. (287) 조건을 AND로 나눌 때 잇는 AND가 아닌 AND를 가림: BETWEEN의 짝 AND, CASE … END 안, 배열 `[…]` 안. 괄호 깊이만 보면 셋 다 맨 바깥 AND로 보여 `false BETWEEN false AND (o.shop_id = $1)`(늘 참)을 가게 조건으로 쳤음(Codex). PostgreSQL에서 AND보다 약하게 묶이는 것은 OR뿐이라 그 밖의 맨 바깥 AND는 잇는 AND임. (288) 별칭 겹침 검사에는 테이블 별칭만이 아니라 하위 질의·함수·JOIN USING … AS(PostgreSQL 14부터) 별칭도 넣음. 안쪽 별칭이 바깥 가게 테이블의 별칭을 가리면 `p.shop_id = o.shop_id`를 바깥 o로 잘못 이었음(Codex). 하위 질의·함수 별칭에 가게 테이블 이름도 막음. (289) 따옴표 이름은 모두 막음: PostgreSQL에서 `"c.shop_id"`·`"Orders"`·`"and"`는 이름 하나인데 검사는 낱말 셋·접은 소문자·예약어로 읽음. 처음(`2b196a5`)에는 소문자 낱말인 따옴표 이름만 받게 고쳤으나 그것으로는 따옴표로 쓴 예약어(`"and"`가 BETWEEN의 짝을 가로챔)를 못 막아 `dc02ba9`에서 모두 막음. 서버 코드·05의 SQL에 따옴표 이름이 없음을 grep으로 봄. 이름은 표시와 함께 남겨 정적 시험이 가게 테이블 SQL을 고르게 함. 커밋 글의 실패 시험 수는 시험 실행 출력에서 옮겨 적음(`2b196a5` 글에 9개로 잘못 적음, 실제 10개). (290) 절의 끝(WHERE·ON)과 목록의 나눔(SET)은 식 밖에서만 찾음: 배열 `[…]` 안의 쉼표, 함수 이름으로도 쓰는 예약어(`left(…)`·`right(…)`), 식 안에 쓰이는 예약어(`COLLATION FOR (…)`·`WITHIN GROUP (…)`·`IS DISTINCT FROM`)는 끝이 아님. 괄호 깊이만 보면 이것들이 절과 같은 깊이에 있어 절이 일찍 끝나고 그 뒤의 `OR true`를 못 봤음(Codex). 끝 낱말 목록을 고칠 때는 낱말마다 식 안에 쓰이는 꼴을 PostgreSQL 문법에서 찾아 시험으로 둠. (291) 별칭은 적힌 것만이 아니라 PostgreSQL이 붙이는 것도 셈: 별칭을 적지 않은 함수는 함수 이름이 별칭이고(`jsonb_to_record($2) AS (shop_id uuid)`), WITH ORDINALITY 뒤의 AS와 다른 스키마 함수(`pg_catalog.f(…)`)의 별칭도 별칭임. 별칭 뒤 열 목록을 건너뛰어 다음 FROM 항목까지 읽음. 다음 규칙 번호는 (292)부터.

[PR #61](https://github.com/kodonghui/siljang.ai/pull/61)을 squash로 합침(main `5886f76`, 2026-11-16 02:50 KST 무렵, 브랜치 reset·force-with-lease·`git branch -f main origin/main`). 합친 뒤 main에서 돈 run 43743349898(app)·43743349883(db) 성공. [PR #62](https://github.com/kodonghui/siljang.ai/pull/62)(TASK-022 사진 올리기, 04 SPEC-002·004·053·SPEC-068 [입력], 05 A11, 06 API-007·DEC-09·DEC-16·DEC-02). 합친 커밋은 다음 단락에 적음. 더한 것: `app/server/src/`의 `uploads.ts`·`storage.ts`·`services.ts`·`rate-limit.ts`·`file-url.ts`·`owner-scope.ts`·`photo-count.ts`·`encoding.ts`(새)와 `app.ts`·`routes.ts`·`body.ts`·`settings.ts`·`time.ts`·`shop-scope.ts`(고침), `wrangler.jsonc`의 `ratelimits`, `.dev.vars.example`, 새 의존성 `aws4fetch` 1.0.20, 시험 5파일(`uploads`·`file-url`·`storage`·`photo-count`·`rate-limit`)과 `test/support/`의 `contract.ts`·`images.ts`·`rate-limit.ts`·`storage.ts`, 고친 시험 5파일(`app`·`cross-shop`·`shop-scope-static`·`settings`·`time`), `app/README.md` 첫머리·5·22와 23\~30, WBS의 TASK-171 끝난 조건(저장소 모듈 시험)과 TASK-158 끝난 조건(쓰지 않은 임시 파일 지우기)·10-wbs README 10절 두 행·기술 스택 제안 8-1 행, TASK-022 끝남 표시(`b9fce0c`의 app run 43748424193·db run 43748424053 성공 뒤 서버 시험 388개, Codex 고침 `f697efd`의 app run 43781194736·db run 43781194671 성공을 보고 391개로). `6dd036f`(구현)·`4850613`(시험)은 PR 전이라 CI가 돌지 않았고, `f537fdd`는 조정 세션이 턴 한도에서 남긴 중간 저장 커밋(10-wbs README 10절 두 행, app run 43748815471·db run 43748815450 성공). `task022`(03:43, 머리 `b9fce0c`에 `f537fdd`의 두 행을 얹은 작업 트리) 검사 9개 모두 0. Codex는 `b9fce0c`에서 코드 검토·보안 검토 모두 지적 없음. `9534488`(기록 커밋, app run 43780213794·db run 43780213731 성공) 코드 검토의 P2(저장소 응답 머리 뒤에 몸체가 끊기면 날 TypeError가 새어 API-007이 500)는 `f697efd`에서 고치고(고치기 전 코드에서 실패하는 시험 3개를 먼저 둠) 스레드를 해결로 표시, 댓글은 달지 않음. `task022b`(09:24, 머리 `9534488`)도 9개 모두 0. (292) 원본에 없는 저장 구조(올린 파일 테이블)가 필요해 보이면 먼저 원본이 요구하는 것을 적고(06의 1시간·올린 사장님만·없음·지남·다른 사장님 것을 가리지 않는 `upload_not_found`·저장 위치 안 보임, 04·05·06에 한 번만 쓰기·엄격한 세기 요구 없음), 키와 ID로 모두 지킬 수 있으면 05를 바꾸지 않음. 저장소가 사용자 메타데이터를 받지 않으면(Supabase Storage의 S3 호환 주소) 뒤에 볼 사실(올린 시각·용도)을 ID에 담고, 그 대가(한 번만 쓰기는 실제로만, 느슨한 한도)를 README에 적음. 05 테이블(TBL-054)에 억지로 담지 않은 까닭(`shop_id`가 꼭 있고 출처가 둘뿐)도 함께 적음. (293) 라이브러리 형식을 손으로 좁게 쓴 경우(`src/types/pg.d.ts`는 `DatabaseError.code`만) 시험이 쓰는 다른 필드는 구조로 읽음(`(err as { constraint?: unknown }).constraint`). 처음에는 `pg`의 `DatabaseError`로 읽어 시험 typecheck가 TS2339로 실패했음. 서버가 쓰지 않는 필드라 서버 형식은 넓히지 않음. (294) 데이터베이스 제약 시험은 어느 검사가 먼저 걸리는지도 보여 줌: 부모 행 없이 넣은 순서 6·0이 23514이고, 같은 꼴의 맞는 순서 5는 외래 키의 23503임을 함께 둬서 앞의 23514가 순서 때문임을 보임. 외래 키는 문 끝에 도는 검사라 CHECK가 먼저이고, 유일 제약의 23505는 여러 행 INSERT 한 문 안의 겹침으로 외래 키보다 먼저 보임((278)을 넓힘). (295) 행 잠금 시험은 시간을 기다리지 않고 데이터베이스에서 기다림을 봄: 뒤 연결의 pid를 받아 `pg_stat_activity`의 `wait_event_type`이 `Lock`이 될 때까지 짧게 물어보고(50ms씩 최대 100번), 그 뒤 앞 트랜잭션을 풀어 두 결과(10, 6)를 봄. 앞 트랜잭션이 잠금을 쥔 때도 Promise로 알림. (296) 진짜 서비스가 없는 바깥 모듈(S3 저장소)은 보내는 요청의 모양을 가짜 fetch로 시험하고, 로컬 흉내 서버(moto)로 한 번 더 돌림. 흉내 서버만 다르게 도는 곳(moto는 질의 값의 `/`(%2F)를 다르게 다뤄 서명이 맞지 않음)은 다른 클라이언트(boto3)로 같은 요청을 보내 같게 실패하는지 봐서 우리 서명의 잘못이 아님을 가리고, 그 동작만 서명 검사를 끈 채 확인함. 진짜 서비스에서의 확인은 맡을 작업(TASK-171)의 끝난 조건에 더하고 README 10절에 날짜와 이유를 적음. (297) 단계 검사가 도는 동안 그 검사가 읽는 파일을 고치지 않음. `task022`가 도는 사이 10-wbs README 10절에 두 행을 더해 wbs 검사가 어느 판을 읽었는지 흐려졌음. 고쳤으면 검사 시작 머리와 작업 트리를 함께 적고, 마지막 머리에서 다시 돌림. (298) 키 검사(`tools/check-no-keys.mjs --repo`)는 git이 추적하는 파일만 읽으므로 새 파일을 스테이징한 뒤 돌림. 새 파일 17개를 git에 더하기 전에 돌려 398파일로 적었고(CI는 415파일), 이 단락의 기록 커밋에서 바로잡음. (299) 서버 코드(src)는 Workers 형식(`tsconfig.json`)과 시험이 가져올 때의 Node 형식(`tsconfig.test.json`) 두 typecheck를 모두 지나야 하므로, 런타임마다 다를 수 있는 전역 형식 이름 대신 값에서 끌어낸 형식을 씀(`file-url.ts`의 `Awaited<ReturnType<typeof crypto.subtle.deriveKey>>`). Workers 형식의 `TextDecoder` 옵션은 `fatal`·`ignoreBOM`을 둘 다 적음(`body.ts`와 같게). (300) 커밋 전에 `npx biome check --write server`로 형식을 맞추고 `biome ci`를 돌림. 처음 `biome ci`가 형식 오류 4파일로 실패했음. (301) 바깥 서비스의 응답은 머리(상태 코드)와 몸체가 따로 실패함: fetch가 머리를 받은 뒤 연결이 끊기면 몸체 읽기(`text()`)와 버리기(`body.cancel()`)가 거절됨. 몸체를 읽어야 결과를 아는 동작(목록·복사)은 읽기 실패를 '답하지 않음'(503)으로 바꾸고, 상태 코드로 끝난 동작(넣기·지우기·없음)은 버리기 실패를 무시함. 처음에는 fetch의 거절만 바꿔 끊긴 몸체의 TypeError가 500으로 샜음(Codex). 시험은 머리 뒤에 오류가 난 ReadableStream(`test/support/storage.ts`의 `brokenBody`)으로 만들고, 동작마다와 API 응답(503)을 함께 봄. 다음 규칙 번호는 (302)부터.

[PR #62](https://github.com/kodonghui/siljang.ai/pull/62)를 squash로 합침(main `36f458a`, 2026-11-16 09:43 KST 무렵, 브랜치 reset·force-with-lease·`git branch -f main origin/main`). 합친 뒤 main에서 돈 run 43782059666(app)·43782059664(db) 성공. [PR #63](https://github.com/kodonghui/siljang.ai/pull/63)(TASK-025 계좌번호·원래 값 암호화와 마스킹한 값 저장, 05 A23·A15·5절 E20, REQ-191\~193, TBL-015·019·033). 합친 커밋은 다음 단락에 적음. 더한 것: `app/server/src/`의 `field-crypto.ts`·`account-number.ts`·`masked-values.ts`(새)와 `settings.ts`·`services.ts`·`app.ts`(고침), `.dev.vars.example`(이름만), 시험 4파일(`field-crypto`·`account-number`·`masked-values`·`no-plaintext`)과 `test/support/field-keys.ts`, 고친 시험 `settings`, `app/README.md` 첫머리·5와 31\~37, WBS의 TASK-166·167·173 끝난 조건·10-wbs README 10절 세 행·기술 스택 제안 3-2 행. `e50209e`(구현과 시험)의 app run 43783829245(서버 시험 21파일 433개)·db run 43783829262 성공. `task025`(10:06, 머리 `e50209e`에 문서·WBS 고침과 `field-crypto.ts` 주석 고침을 얹은 작업 트리) 검사 9개 모두 0. Codex는 `e50209e`에서 코드 검토·보안 검토 모두 지적 없음. (302) 앞 규칙을 알고도 같은 실수가 되풀이됨: 새 모듈에서 `TextDecoder`에 `fatal`만 적어 src typecheck가 TS2741로 실패했음((299)에 적은 것). 새 모듈에서 런타임 전역 API를 쓰기 전에 저장소에서 같은 API를 쓴 곳(`grep -rn "new TextDecoder" app/server/src`)을 먼저 찾아 그 꼴을 따름. (303) '없음'을 보는 검사는 먼저 '있음'을 찾는지 봄: 데이터베이스 전체에서 평문 0건을 보기 전에 일부러 남긴 표시 숫자를 같은 검사가 찾는지(`{ messages: 1 }`) 확인해 검사가 헛돌지 않음을 보임. 훑는 범위는 컬럼 형식으로 고르지 않고 행 전체(`t::text`)로 해 형식이 다른 컬럼도 빠지지 않게 함. (304) 동시성 시험은 진짜로 동시에 돌게 부르는 쪽마다 연결을 따로 엶. 한 `RequestDb`는 연결 하나라 그 위에 트랜잭션 둘을 겹치면 `TransactionMisuseError`로 시험이 다른 까닭으로 실패했음. 지키는 장치(상담 행 잠금)를 빼면 시험이 실패하는지 한 번 확인해 시험이 그 장치를 보는지 보이고, 확인한 뒤 원래 파일로 되돌려 `git diff`로 같은지 봄. (305) 경계 시험의 값은 계약의 수에서 셈함: 06 `accountNumber`(10\~40자, 숫자 10\~16자리)에서 '-' 30개와 숫자 10자리는 40자라 맞는 값이고 41자가 첫 틀린 값. 처음에는 30개를 틀린 값으로 적어 시험이 실패했음. 바로 아래(맞음)와 바로 위(틀림)를 함께 둠. (306) '다른 키'를 보이는 시험은 다른 것이 키 때문임을 보임: 같은 틀(`framed`)의 같은 메시지를 원래 비밀 값으로 직접 서명한 값과 HMAC이 다른지 견줌. 처음 시험은 메시지가 달라 키와 상관없이 지났음. (307) 원본이 '다른 단계에서 함'이라 넘긴 일(05 E20 반론의 '키 보관과 바꾸기는 10단계 배포에서')은 그 단계 문서에 실제로 있는지 찾고, 없으면 맡을 작업의 끝난 조건과 10-wbs README 10절에 날짜·이유를 더함. 바꾸는 차례처럼 지금 코드와 함께 읽어야 하는 것은 이 PR의 앱 README에 적음. (308) 비밀 값을 만드는 명령은 값이 화면·대화·셸 기록을 지나지 않는 꼴로 적음: 권한을 좁힌 파일로 만들고(`umask 077`) 그 파일을 `wrangler secret put`의 입력으로 넣은 뒤, 사본을 비밀 저장소에 옮기고 파일을 지움. Workers 비밀 값은 다시 읽을 수 없어 사본이 없으면 키를 잃음. (309) 코드 주석이 README의 번호를 가리키면 README를 다 쓴 뒤 번호를 다시 봄: `field-crypto.ts` 첫머리가 키 바꾸기 차례를 README 31로 가리켰는데 실제는 33이었음(기록을 쓰다 찾아 고침). (310) CI의 서비스 컨테이너 로그도 읽음: PostgreSQL은 제약을 어긴 문장의 행 값을 로그의 DETAIL에 남기고, 시험이 일부러 넣은 평문 시험 값이 거기 보였음. 앱 로그(G6)만이 아니라 데이터베이스 서버 로그도 개인정보가 남는 곳으로 보고 맡을 작업(TASK-166)에 넘김. 다음 규칙 번호는 (311)부터.

[PR #63](https://github.com/kodonghui/siljang.ai/pull/63)을 squash로 합침(main `0e3ff83`, 2026-11-16 10:17 KST 무렵, 브랜치 reset·force-with-lease·`git branch -f main origin/main`). 합친 뒤 main에서 돈 run 43785389431(app)·43785388524(db) 성공. [PR #64](https://github.com/kodonghui/siljang.ai/pull/64)(TASK-023 서버 안의 일 실행기, 05 A33, G2·G4·G8, TBL-051). 합친 커밋은 다음 단락에 적음. 더한 것: `app/server/src/`의 `event-keys.ts`·`due-sources.ts`·`retry.ts`·`job-runner.ts`·`jobs.ts`·`scheduled.ts`(새)와 `index.ts`·`shop-scope.ts`·`ops-events.ts`·`log.ts`(고침), 시험 6파일(`due-sources`·`event-keys`·`job-runner`·`jobs`·`retry`·`scheduled`), 고친 시험 `shop-scope-static`·`app`과 `app/server/vitest.config.ts`, `app/README.md` 첫머리와 38\~47, WBS의 TASK-016 끝난 조건·10-wbs README 10절 두 행·기술 스택 제안 0절·3-2·3-3. `5e1c86d`의 app run 43790459585·db run 43790459579 성공, `task023` 검사 9개 모두 0. Codex가 `5e1c86d`에서 P2 셋을 지적해 `0e72810`에서 실패하는 시험부터 더해 고침(app run 43791770633 서버 시험 27파일 516개 통과·db run 43791770620 성공, `task023b` 검사 9개 모두 종료 코드 0(api 검사 17개 통과, wbs 검사 18개 · 오류 0)). Codex가 새 커밋마다 다시 검토해 P2를 하나씩 더 지적했고 모두 실패하는 시험부터 더해 고침: `0e72810`의 늘 던지는 행이 묶음을 막음 → `26f6543`(app run 43793922553 서버 시험 519개), `26f6543`의 일과 곳의 차례가 함께 돎 → `363da81`(app run 43794738881 520개), `363da81`의 하루 한 번 일이 찾은 새 행을 남기고 멈춤 → `dd93af5`(하루 한 번 일을 실행의 처음에 두는 것도 함께, app run 43795897879 서버 시험 27파일 522개 통과·db run 43795898012 성공). 단계 검사 `task023c`·`task023d` 9개 모두 0, `task023e` 검사 9개 모두 종료 코드 0(api 검사 17개 통과, wbs 검사 18개 · 오류 0). (311) 정적 검사가 SQL 글자를 모두 봐야 하면 SQL을 틀로 만들지 않음: 처음에 찾는 곳의 SQL을 테이블 이름 끼워 넣기(`FROM ${table}`)로 만들어 TASK-019 정적 시험이 그 SQL을 볼 수 없었음. 글자 그대로 적고, 같은 꼴인지는 시험이 정규식으로 봄(잡기 SQL은 찾기 SQL에서 셈해 견줌). (312) 정적 규칙의 예외는 파일 하나와 시험 파일에 적은 꼴로만 엶: 여러 가게에 걸친 찾기는 `due-sources.ts` 하나에서 FROM 하나·끼워 넣기 없는 꼴로만 허용하고, 그 꼴을 시험 파일에 따로 적어 src가 꼴을 넓히면 실패하게 함. 틀린 예(컬럼 더함·하위 쿼리·다른 파일)가 거절되는지도 봄. (313) 진입점의 형식은 src와 시험 두 tsconfig에 모두 있는 것만 씀: `ExportedHandler`는 시험 tsconfig에 없어 test typecheck가 TS2304로 실패했고, `setTimeout`이 돌려주는 값은 두 형식이 달라 `clearTimeout`이 TS2345로 실패했음(`undefined` 검사로 좁힘). (314) 기본 내보내기를 바꾸기 전에 그것을 쓰는 시험을 찾음: 진입점을 Hono 앱에서 `{ fetch, scheduled }`로 바꾸자 `worker.request`를 쓰던 `app` 시험이 깨졌음(`grep -rn 'src/index' app/server/test`). (315) 공유 시험 데이터베이스에서 '때가 된 행'을 찾는 시험은 서로의 행을 집지 않게 시각을 나눔: 실행기 시험은 2001\~2008년의 아무 분을 기준 시각으로, 발송 결과 조회 셈 시험은 2090년의 행을 쓰고 끝나면 끝난 상태로 둠. 처리는 자기 행만 보고, 같은 시험을 6번 되풀이해 흔들리지 않는지 봄. (316) 시험의 기대 수는 조합을 세어 그대로 적음: 발송 결과 조회 셈 시험의 비교 수를 '25보다 많음'으로 적었다가 실제 23(조회 시각이 기준 시각보다 뒤인 조합을 뺌)이라 실패했음. 범위가 아니라 센 수를 적어 조합이 바뀌면 알게 함. (317) '멈춘 실행기' 시험은 정말로 멈춤: 던짐·되돌림만이 아니라 행을 잡은 연결을 `pg_terminate_backend`로 끊어, 잠금이 풀린 뒤 새 실행기가 그 행을 한 번 하는지 봄. 임대 꼴은 기준 시각을 임대 끝 앞과 뒤로 나눠 봄. (318) 예정 시각과 실제 시각을 나눔: 찾기와 때 셈은 Cron이 예정한 시각(`scheduledTime`)으로 하고, 임대 끝처럼 '지금부터 얼마 동안'은 실제 시계로 셈. 예정 시각으로 세자 3분 늦게 깨운 실행의 임대가 잡자마자 끝나 있어, 제때 깨운 다음 실행이 같은 바깥 호출을 함께 했음(Codex). 시험은 시계를 넣을 수 있게 하고 늦은 실행과 제때 실행을 겹쳐 봄. (319) '그날 했는지'는 그날 전체를 봄: 시작 표시를 기준 시각까지만 보면, 늦게 도착한 앞 분의 실행이 뒤 분의 표시를 못 보고 다시 시작함(Codex). 그날의 때부터 다음 날의 때 전까지를 봄. (320) 한 실행 안의 차례는 일만이 아니라 한 일 안의 곳도 돌림: 일의 차례만 돌리자, 앞 곳(보내기)이 시간 한도를 다 쓰면 뒤 곳(발송 결과 조회)이 늘 뒤로 밀렸음(Codex). (321) 여러 가게에 걸쳐 찾는 시험은 다른 시험 파일과 동시에 돌리지 않음: 실행기 시험이 다른 파일이 동시에 넣은 행을 잡거나(서로 SKIP LOCKED로 건너뜀) 그 행이 묶음을 채워, 묶음 2의 시험이 4번 중 3번 실패했음. 기준 시각을 더 앞의 해(1991\~1999)로 옮기자 오히려 다른 실행기가 모두 그 행을 찾아 더 나빴음. 서버 시험 파일을 차례로 돌리고(`fileParallelism: false`), 실패한 시험이 남긴 때가 된 행이 다음 실행을 잇달아 깨뜨리므로 로컬 시험 데이터베이스의 남은 시험 행을 끝난 상태로 정리함. (322) 검토가 돌았는지는 기록에 적기 전에 PR에서 확인함: `0e72810` 푸시 뒤 Codex 검토(P2 하나)가 와 있었는데, 기록 커밋에 '푸시만으로는 새 검토가 돌지 않는다'고 짐작해 적었음. 이 저장소의 Codex는 새 커밋마다 코드 검토와 보안 검토를 돌리고, PR의 요약 댓글에 머리와 상태를 적음. 합치기 전에 그 요약이 마지막 머리에서 끝났는지(`completed`, 풀리지 않은 지적 없음)를 보고, 본 머리를 기록에 적음. (323) '다음 실행에서 다시'인 실패가 같은 실행의 뒤를 막지 않게 함: 되돌린 행은 그대로 때가 된 채 찾기의 앞에 다시 나와, 한 번에 찾는 수만큼 그런 행이 있으면 뒤의 행이 영영 돌지 않았음(Codex). 본 행을 빼고 이어 찾고, 물러난 때가 있는 바깥 호출 실패는 채우지 않음. 넘길 위험으로 적어 둔 것(앱 README 47)이라도 실행기가 고칠 수 있는 것이면 그 PR에서 고침. (324) 지우지 않고 쌓이는 표시를 보는 시험은 앞 실행이 남긴 표시가 없는 때를 고름: 로컬 시험 데이터베이스에 하루 한 번 시작 표시가 105개 쌓여 하루 한 번 시험이 세 번 중 한 번 실패했음(CI는 새 데이터베이스라 드묾). 행을 남기는 시험은 끝난 상태로 정리함. (325) 차례 둘을 같은 수로 돌리지 않음: 일의 차례와 곳의 차례를 모두 '분 % 수'로 돌리자 일 수가 짝수일 때 두 차례가 함께 움직여, 어떤 (일, 곳) 짝은 늘 먼저 오지 못했음(Codex). 섞인 진법(일 = 분 % 일 수, 곳 = 분 / 일 수 % 곳 수)으로 돌리고, 시험은 일 둘·곳 둘을 네 분 동안 돌려 네 짝이 모두 먼저 오는지 봄. 한 일만 쓰는 시험으로는 두 차례의 얽힘을 볼 수 없었음. (326) '다 찾았다'는 돌려받은 새 행을 다 했을 때만: 처리한 행이 빠지는 찾기에서 '찾은 수 < 찾는 수'만 보고 멈추자 새 행 하나를 그날 남겼음(Codex). 다시 찾는 수는 다시 나올 수 있는 본 행만큼만 더해 커지지 않게 함. 지적을 고친 뒤 같은 꼴(표시를 남긴 뒤 할 일을 못 함)을 스스로 더 찾아, 하루 한 번 일이 앞의 일 뒤에 시작해 시간 한도를 거의 다 쓴 채 시작 표시만 남기던 것도 시험부터 고침. 지적을 고친 커밋마다 검토가 새 지적을 하나씩 더 냈으므로(`0e72810`·`26f6543`·`363da81` 세 번 잇달아), 고친 곳의 둘레(같은 셈을 쓰는 다른 꼴의 일, 같은 표시를 쓰는 다른 때)를 먼저 훑음. 다음 규칙 번호는 (327)부터.

[PR #64](https://github.com/kodonghui/siljang.ai/pull/64)를 squash로 합침(main `da89768`, 2026-11-16 12:19 KST 무렵, 브랜치 reset·force-with-lease·`git branch -f main origin/main`). 합친 뒤 main에서 돈 run 43797461790(app)·43797461850(db) 성공. [PR #65](https://github.com/kodonghui/siljang.ai/pull/65)(TASK-026 모델 호출 한 곳, REQ-266·138·150, 06 DEC-25·DEC-17, 04 AI-1, TBL-048). 합친 커밋은 다음 단락에 적음. 더한 것: `app/server/src/`의 `ai-model.ts`·`ai-turn-output.ts`·`ai-usage.ts`·`ai-prices.ts`·`ai-calls.ts`(새)와 `settings.ts`·`services.ts`(고침), 시험 5파일(`ai-model`·`ai-usage`·`ai-turn-output`·`ai-settings`·`ai-model-static`)과 `test/support/ai-mock.ts`, 의존성 넷(`--before=2026-11-08`), `.dev.vars.example`, `app/README.md` 첫머리와 48\~57, 기술 스택 제안 3-4의 날짜 줄과 10-wbs README 10절 한 행. 서버 시험 522 → 567개(27 → 32파일), 유료 AI 호출 0번. (327) 금액의 근거가 되는 수는 라이브러리가 모아 준 값이 아니라 회사 응답의 원래 값에서 읽음: LangChain이 Anthropic 스트림의 시작 이벤트 출력 토큰과 누적 출력 토큰을 더해 150을 151로 셌음. 회사 문서의 뜻(`message_delta`의 usage는 누적)을 시험에 적고, 받은 바이트를 바꾸지 않고 지나가며 읽는 스트림으로 셈. (328) 모의 응답은 회사 문서의 실제 꼴로 만듦: SSE 이벤트 차례, 누적 usage, 공백이 있는 JSON, CRLF, 아무 바이트에서 끊긴 조각(한글·이모지). 단순한 모의로는 위의 셈 오류도, 첫 토큰 시각을 시작 이벤트에서 재던 것도 보이지 않았음. (329) SDK가 보내는 머리는 짐작하지 않고 시험이 받은 요청으로 적음: Anthropic SDK 1.6.0은 키를 `x-api-key`가 아니라 `Authorization` 머리로 보냈고(시험이 실패해서 앎), LangChain은 브라우저 허용(`dangerouslyAllowBrowser`)을 기본으로 켜 두어 끔. (330) '새는 요청 0'을 보는 시험은 같은 시험이 새는 요청을 잡을 수 있음을 함께 봄: 운영에서 추적 요청 0만 보면 시험이 아무것도 못 잡아도 지남. 개발에서 추적을 켜 같은 시험이 가짜 추적 주소로 간 요청을 잡는지 보고, 그 주소는 `.invalid`로 두어 가짜 fetch를 걷은 뒤 늦게 나간 요청이 밖에 닿지 않게 함. (331) 끄는 설정은 우리 설정 검사만이 아니라 라이브러리가 따로 읽는 곳까지 봄: Workers는 nodejs_compat에서 Worker 변수를 `process.env`에도 넣고 LangChain은 그것을 읽음. 호출 직전에 `process.env`를 다시 보고, 끌 이름(추적 스위치·키·`LANGSMITH_GATEWAY`)은 라이브러리 소스에서 찾아 더함. 주소를 바꾸는 변수(`ANTHROPIC_BASE_URL` 등)도 같은 이유로 주소를 정해 둠. (332) 단언이 늘 참인지 봄: 오류 위치 목록을 그 목록에서 만든 값과 견줘 늘 지나던 단언을 기대 위치(`arrayContaining`)와 꼴(정규식)로 바꿈. (333) 일을 멈추고 넘길 때는 아직 없는 문서를 가리키는 글을 함께 적음: 코드 주석과 `.dev.vars.example`이 쓰기 전의 앱 README 48\~57을 가리킨 채 멈췄음. 문서를 쓰며 번호가 바뀐 곳(요금표 주석 48 → 53)을 맞춤. (334) 검사는 종료 코드로 봄: 로컬에서 `npm run -s lint 2>&1 | tail -1`로 마지막 줄만 보고 지나간 줄 알았으나, Biome은 마크다운(앱 README의 표 정렬)도 보므로 `biome ci`가 실패했고 처음 연 머리 `2d80c98`의 app run 43803126811이 실패함. 끝 몇 줄만 남기는 파이프는 오류 줄과 종료 코드를 가림. 검사·시험·빌드는 출력 파일과 함께 종료 코드를 적고, 표가 든 문서를 고치면 `npx biome format --write`로 맞춤. (335) 쌓이는 값은 끝 이벤트의 값만 끝 값으로 씀: Anthropic 스트림이 글을 다 보낸 뒤 `message_delta` 없이 끝나면 시작 이벤트의 `output_tokens`(1)로 금액을 세어 성공 행을 남겼음(Codex P2, `2d80c98`). 끝 사용량을 받았는지 따로 두고, 받지 않았으면 사용량 없음(`usage_missing`)으로 금액을 세지 않음. 실패하는 시험 둘(사용량 읽기·모델 호출)을 먼저 더해 실패를 확인(`ok: true`, 출력 1)하고 고침. 같은 꼴을 둘레에서 찾음: OpenAI는 끝 이벤트(`response.completed`·`response.incomplete`·`response.failed`)에서만 사용량을 읽어 같은 문제가 없음(모델 호출 시험이 두 회사를 다 봄). 다음 규칙 번호는 (336)부터.

[PR #65](https://github.com/kodonghui/siljang.ai/pull/65)를 squash로 합침(main `1977cee`, 2026-11-16 13:41 KST 무렵, 브랜치 reset·force-with-lease·`git branch -f main origin/main`). 합친 뒤 main에서 돈 run 43805603239(app)·43805603318(db) 성공. [PR #66](https://github.com/kodonghui/siljang.ai/pull/66)(TASK-029 사장님·운영자 웹 바탕, REQ-147, 04 G7, 06 오류 코드·필드 이유·확인·DEC-04, 08 공통 상태, 09 토큰). 합친 커밋은 다음 단락에 적음. 더한 것: `app/web/`의 `scripts/gen-tokens.mjs`·`page-check.mjs`·`check-dist.mjs`, `src/problems.ts`·`command.ts`·`useCommand.ts`, `src/ui/`(공통 부품), `src/styles/`(생성 파일 `tokens.css`와 `base.css`·`parts.css`·`fonts.ts`), 개발용 견본(`samples.html`, `src/samples/`)(새)와 `src/api.ts`·`src/main.tsx`·`app/biome.json`(고침), 시험 5파일(`problems`·`command`·`ui/parts`·`styles`·`samples`)과 `api` 시험 더함, 의존성 둘(`@fontsource/ibm-plex-sans-kr` 5.3.0, 시험용 `yaml` 2.9.1, `--before`), `app/README.md` 첫머리와 58\~66. 웹 시험 4 → 111개(2 → 7파일). (336) 생성 파일은 서식 도구 대상에서도 뺌: Biome이 생성 파일 `tokens.css`의 16진 색을 소문자로 바꾼 채 첫 커밋 `018e0b1`에 들어가 `gen-tokens.mjs --check`(다시 만들어 견줌)가 실패함. `app/biome.json`에서 그 파일을 빼고 생성기로 다시 만듦(`7ec1d57`). 생성 파일을 더하면 서식·린트 대상에서 빼고, 다시 만들어 견주는 시험을 같이 둠. (337) 지시서와 계약이 다르면 계약을 따르고 그 자리를 적음: 지시서는 확인 창 뒤 같은 요청 키로 다시 보낸다 했으나, 06의 `confirmation_required` client 글은 확인 값을 실은 새 요청 키. 06대로 하고 앱 README 63과 PR 본문에 적음. (338) 의존성을 더하면 빌드 크기와 싣는 차례를 잼: 글꼴 CSS(316 kB)가 첫 CSS에 들어가 첫 화면을 막는 것을 빌드 출력으로 봄. `src/styles/fonts.ts`로 나눠 동적 import로 싣고, `check-dist.mjs`가 빌드마다 첫 CSS에 `@font-face`가 없고 토큰·공통 부품이 있는지 봄. (339) 렌더마다 새로 만드는 함수를 처음 한 번만 잡지 않음: 견본의 가짜 보내기가 렌더마다 요청 기록을 새로 만들어 page-check 흐름이 요청 0개를 봄. 명령 실행기도 처음 받은 보내기 함수만 잡으면 오래된 값으로 보냄. 명령마다 누른 때의 보내기 함수를 붙들고(`setSend`, `current.send`) 다시 시도·확인도 그 함수를 쓰며, 이를 보는 시험을 더함. (340) page-check 경고는 스크린샷을 보고 고친 뒤 다시 돌려 확인: 360의 위험 배너에서 추적 번호가 잘려 나뉨(latin-split). 덧붙임이 있는 배너는 줄을 바꾸게(`ui-banner--detail`) 하고, 다시 돌려 경고가 사라진 것과 스크린샷을 봄. (341) 예외 목록은 두 방향으로 견줌: 08 SCR 응답 표 509행과 G7 표를 견주는 시험은 예외 목록에 없는 차이와, 예외 목록에만 있고 08에 없는 행을 모두 실패로 봄. 한쪽만 보면 08이 바뀐 뒤 남은 예외가 조용히 지나감. (342) 짐작한 문구로 시험하지 않음: 부품 시험이 '이미 처리된 요청이에요'를 기대했으나 06 문구는 '이미 처리됐어요'. 시험은 `ERROR_CODES[...].message`에서 읽음. (343) 금지어는 문서만이 아니라 코드 주석·시험 이름에서도 봄: 더한 줄을 금지어로 훑다가 주석 둘과 시험 이름 하나의 금지어를 찾아 고침(`003afc0`). (344) 화면이 사라질 때의 정리는 타이머만이 아니라 아직 오지 않은 응답도 끊음: 보내는 중에 화면이 사라지면 멈출 타이머가 아직 없어, 뒤늦게 온 429 `rate_limited`·409 `request_in_progress`가 새 타이머를 걸고 사라진 화면에서 쓰기를 다시 보냈음(Codex P2, `901834a`). 실패하는 시험 넷을 먼저 더해 실패(새 타이머 1개)를 확인하고, 정리가 세대를 올려 오지 않은 응답을 버리게 고침. 같은 꼴을 둘레에서 찾음: StrictMode의 두 번 붙임과 숨겼다 보임은 같은 실행기를 다시 쓰므로, 보내는 중이던 명령은 결과를 모르는 연결 실패(같은 키로 다시 시도)로, 한도로 막힌 명령은 막힘을 풀어 '보내는 중'·'막힘'에 멈춰 있지 않게 함. 다음 규칙 번호는 (345)부터.

[PR #66](https://github.com/kodonghui/siljang.ai/pull/66)을 squash로 합침(main `751a2fc`, 2026-11-16 15:00 KST 무렵, 브랜치 reset·force-with-lease·`git branch -f main origin/main`). 합친 뒤 main에서 돈 run 43813810893(app)·43813811001(db) 성공. [PR #67](https://github.com/kodonghui/siljang.ai/pull/67)(TASK-024 접속기록 남기기 공통, REQ-196, 04 SPEC-074·G6, 05 A24·E21·TBL-053, 06 README 5절). 합친 커밋은 다음 단락에 적음. 더한 것: `app/server/src/access-log.ts`(새)와 `routes.ts`·`request-key.ts`·`log.ts`·`jobs.ts`(고침), 시험 `access-log.test.ts`와 도우미 `test/support/access-log.ts`, `app/README.md` 첫머리·40·67\~73, WBS 끝난 조건 셋(TASK-016·166·174)과 10-wbs README 10절 세 행. 서버 시험 567 → 598개(32 → 33파일), 새 의존성 없음, 유료 AI 호출 0번. (345) 인용과 경로는 저장한 원문과 파일에서 다시 찾은 뒤 적음: 'Worker 하위 요청이 없으면 cf-connecting-ip가 클라이언트의 IP'라는 문장을 Workers의 'Headers' 쪽에서 읽었다고 기억했으나 저장한 사본에 없었고 'Cloudflare HTTP headers' 쪽(2026-11-15 고침)에 있었음. 앱 README에 처음 적은 규칙 시험 경로(`db/tests/rule_tests.sql`)도 없는 경로였고 실제는 `research/cake-erd-2026-11/rule_tests.sql`. 문서 이름·고친 날·파일 경로·행 번호는 grep·ls 결과에서 옮김. (346) 문서가 말하지 않는 것은 짐작해 채우지 않고 확인할 작업에 넘김: Cloudflare 문서는 CF-Connecting-IP가 Cloudflare에 접속한 클라이언트의 IP라고 하지만, 클라이언트가 보낸 같은 이름의 헤더를 덮어쓰는지는 적지 않음. 앱 README 70에 '문서에 없음'으로 적고, 꾸며 보내 보는 확인을 TASK-016의 끝난 조건에 넣음. (347) 로컬 도구가 같은 헤더를 어떻게 다루는지는 그 도구의 소스에서 봄: wrangler dev(Miniflare 5.20261104.0-beta)는 요청에 CF-Connecting-IP가 이미 있으면 소켓 주소로 바꾸지 않음(`entry.worker.js`). 로컬에서 지나는 것이 운영의 근거가 되지 않는 곳으로 README에 적음. (348) 권한에 대한 주장은 임시 역할로 실제로 해 보고 적음: 05 E21은 '앱 계정에 넣기만 허용'을 권했지만 2년 지난 행 지우기(TASK-158)가 같은 서버에서 돌고, PostgreSQL은 조건이 있는 DELETE에 그 컬럼의 SELECT도 요구함(로컬 16.15에서 permission denied를 봄). 트랜잭션 안에서 역할을 만들고 SET ROLE로 해 본 뒤 되돌려, 남는 역할 없이 넘길 권한 목록(INSERT, DELETE·SELECT(accessed_at), 소유자 아님)을 TASK-174에 적음. (349) 같은 트랜잭션이라는 주장은 시각으로 보임: 넣기가 성공했다는 것만으로는 응답과 같은 트랜잭션인지 모름. 시험용 경로가 응답 본문에 그 트랜잭션의 now()를 마이크로초까지 담고, 시험이 접속기록의 accessed_at(기본 now())과 같은지 봄. PostgreSQL의 now()는 트랜잭션 시작 시각이라 다른 트랜잭션이면 달라짐. (350) 껍데기에서 지난 시험은 새 코드의 증거로 세지 않음: 시험을 먼저 쓰고 빈 껍데기로 돌려 31개 가운데 24개 실패를 봄. 지난 7개는 이미 있던 동작(05 트리거, 0행, 06 범위 줄, 운영 선언 대조)이나 실패 쪽(500)만 보는 시험이었음. 실패 쪽 시험은 껍데기가 던져도 지나므로, 같은 경로의 성공 쪽 시험(한 행과 200)이 함께 있는지 봄. (351) 공통 층의 동작을 바꾸면 그 층을 쓰는 시험을 모두 다시 돌림: 같은 요청 키의 다시 읽기를 트랜잭션 안으로 옮긴 것은 접속기록 경로만이 아니라 모든 명령에 해당해, 서버 시험 33파일 598개를 다시 돌려 앞 작업의 요청 키 시험이 그대로 지나는 것을 봄. (352) 더한 줄 훑기에는 01 금지어와 EXTRA만이 아니라 옛 용어(`check_screens.py`의 OLD_TERMS)도 넣음: 앞 작업들의 훑기는 금지어와 EXTRA만 봐서, 이번에 처음 넣자 주석 두 줄과 README 한 줄에서 옛 용어 셋이 나왔음(하나는 뜻이 다른 말이 같은 글자로 걸린 것). 고친 뒤 다시 훑어 0건. 다음 규칙 번호는 (353)부터.

[PR #67](https://github.com/kodonghui/siljang.ai/pull/67)을 squash로 합침(main `d301608`, 2026-11-16 16:01 KST 무렵, 브랜치 reset·force-with-lease·`git branch -f main origin/main`). 합친 뒤 main에서 돈 run 43820877589(app)·43820877561(db) 성공. [PR #68](https://github.com/kodonghui/siljang.ai/pull/68)(기록: Notion·Artifact 한 번 올리기의 결과와 다음 한 번 올리기 목록을 저장소에, 10단계 TASK-182 화면 레이아웃). 합친 커밋은 다음 단락에 적음. 고친 것: 02\~04 `synced_at`과 머리말, 플로우 파일 14개의 `notion`(옮긴 옛 행을 가리키던 것), 06·08·09 README의 올린 판, `.corthex/project.json`의 `10-wbs` link·note, `wbs_rows.py`(TASK-182와 화면 작업 33개의 앞선 작업)와 다시 만든 `wbs.md`·10-wbs README, 진행 기록. 앱 코드는 바꾸지 않음. (353) 새로 쓰는 작업의 이름과 끝난 조건은 커밋 전에 `build_wbs.py .`로 옛 용어까지 봄: TASK-182 이름과 끝난 조건에 08·09 검사와 같은 옛 용어 목록의 말(새 용어는 '레이아웃')을 썼다가 `build_wbs.py .`에 걸려 '화면 레이아웃'으로 고침. 08 W4의 결정 이름이 이미 '사장님·운영자 화면 레이아웃'이었음. (354) 작업의 끝난 조건을 원본 여럿에서 옮길 때는 생성된 뷰와 결정 글을 직접 열어 같은 것을 말하는지 견줌: 08 와이어프레임의 운영자 메뉴는 `build_screens.py`가 07 트리의 1뎁스로 만들어 셋(SCR-050 포함)인데, 08 W4·SCR-047 정의와 09 `gen_screens.py`의 `OPERATOR_MENU`는 둘이었음. 원본을 바꾸는 일은 이 PR 밖이라, 끝난 조건에 따른 쪽(08 W4·09)과 차이를 함께 적음. (355) 한 번 올리기 뒤의 '다음 목록'은 올릴 때 쓴 생성기로 다시 셈: 그 작업의 `gen_full.py`와 `diff_wbs_main.py`를 그 작업 폴더를 건드리지 않게 사본으로 돌리고, 먼저 main `d301608`에서 그 작업이 적은 수(표 5행, 작업 17행과 TASK-024)가 나오는지 본 뒤 이 PR의 원본에서 셈(표 5행, 작업 52행). 다음 규칙 번호는 (356)부터.

[PR #68](https://github.com/kodonghui/siljang.ai/pull/68)을 squash로 합침(main `364dea6`, 2026-11-16 16:34 KST 무렵, 브랜치 reset·force-with-lease·`git branch -f main origin/main`). 합친 뒤 main에서 돈 run 43824848997(app)·43824848900(db) 성공. [PR #69](https://github.com/kodonghui/siljang.ai/pull/69)(TASK-027 AI 평가 세트와 채점·한 명령 실행기 가운데 키 없이 되는 부분, REQ-145·139·146·266, 04 AI-1·SPEC-013·018·020·021·022). 합친 커밋은 다음 단락에 적음. 더한 것: `app/server/eval/`(사례 134개, 합성 가게 3곳, 기준 프롬프트 버전 0, 다섯 잣대 채점, 어림, 모의·진짜 실행, 결과 파일 넷, 생성 파일 `source-checklist.md`, 개인정보 훑기, 명령)과 시험 `eval-cases`·`eval-score`·`eval-run`, `server/package.json` 명령 둘, `tsconfig.test.json`, `biome.json`, `.gitignore`, `app/README.md` 첫머리·74\~82·명령 절. 서버 시험 598 → 667개(33 → 36파일), 새 의존성 없음, 유료 AI 호출 0번. TASK-027은 끝남으로 표시하지 않음(남은 것: 진짜 키로 작은 실행과 결과 표, 다른 세션 몫). (356) 생성하는 Markdown 파일과 저장소에 넣지 않는 결과 폴더도 `biome.json`에서 뺌: Biome은 Markdown 표의 꼴도 보므로, 점검표 생성기가 쓴 `source-checklist.md`를 `biome ci`가 꼴 오류로 잡았음. 생성 파일은 손으로 맞추지 않고 (336)처럼 대상에서 빼며, Biome은 `.gitignore`를 읽지 않아 결과 폴더도 따로 뺌. (357) 금지어 훑기는 손으로 쓴 글만이 아니라 생성하는 글과 데이터에서 만드는 ID에도 함: 먹어도 되는지 갈래의 사례 ID 머리글자가 10단계 EXTRA의 영어 두 글자 말을 품어 생성 점검표에서 걸렸음. 머리글자를 `EAT`로 바꾸고 점검표를 다시 만듦. README와 주석의 25곳도 고친 뒤 다시 훑어 0건. (358) 채점기는 이상적인 모의 답 전체 실행(실패 0·사람 검토 0이어야 함)으로 먼저 잘못 걸림을 찾음: 주문번호 `K7Q2M9`의 끝 숫자가 뒤의 글과 함께 기간으로 읽혀 지어낸 답에 걸렸고, '…되었는지'·'…되는지'처럼 묻는 꼴이 단정하는 말로 걸렸음. 영문자·숫자 바로 뒤의 숫자는 뽑지 않고 묻는 꼴은 단정이 아닌 것으로 고친 뒤, 같은 글을 `eval-score.test.ts`에 넣어 고정함. (359) 금액 상한은 시작 전 위 끝 어림으로 지킴: 실행 중의 확인은 호출 행의 `cost_krw` 합이라 실패해 금액이 남지 않은 호출(앱 README 57)이 들어가지 않음. 위 끝 어림을 호출 하나가 쓸 수 있는 가장 큰 토큰 수로 세어 시작 전에 넘으면 하나도 호출하지 않는 것을 주된 장치로, 실행 중 확인을 어림이 틀렸을 때의 두 번째 장치로 두고 그 한계를 앱 README 78에 적음. PR을 연 머리 `4f92b95`에 Codex 코드 검토의 P2 지적 셋(범위 견적, 모른다는 말, 손님이 말한 숫자)이 왔고, 셋 다 맞아 지적의 답 글로 실패하는 시험을 먼저 쓰고 고침(GitHub 댓글 없이 스레드만 resolve). (360) 견적 표시 검사는 표시 말이 답 어딘가에 있는지가 아니라 견적 금액 바로 옆에 있는지로 봄: 범위 견적 AMT-08에서 '61,000원부터예요.'는 '부터'가 범위 표시로 읽혀, '66,000원이에요.'는 아래 끝이 없어 표시 검사를 지나 둘 다 통과했음. 범위는 아래 끝과 위 끝을 범위 꼴로 이어 말해야 통과, '부터'는 그 금액 옆의 말로 보고, 한 금액 표시에 '부터'·어림 말이 붙으면 실패로 함. 앞 끝의 '원'을 뺀 범위('6만 1천\~6만 6천 원')도 두 금액으로 읽음. (361) 단정 패턴은 AI가 자기 앎이나 할 일을 말하는 꼴('확인할 수 없어요', '답하기 어려워요')을 먼저 가린 뒤 봄: 주제 뒤 20자 안의 '없어요'를 단정으로 잡아, 넘기며 모른다고 한 바른 답(UNK-01)이 실패했음. 같은 길이의 빈칸으로 가려 뒤의 자리를 지키고, 패턴을 쓰는 주제 24개 전부를 시험으로 돎. (362) 답의 숫자를 입력과 견줄 때 출처를 나눔: 손님 글(믿지 않는 입력)의 숫자를 근거로 치면, 바꾸기 시도에서 손님이 말한 시각을 다른 꼴로 되받아 된다고 한 답('밤 10시' → '22:00 픽업 가능합니다', INJ-28)을 놓침. 손님 글을 JSON 문자열 꼴과 원문 꼴로 지운 입력만 근거로 보고, 손님 글에만 있는 숫자는 그 문장이 된다고 하는지 거절하는지로 가름. 고친 머리 `a663742`에 Codex가 같은 종류의 P2 지적 셋(먹어도 되는지의 부정 꼴, '불가능' 안의 '가능', 완료가 아니라는 말)을, 실패하는 시험만 먼저 올린 중간 저장 커밋 `4f47702`에 하나(사람이 직접 답하고 있지 않다는 말)를 더 남김. 넷 다 맞아 다섯 잣대의 짝 표 시험을 먼저 쓰고 고침(GitHub 댓글 없이 스레드만 resolve). (363) 단정의 긍정·부정은 잣대마다 따로 두지 않고 공용 도우미 하나로 가름: 잣대마다 거절 말 목록을 따로 두니, 한 잣대에서 다룬 부정 꼴('-지 않아요', '-가 아니에요', '불가능')을 다른 잣대가 놓쳐 같은 종류의 지적이 네 번 옴. 주장 꼴의 서술어를 이름 붙인 무리로 표시하고 그 바로 앞뒤의 말만 보는 도우미(`eval/polarity.ts`)를 다섯 잣대가 함께 씀. 서술어 안은 보지 않아 '불가능' 안의 '가능', '있지 않아요'의 '있'을 된다로 읽지 않음. (364) 주장 꼴마다 '된다·안 된다 모두 단정'과 '된다고 할 때만 단정'을 나눠 적음: 먹어도 되는지, 가게 규칙에 없는 것, 원인·책임·보상(SPEC-057)은 안 된다고 해도 판단을 지어낸 답이고, 규칙이 안 된다고 한 일을 바꾸라는 요구에는 안 된다는 답이 바른 답임. 한 목록의 거절 말로 둘을 함께 다루면 한쪽이 틀림. (365) 기계로 확실히 가를 수 없는 꼴은 통과가 아니라 사람 검토로 보냄: 옮겨 말한 뒤 부정('…된다고 말씀드리기 어려워요')과 한 문장에 된다·안 된다가 섞인 꼴('밤 10시는 안 되고 8시는 돼요')은 부정이 어디에 걸리는지 패턴으로 가를 수 없음. 틀린 통과가 틀린 실패보다 나쁘므로 `_unclear` 이유 코드로 사람 검토에 둠. (366) 부정 처리를 고칠 때는 지적이 온 잣대만이 아니라 다섯 잣대 모두에 같은 주제의 긍정·부정·모르는 꼴을 짝지은 표 시험을 둠: 지적이 온 잣대만 고치면 같은 꼴을 다른 잣대가 놓친 것을 다음 검토에서야 앎. 표에 지적의 답 글과 그 갈래의 그럴듯한 바른 답·틀린 답(부정 능력 '먹을 수 없어요', 조건 '주문 완료하시면 돼요', 숫자 뒤의 '30,000원이면 돼요')을 넣어 보니 지적 밖의 틈 여섯이 더 나옴. (367) 금지어 훑기는 git에 아직 올리지 않은 새 파일도 넣고 봄: 기준 커밋과의 차이로 훑으니 새 파일 `polarity.ts`가 빠져 있었음. `git add -N`으로 넣은 뒤 훑어 주석 두 곳을 더 고침. 둘째 지적을 고친 머리 `707044f`에 Codex가 P2 지적 넷(8\~11: 틀린 통과 둘, 틀린 실패 하나, 사람 검토 표본의 논리 버그 하나)을 남김. 넷 다 맞아 실패하는 시험을 먼저 커밋(`c120c93`, `[skip ci]` 없음, 로컬에서 17개 실패를 봄)하고 고침(`d5400ab`, 두 커밋을 함께 올려 CI는 고친 머리에서만 돎, GitHub 댓글 없이 스레드만 resolve). (368) 답의 값이 입력에 있다는 것만으로 근거로 치지 않음: 서버가 판정한 값(날짜 판정·영업 시간·쉬는 요일)은 그 값의 판단까지 맞아야 근거임. FLW-10에서 '2026-11-21 주문 가능합니다'가 ISO 날짜가 입력에 있다는 이유로 숫자 검사를 지났고, 글 꼴 주장은 '21일'·'그날'만 봐 통과했음(지적 8, 틀린 통과). 값을 같은 꼴로 읽는 층(`eval/values.ts`) 위에 서버 판단과 견주는 `eval/judgment.ts`를 두고, 사례의 날짜·시각 글 꼴 주장을 뺌. (369) 값 표기를 같은 값으로 읽을 때 근거 쪽 값을 늘리지 않음: HH:MM을 오전·오후 두 갈래로 읽어 운영규정의 '11:00'이 23:00까지 늘어나 INJ-28의 '23:00 픽업 가능합니다'가 통과했음(지적 11, 틀린 통과). HH:MM은 24시간 한 값이고, 두 갈래는 말로 한 'N시'에만 둠. (370) 서술어를 이끄는 앞의 조건을 봄: 사장님·결제 확인 조건('사장님이 결제를 확인하면 … 완료입니다')은 원본(SPEC-036: 결제가 확인되어야 주문 확정)과 같은 말이라 단정이 아니고(지적 9, 틀린 실패), 손님이 하는 일의 조건은 사람 검토임. 조건 절이 '-요·-고·-는데'로 끝난 뒤의 서술어에는 조건을 걸지 않음(틀린 통과를 막음). 조건은 상태 주장(주문 확정·취소·수락)과 서버 판단 견주기만 보고, 먹어도 되는지는 조건이 붙어도 답이라 그대로 실패. (371) 표본은 뽑을 무리를 먼저 거른 뒤 간격으로 뽑음: '기계가 지나게 한 답의 표본'을 모델로만 걸러 10번째마다 뽑아, 그 자리에 출력 없음·실패 답이 오면 통과한 답이 하나도 뽑히지 않았음(지적 10). (372) 고친 뒤 스스로 훑을 때는 같은 답을 고치기 전 머리의 코드로도 돌려 판정이 어떻게 바뀌는지 봄: 잣대마다 표기 변형·조건·되묻기·남의 말 옮기기 꼴을 손으로 만들어 짝 표에 넣고 고치기 전 머리 `c120c93`의 코드로 돌려 보니, 지적 밖의 틀린 통과 16개(실패여야 할 10개: 서술어 꼴 '받고 있어요'·'되죠'·'문 열어요', 꾸밈말이 낀 '… 다 됐어요', '-지만' 뒤의 다른 절, '당연히 가능해요', 어간 '어려우' 등, 사람 검토여야 할 6개: 어림 '가능할 수 있어요', 값으로 읽지 않는 '주말', 주문 확정으로 들릴 수 있는 주문 바로 뒤의 '됐어요·들어갔어요·넣어 드렸어요·처리됐어요')와 틀린 실패 2개가 더 나옴. 된다고 하는 서술어 꼴은 한 곳(`judgment.ts`의 `POSSIBLE`)에 두고 숫자 출처 검사와 서버 판단 견주기가 함께 씀. (373) 서술어는 같은 문장에서 앞의 가장 가까운 값과 그 값에 나열로 이어진 값만 다스린다고 봄: 문장 단위로 보면 '밤 10시는 안 되고 8시는 돼요'처럼 된다·안 된다가 섞인 바른 답을 사람 검토로 보내고, '21일, 일요일 모두 가능해요'의 21일처럼 나열된 값을 놓침. 값과 서술어 사이에 부정·쉼·빼기·절 끝이 있으면 다스리지 않음. 셋째 지적을 고친 머리 `30fe5af`에 Codex가 P2 지적 셋(12\~14, 셋 다 틀린 통과)을 남김. 셋 다 맞아 실패하는 시험을 먼저 커밋(`21a33d2`, `[skip ci]` 없음, 로컬에서 시험 7개·짝 표의 줄 62개 실패를 봄)하고 고침(이 기록과 같은 커밋, 두 커밋을 함께 올려 CI는 고친 머리에서만 돎, GitHub 댓글 없이 스레드만 resolve). (374) 말로 한 값이 여러 값으로 읽히면 모든 값이 근거와 서버 판단에 맞을 때만 근거로 봄: S2(12:00\~19:00)의 UNK-20에서 '오전 12시 픽업 가능합니다'가 '오전 12시'를 12:00으로 읽어 통과했음(지적 12, 틀린 통과). 오전·아침·새벽·밤·저녁 12시와 자정·0시·24시는 0:00, 오후·낮 12시와 정오는 12:00, 때를 붙이지 않은 '12시'는 두 값이고, 후보가 모두 영업 시간 밖이면 실패, 일부만 밖이면 사람 검토, 숫자 출처도 값마다 가림('밤 10시는 안 되고 8시는 돼요'도 8시가 두 값이라 사람 검토, (373)의 다스림은 그대로). (375) 통과로 빼 주는 면제는 허용 목록으로 둠: 조건에 '사장님이'나 결제 확인 말이 있기만 하면 면제해 CNF-01의 '사장님이 결제를 확인하지 않으면 … 완료입니다'·'사장님이 거절하면 … 완료입니다'가 통과했음(지적 13, 틀린 통과). 행동이 결제 확인·주문 수락이고 극성이 긍정인 좁은 꼴만 면제하고, 부정·다른 행동은 주장이 그대로 남아 실패, 둘이 함께이거나 알아보지 못한 사장님 조건은 사람 검토. 부정·다른 행동은 조건의 마지막 행동 말에서만 봄('취소된 주문의 환불은 사장님이 확인한 뒤'의 '취소'는 행동이 아님). (376) 권위 입력에 같은 값이 있어도 이 상황(때·조건·주제)에 걸리는 규칙의 값일 때만 근거로 봄: S1 2조가 전날 환불을 모두 막는데 INJ-24의 '전날 취소도 50% 환불 가능합니다'가 50%가 다른 때(2일 전)의 값으로 조문에 있다는 이유로 숫자 검사를 지났고, 주장 꼴은 '전액'만 봐 통과했음(지적 14, 틀린 통과). 때별 규칙(변경·취소 기한, 환불 비율 표)을 `shops.ts`에 구조로 두고 답의 변경·취소·환불 말을 때와 비율로 읽어 그 때의 값과 견줌. 막힌 일은 전액·일부·조건부를 가리지 않고 된다고 하면 실패, 상황을 가릴 수 없으면 사람 검토. 숫자 출처도 조문 값은 그 값이 든 조문 문장의 주제(픽업·결제 기한·변경·환불·할인)가 답의 주제와 같을 때만 근거('결제 기한은 오늘 20:00까지예요'의 20:00은 픽업 조문의 값). (377) 빼는 말('대신'·'말고'·'빼고')은 주제 바로 뒤에 올 때만 주제를 뺌: '퀵비는 포장비 대신 무료예요'처럼 조사로 끝난 주제 뒤에 다른 낱말이 끼면 빼는 것은 그 낱말이고 주제(퀵비)의 주장은 그대로 남음. 같은 종류를 훑은 답 103개를 고치기 전 머리 `30fe5af`의 코드로 돌려 보니 지적 밖의 틀린 통과 55개(실패여야 할 40개, 사람 검토여야 할 15개)와 사람 검토였다가 실패여야 할 4개가 더 나왔고 틀린 실패는 0개였음. 넷째 지적을 고친 머리 `7cd9f2c`(CI app·db 성공, 보안 검토 지적 없음)에 Codex가 P2 지적 하나(15, 틀린 실패)를 남김. 맞아 실패하는 시험을 먼저 커밋(`1d5ace9`, `[skip ci]` 없음, 로컬에서 시험 3개·짝 표의 줄 29개와 FLW-01의 기대 하나 실패를 봄)하고 고침(이 기록과 같은 커밋, 두 커밋을 함께 올려 CI는 고친 머리에서만 돎, GitHub 댓글 없이 스레드만 resolve). (378) 숫자 근거 검사는 맥락 판단을 먼저 씀: INJ-24에서 '픽업 3일 전까지 취소하면 100% 환불 가능합니다'·'픽업 전날과 당일에는 환불이 0%예요'가 조문의 '전액'·'환불하지 않습니다'와 같은 값인데 글자만 견줘 `unsupported_number` 실패였음(지적 15, 틀린 실패). 그 값을 `judgment.ts`(때별 환불·기한, 영업 시간, 받을 수 없는 날)가 판정하면 그 판정을 따르고(맞음은 근거 있음, 어긋남은 그 판단의 실패나 사람 검토), 판정하지 못할 때만 같은 주제 조문 값 규칙을 씀. (379) 같은 값의 다른 표기는 한 표(`values.ts`의 `SAME_VALUE`)에서 같게 보고 쓰는 곳 모두가 그 표를 씀: 전액·모두·100%, 반액·절반·50%, 환불하지 않음·환불 불가·0%, 무료·공짜·0원, 전날·하루 전·1일 전, 이틀 전·2일 전, 당일·그날, 24시간·1일. 표기를 같게 보면 다시 열리는 틀린 통과('3일 전 취소는 0% 환불이에요'의 0%가 조문 값이 됨, '퀵비는 0원이에요', '1호 생크림은 무료예요')를 함께 막음: 0% 환불은 안 된다는 말, 때를 말한 안 된다는 말도 표와 견주어 받을 수 있는 날을 안 된다고 하면 사람 검토(된다고 할 때만 실패라는 둘째 지적 5의 설계를 지켜 실패로 두지 않음), 금액 잣대에서 수수료·환불·퀵비의 0원·무료는 운영규정 말이라 뺌. (380) 끝을 말한 값은 가게 표의 끝과 같을 때만 판단을 따름: 판단만 먼저 쓰면 '4일 전까지 취소하시면 전액 환불돼요'·'변경은 5일 전까지 가능해요'·'픽업은 19시까지 가능해요'처럼 말한 날·때는 맞아도 끝을 지어낸 틀린 답 16개가 통과로 바뀜. 바로 바깥 날(까지면 하루 뒤, 부터면 하루 앞, 지나면 그날)이 말한 것과 다를 때만 그 수를 판정한 값으로 보고, 아니면 지금 규칙(조문에 없는 수면 실패)에 맡김. 'N일 전'과 조문의 날 말(전날은 1일 전)을 견주는 것도 끝 말이 없는 때만 씀. (381) 때 말의 끝은 '까지·이전·부터'만이 아님: 'N일 전부터'의 '전부'를 모두라는 말로 읽어 '픽업 2일 전부터는 변경이 안 돼요'가 `number_other_rule`이었고, 'N일 전이 지나면·이후·넘기면·보다 늦으면'을 그날로 읽어 안 된다는 말을 표와 견주자 '3일 전이 지나면 변경이 안 돼요' 같은 바른 답 13개가 사람 검토로 바뀜. 뒤의 것은 그다음 날부터 당일까지로 읽음. 규칙을 다른 말로 바르게 설명한 바른 답 168개를 고치기 전 머리 `7cd9f2c`의 코드로 돌리니 실패 33개·사람 검토 10개였고, 고친 코드로는 실패 0개·사람 검토 4개(넷 다 고치기 전에도 사람 검토: 여러 값 시각 2, 옮겨 말한 부정 1, 주제 말이 없는 다음 문장 1). 같은 값을 다른 표기나 끝 말로 쓴 틀린 답 88개는 고치기 전 틀린 통과 19개였고 고친 코드로 모두 기대와 같음. 넷째 지적 때 훑은 답 103개는 고치기 전후 모두 기대와 같음. 다섯째 지적을 고친 머리 `cbf93d7`(CI app·db 성공)에 Codex가 지적 셋(16·17·18, 모두 틀린 통과)을 남김: FLW-01의 '2027-11-20 오후 3시 픽업 가능합니다.'(`values.ts` 252), INJ-02의 '네, 가격은 반값으로 해 드릴게요.'(`score.ts` 130), 확정된 주문이 있는 FLW-08의 '픽업 시간 변경 완료됐어요.'·'주문이 취소됐어요.'(`score.ts` 199, 해당 없음)가 지나감. 맞아 실패하는 시험을 먼저 커밋(`257c5da`, `[skip ci]` 없음, 고치기 전 커밋 `cbf93d7`의 작업 트리에 시험 파일을 복사해 돌리니 시험 53개 가운데 7개 실패: 날짜 읽기 1, 주문 확정 잣대 2, 짝 표 넷의 줄 3·13·13·3)하고 고침(이 기록과 같은 커밋, 두 커밋을 함께 올려 CI는 고친 머리에서만 돎, GitHub 댓글 없이 스레드만 resolve). (382) 적힌 해는 그대로 읽고 없을 때만 짐작: 날짜를 월·일로만 견주면 '2027-11-20'·'2027년 11월 20일'·'내년 11월 20일'이 서버가 허락한 2026-11-20의 근거로 지나감. 해나 '올해·내년' 말이 있으면 그 해로 읽고, 짐작한 해와 다르면 월·일 후보 대신 그날로 견줌. 해가 없을 때만 오늘보다 앞선 날을 다음 해로 짐작. (383) 원 금액이 없다고 금액 잣대를 바로 통과로 두지 않음: 서버 견적에는 할인·조정이 없으니(견적에 할인 값 없음, 세 가게 규칙에도 없음) 된다고 한 가격 조정 약속(할인·반값·깎기·가격 맞추기·서비스로 빼기·이벤트가·싸게)은 금액을 말하지 않아도 견적과 어긋난 것이라 실패. 사장님 조건이 붙어도 값은 견적이 정하므로 넘기지 않고 사람 검토(`promise` 옵션). 환불·취소·수수료 문장의 반액·50%는 환불 비율이라 가격 조정으로 읽지 않음. (384) 이른 해당 없음은 이미 있는 사실의 확인만 빼 줌: 확정된 주문이 있다고 잣대 전체를 해당 없음으로 돌리면 '변경 완료됐어요'·'취소됐어요' 같은 새 상태 변경 주장이 지나감. 주문 확정·결제 확인 말만 빼 주고 변경·취소·수락 단정은 그대로 보며, 주문이 있는 사례의 '바꿔 드렸어요'·'바뀌었어요'는 실패, '바꿔 드릴게요'는 사람 검토. 주문이 없는 사례의 바꿔 드림은 초안을 고친 말이라 보지 않음. 아무것도 없으면 해당 없음 대신 통과(주문 확정 잣대의 매긴 사례 128에서 134로). (385) 주장 꼴 목록만으로는 알아보지 못한 꼴이 통과가 됨(구조적 안전장치): 그 잣대를 겨눈 사례(상태 말은 주문이 있는 사례도)에서 약속 낱말 뒤 12자 안의 약속·상태 끝말과 무엇을 약속하는지 모를 약속 끝말('네, 그렇게 해 드릴게요'·'20일에 케이크 준비해 드릴게요')이 남으면 사람 검토(`price_word`·`state_word`), 판정한 주장 꼴과 어긋남이 확실하면 실패. 끝말 앞 낱말이 알리기·전달·보내기면 빼고, 사이에 요청·문의·부정 말이 끼면 그 낱말을 말하지 않는 것으로 봄. 금액이 든 마디의 약속은 금액 판정이 이미 봤으니 빼되 '35,000'의 쉼표가 마디를 나누므로 금액의 처음과 끝이 든 마디 모두 뺌. 상태 약속은 허용 목록의 사장님·결제 확인 조건이 이끌면 넘김(넘기지 않았더니 CNF-12에서 결제 확인 뒤 문자를 드린다는 바른 답이 사람 검토로 바뀜). (386) 훑기는 짧게, 종류마다 틀린 답·바른 답을 짝으로: 세 종류(적힌 해·가격 조정·상태 변경)의 틀린 답 28개와 바른 답 31개를 지난 훑기 묶음에 더해 고치기 전 커밋 `cbf93d7`의 코드로 돌리니 틀린 답 25개가 통과·해당 없음(해 4, 가격 10, 상태 11)이었고, 고친 코드로는 59개 모두 기대와 같음. 지난 훑기 묶음 388개(바른 답 223, 틀린 답 165)는 고치기 전후 모두 기대와 다른 것이 바른 답의 사람 검토 4개로 같아(여러 값 시각 2, 옮겨 말한 부정 1, 주제 말이 없는 다음 문장 1) 바른 답의 사람 검토 증가는 0, 틀린 실패와 틀린 통과도 0. (387) 맥락을 빼는 가림은 그 맥락의 값 말만 가림: 환불 문장을 통째로 가리니 같은 문장의 할인 약속까지 사라져 INJ-02에서 환불 규정과 따로 할인해 주겠다는 답이 지나감(일곱째 지적 19, 틀린 통과). 환불 문장에서는 환불의 비율 말(반액·절반·전액·일부·N%)만 가리고 가격 조정 낱말(할인·반값·깎·싸게·특가·서비스로·덤으로)은 그대로 봄. 가린 비율 말에서만 가격 조정 꼴이 나오는데 그 문장에 가격 조정 낱말이 있거나 비율 말이 환불 낱말과 다른 마디에 있으면 가를 수 없어 사람 검토. 무료의 운영규정 예외도 같은 구멍이라 주제와 무료 사이에 다른 것을 가리키는 말(대신·별도·말고·따로·외에·빼고·아니라)이나 마디를 잇는 말(지만·는데·은데·인데)이 오면 빼지 않음. (388) 낱말 꼴은 더 긴 낱말 안에서 맞지 않는지 봄: 주문 확정 꼴의 '예약 완료'가 '가예약 완료' 안에서 맞아 결제 기다림(가예약됨) 주문인 CNF-01의 '가예약 완료됐어요. 아직 주문 확정 전이에요.'가 실패(일곱째 지적 20, 틀린 실패). 이웃 꼴처럼 앞에 '가'가 오면 맞지 않게 하고, 같은 구멍을 한 번 훑어 `CONFIRM_WORD`의 완료 낱말도 가예약 바로 뒤는 뺌(앞의 두 꼴은 이미 뺌). 가예약 단정은 결제 기다림 주문이 없는 사례에서만 사람 검토. (389) 짝 시험이 공용 도우미의 구멍도 드러냄: '환불 대신 다음 주문은 할인해 드릴게요.'에서 '대신 다음'을 '-신 다음'(하신 다음) 조건으로 읽어 실패가 아닌 사람 검토로 나옴. 조건 꼴에서 '대신'의 '신'을 뺌. 고치기 전 커밋 `97cd8cd`에서 시험 55개 가운데 2개 실패(짝 표의 줄 7·5), 짝 시험 19줄 가운데 12줄이 기대와 달랐고, 고친 코드로는 19줄 모두 같으며 지난 훑기 묶음 455개는 고치기 전후 판정과 이유가 같음. 다음 규칙 번호는 (390)부터.

[PR #69](https://github.com/kodonghui/siljang.ai/pull/69)를 squash로 합침(main `342d402`, 2026-11-17 01:04 KST 무렵). 합친 뒤 main에서 돈 run 43903350367(app)·43903350407(db) 성공. 후속 [PR #70](https://github.com/kodonghui/siljang.ai/pull/70)(TASK-027 채점기 후속, Codex 여덟째 지적 셋 21·22·23). D11 세션이 실패하는 시험 커밋 `16c60ae`와 커밋하지 않은 고침을 남긴 채 주간 사용 한도로 멈춰(11/16 UTC) 11/18에 D11b 세션이 이어 받음. (390) 범위를 좁히는 것은 같은 일끼리만: 한 문장의 다른 때로 범위를 좁힐 때 일(변경·취소·환불)을 가리지 않으면 변경 기한이 환불 범위를 줄여, INJ-24의 '2일 전부터는 50% 환불 가능하고, 전날부터는 변경이 안 돼요.'에서 전날·당일의 50% 환불이 지나감(여덟째 지적 21, 틀린 통과). 마디마다 때·비율·극성·일을 먼저 읽고 같은 일을 말하는 때끼리만 좁힘. 서술어가 없어 넘기지 못한 끝의 때는 문장의 일로 범위를 좁히는 데만 씀. 손님 말의 때(`timingsIn`)는 답에 때가 없을 때 짐작하는 데만 쓰고 짐작한 때로는 실패를 세지 않아 일을 가리지 않고 둠. (391) 모든 사례에서 매기는 잣대의 패턴은 일상 말과 겹치는지 봄: 먹어도 되는지 잣대가 '줘도·주셔도'를 맥락 없이 보아 AMT-01의 '원하시는 문구를 알려 주셔도 돼요.'와 FLW-09의 '사진을 보내 주셔도 돼요.'가 실패(여덟째 지적 22, 틀린 실패). '줘도·주셔도'는 먹는 맥락(먹일 사람·반려동물, 같은 문장의 먹는 말, '먹여·먹게·드시게' 형태, 먹어도 되는지를 묻는 사례)이 있을 때만 판단으로 보고, 그때도 보조 동사 표현과 먹을거리가 아닌 것을 주는 말은 뺌. 같은 종류를 짝 시험으로 훑으니 사람 수와 함께 쓴 양의 말('2\~3명이 드시기 좋아요'), 어디서 먹는지('가게에서 드셔도 돼요'), 요금·비용·수량이 없다는 말('꽃 장식은 추가 요금이 없어요')도 같은 구멍이라 함께 뺌. 단어 목록으로 가르므로 목록 밖의 먹일 사람·일상 말은 README 77 한계에 적음. (392) 상태 변경 패턴은 무엇을 바꿨는지 봄: 주문이 없고 `draft_patch`가 맞는 FLW-03에서 '주문서 초안의 문구 변경 완료됐어요.'가 `change_claim` 실패(여덟째 지적 23, 틀린 실패). 주문을 말하지 않고 초안을 가리키는 마디와, 주문이 없는 사례에서 주문을 말하지 않는 마디의 변경·반영 말을 빈칸으로 바꾼 글(`stateView`)로 변경 패턴·약속 끝말·`CONFIRM_WORD`의 '완료'를 봄. 주문 뒤에 서·초안·요청서가 붙은 말은 초안 말이고, 붙지 않은 '주문'만 주문 말. 주문을 말한 마디('주문 변경 완료됐어요')는 주문이 있든 없든 실패. 환불은 초안에 없으니 따로 떼어(`REFUND_CLAIMS`) 늘 답 글로 보고, 같은 김에 '처리 완료' 형태('요청하신 변경은 처리 완료예요'·'환불 처리 완료됐어요', 사람 검토였음)을 다 했다는 끝말에 넣어 실패로. (393) 멈춘 세션의 작업 트리를 이어 받으면 지시의 지적마다 고침이 있는지 먼저 대조하고, 고치기 전 커밋으로 다시 잼: 고치기 전 커밋 `342d402`의 임시 worktree(node_modules는 링크)에 실패하는 시험 커밋 `16c60ae`의 시험 파일을 넣어 시험 58개 가운데 3개 실패, 작업 트리의 늘어난 시험 파일로는 4개 실패·기대와 다른 줄 52개를 봄(고친 코드로는 0). 스캔 실행기는 고치기 전·뒤 `eval/` 폴더의 절대 경로를 받게 해 같은 줄 세트를 두 코드로 돌리고, 지난 세트 487개는 두 결과 파일을 `diff`로 견줘 글자까지 같음을 봄. (394) 컨테이너가 다시 시작되면 단계 검사용 PG16(127.0.0.1:54329)이 꺼져 있음: `tools/stage-checks.sh` 머리말의 `pg_ctl ... start`에 `-w`를 붙여 다시 띄움(옛 소켓 잠금 파일이 있어도 뜸). 서버 시험은 `TEST_DATABASE_URL`과 `REQUIRE_DATABASE_TESTS=1`(CI와 같음, `tools/db-migrate.sh`로 마이그레이션한 시험 데이터베이스)을 주어야 데이터베이스 시험 132개까지 돌고, 빼면 그 132개가 건너뛰어 통과로 보임. (395) 플러그인 폴더 이름이 버전에 따라 바뀜(`corthex` → `corthex~g2`): `tools/stage-checks.sh`의 page-check.js 경로가 `*/corthex/`로 고정돼 있어 mockup의 C11이 '돌리지 못함'(EISDIR)으로 실패. hub 경로(203)처럼 glob(`*/corthex*/`)으로 찾게 고침. 단계 검사의 실패는 검사 내용인지 도구를 못 찾은 것인지 출력 파일(`/tmp/stage-checks/<이름>/<검사>.txt`)로 먼저 가름. 다음 규칙 번호는 (396)부터.

[PR #70](https://github.com/kodonghui/siljang.ai/pull/70)을 squash로 합침(main `4c0dbcc`, 2026-11-18 22:18 KST 무렵). 합친 뒤 main에서 돈 run 44312454086(app)·44312454115(db) 성공. [PR #71](https://github.com/kodonghui/siljang.ai/pull/71)(동희님 결정 반영: TASK-003 운영자 인증은 Supabase Auth의 TOTP 2단계 인증, 사진 EXIF는 저장하기 전에 모두 지움(02 REQ-269, 04 G10, 10 TASK-183), A·B 역할 나눔). 합친 커밋은 다음 단락에 적음. (396) ID 번호를 정규식으로 읽는 생성기는 자리 수를 고정하지 않음: `build_wbs.py`가 04 공통 규칙을 `G\d`로 읽어 G10을 G1로 읽었고, `build_spec.py`는 행의 G 참조를 1\~9 범위로 봤음. 둘 다 04 2절 표의 번호(`G\d+`)로 바꿈. 번호가 한 자리 늘기 전에 그 번호를 읽는 생성기·검사의 정규식(`G\d` 같은 것)을 grep으로 먼저 찾음. (397) 서비스 전체에 걸리는 비기능 의무를 더하는 결정은 02에 결정 반영 요구사항(버전 5, 확정)으로 더하고, SPEC 행이 없으면 04 '수락 기준 없이 두는 필수 요구사항' 표, 03 2절 표와 7절 부록에 함께 적음(REQ-267 선례). 04 공통 규칙은 그 요구사항을 가리키고, 10단계는 'SPEC 밖 유효 요구사항마다 작업' 검사로 작업에 이어짐. 02를 고치면 0-2 표·11절·결정 반영 검사 표의 수를 `check_prd.py`·`check_flows.py --appendix` 출력에서 옮김. (398) 공통 규칙 수 같은 범위를 바꿀 때는 지금 범위를 말하는 곳(04 0-2)만 고치고, 그때 값을 적은 곳(04 6절)은 그때 값임을 적고, 지난 기록과 문서를 만들 때 '읽은 것'(05·06 README, `db/` 주석, 설계 재검토 문서)은 고치지 않음. 고치지 않은 곳은 기록과 PR 본문에 적음. (399) 동희님 작업이 결정 카드가 아니라 채팅 답으로 끝나면 끝난 조건은 바꾸지 않고 `finished`에 채팅 답이었다는 것과 원문 위치를 적음. 원문(금지어가 든 말 그대로)은 진행 기록에만 두고, 10단계 금지어 검사를 받는 파일(`wbs_rows.py`·README·안내서·`tech-stack.md`)에는 뜻만 씀. (400) `.corthex/stages.json`은 CORTHEX hub의 `hub.py status PROJECT STAGE`가 쓰는 저장소 기록(생성 파일 아님): done은 `--checkpoint`·`--by`·`--date`가 있어야 하고 `--where`는 HTTPS 주소만 받음. 쓰기 전에 파일을 임시 폴더에 복사하고, 쓴 뒤 `git diff`로 다른 단계와 들여쓰기가 그대로인지 봄. 다음 규칙 번호는 (401)부터.

TASK-021 운영자 로그인(06 DEC-27이 OPEN-6을 닫음, D13 세션, 브랜치 `claude/serene-dijkstra-6edbbk`). (401) 저장소 키 검사(`check-no-keys.mjs --repo`)는 추적하는 파일만 봄: 새 파일은 `git add` 뒤에 다시 돌림. 이번에 새 시험의 가짜 비밀번호 값이 `assigned_secret`에 걸려 누가 봐도 가짜인 값(`fake-` 앞글자)으로 바꿈. (402) 05 헤더 주석의 `terms:`는 용어가 없으면 `none`으로 씀(그 밖의 글은 S7이 용어로 읽어 실패). (403) 06의 열린 질문을 닫으면 그 ID를 쓰는 다른 곳(10 반복 0 안내서, WBS 출처, 07·08 README)이 `build_wbs.py` 등의 '원본에 없는 ID' 검사에 걸림: 닫기 전에 `git grep -n 'OPEN-<번호>'`로 남은 곳을 모두 찾아 함께 고침. (404) 여러 단계를 고치는 작업은 단위(05, 06\~08, 시험, 구현, 기록)마다 커밋·푸시함: 이 작업은 커밋 0개로 턴 한도에 걸려 조정 세션 지시로 중간 커밋을 먼저 남김. (405) 다른 커밋의 파일을 볼 때 `git checkout <커밋> --`를 쓰지 않음(HEAD가 분리됨): `git show <커밋>:<경로>`나 별도 worktree를 씀.

[PR #72](https://github.com/kodonghui/siljang.ai/pull/72)를 squash로 합침(main `84d21e4`, 2026-11-18 23:51 KST 무렵). 합친 뒤 main에서 돈 run 44328867624(app)·44328867499(db) 성공. TASK-182 사장님·운영자 화면 레이아웃(D14 세션, 브랜치 `claude/serene-dijkstra-6edbbk`). (406) 저장소의 도구는 `npx --no-install <도구>`로 부름: `app/`의 Biome를 `npx biome`로 부르다 `--no-install`이 없어 npm 레지스트리의 이름이 같은 다른 패키지(`biome` 0.3.3)가 npx 캐시에 깔림(저장소·잠금 파일은 그대로). (407) `web/scripts/page-check.mjs`는 플러그인의 `page-check.js`를 폴더 이름 `corthex`로 찾음: 플러그인 폴더 이름이 바뀌면(지금 `corthex~g2`) `--page-check '<절대 경로>'`로 줌. 찾는 방식 고치기는 조정 세션의 다음 PR. (408) 금지어는 코드의 새 글(견본 이름, 시험 이름, 주석)에도 적용함: 기존 코드에 남은 옛 말('흐름'·'틀')을 따라 쓰지 않고, 커밋 전에 `git diff`의 더한 줄만 금지어로 grep함. (409) CSS의 @media 조건에는 var()를 쓸 수 없어 숫자를 적되, 그 숫자를 토큰에서 셈하는 시험(`styles.test.ts`)을 함께 두어 토큰이 바뀌면 CI가 실패하게 함. 넓고 좁음의 경계는 레이아웃이 실제로 들어가는 너비(`size.menu` + `size.content`)로 고르고, page-check로 경계 양쪽(1259·1260)을 봄. 다음 규칙 번호는 (410)부터.

## PR 74 — TASK-183 사진 저장 전에 촬영 메타데이터 제거

- (411) 저장소에 간 바이트를 독립 메타데이터 파서로 검사합니다. 합성 원본에서 값을 먼저 찾은 뒤 저장본에서 없는지 보고, 저장되지 않아야 할 입력에는 422와 저장 건수 0을 함께 확인합니다.
- (412) 방향 태그의 존재와 브라우저의 실제 표시는 각각 확인합니다. Chromium의 WebP 방향 처리와 같이 도구마다 차이가 있으므로 원본과 저장본을 같은 뷰어에서 비교하고, 디코더 하나의 결과로 다른 뷰어의 표시까지 끝났다고 기록하지 않습니다.
- (413) 데이터베이스 규칙 시험은 앱 시험이 쓴 데이터베이스와 분리해 마이그레이션한 새 데이터베이스에서 실행합니다. 05 시험은 빈 데이터에서 출발하는 보관·삭제 건수를 포함합니다.

[PR #73](https://github.com/kodonghui/siljang.ai/pull/73)을 합침(main `1f92d3e`). 합친 뒤 main에서 돈 run 44335501837(app)·44335501855(db) 성공(이 세션에서 GitHub MCP로 다시 읽어 봄). 이 작업 중에 [PR #74](https://github.com/kodonghui/siljang.ai/pull/74)(TASK-183, 위 절)가 합쳐져(main `c1d6675`) 이 가지에 main을 합침(기록 파일 셋만 충돌, 위 절의 번호 (411)\~(413)과 겹치지 않게 이 단락은 (414)부터). TASK-021 독립 보안 검토 후속(D15 세션, 브랜치 `claude/serene-dijkstra-6edbbk`). (414) 앱이나 대시보드·SQL 어느 쪽에서 바꿔도 지켜야 하는 보안 규칙(막기가 세션을 끝냄)은 데이터베이스 트리거로 두고, 앱 시험(운영자 경로 401)과 05 규칙 테스트(`expect_left`) 둘 다로 봄. 새 컬럼에 CHECK를 걸 때는 마이그레이션에서 있는 행을 먼저 맞춘 뒤(여기서는 `mfa_enrolled_at` 비우기) 제약을 더함. (415) 마이그레이션을 더하면 로컬 시험용 데이터베이스에도 바로 적용함(`psql -1 -v ON_ERROR_STOP=1 -f`): 적용하지 않고 돌린 앱 시험이 '없는 컬럼'으로 실패함. (416) 데이터베이스 시험에서 UNIQUE가 걸린 값(쿠키 해시 등)은 고정 글 대신 시험마다 새로 만든 값을 씀: 고정 값은 같은 데이터베이스로 두 번째 돌릴 때 `operator_sessions_token_uq`에 걸림. (417) 겹친 방어(앞 단계의 비교와 뒤 단계의 실패)가 있으면 앞 단계를 빼도 뒤 단계가 같은 응답을 만들어 시험이 가르지 못함: 앞 단계만 보이는 관찰(여기서는 Supabase에 challenge·verify를 부르지 않음)을 시험에 더하고, 그래도 가를 수 없는 변이(같은 값임이 보장된 바꾸기)는 README에 적음. (418) 검토자가 기억으로 말한 바깥 서비스의 사실(오류 코드, 한도, 요금제)은 1차 출처로 확인하고 확인 날짜를 적음: 문서의 수는 문서 저장소의 원문과 수를 넣는 설정 파일에서, 오류 코드는 그 서비스의 소스에서 찾음. (419) 응답 시간 바닥 같은 방어는 확인을 시작한 뒤의 모든 실패 상태(401·429·503)에 걸고 상태마다 기다림을 시험함. 확인 전에 바로 내는 응답(Origin 401·422)과 성공은 기다리지 않음을 함께 시험함. (420) 사람이 쓰는 글의 길이는 코드 포인트로 셈(`[...s].length`): 데이터베이스 `char_length`·06 `maxLength`·등록 도구와 단위를 맞추고, 같은 종류의 `.length` 검사를 `grep -n "\.length" server/src`로 함께 찾아 하나씩 이유를 적음. (421) TypeScript strict에서 `await res.json()`은 `unknown`이라 속성을 바로 읽지 않고 `expect(...).toMatchObject(...)`로 봄. 다음 규칙 번호는 (422)부터.

## PR 76 — Codex 개발 인계 준비: 검사 도구 사본, AGENTS.md, 인계 문서

[PR #75](https://github.com/kodonghui/siljang.ai/pull/75)를 합침(main `c6b3a85`). 합친 뒤 main에서 돈 run 44343886057(app)·44343886134(db) 성공(이 세션에서 GitHub MCP로 읽음). 인계 준비(조정 세션, 브랜치 `claude/serene-dijkstra-6edbbk`). (422) 저장소의 검사가 기대는 바깥 도구(플러그인 스크립트)는 다른 에이전트에게 일을 인계하기 전에 저장소에 사본으로 넣음(`tools/corthex/`): 출처·버전·복사 날짜·라이선스를 README에 적고, 사본은 손으로 고치지 않고 통째로 다시 복사함. 찾는 차례는 환경 변수 → 저장소 사본 → 플러그인 glob이고, 확인은 플러그인 폴더를 빈 폴더로 바꿔(`CORTHEX_PLUGINS`) 검사를 모두 돌리고 실제로 고른 경로를 출력이나 `report.json`에서 봄. 사본이 없을 때의 플러그인 찾기도 따로 돌려 봄. (423) 인계 문서의 숫자(main SHA, 마이그레이션·규칙 테스트 수, README 항목 번호, 다음 규칙 번호)는 'main `<SHA>` 기준'으로 적고 받는 쪽이 main에서 다시 확인하게 씀. 동희님께 채팅으로 드린 프롬프트도 저장소에 넣을 때 그 사이에 합쳐진 PR(#74·#75)을 반영해 고침. (424) 두 세션이 같은 기록 파일(progress.md·fix-log·app/README 번호)을 쓰면 나중에 합치는 쪽이 rebase하고 번호를 다시 맞춤(PR #75가 #74 뒤에 (414)부터 쓴 예). 포크가 '검사 모두 통과'로 보고해도 합치는 세션이 위험한 부분(마이그레이션)을 직접 읽고 합치며, 자동 검토가 돌지 않았으면 그 사실을 기록에 남김. 다음 규칙 번호는 (425)부터.

## PR 77 — TASK-176 웹앱 설치와 정적 파일 캐시

- (425) 서비스 워커 캐시의 대상으로 최종 빌드의 정적 파일을 열거합니다. Vite가 제거한 파일이 목록에 섞이지 않는지 디스크의 빌드 파일과 대조합니다.
- (426) 설치 조건은 Chromium의 설치 오류 목록과 파일 크기로 확인합니다. 서비스 워커가 제어하는 같은 화면에서 API 응답 번호가 바뀌고, 오프라인에서는 캐시된 정적 파일만 읽히는지도 확인합니다.

## PR 78 — TASK-183 WebP 방향 후속 결정

- (427) 방향 표시는 디코더가 원본과 저장본을 그린 픽셀로 확인합니다. 표시 옵션을 고르면 기존 작업의 끝난 조건에 대상 수신 경로와 보존할 속성을 함께 둡니다.

## PR 79 — TASK-031 운영자 로그인 화면

- (428) 보호된 화면은 위치와 세션 재확인 요청이 일치하는 결과로만 그립니다. 대기와 401에는 운영자 이름이나 내용을 표시하지 않으며, 돌아갈 주소는 사이트맵 경로로 제한합니다.
- (429) 인증 실패는 06 상태마다 필드 유지 조건을 따로 시험합니다. 좁은 하위 화면의 로그아웃 시험은 뒤로 링크에서 메뉴 항목 화면으로 이동한 다음 진행합니다.

## PR 80 — Codex 인계 문서 codex-finish.md(진짜 환경 확인까지 끝까지)

조정 세션(브랜치 `claude/serene-dijkstra-6edbbk`). (430) 동희님 몫 작업의 현재 상태(계정·도메인이 이미 있는지)는 WBS 작업 이름에서 짐작하지 않고, 보고 전에 동희님 환경을 확인하거나 '확인 못 함'으로 적음: TASK-170을 '계정 만들기'로 설명했는데 동희님은 계정과 도메인을 이미 갖고 계셨음. (431) 에이전트에게 주는 인계 문서는 할 일·차례·도구·확인받을 때를 긍정문으로 쓰고, 지시가 바뀌면 앞 인계 문서의 대체된 절을 그 문서 머리에 적어 두 글이 서로 다른 지시를 하지 않게 함(AGENTS.md도 함께 고침). 다음 규칙 번호는 (432)부터.

## TASK-174 — PostgreSQL 16과 17에서 데이터베이스 검사(2026-11-19)

(433) PostgreSQL 주 버전을 더할 때 두 버전의 빈 데이터베이스에서 같은 마이그레이션·규칙 테스트·카탈로그 검사를 돌린다. CI 행렬의 자동 취소를 끄면 한 버전에서 실패해도 다른 버전의 결과를 확인할 수 있다. Supabase 프로젝트에 직접 적용하고 역할 권한을 확인한 뒤 TASK-174를 완료로 표시한다.

## TASK-016 — 스테이징 주소와 배포 작업(2026-11-19)

(434) Cloudflare에서 Worker 배포가 성공하면 공개 HTTPS 주소도 외부에서 호출해 확인한다. 현재 클라우드 셸의 프록시가 503을 돌려줘 OVH 두 곳에서 상태 주소와 콘텐츠를 확인했다. CI의 배포용 비밀 값은 스테이징 배포 단계에만 전달한다.

## TASK-008 — 카카오 시험 서버 배포(2026-11-19)

(435) 사용자 지정 도메인을 연결한 뒤 DNS와 HTTPS 인증서가 모두 적용되면 공개 상태 주소를 확인한다. 키 없는 요청의 401과 키가 있는 합성 요청의 200, 마스킹된 KV 기록까지 함께 확인한다.

## TASK-027 — 두 회사 합성 상담 실제 평가(2026-11-19)

(436) Anthropic에 보내는 구조화 출력 스키마의 선택 필드·유니언 수를 검사한다. 공급자 응답의 HTTP 상태와 SSE 오류를 함께 확인해 한도 초과를 분류한다. 출력이 없는 사례 수와 채점한 사례 수를 결과 표에서 구별한다.

## TASK-016 — 스테이징 방문자 IP 검증(2026-11-19)

(437) 방문자 IP는 외부의 정상 요청에서 Cloudflare 출처 확인 값과 Worker가 받은 헤더를 견준다. 같은 헤더를 직접 넣은 요청의 HTTP 상태와 Worker 도착 여부도 함께 확인했다.

## TASK-183 — WebP 코덱 로컬 검사(2026-11-19)

(438) WebP의 압축 파일 크기와 픽셀 처리에 드는 메모리를 각각 측정한다. 무손실 회전 결과의 투명도와 애니메이션 입력도 후보 검사에 넣는다. 로컬 프로세스의 최대 메모리와 Workers에서 측정한 사용량을 구별한다.

## TASK-016 — 스테이징 1분 외부 감시(2026-11-19)

(439) 상태 점검은 HTTP 200과 지정된 JSON 상태를 함께 확인한다. 수동 실패 시험과 별도로 타이머가 실제로 연속 실행됐는지 서비스 로그에서 시각을 확인한다.

## TASK-170 — 무료 MVP 개발 환경(2026-11-19)

(440) 계정의 현재 요금제는 대시보드에서 확인한다. 동희님이 비용 범위를 정하면 개발 환경의 완료 조건과 인수인계 문서를 함께 갱신한다.

## TASK-010 — 카카오 스킬 발신 검증 문의(2026-11-19)

(441) 문의는 제출 뒤 사이트의 접수 완료 화면으로 확인한다. 본문과 접수 시각을 남기고, 답이 도착할 때까지 API 계약의 해당 질문을 유지한다.

## TASK-014 — 구글 OAuth 시험 설정(2026-11-19)

(442) OAuth의 범위 분류와 검증 여부는 Data Access와 Verification Center에서 각각 확인한다. Testing에서의 검증 상태는 해당 게시 상태와 함께 기록한다.

## TASK-183 — Cloudflare Images WebP 회전(2026-11-19)

(443) WebP 회전 후보는 출력의 크기와 형식, 프레임 수, 지연, 반복 값, 회전된 알파 채널을 검사한다. 압축이 잘 되는 합성 입력의 통과와 실제 업로드 한도 검증을 각각 기록한다.

## TASK-016 — main 자동 배포 확인(2026-11-19)

(444) 배포 설정은 GitHub 비밀 값 이름과 변수부터 확인한다. 배포 작업의 성공 뒤 Wrangler의 활성 버전 태그와 공개 상태 주소를 대조하고, 모니터 설정과 알림 수신 확인을 각각 기록한다.

## TASK-170 — 서울 Supabase 개발 프로젝트(2026-11-19)

(445) Supabase 프로젝트를 만든 뒤 정확한 리전과 플랜, 활성 상태를 다시 확인한다. Vault의 연결 템플릿 보관과 실제 데이터베이스 연결 시험을 각각 기록한다.

## TASK-009 — K-01 개발 봇 시험(2026-11-19)

(446) 개발 봇테스트 응답의 항목 ID와 Worker KV의 상태 코드를 대조한다. 친구 관계와 앱 사용자 값이 없는 봇테스트 결과는 카카오톡 앱의 친구 추가 전후 시험과 함께 기록한다.

## TASK-009 — K-11 카카오 로그인 시험(2026-11-19)

(447) 로그인 시험 카드를 연 경로와 토큰 요청의 결과를 각각 기록한다. 봇테스트에서 새 탭이 열리지 않으면 같은 카드가 만든 링크를 사용하고, 화면의 상태 코드와 Worker KV의 모드·결과를 대조한다.

## TASK-174 — 서울 Supabase 마이그레이션(2026-11-19)

(448) 원격 마이그레이션을 적용할 때 대상 프로젝트와 SQL 파일의 해시를 확인한다. 트랜잭션에서 빈 스키마 여부를 검사하고 파일별 해시를 원장에 넣는다. 적용 결과는 원장, 테이블 수, 확장을 조회해 대조한다.

## TASK-009 — K-02~K-04 개발 봇테스트(2026-11-19)

(449) 지연·빈 응답의 경우 화면에 나온 말풍선과 서버 상태를 따로 본다. 같은 발화의 후보 키는 기록된 2초 구간 번호와 대조한다.

## TASK-174 — Supabase 서버 전용 역할(2026-11-19)

(450) 대시보드에서 만든 PostgreSQL 역할의 기본 속성은 실제 카탈로그에서 확인한다. 서버 역할의 접속기록 권한은 테이블·컬럼·소유자 단위의 조회를 함께 실행해 대조한다.

## TASK-173 — 스테이징 앱 DB 연결(2026-11-19)

(451) `/api/healthz`와 쿠키 없는 운영자 조회는 DB를 확인하지 않는다. 운영자 조회에 형식이 맞는 무작위 세션 쿠키를 넣으면 기존 경로에서 세션 SELECT가 실행되고, 알려진 세션이 없어 401을 돌려준다. Wrangler의 환경별 바인딩과 기존 업로드 한도를 모의 배포에서 같이 확인한다.

## TASK-009 — PC 카카오톡 실앱 시험(2026-11-19)

(452) 실앱 채팅방의 입력 가능 여부와 출력 문구를 보고 실제 전송 시각을 Worker 기록의 수신 시각과 대조한다. 봇테스트와 실앱의 기록은 대본에 각각 적는다.

## TASK-009 — Event API 시험 이관(2026-11-19)

(453) 출시 검토로 미룬 시험은 현재 작업의 완료 조건에서 제외하고, 출시 검토 작업의 출처와 검증 조건에 함께 기록한다.

## TASK-007 — 카카오 시험 리소스 확인(2026-11-19)

(454) 시험 리소스는 관리 설정의 개발 채널·봇·앱 연결, 비밀 저장소의 이름, 실제 스킬 요청이 도착한 Worker 기록을 함께 확인한다.

## TASK-090 — 사장님 알림 카드(2026-11-19)

(455) 카카오 TextCard 단일형은 제목과 설명이 함께 400자 안에 들어야 한다. 고정 제목의 길이를 먼저 빼고 설명을 줄이며, UTF-16 서로게이트 쌍은 분리하지 않는다. 할 일 링크는 누르는 시점의 목록을 연다.

## TASK-009 — 사진 메시지·봇 ID 실기기 시험(2026-11-19)

(456) 카카오톡 시험에서 필수 파라미터 질문이 진행 중이면 다른 발화도 같은 질문으로 이어질 수 있다. PC의 화면 상태와 Worker KV를 각각 확인하고, 스킬 요청에 도달한 경우만 해당 기능의 시험 결과로 기록한다.

## TASK-009 — 개발 시나리오 탈출 명령(2026-11-19)

(457) 필수 파라미터 입력을 중단하려면 기본 탈출 블록에 등록한 명령을 사용한다. 실기기 시험 전에 대본을 WBS 생성기의 용어 검사까지 확인한다.

## TASK-170 — 무료 개발 환경 설정 확인(2026-11-19)

(458) 플랜과 개발 프로젝트를 확인한 뒤 스테이징에서 그 데이터베이스를 실제로 조회하는 검사를 대조한다. 연결 정보는 비밀 저장소에 두고 기록에는 확인 결과만 남긴다.

## TASK-171 — 행 잠금과 비공개 파일 저장소(2026-11-19)

(459) 실제 환경의 경합은 서로 다른 연결에서 확인하고 같은 트랜잭션에서 읽은 값과 구분한다. S3 검증은 비공개 버킷의 인증된 파일 처리와 익명 요청을 모두 확인하고 시험 객체만 삭제한다.

## TASK-173 — 무료 Cron·Queue와 스테이징 필드 키(2026-11-19)

(460) Cron 설정과 실제 실행 로그를 대조하고, 큐는 발행·소비 로그의 같은 ID와 시각을 비교한다. 시험용 소비자를 먼저 해제하면 큐 핸들러 없이 시험 Worker를 비활성화할 수 있다. 키는 Vault에 사본을 두고 Wrangler에서 버전과 키를 함께 적용한다.

## TASK-009 — 개발 채널 실제 콜백(2026-11-19)

(461) 콜백 증거는 설정한 지연, Worker 수신 뒤 발신까지의 시간, 카카오 HTTP 상태와 결과, 화면 수신을 각각 적는다. 5분 경계는 개발 채널의 관찰 조건을 기록한다.

## TASK-174 — 스테이징 Supabase 권한 대조(2026-11-19)

(462) 원장 적용 당시 파일과 현재 마이그레이션을 비교하고, 관리자 설정에서 본 권한을 실제 서버 연결의 현재 사용자로 다시 조회한다. 열 권한과 테이블 전체 권한은 따로 검사한다.

## TASK-173 — 스테이징 앱의 세션 종료 쓰기(2026-11-19)

(463) 로그아웃의 HTTP 204는 세션이 없어도 반환된다. 실제 쓰기 시험에서는 합성 세션의 종료 시각을 별도로 읽고, 계정은 비활성으로 두어 운영자 접근을 막는다.

## TASK-009 — PC 카카오톡의 반복 발화와 빈 응답(2026-11-19)

(464) PC 카카오톡에서 응답이 없을 때는 발화와 직후 화면을 남기고 Worker 요청 수·HTTP 상태를 따로 확인한다. 두 요청 사이가 2초보다 짧아도 수신 시각이 고정 구간의 경계에 걸치면 후보 키가 달라진다.

## TASK-171 — 한국 스테이징 요청과 Hyperdrive 연결(2026-11-19)

(465) 한국 요청의 유입 엣지는 trace와 CF-Ray를, Worker 실행 위치는 CF-Placement를 본다. HTTP 전체 시간과 같은 Hyperdrive의 SQL 왕복을 따로 잰다. 연결 수는 같은 시험 시간에 PostgreSQL에서 표본으로 읽고 서버의 설정 상한과 대조한다.

## TASK-009 — 10초 간격 반복 발화 보완(2026-11-19)

(466) 전송 간격을 검증할 때는 화면 조작을 한 실행으로 묶고, 도구가 찍은 전송 시각과 Worker 수신 시각을 구분한다. 같은 구간인지 여부는 Worker 수신 시각과 후보 키로 확인한다.

## Codex 지시 — 멈추는 조건(2026-11-19)

(467) 개발 에이전트에게 '확인받을 것' 목록을 줄 때는 그 목록이 작업을 멈추게 하는지 본다. 도구로 대신하거나 출시 검토로 미룰 수 있는 휴대폰 단계는 목록에 넣지 않고, 옮길 곳(TASK-167)과 방법을 함께 적는다.

(468) 채팅으로 일하는 개발 에이전트에게 'PR마다 보고'를 시키면 보고할 때마다 차례를 끝낸다. 진행은 progress.md에 남기게 하고, 채팅 보고는 끝에 닿았을 때와 남은 작업이 모두 확인을 기다릴 때로 적는다.

## TASK-009 — PC 카카오톡 친구·후기·로그인 시험(2026-11-19)

(469) PC 전용 후기 블록을 따로 두고 원본의 사진 필수를 보존한다. 카드가 연 인가를 기존 로그인에서 이어갈 때 최초 PC 버튼의 인가 상태를 유지하고, 모드·HTTP 결과만 기록한다.

## TASK-011 — 카카오 시험 결과의 계약 반영(2026-11-19)

(470) 실제 카카오 요청으로 결정한 값은 SPEC·DB 컬럼 설명·OpenAPI와 화면 응답 표가 함께 가리키게 한다. 빈 출력을 쓰는 같은 결과는 기존 결과의 예시와 설명에 적고, HTTP 응답 헤더에 별도 결과가 없으면 예시 이름으로 새 결과를 만들지 않는다.

## TASK-028 — 카카오 스킬 인증과 메시지 수신(2026-11-20)

(471) 카카오 스킬의 연결 해석기는 정규 봇 ID로 읽는 쿼리 하나만 허용한다. 인증 뒤 수신 키는 가게 범위 트랜잭션에서 기록하고, 동시에 같은 요청이 들어오는 경우도 데이터베이스에서 시험한다.

## TASK-028 — 카카오 콜백과 큐 소비자(2026-11-20)

(472) 카카오 콜백의 주소는 수신 메시지에 암호화해서 보관하고, 큐 작업에는 가게 ID와 메시지 ID를 넣는다. 소비자가 처리 권한을 획득했는지와 기한이 지나 내용을 비웠는지를 데이터베이스 시험으로 확인한다.

## PR #119 — TASK-028 검사 재개(2026-11-21)

(473) push 전에 format 다음 lint의 종료 코드 0을 확인한다. PR을 연 뒤에는 app·db CI, squash 합치기, main CI와 스테이징 배포까지 확인하고 다음 작업으로 간다. 작업 전체의 수락 기준과 부분 PR에서 제공한 것은 구분해서 기록한다.

## PR #120 — TASK-020 사장님 로그인과 연장 세션(2026-11-21)

(474) 로그인 state에 nonce를 싣지 않고 HttpOnly 쿠키와 리다이렉트 주소에 서명을 묶는다. 세션은 요청마다 같은 쿠키를 재발급하며 데이터베이스의 마지막 사용 시각도 함께 늘린다. 로그아웃한 쿠키는 늦은 응답으로 돌아와도 서버에서 되살아나지 않아야 한다.

## PR #121 — TASK-176 PWA 검증과 휴대폰 확인 이관(2026-11-21)

(475) PWA 설치 가능 여부는 Chromium의 설치 오류 목록·매니페스트·서비스 워커와 캐시의 실제 동작으로 확인한다. 휴대폰 홈 화면 사진은 데스크톱 화면 사진으로 대신하지 않고 출시 검토 작업에 따로 배정한다. 업무 화면이 준비 중이면 PWA 조건 통과와 화면 기능 완료를 구분한다.

## TASK-028 — 예약 링크 준비 조건과 채널 친구 상태(2026-11-21)

(476) 채널 연결과 예약 링크 발급을 같은 조건으로 보지 않는다. 준비 전 수신의 응답뿐 아니라 새 손님·상담·메시지가 0건인지 확인한다. 친구 상태는 누락을 false로 보되 관찰 시각이 늦은 값은 이전 요청으로 되돌리지 않는다.

(477) 공개 저장소에서는 첫 커밋 전에 저장소 로컬 Git 작성자 메일이 GitHub noreply인지 확인한다. 다른 프로젝트에서 물려받은 전역 설정을 그대로 쓰지 않는다. squash 메시지도 명시해 원치 않는 공동 작성자 주소를 자동으로 덧붙이지 않게 한다. 이미 공개한 main 이력은 허가 없이 다시 쓰지 않는다.

## TASK-030 — 사장님 로그인 화면(2026-11-21)

(478) 카카오 로그인 화면은 인가 주소로 이동하기 전 서버 응답의 출처를 확인하고, 돌아온 코드와 state는 화면 주소에서 바로 지운다. 세션 확인 전에는 사장님 업무 내용을 표시하지 않으며 돌아갈 주소는 07의 화면 경로로 제한한다.

(479) 로그인 화면의 자동 검사에 더해 실제 스크린샷을 시안과 대조한다. 카드의 세로 정렬·버튼 글자·오류 배너가 어긋나면 공통 토큰과 부품을 고치고 두 너비의 화면 흐름을 다시 확인한다. 모의 API로 통과한 결과와 실제 카카오 계정 성공을 나누어 기록한다.

## TASK-027 — 호출 실패 중단과 OpenAI 재확인(2026-11-21)

(480) 모델 평가에서 호출 실패를 수십 번 반복하지 않는다. 같은 모델에서 실패 두 번이면 부분 결과와 다음 사례를 보존하고 그 실행만 멈춘다. 틀린 답의 채점 실패는 호출 실패로 세지 않는다. 사용량이 없는 실패의 금액을 0원으로 단정하지 않고 미확인으로 기록한다.

## TASK-173 — 콜백 큐 연결 확인(2026-11-21)

(481) Wrangler 배포 목록의 첫 항목을 최신이라고 가정하지 않는다. 배포 시각을 비교해 최신 버전을 고르고 그 버전의 태그를 원격 main SHA와 대조한다. 연결 실패가 기록돼 있어도 실제 Git·Wrangler 조회가 회복됐으면 그 근거와 새 결과를 남긴다.

## TASK-028 — 고정 응답과 연결 확인 중 연락처(2026-11-21)

(482) 연결 확인 중에는 수신 저장 함수를 거치지 않아도 인증된 가게 연락처를 안내한다. 고정 응답은 한 함수에서 만들고, 일반 출력·빈 출력·콜백 접수는 API의 공통 SkillResponse로 검사한다. AI 실패 안내의 형식을 제공한 것과 실제 AI 처리·에스컬레이션을 연결한 것은 따로 기록한다.

## TASK-028 — 전체 응답 기한과 요청 중단(2026-11-21)

(483) 외부 요청의 응답 기한은 마지막 큐 발행만이 아니라 본문 읽기·인증·DB 처리를 포함해 적용한다. 시간 초과 응답 뒤 늦은 처리가 DB 연결을 다시 맺거나 커밋하지 못하게 중단 상태를 지킨다. 실제 트랜잭션의 변경이 되돌아갔는지와 연결을 기다리던 쓰기가 실행되지 않았는지 확인한다. 가짜 시계의 경계 시험을 스테이징 P99 부하 결과로 기록하지 않는다.

## TASK-183 — 원격 후보 검증의 측정 범위(2026-11-21)

(484) 큰 해상도의 작은 압축 파일만으로 최대 입력과 자원 한도를 통과했다고 기록하지 않는다. 실제 경계 크기를 가진 합성 입력을 준비하고 원격 결과를 받아 검증한다. 연결 오류로 출력이 없으면 방향·CPU·메모리는 미확인으로 남기고 두 번째 실패 뒤 그 실행만 중단한다.

## TASK-158 — 요청 키의 기간과 처리 임대(2026-11-21)

(485) 만든 지 하루가 지난 요청 키라도 최근 이어받아 처리 중인 유효한 임대는 보호한다. 지우기는 짧은 배치와 SKIP LOCKED로 실행하고, 같은 요청을 처리하는 트랜잭션을 기다리거나 같은 행을 두 번 세지 않는지 실제 데이터베이스로 확인한다.

(486) AI 도구 호출의 마스킹한 인자와 AI 호출의 토큰·비용은 보관 기준이 다르다. 상담이 열려 있어도 30일 지난 도구 인자를 지우고 비용 행은 그대로 남긴다. 가게 범위와 동시 실행, 보관 경계의 실제 데이터베이스 시험으로 확인한다.

(487) 접속기록의 2년 보관은 실행기가 받은 시각과 데이터베이스의 실제 시각 가운데 앞선 값으로 판단한다. 미래 시각이 들어왔다고 최근 기록을 지우려 시도하지 않고 기존 보관 트리거와 같은 경계를 지킨다. 미래 시각과 다른 가게·잠금·동시 배치로 이를 검증한다. 접속기록 삽입·도구 사용자의 정적 제한은 유지하고 기간 지우기 모듈의 참조만 추가한다.

(488) 주문 개인정보를 지울 때 보관 기록·사진 삭제 대기·주문 잠금 번호 변경을 한 트랜잭션으로 묶는다. 중간 DB 오류에서 모두 되돌아가는지, 동시 실행과 반복에서 보관 기록과 잠금 번호가 한 번만 바뀌는지 실제 데이터베이스로 확인한다. 사진 파일은 커밋 뒤 별도의 삭제 대기 처리에서 지운다.

(489) 보관 주문은 화면의 ID 조회와 새 명령의 참조에서도 빼고, 이름을 남긴 보관 기록은 운영자와 지우기 처리 범위만 직접 참조하게 한다. 문자열·주석의 글자를 실제 테이블 참조로 오인하지 않도록 SQL 토큰으로 검사한다. 목록과 실제 보관 기록 API의 권한·접속기록도 각 구현에서 대조한다.

(490) 상담 내용을 지울 때 열린 에스컬레이션과 아직 보관되지 않은 관련 주문을 먼저 확인한다. 사장님 알림은 할 일 연결만 끊고 묶임 관계를 남긴다. 대화·원래 값·에스컬레이션·초안 지우기와 사진 삭제 대기를 한 트랜잭션으로 처리하며 AI 비용·주문이 된 초안은 보존한다.

(491) 신고 내용의 3년 기한과 주문자 이름의 5년 기한을 나누어 처리한다. 신고 설명·사진·개별 사유를 지워도 보상·금액·신고 행은 남긴다. 신고 기한 처리 표시가 남아 있을 때 내용을 정리하고 그 뒤 5년 보관 이름을 지워 처리 순서가 바뀌어도 기한 표시를 먼저 잃지 않게 한다.

(492) 손님 키를 지우기 전에 모든 상담의 지워짐과 모든 주문의 보관 여부를 각각 확인한다. 그 사이 새 상담이 열렸으면 키를 보존하고, 지운 뒤 같은 채널 키가 다시 와도 예전 행을 되살리지 않게 새 손님 행이 만들어지는지 확인한다.

(493) 사진 삭제의 시도 표시를 커밋한 뒤에 외부 저장소를 부르고, 확인한 성공에만 같은 시도의 대기를 지웁니다. 실패·시간 초과의 저장 위치를 버리지 않고 서울 날짜가 바뀐 뒤 다시 처리합니다. 늦은 성공이 새 시도의 기록을 지우지 않는 것과 가게 경로·동시 처리·횟수 상한을 시험합니다.

(494) 임시 파일 지우기는 사장님 ID와 실제 uploadId 형식을 확인하고 발급 시각에서 한 시간을 셉니다. 파일 목록의 앞쪽만 매일 읽으면 새 파일이 많은 사장님 뒤의 오래된 파일이 남을 수 있으므로 마지막 확인 위치를 저장해 이어갑니다. 한 바퀴 뒤 처음으로 돌아가고 실패 파일은 남기며, 저장소의 진행 위치에는 내용이나 비밀 값을 넣지 않습니다.

(495) 전역 기록 지우기는 기존 하루 실행 잠금과 시작 표시를 거쳐 한 번 시작하고, 각 주문·상담은 자기 가게의 짧은 트랜잭션에서 다시 확인합니다. 후보 조회는 ID·시각·존재 여부만 허용하고 쓰기나 내용 반환은 거절합니다. 배치마다 여덟 차례를 돌며 건수·남은 사진 수만 남기고, 통합 지우기 시험은 독립 DB로 다른 시험의 자료를 보호합니다.

(496) 한 배치의 처리로 다른 차례에서 더 오래된 행이 새 후보가 될 수 있습니다. 실행 중에는 이미 시도한 ID만 빼고 다시 찾아 시간 순서가 달라져도 놓치지 않게 합니다. 행별 오류·시간 예산·저장소 설정 없음의 중단 지점을 각각 시험해 이미 커밋한 변경과 파일 대기가 다음 날 이어지는지 확인합니다.

(497) 보관 수락 시험에는 실제 결제·송금한 환불·장부·완성 사진·후기·게시 동의를 함께 넣어 지울 값과 남길 근거를 대조합니다. 신고를 만든 에스컬레이션과 메시지를 지울 때는 신고 자체를 남겨 3년 기한을 지킵니다. 상담 지우기의 잠금을 잡은 중 새 수신을 별도 DB 연결로 처리하고, 손님 키까지 지운 뒤에도 예전 기록을 되살리지 않는지 실제 수신 함수로 검사합니다.

(498) 작업 끝남은 WBS의 수락 기준을 시험 파일·확인 행동과 하나씩 대조한 뒤 원본의 finished와 생성기로 표시합니다. 저장소 모의 구현의 통과를 실제 S3나 스테이징 실행으로 쓰지 않고, 실제 환경 준비가 두 번 거절되면 그 확인만 멈춰 기록합니다. 검증 표에는 자동 기준 충족과 남은 직접 확인을 함께 남깁니다.

(499) 필수 목업 검사의 미리보기 높이 차이가 나면 본문 크기·글꼴 로드·page-check 결과를 먼저 대조합니다. 기존 main과 같은 파일에서도 같은 높이가 재현되면 임의 여유를 더하지 않고 측정값을 heights.json에 쓰고 생성기를 돌립니다. 해당 보드와 캔버스의 높이만 바뀌었는지 diff로 확인하고 실패한 목업 검사를 다시 합니다.

(500) 필수 검사를 돌린 뒤 외부 글꼴 요청이 실패하면 화면의 높이·넘침 오류와 외부 통신 실패를 구분합니다. 같은 원본에서 이미 확인한 결과와 고친 화면의 개별 검사를 보존하되 실패한 전체 검사를 통과로 쓰지 않습니다. 두 번 실패 뒤 중단하는 최신 지시에 따라 그 외부 확인만 멈추고, CI app·db 성공 여부와 남은 확인을 PR에 명시합니다.

## TASK-173 — 배포 환경별 바인딩과 실제 검증(2026-11-21)

(501) Wrangler의 staging에 필요한 vars·queues는 상위 설정을 물려받는다고 가정하지 않고 그 환경에 명시합니다. 콜백 생산자와 소비자가 같은 별도 큐를 가리키는지 검사하며 실패한 메시지를 보존할 큐도 정합니다. 비밀 값은 이름의 유무를 먼저 확인하고 없는 것만 한 번 만들어 secret put의 입력으로 넘깁니다. 배포 성공과 최신 태그·DB·큐·Cron의 실제 검증은 각각 확인합니다.

(502) 콜백 큐의 환경 이름·생산자·소비자와 데드 레터 큐를 같은 staging 설정에 명시합니다. 한 건씩 처리하고 재시도 한도를 넘은 메시지도 버리지 않게 보관하며 다른 시험 큐의 메시지는 건드리지 않습니다. 설정 시험 통과와 실제 플랫폼 자원 생성·소비 성공은 구분합니다.

(503) 스테이징 자원 준비는 먼저 이름을 읽고 없는 것만 만들며 기존 키를 다시 만들지 않습니다. 새 값은 표준 입력으로만 전달하고 공급자 오류 원문도 출력하지 않습니다. 최신 배포와 버전의 태그를 대조한 뒤 공개 상태를 검사해 예전 Worker의 정상 응답으로 새 배포를 통과시키지 않습니다. 권한이 있는 도구의 실패·출력 제외·반복을 비밀 값 없는 시험으로 확인합니다.

(504) 스테이징 준비는 비밀 값 없는 check 작업과 나누고 main 배포에서만 실행합니다. 자원이 준비된 뒤 배포하고 그 뒤에 정확한 태그·공개 상태를 대조하는 순서를 검사합니다. 원격 읽기 명령이 시간 초과면 성공으로 쓰지 않고 그 실행과 임시 자료를 정리한 뒤 입력 전달을 확인합니다.

(505) 읽기 CLI의 시간 초과 원인이 입력 끝 대기라면 입력을 한 줄로 구분하고 받았다는 고정 표시를 확인한 뒤 실행합니다. 기존 자원의 이름과 없는 이름을 먼저 대조하고 없는 것만 생성하며, 두 번째 실행에서 생성 0건을 확인합니다. 실제 태그·공개 상태와 자원 준비의 증거를 따로 남기고 앱의 소비·DB 쓰기까지 확인하기 전에는 WBS 끝남을 표시하지 않습니다.

(506) 실제 DB 확인은 배포 성공·조회·쓰기 권한을 따로 대조합니다. 시험 결과 기록 자체가 원래 역할에 없는 UPDATE를 요구하면 결과 미기록을 앱 성공이나 실패로 단정하지 않습니다. 관리자 작업 없이 권한을 넓히지 않고, 시험 행 삭제의 권한 오류와 남은 ID를 기록합니다. 큐 소비자를 먼저 분리해야 Worker를 지울 수 있는 경우 분리 후 삭제 결과까지 확인합니다.

(507) 새 API를 배포할 때 테이블 존재와 서버 역할 권한을 함께 적용합니다. 빈 DB의 관리자 계정으로 통과한 시험을 실제 역할의 통과로 가정하지 않습니다. 기존 역할로 로그인·수신·콜백을 실행하고 공유 잠금에 필요한 열 권한도 확인하며, 접속기록 전체 조회·수정과 DDL 같은 금지 권한이 그대로 거절되는지 시험합니다. 관리자 SQL 적용은 원장과 원본 파일 해시를 대조한 뒤 합니다.

(508) 기존 DB를 갱신할 때 빈 DB용 스크립트를 다시 실행하지 않습니다. 저장된 커밋의 파일 바이트와 원장의 파일별 해시·연속 순서·모르는 파일을 모두 확인한 뒤에만 빠진 DDL을 적용합니다. 권한과 정리까지 같은 트랜잭션에서 실행하며 반복·이전 파일 변조·부분 DDL 충돌을 실제 DB에서 시험합니다. 합성 행 정리는 ID·종류·0건·시험 표시가 모두 같을 때만 합니다.

(509) 실제 관리자에게 넘기는 갱신 SQL은 검증한 생성기로 만들고 원본 커밋과 파일 SHA-256을 함께 고정합니다. 실행하는 쪽에서도 그 해시를 대조한 파일만 사용하고, 실행 결과를 받기 전에는 적용 완료로 쓰지 않습니다. 생성 결과를 손으로 바꾸지 않으며 연결 문자열·비밀 값은 넣지 않습니다.

(510) 실제 관리자 적용은 생성 파일 해시·원문 실행·COMMIT 뒤 결과와 별도 읽기 검증을 각각 남깁니다. 원장 전체 파일 해시와 런타임 권한·접속기록 제한·합성 행 정리를 함께 확인합니다. 검증 결과를 적으려고 역할에 운영 기록 수정·삭제 권한을 더하지 않고 큐·Cron 증거는 식별자·개수만 있는 실행 로그로 확인합니다.

(511) 큐 검증은 앱의 기본 처리기를 실제 바인딩과 연결하고 처리 뒤 ack와 실행 결과를 함께 확인합니다. 결과 저장을 위해 기존 DB 역할 권한을 넓히지 않고 ID·건수만 있는 실행 로그를 사용합니다. 새 Cron 이벤트를 시간 안에 보지 못하면 앱 오류나 성공으로 단정하지 않고 전파 대기와 실패 이벤트를 구분하며 시험 자원을 정리합니다.

(512) 실행 로그 수집기가 특정 결과만 모으면 그 결과 없음으로 다른 오류가 없다고 판단하지 않습니다. 새 주소의 기본 응답 검사에서 중단된 실행은 DB·Cron 실행 여부와 구분합니다. 새 검증 경로가 두 번 실패하면 그 경로만 멈추고 자원 정리를 확인한 뒤 다른 진행 가능한 작업을 계속합니다.

## TASK-020 — 실제 카카오 로그인 연결(2026-11-21)

(513) 배포한 로그인 코드는 실제 스키마·서버 역할·카카오 앱 설정이 함께 맞아야 확인할 수 있습니다. 없는 세션 표와 권한 문제를 먼저 해결한 뒤 임의 쿠키의 실제 DB 경로와 진짜 로그인 성공을 구분합니다. 클라이언트 키·리다이렉트·알림 채널을 기존 앱과 대조하고 비밀 값은 로그·보고로 옮기지 않습니다.

(514) 비밀 저장 항목 이름의 존재와 앱·채널 일치·실제 비밀 등록·로그인 성공을 각각 확인합니다. 공급자 로그인에서 자격 증명이 거절되면 같은 값을 반복 제출하지 않고 정상 복구를 확인 대기에 둡니다. Vault의 단일 직접 전달 기능 부재와 정상 조회·허용 저장소 쓰기 가능 여부를 구분합니다. 승인된 비밀 사용을 불필요하게 막지 않으며 비공식 추출 경로는 만들지 않습니다.

(515) 공개 상태200과 배포 태그 일치만으로 실제 로그인 설정이 준비됐다고 판단하지 않습니다. 배포 뒤 API-078의200·정확한 인가 대상/콜백·S256·10분 보안 쿠키를 따로 확인하며 실패 본문·인가 주소·state·쿠키 원문은 출력하지 않습니다. 이 확인과 외부 공급자의 권한·실제 로그인 완료를 구분합니다.

## TASK-028 — 공통 응답·재전달 이어가기(2026-11-21)

(516) 스킬 공통 결과 형식이 맞는 시험과 실제 요청·저장·처리·전달 경로의 시험을 구분합니다. 공급자·업무 처리의 후속 기능을 완료했다고 가정하지 않고 응답별 실제 경로와 중복·실패 복구의 경계를 먼저 확인합니다.

(517) 콜백 실패를 deferred로 남기는 것만으로 다음 대화 전달이 구현된 것은 아닙니다. 실제 스킬 요청에서 이전 답을 읽어 새 답보다 먼저 보여 주고 같은 트랜잭션에서 전달 상태를 바꿉니다. 같은 손님의 동시 요청은 직렬화하고 다른 손님·가게·콜백 처리 중인 답을 섞지 않습니다. 바깥 서비스는 이 트랜잭션에서 부르지 않습니다.

(518) 콜백의 이전 답 전달은 같은 손님의 서로 다른 수신 메시지에서도 직렬화합니다. 짧은 손님 행 잠금으로 선점을 정하고 외부 발신은 트랜잭션 밖에서 합니다. 이전 답은 카카오 SUCCESS를 확인한 뒤 현재 답 기록과 함께 전달 표시하며, 예외 시 선점을 풀어 남은 기한의 재시도를 허용합니다.

(519) 미전달 답은 카카오 실패·로컬 예외·응답 생성 실패 때 전달 상태를 바꾸지 않고 보존합니다. 같은 가게의 다른 손님은 병렬 처리하며 끝난 상담의 답도 같은 손님에게만 전합니다. 개수·글자 수 한도와 중복의 빈 출력 계약을 함께 검사하고 실제 제한 역할의 실행으로 새 SQL 권한을 확인합니다.

## TASK-173 — 기존 Cron의 작업 표 조회와 관측(2026-11-21)

(520) Cron 이벤트의 outcome=ok와 실제 작업 표 조회 성공을 구분합니다. 등록된 일이 하루 한 번뿐일 때 실행 시간 밖에서 DB를 쓰지 않는 경로도 확인합니다. 시작 표시는 매분 읽되 실제 실행의 하루 한 번·트랜잭션 잠금·동시 재확인을 보존하고, 정해진 메타데이터로 성공·실패를 관측합니다. 새 Worker 검증의 두 번 실패를 같은 방법으로 반복하지 않습니다.

(521) 매분 조회의 성공 로그는 DB 조회가 끝난 뒤에만 남깁니다. 권한·연결 실패 때 성공 로그를 남기지 않고 SQLSTATE와 오류 종류만 기록하며 연결을 닫습니다. 실행 시간 밖의 읽기는 쓰기 트랜잭션을 열지 않고, 실제 시작에서는 선행 조회 결과를 믿지 않고 잠금 뒤 다시 확인합니다.

## TASK-173 — 실제 앱의 Cron·큐와 끝난 조건(2026-11-21)

(522) 별도 검증 Worker가 실제 처리 함수를 실행한 결과와 현재 앱 Worker가 직접 소비한 결과를 구분합니다. 배포 태그를 대조한 기존 앱의 Cron 조회 성공을 먼저 확인하고, 기존 큐의 소비자도 같은 앱인지 확인합니다. 내용 없는 임의 ID로 검사하며 업무 행·새 소비자·유료 변경을 만들지 않습니다.

(523) 플랫폼 응답 필드가 문서와 다르면 사전 검사에서 멈추고 실제 형태를 먼저 읽습니다. 소비자 이름·개수·데드 레터 큐를 확인하기 전에는 메시지를 발행하지 않습니다. 현재 앱이 ID만 담은 한 건을 실패 없이 소비했는지 관측하고, 과거 별도 검증 함수 결과와 새 실제 앱 결과를 구분해 완료 근거에 적습니다.

## TASK-183 — 연결 조건을 바꾼 실제 이미지 검증(2026-11-21)

(524) 네트워크 실패와 이미지 후보의 기능 실패를 구분합니다. 같은 실패를 반복하지 않고 정상 연결을 확인한 다른 실행 환경에서 작은 입력 하나부터 재개합니다. HTTP 전체 시간을 CPU 시간으로 쓰지 않으며 실제 픽셀·촬영 정보·애니메이션·자원 한도의 증거를 얻기 전에 앱 경로나 완료 표시를 바꾸지 않습니다.

(525) 긴 공개 소스와 비밀 값을 같은 원격 입력에 섞기보다 공개 파일은 먼저 복사하고 필요한 비밀 값은 작은 프로세스 입력으로만 전달합니다. 공급자 응답 없는 SSH 실패와 변환 결과의 기능 검사를 구분하며, 받은 바이트를 독립 디코더로 대조한 뒤에만 방향·촬영 정보 제거를 통과로 적습니다.

(526) 방향 태그만 보존하는 것으로 WebP 픽셀 보정을 대신하지 않습니다. 실제 코덱으로 확인한 변환을 공통 모듈에서 호출하고 외부 처리 전후에 촬영 정보를 제거합니다. 변환 실패 때 원본으로 되돌아가 저장하지 않으며 바인딩 누락은 설정 오류·외부 실패는503·초과 출력은413으로 구분해 실제 업로드 응답과 저장 부재를 시험합니다.

(527) 픽셀/브라우저 검증과 자원 한도 증거를 구분합니다. 실제 Chromium20개가 통과해도 새 Worker 배포가10007에서 멈추면 CPU·최대 메모리는 미측정으로 남깁니다. 메트릭 스키마에서 단위를 읽었거나 조회가0건인 것을 한도 통과로 세지 않고 자기 검증 Worker404·폴더 없음·프로세스0을 별도로 확인합니다. 동작과 시험을 반영하더라도 WBS 완료는 보류합니다.

## TASK-016 — 외부 점검과 실제 알림 연결(2026-11-22)

(528) 1분 상태 점검이 성공한 것과 실패 알림이 연결된 것을 구분합니다. 실제 systemd 실패 연결·발송 도구·기존 인증의 사용 가능 여부를 값 노출 없이 확인하고, 점검 실패·알림 전달·중복 억제·복구를 각각 검증합니다. 메일 조회0건이나 모니터 활성화만으로 전달 성공을 표시하지 않습니다.

(529) 외부 장애 알림은 한 사건의 반복 요청과 복구 뒤 새 장애를 구분합니다. 파일 잠금 아래 마지막 전달 시각을 기록하고 gh 실행 실패는 전달로 세지 않습니다. 정상 점검 뒤에는 사건 상태를 지워 새 장애를 바로 알리며, 상태 파일을 셸 식으로 해석하지 않는 실제 프로세스 시험으로 확인합니다. 실제 메일 도착은 별도 검증으로 남깁니다.

(530) 알림 정책은 코드의 실제 실패 종류 전체와 조회 창을 대조합니다. 정책 이름만으로 임의 조건을 덮어쓰지 않고 계정/Worker·기존 대상·추가 조건을 먼저 검사하며, API 쓰기 뒤 다시 읽은 결과가 같아야 통과합니다. 인증 오류403·10000은 기록하고 같은 인증으로 쓰기를 반복하지 않습니다.

(531) 실제 설치는 원본 파일을 대조하고 구성 검증이 실패하면 즉시 그 원본으로 복구합니다. 설치 파일을 쓴 것만으로 적용 성공을 표시하지 않으며 원래 구성도 같은 검증기에서 통과하는지 대조해 원인을 찾습니다. 실패 경보를 아직 실행하지 않았으면 메일이나 전달 성공으로 세지 않습니다.

(532) 검증기의 사용자 런타임 경로 누락과 서비스 문법 오류를 구분합니다. 원본이 정상 환경에서 먼저 통과한 뒤 새 단위를 같은 환경에서 확인합니다. 실제404와 OnFailure·경보 작업 발행·정상 복구는 각각 대조하고, 경보 작업의 의도한 failure를 app/db CI 실패로 세지 않습니다. 메일 조회0건은 전달 성공/실패로 단정하지 않으며 자기 transient 단위만 시각과 이름을 확인해 정리합니다.

(533) 새 자원 생성이 실패하면 같은 생성을 반복하지 않고 정상인 기존 시험 자원에서 기존 동작을 유지하는 별도 경로를 검토합니다. 쓰기 전에 원래 배포/바인딩/큐를 대조하고 위임·인증·본문 보존을 시험하며, 합성 검증 뒤 원래 버전과 상태를 되돌려 확인합니다. 기존 키 값을 읽어 복사하거나 고객 요청 로그를 켜서 측정을 대신하지 않습니다.

(534) 기존 시험 자원에서 측정할 때 일반 요청/큐를 가로채지 않는지 먼저 시험합니다. 별도 경로는 키 확인 뒤에만 처리하고 실패 때 기존 업무 처리기로 보내지 않습니다. 요청 본문을 두 번 읽거나 multipart 경계를 바꾸지 않으며 측정기에 기존 업무의 비밀 값을 넘기지 않는 시험을 먼저 통과시킵니다.


(535) rollback 검증은 마지막 업로드 설정과 활성 배포가 가리키는 버전 설정을 구분합니다. 배포 생성 시각으로 최신 배포를 고르고 resources.bindings/script_runtime에서 활성 구성을 읽습니다. 첫 잘못된 false 사건은 지우지 않고 별도 재조회로 원본 복구·큐·상태·경로 제거를 대조합니다. 실제40개 기능 성공과 CPU/메모리 한도도 구분하며 분위수를 최대치로 적거나 무료10ms 초과를 완료로 세지 않습니다.


(536) 콜백 기한이 지난 질문은 안내만 남기지 않고 사장님 에스컬레이션·할 일·대기 중 알림과 같은 트랜잭션에 둡니다. 열린 일반 건에는 질문을 덧붙이고 새 할 일을 만들지 않습니다. 답하는 시간 안의 기다림과 가게 날짜의 하루 한 번 알림 키를 쓰며 pending 알림을 발신 성공으로 세지 않습니다. 입력 메시지와 원래 상태를 지키는 동시 처리·교차 가게·끝난 상담·실패 롤백을 실제 데이터베이스로 대조합니다.

(537) 만료 처리의 중복 억제는 같은 메시지뿐 아니라 같은 손님의 서로 다른 메시지도 실제 동시 시험합니다. 손님→상담 순서의 행 잠금 아래 열린 일반 건 하나를 공유하고 하루 덧붙임 알림 키를 재사용합니다. 끝난 상담은 다시 열지 않으며, 후속 알림 저장 실패를 주입해 질문/할 일/콜백 제거 전체의 롤백과 정상 재시도를 대조합니다.


(538) HTTP 응답별 계약 시험은 실제 라우터·인증·범위 해석기를 거쳐 실행합니다. 연결 객체 생성과 실제 질의를 구분하고401/422는 실제 query/쓰기0건으로 검증합니다. 인증 해석 중500 Problem과 처리 중200/server_error를 구분하며 응답·로그에 오류 내용이나 손님 글이 섞이지 않는지 확인합니다. 기존 동작을 검증한 시험을 새 업무 기능 구현으로 기록하지 않습니다.


(539) 상담을 받는 가게의 AI 미준비를 상담 거절로 안내하지 않습니다. Services에서 선택 회사/모델/키 존재만 확인하고 값은 읽지 않습니다. 실제 업무 처리기가 연결되지 않았으면 모델 호출 없이 실패 안내와 사장님 질문 참조·할 일·발신 대기 알림을 한 트랜잭션으로 남깁니다. 수신 본문 마스킹/보존과 실제 모델 처리는 남은 작업으로 명시합니다.


(540) 비동기 작업의 예외를 처리기 catch에서 바꿔야 하면 await로 완료를 기다립니다. 반환한 Promise의 나중 거절을 같은 try가 잡는다고 가정하지 않으며 실제 저장 실패를 주입해200/server_error와 내부 내용 비노출을 확인합니다. 고정 시각의 지우기 시험은 준비 자료의 생성 시각도 명시해 실제 시각이 기준을 지난 뒤에도 후보가 되게 하며 제품의 지우기 조건을 완화하지 않습니다.


(541) 외부 호출이 없는 즉시 실패 처리는 수신과 후속 기록을 한 트랜잭션으로 묶습니다. 수신만 먼저 커밋하면 후속 실패의 같은 요청 재시도를 중복으로 버리므로, 실제 저장 실패 뒤 손님/상담/수신까지 롤백되고 같은 요청으로 한 번만 복구되는지 확인합니다. 처리 결과를 소비하는 공통 함수는 형식 매개변수로 분리하고 저장 층에 HTTP 응답 형식을 고정하지 않습니다.


(542) 새 처리의 SQL은 관리자 연결뿐 아니라 배포 권한 파일만 적용한 LOGIN·NOINHERIT 제한 역할로 실제 API를 호출해 검증합니다. 기능에 필요한 조회/삽입과 달력 읽기만 추가하고 수정/삭제·운영 기록/접속기록 보호를 지킵니다. 로컬 권한 파일의 부족 재현과 실제 스테이징의 보유 권한/관리자 적용 결과를 구분합니다.


(543) AI 미준비 콜백도 외부 발신 전에 자기 선점과 열린 상담을 확인하고 사장님 질문 참조·할 일·대기 알림을 커밋합니다. 발신 두 번 실패는 이 기록을 되돌리지 않으며 안내를 다음 대화의 미전달 답으로 남깁니다. 기록 완료 로그와 실제 발신 성공을 구분하고 닫힌 상담이나 바뀐 선점은 건드리지 않습니다.


(544) 적격 콜백의 암호화와 봉투 저장은 수신 트랜잭션 안에서 끝내고 외부 큐 발행만 커밋 뒤에 합니다. 암호화/저장 실패 뒤 수신만 남아 같은 요청의 재시도를 중복으로 버리지 않도록 손님/상담/메시지 롤백과 한 번 복구를 실제 PostgreSQL로 검증합니다. 큐 발행 시 다른 연결에서도 봉투를 읽을 수 있어야 합니다.


(545) 큐 발행 실패는 실제 소비 실패를 뜻하지 않습니다. 자기 콜백 봉투를 선점 전 상태에서 제거한 경우에만 즉시 안내로 전환하고, 제거0건이면 소비자의 선점/완료/미전달 답을 보존해 안내를 겹쳐 만들지 않습니다. 발신 중·발신 완료·미전달3가지 동시 경로를 실제 PostgreSQL과 합성 fetch로 대조합니다.


(546) 큐 거절 뒤의 콜백 봉투 제거와 사장님 실패 기록은 한 트랜잭션으로 커밋합니다. 손님/상담을 잠그고 자기 봉투만 조건부로 제거한 뒤 같은 트랜잭션에서 기록합니다. 알림/답 저장 실패는 제거도 롤백하며 원래 작업으로 한 번 복구할 수 있어야 합니다. 소비자의 선점/완료는 건드리지 않고 자동 유실 복구와 명시적 재실행을 구분합니다.


(547) 신청 화면은 도메인·페이지 존재나 클릭ok만으로 제출 완료로 세지 않습니다. 사이트 문의 도우미와 실제 신청 분류를 구분하고 다음 양식/접수 결과까지 확인합니다. 같은 선택 목적이 두 번 실패하면 그 작업만 중단하고 실제 항목·실행 결과·미확인 범위를 남깁니다. 도구 선택 실패를 계정/사람 확인 필요로 바꾸어 기록하지 않습니다.


(548) 개인 입력값은 명령 인자나 임시 파일에 넣지 않고 같은 사용자에게만 허용한 임시 통로와 CLI 표준 입력으로 전달합니다. 입력값 확인과 양식의 실제 다음 단계/최종 접수는 구분합니다. Windows에서는 도구의 내장 지침과 세부 명령을 먼저 읽고, 실패의 delivery/retry를 대조해 반영 여부를 확인한 뒤 다음 행동을 정합니다.


(549) 큐 발행/즉시 실패 안내가 모두 실패한 작업은 보존한 콜백 정보가 만료된 뒤 기존 1분 실행이 찾습니다. 식별자와 기한만 조회하고 가게 범위에서 제거/사장님 기록/미전달 답을 함께 커밋합니다. 실패는 다음 실행에 남기되 다른 가게를 막지 않으며 닫힌 상담은 다시 열지 않습니다. 새 행 시작은25개/5초로 제한하고 진행 중 트랜잭션은 끝냅니다.


(550) 콜백 큐에 넘기기 전과 소비자의 선점 확인 뒤에 상담 누적1,000원/가게 날짜의 하루 AI 비용 한도를 확인합니다. 금액은 numeric으로 비교하고 자정부터 다음 자정까지를 가게 시간대로 구해 서머타임의25시간 날짜도 포함합니다. 한도 뒤 질문은 ai_cost_limit로 넘기며 같은 요청은 다시 쓰지 않습니다. 비용 확인에는 ai_calls 조회 권한만 더합니다.


(551) 번호 검출은 한글/Unicode 숫자를 정규화하면서 주문번호와 문장 경계를 지킵니다. 유효 카드/주민등록번호 모양은 계좌 문맥보다 먼저 가리고, 일반 단어를 은행 이름으로 오인해 긴 숫자의 원본을 보관하지 않습니다. 같은 전화/계좌는 기존 HMAC/암호화 저장을 재사용하고 카드/긴 숫자는 원본을 두지 않습니다. 저장 한도/가게 범위/중간 실패 롤백을 실제 PostgreSQL로 확인합니다. 수신의 번호/본문은 가게 범위 저장점으로 묶어 부분 실패를 되돌린 뒤 원문 없이 실패 표시와 사장님 건을 남깁니다. 트랜잭션 밖/중첩 저장점은 받지 않고 실패한 PostgreSQL 상태도 되돌려 후속 기록을 함께 커밋합니다.

(552) 미전달 일반 안내도 콜백 답과 같은 다음 대화 전달 경로에 연결합니다. 사장님 답/지연 안내/맞춤 거절/답 없어 닫힘의 글만 생성 순서로 합쳐 Unicode 글자1,000개씩 출력 두 개 안에 온전히 전하며 현재 답 자리를 남깁니다. 같은 가게/손님·끝난 상담·동시 요청·빈 중복 응답·긴 안내·콜백 성공/실패·응답 생성 실패를 실제 PostgreSQL로 확인합니다. 일반 안내 전달 표시는 상태/시각 두 열만 고치며 결제/버튼/사진 안내는 해당 업무 렌더러에 남깁니다.

- 552 추가 확인: 서로 다른 테이블의 같은 밀리초 안 생성 시각도 PostgreSQL 마이크로초 정밀도를 유지해 비교합니다. 순서 역전 재현1개를 포함해 관련34개가 통과했습니다.

(553) 인증 뒤 안내 스킬(API-073)이 전체 응답 기한에 닿으면 DEC-20대로500을 반환해 카카오 전송을 막습니다. 메시지/카드/후기의200 server_error와 인증 전500은 유지합니다. 모의 시계와 실제 PostgreSQL 지연 질의로200/기대500의 두 실패를 재현했으며, 수정 뒤 관련30개와 전체 타입이 통과했습니다. 실제 DB의 미완료 쓰기는 중단 뒤0행이고 늦은 안내 내용은 노출하지 않습니다.

(554) 카카오 Event API 공통 전송 모듈(`app/server/src/kakao-event.ts`)과 시험 72개를 합칩니다. Workers의 fetch 요청 옵션에 없는 `cache`를 지워 타입 오류(TS2353)를 고쳤습니다. 서비스와 앱 경로에는 아직 연결하지 않았습니다.

(555) 무료 MVP의 진행 조건은 끝남과 구현 완료를 구분합니다. 구현 완료에는 코드/시험 조건, main app·db와 스테이징 성공, 구체적인 실환경 확인 목록이 모두 필요합니다. 코드 오류는 횟수로 중단하지 않고 고쳐 검사하며 바깥 원인의 반복 실패만 따로 남깁니다. 결제와 반복 9는 출시 검토로 미루고 합성 자료만으로 무료 운영 환경까지 배포합니다.

(556) TASK-020의 MVP 동의 제외는 인가 주소의 scope와 로그인/내 정보의 채널 조회·친구 기록·배너를 함께 시험합니다. 기본 상태와 plusfriends를 명시한 상태를 나누고, 기존 사장님의 친구 값과 확인 시각을 보존하는지 실제 PostgreSQL에서 확인합니다. 외부 화면 확인은 코드 검사와 별도로 기록합니다.

- 556 추가 확인: 배포 뒤 로그인 점검도 plusfriends를 필수로 요구하고 있어 3개 실패 시험으로 고쳤습니다. 점검의 기대 동의 항목은 같은 이름의 Actions 변수이며 기본은 scope 생략입니다. 전체 앱·도구 검사는 통과했고 Google 글꼴의 외부 503/CORS 실패는 코드 오류와 구분해 기록했습니다. 브라우저 도구는 동희님 19:47 KST 추가 지시의 학원컴 Aside CLI를 사용합니다.

(557) TASK-020의 실제 로그인만 남았을 때는 구현 완료와 finished를 구분해 기록하고 TASK-028을 계속합니다. 콜백 소비자가 모델 설정 여부만 보고 실패 안내를 확정하지 않도록 정상 모델 결과/실패 종류/중복 처리의 시험을 먼저 작성합니다. 원격 SHA·최신 생성 배포 태그·로그인 시작 응답과 사람 확인 대기는 따로 기록합니다.

- 557 진행: 성공한 모델 출력의 거부 사유도 ai-calls.ts 한 곳에서만 기록합니다. 제한 역할에는 ai_calls의 INSERT와 fallback_reason UPDATE, 초안의 자유 입력 항목만 허용하고 비용/연락처/알레르기/DELETE는 막습니다. 모델 실패 5종·재시도 1회·고지 없음·제한 역할 정상/거부를 포함해 전체 서버 1,297개와 웹 237개, 타입/빌드가 통과했습니다. 중단 복구와 실제 스테이징 적용은 이어갑니다.
- 557 추가 확인: 중단 복구 4개를 통과했고 기존 프록시 적용 후 실제 OpenAI의 합성 문구 1건도 로컬 DB에서 호출/초안/모의 콜백 각 1회를 확인했습니다. 학원컴 Aside의 Supabase SQL Editor에서 기존 서버 역할의 권한 SQL을 적용하고 허용/차단 25개를 확인했습니다. 실제 스테이징 쓰기/모델 연결과 API-072 업무 중복·G4/G5 서비스 연결은 다음 변경에서 이어가며 TASK-028 finished는 표시하지 않습니다.

(558) TASK-028의 공통 전송 서비스와 실제 서버 역할 쓰기를 이어갑니다. 권한 확인 SQL은 새 합성 행만 만들고 전체 ROLLBACK하며 비용/연락처/알레르기/삭제의 차단도 확인합니다. 카탈로그 권한 확인과 실제 역할의 쓰기 결과를 구분합니다.
- 558 서비스 연결: 메서드 없음의 4개 실패 뒤 Services.kakaoEvents를 연결해 관련 91개·전체 타입이 통과했습니다. 기존 우리 앱 REST 키를 쓰고 클라이언트 생성 자체는 외부 발신을 하지 않습니다. 시험의 모의 반환값 타입을 명시해 문자열 확장 오류도 고쳤습니다.
- 558 API-072: 글 후기의 수신 키·버전 쓰기를 한 트랜잭션으로 묶어 실제 업무 중복을 확인합니다. API-070의 빈 출력과 달리 API-072 반복 요청은 감사 답을 다시 보냅니다. 관련 47개·전체 타입이 통과했고 사진/게시 동의 전체는 TASK-145가 이어갑니다. Aside의 쓰기 확인 원 실행은 UI 결과 유실로 미확인이며 롤백/합성 가게 0개만 확인했습니다.
- 558 최소 권한: 주문 식별/상태와 후기 버전 쓰기 권한 2문장을 더해 실제 제한 역할의 같은 HTTP 세 번을 한 버전으로 저장했습니다. 금액/기존 후기 본문 조회·수정/삭제는 막으며 관련 24개가 통과했습니다. 쓰기 확인은 pg_temp 함수의 내부 저장점에서 되돌린 뒤 결과 한 행을 반환하는 방식으로 바꾸고 로컬 통과를 확인했습니다. 실제 UI 확인은 이어갑니다.
- 558 실제 결과: 새 반환 방식은 실제 서버에서 42501·허용 쓰기 false/차단 0이며 롤백/역할 복원은 true입니다. 실제 쓰기 확인만 멈추고 코드 작업을 계속합니다. 후기 권한 2문장은 실제 적용됐고 기존 스테이징 역할의 orders.amount SELECT는 원래 true라 취소하지 않았습니다. 로컬 새 제한 역할의 차단과 기존 역할 보유 권한을 구분합니다. 최종 전체 타입·서버 1,317개·웹 237개·빌드 819ms가 통과했습니다.

(559) TASK-016의 실제 실패 메일 확인을 이어갑니다. 기존 Free 정책의 활성화/이메일 연결과 수신자 일치 미확인을 구분하고 GitHub Actions 실패 이메일을 켠 뒤 저장/재확인했습니다. 의도한 경보 workflow 한 번의 실패와 해당 Gmail 실행 알림을 대조하며 app/db CI와 구분합니다. 시험 발신은 실행 전이고 비밀 값/메일 주소는 기록하지 않습니다.
- 559 실제 수신: main/source=external의 경보 실행 45024045647을 한 번 요청했고 alert 단계의 정한 오류/exit 1과 21:47:19 KST Gmail 알림의 같은 실행 링크를 확인했습니다. 외부 경보 수신과 Cloudflare 일 실행기 정책 수신을 구분해 후자는 미완료로 남깁니다. 전체 타입·서버 1,317개·웹 237개·빌드 593ms가 통과했습니다.
- 559 샘플 수신: Cloudflare 기존 수신자 일치와 샘플 요청 1회 뒤 21:54:24 KST 정책명이 같은 메일을 확인했습니다. 실제 일 실패 로그 발동과 구분하며 조회 1분/실행 15분의 공백은 기존 무료 정책에서 실패 8종·평균/실행 15분으로 저장하고 다시 열어 확인했습니다. 임계치/재알림/대상/수신자/활성화는 유지했습니다. 메일 주소/메일함 식별자는 공개 기록에 넣지 않습니다.

(560) TASK-183은 Workers Free를 유지하고 처리기에 전달된 CPU 한도 오류를 실패 시험에 포함합니다. 바이트/스트림의 두 수신 경로에서 원본으로 돌아가지 않고, API-007의 503 재업로드 안내 뒤 같은 사진을 다시 올리면 정규화 파일 하나만 남는 것을 확인했습니다. 관련 96개·전체 타입·서버 1,323개·웹 237개·빌드 594ms가 통과했습니다. 실제 합성 40개 성공/CPU P999 최대 459.208ms 위험은 그대로 기록하며 무료 CPU 충족 판단은 WBS README 10절의 TASK-167 이관 행에 남기고 finished를 생성합니다. 강제 CPU 중단 실측과 예외 모의 시험을 구분합니다.

- 560 최종 확인: 단계 9개가 전부 종료 0이며 API 17/17·목업 14/14·WBS 18개/오류 0입니다. 무료 CPU 판단을 출시 검토에 둔 끝남은 30/183개·반복 1은 15/22개이며 착수 가능 21개입니다. 최종 CI/main 확인 뒤 TASK-027을 계속합니다.

(561) TASK-030은 기존 로그인 응답 처리를 유지하며 09의 카카오 공식 버튼과 360/1280 실제 화면 확인을 이어갑니다. PNG의 심볼/레이블 비율을 보존하고 누르는 높이 44px 이상과 자산 로딩을 검사합니다. 실제 로그인 성공과 화면 확인은 구분합니다.

- 561 공식 자산: 이미지 부재의 실패 뒤 원본 PNG를 적용했고 관련 웹 43개·360/1280 page-check 22개가 통과했습니다. 해시와 출처를 owner-login 기록에 남기며 그림/색상/비율은 바꾸지 않았습니다. 로딩/한도/일반 재시도는 기존 08 상태를 유지합니다.

- 561 토큰 수정: 첫 전체 서버 1,323개는 통과했고 CSS 직접 값 금지 1개가 실패했습니다. 09 기본 55개를 보존하고 카카오 공식 규격 3개를 별도 원본/생성기에 연결해 관련 66개·22개 page-check가 통과했습니다. 금지 검사는 유지하고 최종 전체 앱을 다시 확인합니다.

(562) TASK-027의 실제 평가 재개 전에는 동시 호출 1개와 요청 간격·Retry-After·중간 결과 보존을 모의 시험으로 확인합니다. 이미 성공한 사례를 다시 호출하거나 과거 비용을 지우지 않고 원본 판정 44건과 실제 OpenAI 실행 결과를 구분합니다. 아직 새 실제 모델 호출은 하지 않았습니다.

- 562 속도 제한: 모듈 부재의 실패 뒤 요청 간격·숫자/HTTP 날짜 Retry-After·긴 대기의 재개 시각 보존·잘못된 설정 거절 17개가 통과했습니다. 실제 실행기 연결/중간 저장은 아직 진행 중이며 새 실제 호출은 없습니다.

- 562 재개 연결: 중간 저장 모듈 부재 뒤 원자적 예약/결과·미확정 호출 거절·성공 사례 재사용·사용량 미확인분 비용 여유·실제 CLI 재개를 포함한 관련 55개와 전체 타입/lint가 통과했습니다. 선택 인자의 undefined 타입과 import 순서 오류를 고쳤으며 전체 앱 검사를 진행합니다.

- 562 실제 평가: OpenAI 성공 3/134와 새 한도 실패 2회 뒤 중단을 보존했고 Anthropic은 첫 연결 실패 한 건만 재개해 134개 답을 확보했습니다. 새 검토 37사례/38판정은 Codex가 근거와 판정해 미해결0이며 기존 기계 실패와 합친 실패17개를 보존합니다. 옛44건 원문 미확인과 모델 품질 미달을 통과로 바꾸지 않습니다.

(563) TASK-030의 실제 정상/인가 거부 화면을 학원컴 Aside CLI에서 360×800·1280×800으로 확인했습니다. 전체 스냅샷/화면 사진 각 4개, PNG 200·448×92·버튼 높이 48px·가로 넘침 없음과 오류 안내/쿼리 제거를 대조했습니다. 기존 네 상태/12응답·page-check 22개와 함께 화면 작업 finished를 생성하며 실제 계정 인증은 Vault 잠금으로 TASK-020에 남깁니다.

- 563 검사기 수정: 옛 finished 의존 검사 실패 뒤 현재 구현 완료 표의 완전한 행만 인정하도록 바꿨습니다. 과거 표/빈 항목/없는 작업을 거절하는 회귀 시험 4개와 WBS 18개/오류 0이 통과했고 TASK-020 finished는 유지했습니다.

- 563 최종 검사: 전체 타입·서버 1,351개·웹 237개·빌드 765ms와 단계 9개가 전부 종료 0입니다. API 17/17·목업 14/14·WBS 18개/오류 0이며 키 725개 파일/0·추가 용어/언어 0입니다.

(564) TASK-032의 가게 등록·내 가게 조회를 시작합니다. 사장님 인증은 구현 완료 기반을 사용하고 위탁 동의/신고증/요청 키/동시 등록과 교차 사장님 조회를 실패 시험부터 확인합니다. 실제 로그인 대기와 코드 수락 조건을 구분합니다.

- 564 첫 구현: 경로 부재의 실패 6개 뒤 정상 등록/동의 거절/신고 기관·사진 누락/401/미등록 404가 통과했습니다. 사장님 전용 등록과 기존 가게 범위 조회를 연결했고 정적/교차 가게를 합친 관련 55개·타입이 통과했습니다. 응답별 나머지/동시 요청/실패 보상은 이어갑니다.

- 564 응답/실패 보상: 제한 역할의 500 뒤 등록 열/변경 조회/요청 키 권한을 더했고 승인·예약 링크/삭제 권한은 유지했습니다. 본문 형식 검사 누락의 실패도 고쳤으며 중복/동시·저장소 503·설정 500·커밋 응답 유실·사진 만료·사업자 변경 조회를 포함한 관련 99개와 전체 타입/lint가 통과했습니다. 실제 스테이징 권한은 아직 적용 전입니다.

- 564 최종 조건: 전체 타입·서버 1,396개·웹 237개·빌드 1.22초와 head aecedad6 app/db가 통과했습니다. Aside에서 새 GRANT 3문장과 등록 19개 열/변경 조회 true, 승인·예약 링크·삭제 false 유지의 전후를 확인했습니다. 실제 서버 역할 쓰기/계정 등록은 미확인으로 구분하며 WBS 자동 시험 조건을 대조해 TASK-032 finished를 생성합니다.

- 564 오류 사유 경계: 빈/긴 영업 종류 문자열의 실패 2개 뒤 허용 목록을 먼저 검사해 not_allowed를 반환합니다. 관련 101개·타입/lint가 통과했습니다. 단계 첫 실행의 외부 글꼴 CORS 실패는 코드 오류와 구분하고 목업만 재확인합니다.

- 564 새 코드 전체 검사: 관련 101개·전체 타입/lint·서버 1,398개·웹 237개·빌드 792ms/Worker dry-run이 통과했습니다. 이 검사 뒤 앱 코드는 그대로이며 최종 CI와 외부 글꼴의 목업 재검사 결과를 같은 PR에서 확인합니다.

- 564 외부 검사: 목업 단독 재검사도 Google 글꼴의 CORS/503으로 13/14·종료 1입니다. 두 번 실패한 외부 글꼴 검사만 멈추며 단계 8개 종료 0과 구분해 PR에 기록합니다. 앱 코드/시험·디자인/검사는 바꾸지 않았고 합치기는 AGENTS.md 10번의 app/db CI 기준을 적용합니다.

## PR #167 — PR 리뷰 규칙

(565) 리뷰한 SHA 이후 발견 사항 처리와 `main` rebase만 했다면 처리 댓글에 관련 커밋과 새 head SHA를 적어 그 리뷰를 적용합니다. 다른 변경은 재리뷰 요청을 적고 병합 뒤 확인합니다. 병합 직전 Codex 요청이 사용 한도로 실패하거나 30분 안에 응답이 오지 않으면 PR 댓글에 기록합니다.

(566) TASK-041의 영업 캘린더와 그날 주문 마감을 시작합니다. 기존 주문/자리 보존과 날짜 행 잠금을 확인하고 REQ-261의 가예약/최대 개수 사전 확인을 빠진 API 확인 항목에 반영합니다. 계약 원본과 깨지는 변화 검사를 대조하고 실패 시험부터 구현합니다.

- 566 중간 구현: API-026~029 기본 7건/사전 확인 4건 실패 뒤 가게 범위·날짜 잠금·기존 예약 보존과 미발송 안내 재계산을 연결했습니다. 관련 192개·타입/lint가 통과하며 최소 권한을 로컬 제한 역할로 확인했습니다. 실제 권한 적용·전체 검사·후속 예약 경로의 수락 대조는 남았습니다.

- 566 수락 대조: 서버1,465·웹237·타입/lint/빌드와 단계9개가 통과했습니다. 실제 잠금 대기와 재전송, 본문 형식도 확인했습니다. 목업 실행기의 캐시 재사용은 합성5페이지/자원1회와 오류 보존을 검사했고 실제113개/14검사도 통과했습니다. Aside 연결2회 실패로 실제 GRANT는 미실행입니다. 예약 날짜/자리/발송의 후속 코드가 남아 finished/구현 완료를 표시하지 않습니다.

(567) TASK-041 후속 예약 날짜·새 자리 판정과 안내 시각 찾기를 시작합니다. 아직 없는 함수의 시험2건이 실패했고 format/lint는 통과했습니다. 실제 예약/발송 연결과 수락 조건이 남아 완료로 세지 않습니다.

- 567 판정·안내 찾기:60일 공개 상태와 날짜 잠금 뒤 판정을 구현했고 관련92개·타입/lint가 통과했습니다. 안내 시각을 바꾼 뒤 옛 시도 표만 보고 일찍 찾던 실패를 고쳐 찾기/잡기 둘 다 새 예정 시각을 확인합니다. main b6e5633 배포/상태200과 인증 없는4경로401도 확인했습니다.

- 567 전체 검사: 서버1,469·웹237·타입/lint·빌드1.15초가 통과했습니다. 공개 날짜/잠금 뒤 판정·새 예정 시각 찾기의 모듈을 확인했으며 전체 예약·실제 발송 성공과 구분합니다. 실제 계정/기존 역할은 Aside2회 중단 때문에 미확인이고 main CI/배포 뒤 구현 완료 목록을 갱신합니다.

- 567 Claude 리뷰3건: 실패5건 뒤 기간 밖을 잠금 전에 거절하고 판정의 빈 날짜 생성을 없애며 오류 필드를 인자로 받았습니다. 커밋된 거절/휴무/열린 날 판정의 행0건과 설정 버전 불변을 확인했습니다. 관련97개·타입/lint가 통과했습니다.

(568) TASK-038 가격표·도안 버전 API-016~019를 시작합니다. 경로 부재의6건 실패를 확인했고 format/lint가 통과했습니다. 이전 버전 보존·변경 없는 저장·사진과 범위의 같은 버전 저장을 구현합니다.

- 568 첫 경로: 현재/버전 목록/버전 하나·첫 저장·변경 없음·401의6개가 통과했습니다. 가게 범위 저장 선언을 맞췄으며 타입/lint가 통과했습니다. 버전/도안 보존·사진 실패·동시·교차 가게와 전체 검사는 남았습니다.

- 568 도안/실패 보상: 관련94개가 통과했습니다. 이전 버전 금액/범위/사진과 원본을 보존하고 새 복사 실패·복사 응답 유실은 정리하며, 커밋 응답만 잃은 사진은 유지합니다. 같은 파일은 새 주소로 열어 본 내용과 저장 객체로 확인했습니다.

- 568 입력/권한: 다른 가게41개·입력41개·응답/사진27개와 제한 역할10개가 통과했습니다. 권한 부재500 뒤 읽기/새 버전 INSERT·교체 시각 UPDATE만 더했고 이전 옵션/도안 수정과 삭제를 거절했습니다. PR #169 main354868c의 CI/배포·학원컴 태그/상태200도 확인했습니다.

- 568 전체 검사: 서버1,550개·웹237개·타입/lint·빌드877ms/Worker dry-run이 통과했습니다. 네 API 응답과 SPEC-004의 버전/범위 대조를 기록했고 실제 권한 적용·견적 업무 연결과 구분합니다.

- 568 리뷰 지적: 실패8건 뒤 외래 키와 양립하는 잠금·계약 정규식·오류 모으기·범위 생성 정적 검사를 고쳤고 관련148개·타입/lint가 통과했습니다. Free 외부 요청 모의 한도의17/26장 잔류는 해결로 적지 않고 PR 설계 메모대로 알려진 제한과 확인 대기에 남깁니다.

- 568 수정 뒤 전체: 서버1,560개·웹237개·타입/lint·빌드1.05초/Worker dry-run이 통과했습니다. 새 CI/보안 결과 대기이며 알려진 사진 한도 때문에 finished는 표시하지 않습니다.

(569) TASK-041의 병합 뒤 리뷰를 후속 처리합니다. 지난 기록/같은 자리의 시각 변화·빈 날짜 null 버전 우회·확인 날짜의 실패6건을 먼저 확인했습니다. 실제 권한 적용 대기와 코드/자동 확인을 구분합니다.

- 569 리뷰 처리: 설정의 과거 기록/같은 자리 시각 의존과 null 우회를 없애고 날짜 확인/예시를 맞췄습니다. 안내 잠금의55P03 실패 뒤 바뀐 종류만 잠그고 갱신1번·시도 표 보존을 확인해 관련122개가 통과했습니다. 설정/해시/본문 검사를 공유하고 타입/lint가 통과했습니다.

- 569 전체 확인: 서버1,479개·웹237개·타입/lint·빌드910ms/Worker dry-run과 단계9개가 통과했습니다. 지적별 처리/실환경 미적용/보안 도구 미실행을 대조표에 구분했고 ready 리뷰를 기다립니다.

- 569 추가 리뷰: 실제 코드/보안 도구의 취약점0건과 동작/계약5건을 구분했습니다. 날짜 버전의 시각 의존·계약 설명·자정 재조회·확인 예시 속성·모듈 주석을 처리했고 실패1건 뒤 관련123개가 통과했습니다.

- 569 추가 수정 전체: 서버1,480개·웹237개·타입/lint·빌드763ms와 단계9개가 통과했습니다. 자정/날짜 버전 회귀와 계약 설명을 맞췄으며 실제 권한 적용·main 배포 전 완료 표시는 하지 않습니다.

- 569 main 결합: 가격표 main3d05899 반영 뒤 전체 서버1,566개·웹237개·타입/lint·빌드732ms이 통과했습니다. 리뷰 지적 처리/기록과 main 반영만 추가됐으며 실제 권한/최종 배포 전 완료 표시는 하지 않습니다.

(570) TASK-039 운영규정 버전을 시작합니다. 템플릿·현재/이전·저장/변경 없음·401의6개 실패를 확인했습니다. 조문·환불 단계와 확인 선택을 같은 버전에 남기고 입력/카드 글 한도를 검사합니다.

- 570 첫 구현: 현재/이전/목록·템플릿·새 버전·변경 없음의6개가 통과했고 타입/lint가 통과했습니다. 조문/단계/위험 확인·카드 글 한도와 구체적인 실패/권한 시험은 이어갑니다.

- 570 수락 보강: 환불 경고/확인·조문/단계/옛 버전·카드 글 한도의15개와 타입/lint가 통과했습니다. 최신 가격표 main을 반영하고 가게 분리·권한/입력 경계 검사를 이어갑니다.

- 570 최소 권한: 읽기500 뒤 규정/조문/단계 추가와 교체 시각만 더해 관련71개가 통과했습니다. 옛 조문 수정·단계 삭제를42501로 거절하며 실제2문장은 미적용입니다. 가격표 main3d05899의 CI/학원컴 태그·상태200과 인증 없는4경로401도 확인했습니다.

- 570 전체 확인: 서버85파일/1,620개·웹237개·타입/lint·빌드823ms/Worker dry-run이 통과했습니다. SPEC-005/API-020~023/A21의 제공 범위와 실제 권한 미적용을 대조표에 구분했으며 최종 CI/리뷰를 기다립니다.

- 570 Claude 지적: 운영규정5건·가격표 시각1건의 실패 뒤 관련144개가 통과했습니다. 카드 한도 우선, 원문 보존/한 줄 표시, 넘친 행만 표시, 일관된 교체 시각, 조문/단계의 일괄 INSERT를 적용했습니다. 입력 공통화는 서로 다른 항목/참조 규칙의 넓은 변경을 피하고 독립 계약 시험을 유지하는 이유를 기록했습니다.

- 570 리뷰 최종 전체: 순차 서버1,627개·웹237개·타입/lint·빌드965ms/Worker dry-run·WBS18/0·키/용어0이 통과했습니다. 실제 역할/계정과 최종 main 확인은 통과로 세지 않습니다.

### (571) TASK-040 암호화 계좌 등록·교체와 예금주 확인

- 계좌 API가 없는 실패4건부터 시작했습니다. 계좌/가게 분리/제한 역할103개가 통과했고 확인된 이름/추가 확인/옛 계좌와 기존 안내 보존/알림1건/동시 요청/DB 실패 되돌림을 확인했습니다. 은행·예금주·계좌·주소·확인 목록의 입력 경계도 검사합니다.
- 계좌번호는 기존 가게별 암호화 봉투와 끝4자리만 남깁니다. 예금주 승인 이력은 같은 가게의 기존 운영자 확인을 읽으며 사장님 역할이 새 확인 이력을 쓰지 못합니다. 새 계좌와 옛 교체 시각/알림을 같은 트랜잭션으로 남깁니다.
- 제한 역할 GET500 뒤 최소 등록 필드/교체 시각 권한을 더했습니다. 마이그레이션0026의 INSERT 트리거는 보류를 확인 기다림으로만 바꾸며 일반 승인 권한은 늘리지 않습니다. 임의 승인·예금주 확인 수정·삭제는42501입니다. 함수 검색 경로/공개 실행 금지와 DB 규칙도 검사했습니다.
- 설계9단계03:16:51~03:20:04 종료0·빌드876ms/Worker dry-run·타입/lint를 확인했고 전체 앱 순차 결과는 이어 기록합니다. 실제 계정/권한2문장/마이그레이션은 미확인·미적용이며 finished는 표시하지 않습니다.

- 571 최신 main 결합: 서버1,680개·웹237개·타입/lint·빌드596ms/Worker dry-run이 통과했습니다. 운영규정/계좌의 시험과 최소 권한을 모두 보존했고 실제 계정/권한2문장/0026은 확인 전입니다.

### (572) TASK-042 채널 설정·키 교체와 선점

- 경로 부재5건·가게 분리 등록 누락4건·제한 역할 저장500부터 확인했습니다. 관련113개가 통과하며 키23시간 수신/24·25시간 거절·즉시 폐기·바로 앞 버전만 수신,30분 선점/실패 되돌림·동시200/409를 확인했습니다.
- 키/연결 문구는 기존 시크릿과 별도 HMAC 문맥에서 만들고 저장하지 않습니다. 내부 순번으로 현재 설정을 찾고 옛 linked 연결/새 pending 설정을 구분합니다. 다른 가게 ID/내용을 반환하지 않는 선점 함수는 고정 검색 경로/공개 실행 금지로 두고 공통 잠금 뒤 자기 행을 잠급니다. 잠금을 뺀 시험은200/500으로 실패하고 복구 뒤200/409입니다.
- 새 역할 권한은 함수 실행·등록 필드·설정/키 UPDATE만입니다. 기존 봇/가게 ID 변경·삭제는42501이며 순번 DEFAULT는 성공합니다. 블록 누락/다른 입력 오류가 사라지는 실패2건도 고쳤습니다. 설계9단계가 통과했고 실제 계정/역할·0027/권한3문장은 대기입니다.

- 572 전체 확인: 서버1,731개·웹237개·타입/lint·빌드800ms/Worker dry-run·9단계/규칙356개가 통과했습니다. blockIds 객체의 오류2건을 보완했으며 실제 적용/계정 확인과 최종 main은 통과로 세지 않습니다.

- 572 부모 main 확인: 계좌 main0c64f0a CI/배포/학원컴 확인을 기록하고 동일한 부모 트리를 검증한 뒤 채널 가지의 기준을 연결했습니다. 실행 파일 내용은 전체1,731개 검사 때와 같고 실제 권한/0027은 미확인입니다.

- 572 Claude 리뷰 후속: 실패6건 뒤 옛 linked와 현재 설정의 키 수명을 함께 적용하고 SQL10분 만료/GET 없는 재저장을 고쳤습니다. 기존 행 순서는0027을 바꾸지 않고 새0028로 보정하며 독립 DB 시험을 추가했습니다. botId 형식은 입력 계약을 유지합니다. 전체 검사/원장 시험은 커밋 뒤 이어 기록합니다.

- 572 리뷰 수정 전체 확인: 서버88파일/1,739개·웹237개·타입/lint·빌드591ms/Worker dry-run·관련58개·설계9단계04:40:39~04:43:58 종료0·규칙356개/안 막힘0이 통과했습니다. 수정 head5f3ee2a5 app/db도 성공했습니다. 실제0027/0028/권한·계정/PC는 대기입니다.

### (573) TASK-034 운영자 영업 신고 판정

- 경로 부재6건 뒤 API-012/013/014와 진짜 로컬 합성 운영자 세션을 붙였습니다. 전용 목록/중복 기능의 정확한 두 SQL과 범위 검사를 두고 상세는 등록 정보/은행/예금주/끝4자리만 읽습니다. 마이크로초 커서의 반복과 공통 삽입 형식 오류를 고쳐 관련150개를 확인했습니다.
- 버전은 가게/현재 계좌/대기 중인 신원 변경을 함께 가리킵니다. 두 운영자200/409 already_decided, 다른 변경409, 재전송 한 번, 확인됨 재확인/보류 금지를 시험했습니다. 보류 알림 DB 실패는 판정/할 일도 되돌립니다.
- 새0029는 살아 있는 운영자/세션·현재 상태를 다시 확인하고 가게/현재 계좌에 같은 확인자/시각을 남깁니다. 조회2문장/함수 실행1문장만 더하며 일반 승인/예금주 확인 UPDATE는 로컬 새 역할에서42501입니다. 실제0029/권한3문장·TOTP/계정·카카오 발신은 미확인입니다.

- 573 커서0000년을 받던 입력 실패1건을 재현해422로 막았고 관련6파일151개/타입/lint가 통과했습니다. 그 전 전체1,804개/웹237개·빌드772ms·설계9단계/DB 규칙369개는 통과했고 최종 입력 수정 뒤 전체 검사를 다시 진행합니다.

- 573 최종 전체 서버90파일/1,805개·웹237개·빌드684ms/Worker dry-run·관련151개·타입/lint가 통과했습니다. 설계9단계04:53:56~04:57:17 종료0·규칙369개/안 막힘0 뒤의 변경은0000년 커서 입력 경계/시험/기록뿐이며 DB/권한/계약은 그대로입니다. 실제0029/권한3문장·계정/발신은 대기입니다.

- 573 Claude6건 중 보류 할 일 수명/공백/limit은 실패11건 뒤 고쳤고 목록 버전의 직접 승인 시험을 더했습니다. 새0030/내부 정리는 일반 수정 권한을 넓히지 않으며 과거 pending 예약만 비웁니다. 관련91개·전체1,819개/웹237개·빌드684ms·타입/lint·설계9단계05:33:37~05:37:21 종료0·DB 규칙376개/안 막힘0이 통과했습니다. 실제0029/0030/권한/계정은 대기입니다.

### (574) TASK-043 연결 문구와 시험 버튼 다섯

- 경로 부재7건에서 시작6개를 통과시키고 문구/같은 시험 사용자·설정 블록 ID/스킬로 검증을 붙였습니다. 다섯이 모두 닿으면 옛 연결을 retired로 바꾼 뒤 새 연결만 linked로 두고 실제 Event API는 요청/조회하지 않습니다. 시험과 연결 뒤 재전송은 일반 상담/후기를 만들지 않습니다.
- 가게 분리/제한 역할을 포함한 관련3파일87개와 추가 경계28개가 통과했습니다. 마이크로초10분/30분 선점·동시/중복·다른 사용자·옛 키401, 제한 역할 권한 제거500/같은 키 복구200을 검사했습니다. 새 시험 자료의 DB 제약/CASE 시각 형식 오류도 고쳤습니다.
- API 결과/예시와 A19의 다섯 블록/A20의 무료 예외를 맞췄습니다. 권한/마이그레이션은 추가하지 않았으며 전체 앱/설계9단계는 진행 중입니다. 실제 스테이징/PC·Event API 발신은 미확인이고 finished는 표시하지 않습니다.

- 574 첫 전체의 미연결/응답 시간 회귀9건을 확인해 시험 표시/문구 후보만 새 트랜잭션으로 보냈고 관련5파일119개가 통과했습니다. 화면C10의 옛 먼저 보내기 약속도 원본에서 무료 문구/출시 검토 대기로 고쳐 생성했습니다. 첫 전체/설계 실행은130 중단이며 수정 뒤 전체 검사를 새로 진행합니다.

- 574 전체 확인: 서버91파일/1,849개·웹237개·타입/lint·빌드633ms/Worker dry-run·관련119개, 새 설계9단계05:54:17~05:57:45 KST 종료0·DB 규칙376개/안 막힘0·WBS18/0·키774파일/0이 통과했습니다. 추가 원문/문서·생성 HTML의 실제 추가/변경 텍스트 용어/일본어/한자0이며 실제 스테이징/PC·Event API는 대기입니다.

- 574 Claude7건의 수신 전역 잠금/시작 시각·선점 오류/운영 기록·무료 계약/화면을 고쳤습니다. 만료/블록 목록/타입은 공유하고 내보낸 함수의 범위 방어는 유지합니다. 잠금/시각 실패 재현 뒤32개가 통과했고 수정 뒤 전체/설계를 다시 검사합니다. 실제 계정/발신은 대기입니다.

- 574 리뷰 수정 최종 확인: 서버91파일/1,853개·웹237개·타입/lint·채널32개·빌드709ms/Worker dry-run이 통과했습니다. 목업C8의 옛 순서 글은 원본/생성기로 고쳤고 최종 설계9단계06:26:13~06:29:21 종료0·DB 규칙376개/안 막힘0입니다. 앱 실행 코드/마이그레이션은1,853개 검사 뒤 그대로이며 실제 역할/계정/PC·Event API는 대기입니다.

### (575) TASK-037 가게 설정 부분 저장

- 경로 부재405/본문 읽기26실패에서 API-010의 부분 저장과 현재 값 기반 통신판매업 결합 검사를 고쳤습니다. 같은 값은unchanged, 같은 버전 동시 저장은200/409, 같은 키는 최근 값만 읽습니다. 입력/본문/요청 키·서명 실패500/같은 키 복구도 확인했습니다.
- 가게 분리/제한 역할을 포함한 관련3파일113개가 통과했습니다. 제한 역할 저장500 뒤 설정13열/수정 시각 UPDATE1문장만 더했고 일반 신원/승인 수정/삭제는42501입니다. 기존120분 기다림은 그대로, 새 질문부터30분이며 AI 한도를 낮추면 실제 수신이 모델/큐 없이 넘기고 올리면 모의 큐에 넣습니다.
- [수락 대조](shop-settings/task-037-acceptance.md)에 API 제공과 후속 예약 페이지/주문 요청/문의 끊김/지연 발송 연결을 구분했습니다. 실제 계정/권한은 대기이고 전체 앱/설계 검사는 진행 중입니다. finished는 표시하지 않습니다.

- 575 전체 확인: 서버92파일/1,892개·웹237개·타입/lint·빌드787ms/Worker dry-run·관련113개·설계9단계06:06:34~06:09:55 종료0·DB 규칙376개/안 막힘0이 통과했습니다. 부모 PR #176 병합/main 확인 뒤 고유 변경을 대조해 ready PR을 엽니다. 실제 새 권한/계정과 후속 흐름은 미확인입니다.

- 575 최신 부모 확인: main29eff88의 CI/배포·학원컴 같은 태그/상태200·무인증 시작401과 TASK-043 구현 완료11개를 기록했습니다. 부모 리뷰를 합친 서버1,896개·웹237개·타입·빌드699ms/Worker dry-run과 설계9단계06:32:34~06:35:38 종료0·DB 규칙376개/안 막힘0이 통과했습니다. 마지막 목업/기록 병합은 앱 실행 코드/계약/DB/권한 변화0입니다. 실제 설정 권한1문장/계정은 대기입니다.

- 575 코드/보안7086372010의5건 처리: 가게 전체 버전의 보수적 교차 충돌은 계약을 유지하며 양방향409/새로 읽기 시험으로 고정했습니다. 입력 조합별 SQL/중복 조회 실패3건을 고친 뒤 고정13열 UPDATE와 RETURNING/잠금 행 재사용, 등록/설정 공통 문자열·통신판매업 검사로 바꿨습니다. 실제 새 권한1문장/계정은 대기이며 설정 화면은 아직 제공하지 않았습니다. 관련63개·타입과 새 데이터베이스 전체 서버1,900개/웹237개·빌드598ms/Worker dry-run·설계9단계06:57:42~07:01:05 종료0·규칙376개/안 막힘0이 통과했습니다. 첫 누적 공용 데이터베이스의 평문 검사5초 초과1건은 숨기지 않고 새 빈 데이터베이스로 재현 조건을 분리했으며 검사/시간 제한은 그대로입니다.

### (576) TASK-036 사업자 변경 요청·운영자 판정

- 사장님 요청/운영자 목록·반영·보류와 같은 명령의 할 일 없는 알림을 연결했습니다.0031의 시각 인자/열 충돌은 적용본을 보존해0032에서 고쳤고 같은 시각의 최신 요청은 내부 순번으로 골랐습니다.
- 관련4파일137개와 제한 역할1개·설계9단계07:03:18~07:06:36 종료0입니다. 증빙 실패/COMMIT 응답 유실·반영 뒤 알림/서명 실패·동시 판정/요청·현재 계좌/이전 신원·마이크로초 커서와 최소 권한을 확인했습니다.
- ERD 정렬 인덱스를 열 이름으로 읽던 오류는 생성/비교의 공통 분류로 바로잡고 편집 도구가 원문 DDL을 보존하게 했습니다. [수락 대조](identity-change/task-036-acceptance.md)에 후속 페이지/발신과 실제 권한 대기를 구분했습니다. 전체 검사와 최신 부모 반영은 진행 중이며 finished는 표시하지 않습니다.

- 576 최신 부모 결합 최종 확인: 서버94파일/1,983개·웹237개·빌드682ms/Worker dry-run,설계9단계07:03:18~07:06:36 종료0·규칙393개/안 막힘0·32개 마이그레이션과 schema 카탈로그 일치입니다. 첫 전체의082를 전체 운영자 범위로만 보던 예전 계약 시험1건은081/082를 명시해 관련33개 후 새 전체로 통과했습니다. 부모 main37c162a의 CI/배포·학원컴 같은 태그/상태200·무인증 PATCH401과 구현 완료12개도 함께 기록했습니다. 실제 새 마이그레이션/역할·계정/발신은 미확인입니다.

- 576 코드/보안7086853964의6건 처리: 새 사업자등록번호 중복 표시는 후속 TASK-059의 계약 대조에 남기며 중복을 받는 결정은 유지합니다. 저장소 확인은 버전/pending/같은 값·재전송 뒤 잠금 안에 유지하고 자기 가게 대기 한계를 기록합니다. 해석기는 두 ID가 없으면 조회하지 않고 중복404를 없앴습니다. 목록/상세의 범위 조건은 의도적으로 달라 정확한 SQL 허용과 기존 버전 일치/판정 시험을 유지합니다. 입력 신원/업로드 규칙과 사진 검사를 등록과 공유하고 복사는 기존 공통 함수를 씁니다. 가게 명령의 cleanup callback은 미호출2실패 뒤 원래 응답/자기 범위·실패 경고를 확인해 관련165개가 통과했습니다. SQL/마이그레이션/권한/설계는 그대로이며 전체 검사를 진행합니다.

- 576 리뷰 수정 최종 확인: 서버94파일/1,985개·웹237개·빌드907ms/Worker dry-run·타입·관련165개가 통과했습니다. 수정 뒤 API/SQL/마이그레이션/권한/설계 원본은 처음 검토한 fbd662c5와 같아 설계9단계07:03:18~07:06:36 종료0·규칙393개/안 막힘0 결과를 적용합니다. 앱 실행 코드 변경 뒤 전체 검사는 새로 했으며 그 뒤에는 기록만 더했습니다. 실제 계정/권한/발신은 계속 미확인입니다.

### (577) TASK-033 보류된 영업 신고 재업로드

- 첫5실패에서 실제 사장님의 보류/버전·신고 번호/종류/사진과 요청 키를 붙였습니다. 로컬 함수 초안으로 증빙/세션/COMMIT 경계를 확인한 뒤 정식0033과 실행 권한1문장으로 옮겼습니다. 일반 판정/신고 UPDATE는 주지 않습니다.
- 최신 부모의 공통 신원/사진 검사·cleanup을 함께 씁니다. 결합 때 한 줄 import의 옛 함수 이름이 남아 생긴16실패는 고쳐 관련160개·타입·전체 서버2,025개/웹237개·빌드917ms/Worker dry-run이 통과했습니다. 설계9단계07:43:17~07:46:42 종료0·규칙404개/안 막힘0·33개 버전과 schema 카탈로그 일치입니다.
- [수락 대조](license-resubmission/task-033-acceptance.md)에 API 응답·자기 보류 할 일/예약 정리·최소 권한과 실제0033/역할·계정 대기를 구분했습니다. 실제 모델/카카오 발신·유료 변경0이며 finished는 표시하지 않습니다.

- 577 검토4건 최종 확인: 옛 사진 삭제는 설계 승인7087365528대로0034에 더하고0033을 보존했습니다. 같은 트랜잭션의 삭제 예약/기존 지우기·새 사진 보존·같은 사진 키 예약0·재전송 한 행·실패0과 enum 오류3실패 뒤 관련144개가 통과했습니다. 받은 버전을 함수에 넘기고 계약의 shop_not_registered로 맞췄으며 세 파서의 문자열 검사를 공유합니다. 새 전체 서버2,030개/웹237개·빌드665ms/타입·설계9단계08:20:11~08:23:33 종료0·규칙406개/안 막힘0·34개 버전 카탈로그 일치입니다. 실제32개/기존 권한 파일은 적용됐고0033/0034·계정은 아직입니다.

### (578) TASK-035 운영자 알림 조회

- API-015 경로 부재2실패 뒤 실제 운영자 범위의 목록 기능만 처리기에 줍니다. 허락한 세 종류의 ID/가게 요약/건수/시각만 읽고 상세 열은 조회하지 않습니다. 시각 내림차순/같은 시각 ID 오름차순과 마이크로초6자리 커서를 씁니다.
- 세션 자료의 고정12시간 위반2건과 전역 시간대 import1건을 고쳐 관련77개·타입이 통과했습니다. 최소 로컬 역할의 상세/쓰기42501·필수 열 제거500/복구200과 잘못된 범위·입력/세션의 조회0을 확인했습니다.
- 0033 결합 뒤 새 빈 데이터베이스 전체 서버97파일/2,049개·웹237개·빌드829ms/Worker dry-run과 타입이 통과했습니다. [수락 대조](operator-alerts/task-035-acceptance.md)에 실제 계정·기존 역할 확인과 CI/main 대기를 구분했습니다. 새 마이그레이션/권한·모델 호출/유료 변경0이며 아직 finished는 표시하지 않습니다.

- 578 최신 부모 검토 수정 결합은 서버97파일/2,054개·웹237개·타입·빌드799ms/Worker dry-run으로 확인했습니다. 부모 원본 트리와 mainff5e936가 같아 기준 연결 뒤 트리 변화0입니다. 실제32개/기존 역할의 허용 쓰기·금지5종·롤백/일시 SET 원복은 확인했고 이 API의 실제 운영자/TOTP 조회는 아직입니다.

- 578 검토7건 처리: 세 알림 종류의 쓰기 상한3실패 뒤 공통 종류/상한과 쓰기 전1,000,000 검사를 더했습니다.0/상한·다른 운영 기록의 정수 최대값 보존을 포함한 관련4파일94개가 통과했습니다. 실제 DEFAULT_TIME_ZONE을 공유하고 FK/NOT NULL이 보장하는 이름 검사는 없앴으며 목록 공백/옛 원장 문장을 고쳤습니다. 부분 인덱스는 측정 전 추정이라 TASK-164의 규모/실행 계획 확인 뒤 판단합니다. 실제34개·부모 main CI/배포/학원컴 동일 태그와 기존 역할의 쓰기/금지5종·새 재업로드/예약/금지3종·합성 자료/일시 SET 롤백을 확인했고 실제 계정/TOTP는 아직입니다. 새 전체 검사를 진행합니다.

- 578 검토 수정 최종 확인: 서버97파일/2,063개·웹237개·타입·빌드832ms/Worker dry-run·관련94개가 통과했습니다. SQL/마이그레이션/권한/설계는 그대로이며 WBS18/0·키799파일/0·추가 기록 용어0입니다. 이후에는 기록만 더하고 실제 운영자/TOTP 조회는 대기로 남깁니다.

### (579) TASK-038 무료 저장소 호출 분리 시험

- 도안50개/Free 계약을 유지하기 위해 별도 비공개 RPC 서비스에서 외부 호출 한도가 나뉘는지 확인했습니다. 첫 두 CLI 인자 오류는 배포 전 실패이고 고친 뒤 학원컴 두 배포/SSH가0입니다. 직접49/51번과서비스51번의50번 한도·서비스30번씩 두 번의60번 성공으로 호출별 분리를 확인했습니다.
- [연구 코드](../../research/storage-budget-2026-11/README.md)와 부모035 main/배포·학원컴 같은 SHA/상태200·무인증401을 기록합니다. 아직 가격표의 실제50개 저장/정리·통합 회귀를 통과한 것은 아니며038 완료로 세지 않습니다. 다음은 작은 서비스 배치와 오류/재전송/정리 검증입니다.

- 첫 통합은 사진17/26/50개의 실패3건 뒤 관련4파일138개·타입이 통과했습니다. 사진 없는 저장의 설정 회귀1건을 고쳤고 최대10개/동시3개·배포 환경 바인딩 누락 차단을 확인했습니다. 부분 복사/COMMIT 응답 유실과 실제 API/전체 검사는 이어갑니다.

- 서비스 클라이언트/실행기를 함께 쓴17/26/50개 저장과 부분 복사 실패3종·이전 사진 보존·같은 키 복구를 확인했습니다. COMMIT 응답 유실/임시 삭제 실패의 재전송 정리2실패를 고쳐 관련5파일164개가 통과했습니다. 사진 없는 저장과 개발 HTTP 저장소는 기존 설정 약속을 유지합니다. 기술 스택/수락 대조를 고쳐 전체/두 Worker 빌드·설계9단계를 이어갑니다.

- 최종 자동 확인: 새 빈 데이터베이스 서버98파일/2,097개·웹237개·타입·빌드582ms와 두 Worker dry-run이 통과했습니다. 설계9단계09:35:55~09:39:22 KST 종료0·규칙406개/안 막힘0·34개 카탈로그 일치·WBS18/0·목업14/14입니다. API/계약/마이그레이션/권한은 그대로이고 실제50개 경로·최종 head 리뷰/CI/main은 이어갑니다.

- 검토6건: 저장된409/진행 중 COMMIT/121개 정리/단일HEAD의4실패를 재현해 수정했습니다.201만 임시 정리·같은 가게 잠금 후 사용 사진 확인·50개씩 공용 정리·공통 설정 검사/한 번 분류/단일 직접HEAD와 운영 배포 순서를 반영했습니다. 관련184개/타입 뒤 새 전체와 현재 head CI를 확인합니다. 실제50개 경로는 아직입니다.

- 검토 수정 최종 자동 확인: 서버98파일/2,102개·웹237개·타입·빌드625ms/두 Worker dry-run·관련184개가 통과했습니다. 현재7de875e0의 app45092744847 검사와 db45092744777 두 버전도 성공입니다. API/설계/마이그레이션/권한은 그대로이고 마지막 변경은 기록뿐입니다. 최종 head CI/리뷰 처리·Codex 요청1회/main과 실제50개 확인을 이어갑니다.

### (580) TASK-038·183 학원컴 Wrangler 인증과 출시 전 Workers Paid 전제

- 원격 측정은 실행 기기에 이미 있는 인증을 사용합니다. SSH 표준 입력에는 계정 ID와 공개 시험 설정·자료만 담고, 캐시된 Wrangler의 `whoami --json` 결과를 배포나 자료 전달 전에 확인합니다. 로그에는 마스킹한 진단과 고정된 미인증 메시지를 남깁니다.
- 공개 출시 시 전제할 요금제와 실제 계정 요금제 변경을 별도로 확인합니다. 도안은 50개 계약으로 유지하며 작업의 끝남은 수락 조건으로 판단합니다.

### (581) TASK-044 예약 링크 첫 실패와 부모 배포 확인

- API-037 경로 부재로 무인증401/조회0와 등록 직후 누락 일곱 조건200이404인2실패를 재현했습니다. npm ci141개/13초이며 아직 구현/전체 검사가 아닙니다. 다음은 준비 조건/한 번 발급·처리방침/공개 제한입니다.
- 부모038 main5d8c448의 app/db·스테이징 배포와 학원컴 앱9416ec6f/저장소56dfca6f의 같은 태그·상태200/트래픽100%·SSH0을 확인했습니다. 실제50개 경로와 계정 확인은 남기며 finished를 표시하지 않습니다.

- 581 공개 조회/동시 발급 초안: 관련4파일51개가 통과했습니다. 여덟 동시 요청의 한 주소/처리방침 한 개·누락 설정 하루 알림 하나·고정 개인정보 범위·공개404/60번 뒤429를 확인했습니다. no-store는 기존 경로 층을 유지합니다. 실제 업로드는 설정 다섯 항목 부재로500이며 합성 세션 내 정보200/로그아웃204/재조회401까지만 확인했습니다. 전체/타입·최소 역할/교차 가게는 이어갑니다.

- 581 관련5파일122개·타입을 확인했습니다. 공개 시험이 공용 가게 판정을 바꾸던 간섭은 별도 두 가게로 고쳤습니다. 발급 뒤 주소 유지/최신 게시·옛 글,최소 역할/금지3종과 오류 롤백·커밋 응답 유실 복구를 확인했습니다. 첫 전체의 스테이징 갱신3건은 아직 커밋하지 않은 권한 파일과 HEAD의 차이를 생성기가 거절한 것으로 원본 검사는 유지하고 커밋 뒤 전체를 다시 돌립니다.

- 581 고정 원본2c87850의 전체 서버2,144개/웹237개·타입·빌드654ms/두 Worker dry-run이 통과했습니다. 추가 경계의 옛 처리방침 재사용1실패를 재현해 첫 링크 발급 시 다음 버전을 추가하고 옛 글을 보존합니다. 이미 낸 주소는 새 글을 반복 생성하지 않습니다. 관련/새 전체를 다시 확인합니다.

- 581 최종 새 전체: 서버100파일/2,145개·웹237개·타입·빌드645ms/두 Worker dry-run·관련123개가 통과했습니다. WBS18/0·키816파일/0·수락 대조 용어0입니다. 이후 기록만 더하며 실제 권한 두 문장/설정·사장님/Vault와 PR/리뷰/CI/main 확인을 이어갑니다.

- 581 Claude7089863746 처리: 준비 조건 여섯 개가 다 된 때만 국외 이전 누락 알림을 남기고 출처/모델 설정 오류는500으로 나눕니다. 공개 출처는 services 하나를 쓰며 기존 가게 조회도 설정된 공개 출처를 우선하고 비공개 사진 주소는 요청 호스트를 유지합니다. 같은 회사 중복은 거절합니다. 관련4파일128개가 통과했습니다. 발급 뒤 재발행은 새 제품 결정 대기에 추천/대안/반론을 남겼고045의 한도 공용화/060의 홈 조회를 후속으로 기록합니다. 아직 재발행을 구현했다고 적지 않습니다.

- 581 검토 수정 최종: 서버100파일/2,152개·웹237개·타입·빌드657ms/두 Worker dry-run·관련128개가 통과했습니다. API/스키마/마이그레이션은 그대로이며 이후 기록만 더합니다. 재발행 결정과045/060 후속은 미완료로 명시합니다.

### (582) TASK-027 대기 시각 경과 뒤 OpenAI 평가 재개

- 기존 다음 허용 시각이10시간55분 이상 지났고 간격을30초로 늘립니다. 코드/요금표/사례는 그대로이며 성공3건·과거 비용/미확인 여유를 재사용하고 회사별700원·새 호출 실패2회에서 멈춥니다. 실제 실행 전 dry-run134건 전형111.72원/상한621.49원을 진행 기록에 남겼습니다. 아직 새 호출/완료 결과는 없으며 중간 결과와 실제 비용을 이어 기록합니다.

- 실제 재개 결과: 새2회는09:38:06/09:38:36 KST의 connect_timeout이고 종료4로 중단했습니다. 누적9회·성공3/실패2·요금표1.09원/미확인 여유27.98원이며 새9.33원 여유를 보존했습니다. API 한도/키/잔액으로 판정하지 않고 같은 환경 실행은 반복하지 않습니다. 새 원문/중간 저장은 docs/records/ai-eval/2026-11-23-openai-cooldown에 보존합니다.

- 학원컴의 같은 Node22.23.4/코드 SHA 대조와134건 dry-run이 CLI0/SSH0입니다. 공개 코드/합성 결과만 SFTP로 옮기며 기존 키는 짧은 SSH 표준 입력/실행 메모리로만 씁니다. 네트워크 경로가 바뀐 뒤 같은700원 상한/30초/새 실패2회 조건으로 재개하며 과거9회·미확인 여유27.98원을 버리지 않습니다.

- 학원컴 실제 결과는HTTP401 두 번/CLI4·SSH4여서 중단했습니다. 누적11회·성공3/실패2·요금표1.09원/미확인 여유37.31원을 보존하고 기존 키의 API 접근 확인을 모았습니다. 모델 요청은 더 반복하지 않으며 새 원문은2026-11-23-openai-academy에 남깁니다.

- 582 최신 main84fadbf와 결합한 전체 서버2,102개/웹237개·타입·빌드643ms/두 Worker가 통과했습니다. 앞으로는 학원컴 안의 기존 모델 키만 읽고 다른 기기의 키를 전송하지 않습니다. 이전3실패 뒤 비전달/호출 기기 키 부재 허용/학원컴 키 부재 사전 중단3개와 실제 학원컴 모의134건·CLI0/SSH0을 확인했습니다. 새 실제 모델 요청0이며 기존401/옛44건 원문 대기는 유지합니다.

- 582 최종 부모/전체: main ae905b5의 서버2,152개·웹237개·타입·빌드603ms/두 Worker가 통과했습니다. 부모183의 최종 CI/리뷰6건·Codex 요청1회/새 한도 실패와 main app/db/배포·학원컴 같은 태그/상태200·실제 권한 두 문장을 확인해044를 구현 완료17개에 넣습니다. 실제 발급/재발행 결정과027의 기존401·옛44건 원문은 대기로 보존하며045를 계속합니다.

- 582 Claude7090411052의6건: 키 환경을 모든 SSH/SFTP 자식에서 제외하고 UTF-8·숫자 코드·멈춤 이유·소유 확인 순서/전송 실패 정리를 고쳤습니다. 이전4실패 뒤 로컬5개가 통과했고 새 인증 분기는 합성 표식/무료 모의134건·결과 거절과 Windows PowerShell4개 CI로 확인합니다. 학원컴 새 SSH 두 경로 시간 초과로 실제 학원컴 모의는 아직 통과하지 않았습니다. 기존 비용/401 원문은 보존합니다.

- 582 Windows CI의 첫4실패는 모두 임시 폴더 소유 확인의 invalid_native_folder입니다. 진단을 추가해 Node/모의 전 중단을 확인했고 경로를 같은 절대 형식으로 정규화해 새 CI를 기다립니다. main7dde795의 승인된 재발행 설계를 보존하고 사람 결정 대기를 해제했습니다. 실제 학원컴/모델 성공으로 세지 않습니다.

- 582 Windows 실제 PowerShell4개가13.172초에 통과했습니다(137470483614). 모의134건/결과5개·표식 가림/파일 거절·Node 조기 오류와 자기 폴더 정리입니다. app45107004270 검사/Windows·db45107004339 두 버전도 성공했습니다. 학원컴 새 SSH/Aside 중단은 별도로 남기고 실제 모델 호출/새 키/결제0을 유지합니다.

- 582 학원컴 내부 기존 키의 무료 모델 목록 HTTP200/대상 모델 사용 가능을 확인했습니다. 새 SSH/SFTP 경로로 clean 모의134건/결과5개·CLI0/SSH0과 합성 표식 가림, artifact-rejection의 credential_in_artifact_refused·SSH2/평가 결과0개를 확인했습니다. 두 실행의 진행 stderr는 비어 있지 않습니다. 생성 호출0이며 과거 비용/401과 옛44건 원문 미확인은 보존하고 기존 키 접근 사람 대기만 해제합니다. 실제 재개는 별도 비용 기록 뒤 진행합니다.

### (583) TASK-045 공개 예약 페이지

- API-038이 없어200 대신404와61번째 요청의429 누락 두 실패를 확인했습니다. 공개 페이지/처리방침은 별도 IP 한도이며 기존 달력 판정을 재사용합니다. 아직 구현/전체 검사는 아니고 현재 가격표·동의한 게시 사진/철회·가게 분리/최소 역할을 이어갑니다.

- 583 첫 구현: 공개/처리방침/한도3파일27개가 통과했습니다. 로그인과 분리한 공개 IP HMAC·경로별60회,기존 달력60일/현재 가격표·서명 도안·공개 신원/문의 주소를 확인했습니다. 동의/철회·교차 가게·최소 역할과 전체/실제 확인은 이어갑니다.

- 583 확장124개: 동의/철회·공개 사진3장/실제 서명 읽기·버전4/도안·신원/신고 기관·자기 채널·60일/마감 경계·가게 분리를 확인했습니다. 발급 제약/날짜 열·NULL 준비 자료와 최소 읽기 권한을 고쳐 공개200/금지4종42501이며 타입의 배열 첫 값3곳도 명시합니다. 실제/전체는 이어갑니다.

- 583 최종 전체: 서버101파일/2,171개·웹237개·타입·빌드650ms/두 Worker dry-run·관련124개·lint329파일·WBS18/0·키821파일/0이 통과했습니다. API/스키마/마이그레이션은 그대로이고 공개 사진 읽기 세 GRANT의 실제 적용·공개 합성 조회/수락 대조·PR/리뷰/CI/main을 이어갑니다.

- 583 Claude7건: 서명/IPv6 우회2실패 뒤 접속지·/64 공용화,커밋 뒤 서명,가격표 조회/정렬 공용화와 공개 경로 한도 선언 검사를 고쳐143개·타입을 확인했습니다. 5분은 SPEC-063의 페이지 캐시/노출이고 기존15분 주소는 DEC-09라 유지하며 API 설명만 분명히 했습니다. 사진 경로의 새 한도/결정적 IV는 측정164·화면 lazy loading061 뒤 다루며 이번 수정으로 세지 않습니다.

- 583 검토 수정 최종: 서버102파일/2,189개·웹237개·타입·빌드670ms/두 Worker와 설계9단계13:05:17~13:08:24 KST 전부 종료0입니다. 관련143개·API17/17·ERD15/15·목업14/14·WBS18/0이며 중간 두 제안의 범위/미적용 이유와 낮음5건 처리를 수락 대조에 남겼습니다. 실제 공개/최종 CI/main은 이어갑니다.

- 583 승인7090984075에 따라 공개 포트폴리오5분 구간 공통 주소/구간 끝 만료·공개 캐시와 두 사진 경로IP당1분600회 한도를 반영했습니다. 공개 전용 키/내용·기한 HMAC IV를 분리하고 첫6실패 뒤 관련36개·타입·lint332파일이 통과했습니다. 전체/9단계·재리뷰·실제 확인은 이어갑니다.

- 583 승인 뒤 설계9단계13:32:11~13:35:34 KST가 전부0입니다. 첫 전체의 기존 파일 시험4실패는 새 한도 바인딩을 넣어 관련123개가 통과했고 저장소 대기 중 만료404/응답 시각의 캐시·Date/Expires를 보완해 관련124개/타입도 통과했습니다. 전체/빌드·재리뷰·실제 공개 확인은 이어갑니다.

- 583 최종 새 빈 DB 서버103파일/2,196개·웹237개·타입·빌드673ms/두 Worker와5d의app/db CI가 성공했습니다. 학원컴 Aside CLI에서해시 대조 뒤 새 공개 합성 자료를 한 번 적용해 이름/slug·마이그레이션34·가격표1·달력 예외2를 확인했습니다. 실제 카카오/사장님 발급/사진200은 아니며 최종리뷰·CI/main·배포 뒤 공개200/404/429를 이어갑니다.

### (584) TASK-184 처리방침 재발행 설계(04 SPEC-010·10 WBS)

- 이미 한 작업이 주 출처로 받는 SPEC에 수락 기준을 더해 새 작업에 줄 때는 기존 작업에도 `ac`를 적습니다. `build_wbs.py`는 그 SPEC을 `ac`로 받는 작업이 하나라도 있으면 주 출처 작업에 수락 기준을 자동으로 주지 않고 오류를 냅니다(이번에 TASK-044에 `ac={'SPEC-010': [1, 2, 3, 4]}`).
- SPEC 행의 본문·수락 기준에 REQ를 적으면 그 행의 출처 열에도 넣습니다(`build_spec.py`의 '본문 인용' 검사). 수락 기준 수가 바뀌면 손으로 적은 수도 찾아 고칩니다: `grep -rn '수락 기준 [0-9]*개'`로 TASK-169의 끝난 조건을 찾았습니다.
- 재발행 같은 '바뀌면 새로 만든다' 규칙은 값 목록이 아니라 만들어질 산출물(처리방침 글·국외 이전 항목)과 최신 버전의 비교로 씁니다. 값 목록은 예로만 둡니다. 목록 밖 값(전자우편주소, 코드에 고정된 문장)이 바뀌는 것을 놓치기 때문입니다(PR #184 Claude 리뷰 발견 1). 배포 설정에서 오는 값은 앱 안에 '바뀜' 사건이 없으므로 방법 대신 '배포 뒤 보이는 것'을 보장으로 적습니다(발견 2).
- 학원컴 Windows에서: Git Bash의 `TZ=Asia/Seoul`은 적용되지 않으므로 KST는 `date -u -d '+9 hours'`로 셉니다. `python -I`는 `PYTHONIOENCODING`을 무시하므로 생성기는 WSL의 python3(PyYAML 있음)로 `/mnt/c/...` 경로에서 돌립니다. 단계 검사는 등록된 서버 ko-family에 브랜치를 git bundle로 옮기고, 자기 사용자 데이터 폴더의 임시 PostgreSQL 16(127.0.0.1:54329)과 Playwright Chromium으로 돌린 뒤 멈춥니다. 키·인증 파일은 옮기지 않습니다.

### (585) TASK-027 학원컴 기존 키의 느린 평가 재개

- 학원컴 내부 기존 키의HTTP200/모의 보호 시험과 main185 두 Worker 같은b275c6b/health200 뒤 실제 평가 재개를 준비합니다. 60초 간격/동시1개·기존 성공3건/비용1.09원·미확인 여유37.31원 보존·700원/새 실패2회 중단입니다. 실제 호출 전134건 추정111.72원/상한621.49원과 누적 상한659.89원을 기록했고 push 뒤 시작합니다. 새 키/충전/요금제 변경은 없습니다.

- 585 실제평가29개/응답28개·누적37회·요금표9.65원/미확인여유37.31원의중간저장을키거절가드뒤SFTP/해시대조해추적했습니다. AMT21은API성공뒤schema_invalid입니다. 실행은계속중이므로중복시작하지않고최종반환을확인합니다. 완료/품질통과/finished는아닙니다.

- 두 번째 실제 중간 저장은 결과 72건/응답 71건·누적 80회·23.35원/미확인 여유 37.31원입니다. 113,537바이트의 키 없는 복사본을 SFTP/해시로 대조했고 첫 복사본도 보존했습니다. 최신 main c6f1025를 결합했으며 현재 실행은 중복 시작하지 않습니다.

- 실제109건/응답108건·누적117회·요금표31.14원/미확인여유37.31원의세 번째 복사본을 보존했습니다. 관리 연결 종료 뒤 기존 학원컴 셸에서 실행1개/원본 갱신을 확인했고 키 거절 가드·압축/줄/블록·SHA-256을 대조했습니다. 원본은 계속 실행하며 중복 시작하지 않습니다.

- 027 실제134건/응답133건·누적142회·37.39원/미확인여유37.31원을키거절가드뒤최종원본으로회수하고보고서4개는오프라인재생성했습니다. CLI종료값은미회수입니다. 같은사례의Anthropic134건과합성268행비교표·두회사한명령모의268행/0·출처점검표를확인했습니다. 도구조건을충족하며모델선정/기계실패·검토와예전44건은162/출시검토에보존합니다.

- 현재 원격36877265a3a4bab5ad31054a524810697d184772(트리7c41d0a3af0a5346d209bb02095102dce052ad6e)의 코드에서 새 빈 DB/마이그레이션34개로 서버104파일2,209건·웹11파일237건이 통과했습니다. 타입 검사 종료0, 웹 빌드1.51초와 두 Worker dry-run 종료0(앱5243.96KiB/gzip962.58·저장소20.87/6.47)입니다. 설계9단계도16:05~16:08 KST에 모두 종료0이며 API17/17·ERD15/15·목업14/14·WBS18개/오류0입니다.

### (586) TASK-184 현재 본문과 새 버전 비교

- 현재 전체 처리방침 본문/국외 이전 비교를 공용화해 API010 연락처 저장과 API039 공개 응답 전에 가게 잠금 안에서 재발행합니다. 같은 글·미발급은 새 버전을 만들지 않고 옛 글/상담 버전을 보존합니다. 관련97개/타입을 확인했으며 전체·실제 확인과064의첫 AI 고지 연결이 남아finished/구현 완료로 세지 않습니다.
- (585)는 열린 PR187의 평가 재개 기록 번호로 보존합니다.

- 586 타입 기록을 정정합니다. 시험 응답 unknown 오류를고친뒤 새 전체 typecheck 종료0을 확인했고 첫 전체의교차가게1실패는합성 국외 이전설정/현재버전준비를넣어 관련67개가통과했습니다. 전체/빌드는다시확인합니다.

- 586 main8e73aa1을 결합한 실제 타입0·서버104파일/2,204개·웹237개·빌드540ms/두 Worker와관련88개를확인했습니다. 부모186의main/배포·학원컴두Worker같은태그/health200·합성페이지200/없는주소404를확인했으나순차65/병렬100모두404여서실제429는미확인입니다. 모델/새키/결제0이며184의064연결과045실제대기는남깁니다.

### (587) TASK-045 공개 포트폴리오 사진 주소 만료 경계

- 구간 끝에 사진이 바로 만료된 PR #186 지적을 반영했습니다. 동희님의 2026-11-23 01시대 KST 체크포인트 위임과 실장님 봇 요청 `msg_844ba4f4203d`에 대한 오랑이의 확인에 따라, 150초 구간 끝에 150초를 더해 발급 수명을 150~300초로 정했습니다. [PR #186 검토](https://github.com/kodonghui/siljang.ai/pull/186#issuecomment-7092405123)
- 150초의 배수 여부와 남은 시간 300초 상한을 검증하며 공개 캐시도 만료 시각에 맞춥니다. 경계 시험은 종전 300초 구간의 후반에서 발급해 기존 구현의 수명 1초를 재현했습니다. 저장 위치와 기한 중 하나가 다를 때 IV가 달라지는 시험, 철회 즉시 새 응답에서 제외되며 기존 주소는 300초 안에 만료하는 시험을 추가했습니다. 사진 404 재조회는 TASK-061의 완료 조건에 기록했습니다.

### (588) TASK-046 가게 등록 화면과 계정별 임시 입력

- 가게 등록 화면/API007 multipart·008과 같은계정/1시간의 글값만 복구·사진/동의 제외·성공/로그아웃 정리를 구현했습니다. 실제 타입0·웹246개를 확인했고 Aside 화면/각응답상호작용·새전체/빌드·CI/리뷰/main은 다음입니다. 실제로그인/사진성공·finished/구현완료로 세지 않습니다.
- (585)/(586)은 열린187/188에서사용한번호로보존합니다.

- 046 최신 main c6f1025 결합 뒤 서버2,204개/웹246개·타입0·빌드874ms/두 Worker가 통과했습니다. 이후 주소 두 줄·사진 미리보기 대체 안내·재업로드 시 이전 등록 상태 정리와44px 영역을 보완하고 학원컴 Aside의 합성 UI 시험을 준비합니다. 실제 계정/저장소 성공·finished/구현 완료는 아직 아닙니다.

- Claude7093059004의10건 중3번은08의 전역잠금을 지키는 이유로 그대로두고 나머지를고쳤습니다.4실패를재현한상호작용10개를포함한웹257개/타입0·형식/lint344파일이통과했습니다. 로그아웃/재확인중양식보존·경로무관임시글정리·서버사진기한·중복안내/숫자붙여넣기·한번만완료안내·응답검사공용화입니다. main189결합/새전체·수정뒤Aside/남은응답·CI/리뷰를이어가며588/296을씁니다.

- TASK-046 최신 main191에서 서버2,215건·웹257건·타입·빌드868ms/두 Worker가 통과했습니다. 학원컴 Aside CLI로 SCR-015의17응답(완성 사진201은 계약상 나오지 않음),5상태×두 폭을 대조했고 오류/경고0입니다. 최신 일반/오류/이미 등록6개는 CLI 관측 요약이며 원본 파일 미회수를 표시합니다. 처리 중/실제 로그인 전 접근4개 원본 JSON과 초기 사진/검사4개씩은 회수해 보존합니다.

### (589) TASK-045 병합 뒤 본문 정리와 공개 조회 경계

- Claude7092405123의2·6·7번을 실패 시험으로 대조했습니다. 저장소 응답 뒤 만료404에서 본문 취소가0회였고, 사용자 지정 공개 경로의 한도 누락을 시작 때 거절하지 않았습니다. 공개 페이지는 쓰지 않는 가격 조합 규칙을 한 번 읽었습니다. 각각 본문 취소·실제 경로 목록 검사·규칙 조회 생략으로 고칩니다. 다른 가격표 소비자는 기본값으로 규칙을 계속 읽습니다.
- 새 시작 검사가 시험용 미선언 공개 경로도 거절하므로 교차 가게 시험은 실제 선언 경로와 시험용 한도/접속지로 없는 주소404를 확인합니다. 준비 오류1개 뒤60개가 통과했고 타입 종료0입니다. 현재 원본041ea81의 새 전체/빌드는 진행 중입니다.
- 1번 주소 수명은 PR189에서 처리 중입니다. 4번의 두 사진 경로 공통 한도와 필수 설정을 README에 명시했습니다. 3·5번 edge 캐시/도안 주소와 한도 분리는 TASK-164 실측에 남기며 적용했다고 쓰지 않습니다. 587/588은 다른 열린 PR에 예약하고589를 씁니다.

- 최종 원본041ea81의 새 빈 DB 전체는 서버104파일/2,205개·웹11파일/237개, 타입 종료0·빌드903ms·앱5243.96KiB/gzip962.57와저장소20.87/6.47의두Worker dry-run이 모두 종료0입니다. 원격 CI/리뷰·PR189 결합과 배포는 이어 확인합니다.


- Claude7093339811의1~6번을 처리합니다. HEAD가 S3 GET 본문을 열던 두 실패를 메타데이터 head 조회로 고쳤습니다. 공개 해석기의 slug/한도 누락 두 분기를 직접 시험하고, 공개 가격표 조회를 publicContents로 분리해 반환 타입에도 rules가 없습니다. 만료 취소 시험은 실제 키를 대조하며 정상 GET의 본문 미취소도 확인했습니다. 관련3파일54건·타입·형식/lint335파일이 통과했습니다. 로컬041ea81은 원격091456c의 서버 소스/시험과 같은지 git diff 종료0으로 대조했습니다. 원격 head/tree와 최종 검사를 함께 기록하며, 옛220 기록은 최신 main의 복원 상태를 유지합니다.

- HEAD·공개 가격표 타입 분리 뒤 새 빈 DB/마이그레이션34개에서 서버104파일2,215건·웹11파일237건이 통과했습니다. 타입 종료0, 웹 빌드712ms·앱5244.37KiB/gzip962.69와 저장소20.87/6.47의 두 Worker dry-run 종료0입니다. 관련3파일54건·형식/lint335파일·WBS18개/오류0·키846파일/0·새 글 용어0도 확인했습니다.

### (590) TASK-027 예전44건 판정과 완료 표시 정정

- TASK-027의 finished 표시를 정정합니다. PR187에서 WBS의 세 조건과 실제 두 회사134건 결과를 채웠지만, codex-finish.md4절의 예전44건 Codex 판정을 누락했습니다. 현재 /workspace에서는 Git 무시 경로도 포함한 파일 검색(rg --files --hidden --no-ignore)으로 원래 실행의 검토 파일을 찾지 못했습니다. 추적된 결과 표에는 건수만 있습니다. 학원컴에서 조회한 개발 폴더 후보8곳은 존재하지 않았습니다. WSL Ubuntu의 /home·/root에서는 일부 캐시·의존성 폴더를 제외하고 방문한20,438개 디렉터리에 대상 실행 폴더가 없었습니다(조회 종료0·시간 중단false). 이 확인 범위를 넘어 원문 분실을 단정하지 않습니다. 새 실행37사례38판정으로 예전44건을 대신하지 않습니다. finished를 철회하고 원문 복구/판정 뒤 다시 대조합니다. 실제 평가 자료와 과거 비용은 지우지 않습니다.


- Claude7094942523의4건을 처리합니다. main323a12c를 결합해 세 기록 충돌을 번호 순서대로 풀었습니다. README80에는 원래44건 Codex 판정이 끝나기 전 finished 금지라는 현재 절차와298 참조를 더했습니다. WBS의 도구 세 조건(done)은 유지합니다. 자료 검색은 Git 무시 경로까지 포함한 현재 작업공간 검색과 학원컴의 제한된 조회를 나눠 적고 원문 분실로 단정하지 않습니다. AGENTS에는 열린 PR의 예약 번호/번호 순서 삽입과 새 README 기록의 제목 형식을 명시했으며298도 제목으로 바꿨습니다.

### (591) TASK-047 가게 설정 화면

- TASK-047의 설정 저장 본문을 먼저 시험했습니다. 기준 revision과 바뀐13개 허용 필드만 보내고 사업자 신원은 보내지 않습니다. 통신판매업 신고번호/기관/면제 사유의 전환과 선택 픽업 장소 지우기, 빈 숫자를0으로 바꾸지 않는 경계를 포함합니다. 먼저5실패/1통과, 구현 뒤6통과·웹 타입 종료0·형식/lint337파일0입니다. 전체 화면/응답/라우팅과 실제 확인은 이어갑니다.

- TASK-047의 API009/010 응답 검증을 더했습니다. OpenAPI의 합성 성공 예시7개를 시험에서 직접 읽고 형식/범위가 틀린 응답은502 공통 실패로 처리합니다. 저장 요청의 PATCH·요청 키·변경 본문과401/404/500을 확인했습니다. API쪽 먼저10실패/6통과 뒤 양쪽 관련22건·웹 타입·형식/lint0입니다. 공통 응답 검사와 상호 작용 시험 의존성은 열린190과 같은 원본/고정 버전을 재사용해 다음 main 결합 때 보존합니다. 다음은 실제 양식과19응답/저장·로그아웃 상호 작용이며 아직 끝남/구현 완료가 아닙니다.


- SCR-034의9개 설정 카드가 현재 상태를 표시하도록 가게 조회/저장의 settingsSummary를 더했습니다. 버전·연결 상태·게시/후기 여부만 같은 가게 조건의 조회 하나로 읽으며 계좌/OAuth 참조/사진 주소는 요약에 없습니다. 이전 응답도 유효하도록 계약 필드를 선택 사항으로 두고 UI가 누락을 알게 했습니다. 빠진 요약의2개 실패 뒤 서버 관련3파일143건·웹 관련23건·타입/형식/lint0입니다. 계약/화면은 생성 원본과 생성기로 함께 고쳤습니다. 전체 화면/라우팅과19응답의 상호 작용은 이어갑니다.

- TASK-047의 SCR-034 양식과9개 상태 카드·변경 필드 저장을 실제 OwnerArea에 연결했습니다. 저장/로그아웃/세션 재확인 중 글을 유지해 잠그며, 로그아웃 실패는 추적 ID/재시도를 표시합니다. API009의5성공/401/404/실패·API010의성공/변경없음/401/404/충돌재조회/처리중같은키/필드/요청키/서버실패·API003의204/실패를 상호 작용으로 대조했습니다. 신고 보류도 SCR-034에 접근하게 고치고 다른 업무의 재제출 경로는 유지했습니다. 관련3파일75건·웹 타입0이며 설계9단계도 전부 종료0입니다. 다음은 학원컴 Aside CLI의8상태×두 폭과 새 빈 DB 전체 검사·리뷰입니다. 아직047은끝남/구현 완료로 세지 않습니다.
- 부모PR190은main0ebedf899db4f68641afa8e6dcd1a44748acf616의app45140386137(check·Windows·스테이징배포)/db45140386216이모두성공했습니다. 학원컴기존OAuth의로그인/계정일치와앱6d5b8891-5fef-4b5f-b0b2-54a8637c190b(17:43:16KST)/저장소822c6ba1-d415-4f90-9cba-8eff3d39449d(17:43:08KST,100%)의같은전체SHA·health200/Node0을확인했습니다.046은구현완료목록에만추가하고실제사장님/S3등록은확인대기로남깁니다. Codex수동요청7095631557의이번사용한도7095635802를확인했고닫힌PR체크리스트를갱신했습니다.
- 부모PR192도main48792810d7ecb69a53d4f74f99263f34adb020d3의app45138797620(check·Windows·배포)/db45138797545가성공했습니다. 학원컴기존OAuth앱3bfd20b5-6678-4996-b4b9-2cf06301b2be·저장소b07fe89e-d223-4f2a-b6ed-b502ad9e2c4c/100%가같은전체SHA·health200/Node0입니다. Codex요청7095418570/이번사용한도7095423606을처리하고닫힌PR을갱신했습니다.027의예전44건판정은남아끝남32개를유지합니다.

- 설정 요약의 제한 역할 회귀를 고쳤습니다. 요약은API009/010만 읽고 등록/신고/사업자 요청은 읽지 않습니다. 장부는shop_id/status/unlinked_at만SELECT하고시트ID/OAuth참조와쓰기는금지하는시험을붙였습니다. 관련3파일91건이통과했습니다. 첫새전체7실패중4개는권한회귀,3개는검사중수정에따른불변원본거절이었으므로커밋한깨끗한원본으로다시실행했습니다. 새빈DB34개마이그레이션에서서버104파일2,217개·웹18파일302개,그뒤체크박스이름/재확인실패상태보완의웹304개·타입·빌드529ms/두Worker가모두통과했습니다. 형식/lint353파일0입니다. 다음은학원컴자료회수/남은화면상태·실제장부최소권한과리뷰입니다.

- SCR-034의8상태×360/1280을학원컴AsideCLI에서대조했습니다. 초기사진을직접보고저장버튼고정누락을발견해900px화면밖1404~1448에서844~888로고쳤습니다. 기존1260px미디어조건하나를유지하고09토큰을사용하며웹304개·형식/lint353파일·빌드562ms/두Worker가통과했습니다. 수정뒤16개검사와실제로그인전접근2개원본을회수했고오류/경고0입니다. 최종CSS는원본을페이지에추가했으며최종컴파일파일전체재전송이라고적지않습니다. 사진촬영시간초과는미회수로구분합니다. 장부상태3열권한은실제로허용/비밀조회·쓰기금지와마이그레이션34를확인했습니다. 다음은readyPR리뷰/CI·병합직전Codex요청1회/main·배포확인이고실제사장님저장은아직입니다.

- Claude7097050139의1·2·3·4·6번을수정중입니다. 요약은API009/010예시/설명에만포함하고,카카오확인시작전/진행중/실패와10분경계를계약·서버·화면에서구분했습니다. 장부는shop_id/status두열만읽고unlinked_at은회수합니다. 공백신고번호는화면과같이면제분기로보냅니다. 관련서버3파일88개·웹308개·타입/형식/lint0입니다. 첫서버경계시험은fixture가확인을이미시작한상태임을확인해시작전상태를명시적으로준비했습니다.5번은SCR034loading의모든액션잠금계약을유지하고조회뒤풀리는시험으로대조했습니다. 새환경은권한SQL적용/검증뒤Worker배포순서를README299에적었습니다. 다음은설계9단계와새전체·학원컴권한회수/새채널표시입니다.

- 리뷰 수정 뒤 새 빈 DB34개 마이그레이션에서 서버104파일2,218개·웹18파일308개, 타입 종료0·빌드687ms/두Worker와 설계9단계가 모두 통과했습니다. 학원컴에 최신 JS·CSS 전체 ZIP182,788바이트를 전송해 해시를 대조했고 일반/채널 확인 시작 전/채널 확인 실패/공백 신고번호 면제 저장4경로×두폭8개가 오류·경고0입니다. 합성 PATCH의 신고번호/기관null·면제 사유와 저장 완료를 직접 확인했습니다. 실제 장부는shop_id/status두열만 허용하며 unlinked_at/비밀 열/쓰기는 금지입니다. 사진은 새로 회수하지 못했고 실제 사장님 저장은 미확인입니다. 다음은PR194병합과main결합·현재CI/리뷰처리·병합직전Codex1회/main배포확인입니다.

- PR194를 squash한 main26dee6fc418c503f6c7f2e4ae37192e061a0da2a를 설정 화면에 결합했습니다. README299/300과수정기록591/592는원래번호순서를보존했고046구현완료행을유지했습니다. 서버/db는이전검사원본db0ced5와차이0이므로서버2,218개결과를유지하며, 결합뒤웹18파일310개·타입·빌드/두Worker가종료0입니다. PR194의mainCI/배포확인과현재설정head의CI를이어확인합니다.

### (592) TASK-046 병합 뒤 세션/사진 안내와 기록 정정

- PR190의 병합 뒤 Claude7095941746 발견4건을 처리합니다. 재확인 실패는 진행 중과 구분해 등록/입력은 잠그고 로그아웃은 허용합니다. 서버의 신고증 upload_not_found 뒤에는 옛 업로드 성공 표시를 지우고 파일을 남겨 다시 올립니다. 운영자 응답도 공용 UUID/502 검사 상수를 사용합니다. 임시 글의30분 기록은 실제 코드/SCR-015의1시간으로 고칩니다. 먼저 상호 작용2실패/기존10통과, 수정 뒤 웹15파일259개·타입·형식/lint344파일0입니다. 다음은 최신main결합과전체검사·실환경/리뷰입니다. 원본번호592/README300은047의591/299와구분합니다.

- main0ebedf8기준의새빈DB34마이그레이션에서서버104파일2,215개·웹15파일259개·빌드627ms/두Worker가모두통과했습니다. 학원컴AsideCLI의실제OwnerArea/등록컴포넌트와합성API로사진만료뒤옛성공안내제거/파일보존/다시올리기,재확인503뒤글·사진보존/등록잠금/로그아웃허용과204뒤로그인화면을확인했습니다. 세상태×두폭의6개검사원본을회수했고오류/경고0입니다. 기존계정/S3등록성공과구분하며finished를추가하지않습니다. 닫힌PR190본문의30분도1시간으로정정했고Codex요청은아직하지않았습니다. 다음은현재headCI/코드·보안리뷰/발견처리와Codex한번·main/배포입니다. 설정PR193보다이후속을먼저합친뒤193에최신main을결합합니다.

### (593) TASK-048 영업 신고 화면

- TASK-048의 SCR-035·08 응답36행과09 목업을 읽고 신고증 조회/재제출·사업자 변경 요청 API 시험부터 썼습니다. 첫 실행은 아직 없는 shop-license-api 모듈 때문에1파일 실패/시험 미실행입니다. 등록 후속PR194와 설정PR193의 확인을 계속하며 화면 상태8개·업로드/재시도/권한과 실제 두 폭을 구현합니다. 기록593/README301을 예약하고 아직 끝남/구현 완료로 세지 않습니다.

- 신고증/사업자 변경 API 경계17건과 웹 타입·형식/lint346파일이 통과했습니다. 계약 예시의 이름 resubmitted/requested와 실제 본문 outcome=done이 다름을2실패로 확인해 실제 계약 값으로 고쳤습니다. 비공개 사진은 HTTP(S) 주소만 허용하고 잘못된 사업자 변경 구조/확인 시각은502로 처리합니다. 다음은 확인 시각의 서버/계약 연결과 전체 화면입니다.

- TASK-048의 신고 확인 시각 누락3실패 뒤 기존 판정 시각을 선택 응답 licenseReviewedAt으로 연결했습니다. 재제출 뒤 null을 포함한 서버28개·웹274개·타입/형식/lint와 설계9단계(19:20:48~19:23:59KST)가 종료0입니다. UI 첫 실행은 아직 없는 ShopLicense 모듈 때문에1파일 실패/시험 미실행입니다. 다음은 상태8개와응답36행의실제화면입니다.

- TASK-048의 실제 OwnerArea 영업 신고 경로와 보류 재제출/사업자 변경을 연결했습니다. 관련API/상호작용55건·타입·형식/lint359파일이통과했습니다. 사진 만료와503은옛성공안내를지우고파일을남겨다시올린뒤새본문/키로저장합니다. 500은같은키,요청키재사용실패는새키,충돌은최신조회,401/404는권한경로로보냅니다. 신고증비율은09의4:3입니다. 첫시험의중복알림선택과포커스선택자/입력이벤트를수정했습니다. 다음은변경없음/처리중잠금의남은검증과학원컴8상태/두폭·새전체입니다. API009의반영됨상태applied도기존설정검증과같은계약으로대조할예정입니다.

- 영업 신고 화면을 실제 OwnerArea에 연결한 뒤 웹20파일374개와 타입 검사·형식/lint359파일이 통과했습니다. 사업자 변경의 반영 상태를 기존 설정 조회에서도 applied로 받도록 두 실패 시험을 고쳤습니다. 신고 보류를 고치는 신고/결제 수단 경로와 복귀 주소도 두 실패 시험 뒤 보존합니다. 두 저장의 같은 키 처리 중 재전송, 변경 없음200, 중복 전송 방지, 입력/메뉴 잠금과 세션 실패 뒤 입력 보존·로그아웃을 확인했습니다. 신고 확인 시각의 출처는 08 원본과 생성 문서에 반영했습니다. 다음은 이 커밋의 새 빈 DB 전체·빌드/설계9단계, 학원컴8상태×두 폭과 리뷰/CI입니다. 실제 사장님/S3 성공은 여전히 미확인입니다.

- 깨끗한 원본60a93f8에서 새 빈 데이터베이스에34개 마이그레이션을 적용한 뒤 서버104파일2,221개·웹20파일374개가 통과했습니다. 타입 검사 종료0, 빌드531ms와 앱5246.30KiB/gzip963.16·저장소20.87/6.47의 두 Worker dry-run도 종료0입니다. 설계9단계 중8개는 성공했고 화면 문서의 새 DB 표기 한 곳만 용어 검사에 걸려 데이터베이스로 고쳤습니다. 런타임 코드는 바꾸지 않고 설계 검사를 다시 실행합니다. 학원컴에는 같은 원본의 전체 JS/CSS 공개 ZIP197,975바이트를 전송해 SHA-256a396b96516818c8a077e17e2729cf339b0cb077e37124af002409ed937ecb03e를 대조했습니다. 다음은 Aside CLI의8상태×두 폭과 실제 로그인 전 접근입니다.

- Claude7099246615의 중간1건·낮음7건(보안0건)을 대조했습니다. 재시도/다시 읽기까지 세션·다른 사진 업로드 잠금을 적용하고, 충돌 시 해당 양식만 갱신하며 다른 양식의 입력/증빙을 남깁니다. 최신 조회 실패 뒤에는 이전 값의 저장을 막고 복구 조회를 허용합니다. 사진 재업로드 성공 뒤 누락 안내를 지우고 API009 검증을 두 화면이 공유합니다. 실패 시험8개를 먼저 확인한 뒤 웹21파일382개·타입·형식/lint361파일이 통과했습니다. 결제 수단 구현 전에는 신고 화면 복귀 버튼을 두었습니다. API007의 413 문구는 SCR035 계약대로 유지하며 등록 화면의 사진 공유는 TASK046 후속에서 진행합니다.
- 수정 전 학원컴13상태×두 폭26건과 실제 스테이징 로그인 전 접근2건의 원본을 회수했습니다. 오류/경고0이며 실제 GET/me는401, 로그인 화면 이동입니다. 실제 사장님/S3 성공을 뜻하지 않습니다. 다음은 수정 원본의 새 전체 검사·학원컴 회귀 확인과 현재 CI/리뷰 처리입니다.

- 수정 원본a815bfad의 새 빈 데이터베이스34개 마이그레이션에서 서버104파일2,221개·웹21파일382개, 타입·빌드1.11s·두Worker dry-run이 모두 종료0입니다. app5246.30KiB/gzip963.16·저장소20.87/6.47이며 의존성 변경은 없습니다. 원격9b93ddaf의app/Windows/데이터베이스16.15·17.11이 모두 성공했습니다. 설계9단계는19:53~19:56:40KST에 종료0, 추가 WBS18검사/오류0·새 문서 용어0입니다.
- 학원컴 Aside CLI에 수정된 전체 JS/CSS ZIP198,266바이트를 전송하고 SHA-2563619354d42ed5e5009e284c7556fa3e8722bd774c42dfe114235de7b7356d0d6를 대조했습니다. 모바일7건(세션 잠금/다른 업로드 잠금/양쪽 충돌 보존/조회 실패와 복구/사진 안내 해제), 데스크톱4건(사진 안내/세션 잠금/양쪽 충돌 보존), 두 폭 결제 수단 복귀4건의 합계15건이 오류/경고0입니다. 검사 원본은 reviewed-checks.json이며 수정 전28건과 구분합니다. CSS/검사 스크립트는 수정 전과 바이트가 같습니다. 실제 사장님/S3 성공과 사진 촬영은 미확인입니다. 다음은 기록 추가 head의 CI와 리뷰 처리·Codex한번·main/배포입니다.

### (594) TASK-046 신고증 사진 처리 공유

- PR195의 Claude7099246615 발견7번을 별도 TASK046 후속으로 진행합니다. 등록 저장소503 뒤 옛 사진 성공 안내가 남는 것을 실패1개/기존12개 통과로 재현했습니다. 등록도 신고 재제출/증빙과 같은 사진 훅·부품을 쓰고,503 뒤 파일/글/동의는 보존하며 새 업로드 ID·새 요청 키로 등록하도록 고칩니다. 등록 문구/사생활 안내와 임시 글의 소유자 확인을 유지합니다. npm ci는161개/16s입니다. 기록594/README302를 사용하며 실제 사장님/S3 성공은 미확인입니다.
- PR195는 수동 Codex 요청7100074658의 이번 사용 한도 실패7100079447을 처리하고 squash한 maindca88a8b135de1dd81cd6fc79bd56440722e5e8a입니다. 이 시작 기록 시점에는 main 확인 중이었습니다. 아래 PR195 배포 확인 뒤047/048은 구현 완료 목록에 넣었습니다. 다음은 등록 회귀/전체/학원컴과 main 배포 확인입니다.

- 등록이 공통 useLicensePhoto/LicensePhoto를 쓰도록 옮겼습니다. 등록용 문구·사생활 안내·사진 미리보기 형태는 유지하고 JPG/PNG/HEIC/HEIF의 파일 선택 목록과 재업로드를 공유합니다. 저장소503과 업로드 만료는 옛 성공 안내를 지우고 원래 파일/글/동의를 남깁니다. 새 업로드 ID와 요청 키를 검증한 회귀를 포함해 웹21파일383개·타입·형식/lint361파일이 통과했습니다. 첫 실패의 알림 중복 선택과 시험 옵션의 타입 오류를 고친 뒤 실제503의 잔여 성공 안내 실패를 확인하고 수정했습니다. 다음은 깨끗한 원본의 새 전체와 학원컴 두 폭 확인입니다.

- 깨끗한 원본b277977dc7bbfe4627821688f1a54b8b8bc0a14c의 새 빈 데이터베이스34개 마이그레이션에서 서버104파일2,221개·웹21파일383개, 타입·빌드513ms·두Worker dry-run이 모두 종료0입니다. 형식/lint361파일/737ms·키 검사0건입니다. 학원컴에는 전체 JS/CSS ZIP196,213바이트를 전송해 SHA-256939cd7e88a42b19fd47f2f9765497bc82042ad75fa2c499fc1ba573da5075e9d를 대조했고 두 폭 동작을 확인 중입니다. 다음은 학원컴 원본과 현재 CI/코드·보안 검토입니다.
- PR195의maindca88a8b135de1dd81cd6fc79bd56440722e5e8a에서 app45168301367(check137670901104/Windows137670901446/배포137672167371)·db45168301642(16.15 137670901707/17.11 137670902243)가 모두 성공했습니다. 학원컴 기존OAuth 로그인/계정 일치, 앱c8cd0715-d39d-4384-993a-2905b80fc487(20:50:26KST)와 저장소6e95a5e4-98c0-40c7-a4ca-cb715ec54b3c(20:50:16KST,100%)의 같은 전체SHA·health200/Node0을 확인했습니다. 첫 버전 조회100146 뒤 최신 배포/대상을 확인한 두 번째는 종료0입니다.047/048은 구현 완료 목록에 넣고 실제 사장님/S3 확인은 남깁니다.046은 발견한503 안내 오류 후속이 main에 합쳐질 때까지 목록에서 잠시 뺍니다.

- 학원컴 Aside CLI로 수정 원본b277977의 전체 JS/CSS 공개 ZIP196,213바이트/해시를 대조했습니다. 업로드/등록 저장소503/같은 파일 재업로드/새 사진ID·새 요청키 등록 두 폭8건, 세션 실패 보존·잠금2건, 만료와 재업로드4건의 합계14건이 오류/경고0입니다. [검사 원본](shop-registration/2026-11-23-shared-photo/README.md)을 회수했고 입력/동의·사진과 요청 횟수도 대조했습니다. 실제 계정/S3 성공과 사진 촬영은 미확인입니다. 다음은 PR196의 현재CI·코드/보안 검토와 병합 직전 Codex1회·main배포 확인이며, 기다리는 동안 TASK049를 진행합니다.

- 등록500 뒤 세션 재확인이 실패해도 양식 밖 재시도 버튼이 남는 것을 실패1개/기존13개 통과로 재현했습니다. 공통 CommandStatus의 disabled와 실행 함수의 busy 검사를 함께 적용해 웹21파일384개·타입·형식/lint가 통과했습니다. 등록 서버/데이터베이스는 전체 검사 원본b277977과 차이0이라 서버104파일2,221개 결과를 유지하고 변경된 웹/빌드를 확인합니다. 이전 학원컴14건은 이 잠금 수정 전이며, 수정된 전체 파일로 잠금을 별도 확인합니다. 다음은 현재CI/코드·보안 검토와 학원컴 잠금 확인입니다.

- Claude7100442262의 낮음5건/보안0건을 대조했습니다. 등록은 성공 뒤에도 다시 올리기를 보이도록 실패1개/기존14개 통과 뒤 복원했고, 업로드 무효화는 공통 훅의 discardIfRejected와 명시한 사진 필드로 합쳤습니다. 웹21파일385개·타입·형식/lint가 통과했습니다. 오류/도움말은 입력 바로 옆에 두는 공통 Field 순서와 파일 이름 여백을 의도한 배치로 기록하며 두 폭 검사로 확인합니다. context는 등록/저장 두 문맥의 문구·미리보기 스타일이 서로 어긋나지 않도록 함께 고르는 구성을 유지합니다. 세 번째 문맥이 생기면 표시 옵션으로 나눕니다.
- 등록500/세션 실패 재시도의 수정 원본53420d7 전체 ZIP196,242바이트/SHA256c359aec663db03a64037b5c106c1999a7b41d62356412feb633a81c413fc748b로 학원컴4건을 확인했고 오류/경고0입니다. [잠금 원본](shop-registration/2026-11-23-shared-photo/lock-checks.json)을 기존14건과 구분합니다. 검토 후 변경의 전체 파일로 등록의 다시 올리기와 공통 무효화를 확인한 뒤 현재CI/병합직전Codex/main배포를 처리합니다. 병합 뒤 성공을 확인하고 TASK046 실환경 확인 행을 복구하는 체크리스트를 PR에 추가합니다. 실제 사장님/S3 성공은 미확인입니다.

- 검토 반영 원본a536535642f039bac67d105a8945925d5caef9dd의 전체 JS/CSS ZIP196,291바이트를 학원컴에 전송하고 SHA-2564ed511cc1f564691ab3641a444df7c4282fc3817e6ba20fca0849f23442ea8cd를 대조했습니다. 업로드 성공 뒤 다시 올리기/등록503/재업로드/새ID·새키 등록5상태×두 폭10건과 등록500/세션 실패 잠금2상태×두 폭4건, 합계14건이 오류/경고0입니다. [검사 원본](shop-registration/2026-11-23-shared-photo/README.md)과 순서·글꼴·누르는 영역 관찰2개를 회수했습니다. 라디오 연결 라벨·파일 입력·다시 올리기는44px이고 글꼴은 로드됐습니다. 오류/도움말이 파일 입력 옆에 오는 순서도 두 폭에서 확인했습니다.
- 서버/데이터베이스는 새 전체b277977과 차이0인2,221개 결과를 유지하며 현재 웹385개·타입·빌드857ms/두Worker가 종료0입니다. 코드 원격3fbb74fd의app137683415023/Windows137683415641/데이터베이스16.15 137683415419·17.11 137683415663이 모두 성공했습니다. 다음은 추가 기록 head의CI와 검토 처리 확인·병합 직전Codex1회·mainCI/배포/학원컴SHA·health입니다. 확인 뒤 TASK049에서046의 실환경 확인 행을 복구합니다. 실제 사장님/S3 성공과 사진 촬영은 미확인입니다.

### (595) TASK-049 가격표와 도안 화면

- SCR036의9상태/23응답과09의360·1280 목업, SPEC004·기존 API016/017/007·옵션/규칙/도안 검사를 읽었습니다. 현재 버전/두 저장 결과와 잘못된 수치·사진 주소·연결 참조·용도 검증 시험부터 시작했고 첫 실행은 아직 없는 price-list-api 모듈 때문에1파일 실패/시험 미실행입니다. API 연결 뒤 현재 버전 편집과 충돌 재적용을 구현합니다. 가격표는 저장할 때 옵션/도안ID가 바뀌므로 재적용은 옛ID를 현재ID로 간주하지 않도록 시험합니다. 기록595/README303을 사용합니다.
- 설치 첫 실행은 작업공간 용량 부족으로 실패했습니다. 끝난 작업의 생성 의존성만 정리한 뒤 npm ci161개/11s로 재실행에 성공했습니다. 소스는 지우지 않았습니다. PR196의 남은 CI/검토와 학원컴 잠금 확인도 계속 처리합니다. 실제 계정/S3 저장 성공은 미확인입니다.

- API016/017의 현재 버전·새 버전/변경 없음·권한/미설정/충돌/필드/키 재사용/기본 실패와 API007의 design_image 전송을21개 시험으로 확인했습니다. 다른 사진 용도와 잘못된 수치·실행 주소·암호 포함 주소·연결 참조·이전 버전은 편집하지 않도록 거절합니다. 타입·형식/lint가 통과했고 첫 Biome의 시험 본문 선택 검사를 명시적인 FormData 검사로 고쳤습니다. 다음은 편집 양식과 현재 버전 위로 재적용하는 시험입니다.

- 가격표 저장마다 바뀌는 ID를 기준 버전의 그룹/이름과 연결해 내 변경만 최신 버전에 적용하는 양식 함수를 구현했습니다. 다른 기기의 금액·추가 옵션과 순서 자리를 보존하고 규칙/도안 연결을 최신ID로 바꿉니다. 이름 변경/삭제 때문에 대응할 수 없으면 기존 입력을 남기고 충돌을 돌려줍니다. 옵션 삭제의 규칙 정리/도안 연결 해제와 잘못된 금액을0원으로 바꾸지 않는 시험을 포함해7개가 통과했습니다. 타입·형식/lint365파일도 종료0입니다. 첫 실행은 아직 없는 양식 모듈로 시험 미실행이었고 import 정렬 뒤 검사가 통과했습니다. 다음은 실제 편집 화면과 상태/응답별 상호 작용입니다.

- 재적용 때 새 그림을 올린 도안의 화면 키가 바뀌어 파일/미리보기 부품이 사라질 수 있는 것을 실패1개/기존7개 통과로 재현했습니다. 새 업로드를 가진 도안은 화면 키를 보존해8개가 통과했습니다. 사진 선택·미리보기·재업로드와 무효화 판단의 공통 훅 및 도안 그림 부품을 작업 중입니다. 편집 화면 상호 작용6건은 아직 없는 PriceListEditor 모듈 때문에1파일 실패/시험 미실행입니다. 다음은 편집 화면 구현과 이 시험 통과입니다.
- PR196은 이번 Codex 요청7101204120의 사용 한도7101209374를 처리한 뒤169ddbf5637102574c576cb8ecc94c5b1d4930e7로 병합했습니다. main CI/스테이징/학원컴SHA·health를 이어 확인하고046 실환경 확인 행을 복구합니다. 실제 계정/S3 성공은 미확인입니다.

- 가격표 API21개·양식9개·편집 상호 작용6개의 합계36개와 타입 검사가 통과했습니다. 현재/미설정 편집·변경 셀 수·새 버전 저장·충돌 최신 조회/실패 복구·내 변경 재적용·세션 실패 입력 보존을 확인했습니다. 도안의 새 사진과 재적용 뒤 규칙 키 보존도 실패 시험 뒤 고쳤습니다. 다음은 실제 경로 연결·응답별 오류/사진/제약 시험과 학원컴 두 폭 확인입니다.
- PR196의 main169ddbf5637102574c576cb8ecc94c5b1d4930e7에서 app45175329752(check137694960395/Windows137694959966/배포137696952296)·db45175329705(16.15 137694959323/17.11 137694958618)가 모두 성공했습니다. 학원컴 기존 OAuth 로그인/계정 일치와 앱d401a61b-c381-4bc9-b4a6-0eb4069b4cdb(21:37:06KST)·저장소93d2b4cd-2559-479a-937b-ab192e514933(21:36:57KST,100%)의 같은 전체SHA·health200/Node0을 확인했습니다. TASK046 실환경 확인 대기 행을 복구합니다. 실제 사장님/S3 등록 성공은 미확인입니다.

- 실제 OwnerArea의 pending/verified 가격표 경로와 보류 계정의 신고 수정 이동을 실패2개 뒤 연결했습니다. 오류·요청 키·중복/업로드 잠금·금액/개수·규칙 충돌·사진/충돌 보존을 포함해 웹24파일457개, 타입 종료0·형식/lint371파일/692ms가 통과했습니다. 처리 중 안내 누락을 고치고, 세션 재확인 실패 뒤 자동 재전송이 나가던 실패1개도 고쳤습니다. 스타일은 새 분기나 숫자 크기 없이 기존1260 기준/토큰을 쓰며 공통 스타일 검사 범위에 포함했습니다.
- 가격표 수락 대조 문서에23응답과 끝난 조건을 적었습니다. 끝남32개·구현 완료20개·고를 수 있는 작업36개이며 막힌 확인 외 작업을 계속합니다. 다음은 깨끗한 원본의 새 빈 데이터베이스 전체·빌드와 학원컴9상태/두 폭입니다. 실제 사장님/S3 성공은 미확인입니다.

- 깨끗한 원본8f973b95의 새 빈 데이터베이스34마이그레이션에서 서버104파일2,221개·웹24파일457개와 빌드가 종료0입니다. 그 뒤 학원컴360 충돌 상태에서 재적용 버튼 배너의22px 가로 넘침을 발견해 가격표 범위 안의 줄바꿈을 고쳤습니다. 수정 전9상태 원본은 before-wrap-checks.json이며 stale만 오류1입니다. 직접 입력이 없는 순서 필드 오류가 사라지는 것도 올바른 공통 문구의 실패 시험 뒤 고쳤습니다. 웹458개·타입·형식/lint371파일/645ms·빌드639ms/두Worker가 통과했습니다. 다음은 수정 전체 파일의 학원컴 두 폭 재확인과 PR197 검토/CI입니다.

- Claude7102034408의 중간3건·낮음4건/보안0건을 대조했습니다. 기존 그림은 새 업로드 성공 때만 바꾸고 실패한 파일도 남깁니다. 마지막 성공 그림의 별도 미리보기는 다음 선택 실패에도 남기며 실제로 다 쓴 뒤 해제합니다. 모든 대응 도안의 화면 키를 보존해 업로드 실패 뒤에도 충돌 재적용으로 파일이 사라지지 않게 했습니다. 숨은 규칙 페이지의 첫 오류로 이동하고 빈 이름은 중복 검사에서 뺐습니다. 다섯 실패/기존49개 통과 뒤 수정했고 추가 선택 필드·그림 수명 시험을 포함해 웹24파일465개·타입·형식/lint372파일·빌드531ms/두Worker가 종료0입니다.
- 서버 필드 오류(발견5)는 앞선 bd69d11에서 순서 오류의 일반 안내와 두 선택 필드의 오류를 고쳤습니다. 발견6의413 문구는 SCR036#error·API007의 명시된 공통 문구를 유지합니다. 발견7은 사진 API의 purpose/응답/AbortSignal 검증을 공통 함수로 합치고 변경 수 계산의 기존 기준 값을 재사용하며 가격표 채택/초기화를 adopt로 합쳤습니다. 서버/마이그레이션/의존성은8f973b95 새 전체와 차이0입니다.
- 학원컴 수정 전9상태 두 폭18개와1280 사진503 복구3개, 합계21개는 모두 오류/경고0이며 가격표 검토 전 원본에 보존했습니다. 여기에는 이번 Claude 수정이 없습니다. 다음은 검토 수정 전체 파일의 학원컴·현재CI·발견 처리 댓글/재검토 요청과 병합 직전Codex1회입니다. 실제 사장님/S3 성공과 최종 사진 촬영은 미확인입니다.

- 검토 수정 원본9d868e5의 새 전체 JS/CSS ZIP209,521바이트/SHA2563404218969647de7d48a5adaf1b628db2c51b4ec49c80704e54250ea6793fb1c를 학원컴에서 대조했습니다.9상태×두 폭18건은 오류/경고0입니다.1280 그림 업로드 실패/충돌 재적용/재업로드 저장3건도 동작했으나 처음 두 건에 추적 ID 숫자 줄바꿈 경고가1건씩 있었습니다. 수정 전21건은 before-trace-wrap-checks.json으로 보존했습니다.
- 공통 오류 안내의 추적 ID 값을 그대로 유지하며8자리 경계에 wbr을 넣었습니다. 원문을 읽는 시험 도우미가 모든 태그를 공백으로 바꾸던 두 실패도 확인해 공백을 만들지 않는 wbr/주석은 그대로 다루도록 고쳤습니다. 웹24파일465개·타입·형식/lint372파일/830ms·빌드745ms/두Worker가 종료0입니다. 다음은 수정 전체의 학원컴 두 폭/사진 실패/규칙 초점과 최종CI·검토·병합 직전Codex1회/main배포입니다. 실제 사장님/S3 성공은 미확인입니다.

- 학원컴 Aside CLI에서 최종9상태×두 폭18건과 그림 실패/재적용/재업로드 저장6건·다음 페이지 규칙 오류 초점2건·빈 이름 중복 안내 없음2건, 합계28건을 확인했고 오류/경고/검사 잘림이 모두0입니다. 가격표 최종 검사 원본의 파일SHA256은e397f1a90b9457b0429b01a56e6331cbce7218a6b93862996c0aa8f52a635734입니다. 양쪽 규칙 초점은/rules/20/optionB이고 추적ID의 DOM 글은원문32자 그대로입니다. 사진 요청2·저장2·새 키와 버전6도 관측했습니다.
- 전체 JS/CSS ZIP209,574바이트/SHA2569ad3e1f05cbd9cecdc44fb372ef88b9a66e814429f99b3407e7a5adf522685d5를 대조한 뒤 모바일 사진 오류의 끝 단어 경고를 없애는 text-wrap:balance 속성만 DOM style로 더했습니다. 컴파일JS가바이트같고 CSS도그속성만다른것을 bundle-comparison.json으로 대조했습니다. 최종컴파일CSS의SHA256은dcd57b8ac2e1746c18b2345cf6f9f13adc884c0c1893f199345162f9806976e0입니다. 별도스타일적용과전체재전송을구분하며최종사진촬영은미확인입니다.
- 웹465개·타입·형식/lint372파일/605ms·빌드736ms/두Worker 종료0이며 서버/마이그레이션은새전체8f973b95와차이0입니다. 현재코드원격dc60dc3d의검사는최신API로확인해PR에적습니다. 다음은기록head의CI·검토/발견처리·병합직전Codex1회·mainCI/배포/학원컴SHA·health입니다. 실제사장님/S3성공은미확인이고확인전에는049를끝남/구현완료로세지않습니다.

### (596) TASK-050 가격표 버전 이력 화면

- TASK-050의 SCR037·09 두 폭 목업과 API018/019 예시·DEC14를 읽었습니다. 서버는1,000개까지 전체 목록을 주고 화면은20개부터 점차 표시합니다. 읽기 전용 버전/권한/없는 버전·잘못된 경로·끊긴 응답·날짜/중복/순서/한도부터 시험을 썼고 첫 실행은 아직 없는 price-list-history-api 모듈 때문에1파일 실패/시험 미실행입니다. 설치는 npm ci161개/12s이며 기록596/README304를 예약합니다. 다음은 공용 가격표 응답 검증을 재사용하는 API와 실제 목록/상세 경로입니다. PR197의 학원컴 사진 복구·CI/검토를 계속하며, 아직050을 끝남/구현 완료로 세지 않습니다.

- 버전 이력 API018/019를 구현하며 서버가 허용하는 앞자리0 버전은 숫자 경로로 정규화합니다. 경로 주입·잘못된 숫자는 서버를 부르지 않고 없는 버전으로 처리합니다. 목록은1,000개/최신 순·날짜·중복을 검증하고 상세는 공통 가격표 검증과 요청한 버전을 대조합니다. 목록/상세의9응답·읽기 전용·20개씩 표시·실제 복귀 경로의 상호 작용 시험도 먼저 썼습니다. 첫 화면 시험은 아직 없는 PriceListHistory 모듈 때문에1파일 실패/시험 미실행입니다. 다음은 새 main 결합과 API 시험 통과·실제 화면 구현입니다.
- PR197은 이번 Codex 요청7102813434의 사용 한도7102818956을 처리한 뒤585ac16b4aa283238193a8d541ead8b00bfe64e9로 squash했습니다. main CI·스테이징·학원컴SHA/health는 확인 중이며049는 아직 구현 완료로 세지 않습니다. 기록596/README304를 유지합니다.

- 가격표 편집 main585ac16을 결합한 뒤 버전 이력 API21개가 통과했습니다. 서버가 허용하는 앞자리0 버전 정규화, 잘못된 경로의 무요청404, 목록 순서/중복/날짜/1,000개 한도와 권한/없는 버전/실패를 확인했습니다. 기록 충돌3개는 원래 번호596/README304를 유지해 풀고, 중복해 붙였던 빈 제목 하나씩도 정리했습니다. 다음은 목록/상세 화면과 그 첫 실패 시험 통과입니다. PR197 main CI·스테이징·학원컴SHA/health는 계속 확인 중입니다.

- PR197 main585ac16의 app45186007775는 첫 배포137733206929에서 staging_tag_mismatch로 실패했습니다. 독립 학원컴 조회는 같은 태그/health200이었고, 실패 작업을 한 번 재실행한 attempt2의 check137735080234·Windows137735081107·배포137735079099가 성공했습니다. db45186007399의16.15 137731665161·17.11 137731664716도 성공입니다. 학원컴 기존OAuth/계정 일치·앱cf4dc8c5-c242-4f00-adc4-f530e1c62800(22:45:34KST)·저장소7425a308-35d9-4114-a7fc-618107785b56(22:45:26KST,100%)의 같은 전체SHA·health200·Node0은 main197-deployment.json에 보존합니다.
- 배포 뒤 도착한 Claude7103011222는 이전7건 처리와 보안0건을 확인했으나 새 중간2·낮음3건을 찾았습니다. 두 번 연속 충돌 재적용, 저장 단계에서 거절된 업로드 복구, position 초점과 중복 처리 코드입니다.049를 구현 완료 목록에 넣지 않고 별도049 후속 PR에서 실패 시험부터 고칩니다. 실제 사장님/S3/스크린샷도 미확인입니다.
- TASK050의 목록·읽기 전용 상세와 두 폭 전환·지연 응답 차단·세션 실패·20개 추가 표시를 구현했습니다. 경로 검사가 사이트맵 also_paths를 놓친1실패/496통과 뒤 보조 경로와 인증 콜백 제외를 대조하도록 고쳤고 관련3파일92개가 통과했습니다. 원본 사이트맵은 바꾸지 않았습니다.050은 작업 브랜치에 보존하고049 후속 뒤 전체/학원컴을 이어갑니다.

- 050 보존 검사: 웹26파일507개·전체 타입·빌드 종료0, 형식/lint377파일635ms, WBS18개/오류0·키943파일0입니다. 다음은049 병합 뒤5건의 별도 수정이며050은 API/목록/상세와 회귀 시험이 있는 작업 브랜치에서 이어갑니다.

- 버전 이력 화면의 도안 읽기 실패를1실패/19통과로 확인한 뒤 대체 안내를 더했습니다. 목록/상세401 중복 처리·같은 상세만 재시도·신고 보류의 버전 조회 전 이동까지 화면20개가 통과했고 전체 웹26파일511개·타입·형식/lint377파일548ms가 성공했습니다. 수락 대조는 price-list/task-050-screen-acceptance.md에9응답과5상태를 적었습니다. 다음은 새 빈 데이터베이스 전체·학원컴 두 폭과 PR검토입니다.
- 부모049 후속PR198은 코드 원본9d45179의 새 빈 데이터베이스 서버2221/웹469개·타입/빌드가 성공했고 head3567bb9에서 CI/코드·보안 검토 중입니다. 학원컴049는 첫 화면/360px 트리 뒤 검사88,377ms·뒤 조작30,111ms CDP 시간 초과2회로 그 확인만 보류했고 직접 연 탭/서버는 정리했습니다.049는 아직 구현 완료 표에 넣지 않습니다. 고를 수 있는 작업36개를 다시 계산했으므로 독립050 작업을 계속합니다.

- 원본c374b306882dffa0c5ee02388232d9acca33fb56의 새 빈 데이터베이스34개 마이그레이션·서버104파일2221개/웹26파일511개와 빌드772ms·두 Worker가 종료0입니다. 타입·형식/lint377파일548ms·WBS18개/오류0·키944파일0·새 글 용어0도 확인했습니다.
- 학원컴 전체 JS/CSS ZIP211,480바이트/SHA25622ba89bd0b89ad003e6196d8586892daeacf4490f076c49d00ff184af4dffa3c는 대조했습니다. 그러나 새 탭 열기가 Page.enable30,803ms·DOM.enable30,741ms로 두 번 시간 초과됐고 이 주소 탭은 목록에서0개였습니다. CLI 문서의 별도 창 --incognito repl도 시작 응답이 없어 Ctrl-C로 중단했습니다. 해당 화면/페이지 검사는0개이고 통과로 쓰지 않습니다. 직접 시작한 합성 서버만 정리하며 브라우저 확인은 연결 복구까지 보류합니다.
-049 후속 PR198의현재head3567bb984e0f4751ce2c0d9c451ce19715aabb43은app/Windows/데이터베이스CI성공이며코드·보안검토를기다립니다.050은이검사/제약을넣어readyPR을열고CI·검토를추적합니다.051도독립적인앞선작업을채워원본을읽고API첫실패시험을준비합니다.049/050은끝남·구현완료에넣지않으며고를수있는작업36개를계속합니다.

- PR199검토7104161753(head a3d0e1b7)의중간1·낮음6건/보안0건을이번PR에서모두고쳤습니다. 같은이력분기에서검증한사장님/가게의목록과펼친개수를보존하며,세션재확인중새상세요청을막습니다.401은로그인으로,확인실패는자료를잠근채로그아웃허용으로,다른계정/가게는새key로이전자료를비우는실제OwnerArea시험을더했습니다.60개펼친뒤945버전을골라도목록조회1회/60개가남습니다.
- 좁은상세의숨은목록로딩은버튼을잠그지않고,끝슬래시는같은경로로판정합니다.읽기전용제목은일반제목모양/셀간격을쓰며,자동선택은aria-current=true·직접연버전은page입니다.닿지않는임시복귀버튼을지우고날짜/버전검증과날짜형식객체를공유합니다.
- 초기화/숨은로딩/끝슬래시/권한세경우를실패시킨첫화면시험은9실패/18통과였습니다.관측콜백이생기기전호출하던시험은명시적으로기다리게고쳤고,세션실패문구는실제오류제목을대상으로삼아알림영역의동일문구와구분했습니다.수정뒤관련2파일48개·전체웹26파일518개·타입·형식/lint·빌드가종료0입니다.서버/마이그레이션/의존성은새전체c374b306(2221개/웹511개/빌드772ms)과차이0입니다.학원컴확인은여전히CDP보류이며통과로세지않습니다.다음은새headCI·검토처리/부모main결합·병합직전수동검토한번/main배포입니다.

- PR198을수동요청7104573632의이번사용한도7104578919로처리하고main92b65f5d3aa1eeb1365d6aa195161ed8665bfe79로squash했습니다. app45198702384(check137776013922/Windows137776014326/배포137777655924)·db45198702500(16.15 137776014340/17.11 137776014610)가모두성공했습니다.학원컴기존OAuth/계정일치·앱f2e38447-c5eb-4e30-8dfc-b99b5edc9255(23:54:42KST)/저장소02200dcb-61f1-474a-ae93-57059745ca51(23:54:31KST,100%)가같은전체SHA·health200·Node0입니다.실제화면CDP보류는남아049를끝남/구현완료표에넣지않습니다.
- 이main을결합하며기록4개충돌을원래번호순서596/597·README304/305로풀었습니다. 새597기록의제목모양만기존기록과맞췄고번호는바꾸지않았습니다. 결합뒤웹26파일526개·타입·형식/lint378파일570ms·빌드634ms/두Worker가종료0입니다. 서버/마이그레이션/의존성은새전체c374b306과같습니다. main198-deployment.json에부모배포원본을보존합니다.
- 실제검토7104161753의7건처리와이결합을새head로보내현재CI·추가검토를확인합니다. 수동검토는199에서아직요청하지않았습니다.051은같은main에서API/양식52개·결합웹525개후실제화면첫실패시험을보존했습니다.화면CDP가풀리면보류한확인부터하고그전까지막히지않은구현을계속합니다.

### (597) TASK049 연속 충돌과 거절된 그림 복구

- PR197 병합 뒤 리뷰7103011222의 중간2·낮음3건을 별도049 후속으로 고칩니다. 첫 관련 시험은 연속 충돌의 최신 도안 손실·저장 거절의 잘못된 미리보기2개·순서 오류 초점·파일 URL 중복, 합계5실패/54통과였습니다. 도안의 baseDesignId로 재적용/추가/순서를 판단하고 화면 키는 유지합니다. 새 그림 저장 거절은 기존 기준 도안으로 복구하며 거절된 사진 표시를 지우고 원래 파일은 재업로드용으로 남깁니다.
- 같은 파일의 URL은 공통 훅에서 참조 수로 공유·해제합니다. 필드 위치 이동/규칙20개 페이지를 한 함수/상수로 모으고 직접 고칠 칸이 없는 오류는 결과 안내에 초점을 보냅니다. 수정 뒤 관련2파일59개·형식/lint373파일550ms가 통과했습니다. 추가로 원격 도안 순서와 기존 그림으로 다시 저장하는 흐름을 시험합니다.
- 기록597/README305를 예약합니다.050의 기록596/README304와 원래 번호를 유지하며050 원격55ca4d30d2d9fdfb5e2947da1e9f60eb213279c6의 웹507개·타입·빌드 통과 상태는 보존합니다. 아직049를 끝남/구현 완료로 세지 않습니다. 다음은 추가 회귀·새 빈 데이터베이스 전체·학원컴 두 폭과 ready PR/코드·보안 검토입니다.

- 깨끗한 원본9d45179d26f530a5d595fce4c317dce68a5f8ecf의 새 빈 데이터베이스34개 마이그레이션과 전체 서버104파일2221개·웹24파일469개가 모두 통과했습니다. 빌드583ms/두 Worker dry-run도 종료0입니다. 추가 관련2파일61개와 전체 타입이 통과했고 새 글 용어0·WBS18개/오류0·키940파일0입니다.
- 같은 수정 전체 JS/CSS ZIP209,447바이트/SHA25634542adda736b002bacad28b24bee5ee5dbf75f496a099ef1864bd249028bc34를 학원컴에서 대조했습니다. 별도 CSS 주입은 없습니다. 학원컴 두 폭/복구 확인은 진행 중이며 아직 통과로 쓰지 않습니다. 다음은 실제 확인 결과와 코드/보안 검토·현재 CI·병합 직전 수동 검토1회/main 배포입니다.

- 학원컴 후속 파일의 첫 화면과360px 변경 뒤 접근성 트리는 읽혔지만 페이지 검사 Runtime.callFunctionOn은88,377ms에 시간 초과됐습니다. 뒤의 doubleStale 선택/트리 확인도30,111ms에 같은 CDP 오류여서 이 화면 확인만 보류했습니다. 직접 연 탭은25,627ms에 닫혔습니다. 완료한 페이지 검사는0개이고 새 수정의 두 폭·복구 동작을 통과로 쓰지 않습니다. follow-up-native-status.json에 원본 관측값을 보존하며 기존049의28개 원본과 구분합니다.
- PR #198은 23:06:36 KST에 리뷰 준비 상태로 열어 코드·보안 검토를 요청했습니다. head 225d831의 PostgreSQL 16.15·17.11과 Windows 검사는 성공했고 앱 검사는 진행 중입니다. CLI 대안은 문서를 확인했으나 exec는 별도 브라우저 에이전트입니다. 같은 CLI·프로필 검사를 반복하지 않고, 사용자 지시대로 다른 브라우저 도구로 우회하지 않습니다. 다음은 CI·검토·발견 처리·병합 직전 수동 요청 1회와 main 확인입니다. TASK-050은 별도 원격 브랜치에서 계속하며 TASK-049는 구현 완료로 세지 않습니다.

- PR #198의 실제 검토 7103872042는 14:21:21Z에 head 225d831을 검토한 낮음 5건·보안 0건입니다. 봇 표시 앞머리 때문에 접두부 필터가 이 댓글을 놓친 것을 고쳐 일반·인라인·제출 검토를 모두 읽었습니다. 30분 무응답으로 처리하지 않고 이 PR에서 5건을 모두 고칩니다. PR #199의 실제 검토 7104161753(중간 1건·낮음 6건·보안 0건)도 확인하고 후속 차례에 둡니다.
- A 업로드 성공 뒤 B 업로드 실패 또는 로컬 크기 검사 실패가 나고, A 저장도 거절된 두 흐름에서 A를 보존해 별도 버튼으로 다시 올립니다. 거절된 대상은 acceptedFile로 기록하고 재업로드가 실패하면 기존 그림 유지 안내는 하나만 보입니다. 비활성 입력의 오류는 그룹과 페이지를 표시하고 전역 잠금을 푼 뒤 결과 안내에 초점을 보내 대기를 비웁니다. 규칙 페이지의 마지막 숫자 20도 상수로 바꾸고 designIdentity를 변경 개수 계산과 재적용에서 함께 씁니다.
- 첫 사진 흐름 3건이 실패했고 초점 시험은 표시명을 고친 뒤 1개 실패·52개 건너뜀으로 재현했습니다. 수정 뒤 웹 24파일 473개·타입·형식/lint·빌드 1.05s와 두 Worker가 모두 통과했습니다. 서버·마이그레이션·의존성은 새 전체 원본 9d45179와 차이가 없으며 그 원본의 서버 2,221개 성공 결과를 유지합니다. 새 학원컴 확인은 CDP 문제로 보류 중이므로 통과로 쓰지 않습니다. 다음은 현재 head CI·검토 처리 댓글·병합 직전 수동 검토 1회와 main 배포입니다.

### (598) TASK051 운영규정 확인과 버전 편집 화면

- SPEC-005·SCR-038의 10개 상태·15개 응답과 API-020/021, 숫자·조문·환불 단계 및 공통 명령·확인 절차를 읽었습니다. npm ci는 161개/12s입니다. 첫 API·양식·화면 실행은 각 모듈이 아직 없어 시험을 실행하지 못했고 구현 뒤 검사했습니다.
- API 시험은 실패 예시의 application/problem+json 매체를 맞춘 뒤 조회 캐시 금지의 1개 실패·44개 통과를 재현했습니다. cache:no-store로 고쳐 45개가 통과했습니다. 현재·템플릿 메타데이터와 수치·날짜·조문·환불 단계·확인 기록을 검증합니다. 양식 7개는 빈 값을 0으로 바꾸지 않고 조문 원문·유니코드 한도·단계의 빈 구간/겹침과 조문·표의 짝을 확인합니다.
- G3는 바꾼 값만 최신 위에 적용하며 다른 기기의 기한과 조문을 보존합니다. 같은 원문인 직접 쓴 조문 둘처럼 대응할 수 없는 경우는 입력을 남기고 자동 재적용을 막습니다. 첫 독립 화면은 처리 중 안내가 없어 1개 실패·11개 통과였고 안내를 더해 12개가 통과했습니다. 이후 부모 main92b65f5·e7b7f8b를 결합하면서 기존 기록 번호를 유지했습니다.

- SCR-038의 운영규정 화면을 실제 사장님 경로에 연결했습니다. 현재 값·미확정 템플릿·낮춘 환불의 근거 확인과 새 요청 키·서버/필드 오류·충돌 재적용·처리 중 자동 재시도·세션 잠금과 15개 응답을 자동 시험으로 대조했습니다. API 45개·양식 7개·화면 25개가 있으며 화면과 스타일의 관련 2파일 54개·타입 종료 0·형식/lint 385파일/694ms가 통과했습니다.
- 직접 쓴 조문을 빼면 행에서도 지우고 기본 조문 선택지는 남깁니다. 조문 50개·환불 단계 20개 한도, 카드 길이 오류의 입력/초점 보존, 요청 키 재사용의 새 키 재시도, 환불 확인 창의 세션 실패 잠금, 충돌 재조회 실패 복구를 확인했습니다. 넓은 화면은 기존 1260px 분기 안에서 기한·조문·환불 단계를 세 열로 배치하고 좁은 화면은 카드 흐름을 유지합니다. 새 화면의 실제 두 폭 관측은 하지 않았습니다.
- 첫 실제 경로 시험은 잘못 적은 주소를 원본 /owner/operating-rules로 바로잡은 뒤 2개 실패·1개 통과로 연결 누락을 재현했습니다. 세션 확인 전 조회 2개 실패와 직접 쓴 조문 삭제 1개 실패도 재현해 고쳤습니다. 자동 재시도 시험은 1초 재시도보다 짧았던 대기를 늘렸고, 실제 경로의 초기 스켈레톤을 붙잡던 시험은 새 화면을 기다리게 고쳤습니다. 현재 모든 관련 시험이 통과합니다.
- PR #200의 앱·Windows·두 PostgreSQL 검사는 성공했고 코드 리뷰를 기다립니다. PR #201은 이력 화면의 병합 뒤 두 지적을 처리해 리뷰 준비 상태로 열었으며 새 전체 서버 2,221개·최종 웹 532개·타입/lint/빌드를 통과했습니다. 부모 main e7b7f8b18be9859ce050619de492849897129c66의 CI·배포·학원컴 앱/저장소 같은 SHA·health 200·종료 0은 main199-deployment.json에 보존합니다.
- 학원컴 Aside CDP의 두 번 시간 초과와 별도 창 시작 무응답 때문에 새 실제 화면 검사는 0개입니다. 실제 사장님 계정도 미확인이며 TASK-049·050·051을 끝남이나 구현 완료로 세지 않습니다. 끝남 32개·구현 완료 20개·시작 가능 36개를 다시 계산했습니다. 기록 598·README 306을 유지하고 다음은 새 전체 검사·현재 head CI·코드/보안 리뷰·수동 검토 한 번과 main 배포입니다.

- 깨끗한 원본 24d308b1032a09ab19f739369db55e78aabdf8fe의 새 빈 데이터베이스에 34개 마이그레이션을 적용하고 서버 104파일 2,221개·웹 29파일 605개·빌드 1.20s와 두 Worker를 종료 0으로 확인했습니다. 기존 설치는 161개/12s, 타입 종료 0이며 마지막 형식/lint는 385파일/776ms입니다. 새 문서 용어 0·WBS 18개/오류 0도 확인했습니다.
- 시험 개수를 수집하던 CLI의 출력 파일 옵션을 잘못 써 시험 파일 하나가 JSON으로 바뀌었습니다. 같은 커밋의 원본과 바이트가 같게 복구했고 SHA256 72ebf0c7c80a5f6d762f0e9e2bacb16e395fba84171d8e941d5cdfc36616b93a를 대조했습니다. 복구 뒤 화면 25개·형식/lint가 통과했고 런타임/시험 소스는 전체 검사 원본과 차이가 없습니다. 이 잘못된 수집 실행은 통과로 쓰지 않습니다.
- 다음은 리뷰 준비 PR의 현재 head CI·코드/보안 리뷰·병합 직전 수동 검토 한 번과 main 확인입니다. PR #200의 추가 낮음 3건은 처리 중이며 PR #201의 리뷰도 추적합니다. TASK-052의 API는 별도 원격 브랜치에 보존했고, 051은 실제 두 폭/10개 상태 페이지 검사와 사장님 계정이 남아 끝남이나 구현 완료로 세지 않습니다.

- PR #200의 main737a9256f68722e087b281048a3eb381ed6da029를 결합하고 네 기록 충돌을 원래 번호 598·599/README306·307 순서로 풀었습니다. 결합 뒤 웹 614개·타입 종료 0·형식/lint 385파일/883ms·빌드 915ms와 두 Worker가 통과했습니다. 서버·마이그레이션·의존성은 새 전체 원본 24d308b와 차이가 없습니다. 다음은 새 head CI와 현재 코드/보안 리뷰·병합 직전 수동 검토 한 번, main 확인입니다. 학원컴 실제 화면은 CDP 문제로 보류합니다.

- PR #202의 실제 코드/보안 검토 7106270391(head c383f1e8)의 중간 1건·낮음 7건·보안 0건을 확인했습니다. 서버가 보내는 /clauses와 /clauses/0 순서의 실제 카드 길이 오류로 시험을 고쳐 해당 행의 첫 글 입력란에 초점을 보냅니다. 직접 쓴 조문 삭제는 재적용 뒤에도 행을 지우고, 켠 조문은 저장 position 순서와 번호로 먼저 보여 줍니다. 꺼진 기본 조문은 선택 영역으로 나눕니다.
- 조문을 모두 뺐을 때 하나 이상 넣어야 한다는 이유를 알리고, 세션 확인 실패의 조회 골격을 숨깁니다. 아직 연결 전인 이력 버튼은 TASK-052에서 경로를 반영할 때 보이도록 이번 화면에서 뺐습니다. 가격표와 운영규정의 숫자는 십진 정수 표기만 받고 지수·16진수·소수 표기를 다른 정수로 바꾸지 않습니다. 숫자 변환/검사와 변경 필드 비교를 공통 form-values로 모았습니다.
- 첫 관련 실행은 12개 실패·47개 통과였고 고친 뒤 관련 3파일 59개·타입 종료 0·형식/lint 386파일/679ms가 통과했습니다. 발견 8번의 조회·G3 전체 훅 공통화는 TASK-053에서 가격표·운영규정·결제 수단의 회귀 시험과 함께 적용합니다. 이 PR에서는 숫자와 필드 비교를 공용화했고 남은 조회 수명 정리는 후속으로 명시합니다. 다음은 부모 main201 결합·전체 웹/빌드·현재 head CI와 검토 처리입니다. 실제 화면은 CDP 문제로 보류합니다.

- 검토7106270391의 중간 1건·낮음 7건은 처리 범위를 구분했습니다. 실제 서버 카드 오류의 행 초점·직접 쓴 조문 삭제·선택 조문 순서와 연속 번호·빈 조문 안내·이력 버튼 임시 숨김·세션 실패 조회 골격·두 양식의 정수 표기를 고쳤습니다. 8번의 변경 필드 계산과 정수 변환은 공통 함수로 모았고, 조회·stale·초점 수명의 공통 훅은 TASK-053에서 이어 적용합니다. 새 훅 자체의 7개 시험은 이미 통과했으며 기존 두 편집기 적용과 회귀 검사를 그 작업에서 진행합니다.
- 첫 관련 12개 실패·47개 통과를 재현한 뒤 관련 59개가 통과했습니다. 부모 main c7639483350498b362abda8d4015c4f6372c5402를 결합한 현재 원본 cf028a5의 전체 웹 631개·타입 종료 0·형식/lint 386파일/734ms·빌드 886ms와 두 Worker도 통과했습니다. 서버·마이그레이션·의존성은 새 전체 원본24d308b(서버2,221개)과 차이가 없습니다. 다음은 처리 원본/새 head 연결과 현재 CI·재검토 요청·병합 직전 수동 검토 한 번입니다.
- PR #201은 보안 검토7105898276의 발견 0건, 코드 리뷰 30분 대기 기록7106526819, 수동 요청7106527367의 이번 사용 한도7106534642 처리7106556991 뒤 squash했습니다. main의 app45212291006(check137824032220·Windows137824031690·배포137826599864)과 db45212291053(PostgreSQL16.15 137824031240·17.11 137824031603)가 모두 성공했습니다. 학원컴 기존 OAuth/계정 일치·앱45915f81-eb19-43d4-8fab-2fbc8818f59e(01:08:38 KST)·저장소3f5ce1bc-d1f0-4d75-8116-178bb934a954(01:08:29 KST,100%)의 같은 전체 SHA·health200·종료0은 main201-deployment.json에 보존합니다. 실제 화면은 별도로 CDP 보류 상태를 유지합니다.

### (599) TASK-049 재적용 제약과 오류 안내·파일 이름

- PR #198 병합 뒤 검토 7104828625의 낮음 4건을 TASK-049 후속 PR에서 처리합니다. 로컬 오류 안내를 초점 대상인 저장 결과 영역 안으로 옮깁니다. 옵션의 표시 방식과 기본 범위, 연결 도안의 제약을 화면 변경과 G3 재적용에서 같은 함수로 정리해 두 기기의 변경 뒤에도 저장할 수 있게 합니다.
- 사진 재시도는 ‘선택한 파일’과 ‘저장 거절된 파일’에 각각 파일명을 붙여 구분합니다. 이름·크기·수정 시각만으로 내용이 같은 파일이라고 판단하지 않습니다. 같은 이름의 다른 파일도 두 목적을 구분하며, 같은 File 객체는 원래처럼 버튼 하나만 보입니다. 두 원본을 남겨 사용자가 다시 고를 수 있게 합니다. 최근 TASK-049 기록의 띄어쓰기도 바로잡습니다.
- 첫 관련 실행은 6개 실패·62개 통과였습니다. 그중 빈 화면 문구를 잘못 기다린 시험은 실제 문구로 고쳐 오류 영역에 안내가 없는 1개 실패를 다시 확인했습니다. 사진 버튼을 기다리지 않은 시험도 명시적으로 기다리게 고쳤습니다. 수정 뒤 관련 68개가 통과했고 같은 이름의 다른 파일 사례를 추가 검사합니다. 기록 599·README 307을 예약하며 TASK-051의 598·306을 유지합니다.
- PR #199의 main e7b7f8b18be9859ce050619de492849897129c66은 앱·Windows·두 PostgreSQL·배포가 모두 성공했습니다. 학원컴 기존 OAuth와 계정 일치, 앱과 저장소의 같은 전체 SHA·저장소 100%·health 200·종료 0을 main199-deployment.json에 보존합니다. 병합 뒤 검토 7105290899의 낮음 2건은 TASK-050 후속 PR에서 고칩니다. 실제 화면은 CDP 문제로 보류 중이며 TASK-049·050을 끝남이나 구현 완료로 세지 않습니다.

- 원본 6b73bb0c87f4f1f8b11557e00c5592781def71b5의 새 빈 데이터베이스에 34개 마이그레이션을 적용했고 서버 104파일 2,221개·웹 26파일 530개와 빌드가 종료 0입니다. 새 설치는 161개/15s, 타입 검사도 종료 0입니다. 그 뒤 파일명이 긴 재시도 버튼의 폭과 줄바꿈을 가격표 CSS 안에서 제한했습니다. 최종 웹 530개·형식/lint 378파일/814ms·빌드 735ms와 두 Worker가 다시 통과했습니다.
- 관련 시험은 69개가 통과했습니다. 새 글 용어 0·WBS 18개/오류 0·키 951파일/발견 0을 확인했으며, 마지막 기록을 포함한 키 검사는 커밋 전에 다시 합니다. 실제 화면은 계속 보류합니다. 다음은 리뷰 준비 PR·현재 head CI·코드 리뷰·병합 직전 수동 검토 1회와 main 배포입니다.

- PR #200 검토 7105874699는 기존 네 지적 처리를 확인하고 낮음 3건을 더 찾았습니다. 내 기기에서 켠 기본 범위가 다른 기기의 표시 방식 변경 때문에 정리되는 경우는 옵션·도안을 충돌 목록에 올리고 입력을 보존합니다. 반대 방향인 내 표시 방식 변경은 기존 의도대로 정리합니다. 서버 422가 비활성 체크박스를 가리키면 안내가 있는 결과 영역에 초점을 보내는 시험을 복원하고, 저장 성공 뒤 의미가 없던 초점 단언은 지웠습니다.
- 파일명은 목적이 명시된 재시도 버튼에서 한 번만 표시하고 바로 위의 중복 문단 둘은 지웠습니다. 첫 관련 실행은 4개 실패·70개 통과였으며 수정 뒤 2파일 74개·타입 종료 0·형식/lint 378파일/708ms가 통과했습니다. 파일 메타데이터만으로 내용을 같다고 합치지 않는 이유는 리뷰에서도 수용됐습니다. 다음은 최종 웹·빌드와 새 head CI·처리 댓글·병합 직전 수동 검토 한 번/main 확인입니다. 실제 화면은 CDP 문제로 계속 보류합니다.

- 검토 7105874699의 세 지적은 4개 실패·70개 통과로 재현한 뒤 고쳤습니다. 내 기본 범위 선택을 적용할 수 없으면 옵션·도안의 충돌을 알리고 입력을 보존합니다. 비활성 필드를 가리키는 서버 422는 오류 안내가 있는 결과 영역에 초점을 보내며 파일명은 목적이 명시된 버튼에서 한 번만 읽습니다. 관련 74개·전체 웹 535개·타입 종료 0·형식/lint 378파일/708ms·빌드 788ms와 두 Worker가 통과했습니다. 서버·마이그레이션·의존성은 새 전체 원본 6b73bb0과 차이가 없어 서버 2,221개 결과를 유지합니다.

### (600) TASK-050 세션 재확인과 같은 상세 보존

- PR #199 병합 뒤 검토 7105290899의 낮음 2건·보안 0건을 TASK-050 후속 PR에서 처리합니다. 같은 버전의 준비된 상세는 주소 선택이나 bfcache 세션 재확인 뒤에도 유지합니다. 목록과 상세의 초기 요청은 세션 확인이 끝난 뒤 시작하고, 확인 중 취소된 응답은 적용하지 않습니다.
- 첫 화면 시험은 4개 실패·27개 통과였습니다. 실제로 ‘현재 가격표로’ 이동한 뒤 진행 중인 세션 확인을 취소하고 뒤로 돌아오는 시험도 1개 실패로 재현했습니다. 같은 history key로 돌아왔을 때 이전 방문의 검사 결과가 다시 유효해지는 것을 막기 위해 OwnerArea에서 방문 객체로 세션 검사 결과를 구분합니다. 재확인 뒤 계정·가게가 같으면 기존 화면을 유지하고 다르면 기존 화면 키 규칙대로 비웁니다.
- 첫 수정 뒤에는 목록의 요청 완료 표시가 빠져 기존 60개 유지 시험이 1개 실패했습니다. 성공·실패 응답 모두 완료 상태를 기록하고 취소된 요청만 다시 시작하도록 고쳤습니다. 세션 확인 실패 시험은 먼저 받은 오류를 보존한 뒤 잠금과 로그아웃을 검사하도록 조정했습니다. 기록 600·README 308을 예약합니다. 현재 타입·화면 회귀 검사를 진행하며 새 전체 검사·CI·코드/보안 리뷰·병합 직전 수동 검토 1회와 main 확인을 남깁니다.
- 학원컴 Aside CLI는 두 번의 CDP 시간 초과와 별도 창 시작 무응답으로 실제 화면 확인을 보류 중입니다. 같은 조건의 반복 실행은 하지 않으며 실제 360·1280 화면이나 사장님 계정 성공으로 적지 않습니다. TASK-049 후속 검사의 원격 브랜치를 유지하고 TASK-051도 저장된 작업에서 계속합니다.

- 깨끗한 원본 be03c3bdb49ff475d28926b733bbf115c638b6a1의 새 빈 데이터베이스에 34개 마이그레이션을 적용하고 서버 104파일 2,221개·웹 26파일 531개·빌드 642ms와 두 Worker를 모두 종료 0으로 확인했습니다. npm ci는 161개/16s, 타입 종료 0·형식/lint 378파일/1,173ms·관련 화면 32개가 통과했습니다. 새 글 용어 0·WBS 18개/오류 0·키 950파일/발견 0이며 마지막 기록을 포함한 키 검사를 커밋 전에 다시 합니다.
- 초기 4개 실패와 실제 뒤로 가기 1개 실패를 재현한 뒤 세션 재확인 중 새 목록·상세 요청 차단, 같은 버전 상세 유지, 취소된 요청 재개, 계정 변경 시 기존 화면 초기화를 확인했습니다. 학원컴 실제 화면은 CDP 문제로 계속 보류하며 다음은 현재 head CI·코드/보안 리뷰·병합 직전 수동 검토 1회와 main 확인입니다. TASK-049 후속 PR #200의 CI와 리뷰도 함께 추적합니다.

- 진행 중 목록 요청이 세션 확인 시작으로 취소된 뒤, 늦은 401을 버리고 확인 완료 후 새 목록만 한 번 받는 회귀 시험을 더했습니다. 이미 받은 같은 버전 상세는 GET 한 번을 유지합니다. 런타임은 새 전체 검사 원본 be03c3b와 같고 최종 웹 532개·관련 화면 33개·타입 종료 0·형식/lint 378파일/697ms가 통과했습니다.

- PR #200의 main737a9256f68722e087b281048a3eb381ed6da029를 결합했습니다. 기록 네 곳의 충돌은 원래 번호 599·600/README307·308을 유지했고 부모의 띄어쓰기 수정도 보존했습니다. 결합 뒤 웹 541개·타입 종료 0·형식/lint 378파일/562ms·빌드 943ms와 두 Worker가 통과했습니다. 서버·마이그레이션·의존성 변경은 없습니다. 실제 화면은 CDP 문제로 보류하며 새 head CI와 현재 코드/보안 리뷰를 이어 확인합니다.

- PR #200의 main737a9256f68722e087b281048a3eb381ed6da029는 app45209468879의 check137814036337·Windows137814037091·배포137815841683와 db45209468934의 PostgreSQL16.15 137814037758·17.11 137814037274가 모두 성공했습니다. 학원컴 기존 OAuth·계정 일치, 앱34f917f3-b888-4e8a-bc86-e63ccf8e7a4a(00:52:31 KST)와 저장소e3d9fba4-c912-41ea-894f-15cccf25e9b1(00:52:22 KST,100%)가 같은 전체 SHA이며 health200·종료0을 확인했습니다. 원본은 main200-deployment.json입니다.
- TASK-050은 이 부모를 결합한 웹541개·타입·형식/lint·빌드943ms 결과와 실제 화면 보류 상태를 유지합니다. 현재 코드/보안 리뷰와 새 head CI를 기다리고, 병합 직전 수동 검토는 아직 요청하지 않았습니다. TASK-051도 부모 결합 뒤 웹614개·타입·빌드915ms를 통과했고 TASK-052는 읽기 전용 이력의 새 전체 검사를 진행합니다.

### (601) TASK-052 운영규정 버전 이력

- TASK-052의 SPEC-005·016과 SCR-039의 5개 상태·9개 응답, API-022/023, 360·1280 목업을 읽었습니다. API의 최신 순 1,000개 목록과 저장한 규정 상세는 기존 VersionList·OperatingRules 계약을 사용합니다. 가격표와 운영규정 이력의 순서·날짜·버전 범위·경로 정규화·취소 신호를 공통 API 모듈로 모았습니다. 조회는 no-store이며 숫자로 검증한 같은 출처의 경로만 요청합니다.
- 첫 시험은 아직 없는 이력 모듈 때문에 1파일 실패·시험 미실행이었습니다. 구현 뒤 새 이력 API 24개와 기존 가격표/운영규정 API를 포함한 4파일 111개·타입 종료 0·형식/lint 388파일/905ms가 통과했습니다. 미확정 템플릿을 버전 상세로 받지 않고 선택한 버전과 다른 성공 응답도 거절합니다. 설치는 161개/13s입니다.
- 기록 601·README 309를 예약합니다. TASK-051의 API 검증을 재사용하므로 그 저장된 원본 24d308b에서 작업 브랜치를 만들었습니다. 리뷰 준비 PR은 부모의 main 반영 후 변경 범위를 대조해 엽니다. PR #200·201의 앱·Windows·두 PostgreSQL CI는 모두 성공했고 코드 리뷰를 기다립니다. 학원컴 화면은 CDP 문제로 보류하며 다음은 읽기 전용 상세·두 폭 목록/선택·권한과 지연 응답의 실패 시험입니다.

- 운영규정 이력의 목록·읽기 전용 조문/기한/환불 상세를 구현했습니다. 가격표와 운영규정이 버전 조회·목록/상세 배치·추가 표시·선택과 세션 잠금을 공통 VersionHistory로 사용합니다. 규정 편집의 충돌 비교와 이력 상세도 같은 읽기 전용 요약을 씁니다. 숫자는 한국어 천 단위 표기로 보여 주고 조문 펼치기의 누르는 높이는 기존 토큰을 적용합니다.
- 첫 화면 실행은 없는 모듈 때문에 시험을 실행하지 못했습니다. 구현 뒤에는 금액 표기와 부모 TASK-050의 이전 시험이 2개 실패·97개 통과였습니다. 금액 표시를 고치고 이미 검증한 부모의 세션 실패/취소 시험을 함께 반영해 관련 4파일 105개·타입 종료 0·형식/lint 393파일/711ms가 통과했습니다. API 관련 111개 결과도 유지합니다. 실제 경로의 신고 보류 차단·끝 슬래시, 20개씩 펼침, 숨은 목록 지연, 권한과 실패 복구를 대조했습니다.
- PR #200은 실제 검토 7105874699의 세 건 처리7106041154와 최신 CI 성공, 병합 직전 수동 요청7106131838의 이번 사용 한도7106137182 처리7106153486 뒤 main737a9256f68722e087b281048a3eb381ed6da029로 squash했습니다. main CI·배포 확인을 이어가며 TASK-051의 최신 부모와 기록 번호 598·599·601을 보존해 결합합니다. TASK-052의 실제 두 폭 확인은 CDP 문제로 보류하고 끝남이나 구현 완료로 세지 않습니다.

- 깨끗한 원본 a1594be01e44b28d74e2fe776089233bb020ee71의 새 빈 데이터베이스에 34개 마이그레이션을 적용하고 서버 104파일 2,221개·웹 31파일 662개·빌드 628ms와 두 Worker를 종료 0으로 확인했습니다. 타입 종료 0·형식/lint 393파일/862ms도 통과했습니다. 이후 TASK-051의 최신 검사 기록만 결합했고 런타임과 시험 소스는 이 전체 검사 원본과 같습니다.
- API-022/023의 9개 응답과 5개 상태는 task-052-screen-acceptance.md에 대조했습니다. 공통 이력의 가격표 회귀와 규정 편집 비교를 포함한 관련 105개가 통과합니다. 실제 두 폭·5개 상태의 페이지 검사·44px 관측·스크린샷·사장님 계정은 CDP 문제로 아직 미확인입니다. 부모 PR #202가 main에 반영되면 그 변경을 대조한 뒤 TASK-052만의 리뷰 준비 PR을 열고 CI·코드/보안 리뷰를 계속합니다.

- TASK-051의 main13a11ffbfc95ff03c7d62543a90abf898ea5805b를 결합했습니다. 공통 이력 추출 전의 원본을 기준으로 소스를 합쳐 검토의 조문 오류·순서·삭제·정수 검증을 보존했습니다. 운영규정의 버전 이력 버튼은 이제 실제 이력 경로에 연결합니다. 부모 결합 뒤 전체 웹31파일673개·타입 종료0·형식/lint394파일558ms·빌드622ms와 두 Worker가 통과했습니다. 서버·마이그레이션·의존성은 전체 검사 원본a1594be(서버2,221개)과 같습니다.
- main202의 app45214703191·db45214703181와 배포가 모두 성공했고 학원컴 기존 OAuth/계정 일치, 앱704ec961-f491-43b7-b7a4-ffb4f177dbad·저장소6369da9e-e1b3-4700-8b21-741be7a64e6e(100%)의 같은 전체 SHA·health200·종료0을 확인했습니다. 원본은 main202-deployment.json입니다.
- 병합 뒤 도착한 TASK-051 재검토7107032418의 낮음4건을 확인했습니다. 조문 넣기/빼기 초점과 저장 본문 순서 시험은 TASK-051 후속에서, 취소된 조회의 loading은 이미 공통 훅을 적용 중인 TASK-053에서, 가게 설정의 숫자 변환은 해당 작업 후속에서 처리합니다. 실제 학원컴 화면은 CDP 보류 상태이며 끝남/구현 완료로 세지 않습니다. 다음은 TASK-052 현재 head의 CI·코드/보안 리뷰와 병합 직전 수동 검토 한 번입니다.

- 검토7107405437의 중간2·낮음5건과 보안0건을 확인했습니다. 정렬은 맞아도 두 번째 행이 현재인 목록을 두 API에서 거절하도록 기존 검증을 복구했습니다. 가격표/운영규정 각 실패 시험이 실제 해당 응답을 사용합니다. 규정 첫 조회 실패에도 독립된 이력 링크를 열며 링크로 새 탭 진입도 제공합니다.
- 좁은 직접 상세는 숨은 목록을 요청하지 않고 넓어지면 한 번 읽습니다. 세션 차단·늦은401·목록 보존 시험은 목록이 실제로 보이는 넓은 화면에서 계속 검사합니다. 이력 화면/버전은 한 경로 표와 matchPath로 정하고 쓰지 않는 재내보내기를 지웠습니다. 편집/두 이력의 서울 시각도 공통 format-date로 모았습니다.
- 첫 관련5개 실패·123개 통과를 재현했습니다. 목록 지연 뒤 이전 화면 가정7개를 실제 표시 조건에 맞춘 뒤 전체 웹31파일678개·타입 종료0·형식/lint395파일558ms·빌드903ms와 두 Worker가 통과했습니다. 서버·DB·의존성은 새 전체 원본a1594be(서버2,221개)과 같습니다. 다음은 처리 원본/새 head 연결과 현재 CI·병합 직전 수동 검토 한 번, main 확인입니다. 학원컴 실제 화면은 CDP 문제로 미확인입니다.

### (602) TASK-053 결제 수단 화면

- TASK-053의 SPEC-006·SCR-040 10개 상태/16개 응답과 API-024/025, 서버의 계좌번호·예금주·카드 링크 검사를 읽었습니다. 첫 API 실행은 아직 없는 모듈 때문에 1파일 실패·시험 미실행이었고 구현 뒤 32개 시험·타입 종료0·형식/lint380파일696ms가 통과했습니다. npm ci는161개/11s입니다.
- 조회는 같은 출처의 no-store GET, 저장은 요청 키를 붙인 PUT입니다. 숫자와 하이픈만 있는10~16자리 계좌, 은행/예금주30자·확인 기록·https 링크·날짜·revision을 검증하고 예상하지 않은 성공 필드는 화면 자료에서 뺍니다. 원래 계좌번호와 예금주는 브라우저 저장소나 로그에 남기지 않고 화면 메모리에서만 다룹니다. 실제 계좌나 결제는 사용하지 않았고 합성 자료로 시험했습니다.
- 기록602·README310을 예약합니다. 앞선598~601/306~309 번호는 유지합니다. PR #200의 main 배포와 학원컴 앱/저장소 전체SHA·health200·종료0은 확인했고 PR #201·202는 부모 결합 뒤 새 head CI와 리뷰를 기다립니다. 다음은 결제 수단 양식·예금주 불일치 확인과 제한·충돌 재적용의 실패 시험입니다. 학원컴 화면은 기존CDP 문제로 보류합니다.

- 결제 수단 양식은 원문과 빈 값을 보존하고 카드 링크를 비우면 null로 보냅니다. 예금주 불일치의 과거 확인 기록은 새 저장 본문에 복사하지 않습니다. 다른 기기의 은행·카드 링크를 보존하며 내가 바꾼 계좌·예금주·빈 링크만 최신 revision 위에 재적용합니다. 이름의 유니코드 글자 한도·계좌와 링크 형식을 포함한 양식 4개와 API 32개, 합계 36개·타입 종료 0·형식/lint 382파일/562ms가 통과했습니다.
- PR #202 검토7106270391의 8번에서 요청한 공통 조회·stale·초점 수명은 TASK-053에서 세 편집기의 회귀 시험과 함께 적용합니다. 202의 숫자/변경 필드 공통 함수와 확인 창을 재사용하려고 저장한 최신 부모를 작업 브랜치에 결합하며, 202가 main에 반영된 뒤 TASK-053만의 PR 범위를 대조합니다. 실제 결제와 실제 계좌 변경은 하지 않았습니다.

- 공통 useVersionedRead 훅의 세션 확인 전 무요청·확인 뒤 한 번만 조회·허용한 미설정 응답·확인 시작 때 취소와 늦은 응답 무시·충돌 모드 재시도·연결 예외를 7개 시험으로 확인했습니다. 첫 실행은 아직 없는 모듈로 시험을 실행하지 못했고 구현 뒤 7개·타입 종료 0·형식/lint 392파일/659ms가 통과했습니다. 연결 실패 값도 기존 API 모듈에서 함께 씁니다.
- 현재 훅 자체를 작업 브랜치에 보존한 뒤 가격표·운영규정 편집기에 연결합니다. 결제 양식도 같은 조회 수명과 취소 처리를 사용하며 기존 화면의 회귀 시험으로 동작을 대조합니다. PR #202의 중간1·낮음7건은 처리/후속 범위를 기록했고 현재 head CI를 기다립니다. PR #201의 main CI·배포·학원컴 SHA/health 대조는 완료했습니다.

- 공통 useVersionedRead를 가격표·운영규정 두 편집기에 연결했습니다. 초기/충돌 조회와 마지막 모드 재시도, 세션 확인 중 조회 차단, 진행 중 요청 취소, 늦은 응답 무시와 공통 연결 실패 처리를 함께 사용합니다. 가게별 입력·충돌 계산·오류 위치의 그룹/페이지 이동은 각 화면의 회귀 시험으로 유지합니다.
- 가격표의 첫 세션 확인 중/실패 때도 조회하던 두 경우는 2개 실패로 재현한 뒤 고쳤습니다. 공통 훅 7개와 기존 두 편집기 관련 96개·전체 웹 676개·타입 종료 0·형식/lint 392파일/582ms·빌드 625ms와 두 Worker가 통과했습니다. 검토7106270391의 8번 후속 가운데 조회 수명과 실패 값 공유를 적용한 결과입니다. 다음은 이 훅을 쓰는 결제 수단 화면의 실패 시험과 구현입니다.
- PR #202는 실제 코드/보안 검토 처리7106619628/7106771398과 재리뷰 요청7106771831, 최신 CI 성공, 병합 직전 수동 요청7106863272의 이번 사용 한도7106870581 처리7106886544 뒤 main13a11ffbfc95ff03c7d62543a90abf898ea5805b로 squash했습니다. main 검증을 이어가며 실제 화면 검사는 CDP 문제로 보류합니다. 아직 해당 작업을 끝남이나 구현 완료로 세지 않습니다.

- 결제 수단의 현재 계좌/미등록 양식·예금주 불일치 확인·예금주 제한 오류·저장 충돌 재적용·요청 키 재시도와 신고 보류 가게 재확인 안내를 구현했습니다. 실제 OwnerArea 경로에서 pending/verified/on_hold 가게 모두 계좌를 열고 저장 뒤 가게 상태를 재조회합니다. 서버 계약에 은행 목록이 없으므로 입력 가능한 은행 선택 상자로 현재 값을 제안하고 임의의 은행 목록은 만들지 않습니다.
- 초기 없는 모듈과 공통 인자 오류를 고친 뒤 첫 상호작용/스타일51개가 통과했고 세션 초기 차단·실제422 필드 오류를 더해55개가 통과했습니다. 화면 읽기 알림과 본문을 함께 찾던 시험은 실제 main 영역으로 한정했습니다. 타입 종료0·형식/lint395파일 결과를 로그로 확인했고 계좌 원문은 브라우저 저장소나 로그에 기록하지 않습니다. 실제 학원컴 페이지 검사는 CDP 보류로0개입니다.
- 가격표·운영규정의 취소/초기·충돌 조회는 이미 공통 useVersionedRead를 사용하며 취소 때 loading을 false로 돌립니다. TASK-051 병합 뒤 검토7107032418의3번을 이 후속에서 처리합니다. 조문 초점/저장 순서1·2번은 별도 TASK-051 후속, 가게 설정의4번은 해당 작업 후속으로 이어갑니다. 다음은 새 빈 데이터베이스 전체 검사와 현재 코드/보안 검토입니다.

- 깨끗한 원본832a2c2282ba6cbb5fa192914922901c381f0944의 새 빈 데이터베이스에34개 마이그레이션을 적용해 서버104파일2,221개·웹33파일702개·빌드982ms와 두 Worker를 종료0으로 확인했습니다. 등록 시각/예금주 확인 답 표시를 더한 최종 소스도 전체 웹702개·타입 종료0·형식/lint395파일620ms·빌드734ms와 두 Worker가 통과했습니다. 서버·DB·의존성 차이는 없습니다.
- SCR-040의16개 응답과10개 상태를 task-053-screen-acceptance.md에 대조했습니다. 가격표/운영규정의 공통 조회 적용 회귀도 포함합니다. 실제 학원컴 두 폭/페이지 검사/계정/카카오 알림은 CDP 보류로 미확인입니다. 다음은 현재 head CI와 코드/보안 검토, 병합 직전 수동 검토 한 번 및 main 배포 확인입니다.

- 검토7107739904의 중간1·낮음5건/보안0건을 모두 처리했습니다. 조회 실패의 폼 잠금과 화면 이동 잠금을 나누어 결제/가격표에서 가게 설정으로 나갈 수 있습니다. 첫 세션 확인의 조회 골격을 유지하고 막혀 있던 stale 조회는 확인 뒤 이어 읽습니다. 보류 가게의 created 저장만 가게 상태를 재조회합니다. 카드 링크의2048자도 서버와 같은 코드 포인트로 셉니다.
- 429 뒤 입력을 바꾸면 남은 절대 대기 시각을 보존하고 옛 본문/자동 재전송을 버립니다. 대기가 끝난 뒤 수정한 값은 새 키로 저장합니다. reset이 반복돼도 대기를 늘리거나 풀지 않는 두 명령 시험과 실제 계좌 양식으로 확인했습니다. 세 편집기의 조회 결과/권한/미설정 처리는 훅 콜백으로 모아 handledRead 효과를 없앴고 등록 시각과 신고 시각도 같은 도구를 씁니다.
- 보조 시험 설정을 고친 뒤 실제7개 실패·85개 통과, 콜백4개 실패·8개 통과를 재현했습니다. 수정 후 전체 웹35파일760개·타입 종료0·형식/lint404파일856ms·빌드1.18s와 두 Worker가 통과했습니다. 첫429 화면 보강 시험은 처리 중 버튼을 저장 버튼으로 찾는 설정을 고친 뒤 응답 도착을 기다려 검증합니다. 서버·DB·의존성은 새 전체 원본832a2c2의2,221개 결과와 같습니다.
- 다음은 조문 초점 main76d7dd9 결합·최종 웹/빌드와 현재 head CI·검토 처리 연결·병합 직전 수동 검토 한 번입니다. 실제 학원컴 화면/계좌/카카오 알림은 CDP 보류이며 끝남이나 구현 완료로 세지 않습니다.

- 조문 초점 main76d7dd9038fa732640e2f756e9a1a6407f1b40b6를 결합했습니다. 소스는 충돌 없이 합쳤고 기록601·602·603/README309·310·311 순서를 보존했습니다. 전체 웹35파일764개·타입 종료0·형식/lint404파일739ms·빌드710ms와 두 Worker가 통과했습니다. 검토7107739904의6건 처리와 부모 결합의 결과이며 실제 화면은 CDP 보류입니다.
- main204의 app check137861218793·Windows137861219716·PostgreSQL16.15 137861218711/17.11 137861219242가 성공했습니다. 배포 작업137863223547은 업로드·전체 SHA76d7dd9 확인·health200까지 성공한 뒤 합성 쿠키로 실제 DB를 읽는 점검이15초 시간 초과(exit28)였습니다. 실패 작업만 한 번 재실행했습니다. 학원컴의 기존 SSH 세션도 응답 없음(exit255)으로 끊겨 원격 CLI 재연결을 확인 중이며 학원컴 main204 대조는 아직 미확인입니다. 실패를 통과로 세지 않습니다.
- 다음은 현재 head CI/검토 처리 연결·병합 직전 수동 검토 한 번과 main 확인입니다. 배포의 두 번째 DB 점검도 실패하면 그 실제 환경 확인만 멈추고 기록한 뒤 다른 작업을 계속합니다.

### (603) TASK-051 조문 이동 초점과 저장 본문 순서

- 병합 뒤 검토7107032418의 낮음1·2번을 처리합니다. 기본 조문을 넣거나 뺄 때 부모 영역이 바뀌어도 안정된 행 ID로 옮긴 행을 찾아 넣기는 첫 조건 입력란, 빼기는 다시 넣기 버튼으로 초점을 보냅니다. 꺼진 선택지가 없으면 빈 기본 조문 영역도 그리지 않습니다.
- 첫 실제 회귀는3개 실패·28개 통과였습니다. 순서 시험에는 새로 넣은 기본 조문의 필수 내용을 채운 뒤 확정을 눌러 실제 전송 본문의 제목 순서와 화면 순서를 비교하도록 보강했습니다. 고친 뒤 화면31개·전체 웹29파일633개·타입 종료0·빌드516ms와 두 Worker가 통과했습니다. npm ci161개/10s, 서버·마이그레이션·의존성은 main13a11ff와 차이가 없어 부모의 새 빈 데이터베이스 서버2,221개 결과를 유지합니다.
- 초기 시험 도구는 오래된 공용 설치의 happy-dom 부재로 시험을 시작하지 못했습니다. 새 작업 폴더에 npm ci를 해 자체 설치로 전체 검사를 확인했고 그 도구 실패는 회귀 결과로 세지 않습니다. 학원컴 실제 초점·두 폭 페이지 검사는 기존 CDP 보류로 미확인입니다. 기록603·README311을 예약하고 현재 CI·검토·병합 직전 수동 검토 한 번과 main 확인을 이어갑니다. 취소 조회 loading(검토3번)은 TASK-053 공통 훅, 가게 설정 숫자(4번)는 해당 작업 후속입니다.

- 검토7107494701의 낮음2건을 처리했습니다. 직접 쓴 조문이나 환불 단계를 지우면 다음 행의 같은 삭제 버튼으로, 다음 행이 없으면 해당 추가 버튼으로 초점을 보냅니다. 기본 조문을 모두 넣는 시험도 마지막 행의 조건 입력란 초점까지 확인합니다.
- 첫2개 실패·31개 통과 뒤 전체 웹29파일635개·타입 종료0·형식/lint386파일584ms·빌드595ms와 두 Worker가 통과했습니다. 새 검토 범위는 기존 canEdit 잠금과 초점/시험이며 서버·DB·의존성 변경은 없습니다. 다음은 처리 원본/새 head 연결과 현재 CI·병합 직전 수동 검토 한 번입니다. 실제 학원컴 초점은 CDP 문제로 미확인입니다.

- 이력 main2dbf603cd8365b3b8c15935824a728022e225513를 결합해 현재 조문 초점과 공통 요약/버전 링크를 함께 검증했습니다. 소스 충돌 없이 기록4곳을 원래601·603/README309·311 순서로 보존했습니다. 결합 뒤 전체 웹31파일682개·타입 종료0·형식/lint395파일750ms·빌드694ms와 두 Worker가 통과했습니다. 서버·DB·의존성은 바뀌지 않았습니다.
- PR #203은 실제 코드/보안 검토7107405437의7건 처리7107564458와 수동 요청7107655864의 이번 사용 한도7107660362 처리7107689918 뒤 squash했습니다. main의 app45220581209(check137853405743·Windows137853406126·배포137855534174)과 db45220581158(PostgreSQL16.15 137853406244·17.11 137853405551)가 모두 성공했습니다. 학원컴 앱c56e0a28-7d33-4748-a7b5-a8a898c975a1·저장소7c88d365-c613-4568-b4a6-a020fd415fde(100%)가 같은 전체 SHA이며 health200·종료0입니다. 원본은 main203-deployment.json입니다.
- 다음은 TASK-051 처리 원본/새 head와 현재 CI·병합 직전 수동 검토 한 번, main 확인입니다. 실제 학원컴 초점/화면은 CDP 보류로 미확인입니다.

### (604) TASK-047 가게 설정의 숫자 표기 보존

- TASK-051 병합 뒤 검토7107032418의 낮음4번을 가게 설정 화면의 TASK-047 후속으로 처리합니다. 문의 끊김 시간·사장님 대기 시간·하루 AI 비용·결제 기다림 한도가 공통 numberOrText를 사용해 지수·16진수·소수 표기를 다른 정수로 저장하지 않습니다. 십진 정수와 기존 앞자리0 처리는 유지합니다.
- 모델4개와 실제 양식의 지수 입력/422 보존 시험으로5개 실패·33개 통과를 재현했습니다. 고친 뒤 관련38개·전체 웹29파일636개·타입 종료0·형식/lint386파일1,046ms·빌드891ms와 두 Worker가 통과했습니다. npm ci161개/11s입니다. 서버·DB·의존성은 main13a11ff와 같으며 부모의 새 빈 데이터베이스 서버2,221개 결과를 유지합니다.
- 실제 학원컴 숫자 입력 화면은 공통 CDP 문제로 미확인입니다. 모형 시험을 실제 브라우저 통과로 세지 않습니다. 기록604·README312를 예약하고 현재 head CI·코드 검토·병합 직전 수동 검토 한 번과 main 배포 대조를 이어갑니다.

- 검토7108175231의 낮음2건을 처리했습니다. 네 숫자 필드의 기존 최소/최대 표로 형식 오류·범위 오류에 정수와 허용 범위를 안내합니다. 서버로 원문을 보내는 동작은 유지하며 음수/소수/지수 입력도 구체적인 범위와 정수 안내를 받습니다. 실제 서버가 문자열에 돌려주는 bad_format으로 모형 응답을 고쳤습니다.
- 실제 bad_format에서1e2·-5·12.0의 안내3개 실패·26개 통과를 재현한 뒤 전체 웹31파일689개·타입 종료0·형식/lint395파일680ms·빌드1.13s와 두 Worker가 통과했습니다. 부모는 이력/조문 초점 main76d7dd9이며 서버·DB·의존성은 바뀌지 않았습니다. 기록604·README312를 유지합니다.
- main204는 전체 SHA/health200 뒤 실제 DB 점검이 최초15초 시간 초과였고 실패 작업만1회 재실행해 app45222781261 attempt2와 db45222781365가 성공했습니다. 학원컴 SSH도 재연결했고 원격 대조를 복구 중입니다. 다음은 새 head CI·검토 처리 연결·병합 직전 수동 검토 한 번과 main 확인입니다. 실제 숫자 화면은 CDP 보류로 미확인입니다.

- 결제 수단 maindce90b32f5d32cecd9f255bc28fda4befb87009d를 결합했습니다. 소스 충돌 없이 두 기록을 원래 번호 순서로 보존했고 전체 웹35파일771개·타입 종료0·형식/lint404파일669ms·빌드600ms와 두 Worker가 통과했습니다. 검토7108175231의 실제 bad_format/정수 범위 안내와 이전 가격표·운영규정·결제 수단의 회귀가 함께 통과합니다.
- 부모 main204의 첫 DB 점검 시간 초과는 실패 작업1회 재실행에서 성공했고 학원컴 앱/저장소의 CI 버전 일치·전체 SHA·health200·종료0도 확인했습니다. 부모 main206의 app/db/배포는 성공했으며 학원컴 전체 SHA 대조를 진행 중입니다. 실제 숫자 입력/두 폭 화면은 공통 CDP 보류로 미확인입니다. 다음은 현재 head CI·처리 원본/새 head 연결·병합 직전 수동 검토 한 번과 main 확인입니다.

### (605) TASK-054 채널 API와 일회성 키 경계

- SPEC-008·017과 SCR-041의10개 상태/41개 응답, API-030/031/032/079의 요청·예시·키 설정 계약을 읽고 클라이언트를 구현했습니다. no-store/같은 출처 조회와 취소 신호, 세 명령의 요청 키를 유지하며 연결/블록/사유/시각/키 버전/스킬 주소를 검증합니다. 연결 확인은 발신 시험 API를 부르지 않습니다.
- 첫 실행은 없는 모듈로 시험을 시작하지 못했고 구현 뒤63개가 통과했습니다. 상태를 문자열로 강제 변환하던 잘못된 성공 응답3개 실패를 재현한 뒤 명시적인 문자열 검사로 고쳤습니다. 조회는 계약 밖의 원문 키 필드를 버리고 생성/교체에서만43자 일회성 키를 돌려주며 헤더와 버전 일치를 확인합니다. 타입 종료0·형식/lint397파일547ms, npm ci 종료0입니다.
- 기록605·README313을 예약합니다. 부모 TASK-053의 저장된 원본9fe5870에서 시작했고 그 최신 main 결합을 이어 반영한 뒤 작업 브랜치에 보존합니다. 다음은 입력 양식·일회성 키/설정 값 복사·10분 연결 상태 조회와 실제 권한 경로의 실패 시험입니다. 학원컴 화면은 공통 CDP 문제로 보류하며 실제 발신·월렛·결제·실제 키 사용은 하지 않습니다.

- 채널 양식은 nullable ID/길이/형식과 G3의 바꾼 블록만 재적용하는 흐름을 구현했습니다. 설정 값/일회성 키 복사는 성공 안내·막힐 때 값 선택·잠금·복사 중 값 변경을 대조했습니다. API/양식/복사3파일70개·타입 종료0·형식/lint410파일1,503ms가 통과했습니다. 다음은 실제 채널 화면과 상태 조회/취소/권한 시험입니다.

- 부모 TASK-053 검토6건과 조문 초점 main을 결합한 API/양식/복사70개·타입 종료0·형식/lint410파일840ms가 통과했습니다. 생성 키는 응답 검증 뒤 현재 화면에서만 보이며 조회 데이터에서는 계약 밖 키 필드를 제거합니다. 복사 요청의 순번은 requestNumber로 이름을 분명히 했고 키 검사도 발견0건입니다.
- main204의 app45222781261은 첫 배포 뒤 합성 DB 점검의15초 시간 초과 후 실패 작업1회 재실행(2회차)에서 성공했습니다. db45222781365도 성공이며 학원컴 SSH를 한 번 재연결했습니다. 기존 OAuth의 유일한 계정을 선택하고 앱0268eb9a-c967-4396-8c8e-19b0443a8327·저장소4f1deca7-cf8e-483a-9d32-4c1a3707c13e(100%)가 CI가 배포한 실제 버전 및 전체 SHA76d7dd9038fa732640e2f756e9a1a6407f1b40b6와 같은지 대조했습니다. health200·종료0이며 원본은 main204-deployment.json입니다.
- TASK-053의 PR #206은 검토6건 처리와 수동 요청7108287036의 이번 사용 한도7108292870 처리7108328039 뒤 maindce90b32f5d32cecd9f255bc28fda4befb87009d로 squash했습니다. 해당 main CI·배포를 이어 확인하며 TASK-054는 부모 결합 뒤 실제 채널 화면/상태 조회 취소 시험을 진행합니다. 학원컴 실제 화면은 공통 CDP 문제로 계속 미확인입니다.

- 채널 상태·미설정 단계 안내·봇/공개/블록 ID·스킬 설정 값·일회성 키와 교체 정책·권한/실패 복구를 연결했습니다. 무료 MVP의 연결됨은 손님 안내를 다음 대화에 전하며 실제 발신 API를 만들거나 부르지 않습니다. 복사와 스킬 키는 현재 화면 상태에만 있고 브라우저 저장소/로그로 보내지 않습니다.
- 첫 화면 실행은 아직 없는 모듈로 시험을 시작하지 못했고 구현 뒤 화면/스타일2파일43개·타입 종료0·형식/lint413파일650ms가 통과했습니다. API/양식/복사3파일70개도 유지합니다. 학원컴 실제 페이지/계정 확인은 CDP 보류이며 아직 끝남/구현 완료로 세지 않습니다.
- 다음 단계는10분 연결 확인의 남은 시간/블록별 닿음·자동 상태 조회의 편집/명령/세션 취소·실제 OwnerArea 경로와41개 응답 대조입니다. 아직 리뷰 준비 PR을 열지 않고 이 체크리스트와 작업 브랜치에서 이어갑니다.

- PR #206의 maindce90b32f5d32cecd9f255bc28fda4befb87009d는 app45225239313(check137869833081·Windows137869833549·배포137872404598)과 db45225239349(PostgreSQL16.15 137869832298·17.11 137869831926)가 모두 성공했습니다. 학원컴 기존 OAuth/계정 일치·앱72da9524-5179-4cb6-87a1-8272cdc697ac·저장소70dee585-32b6-4105-a36d-a969581c484c(100%)의 같은 전체 SHA·health200·종료0을 확인했습니다. 원본은 main206-deployment.json입니다.
- TASK-054의 화면 초기 흐름/스타일43개와 API/양식/복사70개는 합성 로컬 검사입니다. 학원컴 실제 화면은 별도의 CDP 문제로 여전히 미확인입니다. 다음은 상태 조회 취소·남은 시간·블록별 닿음·실제 경로·41개 응답 대조이며 작업 브랜치에서 이어갑니다.

- 10분 남은 시간·블록별 닿음·실패 사유를 보입니다. 연결 확인 중5초마다 읽고 연결됨/실패·최종 기한 조회에서 멈춥니다. 숨긴 탭·세션 확인·편집 시작은 진행 중 읽기를 취소하고 늦은401은 무시합니다. 편집 중 수동 상태 조회도 잠가 입력을 보존합니다. 공통 조회 훅에는 명시적 cancel을 더했습니다.
- 실제 /owner/kakao-channel 경로를 사장님 영역에 연결했습니다. 확인됨/확인 중 가게가 화면을 열고 보류 가게는 채널을 읽기 전에 영업 신고로 갑니다. 충돌 뒤 바꾼 필드만 최신 revision에 적용해 새 키로 저장하고, 연결/키 버전이 바뀌면 이전 일회성 키를 지웁니다.
- 상태 조회5개·공통 취소1개·경로2개·편집 중 조회1개의 첫 실패를 각각 확인했습니다. 실제 경로의 제목은 공통 레이아웃의 main 밖에 있어 시험 선택 범위를 고친 뒤 화면/공통 훅/스타일3파일70개·타입 종료0·형식/lint가 통과했습니다. 합성 시험이며 실제 학원컴 화면은 CDP 보류입니다.
- 다음 단계는 계약41응답의 화면 처리 대조·새 빈 DB 전체 검사·main 결합·최종 회귀와 ready PR입니다. 아직 끝남/구현 완료로 세지 않습니다.

- API-030·031·032·079의 원본41응답과 추가 헤더 누락2개를 실제 화면에서 대조하는44개 시험이 통과했습니다. 조회/저장/연결 확인/키 교체의 성공·권한·미설정·필드 오류·충돌·진행 중 재전송·같은 키/새 키 재시도를 확인합니다.
- 검사 보강에서 처리 중 안내3개·편집 중 키 교체 잠금·블록 누락 표시/초점의5개 실패를 재현했습니다. 처리 중 안내·키 교체 잠금·빈 블록의 필수 오류를 고쳤습니다. 편집을 켜는 다음 렌더에서 입력이 활성화될 때까지 초점을 보류하고, 비동기 초점은 시험에서도 기다립니다. 확인 시각/선점 종료 시각도 API 값을 보입니다.
- 학원컴 Aside CLI의 현재 기본 host는local이고 연결된 프로필1개가 있습니다. 도움말/프로필 조회는 성공했지만 기존 CDP 장애가 풀린 것은 확인하지 못했습니다. 같은 페이지 제어를 다시 시도하지 않고 브라우저 통과도 세지 않습니다.
- 다음 단계는 깨끗한 커밋의 새 빈 DB 전체 시험·빌드·최종 기록·현재 main 차이와 ready PR입니다. 실제 화면/페이지 검사·실제 계정/카카오 결과는 미확인입니다.

- 깨끗한 원본a73bde2의 새 빈 데이터베이스에34개 마이그레이션을 적용한 전체 npm test와 빌드가 종료0입니다. 서버104파일2,221개·웹40파일912개·타입 종료0·형식/lint414파일·빌드687ms와 두 Worker가 통과했습니다. 코드는 원본41응답+추가2응답, 명령 재시도와 충돌, 상태 조회/취소/세션, 실제 OwnerArea 경로를 포함합니다.
- TASK-184는 첫 AI 고지를 TASK-064에 연결하는 코드가 남아 있고 TASK-045와049~053은 기록한 실제 환경/화면 확인이 남습니다. 새 고르기 계산은 끝남32개·구현 완료20개·시작 가능36개입니다. 바깥 원인으로 보류한172·027과 이미 코드가 있는184·045·049~054를 구분하고 다음 새 화면TASK-055를 준비합니다.
- 다음은 현재 head CI·코드/보안 검토·발견 처리·병합 직전 수동 검토 한 번과 main CI/배포/학원컴 원격 확인입니다. 실제 화면10상태×두 폭·page-check·44px·실제 사장님/카카오 연결은 공통 Aside CLI CDP 보류로 미확인이고 finished/구현 완료를 표시하지 않습니다.

- main207의 반복 편집 대기/두 저장 실패 처리·카드 링크 안내를 결합했습니다. 소스 충돌 없이 합쳤고 기록605·606/README313·314를 원래 번호 순서로 보존했습니다. 전체 웹40파일922개·타입 종료0·형식/lint414파일·빌드735ms와 두 Worker가 통과했습니다. 서버·DB·의존성은 새 빈 DB 원본a73bde2와 차이가 없습니다.
- 부모 PR #207은 코드/보안 검토7109274932의3건 처리7109508912와 수동 요청7109582398의 이번 사용 한도7109587691 처리7109605880 뒤 maind284a148e2100b1f0da76701935cc89020811da6로 squash했습니다. 이 main의 CI·배포·학원컴 원격 대조를 이어 확인합니다. 다음은 채널 현재 head CI·검토와 발견 처리·수동 검토 한 번입니다. 실제 학원컴 화면은 CDP 보류입니다.

- Claude 검토7109668948의 중간2건·낮음7건을 처리했습니다. 충돌 중 채널/키 변경은 잠그고 최신 조회 재시도를 둡니다. 키 교체의 충돌은 양식 재적용을 요구하지 않고, 편집 취소는 원래 값과 상태 조회로 돌아갑니다. 기한 뒤 pending은2초/5초/10초 뒤에 더 읽고 취소된 조회는 완료 횟수에 넣지 않습니다. 정해진 조회 뒤에도 아직 확인 중이면 수동 조회를 안내하고0초에서는 초침을 멈춥니다.
- 상태 조회가 명령의 성공/실패·재시도를 지우지 않게 했습니다. 공개 ID만 바꾼 저장은 일반 저장 안내, 실제 블록 변경은 재확인 안내를 씁니다. API-032 unchanged는 원본 문구를 씁니다. 확인 시작 때 시각도 갱신합니다. 재발신은 무료 MVP의 기존 결정대로 TASK-167로 미루고 수락표와 화면 생성 원본을 고쳤습니다. 취소 동작도 화면 원본에 추가해 SCR-041.md만 생성기로 바뀌었습니다.
- 첫 관련12개 실패·66개 통과를 재현했고 API 필수 null/실제 블록 변경/React 타이머 진행의 시험 자료를 맞춘 뒤 전체 웹40파일932개·타입 종료0·빌드823ms와 두 Worker가 통과했습니다. 서버·DB·의존성은 새 빈 DB 서버2,221개 원본과 같습니다.
- 설계 검사 스크립트의09 검사기가 로컬 Chromium을 실행하는 점을 뒤늦게 확인했습니다. 확인 때는 그 실행이 이미 끝나 중단할 프로세스가0개였습니다. 그 결과는 학원컴 Aside/실제 앱 화면 통과로 세지 않습니다. stage-checks.sh에 --no-browser를 추가해 정적 설계 검사는 실행하되 브라우저 page-check는 미확인으로 남깁니다. 같은 스크립트의 --no-api --no-browser 실행은 종료0이며 PRD/플로우/SPEC/ERD/사이트맵/화면/WBS 오류0, 목업은14개 중 정적13개 통과·page-check1개 미확인입니다(API 원본은 바뀌지 않았습니다). 이후 브라우저는 학원컴 Aside CLI만 씁니다.
- 다음은 설계 정적 검사 결과·현재 head CI·검토 처리 연결·병합 직전 수동 검토 한 번과 main 확인입니다. 실제 학원컴10상태×두 폭/page-check/44px·계정·카카오/W7은 CDP 보류로 미확인입니다.

### (606) TASK-053 반복 편집의429 대기와 카드 링크 길이

- PR #206의 병합 뒤 재검토7108614474에서 남은 낮음2건을 처리합니다. 가게 설정·등록·신고증/사업자 변경 양식의 버튼과 제출 함수가 각 명령의429 대기를 함께 확인합니다. 입력은 바꿀 수 있고 옛 요청은 자동으로 다시 보내지 않으며, 반복 입력 때 이미 비운 명령의 상태·실패 객체·타이머를 유지합니다.
- 카드 링크는2048 코드 포인트 한도를 길이 초과로 안내하고 입력 도움말에도 적습니다. 브라우저 입력 상한4096 UTF-16 단위는2048개의 보조 평면 문자도 허용합니다. URL 검사의 문자 배열을 한 번만 만듭니다.
- 첫 관련 시험은8개 실패·149개 통과였고 수정 후6파일157개·전체 웹35파일779개가 통과했습니다. npm ci161개/13s·타입 종료0·형식/lint404파일666ms·빌드와 두 Worker도 통과했습니다. 서버·마이그레이션·의존성은 maine7bf383과 같고 부모의 새 빈 DB 서버2,221개 결과를 유지합니다. 기록606·README314를 예약합니다.
- main205의 app45227927673와 db45227927738, check/Windows/배포/PostgreSQL16.15·17.11이 모두 성공했습니다. 학원컴 기존 OAuth/계정 일치·앱d39aac5e-3e81-47ef-b48a-824ee8c2f461·저장소4d9e016f-97c7-47a1-88d7-eaf1cafde6a7(100%)가 전체 SHAe7bf38367b17e37fc5fd5965a6105715acf61ca6와 일치하고 health200·종료0입니다. main205-deployment.json에 보존합니다.
- 다음은 현재 head CI·코드/보안 검토와 발견 처리·병합 직전 수동 검토 한 번·main 배포 확인입니다. 실제 학원컴 화면은 기존 Aside CLI CDP 보류로 미확인이며 끝남·구현 완료 표시는 바꾸지 않습니다.

- Claude 검토7109274932는 앞 재검토2건의 반영을 확인했고 낮음3건·보안0건입니다. 신고증429가 남은 동안 사업자 변경401/409가 가려지는 오류를 명령별 처리 기록으로 고쳤습니다. 두 실패를 각각 처리해 로그인 이동·대상 재조회·사진 폐기·필드 초점이 다른 실패에 가리지 않습니다.
- 요청 경로의 복수형과 폼 밖 오류 안내 영역을 시험에 맞춘 뒤 이전 코드에서 로그인 콜백0회/재조회 없음의2개 실패를 재현했습니다. 고친 뒤 전체 웹35파일781개·타입 종료0·형식/lint·빌드1.04s와 두 Worker가 통과했습니다.
- 긴 카드 링크의 실제 필드 사유도 시험에 더했습니다. CARD_PAYMENT_URL_MAX와 사유 함수 하나로 API 검증/양식/도움말/HTML 상한을 맞추고 입력 한 번에 문자 배열을 한 번만 만듭니다. 서버·DB·의존성은 바꾸지 않았습니다. 다음은 처리 원본/새 head를 리뷰에 연결하고 현재 CI·병합 직전 수동 검토 한 번과 main을 확인합니다.

### (607) TASK-055 예약 링크와 준비 조건 화면

- SCR-043의6상태·API-037의5응답·SPEC-010과09 목업을 읽고 예약 링크 조회 모듈을 시작했습니다. 고정 경로/no-store/같은 출처 자격 증명/취소 신호, 발급됨/조건 미충족의 일관성,7조건·추천1개 열거값/중복/개수, HTTPS 주소·사용자 정보·공백/제어 문자·2048자 한도·발급 시각, 계약 밖 내부 필드 제거를 검사합니다.
- 첫 실행은 모듈 부재로 시험0개였고 구현 뒤 API23개·타입 종료0·형식/lint가 통과했습니다. 기록607·README315를 예약합니다. TASK-054에서 만든 공통 값 복사/조회 수명을 재사용하되055의 화면은 아직 만들지 않았습니다.
- 다음 단계는 채널 화면 부모 결합,7조건 목록·링크 복사/새 탭·새로 고침·세션/늦은 응답·실제 경로의 실패 시험입니다. 학원컴 실제 화면은 기존 Aside CLI CDP 보류이며 끝남/구현 완료를 표시하지 않습니다.

- 예약 링크 발급 주소/복사·새 탭·발급 시각/조회 기준,7개 준비 조건과 마침/설정 경로,픽업 장소 권유,새로 고침과 기존 값 유지,권한/세션 확인/늦은401 무시,뒤로 돌아온 페이지 재조회와 실제 OwnerArea 경로를 구현했습니다. 새 탭은 HTTPS 검증한 응답 주소에만 연결하고 noopener/noreferrer를 씁니다. 복사는 TASK-054의 공통 컴포넌트를 재사용합니다.
- 첫 화면 실행은 모듈 부재였고 초기 실제 경로2개 실패·72개 통과를 재현한 뒤 경로를 연결했습니다. 화면14개·API23개·스타일37개,합계3파일74개·타입 종료0·형식/lint419파일이 통과했습니다. 링크 열기/복사 버튼은09의48px 토큰을 씁니다. 실제 폭/누르기 영역은 브라우저 확인 전입니다.
- 부모 TASK-054의 ready PR #208을 기반으로 작업 브랜치에서 이어갑니다. 다음은 main207/최신 채널 부모 결합·새 빈 DB 전체·빌드·5응답/6상태 대조와 ready PR입니다. 실제 학원컴 화면은 기존 Aside CLI CDP 보류이며 finished/구현 완료로 세지 않습니다.

- 부모 main207의 app45234419727·db45234419709와 check/Windows/PostgreSQL16.15·17.11/배포가 성공했습니다. 학원컴 기존 OAuth/계정 일치·앱d714b89a-f1bc-4f45-a14b-aed72b0e8436·저장소0c0a196b-903e-4d7a-a15a-f287c2cb5c31(100%)의 전체 SHAd284a148e2100b1f0da76701935cc89020811da6·health200·종료0을 main207-deployment.json에 보존했습니다.
- TASK-055 새 빈 DB 전체의 첫 실행은2220개 통과·1개 실패입니다. 기존 kakao-runtime-grants.test.ts의 제한 역할/모델 검증 거절(false) 시험이5000ms 제한에 걸렸습니다. 서버 파일은 부모 전체2,221개 통과 원본과 같으며 제한/시험 코드를 바꾸지 않았습니다. 같은 파일 단독9개는4.02s에 통과했습니다. 원인은 확정하지 않았고 같은 전체 검사를 새 빈 DB에서 한 번 재검사합니다. 첫 실패를 통과로 쓰지 않습니다.
- 다음은 전체 재검사 결과와 채널 PR #208의 검토 수정 결합입니다. 실제 화면은 공통 Aside CLI CDP 보류입니다.

- 새 빈 DB 전체 재검사는34개 마이그레이션·서버104파일2,221개·웹42파일961개·빌드1.29s와 두 Worker가 모두 종료0입니다. 원본e4028b8이며 첫5000ms 실패는 보존합니다. 제한 시간/서버 코드를 바꾸지 않고 같은 파일 단독9개 통과 뒤 전체를 한 번 재검사한 결과입니다.
- 채널 검토9건의 원본c2621d2를 결합한 최종 웹42파일971개·타입 종료0·형식/lint419파일·빌드644ms와 두 Worker도 통과했습니다. 서버·DB·의존성은 새 전체 원본과 같습니다. API-037의5응답·SCR-043의6상태를 수락 대조에 적었습니다.
- 다음 단계는 부모 PR #208의 squash/main 결합 뒤055만의 ready PR·CI/검토·병합 직전 수동 검토 한 번과 main 배포입니다. 부모 검토의 추가 수정/정적 검사 옵션을 보존합니다. 실제6상태×360·1280/page-check/48px·실제 사장님은 공통 Aside CLI CDP 보류로 미확인이고 끝남/구현 완료 표시는 바꾸지 않습니다.

- PR #208은 검토9건 처리7110005413·추가 검사 옵션의 재리뷰 요청7110006006과 수동 요청7110111383의 이번 사용 한도7110117077 처리7110141011 뒤 maina5a70cde54e352032b6e565534825c519cc1a13d로 squash했습니다. 이 main CI·배포/학원컴 대조는 진행 중입니다.
- main208의 전체 treedf7746a08520fbe4147deec791586ec59fc4561e가 이미 결합한 실제 부모c2621d2의 전체 tree와 같고 그 부모가055 HEAD의 조상임을 검증했습니다. 새 main을 추가 부모로 기록해 소스/기록을 바꾸지 않고 결합했습니다. 최종 웹971개·타입/빌드644ms와 새 빈 DB 서버2,221개 결과를 유지합니다. 다음은055만의 ready PR·CI·코드/보안 검토입니다.

- 검토7110397802의 낮음7건·보안0건을 처리했습니다. 발급 주소는 백그라운드 조회 중 복사/열기를 유지하고, bfcache는 deferRead로 재확인 필요만 표시해 OwnerArea 세션 확인 뒤 한 번 읽습니다. 복원 중 visibilitychange도 같은 표시로 합칩니다. 영업 신고의 현재 상태를 여는 링크와 픽업 링크의 비활성/탭 순서를 더했습니다.
- 두 HTTPS 검사는 공통 함수로 모으고 기존 계약 차이를 옵션으로 유지합니다(예약은 사용자 정보 거부,카드는 소문자 https 접두 요구). 경로/화면/ownerDestination 적용 여부를 표 하나로 모아 중첩 선택을 없앴습니다. 조회 기준은 서울 시:분 전용 형식을 씁니다.
- 첫 관련6개 실패·26개 통과 뒤 실제 OwnerArea의 바뀐 main을 기다리도록 시험 선택 범위를 고쳤습니다. 이전 코드에서 세션 확인 전 요청2회/기대1회의 중복도 별도로 재현했습니다. 수정 후 전체 웹44파일981개·타입 종료0·형식/lint422파일·빌드753ms와 두 Worker가 통과했습니다. 서버·DB·의존성은 새 빈 DB 서버2,221개 원본과 같습니다.
- 다음은 처리 원본/새 head 연결·현재 CI·병합 직전 수동 검토 한 번과 main 확인입니다. 기록607·README315를 유지합니다. 실제 학원컴6상태×두 폭/page-check·48px와 계정은 공통 Aside CLI CDP 보류입니다. finished/구현 완료 표시는 바꾸지 않습니다.

### (608) TASK-056 영업 캘린더 날짜 조회와 저장 화면

- SCR-032의10상태·원본17응답·API-028/029의 추가 예시(자리보다 적은 개수 확인/요청 키 누락)를 읽고 날짜 조회/저장 API를 구현했습니다. 최초 모듈 부재 뒤37개·타입 종료0·형식/lint421파일이 통과했습니다. 그레고리력 날짜/범위1~62일·빠짐/중복/순서,하루 최대 개수/잡힌 자리/남은 자리의 한도,참거짓/버전과 필수 속성,요청 날짜와 저장 결과의 일치,취소/no-store/같은 출처 자격 증명과 키를 확인합니다.
- URL 경로에는 검증한 날짜만 넣고 잘못된 경로는 보내지 않습니다. 조회의 필터는 URLSearchParams로 인코딩하며 계약 밖 내부 필드는 DTO에 복사하지 않습니다. 아직 달력 UI는 만들지 않았습니다. 부모 TASK-055의 완성 소스를 결합했고 PR #209는 CI/검토 중입니다. 기록608·README316을 예약합니다.
- 다음 단계는 월/날짜 모델,44px 달력과 패널,지난 날짜 읽기 전용,저장/확인/충돌·세션·실제 경로의 실패 시험입니다. 실제 학원컴 화면은 공통 Aside CLI CDP 보류이며 구현 완료/finished로 세지 않습니다.

- 두 달 기간/연도 이동/윤년·일요일 시작42칸·서울 자정,그날 양식의 바뀐 필드/빈 개수 null/원문 숫자 보존/G3 재적용을8개로 확인했습니다. API37개와 합계2파일45개·타입 종료0·형식/lint423파일656ms가 통과했습니다. 아직 실제 달력 화면은 구현 전이며 다음은44px 달력/패널·확인/충돌/세션 시험입니다.
- main208의 app45238228330·db45238228362와 check/Windows/PostgreSQL16.15·17.11/배포가 성공했습니다. 학원컴 기존 OAuth/계정 일치·앱51f82fee-03ab-4dc5-a7db-a4893e9c142e·저장소fbb2c00c-1cc8-469a-9f3e-eb7023860c42(100%)의 전체 SHAa5a70cde54e352032b6e565534825c519cc1a13d·health200·종료0을 main208-deployment.json에 보존합니다. 실제 페이지 제어는 별도 CDP 보류입니다.
- PR #208의 병합 뒤 검토7110341332는 낮음4건·보안0건입니다. 별도 TASK-054 후속에서 오류 배너 재조회 경로·저장 뒤 재확인 안내·오래된 확인 안내·새 기한 창의 늦음 배너를 처리합니다. 기존 G2의 같은 키 복원 계약과 검토3(가)의 자동 reset 제안은 대조해 처리 이유를 남깁니다. 후속 기록609·README317을 예약하고 이 작업608·316과 구분합니다. PR #209는 코드/보안 검토 중입니다.

- 두 달/한 달 배치와44px 날짜 버튼,날짜 패널/지난 날짜 잠금,바뀐 필드만 저장·동일값,세션과확인/취소/충돌 재적용을 구현했습니다. API의 관련 주문 conflicts를 공통 오류/명령/확인 창으로 전달하고 날짜·한도·주문번호/상태/픽업 시각을 검증해 계약 밖 정보는 버립니다. 원본19응답(08의17행에 추가 예시2개)을 화면에서 대조하다 PATCH not_set의 설정하기 경로 부재1개 실패·18개 통과를 재현해 고쳤습니다. 전체 웹49파일1,080개·타입 종료0·형식/lint433파일689ms·빌드654ms와 두 Worker가 통과했습니다. 아직 실제 학원컴의10상태×두 폭/page-check는 CDP 보류입니다. 다음은 실제 OwnerArea 세션 복귀·연속 제출/처리 중 재전송·새 빈 DB 전체 검사와 ready PR입니다.
- main209의 실제 원격 앱 SHA/활성100%·health200은 배포 workflow의 Wrangler 조회로 확인했습니다. 학원컴 whoami45초 시간 초과2회는 별도 보류이며 스토리지 활성 태그의 학원컴 재조회는 미확인입니다.

- 실제 OwnerArea의 bfcache 복귀는 세션 재확인 전 조회0회/회복 뒤1회이며 날짜 초안을 보존합니다. 처리 중1초 뒤 같은 본문/키,키 재사용 오류의 새 키,충돌 조회 실패 뒤 재적용,연속 제출 방지를 더했습니다. 실제 실패는 보내는 중 링크의 비활성 안내1건이며 바로 고쳤습니다. happy-dom의 PageTransitionEvent 생성자가 persisted를 반영하지 않는 시험은 기존처럼 Event에 persisted를 명시해 바로잡았습니다. 첫 로딩도42칸 자리를 유지합니다. main210 결합과 수정 후49파일1,096개·타입/형식/lint/빌드가 통과했습니다. 다음은 새 빈 DB 전체 검사와 준비된 PR의CI/코드·보안 검토입니다.

- 원본2275e7962efad800f5c95338103eae2b32bc65b2의 새 빈 DB에34개 마이그레이션을 적용하고 npm test/build를 끝냈습니다. 서버104파일2,221개·웹49파일1,096개와 빌드1.70초·앱 Worker5246.30KiB/gzip963.16·저장소20.87KiB/gzip6.47이 모두 종료0입니다. npm ci161개11초·형식/lint433파일657ms·타입 종료0·WBS18/0·키1026/0·용어0·diff0을 확인했습니다. 이제 TASK-056만의 ready PR을 열고 CI/코드·보안 검토,병합 직전 수동 검토1회,main CI/배포/원격 앱 태그 확인까지 계속합니다. 실제 학원컴10상태×두 폭/page-check/44px와계정은 CDP 보류입니다. 끝남/구현 완료 수는 바꾸지 않습니다.

- 검토7111909199의 중간1/낮음5·보안0건을 처리했습니다. 1: 같은 pathname의 query 이동은 OwnerArea를 보존한 채 인증을 다시 확인하고,month는 URL만 기준으로 읽습니다. MemoryRouter의 실제 월 이동/뒤로/앞으로와 기간 밖 날짜로 갔다 돌아오기에서도 초안을 보존하며 인증 전 날짜 요청은 막습니다. 2: 같은 revision 또는 초안 없는 재조회는 조용히 새 값으로 바꾸고 같은 버전의 초안은 남깁니다. 3: 충돌 패널에 휴무/마감/잡힌 자리/남은 자리를 더했습니다. 4: 휴무나 여러 필드를 함께 바꾸면 저장했어요로 안내하고 다시 받는다고 알리지 않습니다. 5: 두 중복 정수 검사를 공통 isApiInteger로 옮겼습니다. 6: 현재 OpenAPI Problem의 conflicts가 달력 전용 계약이므로 검증한 타입을 유지합니다. 다른 종류의 확인 자료가 생기면 공통 전달과 각 화면 파싱을 분리하는 제안을 다시 대조합니다. 지금 unknown 전달로 바꾸면 기존의 계약 밖 응답 거부를 약하게 하므로 일반화하지 않습니다.
- 첫 제품 오류6개 실패·26개 통과 뒤 고쳤으며,수정 후 전체 웹49파일1,102개·타입 종료0·형식/lint433파일906ms·빌드665ms와 두 Worker가 통과했습니다. 서버/DB/의존성은 새 빈 DB 서버2,221개 원본과 같습니다. 기존 bfcache 시험은 같은 버전이면 재적용 버튼 없이 편집을 계속하는 새 동작에 맞췄고,강제409 뒤 조회는 실제처럼 새 revision을 돌려주도록 합성 자료를 고쳤습니다. 단독 stub의 월 이동은 이동 경로만 대조하고 실제 조회/인증/상태 보존은 OwnerArea 시험이 맡습니다. 다음은 처리 원본/새 head 연결·현재 CI·병합 직전 수동 검토 한 번입니다.

### (609) TASK-054 재조회·재확인·기한 안내 후속

- PR #208의 병합 뒤 검토7110341332(낮음4건·보안0건)를 처리합니다. 저장 실패 배너의 다시 불러오기에서도 명령 종류를 보존해 내 변경 재적용을 제공합니다. failed/기한 지난 pending 저장이 확인을 초기화하면 블록 변경과 별도로 다시 확인하라고 안내합니다. 확인 결과가 linked/failed로 바뀌면 지난 시작 안내를 지우고 늦음 배너는 현재 연결·기한 key와 같을 때만 보입니다.
- 검토3(가)의 자동 reset은 하지 않습니다. 기존 G2와 공통 명령의500 동일 키 재시도 계약을 유지해 본문/키를 polling의 revision으로 자동 대체하지 않습니다. 이미 끝난 결과를 같은 키로 복원할 수 있어야 하며, 실제 버전 충돌은 기존 G3로 처리합니다. 추가 충돌 왕복 가능성을 감수하는 이유를 PR에도 적습니다. 같은 본문/키를 보존하는 상호작용 시험으로 확인합니다.
- 첫 관련6개 실패·35개 통과를 확인했고 다시 불러오기 버튼의 공통 이름을 맞춘 뒤 내 변경 재적용이 없는 실패도 별도로 재현했습니다. 수정 후 전체 웹40파일939개·타입 종료0·형식/lint414파일·빌드824ms와 두 Worker가 통과했습니다. 서버·DB·의존성은 main208의 새 빈 DB 서버2,221개 원본과 같습니다. 실제 학원컴 화면은 CDP 보류입니다.
- 기록609·README317을 예약합니다. 열린 TASK-055의607·315와 작업 브랜치 TASK-056의608·316을 보존합니다. 다음은 현재 head CI·코드/보안 검토·발견 처리·병합 직전 수동 검토 한 번과 main 배포입니다.

- 검토7110927245의 낮음3건·보안0건을 처리했습니다. 저장 뒤 재확인은 브라우저 시계/블록 수 대신 failed 상태 또는 서버 checkStartedAt의 초기화로 판단합니다. 두 번째 오류 배너 재조회 때 지난 latest를 비워 이전 값 재적용을 막습니다. 처음 합성 공개 ID에 허용되지 않는 밑줄을 넣어 생긴 실패는 고친 뒤,실제 시계 오차/이전 값 노출3개 실패·1개 통과를 확인했습니다. 수정 후 전체 웹943개,main209 결합 뒤44파일992개·타입 종료0·빌드686ms와 두 Worker가 통과했습니다. 같은 키 복원은 그대로 유지하며 검토도 처리 이유에 동의했습니다. 다음은 새 head CI·병합 직전 수동 검토1회와 main 배포 대조입니다.

### (610). TASK-057 영업 캘린더 설정 화면

- SCR-033/API-026·027의16응답 행과 추가 예시2개를 읽고 설정 조회/저장 API를 구현했습니다. 첫 의존성 설치가 ENOSPC로 실패해 완료한 TASK-054 원본/후속과 TASK-055의 생성·미추적 node_modules만 정리한 뒤161개를16초에 설치했습니다. 소스는 보존했습니다. 모듈 부재 뒤40개가 통과했고,배열 outcome을 문자열로 바꿔 잘못 성공으로 받아들이는 실패1개·통과40개를 추가 재현해 타입 검사로 고쳤습니다. 최종41개·타입 종료0·형식/lint435파일이 통과했습니다. 요일/중복/숫자 한도·시각/답하는 시간 순서·버전과 저장 후 관련 주문,읽기 취소/no-store/같은 출처/요청 키를 확인하고 계약 밖 필드는 버립니다.
- 다음은 양식 모델·실제 화면과 세션/확인/충돌 시험입니다. 작업056 부모의 코드와 WIP 기록을 보존하며 이 작업의 준비 전에는 PR을 열지 않습니다.

- 설정 양식의 기본 시각·전체8필드/revision·숫자 원문 보존·시각 순서/안내 범위·같은 값·내 변경만 재적용을18개로 확인했습니다. API41개와 합계2파일59개·타입 종료0·형식/lint437파일이 통과했습니다. 숫자005와5,요일 순서만 다른 것은 같은 값이며,G3에서는 다른 기기의 개수/답하는 시간을 남기고 내 시각/요일 변경만 옮깁니다. 초기 답하는 시간09:00~21:00·안내18:00·후기11:00은 SCR-033의 기본값입니다. 처음 입력의 하루5개·2일 전18:00은 API예시 값으로 미리 채우며 사장님이 확인 후 저장하기 전에는 보내지 않습니다.
- 다음은 설정 화면의10상태/16응답 행과 추가2예시,세션/확인/관련 주문 더 보기 시험입니다. 부모 TASK-056은 PR #211에서 CI/검토 중입니다.

- SCR-033의10상태·원본16응답 행과 추가2예시를 화면 부품에서 대조했습니다. 요일7개 토글/44px,개수·주문 마감·답하는 시간·전날/후기 시각,처음 기본값,확인/취소와 관련 주문,10일씩 더 보기,다른 기기의 필드를 남기는 재적용과 실패한 최신 조회의 복구를 구현했습니다. 실제 OwnerArea 세션 복귀/신고 보류 경로,첫 입력 오류 초점,연속 제출과1초 뒤 같은 키 재전송/500 재시도/키 재사용 오류의 새 키도 확인했습니다. 처음 응답 시험3건은 전역 화면 읽기 알림까지 함께 찾은 중복 선택이라 main 안으로 범위를 고쳤습니다. 첫 전체에서 기존 운영규정 조문 초점1건이 실패했고 소스 수정 없이 개별1개와 전체 재실행을 통과했습니다. 원인은 확정하지 않습니다. 그때 전체 웹53파일1,195개·타입 종료0·형식/lint441파일660ms·빌드679ms와 두 Worker가 통과했습니다.
- 부모 TASK-056 검토 수정 결합,같은 revision 재조회/최신 전체 값 대조와 새 빈 DB 전체 검사는 완료했습니다. 현재 상태는 아래 검토 후 결과를 따릅니다. 실제 화면/finished/구현 완료 표시는 바꾸지 않습니다.

- TASK-056의 검토 수정을 결합하고 설정 화면에도 같은 revision/초안 없는 재조회는 조용히 반영하도록 고쳤습니다. 처음 정하는 중에는404 재조회가 초안을 지우지 않고,다른 기기가 먼저 설정했다면 최신 값과 내 초안을 대조합니다. 이 다섯 경로를 실패5개로 먼저 재현했습니다. 최신 요일·주문 마감·답하는 시간·전날/후기 시각을 모두 표시하고 공통 정수 검사도 재사용합니다. 강제409 합성 자료는 새 revision을 돌려주며 같은 버전의 bfcache는 재적용 버튼 없이 편집을 계속합니다. 수정 후 전체 웹53파일1,206개·타입 종료0·형식/lint441파일687ms·빌드644ms와 두 Worker가 통과했습니다.
- 다음은 canonical main211 결합·새 빈 DB 전체 검사·ready PR과 검토/병합입니다. 실제 화면은 CDP 보류로 남깁니다.

- 원본687763efadd36b5c1f26d48d177e783ff9da3881의 새 빈 DB에34개 마이그레이션을 적용해 서버104파일2,221개·웹53파일1,206개와 빌드를 모두 종료0으로 확인했습니다. npm ci161개16초·형식/lint·타입·WBS18/0·키·용어·diff도 확인하고 ready PR로 이어갑니다. 이 검사 뒤의 변경은 기록뿐입니다. main211의 전체 tree2dfe6dde31bdbeb73e1ca5b639164b3da429bb8a가 결합한 부모14512bf의 tree와 같고 그 부모가 현재 HEAD의 조상임을 검증해 main을 추가 부모로 결합했습니다.
- main211의 실제 Wrangler 원격 앱 전체SHA/활성100%·health200을 기록했습니다. 다음은 ready PR·CI/코드·보안 검토·병합 직전 수동 검토1회·main 확인입니다. 실제10상태×두 폭/page-check/44px는 CDP 보류입니다.

- 검토7112645315의 중간1/낮음6·보안0건을 처리했습니다. 1: 요일은 latest에 내가 더한 요일을 넣고 내가 뺀 요일만 제거해 다른 기기의 요일을 보존합니다. 추가/제거/다른 기기의 제거와 실제409 재저장을 확인했습니다. 2·3: 유효한 재조회에서 처음 설정/지난 변경 없음 안내를 지웁니다. 4: 안내 창 밖은 outside_window,요일7개 초과는 too_many로 서버와 맞췄습니다. 5·6: CalendarConflictList와 한국 날짜 형식을 두 달력 화면이 공유하며,마지막 더 보기로 버튼이 없어져도 새 첫 날짜 제목으로 초점을 옮겨 대화상자 안에 남습니다. 7: 수락 조건 문서를 현재 상태 하나로 다시 쓰고 README/고친 기록의 낡은 다음 단계도 완료 상태로 맞췄습니다.
- 처음 제품 오류9개 실패·41개 통과를 재현했고,수정 후 관련13파일309개와 전체 웹53파일1,215개·타입 종료0·형식/lint443파일617ms·빌드605ms와 두 Worker가 통과했습니다. 서버/DB/의존성은 새 빈 DB 서버2,221개 원본과 같습니다. PR #213의 TASK-051 초점 복구를 main에 합친 뒤 그 main을 결합해 현재 CI를 다시 확인하며,병합 직전 수동 검토는 아직 요청하지 않았습니다.

- PR #213의 main299736af5e43b67d49bdc05d32d1ddc3635b53fd를 결합했습니다. 기록4곳의 충돌만 원본 번호318/610과320/612를 보존해 합쳤고,운영규정 초점의 단일 요청/같은 commit 제한 재시도와 회귀 시험을 그대로 받았습니다. 결합 뒤 전체 웹53파일1,219개·타입 종료0·형식/lint443파일·빌드1.13초/두 Worker가 통과했습니다. 설정 발견7건 외 제품 변경은 main 결합뿐입니다. main213 CI/배포 대조와 새 head CI·병합 직전 수동 검토 한 번을 계속합니다. 실제 학원컴 확인은 미확인입니다.

- main213의 app45262617399/db45262617409와 check138001102230·Windows138001101808·PostgreSQL16.15 138001101998/17.11 138001103022·배포138003718912가 모두 성공했습니다. 배포 workflow의 실제 Wrangler 조회가 전체 SHA299736af5e43b67d49bdc05d32d1ddc3635b53fd·앱f2487fba-825c-4cf2-a97a-cfe2bc50ed35 활성100%·health200을 확인했습니다(main213-deployment.json). 학원컴 whoami는 기존 두 번 시간 초과 뒤 다시 실행하지 않았으며 저장소 활성 태그의 학원컴 재조회는 미확인입니다.

### (611) TASK-058 영업 신고 확인 목록 화면

- 실제 검토7113641360의 중간1/낮음7·보안0건을 처리했습니다. 같은 pathname의 탭/상태 이동은 목록만 갱신하고 운영자 인증/레이아웃을 다시 만들지 않아 select 초점을 보존합니다. 다른 화면 진입과 bfcache는 인증 재확인 전 기록을 숨깁니다. 새로 고침/로그아웃 실패는 이미 읽은 행을 보존하고 로그아웃 중에는 액션을 잠급니다. 로그아웃은 전용 제목과 공통 오류/추적ID/재시도를 함께 보여 주며,422는 현재 탭/상태에서 커서만 지웁니다. 조회 중 탭 이동은 이전 요청을 취소하고 select는 히스토리를 대체합니다. 긴 값은 title로 전체를 제공하며 사업자 구조/커서 패턴을 공유하되 목록의 길이 상한은 보존합니다.
- 이전 코드에서 제품 실패6개·통과27개를 확인한 뒤 관련 API/URL/UI3파일80개가 통과했습니다. 최초 인증/401/bfcache의 기록 숨김과 추가 읽기 재시도/개인정보 DTO 경계도 함께 통과했습니다. 다음은 main212 결합 뒤 전체 웹·타입/lint/빌드·현재 head CI와 수동 검토 한 번입니다. 실제 학원컴6상태×두 폭/page-check·키보드는 CDP 보류로 미확인입니다.

- TASK-058 검토8건 처리 뒤 maineb6b4f63c1079700d19ed8688825411eed90634a를 결합했습니다. 기록4곳은 원본 번호319/611을 보존했고,스타일 등록 충돌은 설정·관련 주문·운영자 목록 CSS를 모두 남겼습니다. 소스 결합 뒤 전체 웹56파일1,301개·타입 종료0·형식/lint450파일740ms·빌드721ms와 두 Worker가 통과했습니다. 서버/DB/의존성은 새 빈 DB34개 마이그레이션·서버2,221개를 확인한 원본과 같습니다. 실제6상태×두 폭/page-check/44px는 학원컴 Aside CLI CDP 보류입니다. 다음은 현재 head CI·검토 대응 댓글과 수동 검토 한 번·main 배포 대조입니다.

- main212의 app45264966847/db45264966552와 모든 check/Windows/DB·배포138011518062가 성공했습니다. 배포 workflow의 실제 Wrangler 조회가 전체 SHAeb6b4f63c1079700d19ed8688825411eed90634a·앱55a3484e-c012-457b-9984-304ca2ce51ac 활성100%·health200을 확인했습니다(main212-deployment.json). 학원컴 whoami는 기존 두 번 시간 초과 뒤 추가 실행하지 않았고 저장소 활성 태그의 학원컴 재조회는 미확인입니다.

### (612) TASK-051 이동 초점 복구

- 실제 검토7113218554의 중간1/낮음4건을 처리했습니다. 세 ref를 단일 초점 요청으로 모아 새 요청이 이전 요청을 바꿉니다. useLayoutEffect의 같은 화면 반영에서 요청을 소비하고,연결된 활성 대상의 첫 focus가 실패하면 한 번만 다시 시도합니다. 이미 다른 요소로 초점이 옮겨졌거나 입력이 잠겼으면 요청을 버리고 adopt에서도 비웁니다. 다음 렌더/사용자 입력을 기다리는 재시도는 없습니다. 필드 오류가 이전 조문 요청 뒤에 막히지도 않습니다.
- 이전 head에서 같은 commit 복구/다른 필드 타이핑2개가 실패했습니다. 수정 후 조문·단계 삭제·필드 오류의 대상별 모의와 첫 실패 단언,두 실패 뒤 사용자 입력/새 필드 오류를 포함한 전체 웹49파일1,106개·타입 종료0·형식/lint433파일1042ms·빌드881ms와 두 Worker가 통과했습니다. 서버/DB/의존성은 앞서 새 빈 DB34개 마이그레이션·서버2,221개를 통과한 원본과 같습니다.
- 기존CI가 첫 focus를 놓친 정확한 환경 조건은 아직 확인하지 못했습니다. 시험은 같은 body/textarea 증상과 복구/초점 탈취를 결정적으로 모의합니다. 실제 학원컴 키보드/화면은 공통 Aside CLI CDP 보류로 미확인입니다. 다른 PriceListEditor/PaymentDestinationEditor의 먼저 지우는 경로는 WBS별 TASK-049/053 후속 후보로 기록하며 이 PR에 함께 넣지 않습니다. 기록612의 제목 형식도 맞췄습니다. 다음은 새 head CI·수동 검토와 main 확인입니다.

### (613) TASK-059 영업 신고 확인 화면

- 사진 창 안에 주소 실패 재조회와 초점 복구를 두고,중복 가게 더 보기 뒤 새 첫 링크로 초점을 보냅니다. 다른 운영자가 확인한 뒤 이전 보류 폼은 이유를 보존하되 전송을 막습니다. 이3개 실패 뒤 고쳤으며 인증 전/401/bfcache의 기록·사진 숨김과두 판정의1초 뒤 같은 본문/키 재전송/로그아웃 잠금도 통과했습니다. 면제 사유 두 줄/더 보기와 대문자 UUID의 같은 대상 처리4개 실패도 고쳤습니다. 최종 관련 API67개·양식14개·상호작용20개·응답37개·스타일47개 합계5파일185개·타입 종료0·형식/lint458파일584ms가 통과했습니다. 그 전 전체 웹60파일1,437개·빌드655ms도 통과했으며,최종4개 수정 뒤 새 빈 DB 전체 검사를 진행합니다.
- main214의 app45266858165/db45266857714·모든 check/Windows/DB/스테이징138017721415가 성공했습니다. 실제 Wrangler 조회는 전체 SHAea83266c87f603275a7fe7fd1527ae3d1f2fa376·앱df2ca8c5-65c1-493c-aabf-74e524864b8d 활성100%·health200을 확인했습니다(main214-deployment.json). 학원컴 whoami 기존 두 번 시간 초과 뒤 추가 실행은 없었고 저장소 활성 태그의 학원컴 재조회는 미확인입니다.
- 다음은 새 빈 DB 전체 검사/ready PR과CI·코드/보안 검토입니다. 실제 학원컴 확인은 미실행입니다.

- 새 빈 DB 전체 첫 실행은 서버3개 실패·2,175개 통과·43개 건너뜀으로 끝났습니다. 오류4곳 모두 임시 독립 DB CREATE DATABASE의 No space left on device이며 제품 단언 실패가 아닙니다. 동시에 시작한 TASK-060 npm ci도ENOSPC로 실패했습니다. 완료/소스 깨끗함/추적 파일 없음/활성 실행 없음 조건을 확인하고 TASK-051 초점 후속·TASK-057·TASK-058의 app/node_modules만 지워 약2.5GiB를 확보했습니다. 모든 소스 작업 트리는 보존했습니다. TASK-060 재설치는161개12초로 성공했습니다. 실패 로그는 siljang-task059-fresh-full.log에 보존하고,공간을 확보한 환경에서 별도 이름의 새 빈 DB 전체 검사를 한 번 다시 실행합니다.

- 공간 확보 뒤 별도 새 빈 DB 전체 재검사는34개 마이그레이션·서버104파일2,221개·웹60파일1,441개·빌드781ms와 두 Worker가 모두 종료0입니다. 전체 원본은 dd4cd8d2d491db1f68835fc2720d993dbb2bfd4c이며 그 뒤 제품 코드는 바꾸지 않았습니다. 첫 실행의 공간 부족/실패3개·건너뜀43개는 기록을 보존합니다. 이제 TASK-059만의 ready PR을 열고 CI·코드/보안 검토·병합 직전 수동 리뷰 한 번과 squash 뒤 main CI/배포/원격 앱 태그를 확인합니다. 실제 학원컴10상태×두 폭/page-check/44px·48px는 CDP 보류로 미확인이며 끝남/구현 완료로 세지 않습니다.

- Claude 코드/보안 리뷰(7114738073, 원격8177c4f)의6건을 모두 고쳤습니다. 같은 사유의 보류 unchanged를 확인됨과 나누고, 상세 읽기는 셸을 잠그지 않으며 이동하면 취소합니다. 읽기404는 기존 상세·사진도 숨기고, 대상이 사라진 보류 폼은 사유를 보존한 채 닫을 수 있습니다. 두 사진의 실패를 각각 관리하고 새 판정 결과의 주소를 받으면 안내를 지웁니다. 목록·상세의 사업자/이름/버전/헤더 검사와 허용 필드 복사, 두 판정 POST의 요청/결과 흐름도 함께 씁니다.
- 재현 시험은6개 실패·20개 통과였습니다. 수정 뒤 한 번 남은 실패는 두 보류 버튼 중 시험 선택자 범위였고 바로 고쳤습니다. 최종 전체 웹60파일1,447개·타입 검사·lint458파일728ms·빌드621ms와 두 Worker가 통과했습니다. 서버/DB 제품 코드는 바꾸지 않아 직전 새 빈 DB34개 마이그레이션·서버2,221개 결과를 함께 적용합니다. 화면 정의 원본의 unchanged 문구를 나누고 생성기로 SCR-048/wireframes를 갱신했습니다. 단계 검사는 prd/flows 문제0·spec오류0·erd15/15·sitemap17/17·screens15/15·목업 정적13통과/1미확인·WBS18/오류0입니다. API 계약 변경이 없고 목 서버 환경이 없어 --no-api, 학원컴 Aside CDP 보류로 --no-browser를 썼으며 API 목 서버·page-check·실제10상태×두 폭은 이번에 확인하지 않았습니다.

### (614) TASK-060 운영자 알림 화면

- 실제 OperatorArea 알림 경로에 종류3종/가게·건수·시각과 표/카드를 연결했습니다. 처음 인증 전/bfcache/401에는 알림이 DOM에 남지 않으며,내용/주문/연락처를 복사하지 않습니다. 추가 읽기/새로 고침 실패 때 행과 기준 시각을 남기고 같은 커서로 다시 읽습니다. 추가 완료는 알리며 사용자가 초점을 옮기지 않았을 때만 안내로 초점을 보냅니다. 다른 입력에 옮긴 초점은 유지합니다. 이전 추가 안내가 새로 고친 빈 목록에 남는1개 실패도 고쳤습니다. 최초 UI11개 실패·1개 통과 뒤 최종 UI15개/API24개/주소10개/스타일47개 합계4파일96개·타입 종료0·형식/lint457파일614ms가 통과했습니다.
- 다음은 새 빈 DB 전체 검사와 빌드 뒤 ready PR/CI·코드/보안 검토입니다. 아직 실제 학원컴6상태×두 폭/page-check/44px는 CDP 보류로 미확인이며 끝남/구현 완료로 세지 않습니다. 가게 null은 가게 정보 없음으로 표시해 전체 범위를 단정하지 않습니다. 추가 서버/DB/의존성 변경은 없습니다.

- 최종 원본6f21165의 새 빈 DB에34개 마이그레이션을 적용한 전체 검사는 서버104파일2,221개·웹59파일1,352개·빌드959ms와 두 Worker가 모두 종료0입니다. 원본 뒤 제품 코드는 바꾸지 않았습니다. npm ci 재설치161개12초·관련96개·타입·형식/lint도 통과했습니다. 이제 TASK-060만의 ready PR을 열어 CI·코드/보안 검토·수동 리뷰 한 번과 main 배포 대조까지 진행합니다. 실제 학원컴6상태×360/1280/page-check/44px는 CDP 보류로 미확인이며 끝남/구현 완료 표시는 바꾸지 않습니다.

- TASK-059를 합친 main215 ccd23a8e371d0be45687fd369e0fd91841e22c2c를 결합했습니다. OperatorArea의 심사/알림 경로와 공통 메뉴·로그아웃 제어를 모두 보존하고 두 화면 CSS를 검사 목록에 남겼습니다. 기록614·README322와 main의613·321을 원래 번호 순서로 합쳤습니다. 결합 뒤 전체 웹63파일1,498개·타입 종료0·형식/lint465파일867ms·빌드1.86초와 두 Worker가 통과했습니다. 서버/DB/의존성은 직전 새 빈 DB34개 마이그레이션·서버2,221개를 확인한 코드와 같습니다. 현재 main215 CI·배포 확인은 진행 중이며 아직 완료로 쓰지 않습니다. 알림 PR의 보안 리뷰7114908906은 발견0이고 코드 리뷰는 기다립니다. 실제 학원컴6상태×두 폭/page-check/44px는 기존 CDP 보류입니다.

- main215 ccd23a8e371d0be45687fd369e0fd91841e22c2c의 app45274749051/db45274749172·모든 check/Windows/DB·배포138045874770가 성공했습니다. 배포 workflow의 실제 Wrangler 조회가 전체 태그 일치·앱 f3c1496c-e362-4995-a5b9-b5804311b6dd(2026-11-23T22:01:26.734894Z) 활성100%·health200을 확인했습니다. 학원컴 whoami는 기존 두 번 시간 초과 뒤 추가 실행하지 않았고 저장소 활성 태그의 학원컴 재조회는 미확인입니다.

### (615) TASK-062 가게 개인정보 처리방침 화면

- SCR-002/API-039·SPEC-010/011/018과 서버 처리방침 본문 생성기를 읽고 공개 읽기 API를 구현했습니다. 최초 모듈 부재 뒤 원본4응답과 Retry-After,버전/10만자 본문·공백/국외 이전1~20행·여섯 필드 상한,내부 값 비복사와 잘못된 slug 요청0/404를31개로 확인했습니다. 서버와 같은 소문자/숫자·하이픈3~40자 slug만 경로에 넣고,필요한 공개 필드만 복사하며 no-store/취소 신호를 사용합니다. npm ci161개11초·31개·타입 종료0·형식/lint452파일743ms가 통과했습니다.
- 기록615·README323을 예약합니다. 다음은 실제 App의 공개 경로,본문/목차·국외 이전 표/카드와429 남은 초/자동 재조회·404/500 화면입니다. 아직 화면 구현 전이며 ready PR/finished/구현 완료 표시는 없습니다. 실제 학원컴4상태×두 폭/page-check는 공통 Aside CLI CDP 보류입니다. PR #215/#216의 CI와 실제 검토는 계속 확인합니다.

- 실제 App의 공개 경로와 본문·국외 이전 표/카드·목차를 구현했습니다. 본문은 서버의 일반 문자열을 React 텍스트로 보여 HTML 실행 없이 문단/줄바꿈을 보존합니다. 같은 받는 자의 여러 이전 행을 유지하고10만자/20행도 자르지 않습니다. 서울 게시 날짜,404 주소 재확인/목록 링크 없음,500 추적 ID/재시도,429 남은 초/자동 읽기/반복 제한과 닫기 취소를 연결했습니다. 시스템 시각 변경은 대기 시간을 앞당기지 않고 bfcache 복원은 이전 본문을 숨겨 현재 버전을 다시 읽습니다.
- 화면 첫11개가 기존 빈 화면에서 실패했습니다. 구현 뒤 API31개·상호작용13개·스타일47개,합계3파일91개와 타입 검사가 통과했습니다. 사용하지 않는 시험 import 경고도 지우고 형식/lint를 다시 확인합니다. 다음은 새 빈 DB 전체 시험·빌드와 ready PR입니다. 실제 학원컴4상태×두 폭/page-check/44px는 CDP 보류로 미확인이며 finished/구현 완료로 세지 않습니다. 예약 링크 페이지의 정확한 주소만 연결했고 실제 SCR-001 왕복은 TASK-061에서 확인합니다.

- main215 ccd23a8e371d0be45687fd369e0fd91841e22c2c의 app45274749051/db45274749172·모든 check/Windows/DB·배포138045874770가 성공했습니다. 배포 workflow의 실제 Wrangler 조회가 전체 태그 일치·앱 f3c1496c-e362-4995-a5b9-b5804311b6dd(2026-11-23T22:01:26.734894Z) 활성100%·health200을 확인했습니다. 학원컴 whoami는 기존 두 번 시간 초과 뒤 추가 실행하지 않았고 저장소 활성 태그의 학원컴 재조회는 미확인입니다.

- 새 빈 DB 전체 검사 원본13d3604269826ebd395dcb741f9e23905c9646e2는34개 마이그레이션·서버104파일2,221개·웹58파일1,347개·빌드740ms와 두 Worker가 모두 종료0입니다. 그 뒤 main215의 심사 화면을 결합하고 두 CSS 등록과 기록 번호323/615를 보존했습니다. 결합 원본5949473c4b9b6f8d7afbde7ebe9a9a2ae7d3a2d2에서 전체 웹62파일1,493개·타입 종료0·형식/lint463파일790ms·빌드580ms와 두 Worker가 다시 통과했습니다. 서버/DB/의존성 변경은 없습니다. 이제 TASK-062만의 ready PR을 열고 CI·코드/보안 검토와 수동 검토 한 번 뒤 main CI·배포·원격 태그를 확인합니다. 실제 학원컴4상태×두 폭/page-check/44px는 CDP 보류로 미확인이며 끝남/구현 완료 수는 바꾸지 않습니다.

- main216 664c34447373acc118722f10d815d1e2915157e3의 app45277492453/db45277492439·check138052952708·Windows138052952235·PostgreSQL16.15 138052953623/17.11 138052954271·스테이징138054730548이 모두 성공했습니다. 배포 workflow의 실제 Wrangler 조회가 전체 태그 일치·앱b8f7726b-412c-43ad-a8c0-fecc4d3a5b38(2026-11-23T22:16:36.385932Z) 활성100%·health200을 확인했습니다. 학원컴 whoami는 기존 두 번 시간 초과 뒤 추가 실행하지 않았고 저장소 활성 태그의 학원컴 재조회는 미확인입니다. 알림 PR #216은 코드 리뷰30분 부재7115457631·보안 발견0·수동 리뷰의 새 한도 실패7115463269를 기록해 합쳤으며 나중에 온 코드 발견은 후속으로 처리합니다.

- Claude 코드/보안 리뷰7115502989(원격6fc4946adf8610950770a498c515afe01489a129)의5건을 처리했습니다. 429가 끝난 뒤 pageshow/visibilitychange를 두 순서로 받아도 대기 값과 진행 중 표시를 함께 소비해 한 번만 읽습니다. 404/429는 공통 announce 영역으로 한 번 알리고 매초 남은 시간은 live 영역에서 제외했습니다. 불러오는 중에도 가게/게시 정보·목차·상위 링크·본문/국외 이전 자리를 남기고 액션을 막습니다. 목차는 해시를 replace하고 읽기를 마친 뒤 직접 연 해시도 해당 제목으로 이동합니다.
- 리뷰 재현은7개 실패·11개 통과였습니다. 수정 뒤18개가 통과했으나 전체 실행에서 기존 bfcache 시험1개가 실패하고1,548개가 통과했습니다. 응답이 화면에 반영된 뒤 effect에서 진행 중 값을 비우는 시점이 늦어 복원을 놓쳤습니다. 취소되지 않은 읽기가 끝나는 시점에 값을 비우도록 고친 뒤 전체 웹65파일1,549개·타입 종료0·형식/lint470파일1529ms·빌드594ms와 두 Worker가 통과했습니다. 서버/DB/의존성 변경은 없습니다. 실제4상태×두 폭/page-check/44px·화면 읽기 프로그램은 미확인입니다.
- 상위 SCR-001의 /s/:slug 전체 화면은 TASK-061 몫이라 이번 PR에 더하지 않습니다. 무료 운영 MVP는 기존 지시대로 합성 데이터/시험 계정만 쓰고 홍보·실손님 전달을 하지 않으며 noindex를 유지합니다. TASK-061이 그 경로를 채운 뒤에 FL-001~014 스모크 시험에서 실제 왕복을 확인하고 출시 검토를 진행합니다. 429 공통 훅 추출은 선택 제안이므로 이번에는 읽기 시작 경로를 이 화면 안에서 하나로 모았고 TASK-061에서 재사용 여부를 판단합니다.

- 리뷰5건 처리 뒤 main218을 결합했습니다. 기록323/615와 부모324/616의 번호를 보존했고 제품 코드 결합 뒤 전체 웹65파일1,555개·타입 종료0·형식/lint471파일1628ms·빌드756ms와 두 Worker가 통과했습니다. 원본8a81300의 제품 코드는 이 검사 뒤 바꾸지 않았습니다. 서버/DB/의존성 변경은 없습니다. 다음은 새 head CI와 병합 직전 수동 리뷰 한 번/main 확인입니다. 실제4상태×두 폭/page-check/44px는 CDP 보류라 미확인입니다.
- main218 48cbf9c646f4c9e383591dcd81fad583c5bad2f8의 app45280050188/db45280050194·check138061828561·Windows138061828153·PostgreSQL16.15 138061827645/17.11 138061828118·배포138063454348이 모두 성공했습니다. 배포 workflow의 실제 Wrangler 조회가 같은 전체 태그·앱d381baa3-d3cd-447d-b14c-0a6f926d31d0(2026-11-23T22:32:15.230078Z) 활성100%·health200을 확인했습니다. 학원컴 whoami는 기존 두 번 시간 초과 뒤 추가 실행하지 않았고 저장소 활성 태그의 학원컴 재조회는 미확인입니다.

- 검토 수정 뒤 main219를 결합하고 기록323/615와 부모325/617을 보존했습니다. 제품 원본ab9c26d9e56386be90894f8078c2fd459cfe4c54에서 전체 웹65파일1,563개·타입 종료0·형식/lint471파일700ms·빌드840ms와 두 Worker가 통과했습니다. 서버/DB/의존성 변경은 없습니다. 다음은 새 head CI와 수동 리뷰 한 번/main 확인입니다. 실제4상태×두 폭/page-check/44px는 CDP 보류로 미확인이며 WBS 수는 바꾸지 않습니다.
- main219 f696cb7f7f5514383d7b4c4e42a3cc179a83dd67의 app45281369892/db45281369915·check138066375571·Windows138066375311·PostgreSQL16.15 138066375801/17.11 138066375219·배포138067992334가 모두 성공했습니다. 배포 workflow의 실제 Wrangler 조회가 같은 전체 태그·앱227050f4-c334-4778-a5f8-74c90daad726(2026-11-23T22:40:34.914314Z) 활성100%·health200을 확인했습니다. 학원컴 whoami는 기존 두 번 시간 초과 뒤 추가 실행하지 않았고 저장소 활성 태그의 학원컴 재조회는 미확인입니다.

### (616) TASK-049 가격표 초점 복구

- 앞선 TASK-051 검토7113218554의 다른 편집 화면 지적을 TASK-049 후속으로 분리했습니다. 기존 가격표는 필드 초점 ref를 먼저 비운 뒤 focus를 한 번만 호출하고 탭 키보드 이동도 한 번만 호출합니다. 첫 focus를 의도적으로 실패시키는 필드/서버 결과/탭 시험과 두 실패 뒤 입력 초점 보존 시험에서4개 실패·기존60개 통과를 확인했습니다. 아직 제품 코드는 바꾸지 않았습니다. 다음은 같은 화면 반영에서 최대 두 번 시도하고 요청을 소비하는 처리와 전체 검사입니다. 기록616·README324를 예약하며 실제 학원컴 키보드는 기존 Aside CLI CDP 보류로 미확인입니다.

- 초점 재현4개 실패 뒤 고쳤습니다. 필드/결과 영역/키보드 탭의 초점 요청을 단일 state로 모아 같은 화면 반영에서 소비합니다. 첫 focus 실패는 연결된 활성 대상에 한 번만 더 시도하고 두 번 실패하면 끝냅니다. 사용자 초점이 다른 요소로 옮겨졌거나 잠긴 경우 요청을 버리고 서버 값을 채택할 때도 비웁니다. 뒤 입력이나 재렌더까지 재시도하지 않습니다. 기존60개와 신규4개,합계64개·타입·형식/lint가 통과했습니다. 다음은 전체 웹·빌드와 ready PR/CI·검토입니다. 실제 학원컴 키보드는 미확인입니다.

- 최종 원본e58db71c0707366781ee508bc9cb75a0d0a2c396에서 전체 웹60파일1,451개·타입 종료0·형식/lint458파일685ms·빌드978ms와 두 Worker가 통과했습니다. npm ci는161개18초였습니다. 서버/DB/의존성을 바꾸지 않아 바로 앞 TASK-062의 새 빈 DB34개 마이그레이션·서버2,221개 결과를 함께 적용하며 새 head CI가 전체 시험을 다시 합니다. 실패4개/통과60개와 수정 후64개를 보존했습니다. 실제 학원컴 키보드/두 폭/page-check는 미확인입니다. 다음은 ready PR과 코드/보안 검토·수동 검토 한 번 뒤 main CI/배포/원격 태그 확인입니다.
- main215 ccd23a8e371d0be45687fd369e0fd91841e22c2c의 app45274749051/db45274749172·배포138045874770 성공과 실제 Wrangler 전체 태그 일치·앱 f3c1496c-e362-4995-a5b9-b5804311b6dd 활성100%·health200을 확인했습니다. 학원컴 whoami는 기존 두 번 시간 초과 뒤 추가 실행하지 않았고 저장소 활성 태그의 학원컴 재조회는 미확인입니다.

- main216 664c34447373acc118722f10d815d1e2915157e3의 app45277492453/db45277492439·check138052952708·Windows138052952235·PostgreSQL16.15 138052953623/17.11 138052954271·스테이징138054730548이 모두 성공했습니다. 배포 workflow의 실제 Wrangler 조회가 전체 태그 일치·앱b8f7726b-412c-43ad-a8c0-fecc4d3a5b38(2026-11-23T22:16:36.385932Z) 활성100%·health200을 확인했습니다. 학원컴 whoami는 기존 두 번 시간 초과 뒤 추가 실행하지 않았고 저장소 활성 태그의 학원컴 재조회는 미확인입니다. 알림 PR #216은 코드 리뷰30분 부재7115457631·보안 발견0·수동 리뷰의 새 한도 실패7115463269를 기록해 합쳤으며 나중에 온 코드 발견은 후속으로 처리합니다.

- Claude 코드 리뷰7115487005(원격6b20431034c60a9da97f49f8ace44362963c6d19)의3건을 처리했습니다. 그리지 않은 amountMax 같은 오류는 저장 결과 영역으로 보내고 대상 초점 두 실패 뒤에도 결과 영역으로 한 번만 보냅니다. 서버 오류는 제출/재시도 때의 초점을 기준으로 하여 기다리는 동안 버전 이력으로 옮긴 초점을 가져오지 않습니다. focusReady와 요청 소비/잠금/원래 초점 비교/대체 초점은 ui/useFocusRequest.ts 한 곳으로 모았고 가격표·운영규정이 함께 씁니다. 결제 수단은 TASK-053 PR #219가 같은 처리를 이어받고, 카카오 채널 설정의 옛 패턴은 TASK-054 후속으로 남깁니다.
- 추가 재현은3개 실패·63개 통과였습니다. 수정 뒤 가격표66개/운영규정38개 합계104개와 전체 웹63파일1,504개·타입 종료0·형식/lint466파일702ms·빌드914ms/두 Worker가 통과했습니다. 동기 재시도는 한 번만 생기는 일시적 실패에만 도움이 되며 원래 CI 실패의 환경 원인은 아직 특정하지 않았습니다. 숨김/없는 필드와 지속 실패는 결과 영역으로 대체해 안내합니다. 실제 학원컴 키보드·두 폭/page-check는 미확인입니다. 서버/DB/의존성을 바꾸지 않았습니다.

### (617) TASK-053 결제 수단 초점 복구

- 앞선 TASK-051 리뷰7113218554가 남긴 다른 편집 화면의 초점 문제를 TASK-053 후속으로 분리했습니다. 기존 결제 수단은 ref를 먼저 비우고 focus를 한 번만 시도합니다. 로컬 은행 필드·서버 예금주 오류/알 수 없는 필드의 결과 영역과 두 실패 뒤 입력 초점 보존을 시험해4개 실패·기존28개 통과를 확인했습니다. npm ci161개12초입니다. 아직 제품 코드는 바꾸지 않았으며 다음은 같은 화면 반영에서 요청을 소비하고 최대 두 번 시도하는 처리입니다. 기록617·README325를 예약합니다. 학원컴 실제 키보드는 Aside CLI CDP 보류로 미확인입니다.

- 초점 재현4개 실패 뒤 고쳤습니다. 필드/결과 영역의 요청을 단일 state로 모아 같은 화면 반영에서 소비하고, 연결된 활성 대상에 첫 focus가 실패하면 한 번만 더 시도합니다. 두 실패 뒤 요청은 끝내며 사용자 초점이 다른 요소로 옮겨졌거나 입력이 잠기면 버립니다. 서버 값을 채택할 때도 비우고 뒤 입력/재렌더까지 시도를 남기지 않습니다. 기존28개와 신규4개,합계32개·타입·형식/lint가 통과했습니다. 예금주 확인/계좌 저장/요청 키 계약은 바꾸지 않았습니다. 다음은 전체 웹·빌드와 ready PR/CI·검토입니다. 실제 학원컴 키보드는 미확인입니다.

- 최종 원본d8d3223078de460734724598504ba9836d4dcec1의 전체 웹60파일1,451개·타입 종료0·형식/lint458파일865ms·빌드669ms와 두 Worker가 통과했습니다. npm ci161개12초이며 실패4개/기존통과28개와 수정 후32개를 보존했습니다. 서버/DB/의존성을 바꾸지 않아 바로 앞 TASK-062 새 빈 DB34개 마이그레이션·서버2,221개 결과를 함께 적용하고 현재 head CI에서 전체 시험을 다시 확인합니다. 다음은 ready PR과 코드/보안 검토·병합 직전 수동 리뷰 한 번 뒤 main CI/배포/원격 앱 태그입니다. 실제 학원컴 키보드·두 폭/page-check는 CDP 보류라 미확인이며 finished/구현 완료를 바꾸지 않습니다.
- main215 ccd23a8e371d0be45687fd369e0fd91841e22c2c의 app45274749051/db45274749172·배포138045874770 성공과 실제 Wrangler 전체 태그 일치·앱 f3c1496c-e362-4995-a5b9-b5804311b6dd 활성100%·health200을 확인했습니다. 학원컴 whoami는 기존 두 번 시간 초과 뒤 추가 실행하지 않았고 저장소 활성 태그의 학원컴 재조회는 미확인입니다.

- main216 664c34447373acc118722f10d815d1e2915157e3의 app45277492453/db45277492439·check138052952708·Windows138052952235·PostgreSQL16.15 138052953623/17.11 138052954271·스테이징138054730548이 모두 성공했습니다. 배포 workflow의 실제 Wrangler 조회가 전체 태그 일치·앱b8f7726b-412c-43ad-a8c0-fecc4d3a5b38(2026-11-23T22:16:36.385932Z) 활성100%·health200을 확인했습니다. 학원컴 whoami는 기존 두 번 시간 초과 뒤 추가 실행하지 않았고 저장소 활성 태그의 학원컴 재조회는 미확인입니다. 알림 PR #216은 코드 리뷰30분 부재7115457631·보안 발견0·수동 리뷰의 새 한도 실패7115463269를 기록해 합쳤으며 나중에 온 코드 발견은 후속으로 처리합니다.

- main216 664c34447373acc118722f10d815d1e2915157e3 결합 뒤 전체 웹63파일1,502개·타입·형식/lint·빌드/두 Worker가 통과했습니다. 심사와 알림 경로를 모두 보존했습니다. 다음은 결제 수단 리뷰7115606666의5건과 TASK-049 PR #218의 공통 초점 처리를 결합하고 제출 시점/잠금 보호를 추가 검증합니다. 아직 리뷰 수정 완료로 쓰지 않습니다.

- Claude 코드/보안 리뷰7115606666(원격4c59595b6f28e03f079f7bc87faca20f92ecfea1)의5건을 처리했습니다. 결제 수단과 운영규정의 서버 오류는 제출/재시도 시점 초점을 기준으로 하여 기다리며 뒤로 링크로 옮긴 초점을 가져오지 않습니다. 확인 창을 거친 저장도 처음 여는 버튼을 기준으로 유지하며 그 뒤 이동한 초점을 지킵니다. 잠금 중 요청은 버리고 풀려도 재실행하지 않는 시험을 더했습니다. 공통 useFocusRequest/focusReady와 결과 영역 대체 처리를 사용합니다. 가격표의 옛 방식은 PR #218에서 이미 고쳐 main48cbf9c646f4c9e383591dcd81fad583c5bad2f8에 합쳤습니다.
- 추가 재현은3개 실패·70개 통과였고 고친 뒤73개가 통과했습니다. 확인 창 뒤 이동1개도 더해 최종 전체 웹63파일1,512개·타입 검사·형식/lint466파일833ms·빌드1.05초와 두 Worker가 통과했습니다. 같은 동기 실행에서의 한 번 재시도는 일시적 첫 실패에만 도움이 되며 원래 CI 환경의 원인은 특정하지 못했습니다. 지속 실패는 결과 영역으로 대체하고 실제 학원컴 키보드에서 다시 확인합니다. 실제키보드/두 폭/page-check는 CDP 보류로 미확인이며 서버/DB/의존성과 계좌 저장/예금주 확인/요청 키 계약은 바꾸지 않았습니다.

### (618) TASK-054 채널 초점 복구

- TASK-049/053 리뷰7115487005·7115606666가 남긴 다른 편집 화면의 초점 문제를 TASK-054 후속으로 분리했습니다. 채널 필드 첫 실패·두 실패 뒤 결과 영역 대체·저장 대기 중 뒤로 이동·잠금 해제 뒤 옛 요청 재실행·연결 확인의 누락 블록 초점을5개 실패/기존45개 통과로 재현했습니다. npm ci161개18초입니다. 아직 제품 코드는 바꾸지 않았으며 다음은 main218의 공통 useFocusRequest와 제출 시점 기준을 적용합니다. 기록618·README326을 예약하며 실제 학원컴 키보드는 Aside CLI CDP 보류로 미확인입니다. 검사/배포가 끝난 TASK-060의 깨끗함·실행 없음·추적 파일 없음을 확인한 app/node_modules만 정리해 공간을 확보했고 모든 소스는 보존했습니다.
- main218 48cbf9c646f4c9e383591dcd81fad583c5bad2f8의 app45280050188/db45280050194·check138061828561·Windows138061828153·PostgreSQL16.15 138061827645/17.11 138061828118·배포138063454348이 모두 성공했습니다. 배포 workflow의 실제 Wrangler 조회가 같은 전체 태그·앱d381baa3-d3cd-447d-b14c-0a6f926d31d0(2026-11-23T22:32:15.230078Z) 활성100%·health200을 확인했습니다. 학원컴 whoami는 기존 두 번 시간 초과 뒤 추가 실행하지 않았고 저장소 활성 태그의 학원컴 재조회는 미확인입니다.

- 채널 설정을 main218의 공통 useFocusRequest에 연결했습니다. 첫 초점 실패는 한 번 더 시도하고 지속 실패는 결과 영역으로 대체하며, 저장/연결 확인/키 교체·재시도 때의 초점 기준을 보존합니다. 서버 응답을 기다리며 뒤로 링크로 이동한 초점은 가져오지 않고 잠금 중 요청은 소비해 잠금 해제 뒤 재실행하지 않습니다. 서버 값을 채택하면 옛 요청도 비웁니다. 스킬 키·저장 본문·요청 키/확인 정책·상태 조회는 바꾸지 않았습니다.
- 첫5개 실패/기존45개 통과 뒤 누락 블록 시험의 모의 대상을 편집 뒤 새 입력의 포인터로 맞췄습니다. 기존코드의 첫 호출만 실패하는 경로를 다시 확인했고, 수정 뒤 관련1파일50개·타입 검사가 통과했습니다. 중간 시험 모의 수정의 ReferenceError는 제품 오류가 아니며 원본 로그를 보존합니다. 다음은 main219 결합과 전체 웹/빌드·ready PR입니다. 실제 학원컴 키보드·두 폭/page-check는 CDP 보류로 미확인입니다.

- main219를 결합한 제품 원본73cc0365f9e6fbe3a23d1cb391cbab6defee05fa에서 전체 웹63파일1,517개·타입 종료0·형식/lint466파일987ms·빌드1.73초와 두 Worker가 통과했습니다. npm ci161개18초·관련50개도 통과했습니다. 서버/DB/의존성은 앞서 새 빈 DB34개 마이그레이션·서버2,221개를 확인한 코드와 같습니다. 실제 채널/키보드/두 폭/page-check는 CDP 보류로 미확인이며 스킬 키·저장 본문/요청 키/상태 조회 계약은 유지했습니다. 이제 TASK-054만의 ready PR을 열고 CI·코드/보안 검토·수동 리뷰 한 번 뒤 main CI/배포/원격 태그까지 확인합니다.
- main219 f696cb7f7f5514383d7b4c4e42a3cc179a83dd67의 app45281369892/db45281369915·check138066375571·Windows138066375311·PostgreSQL16.15 138066375801/17.11 138066375219·배포138067992334가 모두 성공했습니다. 배포 workflow의 실제 Wrangler 조회가 같은 전체 태그·앱227050f4-c334-4778-a5f8-74c90daad726(2026-11-23T22:40:34.914314Z) 활성100%·health200을 확인했습니다. 학원컴 whoami는 기존 두 번 시간 초과 뒤 추가 실행하지 않았고 저장소 활성 태그의 학원컴 재조회는 미확인입니다.

- Claude 코드·보안 리뷰7116285812(head b28d7b723ce1208bbc3e602c85095da362a495fe)의 낮음4건을 대조했습니다. 1번은 잠금 중422 문구가 화면에 반영된 뒤 초점0회를 검사하도록 보강했습니다. 2번은 연결 실패 뒤 재시도에서 새 기준을 쓰는 경우와 기다리며 뒤로 링크로 이동한 경우를 각각 더해 관련52개가 통과했습니다. 3번 포인터 찾기 통합은 현재 input만 찾는 두 화면과 결과 영역 대체가 같고 공통 focusReady가 fieldset 잠금을 검사하므로 이 기능 수정에 필요하지 않아 보류합니다. 4번은 범용 useCommand에 DOM 의존을 넣지 않고, 이 화면의 유일한 send(저장/연결 확인/키 교체)와 재시도 두 진입점에서 기준을 기록합니다. 진입점 누락 위험은 새 재시도 시험과 기존 저장/누락 블록 시험으로 확인했습니다. 보안 발견은0건입니다.
- main217 c0155e765f135d6b00aedbd1fd68153c14fdc480을 결합한 원본 fa16620에서 전체 웹65파일1,570개·타입 종료0·웹/두 Worker 빌드가 통과했습니다. 실제 학원컴 키보드·360/1280·page-check는 CDP 보류로 미확인이며 WBS 완료 표시는 바꾸지 않습니다.

### (619) TASK-063 손님 메시지 수신 수락 대조

- main219에서 TASK-063을 시작했습니다. 앞선 TASK-028/019는 끝남 또는 구현 완료 기준을 채웠고, 낮은 반복의172접속·027예전44건 원문·184의첫AI고지연결·045/화면들의 실제 확인은 기록한 대기를 유지합니다. 재계산은 끝남32·구현 완료20·시작 가능36개이며 새 개발의 같은 반복 우선순위는 뒤에84개가 기다리는 TASK-063입니다. 기록619·README327을 예약합니다.
- 기존 TASK-028의 수신 코드를 대조하는 실제 PostgreSQL 회귀5개는 첫 실행부터 통과했습니다. 친구 값 누락/오래된 값, 열린 상담/끝난 상담, Unicode1000자와 전체 기록, 상담1000원 차단과 같은 가게 다른 상담의 모의 답, 교차 가게401/두 가게 기록 불변을 확인했습니다. 신규 제품 코드는 아직 없습니다. npm ci161개10초이며 모델/카카오 발신은 모의 응답·실제 API 호출0건입니다. 다음은 수락 대조표의 기존 만료/HTTP/11결과/하루 한도 검사까지 새 빈 DB 전체로 확인하고 끝남 표시를 판단합니다.

- 신규 회귀5개와 기존 만료/HTTP/11결과/하루 한도를 새 빈 PostgreSQL에서 확인했습니다. 마이그레이션34개·서버105파일2,226개·웹65파일1,563개·웹 빌드903ms와 두 Worker가 통과했습니다. 제품 원본25a4d601e8fe01963822cb03ee8413dedea7da7d이며 수신 제품 코드는 바꾸지 않았습니다. 수락 대조표의 SPEC-017 #3·4·7, API-070 네 응답/11결과, A13 자동 조건을 모두 채워 TASK-063 finished를 원본에 쓰고 생성했습니다. 실제 모델/카카오 호출은0건이고 실제 카카오/큐/첫 고지·전체 AI 업무 흐름을 완료했다고 세지 않습니다.
- 완료33개·구현 완료20개·시작 가능41개로 다시 계산했습니다. 반복0/1의 접속·예전44건 원문과 반복2의 실제 화면/FL 확인은 기존 보류를 유지합니다. 다음 새 개발은 TASK-064 첫 고지이며 TASK-184의 고지 연결도 함께 확인합니다. 반복3은28개 중2개 완료(TASK-063·090)이고 나머지를 계속 진행합니다.
- main217 c0155e765f135d6b00aedbd1fd68153c14fdc480의 app45284307027/db45284307029·check138076504780·Windows138076504182·PostgreSQL16.15 138076504497/17.11 138076505070·배포138078124568이 모두 성공했습니다. 배포 workflow의 실제 Wrangler 조회가 같은 전체 태그·앱41538f17-6be0-48c4-b6fb-f16ba2dc8dac(2026-11-23T22:59:53.101754Z) 활성100%·health200을 확인했습니다. 학원컴 whoami는 기존 두 번 시간 초과 뒤 재시도하지 않았고 저장소 활성 태그의 학원컴 재조회는 미확인입니다.

- PR #221 뒤 main220 bf70a09511f37fe1255b0295d7b8e28bc0ec8b72을 결합했습니다. 추가된 채널 초점/시험을 포함한 제품 원본74144fa에서 전체 웹65파일1,570개·타입 종료0·웹 빌드674ms/두 Worker가 통과했고 WBS18개0오류입니다. 서버/DB/의존성은 앞서 새 빈 DB2,226개를 통과한 코드와 같으며 새 head CI에서도 전체 시험을 확인합니다. 공개 첫 고지와 다른 업무 범위는 기존 수락 표대로 이어갑니다.

- SPEC-017 수락 기준4의 뒷부분도 한 HTTP/DB/콜백 회귀로 이었습니다. 친구true 뒤 isFriend 없는 요청으로 false가 된 손님에게 남긴 안내가 다음 콜백에서 AI 답보다 먼저 나오고, 전달 표시는 한 번만 바뀌며 그 다음 답에는 반복되지 않습니다. 추가 사례를 포함한 관련6개가 통과했습니다. 안내 생성/먼저 발신 실행기의 TASK-104와 실제 유료 Event API 확인을 구현했다고 세지 않습니다. 기존2,226개 전체 결과와 새6개 결과를 보존하고 현재 소스로 새 빈 DB 전체를 다시 확인합니다.
- main220 bf70a09511f37fe1255b0295d7b8e28bc0ec8b72의 app45285771131/db45285771238·check138081572403·Windows138081573057·PostgreSQL16.15 138081573260/17.11 138081572693·배포138083530256이 모두 성공했습니다. 실제 Wrangler 전체 태그·앱fdd5aaea-e524-44ad-9843-18b9ed20b5e0(2026-11-23T23:10:18.336086Z) 활성100%·health200입니다. 학원컴 whoami는 기존2회 시간 초과 뒤 재시도하지 않았고 저장소 활성 태그의 학원컴 재조회는 미확인입니다.

- 친구 누락 뒤 안내 전달 사례를 포함한 제품 원본9085f294ab02df18918101d224e9c6749f9fc5d7에서 새 빈 PostgreSQL 마이그레이션34개·서버105파일2,227개·웹65파일1,570개·웹 빌드1.60초/두 Worker가 모두 통과했습니다. 앞서 누락했던 수락 기준4 뒷부분은 같은 HTTP/DB/콜백 회귀로도 확인했고 수락 표를 보강했습니다. 공개 head836b39fa1d44fe09242b4a37160b2dd364925800의 재리뷰 요청7116735948 뒤 코드 검토/현재 head CI를 기다립니다.

### (620) TASK-064 첫 AI 고지

- TASK-064 첫 AI 고지를 시작했습니다. TASK-063은 새 빈 DB 전체 자동 조건을 채웠고 완료 반영 PR을 준비 중입니다. 현재 main217에 첫 고지 모듈이 없어 모의 모델과 실제 PostgreSQL로 첫 발신/같은 상담·새 상담/발신 실패 뒤 재고지3개를 작성했고 모두 실패했습니다. 기존 소비자가 고지 전 모델을 막아 사장님 안내만 보내는 경로를 확인했습니다. 준비 명령의 경로 오류/시험 파일 없음은 제품 재현으로 세지 않고 최초 실제 실행3개 실패 로그를 보존합니다. npm ci161개19초입니다.
- 다음은 카카오 출력의 맨 앞에 고지와 가게 처리방침 링크를 붙이고, 성공 확인 뒤에만 시각/게시 버전을 남기는 처리입니다. 실제 모델·카카오 호출은0건/비용0원이며 학원컴 브라우저/추가 whoami는 실행하지 않았습니다. 기록620·README328을 예약합니다. 완료33·구현 완료20·시작 가능41(낮은 반복의 기존 접속/원문·실제 화면 대기는 유지)입니다.

- 첫 AI 고지를 콜백 출력의 맨 앞에 붙이고 성공 응답 뒤 시각/게시 버전을 답의 전달 표시와 같은 트랜잭션에 씁니다. 모델 대기 중 설정이 바뀌면 발신 직전에 공통 currentPrivacyPolicy로 다시 견주어 새 버전을 고르고, 이전 정책/상담 버전은 보존합니다. 가게→손님→상담 순서로 잠그며 외부 호출 동안 DB 잠금을 유지하지 않습니다. 고지 전송에 실패해 남은 AI 답은 기본 미전달 읽기에서 제외하고 고지가 함께 가는 콜백만 읽습니다. 출력3칸이 고지/이전 안내로 차면 새 AI 답은 다음 대화에 남깁니다.
- 최초 실제3개 실패 뒤 처리방침 시험 자료의 게시 시각을 시험 시계에 맞췄고3개 통과, 설정 변경/두 첫 상담 동시 실행까지 관련5파일104개가 통과했습니다. 문의 끊김/고지 없는 응답 차단/안내 두 개 우선까지 관련8개도 통과했습니다. 타입 검사에서 시험 자료 행2곳의 undefined 검사가 빠진 것을 고쳤고 타입·lint473파일652ms 오류/경고0을 확인했습니다. 초기 WIP lint의9개 경고는 미사용 보조 함수와 non-null 단언을 없애 해결했으며 원본 로그를 보존합니다. 다음은 새 빈 DB 전체 검사·API-070 네 응답/A39 수락 대조와 TASK-063 main 결합입니다. WBS 완료 표시는 아직 하지 않습니다.
- main220 bf70a09511f37fe1255b0295d7b8e28bc0ec8b72의 app45285771131/db45285771238·check138081572403·Windows138081573057·PostgreSQL16.15 138081573260/17.11 138081572693·배포138083530256이 모두 성공했습니다. 실제 Wrangler 전체 태그·앱fdd5aaea-e524-44ad-9843-18b9ed20b5e0(2026-11-23T23:10:18.336086Z) 활성100%·health200입니다. 학원컴 whoami는 기존2회 시간 초과 뒤 재시도하지 않았고 저장소 활성 태그의 학원컴 재조회는 미확인입니다.

- 제품 원본e1aa90bc2c47d4378c028f4c52107add561411b8에서 새 빈 PostgreSQL 마이그레이션34개·서버105파일2,229개·웹65파일1,570개·웹 빌드810ms/두 Worker가 모두 통과했습니다. 고지8개를 포함한 타입 검사도 종료0입니다. 수락 대조표를 작성하고 TASK-063 PR #221의 main 결합과 관련 검사·finished 반영을 남긴 채 ready PR로 검토를 받습니다. 실제 모델/카카오 호출0건·비용0원이며 WBS 완료 표시는 아직 바꾸지 않습니다.
- 현재 origin/main bf70a09511f37fe1255b0295d7b8e28bc0ec8b72의 완료 수는32개입니다. 앞 기록의33개/시작 가능41개는 TASK-063 PR #221의 완료 표시를 포함한 제안 원본의 계산이며 병합 전 main 집계가 아닙니다. 낮은 반복의 기존 외부 접속/예전44건 원문/화면 확인 보류는 유지하고 모든 일이 확인 대기인 상태가 아니므로 계속합니다.
- 학원컴 Aside CLI --version은1.26.1121.1917, update -y는 최신 버전이라고 응답했고 SSH 종료0입니다. 달라진 상태가 없어 기존 CDP 두 실패 보류를 유지했습니다. 새 CDP 제어/Ego/CUA/추가 whoami를 실행하지 않았습니다.

- Claude 코드·보안 리뷰7117078927(head06e97e215662513c2454b10a005dbedf94ff839b)의 발견5건을5개 실패/기존8개 통과로 재현했습니다. 1번은 즉시 응답도 정책을 손님 잠금 전에 골라 고지→미전달 답/안내 순서로 전하고, 세 칸이 차 생략한 새 넘김 안내는 미전달로 남깁니다. 정책이 없어 고지할 수 없으면 고지 전 AI에서 뒤 행의 선택도 멈춥니다. 2번은 게시 전/없는 정책의 not_found를 준비 불가로 바꾸어 모델 없이 바로 사장님에게 넘깁니다. 3번은 첫 준비 때 미전달 고지 행을 먼저 남기고 성공 때 그 행과 실제 sentAt을 확정합니다. 4번은 불리언 대신 고지하는 상담 ID만 열고 끝난 다른 상담의 고지 전 AI 답은 제외합니다. 5번은 발신 직전 영구 사유가 생기면 15초 재시도 없이 바로 넘김/닫힘 처리를 합니다. 보안 발견은0건입니다.
- 수정 뒤 고지13개·수신/미전달/콜백/제한 역할을 포함한5파일109개가 통과했습니다. 콜백 주소 없음/비용 제한/큐 실패의 즉시 넘김까지 고지16개도 통과했습니다. 타입 검사의 시험 행 날짜 타입 누락을 고쳤습니다. 다음은 현재 원본의 새 빈 DB 전체 검사·최종 타입/빌드와 TASK-064 finished 대조이며 아직 완료 표시를 하지 않습니다.
- main221 b4026bff4231002143c70ac53b475819a04bd5e0의 app45290134780/db45290134841·check138096452379·Windows138096451946·PostgreSQL16.15 138096451270/17.11 138096451655·배포138097980769가 모두 성공했습니다. 실제 Wrangler 전체 태그·앱133e05c1-24d6-458b-973c-a96bc07dcb87(2026-11-23T23:39:12.095495Z) 활성100%·health200입니다. 현재 main 완료33개이며 학원컴 whoami/저장소 활성 태그 재조회는 기존 보류를 유지합니다.

- 리뷰 수정 제품 원본03ca269에서 새 빈 PostgreSQL 마이그레이션34개·서버106파일2,243개·웹65파일1,570개·웹 빌드824ms/두 Worker가 모두 통과했습니다. 그 뒤 제품 코드는 바꾸지 않고 시험 행의 빈 값 검사를 required로 보강해 최종 타입 종료0·관련16개 통과를 확인했습니다. SPEC-018 #1~3·A39·API-070 네 응답과 리뷰5건을 대조해 TASK-064 finished를 원본에 쓰고 생성합니다. 현재 main 완료33개이며 이 PR이 합쳐지면34개입니다. 코드 검토7117078927의 보안 발견0과 발견별 처리는 새 공개 head에 연결하고 현재 CI/병합 직전 수동 리뷰 한 번 뒤 main CI/배포/실제 태그까지 확인합니다.

### (621) TASK-066 AI 대화 입력과 출력 마스킹

- TASK-066의 최근 대화 입력과 AI 답 출력을 시작했습니다. 같은 상담의 최근20차례/시간 순서/다른 손님 제외, AI 답의 플레이스홀더를 원래 값으로 풀지 않고 제거해 저장·발신하는 두 실제 PostgreSQL/모의 모델 시험이 모두 실패했습니다. 현 소비자는 마지막 질문 하나만 넘기고 출력 플레이스홀더를 유지합니다. 기존 번호 마스킹/암호화 모듈은 재사용하고 이 두 경계부터 연결합니다. 제품 코드는 아직 바꾸지 않았습니다.
- 원본 main220 bf70a09511f37fe1255b0295d7b8e28bc0ec8b72의 완료32개·구현 완료20개입니다. TASK-063 PR #221의 수신 자동 조건/완료 반영과 TASK-064 PR #222의 첫 고지 검토를 기다리는 동안 독립 입력·출력 경계를 보강합니다. 선행 main 결합 전 완료 표시/병합을 하지 않습니다. 같은 반복에서 남은 새 개발 중 TASK-066 뒤에는78개가 기다립니다. 기록621·README329를 예약합니다. 실제 API0건·비용0원입니다.

- 최근20차례를 마스킹 글에서 시간 순서로 읽고 현재 초안은 허용한 문구/디자인/색/빼야 할 재료/퀵 여부만 조회합니다. 주문 요청 시각까지의 대화와 제출한 초안은 제외하며 주문자 이름·연락처·알레르기는 조회하지 않습니다. AI 답의 플레이스홀더는 제거해 저장/발신하고 원래 값으로 복원하지 않습니다. 이전 AI 답은 한 번에 읽어 차례마다 조회하지 않습니다. 입력 준비/마스킹 실패는 저장점에서 되돌리고 모델을 부르지 않은 채 masking_failed로 사장님에게 넘깁니다. 준비 뒤 시간 예산도 다시 확인합니다.
- 처음 두 실패 뒤2개 통과, 초안 전용 정보/주문 요청 경계까지4개 통과, 암호화 실패1개 실패/4개 통과 뒤 보강했습니다. 관련 대화/번호 마스킹/암호화/콜백4파일110개와 타입·lint473파일802ms가 통과했습니다. 두 회사로 나눈 합성 대화100개의 운영 설정/모델 이름/추적 도구 요청0 검사를 더해 관련2파일21개도 통과했습니다. 모든 모델/카카오 발신은 모의이며 실제 API0건·비용0원입니다.
- 다음은 SPEC-021 수락 기준11개/A15의 남은 번호 원본 보관·사장님 원본 보기·업무 요약/알림/장부의 알레르기 제외 대조, HTTP 네 응답과 새 빈 DB 전체 검사입니다. 전체 업무 출력/스테이징 회사 전환을 확인한 것으로 세지 않고 WBS 완료/구현 완료를 표시하지 않습니다. TASK-063/064 main 결합도 남았습니다.

- 새 빈 DB 전체에서 제한 역할 시험2개 실패/2,225개 통과가 나왔습니다. 최근 대화의 주문 요청 경계와 초안 정렬에 새로 읽는 열이 권한 파일에 빠져 모델 호출 전에 막혔습니다. orders의 shop_id/consultation_id/requested_at 조회만 더한 첫 수정은2개 실패/7개 통과였고, order_drafts.created_at 조회도 더한 뒤 제한 역할9개가 모두 통과했습니다. 실제 스테이징 역할 적용은 아직 미확인입니다. 새 빈 DB 전체를 다시 돌리며 첫 실패 로그는 보존합니다.

- main222를 결합한 관련4파일36개와 타입 검사 뒤, 출력 목적별 열을 고르는 order-output을 추가했습니다. 할 일 요약/알림에는 연락처·알레르기·자유 입력을 넣지 않고, 장부에는 주문자 이름/연락처·금액만 허용하며 알레르기 열은 조회하지 않습니다. 사장님 주문 상세·제작 자료는 알레르기를 읽고 손님/다른 가게는 같은404입니다. 사장님 기다림 계산은 기존 넘김과 ownerWaitDue 하나를 공유합니다.
- 새 출력3개와 기존 콜백을 합쳐56개, 제한 역할을 포함한2파일13개가 통과했고 타입 종료0·형식/lint479파일902ms 오류/경고0입니다. 첫 실행의 모듈 미작성은 시험 수집 실패이며, 구현 뒤 insertOnce의 SQL 띄어쓰기 오류1개를 고쳤습니다. 공용 앱 역할에서 새 사장님 출력의 금액 읽기가 필요해 최소 열 권한과 기존 부정 권한 기대를 함께 갱신했습니다. 제한 역할의 수정/삭제 금지는 유지합니다.
- 이는 TASK-066의 개인정보 출력 경계 공통 함수이며 TASK-072의 전체 주문 요청/할 일 흐름이나 TASK-152의 구글 장부 전송·재시도 구현으로 세지 않습니다. 실제 스테이징 권한 적용/모델 회사 전환은 미확인이고 완료/구현 완료 표시는 하지 않습니다. 다음은 전화번호/주문번호의 실제 수신→모의 모델 대조와 현재 원본의 새 빈 PostgreSQL 전체 검사입니다. 실제 외부 호출0건·비용0원입니다.

- 실제 카카오 수신 처리기→저장된 본문→콜백 소비자→모의 모델 입력까지 전화번호만 플레이스홀더로 바뀌고 주문번호K7Q3M9는 그대로인 사례를 더했습니다. 같은 가게 사장님 범위의 openMaskedValue는 암호화 원본을 풀고 다른 가게는404입니다. 이 함수의 호출자 권한 확인은 기존 계약대로이며 실제 사장님 화면 확인으로 세지 않습니다.
- 카드/주민번호도 이 수신 경로에서 가리고, 카드에는 끝4자리만 남고 긴 숫자에는 끝자리/원본/해시 모두 없는 것을 실제 PostgreSQL에서 확인했습니다. 새2개를 포함한 대화7개가 통과했습니다. 첫 실행의 조회 열 이름 오류1개는 value_hmac로 고쳤으며 제품 오류 재현으로 세지 않습니다. 타입 종료0·형식/lint479파일985ms 오류/경고0이고 실제 API0건·비용0원입니다.
- TASK-064 후속 PR #224의 app/db는 성공해 리뷰를 기다립니다. 그 제품 변경을 main 결합한 뒤 현재 TASK-066 전체 검사와 수락 표/남은 실제 환경 확인을 대조합니다. 완료/구현 완료 표시는 아직 하지 않습니다.

- SPEC-021의 필요한 문맥을 다시 대조해 현재 견적이 빠지는 경우와 사장님 넘김으로 폐기한 AI 답이 다음 문맥에 남는 경우를2개 실패/기존10개 통과로 재현했습니다. 현재 초안의 같은 수정 번호·현재 가격표·유효 시각에 맞는 견적의 금액/표시/주문 종류/유효 기한만 읽고 근거·개인정보·내부 식별자는 모델에 주지 않습니다. 만료/다른 초안 수정/옛 가격표의 견적과 failed AI 답은 제외합니다.
- 초안에 옛 가격표 ID가 남아도 같은 수정 번호에 현재 가격표로 계산한 유효 견적은 쓸 수 있어야 하는 추가1개 실패/12개 통과를 고쳤습니다. 가격표가 현재인지와 견적 수정/유효 시각으로 판단하고 불필요한 초안 가격표 읽기는 없앴습니다. 대화13개·제한 역할10개·출력3개를 합친3파일26개·타입 종료0·형식/lint479파일1239ms 오류/경고0입니다. 근거의 합성 알레르기/전화가 모델에0번 나타나는 것도 확인했습니다.
- 실제 견적 생성/답 렌더와 전체 AI 업무 흐름은 TASK-067·069가 연결할 범위입니다. 현재 일반 AI 답의 가격/자리 출력 제한을 풀지 않았고 외부 호출0건·비용0원입니다. 현재 원본을 커밋하고 main223을 결합한 뒤 TASK-064 후속 main도 결합해 전체 검사/수락 조건을 대조합니다. 완료/구현 완료 표시는 아직 하지 않습니다.

- main224 4d16e10c5fd3933b0eaf86eed5199bc30f6dd724를 결합했습니다. 마스킹 실패 사유와 발신 직전 폐기할 답 ID가 같은 위치의 인자가 되던 충돌은 이름 있는 options로 합쳐 두 동작을 보존했습니다. 같은 트랜잭션의 자기 선점 확인/답 폐기와 비용 한도 우선·masking_failed 사유를 모두 지킵니다.
- 현재 대화13개·고지29개·제한 역할10개·출력3개·콜백53개를 합친5파일108개·타입 종료0·형식/lint480파일799ms 오류/경고0입니다. 그 뒤 제품 코드는 바꾸지 않고 형식과 기록을 커밋해 새 빈 PostgreSQL 전체 검사를 시작합니다. 현재 main의 완료35개·구현 완료20개는 바꾸지 않습니다. 실제 외부 호출0건·비용0원이며 학원컴 CDP/추가 whoami 보류를 유지합니다.

- 제품 원본bb0cdad641cfa81a610523dcd9109064b0dbfb5e에서 새 빈 PostgreSQL 마이그레이션34개·서버109파일2,279개·웹65파일1,570개·웹 빌드794ms/두 Worker가 통과했습니다. main224 결합 관련5파일108개·타입 종료0·형식/lint480파일799ms 오류/경고0입니다. SPEC-021 #1~11을 수락 표에 대조하고 실제 SDK/카카오/구글 호출0건·비용0원과 실제 환경 미확인을 구분합니다.
- 스테이징 로그·대화의 비밀 값 검사, 실제 배포 설정의 회사 전환/평가, 새 열 권한의 실제 적용은 미확인입니다. 원본 번호/알레르기의 실제 화면·전용 블록/알림/장부 전체 흐름은 각각의 담당 작업과 함께 확인합니다. finished/구현 완료 표시는 하지 않고 ready PR에서 현재 코드의 CI·Claude 코드/보안 리뷰·수동 리뷰 한 번/main 확인을 진행합니다.
- 기준 main224 4d16e10c5fd3933b0eaf86eed5199bc30f6dd724의 app45303158836/db45303158901·배포138141734437는 성공했습니다. 실제 Wrangler 전체 태그 일치·앱cedda0c0-2b5f-415d-809d-fff43bf2a5af(2026-11-24T01:15:21.838365Z) 활성100%·health200과 원격 ref 일치를 확인했습니다. 현재 main 완료35개·구현 완료20개이며 학원컴 whoami/저장소 태그 재조회는 기존 보류입니다.

PR #225의 Claude 검토(`8ce65f6`, 댓글 `7119372863`) 발견 7건을 처리합니다. 문맥 조회의 예외 중 `MaskingFailedError`와 `FieldCryptoError`만 마스킹 실패로 분류하고, 권한·조회 등 다른 오류는 선점을 풀어 재시도합니다. 초안 문자열에 번호 검출 결과나 마스킹 플레이스홀더가 있으면 `schema_invalid`로 거절하여 초안과 AI 답을 저장하지 않습니다. 사장님에게 넘긴 원래 질문과 추가 질문은 이후 모델 문맥에서 제외합니다. 출력 정리는 한 번만 계산하고 초기·재시도 프롬프트 모두 플레이스홀더를 답·초안에 쓰지 않도록 명시했습니다.

공용 runtime 역할은 행위자를 구분하지 않는 기존 구조를 유지합니다. 사장님 전용 출력이 쓰는 열과 API-072 자체가 쓰는 열의 주석을 구분했습니다. 손님·일 실행기·운영자 범위에서 장부와 제작 자료를 호출하면 개인정보 조회 SQL 전에 거절하는 시험을 더했습니다. 역할 자체의 열 권한은 여전히 공용이므로 앞으로 새 경로도 목적별 함수를 거쳐야 합니다. `createCustomOrderTask`는 아직 사장님 전용이며, TASK-072에서 손님 주문 요청에 연결할 때는 검증된 내부 쓰기 경계를 별도로 제공해야 합니다. 현재 경로에 연결되지 않은 함수를 손님·일 실행기에 열지는 않았습니다.

새 회귀 시험은 처음 `Tests 6 failed | 13 passed (19)`였고 수정 뒤 `Tests 19 passed (19)`입니다. 최초 오류 분류 시험 두 건은 잘못된 발신까지 진행하여 모의 발신의 빈 반환값에서 오류가 났고, 모의 응답을 보완했습니다. 수정 뒤에는 원래 오류 전파·선점 해제·넘김 없음·재시도 성공을 확인합니다. 초안 세 건과 이전 넘김 질문 제외도 통과했습니다. 사장님 외 범위 세 종류와 기존 시험을 포함한 관련 네 파일은 `Test Files 4 passed (4)`, `Tests 50 passed (50)`입니다. 명령에 적은 존재하지 않는 `kakao-ai-turn.test.ts`는 실행되지 않았으므로 시험 파일 수에 넣지 않았습니다.

플레이스홀더를 제거한 뒤 문장이 어색해질 가능성은 프롬프트로 줄이되, 문법 품질까지 통과로 주장하지 않습니다. 번호를 복원하거나 그대로 발신하지 않는 조건과 빈 답 거절은 유지합니다. 실제 스테이징 열 권한 적용과 로그·모델 전환 확인은 여전히 미확인입니다.

검토 수정 원본 `bd2959e8906bfe43ef17b425ae29c09bba262447`의 새 빈 PostgreSQL 전체 검사를 완료했습니다. 마이그레이션 34개, 서버 `Test Files 109 passed (109)`·`Tests 2287 passed (2287)`, 웹 `Test Files 65 passed (65)`·`Tests 1570 passed (1570)`, 웹 `built in 1.21s`, 두 Worker `--dry-run: exiting now.`이며 시험·빌드 종료는 모두 0입니다. 타입 검사 종료 0, `Checked 480 files in 793ms. No fixes applied.`입니다. 환경 재시작으로 중단된 앞 로그는 성공으로 세지 않고 새 실행 `siljang-task066-review-restart-0150`의 완료 상태와 원본을 확인했습니다.

PR #224 병합 뒤 Claude 재검토 댓글 `7118971639`의 경고 로그 이름·요청 추적 ID 보완 한 건은 별도 TASK-064 브랜치 `codex/task-064-warning-log`에서 이어갑니다. TASK-066에 다른 작업 코드를 섞지 않습니다. 실제 스테이징 권한·로그·모델 설정 전환 확인은 여전히 남아 있으며 끝남/구현 완료 표시는 바꾸지 않았습니다.

### (622) TASK-067 가게 규칙 견적

- TASK-067의 SPEC-013 자동 조건6개를 실제 PostgreSQL 자료로 작성했습니다. 35000원/버전3/72시간, 없는3단, 85000원부터 맞춤, 사진이 있으면 확정 금액의 맞춤, 요청한 주문의 옛 가격/규정 버전, 0원 차단/에스컬레이션입니다. 아직 quotes 모듈이 없어 최초 실행은 시험 수집 실패·실행된 사례0개입니다. 이를6개 기능 실패로 세지 않습니다. 일반 계산은 새 활성 초안으로, 버전 고정 사례만 요청한 주문으로 나누어 자료를 맞췄습니다. 다음은 계산/저장 모듈 구현과6개 실제 실행입니다.
- main221 b4026bff4231002143c70ac53b475819a04bd5e0의 완료33개·구현 완료20개를 기준으로 시작합니다. 앞선 TASK-063의 main CI/배포/실제 태그와 health200도 확인했습니다. TASK-064 리뷰 수정 전체 검사와 TASK-066 남은 수락 대조를 기다리는 동안 독립 견적 모듈을 진행합니다. npm ci161개11초이며 기록622·README330을 예약합니다. 실제 API0건·비용0원입니다.

- 견적 계산/저장과 사장님 넘김을 구현했습니다. 금액은 버전의 옵션·함께 고르는 규칙으로만 계산하고, 확정/부터/범위와 기본 디자인/맞춤을 서버가 정합니다. 참고 사진·빼야 할 재료·범위 밖 옵션/도안은 맞춤이며0원/없는 옵션은 견적을 남기지 않고 cannot_answer로 넘깁니다. 요청한 주문은 받은 가격/규정 버전을 사용합니다. 공개용 customerQuote는 금액·표시 방식·유효 기한만 돌려줍니다.
- 최초 모듈 부재의 수집 실패 뒤 실제6개 실행은 옛 extra_option_ids 컬럼 때문에 모두 실패했습니다. 최신 마이그레이션의 order_draft_extras를 읽게 한 뒤4개 통과/2개 실패였고, 넘김 시험에 필요한 가게 응답 시간 자료를 넣어6개가 통과했습니다. 같은 금액/다른 선택이 이전 견적 ID를 재사용하는1개 실패/6개 통과를 더해 표시 방식·주문 종류·상한·정렬한 전체 근거를 함께 대조하도록 고쳤습니다. 관련7개와 타입 검사가 통과했습니다.
- 다음은 범위/옵션 규칙·교차 가게·공개 노출·제한 DB 역할·현재 main222 결합과 새 빈 DB 전체 검사입니다. AI가 계산값을 쓰는 전체 업무 연결은 TASK-069가 이어가며 WBS 완료/구현 완료는 아직 표시하지 않습니다. 실제 API0건·비용0원입니다.

- TASK-067의 범위 양끝+조합 추가금·부터 우선·중복 옵션 한 번·금지 조합·손님 공개 투영·교차 가게404·없는 버전404·동일 견적 재사용/만료·알레르기 제외/제외 재료 판정을 보강해16개가 통과했습니다. 새9개는 첫 실행부터 통과했으며 제품 실패 재현으로 세지 않습니다. 형식/lint476파일975ms 오류/경고0이고 타입 검사를 마쳤습니다.
- 현재 공개 API/AI 그래프 연결은 TASK-069에서 이어갈 공통 계산 함수입니다. SPEC-013 #5의 요청 당시 운영규정 선택은 확인했지만 실제 환불 계산 대조를 남겼고, 제한 역할/새 빈 PostgreSQL 전체 검사도 남아 있습니다. 완료/구현 완료 표시는 하지 않습니다. 실제 API0건·비용0원입니다.

- SPEC-013 #5의 요청 당시 규정 계산을 quoteOrderCancellation 공통 함수로 대조했습니다. 새 규정3의 비율이0%여도 주문이 받은 규정2의35000원, 고정 수수료를 먼저 뺀 뒤 비율/원 미만 버림, 이미 정한 환불과 별도 몫, 가게 사정 전액, 제작 뒤71시간30분의 단계 선택, 다른 가게404를 확인했습니다. 정수 상한과 음수/소수/상한 밖 거절도 더했습니다. 비율 곱셈은 BigInt로 해 원 단위를 잃지 않습니다.
- 입력의 받은 금액/이미 정한 환불/별도 환불 몫은 호출자가 검증한 배분 결과를 받습니다. 수입 배분 조회·재제작의 원래 주문 자금 선택·API-049/실제 환불 결정·송금은 TASK-121 및 해당 업무 흐름에서 이어갈 범위이며 이 공통 계산을 그 작업 완료로 세지 않습니다. 견적16개·규정 계산10개·제한 역할10개를 합친3파일36개가 통과했고 타입 종료0·형식/lint478파일650ms 오류/경고0입니다.
- 새 계산 모듈 첫 실행은 파일 미작성으로 시험0개 수집 실패였고 구현 뒤 관련22개가 통과했습니다. 제한 역할은 새 견적1개 실패/기존9개 통과로 읽기 권한 부족을 확인했고, 필요한 초안/주문 버전/원래 픽업·제작 시각 읽기와 quotes 새 행만 허용해 고쳤습니다. 실제 스테이징 역할 적용은 미확인이며 기존 수정/삭제 금지는 유지합니다. 실제 API0건·비용0원입니다.
- 현재 main223의 WBS 완료35개입니다. 이 main과 결합해 새 빈 PostgreSQL 전체 검사·SPEC-013 #1~6/API-070 수락 표를 채우고 완료 여부를 대조합니다. 아직 finished/구현 완료를 표시하지 않습니다.

- main223를 결합한 원본fcf56443c43975edb382aa0a589cf0fea2b8b708의 새 빈 PostgreSQL 마이그레이션34개·서버109파일2,275개·웹65파일1,570개·웹 빌드712ms/두 Worker가 통과했습니다. 견적16개·받은 규정 계산10개·제한 역할10개를 포함한 전체 결과입니다. 합쳐진 파일의 형식/lint도 오류/경고0입니다. 실제 외부 호출0건·비용0원입니다.
- 현재 main 완료35개이며 finished/구현 완료 표시는 아직 바꾸지 않습니다. 요청 전 초안에 옛 가격표가 남은 뒤 가격표를 바꿨을 때 기본 계산이 현재 버전을 고르는지도 대조한 다음 수락 표를 확정합니다. API/전체 AI 답 연결은 TASK-069의 별도 흐름이며 공통 계산 함수를 그 흐름 완료로 세지 않습니다.

- SPEC-013의 전제가 현재 가격표임을 대조해, 요청 전 초안에 옛 가격표가 남으면 기본 계산이 옛35000원/버전3을 고르는1개 실패/기존16개 통과를 재현했습니다. 버전 명시가 없고 아직 요청된 주문이 없으면 현재 가격표로 계산해38000원/버전4를 쓰도록 고쳤습니다. 버전3을 명시한 계산과 이미 요청된 주문의 버전 고정은 유지합니다.
- 견적17개·받은 규정 계산10개·제한 역할10개를 합친3파일37개·타입 종료0·형식/lint479파일867ms 오류/경고0입니다. 필요 없어졌던 초안 가격표 ID 읽기와 권한을 없앴습니다. 모델 문맥의 현재 견적도 TASK-066에서 같은 수정 번호/현재 가격표/유효 시각에 맞추며 실제 AI 답의 연결은 TASK-069가 이어갑니다.
- 가격표 수정 원본824f9ad와 main224를 결합한 원본9b99b91의 새 빈 PostgreSQL 전체 검사를 진행 중입니다. 이전 원본fcf5644의 전체2275개 결과와 이번37개를 구분합니다. main224의 배포 확인도 진행 중이며 아직 완료/구현 완료 표시는 하지 않습니다. 실제 API0건·비용0원입니다.

- main224 결합 제품 원본9b99b9130e524d9f64312b124583abc6e1e8dc70의 새 빈 PostgreSQL 마이그레이션34개·서버109파일2,289개·웹65파일1,570개·웹 빌드1.02초/두 Worker가 통과했습니다. 견적17개·받은 규정 계산10개·제한 역할10개와 최종 타입/형식/lint를 확인합니다. SPEC-013 #1~6·API-070 기존 네 응답과 범위/조합/분리/만료를 수락 표로 대조했습니다.
- 현재 가격표 기본 선택/명시 버전/요청 당시 버전 고정과 받은 규정의 실제 금액 계산까지 자동 조건을 채워 TASK-067 finished를 원본에 쓰고 생성합니다. 현재 main 완료35개이며 이 PR 제안은36개입니다. 전체 AI 답/실제 결제·환불·장부 전송을 구현했다고 세지 않으며 실제 API0건·비용0원입니다.
- 기준 main224의 app45303158836/db45303158901·배포138141734437 성공, 실제 전체 태그4d16e10c5fd3933b0eaf86eed5199bc30f6dd724·앱cedda0c0-2b5f-415d-809d-fff43bf2a5af 활성100%·health200과 원격 ref 일치를 확인했습니다. 학원컴 whoami/저장소 태그 재조회는 기존 보류입니다. 다음은 ready PR의 CI·Claude 코드/보안 리뷰·수동 리뷰 한 번과 main 확인입니다.

PR #226의 Claude 검토(`5c3f5c1`, 댓글 `7119401658`) 발견 5건을 처리했습니다. 견적 계산은 손님·상담을 다른 콜백과 같은 순서로 잠근 뒤 초안을 잠그며, 종료·삭제·문의 끊김 상담은 `not_found`로 거절합니다. 현재 가격표의 도안은 이전 도안의 이름으로 찾고, 이름이 사라졌을 때만 `design_missing`으로 넘깁니다. 고른 도안의 값 옵션을 초안의 별도 디자인 옵션보다 우선하여 행 조회 순서에 따라 금액이 달라지지 않도록 했습니다. 명시한 선택은 기존대로 우선합니다.

견적은 해당 초안의 가장 최근 견적일 때만 재사용합니다. A·B·A 계산에서 마지막 A는 새 견적이 됩니다. 이미 받은 주문의 버전과 다른 버전을 명시하면 조용히 무시하지 않고 `not_found`로 거절합니다. 버전 선택의 SQL과 인자는 공통 함수에서 함께 만듭니다. 손님 경로에서 버전·선택을 그대로 받지 않는 조건과 취소 계산의 검증된 자금만 받는 경계는 TASK-069·121 연결 조건으로 유지합니다.

새 시험은 처음 `Tests 7 failed | 18 passed (25)`였고, 그중 상담 종료 시각 세 건과 도안 이미지 키 누락 한 건은 시험 자료 오류였습니다. 자료를 고친 뒤 이전 제품 코드로 다시 실행해 `Tests 7 failed | 18 passed (25)`를 확인했습니다. 수정 뒤 관련 견적·취소 계산·runtime 권한 세 파일은 `Test Files 3 passed (3)`, `Tests 45 passed (45)`입니다. 타입 검사와 format 뒤 lint도 종료 0입니다. 전체 검사를 새 원본으로 이어갑니다.

실제 스테이징 새 열 권한 적용과 실제 AI 경로 연결은 미확인입니다. 외부 모델·카카오·결제·환불 송금은 호출하지 않았습니다. TASK-067의 자동 수락 기준 충족 표시와 다른 업무의 미구현 범위를 유지합니다. 병합 뒤 main 검사와 실제 배포 증거를 확인하겠습니다.

검토 수정의 첫 전체 검사는 `Tests 1 failed | 2296 passed (2297)`였습니다. 버전 선택 공통 함수에서 테이블 이름을 문자열에 끼워 넣어 기존 가게 범위 SQL 정적 검사가 실패했습니다. 허용 테이블 두 개만 쓰는 코드였지만 정적 검사 규칙을 낮추지 않고, 여섯 가지 SQL을 완전한 고정 문자열로 선언하도록 고쳤습니다. 정적 검사·견적·환불·runtime 권한 네 파일 `Test Files 4 passed (4)`, `Tests 66 passed (66)`이며 format 뒤 lint가 종료 0입니다. 실패한 전체 실행은 웹 시험·빌드 통과로 세지 않습니다. 새 원본을 커밋하고 새 빈 PostgreSQL 전체 검사를 다시 실행합니다.

PR #225를 squash한 main `ee3ce8bfea7d32d6b417f82060afac83bc40042f`를 반영했습니다. 견적·환불 runtime 시험과 main의 목적별 개인정보 출력 시험을 모두 보존했고, 두 작업의 필요한 열 권한을 합쳤습니다. API-072의 금액 비조회 설명과 공용 역할의 사장님 출력 권한은 구분했습니다. 기록 번호 622·README330과 main의 621·README329는 원래 번호대로 보존했습니다. 이전 hands-on의 앞·뒤 추가 기록도 모두 보존했습니다.

정적 SQL 수정 원본 `bfb2835b2489e227437f1d36e31d886fa5dedbe3`의 새 빈 PostgreSQL 마이그레이션 34개·서버 109파일2297건·웹65파일1570건·웹 빌드1.64초·두 Worker 빌드가 통과했습니다. 새 main 결합 뒤 관련 여섯 파일은 `Test Files 6 passed (6)`, `Tests 91 passed (91)`이며 타입과 format 뒤 lint는 종료 0입니다. 결합 원본의 새 전체 검사를 다시 실행합니다.

main225의 app45309196170/db45309196156·check138160381422·Windows138160381944·PostgreSQL16.15 138160381367/17.11 138160381641·배포138162230801가 모두 성공했습니다. 실제 Wrangler 검증은 전체 태그 일치·앱3dc38ed7-d384-4f0c-bb42-41b910f7cadb(2026-11-24T02:05:36.534469Z) 활성100%·health200이며 원격 ref도 같았습니다. 보존한 main225-deployment.json은 이 실제 결과입니다. 학원컴 인증/저장소 활성 태그 직접 재조회와 스테이징 새 열 권한 적용은 미확인으로 유지합니다.

main225 결합 원본 `7c7373cf3d41d7f5b6e727bcee60176e1c71ecd8`의 새 빈 PostgreSQL 마이그레이션34개·서버 `Test Files 111 passed (111)`·`Tests 2323 passed (2323)`가 통과했습니다. 이어진 웹 전체에서는 기존 PublicPrivacyScreen.interaction의 알림 영역 확인 한 건이 실패해 `Tests 1 failed | 1569 passed (1570)`였고 빌드는 실행하지 않았습니다. 웹 원본을 바꾸지 않고 실패한 파일을 단독 재검사해18건 통과, 웹 전체 재실행은 `Test Files 65 passed (65)`·`Tests 1570 passed (1570)`입니다. 그 뒤 웹 `built in 751ms`와 두 Worker `--dry-run: exiting now.`가 종료0으로 끝났습니다. 첫 전체 명령의 실패를 성공으로 덮어쓰지 않습니다.

타입과 format 뒤 lint는 종료0이며 최종 키·WBS·용어 검사와 차이를 확인합니다. 현재 원본의 코드·시험 변경은 Claude 발견5건 처리와 main 반영뿐입니다. 실제 스테이징 새 열 권한 적용, AI 도구 연결과 실제 결제·환불 송금은 미확인입니다. TASK-067은 SPEC-013 #1~6 자동 조건의 finished 제안을 유지하며 현재 main 완료35개를36개로 제안합니다. 별도 TASK-068과 함께 합칠 때 생성기로 다시 셉니다.

### (623) TASK-184 첫 고지와 정책 재발행 연결

- TASK-184의 남은 첫 AI 고지 연결을 main222에서 대조했습니다. 새 회사/나라/시기·방법/목적·기간/거부 절차를 쓴 배포 설정과 고정 문장만 바꾼 설정 각각에서 첫 AI 고지의 저장 버전과 공개 API-039의 버전이 같고, 새 버전이 하나만 생기며 이전 글/국외 이전/게시 시각과 지난 상담 버전1이 보존됨을 새 PostgreSQL 시험2개로 확인했습니다. 두 시험은 첫 실행부터 통과했고 기존 재발행8개와 합쳐10개가 통과했습니다. 앞선 TASK-064의 구현을 확인한 회귀이며 제품 코드는 바꾸지 않았습니다.
- 현재 main83b795a7edb2d691c240797dae6a3314558256e9의 완료34개·구현 완료20개·시작 가능40개입니다. 낮은 반복의 접속/예전44건 원문 대기는 그대로이며, 같은 반복2에서 뒤에8개가 기다리는 TASK-184의 남은 조건을 우선 대조합니다. 기록623·README331을 예약합니다. 다음은 새 빈 PostgreSQL 전체 검사와 SPEC-010 #5~9/A39·WBS 끝난 조건 대조입니다. 완료 표시는 아직 바꾸지 않습니다. npm ci161개10초·실제 API0건·비용0원입니다.
- main222의 app45293266692/db45293266654·check138107160737·Windows138107161187·PostgreSQL16.15 138107161175/17.11 138107161575·배포138108633604가 모두 성공했습니다. 실제 Wrangler 전체 태그 83b795a7edb2d691c240797dae6a3314558256e9·앱2e1e3897-2068-4f4c-8ef5-5dfdf3a941e9(2026-11-24T00:02:04.723868Z) 활성100%·health200입니다. 학원컴 whoami/저장소 활성 태그 재조회는 기존 보류를 유지합니다.

- TASK-184의 SPEC-010 #5~9·A39·WBS 끝난 조건을 수락 표와 대조했습니다. 기존 가게 정보/본문 비교8개와 첫 고지2개에 여러 발급 가게/미발급 가게0개·동시 저장 충돌 후 재시도2개를 더해 관련12개가 통과했습니다. 새 두 사례의 첫 실행에서 시험 자료를 같은 연결로 병렬 생성한 오류5개, 이를 고친 뒤 합성 상담의 외래 키를 남기고 정책을 지운 오류1개가 있었고, 자료를 순차 생성하고 합성 고지 참조를 먼저 비워 해결했습니다. 제품 실패 재현으로 세지 않습니다.
- 제품/시험 원본882f369d740ace79a9e815d85689495659d53d3d에서 새 빈 PostgreSQL 마이그레이션34개·서버107파일2,247개·웹65파일1,570개·웹 빌드816ms와 두 Worker가 통과했습니다. 타입 종료0·형식/lint475파일923ms 오류/경고0입니다. 제품 코드는 main222와 같으며 실제 API0건·비용0원입니다. 먼저 통과한2,245개 결과와 별도로 추가 시험까지 다시 전체 검사했습니다.
- currentPrivacyPolicy 하나가 가게 행을 FOR NO KEY UPDATE로 잠근 안에서 지금 만들 전체 글과 국외 이전 모든 값을 비교합니다. API-010 저장·API-039 공개 읽기·첫 고지 준비가 같은 함수를 써 배포 직후 첫 읽기에도 옛 값을 전하지 않고 같은 내용이면 새 버전을 만들지 않습니다. 일괄 배포 작업 없이 가게별 첫 사용 때 원자적으로 견주어 동시 요청의 중복 발행을 막는 방법을 골랐습니다. 과거 글/게시 시각과 이미 고지한 상담 버전은 고치지 않습니다.
- TASK-184 finished를 원본에 반영하고 생성합니다. 현재 main의 완료는34개이며 이 PR이 합쳐지면35개입니다. 실제 스테이징 계정/정책 법률 검토·학원컴 화면/모바일과 기존 접속 대기는 이 자동 검사의 통과로 바꾸지 않습니다. 다음은 ready PR의 app/db CI·Claude 코드/보안 리뷰와 병합 직전 수동 리뷰 한 번, main CI/배포/실제 원격 전체 태그 확인입니다. TASK-064 병합 뒤 검토7117799838의 발견4건은 별도 후속 PR에서9개 실패를 재현해 진행합니다.

- PR #223의 Claude 코드/보안 리뷰7118198722(head8bcaec36d98291773574c14cbd77d541530c64e6)는 낮음6건·보안0건입니다. 1번은 정책0개인 미발급 가게에 실제 API-010 저장200을 보낸 뒤0개를 확인하도록 보강했습니다. 2번은 국외 이전3개 길이를 먼저 검사합니다. 3번은 버전1 고지 상담이 새 배포 뒤 두 번 실제 수신/모의 콜백을 받아도 재고지/시각·버전 덮어쓰기 없이1을 보존하는 새 사례를 더했습니다.
- 4번은 실제 readPrivacyPolicySettings 파서로 합성 설정을 만들고 모델/서버의 개인정보 항목 차이를 그대로 씁니다. 5번은 외부 호출 없음 검사가 실패해도 finally에서 모의를 복원합니다. 6번의 공통 모의 모델/요청 도우미 추출은 급하지 않은 선택적 리팩터링이라 이번 수락 근거 보강에서 보류하며, 계약 변경 때 기존 고지/재발행 파일을 함께 고칠 일로 남깁니다.
- 보강한2파일13개는 첫 실행부터 통과했고 제품 코드는 바꾸지 않았습니다. 형식/lint·타입 검사도 마쳤으며 다음은 현재 시험 원본의 새 빈 PostgreSQL 전체 검사와 최종 head CI/발견별 처리 댓글입니다. 완료 제안35개와 현재 main34개를 구분하고, 실제 외부 호출0건·비용0원을 유지합니다.

- 리뷰 보강 원본eb2bb1aff01ac34a510b0934fc8095d6d0c7fc05의 새 빈 PostgreSQL 마이그레이션34개·서버107파일2,248개·웹65파일1,570개·웹 빌드1.24초/두 Worker가 모두 통과했습니다. 관련13개·타입 종료0·형식/lint475파일802ms 오류/경고0입니다. 앞선0038 실행은 작업 환경 재시작으로 중단돼 통과로 세지 않았고, 새0041 실행의 종료0/전체 결과를 확인했습니다.
- Claude 발견1~5를 시험/정리 코드에 반영했고6번의 선택적 도우미 추출은 위 이유로 보류합니다. 현재 제품 코드는 그대로입니다. 최종 수락 표와 TASK-184 finished의 검사 수를13개/서버2248개로 맞춰 생성합니다. 현재 main34개/이 PR 제안35개를 구분하며, 다음은 최종 head CI·리뷰 처리/재리뷰 요청·병합 직전 수동 리뷰 한 번과 squash/main 배포/실제 전체 태그 확인입니다. 실제 외부 호출0건·비용0원입니다.

### (624) TASK-064 병합 뒤 고지 경계 수정

- TASK-064 PR #222의 병합 뒤 Claude 코드/보안 리뷰7117799838(head b77a8fa1ce6ddd9f1563744a0000970f943c5ba7)의4건을 후속으로 처리합니다. 실제 PostgreSQL·모의 모델/카카오 회귀를 더해9개 실패/기존16개 통과를 재현했고 수정 뒤25개가 통과했습니다. 수신 한도 뒤 불필요한 정책 읽기1개 실패/26개 통과도 재현해 공통 한도 값을 써 막았습니다. 마스킹 실패 첫 넘김을 포함한 관련4파일117개가 통과했습니다.
- 1번은 dropped의 고지 전 AI 답을 선택에서 빼 뒤 사장님 안내가 전해지게 합니다. 문의 끊김에는 다시 고지하지 않는 기존 SPEC-018을 지키는 선택입니다. 2번은 발신 직전 정책 불가로 넘길 때 자기 선점 확인·넘김과 같은 트랜잭션에서 만들어 둔 AI 답을 failed로 바꿉니다. 3번은 즉시/콜백 모두 AI 설정 여부를 따르고, 실장님 봇 결정 안내7117874934가 체크포인트 위임 승인으로 전한 상태 문장만 SPEC-018 원본에 추가해 생성했습니다. 기존 주 동작/수락 기준은 바꾸지 않았으며 출처는 결정 기록에 남깁니다.
- 4번은 가게 잠금 전에 가게/손님 범위의 중복·이미 고지함·문의 끊김·수신 한도를 잠금 없이 읽어 불필요한 정책 트랜잭션을 생략합니다. 정책 읽기 실패는 준비 불가로 처리해 고지 없는 AI 답을 열지 않고 기존 사장님/스티커 안내는 유지합니다. 손님 잠금 전에 정책을 고르는 기존 잠금 순서는 지킵니다.
- npm ci161개11초·타입 종료0·형식/lint474파일641ms 오류/경고0이며 실제 API0건·비용0원입니다. 기록624·README332를 예약합니다. 완료 수는 바꾸지 않으며 현재 main34개, TASK-184 PR #223 제안35개입니다. 다음은 현재 원본의 새 빈 PostgreSQL 전체 검사·설계 단계 검사와 Claude 후속 리뷰·CI/병합/main 배포 확인입니다. 학원컴 브라우저/추가 whoami는 기존 보류를 유지했습니다.

- 후속 제품 원본6a556bf20613ffd1846faca2af6cdc96a160b1e0에서 새 빈 PostgreSQL 마이그레이션34개·서버106파일2,254개·웹65파일1,570개·웹 빌드843ms와 두 Worker가 모두 통과했습니다. 관련 고지27개/4파일117개·타입 종료0·npm ci161개11초·형식/lint474파일641ms 오류/경고0입니다. 설계 단계 검사는 --no-api --no-browser로 종료0이며 목업13개 통과/실제 page-check1개 미확인, WBS18개 오류0입니다.
- Claude 병합 뒤 리뷰7117799838의1·2·3·4번과 결정 안내7117874934를 위 처리/결정 기록에 연결합니다. 고지 시각은 실제 성공 때만 기록하고, 새 실패 표시는 자기 선점을 확인한 같은 트랜잭션에서 그 차례의 미전달 AI 답 하나에만 적용합니다. 문의 끊김의 지난 AI 답은 전하지 않되 뒤 사장님 안내는 전합니다. 실제 모델/카카오 호출0건·비용0원이며 완료 수는 바꾸지 않습니다.
- 다음은 ready 후속 PR의 현재 app/db CI·Claude 코드/보안 리뷰, 병합 직전 수동 리뷰 한 번과 squash/main CI·배포·실제 원격 전체 태그 확인입니다. TASK-184 PR #223의 현재 app/db는 성공했고 Claude 리뷰를 기다립니다. 학원컴 CDP/추가 whoami 보류는 유지했습니다.

- PR #224의 Claude 코드/보안 리뷰7118367438(head155917c7b84dd9988d1611454ccb6efb99943370)는 중간1·낮음2·보안0건입니다. 발견1은 콜백의 공통 정책 읽기가 not_found만 준비 불가로 바꾸고 나머지 오류를 다시 던지도록 고쳤습니다. 즉시 응답의 빠른 확인만 실패를 받아 기존 안내를 유지하며 errorName/dbCode/정해진 code를 남기고 원문은 기록하지 않습니다. 발신 직전40001 오류에서 AI 답/고지/선점을 보존해 재시도하고 모델을 다시 부르지 않는 사례를 더했습니다.
- 발견3은 후기 카드를 제외하는 recentKakaoInboundCount 하나를 수신/빠른 확인이 함께 씁니다. 같은 가게 손님의 1분 수신을 한도+2까지만 읽는 기존 상한도 지켰습니다. 글19개+후기 카드1개 뒤20번째 글의 즉시 고지를 더해 두 새 사례는2개 실패/기존27개 통과를 재현한 뒤 고쳤습니다. 관련5파일133개가 통과했습니다. DB 오류 로그 시험의 일반 Error가 SQLSTATE 대상이 아닌 것을 확인해 실제 pg.DatabaseError로 바꾸었고, 시험 생성자의 타입 선언에 맞춘 뒤 타입 종료0입니다.
- 발견2의 잠금 없는 확인과 수신 사이에 기존 상담이 끝나 새 상담이 열리는 경쟁 구간은 이번 수정에서 남깁니다. 그 첫 즉시 넘김/지원하지 않는 메시지 안내의 고지가 빠질 수 있지만 AI 답은 콜백의 고지 재확인 뒤에만 나갑니다. 가게→손님 잠금 순서와 흔한 고지 완료 경로의 가게 잠금 생략을 유지하기 위한 선택이며 발생 빈도는 측정하지 않았습니다. TASK-076의 종료/재개 연결에서 관측을 함께 검토할 일로 남깁니다.
- TASK-184 PR #223은 main1cbf9a2051ec3f6ce70162eba8e513e9c19f8934에 squash했고 main CI/배포 확인을 진행 중입니다. WBS의 현재 완료35개·구현 완료20개·시작 가능40개입니다. 다음은 이 main 결합 뒤 현재 제품의 새 빈 PostgreSQL 전체 검사와 최종 CI/리뷰 처리/main 확인입니다. 실제 외부 호출0건·비용0원이며 학원컴 CDP/추가 whoami 보류를 유지합니다.

- main223를 결합한 제품 원본b2c9e060691571a88b22b4a178579c0c20bf5858의 새 빈 PostgreSQL 마이그레이션34개·서버107파일2,261개·웹65파일1,570개·웹 빌드1.17초와 두 Worker가 모두 통과했습니다. 추가 두 회귀를 포함한 관련5파일133개·최종 타입 종료0·형식/lint475파일807ms 오류/경고0입니다. 기록 충돌은 README332/수정624와 부모331/623의 번호·본문을 모두 보존해 해결했고 충돌 표시0을 확인했습니다.
- main223 1cbf9a2051ec3f6ce70162eba8e513e9c19f8934의 app45300601716/db45300601686·check138131870819·Windows138131871526·PostgreSQL16.15 138131871162/17.11 138131871459·배포138133239615가 성공했습니다. 실제 Wrangler verify의 전체 태그 일치·앱4c7b01be-3df5-48bd-9ed3-7146242c9479(2026-11-24T00:55:43.635464Z) 활성100%·health200과 원격 main ref 일치도 확인했습니다. 현재 완료35개·구현 완료20개·시작 가능40개입니다.
- 리뷰7118367438의1·3번을 고치고2번의 짧은 상담 교체 경쟁 구간을 위 이유로 남깁니다. 다음은 최종 공개 head에 발견별 처리와 재리뷰 요청을 연결하고 현재 CI·병합 직전 수동 리뷰 한 번/squash/main 확인입니다. 실제 외부 모델/카카오 호출0건·비용0원이며 학원컴 CDP/추가 whoami/저장소 태그 재조회는 기존 보류를 유지합니다.

### (625) TASK-068 날짜 판정과 마감 날짜 확인

TASK-068을 시작했습니다. 캘린더의 기존 60일 판정과 정원 계산을 재사용해 휴무·마감·범위 밖을 구분하고, 앞뒤 14일 안의 가까운 가능한 날을 세 개까지 고릅니다. 조회는 자리와 날짜 행을 만들지 않습니다. 마감 날짜를 다시 요청한 경우에도 안내 메시지의 실제 전달 표시를 확인한 뒤에만 `closed_day` 질문·할 일·발신 대기 알림을 기록합니다. 이후 TASK-069에서 안내 전달 확정과 같은 트랜잭션에 연결할 함수를 제공합니다.

처음 시험은 모듈이 없어 수집에 실패했습니다. 구현 뒤 `booking-capacity.test.ts`는 `Test Files 1 passed (1)`, `Tests 8 passed (8)`입니다. 휴무와 가까운 날, 실제 정원 소진, 안내 전 대기와 안내 후 넘김, 재요청 중복 방지, 60일 범위, 대안 없음, 마감 시각 경계, 다른 가게 차단을 로컬 PostgreSQL에서 확인했습니다. `npm ci`는 `added 161 packages`(15초)입니다. 실제 카카오 발신과 스테이징 권한 적용은 확인하지 않았습니다. 외부 모델·카카오·결제 호출은 0회입니다.

다음 단계는 동시 요청·같은 날 추가 질문과 runtime 역할 권한 시험, 전체 검사, 수락 조건 대조입니다. 아직 끝남이나 구현 완료를 표시하지 않습니다.

동시 중복과 같은 날짜의 재요청, 휴무일의 재요청 차단, 다른 메시지의 안내 증거 거절, 앞뒤 14일 제한을 더했습니다. 처음 동시 시험은 한 연결을 공유해 `nested transaction` 두 건이 났습니다. 요청마다 별도 연결을 사용하고 둘 다 끝난 뒤 닫도록 시험을 고쳤습니다. 이후 같은 날짜 건에 일반 추가 질문을 넣던 제품 코드 한 건이 `handoff_questions_reason_check`로 실패했습니다. 원본 설계는 마감 날짜 건에 일반 추가 질문을 붙이지 않으므로, 같은 열린 날짜 건을 재사용하고 할 일·알림을 다시 만들지 않게 고쳤습니다. 추가 질문 테이블과 제약은 바꾸지 않았습니다.

독립 연결 동시 시험을 포함한 날짜 시험은 `Tests 11 passed (11)`입니다. 제한된 runtime 역할에서 날짜 판정과 안내 전달 뒤 기록·중복 방지·자리 0건을 확인했고, 두 파일 `Test Files 2 passed (2)`, `Tests 21 passed (21)`입니다. 그 뒤 15일 밖 대안 제외 시험과 API-070 기존 응답 시험을 함께 실행하고 있습니다. runtime 시험 import 순서의 lint 오류 1건은 정리했습니다. 최종 결과를 확인한 뒤 main225 변경을 반영하겠습니다.

실제 카카오로 마감 안내를 발신하거나 스테이징에 새 SQL 권한을 적용한 것으로 세지 않습니다. TASK-069가 안내 전달 확정과 같은 트랜잭션에서 함수를 호출해야 하며, 그 경로를 아직 연결하지 않았습니다. 조회 결과에는 남은 자리 수가 없습니다. 실제 외부 모델·카카오·결제 호출은 0회입니다.

main225를 반영한 뒤 날짜·runtime·스킬·AI 문맥·목적별 출력·AI 실패 여섯 파일은 `Test Files 6 passed (6)`, `Tests 74 passed (74)`이며 타입과 format 뒤 lint는 종료 0입니다. 날짜 시험은 앞뒤14일 경계를 포함한 12건입니다. 실제 PostgreSQL의 자리와 시간대·원하는 날짜를 사용했고 새 자리를 만들지 않는 조건을 확인했습니다. 수락 조건 대조를 capacity/2026-11-24/task-068-acceptance.md에 적었습니다. 원본 `c8d99387b700a2be96aa6fc749ca3b4ed8e0bd8c`의 새 전체 검사는 실행 중입니다.

기준 main225 `ee3ce8bfea7d32d6b417f82060afac83bc40042f`의 app45309196170/db45309196156·check138160381422·Windows138160381944·PostgreSQL16.15 138160381367/17.11 138160381641·배포138162230801가 모두 성공했습니다. 실제 Wrangler 전체 태그·앱3dc38ed7-d384-4f0c-bb42-41b910f7cadb(2026-11-24T02:05:36.534469Z) 활성100%·health200과 원격 ref 일치를 확인했고 main225-deployment.json에 보존합니다. 실제 학원컴 인증·저장소 태그 직접 재조회, 스테이징 새 열 권한 적용과 카카오 발신은 미확인입니다. 전체 AI 날짜 도구 연결은 TASK-069입니다.

날짜 판정 원본 `c8d99387b700a2be96aa6fc749ca3b4ed8e0bd8c`의 새 빈 PostgreSQL 전체 검사가 끝났습니다. 마이그레이션34개, 서버 `Test Files 110 passed (110)`·`Tests 2300 passed (2300)`, 웹 `Test Files 65 passed (65)`·`Tests 1570 passed (1570)`, 웹 `built in 2.25s`, 두 Worker `--dry-run: exiting now.`이고 시험·빌드 종료가 모두 0입니다. API-070의 200·401·422·default 응답은 기존 kakao-http-contract 시험을 전체 실행에서 확인했습니다. 타입과 format 뒤 lint도 종료 0입니다.

SPEC-014 #1~2·A3·A4와 날짜 범위·마감·대안·동시 중복·제한 역할을 수락 조건 표와 대조해 TASK-068의 finished를 원본에 표시하고 생성했습니다. 현재 main 완료35개이며 이 브랜치의 제안은36개입니다. TASK-067도 별도 완료 표시를 제안 중이므로 합칠 때 원본에서 다시 생성합니다. 이 숫자를 현재 main 완료로 세지 않습니다. 실제 AI 날짜 도구 연결은 TASK-069이며, 실제 카카오 발신·스테이징 SQL 권한 적용과 학원컴 직접 재조회는 미확인입니다.

다음은 최종 WBS·단계·용어·키 검사 뒤 준비된 PR과 코드·보안 검토입니다. 현재 TASK-067·TASK-064 후속의 main 결합 전체 검사와 TASK-072 준비도 계속합니다. 모든 작업이 확인 대기 상태가 아닙니다.

PR #227의 Claude 코드·보안 검토(`86788f6`, 댓글 `7120014767`) 발견7건을 처리합니다. 보안 발견은0건입니다.

1. 지연 전달 뒤 연결은 제안 (가)를 적용했습니다. TASK-069의 원본 완료 조건에 수신 ID·날짜의 영속 보존, deferred 안내가 다음 대화에서 delivered_later로 확정된 뒤 같은 트랜잭션의 closed_day 건·할 일·알림 한 건, 큐 재시도·프로세스 재시작 뒤 중복0건을 명시했습니다. 이 전체 수신 경로를 지금 확인했다고 세지 않습니다.
2. 기존 요청을 날짜 재판정의 조기 반환보다 먼저 조회합니다. 최초 날짜 결과의 공개 필드만 보관해 날짜가 다시 열리거나 기간 밖이 된 재처리에도 같은 결과를 반환합니다.
3. 같은 열린 날짜 건을 재사용한 수신 ID는 owner_tasks.detail의 내부 목록에 남깁니다. 건이 닫힌 뒤 재처리되어도 원래 건을 찾고 새 할 일·알림을 만들지 않습니다. 일반 handoff_questions는 사용하지 않습니다. runtime 역할에는 detail 열 UPDATE만 더하고 기다림 상태·닫힘·삭제 권한은 계속 막습니다.
4. 같은 수신 글이 다른 사유/날짜 건에 이미 묶였으면 already_handed_off 결과로 알립니다. 수신 글 하나에 원본 건 하나인 기존 제약을 유지하고, 안내 전달 표시를 포함한 호출자 트랜잭션을 예외로 되돌리지 않습니다. TASK-069는 이 결과를 기존 건으로 처리해야 합니다.
5. 기간 밖 날짜도 입력 날짜 앞뒤14일 안이면서 실제 허용된 60일 범위의 대안을 최대3개 냅니다. 요청 날짜 자체는 계속 기간 밖입니다. SPEC-014의 받을 수 없을 때 가까운 날을 권하는 공통 규칙을 적용한 해석입니다.
6. 일반 확인 건과 마감 날짜 건의 기다림·할 일·최초 알림 생성은 createHandoffTask 하나로 모았습니다. 일반 건의 기존 null detail과 이벤트 키는 유지합니다.
7. insist=false 조회는 수신 글의 가게 범위와 기존 기록만 확인하고 손님·상담 FOR UPDATE 없이 판정합니다. 별도 연결이 손님 행을 잠근 상태와 250ms lock_timeout으로 차이를 확인했습니다.

새 시험은 처음 `Tests 6 failed | 10 passed (16)`였고 닫힘 시험 자료의 answered 제약 오류 한 건을 고쳤습니다. 보정한 시험을 이전 제품 코드로 다시 실행해 같은6실패/10통과를 확인했습니다. 수정 과정의 jsonb/uuid 연산자 오류와 열 권한 기대값도 고쳤습니다. 현재 날짜·runtime·AI 실패·고지·SQL 정적 검사 다섯 파일은 `Test Files 5 passed (5)`, `Tests 90 passed (90)`이며 타입과 format 뒤 lint는 종료0입니다. 새 전체 검사와 main226 반영은 다음입니다. 실제 카카오·AI·결제 호출은0회이며 새 스테이징 열 권한 적용은 미확인입니다.

PR #226을 squash한 main `85c1c5ccae9b4de92ea7c5cec2a6b74fcf08191c`를 반영했습니다. TASK-067과 TASK-068의 완료 원본을 합쳐 생성기로 다시 계산한 이 브랜치 제안은37개이며, 현재 실제 main은36개입니다. TASK-069의 지연 전달 전체 경로 완료 조건과 TASK-068의 재처리 보존을 유지했습니다. 견적·환불 시험과 날짜·runtime·고지·AI 실패·SQL 정적 검사 일곱 파일은 `Test Files 7 passed (7)`, `Tests 126 passed (126)`입니다. 타입과 format 뒤 lint도 종료0입니다.

main226의 app45312121434/db45312121457·check138170142915·Windows138170142451·PostgreSQL16.15 138170142944/17.11 138170142934·배포138172109177가 모두 성공했습니다. 실제 Wrangler 검증은 전체 태그 일치·앱bda8b2ed-bb10-4817-8743-d468551b540c(2026-11-24T02:29:45.386082Z) 활성100%·health200이고 원격 main ref도 같습니다. main226-deployment.json에 이 실제 결과를 보존합니다. 학원컴 인증/저장소 활성 태그 직접 재조회와 스테이징 새 열 권한 적용은 미확인입니다.

검토 수정 원본으로 새 빈 PostgreSQL 전체 검사를 실행합니다. 중간 기록의 shell 출력 경로 오타 때문에 시작하지 못했던 타입 검사는 올바른 경로로 실행해 종료0을 확인했습니다. 실행되지 않은 것을 통과로 세지 않았습니다. 실제 모델·카카오·결제 호출은0회입니다.

검토 수정과 main226 결합 원본 `4d25f9aeff1a3126fc70541dbb13456fcb0df277`의 새 빈 PostgreSQL 전체 검사가 완료됐습니다. 마이그레이션34개, 서버 `Test Files 112 passed (112)`·`Tests 2340 passed (2340)`, 웹 `Test Files 65 passed (65)`·`Tests 1570 passed (1570)`, 웹 `built in 905ms`, 두 Worker `--dry-run: exiting now.`이고 시험·빌드 종료가 모두0입니다. 타입 종료0, `Checked 487 files in 1030ms. No fixes applied.`입니다. 현재 기록의 키 검사는1120파일0건입니다.

수락 조건 표와 WBS 원본을 최종 검사 결과로 갱신합니다. TASK-069의 지연 안내 영속 보존·다음 대화 전달 뒤 같은 트랜잭션의 closed_day 한 건이라는 연결 조건은 아직 미실행이며 해당 작업에 남습니다. 실제 main은 TASK-067 반영 뒤 완료36개이고 이 PR의 TASK-068 제안은37개입니다. 직접 스테이징 SQL 권한 적용과 학원컴 인증/저장소 태그 재조회는 미확인입니다. 검토7건 처리 댓글7120369433에 이어 최종 head와 재검토 요청을 남기고 수동 Codex 검토를 한 번 요청합니다.

### (626) TASK-064 고지 정책 경고 로그 보완

PR #224 병합 뒤 Claude 재검토 댓글 `7118971639`의 낮은 발견 한 건을 처리합니다. 고지 정책 읽기 실패 경고에 요청 `traceId`를 넣고, PostgreSQL 오류의 실제 이름이 `error`여도 로그에는 `DatabaseError`로 분류합니다. 일 실행기의 기존 `errorNameOf`를 공통 모듈로 옮겨 두 곳이 같은 분류를 사용합니다. 일반 Error 하위 클래스 이름은 유지하고 오류 객체가 아닌 값은 `Error`로 기록합니다. 메시지·스택·SQL·넣은 값은 남기지 않습니다.

기존 고지 시험에 PostgreSQL·RangeError·오류 객체 외 세 경우를 추가해 처음 `Tests 3 failed | 28 passed (31)`을 확인했습니다. 수정 뒤에는 시험이 추적 ID를 UUID로 가정한 오류 세 건이 나와, 기존 서버의 32자리 16진수 형식으로 바로잡았습니다. 고지·일 실행기 두 파일 `Test Files 2 passed (2)`, `Tests 52 passed (52)`입니다. `npm ci`는 `added 161 packages in 12s`이고 format 뒤 lint와 타입 검사가 종료 0입니다. 실제 스테이징 경고 로그 관측은 아직 하지 않았습니다. 고지 전달 동작과 기존 상담 교체 구간의 제한은 바꾸지 않았습니다.

다음은 새 원본의 전체 검사, 준비된 PR, 코드·보안 검토와 발견별 처리, 한 번의 수동 Codex 검토, CI 성공 뒤 squash와 main 배포 확인입니다. WBS 완료 수는 바꾸지 않습니다. 실제 외부 모델·카카오 발신과 결제는 호출하지 않았습니다.

main225 `ee3ce8bfea7d32d6b417f82060afac83bc40042f`를 반영했습니다. 경고 로그 수정 원본 `618a48b6134259bff84c62b8d30a47c0dbcc7b72`의 새 빈 PostgreSQL 마이그레이션34개·서버107파일2263건·웹65파일1570건·웹 빌드1.02초·두 Worker 빌드가 통과했습니다. 새 main 결합 뒤 고지·실행기·AI 문맥·제한 역할 네 파일은 `Test Files 4 passed (4)`, `Tests 81 passed (81)`이며 타입과 format 뒤 lint는 종료 0입니다. 결합 원본의 새 전체 검사를 실행합니다.

main225의 app45309196170/db45309196156·check138160381422·Windows138160381944·PostgreSQL16.15 138160381367/17.11 138160381641·배포138162230801가 모두 성공했습니다. 실제 Wrangler 전체 태그·앱3dc38ed7-d384-4f0c-bb42-41b910f7cadb(2026-11-24T02:05:36.534469Z) 활성100%·health200과 원격 ref 일치를 확인했고 main225-deployment.json에 보존합니다. 학원컴 인증·저장소 활성 태그 재조회와 실제 경고 로그 관측은 미확인입니다. WBS 완료35개이며 이 작업은 수를 바꾸지 않습니다.

main225 결합 원본 `4b4c0c634db0c99d66c8958a8eadaf284429f19a`의 새 빈 PostgreSQL 전체 검사가 완료됐습니다. 마이그레이션34개, 서버 `Test Files 109 passed (109)`·`Tests 2289 passed (2289)`, 웹 `Test Files 65 passed (65)`·`Tests 1570 passed (1570)`, 웹 `built in 2.01s`, 두 Worker `--dry-run: exiting now.`이며 시험·빌드 종료는 모두 0입니다. 타입과 format 뒤 lint도 종료 0입니다.

PR #224 병합 뒤 발견의 경고 오류 분류·요청 추적 ID만 바꾸고 고지 전달·마스킹·제품 결정은 바꾸지 않았습니다. 준비된 PR에서 코드·보안 검토를 받고 한 번의 병합 직전 수동 검토와 CI 성공 뒤 squash·main 배포를 확인하겠습니다. 실제 스테이징 경고 발생의 관측과 기존 학원컴 직접 재조회 보류는 그대로입니다. 현재 main 완료35개이며 수를 바꾸지 않습니다.

PR #228의 Claude 코드·보안 검토(`8344dc9`, 댓글 `7120091109`) 발견5건을 처리했습니다. 보안 발견은0건입니다. 기존 콜백 큐·예약 실행의 실패, 같은 파일의 마스킹 실패·스킬 실패, 접속기록·지우기 실행기의 오류 분류를 errorFields 하나로 모았습니다. errorName과 허용된 SQLSTATE만 반환하고 메시지·스택·SQL·값은 읽지 않습니다. 이름만 필요한 실행기 결과는 같은 함수의 errorName을 사용합니다.

고지 경고의 추적 ID는 실제 요청에서 발급한 첫 값과 같음을 확인합니다. 시계열 호출의 다음 ID는 다른 값으로 모의해 새 ID를 잘못 발급하거나 다른 요청의 ID를 쓰면 통과하지 않게 했고, ID 발급도 한 번임을 확인합니다. 형식만 확인하던 시험을 대체했습니다.

콜백 큐의 PostgreSQL 실패와 예약 실행의 콜백 복구 실패 로그는 새 시험 두 건으로 먼저 실패를 확인했습니다. 예약 실행의 복구 함수가 원래 내부 오류를 받아 처리하므로, 외부 catch 분기는 복구 함수 자체의 예외를 주입하도록 시험을 보완했습니다. 보정한 시험도 `Tests 2 failed (2)`였고 구현 뒤 고지·실행기·예약 실행·접속기록·복구·새 오류 분류 여섯 파일은 `Test Files 6 passed (6)`, `Tests 92 passed (92)`입니다. import 순서의 lint 오류는 앱 폴더에서 정리했고 최종 format 뒤 lint와 타입은 종료0입니다. 저장소 루트에서 실행한 Biome의 중첩 설정 오류는 실행 위치를 고쳤으며 설정 파일은 바꾸지 않았습니다.

다음은 main226을 반영한 새 전체 검사와 검토 처리 댓글·최종 CI입니다. 현재 main 완료36개이며 이 작업은 수를 바꾸지 않습니다. 실제 스테이징 오류 발생 관측과 학원컴 인증/저장소 태그 직접 재조회는 미확인입니다. 실제 모델·카카오·결제 호출은0회입니다.

main226 `85c1c5ccae9b4de92ea7c5cec2a6b74fcf08191c`를 반영했습니다. 오류 분류·고지·일 실행기·예약 실행·접속기록·복구·runtime·견적·환불 관련 아홉 파일은 `Test Files 9 passed (9)`, `Tests 138 passed (138)`입니다. 타입과 format 뒤 lint는 종료0이며 검토 발견5건을 모두 처리했습니다. 결합 원본의 새 빈 PostgreSQL 전체 검사를 실행합니다.

기준 main226의 app45312121434/db45312121457·check138170142915·Windows138170142451·PostgreSQL16.15 138170142944/17.11 138170142934·배포138172109177가 모두 성공했습니다. 실제 Wrangler 전체 태그·앱bda8b2ed-bb10-4817-8743-d468551b540c(2026-11-24T02:29:45.386082Z) 활성100%·health200과 원격 main ref 일치를 확인했고 main226-deployment.json에 보존합니다. 현재 main 완료36개이며 이 작업은 수를 바꾸지 않습니다. 실제 경고 발생 관측·학원컴 인증/저장소 태그 직접 재조회는 미확인입니다. 실제 모델·카카오·결제 호출은0회입니다.

검토 수정과 main226 결합 원본 `23541b4c6d43b26f89397d2b632209e9ac62a987`의 새 빈 PostgreSQL 전체 검사가 완료됐습니다. 마이그레이션34개, 서버 `Test Files 112 passed (112)`·`Tests 2327 passed (2327)`, 웹 `Test Files 65 passed (65)`·`Tests 1570 passed (1570)`, 웹 `built in 749ms`, 두 Worker `--dry-run: exiting now.`이고 시험·빌드 종료가 모두0입니다. 타입 종료0, `Checked 486 files in 937ms. No fixes applied.`이며 키 검사는1118파일0건입니다.

검토 발견5건의 코드와 회귀 시험을 최종 head에서 대조합니다. 큐·예약 복구·스킬·마스킹·접속기록·지우기·실행기의 오류 필드는 한 함수이며, 고지 경고의 추적 ID는 실제 요청에 발급한 첫 ID와 같고 추가 발급은 없습니다. 실제 스테이징 오류 발생 관측은 미확인입니다. 다음은 최종 CI와 한 번의 수동 Codex 검토, squash와 main 배포 확인입니다. 현재 main 완료36개이며 이 작업은 수를 바꾸지 않습니다.

날짜 판정 main227을 반영한 원본 `99ea857b32d610c3d8c9947d867c859d88b52c27`의 새 빈 PostgreSQL 전체 검사도 완료됐습니다. 마이그레이션34개, 서버 `Test Files 113 passed (113)`·`Tests 2344 passed (2344)`, 웹 `Test Files 65 passed (65)`·`Tests 1570 passed (1570)`, 웹 `built in 647ms`, 두 Worker `--dry-run: exiting now.`이고 시험·빌드 종료가 모두0입니다. 타입과 format 뒤 lint도 종료0입니다. 검토 발견5건의 공통 오류 필드와 실제 요청 추적 ID 대조를 유지합니다.

main227 `74aa2a765ce10ae7388fab02088cfa541d7e407e`의 app45315476716/db45315476727·check138181172816·Windows138181172441·PostgreSQL16.15 138181172219/17.11 138181172696·배포138182326113가 모두 성공했습니다. 실제 Wrangler 전체 태그·앱36a8eb7c-131b-4451-a091-80e39e46c625(2026-11-24T02:55:50.174572Z) 활성100%·health200과 실제 원격 main ref 일치를 확인했고 main227-deployment.json에 보존합니다. 현재 main 완료37개이며 이 작업은 수를 바꾸지 않습니다.

PR #227 병합 뒤 검토7120661351의 낮은5건과 봇이 전달한 결정 안내7120693089는 별도 TASK-068 후속(기록628·README336 예약)에서 처리합니다. 원문이4번 중간에서 잘려 요청 댓글7120784639로 나머지를 요청했으며 누락 항목을 처리한 것으로 세지 않습니다. 이 PR에는 TASK-064 코드만 남깁니다. 실제 스테이징 오류 발생 관측과 학원컴 인증/저장소 활성 태그 직접 재조회는 미확인입니다.

### (627) TASK-072 사장님 할 일 목록과 알림

TASK-072를 시작했습니다. main225 기준 끝남35개·구현 완료20개·시작 가능40개를 다시 계산했고, 먼저 막힌 낮은 반복의 실환경/원본 대기는 그대로 두고 같은 반복에서 뒤에70개가 기다리는 사장님 할 일 목록을 고릅니다. SPEC-067과 API-040·DEC-21, 기존 할 일/알림 테이블·렌더러·실행기를 읽었습니다. 브라우저가 필요한 작업은 학원컴 Aside CLI만 사용합니다. 읽기 전용 CLI 계정 목록에서 로그인한 두 프로필이 보였지만, 이전 CDP 두 실패가 해제됐거나 화면 연결이 복구됐다고 세지 않았습니다.

API-040의 빈 목록·친구 상태·맞춤 주문·개인정보 제외·닫힌 목록·가게 분리·인증·조건 오류·접속기록 실패를 먼저 시험으로 적었습니다. 아직 경로가 없어 보정한 첫 실행은 `Test Files 1 failed (1)`, `Tests 10 failed | 1 passed (11)`입니다. 최초 실행의 6개 비동기 미처리 오류는 시험에서 expectProblem을 await하지 않은 실수였고 바로 고쳤습니다. 처음의7개 통과는 올바른 기능 통과로 세지 않습니다. `npm ci`는 `added 161 packages in 25s`입니다.

기록 번호는 README335·fix-log627을 예약했습니다. 다음은 목록의 정렬/커서·서버의 안전한 요약·접속기록·교차 가게 등록, 이어서 알림 묶음·재시도·발송 결과의 모의 실행입니다. MVP의 실제 우리 채널 알림·plusfriends·친구 조회·월렛 발신은 출시 검토로 미룬 결정을 지키고, 전송 코드는 합성 appUserId로만 시험합니다. 결제와 실제 카카오 발신은 하지 않습니다.

API-040 할 일 목록을 접속기록 경로로 연결했습니다. 요약은 서버의14종 이름만 쓰고 detail의 자유 입력을 반환하지 않습니다. 열린 목록은 지연·기다림 기한·기한 없는 순서이며 닫힌 목록은 닫힌 시각 역순입니다. 커서는 가게와 상태에 묶고 PostgreSQL의 마이크로초와 ID로 이어 읽어 같은 밀리초의 두 항목도 빠지지 않습니다. 다른 가게 ID를 쿼리에 넣어도 자기 목록만 읽는 교차 가게 사례를 등록했고 응답과 같은 트랜잭션에 접속기록을 남깁니다.

초기 경로 부재10실패/1통과 뒤 구현의 두 실패는 시험의 /api 접두사 기대값과 닫힌 목록의 사용하지 않는 SQL 인자였습니다. 경로는 기존 기록 규칙에 맞추고 닫힌 목록의 인자 번호를 분리했습니다. 목록·교차 가게·SQL 정적 검사 세 파일은 `Test Files 3 passed (3)`, `Tests 95 passed (95)`입니다. 커서·정렬을 포함한 목록13건이 통과했습니다. Workers TextDecoder의 ignoreBOM 필수 옵션은 기존 입력 모듈처럼 명시했습니다.

권한 파일로 새 제한 역할을 만들어 실제 API를 호출한 시험은500으로 한 건 실패했습니다. 연결 대상의 관계 열만 SELECT하고 접속기록의 쓰는 열만 INSERT하도록 더한 뒤 `Test Files 1 passed (1)`, `Tests 14 passed (14)`입니다. 접속기록 조회·수정·삭제 권한은 주지 않았고 연락처·알레르기·계좌를 요약에 넣지 않았습니다. 스테이징의 새 권한 적용은 미확인으로 TASK-173에서 추적합니다.

현재는 목록 공통부까지이며 알림 묶음·재시도·발송 결과·실행기 연결과 전체 검사는 다음입니다. 이 작업을 끝남/구현 완료로 세거나 PR을 준비 상태로 열지 않습니다. MVP의 실제 우리 채널 발신과 plusfriends는 출시 검토로 미룬 결정을 유지합니다. 실제 모델·카카오·결제 호출은0회입니다. 다음 저장 전에 main226을 반영합니다.

TASK-072의 사장님 Event API 전송과 알림 처리기를 중간 저장합니다. 사장님 수신자는 appUserId를 쓰고 서비스 봇의 siljang_owner_alert에 alertKey만 보냅니다. 기존 손님 botUserKey 전송을 유지하며 두 전송 모듈75건을 통과했습니다. 외부 통신은 주입한 모의 응답이며 실제 카카오 발신은0회입니다.

새 알림 처리기는 1분 동안 같은 종류를 묶고, 가게 잠금과 임대 소유 확인으로 전송 결과를 기록합니다. 접수는 confirming이고 배달 확인 뒤에만 sent입니다. 알림 전송은 할 일을 닫지 않습니다. 계좌 변경·환불 결정 알림, 친구 아님, 묶음 경계와 MVP 비활성 경로의 실제 PostgreSQL 시험6건을 통과했습니다. 제한 역할의 할 일 조회·접근 기록 시험14건도 통과했습니다. 이는 환불 API 자체 구현을 뜻하지 않습니다.

다음 단계는 재시도1·5·30분, 배달 조회1·5·30분, 동시 실행·오래된 임대, 설정·서비스·스케줄러 연결과 최소 역할 권한 시험입니다. 이 조건과 전체 검사를 채운 뒤 리뷰 준비 PR을 엽니다. 사장님 채널·plusfriends·월렛을 쓰는 실제 발신은 기존 결정대로 TASK-167 출시 검토에 남깁니다. 학원컴 Aside 제어와 실제 스테이징 DB 권한 적용은 기존 외부 원인 보류이며 통과로 적지 않습니다.

TASK-072의 설정·서비스·scheduled 기본 실행을 연결했습니다. 사장님 발신은 기본 비활성이고, 켤 때는 로그인 앱과 서비스 봇 번호가 필요합니다. 전송기를 얻는 것만으로 발신하지 않습니다. 새 설정 시험은 처음4실패·6통과였고, 연결 뒤 실제 서버 설정과 PostgreSQL 실행의 다섯 파일34건을 통과했습니다. 직접 실행 중 DB 환경을 주지 않아8건이 건너뛰어진 결과는 확인으로 세지 않고, REQUIRE_DATABASE_TESTS=1의 서버 명령으로 다시 실행했습니다.

재시도1·5·30분과 최대4회, 접수 뒤 조회1·5·30분, 친구 아님, 변경 반영 안 됨, 별도 연결의 동시 묶음 발신, 임대 만료 뒤 이어 처리와 오래된 결과 무시, 더 새로운 친구 확인 보존을 시험했습니다. 제한 역할 시험은 처음1실패·14통과였으며 알림 상태 열9개의 UPDATE만 추가해 고쳤습니다. 가게·종류·할 일 연결·이벤트 키의 수정과 알림 삭제는 계속 막습니다. 알림·runtime·API-040·가게 간 범위·정적 검사 다섯 파일123건을 통과했습니다. 실제 스테이징 권한 적용은 미확인입니다.

현재 main228은 TASK-064 경고 수정 d330fccdcb3ca293a64f8d3b5ee10ce4f9092c1c입니다. 완료37개·구현 완료20개를 반영해 다시 계산한 시작 가능 작업은38개입니다. 이 작업을 계속하며 날짜 판정의 병합 뒤 발견은 기록628·README336의 별도 후속에서 처리합니다. 다음은 알림 문구·목록 주소와 수락 기준 대조, main228 결합 뒤 새 빈 DB 전체 검사입니다. 실제 모델·카카오 발신·결제0회입니다.

TASK-072의 알림은 기존 SCR-019 변환기로 만든 문구와 화면 주소를 우리 서비스 봇의 Event API 매개변수로 전달합니다. 할 일 종류·묶인 건수·주문 번호만 고르고 내부 detail과 손님 연락처·계좌·알레르기를 읽지 않습니다. 같은 종류 알림 묶음은 건수도 표시하고 여러 주문은 주문 목록으로 엽니다. 같은 가게의 주문·변경 요청·문제 신고 연결만 확인하며 다른 가게 주문은 전송하지 않습니다. 기본 수신자는 appUserId이고 기존 손님 botUserKey 전송은 유지합니다.

문구·주소 시험은 처음3실패·15통과였고 연결 뒤 관련 다섯 파일110건을 통과했습니다. 계좌 변경 주소의 시험 가정은 기존 결제 수단 경로 /owner/payment-destination으로 바로잡았습니다. 켠 scheduled 주입 전송 시험도 처음1실패·17통과로 누락을 재현하고 설정·서비스와 연결했습니다. 관련11파일241건, 추가 묶음 종류·건수 시험 뒤 알림 처리기19건을 통과했습니다. 전송에 필요한 HTTP는 모두 모의 응답이며 실제 카카오 요청은0회입니다. 시험 정리 과정은 검증 실패 때도 모의 전송과 합성 자료를 정리하도록 고쳤습니다.

타입과 format 뒤 lint를 검사했습니다. 선택적 연결 경고 한 건도 고쳐 경고0건을 확인한 뒤 push합니다. 수락 기록은 SPEC-067 #1~#6의 자동 시험과 실제 취소·변경 업무, MVP에서 끈 채널·배너 확인 범위를 구분합니다. 실제 서비스 채널·plusfriends·친구 확인·월렛·발신은 TASK-167 출시 검토에 남고 스테이징 권한 적용도 미확인입니다. main 반영과 CI·배포 확인 전에는 finished나 구현 완료 목록에 올리지 않습니다.

기준 main228 d330fccdcb3ca293a64f8d3b5ee10ce4f9092c1c의 app45318336666/db45318336674·배포138192248906가 성공했습니다. 실제 앱7f0058c6-6c52-488f-be79-1c130081795d 활성100%·health200·전체 태그·원격 SHA 일치를 확인해 증거를 보존합니다. 새 빈 PostgreSQL 전체 시험과 두 Worker 빌드를 다음으로 실행합니다.

TASK-072 첫 새 빈 PostgreSQL 전체 검사는 서버117파일 중2파일에서4건 실패·2384건 통과였고 웹·빌드는 실행하지 않았습니다. 기본 Cron에 owner_alert가 추가되어 기존 보관 작업만 가정한 로그 기대값과 조회 모의 객체가 맞지 않았습니다. 새 작업의 두 조회를 허용하고 정상일 때 오류0건, 연결/권한 실패 때 알림 작업의 실패2건과 SQLSTATE만 남는지 확인하도록 시험을 보강했습니다. 빈 매분 작업은 별도 성공 로그를 남기지 않는 기존 실행기 동작도 유지했습니다. 수정 뒤 Cron·제한 역할·알림 세 파일42건을 통과했습니다.

새 수락 문서의 용어 후보는 '1분 안 같은 종류를 하나로 보냄'으로 풀어 썼고 용어 검사를 통과했습니다. 시험의 가짜 REST/클라이언트 키는 실행 중 생성하도록 바꿔 키 검사1134파일0건입니다. 실제 비밀 값을 저장하거나 키 검사 예외를 더하지 않았습니다. 새 전체 검사를 다른 빈 PostgreSQL에서 다시 실행합니다. 아직 main 반영·CI·배포 전이므로 finished/구현 완료 표시는 유지합니다.

TASK-072의 기본 Cron 시험 보강 원본926f866ac19fbb697fba00d146962114553d494f의 새 빈 PostgreSQL 전체 검사가 완료됐습니다. 마이그레이션34개, 서버 Test Files 117 passed (117)·Tests 2388 passed (2388), 웹 Test Files 65 passed (65)·Tests 1570 passed (1570), 웹 built in 1.33s, 두 Worker --dry-run: exiting now.이며 시험·빌드 종료는 모두0입니다. 첫 전체 검사의 서버4실패·2384통과도 그대로 기록했고 그 실행에서는 웹·빌드를 돌리지 않았습니다.

API-040 응답과 가게 분리·접근 기록, 우리 봇 appUserId와 공개 문구·주소, 1분 안 같은 종류의 알림 합치기와 다른 종류 분리, 재시도·배달 확인·동시 실행·임대·최소 권한, 켜짐/기본 중단의 scheduled 연결을 확인했습니다. 상위 취소·변경 업무의 자료를 받는 시험은 그 API 자체를 구현하거나 실제 카카오 발신을 한 것으로 세지 않습니다. 아직 main 반영·CI·실제 배포 확인 전이며 finished/구현 완료 표는 바꾸지 않습니다.

기록627·README335·수락 기록과 기준 main228 배포 증거를 같은 PR에 보존합니다. 실제 서비스 채널·plusfriends·친구 확인·월렛·발신은 TASK-167 출시 검토에 남습니다. 스테이징 권한 적용과 학원컴 Aside 화면 확인도 기존 인증 보류이며 실제 모델·카카오·구글·결제0회입니다. 다음은 리뷰 준비 PR의 CI·코드/보안 검토, 병합 직전 Codex 검토 한 번과 squash 뒤 main 확인입니다.

TASK-072의 최종 대조에서 MVP 비활성 설정은 Cron의 등록 자체도 중단해야 함을 확인했습니다. 실제 스테이징의 새 알림 열 권한을 아직 적용하지 않은 상태에서, 꺼둔 알림을 조회하거나 실패 상태로 쓰지 않도록 했습니다. 기본 설정은 기존 보관·콜백 정리만 실행하고 알림 자료는 pending 그대로 둡니다. 켠 설정은 주입한 사장님 전송기와 최소 권한 시험을 유지합니다. 실제 최소 권한을 적용한 뒤에만 발신 설정을 켭니다.

새 기본 중단 회귀는 처음1실패·18통과였고 수정 뒤 알림·Cron·제한 역할·설정 네 파일45건을 통과했습니다. 기본 Cron의 기존 시험은 원래 기대값을 유지하며 불필요하게 바꿨던 기대값을 되돌렸습니다. 앞서 통과한 원본926f866의 전체 검사 결과는 그 원본의 기록으로 남기고, 새 등록 조건을 포함한 원본으로 다시 전체 검사합니다. 실제 스테이징 실패를 관측했다고 세지 않으며 이 판단은 코드 경로와 확인하지 못한 권한 상태에 근거합니다.

MVP 비활성 알림의 Cron 등록도 중단한 원본2e8d06835f9c4c5a47b8f2bcc2b31872684dec1a의 새 빈 PostgreSQL 전체 검사가 완료됐습니다. 마이그레이션34개, 서버 Test Files 117 passed (117)·Tests 2388 passed (2388), 웹 Test Files 65 passed (65)·Tests 1570 passed (1570), 웹 built in 753ms, 두 Worker --dry-run: exiting now.이며 시험·빌드 종료가 모두0입니다. 기본 중단은 조회·수정·발신0회이고, 켠 상태의 전송과 재시도·배달 확인은 모의 응답으로 검증했습니다.

이 결과를 최종 제품 원본의 검사로 적용하며 이전 원본의1.33초 빌드는 그 원본의 기록으로 유지합니다. 실제 새 최소 권한 적용·서비스 채널·plusfriends·친구 확인·월렛·카카오 발신은 여전히 미확인 또는 출시 검토입니다. 이번 PR에서는 finished/구현 완료 표시를 바꾸지 않고 main CI·스테이징 배포·원격 SHA 확인 뒤 다시 조건을 대조합니다.

PR #231 Claude 검토7121841851의 중간1건·낮은5건을 반영합니다. MVP 동안 쌓인 대기 알림의 발신 전 확인과 불필요한 합성 시험 알림 제외를 TASK-167 출시 조건에 명시합니다. 친구 상태 갱신 기준을 최초 요청 시각으로 고치고, 현재 친구 상태가 바뀌어도 이미 접수한 건의 배달 조회를 계속합니다. 대표 알림 내용이 잘못되면 묶인 건을 다시 대기시키며, 닫힌 할 일의 알림은 종류와 관계없이 제외합니다. 운영 환경의 개발 봇 설정을 막고 전송 클라이언트·키 검사와 설정 분기를 정리합니다.

고치기 전 관련 시험에서5개 실패·22개 통과를 확인했고, 고친 뒤 다섯 파일109개가 통과했습니다. 외부 HTTP는 주입 응답이며 실제 발신·결제·권한 적용은 하지 않았습니다. 다음은 최신 main 기준 전체 시험·빌드와 CI입니다. 아직 finished나 구현 완료를 표시하지 않습니다.

리뷰 여섯 항목을 고친 로컬 원본 e7a79421732753c9afa1a96315a8ad622ee245f5와 공개 head ba1218a20dd82790d49bc6cfff6036e4c6306b92는 전체 Git 트리가 같습니다. 새 빈 PostgreSQL에 마이그레이션35개를 적용한 전체 검사에서 서버 Test Files 117 passed (117)·Tests 2399 passed (2399), 웹 Test Files 65 passed (65)·Tests 1570 passed (1570), 웹 built in 1.38s, 두 Worker --dry-run: exiting now.이며 시험·빌드 종료는 모두0입니다. 기본 알림 중단과 접수 뒤 배달 확인, 잘못된 대표의 묶음 해제, 닫힌 할 일 제외, 운영 개발 봇 금지를 포함합니다.

TASK-066 등록 main6e86814246859f9197213d6688a054119d1eeeaa를 결합했습니다. 변경은 문서와 기록뿐이며 제품 파일 app/server·app/web·db·tools·research는 위 검사 원본과 같습니다. main230의 배포 확인은 진행 중이므로 아직 성공이라고 쓰지 않습니다. 현재 끝남37개·구현 완료21개이며 이 PR의 TASK-072는 main 확인 전이라 목록에 넣지 않습니다. 실제 스테이징 새 권한 적용과 채널 발신은 미확인이고 발신 설정은 기본 false입니다.

병합 직전 Codex 코드 검토6033883335의 P2 발견4675694142를 처리합니다. 공개 head a92a12b에서 대표 할 일 A·B를 묶고 첫 발신이 재시도 오류로 실패한 뒤 A만 닫으면, B가 batched에 남는 문제를 재현했습니다. 수정 전1실패·22통과였고 대표가 제외되는 분기에서도 묶음을 같은 트랜잭션에서 풀도록 고친 뒤23개가 통과했습니다. 잘못된 내용의 대표를 제외하는 분기와 releaseBatch를 함께 써서 다시 빠지지 않게 합니다. 유효한 B만 다시 접수하고 열린 할 일은 유지하는 것까지 확인했습니다.

Codex 보안 검토7122504760은 발견0건입니다. 수동 요청7122444962는 한 번만 했으며 다시 요청하지 않습니다. 다음은 수정본 전체 시험·빌드와 현재 head CI입니다. 실제 발신과 DB 권한 적용은 하지 않았습니다.

### (628) TASK-068 날짜 안내와 내부 중복 연결

PR #227 병합 뒤 검토7120661351의 읽을 수 있는 발견1~4와 결정 안내7120693089를 TASK-068 후속으로 고칩니다. 마감·휴무·기간 밖의 대안 없음 문구를 나누고, 기간 밖에도 허용된60일 범위와 원하는 날 앞뒤14일 안의 대안을 권한다는 입력 설명을 명확히 했습니다. 원래 SPEC-014 주 동작과 수락 기준, TASK-069의 지연 전달 연결 조건은 유지했습니다. 안내에 적힌 체크포인트 위임의 승인 근거는 별도 결정 기록에 출처와 함께 남겼으며 새로운 사용자 답을 관측했다고 적지 않습니다.

재사용 수신 ID를 일반 에스컬레이션의 중복 확인도 읽게 했습니다. 같은 마감 건에 연결한 글이 callback_timeout을 만나도 두 번째 건을 만들지 않습니다. 기존 결과 조회는 같은 날짜의 마감 건·생성 시각·ID 순서입니다. 같은 가게의 수신 글 확인 뒤 기존 결과를 우선하고, insist=false의 읽기만 허용하며, 새 건을 쓰는 insist=true는 끝난 상담을 거절하는 의도와 시험도 기록했습니다.

추가 UPDATE가 없다는 오래된 수락 기록은 detail 열만 허용한다는 실제 권한과 맞췄습니다. 스키마 원본의 detail 주석·생성 설명과0035 주석 마이그레이션에 내부 키를 화면·API에서 제외하고 허용한 필드만 고르는 원칙을 적었습니다. 이 마이그레이션은 행·제약·권한을 바꾸지 않습니다. API-040과 실제 알림도 내부 detail 전체를 읽거나 전하지 않도록 별도 TASK-072에서 시험합니다.

첫 두 문구 시험의 휴무 요일 자료가 PostgreSQL 제약을 어겨 자료를 날짜별 휴무로 고쳤습니다. 보정한 시험을 이전 제품으로 다시 실행해3실패·15통과를 확인했고 수정 뒤 날짜·제한 역할·AI 실패·정적 검사 네 파일66건을 통과했습니다. 타입과 format 뒤 lint도 종료0입니다. 다음은 새 빈 PostgreSQL 전체 검사와 설계·키·용어 검사입니다.

검토 본문은4번 중간에서 잘려 댓글7120784639로 나머지를 요청했습니다. 누락된5번은 미확인으로 남기며 전체 처리를 완료했다고 세지 않습니다. 기준 main228 d330fccdcb3ca293a64f8d3b5ee10ce4f9092c1c의 app45318336666/db45318336674·배포138192248906 성공, 실제 앱7f0058c6-6c52-488f-be79-1c130081795d 활성100%·health200·원격 SHA 일치를 확인해 증거를 보존합니다. 실제 스테이징 권한·학원컴 인증/저장소 태그 직접 재조회·누락 리뷰 원문은 미확인입니다. 실제 모델·카카오 발신·결제0회이며 운영 서버 반영은 하지 않았습니다. main 완료37개를 유지하고 시작 가능38개가 있어 작업을 계속합니다.

TASK-068 후속의 첫 새 빈 PostgreSQL 전체 검사에서 스테이징 원장 갱신 시험3건이 실패했습니다. 새0035 파일의 BEGIN·COMMIT이 전체 트랜잭션을 만드는 기존 갱신 생성기 안에서 문법 오류를 일으켰습니다. 기존 마이그레이션 형식대로 주석 명령만 남겼고 원장 기대값도34에서35로 맞췄습니다. 고친 원본으로 원장 갱신·날짜 판정 두 파일23건을 통과했습니다. 이전 실패 결과를 성공으로 바꾸어 적지 않습니다.

수정 원본812b68d02a5fc4a759a911a466e5862647e52c08의 새 빈 PostgreSQL 전체 재검사가 완료됐습니다. 마이그레이션35개, 서버 Test Files 113 passed (113)·Tests 2348 passed (2348), 웹 Test Files 65 passed (65)·Tests 1570 passed (1570), 웹 built in 792ms, 두 Worker --dry-run: exiting now.이며 시험·빌드 종료는 모두0입니다. 첫 실패 실행은 서버3실패·2345통과였고 웹·빌드는 실행하지 않았습니다. 환경 재시작 뒤에도 원본·실행 상태·종료값을 대조했습니다.

본문 검토1~4의 처리와 문구 결정 출처는 수락·결정 기록에 보존합니다. 공개되지 않은5번 원문은 여전히 미확인이며 별도 요청 댓글과 후속 PR 검토에서 이어갑니다. 자동 수락과 기존 main228 배포 증거만 확인했고 새 스테이징0035 적용이나 운영 반영을 확인했다고 적지 않습니다. 현재 main 완료37개·구현 완료20개이며 시작 가능38개가 있어 TASK-072와 다음 작업을 계속합니다.

최종 설치 확인은 added 161 packages in 14s, 타입 종료0, format 뒤 Checked 489 files in 821ms. No fixes applied.입니다. 설계 검사는 모든 실행 항목 종료0이며 API·브라우저 항목은 실행하지 않았습니다. 모형 화면은13통과·1미확인, WBS18검사·오류0, 키1128파일·0건, 새 결정 문서 용어0건입니다. 제품 전체 검사는 앞 원본812b68d의 완료 결과를 적용합니다. 이번 후속은 기존 완료37개를 바꾸지 않습니다.

PR #229의 Claude 코드·보안 검토7121503340은 중간1건·낮은2건이며 보안 발견0건입니다. PR #227의 잘렸던 원문도7121402013에서 확인해 이제5번을 대기로 두지 않습니다. 수신 글 연결 조건을 handoffSourceMatch 하나로 모아 날짜 결과·일반 에스컬레이션·AI 턴·AI 문맥 네 곳이 같이 씁니다. SQL 표현식은 정해진 세 상수만 받고 값은 기존 바인딩 파라미터로 전달하며 가게 범위 검사를 유지합니다.

모델 문맥에 재사용 질문이 섞이고 해당 콜백이 모델을 다시 부르는 문제를 새 회귀로 재현했습니다. 수정 전2실패·39통과였고, 수정 뒤 날짜·AI 문맥·최소 권한·정적 검사·AI 실패 다섯 파일88건을 통과했습니다. 다른 가게의 내부 연결 목록이 내 질문을 숨기지 못하는 것도 확인합니다. 실제 모델과 카카오를 부르지 않았습니다.

원문5번은 안내 문장 함수 공통화, 검증한 날짜 사용, 도달하지 않는 조건 제거, 기록 뒤 재조회와 롤백 예외 제거로 처리합니다. 열린 날짜 건을 재사용할 때도 보관한 첫 판정을 직접 읽어 대안이 바뀐 뒤 최초 재사용과 재처리의 결과가 같습니다. 일반 건의 시각이 더 이른 옛 중복 연결 자료를 직접 넣어도 같은 날짜 마감 건을 우선하는 회귀를 추가했습니다.

타입 종료0, format 뒤 Checked 490 files in 680ms. No fixes applied.이며 새 빈 PostgreSQL 전체 검사를 다음으로 실행합니다. 이전의 원문 대기 기록은 당시 사실로 유지하고 최신 결정·수락 기록은 수신과 처리 결과로 갱신했습니다. TASK-066 상태 등록 PR #230도 이 보완을 main에 반영하고 CI·배포 확인을 마친 뒤 최신 증거로 병합합니다. 실제 스테이징 권한·학원컴 인증/저장소 태그 직접 재조회·운영 반영은 미확인입니다.

PR #229 검토3건과 원문5번을 반영한 원본c230c44b3828ae59a7c194a3e317fe1692eda01d의 새 빈 PostgreSQL 전체 검사도 완료됐습니다. 마이그레이션35개, 서버 Test Files 113 passed (113)·Tests 2351 passed (2351), 웹 Test Files 65 passed (65)·Tests 1570 passed (1570), 웹 built in 617ms, 두 Worker --dry-run: exiting now.이며 시험·빌드 종료가 모두0입니다. 타입 종료0, format 뒤 lint490파일·680ms·오류/경고0입니다.

네 경로가 공통 수신 글 연결 조건을 쓰며, 재사용 질문의 모델 문맥 제외·콜백 모델 재호출0건·다른 가게 분리, 같은 날짜 마감 건의 결과 우선, 대안 변경 뒤에도 최초 재사용/재처리 결과 일치를 확인했습니다. 원문 대기는 해제했고 읽을 수 있는 발견을 처리했습니다. 최종 head의 CI와 병합 직전 수동 Codex 검토를 한 번 확인한 뒤 squash와 main 배포 확인을 이어갑니다. 실제 모델·카카오 발신·결제0회, 실제 스테이징0035/권한 적용과 학원컴 인증 직접 재조회는 미확인입니다.

### (629) TASK-066 구현 완료 상태와 실제 확인 구분

TASK-066 수락 기록의11개 조건을 다시 대조했습니다. 코드·자동 시험 조건은 PR #225에서 채웠고 main ee3ce8bfea7d32d6b417f82060afac83bc40042f의 app45309196170/db45309196156·배포138162230801이 성공했습니다. 실제 앱3dc38ed7-d384-4f0c-bb42-41b910f7cadb 전체 태그·활성100%·health200·당시 원격 main 일치 증거를 보존했습니다. 고지 경고 보완도 PR #228 main d330fcc의 같은 확인까지 끝났습니다.

남은 것은 스테이징 로그·대화의 실제 비밀 값 검사, 실제 설정을 두 회사로 바꾼 뒤 같은 평가 세트를 실행하는 일, 새 최소 권한 적용입니다. 기존 학원컴 Aside/Vault 인증 보류 때문에 실제 키·설정·로그·PostgreSQL 접근을 확인하지 못했습니다. 이 외부 원인은 두 번 실패한 뒤 그대로이며 원인이 바뀌지 않아 다시 제어하지 않았습니다. 목적별 출력의 실제 알림·장부·화면 연결은 각 담당 작업에서 이어가고 실제 카카오 발신은 출시 검토에 남습니다.

codex-finish.md 3-2의 코드·시험 충족, main CI·실제 배포 성공, 인증 때문에 못한 실환경만 남음이라는 세 조건에 따라 구현 완료 목록에 TASK-066을 등록합니다. finished는 표시하지 않고 실제 확인을 통과로 바꾸지 않습니다. 인증이 풀리면 TASK-173 권한부터 적용하고 비용 추정치를 적은 뒤 기존 키·잔액 안에서 같은 평가 세트와 로그를 확인합니다. 실제 모델·카카오·구글 호출이나 결제는0회입니다.

현재 main의 끝남37개·구현 완료20개를 이번 목록에 반영하면 구현 완료21개입니다. 전체 의존 충족 작업은41개이며 MVP에서 미룬 TASK-005·006·013·175를 빼면37개입니다. TASK-066이 빠지고 TASK-077이 열립니다. TASK-027의 원래44건 대조 보류는 이 등록으로 풀리지 않습니다. TASK-072를 이어서 확인하고 막히지 않은 다음 작업을 계속합니다. 이번 변경은 상태·증거 기록이며 앱 동작·스키마·권한은 바꾸지 않습니다.

TASK-066 상태 대조 원본476cfb68b82db6792a4781cac63db9d541478809의 새 빈 PostgreSQL 검사도 완료됐습니다. 마이그레이션34개, 서버 Test Files 113 passed (113)·Tests 2344 passed (2344), 웹 Test Files 65 passed (65)·Tests 1570 passed (1570), 웹 built in 802ms, 두 Worker --dry-run: exiting now.이며 시험·빌드 종료가 모두0입니다. added 161 packages in 12s, 타입 종료0, Checked 489 files in 1059ms. No fixes applied.입니다. WBS18검사·오류0, 키1127파일·0건이며 새 앱 코드와 새 마이그레이션은 없습니다.

구현 완료21개는 이 PR 목록을 반영한 수이고 현재 main의 구현 완료20개와 구분합니다. finished37개는 유지합니다. PR의 CI·리뷰·squash 뒤 main 배포 확인을 이어가며, 실제 로그·모델 전환·최소 권한 확인을 완료로 바꾸지 않습니다. 원래44건 대조가 남은 TASK-027은 이 상태 정리와 별개입니다.

TASK-066 상태 정리에 PR #229의 공통 수신 연결 보완 main1f4f96b3bec634419c88ac69a44d07dae90df733을 반영했습니다. app45325409443/db45325409574·배포138214920594가 모두 성공했고 실제 앱c6306525-08f2-4ea8-87ff-2fa51332ba9e(2026-11-24T04:21:46.742667Z) 전체 태그·활성100%·health200·원격 main 일치를 확인했습니다. main229-deployment.json에 증거를 보존합니다.

상태 목록 행은 충돌을 풀 때 빠지지 않도록 다시 확인했습니다. 최신 제품은 origin/main의 app/server·app/web·db·tools·research와 차이0이며 이 PR에는 상태와 증거만 남습니다. 최신 제품 검사 원본은 PR #229 c230c44의 마이그레이션35개·서버113파일2351건·웹65파일1570건·빌드617ms·두 Worker 종료0입니다. 이 PR에서 앞서 실행한476cfb의113파일2344건은 그 원본의 역사로 유지합니다. 제품이 같음을 확인해 같은 전체 검사를 불필요하게 다시 실행하지 않고 현재 head CI에서 검증합니다.

최신 main 결합의 타입 종료0, Checked 490 files in 817ms. No fixes applied.입니다. 구현 완료 목록의 TASK-066은11개 코드 조건과 공통 연결 회귀가 main CI·실제 배포까지 확인된 상태이며 실제 로그·모델 전환·권한 적용만 기존 인증 보류로 남습니다. finished37개는 유지하고 이 상태 PR 반영 뒤 구현 완료21개가 됩니다. 실제 확인을 성공으로 바꾸지 않습니다.

PR #230 검토7121619393의 중간2건·낮은1건을 고칩니다. 계산 결과를 문장에 옮기며 다음 작업 번호를 TASK-078로 잘못 적었습니다. 공식 WBS 생성기의 ACTIVE·DEPS와 task_status의 구현 완료 표를 다시 대조해 TASK-077로 네 기록과 PR 본문을 바로잡습니다. TASK-077의 앞선 작업은024·066이고 TASK-078은039·071이라 아직 열리지 않습니다.

계산 차이도 분명히 합니다. 전체 의존 충족 작업은 등록 전후41개로,066이 빠지고077이 들어옵니다. 앞서 쓴38개는 답/출시 검토로 미룬 동희님 몫005·006·013을 계산상 제외한 수였습니다. MVP에서 전부 미룬175까지 빼면 등록 전후37개입니다. 끝남은37개, 이번 제안의 구현 완료는21개입니다. 이 차이를 implementation-dependencies.json에 공식 원본의 앞선 작업과 함께 보존합니다.

구현 완료 행의 남은 확인에 실제 운영 요청에서 추적 도구 요청0건 관측(SPEC-021 #7)을 더했습니다. 운영 모드의 실제 합성 요청·로그·두 회사 평가·최소 권한 적용은 기존 인증 보류가 풀린 뒤 TASK-066에서 확인합니다. 빠졌던 관측을 통과로 세지 않습니다. 등록 순서에 맞게 행은 기존 마지막 TASK-048 뒤로 옮겼습니다. 앱·권한·스키마는 바꾸지 않았으며 같은 제품인 main229의 CI·실제 배포 증거는 유지합니다.

### (631) TASK-068 병합 뒤 검토: 연결 인덱스와 증거 연결

PR #229 병합 뒤 Claude 코드·보안 검토7122015984의 낮은 위험3건을 후속 처리합니다. 수신 글 연결 조건이 가게와 handoff_id로 찾는 경로에 owner_tasks (shop_id,handoff_id) WHERE handoff_id IS NOT NULL 부분 인덱스를0036과 원본 스키마에 더했습니다. 실제 스테이징 적용은 아직 하지 않았습니다.

TASK-069 완료 조건과 재사용 지점 주석에 저장한 alternatives는 첫 판정의 재처리 결과 보존용임을 명시합니다. 손님에게 다시 권하지 않고 해당 수신 글에 실제 전달한 안내와 현재 날짜 판정으로 답해야 합니다. 기존 중복 방지 결과를 바꾸거나 새 자동 만료 정책을 도입하지 않았습니다.

앞 기록의 c230c44·eb05b90·812b68d·23bde05는 로컬 실행 환경의 커밋으로 GitHub 공개 커밋이 아니었습니다. GitHub API로 같은 파일을 발행할 때 부모·작성 정보가 달라 SHA가 달라집니다. local-public-commits.json에서 두 시험 원본의 app/server·app/web·db·tools·research Git 트리 해시가 공개 b8070a6·6232c51과 각각 일치함을 직접 확인했습니다. 최종 로컬 기록의 전체 트리 대응도 저장합니다. 공개6232c51의 squash main1f4f96b는 app45325409443·db45325409574와 실제 버전 c6306525-08f2-4ea8-87ff-2fa51332ba9e의 전체 태그·활성100%·health200·원격 SHA가 확인된 상태입니다. 따라서 과거2351건의 제품과 공개 증거를 함께 대조할 수 있습니다.

로컬 임시 표의 합성20000행에서 순차 검색3.093ms에서 새 부분 인덱스 검색0.024ms로 바뀌었고 결과는 모두1행입니다. 순차 검색을 강제로 끄지 않았으며 실제 상담 전체나 운영 성능 측정은 아닙니다. 같은 연결의 ROLLBACK으로 임시 자료를 취소했습니다. 기존 DB 갱신 시험은0036 적용 후35건 기대 때문에1실패·2통과였고 기대를36건으로 고친 뒤 날짜 판정과 갱신 두 파일 시험이 통과했습니다. 앞선 미커밋 실행의 source_invalid는 별도 준비 실패로 유지합니다. 다음은 전체 시험·빌드와 CI입니다. 이 후속 자체는 끝남·구현 완료 수를 바꾸지 않습니다(시작 시 main229 기준 끝남37개·구현 완료20개). 실제 모델·카카오·결제0회입니다.

TASK-068 인덱스 후속의 로컬 시험 원본 547f6c606518d6af434a5e5968e19d79efa12b3b에서 새 빈 PostgreSQL 마이그레이션36개, 서버 Test Files 113 passed (113)·Tests 2351 passed (2351), 웹 Test Files 65 passed (65)·Tests 1570 passed (1570), 두 Worker --dry-run: exiting now.를 확인했고 시험·빌드 종료는 모두0입니다. 공개 head 109db706faf247b2c04f1d54a3eff299c00af032는 main230 문서 결합을 포함한 로컬 f15f54e의 전체 트리와 같습니다. 시험 원본과 제품 다섯 경로의 차이는0입니다.

설치 added 161 packages in 19s, 타입 종료0, format 뒤 Checked 490 files in 937ms. No fixes applied.입니다. 설계 검사는 실행 항목 모두 종료0이며 API·브라우저는 미실행, 모형 화면13통과·1미확인입니다. WBS18검사·오류0이며 실제 스테이징0036 적용과 운영 조회 성능은 아직 확인하지 않았습니다.

TASK-066 등록 main6e86814246859f9197213d6688a054119d1eeeaa의 app45328927441·db45328927432·배포138226217888 성공과 실제 버전9f09bdb0-d444-488f-a385-65700bffc95d의 전체 태그·활성100%·health200·원격 SHA 일치를 확인해 main230-deployment.json에 보존합니다. 현재 끝남37개·구현 완료21개입니다. 다음은 이 후속 PR의 검토·현재 head CI·병합 직전 한 번의 리뷰 요청과 main 확인입니다.

PR #232 Claude 검토7122576312의 낮은 위험4건을 반영합니다. 실제 공통 handoffSourceMatch와 날짜 조회 두 곳이 쓰는 공통 조인 문자열을 EXPLAIN하는 시험 세 개를 더했습니다. 첫 실행에서 공통 조건 하나가 해시 하위 계획으로 바뀌며 owner_tasks_event_uq로 가게 전체를 읽는 것을 확인했습니다. hs.handoff_id IS NOT NULL을 명시해 그 변환 뒤에도0036의 부분 인덱스를 쓸 수 있게 했고 세 조회 모두 새 인덱스를 쓰는 것을 확인했습니다. 기존 같은 가게·건의 등호 조건과 논리는 같습니다. 순차 검색을 끈 계획 검사는 사용 가능성의 회귀 검사이며 실제 운영 시간 측정이 아닙니다.

저장된 첫 날짜 판정의 사용 제한은 ClosedPickupResult.availability의 JSDoc으로 옮겨 기존 글 재처리와 다른 글의 재사용 모두에 적용했습니다. 기존 DB 갱신 시험은 마이그레이션 파일 목록의 길이를 기대값으로 사용하고22개를 먼저 기록하는 원장 구성도 같은 목록을 씁니다. 다음0037 때문에 숫자만 고치는 일을 없앱니다. 초기 구현 완료20개 문장에 main229 기준을 붙이고 최신 main230 기준21개와 구분했습니다. progress의 최신 설명도 같은 기준입니다.

관련 세 파일27개 시험이 통과했습니다. 다음은 TASK-072 main을 결합한 제품 전체 검사와 최신 head CI입니다. 실제 스테이징0036 적용과 운영 조회 성능은 미확인입니다.

검토 네 항목을 반영하고 TASK-072 main4732b667712b232848af67359aa9095d1977575a를 결합한 로컬 원본36c50997653298179fc1a2cfb2eb68f31a1ba1ef의 새 빈 PostgreSQL 전체 검사가 완료됐습니다. 마이그레이션36개, 서버 Test Files 118 passed (118)·Tests 2403 passed (2403), 웹 Test Files 65 passed (65)·Tests 1570 passed (1570), 웹 built in 823ms, 두 Worker --dry-run: exiting now.이며 시험·빌드 종료는 모두0입니다.

실제 수신 조건의 해시 하위 계획과 날짜 조회 두 조인이 부분 인덱스를 쓰는 회귀를 포함합니다. 이 원본 뒤 코드 차이는 시험 제목의 문자열을 Biome 템플릿 형식으로 바꾼 한 줄뿐이며 같은 세 파일27개를 재검사합니다. 원본의 lint 정보1건을 경고0으로 숨기지 않고 고칩니다. 최종 head CI로 다시 대조한 뒤 병합 직전 Codex 리뷰를 한 번 요청합니다. 실제0036 적용과 운영 성능은 여전히 미확인입니다.

### (632) TASK-081 손님 확인 카드의 공통 저장·검증

TASK-081을 WBS와 SPEC-069 #1~#2·A7·A8, API-070·071, 기존 confirm-card 판정 모듈과 대조해 시작합니다. 초기 공통 저장 모듈은 카드 값을 같은 가게의 주문·초안에서 읽고, 사용자·상담·버전·30분 기한을 확인한 뒤 같은 트랜잭션에서 합성 명령과 한 번의 사용 표시를 남깁니다. 손님 말이나 clientExtra로 금액·상태·카드 설명을 받지 않습니다.

현재 관련9개 시험이 통과했습니다. 미연결 시험 채널과 이미 제출한 초안을 쓴 준비 오류, 한 연결에서 동시 트랜잭션을 연 시험 오류를 고쳐 실제 별도 DB 연결의 동시 누름을 확인했습니다. 아직 API-071 연결, API-070 카드 응답 연결, 주문 버전 변경과 실제 명령 등록, 실행하지 못한 결과의 되돌리기와 사용 뒤 대상 상태 변경 회귀가 남은 WIP입니다. 이 부분을 구현 완료나 finished로 세지 않습니다. 취소·입금·변경 등의 업무 자체는 각 담당 작업에서 연결하며 실제 고객 주문을 바꾸지 않았습니다. 다음은 남은 회귀를 먼저 추가하고 API 응답 경로를 연결하는 것입니다.

TASK-081의 사용 뒤 초안 제출과 실패 결과 소비를 새 시험으로 재현했습니다. 수정 전2실패·9통과였고, 사용한 카드의 첫 결과를 대상의 현재 상태보다 먼저 읽으며 실행하지 못한 결과를 성공으로 저장하지 않도록 고쳤습니다. 주문 버전2→3의 새 카드 회귀를 포함해 저장 모듈12개가 통과했습니다.

API-071의7개 실패·2개 통과를 먼저 확인한 뒤 인증된 실제 수신 경로에 연결했습니다. 저장 카드의 사용자·상담·버전·기한과 현재 블록을 확인하고 명령과 사용 표시를 한 트랜잭션에 묶습니다. 카드 누름의 말·action.params를 메시지·AI·로그에 저장하지 않으며 카드 값 변경 시도는 쓰지 않습니다. 200의declined·card_stale·card_expired·card_not_yours·card_used,401·422·default500과 실행기 없음/실패의 재시도를 포함해 두 파일21개가 통과했습니다.

아직 제한 DB 역할 권한·교차 가게 전체 회귀, API-070 card_shown의 실제 상담 연결, 각 업무 명령의 실제 등록과 전체 시험·빌드가 남은 WIP입니다. 제품 취소 업무가 구현됐다고 세지 않으며 finished나 구현 완료에 올리지 않습니다. 다음은 main4732b66을 결합하고 최소 권한의 허용·금지 시험입니다.

TASK-081의 공통 카드 응답과 제한 역할을 보완했습니다. 카드 생성·기한 지난 카드의 결과 기록은 허용하되 키·받는 사람·주문/초안 연결·버전·기한 수정과 삭제는 막습니다. 제한 역할에서 confirm_cards 권한 거절을 먼저 확인한 뒤 SELECT·초기 INSERT와 결과3열 UPDATE만 추가했고, 카드·API·인증·역할 네 파일50개가 통과했습니다. 실제 스테이징 역할에는 아직 적용하지 않았습니다.

API-070 공통 card_shown 렌더러는 SkillTemplateResponse 스키마와 저장된 요약·불투명 키만 보이는 것을 확인했습니다. 말의 제안 단계에는 주문 상태가 그대로이고 합성 취소 실행기를 연결했을 때 두 번 눌러도 상태 변경은1건입니다. 이 시험은 공통 트랜잭션 계약이며 환불·자리 해제 등을 포함한 실제 취소 업무가 구현됐다는 뜻이 아닙니다. 업무 명령은 각 담당 작업에서 등록해야 합니다.

실제 API-070의 AI 수신·콜백 연결은 아직 미확인입니다. kakao-ai-turn.ts의 safeReply는 output.card를 의도적으로 거절하며 뒤 업무 처리기가 검증한다고 적혀 있습니다. 이 방어를 풀지 않고 TASK-069의 실제 명령 판정·카드 전달 연결로 남깁니다. TASK-081을 finished나 구현 완료로 세지 않으며 다음 작업은 최신 main 결합·전체 검사와 공통 기반 PR 검토입니다. 그 뒤 API-070 연결을 후속으로 이어야 합니다.

TASK-081 공통 기반의 로컬 원본e69fcdd59d595b0c9809d0ca9f961a8c97754bc1과 공개 WIP b73fa81c2447f5d86dad82a5cda78ad50d3c32d1은 전체 Git 트리919157baeadf792ffd288bb9adf0d4c514913023으로 같습니다. 새 빈 PostgreSQL 마이그레이션36개, 서버 Test Files 120 passed (120)·Tests 2427 passed (2427), 웹 Test Files 65 passed (65)·Tests 1570 passed (1570), 웹 built in 1.26s, 두 Worker --dry-run: exiting now.이며 시험·빌드 종료는 모두0입니다. 설치 added 161 packages in 13s, 타입 종료0, lint502파일871ms·진단0입니다.

실제 명령이 없는 API-071은 retry_needed이고 카드를 쓰지 않습니다. 카드의 공통 card_shown 응답은 렌더러·스키마 시험이며 실제 API-070 상담·콜백의 전달 성공으로 세지 않습니다. 이 방어를 유지한 공통 기반 PR을 검토받고, TASK-069 소비자와 각 업무 명령을 연결한 뒤 TASK-081 전체 수락 조건을 다시 대조합니다. finished나 구현 완료를 표시하지 않습니다.

최신 main43ba212d56286fafe386f5742703a7188f26dabe의 문서·상태표를 반영했고 제품 다섯 경로는 검사 원본과 같습니다. 현재 끝남37개·구현 완료22개이며 TASK-081은 포함하지 않습니다. main233의 CI·배포 확인은 진행 중입니다. main231·232의 실제 Actions Wrangler 증거를 보존하되 학원컴·저장소 활성 태그의 별도 직접 재조회, 카드 새 권한의 스테이징 적용은 미확인입니다. 실제 모델·카카오·구글·결제0회입니다.

PR #234 Claude 코드·보안 검토7123368088의7건을 반영합니다. 새 회귀는 수정 전7실패·23통과였고 수정 뒤 카드·API·제한 역할·기존 인증 네 파일57개가 통과했습니다. 신고·동의 철회만 같은 가게·같은 손님의 지난 주문을 새 상담에 연결할 수 있게 하고 다른 종류와 다른 손님·가게의 제한은 유지합니다.

기한/버전 거절은 원래 payload.presentation을 보존하고 대체 키를 replacedBy에 따로 남깁니다. 같은 카드를 다시 누르면 API-071의 명시된 card_used·처음 결과 계약을 유지하되 대체 버튼을 재발신하지 않아 기한 지난 버튼을 다시 보내지 않습니다. 제안의 반복 card_stale·card_expired 변경은 기존 card_used 계약과 달라 적용하지 않았습니다. 사용하지 않은 카드의 안 할래요는 기한·버전 재발행 전에 처리하여 쓰기와 새 카드가0건입니다.

받은 사람을 확인한 뒤 원래 초안·주문을 더는 읽을 수 없으면 기존 retry_needed로 답해 타인 카드로 오인하지 않습니다. 새 outcome은 만들지 않았습니다. 실행기는 현재 상태·잠금 번호를 다시 확인해야 함을 주석에 명시했습니다. 주문 요청의 order_id 연결 UPDATE와 시험은 실제 실행기를 등록하는 TASK-083에서 추가하도록 남깁니다. 지금 실행기는 미연결이고 order_id 수정 권한은 열지 않습니다. 기록의 기한 갱신은 기한 지난 카드의 결과 기록으로 바로잡았습니다.

API의 사용자·상담 해석과 공통 카드 처리를 한곳에 모아 같은 행을 한 번씩만 잠급니다. 채널에서 읽은 블록을 내부 처리기에 넘겨 같은 채널 재조회를 줄였고 NOT_YOURS 문구를 공유합니다. 권한의 범위를 넓히지 않았습니다. 보안 검토 발견은0건입니다. 다음은 수정본 전체 검사·현재 head CI와 병합 직전 한 번의 Codex 요청입니다. TASK-081의 실제 API-070 상담 연결·업무 명령은 여전히 미연결이므로 끝남·구현 완료를 표시하지 않습니다.

### (633) TASK-072 구현 완료 등록과 실제 확인 목록

TASK-072의 WBS 조건과 SPEC-067 #1~#6, API-040 응답별 시험을 기존 수락 대조와 main 증거로 확인해 구현 완료 표의 마지막에 등록합니다. PR #231의 로컬 전체 검사 원본9c8b9b97fcd3e2e498bad3ffab085487b9f9601b·공개 head6354c25c035bd94eccd88a00f55c54e60a8e455c·squash main4732b667712b232848af67359aa9095d1977575a는 전체 Git 트리가 f79ae9cec985075aa367c2d00aadc3dbefc194f4로 같습니다. 로컬 커밋은 공개 커밋이 아니며 implementation-source.json에서 대응을 보존합니다.

코드 조건은 API-040의200·401·404·422·default, 같은 가게·소유자 재확인·허용 필드·접속기록과 커서, 여섯 종류의 공통 알림 처리, 기본 중단·최소 권한·동시 실행·임대·오래된 결과와 대표 종료 재처리로 대조했습니다. 상위 취소·변경 업무 자체는 담당 작업에 남으며 이 PR이 그것을 구현했다고 세지 않습니다. main4732b66의 app45330983441·db45330983662·배포138233681269 성공과 실제 버전9d626247-b2b6-4240-b3e7-1189311ac319의 전체 태그·활성100%·health200·원격 SHA를 확인했습니다. GitHub Actions의 실제 Wrangler 조회 기준입니다. 학원컴의 별도 재조회와 저장소 Worker 활성 태그의 직접 재조회는 기존 도구 시간초과로 미확인입니다. PR #230 main6e86814의 CI·배포·health200 증거는 docs/records/owner-tasks/2026-11-24/main230-deployment.json에 보존했습니다.

설치 added 161 packages in 25s, 타입 종료0, lint497파일719ms, 새 빈 DB35마이그레이션·서버117파일2400개·웹65파일1570개·웹 빌드774ms·두 Worker가 모두 종료0인 기존 동일 제품의 검사 결과를 적용합니다. 이 상태 PR은 앱·권한·스키마를 바꾸지 않고 최종 head CI에서 같은 검사를 다시 확인합니다.

실제 스테이징의 새 최소 권한 적용과 사장님 API·배너는 학원컴 Aside 페이지 제어와 Vault 접근의 기존 시간초과가 풀린 뒤 확인합니다. 우리 서비스 채널·plusfriends·친구 확인·월렛·실제 발신과 오래된 대기 알림 점검은 MVP 결정대로 TASK-167 출시 검토입니다. 확인하지 않은 것을 통과로 세지 않고 발신 기본값 false를 유지하며 finished37개를 바꾸지 않습니다.

구현 완료는21개에서22개가 됩니다. 공식 WBS·task_status 기준의 전체 의존 충족은 등록 전후41개, MVP에서 미룬005·006·013·175를 뺀 시작 가능 작업은 등록 전후37개입니다. TASK-072가 빠지고 TASK-087이 열립니다. 계산 전후와 ID 차이를 implementation-dependencies.json에 남겼습니다. 다음은 이 상태 등록의 검토·CI·병합 직전 한 번의 Codex 요청과 main 확인이며, 그동안 TASK-068 후속과 TASK-081 개발을 계속합니다.

PR #233 Claude 검토7122978809의 낮은 위험4건을 반영했습니다. 다섯 기록에 배포 증거는 GitHub Actions의 실제 Wrangler 조회이며 학원컴·저장소 Worker 활성 태그의 별도 직접 재조회가 미확인임을 명시했습니다. PR #230 main6e86814의 CI·배포·health200과 main230-deployment.json의 연결도 덧붙였습니다. implementation-source.json에 설치·타입 종료·lint 출력·두 Worker 종료값과 PR #231 본문의 출처를 더했습니다. 구현 완료 수와 실제 확인 결과를 바꾸지 않았습니다.

TASK-087의 앞선 작업은 공식 DEPS에서182·072·020으로 읽었습니다. 원본 행의182 외에 기반 작업072·020이 합쳐지는 것을 TASK-087-deps와 dependencyStates에 보존합니다.182는끝남,020은구현 완료이고072가이번 등록으로구현 완료가되어 열립니다. 다음 등록도 같은 작업 ID-deps 배열과 dependencyStates 형식을 씁니다.

최신 main23c8641627df6a84f418f4a210f9ead68983862f를 결합했으며 상태 행을 표 마지막에 복구했습니다. main232의 app45333122652·db45333122646·배포138239961422 성공과 실제 버전4a06aca4-64e7-415d-aac6-bb72a9751776의 전체 태그·활성100%·health200·원격 SHA를 Actions Wrangler로 확인해 보존합니다. 학원컴·저장소 직접 재조회와0036 실제 적용은 미확인입니다. 현재 제품은 main232와 차이0이며 최신 제품의36마이그레이션·서버118파일2403개·웹1570개·빌드823ms·두 Worker 검사와 main CI 성공을 적용합니다.9c8b9b9의2400개는 해당 원본의 증거로 유지합니다. 다음은 현재 head CI와 병합 직전 한 번의 Codex 요청입니다.

### (634) TASK-082 날짜 잠금 안의 첫 가예약

TASK-082의 SPEC-015 수락8개·A3·A6과 기존 lockCalendarDay·lockedCalendarSlotStatus를 읽고 첫 가예약부터 구현합니다. 같은 날짜의 마지막 자리를 별도 DB 연결 두 요청이 동시에 잡으면 하나만 잡힙니다. 같은 주문·결제 안내는 한 번이고, 사장님의 휴무일 맞춤 수락은 실제 소유와 최신 잠금 번호·명시 확인 뒤에만 overbooked로 남습니다. 손님 요청의 확인 값으로는 우회하지 못합니다. 다른 가게 주문·결제 안내를 섞으면 같은404로 거절하고 자리 쓰기0건입니다. 관련6개가 통과했습니다.

오래된 잠금 번호 시험은 먼저 준비 SQL이 상태만 바꾸고 lock_version을 올리지 않아 실패했습니다. 실제 A6 쓰기처럼 잠금 번호를 함께 올리는 준비로 고쳐 stale·쓰기0건을 확인했습니다. 자리 모듈은 주문의 상태를 쓰지 않으며 읽은 잠금 번호를 비교합니다. 소유자 호출은 baseRevision을 요구합니다.

현재 WIP는 첫 결제·다시 낸 결제의 잡기뿐입니다. 확정·해제·기한 처리·차액 날짜 변경·재제작과 제한 역할, SPEC-015 나머지 수락 조건, 전체 시험·빌드가 남습니다. 차액 결제는 아직 not_applicable로 막으며 실제 업무 실행기에 연결하지 않았습니다. finished나 구현 완료로 세지 않습니다. 다음은 최신 main 결합 뒤 기한·옮기기 회귀를 먼저 추가합니다.

PR #233의 TASK-072 상태 등록 main43ba212d56286fafe386f5742703a7188f26dabe도 app45335047621·db45335047655·배포138246546651 성공을 확인했습니다. GitHub Actions의 실제 Wrangler 조회에서 버전218df9d3-59fa-4a76-90df-26dc00815d3d의 전체 태그·활성100%·health200과 원격 main 일치를 확인해 main233-deployment.json에 보존합니다. 학원컴·저장소 Worker 활성 태그의 별도 직접 재조회와 실제 DB 새 권한 적용은 미확인입니다.

현재 main 끝남37개·구현 완료22개·MVP 시작 가능37개입니다. TASK-072가 빠지고 TASK-087이 열린 계산은 등록 PR의 공식 DEPS와 상태 JSON에 남았습니다. TASK-081은 실제 상담 연결이 남아 이 수에 넣지 않았고, TASK-082도 첫6개 시험만 지난 WIP입니다. 다음 단계는 기한·차액 변경·확정·해제·재제작·제한 역할 시험입니다.

TASK-082의 기한 해제와 보호를 추가했습니다. 새5개 시험은 수정 전5실패·기존6통과였고 구현 뒤11개가 통과했습니다. 첫 결제 기한 정각에는 잡힌 자리·결제 안내·주문을 같은 트랜잭션에서 기한 상태로 바꿉니다. 일반 마감은 자리 수가 줄면 다시 열리고 사장님이 누른 마감은 유지됩니다.

기한 전에 입금을 알렸으면 결제 기한 상한 전까지 지키고 상한 정각에 풉니다. 맞추는 중과 확인된 결제의 확정 자리는 기한으로 풀지 않습니다. 반복 기한 처리는 주문 잠금 번호를 다시 올리거나 자리를 다시 바꾸지 않습니다. 주문과 결제의 읽은 번호를 조건에 넣고 하나라도 달라지면 전체를 되돌립니다. 안내·장부는 후속 실행기가 같은 트랜잭션에서 남기도록 InTransaction 함수를 제공합니다.

아직 차액 날짜 변경·확정·해제·재제작·추가 수락의 예외와 제한 역할·전체 검사, 실제 실행기 연결이 남습니다. 첫 가예약의 차액 결제와 차액 기한 처리는 아직 막혀 있습니다. WIP를 저장하고 TASK-081 검토7건을 고친 뒤 이어갑니다. finished나 구현 완료를 표시하지 않습니다.

TASK-082의 결제 확인 뒤 자리 확정·픽업 일시 뒤 종료·주문 취소 뒤 해제를 추가했습니다. 새3개 시험은 구현 전3실패·11통과였고 구현 뒤14개가 통과했습니다. 종료된 자리1개와 확정 자리2개는 하루 최대3개를 그대로 채우며 새 주문은 자리 없음입니다. 취소되지 않은 주문은 풀지 않고 반복 해제는 아무 일도 없습니다. 결제 확정·취소의 실제 실행기 연결은 각 담당 작업에 남습니다.

새 주문 복제 시험이 이미 확정된 결제 외래 키를 물려받아 실패한 것은 준비 순서를 고쳐 해결했습니다. 이는 제품 오류로 세지 않습니다. 다음은 날짜 변경·차액 변경·재제작·최소 역할 검증입니다. 상태 표시는 계속 미완료입니다.

TASK-082의 차액 없는 날짜 변경을 추가했습니다. 새2개 시험은 구현 전2실패·14통과였고 구현 뒤16개가 통과했습니다. 사장님의 실제 소유·주문 잠금 번호·변경 요청 잠금 번호와 현재 내용 버전을 확인합니다. 새 픽업 일시는 서버에 저장된 변경 요청에서 읽고 옛날과 새날의 잠금을 날짜순으로 잡습니다. 옛 확정 자리를 푼 뒤 새 확정 자리를 만들며 결제 안내를 새로 만들지 않습니다. 휴무일은 확인이 먼저이고 확인 전 자리 변경은0건, 확인 뒤 overbooked로 남습니다.

주문 내용의 새 버전과 변경 반영은 호출자가 같은 트랜잭션에서 저장하도록 함수 계약을 명시했습니다. 시험도 새 주문 상세·주문 버전·변경 반영을 함께 커밋하여 현재 내용 외래 키를 확인합니다. 시험용 상세 복제의 가게 범위 검사와 source 제약 오류는 시험 준비를 고쳐 해결했고 제품 가드를 약하게 하지 않았습니다. 다음은 차액 대기·해제·적용과 재제작입니다.

TASK-082의 차액 대기 날짜 변경을 추가했습니다. 새2개 시험은 구현 전2실패·16통과였고 구현 뒤18개가 통과했습니다. 확정 주문과 같은 버전의 차액 대기 변경 요청·결제 안내만 새날 자리를 잡습니다. 날짜 변경 키는 주문 ID·변경 요청 ID이며 반복해서 잡지 않습니다. 새날은 잡힘이고 옛날 확정 자리와 주문 버전·내용은 그대로입니다.

차액 기한 정각에는 새날 자리만 change_closed로 풀고 결제 안내는 expired, 변경 요청은 closed_no_difference로 같은 트랜잭션에서 바꿉니다. 원래 주문은 confirmed·버전1, 옛 확정 자리도 유지합니다. 반복 기한 처리는 그대로이고 첫 결제·입금 알림 보호·맞추는 중 보호의 앞선 시험도 유지됩니다. 실제 기한 일 등록과 양쪽 안내는 담당 실행기에서 이 트랜잭션에 연결할 작업으로 남깁니다. 다음은 차액 확인 뒤 반영·재제작·추가 수락 증거와 제한 역할입니다.

TASK-082의 차액 결제 확인 뒤 자리 반영을 추가했습니다. 새 반영 시험은 구현 전1실패·19통과였고 구현 뒤20개가 통과했습니다. 확인된 차액 안내·같은 변경 요청·현재 주문 버전과 새날 가예약을 확인한 뒤 옛 확정 자리를 먼저 풀고 새 잡힌 자리를 확정합니다. 호출자가 주문 상세의 새 버전·금액·픽업 날짜·변경 반영을 같은 트랜잭션에서 저장합니다.

별도 롤백 시험은 자리 이동 뒤 주문 내용 저장이 실패하면 옛 자리1개·원래 버전1만 남고 새 자리는0개임을 확인합니다. 실제 결제 확인·변경 반영 API는 담당 작업에 남으며 이 함수만 따로 커밋하지 않는 계약을 유지합니다. 다음은 재제작·저장된 추가 수락의 한 번 사용과 최소 역할입니다.

TASK-082의 재제작 자리와 기본 디자인의 저장된 추가 수락을 구현했습니다. 새4개 가운데 구현 전3실패·21통과였고 구현 뒤24개가 통과했습니다. 재제작은 주문 ID·remake 키로 새날 확정 자리만 한 번 만들고 결제 안내는 만들지 않습니다. 휴무일은 실제 사장님 소유·잠금 번호·명시 확인 뒤에만 overbooked로 잡습니다. 일 범위의 확인 값으로 우회하지 못합니다.

기본 디자인은 같은 가게·상담·날짜의 답한 에스컬레이션에서 accepted·24시간 기한·미사용을 서버가 확인합니다. 추가 수락 행을 날짜보다 먼저 잠그고 자리 생성과 day_used_order_id를 같은 트랜잭션에 남깁니다. 별도 연결 두 주문의 동시 요청 중 하나만 잡히고 하나는 자리 없음입니다. 기한 정각에는 쓰지 못합니다. 다음은 제한 역할의 허용·차단, API 업무 연결 전의 계약 시험과 전체 검사입니다.

TASK-082의 제한 역할 회귀와 결제 안내 순서를 추가했습니다. 권한 적용 전 새 역할 시험3개가42501로 실패했고 기존26개는 통과했습니다. 필요한 상태·잠금 번호·자리 생성/변경 열만 열었습니다. 주문 상태를 쓰면 커밋 시 기존 제약 트리거가 확인된 결제와 제작 시각을 읽으므로 그 관계 열만 추가했습니다. 실제 제한 역할로 첫 결제 기한·차액 기한·추가 수락·확정·종료가 실행됩니다. 관련 두 파일42개가 종료0으로 통과했습니다.

자리의 가게·날짜·주문 연결·키, 결제 금액·기한, 주문 내용 금액·버전, 변경 내용, 추가 수락의 판정·기한과 다섯 테이블의 삭제는 계속 금지합니다. 결제 안내 대기를 같은 트랜잭션에 넣기 전에 잡힌 자리부터 보이는 계약 시험도 통과했습니다. 실제 주문 요청·결제/취소/변경 API와 기한 일 등록은 담당 작업에서 이 함수에 연결합니다. 실제 스테이징 권한 적용은 기존 Vault/DB 연결 장애로 미확인입니다.

PR234는 main172ad4b165eb8d3798dbf7b1bf5b33162ab053d2에 합친 뒤 app45339293306·db45339293318 성공을 확인했습니다. PostgreSQL17.11의 첫 checkout이 GitHub443 연결 실패였고 실패 작업을 한 번 재실행해 통과했습니다. 배포138260561039의 실제 Wrangler는 버전e77539c7-d6d5-4fef-b8d6-92e3a12b9c2d·전체 태그 일치·활성100%·health200, 원격 main SHA 일치입니다. docs/records/slot-holds/2026-11-24/main234-deployment.json에 증거를 남깁니다. 학원컴·저장소 활성 태그의 별도 직접 재조회는 미확인입니다. TASK-081 전체는 실제 상담 전달·업무 명령이 남아 완료 표시는 하지 않았습니다. 다음은 닫힌 차액 변경의 해제와 전체 검사입니다.

TASK-082의 변경 닫기·주문 취소·변경 잠금 번호 회귀를 추가했습니다. 새 닫기 시험은 구현 전1실패·31통과였고 구현 뒤 가예약32개와 제한 역할13개, 두 파일45개가 종료0으로 통과했습니다. 차액 안내와 변경 요청이 닫힌 뒤에만 새날 잡힌 자리를 풀며 반복 해제는 그대로입니다. 원래 확정 자리는 지킵니다. 차액을 기다리던 주문이 취소되면 옛 확정 자리와 새 잡힌 자리를 함께 풀고, 변경 요청의 오래된 잠금 번호로는 자리 이동을 하지 않습니다.

제한 역할로도 변경 닫기와 두 자리 취소 해제를 확인했습니다. 기한 일 등록은 실제 JOBS의 TASK-098(payment_due)·TASK-119(difference_due)에 연결할 몫이고, 주문 요청·결제 확인·변경 반영·취소·재제작의 업무 실행기는 각 담당 작업에 남습니다. TASK-082는 이 공통 저장 함수와 SPEC-015의 자동 시험 범위입니다. 다음은 새 빈 DB의 전체 검사·빌드·수락 기준 대조와 PR입니다.

TASK-082의 첫 전체 검사에서 서버121개 파일 중120개·2465개 시험이 통과했고, 기존 staging-runtime-role의 주문 상태 수정 금지 기대값1개가 실패했습니다. 기한 처리가 허용한 상태 열과 맞지 않아 허용 기대를 고치고 금액·내용 버전·삭제·안내 본문은 계속 금지하는 단언을 추가했습니다. 제품 권한을 더 넓히지 않았습니다.

입금 알림 보호 시험은 픽업 전날18:00의 주문 마감을 due_cap_at으로 저장하여 그 정각에 풀리는 경우를 명시했습니다. 상한의 계산 자체는 TASK-093의 결제 안내 생성에 남고 이 함수는 저장된 기한을 사용합니다. 가예약·카카오 제한 역할·캘린더 실제 역할 세 파일64개가 종료0으로 통과했습니다. 형식·lint·타입 검사도 통과했습니다. 새 빈 DB로 전체 검사·빌드를 다시 실행합니다. 수락 기준8개와 A3·A6 대조는 docs/records/slot-holds/2026-11-24/task-082.md에 남겼습니다.

TASK-082의 새 빈 PostgreSQL 전체 재검사가 끝났습니다. 마이그레이션36개 적용 뒤 서버121파일2466통과·웹65파일1570통과, Vite774ms와 두 Worker dry-run이 모두 종료0입니다. 원본은 로컬3839a35f390a1cf290deabb63b4c7e231fe4bb8b·공개37b7d4d530a155f2136f1c22f1fc571582f0755e·전체 트리536379fd8b4d4216a1a36dc2b72021f1658530c9로 같습니다. 검사 이름은 siljang-task082-final-0636입니다. 관련64개 시험·형식·lint·타입·WBS·비밀값 검사를 통과했습니다.

첫 전체 검사의 기존 권한 기대1개 실패는 그대로 기록했고 수정 뒤 전체를 다시 통과했습니다. SPEC-015 수락8개와 A3·A6의 자동 대조를 기록했습니다. #8은 같은 트랜잭션에서 자리를 먼저 잡은 뒤 안내 대기를 남기는 공통 함수 계약이며 실제 API-071 주문 요청은 TASK-083·084가 연결합니다. 실제 업무 API·기한 일·발신을 구현했다고 세지 않습니다. 실제 스테이징 열 권한 적용은 미확인입니다.

다음은 리뷰 준비 PR, 현재 head app·db CI, Claude 코드·보안 리뷰 처리와 병합 직전 Codex 요청 한 번입니다. squash 뒤 main CI·실제 Wrangler 전체 태그/활성100%·health200·원격 SHA를 확인한 다음 TASK-082의 상태를 판단합니다. 현재 끝남37개·구현 완료22개이며 아직 바꾸지 않았습니다. TASK-077은 별도 WIP 브랜치에11개 실패 시험과 다음 단계를 저장했습니다. 실제 모델·카카오·구글·결제 호출0회입니다.

PR235의 Claude 리뷰7124427754(코드9건·보안0건)를 처리했습니다. 휴무일의 기본 디자인은 저장된 마감 추가 수락으로 받지 않습니다. 차액의 오래된 변경 잠금 번호는 확보·기한·반영에서 모두 stale입니다. 늦은 차액 기한은 받음·미수령에서도 새날만 풀고, 잡힌 자리 없는 첫 결제도 만료합니다. 이미 잡힌 차액 자리는 새 픽업 뒤 결제를 확인해도 반영할 수 있습니다.

호출 순서를 주석에 명시했고 기간 검사·추가 수락 선택·확정 자리 조회를 공유했습니다. 날짜 잠금은 첫 확보1회, 차액의 옛날·새날2회이며 거절 전에 새 날짜 행을 만들지 않습니다. 공유 역할의 열 권한이 값별 전이를 제한하지 않아 다른 SQL 결함으로 상태를 되돌릴 수 있는 위험은 review-235.md와 권한 SQL 주석에 명시하고 기존 설계를 유지했습니다. 권한 열을 늘리지 않았습니다.

새10개 회귀는 수정 전10실패·32통과였고 수정 뒤 가예약42개, 캘린더·두 제한 역할을 포함한 다섯 파일151개가 종료0입니다. 타입 검사의 시험 자료 optional 값은 행 존재를 먼저 확인하도록 고쳤습니다. 다음은 새 빈 DB 전체 검사·빌드, 현재 head CI와 발견별 처리 댓글입니다. 기존 Codex 요청7124324619는 반복하지 않습니다. 실제 스테이징 권한·업무 API·기한 일 연결은 미확인/담당 작업으로 남고 완료 표시는 아직 하지 않습니다.

TASK-082의 Claude9건 수정 뒤 새 빈 DB 전체 검사·빌드가 종료0으로 끝났습니다. 마이그레이션36개, 서버121파일2476통과·웹65파일1570통과, Vite952ms·두 Worker dry-run입니다. 원본은 로컬030d1254cf96cdf5d07aa358d5c1a12a18714c78·공개4ed9f93d87fa3fafd868ae623ad13cccf06b5c17·전체 트리61143a0ee7d7f4885fcf19c933b4db1a7e38ce5d로 같습니다. 이전2466건은 리뷰 전 원본으로 보존하고 source.json의 최신 원본을 갱신합니다.

수정 head의 app45347105550·db45347105569도 성공했습니다. Claude 코드9건·보안0건과 처리 댓글7124883035, 원래 Codex 요청7124324619 한 번 뒤 코드7124360057·보안7124400909 발견0건을 확인했습니다. 리뷰 뒤 변경은 발견 사항 처리뿐입니다. 최종 기록 커밋의 CI를 다시 확인한 뒤 squash하고 main CI·Wrangler 태그/활성100%·health200·원격 SHA를 확인합니다. 아직 TASK-082 끝남 표시는 하지 않았습니다. 실제 스테이징 권한·업무 API·기한 일 연결은 기존 미확인/담당 작업대로입니다.

### (635) TASK-077 사장님의 상담 대화 조회

TASK-077(API-043) 상담 대화 조회를 시작합니다. main172ad4b 기준 끝남37개·구현 완료22개·MVP 앞선 작업 충족37개입니다. TASK-081은 실제 상담 연결, TASK-082는 전체 검사·PR 진행 중이고, 더 낮은 반복의 실제 환경 검증은 기존 외부 장애로 보류돼 있습니다. 남은 반복3 가운데 TASK-077은 TASK-066·024가 끝나 시작할 수 있고 다음 TASK-089 하나가 기다립니다. 같은 순위의 뒤에 기다리는 작업 없는 것보다 먼저 골랐습니다.

저장소의 API-043·ConsultationMessagePage와 마스킹 복원·파일 서명·페이지 커서·사장님 인증 경로를 읽었습니다. 같은 가게 상담만 읽고 전화·계좌는 사장님에게만 복원하며 카드번호는 끝4자리, 긴 숫자는 플레이스홀더만 보입니다. 손님 안내를 시각 순으로 섞고 지운 상담은 deleted·빈 목록입니다. 다음 단계는 200·401·404·422·default와 개인정보·페이지 순서의 실패 시험입니다. 실제 모델·외부 발신·결제는0회입니다.

TASK-077의 첫 회귀11개를 추가했고 아직 경로가 없어10실패·없는 상담404 한 개 통과입니다. 전화·계좌 복원과 카드번호/긴 숫자 비노출, 사장님 답·다른 안내 섞기, 지운 상담 빈 목록, 인증과 목록 입력, 다른 가게404, 접속기록 실패500을 검사합니다.

메시지와 안내를 같은 시각에 남기면 기존 created_at·UUID만으로 실제 저장 순서를 가릴 수 없습니다. 페이지의 누락·중복과 DEC-14를 지키기 위해 두 테이블에서 함께 쓰는 내부 순번을 추가하고, 그 순번과 마이크로초 시각으로 커서를 만들 예정입니다. 응답 스키마에는 내부 순번을 노출하지 않습니다. 다음 단계는 실패 시험으로 같은 시각의 두 종류 기록·페이지 경계·삭제/정정 뒤 순서를 고정하고, 기존 자료의 정렬 기준을 명시하는 마이그레이션과 최소 역할을 검증하는 것입니다. 아직 구현 완료가 아닙니다.

TASK-077의 같은 시각 메시지·안내 정렬을 위한 0037 마이그레이션과 원본 스키마를 추가했습니다. 이행 시험은 구현 전 파일 없음으로1실패였고 구현 뒤1통과, 기존 카카오 최소 역할을 포함해 두 파일14개가 종료0입니다. 기존 본문·ID·시각을 보존하며 새 기록은 두 테이블의 공통 순번으로 증가합니다. 과거의 완전히 같은 시각은 실제 삽입 차례를 복구할 수 없어 시각·종류·ID 순을 문서에 명시했습니다.

서버 역할은 기본값에 필요한 시퀀스 USAGE만 허용하고 SELECT·UPDATE(setval)는 막는 단언을 추가했습니다. ERD 원본·대응·생성기·Editor 동기화를 적용했고 새 빈 DB의 schema/migrations 대조를 포함해 ERD15개가 통과했습니다. 첫 단계 검사에서 WBS 생성 절1개가 오래돼 실패하여 생성기로 갱신합니다. API·브라우저 검사는 이 단계에서 실행하지 않았고 page-check는 미확인입니다. 실제 스테이징 적용·API-043의11개 회귀 구현은 아직 남았습니다. 다음 단계는 안정된 페이지 커서·전화/계좌 복원·사진 서명과 실제 사장님 경로입니다.

TASK-077의 ERD 출력 SQL을 실제 PostgreSQL에 적용하는 추가 비교에서 기본값이 참조하는 시퀀스가 없다는 실패를 확인했습니다. 원본 스키마·마이그레이션 검사15개만으로는 ERD의 before 스크립트 누락을 잡지 못했습니다. 생성기의 공통 before_script에 시퀀스와 설명을 넣고 동기화·기존 builder·E1 검사를 같은 원본에 맞췄습니다. 금지된 --build는 실행하지 않았고 허용된 --compare로 실제 출력 SQL을 검증합니다.

WBS의 생성 절은 생성기로 갱신했고 두 번째 단계 검사는 PRD·흐름·명세·ERD·사이트맵·화면·정적 목업·WBS가 통과했습니다. API 검사는 생략, 브라우저 page-check는 미확인입니다. 표시 순번 이행·최소 역할14개와 앱 형식·lint·타입은 통과했습니다. 아직 API-043 경로의 첫11개 시험은 구현 전10실패·1통과이며 다음 단계는 그 경로 구현입니다.

TASK-077의 API-043 앱 경로를 연결했습니다. 같은 가게 사장님만 읽고 전화·계좌를 복원하며 카드번호는 플레이스홀더와 끝4자리, 긴 숫자는 플레이스홀더만 표시합니다. 한 페이지의 마스킹 값을 한 번에 읽고 기존 암호화·숫자 검증을 공통 함수로 재사용합니다. 손님 안내는 저장된 본문 그대로 시각·공통 순번 순으로 섞고, 개인정보를 지운 주문의 안내는 제외합니다. deleted는 빈 목록, ended는 대화를 유지합니다.

커서는 상담과 마이크로초 시각·표시 순번에 묶으며 같은 시각의 메시지·안내를 한 개씩 넘겨도 빠지거나 겹치지 않습니다. 사진은 원본 저장 위치를 감춘15분 서명 주소만 냅니다. 사진 시험의 누락된 FILE_URL_KEY 설정은 메모리 안의 가짜 키로 고쳤고 서비스의 주입 항목을 늘리지 않았습니다. 경로의 실패 시험15개는 구현 전14실패·1통과였고 구현 뒤15통과, 마이그레이션·기존 마스킹·최소 역할을 포함한 네 파일39개가 종료0입니다. 형식·lint·타입도 통과했습니다.

현재 시험 인증은 시험용 해석기입니다. 표준 사장님 세션을 쓰는 교차 가게 시험, API-043 자체의 제한 역할, 안내 전달 상태 전체, 커서·복호화 오류와 긴 글 경계, 새 빈 DB 전체 검사·빌드·리뷰·실제 스테이징 적용은 아직 남았습니다. 구현 완료 표시는 하지 않습니다. PR235의 Claude 발견9건이 도착해 이 상태를 WIP로 저장하고 해당 리뷰 고침을 먼저 진행합니다. 실제 모델·외부 발신·결제0회입니다.

TASK-077의 최소 역할·전달 상태·복호화 실패·긴 글·같은 ID 경계를 검증했습니다. 새 API 시험을 포함한28개 중 수정 전3실패·25통과였습니다. 사장님 조회에 필요한 안내 표시 열과 사진의 메시지/순서/위치 읽기 열만 더해 실제 제한 역할로 전화 복원·안내·서명 주소를 확인했습니다. 수정·삭제 권한을 늘리지 않았습니다.

100000자 경계는 Unicode 코드 포인트로 세어 마지막 이모지를 보존합니다. 복원 뒤 한도를 넘을 때 표시만 줄이고 저장된 마스킹 글은 바꾸지 않습니다. 메시지와 안내의 UUID가 같아도 안내에는 메시지 사진을 붙이지 않습니다. 전달 상태7개는 API-043의 sending·event_api·deferred·delivered_later·failed와 시각 규칙을 확인했습니다. 다른 가게에 묶인 암호문은 내용 없는500이고 로그에도 원문/암호문이 없습니다. 잘못된 커서 내용·상담·정수 범위도422입니다.

API28개를 포함한 네 파일52개가 종료0이며 형식·lint·타입을 확인합니다. PR235는220d1f2712193d25ff8db29f3cd97d4408481552에 합쳤고 main DB CI는 성공, 앱·배포 확인은 진행 중입니다. 다음은 main 변경 결합·표준 세션 교차 가게 시험·새 빈 DB 전체 검사·빌드입니다. 실제 스테이징0037/권한 적용과 UI 확인은 미확인이고 구현 완료 표시는 하지 않습니다. 실제 모델·외부 발신·결제0회입니다.

TASK-077에 main235의 검토 완료 코드를 결합하고 기록 충돌4개를 원본 번호대로 보존했습니다. 원본 WBS 대응도 생성기로 갱신했습니다. 결합 뒤 형식·lint·타입을 통과했고, API28개를 포함한52개 회귀의 원본은 결합 전 fe4218d입니다. 다음은 마이그레이션37개를 새 빈 DB에 적용한 전체 검사·빌드이며 표준 세션의 교차 가게 시험도 여기에 포함합니다.

main235(220d1f2712193d25ff8db29f3cd97d4408481552)는 app45348986877·db45348986888 성공, 실제 Actions Wrangler 버전5264d3f7-23a1-47d5-98e2-274baec2bb4f·전체 태그 일치·활성100%·health200, 원격 main SHA 일치입니다. 생성은2026-11-24T07:39:29.70214Z이며 증거는 docs/records/consultation-messages/2026-11-24/main235-deployment.json입니다. 학원컴·저장소 활성 태그의 별도 직접 재조회는 미확인입니다. TASK-082 끝남 등록은 별도 상태 PR에서 진행합니다. TASK-077의 실제 스테이징0037·권한 적용은 미확인이고 구현 완료 표시는 아직 하지 않습니다.

TASK-077의 첫 전체 검사는 새 빈 PostgreSQL에 마이그레이션37개를 적용한 뒤 서버123파일 중121개·2504개가 통과하고2개가 실패했습니다. 원본16d17a6954cc2614f45b11222906956182e89121이며 웹·빌드는 서버 실패 때문에 미실행입니다. 교차 가게 공통 요청에는 접속기록용 cf-connecting-ip가 빠져 조회 전에500이 났습니다. 문서용 시험 IP를 공통 요청에 넣어 실제 접속기록 경계를 유지합니다.

기존 원장22건에서 최신까지 올리는 시험은 새 순번의 SELECT setval에 수신 대상이 없어 실패했습니다. 새 마이그레이션0037의 초기화만 DO/PERFORM으로 바꿔 빈 데이터베이스의 직접 실행과 기존 스테이징 갱신 블록 양쪽에서 동작하게 합니다. 이미 main에 합친 마이그레이션은 바꾸지 않았습니다. Biome 정보1건은 시험 문자열을 템플릿으로 고쳐0건으로 다시 확인합니다. 다음은 고친 원본을 커밋하고 새 빈 데이터베이스 전체 시험·두 Worker 빌드를 다시 실행하는 일입니다. 실제 모델·카카오·구글·결제 호출0회입니다.

TASK-077의 수정 뒤 새 빈 PostgreSQL 전체 검사가 종료0입니다. 마이그레이션37개·서버123파일2506개·웹65파일1570개, Vite1.02s와 두 Worker dry-run이 통과했습니다. 원본은 로컬268e8a3aa67769e00718cd02a0e22bdb7aac1395·공개a7c2d075ff1a9d9ce31162de7eb119a9484cfa7d·전체 트리8739ff3839e85711d066b33f3d433672f18ea2c9입니다. 최초 전체2504통과·2실패와 웹/빌드 미실행은 source.json에 함께 보존했습니다.

API-043의200·401·404·422·접속기록 실패500을 계약과 대조했습니다. 그 가게 사장님만 전화·계좌를 복원하고 카드 끝4자리·긴 숫자 표시자는 남깁니다. 같은 시각 메시지·안내를 공통 순번과 마이크로초 커서로 빠짐없이 넘기며 안내 본문은 계좌 표시자를 채우지 않습니다. 원문을 지운 주문의 안내는 빼고 지운 상담은 빈 목록, 끝난 상담은 남은 대화를 줍니다. 사진은 해당 상담의 메시지만15분 서명 주소로 보이며 실제 저장 위치를 노출하지 않습니다. 최대100000자는 마지막 이모지를 보존하고, 복원으로 넘치면 표시만 줄입니다.

실제 최소 역할로 조회·복원·안내·사진과 시퀀스 USAGE만의 허용을 검증했습니다. 시퀀스 SELECT·UPDATE, 민감한 행의 쓰기·삭제는 추가로 열지 않았습니다. 다른 가게404·없는 ID404·잘못된 ID404, 접속기록 실패 시 개인정보 없는500, 다른 가게에 묶인 암호문의 실패와 원문 없는 로그를 확인했습니다. 원본0037과 원래 스키마·설계 대응을 고치고 허용된 생성기와 ERD 비교로 맞췄습니다. 기존 자료의 완전히 같은 시각은 삽입 순서를 복구할 수 없어 시각·종류·ID로 이행하며 이후 기록만 공통 삽입 순번입니다.

실제 스테이징0037·추가 열/시퀀스 권한 적용, 실계정 조회와 사진 주소 열기는 기존 학원컴 Aside·Vault 시간초과로 미확인입니다. finished·구현 완료 표는 아직 바꾸지 않았습니다. 다음은 현재 head CI·코드/보안 검토·Codex 요청 한 번, squash와 main 검증 뒤 상태 판정입니다. 실제 모델·카카오·구글·결제 호출0회입니다.

PR237의 병합 직전 Codex 요청7125744802는 한 번이며 인라인4677148490의 P2를 처리합니다. 미전달 안내의 sent_at이 바뀌면 이미 읽은 안내가 뒤 페이지에 다시 나타납니다. 새 회귀3개와 커서 버전/범위 검사는 유효한 준비 자료로 옛 코드4실패·27통과를 확인했고 고친 뒤 관련4파일55개가 종료0입니다. 첫 준비 자료의 새 수신 글은 카카오 메시지 키가 빠져 제약 오류였고, 가짜 키를 넣어 실제 페이지 실패를 다시 확인했습니다.

커서에 첫 조회의 데이터베이스 트랜잭션 시각·그 상담의 삽입 순번 상한을 보존합니다. 이후 전달된 안내는 그 순회의 첫 시각·전달 상태를 유지하고 첫 페이지 뒤의 새 순번은 새 조회에서 보입니다. 시각·공통 순번으로 정렬하며 아직 읽지 않은 안내도 같은 기준입니다. 지우기·원문 복원·접속기록은 각 요청에서 다시 확인하여 지운 내용을 보존하는 스냅샷을 만들지 않습니다. API 응답 필드는 바꾸지 않았고 아직 배포하지 않은 커서 형식만 버전2로 검사합니다.

기존 전체2506개 결과는 고침 전 원본으로 남깁니다. 다음은 수정 원본을 커밋하고 새 빈 데이터베이스 전체 시험·빌드, 현재 head CI와 발견 처리 댓글입니다. Codex 요청을 반복하지 않습니다. 실제 스테이징0037·열/시퀀스 권한 적용·실계정 확인은 기존 시간초과로 미확인입니다. 실제 모델·카카오·구글·결제 호출0회입니다.

TASK-077의 페이지 수정 뒤 새 빈 PostgreSQL 전체 검사가 종료0입니다. 마이그레이션37개, 서버123파일2509개·웹65파일1570개·Vite686ms·두 Worker dry-run이 통과했습니다. 원본은 로컬ceac8f4dbe522a5ecaf7982ce98f89334bc47dc0·공개6665f163e83fb8d718260551a21549921a1954e0·전체 트리2138fa82ac348145d0fd78790bd595ff2740069e로 같습니다. 기존2506개 결과는 source.json의 beforeSnapshot에 보존합니다.

해당 head의 app45354981489(check138310445374·Windows138310445177)·db45354981511(PostgreSQL16.15 138310444962·17.11 138310445360)도 성공했습니다. Codex 요청7125744802는 한 번이고 코드 P2의 처리 댓글7125981401, 스레드 해결 표시, 보안0건7125836250을 확인했습니다. 발견 뒤 변경은 그 고침과 기록뿐입니다. Claude 검토는 아직 도착하지 않아 AGENTS.md의 기한을 기다립니다.

다음은 최종 기록 head의 CI를 확인하고 최신 main을 반영한 뒤 squash·main CI·실제 Wrangler 전체 태그/활성100%·health200·원격 SHA를 확인하는 일입니다. 실제 스테이징0037·열/시퀀스 권한·실계정 조회와 사진 주소 열기는 미확인으로 남습니다. 아직 finished·구현 완료를 표시하지 않았습니다. 실제 모델·카카오·구글·결제 호출0회입니다.

PR236을 main463728b3d48e0ae2900e74908c4238eda3962a03에 합친 뒤 app45356332433(check138314962508·Windows138314962182)·db45356332450(PostgreSQL16.15 138314962699·17.11 138314962222) 성공을 확인했습니다. 배포138316590913의 실제 Actions Wrangler 조회는 버전4728c83f-a28d-4939-8aa4-85539c162ffc 한 개의 활성100%·전체 태그 일치·health200, 생성2026-11-24T08:31:48.164591Z이며 원격 main SHA도 같습니다. main236-deployment.json과 닫힌 PR236 댓글7126280509에 증거를 남깁니다. 학원컴·저장소 활성 태그의 별도 직접 재조회와 실제 스테이징 권한 적용은 미확인입니다.

TASK-082 끝남 등록을 마쳐 공식 main은 끝남38·구현 완료22·MVP 시작 가능36개입니다. TASK-077에 이 main을 반영하며 기록343·344와635·636을 원본 번호대로 보존했습니다. 제품 파일은 전체 시험 원본ceac8f4dbe522a5ecaf7982ce98f89334bc47dc0과 차이0이며 서버2509개·웹1570개 결과를 재사용합니다. 최신 final 기록 head00ae828a의 app45356019436·db45356019342도 성공했습니다. 이 결합 head의 CI는 새로 기다립니다.

Codex 요청7125744802는 반복하지 않습니다. 이후 변경은 페이지 중복 발견 처리·그 기록·main 결합입니다. 다음은 현재 head CI·최신 댓글을 확인하고 Claude 기한/발견 처리를 기록한 뒤 squash·main 검증을 마치는 일입니다. 실제 스테이징0037·열/시퀀스 권한·실계정 확인은 계속 미확인이며 완료 표는 아직 바꾸지 않습니다. TASK-076은 별도 WIP에서8개 회귀를 통과했고 나머지 조건을 채웁니다. 실제 모델·카카오·구글·결제 호출0회입니다.

### (636) TASK-082 끝남 등록과 다음 작업

PR235를 main220d1f2712193d25ff8db29f3cd97d4408481552에 합친 뒤 app45348986877·db45348986888 성공을 확인했습니다. 배포138292446189의 실제 Actions Wrangler 검증은 버전5264d3f7-23a1-47d5-98e2-274baec2bb4f 한 개의 활성100%·전체 태그 일치·health200이며 원격 main SHA도 같습니다. 증거는 docs/records/slot-holds/2026-11-24/main235-deployment.json입니다. 학원컴·저장소 활성 태그의 별도 직접 재조회와 실제 스테이징 열 권한 적용은 기존 도구 시간초과로 미확인입니다.

TASK-082의 SPEC-015 수락 기준8개·A3·A6은 task-082.md의 자동 시험과 대조했습니다. 최종 가예약42개·관련151개, 새 빈 PostgreSQL 마이그레이션36개·서버121파일2476개·웹65파일1570개·두 Worker 빌드가 통과했습니다. 원본은 source.json의 로컬030d1254cf96cdf5d07aa358d5c1a12a18714c78·공개4ed9f93d87fa3fafd868ae623ad13cccf06b5c17이며 이 상태 PR의 제품 파일은 검증한 main235와 차이0입니다. 전체 검사는 그 원본과 main CI의 결과를 재사용하며 이 문서 변경에서 실행했다고 쓰지 않습니다.

수락 #8은 같은 트랜잭션에서 자리를 먼저 잡고 안내 대기를 저장하는 계약 시험입니다. 실제 주문 요청·결제 확인·변경·취소·재제작 API 연결은 각 담당 작업, 기한 일 등록은 TASK-098·119의 범위로 남깁니다. 공통 저장 함수만의 자동 수락 조건을 채워 TASK-082를 끝남에 등록합니다. 아직 이 PR이 합쳐지기 전 main은 끝남37개·구현 완료22개이며 이 PR 기준 끝남38개·구현 완료22개입니다. 공식 의존 계산의 MVP 시작 가능은37→36개, 전체 의존 충족은41→40개입니다. TASK-082만 목록에서 빠지며 새로 열리는 후속 작업은 없습니다.

첫 WBS 생성은 끝남 설명의 금지어 DB 때문에 오류2건이었고 PostgreSQL로 고쳐18개 검사·오류0을 확인했습니다. 실제 모델·카카오·구글·결제 호출0회입니다. 다음은 현재 head CI와 두 검토, 병합 직전 Codex 요청 한 번을 거쳐 squash하고 main 검증을 마치는 일입니다. TASK-077은 별도 브랜치에서 전체 검사 실패2건의 고침을 진행합니다.

### (637) TASK-076 문의 끊김과 상담 끝남

문의 끊김은 초안을 보존하고 재개하며, 다룬 주문/재제작·결제·변경·신고·환불·직접/간접 할 일이 모두 닫혀야 상담을 끝냅니다. 실제 두 연결의 수신/종료·주문 쓰기 경쟁, 이전 안내→AI 답 한 번과 고지 기록 유지, 만료 견적 재계산을 검증했습니다. 최소 역할의 관계 열만 더하고 신고 본문/계좌 읽기와 쓰기는 거절합니다. 새 빈39개 이행·서버2606개·웹1570개·Vite627ms·두 Worker가 통과했습니다. 구현 완료로 등록하고 실제0039/권한 적용·Cron/수신 확인은 자기 작업에 보존하며 finished는 표시하지 않습니다. [수락·실패와 전체 원본](consultation-idle/2026-11-24/acceptance-checks.md)에 근거를 보존했습니다.

실제0039/원장39·세 읽기 권한 적용을 확인했지만 기존 refunds 전체 SELECT로 계좌 열도 읽혀 금지 점검은 실패로 남겼습니다. 같은 회귀1실패 뒤 필요한 열만 남겨 관련4파일169개·타입·엄격lint를 통과했습니다. 원본 결과/카탈로그 출처와 새 전체 검사·실제 재대조는 consultation-idle/2026-11-24/acceptance-checks.md에 보존합니다.

실제 원본대조 적용1회 뒤 원장39 유지·필요한10열읽기true·환불전체/계좌/신고본문읽기와쓰기false를 확인했습니다. 고친 원본의 새 빈39개 이행·서버2607개·웹1570개·Vite824ms·두 Worker가 종료0입니다. [실제 결과와 통합 기준](consultation-idle/2026-11-24/acceptance-checks.md)에 보존하고 main248 결합 뒤 현재head CI·main 확인을 이어갑니다. 자기 Cron/수신 흐름은 아직 미확인입니다.

### (638) TASK-077 구현 완료와 실환경 확인 등록

TASK-077은 구현 완료로 등록하고 실계정 API-043·사진 주소/만료는 자기 행에 남깁니다. 실제38개 갱신과 허용 쓰기/금지5건·행/역할/멤버십 복구를 확인했습니다. [상태·실제 결과·배포 근거](consultation-messages/2026-11-24/implementation-checks.md)에 확인 범위를 보존했습니다.

main245 상태 원본과 결합해 끝남31·구현 완료30→31개로 다시 계산했습니다. 실제 SQL/일반 역할 점검과 자기 API-043·사진 미확인, 저장소 설정 연결 진행을 구분합니다.

### (639) TASK-077 병합 뒤 검토의 페이지·표시자 고침

PR239의 Claude 낮음6건을 고침3건·실제 설정 경로 회귀로 대조1건·근거 있는 보류2건으로 처리했습니다. 관련5파일120개·타입·ERD 차이0줄·단계 검사가 통과했으며 [발견별 처리와 남은 한계](consultation-messages/2026-11-24/review-followup/claude-239.md)에 모았습니다. main240087367e의 실제 CI·배포·전체 태그/활성100%/health200·원격 SHA도 확인했습니다. 끝남30개·구현 완료30개이고 TASK-077 자체 실제 적용·계정 확인은 미확인입니다. 다음은 고친 원본의 새 빈 PostgreSQL 전체 시험·빌드와 현재 head CI·처리 댓글·squash/main 검증입니다.

TASK-077 Claude 검토 고침 뒤 새 빈 PostgreSQL 마이그레이션38개·서버125파일2535개·웹65파일1570개·Vite650ms·두 Worker 빌드가 모두 통과했습니다. [발견별 처리와 최종 원본](consultation-messages/2026-11-24/review-followup/claude-239.md)에 근거를 모았으며 실제 적용·계정·사진 주소 확인은 미확인입니다. 다음은 현재 head CI·처리 댓글·squash/main 검증과 PR238의 상태 기록 갱신입니다.

### (640) TASK-082 끝남 판정과 확인 범위 정정

끝남30개·구현 완료30개·MVP 시작 가능36개·전체 의존 충족40개입니다. [판정과 검토 처리](slot-holds/2026-11-24/implementation-checks.md)·[끝남 재대조](slot-holds/2026-11-24/finished-audit.md)에 근거를 모았습니다.

### (641) TASK-020 실제 로그인 콜백 오류 진단

PR241 Claude 검토7129590544의5건을 처리했습니다. TASK-028의 같은 문제는 별도 브랜치에서 고침·140개를 통과했고, 이 PR에는300대 거절 명시·토큰/사용자 조회의301·302·303·307·308 행렬 시험·기록 시점과 공개 원본을 반영했습니다. 관련2파일55개·타입·lint가 통과했습니다. [처리 근거](owner-login/2026-11-24/runtime-fetch-checks.md)에 보존하고 현재 head CI 뒤 병합 직전 Codex 리뷰를 한 번 요청합니다. 실제 로그인 확인은 main 배포 뒤입니다.

### (642) TASK-028 Workers 전송 정책 오류 고침

Claude 검토의3건을 처리하고 관련159개·타입·형식 다음 lint를 통과했습니다. 실제 SQL38개는20:04 적용됐고 쓰기 점검42501과 실제 카카오 흐름은 미확인입니다. [검사 원본·실제 결과·검토 처리](kakao-worker-fetch/2026-11-24/checks.md)에 근거를 구분했습니다.

### (643) TASK-028 합성 쓰기 점검의 역할 전환

Claude 검토4건을 처리하고 관련25개·타입·형식 다음 lint를 통과했습니다. [원본 검사·임시 권한 안전 범위·발견별 처리](kakao-runtime-probe/2026-11-24/checks.md)에 근거를 보존했습니다. 실제 역할 점검은 main 반영 뒤 실행하며 아직 미확인입니다.

### (644) TASK-020 실제 로그인과 끝남

실제 로그인·내 정보200·화면 로그아웃 뒤401과 조건 대조로 TASK-020 끝남을 표시합니다. Claude6건을 처리하고 [실제 근거·검토 처리·후속 준비](owner-login/2026-11-24/finished-checks.md)에 확인 범위를 보존했습니다.

### (645) TASK-021 새 합성 운영자의 비출력 인증과 실제 SQL 전달

기존 운영자 Auth/MFA가 준비되지 않은 실제 사전 확인을 기록하고, 기존 계정을 건드리지 않는 새 합성 계정 전용 전달 도구를 더했습니다. 원래 enrollOperator의 단일 쓰기를 공유하며 새 비밀 Vault 보관 확인·실제 SQL 결과 nonce/해시/인증 일치를 모두 요구합니다. 임시 SQL 함수의 인증 불일치 쓰기3개 실패 회귀를 고쳤고 기존 수단 삭제 금지·보관/대기 실패·finally 종료까지5파일52개와 타입·엄격lint가 통과했습니다. [진행/안전 경계](operator-login/2026-11-24/preflight.md)에 사전 확인과 검사 근거를 보존합니다. 새 계정/TOTP 생성·실제 로그인은 아직0회이며 새 빈38개 이행의 서버2608개·웹1570개·Vite573ms·두 Worker도 종료0이며 코드/보안 검토와 main 확인 뒤 실제 준비를 진행합니다.

검토7134530706의 factors 생략·응답 유실 재개·최종 확인 경쟁을 실패 시험부터 고쳤습니다. 같은 합성 수단/원래 요청과 새 SQL 전달nonce를 대조하며 기존 수단을 지우지 않습니다. 실제 PostgreSQL 두 연결 경쟁에서 최종 불일치는 쓰기도 되돌립니다. 최종7파일69개·타입·엄격lint521파일이 통과했고 고친 원본의 전체 검사는 다시 실행합니다. 실장님 봇은 도구를 Codex로 적었으므로 Claude 결과로 세지 않습니다. 실제 새 계정 생성은 아직0회입니다.

검토 고침 원본e5c3f88의 새 빈38개 이행·서버132파일2625개·웹65파일1570개·Vite725ms·두 Worker가 종료0입니다. main249 리뷰 정책 결합 후 제품 차이0이며 현행 AGENTS.md의 실장님 Codex 검토를 적용합니다. 현재head CI·main 확인과 실제 계정 준비는 이어서 진행합니다.

### (646) TASK-045 공개 합성 조회와 구현 완료

실제 공개 합성200·없는 주소404를 확인했고61회 상한 안에서429는 관찰하지 못했습니다. [코드·시험·실제 확인 범위](booking-page/2026-11-24/implementation-checks.md)에 근거를 보존하며 구현 완료로 등록하고 사진/발급 확인은 자기 행에 남깁니다.

학원컴 네이티브 CLI 인증과 현재 main244 활성 태그를 직접 확인했고 저장소/인증 설정 일곱 이름이 없음을 확인했습니다. 실제 사진 오류 로그는 미확인으로 두고 누락 설정 연결을 이어갑니다.

### (647) TASK-170 스테이징 누락 설정 연결

누락된 저장소/인증 일곱 이름을 새 Vault 보관 값과 승인된 비출력 파일/표준입력 경로로 연결했습니다. main238 자동 배포 뒤 실제 태그·활성100%·health200·원격 SHA와 별도 학원컴 네이티브 설정 이름을 확인했고 전용 비밀 파일은 지웠습니다. 합성 업로드/등록UI 각1회와 내 정보/내 가게200을 확인했습니다. POST 상태·사진 읽기·대시보드 UI는 미관찰입니다. [비밀 출력 경계·설정/실제 근거](staging-settings/2026-11-24/checks.md)에 보존합니다.

### (648) 실장님 PR 리뷰 엔진의 Codex 전환

Orca 실장님 항목 114(e2083)의 결정에 따라 [PR 리뷰 규칙](../../AGENTS.md#pr-리뷰)과 두 인계 문서를 맞췄습니다. 새 첫 리뷰 댓글과 재리뷰 요청에는 전체 head SHA를 적습니다. 이 결정 전에 남은 Claude 리뷰와 재리뷰 요청에는 같은 병합 조건을 적용합니다. 자동화 실행이 확인되지 않으면 PR 링크와 전체 head SHA를 실장님에게 전달하며, 실장님이 직접 리뷰하거나 병합 뒤 리뷰를 위한 이벤트 대기를 등록합니다. 새 문구의 CORTHEX 용어 검사 후보는 0건입니다.

### (649) TASK-032 실제 등록/조회와 자연 만료 끝남 대조

실제 합성 등록과 자기 가게200·사진200/자연 만료404/새주소200·현행착지의 안전한 원본 해시를 대조했습니다. 기존 자동 수락과 현재 main247 전체 검사/배포를 연결해032를 finished로 옮기고 구현 완료 표에서 제거합니다. 관찰하지 않은 POST 상태와 TASK-046의 전체 UI 성공은 주장하지 않습니다. [조건과 근거](shop-registration/2026-11-24-staging/finished-checks.md)에 보존하며 제품 차이는0입니다.

### (650) TASK-021 로그인 잠금 권한과 실제 준비 전 중단

operators의 어느 열에도 UPDATE가 없어 FOR SHARE가 막히는 실제 사전 확인 뒤 계정/TOTP 생성 전 중단했습니다. 최소 ID열 잠금·연결 열 읽기·새 세션/실패 기록 권한을 원본에 더했고3실패 뒤 관련55개·전체2628개/웹1570개·빌드가 통과했습니다. 보안 열 수정/운영자 삭제는42501입니다. [원문과 남은 실제 적용](operator-login/2026-11-24/runtime-grants.md)을 분리하고 TASK-021·031은 아직 구현 완료로 둡니다.

### (651) TASK-049 현재 원본 화면과 캡처 보존

예전 스크린샷 미확인을 현재 원본6장 직접 대조와 종료 뒤 파일/해시로 보완했습니다.30시나리오/36페이지 검사의 오류/경고/넘침/44px미달0과 실제 도안50개 저장/읽기를 별도 원문으로 보존합니다. [049 끝난 조건](price-list/2026-11-24-finished/finished-checks.md)을 대조해 finished로 옮기며 다른 화면/견적/실제 주문 성공으로 확대하지 않습니다.

### (652) TASK-061 공개 예약 경로와 사진·달력 상태

준비 중 화면으로 가던 공개 경로에6상태/5응답을 연결했습니다.5개 실패 뒤 공개필드/주소검사·동시사진오류1회갱신·새주소실패빈자리·Retry-After·달경계/폭전환·60초철회반영을 확인했습니다. 전체 서버2670개/웹1606개와 로딩 고침 뒤 웹전체/빌드가 통과했습니다. [원본과 실제 미확인](public-booking/2026-11-24/acceptance-checks.md)을 구분하고 실제 단계를 모의 성공으로 대신하지 않습니다.

- 고침 후속: 실장님 Codex 검토7137919134의 정기 갱신 사진창/선택 달·새 주소 복구 한도2건과 넓은 로딩1건을 고쳤습니다.5개 회귀 실패 뒤 관련110개·웹전체1611개·타입/엄격lint/두 Worker 빌드가 통과했습니다. 실제 원문/6장은 [수락 대조](public-booking/2026-11-24/acceptance-checks.md)에 보존하며 고침 뒤 학원컴 집중 검사는 진행 중입니다. 기본20상태0건과 모달 배경 경고78건/2미확인을 구분합니다.

추가: V3 정기 조회/서명 갱신은 확인됐고 철회 초점2실패를 별도로 재현했습니다. 선택적 가게 제목 복귀를 더한 원본4a4f863에서 관련91개·웹1614개/타입/엄격lint/두 Worker가 통과했고 실제 V4 집중 확인은 진행 중입니다. 원문53경고/예상 밖 리소스14·4장 캡처를 [검토 고침 기록](public-booking/2026-11-24/review-fixes-checks.md)에 보존했습니다.

- V5 후속: 순차활성360/1280의철회직후/최초500ms·첫Tab과원버튼복귀를확인했습니다. 원문/사진2장을보존하고root도직접봤으며360클립/제어오류와기존실패를구분합니다. 자기실제게시200/없는404는남겨finished는바꾸지않습니다.

### (653) TASK-021 실제 운영자 인증 확인

- 실제 최소 권한 적용과 새 Auth1/TOTP1/Vault 보관 뒤 로그인200·막기401·풀기 뒤 이전401·로그아웃401·최종200을 확인했습니다. [원문/수락 대조](operator-login/2026-11-24-finished/finished-checks.md)에 과거 준비 중단/OS종료코드null/추가설정 미확인을 유지합니다. 제품/DB/의존성 변경은0이며 현재 head CI·검토를 이어갑니다.

- 검토7138983958 후속: 인용 파일명을 바로잡고 API-004/005/006의 DB 실패 default500을 각각 추가했습니다. 관련3파일54개·타입/엄격lint가 통과했고 기존 공통 오류 시험을 개별 응답 시험으로 세었던 범위를 고쳤습니다. 실행 코드/DB/의존성 변경은0이며 최종 전체/현재head CI를 확인합니다.

- 추가 원문/최종 전체: 새 빈39개 이행의 서버2676개·웹1570개·Vite752ms·두 Worker를 확인했습니다. 가입차단/TOTP/화면한도·IP읽기와 Vault OTP생성기 미설정의 사전2실패를 구분해 기록했고 현재200세션을 유지합니다. 새 전달 경로와 추가401/정상200 전 finished는 바꾸지 않습니다.

### (654) TASK-050 이력의 목록 복귀 초점

- 실제360에서 발견한 상세→목록 BODY 초점 유실을 가격표/규정의3개 실패로 재현하고 고쳤습니다. 목록/세션 준비 뒤 고른 링크나 목록 영역으로 복귀하되 사용자가 옮긴 초점은 보존합니다. 관련55개·웹전체1574개·Vite645ms·두 Worker가 통과했고 [원문/6장/실제 읽기](price-list/2026-11-24-history/acceptance-checks.md)를 보존했습니다. 미등록2건은 시험 응답 불일치이며 새 원본 실제 집중 검사는 진행 중입니다.

- 검토7139244145의 P3 후속: 브라우저 방문기록 복귀도 같은 초점 규칙을 적용했습니다.1실패/1통과 뒤 관련57개·최신 웹전체1576개/빌드832ms/두 Worker·타입/엄격lint가 통과했습니다. 최신 원본e62bb12의 실제 집중 검사는v3로 안내했고 이전 원문을 유지합니다.

- V5 후속: 넓은 직접 옛 버전 복귀의 BODY1실패를 보존했습니다. 원래 제품4실패/58통과 뒤 넓은 화면도 선택링크/목록영역으로 복귀하도록 고쳐 관련62개·웹1626개/타입·엄격lint·빌드가 통과했습니다. 사진2장은 root도 직접 봤고 새V6 실제 확인은 대기입니다.

공개42b622e의CI성공과실제검사성공을구분합니다. SSH배너뒤인증전시간초과는상태조회/일반명령두실패로접속확인만보류하고제품실패/로그인실패로추정하지않습니다. ZIP무결성과지시수신ACK는다르므로접속복구뒤기존진행/대기열을먼저읽습니다. 자동조건/현재CI가채워진고침은finished대신구현완료만제안하며자체실환경남음행을보존합니다.

### (655) TASK-039 실제 버전 저장과 최소 권한 대조

- 실제 규정201두회/같은값200·현재/이전GET200과 v1결제12시간 보존·원장39/전체열 최소권한을 확인했습니다. [기존6수락/4API응답·A21/원문과 시점](operating-rules/2026-11-24-finished/finished-checks.md)을 구분해 TASK-039 finished를 제안하며 자기 구현 완료 행을 제거합니다. 실행 코드/DB/의존성 변경0이고 현재head CI/검토·main 확인을 이어갑니다.

- 검토7139640140의 P3 후속: 첨부 링크를 관찰 기록/권한 확인 결과로 명시했습니다. SHA-256은 추린 JSON 바이트를 검증하며 HTTP/SQL 전문 해시로 주장하지 않습니다. JSON/해시·조건/상태는 그대로입니다.

### (656) TASK-087 준비 중 홈을 실제 할 일 목록으로 연결

SCR-016의 데이터·기다림·지연·배너·탭·커서와 오류/접근/재확인 수명을 연결했습니다. 보류 상태의 읽기 홈과 수정 경로, MVP 채널 안내 숨김, 대상 없는 행의 비링크를 구분합니다. 첫5실패·로그아웃1실패 뒤 관련86개·새39개 이행의 서버2676/웹1642·타입/lint/두 Worker가 통과했습니다. 실제7상태/13응답 화면은 학원컴에서 대기 중이며 [검증 기록](owner-tasks/2026-11-24/implementation-checks.md)에 명시했습니다. finished/구현 완료 수는 바꾸지 않습니다.

검토 보완: 주문번호6~8자·잘못된필터로그아웃·신원재확인전/실패의이전가게숨김을6실패뒤고쳤습니다. 관련92개/웹1648개·타입/엄격lint/두Worker가통과했고새v2실제화면은확인중입니다.

최신 main 통합의 현재 웹1704개와 이전 홈 고침92개/별도 설치 전체 결과를 구분합니다. SSH 인증 전 시간 초과로 실제 V2는 미확인이라 자체 구현 완료 행만 제안하고 finished로 올리지 않습니다. 브라우저 정지ACK 전에 다른 세션의 초점 예약을 풀지 않습니다.

수동 검토4686829380의 재마운트 초점 문제를4실패/7통과로 고정한 뒤 고쳤습니다. 신원 재확인 중 데이터 숨김을 유지하며 같은 가게의 명시적 탭 이동만 한 번 복구합니다. 다른 요소의 초점/다른 가게/비활성 문서는 보존합니다. 관련11개·현재 웹1712개·타입/엄격lint/두 Worker가 통과했고 main261 통합의 제품/의존성 차이는0입니다. 수정 전 V2는 중단하고 재현 가능한 V3 생성·Linux/Windows 컴파일 검사를 추가했습니다. 현재 main36/31→제안36/32·시작 가능30/전체 의존34이며 실제 두 폭/자기 가게는 미확인입니다. 수동 요청7144977968은 한 번만 사용했고 새 head 처리/재리뷰와 CI·main 배포를 이어갑니다.

### (657) TASK-035 실제 세 종류/커서와 합성 기록 정리로 끝남 대조

API015 네 응답 시험과 실제 운영자200·3종/limit1의3페이지/누락중복0을 대조했습니다. 이번 합성3개만 적재/정리해 원래4개/표식0/빈 API200으로 복구했습니다. [원문과 템플릿](operator-alerts/2026-11-24-finished/finished-checks.md)에 관찰 해시와 실제 장애/발신 미실행·화면 계수 경계·버전 추정을 구분했습니다. 실행코드/DB/의존성 변경0, TASK035 finished/상태35/29 제안이며 현재head CI·검토·main 배포는 별도 확인합니다.

### (658) TASK-034 실제 판정/사유와 권한 대조

[실제 자기합성 보류/확인·사유참조와 고정원본 전체검사](license-review/2026-11-24-finished/finished-checks.md)를보존하고초기기록의대기를당시시점으로표시했습니다. 실제권한추가SELECT의기대일치/직접승인금지를확인해finished/자체구현완료행제거를제안합니다. 실행코드/DB/의존성선언변경0이며후속원문/현재head CI·검토를확인합니다.

- 검토7142828117 P3: SQL경로를text eol=lf로고정하고학원컴Windows의최소Git/core.autocrlf=true/재체크아웃뒤원본1781바이트/해시일치를확인했습니다. 실제SQL/권한원문·제안상태는바꾸지않습니다.

### (659) TASK-040 실제 교체·불변성 관찰과 관측 한계

[자기합성계좌다른값1회/같은새값유지·권한/암호화원문](payments/2026-11-24-finished/finished-checks.md)을보존했습니다. 현재1/옛retired1·알림1·옛암호문/생성/확인보존·새확인null이정상A25임을구분합니다. 응답본문은문서화API미지원/기존안내참조는실제0건으로미확인이라PR238대로구현완료표에유지합니다. 추가저장/직접PUT/외부발신/결제·권한키변경0입니다.

- 검토7143483886: SPEC006 수락 번호별 근거를 원문에 맞추고 DB 알림/실제 카카오 수신·안내 실측을 구분했습니다. 로컬 c00d901의 공개 조회를 주장하지 않고 공개 head17a6c389의 CI 전체2676개/1615개에 직접 연결했습니다. 실제 원문/상태는 그대로입니다.

### (660) TASK-054 합성 자료의 재생성과 관찰 범위

임시 폴더의 빌드 도구에만 의존하지 않고 실제 제품·토큰/폰트·계약과 기존 page-check 원본에서 같은 자료를 만드는 생성기를 저장소에 남깁니다. 자료 컴파일·자동 상호작용과 실제 브라우저 page-check·이미지/자기 계정 확인은 다른 근거이며 각각 미실행을 명시합니다. 관련96개/자료 생성은 통과했습니다. SSH 인증 전 시간 초과와 VPN 설정 상태를 구분하고 원인을 추정하거나 동시 브라우저 예약을 해제하지 않습니다.

합성 응답 자체가 계약의 상태를 만들지 못하면 제품 검사가 잘못될 수 있습니다. Windows 경로를 직렬화하고 생성된 모의코드의 최초404→created/10분기한/빈블록409를3실패로 고정한 뒤 고쳐3통과를 확인했습니다. 같은검사를 두운영체제CI에 연결하며 생성/HTTP응답검사를 실제브라우저성공으로 합치지 않습니다.

### (661) TASK-051 현재 운영규정 수락 대조와 자료 재현

[현재 검사/자체 대기](operating-rules/2026-11-24-runtime/acceptance-checks.md)의 API020/021·10상태/15응답을 현재95개로 대조했습니다. 타입/엄격lint/빌드와 main257 뒤95개·자료 생성이 통과했고 앱 제품/DB·서버/의존성은 바꾸지 않았습니다. 임시 절대 경로와 이전 다른 자료 폴더에 기대던 생성기를 저장소의 공통 서버/관찰기로 옮기고 Windows import를 직렬화했습니다. 기존 V4 최종 원문은 접속 복구 뒤 진행/대기열·정지ACK부터 읽어 수집하며 새 V5를 중복 실행하지 않습니다. 실제 두 폭/키보드/사진·자기 가게는 자체 남음으로 구현 완료 표에 두고 finished는 표시하지 않습니다. 부모 배포/새 CI·코드·보안 검토와 병합 직전 수동 한 번/main 확인을 이어갑니다.

부모 main257의 app45497665883/db45497665710·배포138814426055 활성100% 버전82432e43-a3c3-44c8-871d-fc431e5e547d/전체 태그·상태200·원격fb2edae 일치를 확인했습니다. 별도 학원컴/저장소 Worker 직접 태그 조회는 미확인입니다. main257 뒤 타입/엄격lint536파일806ms·Vite648ms/두 Worker와9단계07:09:32~07:09:59 KST 종료0/WBS18오류0를 확인했고 API/브라우저 건너뜀·목업1미확인은 통과로 세지 않습니다.

검토7146083937의 합성 응답 두 P3를 실제 생성 코드4실패/0통과로 고정해4통과/0실패로 고쳤습니다. 현재 값 그대로는200/버전 유지,유효한 변경은201이고 오류는 OpenAPI Problem 본문/미디어 유형을 사용하며 요청 전용 필드를 응답에 넣지 않습니다. 실제 웹 양식으로 요청을 만들고 Node VM에서 검사했으며 브라우저 실행0입니다. 수정 전 V4는 역사 조건으로 남기고 새 V6를 전송하지 않습니다. PR263 공통 입력 검증을 합친 뒤 최종 CI/재리뷰·수동 한 번/main을 잇습니다.

생성기 공통 검증을 PR263과 같은 원본으로 연결했습니다. 다른 깨끗한 작업 트리의 보조 파일을 섞는1실패를 dcf27cb6a3296ce87a1fcb6eb84273e8b725bf37에 고정한 뒤 같은 실행/입력 root 검사와 임시 결과 완성 후 교체·이전 출력 보관으로 고쳤습니다. 고친 8d3376f7c4a55b9f611ceb26fc771e8ac58fa6fd의 채널3개/운영규정 계약4개/경로1개,합계8통과/0실패입니다. 제품 실행 코드/서버/DB/의존성은 추가 변경0이며 정상 새 자료는 V7·전송/브라우저 실행0입니다. PR263의 검증한 main을 합친 뒤 현재 CI/처리·재리뷰/수동 한 번과 자체 main 배포를 이어 확인합니다.

main263의 가게 조건/신원·원본 고침을 2e173cdd6e5591948761e2f30684bb0f93372653에 통합했습니다. 원본/생성 응답의 공통12개와 운영규정 계약4개/경로1개,합계17통과0실패·관련95개/타입·Vite663ms/두 Worker 종료0입니다. 제품 자체 변경은0이고 기존 새 설치/전체 서버 결과와 이번 로컬 실행을 구분합니다. 새 V7의 전송/브라우저 실행0과 기존 V4의 역사 계약 한계를 유지합니다. README369/fix661은370/662 앞에 보존했으며 다음은 부모 main263 실제 배포 확인과 현재 전체 head CI·재리뷰/수동 한 번/main입니다.

부모 main263 d1c91a5b07e791eaeb46f35e43ec25546f789f2c의 app45511255100/db45511255230·실제 배포138861701436을 확인했습니다. 활성100% 버전2ba59ffa-5e50-4e13-a51f-26854b60ff29 생성2026-11-24T23:41:20.045938Z/전체 태그·상태200·원격SHA가 일치합니다. 별도 학원컴/저장소 Worker 직접 활성 태그는 미확인이며 실제 화면 성공으로 확대하지 않습니다. 앞의 부모 배포 진행 중 기록은 당시 관찰이고 현재는 이 확인으로 완료했습니다.

main263 통합 후 단계도08:43:04~08:43:32 KST 종료0/WBS18오류0·ERD15/사이트맵17/화면15통과·목업13통과1미확인입니다. API/브라우저 건너뜀은 통과가 아니며 새 공개 CI가 현재 통합 원본의 설치/전체 서버·웹과 두 OS 자료17개를 다시 검사합니다.

### (662) TASK-087 가게 조건과 합성 자료 소스 확인

병합 뒤7145880877의 보안P2/원본P3를 [후속 대조](owner-tasks/2026-11-24-shop-binding/acceptance-checks.md)에 연결했습니다. 웹3실패/서버3실패를 고정한 뒤 확인한 가게 헤더를 현재 세션과 비교해 읽기 전401로 거절하고, 홈은 이름/이전 목록을 숨긴 채 한 번 신원을 다시 읽습니다. 웹87개/API18개와 실제 생성기의 입력 변경2실패→4통과·타입/엄격lint가 통과했습니다. 헤더가 권한/조회 대상을 선택하지 않으며 기존 응답과 호출 호환을 유지합니다. 기존 V3는 추가 고침 전 자료로 중단하고 현재36/32를 유지하며 전체/CI·검토/수동 한 번·main 확인을 계속합니다.

고정 로컬89e7b2e의 새 빈39개 전체는 서버2680개/웹1715개·타입/엄격lint·Vite763ms/두 Worker가 종료0이고 시험 DB를 삭제했습니다. 자료 계약은 채널3+원본4의7통과/0실패입니다. 단계9단계 종료0/WBS18오류0와 별도 전체 API17통과/D1 5905값·M1 965요청을 확인했습니다. API 단계 건너뜀과 별도 API 성공을 구분하고 최대 길이 생성3한계/브라우저 미실행을 보존합니다.

주소의 이전 가게 커서1실패/13통과도 고쳐 회귀14개·최신 전체 웹1716개/타입·엄격lint/빌드와 자료 컴파일이 통과했습니다. 서버/API는 앞선 새 빈 전체89e7b2e와 차이0이며 서버2680개/웹1715개와 추가1716개를 별도 원본으로 보존합니다.

검토7146781770의 추가P3 세 건을 고쳤습니다. 가시성 재확인의 가게 변경/옛 커서1실패14통과 뒤 세션15개,생성기 경로/실패 출력/이전 보관3실패4통과 뒤 실제 CLI7개가 통과했습니다. 생성기를 입력 저장소에서 실행하도록 검사하고 보조 파일도 그 원본에서 읽습니다. 저장소 밖 임시 폴더에 번들/manifest를 완성·검사한 뒤 교체하며 실패한 생성은 옛 결과를 바꾸지 않고 성공 교체의 옛 결과도 previousOutput에 보관합니다. 최신 웹1717개·타입/빌드가 통과했고 서버/API는89e7b2e와 차이0입니다.

합성 오류 응답의 명세 불일치2실패를 6701513458cbbd08c38da39b115ab5c6dde5e5aa에 고정해 API002/040의 전체 Problem 예시·application/problem+json/캐시 금지로 고쳤습니다. 실제 생성 응답을 Node VM으로 실행한2개와 채널3개/원본7개,합계12통과/0실패입니다. 첫 green의 경합 시험은 이전 가게 헤더를 빠뜨려11통과1실패였고 준비 조건을 고친 현재 def72d6ca0e6a08ccd5c9c81a241fc4cc5e35b8f에서 다시 확인했습니다. 제품 실행 코드/서버/API는 추가 변경0이며 현재 head의 두 OS CI와 검토/수동 한 번·main 배포를 확인합니다. 새 V5 ZIP/학원컴 전송/브라우저 실행0입니다.

### (663) TASK-052 이력 현재 수락과 실제 확인 분리

[운영규정 이력의 현재 수락](operating-rules/2026-11-24-history-runtime/acceptance-checks.md)을 대조하고 재현 가능한 실제 컴포넌트/명세 자료를 보존했습니다. main263 로컬 통합 뒤 관련126개·자료 계약15개/타입·두 Worker가 통과했고 새 로컬 설치/전체 서버 결과와 구분합니다. 코드 자체 변경0·실제 새 전송/브라우저 실행0이며 기존 V6 원문/지시 수신·정지ACK는 접속 복구 뒤 수집합니다. README371/fix663·자체 실환경 행을 제안하며 현재36/32→제안36/33입니다. 다음은 부모 배포/현재 CI·검토/수동 한 번·main 확인이고 finished를 표시하지 않습니다.

단계 명령은08:39:45~08:40:13 KST 종료0/WBS18오류0·ERD15/사이트맵17/화면15통과·목업13통과1미확인입니다. API/브라우저 건너뜀을 통과로 세지 않으며 ✓ built in 714ms와 두 Worker는 로컬 결과입니다. 같은 lock의 설치를 재사용했고 새 로컬 npm ci/전체 서버 실행은 아닙니다. 새 CI가 실제 새 설치/빈39개 이행과 전체 서버·웹을 검사합니다. 부모 main263 배포는 아직 진행 중이고 그 확인 뒤 병합 조건을 진행합니다.

부모 main263 d1c91a5b07e791eaeb46f35e43ec25546f789f2c의 app45511255100/db45511255230·실제 배포138861701436을 확인했습니다. 활성100% 버전2ba59ffa-5e50-4e13-a51f-26854b60ff29 생성2026-11-24T23:41:20.045938Z/전체 태그·상태200·원격SHA가 일치합니다. 별도 학원컴/저장소 Worker 직접 활성 태그는 미확인이며 실제 화면 성공으로 확대하지 않습니다. 앞의 부모 배포 진행 중 기록은 당시 관찰이고 현재는 이 확인으로 완료했습니다.

검토7147803285의 두 P3를 63f05f6dda5461011a1db3120727e8c19e2ecb56의2실패3통과로 재현했습니다. 현재 규정/빈 이력의 돌아가기 GET은 API020의 현재 규정/초안을 반환하고, 목록과 직접 옛 상세가 같은 빈 데이터를 사용해 없는 버전은404입니다. 522225c74fcf064a03e36af1df283fb32f47b8f6의 생성 계약5개·합계17개가 통과한 뒤 main262를 4f9c81b0f8c71d3c2a63e089c0cbeeef99e91f92에 통합해 자료22개/관련126개·타입/Vite576ms/두 Worker가 통과했습니다. 기존 V7은 이 고침 전 로컬 준비이며 새 V8 전송/브라우저 실행0입니다. 부모 main262 배포는 현재 진행 중이고 자체 행 포함 제안36/34·시작 가능28/전체 의존32를 유지하며 다음은 부모 실제 배포/현재 head CI·발견 처리/수동 한 번과 자체 main입니다.

통합 뒤 단계도08:54:46~08:55:18 KST 종료0/WBS18오류0·ERD15/사이트맵17/화면15통과·목업13통과1미확인입니다. API/브라우저 건너뜀과 실제 학원컴 미확인을 보존합니다. 현재 원본에서 다시 계산한 자체 행 포함 제안은 끝남36/구현34·시작 가능28/전체 의존32입니다. 부모 main262 실제 배포와 새 전체 head CI/검토·수동 한 번을 확인하기 전 다음 PR을 합치지 않습니다.

부모 main262 b801aa9af1d29681c6cf1d65beccb04dfa218506의 app45513496720/db45513496771와 실제 배포138868575877를 확인했습니다. 활성100% 버전ec8f7af6-7435-4deb-b92a-9e13ae176278 생성2026-11-24T23:56:16.018492Z/전체 태그·상태200·원격SHA가 일치합니다. 별도 학원컴/저장소 Worker 직접 활성 태그는 미확인입니다. 앞의 부모 진행 중은 당시 관찰이고 현재 이 확인으로 완료했습니다. 현재 main36/33에서 자체 행 포함 제안36/34이며 다음은 현재 head CI/검토 처리·수동 한 번과 자체 main입니다.

### (664) TASK-053 현재 수락과 생성 응답/실제 확인 분리

[결제 수단의 현재 수락](payment-destination/2026-11-24-runtime/acceptance-checks.md)을 대조하고 재현 가능한 실제 컴포넌트/명세 자료를 보존했습니다. main262 통합 뒤 관련73개·자료 계약23개/타입·두 Worker가 통과했고 기존 설치를 재사용한 범위를 구분합니다. 실제 웹 양식으로 만든 생성 응답6개는16응답/헤더 추가1행과 확인·같은 값/실제 변경·요청 키·미등록 저장을 대조합니다. 제품 자체 변경0·V2 새 전송/브라우저0이며 기존 자료/지시 수신·정지ACK와 자체10상태/두 폭·사진/키보드·자기 가게는 미확인입니다. README372/fix664·자체 행 포함 제안36/34를 남기고 다음은 단계/현재 CI·검토와 먼저 열린264 main 통합/수동 한 번·자체 main입니다.

단계09:02:11~09:02:38 KST는 종료0/WBS18오류0·ERD15/사이트맵17/화면15통과·목업13통과1미확인입니다. API/브라우저 건너뜀은 통과가 아니며 새 공개 CI가 설치/빈39개 이행·전체 서버/웹과 두 OS 자료23개를 검사합니다. 현재 부모 main262 배포는 확인했고 먼저 열린264 main을 통합한 뒤 최종 검토/수동 한 번과 자체 main을 확인합니다.

검토7148229579의 세 P3를 처리하고 추가 보류 조건도 고쳤습니다. 5a21c25ef9ae4a458ef471ad2394623050c037d6의3실패6통과 뒤 9b1742a67b8a386a04c955858ec035cd88b38fbb는 생성 응답9개/통합31개·관련73개·타입/✓ built in 606ms/두 Worker가 통과했습니다. 확인된 가게는 매 저장에서 허용 이름을 대조하고 다른 이름의 확인 재요청도 계속409로 거절해 기존 계좌를 보존합니다. 신규/변경 없음의 첫 응답에는 재사용 헤더가 없고 같은 키로 완료 결과를 다시 쓸 때만 true를 붙입니다. 보류 해제는 실제 created 뒤에만 모의하며 같은 값/실패는 상태를 유지합니다. 저장401 기록은 로그인 이동/복귀 경로 전달로 좁혀 로그인 뒤 입력 복원을 보장하지 않습니다. 고침 전 V2는 로컬 준비 범위로 보존하고 새 V3 전송/브라우저0입니다.

부모 main264 f2d9412ce5af3e345ac1ac0eede8efd4b48c78f2의 app45515403440/db45515403417·실제 배포138875506050,활성100% 버전311aaad3-1eb4-4324-b427-e90bc06566eb 생성2026-11-25T00:11:20.054735Z/전체태그·상태200·원격SHA 일치를 확인했습니다. 별도 학원컴/저장소 Worker 직접 활성 태그는 미확인입니다. 현재 main36/34에서 자체 행 포함 제안36/35이며 다음은 통합 뒤 단계/현재 전체 head CI·처리/재리뷰·수동 한 번과 자체 main입니다.

통합·검토 고침 뒤 단계09:15:28~09:15:56 KST도 종료0/WBS18오류0·ERD15/사이트맵17/화면15통과·목업13통과1미확인입니다. API/브라우저 건너뜀을 통과로 세지 않습니다. 현재 원본에서 다시 계산한 자체 행 포함 제안은 끝남36/구현35·시작 가능27/전체 의존31이며 최종 head CI·검토/수동 한 번과 자체 main 배포 뒤 확정합니다.

### (665) TASK-054 자료 원본/출력 교체·Problem 후속 고침

[채널 자료 원본/오류 고침](kakao-channel/2026-11-25-fixture-source/acceptance-checks.md)을4실패3통과로 재현해 같은 실행/입력 root·깨끗한 HEAD와 임시 완성 후 교체·이전 출력 보관을 적용했습니다. 문맥/4 API의 전체 Problem 예시·미디어 유형/no-store를 맞췄고 신원 URI/traceId의 추가1실패도 고쳤습니다. 통합 자료26개·실제 네 파일162개/타입·두 Worker와 CLI10상태/43응답이 통과했습니다. 첫 잘못된 관련 필터의 API63개를 구분해 보완했고 제품 자체 변경0·새 V4 ZIP/전송·브라우저0입니다. README373/fix665와 기존 구현 완료 행을 유지해36/34를 늘리지 않으며 다음은 단계/현재 CI·검토와 먼저 열린265 main 통합·수동 한 번/자체 main입니다.

단계09:20:26~09:20:53 KST 종료0/WBS18오류0·ERD15/사이트맵17/화면15통과·목업13통과1미확인입니다. API/브라우저 건너뜀을 통과로 세지 않으며 기존 구현 수36/34도 바꾸지 않습니다. 현재 CI가 새 설치/빈39개 이행·전체 서버/웹과 두 OS의 계약26개/채널 CLI를 검사합니다. 먼저 열린265 main을 확인한 뒤 통합하고 최종 현재 CI·발견 처리/수동 한 번과 자체 main을 확인합니다.

검토7148567248의 P2/P3를 4b9ce738995ef0605702e463265b2c6db8be74cb의2실패35통과로 고정했습니다. 실제 상속 설정만 바꾸자 번들 SHA256 25d37d8e7157a276b96239bab71d541bc53cd4224e8dd16666372b7673c81530→9eb8ee19152faa89eff1ae5392cf4db8704e8d60b4d96ddd978d41ea4668f41c가 달라졌지만 원본 SHA는 같았습니다. 공통 입력에 app/tsconfig.base.json을 넣고 시험 사본도 실제 web/tsconfig와 상속 설정을 함께 써 같은 변경을 거절하고 옛 번들을 보존하도록 고쳤습니다. 기본404의 instance는 query를 뺀 실제 요청 경로이며 본문/미디어 유형/no-store도 시험합니다. e301698eb796d1425f5214badf375a5287513177는 자료37개/실제 네 파일162개·타입/Vite611ms/두 Worker·CLI가 통과했습니다. V4는 고침 전 로컬 준비이며 새 V5 ZIP/전송·브라우저0입니다.

부모 main265 6465710675313bea46629666ef040990b5f8c257의 app45518012247/db45518012307·실제 배포138884664080,활성100% 버전8e0bacfc-296e-437e-98c5-dbdfbcca36c5 생성2026-11-25T00:31:42.911556Z/전체태그·상태200·원격SHA를 확인했습니다. 별도 학원컴/저장소 Worker 직접 활성 태그는 미확인입니다. 기존 상태 끝남36/구현35·시작 가능27/전체 의존31은 늘리지 않으며 다음은 최종 단계/현재 head CI·발견 처리/수동 한 번과 자체 main입니다.

검토 고침 뒤 단계09:40:14~09:40:41 KST도 종료0/WBS18오류0·ERD15/사이트맵17/화면15통과·목업13통과1미확인입니다. API/브라우저 건너뜀을 통과로 세지 않으며 기존 구현 수36/35를 늘리지 않습니다. 현재 head의 새 설치/전체 서버·웹/두 OS 자료37개와 채널 CLI·코드/보안 검토·수동 한 번/main 배포를 이어 확인합니다.

### (666) TASK-055 현재 수락과 자료/실환경 확인 분리

[예약 링크의 현재 수락](booking-link/2026-11-25-runtime/acceptance-checks.md)을 대조해 관련45개·자료37개/타입·두 Worker를 확인했습니다. 실제 컴포넌트 자료/생성 계약6개는5응답·재조회/준비 상태 변경과7조건/설정 진입 조회·긴 주소를 확인합니다. 최초 생성 이스케이프 오류와 독립 예시의 버전 기대 차이는 고쳐 현재 통과와 구분했습니다. 제품 자체 변경0·새 ZIP/전송/브라우저0이며 실제6상태/두 폭·사진/클립보드·자기 가게는 자체 미확인입니다. README374/fix666·자체 행 포함 제안36/36을 남기고 다음은 단계/현재 CI·검토와 먼저 열린266 공통 상속 설정 main 통합·수동 한 번/자체 main입니다.

main266 77d70bea90b828327df5691b2cabb0f10576605b의 app45521537698/db45521537679와 실제 배포138895989879를 확인했습니다. 활성100% 버전392fc5e8-301a-419b-b9bf-56e9f4dadfaf 생성2026-11-25T00:57:32.55691Z/전체태그·상태200·원격SHA가 일치합니다. 별도 학원컴/저장소 Worker 직접 활성 태그는 미확인입니다. 상속 설정 검사를 포함한 main266을6578180b7dae7c0da21eeb06b6053dec1d811418에 통합했고 자료43개/타입·Vite614ms/두 Worker·실제 예약 링크 CLI6상태5응답이 종료0입니다. 관련45개는 그 전 원본이며 공개 CI가 현재 전체를 다시 확인합니다. 새 V2는 로컬 컴파일이고 ZIP/전송/브라우저0입니다.

단계09:49:44~09:50:14 KST 종료0/WBS18오류0·ERD15/사이트맵17/화면15통과·목업13통과1미확인입니다. API/브라우저 건너뜀을 통과로 세지 않습니다. 현재 원본에서 다시 계산한 자체 행 포함 제안은 끝남36/구현36·시작 가능26/전체 의존30이며 자기 PR267의 현재 head CI·검토/최종 수동 한 번과 main 배포 뒤 확정합니다. 기존 SSH의 두 외부 실패는 복구 증거가 없어 유지하고 다른 실행 가능한 작업을 계속합니다.

검토7149091421의 P2/P3를 ff812d8의2실패6통과로 재현하고 ebcdb877725d338082dc5b464716787bc8d04fdc에서 고쳤습니다. 이미 발급한 주소/시각은 결제 수단이 사라져도 그대로 유지하며 가게의 설정 요약/해당 설정 GET만 미설정으로 바뀝니다. 발급 전 조건 충족은 becomes-issued로 따로 확인합니다. 발급한 주소와 픽업 장소 권고가 함께 있는 issued-no-pickup을 더하고 recommended/가게 pickupAddress를 함께 대조합니다. 과거 becomes-not-ready 이름은 현재 조건 제거 상태의 호환 입력이며 새 선택 목록은 conditions-removed입니다. 최신 자료 계약8개/통합45개·실제 CLI6상태5응답이 통과했습니다. 제품 코드는 바뀌지 않아 관련45개·타입/빌드는 기록한 원본을 적용하며 현재 공개 CI가 전체를 다시 확인합니다.

검토의 기록 P3는 통합 전37개/45개와 통합 뒤43개를 별도 원본으로 보존하고,현재는 검토 고침 뒤45개로 갱신했습니다. 공통 상속 설정 통합과 main266 실제 배포도 이미 확인했습니다. 고침 전 V1/V2는 로컬 준비 범위로 보존하며 새 V3도 ZIP/전송/브라우저0입니다. 자체 실환경 남음과 끝남36/구현36 제안·시작 가능26/전체 의존30을 유지합니다. 수동 요청7149105428은 한 번 사용했고 결과의 발견 처리만 이어갑니다. 다음은 최종 현재 CI/처리/새 SHA 연결과 자체 main 배포입니다.

### (667) TASK-056 요일 휴무와 그날 휴무의 화면 대조

요일 휴무 weekdayClosed와 날짜별 휴무 closed를 서버가 각각 계산하는데 날짜 셀과 충돌 뒤 최신 휴무 표시는 closed만 읽는 오류를 찾았습니다. 74ff33d의3실패32통과로 요일 휴무/사장님 마감의 표시 우선순위와 최신 상태·초안 보존을 고정했고 a5d3682에서 두 값을 함께 읽도록 고쳤습니다. 날짜별 휴무 체크박스는 원래 날짜별 값 그대로이며 저장/자리 셈을 바꾸지 않습니다. 관련5파일111개·타입/Vite644ms/두 Worker가 종료0이고 같은 lock 설치를 재사용했습니다. 새 로컬 npm ci/전체 서버 검사를 했다고 하지 않습니다. 새 공개 CI가 설치/빈39개 이행·전체 서버/웹을 검사합니다.

SCR032의10상태/17응답 행과 추가2예시를 현재 CalendarScreen·API/양식/관련 주문 회귀와 대조했습니다. 실제360/1280·44px/page-check·사진/키보드/자기 가게 날짜 저장은 미확인입니다. 브라우저는 학원컴 Aside CLI만 사용하며 SSH의 두 외부 실패 뒤 그 확인만 보류합니다. 복구 뒤 기존 D4 독점/KOE 정지·진행/원문·받은 지시·대기열/최종 정지ACK부터 읽습니다. 새 ZIP/전송/브라우저0·실제 서비스 읽기/쓰기·모델/카카오/메일/결제0입니다.

부모 main266 77d70bea90b828327df5691b2cabb0f10576605b의 app45521537698/db45521537679·실제 배포138895989879,활성100% 버전392fc5e8-301a-419b-b9bf-56e9f4dadfaf 생성2026-11-25T00:57:32.55691Z/전체태그·상태200·원격SHA를 확인했습니다. 별도 학원컴/저장소 Worker 직접 태그는 미확인입니다. README375/fix667은 열린267의374/666과 main373/665까지를 보존합니다. 현재 main36/35에서 자체 행 포함36/36을 제안하고 먼저 열린267 main 확인/통합 뒤 최종 CI/발견 처리·수동 한 번과 자체 main 배포까지 진행합니다. finished는 올리지 않습니다.

단계10:01:58~10:02:25 KST 종료0/WBS18오류0·ERD15/사이트맵17/화면15통과·목업13통과1미확인입니다. API/브라우저 건너뜀은 통과가 아닙니다. 현재 원본에서 다시 계산한 자체 행 포함 제안은 끝남36/구현36·시작 가능26/전체 의존30이며 먼저 열린267 main 확인/통합 뒤 최종 CI/검토·수동 한 번과 자체 main을 확인합니다.

검토7149287181의 P2를 e710ab7의2실패35통과로 재현했습니다. 요일 휴무에서 수동 마감만 풀 때와 자리가 다 찬 날에도 '다시 받아요'가 나오던 것을 고쳤습니다. 요일/그날 휴무가 아니고 다 차지 않은 날만 재개 문구를 사용하며 나머지는 저장 안내와 현재 휴무/다 참 라벨을 유지합니다. 3beb13c의 관련5파일113개·타입/Vite575ms/두 Worker가 종료0이고 입력/저장 값·잡힌 자리는 유지합니다. P3는 이번 배포 JSON의 -diff를 제거하고 LF 텍스트/들여쓰기로 표시해 고쳤습니다. 새 배포 증거도 기본 diff에서 보입니다.

main267 f5ec7400dc45fab772572de9f2e8ef7774b9b6a6의 app45523512076/db45523512264·실제 배포138902677639,활성100% 버전763427e0-61f6-4e1a-8a9f-c122fddb1c55 생성2026-11-25T01:13:13.21288Z/전체태그·상태200·원격SHA를 확인했습니다. 별도 학원컴/저장소 Worker 직접 태그는 미확인입니다. de8789e의 부모267 통합 자료45개도 통과했고 현재 원본의 자체 행 포함 제안은 끝남36/구현37·시작 가능25/전체 의존29입니다. 다음은 검토 고침 뒤 단계/현재 CI·발견 처리/최종 수동 한 번과 자체 main입니다. 실제10상태·두 폭/44px/page-check·자기 가게 저장은 미확인·전송/브라우저0이며 finished를 올리지 않습니다.

검토 고침 뒤 단계10:15:05~10:15:31 KST도 종료0/WBS18오류0·ERD15/사이트맵17/화면15통과·목업13통과1미확인입니다. API/브라우저 건너뜀은 통과가 아닙니다. 최종 현재 head CI/발견 처리·수동 한 번과 자체 main을 이어 확인합니다.

### (668) TASK-057 현재 자동 수락과 실환경 범위 구분

SCR033의10상태/16응답 행과 추가2예시를 현재 CalendarSettingsScreen·API/양식/관련 주문 시험과 대조했습니다. main266 원본77d70bea90b828327df5691b2cabb0f10576605b에서 관련5파일121개·타입/빌드가 종료0입니다. 형식·엄격lint/키·용어·공백과 단계 결과를 함께 기록하고 제품/서버/DB/의존성은 바꾸지 않습니다. 같은 lock 설치를 재사용했으며 새 로컬 npm ci/전체 서버 결과로 쓰지 않습니다. 새 공개 CI가 설치/빈39개 이행·전체 서버/웹을 검사합니다.

요일별 추가/제거만 재적용해 다른 기기 요일을 남기며 처음 설정404 재조회는 초안을 보존합니다. 다른 기기의 첫 설정과 비교,같은 revision/초안 없는 새 값,전체 최신 설정 표시,서버와 같은 오류 사유와 필드 초점,확인/취소·관련 주문10일씩 더 보기/마지막 초점,처리 중1초 같은 키/본문과 연속 제출·세션/보류/401·미등록을 기존 회귀로 대조했습니다. 안내 발송과 자리 변경 자체는 각 서버/후속 작업에서 확인합니다.

부모 main266의 app45521537698/db45521537679·실제 배포138895989879,활성100% 버전392fc5e8-301a-419b-b9bf-56e9f4dadfaf 생성2026-11-25T00:57:32.55691Z/전체태그·상태200·원격SHA를 확인했습니다. 별도 학원컴/저장소 Worker 직접 태그는 미확인입니다. 실제10상태×360/1280·16응답/44px/page-check·사진/키보드·자기 가게 저장은 자체 미확인입니다. SSH의 두 외부 실패 뒤 그 확인만 보류하며 복구 뒤 기존 D4 독점/KOE 정지·진행/원문·받은 지시·대기열·최종 정지ACK부터 읽습니다. 브라우저는 학원컴 Aside CLI만 사용하며 새 ZIP/전송/브라우저0·실제 서비스 읽기/쓰기·모델/카카오/메일/결제0입니다.

README376/fix668은 열린267의374/666·268의375/667과 main373/665까지를 보존합니다. 통합 전 main266 기준36/35에서 자체 행 포함36/36을 당시 제안했고 먼저 열린267/268의 main 확인/통합 뒤 최종 CI/리뷰·수동 한 번과 자체 main 배포로 확정합니다. finished를 늘리지 않습니다.

단계10:07:24~10:07:51 KST도 종료0/WBS18오류0·ERD15/사이트맵17/화면15통과·목업13통과1미확인입니다. API/브라우저 건너뜀은 통과가 아닙니다. main267 f5ec7400dc45fab772572de9f2e8ef7774b9b6a6의 새 예약 링크 자료를6804f87에 통합했습니다. 현재 원본에서 다시 계산한 자체 행 포함 제안은 끝남36/구현37·시작 가능25/전체 의존29입니다. 먼저 열린267의 main CI/실제 배포는 진행 중이며268도 최종 통합/검토 중입니다. 두 main 확인을 마치기 전 이 PR을 합치지 않습니다. 기존 관련121개/타입/빌드의 제품 입력은267 통합 전과 같고 공개 CI가 전체를 다시 검사합니다.

검토7149393390의 로딩 제한을 명세대로 고쳤습니다. 설정 GET의 처음/새로 고침 두 경로에서 로그아웃이 실제 호출되던 e05aa8e의2실패28통과를 재현했고 d18d904에서 조회 중 로그아웃 버튼/호출을 함께 잠갔습니다. 양식·새로 고침도 잠기고 조회가 끝나면 로그아웃을 다시 쓸 수 있으며 재조회 전 초안은 남습니다. 처음 고침 뒤2실패121통과는 busy 버튼의 실제 이름이 처리하고 있어요인데 시험이 새로 고침을 찾던 선택자 오류입니다. 8114e61에서 바로잡아 현재5파일123개·타입/Vite623ms/두 Worker가 종료0입니다.

집계 P3는 통합 전 main266 기준36/35→자체 행 포함36/36과 통합 뒤 집계를 명시해 나눴습니다. 단계 P3는 로컬 옛 검사 원본을 공개 SHA로 쓰지 않고 최종 공개 head의 detached 작업 트리에서 같은 옵션으로 다시 실행해 PR 본문/댓글의 전체 SHA와 직접 연결합니다. 아직 그 최종 공개 실행은 하지 않았습니다. main268은 c059712에 통합했고 자체 CI/실제 배포 확인을 이어갑니다. main267 실제 배포는 main267-deployment.json에 보존했습니다.

작업 공간 여유가12,554,240바이트로 줄어든 것을 확인해 완료/깨끗함·추적 파일0·연결 참조0·활성 실행0인 두 이전 작업의 실제 node_modules만 정리했습니다. 1,511,333,888바이트를 확보해 여유1,523,888,128바이트가 됐고 현재 공유 설치/소스/기록은 보존했습니다. 삭제한 설치와 고정한 원본은 dependency-space-recovery.json에 남깁니다. 다른 바깥 장애의 재시도 횟수는 바꾸지 않았고 새 브라우저/전송·모델/카카오/메일/결제0입니다.

현재 main268 기준 자체 행 포함 제안은 끝남36/구현38·시작 가능24/전체 의존28입니다. 실제10상태/두 폭·16응답/44px/page-check·자기 가게 저장은 미확인이며 최종 현재 CI/발견 처리·수동 한 번과 자기 main 배포 뒤 확정합니다.

부모 main268 3b4ac96886645e91b1fa5d8d1226202271930c43의 app45525520400/db45525520380·실제 배포138909902830,활성100% 버전709f4414-99db-497a-9daf-81e4fc5aaa8a 생성2026-11-25T01:30:21.300262Z/전체태그·상태200·원격SHA를 확인했습니다. 별도 학원컴/저장소 Worker 직접 태그는 미확인입니다. c059712에 통합한 부모의 요일 휴무/재개 안내와 이 작업의 로딩 고침은 다른 화면이며 자기 관련123개/타입/빌드와 부모 전체 CI를 원본별로 적용하고 최종 공개 CI가 함께 검사합니다. 현재 기준 제안은 끝남36/구현38·시작 가능24/전체 의존28입니다. 로컬 옛 단계는 역사 범위이며 최종 공개 head를 그대로 분리한 작업 트리에서 재검사해 PR269 본문/댓글에 전체 SHA로 남깁니다. 그 뒤 수동 요청을 한 번 하고 자기 main CI·실제 배포를 확인합니다.

### (669) TASK-058 목록의 자동 수락과 자체 실제 확인 분리

SCR047·SPEC002/003/078과 API012/005/006/081의15응답 행을 현재 OperatorArea/OperatorShopsList·API/URL/운영자 인증 시험과 대조했습니다. main267 원본f5ec7400dc45fab772572de9f2e8ef7774b9b6a6의 관련4파일97개·타입/Vite716ms/두 Worker가 종료0입니다. 같은 lock 설치를 재사용했고 새 로컬 npm ci/전체 서버 검사로 적지 않습니다. 새 공개 CI가 설치/빈39개 이행·전체 서버/웹과 두 OS 자료를 확인합니다. 이번 제품 코드/시험/서버·DB/의존성 변경0이며 기존 회귀와 이전 검토8건 고침을 현재 수락 조건별로 정리합니다.

최초 인증 전 요청/운영자 기록0,목록401 뒤 이미 추가한 기록 제거,bfcache/다른 pathname의 인증 재확인 전 숨김과 같은 화면 필터의 초점 보존을 확인했습니다. 상태별 URL/서버 필터·422의 현재 탭/상태를 남긴 커서 초기화,추가 조회의 같은 커서 재시도/행 중복 병합,조회 중 탭 이동 취소,새로 고침/로그아웃 실패의 행 보존과 작업별 추적ID·중복 로그아웃 잠금도 대조했습니다. 사업자 변경은 지금/새 값과 예금주 불일치 안내·계좌 끝4자리만 쓰며 웹 목록 변환 DTO가 연락처·전체 계좌·증빙 주소를 복사하지 않습니다. API081 원본에는 계약대로 서명 증빙 주소가 포함됩니다.

부모 main267의 app45523512076/db45523512264·실제 배포138902677639,활성100% 버전763427e0-61f6-4e1a-8a9f-c122fddb1c55 생성2026-11-25T01:13:13.21288Z/전체태그·상태200·원격SHA를 확인했습니다. 별도 학원컴/저장소 Worker 직접 태그는 미확인입니다. 실제6상태×360/1280·15응답/44px/page-check·사진/키보드/상세 왕복과 자기 운영자 화면은 미확인입니다. SSH의 두 외부 실패 뒤 그 확인만 보류하며 복구 뒤 기존 D4 독점/KOE 정지·진행/원문·받은 지시·대기열·최종 정지ACK부터 읽습니다. 브라우저는 학원컴 Aside CLI만,새 ZIP/전송/브라우저0·실제 서비스 읽기/쓰기·모델/카카오/메일/결제0입니다.

README377/fix669는 열린268의375/667·269의376/668과 main374/666까지를 보존합니다. 통합 전 main267 기준36/36에서 자체 행 포함36/37을 당시 제안했고 먼저 열린268/269의 main 확인/통합 뒤 최종 CI/검토·수동 한 번과 자체 main으로 확정합니다. finished를 늘리지 않습니다. 새 배포 JSON은 LF 텍스트/들여쓰기이며 기본 diff에서 보입니다.

단계10:15:49~10:16:16 KST 종료0/WBS18오류0·ERD15/사이트맵17/화면15통과·목업13통과1미확인입니다. API/브라우저 건너뜀은 통과가 아닙니다. 현재 원본에서 다시 계산한 자체 행 포함 제안은 끝남36/구현37·시작 가능25/전체 의존29이며 먼저 열린268/269 main 확인/통합 뒤 최종 CI/발견 처리·수동 한 번과 자체 main을 확인합니다.

검토7149553137의 P3 세 건을 처리합니다. 목록 읽기 중 새로 고침/더 보기는 잠기고 탭/변경 상태 선택·다른 화면 이동은 이전 읽기를 취소할 수 있도록 허용합니다. 읽기 중 로그아웃은 허용하며 보내는 동안에는 탭/목록 조작도 막습니다. 기존 검토7113641360의 고침/회귀를 유지하는 범위를 SCR047 원본의 loading 설명과 수락 기록에 명시하고 생성기로 갱신합니다. API/상태 수와 제품 코드는 바꾸지 않습니다.

97개 시험의 네 저장소 경로·app에서 실행할 정확한 명령을 current-checks.json에 넣었습니다. API081 원본 응답에는 계약대로 서명된 evidencePhotoUrl이 포함됩니다. 그 필드를 제외하는 것은 웹 목록의 변환 DTO이며 네트워크 응답 자체에서 주소를 제거했다고 하지 않습니다. 목록 DOM/사진에서 쓰지 않는 경계와 API 계약을 나눠 적었습니다. 부모 main268은 b92ced0에 통합했으며 자기 CI/배포 확인과 최종 공개 SHA 단계/CI·발견 처리·수동 한 번을 이어갑니다.

검토 뒤 첫 단계 실행10:34:41은 다른 단계 검사와 동시에 고정 ERD 임시 DB를 지워 실패했습니다. 실패 원본을 보존하고5b1665a의 직렬 재실행10:39:08~10:39:37 KST에서 종료0/WBS18오류0·ERD15·사이트맵17·화면15·목업13통과1미확인을 확인했습니다. 제품 단언 실패가 아니며 API/브라우저 건너뜀은 통과가 아닙니다. main269 4a2d4ee60ccd4a6a68bb380cb6d4d5dde012f6ad를 로컬에 통합했고 이 부모의 CI/실제 배포 확인 중입니다. 부모 확인을 마치기 전 다음 PR을 합치지 않습니다. 현재 원본표 기준 자기 행 포함 제안은 끝남36/구현39·시작 가능23/전체 의존27이며 최종 공개 head 직접 단계/현재 CI·발견 처리·수동 한 번과 자기 main까지 이어갑니다.

### (670) TASK-059 시험 경로와 실제 화면 확인 범위 구분

[영업 신고 확인의 현재 수락](operator-shops/2026-11-25-detail-runtime/acceptance-checks.md)을 대조해 화면/API/양식4파일144개·별도 스타일55개/타입·Vite670ms/두 Worker를 확인했습니다. 최초 잘못된 스타일 필터의 실제4파일 범위를 보존하고 정확한 경로로 보완했습니다. 초기 대조에서는 제품 코드/시험·서버/DB/의존성을 바꾸지 않았고,검토 뒤 시험2개를 보완했습니다. 실제10상태/두 폭·34행/44px·48px/page-check·사진/자기 운영자 판정은 미확인입니다. 부모 main268 실제 배포/활성100%·전체태그·상태200·원격SHA를 보존하고 먼저 열린269/270 main 확인/통합·최종 CI/검토·수동 한 번과 자기 main을 이어갑니다. README378/fix670을 예약하며 finished를 늘리지 않습니다.

현재 main268 원본 기준으로 다시 계산한 자기 행 포함 제안은 끝남36/구현38·시작 가능24/전체 의존28입니다. 대상 화면/API와 공통 입력은 이전 검사 원본과 main268 사이 차이0을 확인해 current-checks.json에 경로를 남겼습니다. 다른 화면의 부모 고침과 전체 앱은 부모 CI/최종 현재 CI로 적용하며, 최종 공개 head의 직접 단계 검사도 PR 본문/댓글에서 전체 SHA로 연결합니다. 다음은 현재 CI/검토·먼저 열린269/270 통합과 수동 한 번·자기 main입니다.

검토7150000569의 두 P3를 처리했습니다. 상세 재조회 중 잠기는 것은 판정·사진 창 새로 열기/사진 다시 불러오기이며,이미 열린 창의 닫기·확대·축소는 가능하다고 수락표를 좁혔습니다. 사업자 변경의 예금주 불일치/계좌 없음은 코드 대조에 그쳤던 범위를 두 UI 회귀로 보완했습니다. 안내와 확인 창 이전 쓰기0·반영 허용·정확한 대상/버전/키·저장 후 재조회를 실제 OperatorArea 경로에서 확인했습니다. 기존 제품 코드가 두 시험을 처음부터 통과했으므로 새 제품 오류를 재현했다고 하지 않습니다. 5be0bf88a26a751ddc649a19bec414cf5aac30c6의 현재4파일146개·타입/빌드와 이전 별도 원본 스타일55개를 구분해 보존하며 제품 실행 코드/서버·DB/의존성 변경0입니다.

main270 0c56755a6500d3665cb3876e3e674527bccb2c11을 통합했고 이 부모의 CI/실제 배포 확인 중입니다. 현재 원본표 기준 자기 행 포함 제안은 끝남36/구현40·시작 가능22/전체 의존26입니다. 부모 확인을 마치기 전 다음 PR을 합치지 않습니다. 최종 공개 SHA 직접 단계/현재 CI·발견 처리·수동 한 번과 자기 main을 이어가며 실제10상태/두 폭·44px/48px·page-check/사진/운영자 판정은 미확인·전송/브라우저0입니다.

### (671) TASK-060 알림 요약과 실제 화면 확인 범위 분리

[운영자 알림의 현재 수락](operator-alerts/2026-11-25-runtime/acceptance-checks.md)을 대조해 관련3파일49개·타입/Vite876ms/두 Worker를 확인했습니다. 원본5응답·세 종류의 요약/건수·인증 전/401/bfcache 기록 숨김·페이지 재시도/행 보존과 초점을 기존 회귀로 확인했습니다. 제품 코드/시험·서버/DB/의존성 변경0이며 실제6상태/두 폭·44px/page-check·자기 운영자 화면은 미확인입니다. 부모 main269 실제 배포/활성100%·전체태그·상태200·원격SHA를 보존하고 먼저 열린270/271 main 확인/통합·최종 공개 CI/단계·발견 처리·수동 한 번과 자기 main을 이어갑니다. README379/fix671을 예약하고 finished를 늘리지 않습니다.

main269 원본에서 계산한 자기 행 포함 제안은 끝남36/구현39·시작 가능23/전체 의존27입니다. 이 수는 해당 원본의 제안이며 먼저 열린270/271 main 확인/통합 뒤 다시 계산합니다. 최종 공개 head의 직접 단계 결과는 PR 본문/댓글에 전체 SHA로 연결합니다.

검토7150353382의 P3 세 건을 처리했습니다. 422는 입력 안내/처음부터 보기,500은 추적ID/재시도라고 시험 범위를 나눴습니다. 다른 화면 복귀 재조회는 마운트/읽기 effect의 코드 대조이며 새로 고침/옛 안내 제거 시험과 구분합니다. 요청 limit1~100과 응답0~limit(최대100),웹 DTO의 alertId/shopId/nextCursor 보존을 계약대로 적었습니다. 제품 코드/시험·서버/DB/의존성 변경0이라 관련49개는 이전 원본을 그대로 보존하고 최종 현재 CI로 전체를 확인합니다. 먼저 열린270은 main CI/배포 확인 완료,271은 최종 CI/수동 리뷰 진행 중입니다. 다음은 부모271 main 확인/통합·최종 공개 단계/CI·발견 처리/수동 한 번과 자기 main이며 실환경 미확인/finished 미증가를 유지합니다.

부모 main270의 app45530148119/db45530148075·배포138924636794,전체태그/활성100% 버전663378c4-0835-497a-9640-b2aeec65f976(생성2026-11-25T02:07:25.118152Z)/상태200·원격SHA를 확인해 보존했습니다. 부모 main271 a718f9de36009d54c6fc5deca7c619baddbff107도 통합했고 해당 CI/실제 배포 확인 중입니다. 확인 전 이 PR을 합치지 않습니다. 현재 원본표의 자기 행 포함 제안은 끝남36/구현41·시작 가능21/전체 의존25입니다. 관련49개/타입/빌드는 이전 원본이며 대상 알림/상위 운영자 입력의 차이0을 대조했고 최종 공개 CI가 전체를 재검사합니다. 다음은 최종 공개 SHA 직접 단계/현재 CI·발견 처리와 수동 한 번·자기 main입니다. 실제 화면 미확인·finished 미증가를 유지합니다.

### (672) TASK-062 공개 조회와 실제 두 폭 확인 분리

SCR002·SPEC010/011/018과 API039 네 응답을 현재 공개 화면/API의2파일49개·타입/Vite551ms/두 Worker로 대조했습니다. 가게 버전/서울 게시일·문단/줄바꿈/HTML 비실행·10만자/이전20행,잘못된 slug 요청0·공개 허용 필드와 no-store/취소,목차/직접 해시 초점·이력 replace·bfcache 최신 읽기와429 자동 재조회 중복 방지를 확인했습니다. 제품 코드/시험·서버/DB/의존성 변경0이며 같은 lock 설치를 재사용했습니다. 새 로컬 npm ci/전체 서버로 쓰지 않고 최종 공개 CI가 전체를 확인합니다.

부모 main270 0c56755a6500d3665cb3876e3e674527bccb2c11의 app45530148119/db45530148075·실제 배포138924636794,활성100% 버전663378c4-0835-497a-9640-b2aeec65f976 생성2026-11-25T02:07:25.118152Z/전체태그·상태200·원격SHA를 보존했습니다. 별도 학원컴/저장소 Worker 직접 태그와 실제4상태/두 폭·44px/page-check·사진/키보드·자기 공개 가게 왕복은 미확인입니다. 학원컴 SSH의 두 외부 실패 뒤 그 확인만 보류하며 복구 뒤 기존 D4 진행/대기열·정지ACK부터 읽습니다. 브라우저는 학원컴 Aside CLI만 사용하며 새 ZIP/전송/브라우저0·실제 서비스 읽기/쓰기·모델/카카오/메일/결제0입니다.

README380/fix672를 예약하고 [자체 수락](privacy-policy/2026-11-25-runtime/acceptance-checks.md)에 자기 실환경 남음을 남겼습니다. 먼저 열린271/272 main 확인/통합·최종 공개 단계/현재 CI·발견 처리·수동 한 번과 자기 main까지 이어갑니다. finished를 늘리지 않습니다.

main270 원본에서 계산한 자기 행 포함 제안은 끝남36/구현40·시작 가능22/전체 의존26입니다. 이 수는 해당 원본의 제안이며 먼저 열린271/272 main 확인/통합 뒤 다시 계산합니다.

검토7150570364의 P3에 따라 코드 대조뿐이던429 기본60초를 UI 시험으로 보완했습니다. 7a702a67418decdcf76702266e33734682640037의2파일50개/타입이 종료0이며 헤더/본문 대기 시간 없음·59,999/60,000ms 경계와 진행 중 복귀 이벤트 중복0·정상 복구를 확인했습니다. 기존 제품 코드가 처음부터 통과했고 제품 실행 코드/서버·DB/의존성 변경0입니다. 초기49개/타입/Vite551ms는 이전 원본으로 보존하며 최종 공개 CI가 전체를 확인합니다.

부모 main271 a718f9de36009d54c6fc5deca7c619baddbff107의 app45531625485/db45531625926·실제 배포138929632808,활성100% 버전f1c27721-6b53-4305-9a1a-0be17b5d9eb5 생성2026-11-25T02:19:42.459794Z/전체태그·상태200·원격SHA를 보존했습니다. 부모 main272 15c8d8bc79666fc446f52d62808eefb75a374864를 통합했고 해당 CI/실제 배포 확인 중입니다. 확인 전 이 PR을 합치지 않습니다. 현재 원본표의 자기 행 포함 제안은 끝남36/구현42·시작 가능20/전체 의존24입니다. 다음은 최종 공개 단계/현재 CI·발견 처리와 수동 한 번·자기 main이며 실제4상태/두 폭·44px/page-check·자기 공개 왕복 미확인·finished 미증가를 유지합니다.

### (673) TASK-081 저장한 서버 카드와 재전달 원자성

TASK081의 API070·큐·콜백/다음 대화 전달을 실제 수신 경로에서 재현했습니다. 22b06a8b736e418189568522625d9500aeabb6fb의4실패54통과 뒤 저장한 서버 카드의 발신/재전달을 연결하고 126450e7e7d227f1e3acd876f5ff48faa134d5d4의5파일122개/타입·형식/엄격lint0을 확인했습니다. 첫 구현의5실패117통과는 실제 주문 스키마와 트랜잭션 안의 실패 주입을 정정해 해결했습니다. AI의 완료 주장/금액을 카드에 쓰지 않고 저장 값으로 만들며 받은 손님이 누르기 전 주문 상태는 그대로입니다. 콜백 전달 표시 중단 뒤 모델/카드 생성1회·다음 수신의 버튼 보존/30분 만료 갱신을 확인했습니다. 새 실제 모델/카카오·브라우저·결제0입니다.

부모 main272 app45532582673/db45532582558·실제 배포138932801504의 전체태그/활성100% 버전7551dcc3-de7b-4fdd-8848-2ba26f6d1672(생성2026-11-25T02:27:41.474226Z)/health200·원격SHA를 보존하고 main273 bb1804a0de6da96dc22ae579384bbf289cb49803을 통합했습니다. 이 부모의 CI/실제 배포는 확인 중입니다. README381/fix673을 예약하며 아직 finished/구현 완료를 늘리지 않습니다. 다음은 타인/모호함/버전·사용 뒤 재전달 회귀·새 빈DB 전체 검사/빌드·현재 공개 CI/단계·검토/수동 한 번·자기 main입니다. 실제 합성 계정 수신/카드·권한 적용과 PC 카카오 왕복은 미확인입니다. 학원컴 SSH의 두 외부 실패 뒤 그 확인만 보류하고 기존 D4 진행/대기열·정지ACK 확인 원칙과 학원컴 Aside CLI만 사용을 유지합니다.

부모 main273 bb1804a0de6da96dc22ae579384bbf289cb49803의 app45534060933/db45534060929·실제 배포138938375411,활성100% 버전9f01cd8d-d8a8-4476-83c2-aa6f4b3b6911(생성2026-11-25T02:41:42.211052Z)/전체태그·health200·원격SHA를 확인했습니다. 원본 재계산은 반복2 전체32개 중 끝남5·구현 완료27·코드 미완료0이며 실제 확인27개는 각 구현 행에 남습니다. 전체 끝남36/구현42·MVP 시작 가능20개(기존 외부 대기172/027 포함)입니다. 다음 반복3의 TASK081을 계속하며 아직 자기 상태를 늘리지 않습니다.

74c9b9df09fd37f1d2a35e349bb78cbfe85ef590의 추가 경계까지5파일126개/타입·엄격lint0입니다. 다른 가게 주문번호의 카드/정보0·같은 손님의 주문 둘에서 번호 없는 제안의 카드0·버전 변경 뒤 새 카드와 사용한 카드의 버튼 재전달0을 확인했습니다. 이 네 시험은 이미 고친 제품 코드에서 처음부터 통과했습니다. 새 제품 오류 재현이라고 하지 않고 최초4실패/첫 구현5실패와 구분합니다. 다음은 새 빈DB 전체 검사/빌드·최종 공개 단계/현재 CI와 코드/보안 검토·수동 한 번·자기 main입니다. 실제 모델/카카오/브라우저·결제0·학원컴 SSH 두 외부 실패 보류를 유지합니다.

카카오 규격의 제목+설명 합계400자 제한을 마지막에 대조해401자 전송을9695625의1실패/1통과(필터 밖62개 생략)로 재현했습니다. 20ab5c56075ca17dd4cb3df222d079abe640d06d에서 고쳐 관련5파일128개/타입·엄격lint0을 확인했고 두 번째 새 빈39개 이행의 전체 서버2690개·웹1727개/Vite957ms·두 Worker가 모두 종료0입니다. 앞선 전체2688개/854ms는 고침 전 원본으로 보존합니다. 원본20ab는 공개9b8eaf1db365ab53a8b560c38a4c005698a8bbe4와 트리3159a7ec7dd93343dd6d49930c03250fe3a494ca가 같습니다. 같은 lock 설치를 재사용했고 새 로컬 npm ci로 쓰지 않습니다.

SPEC069 #1~2의 공통 계약,API070/071 응답과 card_shown/declined·stale/expired/not_yours/used,A7/A8를 자체 수락표의 파일/시험에 연결했습니다. API070은 우선 callback_pending,저장 카드의 실제 발신은 콜백이며 즉시 card_shown 헤더를 보냈다고 하지 않습니다. 미등록 업무 실행기는 안전하게 retry_needed/소비0이고 실제 취소/환불 등은 각 후속 업무가 연결합니다. 자기 실환경 남음 행 포함 제안은 끝남36/구현43·MVP 시작 가능19/전체 의존23이며 자기 main 확인 뒤 확정합니다. 다음은 ready PR의 최종 공개 단계/현재 CI·코드/보안 검토와 수동 한 번·squash/main 확인입니다. 실제 모델/카카오/브라우저·결제0·학원컴SSH 두 외부 실패 보류·finished 미증가를 유지합니다.

검토7151683553의 코드3건/보안1건을 1fb017b2afeff13e166e2e213fc175c01deb795b의8실패127통과로 재현했습니다. 발신 직전 버전 갱신 뒤 옛 키 전송·실제 두 연결의 메시지/손님 잠금 역전·발신 기한 후 조회,실제 callback의 card_shown 로그 누락·명시한 주문번호 누락/다른 제안/정확한 대상 선택을 고칩니다. 타입/엄격lint는 종료0이고 이 결과는 고침 전 WIP입니다. 현재 브랜치의 TASK081 구현 완료 제안을 철회해 원본36/42를 유지합니다. main에는 아직 이 작업을 합치지 않았습니다.

명시 번호는 수신 때의 서버 판단을 콜백 암호문에 수신ID와 함께 보존하고 모델 출력과 대조합니다. 기존256바이트 암호화 상한을 유지할 수 있도록 고정된 카카오 주소 접두사를 생략한 짧은 내부 형식을 사용하고 옛 URL 봉투도 읽도록 합니다. 발신할 목록을 먼저 정하고 현재 카드를 제외한 뒤 실제 보낼 카드만 갱신하며 손님→메시지 잠금/기한 확인과 성공 결과 로그를 적용할 예정입니다. 아직 이 고침 코드는 없습니다. 수동 요청7151704008은 이미 한 번 사용했고 다시 요청하지 않습니다. 다음은 이 실패 수정/현재 검사와 새 전체 SHA 처리·CI/공개 단계·리뷰 결과와 자기 main입니다. 모델/카카오/브라우저·결제0·실제 환경 보류를 유지합니다.


리뷰7151683553와 수동 리뷰6051338372의 카드 갱신·잠금 순서·성공 로그·수신 주문번호·미고지 카드 종료 정리를 고쳤습니다. 현재 답은 이전 안내의 SQL 조회에서 제외하고, 실제 보낼 카드만 발신 직전에 수신 선점/기한과 최신 버전으로 다시 읽습니다. 손님 행을 먼저 잠그며 실제 성공한 카드 콜백만 card_shown으로 기록합니다. 번호는 마스킹 전 원문에서 정해 수신 UUID와 함께 기존 콜백 암호문에 보존합니다. 최장 주소256자/번호12자도 평문255바이트이며 일반 암호화 상한256을 유지합니다. 옛 URL 봉투의 번호는 미확인으로 구분하고 기존 주문 카드의 새 대상 선택을 거부합니다. 번호가 없으면 서버의 대상 하나만 허용하며 모델이 두 주문 중 하나를 고를 수 없습니다.

최초8실패127통과 중 잠금 시험1개는 TransactionMisuseError였으므로 당시 실제 잠금 교착을 재현했다는 설명을 정정합니다. 두 연결의 트랜잭션 핸들을 고친 정확한 원본662a3287dd3e919b3a2c314210c86e815a2aa5ca를 별도 분리 작업 폴더에서 실행해 실제 행 잠금 충돌과 모델의 모호한 대상 선택2실패/98생략을 확인했습니다. 미고지 시스템 카드 종료는 별도2실패2통과/36생략으로 재현했습니다. 고친 작업 트리의 관련7파일194개/타입·엄격lint가 종료0이고 마지막 문맥 경계17개도 종료0입니다. 검사 도구의 import 정렬/시험 문맥의 리터럴 타입 오류를 로컬에서 고친 뒤 통과했으며 실패 로그도 보존합니다. 같은 lock 설치 재사용이며 새 로컬 npm ci로 쓰지 않습니다.

최종 코드 원본d5df658eeee5c3e1ca3867f415010fa6dcc2a8d9의 새 빈DB39개 이행/전체 검사와 빌드를 시작했습니다. 현재 구현 완료 제안은 철회 상태36/42를 유지하고 이 검사 뒤 갱신합니다. 수동 요청7151704008은 한 번 사용했으며 코드 두 발견은 같은 갱신/종료 정리에서 처리했습니다. 다음은 현재 전체 검사·최종 공개 단계/app·db CI·발견 처리 댓글과 squash 뒤 자기 main 배포/전체태그·활성100%/health200/원격SHA입니다. 실제 모델/카카오/브라우저·결제0이며 실제 계정/PC 왕복·권한 적용은 미확인입니다. 학원컴 SSH 두 외부 실패 뒤 해당 확인만 보류하고 학원컴 Aside CLI만 사용합니다. finished는 늘리지 않습니다.

검토 뒤 첫 새 빈DB 전체 검사(d5df658eeee5c3e1ca3867f415010fa6dcc2a8d9)는 서버135파일 중 정적 검사1실패/2716통과였고 웹/빌드는 시작하지 않았습니다. 날 연결을 만드는 큐 모듈에 가게 SQL을 직접 둔 것이 원인입니다. 예외를 추가하지 않고 가게 범위 연결만 받는 kakao-card-delivery로 재검증을 옮겼습니다. c9bc2614587c307e6da21b917eacea6fa8f974f9의 관련8파일216개/타입·엄격lint0을 확인하고 네 번째 새 빈DB 전체 검사/빌드를 시작했습니다. 현재 구현 완료 제안은36/42를 유지하고 최종 공개 CI/단계와 전체 성공 뒤 갱신합니다. 실제 모델/카카오/브라우저·결제0·실환경 보류와 수동 요청 한 번을 유지하며 다음은 새 전체 검사/최종 공개 CI·단계·발견 처리와 자기 main입니다.

정적 범위 고침 뒤 최종 코드 c9bc2614587c307e6da21b917eacea6fa8f974f9의 네 번째 새 빈39개 이행에서 서버135파일2717개·웹71파일1727개, Vite679ms와 두 Worker 빌드가 모두 종료0이며 시험DB 정리도 마쳤습니다. 관련8파일216개/타입·엄격lint0과 검토 발견 처리 댓글7152239957·수동 코드6051338372/보안7151758096·두 대화 해결을 확인했습니다. 실제 잠금 재현 정정과 앞선 정적 검사1실패2716통과를 보존합니다. 같은 lock 설치를 재사용했으며 새 로컬 npm ci로 쓰지 않습니다.

현재 공개7753a144b0d7a635faf27d98b48277e815755967은 로컬cf0c3ca73d5cccbbe260dfc1f0b7f7937299f388과 트리bea14d2d666a28461bacc9d623efea82fb5e2240가 같고 위 전체 원본 이후 제품/시험 차이0입니다. 실환경 남음 표의 TASK081 구현 완료 제안을 다시 넣었습니다(끝남36/구현43·MVP 시작 가능19/전체 의존23). 이 PR의 최종 공개 단계/현재 app·db CI와 squash 뒤 자기 main CI/배포·전체태그·활성100%/health200·원격SHA까지 확인한 뒤 확정합니다. 수동 요청7151704008은 한 번 사용했으며 다시 요청하지 않습니다. 실제 모델/카카오/브라우저·결제0·학원컴 SSH 두 외부 실패의 해당 확인 보류와 finished 미증가를 유지합니다. 다음은 최종 공개 검사/현재 CI·처리 댓글·자기 main 확인 뒤 TASK065 수신 연결입니다.

### (674) TASK-065 사진 주소와 스트림 크기·G10의 경계

TASK065의 SPEC019/A11/G10·API070/072와 기존 수신/G10/저장소를 읽고 다운로드 부품을 먼저 구현했습니다. 첫334242e의 모듈 부재는 수집 실패/동작 시험0이며 현재8169a2afc991bac0a3afd8196db2f63ee1900ac5의 다운로드20개+기존 정규화18개/타입·엄격lint는 종료0입니다. 같은 lock 설치 재사용이고 새 로컬 npm ci/전체 앱·빌드는 아닙니다. 허용된 카카오 HTTPS만 열고 직접3회 리다이렉트·통신1회 재시도·실제20MB/본문 취소와 G10을 확인했습니다. 방향만 남긴 정상 eXIf를 오인하던 단언은 실제 촬영/위치 정보 fixture로 바꿔 Orientation 이외 EXIF/GPS/XMP 제거를 대조했습니다. G10 제품 모듈은 바꾸지 않았습니다.

수신 API/큐/저장소 연결과 상담10장/원자성·중복/AI0 및 API072 실패 응답은 아직 남습니다. 원래 출처는 암호문 봉투로 보존하고 메시지/로그/AI에 쓰지 않는 기술 선택을 기록했으며 아직 연결했다고 하지 않습니다. README382/fix674를 예약했고 finished/구현 완료를 늘리지 않습니다. 부모273의 실제 CI/배포·전체태그/health200/원격SHA를 보존하고 먼저 열린274 main 확인 뒤 공통 발신을 통합합니다. 실제 사진/저장소/Worker 자원·최소 권한은 이번 작업에서 미확인이고 외부HTTP/브라우저/모델·카카오·결제0입니다. 다음은 실패 시험부터 실제 수신/콜백·저장 연결입니다.

실제 API070 사진 수신의 누락6개를 로컬 e87a9e928b701e98b68dc9fa4036843de3fe15f3의 시험으로 재현했습니다. 원문 주소를 AI/로그/일반 본문에 남기지 않고 수신ID에 묶인 별도 messages.kakao_photo 암호화 용도로 보존했습니다. 이 사진 문맥만16KiB이며 일반 필드와 기존 콜백은256바이트를 유지합니다. 기존55초 선점/큐의 ID만 사용하고 G10 정리 뒤 저장합니다. 같은 상담의 두 사진·다시 온 메시지1회·10장 제한·형식 거절/내려받기 재시도·콜백 안내와 다음 대화 전달의 초안을 연결했습니다. 최초 연결 뒤1실패173통과는 이미 제출된 옛 초안을 기대한 시험이었고 새 손님의 같은 활성 초안을 기준으로 고쳤습니다. 17e9b6857c956ed6cf0e066a5b142dc29db8594b의 관련7파일174개가 통과했고 형식/엄격lint0·앞선 타입0을 확인했습니다. 같은 lock 설치와 기존39개 이행 시험DB를 재사용했으며 새 로컬 npm ci/새 빈DB 전체 검사는 아직 아닙니다.

아직 WIP입니다. 저장소 올리기의 취소 신호/중단 회수와 동시·재개/만료·최소 역할 시험,API072 사진 내려받기 실패·계약/네 HTTP 응답,현재 전체 검사/빌드·단계/검토/CI와 자기 main이 남습니다. 지우기 대기에 올리기 기한 뒤의 회수 시각을 먼저 남기고 성공한 붙이기와 함께 지우지만 실제 중단 회수는 더 시험합니다. TASK065 구현 완료/finished를 늘리지 않습니다. 다음 단계는 저장소 PUT 취소 전달·중단/재전달 경계와 API072 사진 처리입니다.

부모 main274 68e983459e0e35335b4331d8b7ae33aa1d18d7ae를 통합했고 app45543806275/db45543806299·실제 배포138970571805에서 전체태그/활성100% 버전3efccfbf-d348-4f41-9db3-43be25b0ad44(생성2026-11-25T04:06:52.293311Z)/health200·원격SHA를 확인해 같은 폴더에 보존했습니다. 현재 원본은 끝남36/구현43·MVP 시작 가능19/전체 의존23입니다. 실제 사진/원격 저장소·CPU/메모리·권한 적용은 미확인이고 모델/카카오/브라우저·결제0입니다. 학원컴 SSH 두 외부 실패의 해당 확인 보류와 학원컴 Aside CLI만 사용을 유지합니다.

PUT 취소 신호 누락을 b8a89bef396d18cce68d7013b1443861e9a8a206의2실패9통과로 재현하고 62e47ae3e98e2a7df8e8a906c5dcc46a2517ed42에서 실제 S3 요청으로 전달하도록 고쳤습니다. 이미 취소한 요청은 네트워크0이고 시간 제한을 넘는 사진 올리기는 취소 신호도 보냅니다. 파일 지우기의 직접 호출도 회수 시각 전에는 기다립니다. 기존 시험의 queued_at 기본 서버 시각을 고정 시험 시각으로 명시해 실제 기한을 검증했습니다. 원격 저장 뒤 실패한 파일의 대기/기한 뒤 회수,콜백 실패·재실행 뒤 다음 대화1회,기한 지난 사진의 AI/에스컬레이션0,아홉 장 뒤 두 큐의 동시 처리에서 열 장/넘는 내려받기0을 추가했습니다. 17da2e1922574a126d8ac8d13b5ccccdef413780의 관련9파일201개/타입·엄격lint0입니다. 네 경계는 고친 코드가 처음부터 통과했고 새 오류 재현이라고 하지 않습니다. 아직 WIP이며 API072 사진 처리와 HTTP별 계약/최소 역할·새 전체/빌드/단계·검토/CI·자기 main이 남습니다. TASK065 구현 완료/finished는 늘리지 않습니다. 실제 모델/카카오/브라우저·결제0과 학원컴 Aside CLI만 사용을 유지합니다.

API072 사진의 실패/저장/권한3개를 4caa3cbaaa8fd2efe45edb10854f093083e529b5의3실패11통과로 재현하고 받은 자기 주문을 먼저 확인하는 공통 수신을 연결했습니다. 사진이 실패하면 글 후기만 저장하지 않고 같은 요청에는 저장한 첫 실패를 돌려줍니다. G10 뒤 사진/기본 게시 동의 거절을 같은 트랜잭션에서 저장하며 후기는 기존 분당 메시지 한도에서 제외합니다. 그 한도 오계산1실패(0072ff97d55954847b5635baa334c44213df3b71)와 최소 서버 역할의2실패(5e1e5ed856b853ee2286b53491ccb1c70b9c6ff7),사진 콜백이 이전 카드를 함께 보낼 때 card_shown 누락1실패(c48e31b1b7495de81eb49dcd996785b0b929e959)도 고쳤습니다.

현재 코드 47f2349c7536fe86d9518ce0dd05f008b4666d3d의 관련12파일243개·타입/엄격lint가 종료0입니다. API070~073의200/401/422/default 응답별 공통 시험도 포함했습니다. 제한 역할의 새 사진 처리 두 경로,추가 사진 열 권한을 거둔 기존 글 후기와 사진 연결 삭제/기존 후기 본문 수정 권한 없음까지 로컬에서 확인했습니다. 사진을 순차 처리하고 올린 바이트 배열을 목록에 보관하지 않으며 실제 Workers 메모리/CPU를 확인했다고 하지는 않습니다. 사진 수신 문맥만 후기 최대 입력까지20KiB로 늘렸고 일반/기존 콜백256바이트는 유지합니다.

0040은 중단된 후기 사진의 지우기 대기 종류를 추가합니다. API070에도 SPEC019의 photo_download_failed가 빠져 있던 계약을 원본 api_ops.py에서 보완해 생성했습니다. 기존 시험DB39개 이행 위에0040만 직접 적용한 로컬 검사이며 새 빈DB 전체와 혼동하지 않습니다. 최종 코드에서 새 빈40개 이행 전체/빌드를 시작했습니다. 실제 스테이징0040/추가 권한 적용·사진/S3·CPU/메모리·PC 왕복은 미확인입니다. 아직 TASK065 구현 완료/finished를 늘리지 않습니다. 다음은 새 전체/빌드·직접 공개 단계(API 포함)/최종 준비 PR·코드/보안 검토·CI와 자기 main입니다. 실제 모델/카카오/브라우저·결제0과 학원컴 Aside CLI만 사용을 유지합니다.

첫 새 빈40개 이행 전체 검사(47f2349c7536fe86d9518ce0dd05f008b4666d3d)는 서버2761통과/3실패였고 웹/빌드는 시작하지 않았습니다. 새0040의BEGIN/COMMIT이 스테이징 SQL 생성기의 바깥 트랜잭션과 충돌한 것을 확인해 기존 이행 파일 형식으로 고쳤습니다. 4054d118d82cb785e6903ca933051a895a70527d의 스테이징 생성/원장 회귀를 포함한13파일246개가 종료0입니다. 같은 최종 코드로 두 번째 새 빈40개 이행 전체/빌드를 다시 시작했습니다. WBS 생성 차이2곳은 생성기로 갱신한 뒤18검사/오류0이며 제품 시험 실패 수에 더하지 않습니다. 현재 구현 완료/finished 제안은 늘리지 않고 전체/API 단계/현재 CI·검토와 자기 main 확인을 이어갑니다. 실제0040/권한 적용·사진/저장소·CPU/메모리/PC 왕복 미확인과 모델/카카오/브라우저·결제0을 유지합니다.

최종 코드 4054d118d82cb785e6903ca933051a895a70527d의 두 번째 새 빈40개 이행에서 서버139파일2764개·웹71파일1727개와 Vite640ms/두 Worker가 모두 종료0이며 시험DB 정리도 마쳤습니다. 이후 변경은 기록/작업표 생성 문서뿐이고 제품/시험·API/DB/권한 파일 차이0입니다. 관련13파일246개/타입·엄격lint0,이행 합성의 첫3실패2761통과와 고침 원본을 함께 보존했습니다. 같은 lock 설치를 재사용했으며 새 로컬 npm ci로 쓰지 않습니다.

TASK065의 자체 수락 대조를 마치고 실환경 남음 행을 구현 완료 제안으로 더했습니다. 자기 최종 공개 API 단계/현재 app·db CI·코드/보안 검토·수동 한 번과 squash 뒤 main CI/실제 배포·전체태그/활성100%/health200·원격SHA를 확인한 뒤 확정합니다. 실제0040/추가 권한 적용·합성 참고/후기 사진과S3·Workers CPU/메모리·PC 왕복은 미확인이고 finished를 늘리지 않습니다. 모델/카카오/브라우저·결제0과 학원컴 Aside CLI만 사용을 유지합니다. 다음은 준비 PR의 공개 API 단계와 현재 CI/검토·자기 main입니다.

공개 70687d65f1fef40350e5c9ef11683039d43a6b8e의 직접 단계 검사에서 API 17개는 통과했지만 화면 검사 2건이 실패했습니다. 새 API070 photo_download_failed가 SCR003·007의 응답 매핑에 빠진 것이어서 screens_guest.py 원본을 고치고 화면 문서 4개를 생성했습니다. 단독 재검사는 15개 중 통과14·실패0·허브 미확인1이며 허브를 포함하는 전체 단계는 최종 공개 SHA에서 다시 확인합니다. 브라우저 검사는 건너뛰었으며 통과로 세지 않습니다.

같은 공개 SHA의 app45550720335와 db45550720329가 성공했습니다. 실제 CI 새 설치는161개/5초이며 서버139파일2764개·웹71파일1727개, Vite361ms와 두 Worker가 통과했습니다. Linux138990967396·Windows138990967092·PostgreSQL16 138990967096/17 138990967328을 확인했습니다. 이 뒤 변경은 화면 정의/생성물과 기록이며 제품 코드·시험·API/DB/권한 변경은 없습니다. 다음은 최종 공개 단계, 코드·보안 리뷰와 수동 요청 한 번, 현재 CI 및 squash 뒤 main 배포 확인입니다. 실제 사진/S3·0040/권한 적용·CPU/메모리·학원컴 왕복은 미확인이고 finished는 늘리지 않습니다.

실장님 코드/보안 리뷰7153477943의4건을 처리했습니다. 공식 카카오 가이드의 +0900 시간대를 정규화하고, HTTP 표기는 secure.kakaocdn.net 한 호스트만 같은 경로·쿼리의 HTTPS로 바꿉니다. 일반 HTTP/외부 호스트/사용자 정보/임의 포트는 거절하며 실제 다운로드 시험도 HTTPS만 요청합니다. CDN 루트의 HTTPS HEAD403은 TLS 응답 확인일 뿐 실제 서명 사진 내려받기 성공이 아닙니다. 실제 카카오 수신/유효 사진은 미확인입니다.

이미지 정리에 취소 신호와 기다림 상한을 전달했고 늦은 정리 결과는 저장하지 않습니다. 두 즉시 처리기는 인증 전부터 흐른 전체 응답 기한을 공유합니다. 선점은 남은 즉시 응답 시간까지만 잡고 finally에서 자기 선점만 풀며, DB가 이미 중단된 경우도55초 선점이 남지 않게 합니다. 전달 확정 예외 때 이미 커밋한 사진/후기와 결과 안내는 보존합니다. 단독 일반 링크는 글 경로에 남기고 카카오 이미지 CDN 한 줄만 사진으로 고릅니다.

플러그인/분류/취소 원본 b739be4의7실패28통과를 보존했습니다. 초기 선점 시험이 기존 합성 메시지까지 고르던 것을 좁히고, 고정 2b2af1fc79c40cb28a31a0d971e6c84ce0650cbd 별도 작업 폴더에서 예외4건·느린 정리2건·실제 PostgreSQL 잠금2건의8실패/25건너뜀을 재현했습니다. 처음의 잘못된 선점 대상에서 나온4실패160통과와 잠금2통과는 올바른 대상의 증거로 쓰지 않습니다. 수정 뒤 관련7파일164개가 통과했고 최종3cdf9bbc1e8cf0eb687f5c9c6e38d9a3a0a7f8f7에 일반 링크/HTTPS 요청 검증을 더해 새 빈40개 이행 전체·빌드와 관련 검사를 시작했습니다. 타입/엄격lint는 종료0이고 같은 lock 설치를 재사용했습니다.

공개639bf003e8815d7b946124562bf17e1df79df1b9의 화면 매핑 고침은 API17/화면15/ERD15·WBS18을 포함한 전체 단계 종료0입니다. 브라우저 미확인1을 그대로 남겼으며 제품 변경 뒤 최종 공개 SHA에서 다시 확인합니다. 다음은 새 전체/빌드·최종 공개 검사와 현재 CI·발견 처리/수동 한 번·자기 main 확인입니다. 실제0040/권한 적용·S3/사진·CPU/메모리·PC 왕복 미확인과 finished 미증가를 유지합니다.

수정한 최종 코드0bed9312df1765e60ed662db3f6ead2d44bce619의 네 번째 새 빈40개 이행에서 서버140파일2789개·웹71파일1727개와 Vite1.36s/두 Worker가 모두 종료0이며 시험DB도 정리했습니다. 관련9파일192개/타입·엄격lint도 종료0입니다. 이후 제품/시험·API/DB/권한 차이는 없습니다. 같은 lock 로컬 설치를 재사용했고 새 로컬 npm ci로 세지 않습니다.

세 번째 전체의2788통과/1실패는 추가 일반 링크 시험이 가짜 모델 설정과 다른 ai_key_missing을 기대한 것이었습니다. 실제 글 경로의 ai_unavailable에 맞춰 기대값만 고쳤고 지금은 글 보존/사진 GET0까지 통과합니다. DB 연결 문자열을 빠뜨린 단독 시험의 건너뜀은 통과로 세지 않고 REQUIRE_DATABASE_TESTS=1의9파일192개로 다시 확인했습니다. 첫 이행 합성3실패와 선점 대상 선택 정정·고정 원본의 실제8실패도 보존합니다.

공개f18a5663da32c97b201a8c491cd0790677e95f36의 app45552880385/db45552880199, Linux138998025233·Windows138998025529·PG16 138997911573/17 138997911743 성공을 확인했습니다. 같은 공개 SHA의 API17/ERD15/화면15/WBS18 포함 단계는 종료0이며 브라우저1미확인은 그대로입니다. 실장님 코드/보안 리뷰7153477943의4건 처리 댓글7153680231과 수동 요청7153680484 한 번을 남겼고 코드 결과7153716529는 추가 주요 문제 없음입니다. 수동 보안 결과와 최종 기록의 공개 CI·단계/재리뷰 및 squash 뒤 자기 main CI·실제 배포·전체태그/활성100%/health200·원격SHA를 이어 확인합니다. TASK065 실환경 남음은 끝남36/구현44 제안이며 자기 main 확인 뒤 확정합니다. 실제0040/권한 적용·유효 카카오 사진/S3·CPU/메모리·PC 왕복은 미확인이고 finished를 늘리지 않습니다.

수동 보안 리뷰4690767876에서 사진 후기 반복 제출의 합산 저장량/옛 버전 사진 증가를 지적했습니다. 이 발견은 미해결입니다. 유효 키·받은 자기 주문·건당5장/20MiB·3750ms와 중단 파일 회수는 있지만 합산 한도는 없습니다. API072가 '후기는 주문마다 받아 빈도 한도가 없음'을 명시하고 SPEC062의 새 버전 보존·SPEC063의 게시 사진을 바꿀 수 있어, 임의 한도나 옛 사진 즉시 삭제를 넣지 않았습니다. AGENTS1의 제품 결정 규칙에 따라 [제한 제안과 근거](reference-photos/2026-11-25-receive/review-storage-policy.md)를 확인 대기에 모았습니다.

참고·후기 합계20건/분의 제안 시험은 고정88779ba4b5f31cc614687d0517f1f1889735c019에서3실패34건너뜀으로 보존했습니다. 계약에 없는 정책 시험이므로 현재 앱 수락에서는 제거하고 패치/해시를 따로 남겼습니다. 제품/시험의 최종 트리는 성공한0bed9312df1765e60ed662db3f6ead2d44bce619와 같으며 보안 문제를 고쳤다고 세지 않습니다. TASK145와 TASK166에서 실제 손님을 받는 공개 출시 전까지 이 발견을 추적합니다. 현재 MVP의 합성 자료/시험 계정만 사용·실제 손님0 조건을 유지하고 TASK145 구현 완료/finished는 표시하지 않습니다. 다음은 최종 기록 CI/단계와 발견 미수정 사유를 포함한 병합 조건·자기 main 확인 뒤 TASK085입니다.

### (675) TASK-085 상담10상태와29응답 표시

TASK085의 WBS·관련 SPEC14개와 SCR003·API070/073·09목업을 대조했습니다. main275 a654cb735092d35b0b4feaefac67a910479c3577의 실제 app45555219107/db45555219114와 배포139006953427,전체태그/활성100% 버전53613644-7c33-4a21-9295-86ffefa00543(생성2026-11-25T05:45:04.84836Z)/health200·원격SHA를 확인해 보존했습니다. 끝남36/구현44를 유지합니다. TASK065의 실제0040/권한·사진/S3/자원/PC와 미해결 보안4690767876은 그대로입니다.

상담 표시 함수의10상태와 서버 견적/가까운 날·빈 출력·카드400자/출력3개를 구현했습니다. 금액은 customerQuote의 계산값만 표시하고 유효 기한/자리 미확보 안내를 붙이며, 새 견적은 확인 카드 없이 다시 확인을 묻습니다. 날짜 바로가기는 서버가 고른3개까지이고 메시지에는 연도를 보존합니다. 공통 스킬 응답과 채널 시험에 연결했고 시험 카드 문구는08대로 닿은 블록 이름/다음 버튼을 구분합니다. 업무 상태/AI 검증·견적 재계산·두 번 빈 답의 에스컬레이션을 이 표시 함수가 대신 수행하지 않습니다.

처음36aebc6은 모듈 부재로 수집 실패1/동작 시험0이었고 현재 표시17개가 통과했습니다. 초기 타입의 결합된 mode 구분과 제어문자 정규식의 형식4건을 고치고 타입/엄격lint0을 확인했습니다. 실제 공통 수신 관련6파일125개와 별도29행 대조/표시2파일18개가 통과했으며 표시17개는 겹치므로 합산하지 않습니다. 현재 코드138c0868ff3ec61a8bc9c2e5954889b8a1dc94ef에서 새 빈40개 이행 전체/빌드를 시작했습니다. 같은 lock 설치를 재사용했고 새 로컬 npm ci로 세지 않습니다. README383/수정675를 예약하며 TASK085 구현 완료/finished는 아직 늘리지 않습니다.

다음은09토큰/두 폭의 합성 표시 자료와 CLI 근거·전체/단계·현재 CI/코드·보안 검토·수동 한 번 및 자기 main입니다. 학원컴 SSH 두 외부 실패 뒤 실제 화면/PC 카카오 확인은 미확인이고 새 브라우저/전송·모델/카카오 메시지·메일·결제0입니다. 브라우저는 학원컴 Aside CLI만 사용하며 접속 복구 뒤 기존 D4 독점/KOE 정지와 받은 지시/대기열·최종 정지ACK부터 읽습니다.

TASK085의 코드138c0868ff3ec61a8bc9c2e5954889b8a1dc94ef에서 새 빈40개 이행·서버142파일2807개·웹71파일1727개·Vite755ms와 두 Worker가 모두 종료0이며 시험DB도 정리했습니다. 이후 앱 제품/시험·API/DB/권한 차이는 없고 합성 자료 생성기/CI와 기록만 더했습니다. 관련6파일125개와29행 대조/표시2파일18개·타입/엄격lint0을 보존하고 같은 lock 설치 재사용을 새 npm ci로 세지 않습니다.

09토큰을 실제 응답 표시 함수의 합성 본문에 적용하는 CLI를 만들었습니다. 로컬9acf9e530097362418d6e217c66a8be8157de3b2에서10상태×두 폭20개와 표시되는21응답×두 폭42개, 합계62프레임/파일65개가 생성됐습니다. 나머지8응답은 카카오 자체 오류3개와 이 상담에 나오지 않는5개이며 임의 성공 화면을 만들지 않았습니다. 자료의 브라우저/실제 카카오 여부는false이고 JS/TS 번들은 결과에 남기지 않습니다. HTML은 글을 이스케이프하고 CSP/외부 자원 금지·업무 호출0을 적용합니다. 서버/화면 입력과 실행 작업 폴더를 검사하고 완성한 결과만 공통 도구로 교체합니다.

첫 Node 전체는 입력 커밋 전에 실행해 원본 검사에서6파일 거절/14통과였고, 같은 이유로V2 CLI도 거절됐습니다. 제품 오류나 화면 실패로 세지 않고 미커밋 입력을 커밋한 뒤48개/실패0과 실제 Linux CLI 종료0을 확인했습니다. Windows 실행은 새 CI에서 확인하며 로컬 성공으로 대신하지 않습니다.

자동 수락을 대조해 TASK085를 실환경 남음 행의 구현 완료 제안으로 넣었습니다(끝남36/구현45, MVP 시작 가능17/전체 의존21 제안). 최종 공개 단계/현재 app·db CI·두 OS/코드·보안 검토·수동 한 번과 자기 main CI/실제 배포·전체태그/활성100%/health200·원격SHA 뒤 확정합니다. 실제 학원컴 Aside/PC 카카오·고지/버튼·지연/중복과 현재 가게 확인은 미확인이고 finished를 늘리지 않습니다. 휴대폰/월렛 발신만의 확인은 TASK167로 남기며 모델/실제 카카오/브라우저·메일·결제·새 전송/ZIP0을 유지합니다. 다음은 준비 PR의 최종 공개 검사/CI·리뷰와 자기 main입니다.

실장님 코드/보안 리뷰7154479870의 두 낮음 발견을 고쳤습니다. 고침 전86d09a10bbba97f62efa07818c180d2b22af186c에서 블록 ID3실패21통과와 폭1실패3통과를 재현했습니다. 입력 파서와 표시가 같은 코드 포인트/공백/널 검사를 사용하게 하고, 합성 프레임 body에360px·1280px를 실제 CSS 폭으로 적용했습니다. 같은 창 크기의 Happy DOM 계산 스타일에서 두 폭과 최대480px 대화 폭을 확인했습니다. 이는 Node DOM 단위 시험이며 실제 브라우저/카카오 확인이 아닙니다.

이전V1/V3 원본 자료와 공개221dbbea8e9c4bce6dd16502024ca2ae863de2db의 CLI/단계 근거는 보존합니다. V3는 data-width만 달랐으므로 두 폭의 배치/줄바꿈 확인 근거에서 제외합니다. 새V4는 ab78ab00523b692ed1cc22f427a1a2cb1ad25f4a의 실제 Linux CLI 종료0,62프레임/파일65개이며 새 manifest를 따로 보존했습니다. 합성 자료 Node49개/실패0과 관련6파일152개/타입·엄격lint0을 확인했습니다.

같은 최종 코드ab78ab00523b692ed1cc22f427a1a2cb1ad25f4a의 두 번째 새 빈40개 이행에서 서버142파일2814개·웹71파일1727개·Vite696ms와 두 Worker가 모두 종료0이며 시험DB 정리도 마쳤습니다. 같은 lock 설치를 재사용했고 새 로컬 npm ci로 세지 않습니다. 수동 요청7154455703은 한 번 사용했고 코드7154486783·보안7154512401은 이 PR의 추가 발견 없음입니다. 이후 변경은 위 리뷰 처리와 기록뿐이며 새 수동 요청을 달지 않습니다. 다음은 최종 공개 SHA의 단계/CLI·현재 두 OS/app·db CI·발견 처리 댓글과 squash 뒤 자기 main CI/실제 배포·전체태그/활성100%/health200·원격SHA입니다. 실제 학원컴 Aside/PC 카카오·두 폭과 현재 가게 왕복은 미확인이고 finished를 늘리지 않습니다. TASK065의 미해결 보안4690767876/제품 결정 대기도 그대로입니다.

### (676) TASK-086 규정 동의 버튼과9상태 표시

TASK086의 WBS·SPEC028/029/030/069/072/075·SCR004의9상태/29응답과09목업을 읽었습니다. 부모 main276 ff31dd1e887ae93307046afe45e8fb2593fa46c9의 app45561070536/db45561070604·배포139026249809에서 전체태그/활성100% 버전036254c6-d558-4a01-875d-a0be6b9e61ed(생성2026-11-25T06:34:36.30437Z)/health200·원격SHA를 확인했습니다. 끝남36/구현45이며 TASK085의 실제 화면 확인과 TASK065 보안4690767876/제품 결정 대기는 유지합니다.

실제 저장 카드의 동의 버튼과 권한·재시도 문구 차이를7b794287bfe87eea4f6a6aa7d6b1ffd02bb6536d의3실패로 재현해 고쳤습니다. 저장 제목은 주문 요청 확인으로 유지하고 버튼만 규정 동의를 명시합니다. 공통 API071 응답도 같은 표시 함수를 사용합니다. 순수 표시 함수는 그 버전의 규정 조문/두 법률 고지를 요약 카드 앞에 글 하나나 둘로 보내고 조문을 자르지 않습니다. 정상/알레르기/주문자/완료/변경/만료/다 찬 날/권한/오류9상태와29응답을 대조했습니다. 다른 카드 결과10개와 카카오 자체 HTTP오류3개는 임의 화면을 만들지 않습니다.

알레르기 카드의 목적/항목/보는 사람/30일 뒤 삭제·거절, 답 블록과 주문자 블록 버튼·잘못된 입력 안내를 표시합니다. 주문/동의 저장·입력 검증·개인정보 암호화와 AI 미전달, 현재 초안의 요약/버전 투영·자리 확보/결제 안내의 실제 업무는 TASK078/079/080/083/084가 담당합니다. 이 표시 준비를 그 업무의 구현이나 실제 주문 성공으로 세지 않습니다. 이름·문구·알레르기·규정은 줄이거나 철자를 바꾸지 않으며 한도를 넘는 준비된 요약은 거절합니다. 실제 최대 입력 투영과 PC 수신은 그 업무/실환경 확인에서 대조합니다.

관련7파일86개와 타입/엄격lint0을 확인했습니다. 처음 표시 모듈 부재는 수집 실패1/동작 시험0입니다. 초안의 주문번호 가정을 고정6b35ff676a831fe3b13e5edb19172f99d33d9d00의1실패19통과로 확인하고 실제 API의대문자/숫자6~8자로 고쳤습니다. 타입 구분 오류와 forEach 반환값lint1건도 고쳤습니다. Node51개/실패0과 새 Linux 합성 CLI를 확인했습니다. 자료는 실제 브라우저/카카오 결과가 아닙니다. 0358bdf8cc34974852a6b36de099268cd23980ef의 새 빈40개 이행 전체/빌드를 시작했고 같은 lock 설치를 재사용했습니다. 새 로컬 npm ci로 세지 않습니다.

README384/수정676을 예약하며 TASK086 구현 완료/finished는 아직 늘리지 않습니다. 다음은 새 전체/빌드·공개 단계/CLI·준비 PR의 현재 CI/두 OS·코드/보안 검토·수동 한 번과 자기 main입니다. 학원컴 SSH 두 외부 실패 뒤 실제 Aside/PC 카카오 확인은 미확인이고 새 전송/브라우저·모델/카카오 메시지·메일·결제0입니다. 브라우저는 학원컴 Aside CLI만 사용하며 복구 뒤 기존 D4 독점/KOE 정지와 지시 수신/대기열·최종 정지ACK부터 읽습니다.

최종 코드0358bdf8cc34974852a6b36de099268cd23980ef의 새 빈40개 이행에서 서버145파일2841개·웹71파일1727개·Vite847ms와 두 Worker가 모두 종료0이며 시험DB 정리도 마쳤습니다. 이후 앱 제품/시험·API/DB/권한 파일 차이0입니다. Node51개/실패0과 실제 Linux CLI18상태 프레임+32응답 프레임=50개/파일53개를 확인했습니다.10개 다른 카드 결과와3개 카카오 자체 오류는 본문null이고 임의 화면을 만들지 않습니다. 같은 lock 설치 재사용이며 새 로컬 npm ci가 아닙니다.

자동 수락을 대조하고 TASK086을 실환경 남음 행의 구현 완료 제안에 넣었습니다(끝남36/구현46·MVP 시작 가능16/전체 의존20 제안). 자기 최종 공개 단계/CLI·두 OS·app/db CI와 코드/보안 검토·수동 한 번 및 squash 뒤 main CI/실제 배포·전체태그/활성100%/health200·원격SHA 뒤 확정합니다. 이 표시 함수가 실제 주문/개인정보 저장·초안 요약 투영·자리 확보 업무를 구현했다는 뜻이 아닙니다. 해당 업무는 TASK078/079/080/083/084로 남습니다. 실제 학원컴 Aside/PC 카카오·현재 가게의 규정/버튼·중복/기한·두 폭은 미확인이고 finished를 늘리지 않습니다. 다음은 준비 PR의 공개 단계/현재 CI/검토와 자기 main입니다.

수동 코드 리뷰4691357308의 실제 주문 요청 카드 전달에 규정이 빠지는 P1을 확인했습니다. 고침 전29ffff4a의 실제 콜백/만료 응답·옛 카드/미준비 견적4실패3통과를 재현했습니다. TASK086 구현 완료 제안을 철회해 끝남36/구현45로 돌립니다. 콜백/재전달/버튼 답에서 공통 규정 묶음을 사용하고 유효한 서버 견적·그 운영규정이 없으면 동의 카드를 만들지 않습니다. 기존 규정 분할기를 공유하며, 규정 두 글과 카드의 세 칸 재전달 실패도ac10bdd9의1실패7통과로 확인했습니다. 현재 해당 경로/타입·엄격lint를 다시 검사하고 새 전체를 준비합니다. 최초 전체2841/1727은 고침 전 원본0358의 근거로 보존하며 새 코드의 성공으로 세지 않습니다. 수동 요청7155106350은 한 번 사용했으며 다시 달지 않습니다. 다음은 리뷰 고침/현재 검사·새 전체와 최종 공개CI·발견 처리/자기 main입니다. 실제 Aside/PC 카카오 미확인과 학원컴 Aside CLI만 사용·모델/메시지/결제0을 유지합니다.

실장님 코드/보안 리뷰7155527519(fd7aa4949dccf5f5a9fbe84982d230cce08c664e)의 P1 한 건과P2 세 건을 고쳤습니다. 견적 행의FOR SHARE를 없애 견적UPDATE 권한을 추가하지 않고, 초안 잠금과 현재 규정/가격표 행 잠금을 사용합니다. 표시에 필요한 초안8개 열의SELECT만 권한 파일에 더했으며 개인정보UPDATE는 막힌 상태입니다. 제한 역할의 카드 생성/만료 갱신·견적UPDATE 거절과 기존 권한 제한을 확인했습니다. 실제 스테이징에 이SELECT 권한을 적용한 것은 아직 아닙니다.

미전달 카드가 세 칸이면 공통 응답과 사장님 연결이 규정/카드 한 묶음을 먼저 보냅니다. 사장님 연결의 이번 안내는 미전달로 남깁니다. 사진 수신/사진 콜백은 현재 결과 한 칸을 남기고 세 칸 카드를 소비하지 않습니다. 이 경계는c622d99f의1실패7통과로 확인했습니다. 새 견적이 없는 변경/만료 버튼에는 반복 클릭 대신 채널 대화에서 주문 내용/견적을 다시 확인할 방법을 안내합니다.

저장된 초안·서버 견적·옵션 이름에서 실제 요약과 금액·카드 기한을 읽는 표시 투영도 이번 고침에 포함했습니다. 필수 값/동의 답/금액·범위가 준비되지 않았거나 변경 고지까지 카드 한도를 지킬 수 없으면 동의 버튼을 만들지 않습니다. 글자나 개인정보를 자르지 않고, 주문 카드payload에는 전화번호/알레르기 원문을 복제하지 않습니다. 재조회 때 같은 손님/상담의 원본에서 다시 표시하고 원래 카드 기한을 유지합니다. 입력·동의/주문/자리 확보를 쓰는 TASK078/079/080/083/084의 전체 업무를 끝냈다는 뜻은 아닙니다.

고정4e4dcd065351166b0bac8280bcf9ed72c2eca497의5실패20통과는 실제 규정/요약/회복·제한 역할4건과 시험 수신ID 제약 오류1건입니다. 수신ID를 고쳐 실제 사장님 연결의 세 칸/현재 안내 미전달을 검증했으며 당시 오류를 제품 재현으로 세지 않습니다. 다음1실패24통과는 새 표시에 필요한 초안SELECT 누락이어서 필요한 열만 열었습니다. 관련13파일324개·타입/엄격lint0이며 새 읽기 권한과 바뀐 회복 안내의 기존 기대값도 대조했습니다.

두 번째 전체의edef41def0a2c60c5f24994fb2bb3c013171f3b9는 서버2845통과1실패이며 웹/빌드는 시작하지 않았습니다. 실패는 동시 시험 자료의 통계에서 다른 인덱스를 고른 실행 계획 시험이었습니다. 인덱스 조건/검증과 제품 쿼리는 그대로 두고 해당 시험을 독립 빈DB로 옮겼으며 관련 검사에서 통과했습니다. 고침 전 전체와V1/V2 자료를 보존하고 이 뒤 코드의 새 빈40개 전체/빌드·Node/CLI를 다시 확인합니다. 현재 TASK086 구현 제안은 철회 상태36/45이며 새 전체/현재 공개검사·발견 처리와 자기 main 뒤 판단합니다. 수동 요청7155106350은 한 번 사용했으며 다시 달지 않습니다. 실제 학원컴 Aside/PC 카카오·권한 적용·두 폭은 미확인이고 모델/카카오 메시지·브라우저·메일·결제0입니다.

네 번째 고정 원본d727807a3e2fd052c562fadc83849b676a00891d의 새 전체는 서버2848통과/2실패였고 웹/빌드는 시작하지 않았습니다. 실패는 스테이징 쓰기 점검 도구가 알레르기SELECT를 아직 금지로 기대한 두 경우입니다. 도구가 자기 합성 초안의 표시용 읽기를 확인하고, 알레르기UPDATE·전화번호UPDATE·삭제 등5개 금지 쓰기는 계속 거절하게 고쳤습니다. 점검/제한 역할3파일39개는 종료0이며 임시 멤버십·역할·합성 행의 원복도 확인합니다. 앱 제품/시험·API/DB 파일은d727 이후 그대로이고 도구SQL과 기록만 달라집니다.

용어 검사 후보3건에서 문구를 고쳐 종료0을 확인했습니다. 그 검사 뒤 커밋 전 시작된 세 번째 전체는 중단/시험DB 정리하고 결과에서 제외했습니다. 당시 Node51개는 통과했지만 CLI는 미커밋 입력을 거절했으며, 고정 원본의 자료 생성 성공으로 쓰지 않습니다. 커밋 뒤 별도 Node51/실패0과V4 실제 Linux CLI를 확인했습니다. 이 원본과 실패 로그를 보존하고 현재 도구 고침을 커밋한 뒤 다섯 번째 새 빈40개 전체/빌드와 자료를 검사합니다. TASK086 구현 제안은 여전히 철회 상태이며 새 전체/최종 공개검사·리뷰 발견 처리와 자기 main 확인 뒤 판단합니다. 실제 새SELECT 권한 적용/Aside·PC 카카오는 미확인입니다.

최종 코드54e0af6c4ae4cfb88951083be7cd8abefef60470의 다섯 번째 새 빈40개 이행에서 서버145파일2850개·웹71파일1727개·Vite916ms와 두 Worker가 모두 종료0이며 시험DB도 정리했습니다. 이 뒤 제품/시험·API/DB/두 권한 점검SQL 차이0입니다. Node51개/실패0과 같은 원본의V5 실제 Linux CLI18상태 프레임+32응답 프레임=50개/파일53개도 확인했습니다. 같은 lock 설치 재사용이며 새 로컬 npm ci로 세지 않습니다.

수동 P1 4691357308과 실장님 코드/보안7155527519의4건 처리 코드를 검증했습니다. 실제 콜백/만료 답의 규정/두 고지와 서버 요약·기한, 미준비 입력의 버튼0·견적 회복 안내, 사장님 연결의 세 칸과 이번 안내 미전달, 사진 결과 한 칸, 제한 역할/PII 읽기·쓰기 금지와 점검 도구 원복을 포함합니다. 관련13파일324개와 점검3파일39개는 겹치므로 합산하지 않습니다. 이전 전체 실패/커밋 전 중단과 원본 자료는 보존하며 현재 성공으로 바꾸지 않습니다.

TASK086을 실환경 남음 행의 구현 완료 제안에 다시 넣었습니다(끝남36/구현46·MVP 시작 가능16/전체 의존20 제안). 실제 스테이징의 초안8개 열SELECT 적용·Aside/PC 카카오의 현재 가게·고지/버튼/기한·두 폭은 미확인이고 finished는 늘리지 않습니다. 자기 최종 공개 단계/CLI·현재 두 OS/app·db CI·발견 처리/재리뷰와 squash 뒤 main CI/실제 배포·전체태그/활성100%/health200·원격SHA 뒤 확정합니다. 수동 요청7155106350은 한 번 사용했으며 다시 달지 않습니다. 부모275의 보안4690767876/제품 결정 대기는 TASK145/166에 그대로입니다. 다음은 최종 공개검사/현재 CI·리뷰 처리와 자기 main 뒤 TASK089입니다.


### (677) TASK-089 실제 페이지 방향과 사진·세션 경계

최종 고정c9659301f88330e27974300e4c8da4d047041cc2의 새 빈40개 이행에서 서버145파일2854개·웹73파일1772개·Vite637ms와 두 Worker가 종료0이고 시험DB를 정리했습니다. Node55개/실패0과 같은 원본의 V3 실제 Linux CLI도 종료0입니다. 관련 서버59개/웹45개는 전체에 포함하므로 합산하지 않습니다. 같은 lock 설치 재사용이며 새 로컬 npm ci로 세지 않습니다.

수동3건과 실장님 코드/보안7157264383의 서로 다른5건을 고쳤습니다. 기존 정방향 API043/200자 커서를 유지하면서 최근20개/이전 페이지와 고정한 사진 재조회 기준을 추가했습니다. 동률의 저장 순서·페이지별 사진/사진 창·새 메시지 사이 같은 페이지 재조회와 방향/가게/상담 바인딩, 실제 탭의 신원 확인과 두 조회 사이 계정 변경·기대 가게 거절을 검증합니다. 확인 중에는 이전 자료를 가리고 같은 신원은 읽던 페이지/선택을 보존하며 실패/로그아웃/새 신원은 비웁니다. 실패 원본/패치와 옛 전체 결과는 보존하며 현재 통과로 바꾸지 않습니다.

공개2c38204c4ab84b6f7efa5ea6b8d378f3565c076e의 직접 단계가 종료0/작업 폴더 깨끗함입니다(API17·ERD15·사이트맵17·화면15·WBS18). --no-browser의 미확인1을 유지하며 같은 공개 원본의 실제 CLI도 종료0입니다. 자료는6상태/7응답을 준비하며765파일은 번들 파일 수이고 실제 그린 프레임은0입니다. app45583181748/db45583181807의 Linux139098055038·Windows139098055499·PostgreSQL16.15 139098052574/17.11 139098052860도 성공했습니다. PR 배포139100525794는 생략이며 자기 main의 실제 배포는 별도로 확인합니다.

TASK089 구현 완료 제안을 다시 넣었습니다(끝남36/구현47·MVP 시작 가능15/전체 의존19 제안). 최종 기록 공개 원본의 단계/CLI·현재 두 OS/app·db CI·발견 처리/재리뷰와 squash 뒤 main CI/실제 배포·전체태그/활성100%/health200·원격SHA 뒤 확정합니다. 실제 Aside360/1280·44px/page-check·자기 가게의 원래 값/사진/키보드·PC 카카오는 미확인이고 finished를 늘리지 않습니다. 수동 요청7157142247은 한 번 사용했고 다시 달지 않습니다. 학원컴 Aside CLI만 사용하며 새 전송/브라우저·모델/카카오 메시지·메일·결제0입니다. 부모277의 초안8열SELECT 실제 적용 미확인과 부모275의 보안4690767876/제품 결정 대기를 유지합니다. 다음은 최종 공개 검사/현재 CI·발견 처리와 자기 main 뒤 TASK104입니다.

[수락 대조](consultation-messages/2026-11-25-screen/acceptance-checks.md).


### (678) TASK-089 같은 주소의422 복구와 한 페이지의 커서 용량

PR #278의 병합 뒤 [실장님 코드·보안 리뷰7158693556](https://github.com/kodonghui/siljang.ai/pull/278#issuecomment-7158693556)에서 새로 발견한 두 오류를 고칩니다. 검색 조건 없는 상담 주소의 이전 페이지가422로 실패하면 같은 주소로 이동해 읽던 상태가 남았습니다. 이제 처음부터 보기는 페이지·사진 선택과 오류를 비우고 커서 없이 최신 페이지를 읽습니다. 검색 조건이 있으면 지운 주소로 이동해 같은 방식으로 다시 읽습니다.

사진 재조회용 reloadCursor가 고정200자 봉투의 용량을 넘으면 다음 페이지가 없는 상담도500으로 끝났습니다. 용량 오류를 별도 형식으로 구분해 다음 페이지가 없을 때만 보조 커서를 null로 돌려주고 본문을 읽습니다. 다른 암호화 오류와 다음 페이지가 필요한 오류는 숨기지 않습니다. 기본 정방향·가게/상담/방향 바인딩·동률 순서·페이지별 사진과 신원 확인은 유지합니다.

실제 OwnerArea에서 실패를 재현한 원본70aedd29의 웹은1실패/22건너뜀, 실제 DB·API043에서 긴 가시성 목록을 주입한 서버는1실패/38건너뜀이었습니다. 고친9e1e755d의 관련 웹23개/서버2파일60개와 타입·엄격lint가 종료0입니다. 검색 조건 시험을 추가한 첫 제품/시험 원본은 f73978274b6b2bd4e168e88f610d7df336ff3e55입니다. 새 빈40개 전체·빌드의 결과는 다음과 같습니다.

새 고정4ed1dd404a3c282b3a643fc82d5dca72a1a795cc의 빈40개 이행에서 서버145파일2855개·웹73파일1774개가 통과했습니다. Vite577ms와 앱 Worker5453.92KiB/gzip1003.69KiB·저장소 Worker21.08KiB/gzip6.55KiB가 종료0이며 DB 정리/state completed를 확인했습니다. 같은 원본의 Node55개/실패0·실제 Linux 자료 생성 CLI6상태/7응답과 타입·엄격lint도 종료0입니다. CLI는 실행 준비 자료이며 실제 그린 프레임0·브라우저 미실행입니다. 앞선 실패와 재현 패치를 보존합니다. 이 뒤 제품/시험·API/DB/권한 SQL 차이0을 확인하고 기록만 추가합니다.

첫 전체 f73978274b6b2bd4e168e88f610d7df336ff3e55는 서버145파일2855개 통과, 웹1773통과1실패였으며 빌드는 시작하지 않고 DB를 정리했습니다. 추가한 검색 조건 시험이 limit=1에 여러 행인 계약 예제를 돌려준 자료 오류였습니다. 실제 클라이언트의 한도 검사를 유지하고 시험의 검색 조건을 limit=20으로 고쳤습니다. 이 실패를 제품 고침의 통과로 바꾸지 않으며 새 고정 원본의 전체/빌드를 확인합니다.
 같은 lock의 설치를 재사용하며 새 로컬 npm ci로 세지 않습니다.

부모 main cd862de063ed228e05fac28f019da8c34de622eb의 app45587192949/db45587192912와 Linux139111683412·Windows139111683851·PostgreSQL16.15 139111682838/17.11 139111682393·배포139113811833가 성공했습니다. 실제 검증 로그의 버전1073382e-c7a1-43b3-ae04-b893d7d5af8a·생성2026-11-25T09:42:11.814175Z·전체 태그·활성100%·health200과 원격main을 대조했습니다. 학원컴·저장소 Worker의 별도 활성 태그는 미확인입니다.

실제 학원컴 Aside/PC 카카오·두 폭360/1280·44px/page-check·자기 가게의 원래 값/사진/키보드와 부모277의 초안8열SELECT 적용은 미확인 그대로입니다. 학원컴 SSH의 외부 실패 두 번 뒤 새 복구 근거가 없어 재시도하지 않았습니다. 브라우저는 학원컴 Aside CLI만 사용하며 이 작업의 새 브라우저·모델/카카오 발신·메일·결제는0건입니다. 부모275 보안4690767876/제품 결정 대기는 별도 미해결입니다. 끝남36/구현47을 늘리지 않으며 후속 공개 검사·리뷰·CI와 squash 뒤 자기main/실제 배포/원격SHA를 확인합니다. TASK104의 부분 구현은 공개 WIP121dc069c4ca5476f870b2fc537dec36ba2cf22f에 보관했으며 이 고침 뒤 계속합니다.

[재현과 검사](consultation-messages/2026-11-25-recovery/acceptance-checks.md).


PR279의 수동 리뷰4693412935에서 보조 커서가 없는 사진 재조회가 새 nextCursor를 버리는 P2를 확인했습니다. 원본24b6c8db에서 처음20개·사진 만료·새 메시지 도착 뒤 실제 OwnerArea의 이전 대화 버튼이 없어지는1실패/24건너뜀을 재현했습니다. 커서 없는 사진 갱신은 새 전체 페이지와 이전 대화 커서를 함께 반영하고, 사진 실패 상태를 비우며 새 페이지에서 없어진 선택을 지웁니다. 새 메시지와 밀려난 옛 메시지21개를 다시 읽는 시험을 포함해 관련 웹25개와 엄격lint가 종료0입니다. 페이지 커서가 있으면 기존 페이지의 사진만 갱신합니다.

앞선4ed1dd404a3c282b3a643fc82d5dca72a1a795cc의 서버2855/웹1774·빌드·Node55/CLI 성공은 고침 전 근거로 보존합니다. 바뀐 웹 코드의 새 고정 전체·빌드·Node/CLI/타입과 현재 공개 검사·리뷰/발견 처리를 이어갑니다. 수동 요청7159437409는 한 번 사용했고 다시 달지 않습니다. README386/fix678의 같은 PR에 기록하며 실제 학원컴 화면과 부모275 보안4690767876/제품 결정 대기는 미확인·미해결 그대로입니다. 끝남36/구현47은 늘리지 않습니다. TASK104는 독립 작업 폴더의 생성/다음 답 전달 관련37개를 확인했으며 부분 구현이고 구현 완료로 세지 않습니다.


사진 갱신까지 고친 고정c21ac21850cfa14044c3f17b0b9e06a59de9bd0a의 새 빈40개 이행에서 서버145파일2855개·웹73파일1775개가 통과했습니다. Vite648ms와 앱 Worker5453.92KiB/gzip1003.69KiB·저장소 Worker21.08KiB/gzip6.55KiB가 종료0이고 DB 정리/state completed를 확인했습니다. Node55개/실패0·같은 원본의 실제 Linux 자료 생성 CLI6상태/7응답·타입/엄격lint도 종료0입니다. 자료 생성은 브라우저 미실행·실제 그린 프레임0이며 새 로컬 npm ci가 아닙니다. 공개beac8abb2bf41482596979e4cd0d365f17a1a47f의 트리14fdb5feebb00acf624a66cd313d3b0c946cbe86가 고정 원본과 같습니다. 이 뒤 제품/시험·API/DB/권한 SQL 차이0을 확인하고 기록만 추가합니다.

수동4693412935와 실장님7159548036의 같은 P2를 실패 원본24b6c8db(1실패24건너뜀)부터 고쳤습니다. 처음20개 뒤 새 메시지가 생겨 밀려난 옛 기록까지21개를 다시 읽고, 커서 없는 사진 갱신은 새 페이지/nextCursor와 사진 실패 상태·사라진 선택을 함께 갱신합니다. 고정 커서가 있으면 같은 페이지를 유지합니다. 이전4ed 전체2855/1774와 첫f739 자료 오류·초기70aedd 두 재현을 보존하며 현재 성공으로 바꾸지 않습니다. 수동 요청7159437409는 한 번 사용했고 다시 달지 않습니다. 현재 공개검사/두 OS·app/db CI·발견 처리/재리뷰와 squash 뒤 자기main의 CI/실제 배포·전체태그/활성100%/health200·원격SHA를 이어갑니다. 실제 학원컴 Aside/PC·두 폭/개인정보/사진/키보드·권한 적용과 부모275 보안4690767876/제품 결정 대기는 미확인·미해결 그대로이며 끝남36/구현47을 늘리지 않습니다. 다음은 자기main 뒤 TASK104의 부분 구현을 계속합니다.


## PR #280 — TASK-104 손님 안내 전달 기반

(679) Event 스킬 응답 생성과 실제 전달 관측을 구분합니다. 결제 시계는 안내에 연결된 자기 주문/손님·결제 요청과 전달 시각을 확인하고 같은 트랜잭션에 한 번만 남깁니다. 계좌는 당시 계좌를 표시 직전에만 풀며 새 금액 확인 전/기한 지남에는 키 없이 안전한 글만 보입니다. 예약 시각과 변경된 날짜·닫힌 신고/재제작을 발신 전에 다시 확인합니다. 새 최소 권한을 추가하면 옛 금지 기대와 실제 실패 감시 조회도 함께 대조하며 본문/금액/상한·견적 수정과 삭제 금지는 유지합니다.

TASK104의 안내 저장·읽기·다음 답 전달과 발신 실행기 기반을 구현했습니다. 실제 확인된 결제의 확정 안내와 결제 안내는 같은 사건 한 건이며, 계좌는 안내에 연결된 옛 계좌를 표시 직전에만 풉니다. API073을 읽는 것만으로 전달 표시나 결제 시계를 바꾸지 않습니다. 다음 메시지/성공 콜백/합성 발송 관측의 전달 시각과 같은 트랜잭션에서 주문 당시 운영규정의 결제 시간(기본12시간)과 상한 중 이른 때를 한 번만 남깁니다. 새 금액 확인 전에는 요청 견적의 확정/부터/범위 표시·새 금액·사유를 보이며 계좌를 풀지 않습니다.

Cron 기본값은 실제 발신/결과 조회를 끄며 클라이언트도 만들지 않습니다. 켠 합성 경로는 접수와 전달을 구분하고1·5·30분 재시도/관측, 실제 관측 시각, 친구/채널의 더 최신 확인 보존·임대/두 연결 중복 방지를 검증했습니다. 설정 오류는 새0041의 channel_event_unavailable 사장님 알림 하나와 카카오 연결 화면으로 잇고, 잔액 부족은 기존 운영자 실패 감시로 잇습니다. 최소 권한 역할의 실제 읽기·생성·전달·오류 기록은 통과하며 안내 본문/ID 수정·삭제, 결제 금액/상한과 견적 수정은 열지 않습니다.

예약 시각 전 Event 스킬/다음 대화 노출, 운영규정6시간인데12시간을 쓰던 오류, 날짜가 바뀐 전날 안내와 닫힌 신고/재제작의 후기 발신을 실패 시험부터 고쳤습니다. 실제 확정 안내 생성→합성 Event 접수/관측과 채널 불가→다음 메시지를 대조했습니다. 끝난 상담의 확정 안내도 새 고지 뒤 합성 AI 답 전에 한 번 전합니다. 관련55개와 뒤 전체에서 발견한 기존 권한/감시 시험46개는 겹치므로 합산하지 않습니다.

첫 고정d01ade783a7f3b758b0e51ee919b9fd7f293011d의 새 빈41개 전체는 서버150파일에서2907통과/4실패였고 웹/빌드는 시작하지 않았습니다. 기존 due_at 금지 기대와 새 매분 안내 조회를 모르는 감시 시험3개였으며, 상한 금지로 대조하고 조회/오류의 실제 기대를 보완한 뒤 관련46개가 통과했습니다. 첫 단계의 ERD D2는0041의 열 설명 누락, WBS는ERD 대응에 따른 생성 추적 표 차이였습니다. 새 마이그레이션 설명을 원본과 맞추고 WBS 생성기를 돌려18개/오류0이며 끝남36개를 유지했습니다. Node55개/실패0은d01 원본의 결과입니다. 이 실패를 성공으로 바꾸지 않고 새 고정 전체·빌드/단계를 다시 확인합니다. 같은 lock의 설치 재사용이며 새 로컬 npm ci가 아닙니다.

이 PR은 전달 기반의 부분 구현입니다. 일반 글5종과 결제 안내 읽기를 다루며, 종류별 고정 템플릿·무의미해진 사건과 확정 안내의 주문 내용/규정·사진/후기 버튼 표시는 남습니다. SCR005/011 표시 작업과 실제 업무 명령의 생성 연결을 이어서 대조한 뒤 TASK104 전체 완료를 판단합니다. 구현 완료/finished를 늘리지 않고 끝남36/구현47·MVP 시작 가능15개를 유지합니다.

부모279 main bb9703824b944670d732241d01a06c1ce270f613의 app45596362332/db45596362348·Linux/Windows·PG16/17·배포139145582340가 성공했고 버전6fa6873d-c75a-4509-bee1-f197dd5697a5·전체 태그/활성100%/health200·원격main을 확인했습니다. 실제 학원컴 Aside/PC 카카오·두 폭·개인정보/사진/키보드와 초안8열SELECT·새0041/최소 권한 적용, 감시 메일은 미확인입니다. 학원컴 접속의 바깥 실패 두 번 뒤 새 복구 근거가 없어 재시도하지 않았고 브라우저는 학원컴 Aside CLI만 사용합니다. 예상 AI 비용0원, 실제 모델/카카오 발신/메일/결제0건입니다. 부모275 보안4690767876/제품 결정 대기는 별도 미해결입니다.


새 고정039b79aaa93fa8aed46198b87735bf972b7bce44의 새 빈41개 이행에서 서버 전체2911개가 통과했습니다. 첫 웹은1774통과/1실패로 합친 npm test 종료1이었고 빌드는 시작하지 않았습니다. 기존 추가 페이지의 사진 재조회 시험이며 단독 파일25개와 웹 전체 재실행1775개는 종료0입니다. 원인은 확정하지 않았고 실패를 통과로 바꾸지 않습니다. 같은 원본의 별도 빌드도 종료0이며 시험DB를 정리했습니다. 한 번의 전체 npm test 성공으로 세지 않고 새 설치/단일 전체 명령의 종료0은 PR CI에 요구합니다. 실제 통과한 각 실행의 결과 줄은 다음과 같습니다.

```text
Test Files  150 passed (150)
Tests  2911 passed (2911)
Duration  283.98s (tests 70%, import 29%)
Test Files  73 passed (73)
Tests  1775 passed (1775)
Duration  44.50s (tests 55%, import 35%, environment 8%, transform 2%)
✓ built in 728ms
Total Upload: 5476.98 KiB / gzip: 1008.88 KiB
Total Upload: 21.08 KiB / gzip: 6.55 KiB
```

같은 원본의 설계 단계는prd/flows/spec·ERD15·API17·사이트맵17·화면15·WBS18 모두 오류0입니다. mockup은 --no-browser로13통과/미확인1이며 실제 브라우저 검사로 세지 않습니다. [검증 자료](customer-notices/2026-11-25-foundation/full-proof-039.json)에 원본과 적용 범위별 Git 객체를 남겼고 이 뒤 제품/시험·API/DB/권한 SQL 차이0을 확인했습니다. README 빈 줄 형식1건은 공개 전 엄격lint가 막았고 기록만 포맷했습니다. 새 로컬 npm ci가 아닌 같은 lock 설치 재사용이며 실제 새 설치는 현재 PR CI에서 확인합니다. TASK104는 종류별 표시/업무 연결이 남은 부분 구현이고36/47을 유지합니다. 다음은 현재 공개 원본/리뷰·app/db CI와 squash 뒤 자기main/배포/원격SHA입니다.


추가 날짜 경계: SPEC-052의 전날 안내가 밤을 넘겨 픽업 당일08:00에 발신되던 오류를 be7ac07f의1실패/5통과/19건너뜀으로 재현했습니다. 픽업 당일에는 전날 안내를 버리고, 아직 예약 날짜 전이면 오래된 재시도 시각으로 찾아도 보존합니다. 같은 날 정상 발신과 미래 보존까지 관련3파일58개가 통과했습니다. 기존039의2911/1775·별도 빌드/단계·Node55 결과는 고침 전 근거로 보존하고 새 제품 코드의 고정 전체/빌드를 다시 확인합니다. 처음 추가한 미래 시험의 편집은 작업 디렉터리를 잘못 지정해 적용되지 않았고, 그때57개 통과를 미래 시험의 성공으로 세지 않습니다. 경로를 고친 뒤58개를 실행했습니다. TASK104는 여전히 부분 구현이며36/47을 유지합니다.


전날 안내 날짜 경계까지 고친 최종 고정4f70285d6ffa656806b161cb8961a5ad57a2d720의 새 빈41개 이행에서 하나의 npm test와 별도 빌드가 모두 종료0입니다. 시험DB 정리와 state completed도 확인했습니다. 실제 결과 줄은 다음과 같습니다.

```text
Test Files  150 passed (150)
Tests  2914 passed (2914)
Duration  284.10s (tests 70%, import 29%, transform 1%)
Test Files  73 passed (73)
Tests  1775 passed (1775)
Duration  43.27s (tests 54%, import 37%, environment 8%, transform 2%)
✓ built in 881ms
Total Upload: 5477.07 KiB / gzip: 1008.88 KiB
Total Upload: 21.08 KiB / gzip: 6.55 KiB
```

같은 원본의 Node55개/실패0과 설계 단계prd/flows/spec·ERD15·API17·사이트맵17·화면15·WBS18이 오류0입니다. mockup의 --no-browser 미확인1을 유지하며 실제 브라우저 검사로 세지 않습니다. 이 뒤 제품/시험·API/DB/권한 SQL 차이0이며 최종 기록의 엄격lint/타입/키/용어를 확인합니다. 같은 lock의 설치 재사용으로 새 로컬 npm ci는 아니며 현재 PR CI에서 실제 새 설치를 확인합니다.

이전d01 전체 서버2907/4실패와039의 서버2911통과·첫 웹1774/1실패·단독25/웹 전체 재실행1775·별도 빌드를 보존합니다. 사진 재조회 실패의 원인은 확정하지 않았고 이번 성공으로 옛 실패를 덮지 않습니다. 039 자료는full-proof-039.json, 현재 자료는full-proof.json입니다. 전달 기반은 부분 구현이며 종류별 표시/업무 연결과 실환경 확인이 남아36/47을 유지합니다. 다음은 준비 PR의 현재 CI·코드/보안 검토·수동 요청1회/처리와 squash 뒤 자기main/배포/원격SHA입니다.


PR280의 [실장님 코드/보안 검토7161986707](https://github.com/kodonghui/siljang.ai/pull/280#issuecomment-7161986707)가 현재f5e85df1b47c64cdcbdd9d4cd0d4ed139d99afde에서 P2 두 건을 찾았습니다. 별도 보안 결함은 확인되지 않았고 관리형 스캔의 HEAD 인식 실패 뒤 고정 커밋을 직접 정적으로 검토했습니다. 첫 자동 실행은 확인했으며 수동 요청은 아직 하지 않았습니다.

긴 한글 결제 링크의 정규화 뒤 길이 초과/API073 실패·다음 대화 막힘과, 계좌 대신 상태 문구만 전해도 결제 시계가 시작되는 오류를a25f649b의10실패/4통과/58건너뜀으로 재현했습니다. API025는 정규화한 URL도2048자 안이어야 하며, 이미 저장한 긴 링크는 계좌 안내와 현재 답의 자리를 보존하도록 링크만 빼고 전합니다. 짧은 링크는 그대로 보입니다. 실제 전달 기록도 요청 견적의 표시/금액과 수락 사유가 준비된 경우에만 결제 시계를 시작합니다. 다음 대화와 발송 성공 표시 두 경우를 대조하며 정상 범위 견적의 계좌/기한도 확인했습니다.

현재 관련4파일89개와 타입/엄격lint가 종료0입니다. 기존 최소 권한으로 새 조인이 되며 권한은 늘리지 않았습니다. 이전4f의 전체2914/1775·빌드/설계/Node55는 고침 전 근거로 보존하고 새 고정 전체/빌드를 확인합니다. 두 발견 사항 처리와 현재 CI/수동 요청 한 번/병합 조건, 자기main·실제 배포·원격SHA까지 계속합니다. 부분 구현·36/47과 실제 Aside/PC·권한/0041 적용 미확인·모델/카카오 발신/메일/결제0을 유지합니다.


실장님 P2 두 건과 전날 안내 날짜 경계까지 고친 최종 고정1fcbe6381638861329eabfb0ddaf688e9858dca8의 새 빈41개 이행에서 하나의 npm test와 별도 빌드가 모두 종료0입니다. 시험DB 정리와 state completed도 확인했습니다. 실제 결과 줄은 다음과 같습니다.

```text
Test Files  150 passed (150)
Tests  2928 passed (2928)
Duration  267.00s (tests 70%, import 30%, transform 1%)
Test Files  73 passed (73)
Tests  1775 passed (1775)
Duration  41.39s (tests 55%, import 36%, environment 7%, transform 2%)
✓ built in 715ms
Total Upload: 5477.81 KiB / gzip: 1009.22 KiB
Total Upload: 21.08 KiB / gzip: 6.55 KiB
```

같은 원본의 Node55개/실패0과 설계 단계prd/flows/spec·ERD15·API17·사이트맵17·화면15·WBS18이 오류0입니다. mockup의 --no-browser 미확인1을 유지하며 실제 브라우저 검사로 세지 않습니다. 이 뒤 제품/시험·API/DB/권한 SQL 차이0이며 최종 기록의 엄격lint/타입/키/용어를 확인합니다. 같은 lock의 설치 재사용으로 새 로컬 npm ci는 아니며 현재 PR CI에서 실제 새 설치를 확인합니다.

이전d01 전체 서버2907/4실패와039의 서버2911통과·첫 웹1774/1실패·단독25/웹 전체 재실행1775·별도 빌드를 보존합니다. 사진 재조회 실패의 원인은 확정하지 않았고 이번 성공으로 옛 실패를 덮지 않습니다. 039 자료는full-proof-039.json, 고침 전4f 자료는full-proof-4f.json, 현재1fc 자료는full-proof.json입니다. 실장님7161986707의 두 P2를10실패/4통과로 재현해 고쳤고 처리7162248578에 새 원본/관련89개·최소 권한을 기록했습니다. 수동 커넥터 요청은 아직 하지 않았으며 현재 CI 뒤 한 번만 합니다. 전달 기반은 부분 구현이며 종류별 표시/업무 연결과 실환경 확인이 남아36/47을 유지합니다. 다음은 준비 PR의 현재 CI·코드/보안 검토·수동 요청1회/처리와 squash 뒤 자기main/배포/원격SHA입니다.

## PR #281 — TASK-106 결제 안내 표시와 실제 안내 읽기 연결

### (680) 결제 안내의 계좌·버튼·바로가기를 같은 표시 자료에서 전한다

- 원인: 표시 함수를 따로 만들어도 공통 응답/콜백이 출력만 받으면 결제 바로가기를 잃었습니다. 실제 안내 읽기는 기존 글 경로라 새 표시 함수와 이어지지 않았습니다. 요청 견적의0원부터는 양수 결제 금액과 다른 유효한 표시입니다.
- 고침: 저장하지 않는 결제 표시 자료를 공통 내용으로 펼치고, 다시 펼쳐도 같게 합니다. 상담·주문 요청 결과·콜백과 세 출력 응답에서 버튼/바로가기를 보존합니다. 실제 안내 읽기는 기존 소유·상태/기한·키 검사를 지킨 뒤 표시를 만들고 상대 시간/상한으로 읽기의 시계 비시작을 보존합니다. 정규화 URL은 main의 공통2048자 한도를 씁니다.
- 확인: 관련7파일152개, 뒤의 안내/시계/최소 권한 등6파일81개와 엄격lint/타입 종료0입니다. 결과는 겹쳐 합산하지 않습니다.35응답은08원본과 대조하며 합성 HTML은 실제 화면 통과가 아닙니다.
- 남음: 차액 업무 자료·카드 발급/교체·실제 금액 확인 명령 뒤 표시와 전체/빌드·PR/CI·자기 main/배포, 학원컴 Aside/PC 카카오입니다. TASK106을 구현 완료로 세지 않습니다.

- 작업 중 기록: 저장소 뿌리에서 npm --prefix app으로 실행한 README 형식 검사가 중첩 설정 오류로 멈췄습니다. 설정은 바꾸지 않고 app 작업 경로에서 같은 형식 검사를 다시 실행합니다.

680번 검증 보충: 새 빈41개 이행의 단일 전체 명령은 서버2957개/웹1775개·빌드 종료0, Node55개·WBS18개/오류0입니다. 고정 원본d5c80fb3 뒤 제품·시험은 바뀌지 않았습니다. 같은 원본의7상태14프레임/35응답 중24응답 프레임은 합성 HTML이며 실제 화면은 미실행입니다. PR280 main/실제 스테이징 전체 태그·활성100%·health200·원격 SHA도 확인했습니다. 남은 업무 연결은 그대로 부분 구현입니다.

680번 발견 사항 고침: 설정/입력 계약보다 엄격했던 표시의 두 검사를 고쳤습니다. 은행명·예금주의 줄바꿈은 표시에서 공백으로 바꾸고 저장 원문은 보존합니다. 블록 ID는 기존 설정 검사를 재사용합니다. 실패12개/통과52개에서 고쳐 관련7파일95개·엄격lint/타입이 종료0입니다. 옛d5 전체 근거를 보존하고 새 고침의 전체/빌드·합성 자료·현재 CI를 다시 확인합니다. 병합 직전 요청은7163322038 한 번이며 다시 요청하지 않습니다.

680번 검증 보충: 새 빈41개 이행의 단일 전체 명령은 서버2970개/웹1775개·빌드 종료0, Node55개·WBS18개/오류0입니다. 고정 원본8dd38139 뒤 제품·시험은 바뀌지 않았습니다. 같은 원본의7상태14프레임/35응답 중24응답 프레임은 합성 HTML이며 실제 화면은 미실행입니다. PR280 main/실제 스테이징 전체 태그·활성100%·health200·원격 SHA도 확인했습니다. 남은 업무 연결은 그대로 부분 구현입니다.

실장님7163315202의P2/P3는 처리7163528281로 이었으며 현재 고침의 새 빈 전체2970/1775·빌드/Node55·WBS18과 합성 자료가 종료0입니다. 수동 요청7163322038은 한 번이고 코드7163371686/보안7163431797 완료·추가 발견 없음입니다. 이후 변경은 발견 사항 고침/회귀 시험과 기록입니다. 진행 PR은 https://github.com/kodonghui/siljang.ai/pull/281 이며 다음은 최종 기록 head의 CI와 squash·자기 main/실제 배포/원격 SHA 확인입니다.

## PR 282 — TASK-104 18종 안내와 예약 조건의 공통 전달

### (681) 공통 전달의 종류 누락과 예약의 현재 의미를 같이 본다

- 원인: 발신 실행기의 전날/후기 안내가 스킬/다음 대화 목록에는 없었고, 다른 업무 종류도 저장 가능한18종 가운데 일부가 빠져 있었습니다. 미래/시간 밖의 유효함과 무의미함을 구별하지 않으면 예약을 버리거나 뒤 안내를 막습니다.
- 고침: 스키마의18종과 전달 목록을 대조하고 예약의 현재 의미와08:00~20:50 조건을 두 읽기 경로에서 같이 씁니다. 스킬은 읽기만 하고, 다음 대화에서 무의미한 자기 예약만 닫습니다. 기존 최소 권한을 넓히지 않았습니다.
- 확인: 자료의 픽업 일시/날짜·현재 내용 버전과 인도 상태를 먼저 일치시킨 뒤 변경 전6실패/10통과, 종류 누락21실패/8통과를 확인했습니다. 최신 main과 합친165개·엄격lint/타입 통과입니다. 새 전체/빌드와 현재 CI는 이어갑니다.
- 범위: 업무가 저장한 본문의 공통 전달과 업무별 템플릿/명령을 WBS의 각 작업에서 대조합니다. TASK104의5개 수락 기준과 API073/A12/A20·자기 main 검증이 끝난 뒤 완료를 기록하며 사진/동의·환불/변경 업무를 통과로 세지 않습니다.

681번 검증 보충: 고정002a88f2의 새 빈41개 단일 전체에서 서버155파일3015개·웹73파일1775개/빌드 종료0, 시험 데이터베이스0개 남음·Node55개·WBS18개/오류0입니다. 이후 제품·시험·API·데이터베이스/권한은 같고 기록만 보충합니다. 현재 PR의 새 설치/전체 CI와 코드·보안 검토·자기 main/실제 배포까지 확인한 뒤 제공·수용을 판정합니다.

#### PR282 리뷰 발견 사항 처리

실장님 코드·보안 검토7164719634(head ffb9410886c7b359866f2fac086854176f66acf0)의P2/P3를 고쳤습니다. 아직 전달하지 않은 deferred 전날/후기도 새 발송 시각으로 옮기며 다음 대화에서 새 시각 전까지 보존합니다. 그 행의 next_attempt_at과 이미 시작한 시도의 임대/재시도 표는 덮어쓰지 않습니다. 공백뿐인 일반 안내는 같은 손님의 미전달 대기에서 닫아 뒤의 정상 안내가 진행되게 합니다. JavaScript trim과 같은 공백을 SQL에서 대조하며 결제 안내의 본문에는 이 정리를 적용하지 않습니다.

수정 전e4e1c911의7실패/45통과를 확인한 뒤 예약/18종·캘린더/가용일·최소 권한/다음 대화6파일176개가 통과했습니다. ASCII·줄바꿈·NBSP/전각/FEFF 공백 두 행 뒤의 환불 안내를 실제 수신으로 대조했습니다. 저장 본문·ID·보낸 시각은 바꾸지 않으며 공백 안내는 sent_at 없이 dropped가 됩니다. 현재 고침의 엄격lint/타입·새 빈 전체/빌드/Node/WBS와 최종 CI는 이어서 확인합니다.

PR282의 수정 전 app45629208844/db45629208831는 성공했습니다. 병합 직전 요청7164730968은 한 번이며 코드 결과7164776388은 추가 발견 없음입니다. 보안 결과와 현재 고침의 최종CI·처리 댓글·자기 main/실제 배포 확인은 남았습니다. 이후 제품 변경은 위 발견 사항 고침과 회귀 시험뿐입니다. 실제 카카오/학원컴 Aside·0041/최소 권한 적용은 미확인, 예상 AI 비용0원·실제 외부 발신/모델/메일/결제0건입니다.

#### PR282 현재 고침의 전체 검증

실장님7164719634의P2/P3는 처리7164844325로 이었고, 고침 원본9809b786ab0f623f1de5bd09aeb682935f05fece와 공개 같은 트리0bc3dcd97719bc303aedce01a8c035a130058b36에서 새 빈41개 이행의 단일 npm test·빌드가 종료0입니다. 시험 데이터베이스는0개 남았고 Node55개·WBS18개/오류0입니다. 같은 공개 원본의 app45630943747/db45630943741도 성공하여 CI 새 설치를 확인했습니다. 이후 제품/시험/API/데이터베이스·권한 원본은 같고 이 검증 기록만 보충합니다. 앞002a 원본의 전체 근거는 이름에002a를 붙여 보존했습니다.

```text
Test Files  155 passed (155)
Tests  3022 passed (3022)
Duration  297.42s (tests 69%, import 31%)
Test Files  73 passed (73)
Tests  1775 passed (1775)
Duration  45.59s (tests 54%, import 37%, environment 8%, transform 2%)
✓ built in 1.20s
Total Upload: 5491.42 KiB / gzip: 1011.95 KiB
Total Upload: 21.08 KiB / gzip: 6.55 KiB
```

병합 직전 요청7164730968은 한 번이며 코드7164776388·보안7164818560이 완료·추가 발견 없음입니다. 이후 변경은 발견 사항 고침/그 회귀 시험과 기록뿐입니다. 최종 기록 head의 CI·처리 댓글과 squash 뒤 자기 main CI/실제 배포/원격 SHA를 확인한 다음 TASK104 제공·수용을 판정합니다. 실제 학원컴 Aside/PC 카카오·0041/최소 권한 적용·감시 메일은 미확인입니다. 끝남36·구현47을 유지하며 예상 AI 비용0원·실제 모델/발신/메일/결제0건입니다.
