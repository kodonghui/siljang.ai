/**
 * 웹이 서버 API를 부르는 곳은 이 모듈 하나다(tech-stack.md 9-3). 화면은 여기의 request만 쓴다.
 * 주소의 뿌리는 설정 값 하나(VITE_API_BASE, 없으면 같은 출처의 /api)에서만 온다.
 * 모델 호출과 비밀 값은 서버에만 있다. VITE_* 값은 브라우저에 그대로 실리므로 비밀 값을 넣지 않는다.
 */
import { type Problem, parseProblem } from "./problems";

export function normalizeBase(raw: string | undefined): string {
  const base = (raw ?? "").trim();
  if (base === "") return "/api";
  return base.replace(/\/+$/, "");
}

export const API_BASE = normalizeBase(import.meta.env.VITE_API_BASE);

/** 계약(api/openapi.yaml)의 경로를 API 주소로 바꾼다. path는 '/'로 시작하는 계약 경로다. */
export function apiUrl(path: string, base: string = API_BASE): string {
  if (!path.startsWith("/")) {
    throw new Error("API path must start with '/'");
  }
  return `${base}${path}`;
}

/** 04 G2·06 DEC-04의 요청 키 헤더와 같은 키로 다시 온 요청에 서버가 붙이는 헤더 */
export const REQUEST_KEY_HEADER = "Idempotency-Key";
export const REPLAYED_HEADER = "Idempotency-Replayed";

/**
 * 명령 하나의 요청 키. 06 IdempotencyKey(16~64자, 영문·숫자·_·-)에 맞는 'ui-' + 무작위 16바이트의 16진수(35자).
 * 명령마다 새로 만들고, 같은 요청을 다시 보낼 때('다시 시도', 처리 중 1초 뒤)만 다시 쓴다(command.ts).
 */
export function newRequestKey(
  fill: (bytes: Uint8Array<ArrayBuffer>) => void = (b) => crypto.getRandomValues(b),
): string {
  const bytes = new Uint8Array(16);
  fill(bytes);
  return `ui-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export interface ApiSuccess<T> {
  readonly ok: true;
  readonly status: number;
  readonly data: T;
  /** 같은 요청 키로 다시 보낸 요청에 처음 결과를 돌려줌(06 Idempotency-Replayed) */
  readonly replayed: boolean;
}

export interface ApiFailure {
  readonly ok: false;
  /** HTTP 상태. 연결하지 못했거나 응답을 끝까지 읽지 못했으면 0 */
  readonly status: number;
  /** 06 Problem으로 읽은 본문. Problem이 아니면 null */
  readonly problem: Problem | null;
  /** Retry-After(초). 429에서만 */
  readonly retryAfterSeconds: number | null;
}

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestOptions {
  readonly method?: Method;
  readonly body?: unknown;
  /** 명령의 요청 키. 쓰기 명령은 꼭(06은 쓰기 명령마다 Idempotency-Key를 요구함) */
  readonly key?: string;
  readonly signal?: AbortSignal;
  readonly cache?: RequestCache;
  readonly base?: string;
  readonly fetch?: typeof fetch;
}

function retryAfter(header: string | null): number | null {
  if (header === null || !/^\d+$/.test(header.trim())) return null;
  const seconds = Number(header.trim());
  return seconds >= 1 ? Math.min(seconds, 3600) : null;
}

const CONNECTION_FAILED: ApiFailure = { ok: false, status: 0, problem: null, retryAfterSeconds: null };

/**
 * API 하나를 부른다. 던지지 않고 결과를 돌려준다(연결 실패도 status 0의 실패).
 * signal로 멈춘 요청만 그 오류를 그대로 던진다.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { accept: "application/json, application/problem+json" };
  const init: RequestInit = { method, headers, credentials: "same-origin" };
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  if (options.key !== undefined) headers[REQUEST_KEY_HEADER] = options.key;
  if (options.signal !== undefined) init.signal = options.signal;
  if (options.cache !== undefined) init.cache = options.cache;
  const call = options.fetch ?? globalThis.fetch.bind(globalThis);
  let res: Response;
  let text: string;
  try {
    res = await call(apiUrl(path, options.base), init);
    text = await res.text();
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return CONNECTION_FAILED;
  }
  let body: unknown = null;
  if (text !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
  }
  if (res.ok) {
    if (body === undefined) return { ok: false, status: res.status, problem: null, retryAfterSeconds: null };
    return { ok: true, status: res.status, data: body as T, replayed: res.headers.get(REPLAYED_HEADER) === "true" };
  }
  const problem = parseProblem(body, res.status);
  return {
    ok: false,
    status: res.status,
    problem,
    retryAfterSeconds:
      res.status === 429 ? (retryAfter(res.headers.get("retry-after")) ?? problem?.retryAfterSeconds ?? null) : null,
  };
}
