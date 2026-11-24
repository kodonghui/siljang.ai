import { type ComponentType, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ApiFailure, ApiResult } from "./api";
import { formatSeoulDateTime } from "./format-date";
import { classify } from "./problems";
import type { ShopLicenseProps } from "./ShopLicense";
import { Banner, Button, EmptyState, LoadFailure, OwnerLayout, Skeleton } from "./ui";
import { focusReady } from "./ui/useFocusRequest";
import { parseVersion, type VersionList } from "./version-history-api";
import "./version-history.css";

type Read<T> = { kind: "loading" } | { kind: "failed"; failure: ApiFailure } | { kind: "ready"; data: T };
const network: ApiFailure = { ok: false, status: 0, problem: null, retryAfterSeconds: null };
export interface VersionHistoryConfig<T> {
  readonly path: "/owner/price-list" | "/owner/operating-rules";
  readonly screen: string;
  readonly name: string;
  readonly note: string;
  readonly currentLabel: string;
  readonly emptyText: string;
  readonly createLabel: string;
  readonly timestampLabel: string;
  readonly list: (signal?: AbortSignal) => Promise<ApiResult<VersionList>>;
  readonly detail: (value: string, signal?: AbortSignal) => Promise<ApiResult<T>>;
  readonly Details: ComponentType<{ readonly value: T }>;
}
interface VersionHistoryProps<T> extends ShopLicenseProps {
  readonly version?: string | null;
  readonly config: VersionHistoryConfig<T>;
}
function useWide() {
  const [wide, setWide] = useState(
    () => typeof window.matchMedia === "function" && window.matchMedia("(min-width: 1260px)").matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(min-width: 1260px)"),
      change = () => setWide(query.matches);
    query.addEventListener("change", change);
    change();
    return () => query.removeEventListener("change", change);
  }, []);
  return wide;
}
export function VersionHistory<T>(props: VersionHistoryProps<T>) {
  const config = props.config;
  const { list: fetchVersions, detail: fetchVersion } = config;
  const callbacks = useRef(props);
  callbacks.current = props;
  const [list, setList] = useState<Read<VersionList>>({ kind: "loading" }),
    [detail, setDetail] = useState<{ key: string; read: Read<T> } | null>(null),
    [shown, setShown] = useState(20);
  const listCompleted = useRef(false),
    previousVersion = useRef<string | null>(null),
    readyVersion = useRef<string | null>(null);
  const listRequest = useRef<AbortController | null>(null),
    detailRequest = useRef<AbortController | null>(null),
    permission = useRef(false),
    listRegion = useRef<HTMLElement | null>(null),
    returnFocus = useRef<{ version: string; origin: Element | null } | null>(null),
    more = useRef<HTMLDivElement | null>(null);
  const wide = useWide(),
    explicit = props.version !== null && props.version !== undefined;
  const selected = explicit
    ? String(parseVersion(props.version ?? "") ?? props.version)
    : wide && list.kind === "ready" && list.data.items[0]
      ? String(list.data.items[0].version)
      : null;
  const report = useCallback((failure: ApiFailure) => {
    if (permission.current) return;
    if (failure.status === 401) {
      permission.current = true;
      callbacks.current.onSessionExpired();
    } else if (failure.problem?.code === "shop_not_registered") {
      permission.current = true;
      callbacks.current.onRegisterShop();
    }
  }, []);
  const readList = useCallback(() => {
    if (callbacks.current.sessionChecking || callbacks.current.sessionFailed) return;
    listCompleted.current = false;
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    setList({ kind: "loading" });
    void fetchVersions(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        listCompleted.current = true;
        if (result.ok) {
          setList({ kind: "ready", data: result.data });
          setShown(20);
        } else {
          setList({ kind: "failed", failure: result });
          report(result);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          listCompleted.current = true;
          setList({ kind: "failed", failure: network });
        }
      });
  }, [fetchVersions, report]);
  useEffect(() => {
    if (props.sessionChecking || props.sessionFailed || (explicit && !wide)) {
      listRequest.current?.abort();
      return;
    }
    if (!listCompleted.current) readList();
    return () => listRequest.current?.abort();
  }, [readList, props.sessionChecking, props.sessionFailed, explicit, wide]);
  const readDetail = useCallback(
    (value: string) => {
      if (callbacks.current.sessionChecking || callbacks.current.sessionFailed) return;
      readyVersion.current = null;
      detailRequest.current?.abort();
      const controller = new AbortController();
      detailRequest.current = controller;
      setDetail({ key: value, read: { kind: "loading" } });
      void fetchVersion(value, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          if (result.ok) {
            readyVersion.current = value;
            setDetail({ key: value, read: { kind: "ready", data: result.data } });
          } else {
            setDetail({ key: value, read: { kind: "failed", failure: result } });
            report(result);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setDetail({ key: value, read: { kind: "failed", failure: network } });
        });
    },
    [fetchVersion, report],
  );
  useEffect(() => {
    if (props.sessionChecking || props.sessionFailed) {
      detailRequest.current?.abort();
      return;
    }
    if (selected !== null) {
      if (readyVersion.current !== selected) readDetail(selected);
    } else {
      readyVersion.current = null;
      detailRequest.current?.abort();
      setDetail(null);
    }
    return () => detailRequest.current?.abort();
  }, [selected, readDetail, props.sessionChecking, props.sessionFailed]);
  const currentDetail = detail?.key === selected ? detail.read : null;
  const pending =
      (!props.sessionFailed &&
        (((!explicit || wide) && list.kind === "loading") ||
          (selected !== null && (currentDetail === null || currentDetail.kind === "loading")))) ||
      Boolean(props.logoutPending || props.sessionChecking),
    locked = pending || Boolean(props.sessionFailed);
  const total = list.kind === "ready" ? list.data.items.length : 0;
  useEffect(() => {
    const element = more.current;
    if (!element || locked || shown >= total || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setShown((n) => Math.min(total, n + 20));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [locked, shown, total]);
  useLayoutEffect(() => {
    const previous = previousVersion.current;
    previousVersion.current = explicit ? selected : null;
    if (explicit) {
      returnFocus.current = null;
      return;
    }
    if (previous !== null && returnFocus.current === null)
      returnFocus.current = { version: previous, origin: document.activeElement };
  }, [explicit, selected]);
  useLayoutEffect(() => {
    const request = returnFocus.current;
    if (!request) return;
    if (props.sessionFailed) {
      returnFocus.current = null;
      return;
    }
    if (explicit || locked) return;
    returnFocus.current = null;
    const active = document.activeElement;
    if (active && active !== document.body && active !== request.origin) return;
    const target = Array.from(listRegion.current?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? []).find(
      (link) => link.getAttribute("href") === `${config.path}/versions/${request.version}`,
    );
    if (!focusReady(target)) focusReady(listRegion.current);
  }, [explicit, locked, props.sessionFailed, config.path]);
  const navigate = (path: string) => {
    if (locked) return;
    returnFocus.current =
      explicit && selected !== null && path === `${config.path}/versions`
        ? { version: selected, origin: document.activeElement }
        : null;
    props.onNavigate(path);
  };
  const failure = (value: ApiFailure, retry: () => void) => (
    <LoadFailure
      failure={classify(value.status, value.problem, value.retryAfterSeconds)}
      disabled={locked}
      onRetry={() => {
        if (!locked) retry();
      }}
      onLogin={props.onSessionExpired}
      onRegisterShop={props.onRegisterShop}
      notFoundAction={
        <Button disabled={locked} onClick={() => navigate(`${config.path}/versions`)}>
          버전 목록으로
        </Button>
      }
    />
  );
  return (
    <OwnerLayout
      screen={config.screen}
      title={`${config.name} 버전 이력`}
      shopName={props.shopName}
      back={explicit ? `${config.path}/versions` : config.path}
      busy={locked}
      onNavigate={(href, event) => {
        event.preventDefault();
        navigate(href);
      }}
    >
      <div className="version-history">
        <p>{config.note}</p>
        <div className="version-history__actions">
          <Button disabled={locked} onClick={() => navigate(config.path)}>
            {config.currentLabel}
          </Button>
          <Button
            disabled={pending}
            busy={Boolean(props.logoutPending)}
            onClick={() => {
              if (!pending) props.onLogout();
            }}
          >
            로그아웃
          </Button>
        </div>
        {props.logoutFailure ? <Banner tone="danger">{props.logoutFailure.message}</Banner> : null}
        <div className="version-history__panes">
          <section
            className={`version-history__versions ${explicit && !wide ? "ui-wide-only" : ""}`}
            aria-label={`${config.name} 버전 목록`}
            ref={listRegion}
            tabIndex={-1}
          >
            {list.kind === "loading" ? (
              <Skeleton rows={4} label={`${config.name} 버전 목록을 불러오고 있어요`} />
            ) : list.kind === "failed" ? (
              failure(list.failure, readList)
            ) : list.data.items.length === 0 ? (
              <EmptyState>
                {config.emptyText}
                <Button disabled={locked} onClick={() => navigate(config.path)}>
                  {config.createLabel}
                </Button>
              </EmptyState>
            ) : (
              <>
                <ul>
                  {list.data.items.slice(0, shown).map((item) => (
                    <li key={item.version}>
                      <a
                        href={`${config.path}/versions/${item.version}`}
                        aria-current={selected === String(item.version) ? (explicit ? "page" : "true") : undefined}
                        aria-disabled={locked}
                        onClick={(event) => {
                          event.preventDefault();
                          navigate(`${config.path}/versions/${item.version}`);
                        }}
                      >
                        <strong>
                          버전 {item.version}
                          {item.supersededAt === null ? " · 현재" : ""}
                        </strong>
                        <span>
                          {config.timestampLabel} 시각 {formatSeoulDateTime(item.createdAt)}
                        </span>
                        {item.supersededAt !== null ? (
                          <span>바뀐 시각 {formatSeoulDateTime(item.supersededAt)}</span>
                        ) : null}
                      </a>
                    </li>
                  ))}
                </ul>
                {shown < total ? (
                  <>
                    <div ref={more} className="version-history__more" aria-hidden="true" />
                    <Button
                      disabled={locked}
                      onClick={() => {
                        if (!locked) setShown((n) => Math.min(total, n + 20));
                      }}
                    >
                      버전 더 보기
                    </Button>
                    <p>
                      {shown}/{total}개
                    </p>
                  </>
                ) : null}
              </>
            )}
          </section>
          {selected !== null ? (
            <section className="version-history__detail" aria-label={`고른 ${config.name}`}>
              {currentDetail === null || currentDetail.kind === "loading" ? (
                <Skeleton rows={4} label="고른 버전을 불러오고 있어요" />
              ) : currentDetail.kind === "failed" ? (
                failure(currentDetail.failure, () => readDetail(selected))
              ) : (
                <config.Details value={currentDetail.data} />
              )}
              {explicit && currentDetail?.kind !== "failed" ? (
                <Button disabled={locked} onClick={() => navigate(`${config.path}/versions`)}>
                  버전 목록으로
                </Button>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </OwnerLayout>
  );
}
