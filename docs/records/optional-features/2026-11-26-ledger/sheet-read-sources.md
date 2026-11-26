# 구글 시트 조회 공식 문서

2026-11-26에 확인했습니다. 실제 구글 계정의 인증/조회/쓰기는 실행하지 않았습니다.

- https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get : fields와 ranges로 필요한 속성/범위만 요청합니다.
- https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate : 요청을 함께 적용하되 동시 편집 뒤 상태까지 같다고 보장하지 않습니다. 헤더 쓰기 구현과 동시 편집 검사는 아직 남았습니다.
- https://developers.google.com/workspace/sheets/api/guides/metadata : PROJECT 메타데이터도 비밀 값이나 보안 수단으로 쓰지 않습니다. 장부 열은 서버의 별도 HMAC 서명과 실제 헤더를 함께 검증해야 합니다.

조회 모듈은 고정 Sheets API에 토큰을 Authorization 헤더로만 보내고 첫 행/필요한 속성만 읽습니다. 응답은2MiB로 제한합니다. 잘못된/큰 응답과 리디렉션·통신 오류는 원문 없이 서비스 오류로 닫습니다. 시트에 권한이 없거나 탭이 없으면 연결하지 않습니다.
