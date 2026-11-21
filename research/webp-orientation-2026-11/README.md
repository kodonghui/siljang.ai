# WebP 방향과 Workers 한도 확인

TASK-183의 서버 회전 후보를 앱에 넣기 전에 검증한다. 사람 사진 없이 합성 사진만 쓴다.

- 기존 결과: 작은 정적·큰 해상도의 작은 압축 파일·두 프레임 애니메이션의 90도 회전은 Wrangler 원격 미리보기에서 통과했다. 큰 압축 파일과 방향 전체·CPU·메모리는 확인하지 않았다(앱 README 116).
- 이번 범위: 방향 2~8, 알파·프레임·시간·반복, 10·20MiB 입력, 큰 해상도와 여러 프레임을 확인한다. 자원 측정의 방법·범위와 한계를 결과에 함께 쓴다.
- 공식 문서 확인(2026-11-21): Images 바인딩은 `.transform()` 호출 순서로 변환을 적용하고 `.output({format, quality, anim})`으로 내보낸다. 로컬 개발의 바인딩 사용에는 사용 요금을 부과하지 않는다고 안내한다. 원격 고정밀 버전은 `wrangler dev --remote`로 확인한다. 실제 배포의 무료 플랜은 월 고유 변환 5,000건을 넘기면 새 변환을 오류로 막고 초과 과금하지 않는다고 안내한다. 유료 플랜 전환은 하지 않는다.
- 앱 통합: 아직 하지 않는다. 서버의 픽셀 방향, 촬영 정보 제거, 브라우저 표시, Workers 한도 증거를 먼저 확인한다. 실패가 두 번 반복되면 그 실행만 멈추고 결과와 다음 단계를 보존한다.

출처:

- [Images 바인딩](https://developers.cloudflare.com/images/optimization/binding/)
- [Images 가격](https://developers.cloudflare.com/images/pricing/)
- [Workers 한도](https://developers.cloudflare.com/workers/platform/limits/)
