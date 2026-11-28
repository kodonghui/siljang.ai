/** Google에서 직접 받은 브라우저 액세스 토큰은 Picker 호출에만 쓰고 보관하지 않는다. */
export const LEDGER_PICKER_SCOPE = "https://www.googleapis.com/auth/drive.file";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
export interface LedgerPickerConfig {
  clientId: string;
  appId: string;
  apiKey: string;
}
export interface LedgerPickerSdk {
  access(clientId: string, scope: string): Promise<string>;
  choose(input: {
    appId: string;
    apiKey: string;
    accessToken: string;
  }): Promise<{ id: string; mimeType: string } | null>;
}
export async function pickLedgerFile(config: LedgerPickerConfig, sdk: LedgerPickerSdk): Promise<string | null> {
  if (!config.clientId || !/^\d+$/.test(config.appId) || !config.apiKey) throw new Error("picker is not configured");
  const accessToken = await sdk.access(config.clientId, LEDGER_PICKER_SCOPE);
  const file = await sdk.choose({ appId: config.appId, apiKey: config.apiKey, accessToken });
  return file && file.mimeType === SHEET_MIME && /^[A-Za-z0-9_-]{20,100}$/.test(file.id) ? file.id : null;
}

type PickerData = { action?: string; docs?: { id?: string; mimeType?: string }[] };
type PickerView = {
  setIncludeFolders(v: boolean): PickerView;
  setSelectFolderEnabled(v: boolean): PickerView;
  setMode(v: unknown): PickerView;
};
type PickerBuilder = {
  addView(v: PickerView): PickerBuilder;
  setAppId(v: string): PickerBuilder;
  setDeveloperKey(v: string): PickerBuilder;
  setOAuthToken(v: string): PickerBuilder;
  setCallback(callback: (data: PickerData) => void): PickerBuilder;
  build(): { setVisible(visible: boolean): void };
};
type GoogleSdk = {
  accounts: {
    oauth2: {
      initTokenClient(options: {
        client_id: string;
        scope: string;
        include_granted_scopes: false;
        callback(result: { access_token?: string; error?: string; scope?: string }): void;
        error_callback(): void;
      }): { requestAccessToken(options: { prompt: string }): void };
    };
  };
  picker: {
    DocsView: new (view: unknown) => PickerView;
    ViewId: { SPREADSHEETS: unknown };
    DocsViewMode: { LIST: unknown };
    PickerBuilder: new () => PickerBuilder;
  };
};
type GoogleWindow = Window & {
  google?: GoogleSdk;
  gapi?: {
    load(name: string, options: { callback(): void; onerror(): void; timeout: number; ontimeout(): void }): void;
  };
};
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      script.remove();
      reject(new Error("picker script timeout"));
    }, 10000);
    script.src = src;
    script.async = true;
    script.onload = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    script.onerror = () => {
      window.clearTimeout(timeout);
      script.remove();
      reject(new Error("picker script unavailable"));
    };
    document.head.append(script);
  });
}
export async function googleLedgerPickerSdk(): Promise<LedgerPickerSdk> {
  const root = window as GoogleWindow;
  if (!root.google?.accounts?.oauth2) await loadScript("https://accounts.google.com/gsi/client");
  if (!root.gapi) await loadScript("https://apis.google.com/js/api.js");
  if (!root.google?.accounts?.oauth2 || !root.gapi) throw new Error("picker unavailable");
  await new Promise<void>((resolve, reject) =>
    root.gapi?.load("picker", {
      callback: resolve,
      onerror: () => reject(new Error("picker unavailable")),
      timeout: 10000,
      ontimeout: () => reject(new Error("picker unavailable")),
    }),
  );
  if (!root.google.picker) throw new Error("picker unavailable");
  const google = root.google;
  return {
    access(clientId, scope) {
      return new Promise((resolve, reject) => {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope,
          include_granted_scopes: false,
          callback: (result) =>
            result.access_token && (result.scope === undefined || result.scope.trim() === scope)
              ? resolve(result.access_token)
              : reject(new Error("picker authorization denied")),
          error_callback: () => reject(new Error("picker authorization unavailable")),
        });
        client.requestAccessToken({ prompt: "select_account" });
      });
    },
    choose({ appId, apiKey, accessToken }) {
      return new Promise((resolve, reject) => {
        const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
          .setIncludeFolders(true)
          .setSelectFolderEnabled(false)
          .setMode(google.picker.DocsViewMode.LIST);
        const picker = new google.picker.PickerBuilder()
          .setAppId(appId)
          .setDeveloperKey(apiKey)
          .setOAuthToken(accessToken)
          .addView(view)
          .setCallback((data) => {
            if (data.action === "error") reject(new Error("picker unavailable"));
            if (data.action === "cancel") resolve(null);
            if (data.action === "picked") {
              const file = data.docs?.[0];
              resolve(file?.id && file.mimeType ? { id: file.id, mimeType: file.mimeType } : null);
            }
          })
          .build();
        picker.setVisible(true);
      });
    },
  };
}
