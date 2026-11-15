/**
 * 요청 본문 읽기(TASK-018). JSON으로 읽을 수 없으면 422 validation_failed와 본문 전체(/)의 bad_json,
 * 크기 한도를 넘으면 본문 전체의 too_long(06 fieldErrors).
 * 한도는 읽으면서 센다(Content-Length가 없거나 틀려도 한도를 넘는 순간 멈추고, 본문 전체를 메모리에 올리지 않음).
 * 본문은 이 함수가 한 번 읽는다. 처리기는 c.req.json()·text()를 다시 부르지 않고 이 결과를 쓴다.
 * 계약의 요청 스키마로 필드마다 검사하는 일(글자 필드의 NUL 문자는 bad_format 포함, 06 README 13절)은
 * 본문을 받는 API 작업마다 이 위에 더한다(첫 작업은 TASK-020).
 */
import type { Context } from "hono";
import type { HonoEnv } from "./app";
import { fieldError } from "./problem";

/** 본문의 가장 큰 크기(바이트). 사장님·운영자 명령의 본문은 작다. 사진은 따로 올린다(API-007). */
export const MAX_JSON_BYTES = 256 * 1024;

const DIGITS = /^\d+$/;

/** 한도까지만 읽는다. 넘으면 읽기를 멈추고(cancel) too_long. UTF-8이 아니면 bad_json. */
async function readLimited(req: Request, limit: number): Promise<string> {
  const declared = req.headers.get("content-length");
  if (declared !== null && DIGITS.test(declared) && Number(declared) > limit) throw fieldError("/", "too_long");
  if (req.body === null) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw fieldError("/", "too_long");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw fieldError("/", "bad_json");
  }
}

export async function readJsonBody(c: Context<HonoEnv>): Promise<unknown> {
  const text = await readLimited(c.req.raw, MAX_JSON_BYTES);
  if (text.trim() === "") throw fieldError("/", "bad_json");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw fieldError("/", "bad_json");
  }
}
