/**
 * 웹이 서버 API를 부르는 곳은 이 모듈 하나다(tech-stack.md 9-3).
 * 주소의 뿌리는 설정 값 하나(VITE_API_BASE, 없으면 같은 출처의 /api)에서만 온다.
 * 모델 호출과 비밀 값은 서버에만 있다. VITE_* 값은 브라우저에 그대로 실리므로 비밀 값을 넣지 않는다.
 */

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
