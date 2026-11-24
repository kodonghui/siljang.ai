# TASK-032 실제 등록/조회와 끝남 대조

main247 4be0f0b0f96f008414ca4441b274b67ac8f4152a의 검증한 제품과 기존 API-008/009 수락 대조를 기준으로 합니다. 제품 app/server·app/web·db·tools는 그 main과 차이0입니다. 기록 번호는 README356·fix-log648입니다.

| 조건 | 자동 시험과 실제 근거 |
| --- | --- |
| SPEC-002 #1~4 | 기존 task-032-acceptance.md의 정상 등록·동의 거절·신고 기관/사진 누락과 범위/형식 대조를 유지합니다. 현재 main247 전체2562개에도 포함됩니다. |
| API-008 201/401/409/422/503/default | 기존 응답별 시험의 원자성·중복/재전송·입력·저장소 실패와 복구를 대조합니다. 실제 합성 업로드/등록 UI는 각각1회이며 두 POST 상태는 직접 관찰하지 않았습니다. 관찰하지 않은201을 실제 결과로 쓰지 않습니다. |
| API-009 200/401/404/default | 자기 가게·서명·내부 오류의 기존 응답별 시험을 유지합니다. 실제 등록 전 내 가게404, 등록 뒤 내 정보/내 가게200·합성 가게·신고 확인 대기·예약 링크 미발급을 관찰했습니다. |
| 실제 사진 읽기/15분 만료/새 조회 | 자기 합성 신고증의 새 주소200·이미지/양수 바이트를 확인했습니다. 같은 원래 문자열을 메모리에 유지한 별도 실행에서 자연 만료 뒤 캐시를 우회한 GET404 not_found, 가게200에서 새로 받은 다른 주소200·이미지/양수 바이트를 확인했습니다. 시계·exp·서명을 바꾸지 않았습니다. |
| 실제 등록 뒤 현행 이동 화면 | 별도 /owner에서 현행 코드의 제목·준비 문구·로그아웃을 확인했고 자기 가게200도 유지됩니다. 당시 미확인이던 현행 착지를 확인한 것입니다. 새 대시보드 기능이나 TASK-046 전체 화면 상태를 완료했다고 하지 않습니다. |
| 실제 서버 역할/권한 | 기존 등록 열/조회 권한 대조와 main243 일반 역할 점검의 허용 쓰기·금지5건/복구를 유지합니다. 현재 실제 앱의 등록과 자기 조회는 추가 업무 성공 근거입니다. 일반 역할 점검을 모든 다른 업무의 성공으로 확대하지 않습니다. |

## 원본과 범위

네 JSON은 학원컴 Aside CLI가 만든 안전한 메타데이터를 원문 그대로 복사했고 아래 SHA256을 대조했습니다. 계정/가게ID·키·쿠키·서명주소/쿼리·사진/응답본문은 저장하지 않았습니다. 등록 원본의 당시 사진/대시보드 미확인은 역사로 보존하고 이후 사진/현행착지 결과를 별도로 연결합니다.

- registration-result.json: `a9424466f67cd2c7e1796a633a0c7924d0ce8175bf107ca259e6f75a18cff5e4`
- photo-readback-result.json: `0d9e8cfc1fb4cd6307f3da13dfa1915d114a18afe5542c334a878b99145c49fd`
- photo-natural-expiry-result.json: `b5c31c631fd4fe7bd55ec016733af61d30d32f0719b688061080f716438aa6f7`
- owner-landing-result.json: `f632db65eedc5ca6a7ba3cf17ae8593355e2bd3db7bd1efc9d2d2a43b10ed223`

처음 만료 시도는 원래 주소가 현재 REPL에 없어 null로 기록했고 통과로 세지 않았습니다. 이어 같은 실행 흐름에 새 주소를 유지해23:24:19 KST 만료 뒤23:25:09에404를 확인했습니다. 자연 만료 원본의 previousAttemptReason도 보존했습니다.

## 현재 main의 실제 검사

check138509315540 로그에서 다음 줄을 그대로 옮겼습니다. 이 문서 변경에서 npm ci/전체 시험을 새로 돌렸다고 적지 않습니다. 현재 PR의 head app/db CI와 형식 다음 엄격lint·WBS/키/용어는 별도로 확인합니다.

```text
added 161 packages in 7s
Test Files  126 passed (126)
Tests  2562 passed (2562)
Test Files  65 passed (65)
Tests  1570 passed (1570)
✓ built in 541ms
```

main247 app45412371673·db45412371472·실제배포138512299817·전체 태그/활성100%/health200·원격SHA와 별도 앱 네이티브 조회는 main247-deployment.json에 보존합니다. 이 main 보조 Worker의 별도 태그 재조회는 미확인입니다. TASK-032 자체의 등록/조회/사진과 현행착지는 확인했으므로 finished로 옮깁니다. TASK-046의 전체 상태·다른 준비 API와 운영 MVP 스모크는 각 작업에서 확인합니다. 새 등록을 중복 생성하지 않습니다.

## 상태 기록의 단계 검사

`bash tools/stage-checks.sh task032-finished --no-api --no-browser`의 실제 결과입니다. API/화면 제품을 바꾸지 않아 새 계약 서버/브라우저 페이지 검사는 생략했으며 미확인을 통과로 세지 않습니다.

```text
prd exit=0 :: PROBLEMS 0 · AVOIDED WORDS 0
flows exit=0 :: PROBLEMS 0 · AVOIDED WORDS 0
spec exit=0 :: 오류 0
erd exit=0 :: 검사 15개: 통과 10, 실패 0, 미확인 5
api skipped (--no-api)
sitemap exit=0 :: 검사 17개: 통과 17, 실패 0, 미확인 0
screens exit=0 :: 검사 15개: 통과 15, 실패 0, 미확인 0
mockup browser skipped (--no-browser); page-check remains unverified
mockup exit=0 :: 검사 14개: 통과 13, 실패 0, 미확인 1
wbs exit=0 :: 검사 18개 · 오류 0
```

제안 상태는 끝남32·구현 완료30·MVP 시작 가능36·전체 의존 충족40입니다. 현재 원격main은31/31이며 이 PR의 CI/검토/병합 뒤에만 원격의 끝남 수로 셉니다.
