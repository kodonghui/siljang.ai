/**
 * 요청 본문 읽기(TASK-018). JSON으로 읽을 수 없으면 422 validation_failed와 본문 전체(/)의 bad_json,
 * 크기 한도를 넘으면 본문 전체의 too_long(06 fieldErrors).
 * 계약의 요청 스키마로 필드마다 검사하는 일(글자 필드의 NUL 문자는 bad_format 포함, 06 README 13절)은
 * 본문을 받는 API 작업마다 이 위에 더한다(첫 작업은 TASK-020).
 */
import type { Context } from "hono";
import type { HonoEnv } from "./app";
import { fieldError } from "./problem";

/** 본문의 가장 큰 크기(바이트). 사장님·운영자 명령의 본문은 작다. 사진은 따로 올린다(API-007). */
export const MAX_JSON_BYTES = 256 * 1024;

export async function readJsonBody(c: Context<HonoEnv>): Promise<unknown> {
  const text = await c.req.text();
  if (new TextEncoder().encode(text).length > MAX_JSON_BYTES) throw fieldError("/", "too_long");
  if (text.trim() === "") throw fieldError("/", "bad_json");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw fieldError("/", "bad_json");
  }
}
