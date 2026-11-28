// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { LedgerScreen } from "./LedgerScreen";
import { acceptLedgerReturn, beginLedgerReturn } from "./ledger-callback";
import { pickLedgerFile } from "./ledger-picker";

vi.mock("./ledger-picker", () => ({
  googleLedgerPickerSdk: vi.fn(async () => ({})),
  pickLedgerFile: vi.fn(async () => "sheet-selected-1234567890"),
}));
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": status >= 400 ? "application/problem+json" : "application/json" },
  });
const problem = (code: string, status: number) => ({
  type: `/problems/${code}`,
  title: "error",
  status,
  code,
  traceId: "0123456789abcdef0123456789abcdef",
  instance: "/api/owner/ledger",
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  sessionStorage.clear();
});
it("구글 복귀 뒤 선택한 파일만 연결하며 장애가 나면 코드를 재전송하지 않고 상태를 다시 읽는다", async () => {
  vi.stubEnv("VITE_LEDGER_PICKER_CLIENT_ID", "client");
  vi.stubEnv("VITE_LEDGER_PICKER_APP_ID", "123");
  vi.stubEnv("VITE_LEDGER_PICKER_API_KEY", "public-key");
  beginLedgerReturn({ shopId: "shop-1", state: "signed-state-123456", revision: null });
  expect(acceptLedgerReturn("?code=example-auth-code&state=signed-state-123456")).toBe(true);
  const calls: { method: string; body: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: RequestInit) => {
      calls.push({ method: init.method ?? "GET", body: String(init.body ?? "") });
      return init.method === "PUT" ? json(problem("google_unavailable", 503), 503) : json(problem("not_set", 404), 404);
    }),
  );
  render(
    <StrictMode>
      <LedgerScreen
        shopId="shop-1"
        shopName="가게"
        onNavigate={vi.fn()}
        onSessionExpired={vi.fn()}
        onRegisterShop={vi.fn()}
        onLogout={vi.fn()}
      />
    </StrictMode>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "구글 시트 선택" }));
  await screen.findByText("시트를 선택했어요");
  fireEvent.change(screen.getByLabelText("탭 이름"), { target: { value: "장부" } });
  fireEvent.click(screen.getByRole("button", { name: "연결" }));
  await screen.findByText(/구글 시트에 열이 이미 생겼을 수 있어요/);
  await waitFor(() => expect(calls.filter((call) => call.method === "GET").length).toBeGreaterThanOrEqual(2));
  expect(calls.filter((call) => call.method === "PUT")).toHaveLength(1);
  expect(JSON.parse(calls.find((call) => call.method === "PUT")?.body ?? "{}").spreadsheetId).toBe(
    "sheet-selected-1234567890",
  );
  expect(screen.queryByRole("button", { name: "연결" })).toBeNull();
});

it("파일 선택 오류가 나면 처리 중 상태를 풀고 권한을 다시 연결할 수 있다", async () => {
  vi.stubEnv("VITE_LEDGER_PICKER_CLIENT_ID", "client");
  vi.stubEnv("VITE_LEDGER_PICKER_APP_ID", "123");
  vi.stubEnv("VITE_LEDGER_PICKER_API_KEY", "public-key");
  beginLedgerReturn({ shopId: "shop-1", state: "signed-state-123456", revision: null });
  acceptLedgerReturn("?code=example-auth-code&state=signed-state-123456");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(problem("not_set", 404), 404)),
  );
  vi.mocked(pickLedgerFile).mockRejectedValueOnce(new Error("synthetic"));
  render(
    <StrictMode>
      <LedgerScreen
        shopId="shop-1"
        shopName="가게"
        onNavigate={vi.fn()}
        onSessionExpired={vi.fn()}
        onRegisterShop={vi.fn()}
        onLogout={vi.fn()}
      />
    </StrictMode>,
  );
  const choose = await screen.findByRole("button", { name: "구글 시트 선택" });
  await waitFor(() => expect((choose as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(choose);
  await screen.findByText("파일 선택을 열 수 없어요. 구글 연결을 다시 해 주세요");
  expect((screen.getByRole("button", { name: "구글 권한 다시 연결" }) as HTMLButtonElement).disabled).toBe(false);
});
it("연결된 장부에서 확인할 구글 시트를 연다", async () => {
  const id = "synthetic_sheet_1234567890";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json({ status: "linked", spreadsheetId: id, sheetName: "장부", revision: "v1", unwrittenCount: 1, columns: [] }),
    ),
  );
  render(
    <LedgerScreen
      shopId="shop-1"
      shopName="가게"
      onNavigate={vi.fn()}
      onSessionExpired={vi.fn()}
      onRegisterShop={vi.fn()}
      onLogout={vi.fn()}
    />,
  );
  const link = await screen.findByRole("link", { name: "구글 시트 열기" });
  expect(link.getAttribute("href")).toBe(`https://docs.google.com/spreadsheets/d/${id}/edit`);
});
