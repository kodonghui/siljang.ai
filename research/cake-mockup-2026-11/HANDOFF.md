# Siljang 작업 인계 (2026-11-13 10:45 KST, 이 계정의 Claude가 작성)

동희님(GitHub `kodonghui`)의 Siljang 프로젝트를 다른 Claude 계정에서 이어받습니다. 11/12 23:38에 이 계정이 이전 계정의 인계(01~07단계)를 받아 08단계를 마쳤고, 09단계(목업)를 시작한 뒤 11/13 10:11 KST에 동희님 말씀으로 멈췄습니다: "혹시 잠시만 대기 // 클로드 계정 다른데서 작업하고싶은데 , 우리가 작업해야하는거 전부 프롬프트로 상세히 작성해서 줘볼래? 맥락 충분히 반영해서 // 여기 메모리도 다 줘봐". 아래는 이 계정에서 한 일, 확정된 결정, 남은 일입니다. 이 글은 2026-11-13 10:45 KST 기준이므로 0절대로 지금 상태부터 확인하고 시작하세요.

## 0. 시작 전에 확인할 것 (작업이 겹치지 않게)

1. 이 계정의 작업 대화는 이 인계로 멈췄습니다. 이 계정의 Claude는 이 뒤로 저장소·Notion·Miro를 고치지 않습니다.
2. 기준 상태는 `kodonghui/siljang.ai` main `cdff7bc`, 열린 PR은 이 인계를 올린 초안 PR 하나(브랜치 `claude/project-thread-qli6pn`, 제목 "chore(handoff): 09단계 진행분과 다른 계정 인계 문서")입니다. 시작하기 전에 `git log origin/main`, 열린 PR, `.corthex/stages.json`, Notion 프로젝트 첫 화면의 '지금과 다음' 맨 위(현재 11/13 10:45 인계)와 '작업로그' 맨 아래(마지막 항목 '11/13 · 09단계 멈춤과 다른 계정으로 인계')를 읽어 그 뒤에 바뀐 것이 있는지 확인하세요. 바뀐 것이 있으면 그쪽이 최신입니다.
3. 09단계 도구와 캔버스 파일은 그 초안 PR의 `research/cake-mockup-2026-11/`와 `design/candidates/`에만 있습니다(main에는 아직 없음). 이전 세션의 임시 폴더는 남아 있지 않습니다. 먼저 이 PR을 main에 합치고(squash, 동희님 상시 허용) 최신 main에서 새 브랜치를 만드는 것을 추천합니다. 합치기 전에 PR의 파일이 이 문서와 같은지 봅니다.
4. 이 계정에서 게시한 Artifact 페이지 4개(06 Swagger UI, 07 사이트맵, 08 와이어프레임, 09 목업 캔버스)는 새 계정에서 고칠 수 없고, 비공개라 새 계정으로는 열리지 않을 수 있습니다. 새로 게시하고 링크를 바꾸세요(6절).
5. 새 계정에 GitHub(`kodonghui/siljang.ai` 읽기·쓰기)·Notion(CORTHEX HQ)·Miro 연결이 있는지 먼저 보고, 없으면 동희님께 연결을 요청하세요.
6. 작업은 CORTHEX 플러그인(`/corthex:corthex`와 단계 스킬)으로 합니다. 09단계는 `corthex-screen`의 `references/09-mockup.md`(계약)와 `references/design-tools.md`, 화면 만드는 법과 검사는 `corthex-uxui`입니다. 동희님 말씀: "노파심에 말하는건데 /corthex:corthex 플러그인으로 작업해라잉".
7. 이 계정의 프로젝트 메모리 가운데 설계·개발에 쓰는 12개를 부록 A에 옮겼습니다(모델 이름만 바꾸고 나머지는 글자 그대로). 새 계정의 프로젝트 메모리에 주제별 파일로 저장하세요. 전체(개인 일정·지원사업·피벗 전 카톡 봇 상품 포함)는 동희님이 따로 주시는 `memory-all.md`에 있고, 목록은 부록 B입니다.

## 1. 프로젝트

- 제품: 1인 고관여 서비스업을 위한 노코드 AI 예약·상담 플랫폼이고, 첫 업종은 수제케이크(주문제작)집입니다(11/11 동희님 결정). 첫 버전은 사장님 대신 AI가 가게의 카카오톡 채널(오픈빌더)에서 상담·견적·결제 안내를 하고, 손님은 예약 링크 페이지에서 주문 요청과 규정 동의를 합니다. 사장님은 맞춤 주문 수락·결제 확인·환불·보상 같은 결정만 합니다. 금액과 가능 여부는 코드가 가게 규칙으로 계산하고 AI는 설명만 합니다. 결제는 가게 명의 계좌 안내와 사장님 결제 확인이고 PG 연동은 하지 않습니다. 인스타그램 DM과 웹 채팅은 첫 버전에서 뺐습니다. 한국 유료 PoC 3곳(2026-12~2027-02), 유료 30곳(2027-08) 뒤 일본·미국으로 갑니다. AI 부분은 LangChain·LangGraph입니다(11/11 결정). 범위는 `docs/02-prd/requirements.md` 1절에 있습니다.
- 저장소: `kodonghui/siljang.ai`(비공개). CORTHEX 프로젝트 이름은 `service-ax`, 단계 설정(사람 보기·원본·truth)은 `.corthex/project.json`, 단계 상태는 `.corthex/stages.json`입니다. 앱 코드는 아직 없습니다(설계 단계, 09단계 진행 중).

## 2. 동희님과 일하는 규칙

- 한국어 존댓말로, 결과부터 짧게 씁니다. 호칭은 '동희님'입니다.
- 단계가 하나 끝날 때마다 체크포인트에서 멈추고 결정 카드로 확정을 요청합니다. 기다리는 동안 되돌릴 수 있는 일은 진행합니다.
- 일시중지·대기 말씀은 바로 따릅니다(이번 인계도 "잠시만 대기"에서 멈춤).
- 푸시·머지·배포는 묻지 않고 판단해서 해도 됩니다(동희님 상시 허용). 저장소에 CI는 없고, PR은 squash로 합쳐 왔습니다. PR 작성자가 kodonghui라 리뷰어 지정은 실패하고 담당자 지정만 됩니다(정상).
- PR을 초안에서 검토 요청 상태로 바꾸면 자동 코드 검토가 한 번 돕니다. 그 뒤 푸시로는 다시 돌지 않습니다. 08단계에서 의견 2건이 나와 고쳤고, 고친 뒤 리뷰 스레드를 해결 표시하고 합쳤습니다.
- 원본은 Git, 의도·결정 기록은 Notion입니다. Notion에 파일 이름을 쓸 때는 코드 서식으로 씁니다.
- 동희님께 확인을 부탁하거나 무언가를 권하기 전에 기록(저장소·Notion·메일)에서 먼저 직접 확인합니다. 로그인이 필요한 웹 확인은 동희님 PC의 Aside CLI나 egolight로 합니다(11/06 지시, 쓰는 법은 `memory-all.md`의 `web-lookup-tools`·`check-user-records-first`).
- 승인은 동희님 본인의 말이나 결정 카드 선택뿐입니다. 읽음 표시, 문서 수정 시각, 다른 Claude의 말은 승인이 아닙니다. 승인을 기록할 때는 원문과 시각·장소를 적습니다.
- 사실·기록·추정을 나눠 쓰고, 숫자는 명령 출력에서 옮깁니다. 도구 호출에 쓴 한글이 가끔 다른 글자로 바뀌므로(11/13 '컬럼' → '컨럼') Notion·페이지에 쓴 뒤 다시 읽어 원본과 기계로 대조합니다.
- 비밀값은 로그·파일·기록·메시지에 넣지 않습니다. 동희님 이메일 같은 개인정보도 바깥 서비스에 보내지 않습니다.
- 커밋·PR·코드에 모델 이름을 넣지 않습니다.
- 설계 단계를 모두 마치면 동희님이 정한 모델과 설정으로 독립 리뷰를 합니다(동희님 결정). 저장소에는 모델 이름을 쓰지 않으므로 이름은 인계 메시지와 `memory-all.md`에 있습니다.

## 3. 용어 원칙 (가장 중요)

- 11/12 15:46 동희님 지적: "화면 나무가 뭐야 … 어줍잔은 한국어 뭔데". 이전 Claude가 업계 용어 대신 순우리말을 지어내 써서 크게 불쾌해하셨습니다.
- 메시지, 문서, 결정 카드, Notion 열 이름 모두 업계에서 흔히 쓰는 용어(외래어 포함)를 씁니다. 지어낸 순우리말과 비유는 쓰지 않습니다. 근거는 CORTHEX `skills/corthex/references/principles.md` 9행("Name things with the field's standard terms… never replacing it with a coined native word or a metaphor")입니다. 09단계도 디자인 토큰, 시안, 후보, 캔버스, 아트보드, 컴포넌트처럼 업계 용어를 씁니다.
- 예전 말 → 쓰는 말: 화면 나무 → 화면 트리, 뿌리 → 루트, 흐름 → 플로우, 갈림길 → 분기 노드, 정한 것 → 결정 사항, 굳힘·굳힐까요 → 확정·확정할까요, 확인 지점 → 체크포인트, 까닭 → 사유·이유, 피할 말 → 금지어, 못 봄 → 미확인, 여쭙니다 → 확인을 요청합니다, 판(번호) → 버전, 자리 잡기 → 가예약, 넘긴 질문 → 에스컬레이션 건, 넘기기(AI가 사장님께) → 에스컬레이션, 케이크 넘기기 → 인도, 결제 받을 곳 → 결제 수단, 다시 만들기 → 재제작, 늦어짐 안내 → 지연 안내, 더 기다리기 → 결제 기한 연장, 영업 달력 → 영업 캘린더, 장부 줄 → 장부 행, 한 거래 후보 → 트랜잭션 경계 후보, 사건 → 도메인 이벤트, 행위자 → 액터, 상태 기계 → 상태 머신, 가리기 → 마스킹.
- 전체 대조표 82개는 Notion 용어 정리 기록 행(5절)과 `docs/01-domain/domain.md` 3-7절에 있습니다(11/12 17:30 '추천대로 확정').
- 바꾸지 않는 것: ID(TERM·REQ·FL·SPEC·TBL·API·SCR·DEC·W 등), 코드 이름, DB 컬럼과 enum, API 경로와 enum, 마스킹 토큰 `[전화번호1]`·`[계좌번호1]`, 기록에 옮긴 동희님 말과 지난 결정 카드 문구 인용.
- 새 글을 쓴 뒤에는 예전 말을 grep으로 다시 찾아 빠진 곳이 없는지 확인하세요. 01 용어집의 '금지어' 열을 단계별 검사 스크립트가 잡습니다. 08 README에서 '확정 뒤'는 금지어 검사(C11)에 걸려 '체크포인트 뒤'로 썼습니다.

## 4. 단계 진행 (01~08 완료, 09 진행 중)

| 단계 | 확정(KST) | 원본 | 사람 보기 | Notion 기록 행 |
| --- | --- | --- | --- | --- |
| 01 도메인 | 11/11 17:11 | `docs/01-domain/domain.md` (CTX-001~009, TERM-001~074) | Miro 보드 | 첫 화면 작업로그 |
| 02 PRD | 11/11 22:24 버전 1, 뒤에 버전 2~4 | `docs/02-prd/requirements.md` (REQ-001~164, 유효 162: 필수 113·권장 47·선택 2, 제외 REQ-083·119) | Notion | `415bf16cc3ec81d28b8dd61931abbce1` |
| 03 유저 플로우 | 11/12 09:13 | `docs/03-user-flow/` (FL-001~014, 요구사항 해석 R1~R22) | Notion | `415bf16cc3ec8170b22bf7ce04dc315c` |
| 04 기능 명세 | 11/12 09:57 | `docs/04-functional-spec/spec.md` (SPEC-001~069, 상태 머신 8개) | Notion | `416bf16cc3ec81e2819bfa25353ae4d8` |
| 05 ERD | 11/12 11:56 | `db/schema.sql` (TBL-001~051, 컬럼 585), `db/migrations/0001_init.sql`, `db/schema.erd.json`, `docs/05-erd/README.md` (결정 사항 E1~E14) | ERD Editor | `416bf16cc3ec816ca5a0ff51e46a375d` |
| 06 API | 11/12 14:01 | `api/openapi.yaml` (API-001~072, 결정 사항 DEC-01~19, 열린 질문 OPEN-1~8, 오류 코드 32), `docs/06-api/README.md` | Swagger UI 페이지 | `416bf16cc3ec81bc8e55c85d0f194ccf` |
| 07 사이트맵 | 11/12 15:46 | `docs/07-sitemap/sitemap.yaml` (SCR-001~049, 루트 3개, 손님 13·사장님 32·운영자 4, 결정 사항 S1~S9) | 사이트맵 페이지 | `416bf16cc3ec813b936ad3bd948150c4` |
| 용어 정리 | 11/12 17:30 | `docs/01-domain/domain.md` 3-7절, `research/cake-terms-2026-11/` | Notion | `416bf16cc3ec8149a1cacc395e33055c` |
| 08 화면 상태 | 11/13 09:13 | `docs/08-screens/SCR-001.md`~`SCR-049.md` (상태 336개, 06단계 응답 740행 연결), `docs/08-screens/README.md` (결정 사항 W1~W9), `docs/08-screens/wireframes.html` (360·1280 프레임 672개). 원본 데이터는 `research/cake-screens-2026-11/screens_*.py` | 회색조 와이어프레임 페이지 | `416bf16cc3ec81f390afc8e14560e86c` |
| 09 목업 | 진행 중(체크포인트 전) | 후보 토큰 `design/candidates/a.tokens.json`·`b.tokens.json`, 캔버스 파일 `research/cake-mockup-2026-11/canvas/project/` (인계 초안 PR) | Claude Design 캔버스(동희님 확인 전, 9절) | 아직 없음 |

- 요구사항 버전: 버전 2는 03 확정으로 REQ-151~157 추가와 REQ-083·119 제외, 버전 3은 04 확정으로 REQ-158~163, 버전 4는 06 DEC-12로 REQ-164(결제 수단이 없으면 예약 링크를 내지 않음)입니다. 확정한 행은 동희님 결정으로만 고칩니다. 저장소 문서에 아직 없는 ID를 쓰면 검사와 허브가 오류로 보므로 "165번부터"처럼 씁니다.
- 08 체크포인트: 11/13 09:13 이 계정 작업 대화의 결정 카드에서 '추천대로 확정'을 고르셨습니다(질문 "화면 정의 49개와 결정 사항 W1~W9를 추천대로 확정할까요?", 03:10 확인 요청). 원문은 `docs/08-screens/README.md` 11절, `stages.json` 08, Notion 08 행에 있습니다.
- PR(모두 squash로 main에 합침): #1 01, #2 02, #3·#4 03과 넘겨받은 도구, #5 04, #6 05, #7 06, #8·#9 07, #10 용어 82개 적용(`4246cae`), #11~#13 뜻이 바뀐 곳 고침, #14 어색해진 문장 고침(`91f5209`), #15 용어·Notion 동기화 도구(`f9eaaaf`), #16 06·07 페이지를 이 계정에서 다시 게시한 링크와 API 설명 4곳(`61b677e`), #17 08단계(`cdff7bc`). 그다음이 이 인계 초안 PR입니다. 원격에 합친 PR의 브랜치들이 남아 있지만(프록시가 삭제를 막음) 모두 합친 것이라 무시해도 됩니다.

## 5. Notion

- CORTHEX HQ(`3d3bf16cc3ec80c09fb5c406e88a22db`) > 프로젝트 DB(`collection://48e84da4-280c-4461-b6c2-060d3fbe6f67`) > 첫 화면 `410bf16cc3ec81db8cb8ce38eb68b7e7` "1인 서비스업 AI 예약·상담 플랫폼 · 카톡 외주에서 피벗".
  - 본문 맨 위 `최근 업데이트` DB(`a6fbf16cc3ec83c2950701d62899f63e`, `collection://5d5bf16c-c3ec-8382-b60c-8769771fc1c2`, 속성: 문서·종류·최근 변경·달라진 점·읽었어요). `.corthex/project.json`의 `records.location`이 이 DB입니다. 새 문서는 이 DB의 행으로 만들고, 같은 작업은 기존 행을 이어 씁니다. 행을 고치면 '최근 변경'과 '달라진 점'을 갱신하고 '읽었어요'를 해제합니다.
  - 첫 화면 본문: 목표와 완료 기준 / 지금과 다음(최신이 위, '현재'와 '다음 행동' 한 쌍) / 논의와 결정 / 결과물과 근거 / 작업로그(최신이 아래, 하위 항목은 두 칸 들여쓰기로 '한 일과 이유', '결과·확인 범위', '다음 행동'). 속성 '다음 행동'과 '최근 갱신일'도 갱신합니다. fetch 결과가 약 65,000자라 파일로 저장되니 grep이나 나눠 읽기로 보세요.
- 단계 기록 행 안의 inline DB(원본에서 스크립트로 만들어 올림):

| 키 | 행 | 데이터 소스 | 제목 열 |
| --- | --- | --- | --- |
| REQ 요구사항 | 164 | `collection://2423480b-108c-4366-b2dc-f8dba389aeef` | REQ ID |
| HOT 핫스팟 답(02) | 27 | `collection://1d25fc54-a18d-4df3-a7e3-32c383f98479` | 핫스팟 |
| FLOW 플로우 | 14 | `collection://8adbbe2d-640f-49cd-a96c-3ddd880cb267` | 플로우 |
| CAND 새 요구사항 후보(03) | 7 | `collection://880604f6-0fe2-47eb-ab2a-1dc93135c164` | |
| READ 요구사항 해석(03) | 22 | `collection://0be2bc5d-4649-4768-bc02-1fe01aa62bae` | |
| SPEC 기능 명세 | 69 | `collection://0303376d-24b4-435c-b384-9cf3873c5715` | 번호 |
| E 결정 사항(05) | 14 | `collection://16df8283-90bb-4411-8916-e0322d01d974` | |
| TBL 테이블 | 51 | `collection://b27ee607-74ae-4df6-b5fa-cd47264ff7b1` | |
| API | 72 | `collection://371fbd11-27c4-4b12-94b5-42177da3755c` | API |
| ERR 오류 코드 | 32 | `collection://80b0c6dd-bde6-4b53-b219-702910782f2f` | |
| DEC 결정 사항(06) | 19 | `collection://e1cff7ea-d4d1-4a76-9bee-2066ac46d243` | 결정 사항 |
| S 결정 사항(07) | 9 | `collection://ccb2cf95-aee8-4015-834f-d84d24ef02e1` | 결정 사항 |
| SCR 화면(07) | 49 | `collection://96eadb29-9f83-4c16-adb3-296ae419994f` | 번호 |
| 용어 대조표 | 82 | `collection://1b1cbfdb-b079-43d8-b22f-663585b0de12` | 번호 |
| W 결정 사항(08) | 9 | `collection://ac8fa4b9-f29e-42dc-9a89-5d5adcf697d3` | |
| 화면 상태(08) | 49 | `collection://e1304737-1fcd-4a58-afb1-d6e6016c2f16` | |

- 그 밖: 🧭 전략·설계 지도 `410bf16cc3ec81e4babfdd130dec3afa`(항목 DB `collection://16ba69df-489c-4cb3-86bd-fba4c93c3c1b`, 68행, 21·68·9행이 동희님 결정 대기), 피벗 연구 보고서 `410bf16cc3ec8123a4a8cf1b88dfc61d`.
- 09 기록 행은 아직 없습니다. 08 행과 같은 형식으로 최근 업데이트 DB에 행을 만들고 후보 비교와 체크포인트 질문을 적습니다.
- 편집 규칙: `update_content`로 바뀐 부분만 고칩니다(가장 짧은 고유 old_str). 본문의 `~`는 `\~`로, 속성 값은 그냥 `~`로 씁니다. 파일 이름은 백틱으로 감쌉니다(가짜 링크 방지). 제목 열 이름을 "ID"로 두면 DB 만들기가 실패합니다. 기존 DB·문서 ID를 재사용하고 최상위 페이지를 새로 만들지 않습니다.
- 원본을 바꾼 뒤 02~07 DB를 맞출 때는 `research/cake-terms-2026-11/notion-sync/`의 `gen_all.py`(원본에서 Notion 값 생성)와 `diff2.py`(두 스냅숏 비교)를 쓰세요(폴더 README 참고).

## 6. Miro와 Artifact 페이지

- Miro 01단계 이벤트 스토밍 보드: https://miro.com/app/board/uXjVEPLnid4=/ . 원본은 `domain.md`이고 보드는 사람 보기입니다. 11/13 이 계정에서 용어 82개를 반영했습니다(스티커 234·텍스트 170·다이어그램 2·프레임 이름 5, 9 프레임 맨 아래 '용어 정리 반영' 박스와 'AI:' 댓글). 고칠 때는 `domain.md`를 먼저 고치고, 보드의 해당 항목을 고친 뒤 프레임 '9 컨텍스트 표' 맨 아래에 연한 초록 상자로 바뀐 점을 더하고 'AI:' 댓글로 알립니다.
- 이 계정에서 게시한 페이지(모두 비공개, 새 계정에서 고칠 수 없음):

| 단계 | 지금 주소 | 새로 게시하는 법 |
| --- | --- | --- |
| 06 Swagger UI | https://claude.ai/artifact/VNFQ5dXepMshMwtvUVdBbH | `npm pack swagger-ui-dist@5.17.14`로 받은 패키지를 풀고 `python3 -B research/cake-api-2026-11/build_viewer.py . OUT --css package/swagger-ui.css`를 실행한 뒤, OUT의 html을 페이지로, `openapi.json`을 함께 올리는 파일로 게시 |
| 07 사이트맵 | https://claude.ai/artifact/CeVbTfWtRHgL5undj5WNEd | 원본에서 생성한 `docs/07-sitemap/sitemap.html`(구조도·화면 목록·슬라이드)을 게시 |
| 08 와이어프레임 | https://claude.ai/artifact/YSLmrCtZj6FjYbzs1vsrLP | `build_screens.py`가 생성한 `docs/08-screens/wireframes.html`(약 1.2MB, 바깥 자원 없음)을 게시. 원본이 바뀌면 같은 파일 경로로 다시 게시해야 같은 주소 |
| 09 목업 캔버스 | https://claude.ai/artifact/EmtD9eSGq5N5nkxEdM4ro1 (Design 타입, 버전 4) | 9절 3-1 |

- 링크가 적힌 곳: `.corthex/project.json`(06·07·08의 `link`), `docs/06-api/README.md`(3행과 48행 부근), `docs/07-sitemap/README.md`(43행 부근), `docs/08-screens/README.md`(3행과 37행 부근), Notion 첫 화면과 06·07·08 기록 행. 저장소에서는 `grep -rn "VNFQ5dXepMshMwtvUVdBbH\|CeVbTfWtRHgL5undj5WNEd\|YSLmrCtZj6FjYbzs1vsrLP\|EmtD9eSGq5N5nkxEdM4ro1" .`로 찾습니다. 생성 스크립트(`*.py`)에는 주소가 없어(11/13 확인) README의 링크는 손으로 고칩니다. 새 링크로 바꾸고 PR로 합치세요.

## 7. 도구와 검사 (저장소 맨 위에서, 항상 `python3 -B`)

- 02: `research/cake-prd-2026-11/check_prd.py docs/02-prd/requirements.md docs/01-domain/domain.md`
- 03: `research/cake-flow-2026-11/check_flows.py docs/03-user-flow docs/02-prd/requirements.md docs/01-domain/domain.md` (필수 108/113은 정상: 플로우 밖 출시 조건 REQ-145와 REQ-158·160·161·164)
- 04: `research/cake-spec-2026-11/build_spec.py . --write` (원래 값은 `spec_rows.py`, 오류 0)
- 05: `research/cake-erd-2026-11/build_erd.py . --write --migration`, `check_erd.py . --db "<DSN>"` (14개). `erd_editor_build.py --build`는 돌리지 마세요(그림 배치가 지워짐). `db/schema.erd.json`은 텍스트로 직접 고칩니다.
- 06: `research/cake-api-2026-11/build_api.py . --write` (원래 값은 `api_catalog.py`·`api_schemas.py`·`api_examples.py`·`api_ops.py`), 검사 `check_api.py . --db "host=/var/run/postgresql ..." --mock http://127.0.0.1:4010` (17개, DSN은 URI가 아니라 키=값 형식). venv: `python -m venv .venv-api && .venv-api/bin/pip install -r research/cake-api-2026-11/requirements.txt`. 목 서버: `npx -y @stoplight/prism-cli@5.14.2 mock api/openapi.yaml -p 4010 -h 127.0.0.1`. Schemathesis 실패 128은 목 서버 한계입니다(README 13절).
- 07: `research/cake-sitemap-2026-11/build_sitemap.py . --write`, `check_sitemap.py . [--hub <corthex-hub의 scripts/sitemap.py>]` (17개)
- 08: `research/cake-screens-2026-11/build_screens.py .`(불일치만 확인) / `--write`(다시 생성), `check_screens.py . [--hub <corthex 저장소>/plugins/corthex-nexus/skills/corthex-hub/scripts/hub.py]` (15개, PyYAML 필요). 생성 파일(`SCR-0xx.md` 49개, README 마커 사이의 표, `wireframes.html`)은 손으로 고치지 않고 `screens_*.py`를 고친 뒤 다시 생성합니다.
- 09: `research/cake-mockup-2026-11/README.md`의 표. 순서는 `make_tokens.py`(토큰) → `contrast.py`(색 쌍 대비) → 아트보드 작성(`gen.py` 또는 손) → `dc2html.py`(검사용 HTML) → `check_local.js <page-check.js> <HTML 절대 경로> <아트보드 너비> <PNG>`(줄바꿈·넘침·대비·누름 영역, 뷰포트는 휴대폰 360이 아니라 아트보드 너비) → PNG를 눈으로 봄.
- 공통: `main`에 `research/cake-terms-2026-11/run.py --write`를 다시 돌리지 마세요(바꾸면 안 되는 3개 파일 37곳이 바뀜). 생성 파일(`api/openapi.yaml`, `spec.md`의 표, README의 generated 블록, `sitemap.html`, 08 생성 파일 등)은 손으로 고치지 않습니다. 원래 값 파일을 고친 뒤 생성기로 다시 만듭니다.
- DB 검사용 PostgreSQL 16: 클라우드 컨테이너는 사라지므로 새로 설치하고 빈 클러스터를 만들어 DSN을 줍니다(이전 예: 소켓 폴더 `/var/lib/postgresql/siljang-erd`, 포트 55432, 사용자 postgres).
- 마지막 검사 결과: 11/13 10:2x main `cdff7bc` 파일에서 `check_screens.py` 15/15(허브 포함), `build_screens.py` 생성 파일 51개 원본과 같음. 11/13 09:27 main `cdff7bc`에서 `build_spec.py` 오류 0. 11/13 00:40 무렵 main `61b677e`에서 `check_api.py` 17개 통과(빈 DB·목 서버 포함)와 `check_sitemap.py` 실패 0. 11/12 main `91f5209`에서 `check_prd.py`·`check_flows.py` 문제 0, `check_erd.py` 14/14.

## 8. 11/12 23:38 ~ 11/13 10:11에 이 계정이 한 일

- 11/12 인계 9절의 1~4: Miro 01 보드에 용어 82개 반영, Swagger UI·사이트맵 페이지를 새 주소로 게시하고 링크와 깨진 API 설명 4곳을 PR #16으로 고침(`61b677e`), Notion 첫 화면과 용어 정리 기록 행 기록. 예전 기록 말투는 11/13 01:05 결정 카드에서 동희님이 'Claude 문장 전부 바꿈'을 고르셔서, Notion 첫 화면의 지난 기록·작업로그와 01~07 기록 행 7개의 Claude 문장만 업계 용어로 바꿨습니다(동희님 말과 지난 결정 카드 인용은 그대로, 03:20 끝).
- 08단계: 화면 정의 49개(목적·데이터·액션·상태·응답·케이스 유형), 상태 336개(기본 상태 여섯과 화면 고유 상태 16종), 06단계 응답 740행을 화면 상태에 하나씩 연결, 회색조 와이어프레임 672개, 결정 사항 W1~W9. 03:10 확인 요청, 09:13 '추천대로 확정'. PR #17을 검토 요청으로 바꾸자 자동 코드 검토가 의견 2건을 남겨(SCR-025 '환불 없음'의 0원 입력 규칙, SCR-048 확인된 가게 결과 화면의 버튼) 둘 다 고치고 같은 종류의 읽기 전용 결과 상태 SCR-017·021·024·026·027·029도 고쳤습니다(`0a545e2`). 자동 보안 검토는 찾은 것이 없었습니다. squash로 main `cdff7bc`(09:27). 와이어프레임 페이지를 같은 주소에 다시 게시하고 Notion 08 행·결정 사항 W 9행·화면 상태 49행·첫 화면(09:35)을 기록했습니다.
- 09단계(09:35~10:11, 체크포인트 전에 멈춤):
  - 대표 화면 셋을 골랐습니다: SCR-001 예약 링크 페이지(손님 공개 화면), SCR-016 할 일 목록(사장님 첫 화면), SCR-022 맞춤 주문 검토(금액 변경과 확인 창이 있는 사장님 결정 화면). 보일 상태와 너비는 SCR-001 normal·empty(360)와 normal(1280), SCR-016 normal·not-sent·empty(360)와 normal(1280), SCR-022 normal·금액 변경 펼침·confirm(360)과 normal(1280)입니다.
  - 후보 두 개의 디자인 토큰을 DTCG 2025.10 형식으로 만들었습니다: A '주문서'(51개, 종이 주문서처럼 얇은 선과 촘촘한 글·숫자, 볼펜 남색 `#2B4BA6`, IBM Plex Sans KR)와 B '쇼케이스'(55개, 사진이 먼저 보이는 진열장, 넓은 여백과 둥근 카드, 진한 청록 `#0E5A5C`, 제목 Gothic A1과 본문 Noto Sans KR). 비교 표는 `research/cake-mockup-2026-11/README.md`입니다. 색 쌍 26개 대비가 모두 기준을 넘습니다.
  - Claude Design 캔버스(Artifact Design 타입)에 토큰 비교 보드(`Main`, 2640×2130)와 SCR-001 360의 A·B 보드(normal 전체 길이, empty 첫 화면)를 그려 게시했습니다(버전 4). 세 보드 모두 `page-check.js` 통과(오류 0·경고 0), 가로 넘침 0, 콘솔 오류 0입니다. SCR-001 두 보드는 전체 PNG를, `Main`은 네 조각 중 두 조각(A 위쪽, B 아래쪽)만 눈으로 봤습니다.
  - 나머지 보드 10개를 쓰는 `gen.py`를 만들었지만 돌리기 전에 멈췄습니다.
  - 동희님께는 아직 아무것도 묻지 않았습니다(방향, 사람 보기, 빠진 입력 모두).
- 11/13 10:11 멈춘 뒤: 09단계 파일을 저장소로 옮기고(경로만 바꿈, 옮긴 스크립트로 토큰 바이트 일치·대비 26쌍·보드 검사 3개가 이전과 같음을 확인), 이 문서와 초안 PR을 올리고, Notion 첫 화면에 인계를 기록했습니다.

## 9. 남은 일 (이 순서로)

1. 0절을 확인하고, 연결을 점검하고, 부록 A 메모리를 새 계정에 저장합니다. 인계 초안 PR을 main에 합치고 최신 main에서 새 브랜치를 만듭니다.
2. 06·07·08 페이지를 새 계정에서 새로 게시하고(6절), 저장소 링크를 PR로 바꾸고, Notion 첫 화면과 06·07·08 기록 행의 링크를 바꿉니다.
3. 09단계를 이어 합니다(`corthex-screen` `references/09-mockup.md`, `corthex-uxui`).
   1. 캔버스: Artifact 도구의 `quickstart`(intent `design`)로 Design 타입을 받아 새 캔버스를 만들고, `research/cake-mockup-2026-11/canvas/project/`의 4개 파일을 `project/` 아래에 올립니다. 이 계정이 지킨 아트보드 규칙: 머리에 `<script src="./support.js"></script>`, `<x-dc>` 안 `<helmet>`에 Google Fonts 링크와 `body{margin:0}`·`a` 색, 스타일은 모두 인라인으로 토큰 변수만 씀(직접 쓴 px는 360·1280·800과 보드 너비뿐), 끝에 `<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":W,"height":H}}'>`와 `class Component extends DCLogic { renderVals() { return {}; } }`, `{{ }}` 구멍 없음, 글꼴 이름은 작은따옴표. 게시는 한 번에 한 파일씩 `url`과 `root`로, 작은 수정은 `edits`로, 배치를 바꿀 때만 `canvas.json`을 보냅니다. 새로 받은 타입 안내와 다르면 안내를 따릅니다.
   2. `gen.py`를 처음 돌려 고칩니다. 보드마다 `dc2html.py` → `check_local.js`(뷰포트는 보드 너비) → PNG를 눈으로 보고, 잰 높이를 `heights.json`에 적어 다시 생성한 뒤 한 파일씩 게시합니다.
   3. `canvas.json` 배치를 실제 크기로 고칩니다: A 보드 폭 816(휴대폰 2개)·1208(3개)·1344(1280 화면), B는 864·1272·1376, 높이는 잰 값, B 열 x=1440, 다음 줄 y=윗줄 아래 끝+420, 줄 제목 메모 y=줄 y−300. 지금 파일의 A·B-SCR-001-360 크기(840×1600, 864×1700)는 실제(816×1476, 864×1988)와 다릅니다.
   4. 시안의 글을 08 화면 정의와 대조합니다(`research/cake-mockup-2026-11/README.md` '시안의 글과 숫자'). 정의에 없는 글은 빼거나, 정의에 더할지 동희님께 확인합니다.
   5. 원본과 기록: `.corthex/project.json`에 09 항목을 제안합니다(계약의 기본 사람 보기는 Figma나 Claude Design이고, Figma는 연결·로그인이 없어 Claude Design 캔버스로 했으므로 동희님 확인 뒤 `note`에 결정으로 적음; `source`는 `design/`, `truth`는 `source`). `docs/09-mockup/README.md`(후보 비교, 보인 상태와 너비, 검사 결과, 측정하지 않은 것), 09 검사 스크립트(계약의 검사: 아트보드는 토큰 이름만 씀, 그룹에는 `$value`가 없고 토큰에는 `$value`와 `$type`, 토큰마다 값 하나, 고른 방향과 동희님 말 기록. 더해서 아트보드의 SCR ID와 상태 이름이 08 정의에 있는지), Notion 09 기록 행.
   6. 체크포인트(더 그리기 전에 방향 하나): 결정 카드로 "목업 방향을 A 주문서와 B 쇼케이스 중 무엇으로 할까요?"를 묻습니다. 이 계정의 판단(아직 동희님께 말하지 않음, 추천일 뿐): A. 이유는 화면 49개 중 32개가 사장님 업무 화면(할 일, 주문 검토, 결제 확인 등)이라 촘촘한 표와 숫자, 빠른 훑기가 중요하기 때문입니다. 반론은 손님 공개 화면(SCR-001 등)은 사진이 먼저 보여야 주문이 늘 수 있다는 점입니다. 보완은 A로 가되 손님 화면의 사진을 키우는 것입니다. 함께 확인할 것: 사람 보기를 Figma 대신 Claude Design 캔버스로 할지, 빠진 입력(가게 로고, 브랜드 색, 글꼴, 동희님이 좋아하는 참고 사이트)이 있는지, 몇 화면까지 그릴지.
   7. 고른 뒤: 고른 후보를 `design/base.tokens.json`으로 옮기고(라이트·다크 같은 모드가 생기면 모드별 파일과 `design/tokens.resolver.json`), 나머지 화면을 고른 방향으로 그리고, 화면 정의에서 고른 시안을 링크합니다. 개발 전에 토큰을 확정하는 두 번째 체크포인트를 거쳐 `stages.json` 09를 done으로 적고 PR을 합칩니다.
4. 설계를 모두 마치면 동희님이 정한 모델로 독립 리뷰를 합니다(2절). [추정] 09단계가 설계의 마지막 단계이므로 10단계 전에 할지 동희님께 확인합니다.
5. 그 뒤 10 WBS, 11 개발, 12 QA, 13 발표 순서입니다. 법률 검토 질문 8개는 출시 전까지입니다.
6. 08에서 남은 것: W7 오픈빌더 봇 ID 위치(확인 전 문구 그대로, 개발 전에 동희님 PC의 실제 오픈빌더 화면으로 확인), OPEN-6 운영자 인증 서비스, SCR-011을 사이트맵 specs에 더할 후보.
7. 동희님이 결정할 것(그대로 남음): Notion 첫 화면 '다음 행동' 속성의 PoC 가게 후보를 케이크 기준으로 다시 고르기(21행), 가격 가설(68·9행), 첫 결제 전 126 문의.
8. 선택(동희님이 원할 때만): CORTHEX 하네스 요약 보완(11/12 인계 9절 끝). 정본 `kodonghui/corthex`의 세션 시작 요약(corthex-memory `context/principles.md`)과 `skills/corthex/SKILL.md` 3절 요약에 principles.md 9행(업계 표준 용어)이 빠져 있다는 사실을 11/12에 답했고, 고칠지는 아직 답이 없습니다.

## 10. 겹치지 않게 지킬 점

- 이 계정은 손을 뗐습니다. 시작 전에 main·PR·`stages.json`·Notion 작업로그로 기준(`cdff7bc`, 열린 PR은 인계 초안 하나)과 달라진 점이 있는지 확인하세요.
- 새 브랜치는 최신 main에서 새 이름으로 만듭니다. 예전 브랜치를 다시 쓰지 않습니다.
- 이 계정의 Artifact 페이지는 고치거나 지우지 말고 새로 게시합니다.
- Notion은 기존 DB와 행을 재사용합니다.
- 단계가 하나 끝날 때마다 멈추고 동희님 확인을 받습니다.

## 부록 A. 프로젝트 메모리 12개 (2026-11-13 10:45 KST, 원문에서 모델 이름만 바꿈)

이 계정의 프로젝트 메모리에서 설계·개발에 쓰는 파일을 옮겼습니다. 쓴 때의 기록이므로 쓰기 전에 지금 상태로 확인하세요. `/mnt/project-files/...` 경로는 이 계정 프로젝트의 공유 폴더라 새 계정에서는 열리지 않습니다(필요한 파일은 저장소 `research/`에 있음). `[[이름]]`은 다른 메모리 파일을 가리킵니다. 저장소에는 모델 이름을 쓰지 않는 규칙에 따라 리뷰 모델 이름은 `[리뷰 모델]`, 그 밖의 모델 이름은 `[모델]`, 자동 코드 검토 도구 이름은 빼고 '자동 코드 검토'로 썼고, 나머지는 글자 그대로입니다. 바꾸지 않은 원문은 `memory-all.md`에 있습니다. 08단계 뒤의 일(09단계와 이 인계)은 이 문서 8·9절이 기록입니다.

### A-1. `service-ax-platform-pivot.md`

````markdown
---
name: service-ax-platform-pivot
description: 11/07 피벗(1인 고관여 서비스직 AI 예약·상담 플랫폼) 보고서 위치, 제품 저장소 siljang.ai(11/11 17:44), 시장 순서 B(11/07), 첫 업종 수제케이크(11/11), /corthex 단계별 설계, 남은 결정(21 PoC·68·9 가격)
metadata:
  type: project
  modified: 2026-11-11T08:54:45.000Z
---

2026-11-07 05:33 KST 동희님 지시로 카톡·크몽 외주에서 "1인 고관여 서비스직 글로벌 노코드 AI 예약·상담 플랫폼"으로 피벗(대상 6업종: 브로우, 타투·반영구, 1인 필라테스·PT, 꽃집, 1인 에스테틱, 야외·웨딩 스냅). 보고서 https://app.notion.com/p/410bf16cc3ec8123a4a8cf1b88dfc61d (표 ID는 [[service-ax-notion-map]]). 조사 노트: /mnt/project-files/research/ai-booking-pivot-2026-11/

- 정해짐: 시장 순서 B(한국 먼저, 법·결제·언어는 나라별 패키지). 11/07 09:55 결정 카드. 사업자 등록은 11/07 10:07 '등록 없이 받기'([[business-registration-timing]]).
- 정해짐: 첫 업종 수제케이크(주문제작)집. 11/11 12:47 "수제케이크집으로 해봐바 /corthex 하네스로 작업하고, 한 단계씩 끝날때마다 나한테 말해줘. 논의해가면서 하자." 설계 뒤 [리뷰 모델]로 독립 재검토(동희님). 🧭 64행 정해짐.
- 정해짐: 제품 저장소는 kodonghui/siljang.ai(비공개, 11/07 동희님이 기획안 README로 만듦). 11/11 17:44 프로젝트 대화 "야 너 어디서 작업중이야? siljang에서 해야지". 설계 문서·단계 기록(.corthex)은 여기에 두고, kakao-hack은 대회용 카톡 봇 코드(재료)로만 봄. 🧭 44행 정해짐.
- 11/07 브로우 추천은 여섯 업종 안에서 고른 것이라 케이크와 비교한 적 없었다. 11/11 비교(Claude 판단)도 첫 PoC는 케이크: PoC가 먼저 시험하는 건 AI 상담·견적, 케이크는 옵션 조합 견적에 맞고 결제·법 쟁점이 적음, 11/06 케이크 견적 규칙 23개 재사용. 반론: 낮은 객단가로 월 3만원 의향 약함, 선입금 관행이면 노쇼 고통·'왜 지금(문신사법)' 약함. 대응: 첫 인터뷰에서 선입금 관행·월 3만원 의향 먼저, 브로우는 2027-10-29 전 두 번째 업종 후보(Claude 추천, 승인 전).
- 결정 대기: 21 PoC 후보(케이크 기준 다시), 68·9 가격(월 3만/5만+세팅비 15만 추천). 여섯 업종을 대상에 둘지는 미정. 크몽·숨고(3·15·17행)·파티룸(6행)은 멈춤.
- 원문 미확인(케이크): 전자상거래법 제17조②6호·시행령 제21조 주문제작 청약철회 제한, 제과 분쟁해결기준, 식품 영업신고. 보고서 1-5 시장 규모·5-1 '왜 지금'은 아직 반영구·여섯 업종 기준.
- 지킬 선: 금액·가능 여부는 코드, AI는 사실 추출·인용 설명만. 예약금은 가게 명의 PG·Stripe로 바로 가고 "에스크로"라 쓰지 않는다.

**Why:** 스레드가 조사를 되풀이하거나 옛 브로우 추천·카톡 결정을 새 결정과 섞지 않게.
**How to apply:** 결정이 나면 🧭 행 상태, 지도 본문(결정할 것 목록, 어긋난 곳 9군데), 보고서 한눈에·7절, 프로젝트 첫 화면을 함께 고친다. 원문 대조한 사실은 [[service-ax-verified-facts]]. 예전 상품 [[kmong-kakao-bot-product]], 영업 법 [[kakao-outreach-law]].
````

### A-2. `service-ax-ai-stack.md`

````markdown
---
name: service-ax-ai-stack
description: 예약·상담 플랫폼의 AI 부분은 LangChain·LangGraph로 만든다(11/11 14:03 동희님), 같은 방향의 11/10 말씀, 설계에 쓰는 다섯 줄기
metadata:
  type: project
  modified: 2026-11-11T05:40:44.977Z
---

결정: 2026-11-11 14:03 KST 프로젝트 대화(1차 확인 지점 답과 함께) 동희님 "야 그 AI만들때, 참고로 ai 부분은 랭채인 랭그래프로 만들거다?". 같은 방향의 앞선 말씀: 2026-11-10 11:10 필받음_약봉이 채팅 "이제는 AI 부를때 랭채인 랭그래프로 Agent 를 만들어버릴거야" (메타 하네스인지 진짜 하네스인지는 미정). AX 인재전쟁 W07 제출본은 11/10 13:41 결정으로 지금 구조 유지(LangGraph 연습은 마감 뒤 사본) — 케이크 플랫폼과 겹치지 않음.

스터디·회고 16개 분석(11/11, Notion https://app.notion.com/p/415bf16cc3ec81fe85dbf4fa3744364e)에서 정한 설계 줄기:
1. 상담은 에이전트, 주문의 수명은 코드 상태 기계(LangGraph로 옮김). 사이 약속은 구조화된 주문서 초안. 수업 자료도 '바깥은 정해진 워크플로, 노드 안에서만 에이전트'를 권장.
2. 가격·리드타임·휴무·수량·환불은 코드가 계산, AI는 설명. AI 쓰기 도구는 초안 저장과 사장님 확인 요청 정도.
3. 확정·결제 안내·환불·바깥 발송은 서버 코드 검사와 사장님(Rule of Two).
4. 중복·늦음·순서 바뀜(연속 메시지, 결제 알림, 재시도·재개 때 노드 재실행)은 주문번호 키·판 번호·받은편지함으로.
5. 사람이 끝까지 써 보기와 독립 평가(설계 뒤 [리뷰 모델] 재검토 계획).
- 추적(LangSmith)은 기본값 끄기: 대화·시스템 프롬프트가 바깥으로 나가고 서울 지역 없음(S5, 11/7 기준).
- 제품은 구독이 아니라 API 키로 부름, 메시지마다 비용.

**Why:** 01단계는 기술과 상관없이 그리지만 04·06·11단계에서 LangGraph로 옮길 수 있게 AI 명령과 사람 명령을 나눠 두기 위해.
**How to apply:** 단계 문서에 제약으로 적고(domain.md 0-5), 프레임워크가 업무 규칙을 대신하지 않는다는 점을 지킨다. [[cake-domain-stage01]] [[service-ax-platform-pivot]]
````

### A-3. `service-ax-notion-map.md`

````markdown
---
name: service-ax-notion-map
description: 피벗 뒤 프로젝트(1인 서비스업 AI 예약·상담 플랫폼)의 Notion 첫 화면·최근 업데이트 DB·🧭 전략·설계 지도·피벗 연구 보고서와 그 안 표 9개의 ID
metadata:
  type: reference
  modified: 2026-11-07T01:30:29.025Z
---

- 프로젝트 페이지(11/07 새 제목 "1인 서비스업 AI 예약·상담 플랫폼 · 카톡 외주에서 피벗") https://app.notion.com/p/410bf16cc3ec81db8cb8ce38eb68b7e7 . 첫 블록 최근 업데이트 DB collection://5d5bf16c-c3ec-8382-b60c-8769771fc1c2 (문서·종류·최근 변경·달라진 점·읽었어요), 새 문서는 이 DB의 행. 프로젝트 DB collection://48e84da4-280c-4461-b6c2-060d3fbe6f67 (목표·다음 행동·상태·최근 갱신일).
- 피벗 연구 보고서 410bf16cc3ec8123a4a8cf1b88dfc61d. 안의 표(collection://): 방향 대안 c355e370-18c1-4bb4-b0f9-8adb6342c24a, 업종 지도 985120c6-dba8-410f-8cec-1ca416974b89, 경쟁·벤치마크 c31522b6-36c7-48e1-a9b1-30db2752b80c, 가격 가설 80d8e87e-582c-4291-992e-64ea6ae90308, 단계 로드맵 e0a50d42-ad10-4afe-abcc-2e1763a544cb, KPI 5699a80b-f68d-4e85-9225-69c4f3a2eb42, 근거 숫자 47f8b460-1ba2-4eb5-a6c1-33e88f1e4994, 위험·반론 ee75d2f9-e765-4939-8d65-9589afcb21cb, PC 재확인(11/07, 30행, 8-1 아래) 0763f785-7520-49fe-a917-7892199e7208.
- 전략·설계 전체 지도 410bf16cc3ec81e4babfdd130dec3afa. 안의 🧭 전략·설계 항목 collection://16ba69df-489c-4cb3-86bd-fba4c93c3c1b (항목·순서·회차·상태·지금 내용·추천과 반론·다음 행동·근거, 68행). 상태는 정해짐/결정할 것/Claude 판단/확인할 것/아직 없음/멈춤. 새 상태 값은 update-data-source로 기존 값을 모두 적어 더해야 행에 쓸 수 있다. 옛 행을 고칠 때는 "(이전: …)"으로 원문을 남기고, 결정이 나면 행 상태와 지도 본문(결정할 것 목록, 어긋난 곳 9군데)을 함께 고친다.
- 피벗 전 문서(크몽 상품, 1분 제안, 시스템 구조, 1-Page 요약, 로드맵 보고서)의 ID는 [[kakao-bot-notion-map]].

[[service-ax-platform-pivot]] [[notion-autolink-gotcha]]
````

### A-4. `service-ax-verified-facts.md`

````markdown
---
name: service-ax-verified-facts
description: 피벗 보고서 핵심 주장 30개를 11/07 동희님 PC(Aside)로 원문 대조한 결과와 다시 쓸 때 지킬 사실(대법원·AI 기본법·노쇼 기준·PG 업종·자영업 통계)
metadata:
  type: project
---

2026-11-07 10:07–10:42 KST 동희님 PC의 Aside로 30개 대조: 틀린 것 0, 일부 다름 4, 시행령 미확인 1. 전체 표는 보고서 8-1 아래 DB, 요약은 /mnt/project-files/research/ai-booking-pivot-2026-11/pc-recheck-2026-11-07.md

- 대법원 2026-05-21: 2021도15611(미용문신)·2022도13370(서화문신) 파기환송, 91도3219 변경. "만장일치"는 쓰지 않음. 06-11 무죄 확정은 보도 기준.
- 문신사법: '반영구'는 법률 용어가 아니고 '미용문신행위'(제2조).
- AI 기본법: 고지 제31조①, 과태료 3천만원 이하는 제43조①1호. 계도기간은 정부 방침.
- 노쇼: 2025-12 개정은 음식점(40%/20%)뿐. 미용에는 노쇼 항목 없고 해지 기준(총액 10%)만.
- PG: 공개 불가 목록(나이스페이·이니시스·토스페이)에 문신 없음. 나이스페이에 '위약금 있는 예약상품'·스포츠 이용권이 있어 쟁점은 예약금 구조. PG 문의는 동희님 확인 뒤.
- 전자금융거래법 시행령(06-19 입법예고분) 공포는 11/07 기준 미확인.
- 고용원 없는 자영업자 2026-08 430.3만(74.4%). 약 10만 곳·SAM 약 360억원 유지.
- [모델] 캐시 읽기 0.10달러 맞음. 일본 82.7%는 캐시리스 중 카드 비중(캐시리스 58.0%).
- 남은 확인: 금융청 원문, 2023 アートメイク 통지, MHMDA, eCFR 개정, 별표 원본.

**Why:** 로드맵·사업계획서로 옮길 때 옛 표현(만장일치, 제31조 과태료, 미용 노쇼 40%, PG가 문신을 막음)이 되살아나지 않게.
**How to apply:** 위 주제를 쓰기 전에 이 파일과 8-1 표를 본다. 남은 확인은 '확인 못 함'으로 쓴다. [[service-ax-platform-pivot]] [[service-ax-notion-map]] [[web-lookup-tools]]
````

### A-5. `cake-domain-stage01.md`

````markdown
---
name: cake-domain-stage01
description: 수제케이크 CORTHEX 01단계 마침(11/11 17:11, CTX-001~009·TERM-001~073), 원본은 siljang.ai main(18:07 PR #1로 합침), Miro·Notion ID, 02 범위 확정 뒤 TERM-074·3-5를 더함(22:30 PR #2로 main)
metadata:
  type: project
  modified: 2026-11-11T12:29:34.895Z
---

2026-11-11 12:47 동희님: 수제케이크집을 /corthex 하네스로 한 단계씩 논의하며 하고, 설계를 마치면 [리뷰 모델]로 독립 재검토.

- 01단계 마침. 확인 지점 1차 14:03 "추천은 모두 승인"(맞춤 주문만, 전액 선결제), 2차 15:46 "추천 모두 승인"(문제 신고 흐름, 결제 안내 때 그날 자리 잡기, 가게 규칙 따로), 3차 17:11 "추천 모두 승인" "지울건 지워".
- 원본: kodonghui/siljang.ai main의 docs/01-domain/domain.md와 .corthex/. PR #1로 18:07 합침(f65d809). 17:44 "siljang에서 해야지"로 kakao-hack PR #10(닫음)에서 커밋째 옮김. 02단계부터는 02 스레드가 맡음(18:16 "2단계부터는 새 스레드에서 하자").
- CTX: 001 상담, 002 가게 규칙, 003 주문(핵심), 004 결제·환불, 005 제작·전달, 006 후기·포트폴리오, 007 가게 등록·연결, 008 알림, 009 장부 연결. TERM-001~073(업무 45, 애그리거트 10, 읽기 모델 18).
- 11/11 20:17 02 범위 확정 뒤 02 가지(PR #2)에서 domain.md를 고침: 3-5(02에서 되돌린 것), TERM-074 운영자, 열린 핫스팟 모두 답함([추측] 뗌). Miro도 고침(항목 2,046). 11/11 22:30 PR #2(5d2908b)로 main에 들어감 [[cake-prd-stage02]].
- 18:15 01 스레드가 PC로 보낸 02용 법 조문 확인은 PC가 꺼져 18:18에 멈춤(결과가 오면 research 폴더에 저장).
- Miro https://miro.com/app/board/uXjVEPLnid4=/ (프레임 12, 프레임 ID는 domain.md 2절). Notion 01 기록 행 415bf16cc3ec81879385e0d0792ed6b1. 🧭 44·45행 정해짐.
- 확인 방법: corthex-hub scripts의 domain 해석기를 직접 불러 읽음(경고 0). hub snapshot은 main을 읽음. 메모는 /mnt/project-files/research/cake-domain-2026-11/.

**Why:** 다음 작업이 01단계를 다시 하거나 옛 위치(kakao-hack)에서 이어 쓰지 않게.
**How to apply:** 01을 고칠 일은 domain.md를 먼저 고치고 Miro에 옮긴 뒤 'AI:' 댓글로 알림. [[service-ax-platform-pivot]] [[service-ax-ai-stack]] [[web-lookup-tools]]
````

### A-6. `cake-prd-stage02.md`

````markdown
---
name: cake-prd-stage02
description: 수제케이크 02단계 PRD 마침(11/11 22:24 판 확정, REQ-001~150 1판), siljang.ai main에 PR #2로 합침(22:30, 5d2908b), Notion ID, 다음은 03단계(사용자 흐름)
metadata:
  type: project
  modified: 2026-11-11T13:38:53.463Z
---

11/11 18:16 동희님 "2단계부터는 새 스레드에서 하자", "클라우드에서 작업하고". 같은 말의 "모두 승인"은 02 추천을 보기 전이라 승인으로 세지 않음.

- 범위 확정: 11/11 20:17 02 스레드 결정 카드("핫스팟 추천을 포함해 02단계 범위를 이대로 확정할까요?")에서 '이대로 확정'. 핫스팟 26개 답(추천 8: 1·6·8·12·17·18·20·25, 기본값 17, 가설 1: 19)과 26·34·결제 기한 12시간·사장님 알림 경로 기본값은 동희님 결정.
- 판 확정: 11/11 22:24 같은 스레드 카드("요구사항 1판(REQ-001~150)을 이대로 굳히고 03단계로 갈까요?", 21:30에 여쭘)에서 '판 확정'. 카드 내용은 PR #2 합치고 02 마침 기록 뒤 03 시작, 뒤에 바꿀 것은 '제외'나 새 번호. 판 확정 때 요구사항 행은 안 고침.
- 원본: siljang.ai main의 docs/02-prd/requirements.md(1판). PR #2를 22:30 merge commit 5d2908b로 합침(8218526 초안, c4242c2 범위 확정, eb69877 단계 기록, fa0e292 판 확정). CI 없음, 자동 리뷰는 사용량 한도로 실패(지적 0). 허브는 main을 읽어 02-prd done(확인 지점 2개), 항목 233, 오류·경고 0.
- 저장소 문서에 없는 ID("REQ-151")를 쓰면 check_prd와 허브가 걸림 → "151번부터"로 씀. Notion에는 REQ-151로 써도 됨.
- 01 되돌림: domain.md 3-5, TERM-074 운영자(7-4). Miro 지운 항목 0, 항목 2,046.
- Notion: 02 기록 행 415bf16cc3ec81d28b8dd61931abbce1(제목 '1판 확정, 02단계 마침'). 요구사항 표 collection://2423480b-108c-4366-b2dc-f8dba389aeef(150행 확정). 핫스팟 답 표 collection://1d25fc54-a18d-4df3-a7e3-32c383f98479(27행, 26 동희님 결정, 19 가설). 🧭 46행 정해짐(22:33), 개수 정해짐 19·결정할 것 7·Claude 판단 22·확인할 것 8·아직 없음 8·멈춤 4.
- 03단계: 01·02처럼 새 스레드에서 하도록 11/11 22:4x 코디네이터에게 요청. project.json에 03-user-flow 설정이 아직 없음.
- 검사: /mnt/project-files/research/cake-prd-2026-11/ 의 check_prd.py(문제 0), picture_check.py.
- 교훈: 데이터 소스 설명은 글자 그대로라 ~를 \~로 쓰지 않음(fetch는 \~로 보여 줌). 텍스트 속성은 markdown(\~, \[ \], 백틱). SQL 모드는 WITH RECURSIVE 거부. 한국어를 \u로 보냈으면 기록(JSONL)에서 풀어 다시 읽음.

**Why:** 03단계가 02를 다시 묻거나, 1판 뒤 변경을 지우거나 번호를 다시 쓰지 않게.
**How to apply:** 03단계는 main의 requirements.md 1판과 domain.md에서 시작. 요구사항을 바꾸면 '제외'나 새 번호(151~)로 두고 다음 판에서 확인받음. [[cake-domain-stage01]] [[service-ax-platform-pivot]] [[service-ax-notion-map]] [[notion-autolink-gotcha]]
````

### A-7. `cake-flow-stage03.md`

````markdown
---
name: cake-flow-stage03
description: 수제케이크 03단계 마침(11/12 09:13 '추천대로 확정', 2판 REQ-151~157, PR #3으로 main f47a808), 11/12 작업을 다른 계정으로 옮김, 넘김 파일은 siljang.ai 초안 PR #4(research/)
metadata:
  type: project
  modified: 2026-11-12T00:34:22.246Z
---

11/11 22:39 코디네이터가 03 스레드를 엶(동희님 12:47 "한 단계씩 끝날때마다 나한테 말해줘. 논의해가면서 하자"). 23:25 초안(FL-001~014, 후보 N1~N7, 읽은 방식 R1~R22), 23:51 확인 지점 카드.

- 11/12 아침 동희님이 이 작업을 **다른 계정**으로 옮기심. 그 계정에서 09:12에 같은 질문을 다시 올렸고 09:13 '추천대로 확정'. 그 계정이 f6edcdf로 반영(2판 REQ-151~157, REQ-083·REQ-119는 '제외(2판, …로 바꿈)', TERM-049·054 고침), PR #3이 09:19 main f47a808(squash). stages.json 03 done, next는 04단계.
- 09:17 동희님이 이 계정에는 멈추고 파일을 넘기라고 하심("깃에 올려서줘야지"). 이 계정의 공유 폴더·작업 공간에만 있던 15개를 research/ 아래로 올림: 가지 claude/project-thread-wryjf1, 초안 PR #4(b69f2b5). 강제 푸시가 허용되지 않아 main을 가지에 합친(30403e7) 뒤 올림. 상태와 검사는 research/cake-flow-2026-11/HANDOFF.md.
- check_flows.py·check_prd.py는 2판 표에서 멈춰서 고침(머리줄 `| ID | 요구사항` 표만 읽고 '제외…' 상태를 뺌). main에서 문제 0, 필수 108/109, 살아 있는 150/155, 행 157, 부록이 README 7절과 같음. 옮긴 계정은 같은 이름의 check_flows.py를 자기 프로젝트 파일에 새로 만들었다고 docs/03-user-flow/README.md 6절에 적음(다른 파일).
- 이 계정은 09:17 뒤 Notion을 쓰지 않음. 확정 뒤 Notion 정리(흐름 표 상태, 후보 표, 기록 행, 🧭 지도, 프로젝트 행)를 그 계정이 했는지는 모름.
- Notion ID: 기록 행 415bf16cc3ec8170b22bf7ce04dc315c, 흐름 표 67cd294c32764e5399406187fa021b2e(ds 8adbbe2d-640f-49cd-a96c-3ddd880cb267), 후보 표 df79c1494a954b5c9d8b7bbd9df27bc3(ds 880604f6-0fe2-47eb-ab2a-1dc93135c164), 읽은 방식 표 0b281fc982aa445b88f02ce184dd5ba2(ds 0be2bc5d-4649-4768-bc02-1fe01aa62bae).
- 교훈: Notion 행 내용을 손으로 옮기면 오타가 남(FL-007). 넣은 값과 다시 읽은 값을 원본과 기계로 대조. 텍스트 속성의 ~는 \~.

**Why:** 작업이 다른 계정으로 옮겨져서, 이 프로젝트에서 다시 열려도 무엇이 어디 있는지 바로 알게.
**How to apply:** 이 프로젝트에서 수제케이크 03·04단계 일을 맡으면 먼저 동희님께 어느 계정에서 이어 하는지 여쭘. PR #4를 합칠지는 동희님·옮긴 계정이 정함. [[cake-prd-stage02]] [[cake-domain-stage01]] [[service-ax-notion-map]] [[notion-autolink-gotcha]]
````

### A-8. `cake-handover-back-2026-11-12.md`

````markdown
---
name: cake-handover-back-2026-11-12
description: 11/12 23:38 KST 다른 계정이 01~07단계를 마치고 인계해 이 계정이 다시 이어받음. Miro 용어 반영·Artifact 재게시(PR #16)·08단계 끝, 다음은 09단계(목업)
metadata:
  type: project
  modified: 2026-11-12T16:06:05.177Z
---

2026-11-12 23:38 KST 동희님이 이 프로젝트 스레드에 "Siljang 작업 인계 (2026-11-12 23:20 KST, 이전 계정의 Claude가 작성)"를 붙여 주심. 11/12 아침 다른 계정으로 옮긴 수제케이크 설계([[cake-flow-stage03]])가 04~07단계까지 끝나고(main f9eaaaf, 07 체크포인트 11/12 15:46) 돌아옴. "/corthex:corthex 플러그인으로 작업해라잉".

- 규칙: 업계 표준 용어(11/12 15:46 "화면 나무가 뭐야 … 어줍잔은 한국어 뭔데", 17:30 대조표 82개 확정, 기준 domain.md 3-7·7절). 푸시·머지·배포는 묻지 않음(squash). 단계 끝마다 결정 카드로 멈춤. main에 cake-terms run.py --write 금지.
- Artifact 재게시(옛 계정 것은 못 고침): 06 https://claude.ai/artifact/VNFQ5dXepMshMwtvUVdBbH (build_viewer.py html + openapi.json), 07 https://claude.ai/artifact/CeVbTfWtRHgL5undj5WNEd. 링크는 PR #16(main 61b677e), 같은 PR에서 API 설명 깨진 말 4곳 고침. check_api --db는 "host=/var/run/postgresql" 형식(URI 아님).
- Miro 01 보드(uXjVEPLnid4=) 용어 반영 끝: 스티커 234·텍스트 170·다이어그램 2·프레임 이름 5. 9 프레임 맨 아래 '용어 정리 반영' 박스(rect 3458764690266021358), AI: 댓글 3458764690266021742, 9 프레임 높이 13730. 남은 옛말은 인용뿐.
- Notion 첫 화면·용어 정리 기록 행(416bf16cc3ec8149a1cacc395e33055c)·06·07 행 링크는 끝. 옛 기록 말투: 11/13 01:05 KST 이 스레드 결정 카드에서 동희님이 'Claude 문장 전부 바꿈'(A) 선택 → Notion 첫 화면과 01~07 기록 행의 Claude가 쓴 문장을 업계 용어로 바꿈(동희님 말·지난 결정 카드 인용은 그대로). 11/13 03:20 KST에 끝냄([[cake-screens-stage08]]).
- 남은 일: 08단계는 11/13 09:13 확정·main cdff7bc로 마침([[cake-screens-stage08]]) → 09(목업)~12, 설계 뒤 [리뷰 모델] 재검토, 법률 질문 8개. 대기 결정: PoC 가게 후보(21행), 가격 가설(68행), 첫 결제 전 126 문의.

**Why:** 계정이 두 번 바뀌어 어느 쪽이 무엇을 했는지 헷갈리기 쉬움.
**How to apply:** 수제케이크 일을 이으면 이 파일과 siljang.ai main의 .corthex/stages.json부터 읽음. [[service-ax-platform-pivot]] [[service-ax-notion-map]]
````

### A-9. `cake-screens-stage08.md`

````markdown
---
name: cake-screens-stage08
description: 수제케이크 08단계 화면 상태 마침(11/13 09:13 '추천대로 확정', 화면 49·상태 336·응답 740행·W1~W9), 자동 검토 의견 고친 뒤 PR #17로 main cdff7bc, 와이어프레임 Artifact
metadata:
  type: project
  modified: 2026-11-13T00:32:15.386Z
---

2026-11-13 KST 이 계정이 /corthex 08단계(화면 상태)를 마침. 원본은 siljang.ai `research/cake-screens-2026-11/screens_*.py`, `build_screens.py`가 `docs/08-screens/SCR-0xx.md` 49개·README 표·`wireframes.html`을 생성(생성 파일은 손으로 고치지 않음), `check_screens.py` 검사 15개(`--hub <hub.py>`를 주면 C14까지).

- 결과: 화면 49(손님 13·사장님 32·운영자 4), 상태 336(기본 6 + 화면 고유 16종), 06단계 응답 740행 전수 연결, 와이어프레임 프레임 672(360·1280), 결정 사항 W1~W9.
- 체크포인트: 03:10 결정 카드("화면 정의 49개와 결정 사항 W1~W9를 추천대로 확정할까요?") → 09:13 동희님 '추천대로 확정'. README 11절·stages.json 08 done·Notion 08 행에 원문·시각·장소.
- 합치기: PR #17을 ready로 바꾸자 자동 코드 검토가 P2 2건(09:19): SCR-025 '환불 없음' 0원 입력 규칙, SCR-048 확인된 가게 결과 프레임의 버튼. 둘 다 맞아 고치고 같은 종류(읽기 전용이라 적은 done) SCR-017·021·024·026·027·029도 고침: `f_result` 프레임(폼·버튼 줄 빼고 남긴 값 표시), 0a545e2. 보안 검토는 찾은 것 없음. 리뷰 스레드 해결 표시 뒤 squash로 main cdff7bc(09:27:43). main에서 check_screens 15/15, build_spec 오류 0.
- 와이어프레임 Artifact: https://claude.ai/artifact/YSLmrCtZj6FjYbzs1vsrLP (파일 /home/user/siljang.ai/docs/08-screens/wireframes.html로 버전 2 다시 게시, 같은 경로로 다시 게시해야 같은 주소).
- Notion: 08 기록 행 416bf16cc3ec81f390afc8e14560e86c(제목 '확정, 08단계 마침과 상태 336개'), 결정 사항 W DB ds ac8fa4b9-f29e-42dc-9a89-5d5adcf697d3(9행 확정·판단 '동희님 결정(추천대로)'), 화면 상태 DB ds e1304737-1fcd-4a58-afb1-d6e6016c2f16(49행 정의 상태 확정). 첫 화면 지금과 다음·작업로그·다음 행동 속성 11/13 09:35로 갱신.
- 열린 것: W7 오픈빌더 봇 ID 위치(개발 전 동희님 PC의 실제 화면), OPEN-6 운영자 인증 서비스, SCR-011을 사이트맵 specs에 더할 후보.
- 교훈: 도구 호출에 쓴 한글이 가끔 다른 글자로 바뀜(컬럼→컨럼). Notion에 쓴 뒤 다시 읽어 따로 적은 예상 글과 기계로 대조(scratchpad s08/rows/check_snips.py 방식). README에 '확정 뒤' 같은 말은 C11 금지어(TERM-011 예외 패턴 밖)라 '체크포인트 뒤'로 씀. 자동 코드 검토는 ready로 바꿀 때만 돌고 이후 푸시로는 다시 돌지 않음.

**Why:** 09단계를 하다 스레드나 계정이 바뀌어도 08의 확정 내용과 위치를 바로 찾게.
**How to apply:** 09단계(목업)는 이 화면 정의·와이어프레임을 입력으로 씀. [[cake-handover-back-2026-11-12]] [[service-ax-notion-map]] [[cake-flow-stage03]]
````

### A-10. `kakao-platform-limits.md`

````markdown
---
name: kakao-platform-limits
description: 가게용 봇의 먼저 보내기 제약: 봇 API 1:1 막힘·새 봇 불가·회수 예고라 판매용은 오픈빌더 Event API(채널 친구만, 1건 15원, 11/06 동희님 결정), 카나나와 겹치는 점, 확인 전인 것
metadata:
  type: project
  modified: 2026-11-06T07:34:00.000Z
---

- 콜백 토큰은 1회용·5분이라, 사장님이 [수락]을 누른 뒤 손님에게 가는 확정·전날·후기 안내는 먼저 보내기다. 그래서 예약 요청 때 채널 추가를 안내하고, 친구가 아닌 손님에게는 다시 말을 걸 때 예약 상태를 알린다(1단계). 새 채널로 시작하는 가게에는 매장용 채널 추가 문구와 QR 자리를 드린다.
- 봇 API(A안, 대회 봇) 제약: 채널 친구만(-877), 알림 끈 친구 제외(-879), 하루 1,000건(marong2 marong/kakao.py 주석), 앱 '호출 허용 IP'의 서버에서만. 여기에 11/5 14:30부터 1:1 먼저 보내기가 막혔고(단톡방·답장은 됨) 11/06 콘솔에 봇 메뉴가 없어 새 봇도 못 만든다. 상세는 [[kakao-proactive-block-2026-11]].
- 그래서 판매용 연결은 1단계부터 오픈빌더(B안), 먼저 보내기는 Event API(11/06 15:55 동희님 결정 카드 '오픈빌더 판매, 기존 봇 데모'). Event API: 1건 15원(VAT 별도), 채널 추가 사용자에게만, 한 번에 100명, 광고성이면 (광고)와 8:00~20:50, 비즈니스 인증 채널, 비즈 인증 디벨로퍼스 앱(카카오 로그인 활성화) 연결, 월렛(캐시 최소 1천 원)이 필요하고 개발 채널로 보내도 과금(성공 건만). 개인사업자 대표는 본인 카카오톡 전자증명서로 채널 인증, 식품 등 인허가 업종은 인허가 서류 필수, 사업자번호 없는 개인도 업종별 서류로 심사 신청 가능(서류 확인 전). 스킬은 5초 안에 답해야 해서 콜백과 HTTPS 서버가 필요하다. 콜백은 공개 문서상 신청·심사 없이 '블록 상세 > 더보기 > Callback API 설정'으로 켜고 배포한 운영 채널에서만 시험된다(11/06 16:13 문서, 봇 안 메뉴는 확인 전). 데모·체험의 사장님 알림은 이미 있는 A안 봇과 사장님+봇 단톡방으로 콜백 승인 전에도 할 수 있다(2인 전달 11/6 15:22 확인, @호출 필요, 버튼은 시험 전). 다만 A안 봇은 10/31 사무국 메일로 회수가 예고돼([[kakao-bot-api-contest-only]]) 데모에는 될 때까지만 쓰고 그 위에 새로 만들지 않는다.
- 카나나 상담매니저(카카오, 2025-09-25 정식 출시)는 톡채널 매장 정보로 답하고 주문·예약 요청을 받는다. 카카오비즈니스 채팅 가이드 원문(11/06 PC 확인)의 조건이 "비즈니스 인증 / 챗봇을 사용하지 않는 / 공개 상태인 채널"이라 우리 봇과 한 채널에서 함께 못 쓰고 사장님은 둘 중 하나를 고른다. 요금은 공식 자료에 없음. 그래서 FAQ만으로 팔지 않고 견적·예약금·장부로 판다.
- 확인 전: 사업자 없는 동희님 시험 채널의 비즈니스 인증(등록 전 할 일 26번), 시험 봇에서 콜백 설정이 바로 보이는지(20번, 시험 봇은 동희님이 전략·설계 뒤로 미룸 11/06 16:30), 쓰던 채널에 붙이기. 11/06 동희님 계정의 오픈빌더 봇은 0개. 연결 두 갈래와 알림 방법은 시스템 구조 문서 3·6절.

**Why:** 확정 안내가 모든 손님에게 간다고 약속하면 친구가 아닌 손님과 분쟁이 나고, 예고 없이 바뀐 A안에 유료 고객을 올리면 그대로 멈춘다.
**How to apply:** 먼저 보내는 기능을 약속하거나 만들 때 이 제약을 문구·흐름·월 관리 비용에 넣는다. [[kakao-bot-capability-map]] [[kmong-kakao-bot-product]] [[web-lookup-tools]]
````

### A-11. `kakao-outreach-law.md`

````markdown
---
name: kakao-outreach-law
description: 가게 사장님 영업에서 인스타 DM·카톡으로 먼저 제안하면 안 되는 이유(정보통신망법 제50조)와 매장 방문 우선 방식, 확인 못 한 부분 (2026-11-06 조문 확인)
metadata:
  type: project
  modified: 2026-11-06T04:59:55.822Z
---

11/06 법 조문은 국가법령정보센터, 시행령 제61조는 법령 사본 사이트에서 읽었다. 법률 자문은 아니다.

- 제50조 제1항: 인스타 DM·카톡 같은 전자적 전송매체로 영리 목적 광고성 정보를 보내려면 받는 사람의 명시적 사전 동의가 필요하다. 받는 사람이 가게 사장님(사업자)이면 된다는 예외는 없다.
- 제50조 제3항 오후 9시~오전 8시는 별도 동의, 제4항 전송자 명칭·연락처와 수신 거부 방법 표시. 제50조의7 제1항 남의 홈페이지 광고 게시는 운영자 동의(누구나 쓰는 게시판은 예외).
- 위반은 3천만원 이하 과태료(제76조 제2항 제7호·제8호).
- 매장 방문 대화와 종이 카드는 전자적 전송이 아니라 이 규칙 밖이다.
- 그래서 영업 순서: 매장 방문 1분 → 체험 채널 QR 카드 → 사장님이 채널에 '체험'을 먼저 보냄 → 3일 무료 세팅·라이브 데모. 인스타는 콘텐츠로 먼저 연락이 오게 하고, (광고) 제안은 동의를 받은 뒤 전송자·수신 거부 방법을 붙여 보낸다. 동의 근거는 1분 제안 템플릿(410bf16cc3ec81a79e01fffeb73b562c)의 영업 기록 DB에 남긴다.
- 확인 못 함: 시행령 제61조가 가리키는 별표 6 원문(표시 방법. 지금은 (광고)를 첫머리에 두는 일반 방식), KISA 불법스팸 방지 안내서 7차 개정본(2026-03-04) 본문(PDF 접근이 봇 확인에 막혀 우회하지 않음). 그래서 '동의를 묻는 첫 메시지'와 '먼저 온 문의에 답하며 제안하기'가 광고성 정보인지는 단정하지 않는다.

**Why:** 첫 고객을 찾으려고 DM을 여러 곳에 보내면 과태료 대상이 되고 상품 신뢰도 잃는다.
**How to apply:** 영업 문구나 자동 발송을 만들 때 이 규칙을 먼저 보고, 확인 못 한 항목은 단정하지 않는다. [[kmong-kakao-bot-product]]
````

### A-12. `notion-autolink-gotcha.md`

````markdown
---
name: notion-autolink-gotcha
description: Notion MCP가 prompt.md·bot/app.py 같은 파일 이름을 가짜 http 링크로 바꾸는 문제와 백틱 해결법
metadata:
  type: reference
  modified: 2026-11-06T01:32:41.459Z
---

Notion MCP로 페이지 본문이나 DB 글 속성에 점이 든 파일 이름(`prompt.md`, `bot/app.py`, `multi-user.target` 등)을 그냥 쓰면 [prompt.md](http://prompt.md) 같은 가짜 링크로 저장된다(2026-11-06 확인). 백틱으로 감싸면 코드 서식으로 남고 링크가 되지 않는다(본문과 DB 속성 모두 확인). `.txt`, `.example`은 바뀌지 않았다.

- create-database로 만든 DB는 inline이 아니라서 update-data-source의 is_inline: true로 바꿨다.
- 속성 이름이 url이나 id일 때만 userDefined: 접두사를 붙인다. "링크" 같은 이름에 붙이면 속성을 못 찾는다.

**Why:** 사용자가 읽는 표에 엉뚱한 링크가 생겨 행마다 다시 써야 했다.
**How to apply:** Notion에 파일 경로·설정값을 쓸 때 처음부터 백틱으로 감싸고, 쓴 뒤 rows 모드 조회로 한 번 확인한다. 관련: [[kmong-kakao-bot-product]]
````

## 부록 B. 저장소에 넣지 않은 메모리 13개

개인 일정·지원사업·세금, 동희님 PC의 로그인 상태, 피벗 전 카톡 봇 상품에 관한 것이라 제품 저장소에는 넣지 않았습니다. 원문은 동희님이 따로 주시는 `memory-all.md`에 있습니다. 설명은 이 계정 메모리 목록(`MEMORY.md`)의 줄입니다.

- `ax-talent-war-2026.md`: 조코딩 AX 인재전쟁 11/4 신청 완료, 과제 제출 완료(11/11 동희님 확인), 이후 면접 일정
- `business-registration-timing.md`: PoC는 유료(구축비 15만원+매달 유지비, 11/06 19:12 동희님 결정), 등록 없이 받기(11/07 10:07 동희님 결정), 미등록 가산세, 청창사는 붙으면 받기 추천, 크몽·세금 쟁점
- `check-user-records-first.md`: 동희님께 확인을 부탁하거나 신청을 권하기 전에 메일·PC(Aside CLI·egolight)로 직접 확인
- `kakao-bot-api-contest-only.md`: 봇 API는 AI TOP 100 참가자 전용, 10/31 메일이 삭제·권한 회수 예고, 남는 길은 단톡방 챗봇 제휴뿐
- `kakao-bot-capability-map.md`: 가게용 카톡 AI 상담봇의 기준 코드, 이미 되는 것·만들 것, 약속하지 않는 것
- `kakao-bot-notion-map.md`: 피벗 전 Notion 문서 5개·로드맵 보고서와 그 안 표 ID (참고용)
- `kakao-proactive-block-2026-11.md`: 2026-11-05부터 봇 API 1:1 먼저 보내기 막힘(-876·-880, 단톡방·답장은 아직 됨), 마롱이 PR #9, 11/6 콘솔에 봇 메뉴 없음
- `kmong-kakao-bot-product.md`: 피벗 전 카톡 상담봇 외주(크몽) 대상·옛 가격·수수료, 이어지는 유료 PoC·오픈빌더 결정(상품은 11/07 멈춤)
- `marong-proactive-rooms.md`: 마롱이 선톡은 11/6부터 방 #deaad93a·#7fc76451 두 곳만(1:1 끔, 11/6 19:10 배포), DB는 지우지 않기, 11/6 카카오가 내보낸 일
- `startup-guarantee-loans.md`: 기보 청년 우대 3억 이내·기보·IBK 협약·신보 빌드업·중진공과 중복 보증 규칙(모두 빚)
- `startup-programs-2027-budget.md`: 2027 정부안(9/1)에서 예비창업패키지 예산 '-', 모두의 창업 4,411억·2만 명(국회 확정 전), 예창패 개업일·등록일 기준은 공고에 없음
- `startup-programs-calendar.md`: 예창패(기준일 1/22, 2026 경쟁률 49.4:1)·청창사(3월 말 먼저 확정)·초창패·모두의 창업·스마트상점·AI 바우처의 일정·조건과 서로 막는 관계
- `web-lookup-tools.md`: 인터넷 검색·사이트 확인은 동희님 PC의 Aside CLI나 egolight로 한다(2026-11-06 지시)
