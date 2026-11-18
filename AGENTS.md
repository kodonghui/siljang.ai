# AGENTS.md: siljang.ai 개발 에이전트 안내

이 저장소에서 11단계 개발을 맡은 코딩 에이전트(Codex 등)가 먼저 읽는 파일이다. 직접 해보기 세션(B, 다른 계정의 Claude)은 이 파일이 아니라 자기 프롬프트를 따른다.

- **전체 지침:** [docs/handover/codex-development.md](docs/handover/codex-development.md)를 작업을 시작하기 전에 처음부터 끝까지 읽는다. 이 파일은 그 요약이고, 다르면 지침이 우선한다.
- **지금 기록:** [docs/records/progress.md](docs/records/progress.md) 맨 위 단락, [docs/records/fix-log.md](docs/records/fix-log.md) 끝, [app/README.md](app/README.md)의 번호 항목.

## 요약

1. **기준.** 동희님(제품 책임자)의 결정 사항과 01~10단계 설계 문서가 기준이다. 설계를 새로 하지 않는다. 제품 결정이 필요하면 추천안과 함께 확인 요청을 하고, 그 부분만 열린 질문으로 둔다.
2. **작업 단위.** WBS(`docs/10-wbs/wbs.md`)의 작업 하나를 PR 하나로 한다.
   - 브랜치는 `codex/task-<번호>-<짧은-영문>`이다.
   - `main`, `claude/*`, `hands-on/*` 브랜치에는 push하지 않는다.
3. **차례.** 원본을 읽고, 실패하는 시험부터 쓰고, 구현한다. 커밋과 push는 일찍, 자주 한다.
4. **생성 파일.** 손으로 고치지 않고 각 단계의 생성기로만 고친다(지침 7절).
5. **진짜 환경.** 진짜 계정·키·카카오·휴대폰·유료 AI 호출은 0번이다. 그런 확인은 README에 '직접 해보기 남음'과 따라 할 방법으로 적는다. 그 확인이 끝난 조건에 있으면 끝남 표시를 하지 않는다.
6. **남기지 않는 것.** 비밀 값, 실제 이메일(시험은 `example` 도메인만), 계정 ID, AI 모델 이름을 파일·커밋·PR·로그에 넣지 않는다. GitHub 댓글을 쓰지 않는다.
7. **B 몫 파일.** `docs/records/hands-on.md`, `research/platform-test-2026-11/`, `docs/records/ai-eval/`은 만들거나 고치지 않는다. B가 'A에게 넘김' 표에 적은 개발 일은 네 몫이다.
8. **검사.** 결과 줄을 PR 본문에 그대로 옮긴다. 못 돌린 검사는 '미실행'과 이유를 적는다.
   - `app/`에서 `npm ci && npm run lint && npm run typecheck && npm test && npm run build`
   - `bash tools/stage-checks.sh <이름>`(설계 문서를 바꾼 PR)
   - `python3 -I research/cake-wbs-2026-11/build_wbs.py .`
   - `node tools/check-no-keys.mjs --repo`
   - `python3 -I tools/corthex/term-check.py '<파일>'`
9. **기록.** PR마다 다음을 같은 PR에 넣는다.
   - progress.md 맨 위 단락
   - fix-log 다음 번호
   - app/README 번호 항목
   - 끝난 조건이 다 채워졌으면 `wbs_rows.py`의 `finished`와 `build_wbs.py . --write`
10. **합치기.** CI app·db가 성공하면 squash로 합치고, main CI와 원격 SHA를 확인한다. 합칠 수 없는 환경이면 '합칠 준비 됨'으로 동희님께 보고한다.
11. **글.** 한국어로 쓰고, 그 분야의 표준 용어를 쓴다. 지어낸 고유어를 쓰지 않는다. 저장소의 금지어 표(지침 11절)를 지킨다. 동희님께 하는 보고는 존댓말이다.
12. **틀린 통과.** 틀린 통과는 틀린 실패보다 나쁘다. 기계로 확실히 가를 수 없는 것은 통과로 두지 않는다.
