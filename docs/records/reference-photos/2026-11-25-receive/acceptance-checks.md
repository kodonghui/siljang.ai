# TASK-065 참고 사진 수신의 현재 수락

## 남은 것

- [x] API070 참고 사진·큐/콜백·다음 대화, 중복1회·10장/20MiB·AI0
- [x] API072 보안 이미지 플러그인·받은 자기 주문·G10/동의 기본 거절·부분 저장0·첫 실패 반복
- [x] 최소 서버 역할/기존 글 권한 호환·중단 파일 회수·동시 장수·기한·이전 카드 결과
- [x] API070/072의200·401·422·default와 형식/엄격lint·타입·비밀 값·용어/WBS
- [x] 새 빈40개 이행 전체/빌드 재검사
- [ ] 공개 전체SHA 직접 단계(API 포함)
- [ ] 현재 app/db CI·코드/보안 검토·수동 한 번·squash 뒤 main CI/배포·전체태그/활성100%/health200·원격SHA
- [ ] 실제0040/추가 권한 적용·합성 사진/저장소·Workers CPU/메모리·PC 카카오 왕복

## 끝난 조건 대조

| 조건 | 현재 근거 |
| --- | --- |
| SPEC019 #1 | kakao-reference-photo의 두 수신→같은 활성 초안/두 사진·revision3·모델0. G10 뒤 바이트만 저장 |
| API070 응답별/사진 결과 | kakao-http-contract의 공통 네 HTTP 응답, reference-photo의 photo_received/photo_rejected/실패 안내·콜백/재전달 |
| API072 응답별/내려받기 실패 | 같은 공통 HTTP 응답, kakao-review-dedup의2회503→photo_download_failed·글 후기0/반복 첫 실패·권한 전 내려받기0 |
| A11 | 열한 번째 선 거절·아홉 장 뒤 두 큐가 겹쳐도10장/추가 내려받기1회, 바이트20MiB는 photo-download와 기존 photo-normalizer |
| G10 | 공통 bytes 경로를 사용. 참고/후기 수신의 메타데이터 있는 PNG가 정리된 바이트로만 저장. 형식/헤더 위장·크기·리다이렉트는 download 회귀 |
| 반복/전달 | 같은 수신/큐에 붙이기1회, 콜백 실패 뒤 다음 대화1회,55초 만료는 모델/에스컬레이션 없이 재전송 안내, 이전 카드가 있으면 card_shown도 기록 |
| 지우기/권한 | S3 PUT 취소 전달/이미 취소한 요청0, 원격 저장 뒤 오류의 회수 대기·기한 뒤 삭제. 제한 역할에서 두 수신 성공·기존 글 호환·사진 삭제/후기 본문 수정 권한 없음 |

## 구현 경계

일반 사진의 주소는 DEC28대로 utterance의 주소 하나에서 받습니다. 허용한 카카오 HTTPS와 실제 이미지 형식을 확인하고 네트워크 실패만 한 번 다시 받습니다. 주소를 본문/로그/AI에 넣지 않습니다. 수신 문맥은 별도 messages.kakao_photo 용도로 가게와 메시지 UUID에 묶고20KiB까지 암호화합니다. 일반 필드와 기존 콜백은256바이트입니다. 큐에는 가게/메시지 ID만 보냅니다. 사진은 순차 처리하고 올린 뒤에는 저장 키/종류/크기만 보관합니다. 이것은 실제 Workers CPU/메모리 측정 성공을 뜻하지 않습니다.

기존55초 선점과 암호문 보관 열을 재사용합니다. 준비 중에는 기존 CHECK에 맞춰 text로 두고,끝낼 때 암호문을 지우며 참고 사진은 photo/후기는 card로 바꿉니다. 서버 전용 후기 표식을 분당 일반 메시지 수에서 제외합니다. 큐/콜백이 없는 참고 사진과 API072는4초 작업 한도 안에서 처리하며,콜백 가능한 참고 사진은 먼저 응답한 뒤 큐에서 처리합니다.

API072의 privacyAgreement는 카카오의 사진 받기 허용이며 사진 게시 동의와 구분합니다. 받은 자기 주문을 먼저 확인하고5장/주소 만료10분을 검사합니다. 성공한 글/사진/각 동의를 함께 남기며 기본 게시 동의는 거절입니다. 부분 실패면 글 후기만 성공으로 남기지 않습니다. 반복은 첫 실패도 보존하고 진행 중인 중복에 저장됐다고 답하지 않습니다. 실제 후기 요청·게시/철회·전체 화면의 수락은 TASK143/145 등 후속 작업에 남습니다.

중단 회수는 PUT 전에 기존 file_deletions에 기한 뒤 시각을 기록하고,성공한 사진 연결과 함께 대기를 지웁니다.0040은 이 대기의 review_photo 종류만 더합니다. 기존 글 후기는 사진용 추가 열 권한을 적용하기 전에도 원래 열 권한으로 처리합니다. 사진의 실제 역할 적용은 별도 남음입니다.

## 검사 원본

[수신/검토 고침](receive-checks.json)과 [기존 내려받기 검사](download-checks.json)에 원본과 명령/범위를 보존했습니다. 현재 코드4054d118d82cb785e6903ca933051a895a70527d의13파일246개는 기존39개 이행 시험DB 위에0040만 적용한 결과입니다. 새 빈DB 전체와 혼동하지 않습니다. 첫 새 전체의 이행 합성3실패2761통과는 BEGIN/COMMIT을 고쳐 해결했고 두 번째 새40개 전체/빌드는 서버2764·웹1727/Vite640ms·두 Worker 모두0이며 시험DB 정리를 마쳤습니다. 같은 lock 설치를 재사용했으며 새 로컬 npm ci가 아닙니다. 최종 공개 CI가 설치부터 재확인합니다.

관련 명령(app): `npm exec -w server -- vitest run test/staging-db-update.test.ts test/kakao-photo-permissions.test.ts test/kakao-review-dedup.test.ts test/kakao-reference-photo.test.ts test/kakao-photo-context.test.ts test/kakao-photo-download.test.ts test/field-crypto.test.ts test/kakao-callback.test.ts test/kakao-deferred.test.ts test/shop-scope-static.test.ts test/storage.test.ts test/purge-files.test.ts test/kakao-http-contract.test.ts`.

[부모 main274 실제 배포](main274-deployment.json)는 확인했습니다. 학원컴 SSH의 두 외부 실패 뒤 실제 화면 확인만 보류하며 복구 증거가 있으면 기존 D4 진행/받은 지시·대기열·정지ACK부터 읽습니다. 브라우저는 학원컴 Aside CLI만 사용합니다. 실제 모델/카카오/브라우저·메일·결제0이며 TASK065 실환경 남음 행은 구현 완료 제안이며 자기 CI/리뷰·병합/main 확인 뒤 확정합니다. finished는 늘리지 않습니다.

## 최종 전체 검사

최종 코드 4054d118d82cb785e6903ca933051a895a70527d의 두 번째 새 빈40개 이행에서 서버139파일2764개·웹71파일1727개와 Vite640ms/두 Worker가 모두 종료0이며 시험DB 정리도 마쳤습니다. 이후 변경은 기록/작업표 생성 문서뿐이고 제품/시험·API/DB/권한 파일 차이0입니다. 관련13파일246개/타입·엄격lint0,이행 합성의 첫3실패2761통과와 고침 원본을 함께 보존했습니다. 같은 lock 설치를 재사용했으며 새 로컬 npm ci로 쓰지 않습니다.

TASK065의 자체 수락 대조를 마치고 실환경 남음 행을 구현 완료 제안으로 더했습니다. 자기 최종 공개 API 단계/현재 app·db CI·코드/보안 검토·수동 한 번과 squash 뒤 main CI/실제 배포·전체태그/활성100%/health200·원격SHA를 확인한 뒤 확정합니다. 실제0040/추가 권한 적용·합성 참고/후기 사진과S3·Workers CPU/메모리·PC 왕복은 미확인이고 finished를 늘리지 않습니다. 모델/카카오/브라우저·결제0과 학원컴 Aside CLI만 사용을 유지합니다. 다음은 준비 PR의 공개 API 단계와 현재 CI/검토·자기 main입니다.

```text
마이그레이션 40개를 차례로 적용함
 Test Files  139 passed (139)
      Tests  2764 passed (2764)
 Test Files  71 passed (71)
      Tests  1727 passed (1727)
✓ built in 640ms
Total Upload: 5425.44 KiB / gzip: 995.97 KiB
--dry-run: exiting now.
Total Upload: 21.08 KiB / gzip: 6.55 KiB
--dry-run: exiting now.
```
