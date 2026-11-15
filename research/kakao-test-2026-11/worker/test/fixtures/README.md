# 시험 견본(fixtures)

카카오 공식 문서의 스킬 요청 예제 모양을 따르고, 값은 모두 가짜입니다. 실제 채널·봇·사용자에게서 받은 값은 없습니다. 2026-11-15에 문서를 다시 확인했습니다.

| 파일 | 모양의 출처 | 바꾼 것 |
| --- | --- | --- |
| `skill-basic.json` | 카카오비즈니스 가이드 '스킬 개발 가이드 > 응답 타입별 JSON 포맷'의 SkillPayload 예제와 user.properties 예제(https://kakaobusiness.gitbook.io/main/tool/chatbot/skill_guide/answer_json_format) | ID는 가짜 24자, 사용자 키는 가짜 글, appUserId는 가짜 숫자 10개, 발화에 가짜 전화번호(마스킹 시험용) |
| `skill-callback.json` | '콜백 개발 가이드'의 userRequest 예제(https://kakaobusiness.gitbook.io/main/tool/chatbot/skill_guide/ai_chatbot_callback_guide) | 콜백 주소의 꼴은 문서에 없어 가짜로 만듦(실제 꼴은 K-05에서 기록) |
| `skill-review.json` | '스킬 개발 가이드 > 플러그인에 스킬 적용하기'의 이미지 보안전송 플러그인 호출값(https://kakaobusiness.gitbook.io/main/tool/chatbot/skill_guide/apply_skill_to_plugin) | 파라미터 이름을 대본의 `photos`로, `review_text`·`consent`를 더함. credential·signature는 가짜 |

메시지 ID나 Event API로 부른 요청의 실제 모양은 문서에 없어 견본을 만들지 않았습니다. 시험 채널의 실제 요청 기록(TASK-009)으로 봅니다.
