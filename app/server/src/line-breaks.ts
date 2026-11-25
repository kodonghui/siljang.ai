/** 표시·내용 비교에 쓰는 줄바꿈. 저장된 원문은 호출자가 그대로 보존한다. */
export function normalizeLineBreaks(value: string): string {
  return value.replace(/\r\n?/gu, "\n");
}
