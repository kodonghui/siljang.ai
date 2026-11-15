/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API 주소의 뿌리. 없으면 같은 출처의 /api. VITE_* 값은 브라우저에 그대로 실리므로 비밀 값을 넣지 않는다. */
  readonly VITE_API_BASE?: string;
}
