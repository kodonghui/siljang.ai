# 합성 화면 확인 자료

학원컴 Aside CLI의 실제 화면 확인용 정적 자료입니다. 로컬에서 빌드해도 브라우저를 실행하지 않습니다. 실제 제품의 컴포넌트와09토큰/폰트·OpenAPI 예시를 묶고 생성된 합성 화면 안에서만 fetch를 가짜 응답으로 바꿉니다. 실제 서비스 페이지에 주입하거나 실제 쓰기를 대신하지 않습니다.

`app`에 고정 의존성을 설치한 뒤 저장소 뿌리에서 다음을 실행합니다.

```sh
node research/screen-checks-2026-11/build-kakao-channel.mjs . /tmp/siljang-qa054-channel
node /tmp/siljang-qa054-channel/server.mjs
```

인자2는 저장소 뿌리, 인자3은 빌드 폴더입니다. 없으면 현재 폴더와 시스템 임시 폴더를 씁니다. 생성된 manifest의 원본 커밋/10상태/계약41행과 헤더 추가2행을 확인합니다. 컴파일 성공을 page-check 통과로 세지 않습니다. `checker.js`는 저장소 tools/corthex/page-check.js를 함수로 감싼 같은 검사이며 원본을 고치지 않습니다.

관찰기는 console.error/window error/unhandled rejection/리소스 실패의 제한된 계수입니다. 전체DevTools 구독이 아니고 observer-selftest에서 가짜 오류/실패 계수를 따로 확인합니다. selftest의 고의 오류는 제품 오류로 합치지 않습니다. 서버는 loopback 임의 포트만 듣고 CSP의connect-src none을 유지합니다. 실제 운영 계정/키/서비스가 필요하지 않습니다.

현재054 실제 학원컴 전달/실행은 접속 복구 뒤 진행합니다. 화면은360/1280한폭씩활성·가시성을확인하고고유snapshot에서조작합니다. D4/KOE의같은브라우저창에대한예약을먼저확인합니다.

할 일 홈은 다음 명령으로 같은 공통 관찰기/서버를 사용해 생성합니다. 실제 App/OwnerArea와 합성7상태/13응답을 묶고 새탭 신원확인4.5초 대기를 제공합니다. QA의 합성 다른 초점 버튼으로 실제 조작을 하며 DOM 초점/타이머를 주입하지 않습니다. 신원 확인 주소 버튼은 유효한limit=19의 경로 이동이고 실제 가시성 복귀 시험과 구분합니다.

```sh
node research/screen-checks-2026-11/build-owner-tasks.mjs . /tmp/siljang-qa087-owner-tasks
node /tmp/siljang-qa087-owner-tasks/server.mjs
```

두 생성기의 Windows 경로는 직렬화해 import에 넣습니다. 할 일 홈의 생성도 Linux/Windows CI에서 확인하며 브라우저는 실행하지 않습니다. 실제 학원컴 전달/화면 결과는 작업별 기록을 따릅니다.

할 일 생성기는 app/web·앱 package/lock·OpenAPI·page-check·이 자료 폴더의 소스 입력이 HEAD와 같은지 생성 전/후에 검사합니다. 변경한 입력이나 아직 커밋하지 않은 입력이 있으면 FIXTURE_SOURCE_CHANGED로 중단하므로 먼저 입력을 커밋합니다. docs/records만 바뀐 상태는 허용합니다. 의존성 설치는 lock을 따릅니다. session-race는 첫 내 정보 뒤 목록 세션이 바뀌는 추가 합성 조건이며 기대 가게 헤더의 거절/재확인을 실제 UI로 확인합니다. 기존 V3는 이 고침 전 자료로 새 확인에 재사용하지 않습니다.

할 일 생성기는 실행한 생성기와 입력 root가 같은 작업 트리인지 realpath로 확인하고 보조 파일도 그 root에서 읽습니다. 출력은 저장소 밖 폴더를 사용합니다. 임시 형제 폴더에 전체를 만든 뒤 원본 검사까지 성공하면 교체하고, 기존 결과는 previousOutput 폴더로 보존합니다. 입력 변경으로 실패하면 이전 번들/manifest는 바뀌지 않습니다. V3/V4는 이 추가 고침 전 준비 자료이며 새 V5를 사용합니다.

할 일 합성 오류는 API002/040의 전체 Problem 예시와 application/problem+json/캐시 금지를 사용합니다. 생성한 응답 코드를 Node VM에서 검사하며 브라우저/실제 서비스 확인과 구분합니다.

운영규정 화면은 다음 명령으로 생성합니다. 실제 OwnerArea/편집기와10상태·15응답을 묶습니다. empty는 미확정 템플릿이고 confirm/submitting/done은 정상 입력/확정 버튼으로 해당 상태에 도달합니다. 이미 학원컴에서 진행하던 V4와 새 로컬 재현 자료 V5를 구분하며, 기존 진행/정지ACK를 읽기 전에 중복 전송하거나 실행하지 않습니다.

```sh
node research/screen-checks-2026-11/build-operating-rules.mjs . /tmp/siljang-qa051-operating-rules
node /tmp/siljang-qa051-operating-rules/server.mjs
```

운영규정 생성물의 저장 결과는 제출한 값으로 결정합니다. 현재 값 그대로면200/unchanged,유효한 변경이면201/created이며 done/unchanged 선택 이름으로 결과를 강제하지 않습니다. 오류의 Problem 본문/미디어 유형은 OpenAPI 예시를 사용하고 응답에는 입력 전용 필드를 넣지 않습니다. operating-rules-fixture.test.mjs는 실제 웹 양식의 요청과 생성된 응답 코드를 Node VM에서 대조하며 브라우저를 실행하지 않습니다.

운영규정 생성기도 fixture-source의 동일 작업 트리/깨끗한 입력/임시 완성 후 교체를 사용합니다. 기존 출력은 previousOutput으로 보관하며 새 V7의 로컬 컴파일/계약 검사는 실제 학원컴 화면 성공과 구분합니다.

운영규정 이력은 `node research/screen-checks-2026-11/build-operating-rules-history.mjs . /tmp/siljang-qa052-rules-history`로 생성합니다. 실제 OwnerArea/VersionHistory와 현재 API022/023의9응답·5상태를 묶습니다. 같은 원본/깨끗한 입력/임시 완성 후 교체와 이전 출력 보관을 사용합니다. 실제 브라우저·초점·사진 성공은 별도이며 새 V8은 기존 학원컴 V6의 원문/지시 수신/정지ACK를 수집하기 전 중복 전달하지 않습니다.

결제 수단 자료는 `node research/screen-checks-2026-11/build-payment-destination.mjs . /tmp/siljang-qa053-payment-destination`로 만듭니다. 실제 OwnerArea/결제 수단 편집기와 API024/025의16응답·요청 키 누락 추가1행/10상태를 묶습니다. 같은 원본/깨끗한 입력·임시 완성 후 교체와 옛 출력 보관을 사용하며 실제 금융기관에 연결하지 않습니다. 같은 값은 unchanged이고 다른 합성 예금주로 실제 입력/저장하면 확인 창이 나옵니다. 초기 실제 임시 자료의 원문/받은 지시·정지ACK를 먼저 수집하고 고친 V3를 중복 전송하지 않습니다.

채널 생성기도 실행/입력 저장소·깨끗한 HEAD를 확인하고 같은 원본의 보조 파일을 읽으며 임시 폴더에 완성한 뒤 교체합니다. 이전 출력은 previousOutput으로 보존합니다.43응답(화면41행/요청 키 헤더 추가2행)의 오류는 전체 OpenAPI Problem 예시와 올바른 미디어 유형/no-store를 보존합니다. 과거 V3는 이 고침 전 준비 자료이며 새 V5는 실제 전송/브라우저 성공과 구분합니다.

공통 원본 검사는 웹이 상속하는 app/tsconfig.base.json도 포함합니다. 실제 시험용 Git 사본에도 상속 설정을 함께 넣어 미커밋 클래스 필드 설정으로 번들이 달라지면 기존 SHA를 붙이지 않도록 검사합니다. 채널 자료의 지원하지 않는 기본404는 query를 뺀 실제 요청 경로를 instance에 넣습니다.

예약 링크 자료는 `node research/screen-checks-2026-11/build-booking-link.mjs . /tmp/siljang-qa055-booking-link`로 생성합니다. 실제 OwnerArea/BookingLinkScreen과6상태/5응답·재조회 실패/준비 상태 변경을 묶습니다. 미충족 조건의 각 설정 화면은 해당 상태의 진입 조회를 제공하며 저장은 해당 TASK 자료에서 확인합니다. 발급 주소는 예약된 .example 도메인이고 실제 발급 주소/도착 화면은 자기 가게 실환경 확인으로 구분합니다. 같은 원본/완성 뒤 교체를 사용하며 공통 상속 설정 고침을 PR266 main에서 통합했고 최종 검사를 이어갑니다.

상담 대화 자료는 `node research/screen-checks-2026-11/build-consultation-messages.mjs . /tmp/siljang-qa089-consultation-messages`로 만듭니다. 실제 App/OwnerArea/상담 화면과 API043의7응답·6상태를 준비합니다. 사장님 답·지운 상담·100,000자 글·사진 창/만료·이전 페이지 실패/재시도를 합성 응답으로 확인할 수 있습니다. 두 폭360/1280은 학원컴 Aside에서 직접 걸어야 하며 생성 성공은 page-check나 실제 브라우저 통과가 아닙니다. 원래 계약 예시/가게 기대값·업무 쓰기 차단은 Node VM에서 검사하고 Linux/Windows CI는 CLI 생성까지만 실행합니다. 같은 원본·완성 뒤 교체/기존 출력 보관과 공통 관찰기/CSP를 사용하며, 실제 서비스 자료나 키가 필요하지 않습니다.
