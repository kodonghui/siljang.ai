# AGENTS.md: siljang.ai 개발 에이전트 안내

이 저장소에서 11단계 개발을 맡은 코딩 에이전트(Codex 등)가 먼저 읽는 파일이다.

- **지금 지시:** [docs/handover/codex-finish.md](docs/handover/codex-finish.md)를 처음부터 끝까지 읽는다. WBS의 작업을 끝까지 진행하고, 진짜 계정·카카오·배포 확인도 Aside CLI·agent-desktop·wrangler로 직접 한다(동희님 지시 2026-11-19).
- **2026-11-22 지시:** codex-finish.md 맨 위의 무료 MVP 운영 배포 범위·구현 완료 기준·코드 오류 재검사 규칙·학원컴 Ego Light·결제 없음 지시를 먼저 따릅니다.
- **코드 규칙·검사·기록·PR 형식:** [docs/handover/codex-development.md](docs/handover/codex-development.md) 5~11절. 두 글이 다르면 codex-finish.md를 따른다.
- **지금 기록:** [docs/records/progress.md](docs/records/progress.md) 맨 위 단락, [docs/records/fix-log.md](docs/records/fix-log.md) 끝, [app/README.md](app/README.md)의 번호 항목.

## 요약

1. **기준.** 동희님(제품 책임자)의 결정 사항과 01~10단계 설계 문서가 기준이다. 제품 결정이 필요하면 추천안과 함께 확인 요청을 하고, 답을 기다리는 동안 다음 작업을 한다.
2. **작업 단위.** WBS(`docs/10-wbs/wbs.md`)의 작업 하나를 PR 하나로 한다. 브랜치는 `codex/task-<번호>-<짧은-영문>`이다.
3. **차례.** 원본을 읽고, 실패하는 시험부터 쓰고, 구현하고, 스테이징에서 확인한다. 커밋과 push는 일찍, 자주 한다.
4. **생성 파일.** 각 단계의 생성기로 고친다(codex-development.md 7절).
5. **진짜 환경.** 웹 화면 일은 Aside(`aside exec`, `aside repl`), 데스크톱 앱(카카오톡 PC)은 agent-desktop, Cloudflare는 wrangler로 한다. 결과는 `docs/records/hands-on.md`에 적고, 끝난 조건이 다 채워지면 `finished`를 표시한다.
6. **비밀 값.** Aside Vault, `wrangler secret put`, GitHub Actions secrets, `.dev.vars`에 두고, 저장소·기록·PR에는 이름만 적는다. 시험의 가짜 이메일은 `example` 도메인을 쓴다.
7. **동희님께 확인받는 것.** 결제 직전, 제품 결정, 사람 확인 화면(캡차·인증 번호·신원 확인), 전문가 답이다(codex-finish.md 8절). 확인 요청은 progress.md의 '동희님 확인 대기' 목록에 모으고 다음 작업을 계속한다.
   - 카카오톡은 PC 카카오톡에서 agent-desktop으로 한다. PC에서 되지 않는 단계와 휴대폰에서만 되는 확인은 TASK-167(출시 검토)로 옮기고 그 작업을 끝낸다(codex-finish.md 맨 위 '지금 먼저 읽을 것' 3번).
8. **검사.** 결과 줄을 PR 본문에 그대로 옮긴다.
   - `app/`에서 `npm ci && npm run lint && npm run typecheck && npm test && npm run build`
   - `bash tools/stage-checks.sh <이름>`(설계 문서를 바꾼 PR)
   - `python3 -I research/cake-wbs-2026-11/build_wbs.py .`
   - `node tools/check-no-keys.mjs --repo`
   - `python3 -I tools/corthex/term-check.py '<파일>'`
9. **기록.** PR마다 다음을 같은 PR에 넣는다.
   - progress.md 맨 위 단락
   - fix-log 다음 번호
   - app/README 번호 항목
   - hands-on.md(진짜 환경 결과)
   - 끝난 조건이 다 채워졌으면 `wbs_rows.py`의 `finished`와 `build_wbs.py . --write`
10. **합치기.** CI app·db가 성공하면 squash로 합치고, main CI·스테이징 배포·원격 SHA를 확인한다.
11. **글.** 한국어로 쓰고, 그 분야의 표준 용어를 쓴다(codex-development.md 11절의 표). 동희님께 하는 보고는 존댓말이다.
12. **확인한 것만 통과로.** 기계나 화면으로 확인한 것만 통과로 적고, 확인 못 한 것은 그렇다고 적는다.
13. **끝까지 계속.** PR을 합치면 progress.md에 적고 바로 다음 작업을 시작한다. 채팅 보고는 '11단계 개발 끝'에 닿았을 때와 남은 작업이 모두 확인을 기다릴 때 한다(codex-finish.md 9절).
