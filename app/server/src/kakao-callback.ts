export const SKILL_ACK_MS = 4_000;
/** 응답 전송에 250ms를 남긴 내부 처리 기한. 전체 요청과 큐 발행이 같은 기준을 쓴다. */
export const SKILL_WORK_MS = SKILL_ACK_MS - 250;
export const SKILL_CALLBACK_MS = 55_000;
export const KAKAO_CONSULTATION_UNAVAILABLE_TEXT = "아직 상담을 받지 않아요";

type CallbackResult = "delivered" | "expired" | "unavailable";
type Fetch = (input: URL, init: RequestInit) => Promise<Response>;

export interface KakaoCallback {
  readonly url: URL;
  readonly deadline: number;
}

/** K-05에서 확인한 카카오 콜백 주소만 사용한다. 다른 주소·리다이렉트에는 요청을 보내지 않는다. */
export function kakaoCallback(raw: string | undefined, receivedAt: Date): KakaoCallback | null {
  if (raw === undefined || raw.length > 2_048) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (
    url.origin !== "https://bot-api.kakao.com" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    url.toString().length > 256 ||
    !/^\/v1\/callback\/[A-Za-z0-9_.~-]{1,180}$/.test(url.pathname)
  ) {
    return null;
  }
  const expires = url.searchParams.get("expires");
  if (expires !== null && !/^[0-9]{1,12}$/.test(expires)) return null;
  const received = receivedAt.getTime();
  const deadline = Math.min(received + SKILL_CALLBACK_MS, expires === null ? Infinity : Number(expires) * 1_000);
  return deadline > received ? { url, deadline } : null;
}

const MAX_ATTEMPT_MS = 6_000;
const TRANSIENT_CODES = [408, 429];
const MAX_RESULT_LENGTH = 4_096;

async function readSuccess(response: Response): Promise<boolean> {
  try {
    const declared = Number(response.headers.get("Content-Length") ?? 0);
    if (declared > MAX_RESULT_LENGTH) {
      await response.body?.cancel();
      return false;
    }
    const reader = response.body?.getReader();
    if (reader === undefined) return false;
    const utf8 = new TextDecoder();
    let body = "";
    let length = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_RESULT_LENGTH) {
        await reader.cancel();
        return false;
      }
      body += utf8.decode(chunk.value, { stream: true });
    }
    const parsed: unknown = JSON.parse(body + utf8.decode());
    return typeof parsed === "object" && parsed !== null && "status" in parsed && parsed.status === "SUCCESS";
  } catch {
    return false;
  }
}

/** 카카오가 성공을 확인하면 즉시 끝낸다. 다시 보내기는 연결 오류와 다시 받을 수 있는 HTTP 상태에 한 번만 한다. */
export async function deliverKakaoCallback(
  callback: KakaoCallback,
  message: string | readonly string[],
  options: { readonly fetch?: Fetch; readonly now?: () => number } = {},
): Promise<CallbackResult> {
  const send = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const texts = typeof message === "string" ? [message] : message;
  if (texts.length < 1 || texts.length > 3 || texts.some((text) => [...text].length < 1 || [...text].length > 1000))
    return "unavailable";
  const body = JSON.stringify({
    version: "2.0",
    template: { outputs: texts.map((text) => ({ simpleText: { text } })) },
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const left = callback.deadline - now();
    if (left <= 0) return "expired";
    let response: Response;
    try {
      response = await send(callback.url, {
        method: "POST",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(Math.min(MAX_ATTEMPT_MS, left)),
      });
    } catch {
      continue;
    }

    if (response.ok) return (await readSuccess(response)) ? "delivered" : "unavailable";
    await response.body?.cancel().catch(() => {});
    if (!TRANSIENT_CODES.includes(response.status) && response.status < 500) return "unavailable";
  }
  return "unavailable";
}
