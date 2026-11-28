// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import { acceptLedgerReturn, beginLedgerReturn, takeLedgerReturn } from "./ledger-callback";

beforeEach(() => sessionStorage.clear());
it("동일 가게의 일회성 콜백만 메모리에서 넘기고 코드는 저장하지 않는다", () => {
  beginLedgerReturn({ shopId: "shop-1", state: "signed-state-123456", revision: "123" });
  expect(acceptLedgerReturn("?code=example-auth-code&state=signed-state-123456")).toBe(true);
  expect(JSON.stringify(sessionStorage)).not.toContain("example-auth-code");
  expect(takeLedgerReturn("shop-2")).toBeNull();
  expect(takeLedgerReturn("shop-1")).toBeNull();
});
it("상태가 다른 콜백은 거부하고 같은 콜백은 한 번만 쓴다", () => {
  beginLedgerReturn({ shopId: "shop-1", state: "signed-state-123456", revision: null });
  expect(acceptLedgerReturn("?code=code&state=other-state-123456")).toBe(false);
  beginLedgerReturn({ shopId: "shop-1", state: "signed-state-123456", revision: null });
  expect(acceptLedgerReturn("?code=code&state=signed-state-123456")).toBe(true);
  expect(takeLedgerReturn("shop-1")).toEqual({ code: "code", state: "signed-state-123456", revision: null });
  expect(takeLedgerReturn("shop-1")).toBeNull();
});
