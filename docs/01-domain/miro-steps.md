# 01 이벤트 보드(Miro)에 옮길 단계 목록

01단계 원본 [`domain.md`](domain.md)에서 2026-11-12 10:05 뒤에 바뀐 것을 [이벤트 스토밍 보드](https://miro.com/app/board/uXjVEPLnid4=/)에 옮기는 차례입니다. 2026-11-15 동희님 지시("미로보드 관련해서도 일단 깃에서 관리해", [진행 기록](../records/progress.md)의 15:27 단락)에 따라 지금은 보드를 고치지 않고, 보드에 옮길 때까지 이 목록이 보드와 원본의 차이를 적은 원본입니다.

- 기준: main `220f09d`(설계 재검토 PR #27~#47과 동희님 결정 반영 PR #48을 합친 커밋)의 `domain.md`. 아래 `L000`은 이 커밋의 줄 번호이고, 누르면 그 줄이 열립니다.
- 보드: 마지막으로 읽어 대조한 때는 `domain.md` 머리말의 `synced_at` 2026-11-12 10:05 KST이고, 그때의 원본은 `dc7dfae`(2026-11-12 09:29)입니다.
- 처음 만든 때: 2026-11-15 15:21 KST(main `e4067ce` 기준). 같은 날 PR #48이 더한 두 줄(3-8의 11번, CTX-003 규칙 하나)을 넣어 `220f09d` 기준으로 고쳤습니다.
- 원본이 또 바뀌면 그 PR에서 이 목록도 고칩니다. 보드에 옮긴 뒤에는 5단계대로 끝을 적습니다.

## 지금 보드를 고치지 않는 이유와 옮기는 길

- 2026-11-15 동희님 지시로 Miro 보드 일도 일단 저장소에서 관리합니다. 보드에 언제 옮길지는 따로 정합니다.
- 옮길 때의 길은 둘입니다.
  - **추천:** https://claude.ai/customize/connectors 에서 Miro를 연결하고 새 세션을 엽니다(커넥터는 세션을 시작할 때 읽힘). 그러면 Claude가 이 목록대로 옮기고 보드를 다시 읽어 견줍니다.
    - 이유: 보드 항목이 2,046개(2026-11-11 20:56 기준)입니다. 용어를 바꾼 글이 거의 모든 프레임에 있어 손으로 옮기면 빠뜨리기 쉽습니다.
  - 손으로 옮긴다면 아래 0~5단계 차례로 합니다.
- 보드에 아직 없는 것은 셋입니다(원본 [L10](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L10)).
  - 3-7 용어 정리(2026-11-12)
  - 3-8 요구사항 버전 2~5, 설계 재검토 K1, 동희님 결정 반영에서 되돌린 것(2026-11-15)
  - 2-1의 이벤트 63·64
  - 설계 재검토로 컨텍스트 지도에 더한 화살표 둘도 함께 옮깁니다(3단계).
- 글 하나하나의 정확한 차이는 저장소에서 바로 봅니다(`dc7dfae`에서 `220f09d`까지 498줄 더함, 426줄 지움).
  - 줄 단위: `git diff dc7dfae 220f09d -- docs/01-domain/domain.md`
  - 낱말 단위: `git diff --word-diff dc7dfae 220f09d -- docs/01-domain/domain.md`
- **고치지 않는 것**
  - 0·2·3절의 체크포인트 기록과 2-4·2-5·2-7의 단계별 표는 '그때 모습대로' 둡니다(3-8 첫 문단, [L401](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L401)).
  - 그래서 '2 외부 시스템'·'3 명령'·'5 액터'·'6 애그리거트' 프레임과 체크포인트 박스는 4단계의 용어 이름만 바꿉니다.
  - 동희님 말을 옮긴 따옴표 안의 글은 바꾸지 않습니다.

## 0단계. 시작 전

1. 보드를 열고, 2026-11-12 10:05 뒤에 사람이 더하거나 고친 항목이나 새 댓글이 있는지 봅니다.
   - 있으면 옮기기 전에 Claude에게 알려 주세요. 원본에 먼저 넣을지 정한 뒤 옮깁니다(원본 [L8](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L8): "이 문서를 먼저 고치고 보드를 고친 뒤, 무엇이 바뀌었는지 보드 댓글로 알립니다").
2. 색은 범례대로입니다: 이벤트 주황, 명령 파랑, 액터 연노랑, 애그리거트 노랑, 정책 보라, 읽기 모델 연두, 핫스팟 빨강(답한 것은 초록).

## 1단계. '1-a 이벤트 모으기' 프레임: 이벤트 둘 더하기

| 이벤트 | 주황 스티커 글 | 넣을 줄 | 원본 |
| --- | --- | --- | --- |
| 63 | 결제 수단 등록됨 (요구사항 버전 4 되돌림으로 더함, 3-8) | A 가게 준비 | [L159](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L159) |
| 64 | 결제 확인 취소됨 (요구사항 버전 5 되돌림으로 더함, 3-8) | D 주문 요청·확정 | [L160](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L160) |

'1-b 타임라인' 프레임의 플로우(2-2)에는 63·64가 없으므로 더하지 않습니다(용어 이름만 4단계에서 바꿈).

## 2단계. '9 컨텍스트 표와 3차 체크포인트' 프레임: 컨텍스트 표

1. 프레임을 아래로 늘려 박스 **'요구사항 버전 2~5·설계 재검토·동희님 결정 반영 (2026-11-15)'** 를 더합니다.
   - 3-8의 열한 항목([L403~L413](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L403-L413))을 스티커 열한 개로 붙입니다. 11번은 2026-11-15 14:19 동희님 결정 카드의 반영입니다(결제 기다림 주문 한도와 AI 모델 회사).
   - 2026-11-11의 '3차 답 반영'·'02단계 범위 확정 반영' 박스와 같은 꼴입니다.
2. 컨텍스트 표의 행과 규칙 스티커를 원본대로 고칩니다.
   - 행의 열은 '주는 쪽 | 읽기 모델 | 명령 | 애그리거트 | 이벤트 | 확신'입니다.
   - 글 끝의 괄호(예: '버전 5 되돌림: REQ-225')까지 옮깁니다.
   - '새 행'은 표에 한 줄을 더하고, '새 규칙'은 스티커를 하나 더합니다.

| 컨텍스트 | 새 행 | 고칠 행 | 고치거나 더할 규칙 |
| --- | --- | --- | --- |
| CTX-001 상담 | 없음 | 없음 | 마감된 날을 원하는 손님은 사장님께 [L447](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L447). 새 규칙 셋: 가게의 하루 AI 비용 한도 [L448](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L448), 상담 하나의 AI 비용 상한 [L449](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L449), 문의 끊김과 상담 끝남 [L450](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L450) |
| CTX-002 가게 규칙 | 없음 | 정책 행 '가예약 해제하기'의 조건 [L477](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L477) | 결제 기한이 지나도 자리를 풀지 않는 동안 [L491](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L491). 새 규칙: 휴무·하루 최대 개수를 바꾸기 전 확인 [L497](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L497). 운영규정 조문 근거 REQ-033→REQ-258 [L487](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L487) |
| CTX-003 주문 | '문제 신고로 남기기'(사장님) [L524](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L524) | '개인정보 지우기'의 시간(주문이 끝나고 30일)과 확신 [추론]→[확실] [L522](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L522). '문제 신고하기'의 주는 쪽(그 주문을 요청한 카카오 사용자만) [L523](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L523). '보상 정하기'(문제 종류, 다섯 가지) [L525](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L525) | 변경·취소·문제 신고는 요청한 사용자에게서만 [L534](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L534). 새 규칙 여섯: 결제 기다림 주문 한도(가게가 정함, 기본 2건, 2026-11-15 동희님 결정 카드 '가게가 한도를 정함') [L535](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L535), 보상 다섯 가지 [L541](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L541), 문제 종류 [L542](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L542), 신고 기한으로 막지 않음 [L543](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L543), 다른 사용자의 에스컬레이션 건 [L544](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L544), 개인정보 지우기와 보관 기록 [L545](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L545) |
| CTX-004 결제·환불 | '결제 확인 취소하기'(사장님) [L563](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L563) | 없음 | 받은 금액의 뜻 [L568](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L568), 맞추는 중 [L571](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L571), 결제 기한 세는 법 [L572](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L572). 새 규칙 둘: 잘못 누른 결제 확인 취소 [L573](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L573), 보내지 않은 환불 다시 알림 [L574](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L574) |
| CTX-005 제작·전달 | 없음 | '완성 표시하기'의 주는 쪽 열 [L588](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L588) | 없음 |
| CTX-006 후기·포트폴리오 | 없음 | '사진 게시에 동의하기'의 주는 쪽 열(사진마다, 주문 요청 때는 묻지 않음) [L607](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L607) | 후기는 받은 주문에만 [L613](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L613), 사진 게시 동의 [L614](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L614), 포트폴리오 [L615](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L615) |
| CTX-007 가게 등록·연결 | '결제 수단 등록하기'(사장님, 가게 명의 계좌) [L630](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L630) | 정책 행 '예약 링크 발급하기'의 조건(결제 수단 등록됨) [L631](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L631). 목적 글 [L623](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L623) | 예약 링크를 내는 조건 [L634](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L634). 새 규칙: 사장님은 카카오 로그인, 운영자는 운영자 계정 [L638](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L638). 외부 시스템 글(채널 연결 확인은 부패 방지 층) [L639](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L639) |
| CTX-008 알림 | 없음 | 정책 행 '사장님께 알리기' [L655](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L655). 시간 행 '지연 안내 보내기'(넓힌 범위) [L656](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L656) | 지연 안내 범위 [L665](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L665), 기다리는 시간과 사장님 알림 받는 곳 [L668](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L668), 완성 사진의 게시 동의 [L670](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L670). 새 규칙 둘: 손님에게 결과 알림 [L666](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L666), 사장님이 정할 일 [L667](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L667) |
| CTX-009 장부 연결 | 없음 | 정책 행 '장부에 적기'(인도·미수령 더함) [L683](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L683) | 새 규칙 둘: 인도·미수령도 적음 [L688](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L688), 24시간 실패·권한 끊김 알림 [L689](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L689). 연결 글 [L691](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L691) |

## 3단계. '8 정책·읽기 모델·컨텍스트 지도' 프레임

1. **정책(보라)**
   - '가예약 해제하기'의 조건에 '입금했다고 알린 동안과 맞추는 중은 빼고'를 넣습니다([L794](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L794)).
   - '장부에 적기'의 조건에 인도·미수령을 넣습니다([L798](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L798)).
2. **읽기 모델(연두)**: '사장님 할 일 목록'의 뜻과 명령을 고칩니다([L818](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L818)).
3. **컨텍스트 지도**
   - CTX-004→CTX-002 화살표 글을 고칩니다([L711](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L711)).
   - 카카오톡 채널에서 나가는 점선 화살표 둘을 더합니다.
     - CTX-006으로 가는 '후기·사진, 부패 방지 층'([L729](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L729), [L751](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L751))
     - CTX-007로 가는 '채널 연결 문구, 부패 방지 층'([L730](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L730), [L752](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L752))
   - 구글 캘린더의 박스와 화살표에 '다음 버전'을 붙입니다([L727](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L727), [L748](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L748), [L779](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L779)). 식품안전나라는 이미 '다음 판'이라 4단계에서 '다음 버전'으로 바꾸기만 합니다.

## 4단계. 모든 프레임: 3-7 용어 이름 바꾸기

1. **TERM 이름 열 개**([L394](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L394)): 각 프레임 맨 위의 용어 메모와 스티커 글에서 예전 이름을 찾아 바꿉니다. 보드 검색(Ctrl+F, 맥은 Cmd+F)을 씁니다.

   | 예전 이름 | 새 이름 | 예전 이름 | 새 이름 |
   | --- | --- | --- | --- |
   | 판 번호 | 버전 | 다시 만들기 | 재제작 |
   | 한 거래 후보 | 트랜잭션 경계 후보 | 늦어짐 안내 | 지연 안내 |
   | 자리 잡기(그날 자리 잡기·잡힘) | 가예약(가예약하기·가예약됨) | 더 기다리기 | 결제 기한 연장 |
   | 넘긴 질문 | 에스컬레이션 건 | 영업 달력 | 영업 캘린더 |
   | 넘기기(질문을) | 에스컬레이션 | 장부 줄 | 장부 행 |

2. **용어집 밖의 말**([L396](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L396), 대조표: [Notion 용어 대조표](https://app.notion.com/p/416bf16cc3ec8149a1cacc395e33055c)). 이번 차이에서 자주 나온 말은 아래와 같습니다(왼쪽이 예전 말).
   - 사건→이벤트, 바깥→외부, 달력→캘린더
   - 받아들여짐→수락됨, 거둠·거두기→철회함·철회, 그날 자리 풀기·풀림→가예약 해제하기·가예약 해제됨
   - 줄→행, 흐름→플로우, 확인 지점→체크포인트, 상자→박스, 받아 줌→추가 수락, 행위자→액터
   - 저절로→자동으로, 가림→마스킹, 틀→템플릿, 부름→호출함, 까닭→사유
3. **기계적으로 한꺼번에 바꾸지 않습니다.** 뜻에 따라 갈리는 말이 있어 하나씩 원본과 대어 봅니다. 위의 낱말 단위 차이에서 그 줄을 찾으면 됩니다.
   - '넘기다': 에스컬레이션·전달·인도·초과로 갈립니다.
   - '판': 버전의 뜻일 때만 바꿉니다.
   - '칸': 열·필드·항목으로 갈립니다.
   - '끝남': 만료됨·종료된으로 갈립니다.
4. **대조표와 다르게 적은 세 곳**([L397](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L397))
   - '결제 확인 요청 카드'
   - 입금 대조 결과 '입금됨'
   - '첫 버전'
5. **버전 5에서 뜻이 바뀐 용어**(3-8의 9): 용어 메모에 있으면 7절의 지금 뜻으로 고칩니다.
   - TERM-038 맞춤 주문 [L931](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L931), TERM-039 기본 디자인 주문 [L932](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L932)
   - TERM-031 문제 신고 [L924](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L924), TERM-033 보상 [L926](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L926)
   - TERM-035 사장님 알림 [L928](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L928), TERM-036 지연 안내 [L929](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L929)
   - TERM-051 후기 [L949](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L949), TERM-052 포트폴리오 [L950](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L950), TERM-071 후기 사진과 게시 동의 여부 [L974](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L974)
6. **(선택) 7-5의 새 용어**: TERM-075~086([L984](https://github.com/kodonghui/siljang.ai/blob/220f09dbbe4f57afaa17ddd85fc80f6b48cc8b49/docs/01-domain/domain.md?plain=1#L984)부터)을 '9' 프레임의 용어 메모에 더합니다.

## 5단계. 알리고 끝내기

1. 보드에 댓글을 하나 답니다. 예:
   > 원본(docs/01-domain/domain.md, 옮긴 커밋)의 3-7 용어 정리, 3-8 요구사항 버전 2~5·설계 재검토·동희님 결정 되돌림, 이벤트 63·64, 컨텍스트 지도 화살표 둘을 옮김. 바꾼 프레임: 1-a, 8, 9와 모든 프레임의 용어.
2. 끝낸 시각을 Claude에게 알려 주세요.
   - 그 PR에서 `domain.md` 머리말의 `synced_at`을 그 시각으로 고치고, 10줄 끝의 2026-11-15 두 문장(보드에 옮기지 않았다는 것과 이 목록이 원본이라는 것)을 지웁니다.
   - 이 목록의 맨 위에 옮긴 시각과 커밋을 적고, 옮기지 않은 것이 있으면 남깁니다.
   - Miro에 닿는 세션이면 Claude가 보드를 다시 읽어 항목 수와 바뀐 글을 견줍니다.
