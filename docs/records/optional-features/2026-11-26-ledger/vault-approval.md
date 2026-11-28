# TASK-156 장부 OAuth 토큰 저장 결정

- 승인자: 동희님(제품 책임자), 2026-11-28 Orca 실장님 항목 247, 질문 «TASK-156 장부 토큰을 Supabase Vault에 두는 예외를 허용할까요?»에 «Vault 허용(복구 땐 다시 연결)» 선택.
- 결정: 가게별 영속 OAuth 토큰을 무료 Supabase Vault에 좁은 권한으로 보관하는 예외를 허용합니다. 기존 public 전용 무료 백업에는 Vault가 포함되지 않으므로 DB 복구 후 사장님이 장부를 다시 연결합니다. 별도 Vault 복구는 만들지 않습니다.
- 근거: 기존 설정용 시크릿 저장소에는 가게별 토큰을 영속 저장하는 어댑터가 없고, public 전용 백업에는 Vault 토큰 행이 없습니다. 기존 제안과 보안 경계는 [WIP 결정안](https://github.com/kodonghui/siljang.ai/blob/e1c738938d632c3a2fdc342a071958155bfbe715/docs/records/optional-features/2026-11-26-ledger/credential-store-decision.md)에 있습니다.
- 상태: 결정 기록만 반영했습니다. 구현, 권한 시험, 실제 Vault 적용과 복구 후 재연결 확인은 아직 완료하지 않았습니다.
