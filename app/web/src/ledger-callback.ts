/** 코드가 브라우저 주소나 저장소에 남지 않게 콜백은 메모리에서 한 번만 전달한다. */
const RETURN_KEY = "siljang.ledger.return";
interface Pending {
  shopId: string;
  state: string;
  revision: string | null;
}
interface Grant {
  shopId: string;
  state: string;
  code: string;
  revision: string | null;
}
let grant: Grant | null = null;
export function beginLedgerReturn(value: Pending): void {
  grant = null;
  sessionStorage.setItem(RETURN_KEY, JSON.stringify(value));
}
export function acceptLedgerReturn(search: string): boolean {
  grant = null;
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
  } catch {
    return false;
  }
  if (!raw) return false;
  try {
    const value = JSON.parse(raw) as Partial<Pending>;
    const query = new URLSearchParams(search),
      code = query.get("code"),
      state = query.get("state");
    if (
      query.getAll("code").length !== 1 ||
      query.getAll("state").length !== 1 ||
      !code ||
      code.length > 2048 ||
      /\s/.test(code) ||
      !state ||
      !/^[A-Za-z0-9._-]{16,512}$/.test(state) ||
      value.state !== state ||
      typeof value.shopId !== "string" ||
      !(value.revision === null || typeof value.revision === "string")
    )
      return false;
    grant = { shopId: value.shopId, state, code, revision: value.revision };
    return true;
  } catch {
    return false;
  }
}
export function takeLedgerReturn(shopId: string): Omit<Grant, "shopId"> | null {
  const value = grant;
  grant = null;
  return value?.shopId === shopId ? { code: value.code, state: value.state, revision: value.revision } : null;
}
