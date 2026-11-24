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
