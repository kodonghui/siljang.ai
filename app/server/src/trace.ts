/** 추적 ID: W3C trace-id 꼴(소문자 16진수 32자, 06 Problem.traceId). 모두 0인 값은 쓰지 않는다. */
export function newTraceId(): string {
  const bytes = new Uint8Array(16);
  let hex = "";
  do {
    crypto.getRandomValues(bytes);
    hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  } while (/^0+$/.test(hex));
  return hex;
}
