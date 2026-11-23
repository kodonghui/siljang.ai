# AGENTS.md: siljang.ai 개발 에이전트 안내

이 저장소에서 11단계 개발을 맡은 코딩 에이전트(Codex 등)가 먼저 읽는 파일이다.

- **지금 지시:** [docs/handover/codex-finish.md](docs/handover/codex-finish.md)를 처음부터 끝까지 읽는다. WBS의 작업을 끝까지 진행하고, 진짜 계정·카카오·배포 확인도 Aside CLI·agent-desktop·wrangler로 직접 한다(동희님 지시 2026-11-19).
- **2026-11-22 지시:** codex-finish.md 맨 위의 무료 MVP 운영 배포 범위·구현 완료 기준·코드 오류 재검사 규칙·학원컴 Aside CLI·결제 없음 지시를 먼저 따릅니다. 브라우저 도구는 19:47 KST의 추가 지시를 적용합니다.
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
   - 동시에 열린 PR이 있으면 main과 그 PR의 예약 번호를 함께 보고 중복 없이 다음 번호를 정한다. 합칠 때는 기록을 원본 번호 순서에 끼워 넣고 옛 번호를 다시 매기지 않는다.
   - README의 새 번호 기록은 `### <번호>. <작업>` 제목으로 써서 Markdown 순서 목록의 자동 번호와 원본 번호가 어긋나지 않게 한다. 예전 기록은 그대로 둔다.
   - hands-on.md(진짜 환경 결과)
   - 끝난 조건이 다 채워졌으면 `wbs_rows.py`의 `finished`와 `build_wbs.py . --write`
10. **합치기.** 아래 [PR 리뷰](#pr-리뷰)의 병합 조건을 채우면 squash로 합치고, main CI·스테이징 배포·원격 SHA를 확인한다.
11. **글.** 한국어로 쓰고, 그 분야의 표준 용어를 쓴다(codex-development.md 11절의 표). 동희님께 하는 보고는 존댓말이다.
12. **확인한 것만 통과로.** 기계나 화면으로 확인한 것만 통과로 적고, 확인 못 한 것은 그렇다고 적는다.
13. **끝까지 계속.** PR을 합치면 progress.md에 적고 바로 다음 작업을 시작한다. 채팅 보고는 '11단계 개발 끝'에 닿았을 때와 남은 작업이 모두 확인을 기다릴 때 한다(codex-finish.md 9절).

## PR 리뷰

동희님이 2026-11-22 23시대 KST에 정하고 11-23에 저장소 반영을 허락한 규칙이다. PR 리뷰 댓글과 병합 조건에서는 이 절이 기존 인계 문서보다 우선한다.

1. **리뷰 담당.** PR마다 실장님 봇(Orca)이 Claude Code `/code-review`를 돌린다. 인증·권한·세션, 비밀 값, 개인정보, 결제, 웹훅·콜백 서명처럼 보안이 걸린 변경에는 `/security-review`도 돌린다.
2. **시작과 기록.** PR은 draft로 열지 않는다. 작업을 마치고 리뷰를 받을 때 리뷰 준비(ready for review) 상태로 열면 실장님 봇이 리뷰를 시작한다. PR 댓글의 첫 줄은 `## Claude 리뷰`로 쓰고, 리뷰한 head SHA를 적는다. draft로 열린 PR은 병합 뒤 리뷰하고 발견 사항을 후속 PR에서 고친다.
3. **발견 사항 처리.** PR을 연 쪽은 발견 사항마다 고치거나 고치지 않는 이유를 적고, 처리 결과를 PR 댓글에 남긴다.
4. **30분 대기.** PR이 리뷰 준비가 된 뒤 30분 안에 Claude 리뷰 댓글이 오지 않으면, 그 사실을 PR 댓글에 남긴 뒤 병합해도 된다. 보안이 걸린 변경은 `/security-review` 결과도 같은 기한까지 기다리고, 결과가 오지 않으면 PR 댓글에 적는다. 병합 뒤에 온 Claude 리뷰의 발견 사항은 후속 PR에서 고친다.
5. **병합 직전 Codex 리뷰.** PR에 `@codex review` 두 단어만 담은 댓글을 한 번 달고 결과를 기다린다. 설명이나 처리 댓글에서는 멘션을 빼고 'Codex 리뷰 요청 댓글'이라고 쓴다. 발견 사항은 3번대로 처리한다. 요청에 대한 답으로 사용 한도 실패 메시지가 오거나, 요청 뒤 30분 안에 리뷰도 사용 한도 실패 메시지도 오지 않으면, 그 사실을 PR 댓글에 남기고 Claude 리뷰 결과로 병합 여부를 판단한다.
6. **Codex 자동 리뷰.** 자동 리뷰는 2026-11-23에 껐다. 남아 있는 옛 자동 리뷰와 그 사용 한도 메시지는 그대로 둔다.
7. **병합 조건.** 검사(CI app·db 포함)가 통과해야 한다. 현재 head SHA의 Claude 리뷰(보안이 걸린 변경은 `/security-review` 결과 포함), 4번의 대기 기록, 또는 아래에 정한 병합 뒤 리뷰 요청 댓글이 있어야 한다. 발견 사항이 있으면 처리 댓글을 남긴다. 병합 직전 Codex 리뷰를 한 번 요청하고 5번에 따라 결과를 처리하거나 사용 한도 실패·30분 대기를 기록한다.
   - 리뷰한 SHA 뒤의 변경이 발견 사항 처리와 `main` rebase뿐이면, 처리 댓글에 관련 커밋과 새 head SHA를 적고 그 리뷰를 적용한다.
   - 다른 변경이 추가되면 `Claude 재리뷰 요청` 댓글에 새 head SHA를 적은 뒤 병합해도 된다. 실장님 봇이 병합 뒤 바뀐 부분을 리뷰하고 발견 사항은 후속 PR에서 고친다.
   - 2번의 draft로 열었던 PR은 리뷰 준비 상태로 바꿨더라도 4번의 30분 대기를 적용하지 않는다. Claude 리뷰를 병합 뒤에 받는다고 PR 댓글에 기록한다.
