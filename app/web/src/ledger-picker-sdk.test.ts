// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { googleLedgerPickerSdk, pickLedgerFile } from "./ledger-picker";

afterEach(() => vi.unstubAllGlobals());
it("Google Picker에 최소 범위와 프로젝트를 넘기고 선택한 파일만 받는다", async () => {
  let consent: Record<string, unknown> = {},
    callback: ((data: unknown) => void) | undefined;
  const methods: Record<string, unknown> = {};
  class View {
    setIncludeFolders(value: boolean) {
      methods.folders = value;
      return this;
    }
    setSelectFolderEnabled(value: boolean) {
      methods.selectFolder = value;
      return this;
    }
    setMode(value: unknown) {
      methods.mode = value;
      return this;
    }
  }
  class Builder {
    setAppId(value: string) {
      methods.appId = value;
      return this;
    }
    setDeveloperKey(value: string) {
      methods.apiKey = value;
      return this;
    }
    setOAuthToken(value: string) {
      methods.token = value;
      return this;
    }
    addView() {
      return this;
    }
    setCallback(value: (data: unknown) => void) {
      callback = value;
      return this;
    }
    build() {
      return {
        setVisible: () =>
          callback?.({
            action: "picked",
            docs: [{ id: "chosen-sheet-1234567890", mimeType: "application/vnd.google-apps.spreadsheet" }],
          }),
      };
    }
  }
  vi.stubGlobal("google", {
    accounts: {
      oauth2: {
        initTokenClient: (options: Record<string, unknown>) => {
          consent = options;
          return {
            requestAccessToken: () =>
              (options.callback as (value: unknown) => void)({ access_token: "temporary", scope: options.scope }),
          };
        },
      },
    },
    picker: {
      DocsView: View,
      DocsViewMode: { LIST: "LIST" },
      ViewId: { SPREADSHEETS: "sheets" },
      PickerBuilder: Builder,
    },
  });
  vi.stubGlobal("gapi", { load: (_name: string, options: { callback(): void }) => options.callback() });
  const sdk = await googleLedgerPickerSdk();
  expect(await pickLedgerFile({ clientId: "client", appId: "123", apiKey: "key" }, sdk)).toBe(
    "chosen-sheet-1234567890",
  );
  expect(consent.scope).toBe("https://www.googleapis.com/auth/drive.file");
  expect(consent.include_granted_scopes).toBe(false);
  expect(methods).toMatchObject({ appId: "123", mode: "LIST", selectFolder: false });
});

it("Picker 오류 이벤트에서 대기가 끝나고 안전한 오류를 돌려준다", async () => {
  let callback: ((data: unknown) => void) | undefined;
  class View {
    setIncludeFolders() {
      return this;
    }
    setSelectFolderEnabled() {
      return this;
    }
    setMode() {
      return this;
    }
  }
  class Builder {
    setAppId() {
      return this;
    }
    setDeveloperKey() {
      return this;
    }
    setOAuthToken() {
      return this;
    }
    addView() {
      return this;
    }
    setCallback(fn: (data: unknown) => void) {
      callback = fn;
      return this;
    }
    build() {
      return { setVisible: () => callback?.({ action: "error", message: "sensitive-example" }) };
    }
  }
  vi.stubGlobal("google", {
    accounts: {
      oauth2: {
        initTokenClient: (options: Record<string, unknown>) => ({
          requestAccessToken: () =>
            (options.callback as (data: unknown) => void)({ access_token: "temporary", scope: options.scope }),
        }),
      },
    },
    picker: {
      DocsView: View,
      DocsViewMode: { LIST: "LIST" },
      ViewId: { SPREADSHEETS: "sheets" },
      PickerBuilder: Builder,
    },
  });
  vi.stubGlobal("gapi", { load: (_name: string, options: { callback(): void }) => options.callback() });
  const sdk = await googleLedgerPickerSdk();
  const result = await Promise.race([
    pickLedgerFile({ clientId: "client", appId: "123", apiKey: "key" }, sdk).then(
      () => "done",
      () => "error",
    ),
    new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 100)),
  ]);
  expect(result).toBe("error");
});
