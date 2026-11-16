# AI 평가 세트 출처 점검표(REQ-139)

<!-- 생성 파일: app/server/eval/checklist.ts가 만듦(npm run eval:checklist -w server). 손으로 고치지 않음 -->

- 사례 버전 `eval-cases-1`, 사례 134개. 사례 글은 `app/server/eval/cases.ts` 한 곳에 있다.
- 출처: 모든 사례는 이 저장소에서 지은 합성 상담이다(2026-11-16 TASK-027). 실제 손님 대화와 실제 가게 자료는 없다(출시 전이라 실제 대화가 없음).
- 가게: 합성 가게 3곳(S1 가나다 케이크(시험 가게), S2 마바사 디저트(시험 가게), S3 아자차 베이크(시험 가게)). 처리방침 주소는 풀리지 않는 이름(.invalid)이다.
- 번호: 손님 글의 번호는 SPEC-021 플레이스홀더 꼴만 쓴다. 플레이스홀더가 들어간 사례 2개.
- 개인정보 훑기(`scan.ts`): 사례 134개의 글 227개(손님 말·지난 대화·초안·모의 초안·주문 요약·견적)와 가게 3곳을 훑어 찾은 것 0건.
  찾는 것: 플레이스홀더가 아닌 전화번호, 주민등록번호, 9자리가 넘는 숫자, 이메일, 합성(.invalid·.test)이 아닌 주소, 모르는 플레이스홀더, 한글로 적은 전화번호.
- 근거 ID 22개 가운데 원본(02 requirements.md의 REQ 행, 04 spec.md의 SPEC 행과 AI-1 절)에 없는 것 0개.
- 사례 ID 중복 0개.

## 잣대별 겨눈 사례 수와 최소

잣대는 겨눈 사례만이 아니라 모든 사례에서 매긴다. 최소의 이유는 `cases.ts`의 CASE_MINIMUMS 설명과 같다: 잣대마다 가게 셋·갈래·말투를 고루 덮는 수이고, 20개에서 0건이면 실제 실패율의 95% 위 끝이 약 14%라 이 세트는 비율을 재는 것이 아니라 실패를 찾아내는 데 쓴다(결과 표가 출시를 정하지 않음). 바꾸기 시도 30개는 REQ-146이 정한 수다.

| 잣대 | 겨눈 사례 | 최소 |
| --- | --- | --- |
| 틀린 금액 | 37 | 20 |
| 주문 확정 전에 확정되었다고 한 말 | 28 | 20 |
| 먹어도 되는지에 대한 답 | 20 | 20 |
| 가게 규칙에 없는 지어낸 답 | 30 | 20 |
| 빠진 AI 상담 고지: 상담의 첫 메시지(서버 고지 경로) | 129 | 20 |
| 빠진 AI 상담 고지: AI인지 묻거나 사람인 척하라는 사례 | 9 | 8 |
| 바꾸기 시도(REQ-146) | 30 | 30 |
| 전체(REQ-145) | 134 | 100 |

## 갈래별 사례 수

| 갈래 | 사례 |
| --- | --- |
| 견적·금액 | 22 |
| 바꾸기 시도(REQ-146) | 30 |
| 주문 확정 전 상담 | 20 |
| 먹어도 되는지 | 20 |
| 가게 규칙에 없는 질문 | 21 |
| AI인지 묻기 | 8 |
| 일반 상담 | 13 |

## 사례 목록

| ID | 갈래 | 겨눈 잣대 | 가게 | 첫 메시지 | 근거 |
| --- | --- | --- | --- | --- | --- |
| AMT-01 | 견적·금액 | amount | S1 | 예 | REQ-145, SPEC-020, SPEC-013, REQ-005, REQ-007 |
| AMT-02 | 견적·금액 | amount | S1 | 예 | REQ-145, SPEC-020, SPEC-013, REQ-005, REQ-007 |
| AMT-03 | 견적·금액 | amount | S1 | 예 | REQ-145, SPEC-020, SPEC-013, REQ-005, REQ-007 |
| AMT-04 | 견적·금액 | amount | S1 | 아니요 | REQ-145, SPEC-020, SPEC-013, REQ-005, REQ-007 |
| AMT-05 | 견적·금액 | amount | S1 | 예 | REQ-145, SPEC-020, SPEC-013, REQ-005, REQ-007 |
| AMT-06 | 견적·금액 | amount | S1 | 예 | REQ-145, SPEC-020, SPEC-013, REQ-005, REQ-007, REQ-229 |
| AMT-07 | 견적·금액 | amount | S1 | 예 | REQ-145, SPEC-020, SPEC-013, REQ-005, REQ-007, REQ-229 |
| AMT-08 | 견적·금액 | amount | S1 | 예 | REQ-145, SPEC-020, SPEC-013, REQ-005, REQ-007 |
| AMT-09 | 견적·금액 | amount | S1 | 예 | REQ-145, SPEC-020, SPEC-013, REQ-005, REQ-007 |
| AMT-10 | 견적·금액 | amount, fabricated | S1 | 예 | REQ-145, SPEC-020, SPEC-013, REQ-005, REQ-007 |
| AMT-11 | 견적·금액 | amount | S1 | 예 | REQ-145, SPEC-020, SPEC-013, REQ-005, REQ-007 |
| AMT-12 | 견적·금액 | amount | S2 | 예 | REQ-145, SPEC-020, SPEC-013, REQ-005, REQ-007 |
| AMT-13 | 견적·금액 | amount | S2 | 예 | REQ-145, SPEC-020, SPEC-013, REQ-005, REQ-007 |
| AMT-14 | 견적·금액 | amount | S2 | 예 | REQ-145, SPEC-020, SPEC-013, REQ-005, REQ-007 |
| AMT-15 | 견적·금액 | amount | S2 | 예 | REQ-145, SPEC-020, SPEC-013, REQ-005, REQ-007 |
| AMT-16 | 견적·금액 | amount | S3 | 예 | REQ-145, SPEC-020, SPEC-013, REQ-005, REQ-007 |
| AMT-17 | 견적·금액 | amount | S3 | 예 | REQ-145, SPEC-020, SPEC-013, REQ-005, REQ-007 |
| AMT-18 | 견적·금액 | amount | S1 | 예 | REQ-145, SPEC-020, SPEC-013, REQ-005, REQ-007 |
| AMT-19 | 견적·금액 | amount | S1 | 예 | REQ-145, SPEC-020, SPEC-013, REQ-005, REQ-007 |
| AMT-20 | 견적·금액 | amount | S2 | 예 | REQ-145, SPEC-020, SPEC-013, REQ-005, REQ-007 |
| AMT-21 | 견적·금액 | amount | S3 | 예 | REQ-145, SPEC-020, SPEC-013, REQ-005, REQ-007 |
| AMT-22 | 견적·금액 | amount | S1 | 예 | REQ-145, SPEC-020, SPEC-013, REQ-005, REQ-007 |
| INJ-01 | 바꾸기 시도(REQ-146) | amount | S1 | 예 | REQ-146, REQ-145, SPEC-020, SPEC-013 |
| INJ-02 | 바꾸기 시도(REQ-146) | amount | S1 | 예 | REQ-146, REQ-145, SPEC-020, SPEC-013 |
| INJ-03 | 바꾸기 시도(REQ-146) | amount | S1 | 예 | REQ-146, REQ-145, SPEC-020, SPEC-013 |
| INJ-04 | 바꾸기 시도(REQ-146) | amount | S1 | 예 | REQ-146, REQ-145, SPEC-020, SPEC-013 |
| INJ-05 | 바꾸기 시도(REQ-146) | amount | S1 | 예 | REQ-146, REQ-145, SPEC-020, SPEC-013 |
| INJ-06 | 바꾸기 시도(REQ-146) | amount | S1 | 아니요 | REQ-146, REQ-145, SPEC-020, SPEC-013 |
| INJ-07 | 바꾸기 시도(REQ-146) | amount | S1 | 예 | REQ-146, REQ-145, SPEC-020, SPEC-013 |
| INJ-08 | 바꾸기 시도(REQ-146) | amount | S1 | 예 | REQ-146, REQ-145, SPEC-020, SPEC-013 |
| INJ-09 | 바꾸기 시도(REQ-146) | amount | S1 | 예 | REQ-146, REQ-145, SPEC-020, SPEC-013 |
| INJ-10 | 바꾸기 시도(REQ-146) | amount | S1 | 예 | REQ-146, REQ-145, SPEC-020, SPEC-013 |
| INJ-11 | 바꾸기 시도(REQ-146) | amount | S1 | 예 | REQ-146, REQ-145, SPEC-020, SPEC-013 |
| INJ-12 | 바꾸기 시도(REQ-146) | amount | S1 | 예 | REQ-146, REQ-145, SPEC-020, SPEC-013 |
| INJ-13 | 바꾸기 시도(REQ-146) | amount | S1 | 예 | REQ-146, REQ-145, SPEC-020, SPEC-013 |
| INJ-14 | 바꾸기 시도(REQ-146) | amount | S1 | 예 | REQ-146, REQ-145, SPEC-020, SPEC-013 |
| INJ-15 | 바꾸기 시도(REQ-146) | amount | S1 | 예 | REQ-146, REQ-145, SPEC-020, SPEC-013 |
| INJ-16 | 바꾸기 시도(REQ-146) | confirmed | S1 | 예 | REQ-146, REQ-145, SPEC-020, REQ-012 |
| INJ-17 | 바꾸기 시도(REQ-146) | confirmed | S1 | 예 | REQ-146, REQ-145, SPEC-020, REQ-012 |
| INJ-18 | 바꾸기 시도(REQ-146) | confirmed | S1 | 예 | REQ-146, REQ-145, SPEC-020, REQ-012 |
| INJ-19 | 바꾸기 시도(REQ-146) | confirmed | S1 | 예 | REQ-146, REQ-145, SPEC-020, REQ-012 |
| INJ-20 | 바꾸기 시도(REQ-146) | confirmed | S1 | 예 | REQ-146, REQ-145, SPEC-020, REQ-012 |
| INJ-21 | 바꾸기 시도(REQ-146) | confirmed | S1 | 예 | REQ-146, REQ-145, SPEC-020, REQ-012 |
| INJ-22 | 바꾸기 시도(REQ-146) | confirmed | S1 | 예 | REQ-146, REQ-145, SPEC-020, REQ-012 |
| INJ-23 | 바꾸기 시도(REQ-146) | confirmed, notice | S1 | 예 | REQ-146, REQ-145, SPEC-020, REQ-012 |
| INJ-24 | 바꾸기 시도(REQ-146) | fabricated | S1 | 예 | REQ-146, REQ-145, SPEC-020, AI-1 |
| INJ-25 | 바꾸기 시도(REQ-146) | fabricated | S1 | 예 | REQ-146, REQ-145, SPEC-020, AI-1 |
| INJ-26 | 바꾸기 시도(REQ-146) | fabricated | S1 | 예 | REQ-146, REQ-145, SPEC-020, AI-1 |
| INJ-27 | 바꾸기 시도(REQ-146) | fabricated | S1 | 예 | REQ-146, REQ-145, SPEC-020, AI-1 |
| INJ-28 | 바꾸기 시도(REQ-146) | fabricated | S1 | 예 | REQ-146, REQ-145, SPEC-020, AI-1 |
| INJ-29 | 바꾸기 시도(REQ-146) | fabricated | S1 | 예 | REQ-146, REQ-145, SPEC-020, AI-1 |
| INJ-30 | 바꾸기 시도(REQ-146) | fabricated | S1 | 예 | REQ-146, REQ-145, SPEC-020, AI-1 |
| CNF-01 | 주문 확정 전 상담 | confirmed | S1 | 예 | REQ-145, REQ-012, SPEC-020 |
| CNF-02 | 주문 확정 전 상담 | confirmed | S1 | 예 | REQ-145, REQ-012, SPEC-020 |
| CNF-03 | 주문 확정 전 상담 | confirmed | S1 | 예 | REQ-145, REQ-012, SPEC-020 |
| CNF-04 | 주문 확정 전 상담 | confirmed | S1 | 예 | REQ-145, REQ-012, SPEC-020 |
| CNF-05 | 주문 확정 전 상담 | confirmed | S1 | 예 | REQ-145, REQ-012, SPEC-020 |
| CNF-06 | 주문 확정 전 상담 | confirmed | S1 | 예 | REQ-145, REQ-012, SPEC-020 |
| CNF-07 | 주문 확정 전 상담 | confirmed | S1 | 예 | REQ-145, REQ-012, SPEC-020 |
| CNF-08 | 주문 확정 전 상담 | confirmed | S1 | 예 | REQ-145, REQ-012, SPEC-020 |
| CNF-09 | 주문 확정 전 상담 | confirmed | S1 | 아니요 | REQ-145, REQ-012, SPEC-020 |
| CNF-10 | 주문 확정 전 상담 | confirmed | S1 | 예 | REQ-145, REQ-012, SPEC-020 |
| CNF-11 | 주문 확정 전 상담 | confirmed | S1 | 예 | REQ-145, REQ-012, SPEC-020 |
| CNF-12 | 주문 확정 전 상담 | confirmed | S1 | 예 | REQ-145, REQ-012, SPEC-020 |
| CNF-13 | 주문 확정 전 상담 | confirmed | S1 | 예 | REQ-145, REQ-012, SPEC-020 |
| CNF-14 | 주문 확정 전 상담 | confirmed | S1 | 예 | REQ-145, REQ-012, SPEC-020, REQ-004 |
| CNF-15 | 주문 확정 전 상담 | confirmed | S1 | 예 | REQ-145, REQ-012, SPEC-020 |
| CNF-16 | 주문 확정 전 상담 | confirmed | S1 | 예 | REQ-145, REQ-012, SPEC-020 |
| CNF-17 | 주문 확정 전 상담 | confirmed | S1 | 예 | REQ-145, REQ-012, SPEC-020 |
| CNF-18 | 주문 확정 전 상담 | confirmed | S1 | 예 | REQ-145, REQ-012, SPEC-020 |
| CNF-19 | 주문 확정 전 상담 | confirmed | S1 | 예 | REQ-145, REQ-012, SPEC-020 |
| CNF-20 | 주문 확정 전 상담 | confirmed | S1 | 예 | REQ-145, REQ-012, SPEC-020 |
| EAT-01 | 먹어도 되는지 | edibility | S1 | 예 | REQ-145, REQ-014, SPEC-020, SPEC-022 |
| EAT-02 | 먹어도 되는지 | edibility | S1 | 예 | REQ-145, REQ-014, SPEC-020, SPEC-022 |
| EAT-03 | 먹어도 되는지 | edibility | S1 | 예 | REQ-145, REQ-014, SPEC-020, SPEC-022 |
| EAT-04 | 먹어도 되는지 | edibility | S1 | 예 | REQ-145, REQ-014, SPEC-020, SPEC-022 |
| EAT-05 | 먹어도 되는지 | edibility | S2 | 예 | REQ-145, REQ-014, SPEC-020, SPEC-022 |
| EAT-06 | 먹어도 되는지 | edibility | S1 | 예 | REQ-145, REQ-014, SPEC-020, SPEC-022 |
| EAT-07 | 먹어도 되는지 | edibility | S1 | 예 | REQ-145, REQ-014, SPEC-020, SPEC-022 |
| EAT-08 | 먹어도 되는지 | edibility | S1 | 예 | REQ-145, REQ-014, SPEC-020, SPEC-022 |
| EAT-09 | 먹어도 되는지 | edibility | S3 | 예 | REQ-145, REQ-014, SPEC-020, SPEC-022 |
| EAT-10 | 먹어도 되는지 | edibility | S1 | 예 | REQ-145, REQ-014, SPEC-020, SPEC-022 |
| EAT-11 | 먹어도 되는지 | edibility | S1 | 예 | REQ-145, REQ-014, SPEC-020, SPEC-022 |
| EAT-12 | 먹어도 되는지 | edibility | S2 | 예 | REQ-145, REQ-014, SPEC-020, SPEC-022 |
| EAT-13 | 먹어도 되는지 | edibility | S1 | 예 | REQ-145, REQ-014, SPEC-020, SPEC-022 |
| EAT-14 | 먹어도 되는지 | edibility | S1 | 예 | REQ-145, REQ-014, SPEC-020, SPEC-022, SPEC-013 |
| EAT-15 | 먹어도 되는지 | edibility | S1 | 예 | REQ-145, REQ-014, SPEC-020, SPEC-022 |
| EAT-16 | 먹어도 되는지 | edibility | S2 | 예 | REQ-145, REQ-014, SPEC-020, SPEC-022 |
| EAT-17 | 먹어도 되는지 | edibility | S1 | 예 | REQ-145, REQ-014, SPEC-020, SPEC-022 |
| EAT-18 | 먹어도 되는지 | edibility | S3 | 예 | REQ-145, REQ-014, SPEC-020, SPEC-022 |
| EAT-19 | 먹어도 되는지 | edibility | S1 | 예 | REQ-145, REQ-014, SPEC-020, SPEC-022 |
| EAT-20 | 먹어도 되는지 | edibility | S2 | 예 | REQ-145, REQ-014, SPEC-020, SPEC-022 |
| UNK-01 | 가게 규칙에 없는 질문 | fabricated | S1 | 예 | REQ-145, REQ-009, SPEC-020, SPEC-022 |
| UNK-02 | 가게 규칙에 없는 질문 | fabricated | S1 | 예 | REQ-145, REQ-009, SPEC-020, SPEC-022 |
| UNK-03 | 가게 규칙에 없는 질문 | fabricated | S1 | 예 | REQ-145, REQ-009, SPEC-020, SPEC-022 |
| UNK-04 | 가게 규칙에 없는 질문 | fabricated | S1 | 예 | REQ-145, REQ-009, SPEC-020, SPEC-022 |
| UNK-05 | 가게 규칙에 없는 질문 | fabricated | S1 | 예 | REQ-145, REQ-009, SPEC-020, SPEC-022 |
| UNK-06 | 가게 규칙에 없는 질문 | fabricated | S1 | 예 | REQ-145, REQ-009, SPEC-020, SPEC-022 |
| UNK-07 | 가게 규칙에 없는 질문 | fabricated | S1 | 예 | REQ-145, REQ-009, SPEC-020, SPEC-022 |
| UNK-08 | 가게 규칙에 없는 질문 | fabricated | S1 | 예 | REQ-145, REQ-009, SPEC-020, SPEC-022 |
| UNK-09 | 가게 규칙에 없는 질문 | fabricated | S1 | 예 | REQ-145, REQ-009, SPEC-020, SPEC-022 |
| UNK-10 | 가게 규칙에 없는 질문 | fabricated | S1 | 예 | REQ-145, REQ-009, SPEC-020, SPEC-022 |
| UNK-11 | 가게 규칙에 없는 질문 | fabricated | S1 | 예 | REQ-145, REQ-009, SPEC-020, SPEC-022 |
| UNK-12 | 가게 규칙에 없는 질문 | fabricated | S1 | 예 | REQ-145, REQ-009, SPEC-020, SPEC-022 |
| UNK-13 | 가게 규칙에 없는 질문 | fabricated | S1 | 예 | REQ-145, REQ-009, SPEC-020, SPEC-022 |
| UNK-14 | 가게 규칙에 없는 질문 | fabricated | S1 | 예 | REQ-145, REQ-009, SPEC-020, SPEC-022 |
| UNK-15 | 가게 규칙에 없는 질문 | fabricated | S1 | 예 | REQ-145, REQ-009, SPEC-020, SPEC-022 |
| UNK-16 | 가게 규칙에 없는 질문 | fabricated | S1 | 예 | REQ-145, REQ-009, SPEC-020, SPEC-022 |
| UNK-17 | 가게 규칙에 없는 질문 | fabricated | S1 | 예 | REQ-145, REQ-009, SPEC-020, SPEC-022 |
| UNK-18 | 가게 규칙에 없는 질문 | fabricated | S3 | 예 | REQ-145, REQ-009, SPEC-020, SPEC-022 |
| UNK-19 | 가게 규칙에 없는 질문 | fabricated | S3 | 예 | REQ-145, REQ-009, SPEC-020, SPEC-022 |
| UNK-20 | 가게 규칙에 없는 질문 | fabricated | S2 | 예 | REQ-145, REQ-009, SPEC-020, SPEC-022 |
| UNK-21 | 가게 규칙에 없는 질문 | fabricated | S3 | 예 | REQ-145, REQ-009, SPEC-020, SPEC-022 |
| NTC-01 | AI인지 묻기 | notice | S1 | 예 | REQ-145, REQ-257, SPEC-018 |
| NTC-02 | AI인지 묻기 | notice | S1 | 예 | REQ-145, REQ-257, SPEC-018 |
| NTC-03 | AI인지 묻기 | notice | S1 | 예 | REQ-145, REQ-257, SPEC-018, SPEC-022 |
| NTC-04 | AI인지 묻기 | notice | S1 | 예 | REQ-145, REQ-257, SPEC-018 |
| NTC-05 | AI인지 묻기 | notice | S1 | 예 | REQ-145, REQ-257, SPEC-018, SPEC-022 |
| NTC-06 | AI인지 묻기 | notice | S1 | 아니요 | REQ-145, REQ-257, SPEC-018 |
| NTC-07 | AI인지 묻기 | notice | S1 | 예 | REQ-145, REQ-257, SPEC-018, REQ-146 |
| NTC-08 | AI인지 묻기 | notice | S1 | 예 | REQ-145, REQ-257, SPEC-018, SPEC-022 |
| FLW-01 | 일반 상담 | - | S1 | 예 | REQ-145, SPEC-020, REQ-004 |
| FLW-02 | 일반 상담 | - | S1 | 예 | REQ-145, SPEC-020, REQ-004 |
| FLW-03 | 일반 상담 | - | S1 | 예 | REQ-145, SPEC-020 |
| FLW-04 | 일반 상담 | - | S1 | 예 | REQ-145, SPEC-020, SPEC-013 |
| FLW-05 | 일반 상담 | - | S1 | 예 | REQ-145, SPEC-020 |
| FLW-06 | 일반 상담 | - | S1 | 예 | REQ-145, SPEC-020 |
| FLW-07 | 일반 상담 | - | S1 | 예 | REQ-145, SPEC-020, SPEC-046 |
| FLW-08 | 일반 상담 | - | S1 | 예 | REQ-145, SPEC-020, SPEC-045 |
| FLW-09 | 일반 상담 | - | S1 | 예 | REQ-145, SPEC-020, SPEC-057, AI-1 |
| FLW-10 | 일반 상담 | fabricated | S1 | 예 | REQ-145, SPEC-020, SPEC-014, SPEC-022 |
| FLW-11 | 일반 상담 | - | S1 | 아니요 | REQ-145, SPEC-020, SPEC-049, SPEC-021 |
| FLW-12 | 일반 상담 | - | S1 | 예 | REQ-145, SPEC-020 |
| FLW-13 | 일반 상담 | - | S1 | 예 | REQ-145, SPEC-020, SPEC-021, SPEC-072 |
