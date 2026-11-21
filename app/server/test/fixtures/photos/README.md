# 사진 정규화 시험 자료

`pixel-source.webp`은 사람 사진이 없는 합성 방향6 입력입니다. `research/webp-orientation-2026-11/fixtures.py`의 `still-6.webp`에서 생성했고 카메라·시각·위치는 모두 가짜입니다.

`pixel-result.webp`은 같은 입력을 Cloudflare Images의 실제 원격 미리보기에서 처리해 받은 결과입니다. 2026-11-22의 공개 실행 보고서와 독립 Pillow 검사에서 촬영 정보 제거·96×160 픽셀 방향·알파를 확인했습니다. 단위 시험은 이 기록된 응답을 외부 서비스 대신 사용하며 실제 코덱 방향은 별도의 합성20개·Chromium·Workers 검증으로 확인합니다.
