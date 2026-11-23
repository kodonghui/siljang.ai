/** 소유한 외부 상태 주소만 호출한다. 응답 내용과 오류 원문은 돌려주지 않는다. */
export async function measure(url, count) {
  if (!Number.isInteger(count) || count < 1 || count > 51) throw new TypeError("invalid_count");
  let completed = 0;
  try {
    for (; completed < count; completed++) {
      const response = await fetch(url, { redirect: "manual" });
      await response.body?.cancel();
    }
    return { completed, limited: false, failed: false };
  } catch (error) {
    return {
      completed,
      limited: error instanceof Error && /too many subrequests/i.test(error.message),
      failed: true,
    };
  }
}
