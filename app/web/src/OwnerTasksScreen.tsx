import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";
import type { ApiFailure } from "./api";
import { formatKoreanDateTime, formatSeoulTime } from "./format-date";
import { appendReviewRows } from "./operator-shops-query";
import type { OwnerBanner } from "./owner";
import {
  fetchOwnerTasks,
  type OwnerTask,
  type OwnerTasksPage,
  ownerTasksHref,
  parseOwnerTasksSearch,
  TASK_LABELS,
  taskHref,
} from "./owner-tasks-api";
import { classify } from "./problems";
import type { ShopLicenseProps } from "./ShopLicense";
import { Banner, Button, type ListColumn, ListView, LoadFailure, type Navigate, OwnerLayout, Skeleton } from "./ui";
import "./owner-tasks.css";

interface Loaded extends OwnerTasksPage {
  readonly search: string;
  readonly at: number;
}
const BANNERS = {
  license_pending: {
    text: "운영자가 영업 신고를 확인하고 있어요",
    action: "영업 신고 보기",
    href: "/owner/shop/license",
  },
  license_on_hold: {
    text: "영업 신고 확인이 보류됐어요. 사유를 보고 수정해 주세요",
    action: "보류 사유 보기",
    href: "/owner/shop/license",
  },
  booking_link_not_ready: { text: "예약 링크를 준비해 주세요", action: "예약 링크 보기", href: "/owner/booking-link" },
  ledger_relink: { text: "장부를 다시 연결해 주세요", action: "장부 보기", href: "/owner/ledger" },
} as const;
const NETWORK: ApiFailure = { ok: false, status: 0, problem: null, retryAfterSeconds: null };
const isLate = (row: OwnerTask, at: number) =>
  row.closedAt === null &&
  (row.waitStatus === "late" ||
    (row.waitStatus === "waiting" && row.waitDueAt !== null && Date.parse(row.waitDueAt) <= at));
const WAIT_LABELS = { waiting: "기다림", late: "지연", answered: "답함", closed_no_answer: "답 없어 닫힘" } as const;

export function OwnerTasksScreen(
  props: ShopLicenseProps & { readonly banners?: readonly OwnerBanner[]; readonly registrationNotice?: boolean },
) {
  const { search } = useLocation();
  const query = useMemo(() => parseOwnerTasksSearch(search), [search]);
  const callbacks = useRef(props);
  callbacks.current = props;
  const blocked = Boolean(props.sessionChecking || props.sessionFailed || props.logoutPending);
  const blockedNow = useRef(blocked);
  blockedNow.current = blocked;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  const [failure, setFailure] = useState<{ readonly result: ApiFailure; readonly more: boolean } | null>(null);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState(false);
  const request = useRef<AbortController | null>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const focusOrigin = useRef<Element | null>(null);
  const pendingFocus = useRef(false);
  const id = useId();
  const current = loaded?.search === search ? loaded : null;
  const banners = (props.banners ?? []).filter((name): name is keyof typeof BANNERS => name !== "add_alert_channel");
  const read = useCallback(
    async (cursor: string | null, more: boolean) => {
      if (!query || request.current || blockedNow.current) return;
      const controller = new AbortController();
      request.current = controller;
      setLoading(true);
      setFailure(null);
      setMessage("");
      if (more) focusOrigin.current = document.activeElement;
      try {
        const result = await fetchOwnerTasks({ ...query, cursor }, controller.signal);
        if (controller.signal.aborted) return;
        if (result.ok) {
          setLoaded((old) => ({
            ...result.data,
            search,
            at: more && old?.search === search ? old.at : Date.now(),
            items:
              more && old?.search === search
                ? appendReviewRows(old.items, result.data.items, (row) => row.taskId)
                : result.data.items,
          }));
          if (more) {
            pendingFocus.current = true;
            setMessage(
              result.data.items.length
                ? `할 일 ${result.data.items.length}개를 더 불러왔어요`
                : "더 불러올 할 일이 없어요",
            );
          }
        } else if (result.status === 401 || result.status === 404) {
          setLoaded(null);
          setExpired(true);
          if (result.status === 401) callbacks.current.onSessionExpired();
          else callbacks.current.onRegisterShop();
        } else setFailure({ result, more });
      } catch {
        if (!controller.signal.aborted) setFailure({ result: NETWORK, more });
      } finally {
        if (request.current === controller) request.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [query, search],
  );
  useEffect(() => {
    void revision;
    if (!blocked) void read(query?.cursor ?? null, false);
    return () => {
      request.current?.abort();
      request.current = null;
      pendingFocus.current = false;
    };
  }, [read, query, revision, blocked]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") setRevision((old) => old + 1);
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);
  useLayoutEffect(() => {
    if (!message || !pendingFocus.current) return;
    pendingFocus.current = false;
    const active = document.activeElement;
    if (blockedNow.current || (active && active !== document.body && active !== focusOrigin.current)) return;
    status.current?.focus();
  }, [message]);
  const busy = blocked || (query !== null && loading);
  const navigate: Navigate = (href, event) => {
    event.preventDefault();
    if (!busy) props.onNavigate(href);
  };
  const refresh = () => setRevision((old) => old + 1);
  const firstHref = query ? ownerTasksHref({ ...query, cursor: null }) : "/owner";
  const first = (
    <a href={firstHref} onClick={(event) => navigate(firstHref, event)}>
      처음부터 보기
    </a>
  );
  const columns: readonly ListColumn<OwnerTask>[] = [
    { label: "종류", card: "title", cell: (row) => TASK_LABELS[row.kind] },
    {
      label: "요약",
      card: "body",
      cell: (row) => (
        <span className="owner-task-summary" title={row.summary}>
          {row.summary}
        </span>
      ),
    },
    { label: "주문번호", card: "meta", cell: (row) => row.order?.orderNo ?? "주문 없음" },
    { label: "연 시각", card: "meta", cell: (row) => formatKoreanDateTime(row.openedAt) },
    {
      label: "기다림",
      card: "tag",
      cell: (row) => (
        <span className="owner-task-wait" data-late={isLate(row, current?.at ?? Date.now()) || undefined}>
          {isLate(row, current?.at ?? Date.now())
            ? "지연"
            : row.waitStatus === null
              ? "기다림 없음"
              : WAIT_LABELS[row.waitStatus]}
        </span>
      ),
    },
  ];
  return (
    <OwnerLayout screen="SCR-016" title="할 일" shopName={props.shopName} onNavigate={navigate} busy={busy}>
      <section className="owner-tasks" aria-label="사장님 할 일">
        {props.registrationNotice ? <p role="status">가게를 등록했어요. 운영자가 영업 신고를 확인하고 있어요</p> : null}
        <section className="owner-task-banners" aria-label="가게 설정 안내" inert={busy}>
          {(expanded ? banners : banners.slice(0, 3)).map((name) => {
            const banner = BANNERS[name];
            return (
              <Banner
                key={name}
                tone="warning"
                actions={
                  <a href={banner.href} onClick={(e) => navigate(banner.href, e)}>
                    {banner.action}
                  </a>
                }
              >
                {banner.text}
              </Banner>
            );
          })}
          {banners.length > 3 ? (
            <Button
              kind="secondary"
              disabled={busy}
              aria-expanded={expanded}
              onClick={() => setExpanded((old) => !old)}
            >
              {expanded ? "배너 접기" : `배너 ${banners.length - 3}개 더`}
            </Button>
          ) : null}
        </section>
        {expired ? (
          <Skeleton label="로그인과 가게 정보를 확인해 주세요" />
        ) : (
          <>
            <div role="tablist" aria-label="할 일 상태" className="owner-task-tabs">
              {(["open", "closed"] as const).map((value, index) => (
                <button
                  key={value}
                  id={`${id}-${value}`}
                  type="button"
                  role="tab"
                  aria-selected={(query?.status ?? "open") === value}
                  aria-controls={`${id}-panel`}
                  disabled={busy}
                  tabIndex={(query?.status ?? "open") === value ? 0 : -1}
                  onClick={() =>
                    props.onNavigate(ownerTasksHref({ status: value, limit: query?.limit ?? 20, cursor: null }))
                  }
                  onKeyDown={(event) => {
                    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || busy) return;
                    event.preventDefault();
                    const target = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
                    document.getElementById(`${id}-${target === 0 ? "open" : "closed"}`)?.focus();
                    props.onNavigate(
                      ownerTasksHref({
                        status: target === 0 ? "open" : "closed",
                        limit: query?.limit ?? 20,
                        cursor: null,
                      }),
                    );
                  }}
                >
                  {value === "open" ? "열린 할 일" : "처리한 일"}
                </button>
              ))}
            </div>
            <div
              role="tabpanel"
              id={`${id}-panel`}
              aria-labelledby={`${id}-${query?.status ?? "open"}`}
              className="owner-task-panel"
            >
              {current ? (
                <Banner
                  tone="warning"
                  actions={
                    <Button kind="warn" disabled={busy} onClick={refresh}>
                      새로 고침
                    </Button>
                  }
                >
                  {formatSeoulTime(current.at)} 기준이에요
                </Banner>
              ) : null}
              <div inert={busy} aria-busy={busy}>
                {current ? (
                  <ListView
                    label="할 일 목록"
                    columns={columns}
                    rows={current.items}
                    rowKey={(row) => row.taskId}
                    href={taskHref}
                    onNavigate={navigate}
                    empty="지금 처리할 일이 없어요"
                  />
                ) : null}
              </div>
              {busy ? <Skeleton label="할 일을 불러오고 있어요" /> : null}
              {!query || failure?.result.status === 422 ? (
                <Banner tone="danger" actions={first}>
                  입력한 내용을 확인해 주세요
                </Banner>
              ) : failure ? (
                <LoadFailure
                  failure={classify(failure.result.status, failure.result.problem, failure.result.retryAfterSeconds)}
                  disabled={busy}
                  onRetry={() => (failure.more ? void read(current?.nextCursor ?? null, true) : refresh())}
                />
              ) : null}
              {current?.nextCursor && !failure ? (
                <Button
                  kind="secondary"
                  disabled={busy}
                  busy={loading}
                  onClick={() => void read(current.nextCursor, true)}
                >
                  더 보기
                </Button>
              ) : null}
              {message ? (
                <p ref={status} tabIndex={-1} role="status">
                  {message}
                </p>
              ) : null}
            </div>
          </>
        )}
        {props.logoutFailure ? (
          <LoadFailure failure={props.logoutFailure} disabled={busy} onRetry={props.onLogout} />
        ) : null}
        <Button kind="secondary" disabled={busy} busy={Boolean(props.logoutPending)} onClick={props.onLogout}>
          로그아웃
        </Button>
      </section>
    </OwnerLayout>
  );
}
