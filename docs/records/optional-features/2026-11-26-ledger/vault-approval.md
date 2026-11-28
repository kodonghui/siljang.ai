# TASK-156 장부 OAuth 토큰 저장 결정

- 승인자: 동희님(제품 책임자), 2026-11-28 Orca 실장님 항목 247, 질문 «TASK-156 장부 토큰을 Supabase Vault에 두는 예외를 허용할까요?»에 «Vault 허용(복구 땐 다시 연결)» 선택.
- 결정: 가게별 영속 OAuth 토큰을 무료 Supabase Vault에 좁은 권한으로 보관하는 예외를 허용합니다. 기존 public 전용 무료 백업에는 Vault가 포함되지 않으므로 DB 복구 후 사장님이 장부를 다시 연결합니다. 별도 Vault 복구는 만들지 않습니다.
- 근거: 기존 설정용 시크릿 저장소에는 가게별 토큰을 영속 저장하는 어댑터가 없고, public 전용 백업에는 Vault 토큰 행이 없습니다. 기존 제안과 보안 경계는 [WIP 결정안](https://github.com/kodonghui/siljang.ai/blob/e1c738938d632c3a2fdc342a071958155bfbe715/docs/records/optional-features/2026-11-26-ledger/credential-store-decision.md)에 있습니다.
- 초기 상태: 승인 당시 구현은 없었습니다. 이후 앱 암호화와 로컬 모의 Vault 권한 시험을 추가했으며, 실제 Vault 적용과 복구 후 재연결 확인은 아직 완료하지 않았습니다.

2026-11-28 실장님은 Orca 작업 답변(msg_f97415889703)에서 동희님의 Vault 허용 범위 안에서 플랫폼 제약을 받아들이고 Worker 비밀 키를 쓰는 기존 앱 암호화로 OAuth 토큰을 먼저 암호화해 Vault에 암호문만 저장하도록 결정했습니다. `service_role` 직접 권한 금지는 평문을 읽지 못하게 하는 조건으로 해석하며, `siljang_runtime`·`anon`·`authenticated`에는 Vault 직접 권한을 주지 않고 전용 SECURITY DEFINER 함수만 사용합니다. [Supabase 공식 문서](https://supabase.com/kb/troubleshooting/revoking-privileges-on-storage-pg_cron-vault-and-extension-objects-has-no-effect-916576)는 Vault의 `service_role` 기본 권한을 개별 프로젝트에서 회수할 수 없다고 설명합니다. 앱 서버 소스, Worker 설정, CI 워크플로와 도구에서 `service[_-]?role|serviceRole`을 검색한 결과 일치 항목은 없었습니다(검색은 코드·설정에 한정하며 실제 환경의 모든 권한을 확인한 것은 아닙니다).
