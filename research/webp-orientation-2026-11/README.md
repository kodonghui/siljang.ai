# WebP 방향과 Workers 한도 확인

TASK-183의 서버 회전 후보를 앱에 넣기 전에 검증한다. 사람 사진 없이 합성 사진만 쓴다.

- 기존 결과: 작은 정적·큰 해상도의 작은 압축 파일·두 프레임 애니메이션의 90도 회전은 Wrangler 원격 미리보기에서 통과했다. 큰 압축 파일과 방향 전체·CPU·메모리는 확인하지 않았다(앱 README 116).
- 이번 범위: 방향 2~8, 알파·프레임·시간·반복, 10·20MiB 입력, 큰 해상도와 여러 프레임을 확인한다. 자원 측정의 방법·범위와 한계를 결과에 함께 쓴다.
- 공식 문서 확인(2026-11-21): Images 바인딩은 `.transform()` 호출 순서로 변환을 적용하고 `.output({format, quality, anim})`으로 내보낸다. 로컬 개발의 바인딩 사용에는 사용 요금을 부과하지 않는다고 안내한다. 원격 고정밀 버전은 `wrangler dev --remote`로 확인한다. 실제 배포의 무료 플랜은 월 고유 변환 5,000건을 넘기면 새 변환을 오류로 막고 초과 과금하지 않는다고 안내한다. 유료 플랜 전환은 하지 않는다.
- 현재 앱 통합 후보는 공통 photo-normalizer와 API-007 저장 전 호출·카카오 HTTP 스트림 입력까지 구현했다. 실제 픽셀·촬영 정보·알파/애니메이션과 Chromium 검증은 통과했으나 Workers CPU·최대 메모리는 아직 측정하지 못했다. 자원 한도 증거가 남아 TASK-183은 완료로 세지 않는다. 실패가 두 번 반복되면 그 실행만 멈추고 결과와 다음 단계를 보존한다.

출처:

- [Images 바인딩](https://developers.cloudflare.com/images/optimization/binding/)
- [Images 가격](https://developers.cloudflare.com/images/pricing/)
- [Workers 한도](https://developers.cloudflare.com/workers/platform/limits/)

## 2026-11-21 실행 결과

- Pillow 13.0.0으로 방향 1~8의 정적·3프레임, 4,000×3,000 해상도, 정확히 10·20MiB인 잡음·메타데이터 포함 입력, 40프레임 등 20개를 만들었다. 입력은 저장소에 넣지 않고 실행 중 생성한다.
- Wrangler 4.158.0의 `dev --remote`에서 첫 방향 6 입력(602바이트)이 HTTP 500, ProxyWorker의 Network connection lost로 실패했다.
- 공식 안내의 다른 방식인 로컬 `dev`와 `images.remote=true`로 바꾸어 같은 입력을 확인했지만 HTTP 500, Images 바인딩의 Network connection lost로 실패했다. 두 번째 실패 뒤 프로세스를 종료했다.
- 이미지 결과를 받지 못했다. 방향·촬영 정보·알파·프레임 보존은 미확인이고 CPU 시간·최대 Worker 메모리도 미측정이다. 후보의 처리 실패나 한도 초과라고 단정하지 않는다. HTTP 응답 시간을 CPU 시간으로 쓰지 않는다.
- 독립 검사기가 원본을 그대로 받은 경우 촬영 정보 남음을 검출하는 것은 로컬에서 확인했다. 이는 원격 변환 성공의 증거가 아니다. 앱의 바인딩·공통 모듈·수신 경로는 바꾸지 않았고 TASK-183은 미완료다.
- [합성 입력 목록](manifest.json), [실행 결과](results.json).

## 다시 실행하기

연결 조건이 회복된 뒤에 실행한다. 지금 같은 조건에서 원격 호출을 반복하지 않는다.

```sh
python3 research/webp-orientation-2026-11/fixtures.py /tmp/siljang-webp-validation/input
cd app
npx --no-install wrangler dev --config ../research/webp-orientation-2026-11/wrangler.jsonc --port 8793 --inspector-port 9233
```

다른 셸에서 저장소 루트를 기준으로 검사한다. 첫 사례가 성공한 뒤 `--name still-6`를 빼서 전체를 검사한다. 실패하면 부분 결과를 남기고 즉시 끝난다.

```sh
python3 research/webp-orientation-2026-11/check.py /tmp/siljang-webp-validation/input --name still-6 --report /tmp/siljang-webp-validation/report.json
```

독립 디코더는 픽셀 방향·알파 전체·모서리 색·프레임 수·시간·반복과 촬영 정보 제거를 본다. RGB는 재인코딩을 고려해 표식 중심의 채널 차 16까지 허용한다. 실제 앱 통합 전에는 Worker CPU·메모리와 Chromium의 표시 방향도 별도로 확인해야 한다.

## 2026-11-22 학원컴 원격 미리보기 첫 결과

- 기존 Linux 프록시 실패를 반복하지 않고 정상 Cloudflare 연결을 확인한 학원컴 Wrangler4.158에서 실행했다. 첫 실행은 SSH255로 공급자 응답을 받지 못했다. 공개 파일을 먼저 복사하고 비밀 값은 작은 프로세스 입력으로만 전달한 실행은 정상 준비·HTTP200이었다. 첫 실패의 원인을 이미지 처리 오류로 단정하지 않는다.
- 방향6 합성 입력602바이트가 출력104바이트·96×160으로 바뀌었다. HTTP 전체 시간409ms이며 CPU 시간이 아니다. 기존 독립 Pillow 검사9개가 모두 참이다(촬영 정보 제거·원본 촬영 정보 검출·방향·알파·모서리 색·프레임·시간·반복·WebP).
- CPU 시간과 최대 Worker 메모리는 미측정이고 나머지19개와 Chromium 표시도 아직 확인 전이다. 앱 수신 경로는 바꾸지 않았다. [실제 실행과 독립 검사 결과](windows-preview-2026-11-22.json)

## 2026-11-22 방향 전체·큰 입력·애니메이션 결과

- 원격 미리보기와 루프백 전달을 연결한 검사는 첫 요청이403이어서 중단했다. 이미지 결과를 받지 못했으며 자기 프로세스 트리는 종료 코드0으로 정리했다. 그 경로를 반복하지 않고 이미 성공한 학원컴의 Node 직접 요청으로 각 결과를 받아 독립 검사했다.
- 합성20개 모두 HTTP200이고 독립 검사9개가 전부 참이다. 정적/애니메이션 방향1~8,4,000×3,000,정확히10/20MiB,40프레임을 포함한다. 촬영 정보·픽셀 방향·알파·모서리 색·프레임 수·시간·반복을 확인했다. HTTP 전체243~10,098ms이며 CPU 시간이 아니다.
- 원격 미리보기는 종료했고 앱 수신 경로는 아직 바꾸지 않았다. 실제 Workers CPU/메모리 한도와 Chromium 표시는 이어 확인한다. [전체 실제 결과](windows-matrix-2026-11-22.json)

## 2026-11-22 공통 모듈·Chromium·자원 측정 상태

- 공통 모듈은 WebP 방향2~8에서만 Images를 호출한다. 외부로 보내기 전 위치·기기·촬영 시각·XMP를 제거하고 방향 태그 하나만 남긴다. 결과도 다시 정리하고 정상 WebP·방향1을 확인한다. 변환 실패·잘못된 출력·20MiB 초과 결과는 원본을 저장하지 않는다. API-007은 용도별 입력/출력 크기와 형식도 확인한다. JPEG·PNG·HEIC의 기존 방향 속성은 유지한다.
- 같은 모듈의 fromBytes와 fromStream은 각각 사장님 업로드와 카카오 다운로드 응답을 받는다. 실제 카카오 업무 다운로드는 TASK-065·139·145에서 호출해야 한다. 진짜 채널 사진의 촬영 정보 유무는 아직 확인하지 않았다. 채널 연결 뒤 위치·기기·시각을 넣은 시험 사진을 보내고 저장소 파일을 독립 파서로 읽어 촬영 정보0개와 표시 방향을 확인한다. 실제 사진·원본 메타데이터를 기록이나 PR에 올리지 않는다.
- Chromium151.0.7922.34의 HTMLImageElement.decode와 canvas에서 합성20개 출력의 실제 표시 크기·방향별 모서리 색/알파가 모두 맞았다. 애니메이션의 첫 프레임을 검사하며 전체 프레임/시간/반복은 별도 Pillow 검사20개가 확인한다. [Chromium 실제 결과](chromium-2026-11-22.json)
- runtime-probe.ts는 실제 createUpload와 공통 스트림 입력을 자원 측정에 쓰도록 묶었다. 인증은 고정 합성 사장님, 저장소는 요청별 메모리 목(mock)이며 실제 DB·S3·로그인·카카오 다운로드 검증이 아니다. 별도 PROBE_TOKEN이 없으면401이고 실제 업무 바인딩은 없다. 구성 파일과 소스는 보존하지만 실행 성공으로 판단하지 않는다.
- 첫 원격 실행은 준비 스크립트의 치환이 환경 변수 이름까지 바꾼 구문 오류여서 Worker를 호출하지 않았다. 치환 범위를 고친 실행은 Wrangler deploy에서 API10007로 중단했다. 공식 설명은 Worker 또는 workers.dev 하위 도메인을 찾을 수 없다는 뜻이며 Images 기능이나 CPU/메모리 초과로 단정하지 않는다. 같은 새 Worker 배포 방식을 더 반복하지 않는다. 자기 Worker 삭제 종료0을 확인했다.
- HTTP 전체 시간은 CPU 시간이 아니다. 무료 Workers의 CPU10ms·메모리128MB와 비교하려면 같은 처리 코드의 실제 CPU/메모리 계측이 더 필요하다. 원격 미리보기의 성공이나 플랫폼의 일시적 CPU 여유를 엄격한10ms 준수로 세지 않는다. 요금제를 바꾸지 않았으며 TASK-183 완료 표시는 보류한다.

- 읽기 전용 GraphQL 스키마에서 CPU 분위수의 단위가 마이크로초이고 메모리 분위수의 단위가 바이트임을 확인했다. 과거 미리보기 이름으로 조회한 결과는0건이어서 사진의 CPU·메모리 측정으로 쓸 수 없다. P99/P999는 최대 사용량과도 다르다. 자기 검증 폴더2개 없음·자기 Node0·Worker 메타데이터404를 별도로 확인했다. [자원 검사 시도와 정리 결과](runtime-attempt-2026-11-22.json)

Chromium 검사는 위 원격 실행의 출력 폴더를 사용한다. Pillow13과 실행 환경에 설치된 Playwright/Chromium이 필요하며 PLAYWRIGHT_MODULE로 기존 Playwright 모듈 경로를 지정할 수도 있다.

```sh
python3 research/webp-orientation-2026-11/prepare-browser.py /tmp/siljang-webp-validation/input /tmp/siljang-webp-validation/expected.json
node research/webp-orientation-2026-11/chromium-check.mjs /tmp/siljang-webp-validation/output /tmp/siljang-webp-validation/expected.json /tmp/siljang-webp-validation/chromium.json
```
