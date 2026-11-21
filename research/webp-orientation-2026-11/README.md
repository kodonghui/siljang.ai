# WebP 방향과 Workers 한도 확인

TASK-183의 서버 회전 후보를 앱에 넣기 전에 검증한다. 사람 사진 없이 합성 사진만 쓴다.

- 기존 결과: 작은 정적·큰 해상도의 작은 압축 파일·두 프레임 애니메이션의 90도 회전은 Wrangler 원격 미리보기에서 통과했다. 큰 압축 파일과 방향 전체·CPU·메모리는 확인하지 않았다(앱 README 116).
- 이번 범위: 방향 2~8, 알파·프레임·시간·반복, 10·20MiB 입력, 큰 해상도와 여러 프레임을 확인한다. 자원 측정의 방법·범위와 한계를 결과에 함께 쓴다.
- 공식 문서 확인(2026-11-21): Images 바인딩은 `.transform()` 호출 순서로 변환을 적용하고 `.output({format, quality, anim})`으로 내보낸다. 로컬 개발의 바인딩 사용에는 사용 요금을 부과하지 않는다고 안내한다. 원격 고정밀 버전은 `wrangler dev --remote`로 확인한다. 실제 배포의 무료 플랜은 월 고유 변환 5,000건을 넘기면 새 변환을 오류로 막고 초과 과금하지 않는다고 안내한다. 유료 플랜 전환은 하지 않는다.
- 앱 통합: 아직 하지 않는다. 서버의 픽셀 방향, 촬영 정보 제거, 브라우저 표시, Workers 한도 증거를 먼저 확인한다. 실패가 두 번 반복되면 그 실행만 멈추고 결과와 다음 단계를 보존한다.

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
