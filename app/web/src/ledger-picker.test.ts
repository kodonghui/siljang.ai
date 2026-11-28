import { describe, expect, it, vi } from "vitest";
import { type LedgerPickerSdk, pickLedgerFile } from "./ledger-picker";

describe("장부 파일 선택", () => {
  it("선택한 시트 하나만 돌리고 최소 권한을 요청한다", async () => {
    const choose = vi.fn(async () => ({
      id: "selected-sheet-id-123456789",
      mimeType: "application/vnd.google-apps.spreadsheet",
    }));
    const access = vi.fn(async () => "example-browser-token");
    const sdk: LedgerPickerSdk = { access, choose };
    expect(await pickLedgerFile({ clientId: "client", appId: "123", apiKey: "key" }, sdk)).toBe(
      "selected-sheet-id-123456789",
    );
    expect(access).toHaveBeenCalledWith("client", "https://www.googleapis.com/auth/drive.file");
    expect(choose).toHaveBeenCalledWith({ appId: "123", apiKey: "key", accessToken: "example-browser-token" });
  });
  it("선택 취소와 시트가 아닌 파일은 연결하지 않는다", async () => {
    const access = vi.fn(async () => "example-browser-token");
    expect(
      await pickLedgerFile({ clientId: "c", appId: "1", apiKey: "k" }, { access, choose: async () => null }),
    ).toBeNull();
    expect(
      await pickLedgerFile(
        { clientId: "c", appId: "1", apiKey: "k" },
        { access, choose: async () => ({ id: "x", mimeType: "text/plain" }) },
      ),
    ).toBeNull();
  });
});
