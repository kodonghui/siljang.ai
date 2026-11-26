# TASK156 구글 권한과 토큰 저장소 조사

확인일:2026-11-26. 실제 계정/설정/토큰 호출은 하지 않았습니다.

- [Sheets API 권한](https://developers.google.com/workspace/sheets/api/scopes): Sheets 권한과 파일별 권한을 구분합니다. 현재 API035는 시트ID를 서버에서 받고 토큰은 응답하지 않으므로 Sheets 권한 하나를 요청합니다. 실제 Google 승인/동의 화면은 미확인입니다.
- [Drive 파일별 권한](https://developers.google.com/workspace/drive/api/guides/api-specific-auth): drive.file와 Google Picker의 조합을 설명합니다. 현재 응답 계약에 OAuth 토큰을 더하지 않습니다.
- [서버 OAuth 코드 흐름](https://developers.google.com/identity/protocols/oauth2/web-server): 인가 코드 교환·offline 권한·서버 토큰 처리를 대조했습니다.
- [Supabase Vault](https://supabase.com/docs/guides/database/vault): 암호화된 비밀 값과 생성/갱신 함수·복호화 뷰의 권한을 설명합니다. 저장소 후보 조사이며 실제 설치/무료 요금/실행 역할 확인이나 구현 완료 근거가 아닙니다.
