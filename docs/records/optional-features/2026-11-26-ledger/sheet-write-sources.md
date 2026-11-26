# 장부 열 쓰기의 공식 계약과 확인 범위

2026-11-26 확인. 실제 구글 계정의 조회/쓰기/토큰 호출은 하지 않았습니다.

- https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/request#InsertDimensionRequest : 정해진 인덱스에 새 열을 삽입합니다. 기존 셀에 바로 덮어쓰는 요청을 만들지 않습니다.
- https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate : 새 열/헤더/메타데이터를 한 요청으로 적용합니다. 협업자 편집과의 완전한 격리까지 보장하는 것으로 해석하지 않습니다.
- https://developers.google.com/workspace/sheets/api/guides/metadata : 메타데이터의 가게/파일/탭/범위/헤더는 서버 HMAC과 실제 헤더로 함께 검증합니다. PROJECT 가시성 자체를 보안 수단으로 쓰지 않습니다.

모의 Google API에서는 읽은 뒤 추가된 협업자 자료도 삽입으로 보존하고, 적용 뒤 응답이 유실되면 다음 호출의 서명 확인으로 기존 열을 재사용했습니다. 실제 Google API에서의 새 열/다시 연결/동시 편집 확인은 미실행입니다. 토큰 저장 위치 결정과 API035/036 연결도 남았습니다.
