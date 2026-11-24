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
