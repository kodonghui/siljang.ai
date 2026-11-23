# TASK-027 학원컴 평가 경로

현재 실행 환경의 새 두 요청은 연결 시간 초과였다. 같은 시각 학원컴에서 인증 없는 OpenAI 주소의 HTTP 머리를 받아401을 확인했다. 키/잔액/모델 한도로 추정하지 않고, 다른 네트워크 경로에서 같은 평가 코드를 실행할 준비를 한다.

- 학원컴에는 공식 Node22.23.4 배포의 SHA-256을 대조한 실행 파일을 사용자 도구 폴더에 둔다. 앱이 정한 Node22를 그대로 쓴다.
- `bundle.mjs`는 잠금 파일의 esbuild로 평가 CLI와 같은 모듈을 한 파일로 만든다. 생성물은 임시 폴더에 두고 저장소에 넣지 않는다. 로컬 dry-run의134개/111.72원·621.49원이 원래 CLI와 같다.
- `run_native.py`는 기본이 dry-run이며 그때는 키를 읽거나 보내지 않는다. 실제 실행은 `--real`과 학원컴 프로세스/사용자 환경에 이미 있는 OPENAI_API_KEY를 요구한다. 호출 기기는 키를 읽거나 보내지 않으며 학원컴은 공개 파일을 받기 전에 기존 키의 존재만 확인한다. 값은 학원컴 프로세스 메모리에서만 쓰고 파일/명령 인자/출력에 넣지 않는다. 추적 변수/키도 그 프로세스에서 비운다.
- 기존 중간 저장을 읽어 호출/비용/성공 사례를 이어받는다. 현재 요청 간격60초·기존 비용과 여유를 포함한700원 상한·새 실패2회 중단은 같다. 실제 실행 전에 progress.md에 비용을 기록한다. 새 결제/키는 만들지 않는다.
- 공개 코드/합성 중간 결과만 SFTP로 복사하고, SSH 안에서는 코드의 SHA-256을 대조하고 실제 Node 버전을 확인한다. 결과 파일만 돌려받고 임시 폴더를 정리한다. 결과는 아직 모델 품질 통과나134개 완료가 아니다.

실행 예시의 경로는 공개 코드와 합성 중간 결과뿐이다. 생성물/결과는 저장소 밖 임시 경로를 지정한다.

```sh
node research/ai-eval-native-2026-11/bundle.mjs /tmp/siljang-eval-native/eval.mjs
python3 research/ai-eval-native-2026-11/run_native.py \
  --bundle /tmp/siljang-eval-native/eval.mjs \
  --resume-from docs/records/ai-eval/2026-11-23-openai-academy \
  --out /tmp/siljang-eval-academy-dry
```

2026-11-23 09:55 KST 학원컴 Node22.23.4의 dry-run은134사례·같은 비용 추정/코드 SHA 대조·CLI0/SSH0을 확인했습니다. 긴 명령의 Windows8191자 제한과 긴 표준 입력 전송을 고쳐 공개 파일은 SFTP로 복사하고 키/실행 설정만 짧은 표준 입력으로 보냅니다. 모의 실행은 키를 보내지 않았습니다.

2026-11-23 오전의 학원컴 내부 인증 지침을 앞으로 실행할 평가 경로에도 적용했습니다. 이전09:55/10:02 실행의 전달 방식/비용 원문은 그대로 보존하며 이후 실행은 다른 기기의 키를 전달하지 않습니다. 학원컴에서 키를 가린 출력과 키가 든 결과 파일 거절을 먼저 처리한 뒤 공개 결과만 돌려줍니다. 새 모델 요청이나 키 등록은 하지 않았습니다.

## 인증 경계의 무료 시험

`--native-auth-probe clean`은 학원컴 프로세스에서 합성 표식을 만들고 실제 키와 같은 읽기·출력 가림 분기를 지납니다. `--real`을 붙이지 않으며, CLI의 모의134건을0초 간격으로 실행합니다. 실제 중간 저장은 읽지 않고 결과5개를 반환합니다. `--native-auth-probe artifact-rejection`은 합성 표식을 결과에 넣어 전송 전에 거절하는 거절 시험입니다. 실제 회사 키를 만들거나 모델에 요청하지 않습니다. 실제 평가를 재개하기 전에 두 시험을 먼저 확인합니다.

```sh
python3 -I research/ai-eval-native-2026-11/run_native.py --bundle /tmp/siljang-eval-native/eval.mjs --native-auth-probe clean --out /tmp/siljang-auth-clean
python3 -I research/ai-eval-native-2026-11/run_native.py --bundle /tmp/siljang-eval-native/eval.mjs --native-auth-probe artifact-rejection --out /tmp/siljang-auth-reject
python3 -I research/ai-eval-native-2026-11/test_native_auth.py
```

호출 기기의 모델/Cloudflare 인증 환경 변수는 SSH·SFTP 자식 프로세스에서 제외합니다. 중간 저장은 존재만 확인하고 결과/로그의 문자 인코딩은 UTF-8로 고정합니다. 학원컴 임시 폴더는 이름/부모 확인을 Node/입력 해석보다 먼저 하며 파일 전송 실패에도 자기 폴더만 정리합니다. 숫자가 있는 오류 코드와 실제 중단 이유를 보존합니다.

Windows CI의 `test_native_driver.py`는 공개 평가 코드와 Node22.23.4만 써서 실제 Windows PowerShell로 모의134건/결과5개·표식 가림·파일 거절·Node 부재/버전 오류와 자기 폴더 정리를 실행합니다. Linux에서는 이4개를 건너뛰며 Windows job 성공을 별도로 확인합니다. 이 시험에는 저장소 비밀 값을 전달하지 않습니다.

2026-11-23 12:08~12:11 KST 학원컴의 새 SSH PowerShell은30초 시간 초과,cmd 경로도18초 시간 초과였습니다. 기존 Aside CLI 세션의 SQL 확인은 동작합니다. 원인을 키/요금제로 추정하지 않고 새 SSH 경로만 보류했습니다. 학원컴에서 새 인증 분기의 모의 실행은 아직 통과하지 않았으며 Windows CI 결과와 구분합니다.

2026-11-23 12:37 KST Windows CI137470483614의 실제 PowerShell4개는13.172초/OK입니다. 모의134건/결과5개·표식 가림/파일 거절·Node 부재/버전과 자기 폴더 정리를 확인했습니다. 모의/거절은 실제 키와 실제 모델을 사용하지 않습니다. 실제 학원컴의 새 SSH 경로는 아직 별도 미확인입니다.

2026-11-23 후속: 실제 학원컴 clean 모의134건/결과5개·CLI0/SSH0과 합성 표식 파일의 전송 거절/결과0개를 확인했습니다. 학원컴 기존 키의 모델 목록 읽기도HTTP200/대상 모델 사용 가능=true입니다. 과거401/비용을 보존하고 요청 간격을60초로 늘려 같은 중간 저장/700원·새 실패2회 규칙으로 실제 평가를 이어갑니다. 새 생성 전에 progress.md에 비용을 기록하고 push합니다. 실제 결과를 받을 때까지 완료로 세지 않습니다.
