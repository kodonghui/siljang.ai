// 시험 전 원래 배포/바인딩/큐를 대조하고, 끝나면 원래 버전으로 되돌린다.
// 기존 요청 로그는 켜지 않는다. 별도 인증된 합성 사진만 측정한다.
import kakaoWorker from "../kakao-test-2026-11/worker/src/index";
import photoProbe from "./runtime-probe";
import { withPhotoProbe } from "./wrap-existing-worker";

export default withPhotoProbe(kakaoWorker, photoProbe);
