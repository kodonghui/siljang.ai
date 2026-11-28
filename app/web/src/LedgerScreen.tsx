import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { newRequestKey, request } from "./api";
import { acceptLedgerReturn, beginLedgerReturn, takeLedgerReturn } from "./ledger-callback";
import { googleLedgerPickerSdk, type LedgerPickerSdk, pickLedgerFile } from "./ledger-picker";
import { classifyLedgerLink } from "./problems";
import type { ShopLicenseProps } from "./ShopLicense";
import { Banner, Button, OwnerLayout, Skeleton } from "./ui";

const CALLBACK = "/owner/ledger/callback";
type Ledger = {
  status: "linked" | "auth_lost" | "unlinked";
  spreadsheetId: string;
  sheetName: string;
  revision: string;
  unwrittenCount: number;
  columns: { header: string; column: string }[];
};
type Grant = { code: string; state: string; revision: string | null };
function parseLedger(value: unknown): Ledger | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    !["linked", "auth_lost", "unlinked"].includes(String(v.status)) ||
    typeof v.spreadsheetId !== "string" ||
    !/^[A-Za-z0-9_-]{20,100}$/.test(v.spreadsheetId) ||
    typeof v.sheetName !== "string" ||
    typeof v.revision !== "string" ||
    !Number.isSafeInteger(v.unwrittenCount) ||
    !Array.isArray(v.columns) ||
    !v.columns.every(
      (item: unknown) =>
        item &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>).header === "string" &&
        typeof (item as Record<string, unknown>).column === "string",
    )
  )
    return null;
  return v as Ledger;
}
/** 콜백 주소의 인가 코드를 읽자마자 주소에서 지우고 일회성 메모리로만 넘긴다. */
export function LedgerCallback() {
  const location = useLocation(),
    navigate = useNavigate(),
    handled = useRef(false);
  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const ok = acceptLedgerReturn(location.search);
    window.history.replaceState(window.history.state, "", CALLBACK);
    navigate(ok ? "/owner/ledger" : "/owner/ledger?authorization=failed", { replace: true });
  }, [location.search, navigate]);
  return <main aria-busy="true">구글 연결을 확인하고 있어요</main>;
}
export function LedgerScreen(props: ShopLicenseProps & { readonly shopId: string }) {
  const [ledger, setLedger] = useState<Ledger | null>(null),
    [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const [grant, setGrant] = useState<Grant | null>(null),
    [sheet, setSheet] = useState<string | null>(null);
  const [sheetName, setSheetName] = useState(""),
    [picker, setPicker] = useState<LedgerPickerSdk | null>(null);
  const mounted = useRef(true),
    pickerRequested = useRef(false),
    returnTaken = useRef(false),
    readGeneration = useRef(0);
  const blocked = Boolean(props.sessionChecking || props.sessionFailed || props.logoutPending || busy);
  const config = {
    clientId: import.meta.env.VITE_LEDGER_PICKER_CLIENT_ID ?? "",
    appId: import.meta.env.VITE_LEDGER_PICKER_APP_ID ?? "",
    apiKey: import.meta.env.VITE_LEDGER_PICKER_API_KEY ?? "",
  };
  const refresh = useCallback(async () => {
    const generation = ++readGeneration.current;
    setLoading(true);
    const result = await request<unknown>("/owner/ledger", { expectedShopId: props.shopId });
    if (!mounted.current || generation !== readGeneration.current) return;
    if (result.ok) {
      const value = parseLedger(result.data);
      if (value) setLedger(value);
      else setMessage("장부 상태를 불러오지 못했어요. 다시 확인해 주세요");
    } else if (result.problem?.code === "not_set") setLedger(null);
    else if (result.status === 401) props.onSessionExpired();
    else if (result.problem?.code === "shop_not_registered") props.onRegisterShop();
    else setMessage("장부 상태를 불러오지 못했어요. 다시 확인해 주세요");
    setLoading(false);
  }, [props.shopId, props.onSessionExpired, props.onRegisterShop]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      readGeneration.current += 1;
    };
  }, []);
  useEffect(() => {
    if (props.sessionChecking || props.sessionFailed || returnTaken.current) return;
    returnTaken.current = true;
    setGrant(takeLedgerReturn(props.shopId));
    if (window.location.search.includes("authorization=failed")) setMessage("구글 연결을 다시 해 주세요");
  }, [props.shopId, props.sessionChecking, props.sessionFailed]);
  useEffect(() => {
    if (!props.sessionChecking && !props.sessionFailed) void refresh();
  }, [props.sessionChecking, props.sessionFailed, refresh]);
  useEffect(() => {
    if (!grant || pickerRequested.current) return;
    pickerRequested.current = true;
    void googleLedgerPickerSdk()
      .then((sdk) => {
        if (mounted.current) setPicker(sdk);
      })
      .catch(() => {
        if (mounted.current) setMessage("파일 선택을 열 수 없어요. 구글 연결을 다시 해 주세요");
      });
  }, [grant]);
  async function start() {
    if (blocked || loading) return;
    setBusy(true);
    setMessage(null);
    setGrant(null);
    setSheet(null);
    pickerRequested.current = false;
    setPicker(null);
    try {
      const result = await request<{ authorizationUrl: string; state: string; expiresAt: string }>(
        "/owner/ledger/authorization",
        {
          method: "POST",
          body: { redirectUri: new URL(CALLBACK, window.location.origin).href },
          expectedShopId: props.shopId,
        },
      );
      if (!mounted.current) return;
      if (!result.ok) {
        setMessage("구글 연결을 시작하지 못했어요. 다시 시도해 주세요");
        return;
      }
      const url = new URL(result.data.authorizationUrl);
      if (
        url.protocol !== "https:" ||
        url.hostname !== "accounts.google.com" ||
        url.pathname !== "/o/oauth2/v2/auth" ||
        url.searchParams.get("state") !== result.data.state ||
        !/^[A-Za-z0-9._-]{16,512}$/.test(result.data.state)
      )
        throw new Error("invalid authorization address");
      beginLedgerReturn({ shopId: props.shopId, state: result.data.state, revision: ledger?.revision ?? null });
      window.location.assign(url.href);
    } catch {
      if (mounted.current) setMessage("구글 연결을 시작하지 못했어요. 다시 시도해 주세요");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function choose() {
    if (!picker || blocked) return;
    setBusy(true);
    setMessage(null);
    try {
      const chosen = await pickLedgerFile(config, picker);
      if (mounted.current && chosen) setSheet(chosen);
    } catch {
      if (mounted.current) setMessage("파일 선택을 열 수 없어요. 구글 연결을 다시 해 주세요");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function connect() {
    if (!grant || !sheet || !sheetName.trim() || blocked) return;
    const submitted = grant;
    setGrant(null);
    setBusy(true);
    setMessage(null);
    try {
      const result = await request<unknown>("/owner/ledger", {
        method: "PUT",
        key: newRequestKey(),
        expectedShopId: props.shopId,
        body: {
          baseRevision: submitted.revision,
          code: submitted.code,
          state: submitted.state,
          spreadsheetId: sheet,
          sheetName: sheetName.trim(),
        },
      });
      if (!mounted.current) return;
      if (result.ok) {
        setMessage("장부를 연결했어요");
        await refresh();
      } else {
        const failure = classifyLedgerLink(result.status, result.problem, result.retryAfterSeconds);
        setMessage(failure.message);
        if (result.status === 401) props.onSessionExpired();
        else if (result.problem?.code === "shop_not_registered") props.onRegisterShop();
        await refresh();
      }
    } catch {
      if (mounted.current) {
        setMessage("현재 연결 상태를 확인하고 구글 권한부터 다시 연결해 주세요");
        await refresh();
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function unlink() {
    if (blocked) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await request<unknown>("/owner/ledger", {
        method: "DELETE",
        key: newRequestKey(),
        expectedShopId: props.shopId,
      });
      if (!mounted.current) return;
      setMessage(
        result.ok
          ? "연결을 해제했어요. 기다리던 쓰기는 다시 연결하면 적어요"
          : "연결 상태를 확인하고 다시 시도해 주세요",
      );
      await refresh();
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <OwnerLayout
      screen="SCR-042"
      title="장부 연결"
      shopName={props.shopName}
      back="/owner/shop"
      busy={blocked}
      onNavigate={(href, event) => {
        event.preventDefault();
        if (!blocked) props.onNavigate(href);
      }}
    >
      <div className="ui-stack" aria-busy={busy || loading}>
        {message && <Banner tone="danger">{message}</Banner>}
        {loading ? (
          <Skeleton />
        ) : ledger ? (
          <>
            <p>{ledger.status === "linked" ? "연결됨" : "다시 연결해 주세요"}</p>
            <p>{ledger.sheetName}</p>
            <a
              href={`https://docs.google.com/spreadsheets/d/${ledger.spreadsheetId}/edit`}
              target="_blank"
              rel="noopener noreferrer"
            >
              구글 시트 열기
            </a>
            <p>못 적은 주문 {ledger.unwrittenCount}건</p>
            <ul>
              {ledger.columns.map((column) => (
                <li key={column.column}>
                  {column.header} {column.column}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>장부는 고를 수 있는 기능이에요. 연결하면 주문을 구글 시트에 적어요.</p>
        )}
        <p>사장님이 만든 열은 고치지 않아요.</p>
        {grant ? (
          <>
            <p>같은 구글 계정으로 연결할 파일을 골라 주세요.</p>
            <Button disabled={!picker || blocked} onClick={() => void choose()}>
              {sheet ? "파일 다시 선택" : "구글 시트 선택"}
            </Button>
            {sheet && <p>시트를 선택했어요</p>}
            <label>
              탭 이름 <input value={sheetName} maxLength={100} onChange={(event) => setSheetName(event.target.value)} />
            </label>
            <Button disabled={!sheet || !sheetName.trim() || blocked} onClick={() => void connect()}>
              연결
            </Button>
            <Button disabled={blocked || loading} onClick={() => void start()}>
              구글 권한 다시 연결
            </Button>
          </>
        ) : (
          <Button
            disabled={blocked || loading || !config.clientId || !config.appId || !config.apiKey}
            onClick={() => void start()}
          >
            {ledger ? "다시 연결" : "구글 계정 연결"}
          </Button>
        )}
        {ledger?.status === "linked" && (
          <Button disabled={blocked} onClick={() => void unlink()}>
            연결 해제
          </Button>
        )}
        {!config.clientId || !config.appId || !config.apiKey ? <p>구글 파일 선택을 준비하고 있어요.</p> : null}
      </div>
    </OwnerLayout>
  );
}
