# 05단계 ERD: 수제케이크 주문제작 데이터베이스

상태: 확정(2026-11-12 11:56 동희님 '추천대로 굳힘', 10절). 2026-11-13 설계 재검토의 높음 묶음(H1·H2, H11·H12, H7·H8, H3, H4, H5·H10)과 중간 묶음(M1·M2·M3·M9·M10)을 마이그레이션 0002~0008로, 합친 PR에 남은 Codex 자동 검토 의견 넷을 0009로, 중간 묶음 M4·M13을 0010으로, M5·M6을 0011로, M7·M17을 0012로, M16·M18을 0013으로, M11·M14를 0014로, M12를 0015로, 남은 빈 곳(PR J2)을 0016으로, M8(앞 단계 문서 되돌리기와 앞뒤 맞추기)을 0017로, 낮음 K1(01단계 용어집에 더한 TERM-075~086의 자리)을 0018로, 낮음 K2(AI 상담 고지의 처리방침 버전, 재제작이 아닌 주문의 1원부터와 주문번호 6~8자)를 0019로, 동희님 결정 반영(한 손님의 결제 기다림 주문 한도와 그 에스컬레이션 건)을 0020으로, TASK-021 운영자 로그인(06단계 DEC-27, 운영자 세션과 로그인 실패)을 0021로, 그 독립 보안 검토 후속(운영자 행을 Supabase 사용자·TOTP 인증 수단에 묶고, 막기·2단계 인증 바꾸기가 열린 세션을 끝냄)을 0022로 고쳤습니다(11절). 원본은 [`db/schema.sql`](../../db/schema.sql)이고, 사람이 보는 곳은 ERD Editor로 여는 [`db/schema.erd.json`](../../db/schema.erd.json)입니다(`truth: source`). 이 문서의 표 목록과 다이어그램은 같은 원본에서 `build_erd.py`가 만듭니다.

## 1. 한눈에

- 테이블 60개(TBL-001~060), 컬럼 738개입니다. 외래 키 134개, CHECK 424개, UNIQUE 92개, EXCLUDE 1개로 데이터베이스가 지키는 규칙을 적었고, 제약 밖 인덱스는 70개(그 가운데 부분 인덱스 48개)입니다. 접속기록은 트리거 둘(`access_logs_guard`)이 고치거나 비우는 것을 막고, 주문 상태와 제작 행의 짝은 지연 제약 트리거 둘(`orders_production_sync`)이, 취소 뒤 들어온 입금·더 들어온 금액의 환불 계산값은 트리거 하나(`refunds_unconfirmed`)가, 재제작 주문이 돈을 낸 원래 주문을 가리키고 결제 안내·환불·장부 행을 두지 않음은 트리거 넷(`orders_remake_root`, `payment_requests_remake` 등)이, 끝나지 않은 재제작 주문이 있는 원래 주문이 끝나지 않음은 지연 제약 트리거 하나(`orders_remake_finish`)가, 한 주문에 잡힌 자리와 확정된 자리가 함께 있는 것이 차액을 기다리는 날짜 변경뿐임은 트리거 하나(`slot_holds_pair`)가, 취소 환불의 취소한 주문이 환불을 남기는 주문이나 그 재제작 주문임은 트리거 하나(`refunds_cancelled`)가, 주문 확정 뒤 그 주문을 확정한 결제가 확인을 취소한 것이 아님은 지연 제약 트리거 둘(`orders_confirmed_payment_live`, `payments_confirmed_void`)이 봅니다. 운영자를 막거나 2단계 인증·Supabase 사용자를 바꾸면 그 운영자의 열린 세션을 끝내는 것은 트리거 하나(`operators_end_sessions`)가 합니다.
- 기능 명세 SPEC-001~079가 읽고 쓰는 데이터 1098건을 테이블.컬럼 508개에 하나씩 이었습니다([`erd_map.py`](../../research/cake-erd-2026-11/erd_map.py)). 모든 SPEC에 대응이 있고, 쓰이지 않는 테이블은 없습니다.
- 용어집 TERM-001~086이 모두 자리를 가집니다. 애그리거트·읽기 모델 31개는 테이블 헤더 주석(16개)이나 '테이블 없음' 행(15개)에, 상태·값 이름 35개는 컬럼·테이블 설명에 TERM 번호로 있습니다.
- PostgreSQL 16.15의 빈 데이터베이스에 `db/schema.sql`과 마이그레이션 `0001_init.sql`~`0022_operator_auth_binding.sql`을 각각 만들어 카탈로그가 같음을 봤고, 규칙 테스트 338개가 모두 기대한 결과였습니다(막아야 할 쓰기 277개는 막힘, 늦은 쓰기 3개는 0행, 받아야 할 쓰기 23개는 들어감, 남은 행과 값 35개(지우기 결과 30개, 운영자 세션을 끝낸 결과 5개)는 기대한 값). 지우기(6절)를 31일·32일·3년·5년 뒤 시각으로 돌려, 지운 뒤 개인정보는 0건이고 계약·결제 기록은 그대로 남으며, 저장소가 실패한 사진 파일은 지울 파일로 남아 다음 날 지워짐을 봤고(8절 D4), 두 세션이 같은 주문을 동시에 쓰면 잠금 번호가 늦은 쓰기를 막음도 봤습니다(8절 D5).
- ERD Editor 다이어그램은 MCP 서버(1.2.0)로 이 원본을 들여와 만들었고, 2026-11-13~18의 바꿈은 편집 도구로 더했습니다(`erd_editor_sync.py`). 다이어그램의 DDL을 빈 데이터베이스에 만들어 견주면 CHECK 424개 말고는 같습니다(9절).
- 체크포인트: 2026-11-12 11:56 동희님이 이 작업 대화의 결정 카드에서 '추천대로 굳힘'을 고르셔서, 이 스키마와 5절의 결정 사항 E1~E14를 추천대로 확정했습니다. SPEC-021을 좁혀 읽은 E5(카드번호는 끝 4자리만 남김)도 함께 정해졌습니다.

## 2. 읽은 것과 만든 것

| 읽은 것 | 버전 | 쓴 것 |
| --- | --- | --- |
| [`docs/04-functional-spec/spec.md`](../04-functional-spec/spec.md) | 04단계 확정(2026-11-12 09:57 동희님 '추천대로 확정'), 커밋 ddb9c85. 2026-11-13 SPEC-070~075를 더하고 환불 길·주문자 정보·카카오 먼저 보내기와 채널 연결·보관과 지우기·계좌 암호화와 접속기록·알레르기 정보 동의·사진 게시 동의를 고침. 2026-11-14 중간 묶음과 Codex 후속(SPEC-016·065·073)으로 다시 고치고 SPEC-076~079를 더함, 2026-11-15 M8로 뒤 단계 결정을 SPEC 행에 되돌림(spec.md 8절), 낮음 K2로 SPEC-018에 고지한 처리방침 버전을 남김, 동희님 결정 반영으로 SPEC-022·023·029·030·077에 결제 기다림 주문 한도 | SPEC-001~079의 데이터, 상태 머신 1-1~1-8, 공통 규칙 G1~G9, 요구사항 해석 R2~R21, AI-1 |
| [`docs/02-prd/requirements.md`](../02-prd/requirements.md) | 05단계를 확정했을 때는 버전 3(REQ-001~163, 유효한 161), 커밋 ddb9c85. 지금은 버전 5(REQ-001~266, 유효한 235). 2026-11-15 동희님 결정 반영으로 REQ-263~265를 `shops.awaiting_payment_limit`과 에스컬레이션 건의 한도 컬럼에 넣음(REQ-266은 앱의 모델 호출 구조라 테이블을 바꾸지 않음, 11절). 2026-11-15 낮음 K2에서 K1이 더한 REQ-255~262를 이 스키마와 다시 대조하고, K1이 바꾼 번호(REQ-033→258, REQ-118→259, REQ-183→260)를 컬럼 설명에서 새 번호로 고침(11절) | 컬럼 설명과 제약에 단 REQ 번호 |
| [`docs/01-domain/domain.md`](../01-domain/domain.md) | 커밋 dc7dfae. 2026-11-15 설계 재검토 M8로 3-8절(요구사항 버전 2~5 되돌림)이 더해졌고 CTX·TERM 번호는 그대로. 낮음 K1로 7-5절 용어 TERM-075~086이 더해져 그 번호를 컬럼·테이블 설명에 더함(11절) | CTX-001~009, TERM-001~086과 이름, 애그리거트 규칙(3-1), 읽기 모델(5-2) |
| [`docs/03-user-flow/`](../03-user-flow/) | FL-001~014, 커밋 ddb9c85. 2026-11-13 FL-001·002·003·004·005·006·008·009·010·011·012·014를 고침 | 플로우의 순서(한 트랜잭션으로 써야 하는 곳) |

| 만든 것 | 무엇 |
| --- | --- |
| [`db/schema.sql`](../../db/schema.sql) | 원본 DDL. 테이블마다 `-- TBL-번호 이름 (컨텍스트) ← SPEC 목록 \| terms: 용어` 헤더 주석과 TBL 번호로 시작하는 테이블 설명, 컬럼마다 설명 |
| [`db/migrations/0001_init.sql`](../../db/migrations/0001_init.sql) | 첫 마이그레이션(확정할 때의 `schema.sql` 사본). 한 번 적용한 뒤에는 고치지 않고 0002부터 더함 |
| [`db/migrations/0002_refund_path.sql`](../../db/migrations/0002_refund_path.sql) | 환불 길(설계 재검토 H1·H2)의 바꿈(11절). 0001 위에 적용하면 `schema.sql`과 같은 카탈로그(D2) |
| [`db/migrations/0003_order_input_lock.sql`](../../db/migrations/0003_order_input_lock.sql) | 주문자 정보 카드와 잠금 번호(설계 재검토 H11·H12)의 바꿈(11절) |
| [`db/migrations/0004_kakao_event_path.sql`](../../db/migrations/0004_kakao_event_path.sql) | 카카오 먼저 보내기 길과 버튼 블록 ID(설계 재검토 H7·H8)의 바꿈(11절) |
| [`db/migrations/0005_retention_split.sql`](../../db/migrations/0005_retention_split.sql) | 보관과 지우기(설계 재검토 H3)의 바꿈: 상담 끝남, 주문이 끝난 시각, 보관 기록 테이블(11절) |
| [`db/migrations/0006_account_encryption_access_log.sql`](../../db/migrations/0006_account_encryption_access_log.sql) | 계좌번호 암호문, 원래 값을 두지 않는 번호, 예금주 확인, 접속기록 테이블과 트리거(설계 재검토 H4)의 바꿈(11절) |
| [`db/migrations/0007_consent_allergy_photo.sql`](../../db/migrations/0007_consent_allergy_photo.sql) | 알레르기 정보 동의의 답·동의 글 버전·시각, 알레르기 답 블록, 사진마다 게시 동의와 동의가 살아 있는 포트폴리오(설계 재검토 H5·H10)의 바꿈(11절) |
| [`db/migrations/0008_wait_ends_due_cap.sql`](../../db/migrations/0008_wait_ends_due_cap.sql) | 사장님 답 기다림의 끝, 결제 기한의 시작과 상한, 그날 자리 세기, 주문 상태와 제작 행의 짝(설계 재검토 M1·M2·M3·M9·M10)의 바꿈(11절) |
| [`db/migrations/0009_refund_excess_file_queue.sql`](../../db/migrations/0009_refund_excess_file_queue.sql) | 더 들어온 금액의 환불 계산값과 환불 금액 상한, 지울 사진 파일 테이블, 운영자가 여는 상담의 대화 글(Codex 후속)의 바꿈(11절) |
| [`db/migrations/0010_refund_calc_remake.sql`](../../db/migrations/0010_refund_calc_remake.sql) | 금액이 내려간 변경의 차액 돌려주기, 재제작 주문이 돈을 낸 원래 주문을 가리킴과 재제작 주문의 결제 안내·환불·장부 행 막기, 끝나지 않은 재제작 주문이 있는 원래 주문을 끝내지 않기(Codex 의견), 환불 계산의 차례를 적은 설명(설계 재검토 M4·M13)의 바꿈(11절) |
| [`db/migrations/0011_amount_confirm_standard_quote.sql`](../../db/migrations/0011_amount_confirm_standard_quote.sql) | 손님의 새 금액 확인(결제 안내의 확인 필요·확인한 시각·받지 않은 시각·누른 카드), 차액을 기다리는 날짜 변경의 잡힌 자리와 확정된 자리, 닿을 수 없던 오래된 버전 변경 상태와 할 일 빼기, 기본 디자인 범위의 옵션과 견적(설계 재검토 M5·M6)의 바꿈(11절) |
| [`db/migrations/0012_request_keys_questions_extras.sql`](../../db/migrations/0012_request_keys_questions_extras.sql) | 화면 요청 키의 요청 지문·처리 상태·처음 결과, 환불의 취소한 주문과 대상마다 하나, 주문을 확정한 결제, 덧붙은 질문과 날짜마다의 마감된 날 질문 건·추가 수락을 쓴 주문 요청, 초안의 픽업 날짜와 시각, 더하는 옵션 연결 테이블과 (상담, 손님) 쌍 외래 키(설계 재검토 M7·M17)의 바꿈(11절) |
| [`db/migrations/0013_ai_calls_skill_keys.sql`](../../db/migrations/0013_ai_calls_skill_keys.sql) | AI 호출의 차례 안 순번(위 끝 없음)과 다시 한 종류, 호출 상한 이유, 연결마다 스킬 키 버전·앞 버전 키를 받는 끝, '연결 확인 중' 선점이 풀리는 시각(설계 재검토 M16·M18)의 바꿈(11절). 0001~0013을 차례로 적용하면 `schema.sql`과 같은 카탈로그(D2) |
| [`db/schema.erd.json`](../../db/schema.erd.json) | ERD Editor 다이어그램. 컨텍스트마다 색 그룹, 맨 위 메모 |
| [`research/cake-erd-2026-11/`](../../research/cake-erd-2026-11/) | `build_erd.py`(헤더 주석 SPEC 목록·컬럼 설명·이 문서의 표와 다이어그램을 만듦), `erd_map.py`(SPEC → 테이블.컬럼 대응), `check_erd.py`(검사), `rule_tests.sql`(규칙 테스트와 지우기를 돌려 남는 것), `erd_editor_build.py`(ERD Editor 다이어그램 만들기와 견주기), `erd_editor_sync.py`(마이그레이션 0002부터의 바꿈을 ERD Editor 편집 도구로 다이어그램에 옮김) |

다시 만들고 검사하는 법(저장소 맨 위에서):

```sh
python3 -B research/cake-erd-2026-11/build_erd.py . --write
python3 -B research/cake-erd-2026-11/erd_editor_sync.py . --write
python3 -B research/cake-erd-2026-11/check_erd.py . --db "host=… port=… user=…"
python3 -B research/cake-erd-2026-11/erd_editor_build.py . --compare --db "host=… port=… user=…"
```

`check_erd.py`의 `--db`는 검사용 PostgreSQL 서버입니다. 검사용 DB(`erd_check_*`)를 만들고 끝나면 지우니 운영 서버에는 쓰지 않습니다.

## 3. 테이블과 다이어그램

### 3-1. 이름과 형식을 정한 방식

- 이름은 영어 snake_case, 테이블은 복수형이고 용어집의 코드 이름에서 땄습니다. 상태 값도 영어로 두고 한국어 이름은 컬럼 설명에 적었습니다.
- 기본 키는 모두 uuid입니다. 손님에게 보이는 번호는 주문번호(`orders.order_no`, 무작위) 하나뿐입니다(G6).
- 시각은 `timestamptz`(UTC로 저장, 계산은 가게 시간대, G8), 날짜만 쓰는 자리·목록은 가게 시간대의 `date`입니다. 돈은 원 단위 정수입니다.
- 외래 키는 모두 `ON DELETE RESTRICT`입니다. 기록은 지우기 작업(6절)이 딸린 행부터 직접 지웁니다.
- 이전 버전(가격표·운영규정·주문 내용·후기)은 지우지 않고 행으로 남깁니다(REQ-027).
- 시크릿(토큰·키·비밀번호)은 어느 테이블에도 없고 시크릿 저장소의 이름만 둡니다(REQ-135).

### 3-2. 테이블 목록

'읽고 쓰는 SPEC'은 `erd_map.py` 대응에서 만듭니다. 테이블 순서는 만드는 순서(참조되는 테이블이 먼저)라 컨텍스트가 섞입니다.

<!-- build_erd:tables:begin -->
| TBL | 테이블 | 이름 | 컨텍스트 | 읽고 쓰는 SPEC | 용어 |
| --- | --- | --- | --- | --- | --- |
| TBL-001 | `owners` | 사장님 | CTX-007 | 001, 067 | TERM-044 |
| TBL-002 | `operators` | 운영자 | CTX-007 | 001, 003, 078 | TERM-074 |
| TBL-003 | `shops` | 가게 | CTX-007 | 001, 002, 003, 006, 009, 010, 011, 017, 024, 025, 029, 030, 036, 052, 053, 068, 073, 077, 078 | TERM-053 |
| TBL-004 | `kakao_channels` | 카카오톡 채널 연결 | CTX-007 | 008, 010, 011, 017, 066, 068, 075 | TERM-053 |
| TBL-005 | `privacy_policies` | 가게 개인정보 처리방침 | CTX-007 | 010, 011, 018 | 없음 |
| TBL-006 | `price_lists` | 가격표 버전 | CTX-002 | 004, 010, 011, 013, 027 | TERM-047 |
| TBL-007 | `price_options` | 가격표 옵션 | CTX-002 | 004, 011, 013 | TERM-047 |
| TBL-008 | `price_option_rules` | 옵션 규칙 | CTX-002 | 004, 013 | TERM-047 |
| TBL-009 | `designs` | 도안 | CTX-002 | 004, 011, 013 | TERM-020 |
| TBL-010 | `operating_rules` | 운영규정 버전 | CTX-002 | 005, 010, 013, 016, 029, 032, 040, 041, 042, 043, 058, 079 | TERM-017 |
| TBL-011 | `rule_clauses` | 운영규정 조문 | CTX-002 | 005, 016, 026, 028, 041, 046, 047, 048 | TERM-017 |
| TBL-012 | `refund_tiers` | 단계별 환불 | CTX-002 | 005, 016, 040 | TERM-017 |
| TBL-013 | `business_calendars` | 영업 캘린더 설정 | CTX-002 | 007, 010, 011, 012, 014, 024, 052, 061 | TERM-048 |
| TBL-014 | `calendar_days` | 영업 캘린더 날짜 행 | CTX-002 | 007, 011, 012, 014, 015 | TERM-048 |
| TBL-015 | `payment_accounts` | 결제 수단 | CTX-004 | 003, 006, 010, 032, 078 | 없음 |
| TBL-016 | `customers` | 손님 | CTX-001 | 017, 022, 029, 040, 065, 066, 068, 069 | TERM-043 |
| TBL-017 | `consultations` | 상담 | CTX-001 | 017, 018, 022, 023, 025, 029, 065, 068, 073 | TERM-046 |
| TBL-018 | `messages` | 상담 대화 | CTX-001 | 017, 018, 019, 020, 021, 022, 065, 066, 073 | TERM-046 |
| TBL-019 | `masked_values` | 마스킹 원본 값 | CTX-001 | 021, 022, 049, 065, 068, 073 | 없음 |
| TBL-020 | `order_drafts` | 주문서 초안 | CTX-001 | 013, 019, 020, 025, 027, 028, 029, 065, 072, 075 | TERM-003, TERM-057 |
| TBL-021 | `reference_photos` | 참고 사진 | CTX-001 | 013, 019, 031, 065 | TERM-019 |
| TBL-022 | `quotes` | 견적 | CTX-001 | 013, 020, 025, 027, 028, 031, 032, 065, 076 | TERM-013, TERM-058 |
| TBL-023 | `orders` | 주문 | CTX-003 | 013, 016, 024, 025, 029, 030, 031, 034, 036, 037, 038, 039, 040, 041, 042, 045, 046, 047, 048, 050, 052, 054, 055, 056, 059, 060, 061, 062, 064, 065, 068, 070, 073, 076, 079 | TERM-001 |
| TBL-024 | `confirm_cards` | 손님 확인 카드 | CTX-001 | 028, 029, 033, 040, 041, 046, 053, 057, 058, 063, 065, 069, 072, 075, 076 | 없음 |
| TBL-025 | `change_requests` | 변경 요청 | CTX-003 | 024, 035, 041, 042, 043, 044, 045, 046, 048, 065, 070, 076 | TERM-001 |
| TBL-026 | `order_details` | 주문 내용 | CTX-003 | 016, 029, 031, 033, 040, 045, 050, 054, 059, 060, 064, 065, 073, 076 | TERM-004 |
| TBL-027 | `handoffs` | 에스컬레이션 건 | CTX-001 | 014, 015, 017, 020, 021, 022, 023, 024, 025, 026, 029, 030, 040, 053, 056, 065, 079 | TERM-008, TERM-018 |
| TBL-028 | `issue_details` | 신고 내용 | CTX-001 | 057, 058, 059, 065, 079 | TERM-032 |
| TBL-029 | `issue_photos` | 신고 사진 | CTX-001 | 057, 059, 065 | TERM-032 |
| TBL-030 | `issue_reports` | 문제 신고 | CTX-003 | 058, 059, 060, 061, 065, 079 | TERM-031 |
| TBL-031 | `payment_requests` | 결제 안내 | CTX-004 | 006, 015, 016, 024, 029, 030, 031, 032, 033, 034, 035, 036, 037, 038, 039, 042, 043, 044, 046, 047, 048, 059, 065, 066, 068, 070, 071, 076 | TERM-049 |
| TBL-032 | `payments` | 확인된 결제 | CTX-004 | 016, 034, 035, 036, 040, 043, 046, 047, 059, 070 | TERM-049, TERM-014 |
| TBL-033 | `refunds` | 환불 | CTX-004 | 016, 035, 036, 040, 045, 046, 047, 048, 049, 059, 065, 070, 071, 073 | TERM-049 |
| TBL-034 | `slot_holds` | 그날 자리 | CTX-002 | 011, 012, 014, 015, 029, 030, 031, 033, 035, 036, 037, 038, 042, 043, 044, 045, 046, 048, 060, 070, 076 | TERM-007 |
| TBL-035 | `productions` | 제작 | CTX-005 | 016, 036, 045, 050, 051, 053, 054, 055, 058, 060, 061, 070 | TERM-050 |
| TBL-036 | `production_undos` | 제작 표시 되돌린 기록 | CTX-005 | 051 | TERM-050 |
| TBL-037 | `completion_photos` | 완성 사진 | CTX-005 | 011, 053, 063 | TERM-050 |
| TBL-038 | `reviews` | 후기 | CTX-006 | 062 | TERM-051 |
| TBL-039 | `review_photos` | 후기 사진 | CTX-006 | 011, 062, 063 | TERM-051 |
| TBL-040 | `photo_consents` | 사진 게시 동의 | CTX-006 | 053, 062, 063 | TERM-051 |
| TBL-041 | `portfolio_items` | 포트폴리오 | CTX-006 | 011, 063 | TERM-052 |
| TBL-042 | `owner_tasks` | 사장님 할 일 | CTX-008 | 003, 007, 022, 023, 024, 029, 031, 033, 034, 035, 036, 037, 041, 042, 045, 046, 047, 048, 049, 058, 059, 064, 065, 067, 071, 077, 079 | TERM-059 |
| TBL-043 | `owner_alerts` | 사장님 알림 | CTX-008 | 003, 006, 022, 024, 044, 046, 048, 050, 057, 058, 064, 065, 067, 076, 078 | TERM-035 |
| TBL-044 | `notifications` | 알림 | CTX-008 | 022, 023, 024, 029, 031, 032, 035, 036, 039, 042, 044, 045, 047, 048, 052, 053, 059, 061, 065, 066, 070 | TERM-054 |
| TBL-045 | `ledger_links` | 장부 연결 | CTX-009 | 009, 064 | TERM-028 |
| TBL-046 | `ledger_rows` | 장부 행 | CTX-009 | 060, 064 | TERM-055 |
| TBL-047 | `ledger_writes` | 장부 쓰기 | CTX-009 | 009, 036, 039, 045, 046, 047, 048, 054, 055, 060, 064, 070, 076 | TERM-055 |
| TBL-048 | `ai_calls` | AI 호출 기록 | CTX-001 | 017, 020, 021, 068, 077 | TERM-045 |
| TBL-049 | `ai_tool_calls` | AI 도구 호출 기록 | CTX-001 | 013, 014, 020, 021, 026, 040, 065 | 없음 |
| TBL-050 | `request_keys` | 요청 키 | 공통 | 002, 003, 004, 005, 007, 031, 034, 038, 039, 042, 047, 048, 051, 054, 059, 065, 070, 071, 077, 078, 079 | 없음 |
| TBL-051 | `ops_events` | 운영 기록 | 공통 | 008, 010, 017, 029, 065 | 없음 |
| TBL-052 | `kept_records` | 보관 기록 | CTX-003 | 065, 073 | 없음 |
| TBL-053 | `access_logs` | 접속기록 | 공통 | 065, 073, 074 | 없음 |
| TBL-054 | `file_deletions` | 지울 파일 | 공통 | 065 | 없음 |
| TBL-055 | `handoff_questions` | 덧붙은 질문 | CTX-001 | 022, 023, 065 | TERM-008 |
| TBL-056 | `order_draft_extras` | 초안의 더하는 옵션 | CTX-001 | 013, 065 | TERM-003 |
| TBL-057 | `order_detail_extras` | 주문 내용의 더하는 옵션 | CTX-003 | 029, 050 | TERM-004 |
| TBL-058 | `shop_identity_changes` | 사업자 정보 변경 요청 | CTX-007 | 078 | TERM-053 |
| TBL-059 | `operator_sessions` | 운영자 세션 | CTX-007 | 001 | 없음 |
| TBL-060 | `operator_login_failures` | 운영자 로그인 실패 | CTX-007 | 001 | 없음 |
| TBL-061 | `owner_sessions` | 사장님 세션 | CTX-007 | 001 | 없음 |
<!-- build_erd:tables:end -->

### 3-3. 컨텍스트별 다이어그램

전체 다이어그램은 ERD Editor에서 봅니다. 아래는 컨텍스트마다 키와 상태 열만 보이는 요약입니다.

<!-- build_erd:diagrams:begin -->
### 컨텍스트 사이 (화살표: 참조하는 쪽 → 참조되는 쪽, 숫자는 외래 키 수)

```mermaid
flowchart LR
  C0["CTX-001 상담<br/>테이블 15개"]
  C1["CTX-002 가게 규칙<br/>테이블 10개"]
  C2["CTX-003 주문<br/>테이블 6개"]
  C3["CTX-004 결제·환불<br/>테이블 4개"]
  C4["CTX-005 제작·전달<br/>테이블 3개"]
  C5["CTX-006 후기·포트폴리오<br/>테이블 4개"]
  C6["CTX-007 가게 등록·연결<br/>테이블 9개"]
  C7["CTX-008 알림<br/>테이블 3개"]
  C8["CTX-009 장부 연결<br/>테이블 3개"]
  C9["공통<br/>테이블 4개"]
  C0 -->|8| C1
  C0 -->|6| C2
  C0 -->|2| C6
  C1 -->|1| C2
  C1 -->|1| C3
  C1 -->|4| C6
  C2 -->|8| C0
  C2 -->|8| C1
  C2 -->|1| C3
  C3 -->|2| C0
  C3 -->|7| C2
  C3 -->|2| C6
  C4 -->|1| C2
  C5 -->|2| C2
  C5 -->|2| C4
  C7 -->|3| C0
  C7 -->|4| C2
  C7 -->|2| C3
  C8 -->|1| C2
  C8 -->|1| C6
  C9 -->|5| C6
```

### CTX-001 상담

테이블: TBL-016 `customers`, TBL-017 `consultations`, TBL-018 `messages`, TBL-019 `masked_values`, TBL-020 `order_drafts`, TBL-021 `reference_photos`, TBL-022 `quotes`, TBL-024 `confirm_cards`, TBL-027 `handoffs`, TBL-028 `issue_details`, TBL-029 `issue_photos`, TBL-048 `ai_calls`, TBL-049 `ai_tool_calls`, TBL-055 `handoff_questions`, TBL-056 `order_draft_extras`. 컬럼은 기본 키(PK)·외래 키(FK)와 상태·종류·버전·금액만 보입니다. 다른 컨텍스트의 테이블은 이름만 나옵니다.

```mermaid
erDiagram
  customers {
    uuid id PK "손님 ID"
    uuid kakao_channel_id FK "메시지를 보낸 가게 채널"
  }
  consultations {
    uuid id PK "상담 ID"
    uuid customer_id FK "손님"
    text status "열림·사장님 답 기다림·문의…"
    int ai_disclosed_policy_version FK "AI 상담 고지를 보낸 때…"
  }
  messages {
    uuid id PK "메시지 ID"
    uuid consultation_id FK "상담"
    text kind "글·사진·확인 카드·받지 않는…"
  }
  masked_values {
    uuid id PK "마스킹한 값 ID"
    uuid consultation_id FK "상담"
    text kind "전화번호·계좌번호·카드번호…"
  }
  order_drafts {
    uuid id PK "초안 ID"
    uuid consultation_id FK "상담"
    text status "채우는 중·주문 요청됨"
    uuid price_list_id FK "옵션을 고른 가격표 버전"
    uuid size_option_id FK "크기"
    uuid flavor_option_id FK "맛"
    uuid design_option_id FK "디자인 옵션"
    uuid design_id FK "고른 도안"
  }
  reference_photos {
    uuid id PK "사진 ID"
    uuid draft_id FK "붙인 주문서 초안"
    uuid message_id FK "사진이 온 메시지"
  }
  quotes {
    uuid id PK "견적 ID"
    uuid draft_id FK "계산한 주문서 초안"
    uuid price_list_id FK "계산한 가격표 버전"
    uuid operating_rules_id FK "유효 기한을 정한 운영규정…"
    int amount "금액"
  }
  confirm_cards {
    uuid id PK "카드 ID"
    uuid consultation_id FK "카드를 보낸 상담"
    uuid customer_id FK "카드를 받은 사용자"
    text kind "주문 요청·입금 알리기"
    uuid draft_id FK "주문 요청·주문자 정보…"
    uuid order_id FK "대상 주문"
  }
  handoffs {
    uuid id PK "에스컬레이션 건 ID"
    uuid consultation_id FK "상담"
    uuid source_message_id FK "에스컬레이션한 손님 말"
    uuid order_id FK "관련 주문"
    text status "열림·답함·답 없어 닫힘"
    uuid day_used_order_id FK "추가 수락을 쓴 주문 요청"
    uuid limit_used_order_id FK "한도 넘겨 받기를 쓴 주문…"
  }
  issue_details {
    uuid id PK "신고 내용 ID"
    uuid consultation_id FK "상담"
    uuid order_id FK "받은 주문"
    text status "모으는 중·신고됨·그만둠"
  }
  issue_photos {
    uuid id PK "신고 사진 ID"
    uuid issue_details_id FK "신고 내용"
    uuid message_id FK "사진이 온 메시지"
  }
  ai_calls {
    uuid id PK "AI 호출 ID"
    uuid consultation_id FK "대화 ID"
  }
  ai_tool_calls {
    uuid id PK "도구 호출 ID"
    uuid ai_call_id FK "도구를 호출한 AI 호출"
    uuid consultation_id FK "대화 ID"
  }
  handoff_questions {
    uuid id PK "덧붙은 질문 ID"
    uuid handoff_id FK "덧붙은 열린 에스컬레이션 건"
    uuid message_id FK "덧붙은 손님 말"
    uuid order_id FK "관련 주문"
  }
  order_draft_extras {
    uuid draft_id PK, FK "주문서 초안"
    uuid price_list_id FK "초안의 가격표 버전"
    uuid option_id PK, FK "더한 옵션"
    text option_group FK "늘 '더하는 옵션'"
  }
  kakao_channels ||--o{ customers : "kakao_channel_id"
  customers ||--o{ consultations : "customer_id"
  privacy_policies |o--o{ consultations : "ai_disclosed_policy_version"
  consultations ||--o{ messages : "consultation_id"
  consultations ||--o{ masked_values : "consultation_id"
  consultations ||--o{ order_drafts : "consultation_id"
  price_lists |o--o{ order_drafts : "price_list_id"
  price_options |o--o{ order_drafts : "price_list_id_size_option_id"
  designs |o--o{ order_drafts : "price_list_id_design_id"
  order_drafts ||--o{ reference_photos : "draft_id"
  messages ||--o{ reference_photos : "message_id"
  order_drafts ||--o{ quotes : "draft_id"
  price_lists ||--o{ quotes : "price_list_id"
  operating_rules ||--o{ quotes : "operating_rules_id"
  consultations ||--o{ confirm_cards : "consultation_id_customer_id"
  customers ||--o{ confirm_cards : "customer_id"
  order_drafts |o--o{ confirm_cards : "draft_id"
  orders |o--o{ confirm_cards : "order_id"
  consultations ||--o{ handoffs : "consultation_id"
  messages ||--o| handoffs : "source_message_id"
  orders |o--o{ handoffs : "order_id"
  orders |o--o| handoffs : "day_used_order_id"
  orders |o--o| handoffs : "limit_used_order_id"
  consultations ||--o{ issue_details : "consultation_id"
  orders |o--o{ issue_details : "order_id"
  issue_details ||--o{ issue_photos : "issue_details_id"
  messages |o--o{ issue_photos : "message_id"
  consultations ||--o{ ai_calls : "consultation_id"
  ai_calls ||--o{ ai_tool_calls : "ai_call_id"
  consultations ||--o{ ai_tool_calls : "consultation_id"
  handoffs ||--o{ handoff_questions : "handoff_id"
  messages ||--o| handoff_questions : "message_id"
  orders |o--o{ handoff_questions : "order_id"
  order_drafts ||--o{ order_draft_extras : "draft_id_price_list_id"
  price_options ||--o{ order_draft_extras : "price_list_id"
```

### CTX-002 가게 규칙

테이블: TBL-006 `price_lists`, TBL-007 `price_options`, TBL-008 `price_option_rules`, TBL-009 `designs`, TBL-010 `operating_rules`, TBL-011 `rule_clauses`, TBL-012 `refund_tiers`, TBL-013 `business_calendars`, TBL-014 `calendar_days`, TBL-034 `slot_holds`. 컬럼은 기본 키(PK)·외래 키(FK)와 상태·종류·버전·금액만 보입니다. 다른 컨텍스트의 테이블은 이름만 나옵니다.

```mermaid
erDiagram
  price_lists {
    uuid id PK "가격표 버전 ID"
    uuid shop_id FK "가격표의 가게"
    int version "버전"
  }
  price_options {
    uuid id PK "옵션 ID"
    uuid price_list_id FK "가격표 버전"
    int amount "값"
  }
  price_option_rules {
    uuid id PK "옵션 규칙 ID"
    uuid price_list_id FK "가격표 버전"
    uuid option_a_id FK "옵션 하나"
    uuid option_b_id FK "다른 옵션"
    int amount "더하는 값"
  }
  designs {
    uuid id PK "도안 ID"
    uuid price_list_id FK "이 도안을 담은 가격표 버전"
    uuid price_option_id FK "이 도안의 값을 정하는 디자인…"
  }
  operating_rules {
    uuid id PK "운영규정 버전 ID"
    uuid shop_id FK "가게"
    int version "버전"
  }
  rule_clauses {
    uuid id PK "조문 ID"
    uuid operating_rules_id FK "운영규정 버전"
  }
  refund_tiers {
    uuid id PK "단계 ID"
    uuid operating_rules_id FK "운영규정 버전"
  }
  business_calendars {
    uuid shop_id PK, FK "가게"
  }
  calendar_days {
    uuid shop_id PK, FK "가게"
    date day PK "가게 시간대의 날짜"
  }
  slot_holds {
    uuid id PK "자리 ID"
    date day FK "자리의 날짜"
    uuid order_id FK "자리를 가진 주문"
    uuid payment_request_id FK "잡힘이면 그 결제 안내"
    text status "가예약됨·확정됨·해제됨·종료됨"
  }
  shops ||--o{ price_lists : "shop_id"
  price_lists ||--o{ price_options : "price_list_id"
  price_lists ||--o{ price_option_rules : "price_list_id"
  price_options ||--o{ price_option_rules : "price_list_id_option_a_id"
  price_lists ||--o{ designs : "price_list_id"
  price_options |o--o{ designs : "price_list_id_price_option_id"
  shops ||--o{ operating_rules : "shop_id"
  operating_rules ||--o{ rule_clauses : "operating_rules_id"
  operating_rules ||--o{ refund_tiers : "operating_rules_id"
  shops ||--o| business_calendars : "shop_id"
  shops ||--o{ calendar_days : "shop_id"
  calendar_days ||--o{ slot_holds : "day"
  orders ||--o{ slot_holds : "order_id"
  payment_requests |o--o{ slot_holds : "payment_request_id"
```

### CTX-003 주문

테이블: TBL-023 `orders`, TBL-025 `change_requests`, TBL-026 `order_details`, TBL-030 `issue_reports`, TBL-052 `kept_records`, TBL-057 `order_detail_extras`. 컬럼은 기본 키(PK)·외래 키(FK)와 상태·종류·버전·금액만 보입니다. 다른 컨텍스트의 테이블은 이름만 나옵니다.

```mermaid
erDiagram
  orders {
    uuid id PK, FK "주문 ID"
    text order_no "주문번호"
    uuid customer_id FK "요청한 카카오 사용자"
    uuid consultation_id FK "요청한 상담"
    uuid draft_id FK "요청한 주문서 초안"
    text kind "기본 디자인 주문"
    text status "주문 요청됨·결제 기다림·결제…"
    int version FK "주문 내용의 지금 버전"
    uuid price_list_id FK "금액을 계산한 가격표 버전"
    uuid operating_rules_id FK "동의한 운영규정 버전"
    timestamptz pickup_at FK "픽업 일시"
    int amount FK "현재 버전의 금액"
    uuid confirmed_payment_id FK "주문을 확정한 확인된 결제"
    uuid remake_of_order_id FK "재제작"
  }
  change_requests {
    uuid id PK "변경 요청 ID"
    uuid order_id FK "바꾸려는 주문"
    uuid card_id FK "손님이 누른 변경 요청 카드"
    text status "요청됨·차액 결제 기다림"
  }
  order_details {
    uuid id PK "주문 내용 버전 ID"
    uuid order_id FK "주문"
    int version "버전"
    uuid change_request_id FK "변경 반영으로 생긴 버전의…"
    uuid quote_id FK "요청 때 쓴 견적"
    uuid price_list_id FK "옵션의 가격표 버전"
    uuid size_option_id FK "크기"
    uuid flavor_option_id FK "맛"
    uuid design_option_id FK "디자인 옵션"
    uuid design_id FK "도안"
    int amount "이 버전의 금액"
  }
  issue_reports {
    uuid id PK "문제 신고 ID"
    uuid order_id FK "받은 주문"
    uuid issue_details_id FK "모은 신고 내용"
    uuid card_id FK "손님이 누른 신고 카드"
    uuid follows_report_id FK "같은 주문의 두 번째 신고면…"
    text status "신고됨·보상 정해짐·닫힘"
    uuid remake_order_id FK "재제작 주문"
    uuid handoff_id FK "사장님이 남긴 신고의…"
  }
  kept_records {
    uuid id PK "보관 기록 ID"
    uuid order_id FK "보관 기록이 된 주문"
  }
  order_detail_extras {
    uuid order_detail_id PK, FK "주문 내용 버전"
    uuid price_list_id FK "그 버전의 가격표 버전"
    uuid option_id PK, FK "더한 옵션"
    text option_group FK "늘 '더하는 옵션'"
  }
  customers ||--o{ orders : "customer_id"
  consultations ||--o{ orders : "consultation_id_customer_id"
  order_drafts |o--o| orders : "draft_id"
  price_lists ||--o{ orders : "price_list_id"
  operating_rules ||--o{ orders : "operating_rules_id"
  orders |o--o{ orders : "remake_of_order_id"
  order_details ||--o| orders : "current_version"
  payments |o--o| orders : "id_confirmed_payment_id"
  orders ||--o{ change_requests : "order_id"
  confirm_cards ||--o| change_requests : "card_id"
  orders ||--o{ order_details : "order_id"
  change_requests |o--o| order_details : "change_request_id"
  quotes |o--o{ order_details : "quote_id"
  price_lists ||--o{ order_details : "price_list_id"
  price_options |o--o{ order_details : "price_list_id_size_option_id"
  designs |o--o{ order_details : "price_list_id_design_id"
  orders ||--o{ issue_reports : "order_id"
  issue_details ||--o| issue_reports : "issue_details_id"
  confirm_cards |o--o| issue_reports : "card_id"
  issue_reports |o--o{ issue_reports : "follows_report_id"
  orders |o--o| issue_reports : "remake_order_id"
  handoffs |o--o| issue_reports : "handoff_id_order_id"
  orders ||--o| kept_records : "order_id"
  order_details ||--o{ order_detail_extras : "order_detail_id_price_list_id"
  price_options ||--o{ order_detail_extras : "price_list_id"
```

### CTX-004 결제·환불

테이블: TBL-015 `payment_accounts`, TBL-031 `payment_requests`, TBL-032 `payments`, TBL-033 `refunds`. 컬럼은 기본 키(PK)·외래 키(FK)와 상태·종류·버전·금액만 보입니다. 다른 컨텍스트의 테이블은 이름만 나옵니다.

```mermaid
erDiagram
  payment_accounts {
    uuid id PK "결제 수단 ID"
    uuid shop_id FK "가게"
    uuid holder_checked_by FK "영업 신고를 확인하며 예금주가…"
  }
  payment_requests {
    uuid id PK "결제 안내 ID"
    uuid order_id FK "주문"
    text kind "첫 결제·다시 낸 결제"
    uuid change_request_id FK "차액 결제의 변경 요청"
    text status "나감·확인 요청됨"
    int version "비교해 쓰는 번호"
    int amount "안내 금액"
    uuid amount_card_id FK "손님이 누른 새 금액 확인…"
    uuid payment_account_id FK "이 안내에 포함한 가게 계좌"
    uuid claim_card_id FK "손님이 누른 입금 알리기 카드"
  }
  payments {
    uuid id PK "확인된 결제 ID"
    uuid order_id FK "주문"
    uuid payment_request_id FK "확인한 결제 안내"
    int amount FK "확인된 금액 = 안내 금액"
  }
  refunds {
    uuid id PK "환불 ID"
    uuid order_id FK "주문"
    uuid change_request_id FK "금액이 내려간 변경"
    uuid issue_report_id FK "보상의 문제 신고"
    uuid payment_request_id FK "돌려줄 들어온 입금의 결제…"
    uuid cancelled_order_id FK "취소 환불"
    int amount "정한 환불 금액"
  }
  shops ||--o{ payment_accounts : "shop_id"
  operators |o--o{ payment_accounts : "holder_checked_by"
  orders ||--o{ payment_requests : "order_id"
  change_requests |o--o{ payment_requests : "change_request_id"
  payment_accounts ||--o{ payment_requests : "payment_account_id"
  confirm_cards |o--o{ payment_requests : "claim_card_id"
  confirm_cards |o--o{ payment_requests : "amount_card_id"
  orders ||--o{ payments : "order_id"
  payment_requests ||--o{ payments : "payment_request_id"
  orders ||--o{ refunds : "order_id"
  change_requests |o--o| refunds : "change_request_id"
  issue_reports |o--o| refunds : "issue_report_id"
  payment_requests |o--o{ refunds : "payment_request_id"
  orders |o--o| refunds : "cancelled_order_id"
```

### CTX-005 제작·전달

테이블: TBL-035 `productions`, TBL-036 `production_undos`, TBL-037 `completion_photos`. 컬럼은 기본 키(PK)·외래 키(FK)와 상태·종류·버전·금액만 보입니다. 다른 컨텍스트의 테이블은 이름만 나옵니다.

```mermaid
erDiagram
  productions {
    uuid id PK "제작 ID"
    uuid order_id FK "확정된 주문"
  }
  production_undos {
    uuid id PK "되돌림 ID"
    uuid production_id FK "제작"
  }
  completion_photos {
    uuid id PK "완성 사진 ID"
    uuid production_id FK "제작"
  }
  orders ||--o| productions : "order_id"
  productions ||--o{ production_undos : "production_id"
  productions ||--o{ completion_photos : "production_id"
```

### CTX-006 후기·포트폴리오

테이블: TBL-038 `reviews`, TBL-039 `review_photos`, TBL-040 `photo_consents`, TBL-041 `portfolio_items`. 컬럼은 기본 키(PK)·외래 키(FK)와 상태·종류·버전·금액만 보입니다. 다른 컨텍스트의 테이블은 이름만 나옵니다.

```mermaid
erDiagram
  reviews {
    uuid id PK "후기 버전 ID"
    uuid order_id FK "받은 주문"
    int version "고치면 새 버전"
  }
  review_photos {
    uuid id PK "후기 사진 ID"
    uuid review_id FK "후기 버전"
  }
  photo_consents {
    uuid id PK "게시 동의 ID"
    uuid order_id FK "주문"
    uuid completion_photo_id FK "완성 사진의 동의면 그 사진"
    uuid review_photo_id FK "후기 사진의 동의면 그 사진"
  }
  portfolio_items {
    uuid id PK "포트폴리오 항목 ID"
    uuid photo_consent_id FK "근거가 되는 게시 동의"
    uuid review_photo_id FK "올린 후기 사진"
    uuid completion_photo_id FK "올린 완성 사진"
    bool consent_live FK "올라 있는 동안 참"
  }
  orders ||--o{ reviews : "order_id"
  reviews ||--o{ review_photos : "review_id"
  orders ||--o{ photo_consents : "order_id"
  review_photos |o--o{ photo_consents : "review_photo_id"
  completion_photos |o--o{ photo_consents : "completion_photo_id"
  photo_consents ||--o{ portfolio_items : "photo_consent_id"
  review_photos |o--o{ portfolio_items : "review_photo_id"
  completion_photos |o--o{ portfolio_items : "completion_photo_id"
```

### CTX-007 가게 등록·연결

테이블: TBL-001 `owners`, TBL-002 `operators`, TBL-003 `shops`, TBL-004 `kakao_channels`, TBL-005 `privacy_policies`, TBL-058 `shop_identity_changes`, TBL-059 `operator_sessions`, TBL-060 `operator_login_failures`, TBL-061 `owner_sessions`. 컬럼은 기본 키(PK)·외래 키(FK)와 상태·종류·버전·금액만 보입니다. 다른 컨텍스트의 테이블은 이름만 나옵니다.

```mermaid
erDiagram
  owners {
    uuid id PK "사장님 ID"
  }
  operators {
    uuid id PK "운영자 ID"
  }
  shops {
    uuid id PK "가게 ID"
    uuid owner_id FK "가게 주인"
    uuid license_reviewed_by FK "마지막으로 확인·보류한 운영자"
  }
  kakao_channels {
    uuid id PK "채널 연결 ID"
    uuid shop_id FK "채널을 묶은 가게"
    text status "연결 확인 중·연결됨·연결 안…"
  }
  privacy_policies {
    uuid id PK "처리방침 버전 ID"
    uuid shop_id FK "처리방침의 가게"
    int version "버전"
  }
  shop_identity_changes {
    uuid id PK "변경 요청 ID"
    uuid shop_id FK "바꿀 가게"
    text status "확인 기다림·반영함·보류"
    uuid reviewed_by FK "반영·보류한 운영자"
  }
  operator_sessions {
    uuid id PK "세션 ID"
    uuid operator_id FK "로그인한 운영자"
  }
  operator_login_failures {
    uuid id PK "시도 한 번"
  }
  owner_sessions {
    uuid id PK "세션 ID"
    uuid owner_id FK "로그인한 사장님"
  }
  owners ||--o| shops : "owner_id"
  operators |o--o{ shops : "license_reviewed_by"
  shops ||--o{ kakao_channels : "shop_id"
  shops ||--o{ privacy_policies : "shop_id"
  shops ||--o{ shop_identity_changes : "shop_id"
  operators |o--o{ shop_identity_changes : "reviewed_by"
  operators ||--o{ operator_sessions : "operator_id"
  owners ||--o{ owner_sessions : "owner_id"
```

### CTX-008 알림

테이블: TBL-042 `owner_tasks`, TBL-043 `owner_alerts`, TBL-044 `notifications`. 컬럼은 기본 키(PK)·외래 키(FK)와 상태·종류·버전·금액만 보입니다. 다른 컨텍스트의 테이블은 이름만 나옵니다.

```mermaid
erDiagram
  owner_tasks {
    uuid id PK "할 일 ID"
    text kind "에스컬레이션 건·맞춤 주문…"
    uuid order_id FK "관련 주문"
    uuid handoff_id FK "에스컬레이션 건"
    uuid change_request_id FK "변경 요청"
    uuid issue_report_id FK "문제 신고"
    uuid payment_request_id FK "결제 안내"
    uuid refund_id FK "보낼 환불"
  }
  owner_alerts {
    uuid id PK "사장님 알림 ID"
    uuid owner_task_id FK "알린 할 일"
    text kind "새 할 일·지연 뒤 다시 알림…"
    text status "보낼 것·발송 결과 확인 중…"
    uuid batched_into_id FK "1분 안 같은 종류는 하나로…"
  }
  notifications {
    uuid id PK "알림 ID"
    uuid customer_id FK "받을 손님"
    uuid consultation_id FK "그 손님의 상담"
    uuid order_id FK "관련 주문"
    text kind "사장님 답·지연 안내"
    text status "보낼 것·다시 보낼 것·발송…"
  }
  orders |o--o{ owner_tasks : "order_id"
  handoffs |o--o{ owner_tasks : "handoff_id"
  change_requests |o--o{ owner_tasks : "change_request_id"
  issue_reports |o--o{ owner_tasks : "issue_report_id"
  payment_requests |o--o{ owner_tasks : "payment_request_id"
  refunds |o--o{ owner_tasks : "refund_id"
  owner_tasks |o--o{ owner_alerts : "owner_task_id"
  owner_alerts |o--o{ owner_alerts : "batched_into_id"
  customers ||--o{ notifications : "customer_id"
  consultations ||--o{ notifications : "consultation_id_customer_id"
  orders |o--o{ notifications : "order_id"
```

### CTX-009 장부 연결

테이블: TBL-045 `ledger_links`, TBL-046 `ledger_rows`, TBL-047 `ledger_writes`. 컬럼은 기본 키(PK)·외래 키(FK)와 상태·종류·버전·금액만 보입니다. 다른 컨텍스트의 테이블은 이름만 나옵니다.

```mermaid
erDiagram
  ledger_links {
    uuid id PK "장부 연결 ID"
    uuid shop_id FK "가게"
    text status "연결됨·권한 해제됨·사장님이…"
  }
  ledger_rows {
    uuid id PK "장부 행 ID"
    uuid order_id FK "주문"
  }
  ledger_writes {
    uuid id PK "장부 쓰기 ID"
    uuid ledger_row_id FK "장부 행"
    text status "기다림·다시 적기·적힘…"
  }
  shops ||--o{ ledger_links : "shop_id"
  orders ||--o| ledger_rows : "order_id"
  ledger_rows ||--o{ ledger_writes : "ledger_row_id"
```

### 공통

테이블: TBL-050 `request_keys`, TBL-051 `ops_events`, TBL-053 `access_logs`, TBL-054 `file_deletions`. 컬럼은 기본 키(PK)·외래 키(FK)와 상태·종류·버전·금액만 보입니다. 다른 컨텍스트의 테이블은 이름만 나옵니다.

```mermaid
erDiagram
  request_keys {
    text actor_kind PK "누른 쪽"
    uuid actor_id PK "그 사람의 ID"
    text request_key PK "화면이 만든 요청 키"
  }
  ops_events {
    uuid id PK "운영 기록 ID"
    uuid shop_id FK "가게"
    text kind "지난 기록 지우기·다 찬…"
  }
  access_logs {
    uuid id PK "접속기록 ID"
    uuid shop_id FK "어느 가게의 손님 기록인지"
    uuid owner_id FK "접속한 사장님"
    uuid operator_id FK "접속한 운영자"
  }
  file_deletions {
    uuid id PK "지울 파일 ID"
    uuid shop_id FK "어느 가게의 사진 파일인지"
  }
  shops |o--o{ ops_events : "shop_id"
  shops ||--o{ access_logs : "shop_id"
  owners |o--o{ access_logs : "owner_id"
  operators |o--o{ access_logs : "operator_id"
  shops ||--o{ file_deletions : "shop_id"
```
<!-- build_erd:diagrams:end -->

## 4. 앱이 지키는 규칙

DB는 한 행 안의 규칙(CHECK), 행 사이의 관계(외래 키·UNIQUE), '하나만 열림'(부분 UNIQUE), 기간 중복(EXCLUDE)을 지킵니다. 아래는 여러 행을 세거나 상태 전이를 봐야 해서 앱(06·11단계)이 지키고 12단계 테스트로 보는 규칙입니다.

| 번호 | 규칙 | 근거 | 앱이 하는 일 |
| --- | --- | --- | --- |
| A1 | 확정은 결제 확인으로만 | REQ-060, 1-2, SPEC-036, SPEC-070, 설계 재검토 M7, 5절 E29 | 주문을 `confirmed`로 바꾸는 쓰기는 `payments` 행을 남기는 같은 트랜잭션에서만 하고, 그 결제를 주문을 확정한 결제(`orders.confirmed_payment_id`)로 씁니다. 결제 확인 취소(A17)는 주문을 결제 기다림으로 돌리며 주문을 확정한 결제를 비웁니다. 데이터베이스는 주문 확정 뒤 상태(확정·받음·미수령)의 주문에 그 주문을 확정한 결제가 있고(재제작 주문은 뺌) 그것이 그 주문의 결제이며 확정 시각이 있는지(`orders_confirmed_payment_chk`, `orders_confirmed_payment_fk`), 커밋할 때 그 결제의 확인이 취소되지 않았는지(지연 제약 트리거 `orders_confirmed_payment_live`, `payments_confirmed_void`)를 봅니다 |
| A2 | 환불 합은 받은 금액을 넘지 않음 | REQ-165(REQ-086을 넓힘) | 주문 행을 잠그고(`SELECT … FOR UPDATE`) 그 주문 결제 안내의 들어온 금액(`payment_requests.arrived_amount`) 합과 `refunds` 합을 셉니다. 보상이 아닌 환불이 계산값보다 낮은 쓰기는 `refunds_floor_chk`가 막습니다(REQ-170) |
| A3 | 하루 최대 개수를 넘지 않음 | G3, 1-4, REQ-220, REQ-221, REQ-225, REQ-226 | `calendar_days`의 (가게, 날짜) 행을 없으면 만들고 잠근 뒤, 그날 잡힌 자리·확정된 자리·종료된 자리를 세고(`slot_holds_day_live_idx`) 잡습니다. 픽업 일시가 지나 종료된 자리도 그날 만든 수라 셉니다(설계 재검토 M9). 손님이 고른 날이 다 찼거나 휴무일이면 자리를 잡지 않고 손님에게 알립니다(REQ-220, REQ-225). 마감 후 추가 수락(`overbooked`)은 사장님이 추가 수락한 날(R10)이나, 사장님이 고르는 주문에서 다 찬 날·휴무일임을 보고 확인한 자리(REQ-221, REQ-226)에만 씁니다. 사장님이 추가 수락한 날은 그 마감된 날 질문 건의 날짜에 24시간 안의 주문 요청 하나만 쓰고, 쓴 주문 요청을 그 건에 남깁니다(`handoffs.day_used_order_id`, A34) |
| A4 | 픽업 날짜 | G8 | `orders.pickup_day`는 가게 시간대(`shops.time_zone`)로 본 `pickup_at`의 날짜이고, 유효한 자리의 날짜와 같습니다 |
| A5 | 결제 안내 금액 | REQ-076, REQ-230, REQ-231, R13 | 첫 결제는 수락한 버전(기본 디자인은 요청한 버전)의 금액, 차액 결제는 변경 요청의 올라간 금액(사장님이 고른 방향과 양수 차이 금액으로 앱이 셈한 `change_requests.amount_delta`)입니다. '부터'·'범위' 견적의 맞춤 주문은 사장님이 수락할 때 넣은 최종 금액이고 견적의 아래 끝보다 낮을 수 없으며, 결제 안내에 손님이 요청한 금액(`requested_amount`)을 함께 둡니다(A32) |
| A6 | 상태가 가는 길과 동시 쓰기 | 1-1~1-8, G3, 설계 재검토 H12 | DB는 상태와 시각의 쌍만 봅니다. 어느 상태에서 어디로 갈 수 있는지는 앱의 상태 머신이 지킵니다. 주문·변경 요청은 읽은 잠금 번호와 같을 때만 쓰고 하나 올립니다(`UPDATE … SET …, lock_version = lock_version + 1 WHERE id = … AND lock_version = 읽은 값`). 0행이면 그 사이 다른 쓰기가 있었던 것이라 다시 읽어 지금 상태로 판단합니다(5절 E15, 8절 D5). 결제 안내는 `payment_requests.version`(비교해 쓰는 번호)이 같은 일을 합니다. 2026-11-13 전에는 내용 버전(`version`)을 견줬는데, 상태만 바꾸는 쓰기에서 오르지 않아 늦은 쓰기를 막지 못했습니다(11절) |
| A7 | 손님 확인 카드 | G9 | 누른 사용자가 카드의 손님이고, 30분 안이고, 묶인 버전이 현재 버전일 때만 명령합니다 |
| A8 | 손님 명령은 그 손님만 | REQ-062, G1 | 변경·취소·신고는 말한 손님이 `orders.customer_id`일 때만 받습니다 |
| A9 | 모든 읽기·쓰기는 그 가게 것만 | G1, SPEC-068 | 채널로 찾은 가게 ID로 거릅니다. DB의 복합 외래 키(E1)는 가게가 섞인 행을 막을 뿐, 다른 가게 행을 읽는 것은 막지 않습니다 |
| A10 | 예약 링크를 낼 조건 | SPEC-010 | 영업 신고 확인됨은 DB가(`shops_booking_needs_license`), 현재 버전 가격표·운영규정·영업 캘린더·채널 연결·처리방침 국외 이전 항목과 지금 쓰는 결제 수단(`payment_accounts`에서 `retired_at`이 빈 행, 가게마다 하나는 `payment_accounts_one_current`, REQ-164)은 앱이 봅니다(결제 수단은 설계 재검토 M8로 더함) |
| A11 | 사진 장수 | SPEC-019, SPEC-053, SPEC-057, SPEC-062 | 신고·완성·후기 사진은 순서 컬럼이 1~5라 DB가 막고, 참고 사진의 상담마다 10장은 앱이 셉니다 |
| A12 | 먼저 보내는 안내 | G5 | 채널 친구에게만, 정해진 시각 안내는 가게 시간 08:00~20:50에만 보냅니다 |
| A13 | AI 비용 한도 | REQ-163 | `ai_calls`의 가게 하루 `cost_krw` 합이 `shops.daily_ai_cost_limit_krw`에 닿으면 그날 남은 질문을 에스컬레이션합니다 |
| A14 | 장부에 적는 값 | 1-8, R21, SPEC-064 | 적을 때 그 주문의 지금 값으로 적어 옛 이벤트가 새 값을 덮지 않게 합니다. 재제작 주문은 따로 행을 두지 않고(트리거 `ledger_rows_remake`) 그 만듦·변경·인도·미수령·취소를 원래 주문의 행에 '재제작'(`ledger_writes.event_kind = 'remake'`)으로 적습니다(A31) |
| A15 | 마스킹한 값 | SPEC-021, REQ-191~193 | AI·로그로는 `messages.body_masked`만 보냅니다. 원래 값은 전화번호·계좌번호만 암호문(`masked_values.original_enc`, A23)으로 두고 그 가게 사장님 화면과 사유를 적고 연 운영자(A24)에게만 보입니다. 카드번호는 끝 4자리(`last4`)만, 주민등록번호처럼 보이는 숫자와 무엇인지 모르는 긴 숫자는 아무것도 두지 않습니다(`masked_values_kept_chk`, `masked_values_last4_chk`). 나누는 규칙은 SPEC-021입니다. 같은 값에 같은 플레이스홀더를 주려고 원래 값 대신 비밀 키의 HMAC(`value_hmac`)으로 찾습니다(`masked_values_value_uq`) |
| A16 | 지난 기록 지우기 | SPEC-065, REQ-185~190 | 하루 한 번(03:00) 6절의 여섯 차례대로 지웁니다. 주문 하나·상담 하나를 한 트랜잭션으로 지우고, 사진 행을 지우는 그 트랜잭션에서 저장 위치를 지울 파일(`file_deletions`, 5절 E24)로 넣습니다. 저장소의 사진 파일은 트랜잭션이 끝난 뒤 지울 파일에서 지우고 지운 파일의 행만 지우며, 저장소가 실패하거나 작업이 멈추면 지울 파일이 남아 다음 날 다시 지웁니다(Codex 후속). 지우는 주문은 잠금 번호를 올려 같은 때 온 늦은 쓰기를 막습니다(A6). 데이터베이스에서 지우는 차례는 규칙 테스트의 `purge_run`이 그대로 씁니다(8절) |
| A17 | 결제 확인 취소 | REQ-169, SPEC-070 | 제작을 시작하지 않은 주문만 받습니다. 한 트랜잭션으로 결제에 취소 시각·사유를 남기고, 결제 안내는 나감으로(들어온 금액 지움), 주문은 결제 기다림으로, 자리는 가예약으로 되돌리고, 제작 행을 지웁니다 |
| A18 | 환불 보내기 | REQ-172, REQ-173 | 돌려줄 금액이 있는 환불을 정하는 트랜잭션에서 할 일 '환불 보내기'(`refund_send`)를 열고, 보내지 않은 채 24시간이 지나면 한 번 다시 알립니다(`realerted_at`). '보냄'을 남기는 트랜잭션에서 할 일을 닫고 손님 안내와 장부 쓰기를 남깁니다 |
| A19 | 채널 연결 확인 | REQ-179, SPEC-008 | '연결 확인'을 누른 뒤 10분 안에 온 테스트 메시지의 사용자 키를 `test_user_key`로 두고, 그 사용자가 누른 시험 버튼이 우리 스킬(확인 카드·주문자 정보·입금자 이름·후기)에 닿을 때마다 그 블록을 `verified_blocks`에 더합니다. 넷이 모두 닿아야 연결됨으로 씁니다(데이터베이스는 `kakao_channels_blocks_chk`로 블록 ID 넷과 닿은 블록 넷을 봄) |
| A20 | 먼저 보내기와 발송 결과 | REQ-180, REQ-181, REQ-182, G5 | 연결된 뒤 `test_user_key`로 시험 안내를 한 번 보내 그 결과로 `event_status`를 됨·안 됨으로 씁니다. 안 됨인 가게는 손님 안내를 보내지 않고 다음 대화 때 전함으로 둡니다. 보낼 때는 카카오가 받은 taskId와 시각을 남기고 '발송 결과 확인 중'(`confirming`)으로 두었다가 1분·5분·30분 뒤 결과를 조회해, 닿았으면 보냄(`sent_at`), 친구가 아님(101)이면 다음 대화 때 전함과 손님의 친구 아님, 가게 설정 오류면 `event_status`를 안 됨과 사장님 알림, 월렛 잔액이 모자라면 운영자 알림, 30분 뒤에도 모르면 `fail_code = 'unknown'`으로 다음 대화 때 전함으로 둡니다. 사장님 알림(`owner_alerts`)도 같은 길이고 받는 곳은 `owners.kakao_account_id`입니다 |
| A21 | 주문 요청 카드에 들어가는 규정 글 | REQ-184, SPEC-005, SPEC-028 | 운영규정 버전을 저장할 때 취소·환불 조문으로 주문 요청 카드의 규정 글(머리 줄, 조문마다 한 줄, 청약철회 제한 문장)을 만들어 1,000자 말풍선 둘에 들어가지 않으면 저장하지 않습니다. 카드는 저장된 버전의 글을 자르지 않고 보입니다 |
| A22 | 주문이 끝남, 상담 끝남, 보관 기록 | SPEC-025, SPEC-040, SPEC-060, SPEC-065, REQ-187, REQ-189 | 주문이 받음·미수령·거절·취소에 있고 그 주문의 환불·문제 신고·변경 요청·결제 안내·할 일이 모두 닫히고 그 주문을 가리키는 재제작 주문이 모두 끝나는 트랜잭션에서 `orders.finished_at`을 씁니다(재제작 주문이 끝나는 트랜잭션에서 원래 주문도 끝나면 함께 씀). 끝난 뒤 늦은 신고나 들어온 입금 대조로 그 주문의 일이 다시 열리면 `finished_at`을 비우고(끝난 재제작 주문이 다시 열리면 원래 주문의 것도 함께 비움), 다시 끝날 때까지 지우지 않습니다. 데이터베이스는 끝나지 않은 재제작 주문이 있는 원래 주문이 끝나지 않는지를 트랜잭션 끝에 봅니다(지연 제약 트리거 `orders_remake_finish`, [PR #35 Codex 의견](https://github.com/kodonghui/siljang.ai/pull/35#discussion_r4571233614)). 개인정보를 지운 주문은 다시 열지 않습니다(`orders_purged_chk`). 상담이 다룬 주문(그 상담에서 요청된 주문과 그 상담의 확인 카드·신고 내용·에스컬레이션 건·손님 안내가 가리키는 주문)이 모두 끝나고 손님의 마지막 메시지 뒤 가게가 정한 시간이 지나면 `status = 'ended'`와 `ended_at`을 쓰고, 그 손님의 다음 말은 새 상담으로 받아 고지부터 보냅니다(손님마다 끝나지도 지워지지도 않은 상담 하나, `consultations_one_live_per_customer`). 보관 기록이 된 주문(`personal_data_purged_at`이 있음)과 그 결제 안내·결제·환불·변경 요청·문제 신고는 사장님·손님 화면, 06단계 API(목록에서 빼고 하나를 읽으면 404 `not_found`, 06단계 README 5절), 제작 목록, AI 도구가 읽지 않습니다. 보관 기록은 같은 데이터베이스 안에서 표시(`kept_records`, `personal_data_purged_at`)로 나누므로 이 읽지 않음은 앱이 지킵니다(5절 E19) |
| A23 | 계좌번호와 원래 값의 암호화 | REQ-191, SPEC-006, SPEC-021, SPEC-049, 5절 E20 | 가게 계좌번호·환불 계좌번호·대화 속 전화번호와 계좌번호는 저장하기 전에 앱이 암호화해 봉투(`v키버전:base64url(nonce‖암호문‖태그)`)로 쓰고, 사장님 화면·결제 안내·운영자가 연 값을 보일 때만 복호화합니다. 데이터베이스는 봉투 모양만 보고(`payment_accounts_account_number_enc_check`, `refunds_refund_account_enc_check`, `masked_values_original_enc_check`), 평문 형식(숫자와 '-', 10~16자리)은 06단계 API가 봅니다. 결제 안내 글(`notifications.body`)에는 계좌번호를 넣지 않고 자리만 두어 보일 때 채웁니다. 끝 4자리 컬럼은 운영자 화면과 목록의 가린 값입니다 |
| A24 | 접속기록 | REQ-194~196, SPEC-073, SPEC-074, 5절 E21 | 사장님·운영자가 손님 개인정보를 읽거나 바꾸거나 여는 요청마다 응답과 같은 트랜잭션에서 `access_logs`에 한 행을 넣고, 넣지 못하면 개인정보를 돌려주지 않습니다. 손님 자신의 요청(카카오 스킬)과 서버 작업은 넣지 않습니다. 운영자의 원래 값·상담의 대화 글·보관 기록 열기는 사유(5~200자)와 대상이 꼭 있고(`access_logs_open_chk`) 운영자만 합니다(`access_logs_open_operator_chk`). 운영자가 상담을 볼 때는 대화 글 없이 메시지마다 글자 수만 돌려주고, 대화 글은 사유를 적어 연 페이지만 돌려주며 대상 `consultation_text`로 남깁니다(REQ-227, Codex 후속). 고치기·지우기·비우기는 트리거 `access_logs_guard`가 어느 데이터베이스 계정으로 해도 막고, 지금 시각으로 2년이 지난 행 지우기만 받습니다(6절 여섯째 차례). 데이터베이스 소유자는 트리거를 끄거나 지울 수 있으므로 앱이 소유자 계정을 쓰지 않게 하는 것과 접속기록 점검 주기는 출시 전 내부 관리계획에서 정합니다(「개인정보의 안전성 확보조치 기준」 제8조②) |
| A25 | 예금주 확인과 계좌 바꾸기 | REQ-197~199, SPEC-003, SPEC-006 | 운영자는 결제 계좌가 있고 그 예금주가 대표자·상호와 같은지 본 뒤에만 영업 신고를 확인됨으로 쓰고, 같은 트랜잭션에서 그 계좌에 확인한 운영자와 시각(`payment_accounts.holder_checked_by`·`holder_checked_at`)을 씁니다. 확인된 가게의 새 계좌는 예금주가 확인된 대표자·상호나 운영자가 확인한 예금주와 같을 때만 받습니다. 계좌를 바꾸는 트랜잭션은 옛 행에 그만 쓴 시각을 쓰고 새 행을 지금 계좌로 넣고 사장님 알림 `payment_account_changed`(할 일 없음, 계좌번호 없음)를 남깁니다. 이미 나간 결제 안내는 옛 계좌를 그대로 가리키고 바꾼 뒤 내는 안내만 새 계좌를 씁니다. 보류된 가게가 계좌를 바꾸면 영업 신고를 확인 기다림으로 되돌립니다 |
| A26 | 알레르기 정보 동의와 사진 게시 동의 | REQ-200~205, REQ-207~209, SPEC-029, SPEC-053, SPEC-063, SPEC-075 | 알레르기 정보 동의 단계를 켠 배포(배포 설정, 기본 켬)에서는 알레르기 정보 카드를 주문자 정보 카드 앞에 보내고, 손님이 누른 답과 동의 글 버전·시각을 초안에 쓰며, 알레르기 답은 전용 블록으로만 받아 AI 호출의 입력에 넣지 않습니다(REQ-204, 데이터베이스는 보내는 것을 보지 못함). 주문 요청은 초안에 동의의 답이 있고 동의했으면 알레르기 답도 있을 때만 받고, 주문 내용 버전마다 그 답을 옮깁니다. 완성 사진 안내의 답은 그 안내의 사진마다 한 행으로 쓰고, 철회는 그 사진의 올라 있는 항목을 먼저 내린 뒤(`consent_live` 비움) 같은 트랜잭션에서 `withdrawn_at`과 `publishable = false`를 씁니다. 거꾸로 하면 `portfolio_items_consent_live_fk`가 막습니다. 잠정, 5-2 질문 4·6 |
| A27 | 주문 상태와 제작 행의 인도·미수령 시각 | 1-2, SPEC-054, SPEC-055, 설계 재검토 M9, 5절 E3 | 받음으로 두는 쓰기와 제작 행의 인도 시각(`productions.handed_over_at`), 미수령으로 두는 쓰기와 미수령 시각(`productions.no_pickup_at`)은 한 트랜잭션에서 씁니다. 주문이 받음이면 인도 시각이 있고, 미수령이면 미수령 시각이 있고 인도 시각이 없으며, 다른 상태에는 둘 다 없어야 합니다(미수령 뒤 찾아가면 둘 다 있고 받음). 어긋나면 지연 제약 트리거 `orders_production_sync`(주문 상태를 쓸 때)와 `productions_order_sync`(제작 행의 두 시각을 쓰거나 행을 지울 때)가 커밋 때 막습니다(함수 `orders_production_sync_check()`, SQLSTATE 23514). 같은 트랜잭션 안에서는 어느 쪽을 먼저 써도 됩니다. 데이터베이스가 보는 규칙이지만 두 테이블을 함께 봐야 해서 여기 적습니다 |
| A28 | 사장님 답 기다림의 끝과 결제 기한 | 1-7, REQ-213~218, REQ-223, SPEC-024, SPEC-032, SPEC-037, 5절 E23 | 기한 처리 작업이 몇 분마다 한 건씩 한 트랜잭션으로 씁니다. 맞춤 주문 요청은 그 픽업 날짜의 주문 마감(요청 때 이미 지났으면 픽업 일시)에 주문을 '답 없어 닫힘'(`orders.cancel_kind = 'no_answer'`)으로, 변경 요청은 변경 마감에 `closed_no_answer`로, 에스컬레이션 건은 남긴 지 7일에 `closed_no_answer`와 닫힌 시각으로 닫고(`handoffs_open_age_idx`), 같은 트랜잭션에서 그 할 일을 `wait_status = 'closed_no_answer'`로 닫고 손님 안내 `no_answer_closed`를 한 번 남깁니다. 결제 확인 요청·맞추는 중·환불 결정도 기다리는 시간이 지나면 사장님 다시 알림과 손님 지연 안내를 한 번씩 보내고 '지연'으로 둡니다(REQ-215). 결제 기한 지난 주문을 사장님이 픽업 일시까지 고르지 않으면 결제 없어 취소합니다(REQ-217). 결제 기한은 결제 안내가 손님에게 전해진 시각(`payment_requests.delivered_at`)에 운영규정의 결제 기한을 더한 때와 낼 때 정한 결제 기한 상한(`due_cap_at`) 가운데 이른 쪽으로 쓰고, 확인 요청됨인 결제 안내는 상한에 기한 지남으로 두고 그 결제 확인 요청 할 일을 '답 없어 닫힘'으로 닫습니다(REQ-223, `payment_requests_claim_cap_idx`). 데이터베이스는 상태와 시각의 짝, 기한이 상한을 넘지 않음, 답 없어 닫히는 종류만 봅니다 |
| A29 | 취소 뒤 들어온 입금·더 들어온 금액의 환불 계산값 | SPEC-016, SPEC-071, REQ-165, Codex 후속, 설계 재검토 남은 빈 곳 | 계산값은 그 결제 안내에서 결제로 확인하지 않았고 앞 환불이 셈하지 않은 몫, 곧 그 결제 안내의 들어온 금액에서 결제 확인을 취소하지 않은 확인된 결제와 앞 환불이 셈한 들어온 금액(`refunds.counted_arrived_amount`) 가운데 큰 값을 뺀 값입니다(더 들어온 금액은 넘은 몫만, 취소 뒤 들어온 입금은 확인된 결제가 없어 전부, 환불을 정한 뒤 같은 결제 안내에 또 들어온 입금은 새로 들어온 몫만). 사장님이 '들어옴'을 다시 남기면 그 결제 안내의 들어온 금액에 더하고, 환불은 그때의 들어온 금액(합)을 셈한 것으로 남습니다(결제 확인 요청 중이거나 맞추는 중에 취소한 주문의 취소 환불도 그 결제 안내와 셈한 금액을 가짐). 주문 행을 잠그고 셈하고(A2), 데이터베이스는 환불 행을 쓰거나 계산값을 고칠 때 트리거 `refunds_unconfirmed`가 그 결제 안내 행을 잠그고 셈한 금액을 채운 뒤 앞 환불보다 적게 셈한 환불과 그 몫을 넘는 계산값을 막습니다. 환불 금액과 계산값의 상한은 들어온 금액의 상한과 같은 1억 원입니다 |
| A30 | 환불 계산값 | SPEC-005, SPEC-016, SPEC-045, SPEC-047, SPEC-048, REQ-084, 설계 재검토 M4 | 주문 행을 잠그고(A2) SPEC-016의 차례로 셉니다. ① 바탕 = 받은 금액 - 이미 정한 환불 합계 - 따로 정할 환불의 계산값(아직 정하지 않은 금액이 내려간 변경·취소 뒤 들어온 입금·더 들어온 금액의 환불). ② 비율: 맞춤 재료 주문과 제작 시작이 둘 다 표시되지 않았으면 제작 전 취소 조문의 비율(`operating_rules.pre_production_refund_pct`), 하나라도 표시됐으면 기준 픽업 일시까지 남은 시간(1시간 미만 버림, 지났으면 0)이 든 단계별 환불 행(`refund_tiers.hours_before_min`은 넣고 `hours_before_max`는 뺌)의 비율입니다. 기준 픽업 일시는 운영규정의 `date_change_refund_basis`에 따라 주문 내용 첫 버전의 픽업 일시(`order_details.pickup_at`)나 지금 픽업 일시이고, 단계별 환불이 없는 버전은 제작 전 비율을 씁니다. ③ 고정 취소 수수료를 먼저 빼고(바탕보다 크면 0원) ④ 비율을 곱해 원 미만을 버리며 ⑤ 결과는 0원 이상 바탕 이하입니다. 가게 사정 취소는 바탕 전액(보상 조문은 글로만), 금액이 내려간 변경은 내려간 금액(차액 돌려주기: 일부 환불로 남기고 0원이면 환불 없음, `refunds_change_decision_chk`), 보상은 사장님이 고른 금액입니다. 수수료가 주문 금액보다 큰지는 운영규정을 저장할 때 볼 수 없어(0원~1,000만 원만 봄) 계산 때 봅니다. 계산값과 다른 금액은 사유 1~200자를 꼭 받고(`refunds_override_chk`), 보상이 아니면 높은 금액만 됩니다(`refunds_floor_chk`). 데이터베이스는 계산값을 셈하지 않고, 앱이 셈한 값을 근거(`refunds.calc_basis`)와 함께 씁니다 |
| A31 | 재제작 주문의 돈과 후기 부탁 | SPEC-016, SPEC-042, SPEC-046~048, SPEC-059~061, SPEC-064, R21, 설계 재검토 M13 | 재제작 주문은 결제 없는 주문이라 돈의 일을 원래 주문에서 합니다. 재제작 주문의 취소·가게 사정 취소·다시 신고의 보상은 원래 주문의 받은 금액·이미 정한 환불·따로 정할 환불과 운영규정 버전으로, 시각과 픽업 일시는 재제작 주문 것으로 셈해(A30) 환불을 원래 주문에 남기고, 다시 신고의 보상 한도는 원래 주문의 받은 금액입니다. 재제작 주문의 변경 요청은 금액이 그대로일 때만 수락하고, 장부는 원래 주문 행에 '재제작'으로 적습니다(A14). 재제작 주문의 취소·다시 신고의 환불을 원래 주문에 남기므로 원래 주문은 그 재제작 주문이 모두 끝날 때까지 끝나지 않습니다(A22). 후기 부탁은 보내기 직전에 그 주문에 문제 신고가 한 번이라도 들어왔는지(닫힌 신고 포함) 다시 보고, 신고가 있었던 주문과 재제작 주문에는 보내지 않습니다. 데이터베이스는 재제작 주문이 돈을 낸 원래 주문을 가리키는지(`orders_remake_root`, 재제작의 재제작도 원래 주문에 이음)와 재제작 주문에 결제 안내·환불·장부 행이 없는지(`payment_requests_remake`, `refunds_remake`, `ledger_rows_remake`), 끝나지 않은 재제작 주문이 있는 원래 주문이 끝나지 않는지(`orders_remake_finish`)를 봅니다 |
| A32 | 기본 디자인 범위와 손님의 새 금액 확인 | REQ-228~235, SPEC-004, SPEC-013, SPEC-031~035, SPEC-042~045, SPEC-076, 1-4, 1-5, 설계 재검토 M5·M6, 5절 E25·E26 | (1) 주문 종류는 AI가 아니라 가게 규칙이 가릅니다. 고른 옵션·도안이 모두 그 가격표 버전의 기본 디자인 범위 안(`price_options.in_standard`, `designs.in_standard`, 도안은 값을 정하는 옵션도 범위 안)이고 참고 사진·빼야 할 재료가 없고 견적이 '확정'이면 기본 디자인, 아니면 맞춤입니다. 데이터베이스는 범위 안의 옵션과 기본 디자인 견적이 '확정'인지만 봅니다(`price_options_standard_fixed_chk`, `quotes_standard_fixed_chk`). (2) 손님이 본 금액은 견적이 '확정'이면 그 금액, '부터'면 아래 끝, '범위'면 위 끝이고, 결제 안내의 요청한 금액(`requested_amount`)과 주문 첫 버전의 견적(`order_details.quote_id`)으로 셉니다. 맞춤 주문을 그보다 높게 수락하거나 금액이 오르는 변경을 수락하면 결제 안내를 새 금액 확인 필요(`needs_amount_confirm`)로 내고 계좌 대신 새 금액 확인 카드(`confirm_cards.kind = 'amount_confirm'`)를 보냅니다. 손님이 확인하면 그 시각을 확인한 시각과 전해진 시각으로 쓰고 그때부터 결제 기한을 셉니다. 받지 않으면 맞춤 주문은 손님 취소로 자리를 바로 풀고, 변경은 '차액 없어 닫힘'으로 원래 주문대로 둡니다. 확인 전에 들어온 돈을 사장님이 결제로 확인하면('입금됨'·'대조 완료') 그 시각을 손님의 확인으로 남깁니다. 데이터베이스는 차액 결제가 늘 확인 필요인지, 첫 결제·다시 낸 결제의 확인 필요가 요청한 금액보다 높은 금액에만 있는지, 확인 전에 전해짐·결제 확인 요청·확인됨이 없는지, 받지 않으면 닫힘인지를 봅니다(`payment_requests_needs_confirm_chk` 등 여섯). '범위'의 위 끝과 견주는 것은 앱이 합니다. (3) 날짜를 바꾸고 금액이 오르는 변경은 차액을 기다리는 동안 옛 날의 확정된 자리를 그대로 두고 새 날 자리를 차액 결제 안내로 잡습니다(그날 자리 세기는 A3). 차액이 결제로 확인되면 옛 자리를 풀고(`date_changed`) 새 자리를 확정하며, 변경 요청이 반영되지 않고 닫히면 새 자리를 '변경 닫힘'(`change_closed`)으로 풉니다. 데이터베이스는 주문마다 잡힌 자리 하나·확정된 자리 하나(`slot_holds_one_held_per_order`, `slot_holds_one_fixed_per_order`)와 둘이 함께 있는 것이 차액 결제 안내의 자리뿐인지(트리거 `slot_holds_pair`)를 봅니다 |
| A33 | 같은 일은 한 번만: 이벤트 키의 형식과 대상마다 하나 | G2, REQ-132, REQ-154, SPEC-067, 06 DEC-04, 설계 재검토 M7(RD-05, RC-06), 5절 E27·E29 | 자동으로 하는 일은 아래 표의 형식으로 키를 짓고 그 키로 한 번만 남깁니다. 대상 ID는 그 행의 UUID(소문자 36자), 종류·사유는 그 테이블의 영문 값입니다. 대상은 그 일을 만든 기록이라, 같은 주문에 같은 종류의 일이 다시 생기면(두 번째 변경, 결제 확인 취소 뒤 다른 결제로 주문을 확정함, 환불 둘) 그때의 변경 요청·결제·환불이 대상이 되어 저마다 한 번씩 남습니다. 데이터베이스는 가게마다 같은 키를 한 번만 받고(키마다 `(shop_id, 키)` UNIQUE), 환불은 키가 달라도 대상마다 하나를 따로 봅니다: 취소 환불은 취소한 주문마다(`refunds_cancelled_uq`, 재제작 주문의 취소 환불은 원래 주문에 남기고 취소한 주문은 그 재제작 주문, 트리거 `refunds_cancelled`), 금액이 내려간 변경의 환불은 변경 요청마다(`refunds_change_uq`), 보상은 문제 신고마다(`refunds_issue_uq`), 취소 뒤 들어온 입금·더 들어온 금액의 환불은 결제 안내의 들어온 금액(합)마다(`refunds_request_uq`, 같은 결제 안내에 다시 들어온 입금은 새로 들어온 몫의 새 환불, A29). 주문 확정은 주문을 확정한 결제 하나로 봅니다(A1). 사장님·운영자 화면의 요청 키는 06 DEC-04와 5절 E27을 따릅니다 |
| A34 | 덧붙은 질문과 마감된 날 질문 | SPEC-014, SPEC-022, SPEC-023, SPEC-029, R10, REQ-225, 설계 재검토 M17(RC-08), 5절 E28 | 같은 상담에 열린 에스컬레이션 건이 있으면 새 질문은 그 건에 덧붙고 질문마다 `handoff_questions` 한 행(사유·손님 말·관련 주문)을 남깁니다. 덧붙은 질문의 손님 말이 그 건과 같은 상담의 메시지인지는 앱이 봅니다(같은 말은 한 번만, `handoff_questions_message_uq`). 마감된 날 질문은 덧붙이지 않고, 다른 열린 건이 있어도 상담과 날짜마다 따로 건을 엽니다(`handoffs_one_open_day_per_consultation`). 관련 주문이 있는 다른 카카오 사용자의 사정도 덧붙이지 않고 상담과 주문마다 따로 건을 엽니다(4절 A38). 사장님이 그 건에서 추가 수락하면 24시간 안에 그 날짜로 온 주문 요청 하나가 마감 후 추가 수락(`overbooked`)으로 자리를 잡고, 그 주문 요청을 그 건에 남겨 다시 쓰지 않습니다(`handoffs.day_used_order_id`, 하나만 `handoffs_day_used_uq`, 추가 수락한 건만 `handoffs_day_used_chk`) |
| A35 | 차례마다 AI 호출 상한 | AI-1, SPEC-020, 설계 재검토 M16(RC-07) | AI-1은 한 차례(`ai_calls.trace_id`)의 모델 호출을 8번까지만 합니다. 아홉 번째가 필요하면 호출하지 않고 정해진 문장이나 에스컬레이션으로 끝내고, 마지막 호출의 `fallback_reason`을 `call_limit`으로 남깁니다. 순번(`attempt`)은 1부터 차례로 늘리고 다시 한 종류(`call_kind`)를 함께 남깁니다(처음은 순번 1에만 `ai_calls_kind_chk`, 같은 차례의 같은 순번은 하나 `ai_calls_attempt_uq`). 상한은 데이터베이스가 막지 않아 바꿀 때 마이그레이션이 필요 없습니다 |
| A36 | 스킬 키와 연결 문구, '연결 확인 중' 선점 | SPEC-008, SPEC-017, REQ-237, REQ-238, 06단계 DEC-08, 설계 재검토 M18(RD-06) | 스킬 키는 서버 시크릿과 연결 ID·버전(`kakao_channels.skill_key_version`)으로 만들어 저장하지 않고(해시도 두지 않음), 만들 때와 바꿀 때의 응답에만 보입니다. 스킬 요청의 키는 지금 버전, 또는 `previous_key_until` 전이면 바로 앞 버전으로 만든 값과 견줍니다. 키를 바꾸면 버전을 1 늘리고 `skill_key_issued_at`을 그 시각으로 두며, 앞 버전을 24시간 받거나(`previous_key_until`) 바로 끊습니다(비움). 연결 문구도 서버 시크릿과 연결 ID·연결 확인 시작 시각으로 만들어 저장하지 않습니다. 저장이나 연결 확인 시작 때 `claim_expires_at`을 30분 뒤로 두고, 다른 가게가 같은 봇을 넣을 때 그 시각이 지난 '연결 확인 중' 연결을 같은 트랜잭션에서 '연결 안 됨'으로 바꾼 뒤 넣습니다(`kakao_channels_bot_active_uq`) |
| A37 | 사업자 정보 변경 요청의 반영과 가게가 정하는 값을 쓰는 때 | SPEC-003, SPEC-007, SPEC-077, SPEC-078, REQ-197, REQ-199, REQ-243, REQ-245, 설계 재검토 M14(RB-12), 5절 E31 | 변경 요청은 그 가게의 지금 상호·대표자·사업자등록번호를 요청할 때의 값(`shop_identity_changes.prev_*`)으로 함께 남깁니다. 운영자가 반영하면 같은 트랜잭션에서 그 가게의 세 값이 요청할 때의 값과 같을 때만 새 값으로 바꾸고, 요청을 `applied`로 바꿔 반영한 운영자·시각을 남기고, 사장님 알림(`identity_change_applied`, 할 일 없이)을 넣습니다. 보류는 이유와 알림(`identity_change_on_hold`)을 남깁니다. 상호·대표자·사업자등록번호는 이 길 밖에서 쓰지 않습니다(가게 설정 API는 이 셋을 받지 않음). 영업 신고가 확인 기다림·보류인 가게에 확인을 기다리는 변경 요청이 있으면 영업 신고 확인됨을 남기지 않습니다(SPEC-003). 반영할 때 결제 계좌의 예금주가 새 대표자·상호와 다르면 운영자 화면에 표시하고 막지는 않습니다(REQ-197). 가게 설정의 사장님 답 기다리는 시간은 기다림이 시작될 때 `owner_tasks.wait_due_at`에 정해 이미 시작된 기다림은 그대로이고, 문의 끊김 시간과 하루 AI 비용 한도는 그 작업·호출 때 지금 값을 읽으며, 후기 부탁 시각을 바꾸면 아직 보내지 않은 후기 부탁의 보낼 시각(`notifications.scheduled_for`)을 다시 셈합니다(REQ-243) |
| A38 | 문제 종류와 보상 없음의 사유, 그 밖의 보상, 에스컬레이션 건에서 남기는 문제 신고 | SPEC-059, SPEC-079, SPEC-040, SPEC-023, SPEC-065, REQ-246~REQ-249, REQ-251~REQ-254, 설계 재검토 M12(RA-13, RB-15), 5절 E32 | 사장님이 보상을 정할 때 문제 종류(상함·변질·이물·그 밖)를 함께 받습니다. 상함·변질·이물에 보상 없음을 고르면 저장하기 전에 소비자분쟁해결기준(제빵류: 교환 또는 환급)과 그 위험을 보이고 사유(1~200자)를 받아야 저장합니다(06의 확인 `no_compensation_standard`). 그 밖의 보상은 사장님이 한 일(1~200자)과 금액(선택, 0원~1억 원)만 남기고 환불·장부 행을 만들지 않으며, 보상 안내는 '사장님이 직접 연락해 보상을 처리해 드려요' 한 번입니다. 에스컬레이션 건에서 남기는 문제 신고(SPEC-079)는 사유가 다른 사용자(`other_user`)이고 관련 주문이 받은 주문(픽업 완료됨·퀵으로 보냄)인 열린 건에서만 받고, 그 건의 상담에 신고 내용(신고됨, 사진 없음)과 신고(`reported_by = 'owner_from_handoff'`, 신고 카드 없음, `handoff_id`)를 한 트랜잭션에 넣으며, 같은 주문에 열린 신고가 있으면 첫 신고에 잇습니다(`follows_report_id`). 신고 기한 뒤인지(`late`)는 그 건이 생긴 시각으로 셉니다. 할 일 '문제 신고'는 올리되 사장님 알림과 지연 안내(SPEC-024)는 보내지 않고, 그 신고에는 보상 안내를 보내지 않으며 환불은 결제한 주문자에게 지금 환불 규칙대로 갑니다. 신고한 사람에게는 사장님이 그 건에 답해(SPEC-023) 전합니다. 그 건의 관련 주문이 신고의 주문과 같은지(`issue_reports_handoff_fk`)와 건마다 하나(`issue_reports_handoff_uq`)는 데이터베이스가 보고, 건의 사유와 주문 상태는 앱이 봅니다. 다른 카카오 사용자의 사정은 관련 주문이 있으면 다른 열린 건에 덧붙이지 않고 상담과 주문마다 따로 건을 엽니다(같은 주문의 열린 건이 있으면 그 건에 덧붙음, `handoffs_one_open_other_user_per_order`). 그래서 그 건의 사유와 관련 주문만 보면 신고로 남길 수 있는지 압니다. 관련 주문이 없으면 다른 질문처럼 열린 건 하나(`handoffs_one_open_per_consultation`)를 따릅니다 |
| A39 | 상담 고지 때의 처리방침 버전 | SPEC-018, REQ-140, REQ-257, 설계 재검토 낮음 K2(RC-20), 5절 E33 | AI 상담 고지를 보낼 때 그 가게의 처리방침 가운데 고지 시각에 게시된 가장 큰 버전(`privacy_policies.version`)을 고지 시각과 함께 상담에 씁니다(`consultations.ai_disclosed_policy_version`, 짝은 `consultations_disclosed_policy_chk`). 고지 글의 링크는 가게 처리방침 주소(06단계 API-039)라 늘 가장 최근 버전을 보이므로, 고지 때 게시된 버전은 이 값으로 알고 그 글은 `privacy_policies`의 그 버전 행에 있습니다(외래 키가 ON DELETE RESTRICT라 그 상담이 남은 동안 지우지 못함). 버전을 고르는 주소는 두지 않았습니다([PR #46 Codex 의견](https://github.com/kodonghui/siljang.ai/pull/46#discussion_r4575443540)). 외래 키(`consultations_disclosed_policy_fk`)는 그 가게에 있는 버전인지만 보고, 그때 가장 최근 버전인지는 앱이 봅니다. 이어가는 상담은 고지를 다시 보내지 않아 버전도 그대로입니다(R5) |
| A40 | 결제 기다림 주문 한도 | SPEC-029, SPEC-022, SPEC-023, SPEC-030, SPEC-077, REQ-263~REQ-265, 동희님 2026-11-15 14:19 결정 카드 '가게가 한도를 정함'(설계 재검토 RB-25), 5절 E34 | 기본 디자인 주문 요청의 트랜잭션에서 그 손님 행(`customers`)을 `FOR UPDATE`로 잠그고 이 가게에서 그 손님의 `orders.status = 'awaiting_payment'` 주문을 셉니다. `shops.awaiting_payment_limit`이 0이 아니고 그 수가 한도 이상이면, 그 상담에 사장님이 한도를 넘겨 받은(`handoffs.limit_decision = 'accepted'`) 건 가운데 `limit_accept_expires_at`이 지나지 않고 `limit_used_order_id`가 빈 건이 있을 때만 주문 요청을 남기고 그 건의 `limit_used_order_id`에 그 주문을 씁니다(`handoffs_limit_used_uq`라 하나만). 그런 건이 없으면 주문 요청과 자리를 쓰지 않고 사유 `order_limit`의 에스컬레이션 건을 엽니다(상담마다 열린 한도 건 하나, `handoffs_one_open_limit_per_consultation`). 손님 행을 잠그므로 같은 손님의 주문 요청이 동시에 와도 한도를 넘지 않습니다. 맞춤 주문 요청은 세지 않습니다(사장님이 수락할 때 봄). 마감된 날의 추가 수락(`day_*`, A34)과는 따로 셉니다 |

A33의 키 형식입니다. 키는 가게마다 한 번(키마다 `(shop_id, 키)` UNIQUE)이라 같은 이벤트를 다시 처리해도 처음 행만 남습니다. 들어온 입금의 환불을 정한 뒤 같은 결제 안내에 또 들어온 금액은 셈한 들어온 금액이 다른 새 키의 새 환불로 돌려줍니다(설계 재검토 남은 빈 곳, A29).

| 컬럼 | 형식 | 대상 | 한 번만 | 규칙 테스트 |
| --- | --- | --- | --- | --- |
| `payment_requests.event_key` | `pay:{대상 ID}:{결제 종류}` | 첫 결제(`first`)는 주문, 다시 낸 결제(`reissue`)는 기한이 지난 결제 안내, 차액 결제(`difference`)는 변경 요청 | `payment_requests_event_uq` | G2 같은 이벤트의 결제 안내 둘 |
| `refunds.event_key` | `refund:{대상 ID}:{사유}`, 취소 뒤 들어온 입금·더 들어온 금액은 `refund:{결제 안내 ID}:{사유}:{셈한 들어온 금액}` | 손님 취소·가게 사정 취소는 취소한 주문, 금액이 내려간 변경은 변경 요청, 보상은 문제 신고, 취소 뒤 들어온 입금·더 들어온 금액은 결제 안내와 셈한 들어온 금액(`counted_arrived_amount`). 사유는 `cause` | `refunds_event_uq`와 대상마다 `refunds_cancelled_uq`·`refunds_change_uq`·`refunds_issue_uq`·`refunds_request_uq` | G2 같은 환불을 두 번 정함, M7 다른 이벤트 키로 같은 주문의 취소 환불 둘·같은 변경 요청에 환불 둘·같은 신고에 보상 환불 둘·같은 결제 안내의 같은 들어온 금액에 환불 둘, 남은 빈 곳 앞 환불이 셈한 몫을 다시 돌려줌·앞 환불보다 적게 셈함 |
| `slot_holds.hold_key` | `hold:{주문 ID}:{결제 안내 ID}`, 날짜 변경은 `hold:{주문 ID}:{변경 요청 ID}`, 재제작은 `hold:{주문 ID}:remake` | 자리를 잡은 주문과 그 사유 | `slot_holds_key_uq` | G2 같은 가예약 키 둘 |
| `owner_tasks.event_key` | `task:{만든 이벤트}:{대상 ID}`, 같은 결제 안내에 다시 남긴 '들어옴'의 환불 정할 일은 뒤에 `:{들어온 금액 합}` | 할 일을 만든 이벤트와 그 대상(건·주문·결제 안내·환불 등) | `owner_tasks_event_uq` | G2 같은 이벤트의 할 일 둘 |
| `owner_alerts.event_key` | `alert:{알린 일}:{할 일 ID나 대상 ID}`, 하루 한 번까지인 다시 알림은 뒤에 `:{가게 날짜}` | 알림 종류와 그 대상 | `owner_alerts_event_uq` | G2 같은 이벤트의 사장님 알림 둘 |
| `notifications.event_key` | `notice:{대상 ID}:{안내 종류}` | 손님 안내의 대상(주문·결제 안내·변경 요청 등)과 종류 | `notifications_event_uq` | REQ-154 같은 이벤트의 안내 둘 |
| `ledger_writes.event_key` | `ledger:{대상 ID}:{이벤트 종류}`, 재제작은 `ledger:{대상 ID}:remake:{재제작 주문의 일}` | 그 장부 쓰기를 만든 일의 기록: 주문 확정(`confirmed`)은 주문을 확정한 결제, 변경(`changed`)은 적용된 변경 요청, 환불(`refund`)·환불 보냄(`refund_sent`)은 환불, 결제 확인 취소(`payment_voided`)는 확인을 취소한 결제, 취소(`cancelled`)·인도(`handed_over`)·미수령(`no_pickup`)은 주문(주문마다 한 번뿐인 끝 상태). 재제작은 재제작 주문(그 변경은 변경 요청)과 그 일(`created`·`changed`·`handed_over`·`no_pickup`·`cancelled`). 그래서 같은 주문에 변경이 두 번 있거나 결제 확인 취소 뒤 다른 결제로 주문을 확정하더라도 일마다 한 번씩 적힘 | `ledger_writes_event_uq` | REQ-132 같은 이벤트의 장부 쓰기 둘 |

## 5. 이 단계의 결정 사항

스키마를 확정할 때 함께 정한 결정 사항입니다(2026-11-12 11:56 확정, 10절). 바꾸면 테이블이나 컬럼이 달라지므로 바꿀 때는 새 마이그레이션과 함께 다시 확인 요청합니다.

| 번호 | 결정 사항 | 사유 | 대안과 그 결과 |
| --- | --- | --- | --- |
| E1 | 가게에 딸린 테이블은 모두 `shop_id`를 갖고, 다른 테이블을 `(shop_id, 대상_id)` 복합 외래 키로 참조함. 주문·확인 카드·손님 안내는 상담을 `(shop_id, 상담_id, 손님_id)`로 참조해 손님도 맞는지 보고, 더하는 옵션 연결 테이블은 초안·주문 내용을 `(shop_id, 대상_id, 가격표 버전)`으로, 옵션을 `(가격표 버전, 옵션_id, 무리)`로 참조함(가격표 버전이 가게에 묶여 가게가 섞이지 않음, E30, 2026-11-14 설계 재검토 M17) | 한 가게의 행이 다른 가게의 행을 참조하는 일을 DB가 막음(G1, SPEC-068). 규칙 테스트 G1 2개 | `id`만으로 참조함: 컬럼과 인덱스가 줄지만 가게가 섞인 행을 앱만 막음 |
| E2 | 주문 내용은 버전마다 한 행(`order_details`), 주문 행은 현재 버전의 금액·픽업 일시·가격표 버전을 함께 가짐. 둘이 늘 같음을 지연 외래 키(`orders_current_details_fk`)로 트랜잭션 끝에 확인 | 목록·전날 안내가 주문 행만 읽어도 되고, 이전 버전은 남음(REQ-027). 규칙 테스트 E2 2개 | 현재 버전을 주문 행에 두지 않음: 읽을 때마다 마지막 버전을 찾아야 함 |
| E3 | 인도 시각·미수령 시각은 `productions`에만 두고 주문 행에는 상태만 | 같은 시각을 두 곳에 두지 않음. 2026-11-14 설계 재검토 M9부터 주문 상태와 두 시각의 짝은 커밋 때 트리거가 봄(4절 A27, 11절) | 주문 행에도 둠: 둘이 어긋날 수 있음 |
| E4 | 확인된 결제는 `(결제 안내, 주문, 금액)`으로 결제 안내를 참조함(`payments_match_fk`), 결제 안내마다 하나. 2026-11-13부터 결제 확인을 취소한 것은 빼고 하나(`payments_one_live_per_request`, 11절) | 확인된 결제가 안내한 주문·금액과 다를 수 없음(REQ-081, REQ-153) | 결제 안내 ID만: 금액이 다른 결제를 DB가 받음 |
| E5 | 상담에서 마스킹한 카드번호는 끝 4자리만 남김(`masked_values_card_last4_chk`). 2026-11-13 설계 재검토 H4로 넓힘: 카드번호는 끝 4자리 컬럼(`masked_values.last4`)만 두고(`masked_values_kept_chk`), 주민등록번호처럼 보이는 숫자와 무엇인지 모르는 긴 숫자는 아무것도 두지 않음(`masked_values_last4_chk`, REQ-192, 11절) | 손님이 실수로 보낸 카드번호 전체는 사장님에게도 쓸모가 없고, 남기면 새어 나갈 때 피해가 큼. 전화번호·계좌번호는 원래 값을 그대로 둠(H4부터 암호문으로, E20) | SPEC-021을 글자 그대로: 카드번호 전체를 그 가게 사장님 화면에만 보임. 반론: 끝 4자리만으로는 사장님이 손님에게 어느 카드인지 되물을 때 덜 분명함 |
| E6 | 잡힌 자리는 결제 안내를 참조해야 함(`slot_holds_held_chk`). 그래서 기본 디자인 주문 요청은 주문·첫 버전·동의·결제 안내·자리를 한 트랜잭션으로 쓰고, 맞춤 주문은 수락 때 결제 안내와 자리를 함께 씀 | 자리는 결제 기한까지 잡는데(R13) 그 기한이 결제 안내에 있음. R11의 '한 트랜잭션'을 테이블로 옮김 | 자리에 기한을 따로 둠: 결제 안내와 기한이 어긋날 수 있음 |
| E7 | 퀵 여부 컬럼(`courier_pickup`)을 주문서 초안과 주문 내용에 더함. 말이 없으면 매장 픽업 | REQ-092 오늘 픽업 목록이 퀵 여부를 보이는데 SPEC에 받는 필드가 없었음 | 인도할 때만 고름(`productions.handover_kind`): 오늘 목록에 미리 보이지 않음 |
| E8 | '입금 알리기'는 결제 안내마다 한 번. 사장님이 '미입금'을 고른 시각(`claim_rejected_at`)을 남겨 다시 받지 않음 | SPEC-033과 R14: 거짓 알림으로 자리를 계속 붙잡지 못하게 | 여러 번 받음: 기한이 지나도 자리가 풀리지 않을 수 있음 |
| E9 | 사장님 할 일 목록(TERM-059, 용어집은 CTX-001)을 알림 컨텍스트(CTX-008)의 `owner_tasks` 테이블로 둠 | 에스컬레이션 건만이 아니라 결제·환불·장부·영업 신고·영업 캘린더까지 모으는 목록이라 여러 컨텍스트가 씀. 검사에서 이 하나만 예외로 둠 | 상담(CTX-001)에 둠: 상담이 결제·장부 일까지 알게 됨 |
| E10 | 운영자 알림(이미 다른 가게에 묶인 채널, 처리방침 국외 이전 항목 빔, AI 실패 몰림)은 운영 기록(`ops_events`)의 종류로 둠 | 운영자 화면이 하나뿐이고 손님·주문 기록을 보이지 않음(G1). 건수만 남김. 2026-11-13 설계 재검토 H4부터 운영자는 가게의 상담·주문을 가린 값으로 보고 원래 값은 사유를 적어 엶(SPEC-073, A24). 운영자 알림은 그대로 운영 기록의 종류 | 운영자 알림 테이블을 따로 둠: 테이블이 늘지만 읽음 표시 등을 둘 수 있음 |
| E11 | AI-1의 '우리 로그는 마스킹한 대화만, 30일 보관'은 도구 호출 기록(`ai_tool_calls`, 마스킹한 인자)에 씀: 30일 지난 행을 상담이 열려 있어도 지움(6절 8, 찾는 인덱스 `ai_tool_calls_called_idx`, 설계 재검토 M8로 더함). AI 호출 기록(`ai_calls`)은 숫자와 종류만이라 남겨 상담·가게별 비용을 셈(REQ-150, REQ-163). 대화(`messages`)는 SPEC-065를 따름 | 비용 기록에는 대화 글이 없어 지울 이유가 없음 | `ai_calls`도 30일 뒤 지움: 상담별 비용을 30일 넘게 볼 수 없음 |
| E12 | 가게 규칙이 '안 됨'을 준 견적(마감된 날, 맞지 않는 옵션)은 `quotes`에 남기지 않음. 견적 행은 금액이 있는 것만 | 견적은 금액·유효 기한을 손님에게 안내한 기록(TERM-013) | 안 된 견적도 남김: 견적 행 대부분이 비게 됨 |
| E13 | 영업 신고 확인은 마지막 상태·이유·운영자·시각만 `shops`에 둠 | 첫 버전 범위(SPEC-003). 운영자가 예약 링크를 회수하는 기능(M7)도 첫 버전에 없음 | 확인 이력 테이블을 둠: 다음 버전에서 마이그레이션으로 더할 수 있음 |
| E14 | 픽업 장소(`shops.pickup_address`)를 더하고 비워 둘 수 있게 둠 | SPEC-052 전날 안내가 가게 위치를 포함하는데 가게 등록 필드(SPEC-002)에 없음. 등록 플로우를 바꾸지 않고 가게 설정에서 받음 | 등록 때 꼭 받음: SPEC-002가 바뀜. 비었을 때 예약 링크를 막을지는 06단계 API에서 정함 |
| E15 | 주문(`orders`)과 변경 요청(`change_requests`)에 잠금 번호(`lock_version`)를 두고 그 행을 쓸 때마다 하나 올림. 쓰기는 읽은 잠금 번호와 같을 때만 하고, 0행이면 다시 읽어 지금 상태로 판단함(4절 A6). 06단계 주문·변경 요청의 `revision`(DEC-05, 명령의 `baseRevision`과 견줌)이 이 값. 2026-11-13 설계 재검토 H12로 더함(11절) | 내용 버전(`version`)은 상태만 바뀌는 쓰기(결제 확인·취소·받음)에서 오르지 않아, 같은 버전을 읽은 결제 확인과 손님 취소가 둘 다 조건에 맞아 늦은 쪽이 덮어썼음(RC-01, 8절 D5가 재현). 쓸 때마다 오르는 값은 화면·카드가 읽어 둔 값과 견줄 수 있어 DEC-05와 같은 값을 쓰고, PostgreSQL은 같은 행의 늦은 쓰기를 먼저 쓴 쪽의 커밋까지 기다렸다가 조건을 새 행으로 다시 보아 0행으로 끝냄(D5) | 행 잠금(`SELECT … FOR UPDATE`)만 씀: 한 요청 안의 읽기와 쓰기는 차례가 되지만, 화면이나 카드가 예전에 읽은 상태로 보낸 요청은 막지 못하고(잠금은 요청이 끝나면 풀림) DEC-05가 견줄 값이 없음. 여러 행을 함께 쓰는 곳(A2 환불 합, A3 하루 최대 개수)은 지금처럼 행 잠금도 함께 씀 |
| E16 | 가게 봇의 버튼 블록 ID 넷을 `kakao_channels`의 text 컬럼 넷(`card_block_id`·`orderer_block_id`·`depositor_block_id`·`review_block_id`)에 두고, 시험 버튼으로 닿은 블록은 이름 배열(`verified_blocks`)로 둠. 연결됨이면 넷이 모두 있고 모두 닿음(`kakao_channels_blocks_chk`). 2026-11-13 설계 재검토 H8로 더함(11절) | 카드 버튼의 블록 ID는 봇마다 달라 가게마다 받아야 하고(RD-04), 버튼이 넷으로 정해져 있음. 컬럼이면 넷 모두 있음을 CHECK가 보고 06단계 입력의 필드와 하나씩 맞음 | 블록 ID를 JSON 하나에 둠: 넷 모두 있음을 데이터베이스가 보지 못함. 블록 테이블을 따로 둠: 블록이 늘 넷이라 행 사이 규칙만 늘어남 |
| E17 | 사장님 알림 받는 곳을 `owners.kakao_account_id`(카카오 로그인 사용자 번호, Event API의 appUserId)로 하고, 채울 길이 없던 `alert_user_key`를 지움. 친구 여부(`alert_channel_friend`)는 로그인 때의 채널 관계 조회와 발송 결과로 고치고 본 시각(`alert_friend_checked_at`)을 둠. 2026-11-13 설계 재검토 H7로 바꿈(11절) | 우리 서비스 채널의 사용자 키는 우리 채널 봇이 스킬 요청을 받아야 알 수 있는데 그 길이 없었음(RD-10). 우리 앱에 연결한 우리 채널은 카카오 로그인 사용자 번호로 보낼 수 있어 로그인 때 이미 받은 값을 씀(카카오 비즈니스 도움말 Event API, 2026-11-13 다시 읽음) | 사장님이 우리 채널에 코드를 보내 사용자 키를 잇게 함: 할 일이 하나 늘고 그 스킬 API가 새로 필요함. 알림을 할 일 목록에만 둠: 사장님이 알림을 받지 못함(이 길은 친구가 아닐 때의 대안으로 남김) |
| E18 | 손님 안내(`notifications`)와 사장님 알림(`owner_alerts`)에 카카오 taskId·요청 시각·결과 조회 시각·전하지 못한 사유를 두고, '발송 결과 확인 중'(`confirming`)을 거쳐 닿음을 확인한 뒤에만 보냄으로 씀. 확인 중·보냄이면 taskId가 꼭 있음(`*_kakao_task_chk`). 2026-11-13 설계 재검토 H7로 더함(11절) | Event API는 요청을 받았다는 답(taskId)만 바로 주고, 친구가 아니어서 못 받은 것은 결과 조회로만 알 수 있음. 받음을 보냄으로 쓰면 친구가 아닌 손님의 안내가 다음 대화 때 전해지지 않음(RD-01) | 받은 답만 보고 보냄으로 씀: 못 받은 안내를 놓침. 결과 조회 기록을 따로 둠: 첫 버전은 마지막 조회만 있으면 돼 컬럼으로 둠 |
| E19 | 보관과 지우기를 상담과 주문에 나눔: (1) 상담이 다룬 주문이 모두 끝나면 상담을 끝내고(`consultations.status = 'ended'`, `ended_at`) 손님의 다음 말은 새 상담으로 받아, 대화마다 어느 주문의 것인지 상담으로 갈림. (2) 주문은 끝난 시각(`orders.finished_at`)부터 30일 뒤 개인정보 컬럼을 비우거나 지우고, 주문자 이름과 보관 기간을 보관 기록(`kept_records`, TBL-052)으로 나눔. 계약·결제 기록은 5년, 문제 신고 기록은 3년(잠정, 5-2 질문 7의 답으로 다시 봄). (3) 사장님 알림은 지우지 않고 할 일과의 연결만 비움. (4) 상담이 모두 지워지고 주문이 모두 보관 기록이 된 손님의 카카오 사용자 키를 지움(`customers.purged_at`). 2026-11-13 설계 재검토 H3으로 더함(11절) | 손님마다 상담이 하나뿐이고 메시지에 주문이 없어, 주문이 하나라도 있는 손님의 대화는 지울 수 없었고 주문의 개인정보는 지우는 때가 없었음(RC-02, RB-09, RA-06). 입금자 이름·카드 내용·변경 내용·신고 설명·안내 글·문구·디자인 설명·카카오 사용자 키도 지우는 목록에 없었음(RC-04). 묶인 사장님 알림이 에스컬레이션 할 일을 참조해 6절의 지우는 차례가 막혔음(RC-03). 전자상거래법 시행령 제6조①(계약·청약철회와 대금결제·공급 기록 5년, 불만·분쟁 처리 기록 3년)과 개인정보 보호법 제21조①(지체 없이 파기)·③(보존할 개인정보는 나누어 저장), 2026-11-15 원문과 대조함(requirements.md 13절) | 메시지마다 주문 컬럼을 둠: 주문 전 말이나 여러 주문을 함께 말한 메시지가 어느 주문의 것인지 정할 수 없음. 5년 보관을 가게 장부(구글 시트)에만 맡김: 장부는 가게 것이라 우리가 보관 기간을 지키는지 보일 수 없음. 보관 기록을 다른 스키마나 데이터베이스로 옮김: 지금 데이터와 물리적으로 나뉘지만 결제·환불·신고 행을 옮기는 길과 그 사이의 외래 키가 늘어남. 반론: 지금은 표시와 앱 규칙(4절 A22)으로 나누므로 앱이 실수하면 보관 기록이 화면에 보일 수 있음 |
| E20 | 계좌번호(가게 계좌·환불 계좌)와 마스킹 원본 값(전화번호·계좌번호)은 앱이 AES-256-GCM(256비트 키, 값마다 새 12바이트 nonce, 16바이트 태그)으로 암호화해 text 봉투 `v키버전:base64url(nonce‖암호문‖태그)`로 둠(`payment_accounts.account_number_enc`, `refunds.refund_account_enc`, `masked_values.original_enc`). 끝 4자리는 따로 둠(`*_last4`). 같은 값 찾기는 원래 값 대신 다른 비밀 키의 HMAC-SHA256(`masked_values.value_hmac`). 키는 시크릿 저장소에만 두고(REQ-135) 키 버전을 봉투에 적어 바꿀 수 있게 함. 데이터베이스는 봉투 모양만 CHECK로 보고, 평문 형식 CHECK는 06단계 API 검증으로 옮김. 2026-11-13 설계 재검토 H4로 더함(11절) | 「개인정보의 안전성 확보조치 기준」 제7조②는 이용자의 계좌번호·신용카드번호 등을 안전한 암호 알고리즘으로 암호화해 저장하라고 함(REQ-191, 2026-11-13 law.go.kr 원문). 앱 쪽 암호화는 데이터베이스 백업·덤프·운영자 쿼리에도 평문이 없고, 키가 데이터베이스 밖에 있어 데이터베이스만 새어도 풀리지 않음. GCM은 암호문이 바뀌면 복호화가 실패해 위·변조를 앎. 전화번호는 그 조항의 항목이 아니지만 같은 행(마스킹 원본 값)이라 같이 암호화함 | 데이터베이스 안의 pgcrypto(`pgp_sym_encrypt`): 키가 쿼리와 데이터베이스 로그로 지나가고 키와 암호문이 같은 서버에 있음. 디스크 암호화만: 데이터베이스에 접속한 사람과 덤프에는 평문이 보여 제7조②를 채우지 못함. bytea 컬럼: 몇 바이트 짧지만 키 버전을 따로 둬야 하고 봉투 모양을 CHECK로 보기 어려움. 반론: 앱이 키를 잃으면 계좌번호를 되살릴 수 없음(키 보관과 바꾸기는 10단계 배포에서 정함) |
| E21 | 접속기록을 새 테이블 `access_logs`(TBL-053, 공통)에 둠: 사장님·운영자가 손님 개인정보를 읽거나 바꾸거나 연 요청마다 한 행(누가·언제·어디서·어느 가게의 어느 손님·무엇을, 운영자가 열면 사유와 대상). 2년이 지나면 지우기의 여섯째 차례가 지움. 고치기·지우기·비우기는 트리거 `access_logs_guard`가 막고 2년 지난 행 지우기만 받음. 대상 ID에는 외래 키를 두지 않음. 2026-11-13 설계 재검토 H4로 더함(11절) | 같은 고시 제8조①은 접속기록을 1년 이상(민감정보를 처리하면 2년 이상) 두고, ③은 위·변조·도난·분실을 막으라고 함(REQ-196). 알레르기 답이 민감정보일 수 있어(5-2 질문 4) 2년으로 둠. 사장님 화면도 손님 개인정보를 보이므로 사장님 접속도 함께 남겨 분쟁 때 누가 언제 봤는지 가림. 트리거는 스키마에 있어 마이그레이션과 규칙 테스트(D4)로 보이고 어느 계정으로 써도 막음. 대상 행은 30일·3년·5년 뒤 지워지는데 접속기록은 2년 남아야 해서 외래 키를 두지 않음 | 데이터베이스 권한(앱 계정에 넣기만 허용): 역할과 권한은 배포 환경에서 만들어 이 스키마와 테스트로 보이지 않음. 함께 쓰면 더 좋아 10단계 배포에서 앱 계정 권한도 줄이기를 권함. 로그 파일이나 외부 로그 서비스: 처리를 맡기는 곳이 하나 늘고 응답과 같은 트랜잭션으로 묶을 수 없음. 운영자 접속만 남김(bundles.md H4의 글자): 사장님 쪽 열람을 가리지 못함 |
| E22 | 알레르기 정보 동의는 초안과 주문 내용 버전의 컬럼 셋(동의의 답·동의 글 버전·시각)으로 두고, 동의 없는 알레르기 답을 CHECK로 막음(`order_drafts_allergy_answer_chk`, `order_details_allergy_answer_chk`). 동의 단계를 끄는 것은 배포 설정이라 컬럼이 없고 답은 '동의 필요 없음'. 사진 게시 동의는 완성 사진·후기 사진 한 장마다 한 행이고, 포트폴리오 항목은 `(shop_id, photo_consent_id, consent_live)`로 동의의 `(shop_id, id, publishable)`을 참조해 동의함·철회 안 함인 동안만 올라 있음. 사진과 동의의 짝도 복합 외래 키로 봄 | 설계 재검토 H5(RA-02)·H10(RE-01, RA-14, RB-16, RC-11): 알레르기 정보를 따로 동의받았는지와 동의한 사진만 올라 있는지를 앱만이 아니라 데이터베이스가 지킴. 동의는 초안마다 한 번이라 그 행에 두면 '동의 없는 답'을 한 행의 CHECK로 막을 수 있음. 잠정, 5-2 질문 4·6 | 동의를 따로 테이블로 둠: 동의와 답이 다른 행이라 동의 없는 답을 CHECK로 막지 못함. 철회 때 트리거가 올라 있는 항목을 내림: 숨은 쓰기가 생기고 다이어그램에 보이지 않음. 앱만 봄: 화면을 거치지 않은 쓰기를 막지 못함 |
| E23 | 결제 안내에 손님에게 전해진 시각(`payment_requests.delivered_at`)과 낼 때 정하는 결제 기한 상한(`due_cap_at`)을 두고, 결제 기한(`due_at`)은 둘로 계산한 값을 씀. 기한이 상한을 넘거나 전해지기 전인데 상한과 다르면 CHECK로 막음(`payment_requests_due_cap_chk`, `payment_requests_delivered_chk`). 2026-11-14 설계 재검토 M2로 더함(11절) | 설계 재검토 M2(RB-08, RE-08, RA-10): 결제 기한을 낸 시각부터 세면 친구가 아니어서 전하지 못한 동안 기한이 흘러 손님이 보기도 전에 자리가 풀림. 전해진 때부터 세되 그날 주문 마감을 넘지 않아야(REQ-218) 다른 손님이 그날 자리를 오래 기다리지 않음. 상한을 낼 때 정해 두면 운영규정이나 주문 마감을 나중에 바꿔도 이미 나간 안내의 상한이 그대로이고, 기한 처리 작업과 확인 요청됨의 끝(REQ-223)이 같은 값을 봄 | 결제 기한만 두고 앱이 상한을 매번 계산: 운영규정 버전과 픽업 날짜를 다시 읽어야 하고 바뀐 규정이 이미 나간 안내에 닿음. 전해진 시각을 `notifications`에서 찾음: 결제 안내 하나에 손님 안내가 여러 행이라 처음 전해진 때를 한 값으로 보지 못함. 낸 시각부터 세되 기한을 길게 둠: 대화 중인 손님의 자리도 오래 묶임 |
| E24 | 지우기가 지운 참고 사진·신고 사진의 저장 위치를 새 테이블 `file_deletions`(TBL-054, 공통)에 그 사진 행을 지우는 트랜잭션에서 함께 넣고, 저장소에서 파일을 지운(이미 없는 파일 포함) 뒤에만 그 행을 지움. 실패하면 실패 횟수와 시각(`attempts`, `last_tried_at`, 둘은 함께 `file_deletions_tried_chk`)을 남기고 다음 날 다시. 같은 파일은 한 행(`file_deletions_key_uq`). 2026-11-14 Codex 후속으로 더함(11절) | 사진 행을 지운 뒤 저장소가 실패하거나 작업이 멈추면 저장 위치가 어디에도 남지 않아 '다음 날 다시 지움'을 할 수 없고, 손님 사진 파일이 보관 기간을 넘어 남음([PR #30 의견](https://github.com/kodonghui/siljang.ai/pull/30#discussion_r4567801476)) | 사진 행에 지운 표시만 두고 파일을 지운 뒤 행을 지움: 사진 행을 읽는 곳마다 지운 표시를 걸러야 하고 지우는 차례(6절)가 이틀에 걸침 |
| E25 | 손님의 새 금액 확인은 결제 안내의 컬럼 넷(`payment_requests.needs_amount_confirm`·`amount_confirmed_at`·`amount_declined_at`·`amount_card_id`)으로 둠. 확인한 시각을 전해진 시각으로 써서 결제 기한이 그때부터 흐르고(5절 E23), 확인 전에는 결제 확인 요청·확인됨이 없고 받지 않으면 닫힘을 CHECK 여섯이 봄. 2026-11-14 설계 재검토 M5로 더함(11절) | 설계 재검토 M5(RA-08, RE-17): 사장님이 다른 금액으로 수락하면 손님이 그 금액을 받아들이기 전에 계좌와 결제 기한이 나가 손님이 모르는 금액을 기한 안에 내야 했음. 확인은 결제 안내 하나에 한 번이고 그 결과가 결제 기한·결제 확인 요청과 같은 행에 있어야 확인 전의 쓰기를 한 행의 CHECK로 막을 수 있음. 맞춤 주문의 첫 결제와 변경의 차액 결제가 같은 길을 씀 | 변경 요청에 확인 상태를 둠: 맞춤 주문의 금액 확인을 담지 못하고 차액 결제 안내와 어긋날 수 있음. 확인을 따로 테이블로 둠: 결제 안내와 다른 행이라 확인 전 결제 확인 요청을 CHECK로 막지 못함. 확인 없이 결제 안내만 냄(지금까지): 손님이 동의하지 않은 금액이 결제 기한과 함께 흐름 |
| E26 | 날짜를 바꾸고 금액이 오르는 변경의 차액을 기다리는 동안 한 주문에 옛 날의 확정된 자리와 새 날의 잡힌 자리를 함께 둠. 주문마다 살아 있는 자리 하나를 잡힌 자리 하나·확정된 자리 하나(부분 UNIQUE 둘)로 나누고, 둘이 함께 있는 것은 잡힌 자리가 차액 결제 안내를 가리킬 때만(트리거 `slot_holds_pair`). 2026-11-14 설계 재검토 M5로 더함(11절) | 설계 재검토 M5(RB-07): 차액을 기다리는 동안 옛 날 자리를 풀면 손님이 차액을 내지 않을 때 원래 날짜도 잃고, 새 날을 잡지 않으면 차액을 낸 뒤 그날이 다 차 있을 수 있음. 자리 상태(1-4)와 그날 자리 세기(A3)를 바꾸지 않고 두 자리를 각각 세어 그날 하루 최대 개수가 그대로 지켜짐 | 옛 자리를 풀고 새 자리만 잡음: 차액을 내지 않으면 원래 주문의 날을 지킬 수 없음. 차액이 확인될 때 새 날을 잡음: 그 사이 새 날이 다 찰 수 있음. 자리 행에 '변경 기다림' 상태를 더함: 1-4 상태 머신과 그날 자리 세기 인덱스가 바뀜 |
| E27 | 사장님·운영자 화면의 요청 키(`request_keys`, TBL-050)에 요청 지문(`request_hash`: 명령·경로의 ID·본문을 정한 차례로 이어 시크릿 저장소의 키로 만든 HMAC-SHA256)과 처리 상태(`state`, 처리 중의 기한 `processing_expires_at` = 받은 때 + 60초), 끝났을 때의 처음 결과(`response_status` 200~499·`response_code`·`response_ref`)와 끝난 시각을 두고, 처음 결과 본문(`response_body`)은 두지 않음. 같은 키에 지문이 다르면 422 `idempotency_key_reused`, 처리 중이면 409 `request_in_progress`, 끝났으면 같은 상태 코드와 `response_ref`가 가리킨 기록을 지금 읽은 본문(06 DEC-04). 입력 검사 실패(422)·서버 오류(5xx)는 남기지 않고 처리 중 행을 지움. 기한이 지난 처리 중 행은 같은 키·같은 지문의 다음 요청이 이어받음. 24시간 뒤 지우기(6절 7)가 지움. 2026-11-14 설계 재검토 M7로 바꿈(11절) | 설계 재검토 M7(RC-16): 06 DEC-04는 같은 키에 다른 내용 422, 처리 중 409, 다시 오면 처음 결과를 약속했지만 이 테이블에는 요청 지문과 처리 상태가 없고 처음 결과의 ID와 상태만 있어 셋 다 지킬 수 없었음. 처음 결과 본문을 두면 이름·연락처·원래 값 같은 개인정보가 지우기(6절) 밖에 남음 | 처음 결과 본문을 그대로 둠: 다시 보낸 요청에 처음과 같은 바이트를 주지만 개인정보가 요청 키에 복사되고 그것을 따로 지워야 함. 지문 없이 키만 봄: 다른 내용을 같은 키로 보내면 처음 결과를 잘못 돌려줌. 처리 중 기한 없음: 처리하던 서버가 멈추면 그 키가 계속 409 |
| E28 | 열린 에스컬레이션 건에 덧붙은 질문을 새 테이블 `handoff_questions`(TBL-055, CTX-001)의 행으로 두고(사유·손님 말·관련 주문, 같은 말은 한 번), 마감된 날 질문은 덧붙이지 않고 상담과 날짜마다 따로 건(`handoffs_one_open_day_per_consultation`)으로 둠. 추가 수락은 그 건의 날짜에 24시간 안의 주문 요청 하나에만 쓰고 그 주문 요청을 `handoffs.day_used_order_id`(하나만)로 남김. 2026-11-14 설계 재검토 M17로 더함(11절) | 설계 재검토 M17(RC-08): 덧붙은 질문은 행이 없어 사유·관련 주문을 남길 곳이 없었고, 열린 건에 덧붙은 마감된 날 질문은 그 날짜와 추가 수락을 기록할 수 없었음(건마다 날짜 하나). 추가 수락을 쓴 주문을 남기지 않으면 한 번의 추가 수락으로 24시간 동안 몇 번이고 넘겨 받을 수 있음(4절 A3, 마감 후 추가 수락 확인과 이음) | 덧붙은 질문을 에스컬레이션 건의 배열 컬럼으로: 외래 키를 걸 수 없음. 마감된 날 질문도 덧붙이고 날짜·결정을 질문 행에: 건 하나에서 날짜마다 따로 고르는 화면과 API가 필요하고 열린 건 하나 규칙과 어긋남. 추가 수락을 24시간 동안 여러 번 씀: 사장님이 받은 수보다 많이 넘겨 받음 |
| E29 | 환불은 대상마다 하나를 이벤트 키와 따로 UNIQUE로 봄: 취소 환불은 취소한 주문(`refunds.cancelled_order_id`, 그 주문이나 그 재제작 주문)마다, 금액이 내려간 변경의 환불은 변경 요청마다, 보상은 문제 신고마다, 들어온 입금의 환불은 결제 안내마다. 주문은 그 주문을 확정한 결제(`orders.confirmed_payment_id`)를 가리키고 주문 확정 뒤 상태면 꼭 있으며(재제작 주문은 뺌) 그 결제의 확인 취소는 주문을 결제 기다림으로 돌릴 때만 됨(지연 제약 트리거). 이벤트 키의 형식은 4절 A33. 2026-11-14 설계 재검토 M7로 더함(11절) | 설계 재검토 M7(RD-05, RC-06): 환불·결제의 '한 번만'을 이벤트 키의 `(shop_id, 키)` UNIQUE에만 맡기면 키를 다르게 지은 두 쓰기(다시 시도, 다른 작업)가 같은 대상에 환불 둘을 남길 수 있었고 키 형식도 정해지지 않았음. 주문 확정이 어느 결제로 됐는지 남지 않아 결제 확인을 취소한 뒤에도 주문 확정이 남을 수 있었음 | 키 형식만 정함: 앱이 형식을 어기면 데이터베이스가 막지 못함. 환불을 주문마다 하나: 재제작 주문의 취소 환불을 원래 주문에 남기므로(A31) 원래 주문과 재제작 주문의 취소가 함께 막힘. 확정을 결제 행에만 표시: 주문의 상태와 결제를 한 행의 CHECK로 잇지 못함 |
| E30 | 주문서 초안의 픽업 일시(`pickup_at`)를 날짜(`pickup_day`)와 비울 수 있는 시각(`pickup_time`)으로 나누고(날짜 없이 시각만은 막음), 더하는 옵션 uuid 배열 둘을 연결 테이블 `order_draft_extras`(TBL-056)·`order_detail_extras`(TBL-057)로 옮겨 초안·주문 내용과 같은 가격표 버전의 '더하는 옵션'만 외래 키로 받음. 주문·확인 카드·손님 안내는 상담을 (가게, 상담, 손님)으로 참조함(`consultations_customer_key`). 초안의 가격표 버전을 바꾸려면 앱이 그 초안의 더하는 옵션 행을 먼저 지움. 2026-11-14 설계 재검토 M17로 바꿈(11절) | 설계 재검토 M17(RC-13, RC-12): 날짜만 들은 초안을 timestamptz 하나로는 남길 수 없어 시각을 지어내야 했고, uuid[]에는 외래 키가 없어 다른 가게·다른 가격표 버전의 옵션이 들어갈 수 있었으며, 주문의 손님과 상담의 손님이 같은지 데이터베이스가 보지 않았음 | 픽업 일시에 자정 같은 값을 넣고 '시각 모름'을 따로 표시: 값과 뜻이 갈라짐. 배열을 트리거로 봄: 옵션을 지우거나 가격표를 바꿀 때마다 배열을 다시 봐야 함. 상담의 손님을 앱만 맞춤: 다른 손님의 상담에 주문이 붙을 수 있음 |
| E31 | 가게 신원 정보를 `shops` 컬럼 셋(`business_address`·`contact_email`·`mail_order_authority`, 신고번호와 기관은 함께 `shops_mail_order_authority_chk`)으로 더하고, 상호·대표자·사업자등록번호의 변경은 새 테이블 `shop_identity_changes`(TBL-058, CTX-007)에 새 값·요청할 때의 값·증빙 사진·상태(확인 기다림·반영함·보류)로 두며 가게마다 확인 기다림은 하나(`shop_identity_changes_one_pending`). 2026-11-14 설계 재검토 M11·M14로 더함(11절) | 설계 재검토 M11(RA-05): 예약 링크 페이지의 가게 신원 정보가 전자상거래법 제13조①의 항목보다 적었음. M14(RB-12): 등록 뒤 가게 정보를 고치는 길이 없었고, 상호·대표자·사업자등록번호는 영업 신고 확인(REQ-197)과 예금주 규칙(REQ-199)이 기대는 값이라 바로 고치면 운영자 확인을 비켜 감 | `shops`에 '바꿀 값' 컬럼을 둠: 요청이 하나뿐일 때는 되지만 보류 이유·증빙·지난 값이 덮여 무엇을 언제 바꿨는지 남지 않음. 사장님이 바로 고치고 영업 신고를 다시 확인 기다림으로 둠: 확인되기 전에 예약 링크 페이지·확정 안내가 확인되지 않은 값을 보이고 예약 링크가 멈춤 |
| E32 | 에스컬레이션 건에서 사장님이 남긴 문제 신고는 `issue_reports`에 신고한 사람(`reported_by`: 주문자·사장님이 에스컬레이션 건에서 남김)과 그 건(`handoff_id`)으로 두고 신고 카드(`card_id`)는 비우며(`issue_reports_reporter_chk`), 그 건의 관련 주문이 신고의 주문과 같은지는 `(shop_id, handoff_id, order_id)` → `handoffs (shop_id, id, order_id)` 외래 키로 봄(대상으로 `handoffs_order_scope` UNIQUE를 더함). 이 외래 키도 `RESTRICT`이고, 상담을 지울 때(6절 2) 그 건을 지우기 전에 신고의 `handoff_id`를 비움. 문제 종류·보상 없음의 사유·그 밖의 보상(한 일·금액)은 `issue_reports` 컬럼으로 두고, 사유와 한 일은 3년 뒤 신고 설명과 함께 비움(`notes_purged_at`). 관련 주문이 있는 다른 카카오 사용자의 사정은 다른 열린 건에 덧붙이지 않고 상담과 주문마다 따로 건으로 둠(`handoffs_one_open_other_user_per_order`, 열린 건 하나 인덱스 `handoffs_one_open_per_consultation`에서 뺌). 2026-11-14 설계 재검토 M12로 더함(11절) | 설계 재검토 RB-15(Claude 추천, 동희님 확인 요청. 2026-11-15 14:19 동희님 결정 카드 '지금대로 둠 (추천)'으로 확정함): 주문자가 아닌 사람(예: 선물로 받은 사람)의 문제를 받을 길이 없었고, 신고 카드는 주문자에게만 가므로 그 신고에는 카드가 없음. RA-13: 상함·변질·이물에 보상 없음을 고를 때 기준을 본 뒤의 사유가 남아야 하고, 그 밖의 보상은 돈이 오가지 않을 수도 있어 환불 행으로 둘 수 없음. 다른 카카오 사용자의 사정이 다른 사유의 열린 건에 덧붙은 질문으로 남으면 그 건의 사유·관련 주문이 달라 그 건에서 신고로 남길 수 없었음([PR #40 Codex 의견](https://github.com/kodonghui/siljang.ai/pull/40#discussion_r4573944173)) | `ON DELETE SET NULL`: 지우기 차례가 한 줄 줄지만 외래 키가 모두 `RESTRICT`라는 6절의 규칙이 깨지고, 열을 고르지 않으면 `shop_id`·`order_id`(NOT NULL)까지 비우려다 실패함(열을 고르는 문법은 PostgreSQL 15부터이고, 다이어그램 도구가 담는지는 보지 않음). 사장님 대신 신고 카드를 만듦: 손님이 누르지 않은 카드가 생겨 카드의 뜻이 흐려짐. 따로 둔 신고 테이블: 보상·환불·할 일이 참조하는 신고가 둘로 나뉨. 그 밖의 보상을 환불(`refunds`)로: 돈이 오가지 않은 보상에도 환불·장부 행이 생김. 덧붙은 질문에서도 신고로 남김: 신고의 주문을 질문 행에서 찾아야 해 외래 키를 질문 행으로 옮기고 건 하나에 신고가 여럿이 됨 |
| E33 | AI 상담 고지 때 게시된 처리방침 버전을 상담에 남김(`consultations.ai_disclosed_policy_version`, 그 가게의 버전을 가리키는 외래 키 `consultations_disclosed_policy_fk`, 고지 시각과 짝 `consultations_disclosed_policy_chk`, 4절 A39). 가게의 위탁 동의(`shops.entrustment_terms_version`·`entrustment_consented_at`)는 지금처럼 마지막 버전·시각만 두고, 다시 동의하면 앞 동의가 덮이지 않게 동의마다 이력 행(새 테이블)으로 두는 것은 다음 마이그레이션 후보: 위탁 조건이 처음 바뀌어 다시 동의를 받기 전에 더함(2026-11-15 설계 재검토 낮음 K2, RC-20, 검토자의 고치는 방향대로) | 나중에 '그때 무엇을 알렸나'를 시각으로 미루지 않고 버전으로 바로 앎(주문의 규정 동의가 버전을 남기는 것과 같은 꼴, REQ-055). 위탁 조건은 첫 버전에서 하나뿐이라 아직 덮일 지난 동의가 없음 | 고지 시각만: 처리방침 게시 시각과 견줘 미뤄야 함. 위탁 동의 이력 테이블을 지금 더함: 쓰는 행이 없는 테이블이 하나 늘어남 |
| E34 | 한 손님의 결제 기다림 주문 한도는 가게 설정 컬럼(`shops.awaiting_payment_limit`, 0~10건, 기본 2건, 0이면 한도 없음)으로 두고, 한도에 닿은 기본 디자인 주문 요청은 사유 `order_limit`의 에스컬레이션 건으로 둠. 사장님의 결정(`limit_decision`)·넘겨 받은 24시간(`limit_accept_expires_at`)·그것을 쓴 주문 요청(`limit_used_order_id`, UNIQUE)은 마감된 날의 추가 수락(`day_*`, 설계 재검토 M17)과 같은 꼴의 컬럼으로 에스컬레이션 건에 둠(4절 A40). 한도 건은 열린 건에 덧붙이지 않음(`handoffs_one_open_limit_per_consultation`). 2026-11-15 동희님 결정 반영으로 더함(11절) | 동희님 2026-11-15 14:19 결정 카드 '가게가 한도를 정함'(설계 재검토 RB-25): 결제 전 주문으로 여러 날 자리를 붙잡는 것을 가게가 정한 수로 막고, 사장님이 확인하면 한 번 넘길 수 있게 함. 추가 수락과 같은 꼴이라 화면·계약(SCR-017, API-042)도 같은 방식 | 한도를 우리 서비스의 설정 하나로만 두기: 가게마다 다르게 정하지 못함. 한도 건을 열린 건의 덧붙은 질문으로 두기: 덧붙은 질문에는 사장님 결정이 남지 않아 넘겨 받기·받지 않음과 그것을 쓴 주문 요청을 알 수 없음 |

## 6. 지난 기록 지우기의 차례 (SPEC-065)

하루 한 번 03:00에 아래 여덟 차례를 차례대로 돌고 끝에 저장소의 사진 파일을 지우며, 두 번 돌아도 결과가 같고, 중간에 멈추면 다음 날 이어서 지웁니다. 외래 키가 모두 `RESTRICT`(트랜잭션 끝으로 미룰 수 없음)라 참조하는 행부터 지우고, 차례가 어긋나면 그 문장이 바로 실패합니다. 30일·3년·5년은 잠정이고 5-2 질문 7의 답으로 다시 봅니다(REQ-185~188). 규칙 테스트의 `pg_temp.purge_run(시각)`이 이 차례를 그대로 써서 8절 D4가 돌려 봅니다.

**1. 끝나고 30일 지난 주문**(`orders.finished_at`이 30일 지남, `personal_data_purged_at` 없음. 끝나지 않은 재제작 주문이 있는 원래 주문은 `finished_at`이 없어 들지 않음, 4절 A22)마다 한 트랜잭션으로(REQ-185, REQ-187):

1. 보관 기록 `kept_records` 한 행: 주문자 이름(주문 내용의 이름이 있는 마지막 버전에서), 끝난 시각, 계약·결제 기록을 둘 때까지(5년), 그 주문에 문제 신고가 있으면 신고 기록을 둘 때까지(3년). 주문자 정보가 없는 재제작 주문은 이름이 비고 원래 주문의 보관 기록에 있음
2. `order_details`(모든 버전)와 그 주문이 된 `order_drafts`에서 주문자 이름·연락처·알레르기 답·빼야 할 재료·문구·디자인 설명을 비움. 알레르기 정보 동의의 답·동의 글 버전·시각은 동의를 받은 근거라 남김(REQ-201)
3. 그 초안의 `reference_photos`. 지우는 문장에서 그 저장 위치를 `file_deletions`에 넣고(5절 E24), 파일은 끝의 차례에서 지움
4. `payment_requests.depositor_name`(비교해 쓰는 번호를 올림)과 `refunds`의 환불 계좌(은행·암호문·끝 4자리·예금주)를 비움
5. 그 주문과 그 초안의 `confirm_cards.payload`, `change_requests.changes`(잠금 번호를 올림)는 빈 객체(`{}`)로, 그 주문의 할 일 `owner_tasks.detail`은 빈 값으로
6. 그 주문의 `notifications`(안내 글을 담은 행)
7. `orders.personal_data_purged_at`을 쓰고 잠금 번호를 올림

남는 것: 주문 행, 주문 내용 버전의 나머지(옵션·금액·픽업 일시·가격표 버전, 알레르기 정보 동의 기록), 동의한 운영규정 버전, 결제 안내·결제·환불·변경 요청 행, 자리, 제작, 장부 행, 문제 신고와 그 설명·사진·보상 없음의 사유·그 밖의 보상의 한 일(3년까지).

**2. 닫히고 30일 지난 상담**(문의 끊김 `dropped_at`이나 상담 끝남 `ended_at`이 30일 지남, 열린 에스컬레이션 건 없음, 다룬 주문이 모두 1을 지남. 다룬 주문에는 추가 수락을 쓴 주문 요청과 덧붙은 질문의 관련 주문도 듦)마다 한 트랜잭션으로(REQ-186):

1. 그 상담의 에스컬레이션 건 할 일을 참조하는 `owner_alerts`는 `owner_task_id`만 비움. 알림 행은 글이 없어 남고, 묶인 알림(`batched_into_id`)이 같은 테이블을 참조해도 지우는 차례가 막히지 않음(RC-03)
2. 에스컬레이션 건의 `owner_tasks`와 덧붙은 질문 `handoff_questions` → 그 건에서 사장님이 남긴 문제 신고는 연결(`issue_reports.handoff_id`)만 비움(신고는 받은 주문의 기록이라 3까지 남음, 5절 E32) → `handoffs`
3. 주문이 되지 않은 초안의 `confirm_cards`와 `quotes`
4. 그 상담 초안의 `reference_photos`(저장 위치는 `file_deletions`로)
5. 신고로 전환되지 않은 `issue_details`의 `issue_photos`(저장 위치는 `file_deletions`로) → `issue_details`. 신고된 것의 사진은 `issue_photos.message_id`만 비우고 3에서 지움
6. 주문이 되지 않은 초안의 더하는 옵션 `order_draft_extras` → `order_drafts`
7. `masked_values`, `notifications`, `ai_tool_calls`
8. `messages`
9. 상담 행은 내용 없이 남김: `status = 'deleted'`, `deleted_at` 기록. 주문 행과 AI 호출 기록(`ai_calls`, 비용)이 이 행을 참조함

**3. 끝나고 3년 지난 문제 신고 기록**(`kept_records.issue_keep_until` 지남): 신고된 `issue_photos`를 지우고(저장 위치는 `file_deletions`로) `issue_details.description`을 비우고 `content_purged_at`을 쓰고, 보상 없음의 사유(`issue_reports.no_compensation_reason`)와 그 밖의 보상의 한 일(`other_compensation_note`)을 비우고 `notes_purged_at`을 쓰고(설계 재검토 M12), `kept_records.issue_purged_at`을 씀. 신고(`issue_reports`)와 문제 종류·보상·그 밖의 보상 금액은 남음(REQ-188).

**4. 끝나고 5년 지난 보관 기록**(`kept_records.contract_keep_until` 지남): 그 행을 주문자 이름과 함께 지움. 주문·결제·환불 행은 개인정보 없이 남음(REQ-188).

**5. 손님의 카카오 사용자 키**: 상담이 모두 지워지고 주문이 모두 보관 기록이 된 손님의 `customers.kakao_user_key`를 비우고 `purged_at`을 씀. 같은 사용자가 다시 오면 새 손님 행으로 받음(REQ-190).

**6. 2년 지난 접속기록**(`access_logs.accessed_at`이 2년 지남): 그 행을 지움(REQ-196). 접속기록을 지키는 트리거 `access_logs_guard`가 지금 시각으로 2년이 지나지 않은 행의 지우기를 막으므로 이 차례는 늘 지금 시각으로 셉니다(규칙 테스트의 `purge_run`은 앞당긴 시각으로 돌려도 이 차례만 지금 시각). 접속기록을 참조하는 외래 키는 없습니다.

**7. 하루 지난 화면 요청 키**(`request_keys.created_at`이 24시간 지남): 그 행을 지움(06 DEC-04, 5절 E27). 사장님·운영자가 같은 요청을 다시 보내는 것은 하루 안에만 받습니다. 요청 키에는 요청 지문과 처음 결과가 가리킨 기록의 ID만 있어 개인정보가 없고, 요청 키를 참조하는 외래 키는 없습니다.

**8. 30일 지난 AI 도구 호출 기록**(`ai_tool_calls.called_at`이 30일 지남, 인덱스 `ai_tool_calls_called_idx`): 그 행을 지움(AI-1의 '30일 보관', 5절 E11). 닫힌 상담의 기록은 2에서 상담과 함께 지우고, 이 차례는 상담이 열려 있거나 다룬 주문이 끝나지 않아 2가 지나간 상담의 기록을 지웁니다. AI 호출 기록(`ai_calls`, 토큰·비용)은 남습니다. 도구 호출 기록을 참조하는 외래 키는 없습니다(설계 재검토 M8, RC-15).

**끝: 저장소의 사진 파일**: `file_deletions`의 행마다(이번 차례들이 넣은 것과 지난날 남은 것) 저장소에서 파일을 지우고(이미 없는 파일은 지운 것으로 봄) 지운 행만 지웁니다. 저장소가 실패하면 그 행에 실패 횟수(`attempts`)와 시각(`last_tried_at`)을 남기고 다음 날 다시 지웁니다(5절 E24). 사진 행을 지운 트랜잭션이 저장 위치를 함께 남기므로, 사진 행을 지운 뒤 저장소가 실패하거나 작업이 멈춰도 지울 파일을 잃지 않습니다([PR #30 의견](https://github.com/kodonghui/siljang.ai/pull/30#discussion_r4567801476)). 지울 파일을 참조하는 외래 키는 없습니다.

끝에 차례마다 지운 건수와 저장소에서 지운 파일 수, 아직 지우지 못한 파일 수를 `ops_events`(`purge_run`)에 내용 없이 남깁니다.

이 차례는 행을 지우는 테이블 18개(지울 파일·요청 키 포함)를 참조하는 외래 키 20개(2026-11-14 22:35 KST `db/schema.sql`을 빈 데이터베이스에 만들어 카탈로그에서 읽음. 설계 재검토 M12로 `issue_reports_handoff_fk`가 더해짐, 지울 파일·요청 키·덧붙은 질문·초안의 더하는 옵션을 참조하는 것은 없음)를 모두 따릅니다. 지우는 행을 참조하는 행은 먼저 지우거나 그 참조를 비우고, 주문·주문 내용·신고·결제 안내·변경 요청이 참조하는 초안·견적·신고 내용·카드는 지우지 않습니다. 지우지 않고 남기는 것과 그 이유입니다.

| 남는 것 | 이유 |
| --- | --- |
| 주문·주문 내용 버전(개인정보를 뺀 것)과 그 더하는 옵션(`order_detail_extras`)·결제 안내·결제·환불·변경 요청·장부 행 | 계약·결제 기록(REQ-187). 5년 뒤에도 개인정보 없이 남아 가게별 숫자를 셈 |
| 사장님 알림(`owner_alerts`) | 종류·시각·발송 결과뿐이라 개인정보가 없음 |
| AI 호출 기록(`ai_calls`) | 숫자와 종류만(5절 E11) |
| 상담 행(`deleted`)과 키를 지운 손님 행 | 주문이 참조함. 내용과 개인정보가 없음 |
| 완성 사진(`completion_photos`)·후기(`reviews`·`review_photos`)와 사진 게시 동의 | 포트폴리오의 근거가 되는 사진·글과 사진마다의 동의라 이 지우기에 넣지 않음(SPEC-065). 게시에 동의하지 않은 완성 사진을 언제 지울지는 5-2 질문 6의 답으로 정함(설계 재검토 H10, 이번 고침 밖). 손님의 삭제 요청과 가게가 그만둘 때의 처리는 아직 없음(설계 재검토 RA-06 넷째, 이번 고침 밖) |
| 사장님 장부(구글 시트)에 이미 적힌 이름·연락처 | 가게의 장부라 우리가 지우지 않음(SPEC-064) |
| 채널 연결 시험의 사용자 키(`kakao_channels.test_user_key`) | 연결을 시험한 사람(보통 사장님)의 키라 손님 기록이 아님. 연결 뒤 시험 안내(A20)와 다시 시험(06단계 API-032 `event_recheck`)에 씀. 가게가 그만둘 때의 처리와 함께 정함(설계 재검토 RA-06 넷째, 이번 고침 밖) |
| 에스컬레이션 건에서 사장님이 남긴 문제 신고(`reported_by = 'owner_from_handoff'`)와 그 신고 내용 | 받은 주문의 신고라 주문자의 신고처럼 3년까지 남음(설명은 3에서 비움). 상담을 지우면 그 건과의 연결(`handoff_id`)만 비고 신고한 사람의 대화는 남지 않음(5절 E32) |
| 운영 기록(`ops_events`) | 종류와 건수 같은 숫자만 있고 내용·개인정보·시크릿이 없음(`detail`). 하루 몇 행(지우기 기록 하루 한 행과 일이 생길 때)이라 지우지 않음. 가게가 서비스를 그만둘 때 지우는 길(설계 재검토 영역 C의 '다음에 볼 것')과 함께 다시 정함(설계 재검토 RC-21) |

운영자 세션(`operator_sessions`)과 운영자 로그인 실패(`operator_login_failures`)는 이 차례에 넣지 않습니다(TASK-021). 지난 세션 행은 운영자가 로그인할 때, 15분 지난 실패 행은 로그인을 시도할 때 앱이 지웁니다. 두 테이블에는 쿠키 값의 SHA-256과 이메일의 HMAC만 있고 이메일 글·쿠키 값은 없습니다.

**11단계에서 지우기 SQL과 함께 더할 인덱스**(설계 재검토 RC-21, 검토자의 고치는 방향대로 지우기 SQL을 쓸 때 실행 계획을 보고 더함): 2의 '다룬 주문이 모두 1을 지남'을 볼 `orders(shop_id, consultation_id)`, 2에서 상담 쪽 행을 지울 때 참조를 확인받는 `notifications(consultation_id)`·`confirm_cards(consultation_id)`, 2의 5에서 `message_id`를 비울 `issue_photos(message_id)`, 7의 `request_keys(created_at)`. 가게 1~3곳에서는 느려지지 않아 지금은 더하지 않았고, 이미 있는 지우기 인덱스(`orders_purge_due_idx`, `consultations_dropped_idx`·`consultations_ended_idx`, `kept_records`의 두 기한, `access_logs`의 접속 시각, `ai_tool_calls_called_idx`)는 그대로입니다.

## 7. AI 호출 기록

05 계약이 요구하는 AI 호출 기록 컬럼과 이 스키마의 컬럼입니다. 대화 글·개인정보·시크릿은 두지 않습니다.

| 계약의 필드 | 테이블.컬럼 |
| --- | --- |
| 보낸 시각, 모델, 프롬프트 버전 | `ai_calls.sent_at`, `provider`, `model`, `prompt_version` |
| 토큰 수 | `ai_calls.input_tokens`, `output_tokens` |
| 첫 토큰까지·끝까지 시간 | `ai_calls.first_token_ms`, `total_ms` |
| 결과(성공·실패·한도) | `ai_calls.result`(`success`, `failure`, `timeout`, `limit_reached`), `error_kind` |
| 요청 추적 ID | `ai_calls.trace_id`(+ 차례 안 순번 `attempt`, 다시 한 종류 `call_kind`), `messages.trace_id`로 대화와 연결 |
| 멈춘 사유 | `ai_calls.stop_reason` |
| 캐시 읽기·쓰기 토큰 | `ai_calls.cache_read_tokens`, `cache_write_tokens` |
| 추론 설정 | `ai_calls.reasoning` |
| 도구 호출(이름·결과·대화 ID·대상 ID·마스킹한 인자) | `ai_tool_calls.tool_name`, `result`, `consultation_id`, `target_id`, `args_masked` |
| 정해진 문장을 쓴 이유 | `ai_calls.fallback_reason`(차례마다 호출 상한 `call_limit` 포함, 4절 A35) |
| 비용(REQ-150, REQ-163) | `ai_calls.cost_usd`, `cost_krw`, `cost_basis` |

프롬프트와 답 글은 남기지 않습니다. 손님에게 간 답은 상담 대화(`messages`)에 마스킹한 글로만 있습니다.

## 8. 검사 결과

2026-11-19 00:45 KST, PostgreSQL 16.15, `check_erd.py . --db ...` 출력 그대로입니다(TASK-021 독립 보안 검토 후속을 고친 뒤, 11절). E1의 시각은 다이어그램 파일을 마지막으로 커밋한 시각(이 PR에서 다이어그램을 마지막으로 고친 커밋)이라, 합친 뒤 main에서는 합친 커밋의 시각으로 보입니다. 2026-11-18 23:27 검사(TASK-021 운영자 로그인을 고친 뒤)는 마이그레이션 21개, 컬럼 736, CHECK 423, UNIQUE 91, 규칙 테스트 330개, 함수 9·트리거 14로 15개 모두 통과였고, 2026-11-15 14:51 검사(동희님 결정 반영을 고친 뒤)는 마이그레이션 20개, 테이블 58개, 컬럼 727, CHECK 419, 규칙 테스트 324개, 인덱스 86개(다이어그램)로 15개 모두 통과였고, 2026-11-15 05:10 검사(낮음 K2와 그 PR의 Codex 의견을 고친 뒤)는 마이그레이션 19개, 컬럼 723, CHECK 414, 데이터 1088건 → 컬럼 503개, 규칙 테스트 315개로 15개 모두 통과였고, 2026-11-15 04:13 검사(K1을 고친 뒤)는 마이그레이션 18개, 데이터 1087건 → 컬럼 502개, 규칙 테스트 311개로 15개 모두 통과였고, 2026-11-15 03:09 검사(M8을 고친 뒤)는 마이그레이션 17개, 용어집 74개(컬럼·테이블 설명에 나머지 용어 23개)로 15개 모두 통과였고, 2026-11-15 02:28 검사(남은 빈 곳과 그 PR의 Codex 의견을 고친 뒤)는 데이터 1084건 → 컬럼 500개, 마이그레이션 16개(인덱스 212), 규칙 테스트 309개(지우기 결과 28개), 인덱스 85개(다이어그램)로 15개 모두 통과였고, 2026-11-15 01:48 검사(Codex 의견 전)도 숫자는 같았고, 2026-11-14 23:41 검사(M12와 그 PR의 Codex 의견을 고친 뒤)는 컬럼 721, CHECK 410, 규칙 테스트 303개(받아야 할 쓰기 19개), 인덱스 84개(다이어그램)로 15개 모두 통과였고, 2026-11-14 22:40 검사(M12를 고친 뒤, Codex 의견 전)는 규칙 테스트 300개(받아야 할 쓰기 18개), 부분·식 인덱스 47개로 15개 모두 통과였고, 2026-11-14 20:48 검사(M11·M14를 고친 뒤)는 컬럼 714, CHECK 396, 규칙 테스트 282개, 함수 9·트리거 14로 15개 모두 통과였고, 2026-11-14 19:13 검사(M16·M18을 고친 뒤)는 컬럼 697, CHECK 381, 규칙 테스트 272개, 함수 9·트리거 14로 15개 모두 통과였고, 2026-11-14 18:34 검사(M7·M17을 고친 뒤)는 컬럼 692, CHECK 376, 규칙 테스트 257개, 함수 9·트리거 14로 15개 모두 통과였고, 2026-11-14 14:25 검사(M5·M6을 고친 뒤)는 컬럼 668, CHECK 363, 규칙 테스트 221개, 함수 7·트리거 11로 15개 모두 통과였고, 2026-11-14 12:46 검사(M4·M13과 그 PR의 Codex 의견을 고친 뒤)는 컬럼 664, CHECK 355, 규칙 테스트 207개, 함수 6·트리거 10으로 15개 모두 통과였고, 2026-11-14 11:52 검사(M4·M13을 고친 뒤, Codex 의견 전)는 데이터 908건, 규칙 테스트 204개, 함수 5·트리거 9로 15개 모두 통과였고, 2026-11-14 10:36 검사(Codex 후속을 고친 뒤)는 컬럼 664, CHECK 354, 규칙 테스트 198개로 15개 모두 통과였고, 2026-11-14 09:09 검사(M1·M2·M3·M9·M10을 고친 뒤)는 컬럼 657, CHECK 351, 규칙 테스트 185개로 15개 모두 통과였고, 2026-11-14 07:18 검사(H5·H10을 고친 뒤)는 컬럼 654, CHECK 345, 규칙 테스트 175개로 15개 모두 통과였고, 2026-11-14 05:29 검사(H4를 고친 뒤)는 컬럼 644, CHECK 333, 규칙 테스트 157개로 15개 모두 통과였고, 2026-11-14 04:05 검사(H3을 고친 뒤)는 컬럼 624, CHECK 312, 규칙 테스트 140개로 15개 모두 통과였고, 2026-11-14 01:32 검사(H7·H8을 고친 뒤)는 컬럼 611, CHECK 304, 규칙 테스트 113개로 15개 모두 통과였고, 2026-11-13 23:42 검사(H11·H12를 고친 뒤)는 컬럼 593, CHECK 287, 규칙 테스트 105개로 15개 모두 통과였고, 2026-11-13 22:42 검사(H1·H2를 고친 뒤)는 컬럼 591, CHECK 285, 규칙 테스트 99개로 14개 모두 통과였고, 2026-11-12 11:48 검사는 컬럼 585, 외래 키 105, CHECK 275, 규칙 테스트 87개로 14개 모두 통과였습니다.

```text
통과 S1 TBL 번호 60개(TBL-001~TBL-060), 테이블 이름 중복 없음
통과 S2 헤더 주석 컨텍스트가 CTX-001~009나 공통
통과 S3 헤더 주석 SPEC 목록이 erd_map.py 대응과 같음
통과 S4 SPEC 79개 모두 대응 있음: 데이터 1106건 → 컬럼 516개(전체 컬럼 738개)
통과 S5 쓰이지 않는 테이블 없음(60개 모두 SPEC 대응에 나옴)
통과 S6 컬럼 738개 모두 설명 있음
통과 S7 애그리거트 13개·읽기 모델 18개 용어가 테이블 헤더 주석 16개·'테이블 없음' 행 15개에 한 번씩, 나머지 용어 35개는 컬럼·테이블 설명에. 용어집 86개 모두 자리 있음. 컨텍스트 예외 TERM-059→owner_tasks
통과 S8 테이블 설명이 테이블마다 하나이고 헤더 주석과 같은 TBL 번호로 시작
통과 S9 build_erd.py로 만든 부분(헤더 주석 SPEC·컬럼 설명·README 표와 다이어그램)이 최신
통과 D1 db/schema.sql을 빈 DB에 한 트랜잭션으로 적용(PostgreSQL 16.15)
통과 D2 마이그레이션 22개(0001_init.sql, 0002_refund_path.sql, 0003_order_input_lock.sql, 0004_kakao_event_path.sql, 0005_retention_split.sql, 0006_account_encryption_access_log.sql, 0007_consent_allergy_photo.sql, 0008_wait_ends_due_cap.sql, 0009_refund_excess_file_queue.sql, 0010_refund_calc_remake.sql, 0011_amount_confirm_standard_quote.sql, 0012_request_keys_questions_extras.sql, 0013_ai_calls_skill_keys.sql, 0014_shop_identity_settings.sql, 0015_issue_kind_reporter.sql, 0016_refund_counted_arrived.sql, 0017_ai_tool_calls_called_idx.sql, 0018_glossary_terms.sql, 0019_disclosure_policy_order_amount.sql, 0020_awaiting_payment_limit.sql, 0021_operator_sessions.sql, 0022_operator_auth_binding.sql)로 빈 DB에서 다시 만든 카탈로그가 schema.sql과 같음(column 738, constraint 716, extension 1, function 10, index 223, table 60, trigger 15)
통과 D3 DB 테이블 60개 모두 기본 키와 TBL 설명, 대응 컬럼 모두 있음(기본 키 60, 외래 키 134, CHECK 424, UNIQUE 92, EXCLUDE 1)
통과 D4 규칙 테스트 338개 가운데 기대한 제약에 막힘(늦은 쓰기 3개는 0행, 받아야 할 쓰기 23개는 들어감, 지우기 결과 35개는 기대한 값) 338개, 안 막힘 0개
통과 D5 두 세션이 같은 주문에 결제 확인과 손님 취소를 같은 값을 읽고 동시에 씀: 옛 방식은 늦은 취소가 확인을 덮어쓰고(문제 재현), 잠금 번호는 늦은 취소가 먼저 쓴 쪽의 커밋을 기다린 뒤 0행이라 결제 확인이 남음
      옛 방식(내용 버전 version 비교): 결제 확인 1행, 손님 취소 1행(기다림 1.4초) → cancelled, 잠금 번호 1
      잠금 번호(lock_version 비교): 결제 확인 1행, 손님 취소 0행(기다림 1.5초) → confirmed, 잠금 번호 2
통과 E1 ERD Editor 파일(2026-11-18T15:40:19+00:00)의 테이블 60개·컬럼 738개·관계 134개·인덱스 90개와 컨텍스트 그룹이 스키마와 같음. 다이어그램이 담지 못하는 부분·식 인덱스 49개와 EXCLUDE는 after 스크립트에, CHECK는 schema.sql에만

검사 15개: 통과 15, 실패 0, 미확인 0
```

- 규칙 테스트(`rule_tests.sql`)는 한 트랜잭션 안에서 가게 둘과 주문 다섯의 정상 플로우를 먼저 쓰고(지연 외래 키 확인 포함), 막아야 할 쓰기 277개가 각각 기대한 이름의 제약(접속기록, 주문 상태·제작 행의 짝, 결제로 확인하지 않은 몫을 넘는 환불 계산값, 재제작 주문의 원래 주문과 결제 안내·환불·장부 행, 끝나지 않은 재제작 주문이 있는 원래 주문의 끝남, 한 주문의 잡힌 자리와 확정된 자리의 짝, 취소 환불의 취소한 주문, 주문을 확정한 결제의 확인 취소는 트리거, 주문 내용 버전의 알레르기 정보 동의는 NOT NULL의 컬럼 이름)에 막히는지, 같은 잠금 번호를 읽고 늦게 쓴 쓰기 3개가 0행인지(`expect_stale`), 넓힌 범위 안의 쓰기 2개, 금액이 내려간 변경의 차액 돌려주기 1개, 원래 주문과 재제작 주문을 함께 다시 엶 1개, 금액이 오르는 날짜 변경의 새 날 자리를 잡고 변경이 닫혀 풂 1개, 재제작 주문의 취소 환불을 원래 주문에 남김 1개, 열린 건이 있어도 마감된 날 질문을 날짜마다 따로 둠 1개, 열린 건이 있어도 관련 주문이 있는 다른 카카오 사용자의 사정을 주문마다 따로 둠 1개, 날짜만 아는 초안 1개, 키를 바꾼 뒤 앞 버전 키를 24시간까지 받거나 바로 끊음 2개, 30분이 지난 선점을 풀고 다른 가게가 같은 봇을 넣음 1개, 한 차례에 8번 호출과 호출 상한 이유 2개, 보류한 뒤 새 사업자 정보 변경 요청 1개, 다른 카카오 사용자의 에스컬레이션 건에서 사장님이 남긴 신고 1개와 그 신고의 보상 3개(상함·변질에 사유를 남긴 보상 없음, 그 밖의 보상, 그 밖 문제의 사유 없는 보상 없음), 열린 건이 있어도 결제 기다림 주문 한도 건을 따로 둠 1개, 한도를 넘겨 받은 건과 그것을 쓴 주문 요청 1개가 들어가는지(`expect_ok`, 쓴 것은 되돌림), 지우기를 돌린 뒤 남은 행과 값 30개와 운영자를 막거나 2단계 인증을 다시 등록한 뒤 열린 세션 수와 끝낸 시각 5개가 기대한 값인지(`expect_left`) 봅니다. 1부의 주문·변경 요청 쓰기는 앱처럼 잠금 번호를 올립니다. 끝에 되돌려 아무것도 남기지 않습니다. 이름의 앞머리로 묶으면 SPEC 행 70개, REQ 문장 111개, 공통 규칙 G1~G9 14개, 상태 머신 1-2~1-7 9개, 요구사항 해석 R2~R21 5개, AI-1 12개, 4절 A27 3개, 5절 E32 2개, 지연 외래 키(E2) 2개, 상담마다 채우는 초안 하나 1개, 설계 재검토 H12 5개, H3 1개, M4 2개, M13 7개, M5 12개, M6 2개, M7 10개, M17 17개, M12 1개, RB-15 8개, RB-25 9개, 06단계 DEC-04 6개, DEC-27 8개, Codex 후속 5개입니다. 주문 상태와 제작 행의 짝(A27), 원래 주문의 끝남(A31)과 주문을 확정한 결제의 확인 취소(A1)는 지연 제약 트리거라, 지연 외래 키처럼 `expect_fail`이 쓰기 뒤 `SET CONSTRAINTS ALL IMMEDIATE`로 바로 봅니다.
- 지우기(6절)는 `pg_temp.purge_run(시각, 저장소가 실패할 파일)`이 6절의 여덟 차례와 끝의 사진 파일 차례를 SQL로 그대로 씁니다(저장소는 없어 실패할 파일만 정함). 정상 플로우 뒤에 주문 넷(손님 1의 주문 1·재제작 주문 2·주문 4, 손님 2의 주문 5)을 끝난 것으로 두고(이때 원래 주문 1이 끝난 채 재제작 주문 2만 다시 열면 막히고 둘을 함께 다시 열면 들어감을 봄), 그 셋을 다룬 손님 1의 상담을 상담 끝남으로, 주문 없이 끊긴 손님 3의 상담(대화·마스킹 원본 값·초안·참고 사진·견적·주문자 정보 카드·신고하지 않은 신고 내용과 사진·안내·AI 도구 호출 기록)을 더하고, 보내지 않은 환불이 있는 손님 2의 주문 3은 끝나지 않은 채 둡니다. 31일 뒤 시각으로 돌리면 끝난 주문 넷의 개인정보 21건(알레르기 정보 카드와 사진 게시 동의 카드의 내용 포함)과 두 상담의 내용 26건(손님 1의 상담에 카드번호 끝 4자리만 둔 행과 아무것도 두지 않은 긴 숫자 행, 덧붙은 질문 하나, 손님 3의 초안에 더한 옵션 하나, 주문 1을 선물로 받은 손님 3의 에스컬레이션 건 하나를 포함)이 0건이 되고, 주문자 이름은 보관 기록 넷으로 옮겨지고, 알레르기 정보 동의 기록(동의함 셋·동의 안 함 하나, 동의 글 버전과 시각)은 남고, 계약·결제 기록과 남겨 두는 행 17가지(주문 내용의 더하는 옵션 포함)의 행 수는 그대로이고, 주문 3과 주문 3·5를 다룬 손님 2의 상담은 그대로이고, 묶인 사장님 알림 둘은 남고 할 일 연결만 비고, 새 상담이 열린 손님 1과 끝나지 않은 주문이 있는 손님 2의 키는 남고 손님 3의 키만 지워집니다. 손님 3의 그 건에서 사장님이 주문 1의 문제 신고로 남긴 신고(상함·변질, 사유를 남긴 보상 없음)는 남고 건과의 연결만 빕니다. 접속기록은 2년 1일 전 행 하나만 지워지고 1년 전 행 하나와 지금의 행 둘(원래 값 열기, 상담의 대화 글 열기)이 남고, 하루 지난 화면 요청 키 하나가 지워져 0건이 됩니다(지운 수 1은 운영 기록에). 열린 손님 1의 새 상담에 둔 AI 도구 호출 기록 둘 가운데 31일 전 것만 지워지고 29일 전 것과 AI 호출 기록은 남으며, 다음 날(32일 뒤) 남은 것도 30일이 되어 지워집니다(6절 8). 이때 저장소가 손님 3의 참고 사진 파일에 실패한 것으로 두면 사진 행은 0건이고 지울 파일 1행이 실패 1번으로 남고(신고 사진 파일 하나는 지워짐), 32일 뒤(다음 날) 돌리면 그 파일을 지워 지울 파일이 0건이 됩니다. 같은 시각에 다시 돌리면 0건이고 지우기가 건드리는 테이블(지울 파일 포함)의 행과 값의 지문(md5)이 같습니다. 3년 1일 뒤에는 신고 설명과 사진(파일까지), 보상 없음의 사유만 지워지고 신고와 문제 종류·보상은 남고, 5년 1일 뒤에는 보관 기록 넷이 지워지고 주문·결제 행은 개인정보 없이 남습니다. 각 단계의 기대한 값은 `rule_tests.sql`의 `expect_left` 줄에 있습니다.
- PostgreSQL은 한 행의 CHECK를 이름 차례로 보고 처음 어긋난 것 하나로 막습니다. 그래서 규칙 테스트는 기대한 제약 말고는 모두 맞는 행을 씁니다. 새 CHECK를 더하면 그 이름이 앞서는 테스트가 다른 제약에 막히지 않는지 함께 봅니다(11절의 SPEC-035 10배 테스트).
- D2와 E1이 차이를 잡는지는 일부러 다르게 만든 사본으로 봤습니다(마이그레이션에 컬럼을 더하고 제약을 지운 사본, 컬럼 설명과 인덱스를 바꾼 사본). 둘 다 실패와 그 행을 보였습니다.
- D5는 검사용 데이터베이스에 주문 한 행과 그 확인된 결제 한 행(주문을 확정한 결제, A1)을 외래 키 트리거 없이 만들고(`session_replication_role = replica`, CHECK는 그대로 봄), 두 psql 세션으로 사장님 결제 확인(먼저 쓰고 1.5초 뒤 커밋)과 손님 취소(같은 값을 읽은 채 늦게 씀)를 동시에 돌립니다. 내용 버전(`version`)을 견주는 옛 방식은 늦은 취소가 기다린 뒤에도 조건이 맞아 확인을 덮어쓰고(RC-01 재현), 잠금 번호를 견주면 늦은 취소가 같은 시간을 기다린 뒤 0행이라 결제 확인이 남습니다. 옛 방식이 덮어쓰지 않으면 시험이 헛돈 것으로 보아 실패로 셉니다.
- 보지 못한 것: 앱이 지키는 규칙(4절)은 앱이 없어 테스트하지 못했습니다. A19~A26, A28~A38(시험 버튼, 발송 결과 조회, 카드 글 길이, 주문이 끝남·상담 끝남·보관 기록을 읽지 않음, 진짜 키로 하는 암호화와 복호화, 응답과 같은 트랜잭션의 접속기록, 예금주 확인과 계좌 바꾸기, 알레르기 정보 카드의 차례와 AI로 알레르기 답을 보내지 않음, 사진마다 동의를 남기고 철회 때 먼저 내림, 기한 처리 작업이 기다림을 닫고 결제 기한을 계산함, 결제로 확인하지 않은 몫을 계산값으로 냄, 환불 계산의 차례와 기준 픽업 일시, 재제작 주문의 취소·다시 신고를 원래 주문의 돈으로 셈하고 후기 부탁을 보내지 않음, 가게 규칙으로 주문 종류를 가름, 손님이 본 금액과 견줘 새 금액 확인 카드를 보내고 답에 따라 결제 안내·주문·변경 요청·자리를 씀, 요청 지문을 셈하고 기한이 지난 처리 중 키를 이어받고 처음 결과의 기록을 다시 읽어 돌려줌, 이벤트 키를 형식대로 지음, 덧붙은 질문의 손님 말이 같은 상담의 것인지 봄, 차례마다 호출 상한을 셈, 스킬 키와 연결 문구를 만들어 견줌, 지난 선점을 풀고 같은 봇을 넣음, 상함·변질·이물의 보상 없음에 기준을 보이고 사유를 받음, 그 밖의 보상에 환불·장부 행을 만들지 않음, 에스컬레이션 건의 사유·주문 상태를 보고 신고를 남기며 알림·안내를 보내지 않음)도 같습니다. 데이터베이스 쪽은 봉투 모양과 평문 거절, 원래 값을 두지 않는 번호, 접속기록 고치기·지우기·비우기 막힘, 동의 없는 알레르기 답과 동의가 살아 있지 않은 포트폴리오 항목의 막힘, 결제 기한 상한과 답 없어 닫히는 종류, 주문 상태와 제작 행의 짝(A27), 결제로 확인하지 않은 몫을 넘는 환불 계산값의 막힘(A29), 금액이 내려간 변경의 전액 환불과 재제작 주문을 가리키는 재제작, 재제작 주문의 결제 안내·환불·장부 행, 끝나지 않은 재제작 주문이 있는 원래 주문의 끝남의 막힘(A30·A31), 범위 안의 '부터'·'범위' 옵션과 '확정'이 아닌 기본 디자인 견적, 새 금액 확인 전의 전해짐·결제 확인 요청·확인됨과 받지 않은 열린 결제 안내, 차액 결제가 아닌 잡힌 자리와 확정된 자리의 짝의 막힘(A32), 처리 중·끝남이 어긋난 요청 키와 서버 오류를 처음 결과로 남김(E27), 대상마다 둘째 환불, 주문을 확정한 결제 없는 주문 확정·다른 주문의 결제로 주문 확정·확인을 취소한 결제로 주문 확정(A1·A33), 날짜마다 둘째 마감된 날 건, 추가 수락 없이 쓰거나 두 번 쓴 주문 요청, 마감된 날 질문의 덧붙음과 같은 말 두 번(A34), 날짜 없는 시각, 다른 가격표 버전·가게·무리의 더하는 옵션, 다른 손님의 상담(E30), 첫 호출이 아닌 처음·순번 0·모르는 다시 한 종류(A35), 바꾸지 않은 키의 앞 버전과 24시간을 넘는 앞 버전, '연결 확인 중'이 아닌 연결의 선점과 선점이 남은 봇(A36), 문제 종류 없는 보상·사유 없는 상함·변질·이물의 보상 없음·한 일 없는 그 밖의 보상·신고 카드 없는 주문자 신고·다른 주문의 에스컬레이션 건·건 하나에 신고 둘(A38)의 막힘을 D4로 봤습니다. A6의 잠금 번호는 D4·D5가 데이터베이스 쪽 동작만 봤고, 앱이 모든 쓰기에서 잠금 번호를 올리는지는 10단계 뒤 앱 테스트로 봅니다. 지우기(6절)는 데이터베이스에서 지우는 차례와 지울 파일이 남고 다음 날 지워지는 것만 D4로 돌려 봤고(저장소가 실패한 파일은 `failed_keys`로 정함), 하루 한 번의 실행, 주문 하나·상담 하나씩의 트랜잭션, 저장소에서 실제로 파일을 지우는 것은 10단계 뒤 앱 테스트로 봅니다.

## 9. ERD Editor

- 여는 법: VS Code의 ERD Editor 확장 4.0.0 이상(또는 JetBrains·Obsidian 플러그인 1.0.0 이상)으로 `db/schema.erd.json`을 엽니다. 그룹은 CTX-001부터 위에서 아래로 쌓여 있고 맨 위 노란 메모에 이 다이어그램의 한계를 적었습니다.
- 만든 법: `erd_editor_build.py --build`가 ERD Editor MCP 서버(`@dineug/erd-editor-mcp` 1.2.0, headless)로 `db/schema.sql`을 들여오고(`erd_import_sql`), 데이터베이스를 PostgreSQL로 맞추고, 컨텍스트 그룹과 배치, 메모를 도구로 더했습니다. JSON은 손으로 쓰지 않았습니다.
- 고친 법(마이그레이션 0002부터): `erd_editor_sync.py --write`가 `db/schema.sql`과 다이어그램의 차이(E1이 견주는 것)를 찾아 ERD Editor MCP 편집 도구(`erd_batch` 안의 `erd_add_column`·`erd_move_column`·`erd_change_column_comment`·`erd_set_column_unique`·`erd_link_columns`·`erd_change_relationship_on_delete`·`erd_add_index`, `erd_set_ddl_script`, `erd_change_memo_value` 등)로 옮기고 `erd_save`로 저장합니다. 마이그레이션 0003부터는 컬럼 기본값도 견주어 `erd_change_column_default`로 옮깁니다. 마이그레이션 0005부터는 `erd_add_table`이 새 테이블을 그룹 밖 빈 곳에 두므로, 그 컨텍스트 그룹 상자 안의 빈 곳을 찾아 `erd_move_table`로 옮깁니다(`place_new_tables`). 마이그레이션 0006부터는 상자 안에 빈 곳이 없으면 상자를 아래로 늘려(`erd_resize_table_group`, 다른 그룹 상자와 겹치지 않을 때만) 그룹의 맨 아래 테이블 밑에 두고, 새 테이블의 편집은 늘 새 `erd_batch` 묶음(한 번에 100개까지)에서 시작합니다. 마이그레이션 0008부터는 메모의 트리거 문장을 `db/schema.sql`의 함수 목록으로 다시 씁니다(`trigger_text`). 들여오기(`erd_import_*`)와 `--build`는 쓰지 않아 배치와 그룹이 그대로 남습니다. 다이어그램 파일은 ID를 찾으려고 읽기만 합니다. 쓰기 없이 돌리면 바꿀 편집만 보입니다.
- 다이어그램이 담지 못하는 것: CHECK 424개(다이어그램에 자리가 없음), 부분 인덱스 48개의 WHERE 조건, 식 인덱스 1개(`operators_email_uq`), EXCLUDE 1개, 지연 외래 키 설정 1개. 부분 인덱스는 들여오면 조건 없는 인덱스가 되어 '가게마다 가격표 하나'처럼 실제보다 센 규칙으로 보이므로 다이어그램의 인덱스에서 빼고, 이것들을 모두 DDL의 after 스크립트에 원본 그대로 옮겼습니다. 접속기록을 지키는 함수 `access_logs_guard()`와 트리거 둘(마이그레이션 0006), 주문 상태와 제작 행의 짝을 보는 함수 `orders_production_sync_check()`와 지연 제약 트리거 둘(마이그레이션 0008), 더 들어온 금액의 환불 계산값을 보는 함수 `refunds_unconfirmed_check()`와 트리거 하나(마이그레이션 0009, 0016에서 셈한 들어온 금액을 보게 다시 만듦), 재제작 주문이 돈을 낸 원래 주문을 가리키고 결제 안내·환불·장부 행을 두지 않음을 보는 함수 `orders_remake_root_check()`·`remake_money_check()`와 트리거 넷, 끝나지 않은 재제작 주문이 있는 원래 주문이 끝나지 않는지 보는 함수 `orders_remake_finish_check()`와 지연 제약 트리거 하나(마이그레이션 0010), 한 주문의 잡힌 자리와 확정된 자리가 함께 있는 것이 차액을 기다리는 날짜 변경뿐인지 보는 함수 `slot_holds_pair_check()`와 트리거 하나(마이그레이션 0011), 취소 환불의 취소한 주문을 보는 함수 `refunds_cancelled_check()`와 트리거 하나, 주문 확정 뒤 그 주문을 확정한 결제가 확인을 취소한 것이 아닌지 보는 함수 `confirmed_payment_live_check()`와 지연 제약 트리거 둘(마이그레이션 0012), 운영자를 막거나 2단계 인증·Supabase 사용자를 바꾸면 그 운영자의 열린 세션을 끝내는 함수 `operators_end_sessions()`와 트리거 하나(마이그레이션 0022)는 CHECK처럼 규칙이라 after 스크립트에도 넣지 않고 `db/schema.sql`과 그 마이그레이션에만 두며, 맨 위 메모에 그렇게 적었습니다. 외래 키와 UNIQUE의 이름은 다이어그램이 다시 지어 원본과 다릅니다.
- 견준 결과(`--compare`, 2026-11-19 편집 도구로 고친 다이어그램, 00:43 KST 출력): 다이어그램의 DDL 145,287자를 빈 데이터베이스에 만들어 원본 데이터베이스와 뜻으로 견주면 컬럼 738·기본 키 60·외래 키 134·고유 118·인덱스 44·EXCLUDE 1·테이블 설명과 컬럼 설명이 모두 같고(`db/schema.sql에만 0줄, 다이어그램에만 0줄`), 다른 것은 CHECK(원본 424개, 다이어그램 0개)뿐입니다(TASK-021 독립 보안 검토 후속을 고친 뒤. TASK-021 운영자 로그인 뒤 2026-11-18 23:28에는 144,822자, 컬럼 736·고유 117, CHECK 423개였고, 동희님 결정 반영 뒤 2026-11-15 14:52에는 142,717자, 컬럼 727·기본 키 58·외래 키 133·고유 116·인덱스 40, CHECK 419개였고, 낮음 K2 뒤 05:09에는 141,639자). 견주기는 트리거와 함수를 보지 않습니다(8절 D2가 봄). M12와 그 PR의 Codex 의견을 고친 뒤에는 140,368자, 컬럼 721, CHECK 410개였고, M12를 고친 뒤(Codex 의견 전)에는 140,146자, 고유 113이었고, M11·M14를 고친 뒤에는 138,455자, 컬럼 714, CHECK 396개였고, M16·M18을 고친 뒤에는 134,849자, 컬럼 697, CHECK 381개였고, M7·M17을 고친 뒤에는 133,919자, 컬럼 692, CHECK 376개였고, M5·M6을 고친 뒤에는 125,984자, 컬럼 668, CHECK 363개였고, M4·M13과 그 PR의 Codex 의견을 고친 뒤에는 123,617자, 컬럼 664, CHECK 355개였고, M4·M13을 고친 뒤(Codex 의견 전)에는 123,555자였고, Codex 후속을 고친 뒤에는 122,664자, 컬럼 664, CHECK 354개였고, M1·M2·M3·M9·M10을 고친 뒤에는 121,262자, 컬럼 657, CHECK 351개였고, H5·H10을 고친 뒤에는 119,779자, 컬럼 654, CHECK 345개였고, H4를 고친 뒤에는 116,284자, 컬럼 644, CHECK 333개였고, H3을 고친 뒤에는 112,305자, 컬럼 624, CHECK 312개였고, H7·H8을 고친 뒤에는 108,676자, 컬럼 611, CHECK 304개였고, H11·H12를 고친 뒤에는 105,657자, 컬럼 593, CHECK 287개였고, H1·H2를 고친 뒤에는 104,900자, 컬럼 591, CHECK 285개였고, 2026-11-12에는 102,991자, 컬럼 585·외래 키 105·고유 92, CHECK 275개였습니다.
- 주의: ERD Editor의 DDL은 외래 키를 인덱스보다 먼저 쓰는데, 복합 UNIQUE가 인덱스로 바뀌어 그 순서로는 PostgreSQL에 적용되지 않습니다(견줄 때는 인덱스를 앞에 둠). 그래서 DB는 늘 `db/schema.sql`과 마이그레이션으로 만들고, 다이어그램의 DDL로 만들지 않습니다.
- 그래서 `truth`는 `source`입니다(계약: 들여와 견줄 때 잃는 것이 있으면 `source`를 유지). 확정한 뒤 바꿀 때는 `db/schema.sql`과 새 마이그레이션을 먼저 고치고, 같은 변경을 ERD Editor 편집 도구로 다이어그램에 더한 뒤(`erd_editor_sync.py --write`) `check_erd.py`의 E1로 맞는지 봅니다. 다시 들여오면 배치가 지워지므로 확정한 뒤에는 들여오지 않습니다.
- 보지 못한 것: 이 작업 환경에 VS Code가 없어 다이어그램을 화면으로 열어 보지는 못했습니다. 그룹 사이 중복이 없고 테이블이 모두 자기 그룹 안에 있음은 파일의 좌표로 봤습니다. 새 테이블 `kept_records`도 CTX-003 그룹 상자 안(x 2137, y 4144)에, `access_logs`는 높이를 274에서 700으로 늘린 공통 그룹 상자 안(x 74, y 9668, `ops_events` 아래)에, `file_deletions`는 같은 공통 그룹 상자 안(x 1340, y 9668, `access_logs` 오른쪽)에 있습니다. 새 테이블 `handoff_questions`와 `order_draft_extras`는 너비를 4630에서 6793으로, 높이를 1876에서 1924로 늘린 CTX-001 그룹 상자 안(x 5563, y 352와 y 610)에, `order_detail_extras`는 너비를 3737에서 5818로, 높이를 1488에서 1560으로 늘린 CTX-003 그룹 상자 안(x 4583, y 3434)에 있습니다. 새 테이블 `shop_identity_changes`는 크기를 바꾸지 않은 CTX-007 그룹 상자 안(x 2440, y 7416, `operators` 아래)에 있습니다. 두 상자는 아래가 다음 그룹 상자에 막혀 오른쪽으로 늘렸고(`erd_editor_sync.py`가 아래로 늘리지 못하면 오른쪽으로 늘리게 고침), 편집 도구가 보는 테이블 크기로 상자가 그룹의 테이블을 모두 담습니다.

## 10. 체크포인트

- 질문(2026-11-12 11:52 무렵, 이 작업 대화의 결정 카드): "ERD 표 51개와 정한 것 14개를 추천대로 굳힐까요?" 고를 것은 추천대로 굳힘, E5만 바꿈(카드번호를 SPEC-021 글자대로 전체 남김), 고칠 것 말씀이었습니다.
- 결정: 2026-11-12 11:56 동희님이 '추천대로 굳힘'을 고르셨습니다. 테이블 51개(TBL-001~051)와 5절의 E1~E14를 이대로 확정하고 `db/migrations/0001_init.sql`을 첫 마이그레이션으로 둡니다. 확인 요청한 뒤 PR #6에 댓글과 리뷰는 없었습니다.
- 확정한 뒤: 06단계 API 계약을 이 테이블과 컬럼으로 씁니다. 바꿈은 `db/schema.sql`과 새 마이그레이션(0002부터)으로 하고, 이미 보이는 데이터나 보내는 요청을 깨는 바꿈은 다시 확인 요청합니다.

## 11. 확정한 뒤 고친 것

2026-11-20 TASK-028의 [0024 마이그레이션](../../db/migrations/0024_kakao_callback_delivery.sql)은 수신 메시지에 카카오 콜백 주소의 암호화 봉투, 서비스 기한, 소비자의 임시 처리 권한을 둡니다. 큐 메시지에는 가게 ID와 수신 메시지 ID를 넣습니다. 소비자가 콜백을 처리하거나 기한이 지난 메시지를 받으면 봉투를 지우고, 전할 수 없었던 답은 다음 대화에서 전할 수 있도록 기록합니다(06단계 DEC-29).

2026-11-19 PC 카카오톡 시험(TASK-011, 06단계 DEC-28)으로 `messages.kakao_message_id`에 저장할 가게별 수신 키와 `kakao_channels.bot_id`의 정규화 규칙을 확정했습니다. [0023 마이그레이션](../../db/migrations/0023_kakao_trial_contract_comments.sql)은 두 컬럼의 설명만 갱신합니다. 기존 값, 형식 및 제약은 유지합니다.

2026-11-13 설계 독립 재검토([research/design-review-2026-11](../../research/design-review-2026-11/README.md))의 높음 묶음 H1(RB-01, RC-05, RD-02, RA-15)과 H2(RA-01, RE-02, RE-03, RE-04)를 동희님 2026-11-13 20:59 결정 카드 '추천안대로 (추천)'에 따라 고쳤습니다. 요구사항은 버전 5(REQ-165~174, REQ-086·REQ-151 제외), 기능 명세는 SPEC-070·071을 더하고 환불 길의 행을 고쳤습니다(spec.md 8절). 바꿈은 새 마이그레이션 [`0002_refund_path.sql`](../../db/migrations/0002_refund_path.sql) 하나이고 `0001_init.sql`은 그대로입니다.

| 무엇 | 테이블.컬럼·제약 | 근거 |
| --- | --- | --- |
| 받은 금액을 결제 안내의 들어온 금액 합으로 셈 | `payment_requests.arrived_amount`, `arrived_at` 더함. 확인됨은 안내 금액 이상, 맞추는 중은 다르게 들어온 금액과 같음, 나감·확인 요청됨은 없음, 안내 금액의 10배까지(`payment_requests_arrived_chk`, `_arrived_amount_chk`, `_arrived_status_chk`, `_arrived_paid_chk`, `_arrived_mismatch_chk`) | REQ-165(REQ-086을 넓힘), 4절 A2 |
| 결제로 확인하지 않은 들어온 입금 남기기 | 닫힘·기한 지남 결제 안내에 들어온 금액을 남김. 환불 원인 `over_received`(더 들어온 금액·기한 뒤 차액) 더함. `refunds.payment_request_id` 더하고 취소 뒤 들어온 입금·더 들어온 금액이면 꼭 있게 함(`refunds_request_fk`, `refunds_request_chk`, 참조용 `refunds_shop_scope`) | REQ-166, SPEC-071 |
| 결제 확인 요청 중 손님 취소 | 할 일 종류 '들어온 입금 대조'(`owner_tasks.kind = 'arrival_check'`, 결제 안내를 꼭 참조) | REQ-167 |
| 잘못 누른 결제 확인 취소 | `payments.voided_at`, `void_reason` 더함(`payments_void_chk`). 결제 안내마다 하나는 `payments_one_per_request`(UNIQUE)에서 취소한 것을 뺀 부분 UNIQUE `payments_one_live_per_request`로 바꿈(5절 E4). 손님 안내 `payment_corrected`, 장부 쓰기 `payment_voided` 더함 | REQ-169, SPEC-070, 4절 A17 |
| 환불은 계산값보다 낮게 정하지 못함 | `refunds_floor_chk`: 보상이 아니면 환불 금액이 계산값 이상. '환불 없음'은 계산값이 0일 때만 | REQ-170 |
| 환불 보내기 할 일과 보냄 안내 | 할 일 종류 '환불 보내기'(`owner_tasks.kind = 'refund_send'`)와 보낼 환불(`owner_tasks.refund_id`, `owner_tasks_refund_fk`). 손님 안내 `refund_sent`, 장부 쓰기 `refund_sent` 더함 | REQ-172, REQ-173, 4절 A18 |

- 마이그레이션 0002: 컬럼과 제약을 더하고, 종류 CHECK(`refunds_cause_check`, `owner_tasks_kind_check`, `owner_tasks_subject_chk`, `notifications_kind_check`, `ledger_writes_event_kind_check`)는 지우고 다시 만듭니다. 이미 확인됨·맞추는 중인 결제 안내의 들어온 금액은 안내 금액·다르게 들어온 금액으로 채운 뒤 제약을 더합니다(운영 데이터는 아직 없음). 컬럼 설명은 `schema.sql`과 같은 줄을 옮겨 D2가 같음을 봅니다.
- 다이어그램: `erd_editor_sync.py`를 새로 만들어 편집 도구로 옮겼습니다(9절). 1단계 테이블·컬럼 편집 41개, 2단계 관계 2개·인덱스(`refunds_shop_scope`) 편집 7개, 3단계 메모(CHECK 285개)와 after 스크립트 2개. 첫 실행에서 새 관계 2개의 지울 때 동작이 'none'으로 들어가, 외래 키 읽기를 고치고 `erd_change_relationship_on_delete` 2개로 `restrict`로 맞췄습니다. 그 뒤 낱말을 고치며 컬럼 설명 편집 3개(`erd_change_column_comment`: 할 일 이름 '들어온 입금 대조', `refunds.cause`, `owner_tasks.kind`)를 더 했습니다. 마지막 쓰기 없는 실행은 편집 0개입니다.
- 규칙 테스트 87개 → 99개. 정상 플로우에 주문 하나를 더해 결제 확인 취소 → 입금했다고 알린 뒤 손님 취소 → 들어온 입금 남기기 → 환불 → 환불 보내기를 쓰고, 차액 결제에서 더 들어온 금액을 환불(`over_received`)로 돌려줍니다. 새 테스트 12개: REQ-165 3개, REQ-167 1개, REQ-169 2개, REQ-170 2개, REQ-173 1개, SPEC-035 1개, SPEC-071 2개.
- 바뀐 테스트 3개: 'REQ-153 결제 안내 하나에 확인된 결제 둘'은 기대 제약이 `payments_one_live_per_request`로, 'SPEC-035 다르게 들어온 금액이 10배를 넘음'은 맞추는 중의 들어온 금액도 같이 넘게 써서 이름이 앞서는 `payment_requests_arrived_amount_chk`가 막음(전에는 `payment_requests_mismatch_amount_chk`), 'SPEC-047 계산값과 다른 금액에 사유 없음'은 낮은 금액을 `refunds_floor_chk`가 먼저 막으므로 '계산값보다 높은 금액에 사유 없음'으로 바꿈(기대 제약 `refunds_override_chk` 그대로).
- 설명 낱말: 할 일 종류 `paid_after_cancel`의 설명 이름을 '취소 뒤 들어온 입금'으로, 환불 원인 `over_received` 설명을 '안내 금액을 넘은 몫, 기한 뒤 차액'으로 적었습니다(`db/schema.sql`과 0002의 COMMENT, 다이어그램 컬럼 설명). 0001은 그대로 둡니다.
- 검사: 8절. 14개 모두 통과, `--compare` 차이 0줄.

2026-11-13 같은 재검토의 높음 묶음 H11(RB-02, RD-16), H12(RC-01), H6(RD-08)도 같은 결정 카드('추천안대로 (추천)')에 따라 고쳤습니다. 요구사항 버전 5에 REQ-175~178을 더하고, 기능 명세에 SPEC-072(주문자 이름·연락처 받기)를 더했습니다(spec.md 8절). 바꿈은 새 마이그레이션 [`0003_order_input_lock.sql`](../../db/migrations/0003_order_input_lock.sql)입니다. H6(제작 목록에 알레르기 답·빼야 할 재료·더하는 옵션)는 `order_details`에 이미 있는 컬럼이라 테이블은 그대로 두고 SPEC-050의 대응만 더했습니다.

| 무엇 | 테이블.컬럼·제약 | 근거 |
| --- | --- | --- |
| 쓸 때마다 오르는 잠금 번호 | `orders.lock_version`, `change_requests.lock_version` 더함(1부터, `orders_lock_version_check`, `change_requests_lock_version_check`). 주문·변경 요청은 읽은 잠금 번호와 같을 때만 쓰고 하나 올림. 내용 버전(`orders.version`)은 그대로 주문 내용의 버전 | 설계 재검토 H12(RC-01), 4절 A6, 5절 E15, 06단계 DEC-05 |
| 주문자 정보 카드 | 카드 종류 `orderer_info` 더함(`confirm_cards_kind_check`). 주문 요청 카드처럼 초안과 고친 번호에 묶이고 주문은 아직 없음(`confirm_cards_draft_chk`, `confirm_cards_order_chk`를 다시 만듦) | REQ-175, SPEC-072 |
| 주문자 이름·연락처와 입금자 이름의 출처 | 컬럼은 그대로 두고 설명만 고침. 초안의 `customer_name`·`customer_phone`은 주문 요청 확인 카드 전에 AI를 거치지 않는 입력으로 받고, `payment_requests.depositor_name`은 결제 확인 요청 때 받으며 따로 넣지 않으면 주문자 이름. 셋 다 AI로 보내지 않음 | REQ-175, REQ-176, REQ-178 |
| 제작 목록이 보이는 것 | 테이블은 그대로. SPEC-050의 대응에 `order_details`의 디자인 옵션·더하는 옵션·알레르기 답·빼야 할 재료를 더함 | 설계 재검토 H6(RD-08), REQ-177 |

- 마이그레이션 0003: 잠금 번호 컬럼 둘을 기본값 1로 더하고(운영 데이터가 아직 없어 옛 행은 1부터), 카드 종류 CHECK와 초안·주문 CHECK를 지우고 다시 만듭니다. 컬럼 설명 8줄은 `schema.sql`과 같은 줄을 옮겨 D2가 같음을 봅니다. 내용 버전(`orders.version`) 설명에 '상태만 바꾸는 쓰기에는 오르지 않아 동시 쓰기는 잠금 번호로 견줌'을 더했습니다.
- 잠금 번호와 행 잠금 가운데 잠금 번호를 고른 이유와 대안은 5절 E15에 적었습니다. 06단계 DEC-05의 `revision`이 주문·변경 요청에서는 이 값입니다.
- 규칙 테스트 99개 → 105개. 1부의 주문·변경 요청 쓰기 11곳이 앱처럼 잠금 번호를 올리고, 주문자 정보 카드를 하나 더 씁니다. 새 테스트 6개: 잠금 번호 0 막힘 2개(`orders_lock_version_check`, `change_requests_lock_version_check`), 초안 없는 주문자 정보 카드 1개(`confirm_cards_draft_chk`), 같은 잠금 번호를 읽은 늦은 쓰기 3개(결제 확인 뒤 손님 취소, 손님 취소 뒤 결제 확인, 변경 수락 뒤 취소로 닫기). 늦은 쓰기는 새 도우미 `expect_stale`이 0행인지 보고 D4가 함께 셉니다.
- 두 세션 동시 쓰기 D5를 `check_erd.py`에 더했습니다(8절). 옛 방식(내용 버전 비교)으로 문제를 재현하고 잠금 번호로 막히는지를 함께 봅니다.
- 다이어그램: `erd_editor_sync.py --write`로 컬럼 2개 더함(이름·타입·NOT NULL·설명)과 컬럼 설명 6개, 메모(CHECK 수) 1개를 옮겼습니다. 그 뒤 `--compare`가 새 컬럼의 기본값(1)이 다이어그램에 없다는 2줄 차이를 보여, `erd_editor_sync.py`가 컬럼 기본값도 견주어 `erd_change_column_default`로 옮기게 고치고 2개를 더했습니다(9절). `--compare` 차이 0줄.
- 검사: 8절. 15개 모두 통과(D5 새로).

2026-11-13 같은 재검토의 높음 묶음 H7(RD-01, RD-10, RA-10)과 H8(RD-04)도 같은 결정 카드('추천안대로 (추천)')에 따라 고쳤습니다. 요구사항 버전 5에 REQ-179~184를 더하고 REQ-115를 REQ-183으로 바꿨습니다(requirements.md 11절). 기능 명세는 SPEC-001·005·008·028·066·067을 고쳤습니다(spec.md 8절). 바꿈은 새 마이그레이션 [`0004_kakao_event_path.sql`](../../db/migrations/0004_kakao_event_path.sql)입니다. H9(RD-03, 주문 요청 카드의 규정 글)는 테이블을 바꾸지 않고 앱 규칙 A21로 적었습니다.

| 무엇 | 테이블.컬럼·제약 | 근거 |
| --- | --- | --- |
| 사장님 알림 받는 곳 | `owners.alert_user_key`와 `owners_alert_user_key_uq`를 지움. 받는 곳은 `owners.kakao_account_id`(appUserId). 친구 여부를 본 시각 `owners.alert_friend_checked_at` 더함 | REQ-183(REQ-115를 바꿈), SPEC-001, SPEC-067, 5절 E17 |
| 버튼 블록 ID와 시험 버튼 | `kakao_channels`에 `card_block_id`·`orderer_block_id`·`depositor_block_id`·`review_block_id`(1~100자), `verified_blocks`(넷 가운데 닿은 것), `test_user_key` 더함. 연결됨이면 블록 ID 넷과 닿은 블록 넷(`kakao_channels_blocks_chk`) | REQ-179, SPEC-008, 4절 A19, 5절 E16. PR B가 남긴 '주문자 정보'·'입금자 이름' 블록 ID도 여기 |
| 먼저 보내기 시험 | `kakao_channels.event_status`(아직 안 봄·시험 중·됨·안 됨), `event_task_id`, `event_checked_at`, `event_fail_reason`. 안 됨에는 사유, 시험 중에는 taskId, 결과에는 받은 시각, 시험은 연결된 뒤(`kakao_channels_event_chk`) | REQ-180, REQ-181 |
| 발송 결과 확인 | `notifications`·`owner_alerts`의 상태에 `confirming` 더함. `kakao_task_id`, `requested_at`, `delivery_checked_at`, `fail_code` 더함. 확인 중·보냄이면 taskId와 요청 시각(`notifications_kakao_task_chk`, `owner_alerts_kakao_task_chk`). 조회할 행의 부분 인덱스 `notifications_confirming_idx`, `owner_alerts_confirming_idx` | REQ-182, SPEC-066, SPEC-067, 4절 A20, 5절 E18 |

- 마이그레이션 0004: `alert_user_key`와 그 UNIQUE를 지우고, 컬럼을 먼저 더한 뒤 여러 컬럼을 보는 제약을 더합니다. 상태 CHECK 둘(`owner_alerts_status_check`, `notifications_status_check`)은 지우고 다시 만듭니다. 운영 데이터가 아직 없어 연결된 채널·보낸 안내가 없습니다. 테이블·컬럼 설명 25줄은 `schema.sql`과 같은 줄을 옮겨 D2가 같음을 봅니다.
- 대응(`erd_map.py`): SPEC-001에 친구 여부와 본 시각, SPEC-008에 새 컬럼 10개, SPEC-066에 발송 결과 컬럼 넷과 가게의 먼저 보내기, SPEC-067의 '알림 받는 곳'을 `owners.kakao_account_id`로 바꾸고 발송 결과 컬럼 넷을 더했습니다(데이터 742건 → 764건, 컬럼 370개 → 388개).
- 규칙 테스트 105개 → 113개. 1부의 연결된 채널은 블록 ID 넷이 모두 닿고 먼저 보내기가 됨, 연결 확인 중인 채널은 확인 카드 블록만 닿음으로 쓰고, 보낸 손님 안내·사장님 알림에 taskId와 요청 시각을 씁니다. 새 테스트 8개: 블록 ID 없이 연결됨과 닿지 않은 블록으로 연결됨(`kakao_channels_blocks_chk`), 모르는 블록 이름(`kakao_channels_verified_blocks_check`), 사유 없는 안 됨과 연결 전 시험 안내(`kakao_channels_event_chk`), taskId 없는 확인 중 안내(`notifications_kakao_task_chk`)와 보낸 사장님 알림(`owner_alerts_kakao_task_chk`), 모르는 전하지 못한 사유(`notifications_fail_code_check`).
- 다이어그램: `erd_editor_sync.py --write`로 1단계 편집 106개(컬럼 19개 더함·1개 뺌, 컬럼 설명 24개, 기본값 2개, NOT NULL 2개, 테이블 설명 1개), 2단계 0개, 3단계 메모(CHECK 수)와 after 스크립트(새 부분 인덱스 둘) 2개를 옮겼습니다. 그 뒤 낱말을 고치며 컬럼 설명 편집 1개(`kakao_channels.depositor_block_id`: '결제 확인 요청 카드 버튼이 부름')를 더 했습니다. 마지막 쓰기 없는 실행은 편집 0개, `erd_editor_build.py --compare` 차이 0줄입니다.
- 검사: 8절. 15개 모두 통과.

2026-11-13 같은 재검토의 높음 묶음 H3(RB-09, RC-02, RA-06, RC-04, RC-03)도 같은 결정 카드('추천안대로 (추천)')에 따라 고쳤습니다. 요구사항 버전 5에 REQ-185~190을 더하고 REQ-143·REQ-144를 제외로 바꿨습니다(requirements.md 11절). 기능 명세는 SPEC-065를 다섯 차례로 다시 쓰고 SPEC-010·017·018·025·040과 상태 머신 1-1을 고쳤습니다(spec.md 8절). 바꿈은 새 마이그레이션 [`0005_retention_split.sql`](../../db/migrations/0005_retention_split.sql)입니다. 30일·3년·5년은 잠정이고 5-2 질문 7의 답으로 다시 봅니다. 법 조문(전자상거래법 시행령 제6조①, 개인정보 보호법 제21조①·③)은 검토자의 인용이었고, 2026-11-15에 원문과 대조했습니다(requirements.md 13절).

| 무엇 | 테이블.컬럼·제약 | 근거 |
| --- | --- | --- |
| 상담 끝남과 새 상담 | `consultations.status`에 `ended`, `ended_at` 더함(`consultations_ended_chk`). 손님마다 하나인 상담은 끝나지도 지워지지도 않은 상담(`consultations_one_live_per_customer`의 조건을 `status NOT IN ('ended', 'deleted')`로). 끝낼 상담과 지울 상담을 찾는 부분 인덱스 `consultations_ordered_idx`, `consultations_ended_idx` | REQ-189, SPEC-025, SPEC-017, RC-02, 4절 A22 |
| 주문이 끝난 시각 | `orders.finished_at` 더함. 받음·미수령·거절·취소에만(`orders_finished_chk`), 개인정보를 지운 주문은 끝난 주문(`orders_purged_chk`). 지울 주문을 찾는 부분 인덱스 `orders_purge_due_idx` | REQ-185, SPEC-065, 4절 A22 |
| 보관 기록 | 새 테이블 `kept_records`(TBL-052, CTX-003): 주문마다 하나(`kept_records_order_uq`), 주문자 이름, 끝난 시각, 계약·결제 기록을 둘 때까지(5년), 문제 신고 기록을 둘 때까지(3년), 신고 내용을 지운 시각. 기간은 끝난 뒤이고 신고 기록이 계약 기록보다 길지 않음(`kept_records_keep_chk`, `kept_records_issue_purged_chk`). 찾는 인덱스 `kept_records_contract_due_idx`, `kept_records_issue_due_idx` | REQ-187, REQ-188, RA-06, RB-09, 5절 E19 |
| 신고 내용을 지운 표시 | `issue_details.content_purged_at` 더함(신고된 것의 설명을 비운 뒤에만, `issue_details_purged_chk`). `issue_photos.message_id`는 빈 값을 받음(상담을 지울 때 메시지 연결만 비움) | REQ-188, REQ-186 |
| 카카오 사용자 키 지우기 | `customers.kakao_user_key`는 빈 값을 받고 `purged_at` 더함(`customers_purged_chk`). 지운 키끼리는 사용자 키 UNIQUE에 걸리지 않음 | REQ-190, RC-04 |
| 개인정보 컬럼마다 지우는 때 | 컬럼 설명에 '주문이 끝나고 30일 뒤 비움/지움(SPEC-065)'을 더함: 주문 내용·초안의 이름·연락처·알레르기 답·빼야 할 재료·문구·디자인 설명, 입금자 이름, 환불 계좌, 카드 내용(`payload`)과 변경 내용(`changes`)은 빈 객체로, 할 일의 글감, 안내 글 | REQ-185, RC-04 |
| 사장님 알림 | 지우지 않고 에스컬레이션 할 일과의 연결(`owner_alerts.owner_task_id`)만 비움. 묶인 알림(`batched_into_id`)이 같은 테이블을 참조해도 6절의 차례가 막히지 않음 | RC-03, REQ-186 |

- 마이그레이션 0005: 컬럼을 더하고 NOT NULL 둘을 풀고, 상태 CHECK(`consultations_status_check`)와 손님마다 하나인 부분 UNIQUE 인덱스는 지운 뒤 새 조건으로 만들고, 새 테이블과 인덱스를 만듭니다. 운영 데이터가 아직 없어 끝난 주문과 닫힌 상담이 없습니다. 테이블·컬럼 설명 37줄은 `schema.sql`과 같은 줄을 옮겨 D2가 같음을 봅니다.
- 대응(`erd_map.py`): SPEC-065에 지우는 컬럼과 보관 기록 컬럼(대응 40개), SPEC-025에 끝난 상담과 다룬 주문이 끝남, SPEC-017에 손님마다 끝나지 않은 상담 하나, SPEC-040에 '보관 기록이 된 주문은 빼고'를 더했습니다(데이터 764건 → 793건, 컬럼 388개 → 401개).
- 규칙 테스트 113개 → 140개. 새 제약 8개(`customers_purged_chk`, `consultations_ended_chk`, `orders_finished_chk`, `orders_purged_chk`, `issue_details_purged_chk`, `kept_records_keep_chk`, `kept_records_issue_purged_chk`, `kept_records_order_uq`)를 막는 테스트 8개와, 지우기를 돌린 뒤 남은 행과 값을 보는 새 도우미 `expect_left`의 테스트 19개(8절). `check_erd.py`의 D4가 `expect_left`도 셉니다.
- 다이어그램: `erd_editor_sync.py --write`로 1단계 편집 92개(테이블 1개 더함과 그 이름·그룹·설명, 컬럼 13개 더함과 이름·타입, 컬럼 설명 35개, NOT NULL 7개, 기본값 2개, 컬럼 자리 2개, 기본 키·UNIQUE 각 1개, 테이블 설명 1개), 새 테이블 자리 1개(`erd_move_table`, 이 PR에서 `place_new_tables`를 더함), 2단계 관계 1개(`kept_records`→`orders`)·인덱스(`kept_records_contract_due_idx`) 편집 3개, 3단계 메모(CHECK 수)와 after 스크립트(새 부분 인덱스 넷과 조건을 바꾼 하나) 2개를 옮겼습니다. 마지막 쓰기 없는 실행은 편집 0개, `erd_editor_build.py --compare` 차이 0줄입니다.
- 검사: 8절. 15개 모두 통과.

2026-11-13 같은 재검토의 높음 묶음 H4(RC-10, RC-09, RA-16)도 같은 결정 카드('추천안대로 (추천)')에 따라 고쳤습니다. 요구사항 버전 5에 REQ-191~199를 더하고 REQ-137을 제외로 바꿨습니다(requirements.md 11절). 기능 명세는 SPEC-073(운영자의 가게 기록 보기와 원래 값·보관 기록 열기)과 SPEC-074(접속기록 남기기)를 더하고 SPEC-003·006·021·032·049·065·067·068을 고쳤습니다(spec.md 8절). 바꿈은 새 마이그레이션 [`0006_account_encryption_access_log.sql`](../../db/migrations/0006_account_encryption_access_log.sql)입니다. 법 조문은 「개인정보의 안전성 확보조치 기준」(개인정보보호위원회고시 제2026-9호, 2026.7.1 시행) 제7조②·⑥과 제8조①~③을 2026-11-13 law.go.kr 원문으로 읽었고, 2026-11-14에는 사이트 점검으로 다시 대조하지 못했고, 2026-11-15에 다시 대조했습니다(requirements.md 13절).

| 무엇 | 테이블.컬럼·제약 | 근거 |
| --- | --- | --- |
| 가게 계좌번호 암호화 | `payment_accounts.account_number`를 지우고 `account_number_enc`(봉투, `payment_accounts_account_number_enc_check`)와 `account_last4`를 더함. 평문 형식 CHECK(숫자와 '-', 10~16자리)는 06단계 API 검증으로 옮김 | REQ-191, SPEC-006, 4절 A23, 5절 E20 |
| 환불 계좌번호 암호화 | `refunds.refund_account_number`를 지우고 `refund_account_enc`·`refund_account_last4`를 더함(둘은 함께, `refunds_account_pair_chk`) | REQ-191, SPEC-049 |
| 마스킹 원본 값 | `masked_values.original_value`와 `masked_values_card_last4_chk`를 지우고 `original_enc`(전화번호·계좌번호만, `masked_values_kept_chk`), `value_hmac`(원래 값이 있을 때만, `masked_values_hmac_chk`), `last4`(긴 숫자는 없음, `masked_values_last4_chk`)를 더함. 같은 값에 같은 플레이스홀더는 `masked_values_value_uq`를 (상담, 종류, 해시)로 다시 만듦 | REQ-191, REQ-192, REQ-193, SPEC-021, 4절 A15, 5절 E5·E20 |
| 예금주 확인 | `payment_accounts.holder_checked_by`(운영자)·`holder_checked_at`를 더함(둘은 함께, `payment_accounts_holder_checked_chk`). 확인됨의 조건과 계좌 바꾸기는 앱이 봄 | REQ-197, REQ-199, SPEC-003, 4절 A25 |
| 계좌 바뀜 알림 | 사장님 알림 종류 `payment_account_changed`(`owner_alerts_kind_check`를 다시 만듦). 할 일 없이 알림만, 계좌번호 없음 | REQ-198, SPEC-006, SPEC-067 |
| 결제 안내 글의 계좌 | 컬럼은 그대로. `notifications.body`에는 가게 계좌번호를 넣지 않고 자리만 두어 보일 때 채움(설명을 고침) | REQ-191, SPEC-032 |
| 접속기록 | 새 테이블 `access_logs`(TBL-053, 공통)와 인덱스 둘(`access_logs_accessed_idx`, `access_logs_shop_time_idx`), 함수 `access_logs_guard()`와 트리거 둘(행마다 고치기·지우기, 문장마다 비우기). 제약 `access_logs_actor_chk`·`access_logs_open_chk`·`access_logs_open_operator_chk`·`access_logs_target_chk`와 컬럼 CHECK(쿼리 문자열 없는 경로, 손님 ID 배열, 접속지) | REQ-194~196, SPEC-073, SPEC-074, 4절 A24, 5절 E21 |
| 지우기 여섯째 차례 | 2년 지난 접속기록을 지움(6절). 환불 계좌는 암호문·끝 4자리를 비움 | REQ-196, SPEC-065 |

- 마이그레이션 0006: 평문 컬럼 셋을 지우고 새 컬럼과 제약을 더하고, 사장님 알림 종류 CHECK를 지우고 다시 만들고, 새 테이블·인덱스·함수·트리거를 만듭니다. 운영 데이터가 아직 없어(10단계 전) 계좌·마스킹 원본 값·환불 계좌 행이 없습니다. 행이 있으면 앱이 평문을 암호화해 새 컬럼을 채운 뒤 옛 컬럼을 지워야 하고, 데이터베이스에는 키가 없어 이 파일로는 할 수 없음을 파일 머리에 적었습니다. 테이블·컬럼 설명 30줄은 `schema.sql`과 같은 줄을 옮겨 D2가 같음을 봅니다. D2는 이번부터 함수 1개와 트리거 2개도 견줍니다(8절).
- 대응(`erd_map.py`): SPEC-073(22건)과 SPEC-074(11건)를 더하고, SPEC-003에 대표자·상호·결제 계좌와 예금주 확인, SPEC-006에 암호문·끝 4자리·바꾼 시각·확인된 이름·계좌 바뀜 알림, SPEC-021·022·049·065에 새 컬럼, SPEC-032에 안내 글의 계좌 자리, SPEC-065에 2년 지난 접속기록, SPEC-068에 가린 값을 더했습니다(데이터 793건 → 846건, 컬럼 401개 → 421개).
- 규칙 테스트 140개 → 157개. 1부는 가게 계좌·환불 계좌·마스킹 원본 값을 시험용 봉투('v1:TEST…', 진짜 암호문 아님)와 해시로 쓰고, 카드번호 끝 4자리만 둔 행과 아무것도 두지 않은 긴 숫자 행, 다른 가게의 계좌 바꾸기와 계좌 바뀜 알림, 접속기록 셋(1년 전 사장님 읽음, 지금 운영자의 원래 값 열기, 2년 1일 전 보관 기록 열기)을 더합니다. 새 테스트 17개: 마스킹 원본 값 4개(`masked_values_last4_chk`, `masked_values_original_enc_check`, `masked_values_hmac_chk`, `masked_values_value_uq`), 계좌 4개(`payment_accounts_account_number_enc_check`, `payment_accounts_holder_checked_chk`, `refunds_refund_account_enc_check`, `refunds_account_pair_chk`), 접속기록 8개(`access_logs_actor_chk`, `access_logs_open_chk`, `access_logs_open_operator_chk`, `access_logs_target_chk`, `access_logs_request_path_check`, 트리거로 고치기·지우기·비우기 막힘 3개), 지우기 결과 1개(2년 지난 접속기록만 지움). 바꾼 테스트: 'SPEC-021 카드번호 전체를 남김'을 'REQ-192 카드번호의 원래 값을 남김'(`masked_values_kept_chk`)으로, 지우기 결과 넷에 접속기록 건수를 더하고 지우기 전 상담 내용을 21건에서 23건으로 고쳤습니다. 트리거는 `restrict_violation`(SQLSTATE 23001, 무결성 제약 위반 묶음)으로 막아 `expect_fail`이 제약과 같은 길로 셉니다.
- 다이어그램: `erd_editor_sync.py --write`로 1단계 편집 128개(테이블 1개 더함과 이름·그룹·기본 키, 컬럼 23개 더함·3개 뺌과 이름·타입, 컬럼 설명 27개, 테이블 설명 3개, NOT NULL 10개, 컬럼 자리 9개, 기본값 3개), 새 테이블 자리 2개(`erd_move_table`, `erd_resize_table_group`), 2단계 관계 4개·인덱스 3개 편집 17개, 3단계 메모(CHECK 수) 1개를 옮겼습니다. 첫 실행에서 새 테이블의 편집이 한 묶음 100개를 넘어 MCP가 거부했고(파일은 그대로), 공통 그룹 상자에 빈 곳이 없어 새 테이블이 상자 밖에 놓였습니다. 그래서 `run_batches`는 새 테이블을 늘 새 묶음에서 시작하고 `place_new_tables`는 상자를 아래로 늘리게 고친 뒤 다이어그램 파일을 되돌려 다시 돌렸습니다(9절). 메모에 '접속기록 트리거는 db/schema.sql에만'을 더했습니다(`erd_change_memo_value`). 마지막 쓰기 없는 실행은 편집 0개, `erd_editor_build.py --compare` 차이 0줄입니다.
- 검사: 8절. 15개 모두 통과.

2026-11-13 같은 재검토의 높음 묶음 H5(RA-02)와 H10(RE-01, RA-14, RB-16, RC-11)도 같은 결정 카드('추천안대로 (추천)')에 따라 고쳤습니다. 요구사항 버전 5에 REQ-200~210을 더하고 REQ-013·REQ-096·REQ-097·REQ-179를 제외로 바꿨습니다(requirements.md 11절). 기능 명세는 SPEC-075(알레르기 정보 동의와 알레르기 답 받기)를 더하고 SPEC-008·010·011·020·021·027·028·029·050·053·062·063·065·072를 고쳤습니다(spec.md 8절). H5는 잠정(5-2 질문 4의 답으로 다시 봄), H10은 잠정(5-2 질문 6의 답으로 다시 봄)입니다. 바꿈은 새 마이그레이션 `0007_consent_allergy_photo.sql`입니다.

| 무엇 | 테이블.컬럼·제약 | 근거 |
| --- | --- | --- |
| 알레르기 정보 동의 | `order_drafts`에 `allergy_consent`(동의함·동의 안 함·동의 필요 없음), `allergy_consent_version`(1~20자), `allergy_consent_at` 더함. 답에는 시각이, 동의함·동의 안 함에는 동의 글 버전이 있음(`order_drafts_allergy_consent_chk`) | REQ-201, REQ-205, SPEC-075 |
| 동의 없는 알레르기 답 막기 | 초안의 알레르기 답은 동의함이나 동의 필요 없음일 때만(`order_drafts_allergy_answer_chk`, 빈 동의는 `coalesce`로 거짓이 되어 막힘) | REQ-200, REQ-203 |
| 주문 내용 버전의 동의 기록 | `order_details`에 같은 세 컬럼(동의의 답과 시각은 NOT NULL). 동의 안 함에는 알레르기 답이 없고(`order_details_allergy_answer_chk`), 동의 글 버전은 동의함·동의 안 함에만(`order_details_allergy_consent_chk`). 지우기(6절)는 알레르기 답을 비우고 동의 기록은 남김 | REQ-201, REQ-203, SPEC-029, SPEC-065 |
| 알레르기 답 블록 | `kakao_channels.allergy_block_id` 더함. 시험 버튼으로 닿은 블록 이름에 `allergy_answer`(`kakao_channels_verified_blocks_check`), 연결됨이면 블록 ID 다섯과 닿은 블록 다섯(`kakao_channels_blocks_chk`) | REQ-202, REQ-206, SPEC-008 |
| 카드 종류 | `allergy_info`(초안과 고친 번호에 묶임)와 `photo_consent`(주문과 버전에 묶임) 더함(`confirm_cards_kind_check`, `confirm_cards_draft_chk`, `confirm_cards_order_chk`를 다시 만듦) | SPEC-075, SPEC-053 |
| 사진마다 게시 동의 | `photo_consents.scope`의 주문 요청 때 동의(`order`)와 `photo_consents_order_uq`를 없애고 완성 사진 한 장의 동의(`completion_photo`)로. `completion_photo_id`와 외래 키(`photo_consents_completion_photo_fk`), 동의마다 사진 한 장(`photo_consents_scope_chk`), 완성 사진마다 동의 하나(`photo_consents_completion_photo_uq`) | REQ-207, REQ-208, SPEC-053, SPEC-062 |
| 동의가 살아 있는 동안만 포트폴리오 | `photo_consents.publishable`(동의함·철회 안 함과 늘 같음, `photo_consents_publishable_chk`)과 참조 키 셋(`photo_consents_live_key`, `photo_consents_review_photo_key`, `photo_consents_completion_photo_key`). `portfolio_items.consent_live`(올라 있는 동안 참, 내리면 비움, `portfolio_items_live_chk`)와 복합 외래 키 셋: 동의가 게시 가능(`portfolio_items_consent_live_fk`), 후기 사진·완성 사진이 그 동의의 사진(`portfolio_items_consent_review_photo_fk`, `portfolio_items_consent_completion_photo_fk`). 올려 둔 채로 철회를 쓰면 막혀 앱은 먼저 내림 | REQ-209, REQ-098, SPEC-063, 4절 A26, 5절 E22 |

- 마이그레이션 0007: 컬럼을 먼저 더한 뒤 여러 컬럼을 보는 제약을 더하고, CHECK 다섯(`kakao_channels_verified_blocks_check`, `kakao_channels_blocks_chk`, `confirm_cards_kind_check`, `confirm_cards_draft_chk`, `confirm_cards_order_chk`)과 사진 게시 동의의 범위 CHECK 둘(`photo_consents_scope_check`, `photo_consents_scope_chk`)은 지우고 다시 만들고, 부분 UNIQUE 인덱스 `photo_consents_order_uq`를 지웁니다. 운영 데이터가 아직 없어(10단계 전) 연결된 채널·주문 내용 버전·주문 요청 때의 사진 게시 동의가 없습니다. 있으면 이 파일이 실패하고, 그 이유(블록 ID를 받고 다시 연결 확인, 주문 내용 버전의 동의의 답, 어느 사진의 동의인지 알 수 없는 옛 동의)를 머리 주석에 적었습니다. 컬럼 설명 24줄은 `schema.sql`과 같은 줄을 옮겨 D2가 같음을 봅니다.
- 대응(`erd_map.py`): SPEC-075(10건)를 더하고, SPEC-008에 알레르기 답 블록, SPEC-011에 동의가 살아 있는 사진만, SPEC-027에 '알레르기 정보 동의를 아직 묻지 않음', SPEC-028에 요약의 알레르기 답과 '동의 안 함', SPEC-029에 주문 내용으로 옮기는 동의 셋, SPEC-050에 '동의 안 함' 표시, SPEC-053에 사진 게시 동의 카드와 사진마다의 동의, SPEC-062·063에 게시 가능과 동의가 살아 있음을 더했습니다. SPEC-020(AI는 알레르기를 묻지 않음)에서 알레르기 답을, SPEC-028·029에서 사진 게시 동의를 뺐습니다(데이터 846건 → 870건, 컬럼 421개 → 432개).
- 규칙 테스트 157개 → 175개. 1부는 초안 1·2·5와 그 주문 내용을 동의함(동의 글 버전 'allergy-v1'), 주문 4의 초안과 주문 내용을 동의 안 함(알레르기 답 없음)으로 쓰고, 알레르기 정보 카드를 주문자 정보 카드 앞에, 주문 1의 완성 사진 한 장과 사진 게시 동의 카드·동의를 완성 뒤에 씁니다. 주문 요청 때 사진 게시 동의는 쓰지 않습니다. 후기 사진은 둘(하나는 동의 안 함)이고, 포트폴리오에 후기 사진과 완성 사진을 올린 뒤 완성 사진의 동의 철회는 먼저 내리고 남깁니다. 새 테스트 18개: 알레르기 답 블록 없이 블록 넷으로 연결됨 1개, 초안 없는 알레르기 정보 카드와 주문 없는 사진 게시 동의 카드 2개, 동의 없는 알레르기 답·동의 글 버전 없는 동의·동의의 답 없는 주문 내용 버전·동의 안 한 주문의 알레르기 답·동의 필요 없음에 동의 글 버전 5개, 동의하지 않은 후기 사진과 철회한 완성 사진 올리기 2개(`portfolio_items_consent_live_fk`), 다른 사진의 동의로 올리기 2개, 올려 둔 채 철회 1개, 철회했는데 게시 가능 1개, 내린 항목에 동의가 살아 있음 1개, 사진 없는 완성 사진 동의 1개, 완성 사진 하나에 동의 둘 1개, 지운 뒤에도 알레르기 정보 동의 기록이 남음 1개(`expect_left`). 'REQ-179' 테스트 둘과 'REQ-097' 테스트 하나는 이름을 REQ-206·REQ-209로 바꾸고, 시험 버튼이 닿지 않은 블록 테스트는 알레르기 답 블록 ID도 넣어 닿지 않음만 남게 했습니다. 지우기 전 끝난 주문의 개인정보는 카드 내용 둘이 늘어 19건 → 21건입니다.
- 다이어그램: `erd_editor_sync.py --write`로 1단계 편집 67개(컬럼 10개 더함과 이름·타입, 컬럼 설명 23개, 기본값 2개, NOT NULL 3개, 컬럼 자리 8개, 테이블 설명 1개), 2단계 22개(관계 4개, 인덱스 셋과 그 컬럼·UNIQUE), 3단계 메모(CHECK 수)와 after 스크립트(새 부분 인덱스) 2개를 옮겼습니다. `--compare`는 차이 0줄입니다(9절).
- 검사: 8절. 15개 모두 통과.

2026-11-13 같은 재검토의 중간 묶음 M1(RB-03, RA-17), M2(RB-08, RE-08, RD-07), M3(RA-04, RA-11, RB-04, RB-05), M9(RB-19, RC-17, RB-20), M10(RA-03)도 같은 결정 카드('추천안대로 (추천)')에 따라 고쳤습니다. 요구사항 버전 5에 REQ-211~226을 더하고 REQ-019·021·037·040·048·080·087·160을 제외로 바꿨습니다(requirements.md 11절). 기능 명세는 SPEC 36개(005·007·014·015·017·018·022~025·028~035·037~039·041~048·054·055·060·064~067)와 상태 머신 1-1~1-8을 고쳤습니다(spec.md 8절). 바꿈은 새 마이그레이션 [`0008_wait_ends_due_cap.sql`](../../db/migrations/0008_wait_ends_due_cap.sql)입니다. M10(문의 끊김이 꼭 가야 하는 안내를 막지 않음, REQ-211·212)은 테이블을 바꾸지 않고 컬럼 설명만 고쳤습니다.

| 무엇 | 테이블.컬럼·제약 | 근거 |
| --- | --- | --- |
| 맞춤 주문 요청의 답 없어 닫힘 | `orders.cancel_kind`에 `no_answer` 더함(`orders_cancel_kind_check`를 다시 만듦). 수락하지 않은 맞춤 주문(재제작 아님)만(`orders_no_answer_chk`) | REQ-213, 1-7, 4절 A28 |
| 변경 요청의 답 없어 닫힘 | `change_requests.status`에 `closed_no_answer` 더함. 닫힌 시각이 있고 사장님이 정한 시각은 없음(`change_requests_no_answer_chk`) | REQ-214, 1-5 |
| 에스컬레이션 건의 답 없어 닫힘 | `handoffs.status`에 `closed_no_answer`, 닫힌 시각 `handoffs.closed_at` 더함(둘은 함께, `handoffs_closed_chk`). 7일 지난 열린 건을 찾는 부분 인덱스 `handoffs_open_age_idx` | REQ-216, 1-1, 1-7 |
| 기다림의 상태와 종류 | `owner_tasks.wait_status`를 기다림·지연·답함·답 없어 닫힘으로(옛 '할 일에 남음' `parked`는 지연에 합침). 기다림이 있는 할 일에 결제 확인 요청·맞추는 중·환불 결정을 더해 일곱(`owner_tasks_wait_kind_chk`). 지연이면 지연 안내 시각(`owner_tasks_late_chk`), 답함·답 없어 닫힘이면 닫힌 시각(`owner_tasks_answered_chk`), 답 없어 닫힘은 에스컬레이션 건·맞춤 주문·변경 요청·결제 확인 요청만(`owner_tasks_no_answer_chk`) | REQ-215, REQ-216, 1-7, 설계 재검토 M9 |
| 답 없어 닫힘 안내 | 손님 안내 종류 `no_answer_closed` 더함(`notifications_kind_check`를 다시 만듦). 상담이 문의 끊김이어도 이 안내와 결제 안내·사장님 답·전날 안내는 보내고, 못 보내면 다음 대화 때 먼저 전함(설명을 고침) | REQ-213, REQ-214, REQ-216, REQ-212 |
| 결제 기한의 시작과 상한 | `payment_requests.delivered_at`(손님에게 전해진 시각)과 `due_cap_at`(결제 기한 상한, NOT NULL) 더함. 기한은 상한을 넘지 않고(`payment_requests_due_cap_chk`), 전해지기 전에는 기한이 상한이고 전해진 시각은 낸 시각 뒤(`payment_requests_delivered_chk`). 상한이 지난 확인 요청됨을 찾는 부분 인덱스 `payment_requests_claim_cap_idx` | REQ-218, REQ-223, SPEC-032, SPEC-037, 5절 E23 |
| 그날 자리 세기 | 날짜별로 세는 부분 인덱스 `slot_holds_day_live_idx`의 조건에 종료됨(`done`)을 더함. `overbooked` 설명에 다 찬 날·휴무일에 사장님이 확인하고 받은 자리를 더함 | 1-4, REQ-220, REQ-221, REQ-226, 4절 A3 |
| 주문 상태와 제작 행의 짝 | 함수 `orders_production_sync_check()`와 지연 제약 트리거 `orders_production_sync`(주문)·`productions_order_sync`(제작 행). 받음이면 인도 시각, 미수령이면 미수령 시각만 있어야 커밋됨 | 1-2, 설계 재검토 M9(RC-17), 4절 A27, 5절 E3 |
| 친구 여부·문의 끊김·결제 기한 설명 | 컬럼은 그대로. `customers.channel_friend`(알리지 않으면 친구 아님, REQ-219), `shops.idle_close_hours`·`consultations.last_customer_message_at`(열린 에스컬레이션 건과 다룬 주문이 있으면 닫지 않음, REQ-211), `operating_rules.payment_due_hours`(전해진 뒤부터 셈), `change_requests.needs_owner_day`(휴무일·다 찬 날의 확인, REQ-221·226) 설명을 고침 | REQ-211, REQ-219, REQ-218, REQ-221 |

- 마이그레이션 0008: 종류·상태 CHECK 다섯(`orders_cancel_kind_check`, `change_requests_status_check`, `handoffs_status_check`, `owner_tasks_wait_status_check`, `notifications_kind_check`)과 기다림 제약 셋(`owner_tasks_wait_kind_chk`, `owner_tasks_late_chk`, `owner_tasks_answered_chk`)을 지우고 다시 만들고, 컬럼 셋과 새 제약 여섯, 부분 인덱스 둘, 함수와 지연 제약 트리거 둘을 더하고, `slot_holds_day_live_idx`를 새 조건으로 다시 만듭니다. 운영 데이터가 아직 없지만(10단계 전) 있으면 결제 기한 상한은 지금 결제 기한으로, '할 일에 남음'은 지연으로, 결제 확인 요청·맞추는 중·환불 결정 할 일은 닫혔으면 답함·열려 있으면 기다림으로 옮기고, 받음·미수령인데 제작 행의 시각이 맞지 않는 주문이 있으면 커밋에서 실패함을 머리 주석에 적었습니다. 컬럼 설명 25줄은 `schema.sql`과 같은 줄을 옮겨 D2가 같음을 봅니다. D2는 함수 2개와 트리거 4개를 견줍니다(8절).
- 대응(`erd_map.py`): SPEC-015에 종료된 시각과 결제 기한 상한, SPEC-024에 답 없어 닫히는 주문·변경 요청·에스컬레이션 건과 그 시각, 결제 기한 상한, 할 일이 닫힌 시각, SPEC-032에 전해진 시각과 상한, SPEC-037에 전해진 시각·상한과 결제 없어 취소를 더했습니다(데이터 870건 → 884건, 컬럼 432개 → 437개).
- 규칙 테스트 175개 → 185개. 1부의 결제 안내 17행에 결제 기한 상한을 쓰고(주문 1의 첫 결제 안내는 전해진 시각부터 12시간, 상한은 이틀 뒤), 결제 확인 요청·환불 결정 할 일을 기다림으로 열어 답함으로 닫습니다. 새 테스트 10개: 상한을 넘는 결제 기한과 전해지기 전인데 상한과 다른 기한 2개(`payment_requests_due_cap_chk`, `payment_requests_delivered_chk`), 기다림 없는 결제 확인 요청 할 일 1개(`owner_tasks_wait_kind_chk`), 환불 결정을 답 없어 닫힘으로 1개(`owner_tasks_no_answer_chk`), 수락한 맞춤 주문을 답 없어 닫힘으로 1개(`orders_no_answer_chk`), 사장님이 답한 변경 요청을 답 없어 닫힘으로 1개(`change_requests_no_answer_chk`), 닫힌 시각 없는 답 없어 닫힘 1개(`handoffs_closed_chk`), 주문 상태와 제작 행이 어긋난 쓰기 3개(받음인데 인도 시각 없음, 인도 시각만 쓰고 주문은 그대로, 인도한 주문을 미수령으로, 트리거 `orders_production_sync`). 트리거는 `check_violation`(SQLSTATE 23514)으로 막아 `expect_fail`이 제약과 같은 길로 셉니다.
- 다이어그램: `erd_editor_sync.py --write`로 1단계 편집 38개(컬럼 3개 더함과 이름·타입·자리, NOT NULL 1개, 컬럼 설명 25개), 2단계 0개, 3단계 메모(CHECK 수와 트리거 함수)와 after 스크립트(새 부분 인덱스 둘과 조건을 바꾼 하나) 2개를 옮겼습니다. 메모가 두 트리거 함수를 적도록 `erd_editor_sync.py`에 `trigger_text`를 더했습니다(9절). 마지막 쓰기 없는 실행은 편집 0개, `erd_editor_build.py --compare` 차이 0줄입니다.
- 검사: 8절. 15개 모두 통과.

2026-11-14 합친 PR에 남은 Codex 자동 검토 의견 넷을 지금 원본과 다시 대조해 모두 맞음을 확인하고, 2026-11-13 20:59 결정 카드 '추천안대로 (추천)'의 H1·H3·H4를 지키도록 고쳤습니다(Codex 후속): [PR #27 의견 하나](https://github.com/kodonghui/siljang.ai/pull/27#discussion_r4564156224)(더 들어온 금액의 환불 계산값이 넘은 몫이 아니라 그 결제 안내의 들어온 금액 전부), [PR #27 의견 둘](https://github.com/kodonghui/siljang.ai/pull/27#discussion_r4564156241)(환불 금액 상한 1,000만 원이 들어온 금액 상한 1억 원보다 낮아 더 들어온 큰 금액을 돌려주지 못함), [PR #30 의견](https://github.com/kodonghui/siljang.ai/pull/30#discussion_r4567801476)(지운 사진 행의 파일을 다음 날 다시 지울 기록이 없음), [PR #31 의견](https://github.com/kodonghui/siljang.ai/pull/31#discussion_r4568849791)(운영자가 보는 상담의 대화 글에 이름·알레르기 같은 말이 그대로 보임). 요구사항은 REQ-227을 더했고(requirements.md 11절), 기능 명세는 SPEC-016·065·073을 고쳤습니다(spec.md 8절). 바꿈은 새 마이그레이션 [`0009_refund_excess_file_queue.sql`](../../db/migrations/0009_refund_excess_file_queue.sql)입니다.

| 무엇 | 테이블.컬럼·제약 | 근거 |
| --- | --- | --- |
| 더 들어온 금액의 환불 계산값 | 함수 `refunds_unconfirmed_check()`와 트리거 `refunds_unconfirmed`(환불 행을 쓰거나 원인·결제 안내·계산값을 고칠 때). 취소 뒤 들어온 입금·더 들어온 금액이면 계산값이 그 결제 안내의 들어온 금액에서 결제 확인을 취소하지 않은 확인된 결제를 뺀 몫을 넘지 않음. `refunds.calculated_amount` 설명을 고침 | SPEC-016, SPEC-071, 4절 A29, PR #27 의견 하나 |
| 환불 금액 상한 | `refunds.amount`·`refunds.calculated_amount`의 CHECK(`refunds_amount_check`, `refunds_calculated_amount_check`)를 0~1억 원으로(들어온 금액 `payment_requests.arrived_amount`의 상한과 같음) | SPEC-071, PR #27 의견 둘 |
| 지울 사진 파일 | 새 테이블 `file_deletions`(TBL-054, 공통): 저장 위치(같은 파일은 한 행, `file_deletions_key_uq`)·지운 행의 종류(참고 사진·신고 사진)·넣은 시각·실패 횟수와 마지막 실패 시각(둘은 함께, `file_deletions_tried_chk`). 가게는 `shops`를 참조 | SPEC-065, 5절 E24, 6절, PR #30 의견 |
| 운영자가 여는 상담의 대화 글 | `access_logs.target_kind`에 `consultation_text` 더함(`access_logs_target_kind_check`를 다시 만듦). 대상 ID는 상담 ID(`access_logs.target_id` 설명). 보관 기록이 아니어서 원래 값 열기(`open_original`)로만 엶(`access_logs_target_chk`는 그대로) | REQ-227, SPEC-073, 4절 A24, PR #31 의견 |

- 마이그레이션 0009: 환불 CHECK 둘과 접속기록 대상 CHECK를 지우고 다시 만들고, 함수와 트리거, 새 테이블을 만듭니다. 운영 데이터가 아직 없어(10단계 전) 옮길 행이 없고, 있으면 트리거는 새로 쓰거나 고치는 환불만 보므로 이미 정한 환불의 계산값은 앱이 다시 셈을 머리 주석에 적었습니다. 컬럼 설명 11줄은 `schema.sql`과 같은 줄을 옮겨 D2가 같음을 봅니다. D2는 함수 3개와 트리거 5개를 견줍니다(8절).
- 대응(`erd_map.py`): SPEC-065에 지울 파일의 저장 위치·종류·넣은 시각·실패 횟수와 시각을, SPEC-073에 메시지의 발신자·시각·종류·글자 수와 대화 글 열기를 더하고 운영 기록의 설명을 '지운 건수와 아직 지우지 못한 파일 수'로 고쳤습니다(데이터 884건 → 893건, 컬럼 437개 → 443개).
- 규칙 테스트 185개 → 198개. 새 도우미 `expect_ok`는 넓힌 범위 안의 쓰기가 들어가는지 보고 되돌립니다(`check_erd.py` D4가 함께 셈). 1부에 운영자가 사유를 적고 상담의 대화 글을 연 접속기록 한 행(대상 `consultation_text`)을 더했습니다. 새 테스트 13개: 더 들어온 금액의 환불 계산값이 들어온 금액 전부인 쓰기와 정한 환불의 계산값을 넘은 몫보다 크게 고친 쓰기 2개(트리거 `refunds_unconfirmed`), 1억 원을 넘는 환불 1개(`refunds_amount_check`), 들어가야 할 쓰기 2개(1,500,000원 안내에 15,000,000원이 들어와 넘은 몫 13,500,000원을 환불, 결제 확인을 취소한 결제는 확인된 결제로 세지 않아 취소 뒤 들어온 35,000원을 환불), 상담의 대화 글을 보관 기록 열기로 남긴 쓰기 1개(`access_logs_target_chk`), 같은 파일 두 번·시각 없는 실패 횟수·완성 사진을 지울 파일로 넣은 쓰기 3개(`file_deletions_key_uq`, `file_deletions_tried_chk`, `file_deletions_source_check`), 지우기 결과 4개(첫 지우기에서 저장소가 참고 사진 파일 하나에 실패하면 사진 행은 0건이고 지울 파일 1행이 실패 1번으로 남음, 다음 날 지우기, 다음 날 지우기가 남은 파일을 지움, 3년 지난 신고 사진의 파일도 지움). 지우기 함수 `purge_run`은 사진 행을 지우는 네 문장이 그 저장 위치를 `file_deletions`에 넣고, 끝에 저장소가 실패한 것으로 둔 파일(`failed_keys`) 밖의 행을 지우며, 운영 기록에 지운 파일 수와 남은 파일 수를 남깁니다. 지우기의 지문에 지울 파일을 더했고, 접속기록이 남은 결과(3/1,2,4)와 운영 기록 건수(5/4/5)의 기대값을 고쳤습니다.
- 다이어그램: `erd_editor_sync.py --write`로 1단계 편집 46개(테이블 1개 더함과 이름·설명·그룹, 컬럼 7개 더함과 이름·타입, 기본 키 1개, NOT NULL 5개, UNIQUE 1개, 기본값 3개, 컬럼 설명 11개), 새 테이블 자리 1개(공통 그룹 상자 안), 2단계 관계 1개, 3단계 메모(CHECK 수와 트리거 함수) 1개를 옮겼습니다. 메모가 새 트리거 함수를 적도록 `erd_editor_sync.py`의 `TRIGGER_TEXT`에 더했습니다(9절). 마지막 쓰기 없는 실행은 편집 0개, `erd_editor_build.py --compare` 차이 0줄입니다.
- 검사: 8절. 15개 모두 통과.

2026-11-14 같은 재검토의 중간 묶음 M4(RB-06, RC-18, RE-16, RC-14, RD-19)와 M13(RB-17)도 같은 결정 카드의 '모두 지금 고침 (추천)'대로 검토자의 고치는 방향을 따라 고쳤습니다(두 묶음에는 Claude 추천이 없음). 요구사항은 바꾸지 않았고(requirements.md 11절), 기능 명세는 SPEC-005·016·025·042·045~048·059~061·064·065를 고쳤습니다(spec.md 8절). 바꿈은 새 마이그레이션 [`0010_refund_calc_remake.sql`](../../db/migrations/0010_refund_calc_remake.sql)입니다. 같은 PR의 Codex 자동 검토 의견([PR #35](https://github.com/kodonghui/siljang.ai/pull/35#discussion_r4571233614))을 원본과 대조해 맞음을 확인하고, 원래 주문은 그 재제작 주문이 모두 끝날 때까지 끝나지 않게 했습니다(재제작 주문의 새 픽업 일시는 60일 안이라, 원래 주문이 먼저 끝나 30일 뒤 지워지면 그 뒤 재제작 주문의 취소·다시 신고의 환불을 남길 곳이 없었음).

| 무엇 | 테이블.컬럼·제약 | 근거 |
| --- | --- | --- |
| 환불 계산의 차례 | 컬럼은 그대로. `refunds.calculated_amount`(바탕에서 수수료를 먼저 빼고 비율을 곱해 원 미만 버림, 0원 이상 바탕 이하), `operating_rules.cancellation_fee_krw`(0원~1,000만 원, 주문 금액과는 계산 때 견줌), `operating_rules.pre_production_refund_pct`(단계별 환불이 없는 버전은 제작 뒤 취소에도 씀), `operating_rules.date_change_refund_basis`(기준 픽업 일시), `refund_tiers.hours_before_min`(남은 시간은 1시간 미만 버림)과 `refund_tiers` 테이블 설명(0시간부터 끝없음까지 빈 구간 없이) 설명을 고침 | SPEC-005, SPEC-016, 4절 A30, RB-06·RC-18·RE-16 |
| 금액이 내려간 변경의 차액 돌려주기 | `refunds_change_decision_chk`: 원인이 금액이 내려간 변경(`change_reduced`)이면 전액 환불(`full`)이 아님(일부 환불, 계산값 0원이면 환불 없음). `refunds.decision` 설명을 고침 | SPEC-045, SPEC-047, 4절 A30, RB-06 |
| 계산값과 다른 금액의 사유 | 제약은 그대로(`refunds_override_chk`가 다르면 사유 1~200자를 꼭 받음, 명세를 이쪽에 맞춤). 보상은 고른 금액이 계산값이라 사유를 비움. `refunds.override_reason` 설명을 고침 | SPEC-047, REQ-084, RC-14·RD-19 |
| 재제작 주문의 돈과 장부 | 함수 `orders_remake_root_check()`와 트리거 `orders_remake_root`(재제작 주문을 가리키는 재제작을 막음, 재제작의 재제작은 돈을 낸 원래 주문에 이음), 함수 `remake_money_check()`와 트리거 `payment_requests_remake`·`refunds_remake`·`ledger_rows_remake`(재제작 주문에 결제 안내·환불·장부 행을 막음). `orders.remake_of_order_id`, `payment_requests.order_id`, `refunds.order_id`, `ledger_rows.order_id`, `ledger_writes.event_kind` 설명을 고침 | SPEC-016, SPEC-046, SPEC-059~061, SPEC-064, R21, 4절 A14·A31, RB-17 |
| 원래 주문이 끝나는 때 | 함수 `orders_remake_finish_check()`와 지연 제약 트리거 `orders_remake_finish`(끝나지 않은 재제작 주문이 있는 원래 주문을 끝내지 못하고, 원래 주문이 끝난 채 재제작 주문만 다시 열지 못함. 트랜잭션 끝에 봄). `orders.finished_at` 설명을 고침 | SPEC-025, SPEC-060, SPEC-065, 4절 A22·A31, [PR #35 Codex 의견](https://github.com/kodonghui/siljang.ai/pull/35#discussion_r4571233614) |

- 마이그레이션 0010: CHECK 하나(`refunds_change_decision_chk`)를 더하고 함수 셋과 트리거 다섯(지연 제약 트리거 `orders_remake_finish` 포함)을 만듭니다. 운영 데이터가 아직 없어(10단계 전) 옮길 행이 없고, 있으면 새 CHECK는 적용할 때 이미 있는 행을 보므로 금액이 내려간 변경의 전액 환불을 일부 환불로 고친 뒤 적용하고, 트리거는 새로 쓰거나 주문을 바꾸는 행만 보며 이미 끝난 원래 주문에 끝나지 않은 재제작 주문이 있으면 적용 전에 원래 주문의 끝난 시각을 비움을 머리 주석에 적었습니다. 테이블 설명 1줄과 컬럼 설명 13줄은 `schema.sql`과 같은 줄을 옮겨 D2가 같음을 봅니다. D2는 함수 6개와 트리거 10개를 견줍니다(8절).
- 대응(`erd_map.py`): SPEC-005에 단계의 끝, SPEC-016에 기준 픽업 일시(지금 픽업 일시와 주문 내용 첫 버전의 픽업 일시)와 단계 구간의 시작·끝, 재제작의 원래 주문, SPEC-042·046·059·061·064에 재제작의 원래 주문, SPEC-047에 환불을 남긴 주문과 금액이 내려간 변경의 원인, SPEC-048에 재제작의 원래 주문과 가게 사정 취소의 보상 조문 글을, SPEC-060에 원래 주문의 끝난 시각을 더했습니다(데이터 893건 → 909건, 컬럼 443개 → 445개. 새로 쓰인 컬럼은 `order_details.pickup_at`과 `refund_tiers.hours_before_max`).
- 규칙 테스트 198개 → 207개. 새 테스트 9개: 금액이 내려간 변경의 전액 환불 1개(`refunds_change_decision_chk`), 들어가야 할 차액 돌려주기(일부 환불) 1개(`expect_ok`), 재제작 주문을 가리키는 재제작 1개(트리거 `orders_remake_root`), 재제작 주문의 결제 안내·환불·장부 행 3개(트리거 `payment_requests_remake`, `refunds_remake`, `ledger_rows_remake`), 끝나지 않은 재제작 주문이 있는 원래 주문을 끝냄 1개와 원래 주문이 끝난 채 재제작 주문만 다시 엶 1개(지연 제약 트리거 `orders_remake_finish`), 원래 주문과 재제작 주문을 함께 다시 엶 1개(`expect_ok`). 1부의 정상 플로우는 재제작 주문 2에 결제 안내·환불·장부 행을 쓰지 않아 그대로입니다. 트리거는 `check_violation`(SQLSTATE 23514)으로 막고 메시지 앞머리에 트리거 이름을 둬 `expect_fail`이 제약과 같은 길로 셉니다. 지연 제약 트리거는 `expect_fail`·`expect_ok`가 `SET CONSTRAINTS ALL IMMEDIATE`로 바로 봅니다.
- 다이어그램: `erd_editor_sync.py --write`로 1단계 편집 13개(테이블 설명 1개, 컬럼 설명 12개), 2단계 0개, 3단계 메모(CHECK 수와 트리거 함수) 1개를 옮겼습니다. 메모가 새 트리거 함수를 적도록 `erd_editor_sync.py`의 `TRIGGER_TEXT`에 더했습니다(9절). Codex 의견을 고친 뒤 한 번 더 돌려 1단계 편집 1개(`orders.finished_at` 설명)와 3단계 메모 1개(새 트리거 함수 `orders_remake_finish_check`)를 옮겼습니다. 마지막 쓰기 없는 실행은 편집 0개, `erd_editor_build.py --compare` 차이 0줄입니다.
- 검사: 8절. 15개 모두 통과.

2026-11-14 같은 재검토의 중간 묶음 M5(RB-07, RA-08, RE-17)와 M6(RA-07, RB-18)도 같은 결정 카드의 '모두 지금 고침 (추천)'대로 검토자의 고치는 방향을 따라 고쳤습니다(두 묶음에는 Claude 추천이 없음). 요구사항은 REQ-228~235를 더하고 REQ-155를 REQ-231로 바꿨고(requirements.md 11절), 기능 명세는 SPEC-076(손님이 새 금액 확인하기)을 더하고 SPEC-004·013·015·019·027~029·031~035·042~046·048·066·067·070·071, AI-1과 상태 머신 1-2~1-5를 고쳤습니다(spec.md 8절). 바꿈은 새 마이그레이션 [`0011_amount_confirm_standard_quote.sql`](../../db/migrations/0011_amount_confirm_standard_quote.sql)입니다.

| 무엇 | 테이블.컬럼·제약 | 근거 |
| --- | --- | --- |
| 손님의 새 금액 확인 | `payment_requests.needs_amount_confirm`(NOT NULL, 기본 거짓)·`amount_confirmed_at`·`amount_declined_at`·`amount_card_id`(누른 새 금액 확인 카드, `payment_requests_amount_card_fk`) 더함. 차액 결제는 늘, 첫 결제·다시 낸 결제는 정한 금액이 요청한 금액보다 높을 때만 확인 필요(`payment_requests_needs_confirm_chk`). 확인과 받지 않음은 하나만이고 확인 필요인 결제 안내에만(`_amount_answer_chk`), 확인한 때가 전해진 때(`_amount_delivered_chk`), 확인 전에는 결제 확인 요청(`_amount_claim_chk`)과 확인됨(`_amount_paid_chk`)이 없음, 받지 않으면 닫힘(`_amount_declined_chk`). 확인 카드 종류 `amount_confirm` 더함(`confirm_cards_kind_check`를 다시 만듦). `payment_requests.amount`·`delivered_at`·`close_reason` 설명을 고침 | REQ-232, REQ-233, SPEC-076, SPEC-031~034, SPEC-043, SPEC-044, 4절 A32, 5절 E25, RA-08·RE-17 |
| 손님이 요청한 금액 | `payment_requests.requested_amount`를 다시 낸 결제에도 둠(`payment_requests_requested_amount_chk`를 첫 결제·다시 낸 결제로 다시 만듦). 표시 방식과 위 끝은 주문 첫 버전의 견적에서 읽음(설명을 고침) | REQ-231(REQ-155를 바꿈), SPEC-031, SPEC-032, 4절 A5, RB-18 |
| 차액을 기다리는 날짜 변경의 자리 | 주문마다 살아 있는 자리 하나(`slot_holds_one_live_per_order`)를 잡힌 자리 하나(`slot_holds_one_held_per_order`)와 확정된 자리 하나(`slot_holds_one_fixed_per_order`)로 나눔. 둘이 함께 있는 것은 잡힌 자리가 차액 결제 안내를 가리킬 때만(함수 `slot_holds_pair_check()`와 트리거 `slot_holds_pair`). 풀린 사유 `change_closed`(변경 요청이 반영되지 않고 닫혀 차액을 기다린 새 날을 풂) 더함(`slot_holds_release_reason_check`를 다시 만듦). `slot_holds.payment_request_id`·`status`·`fixed_at` 설명을 고침 | REQ-234, SPEC-015, SPEC-043~045, 1-4, 4절 A32, 5절 E26, RB-07 |
| 닿을 수 없던 오래된 버전 변경 | 변경 요청 상태 `stale`과 할 일 종류 `stale_change`(이전 버전 변경)를 뺌(`change_requests_status_check`, `owner_tasks_kind_check`, `owner_tasks_subject_chk`를 다시 만듦). 변경 요청 카드가 현재 버전이 아니면 받지 않아(G9, SPEC-041) 그 상태에 닿을 길이 없었음. REQ-133은 카드와 `change_requests_applied_version_chk`가 지킴 | REQ-133, 1-5, RB-07 |
| 다르게 들어온 차액과 변경 수락의 금액 | 컬럼은 그대로. `change_requests.status`(차액 결제 기다림이 새 금액 확인과 차액 맞추는 중을 품음)·`amount_delta`(사장님이 고른 방향과 양수 차이 금액으로 앱이 셈) 설명을 고침 | REQ-235, SPEC-035, SPEC-042, SPEC-071, RB-07·RE-17 |
| 기본 디자인 범위와 주문 종류 | `price_options_standard_fixed_chk`('부터'·'범위' 값의 옵션은 기본 디자인 범위에 넣지 않음), `quotes_standard_fixed_chk`(기본 디자인 견적은 '확정'만) 더함. `price_options.in_standard`·`designs.in_standard`(사장님이 고르고 가격표 버전에 함께 남음), `order_drafts.order_kind`, `quotes.order_kind`·`display_kind`·`amount`·`amount_max` 설명을 고침 | REQ-228, REQ-229, SPEC-004, SPEC-013, 4절 A32, RA-07 |
| '부터'·'범위' 견적의 최종 금액 | 컬럼은 그대로. 사장님이 수락할 때 넣은 최종 금액(아래 끝 이상)이 결제 안내 금액이고, 요청한 금액은 견적의 금액(아래 끝)이며, 위 끝을 넘으면 새 금액 확인(앱) | REQ-230, REQ-231, REQ-232, SPEC-031, 4절 A5·A32, RB-18 |

- 마이그레이션 0011: 결제 안내 컬럼 넷과 외래 키 하나, 새 CHECK 여덟(결제 안내 여섯, `price_options_standard_fixed_chk`, `quotes_standard_fixed_chk`)을 더하고, `payment_requests_requested_amount_chk`와 종류·상태 CHECK 넷(`confirm_cards_kind_check`, `change_requests_status_check`, `owner_tasks_kind_check`, `slot_holds_release_reason_check`), `owner_tasks_subject_chk`를 지우고 다시 만들고, `slot_holds_one_live_per_order`를 부분 UNIQUE 둘로 바꾸고, 함수와 트리거 하나씩을 만듭니다. 운영 데이터가 아직 없어(10단계 전) 옮길 행이 없고, 있으면 이미 나간 차액 결제 안내는 새 금액 확인이 필요한 것으로 두고 전해진 시각(없으면 결제 확인 요청·확인된 시각)을 확인한 시각으로 채우며(머리의 UPDATE), `stale` 변경 요청과 `stale_change` 할 일은 만들 길이 없어 없음을 머리 주석에 적었습니다. 컬럼 설명 23줄은 `schema.sql`과 같은 줄을 옮겨 D2가 같음을 봅니다. D2는 함수 7개와 트리거 11개를 견줍니다(8절).
- 대응(`erd_map.py`): SPEC-076(21건: 새 금액 확인의 네 컬럼, 카드의 종류·내용·손님·키·기한, 요청한 금액과 표시 방식, 정한 금액의 사유, 결제 기한과 상한, 전해진 시각, 닫는 사유, 손님 취소, 풀린 사유, 차액 없어 닫힘, 사장님 알림, 장부 쓰기)을 더하고, SPEC-013·027·028·031에 주문 종류와 표시 방식·아래 끝·위 끝·요청 때 쓴 견적, SPEC-015·042~045에 새 날 자리와 그 풂, 새 금액 확인과 받지 않음, SPEC-032~035·066에 확인한 시각·요청한 금액의 표시 방식·확인 카드를 다시 보임·결제로 확인한 시각을 손님의 확인으로·변경 닫기를 더하고, SPEC-042·043·045·070의 이름을 지금 뜻으로 고쳤습니다(데이터 909건 → 964건, 컬럼 445개 → 449개. 새로 쓰인 컬럼은 결제 안내의 새 컬럼 넷).
- 규칙 테스트 207개 → 221개. 1부의 차액 결제(주문 3 버전 2 변경의 차액 5,000원)를 새 금액 확인 필요로 쓰고, 손님이 누른 새 금액 확인 카드(`amount_confirm`)와 확인한 시각·전해진 시각을 남깁니다. 새 테스트 14개: 범위 값의 옵션을 기본 디자인 범위에 넣음 1개(`price_options_standard_fixed_chk`), 범위 견적의 기본 디자인 주문 1개(`quotes_standard_fixed_chk`), 오래된 버전 상태의 변경 요청과 이전 버전 변경 할 일 2개(`change_requests_status_check`, `owner_tasks_kind_check`), 주문 하나에 잡힌 자리 둘 1개(`slot_holds_one_held_per_order`), 차액 결제가 아닌 잡힌 자리를 확정된 자리와 함께 1개(트리거 `slot_holds_pair`), 들어가야 할 새 날 자리를 잡고 변경이 닫혀 풂 1개(`expect_ok`), 새 금액 확인이 없는 차액 결제와 요청한 금액보다 높지 않은 다시 낸 결제의 확인 필요 2개(`payment_requests_needs_confirm_chk`), 확인 전에 전해짐·결제 확인 요청·확인됨 3개(`payment_requests_amount_delivered_chk`, `_amount_claim_chk`, `_amount_paid_chk`), 받지 않았는데 열린 결제 안내 1개(`_amount_declined_chk`), 확인 필요가 아닌 결제 안내의 확인한 시각 1개(`_amount_answer_chk`). 주문 하나에 확정된 자리 둘을 막는 1-4 테스트는 인덱스 이름을 `slot_holds_one_fixed_per_order`로 고쳤습니다.
- 다이어그램: `erd_editor_sync.py --write`로 1단계 편집 41개(컬럼 4개 더함과 이름·타입·자리, NOT NULL 1개, 기본값 1개, 컬럼 설명 23개), 2단계 관계 1개(`payment_requests.amount_card_id` → `confirm_cards`), 3단계 메모(CHECK 수와 트리거 함수)와 after 스크립트(잡힌 자리·확정된 자리의 부분 UNIQUE 둘) 2개를 옮겼습니다. 메모가 새 트리거 함수를 적도록 `erd_editor_sync.py`의 `TRIGGER_TEXT`에 더했습니다(9절). 마지막 쓰기 없는 실행은 편집 0개, `erd_editor_build.py --compare` 차이 0줄입니다.
- 검사: 8절. 15개 모두 통과.

2026-11-14 같은 재검토의 중간 묶음 M7(RC-16, RD-05, RC-06)과 M17(RC-08, RC-13, RC-12)도 같은 결정 카드의 '모두 지금 고침 (추천)'대로 검토자의 고치는 방향을 따라 고쳤습니다(두 묶음에는 Claude 추천이 없음). 기능 명세는 SPEC-020·022·023·065를 고쳤고(spec.md 8절), 06단계는 DEC-04와 이 컬럼을 읽는 스키마를 고쳤으며(06 README 15절, 깨지는 변화는 11절), 화면 정의는 SCR-017을 고쳤습니다(08 README 12절). 바꿈은 새 마이그레이션 [`0012_request_keys_questions_extras.sql`](../../db/migrations/0012_request_keys_questions_extras.sql)입니다.

| 무엇 | 테이블.컬럼·제약 | 근거 |
| --- | --- | --- |
| 같은 요청 키의 다른 내용·처리 중·다시 옴 | `request_keys`에 `request_hash`(HMAC-SHA256 16진수 64자)·`state`(처리 중·끝남)·`processing_expires_at`(받은 때 + 60초)·`response_code`·`response_ref`(가리킨 기록의 ID)·`done_at`을 더하고, `response_status`는 끝났을 때만 200~499로 두며(서버 오류는 남기지 않음) `response_body`를 뺌(`request_keys_state_chk`). 지우기가 24시간 지난 행을 지움(6절 7) | 06 DEC-04, G2, REQ-132, 5절 E27, RC-16 |
| 이벤트 키 형식과 대상마다 하나 | 이벤트 키·가예약 키 설명에 형식을 적음(4절 A33). `refunds.cancelled_order_id`(`refunds_cancelled_fk`, `refunds_cancelled_chk`, 함수 `refunds_cancelled_check()`와 트리거 `refunds_cancelled`)와 대상마다 UNIQUE 넷(`refunds_cancelled_uq`, `refunds_change_uq`, `refunds_issue_uq`, `refunds_request_uq`). `orders.confirmed_payment_id`(`orders_confirmed_payment_chk`, `orders_confirmed_payment_fk`와 그 참조 키 `payments_order_key`, 함수 `confirmed_payment_live_check()`와 지연 제약 트리거 `orders_confirmed_payment_live`·`payments_confirmed_void`) | G2, REQ-060, REQ-154, SPEC-036, SPEC-070, 4절 A1·A33, 5절 E29, RD-05·RC-06 |
| 덧붙은 질문과 마감된 날 질문 | 새 테이블 `handoff_questions`(TBL-055, CTX-001: 질문마다 사유·손님 말·관련 주문, 같은 말은 한 번 `handoff_questions_message_uq`). 마감된 날 질문은 상담과 날짜마다 열린 건 하나(`handoffs_one_open_day_per_consultation`)로 두고 `handoffs_one_open_per_consultation`에서 뺌. `handoffs.day_used_order_id`(추가 수락을 쓴 주문 요청, `handoffs_day_used_fk`·`_uq`·`_chk`). `handoffs.source_message_id`·`requested_day` 설명을 고침 | SPEC-014, SPEC-022, SPEC-023, SPEC-029, R10, REQ-225, 4절 A3·A34, 5절 E28, RC-08 |
| 날짜만 아는 초안 | `order_drafts.pickup_at`을 `pickup_day`(date)와 `pickup_time`(time)으로 나누고 날짜 없이 시각만은 막음(`order_drafts_pickup_time_chk`) | SPEC-014, SPEC-020, SPEC-027, SPEC-029, 5절 E30, RC-13 |
| 더하는 옵션과 (상담, 손님) 쌍 | `order_drafts.extra_option_ids`·`order_details.extra_option_ids`(uuid[])를 새 연결 테이블 `order_draft_extras`(TBL-056, CTX-001)·`order_detail_extras`(TBL-057, CTX-003)로 옮김: 초안·주문 내용과 같은 가격표 버전(`order_draft_extras_draft_fk`·`order_detail_extras_detail_fk`, 참조 키 `order_drafts_list_key`·`order_details_list_key`)의 더하는 옵션만(`*_option_fk`, 참조 키 `price_options_group_key`). 주문·확인 카드·손님 안내는 (가게, 상담, 손님)으로 상담을 참조(`*_consultation_fk`, 참조 키 `consultations_customer_key`) | SPEC-013, SPEC-027, SPEC-028, SPEC-029, SPEC-050, G1, 5절 E1·E30, RC-12 |

- 마이그레이션 0012: 요청 키 행을 지우고(하루만 쓰는 값) 컬럼 여섯을 더하고 하나를 빼며, 새 테이블 셋, 컬럼 다섯(초안의 픽업 날짜·시각, 주문을 확정한 결제, 환불의 취소한 주문, 에스컬레이션 건의 추가 수락을 쓴 주문 요청)을 더하고 초안의 픽업 일시와 더하는 옵션 배열 둘을 뺍니다. 외래 키 열(새 테이블 일곱 포함)·UNIQUE 열하나·CHECK 열셋·인덱스 둘(마감된 날 질문 건의 부분 UNIQUE, 건마다 덧붙은 질문)을 더하고, 상담을 참조하는 외래 키 셋과 `order_drafts_options_need_list_chk`·`handoffs_day_chk`·`handoffs_one_open_per_consultation`을 다시 만들고, 함수 둘과 트리거 셋을 만듭니다. 운영 데이터가 아직 없어(10단계 전) 옮길 행이 없고, 있으면 초안의 픽업 일시는 가게 시간대의 날짜와 시각으로, 더하는 옵션 배열은 연결 테이블 행으로, 확정된 뒤의 주문은 취소하지 않은 첫 결제·다시 낸 결제를 주문을 확정한 결제로, 취소 환불은 취소한 주문으로 옮김을 머리 주석에 적었습니다. 컬럼 설명 39줄은 `schema.sql`과 같은 줄을 옮겨 D2가 같음을 봅니다. D2는 함수 9개와 트리거 14개를 견줍니다(8절).
- 대응(`erd_map.py`): 더하는 옵션 두 곳을 연결 테이블로, 픽업 일시를 날짜와 시각으로 바꾸고, SPEC-013·014·020·022·023·027·029·030·034·036·046·047·048·050·065·070에 덧붙은 질문, 마감된 날 질문 건과 추가 수락을 쓴 주문 요청, 요청 키의 지문·처리 상태·처음 결과, 주문을 확정한 결제, 취소한 주문을 더했습니다(데이터 964건 → 998건, 컬럼 449개 → 468개).
- 규칙 테스트 221개 → 257개. 정상 플로우의 초안 셋은 픽업 날짜와 시각으로, 더하는 옵션은 연결 테이블 행으로, 확정된 주문 셋은 주문을 확정한 결제로, 취소 환불 둘은 취소한 주문으로 쓰고, 덧붙은 질문 하나와 끝난 요청 키 하나를 더합니다. 새 테스트 36개: 06 DEC-04 6개(처리 중인 키의 처음 결과·기한 없는 처리 중·결과 종류 없는 끝남은 `request_keys_state_chk`, 16진수 64자가 아닌 지문, 서버 오류를 처음 결과로, 하루 지난 키는 지우기가 지움), M7 10개(취소한 주문 없는 취소 환불, 다른 주문의 취소로 환불(트리거 `refunds_cancelled`), 재제작 주문의 취소 환불을 원래 주문에(`expect_ok`), 대상마다 둘째 환불 넷, 주문을 확정한 결제 없는 주문 확정, 다른 주문의 결제로 주문 확정, 주문을 확정한 결제의 확인을 취소하고 주문은 확정된 그대로(지연 트리거 `payments_confirmed_void`)), G2 3개(같은 가예약 키·이벤트의 할 일·사장님 알림 둘), M17 17개(열린 건이 있어도 날짜마다 따로 건(`expect_ok`), 같은 날 마감된 날 건 둘, 날짜 없는 마감된 날 질문과 마감된 날이 아닌 질문의 날짜, 추가 수락 없이 쓴 주문 요청, 주문 요청 하나가 추가 수락 둘을 씀, 마감된 날 질문을 덧붙임, 같은 말을 두 번 덧붙임, 날짜만 아는 초안(`expect_ok`), 날짜 없이 시각만, 다른 가격표 버전·무리·두 번의 더하는 옵션, 다른 가게의 더하는 옵션을 주문 내용에, 다른 손님의 상담으로 주문·확인 카드·손님 안내). G2의 같은 화면 요청 키, G2·M13의 환불, H12의 늦은 쓰기 둘은 새 컬럼에 맞춰 고쳤습니다. D5의 준비도 주문을 확정한 결제를 씁니다(`check_erd.py`).
- 다이어그램: `erd_editor_sync.py --write`로 새 테이블 셋과 컬럼·설명, 관계와 인덱스, 메모(CHECK 수와 트리거 함수 둘)와 after 스크립트를 옮겼습니다. 새 테이블 셋이 그룹 상자 밖에 남아, 상자를 아래로 늘리지 못하면 오른쪽으로 늘리고 상자 밖에 남은 테이블도 옮기도록 `place_new_tables`를 고쳤습니다(9절). 메모가 새 트리거 함수를 적도록 `TRIGGER_TEXT`에 더했습니다. 마지막 쓰기 없는 실행은 편집 0개, `erd_editor_build.py --compare` 차이 0줄입니다.
- 금지어: 이 PR이 새로 쓴 설명에서 용어집이 허용하지 않는 꼴로 쓴 '확정'을 '주문을 확정한 결제'·'주문 확정 뒤 상태'처럼 허용 꼴로 고치고(스키마·마이그레이션 0012의 설명과 함수 `confirmed_payment_live_check()`의 오류 글, 매핑 이름, 규칙 테스트 이름 셋, 다이어그램 메모 `TRIGGER_TEXT`, `check_erd.py`의 D5 설명), 키 형식 표의 옛말을 '사유'로 고쳤습니다. 바꾼 문서의 금지어 수는 main과 같거나 적고, 새로 보이는 것은 8절 출력 그대로인 D2·D3 두 줄의 숫자가 바뀐 것뿐입니다.
- Codex 의견([PR #37](https://github.com/kodonghui/siljang.ai/pull/37#discussion_r4572803814)): 장부 쓰기 키의 대상을 주문으로 읽으면 같은 주문의 두 번째 변경이나 재제작 주문의 다음 일이 첫 키에 막혀 장부가 고쳐지지 않습니다. 대상을 그 일을 만든 기록(주문을 확정한 결제·변경 요청·환불·확인을 취소한 결제, 끝 상태는 주문)으로 정하고 재제작은 뒤에 그 일을 붙였습니다(4절 A33과 키 형식 표, `ledger_writes.event_key` 설명과 마이그레이션 0012의 같은 설명, 다이어그램). UNIQUE는 그대로입니다.
- 검사: 8절. 15개 모두 통과.

2026-11-14 같은 재검토의 중간 묶음 M16(RB-14, RD-15, RC-07)과 M18(RD-06, RD-09, RD-11)도 같은 결정 카드의 '모두 지금 고침 (추천)'대로 검토자의 고치는 방향을 따라 고쳤습니다(두 묶음에는 Claude 추천이 없음). 기능 명세는 AI-1과 SPEC-001·008·017·020·021·068을 고쳤고(spec.md 8절), 06단계는 DEC-02·08·10과 OPEN-2·7·8을 고치고 OPEN-10·11과 API-078·079를 더했으며 이 컬럼을 읽는 스키마를 고쳤습니다(06 README '확정한 뒤 고친 것', 깨지는 변화 표). RD-09(본문·쿼리의 다른 기록 ID)와 RD-11(사장님 로그인의 state·PKCE)은 06단계만 바뀌고 이 단계의 컬럼은 그대로입니다.

| 무엇 | 테이블.컬럼·제약 | 근거 |
| --- | --- | --- |
| 한 차례의 AI 호출 순번과 다시 한 종류 | `ai_calls.attempt`의 위 끝(3)을 없애 차례 안 순번(1부터)으로 두고, `call_kind`(처음 `first`·도구 뒤 이어 하기 `after_tool`·다시 하기 `retry`·다시 쓰기 `regenerate`)를 더함. 처음은 순번 1에만(`ai_calls_kind_chk`). `fallback_reason`에 차례마다 호출 상한 `call_limit`을 더함(상한 8번은 앱이 지킴, 4절 A35) | AI-1, SPEC-020, RC-07 |
| 스킬 키 버전과 앞 버전 키 | `kakao_channels.skill_key_version`(1~10000)·`skill_key_issued_at`·`previous_key_until`(바꾼 때부터 24시간까지, 버전 2부터, `kakao_channels_prev_key_chk`). 키와 연결 문구는 서버 시크릿으로 만들어 저장하지 않음(해시도 두지 않음, 4절 A36) | SPEC-008, SPEC-017, REQ-237, 06 DEC-08, RD-06 |
| '연결 확인 중' 선점 30분 | `kakao_channels.claim_expires_at`(연결 확인 중에만 있음, `kakao_channels_claim_chk`). 지난 뒤 다른 가게가 같은 봇을 넣으면 앱이 그 연결을 '연결 안 됨'으로 바꾸고 넣음(4절 A36). 연결 확인 컬럼 설명의 '테스트 메시지'를 '연결 문구'로 | SPEC-008, REQ-238, RD-06 |
| 알레르기 답의 요구사항 | `order_drafts.allergy_answer`·`order_details.allergy_answer` 설명의 REQ-142를 REQ-236으로(02단계가 REQ-142를 제외하고 확인할 수 있는 문장의 REQ-236으로 바꿈) | SPEC-021, REQ-236, RB-14 |

- 마이그레이션 0013: `ai_calls`의 CHECK 둘(`ai_calls_attempt_check`, `ai_calls_fallback_reason_check`)을 바꾸고 컬럼 하나와 제약 하나를, `kakao_channels`에 컬럼 넷과 제약 둘을 더하며, 컬럼 설명 열한 개를 schema.sql과 같게 둡니다. 옮길 운영 데이터는 없고, 있으면 지난 호출의 순번 2부터는 다시 하기로, 스킬 키는 버전 1을 연결을 만든 시각에 만든 것으로, 연결 확인 중인 연결은 연결 확인 시작(없으면 만든 시각)에서 30분을 선점이 풀리는 시각으로 둡니다.
- 대응(`erd_map.py`): SPEC-008에 스킬 키 버전·만든 시각·앞 버전 키를 받는 끝·선점이 풀리는 시각, SPEC-017에 요청의 스킬 키 버전과 앞 버전 키를 받는 끝, SPEC-020에 차례 안 호출 순번과 다시 한 종류를 더하고 '테스트 메시지를 보낸 사용자'를 '연결 문구를 보낸 사용자'로 고쳤습니다(데이터 998건 → 1006건, 대응 컬럼 468개 → 474개).
- 규칙 테스트 257개 → 272개. 정상 플로우의 '연결 확인 중' 연결과 'SPEC-008 채널 하나를 두 가게에'의 행은 선점이 풀리는 시각을 둡니다(이름이 앞서는 `kakao_channels_claim_chk`에 먼저 막히지 않게). 새 테스트 15개: REQ-237 5개(바꾸지 않은 키의 앞 버전, 24시간을 넘는 앞 버전, 버전 0은 막힘, 앞 버전을 24시간 받음·바로 끊음은 들어감), REQ-238 4개(선점이 풀리는 시각 없는 연결 확인 중, 연결됨에 남은 선점, 선점이 남은 봇을 다른 가게가 넣음은 막힘, 30분이 지난 선점을 풀고 같은 봇을 넣음은 들어감), AI-1 6개(첫 호출이 아닌 처음, 다시 하기로 남긴 첫 호출, 순번 0, 모르는 다시 한 종류는 막힘, 한 차례에 도구 뒤 이어 하기·다시 하기·다시 쓰기로 8번 호출과 호출 상한 이유는 들어감).
- 다이어그램: `erd_editor_sync.py --write`로 새 컬럼 다섯과 설명, `call_kind`의 자리(`attempt` 뒤), 바뀐 설명과 메모의 CHECK 수를 옮겼습니다. `erd_editor_build.py --compare`는 양쪽에만 있는 줄이 0이었습니다(9절).
- 검사: 8절. 15개 모두 통과.

2026-11-14 같은 재검토의 중간 묶음 M11(RA-05)과 M14(RB-12)도 같은 결정 카드의 '모두 지금 고침 (추천)'대로 검토자의 고치는 방향을 따라 고쳤습니다(두 묶음에는 Claude 추천이 없음). 요구사항은 REQ-239~245를 더하고 REQ-106을 REQ-239로, REQ-108을 REQ-242로 바꿨고(requirements.md 11절), 기능 명세는 SPEC-077(가게 정보와 설정 바꾸기)·SPEC-078(사업자 정보 변경 요청과 운영자 확인)을 더하고 SPEC-002·003·005·007·011·017·024·025·028·036·040·061·066을 고쳤습니다(spec.md 8절). 바꿈은 새 마이그레이션 [`0014_shop_identity_settings.sql`](../../db/migrations/0014_shop_identity_settings.sql)입니다.

| 무엇 | 테이블.컬럼·제약 | 근거 |
| --- | --- | --- |
| 가게 신원 정보 | `shops.business_address`(사업장 주소, 1~200자)·`contact_email`(전자우편주소, 3~100자, 공백 없이 `@`가 하나인 꼴)를 NOT NULL로, `mail_order_authority`(통신판매업 신고를 받은 기관, 1~40자)를 더함. 신고번호와 기관은 함께 있거나 함께 없음(`shops_mail_order_authority_chk`). 신고번호도 면제 사유도 없는 가게는 그대로 막음(`shops_mail_order_chk`, 설명의 REQ-106을 REQ-239로). `contact_phone`·`pickup_address`와 테이블 설명을 고침 | REQ-239(REQ-106을 바꿈), REQ-242(REQ-108을 바꿈), REQ-244, SPEC-002, SPEC-011, SPEC-036, SPEC-077, RA-05 |
| 사업자 정보 변경 요청 | 새 테이블 `shop_identity_changes`(TBL-058, CTX-007): 새 상호·대표자·사업자등록번호와 요청할 때의 값(`prev_*`), 증빙 사진, 상태(확인 기다림·반영함·보류), 보류 이유, 반영·보류한 운영자와 시각. 세 값이 모두 요청할 때와 같으면 막음(`shop_identity_changes_differs_chk`), 보류에만 이유(`_hold_chk`), 확인 기다림에만 운영자·시각이 없음(`_reviewed_chk`), 가게마다 확인 기다림 하나(`shop_identity_changes_one_pending`), 운영자 확인 목록용 `shop_identity_changes_queue_idx`. 사장님 알림 종류 `identity_change_applied`·`identity_change_on_hold`를 더함(`owner_alerts_kind_check`를 다시 만듦). `shops.business_name`·`representative_name`·`business_reg_no` 설명에 이 길을 적음 | REQ-245, REQ-197, REQ-199, SPEC-003, SPEC-078, 4절 A37, 5절 E31, RB-12 |
| 가게가 정하는 값을 쓰는 때 | 컬럼은 그대로. `shops.owner_wait_minutes`(그 뒤 시작된 기다림부터, `owner_tasks.wait_due_at`)·`idle_close_hours`·`daily_ai_cost_limit_krw`(저장한 때부터)·`business_calendars.review_request_time`(아직 보내지 않은 후기 부탁부터) 설명을 고침 | REQ-243, SPEC-007, SPEC-061, SPEC-077, 4절 A37, RB-12 |

- 마이그레이션 0014: `shops`에 컬럼 셋과 CHECK 넷을 더하고, `owner_alerts_kind_check`를 지우고 다시 만들고, 새 테이블 `shop_identity_changes`(컬럼 열넷, 외래 키 둘, CHECK 열하나, 부분 인덱스 둘)를 만듭니다. 운영 데이터가 아직 없어(10단계 전) 옮길 행이 없습니다. 가게 행이 있으면 사업장 주소와 전자우편주소는 사장님께 받아야 하는 값이라 NOT NULL을 더하는 이 마이그레이션이 실패하므로, 그 값을 먼저 받아 넣는 마이그레이션을 앞에 둔다고 머리 주석에 적었습니다. 컬럼 설명 27줄은 `schema.sql`과 같은 줄을 옮겨 D2가 같음을 봅니다.
- 대응(`erd_map.py`): SPEC-002·011에 사업장 주소·전자우편주소·신고를 받은 기관, SPEC-007에 후기 부탁 시각, SPEC-036에 확정 안내의 결제가 확인된 금액·가게 신원·운영 규칙, SPEC-040에 내 주문의 결제를 확인한 시각·주문 내용 버전·환불 금액과 보낸 시각을 더하고, 새 SPEC-077(15건)·SPEC-078(24건)을 더했습니다(데이터 1006건 → 1062건, 대응 컬럼 474개 → 492개).
- 규칙 테스트 272개 → 282개. 정상 플로우의 가게 둘은 사업장 주소·전자우편주소(가게 1은 신고를 받은 기관도)를 쓰고, 가게 2의 반영한 상호 변경 요청과 그 사장님 알림, 확인을 기다리는 대표자 변경 요청을 더합니다. 새 테스트 10개: REQ-239 4개(신고번호만 있고 기관 없음과 기관만은 `shops_mail_order_authority_chk`, 전자우편주소 꼴, 사업장 주소 없음), SPEC-078 6개(한 가게에 확인 기다림 둘은 `shop_identity_changes_one_pending`, 세 값이 그대로는 `_differs_chk`, 이유 없는 보류는 `_hold_chk`, 운영자·시각 없는 반영과 확인 기다림에 남은 운영자는 `_reviewed_chk`, 보류한 뒤 새 변경 요청은 들어감). 가게를 넣는 2부 테스트 둘(카카오 계정 하나에 가게 둘, 처리 위탁 동의 없는 가게)은 새 컬럼을 채워 기대한 제약에 막히고, 'REQ-106' 테스트의 이름을 REQ-239로 고쳤습니다.
- 다이어그램: `erd_editor_sync.py --write`로 새 테이블과 컬럼·설명, `shops`의 새 컬럼 셋과 바뀐 설명, 관계 둘, 메모의 CHECK 수, after 스크립트(새 부분 인덱스 둘)를 옮겼습니다. 새 테이블은 CTX-007 그룹 상자 안(x 2440, y 7416)에 놓였고 상자 크기는 그대로입니다(9절). 마지막 쓰기 없는 실행은 편집 0개, `erd_editor_build.py --compare` 차이 0줄입니다.
- 검사: 8절. 15개 모두 통과.

2026-11-14 같은 재검토의 중간 묶음 M12(RA-13, RB-15)도 같은 결정 카드의 '모두 지금 고침 (추천)'대로 고쳤습니다. RA-13은 검토자의 고치는 방향을 따랐고, RB-15는 Claude 추천이라 동희님 확인을 요청했습니다(되돌릴 수 있음, 2026-11-15 14:19 동희님 결정 카드 '지금대로 둠 (추천)'으로 확정했고 마이그레이션 0020 머리말에 적음). 요구사항은 REQ-246~254를 더하고 REQ-062를 REQ-251로, REQ-063을 REQ-252·REQ-253으로, REQ-073을 REQ-246으로 바꿨고(requirements.md 11절), 기능 명세는 SPEC-079(에스컬레이션 건에서 문제 신고로 남기기)를 더하고 SPEC-005·022·023·040·046·057·058·059·065·069·076을 고쳤습니다(spec.md 8절). 바꿈은 새 마이그레이션 [`0015_issue_kind_reporter.sql`](../../db/migrations/0015_issue_kind_reporter.sql)입니다.

| 무엇 | 테이블.컬럼·제약 | 근거 |
| --- | --- | --- |
| 문제 종류 | `issue_reports.problem_kind`(상함·변질 `spoiled`·이물 `foreign_matter`·그 밖 `other`)를 더함. 보상을 정하면 문제 종류도 있음(`issue_reports_problem_kind_chk`) | REQ-247, SPEC-059, 4절 A38, RA-13 |
| 보상 없음의 사유 | `issue_reports.no_compensation_reason`(1~200자)을 더함. 상함·변질·이물의 보상 없음에만 있고(`issue_reports_none_reason_chk`) 그때는 꼭 있음(`_none_reason_needed_chk`, 3년 뒤 비운 것은 빼고) | REQ-248, SPEC-059, 4절 A38, RA-13 |
| 그 밖의 보상 | `compensation`에 `other_compensation`을 더하고(설명의 REQ-073을 REQ-246으로), 사장님이 한 일 `other_compensation_note`(1~200자, 그 밖의 보상에만 있고 그때는 꼭 있음: `_other_note_chk`, `_other_note_needed_chk`)와 금액 `other_compensation_amount`(선택, 0원~1억 원, `_other_amount_chk`)를 더함. 환불·장부 행은 없음 | REQ-246, REQ-249, SPEC-059, 4절 A38, RA-13 |
| 3년 뒤 비움 | `issue_reports.notes_purged_at`을 더함. 비운 뒤에는 사유와 한 일이 없음(`issue_reports_notes_purged_chk`). 지우기 3에서 신고 설명과 함께 비움(6절) | REQ-188, SPEC-065 |
| 에스컬레이션 건에서 남긴 문제 신고 | `issue_reports.reported_by`(주문자 `orderer`·사장님이 에스컬레이션 건에서 남김 `owner_from_handoff`, 기본 주문자)와 `handoff_id`를 더하고 `card_id`의 NOT NULL을 풂. 신고 카드는 주문자의 신고에만(`issue_reports_reporter_chk`), 건은 사장님이 남긴 신고에만(`_handoff_chk`), 그 건의 관련 주문과 같은 주문(`issue_reports_handoff_fk`, 대상으로 `handoffs_order_scope` UNIQUE를 더함), 건 하나에 신고 하나(`issue_reports_handoff_uq`). 지우기 2에서 건을 지우기 전에 연결을 비움 | REQ-254, REQ-251, SPEC-079, SPEC-065, 4절 A38, 5절 E32, RB-15 |
| 다른 카카오 사용자 건 | `handoffs_one_open_per_consultation`을 다시 만들어 관련 주문이 있는 다른 카카오 사용자 건(`other_user`)을 빼고, 상담과 관련 주문마다 열린 건 하나(`handoffs_one_open_other_user_per_order`)를 더함. 관련 주문이 없으면 지금처럼 열린 건 하나에 셈 | SPEC-022, SPEC-079, 4절 A38, 5절 E32, [PR #40 Codex 의견](https://github.com/kodonghui/siljang.ai/pull/40#discussion_r4573944173) |

- 마이그레이션 0015: `handoffs`에 UNIQUE 하나를 더하고 열린 건 하나 인덱스를 다시 만들고 인덱스 하나(`handoffs_one_open_other_user_per_order`)를 더하고, `issue_reports`의 `card_id` NOT NULL을 풀고 `issue_reports_compensation_check`를 지우고 다시 만들고, 컬럼 일곱(CHECK 다섯)과 외래 키 하나, UNIQUE 하나, CHECK 아홉을 더합니다. 운영 데이터가 아직 없어(10단계 전) 옮길 행이 없습니다. 보상을 정한 신고 행이 있으면 문제 종류가 없어 `issue_reports_problem_kind_chk`에서 실패하므로, 사장님께 문제 종류를 받아 넣는 마이그레이션을 앞에 둔다고 머리 주석에 적었습니다. 컬럼 설명 9줄은 `schema.sql`과 같은 줄을 옮겨 D2가 같음을 봅니다.
- 대응(`erd_map.py`): SPEC-059에 문제 종류·보상 없음 사유·그 밖의 보상의 한 일과 금액·신고한 사람, SPEC-065에 비운 시각과 지우는 건과 신고의 연결을 더하고, 새 SPEC-079(14건)를 더했습니다(데이터 1062건 → 1083건, 대응 컬럼 492개 → 499개).
- 규칙 테스트 282개 → 303개. 1부의 보상을 정한 신고는 문제 종류 '그 밖'을 씁니다. 지우기 데이터에 손님 3이 주문 1을 선물로 받았다며 남긴 에스컬레이션 건(답함)과 사장님이 그 건에서 남긴 주문 1의 신고(상함·변질, 사유를 남긴 보상 없음, 닫힘)를 더해, 지우기 전 지울 상담의 내용을 25건에서 26건으로 고쳤습니다. 새 테스트 21개: REQ-247 2개(보상을 정하면서 문제 종류 없음, 그 밖 문제의 사유 없는 보상 없음은 들어감), REQ-248 3개(상함·변질에 사유 없는 보상 없음, 사유는 상함·변질·이물의 보상 없음에만, 사유를 남긴 보상 없음은 들어감), REQ-249 4개(그 밖의 보상에 한 일 없음, 한 일과 금액은 그 밖의 보상에만, 한 일과 금액을 남긴 그 밖의 보상은 들어감), SPEC-065 1개(비운 뒤 다시 쓴 사유), RB-15 8개(신고 카드 없는 주문자 신고, 주문자 신고에 에스컬레이션 건, 관련 주문이 다른 건에서 남긴 신고, 건 하나에 신고 둘, 신고 카드 없이 사장님이 남긴 신고는 들어감, 다른 열린 건이 있는 상담에서 관련 주문이 있는 다른 카카오 사용자 건은 따로 열림, 같은 상담·같은 주문의 열린 그 건 둘, 관련 주문이 없는 그 건은 열린 건 하나 규칙을 따름. 뒤의 셋은 Codex 의견), E32 2개(신고 연결을 끊지 않고 건을 지움은 막힘, 상담을 지우면 건은 지우고 신고는 연결만 끊김), M12 1개(3년 뒤 사유도 비우고 문제 종류와 보상은 남음).
- 다이어그램: `erd_editor_sync.py --write`로 `issue_reports`의 새 컬럼 일곱과 설명, `card_id`의 NOT NULL을 푼 것과 바뀐 설명 둘, 관계 하나(`issue_reports` → `handoffs`, 세 컬럼), `handoffs`의 UNIQUE 인덱스 하나(`handoffs_order_scope`), 메모의 CHECK 수를 옮겼고, Codex 의견을 고친 뒤 after 스크립트의 부분 인덱스 둘(다시 만든 `handoffs_one_open_per_consultation`, 새 `handoffs_one_open_other_user_per_order`)을 옮겼습니다. 마지막 쓰기 없는 실행은 편집 0개, `erd_editor_build.py --compare` 차이 0줄입니다.
- 검사: 8절. 15개 모두 통과.

2026-11-15 같은 재검토가 남긴 빈 곳(PR J2)도 같은 결정 카드의 '모두 지금 고침 (추천)'대로 고쳤습니다. 들어온 입금의 환불을 정한 뒤 같은 결제 안내에 또 들어온 돈은 결제 안내마다 환불 하나(`refunds_request_uq`)라 돌려줄 길이 없었습니다(설계 재검토 H1·M5가 남긴 열린 문제, 4절 A33).

| 무엇 | 테이블.컬럼·제약 | 근거 |
| --- | --- | --- |
| 셈한 들어온 금액 | `refunds.counted_arrived_amount`(1원~1억 원)를 더함: 그 환불이 셈한 그 결제 안내의 들어온 금액(합). 결제 안내가 있을 때만(`refunds_counted_chk`) 있고, 비어 있으면 트리거 `refunds_unconfirmed`가 그 결제 안내의 지금 들어온 금액으로 채움 | SPEC-016, SPEC-071, 4절 A29 |
| 결제 안내의 들어온 금액(합)마다 환불 하나 | `refunds_request_uq`를 `(payment_request_id)`에서 `(payment_request_id, counted_arrived_amount)`로 좁힘. 같은 결제 안내에 다시 들어온 입금은 새 키(`refund:{결제 안내 ID}:{사유}:{셈한 들어온 금액}`)의 새 환불 | SPEC-047, SPEC-071, 4절 A33 |
| 취소 환불의 결제 안내 | `refunds_request_chk`를 넓혀 손님 취소·가게 사정 취소의 환불도 결제 확인 요청 중이거나 맞추는 중이던 결제 안내의 들어온 금액을 셈했으면 그 결제 안내를 가짐(그 뒤 또 들어온 입금의 계산값에서 그 몫을 뺌. 맞추는 중은 다르게 들어온 금액이 이미 들어온 금액이라 PR J2의 Codex 자동 검토로 더함). 금액이 내려간 변경·보상 환불은 결제 안내가 없음 | SPEC-046, SPEC-071 |
| 앞 환불이 셈한 몫을 다시 돌려주지 않음 | 함수 `refunds_unconfirmed_check()`와 트리거 `refunds_unconfirmed`(셈한 금액 컬럼에도 걸림)를 다시 만듦: 그 결제 안내 행을 잠그고(`FOR NO KEY UPDATE`), 들어온 금액이 없거나 셈한 금액이 들어온 금액을 넘거나 앞 환불보다 적으면 막고, 들어온 입금의 환불 계산값은 셈한 금액 - (확인된 결제와 앞 환불이 셈한 금액 가운데 큰 값)까지 | SPEC-016, REQ-165 |
| 들어온 금액의 설명 | `payment_requests.arrived_amount`·`arrived_at`·`payment_requests_arrived_amount_chk`의 설명: 같은 결제 안내에 또 들어오면 더한 합(확인됨에 더 들어온 입금도), 마지막으로 남긴 시각 | SPEC-071 |

- 마이그레이션 0016: `refunds`에 컬럼 하나를 더하고 결제 안내를 가진 환불 행을 지금 들어온 금액으로 채운 뒤, `refunds_request_uq`·`refunds_request_chk`를 지우고 다시 만들고 `refunds_counted_chk`를 더하고, 함수와 트리거를 다시 만들고, 바뀐 컬럼 설명 다섯을 고침. 빈 DB에 0001~0016을 적용한 카탈로그가 `schema.sql`과 같음(D2).
- 대응(`erd_map.py`): SPEC-071에 '앞 환불이 셈한 들어온 금액'(`refunds.counted_arrived_amount`)을 더함(데이터 1083건 → 1084건, 대응 컬럼 499개 → 500개).
- 규칙 테스트 303개 → 309개: 환불을 정한 뒤 같은 결제 안내에 또 들어온 5,000원의 새 환불(들어감), 앞 환불이 셈한 1,000원까지 다시 돌려줌·앞 환불보다 적게 셈함·셈한 금액이 들어온 금액을 넘음(`refunds_unconfirmed`), 결제 안내 없이 셈한 금액(`refunds_counted_chk`), 금액이 내려간 변경의 환불에 결제 안내(`refunds_request_chk`). 있던 테스트는 그대로 지나감(결제 안내의 같은 들어온 금액에 환불 둘은 `refunds_request_uq`).
- 다이어그램: `erd_editor_sync.py --write`로 `refunds.counted_arrived_amount`와 설명, 바뀐 설명 넷, UNIQUE 인덱스 `refunds_request_uq`(두 컬럼), 메모의 CHECK 수를 고침(`--compare`로 다시 볼 편집 0개).
- 검사: 8절. 15개 모두 통과.

2026-11-15 같은 재검토의 중간 묶음 M8(RC-15)도 같은 결정 카드의 '모두 지금 고침 (추천)'대로 검토자의 고치는 방향을 따라 고쳤습니다(이 묶음에는 Claude 추천이 없음). 이 단계를 마친 뒤 요구사항 버전 3에서 바뀐 SPEC-010(예약 링크의 조건에 결제 수단, REQ-164)을 따라가지 않았고, 5절 E11('30일 지난 도구 호출 기록을 지움')과 6절(닫힌 상담과 함께만 지움)이 서로 달랐습니다.

| 무엇 | 테이블.컬럼·제약 | 근거 |
| --- | --- | --- |
| 예약 링크 조건의 결제 수단 | 4절 A10에 지금 쓰는 결제 수단(`payment_accounts`에서 `retired_at`이 빈 행, 가게마다 하나는 `payment_accounts_one_current`)을 더하고, 대응에 SPEC-010 → `payment_accounts.retired_at`을 더함(TBL-015 헤더에 SPEC-010) | SPEC-010, REQ-164 |
| 30일 지난 AI 도구 호출 기록 | 6절에 8번째 차례를 더함: 상담이 열려 있거나 다룬 주문이 끝나지 않은 상담의 것도 `ai_tool_calls.called_at`이 30일 지난 행을 지움. 찾는 인덱스 `ai_tool_calls_called_idx`를 더하고 5절 E11이 6절 8을 가리킴 | AI-1, SPEC-065, E11 |
| SPEC-065 대응과 6절 | 6절 2가 지우는 '주문이 되지 않은 초안의 견적'에 SPEC-065 → `quotes.draft_id`(TBL-022 헤더에 SPEC-065), 6절 8에 SPEC-065 → `ai_tool_calls.called_at`을 더함 | SPEC-065 |
| 읽은 것의 버전과 수 | `schema.sql` 머리말(4~5줄)과 2절의 기능 명세·요구사항 버전을 SPEC-001~079, 요구사항 버전 5(REQ-001~254, 유효한 227)로, 이 문서 상태 줄의 마이그레이션 목록(0014~0017)과 1절의 인덱스·대응·마이그레이션·규칙 테스트 수를 지금 값으로 | RC-15 |

- 마이그레이션 0017: 인덱스 하나(`ai_tool_calls_called_idx`)를 더함. 빈 데이터베이스에 0001~0017을 적용한 카탈로그가 `schema.sql`과 같음(D2).
- 대응(`erd_map.py`): SPEC-010에 결제 수단, SPEC-065에 주문이 되지 않은 초안의 견적과 30일 지난 AI 도구 호출 기록을 더함(데이터 1084건 → 1087건, 대응 컬럼 500개 → 502개).
- 규칙 테스트 309개 → 311개: 지우기(`purge_run`)에 6절 8을 더하고, 열린 손님 1의 새 상담에 둔 도구 호출 기록 둘 가운데 31일 뒤 지우기는 31일 전 것만 지우고 AI 호출 기록과 상담은 남기며, 다음 날 지우기는 30일이 된 남은 것을 지움(`expect_left` 둘). 있던 테스트는 그대로 지나감.
- 다이어그램: `erd_editor_sync.py --write`로 인덱스 하나(`ai_tool_calls_called_idx`)를 더함. 마지막 쓰기 없는 실행은 편집 0개, `erd_editor_build.py --compare` 차이 0줄입니다.
- 앞뒤 단계: 04 SPEC-065에 같은 차례와 수락 기준 하나를, 06 서버 작업 목록(SPEC-065)에 '여덟 차례'를 맞춤(04 spec.md 8절, 06 README 15절).
- 검사: 8절. 15개 모두 통과.

2026-11-15 같은 재검토의 낮음 K1(RA-21, RB-21)도 같은 결정 카드의 '높음·중간 뒤에 따로 고침 (추천)'대로 검토자의 고치는 방향을 따라 고쳤습니다(낮음에는 Claude 추천이 없음). 01단계 domain.md 7-5절에 이 단계와 04단계가 이미 쓰던 상태·값 이름 열둘이 용어 TERM-075~086으로 더해져, 나머지 용어는 컬럼이나 테이블 설명에 TERM 번호가 있어야 하는 S7이 어긋났습니다. 테이블·컬럼·제약은 그대로 두고 설명에 번호만 더했습니다.

| 용어 | 테이블.컬럼 | 근거 |
| --- | --- | --- |
| TERM-075 문의 끊김 | `consultations.status`의 'dropped' | 04 1-1 |
| TERM-076 변경 마감 | `operating_rules.change_deadline_hours` | SPEC-041 |
| TERM-077 채널 친구 | `customers.channel_friend` | REQ-219, REQ-120 |
| TERM-078 결제 안내 | `payment_requests`(TBL-031)의 테이블 설명 | 04 1-3 |
| TERM-079 차액 결제, TERM-086 다시 낸 결제 | `payment_requests.kind`의 'difference'·'reissue' | R13, TERM-037 |
| TERM-080 답하는 시간 | `business_calendars.reply_start` | REQ-118(02단계 버전 5에서 REQ-259로 바꿈) |
| TERM-081 주문번호 | `orders.order_no` | G6, 04 SPEC-029 |
| TERM-082 입금 알리기 | `confirm_cards.kind`의 'payment_claim' | SPEC-069 |
| TERM-083 확인 요청됨, TERM-084 맞추는 중 | `payment_requests.status`의 'claimed'·'mismatch' | 04 1-3 |
| TERM-085 대조 완료 | `payments.resolution`의 'shortfall_paid'·'excess_returned' | R15, SPEC-047 |

- 마이그레이션 0018: 테이블 설명 하나와 컬럼 설명 아홉(COMMENT ON)만 바꿈. 빈 데이터베이스에 0001~0018을 적용한 카탈로그가 `schema.sql`과 같음(D2).
- `schema.sql` 머리말과 2절의 용어집 범위를 TERM-001~086으로, 1절의 용어 수와 마이그레이션 범위, 이 문서 상태 줄의 마이그레이션 목록을 지금 값으로 고침. 3-3절 다이어그램의 줄인 설명 둘은 `build_erd.py --write`가 다시 만듦. 요구사항 범위(REQ-001~254)는 그대로: K1이 02단계에 더한 REQ-255~262(04단계 SPEC-069·017·018·005·016·007·024·001·067의 동작)는 이 단계에서 다시 대조하지 않았음.
- 다이어그램: `erd_editor_sync.py --write`로 바뀐 설명(테이블 하나, 컬럼 아홉)을 고침. 마지막 쓰기 없는 실행은 편집 0개, `erd_editor_build.py --compare` 차이 0줄입니다.
- 검사: 8절. 15개 모두 통과.

2026-11-15 같은 재검토의 낮음 K2(RC-20, RC-21)와 K1이 넘긴 셋(RC-19의 05 CHECK, RB-24의 주문번호, 요구사항 범위)도 같은 결정 카드의 '높음·중간 뒤에 따로 고침 (추천)'대로 검토자의 고치는 방향을 따라 고쳤습니다(낮음에는 Claude 추천이 없음). 먼저 그때 main(0709e8e)으로 이미 고쳤는지 봤습니다: RC-21의 `request_keys` 보관 기간은 설계 재검토 M7(PR #37)이 6절 7에 이미 적었고(24시간), 나머지는 그대로였습니다.

| 바꾼 것 | 테이블.컬럼·제약 | 근거 |
| --- | --- | --- |
| 상담 고지 때의 처리방침 버전 | `consultations.ai_disclosed_policy_version`(빈 값 가능), `consultations_disclosed_policy_fk`(→ `privacy_policies(shop_id, version)`), `consultations_disclosed_policy_chk`(고지 시각과 짝) | RC-20, SPEC-018, REQ-140, 4절 A39, 5절 E33 |
| 위탁 동의의 지난 기록 | 바꾸지 않음. 동의마다 이력 행은 다음 마이그레이션 후보(5절 E33) | RC-20 |
| 재제작이 아닌 주문은 1원부터 | `orders_amount_paid_chk` | RC-19(K1이 04단계 SPEC-013·029·004에서 막은 0원 주문 요청을 데이터베이스도 막음) |
| 주문번호 6~8자 | `orders.order_no`의 CHECK를 `^[0-9A-Z]{6,12}$`에서 `^[0-9A-Z]{6,8}$`로 | RB-24(K1의 SPEC-029) |
| 계속 쌓이는 기록과 지우기 인덱스 | 바꾸지 않음. 6절 '남는 것'에 `ops_events`(지우지 않음과 이유), 11단계에서 지우기 SQL과 함께 더할 인덱스 다섯 | RC-21 |
| 요구사항 번호 | `owners.kakao_account_id`(REQ-183→260), `rule_clauses.clause_key`(REQ-033→258), `business_calendars.reply_start`·`owner_tasks.wait_due_at`(REQ-118→259)의 설명 | K1이 02단계에서 '제외'로 두고 같은 문장을 필수로 옮긴 번호 |

- 마이그레이션 0019: 컬럼 하나·외래 키 하나·CHECK 둘을 더하고 주문번호 CHECK를 다시 만들고 컬럼 설명 여섯(COMMENT ON)을 고침. 고지한 상담이 있으면 고지 시각에 게시된 가장 큰 버전을 채운 뒤 제약을 더함(개발 전이라 옮길 행은 없음). 빈 데이터베이스에 0001~0019를 적용한 카탈로그가 `schema.sql`과 같음(D2).
- REQ-255~262 대조: REQ-255(손님 명령은 확인 카드의 버튼으로만)는 `confirm_cards`, REQ-256(스킬 키)은 `kakao_channels.skill_key_version`(4절 A36), REQ-257(새 상담마다 고지)은 `consultations.ai_disclosed_at`과 이번 버전, REQ-258~260은 옛 번호와 같은 문장이라 같은 컬럼, REQ-261(자리가 있는 날을 바꾸기 전 확인)은 저장 전에 그날의 `slot_holds`를 읽는 앱의 확인, REQ-262(상담 하나의 AI 비용 상한, 권장)는 `ai_calls.cost_krw`를 상담(`ai_calls.consultation_id`)마다 더해 셈. 더할 테이블·컬럼은 없었습니다.
- `schema.sql` 머리말과 2절의 요구사항 범위를 REQ-001~262(유효한 231)로, 1절의 수와 마이그레이션 범위, 이 문서 상태 줄, 9절의 견준 결과를 지금 값으로 고침. 3-3절의 상담 다이어그램과 컨텍스트 사이 화살표 수(CTX-001 → CTX-007 외래 키 1 → 2)는 `build_erd.py --write`가 다시 만듦.
- 다이어그램: `erd_editor_sync.py --write`로 컬럼 하나(이름·타입·설명·자리)와 설명 다섯, 관계 하나, 메모를 고침. 마지막 쓰기 없는 실행은 편집 0개, `erd_editor_build.py --compare` 차이 0줄(9절).
- 규칙 테스트 311개 → 315개: 막아야 할 쓰기 넷(고지 시각만 있고 버전이 없음 → `consultations_disclosed_policy_chk`, 그 가게에 없는 버전 → `consultations_disclosed_policy_fk`, 재제작이 아닌 주문의 0원 → `orders_amount_paid_chk`, 9자 주문번호 → `orders_order_no_check`). 고지 시각을 쓰는 상담 넷(정상 플로우 둘, 끊긴 상담, 새 상담)에 버전 1을 함께 씀. 새 CHECK의 이름(`consultations_disclosed_policy_chk`는 `consultations_deleted_chk`와 `consultations_dropped_chk` 사이, `orders_amount_paid_chk`는 `orders_amount_check` 뒤)이 앞서는 기존 테스트가 다른 제약에 막히지 않음을 D4로 봄.
- [PR #46 Codex 의견](https://github.com/kodonghui/siljang.ai/pull/46#discussion_r4575443540)을 같은 PR에서 고침: 처음 A39에 '고지 글의 링크도 그 버전'이라 적었으나 06단계 API-039는 늘 가장 최근 버전만 주어 어긋났습니다. 검토자의 고치는 방향(고지 때의 버전을 남김)에는 버전을 고르는 주소가 필요하지 않아 새 주소를 두지 않고, A39·E33과 컬럼 설명(마이그레이션 0019의 COMMENT ON 포함)을 '고지 때 게시된 가장 최근 버전을 남기고 링크는 늘 가장 최근 버전'으로 고쳤습니다. 06단계 API-039 설명과 04단계 SPEC-018에도 같은 뜻을 적었고, 테이블·컬럼·제약은 그대로입니다.
- 검사: 8절. 15개 모두 통과.

2026-11-15 동희님 결정 반영: 설계 재검토 뒤 남은 결정 셋을 동희님이 2026-11-15 14:19 Claude Code 채팅의 결정 카드에서 정하셨습니다(02단계 11절). 결제 전 주문으로 여러 날 자리를 붙잡는 한도(RB-25)는 '가게가 한도를 정함'이라 가게 설정과 에스컬레이션 건의 컬럼을 더했습니다. AI 모델 회사(06단계 OPEN-7)는 '둘 다 시험해 평가로 고름 (추천)'으로 정해졌고 앱의 모델 호출 구조(REQ-266)라 테이블은 바꾸지 않았습니다(모델 이름과 버전은 지금처럼 호출마다 `ai_calls.model`). 신고의 본인 확인(RB-15)은 '지금대로 둠 (추천)'이라 0015의 컬럼·제약을 그대로 두고 5절 E32와 위 M12 기록에 확정을 적었습니다.

| 바꾼 것 | 테이블.컬럼·제약 | 근거 |
| --- | --- | --- |
| 한 손님의 결제 기다림 주문 한도 | `shops.awaiting_payment_limit`(smallint, NOT NULL, 기본 2, CHECK 0~10, 0이면 한도 없음) | REQ-263, REQ-265, SPEC-029, SPEC-077, 4절 A40, 5절 E34 |
| 한도 건 | `handoffs.reason`에 'order_limit'. 열린 건 하나 인덱스 `handoffs_one_open_per_consultation`에서 빼고 `handoffs_one_open_limit_per_consultation`(상담마다 열린 한도 건 하나)을 더함. 덧붙은 질문의 사유(`handoff_questions_reason_check`)에는 넣지 않음 | REQ-263, SPEC-022 |
| 한도를 넘겨 받기 | `handoffs.limit_decision`(넘겨 받기·받지 않음), `limit_accept_expires_at`(24시간), `limit_used_order_id`(쓴 주문 요청, `handoffs_limit_used_uq`·`handoffs_limit_used_fk`). CHECK `handoffs_limit_chk`(한도 건에만)·`handoffs_limit_used_chk`(넘겨 받은 건만 씀)·`handoffs_limit_accept_chk`(넘겨 받기와 기한은 짝), `handoffs_answer_chk`에 한도 결정을 더함 | REQ-264, SPEC-023, SPEC-029 |
| 모델 호출 한 곳 | 바꾸지 않음 | REQ-266, 04단계 AI-1 |

- 마이그레이션 0020: 컬럼 넷·외래 키 하나·UNIQUE 하나·CHECK 다섯(새 컬럼의 CHECK 둘 포함)을 더하고 사유 CHECK와 `handoffs_answer_chk`, 열린 건 하나 인덱스를 다시 만들고 한도 건 인덱스를 더하고 컬럼 설명 다섯(COMMENT ON)을 씀. 머리말에 RB-15 확정을 적음. 빈 데이터베이스에 0001~0020을 적용한 카탈로그가 `schema.sql`과 같음(D2).
- `schema.sql` 머리말과 2절의 요구사항 범위를 REQ-001~266(유효한 235)으로, 1절의 수와 마이그레이션 범위, 이 문서 상태 줄, 9절의 견준 결과를 지금 값으로 고침. 3-2절 표와 3-3절의 상담·가게 등록 다이어그램은 `build_erd.py --write`가 다시 만듦.
- 다이어그램: `erd_editor_sync.py --write`로 컬럼 넷(이름·타입·설명·자리), 설명 하나, 관계 하나, after 스크립트(한도 건 인덱스)와 메모를 고침. 마지막 쓰기 없는 실행은 편집 0개, `erd_editor_build.py --compare` 차이 0줄(9절).
- 규칙 테스트 315개 → 324개: 막아야 할 쓰기 일곱(한도 11건 → `shops_awaiting_payment_limit_check`, 한 상담의 열린 한도 건 둘 → `handoffs_one_open_limit_per_consultation`, 한도 건이 아닌 건에 한도 결정 → `handoffs_limit_chk`, 기한 없이 넘겨 받음 → `handoffs_limit_accept_chk`, 받지 않은 건을 쓴 주문 요청 → `handoffs_limit_used_chk`, 주문 요청 하나가 넘겨 받기 둘을 씀 → `handoffs_limit_used_uq`, 한도 건을 덧붙은 질문으로 → `handoff_questions_reason_check`)과 받아야 할 쓰기 둘(열린 건이 있어도 한도 건은 따로 열림, 넘겨 받은 건과 그것을 쓴 주문 요청). 지우기(6절)의 다룬 주문에 한도 넘겨 받기를 쓴 주문을 더함(그 상담의 주문이라 결과는 같음).
- 검사: 8절. 15개 모두 통과.

2026-11-18 TASK-021 운영자 로그인: 동희님이 2026-11-16 17:01 무렵 Claude Code 채팅에서 '추천 모두 승인'으로 운영자 인증을 Supabase Auth(이메일·비밀번호와 TOTP 2단계 인증)로 정하셨고(10단계 TASK-003), 06단계 DEC-27이 OPEN-6을 닫았습니다. 비밀번호와 2단계 인증 키는 Supabase Auth에 두고(REQ-135), 우리 데이터베이스에는 운영자 세션과 로그인 실패 세기만 더했습니다. 앞 단계 문서와 있던 테이블·컬럼은 바꾸지 않았습니다.

| 바꾼 것 | 테이블.컬럼·제약 | 근거 |
| --- | --- | --- |
| 운영자 세션 | 새 테이블 `operator_sessions`(TBL-059): 운영자, 쿠키 값의 SHA-256(`operator_sessions_token_uq`, 소문자 16진수 64자 CHECK), 로그인한 시각, 끝나는 시각(`operator_sessions_fixed_chk`: 로그인한 때부터 12시간), 로그아웃 시각(`operator_sessions_ended_chk`). 인덱스 둘(운영자, 끝나는 시각) | SPEC-001, 06 API-004~006, DEC-26, DEC-27 |
| 운영자 로그인 실패 | 새 테이블 `operator_login_failures`(TBL-060): 이메일(앞뒤 공백을 빼고 소문자)의 HMAC-SHA256(소문자 16진수 64자 CHECK), 시도를 시작한 시각. 인덱스 둘(이메일과 시각, 시각) | SPEC-001, 06 API-004 429, DEC-16 |

- 마이그레이션 0021: 테이블 둘·외래 키 하나·UNIQUE 하나·CHECK 넷·인덱스 넷과 테이블·컬럼 설명을 더함. 있는 행은 바뀌지 않음. 빈 데이터베이스에 0001~0021을 적용한 카탈로그가 `schema.sql`과 같음(D2).
- 두 테이블은 지우기(6절)의 차례에 넣지 않고 앱이 로그인 때 지움(6절 끝). 1절의 수와 마이그레이션 범위, 이 문서 상태 줄, 9절의 견준 결과를 지금 값으로 고침. 3절 표와 다이어그램은 `build_erd.py --write`가 다시 만듦.
- 다이어그램: `erd_editor_sync.py --write`로 테이블 둘(컬럼·설명·CTX-007 그룹·자리), 관계 하나, 인덱스 넷과 메모를 더함. `erd_editor_build.py --compare` 차이 0줄(9절).
- 규칙 테스트 324개 → 330개: 받아야 할 쓰기 하나(로그인한 때부터 12시간인 세션)와 막아야 할 쓰기 다섯(12시간 넘게 늘림 → `operator_sessions_fixed_chk`, 쿠키 값을 그대로 둠 → `operator_sessions_token_hash_check`, 쿠키 하나에 세션 둘 → `operator_sessions_token_uq`, 로그인 전에 끝냄 → `operator_sessions_ended_chk`, 이메일 글을 그대로 둠 → `operator_login_failures_email_hash_check`).
- 검사: 8절. 15개 모두 통과.

2026-11-19 TASK-021 독립 보안 검토 후속: PR #72(TASK-021)는 Codex 자동 검토가 돌지 않아 조정 세션이 따로 보안 검토를 돌렸고, 그 결과 가운데 데이터베이스가 지켜야 할 둘을 고쳤습니다. 하나는 계정 막기와 2단계 인증 다시 등록이 운영자 세션을 끝내지 않은 것입니다(요청 때 조건으로만 보아, 막았다가 12시간 안에 풀면 막기 전에 새어 나간 쿠키가 다시 살아남). 06단계 DEC-27은 운영자 세션을 '로그아웃(API-006)·계정 막기로 끝냄'으로 적었고, 이 문서의 TBL-059 설명은 로그아웃만 적었습니다. 다른 하나는 로그인이 'Supabase에 지금 확인된 TOTP가 하나 있는지'만 보아, 대시보드에서 인증 수단을 지운 사이에 비밀번호를 아는 사람이 Supabase에 직접 자기 TOTP를 등록하면 로그인이 된 것입니다. 06 계약은 바뀌지 않습니다(운영자 표는 응답에 나가지 않음).

| 바꾼 것 | 테이블.컬럼·제약 | 근거 |
| --- | --- | --- |
| Supabase 사용자 | `operators.auth_user_id`(uuid, `operators_auth_user_uq`: Supabase 사용자 하나에 운영자 하나). 등록 도구가 쓰고, 비밀번호 로그인이 돌려준 사용자와 같아야 로그인됨 | SPEC-001, 06 DEC-27, 보안 검토 2 |
| 2단계 인증 수단 | `operators.mfa_factor_id`(uuid, 등록 도구가 확인한 Supabase TOTP 인증 수단 ID). 로그인은 이 인증 수단으로만 challenge·verify. CHECK `operators_mfa_chk`: 2단계 인증을 켠 시각과 인증 수단 ID는 둘 다 있거나 둘 다 없고, 인증 수단이 있으면 사용자 ID도 있음. 인증 수단 ID 형식은 UUID(Supabase Auth OpenAPI의 factor `id`와 MFA 문서의 예, 2026-11-18 확인) | SPEC-001, 06 DEC-27, 보안 검토 2 |
| 막기·다시 등록이 세션을 끝냄 | 함수 `operators_end_sessions()`와 트리거 `operators_end_sessions`(operators의 `disabled_at`·`mfa_enrolled_at`·`mfa_factor_id`·`auth_user_id`가 바뀌면 그 운영자의 끝나지 않은 세션의 `ended_at`을 같은 트랜잭션에서 지금과 로그인한 시각 가운데 늦은 쪽으로). 같은 값을 다시 쓰면 끝내지 않음. `operator_sessions.ended_at`·`operators.disabled_at`·`mfa_enrolled_at` 설명을 고침 | 06 DEC-27, 보안 검토 1 |

- 왜 데이터베이스인가: 앱 코드만으로 끝내면 대시보드나 SQL로 막을 때를 놓칩니다(운영자 막기 도구는 맡은 작업이 없어 지금은 데이터베이스에서 `disabled_at`을 씀, app/README 89). 막기를 푸는 쪽도 끝내게 한 것은, 0021까지 막는 동안 남은 세션이 있어도 풀 때 함께 끝내려는 것입니다(막힌 동안에는 새 세션이 생기지 않으므로 다른 영향이 없음).
- 마이그레이션 0022: 컬럼 둘·UNIQUE 하나·CHECK 하나·함수 하나·트리거 하나와 컬럼 설명 다섯을 더함. 있는 운영자 행에는 인증 수단 ID가 없으므로 2단계 인증을 켠 시각을 비우고(등록 도구를 다시 돌려 연결함) 끝나지 않은 운영자 세션을 모두 끝냄. 운영 데이터베이스는 아직 없음(TASK-016 전). 빈 데이터베이스에 0001~0022를 적용한 카탈로그가 `schema.sql`과 같음(D2: 함수 10, 트리거 15).
- 1절의 수(컬럼 738, CHECK 424, UNIQUE 92, 트리거 문장), 마이그레이션 범위, 이 문서 상태 줄, 8절, 9절의 견준 결과를 지금 값으로 고침. `erd_map.py`의 SPEC-001에 두 컬럼을 더하고 `build_erd.py --write`로 컬럼 설명을 다시 만듦.
- 다이어그램: `erd_editor_sync.py --write`로 컬럼 둘(이름·타입·설명·`auth_user_id` UNIQUE 표시), 설명 셋과 메모의 트리거 문장(`TRIGGER_TEXT`에 `operators_end_sessions`를 더함)을 고침. 마지막 쓰기 없는 실행은 편집 0개, `erd_editor_build.py --compare` 차이 0줄(9절).
- 규칙 테스트 330개 → 338개: 막아야 할 쓰기 셋(인증 수단 없이 켠 시각 → `operators_mfa_chk`, 사용자 없이 인증 수단 → `operators_mfa_chk`, Supabase 사용자 하나에 운영자 둘 → `operators_auth_user_uq`)과 남은 값 다섯(이름만 바꾸거나 같은 인증 수단을 다시 쓰면 세션 그대로, 막았다 풀면 그 운영자의 열린 세션 0, 다른 운영자의 세션은 그대로, 다시 등록하면 열린 세션 0, 끝낸 시각은 로그인한 시각보다 앞서지 않음). 기존 운영자 행(정상 플로우)에 사용자·인증 수단 ID를 더함. 트리거를 뺀 사본에서는 남은 값 셋이 기대와 달라 실패함을 봤습니다(335개 막힘, 3개 안 막힘).
- 검사: 8절. 15개 모두 통과.
