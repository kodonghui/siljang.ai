# TASK-027 학원컴 평가 경로

현재 실행 환경의 새 두 요청은 연결 시간 초과였다. 같은 시각 학원컴에서 인증 없는 OpenAI 주소의 HTTP 머리를 받아401을 확인했다. 키/잔액/모델 한도로 추정하지 않고, 다른 네트워크 경로에서 같은 평가 코드를 실행할 준비를 한다.

- 학원컴에는 공식 Node22.23.4 배포의 SHA-256을 대조한 실행 파일을 사용자 도구 폴더에 둔다. 앱이 정한 Node22를 그대로 쓴다.
- `bundle.mjs`는 잠금 파일의 esbuild로 평가 CLI와 같은 모듈을 한 파일로 만든다. 생성물은 임시 폴더에 두고 저장소에 넣지 않는다. 로컬 dry-run의134개/111.72원·621.49원이 원래 CLI와 같다.
- `run_native.py`는 기본이 dry-run이며 그때는 키를 읽거나 보내지 않는다. 실제 실행은 `--real`과 이미 있는 OPENAI_API_KEY를 요구한다. 키는 SSH 표준 입력·학원컴의 해당 프로세스 메모리로만 전달하며 파일/명령 인자/출력에 넣지 않는다. 추적 변수/키도 그 프로세스에서 비운다.
- 기존 중간 저장을 읽어 호출/비용/성공 사례를 이어받는다. 요청 간격30초·기존 비용과 여유를 포함한700원 상한·새 실패2회 중단은 같다. 실제 실행 전에 progress.md에 비용을 기록한다. 새 결제/키는 만들지 않는다.
- 공개 코드/합성 중간 결과만 SFTP로 복사하고, SSH 안에서는 코드의 SHA-256을 대조하고 실제 Node 버전을 확인한다. 결과 파일만 돌려받고 임시 폴더를 정리한다. 결과는 아직 모델 품질 통과나134개 완료가 아니다.

실행 예시의 경로는 공개 코드와 합성 중간 결과뿐이다. 생성물/결과는 저장소 밖 임시 경로를 지정한다.

```sh
node research/ai-eval-native-2026-11/bundle.mjs /tmp/siljang-eval-native/eval.mjs
python3 research/ai-eval-native-2026-11/run_native.py \
  --bundle /tmp/siljang-eval-native/eval.mjs \
  --resume-from docs/records/ai-eval/2026-11-23-openai-cooldown \
  --out /tmp/siljang-eval-academy-dry
```

2026-11-23 09:55 KST 학원컴 Node22.23.4의 dry-run은134사례·같은 비용 추정/코드 SHA 대조·CLI0/SSH0을 확인했습니다. 긴 명령의 Windows8191자 제한과 긴 표준 입력 전송을 고쳐 공개 파일은 SFTP로 복사하고 키/실행 설정만 짧은 표준 입력으로 보냅니다. 모의 실행은 키를 보내지 않았습니다.
