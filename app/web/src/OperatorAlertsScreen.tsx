import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";
import type { ApiFailure } from "./api";
import { formatKoreanDateTime, formatSeoulTime } from "./format-date";
import {
  fetchOperatorAlerts,
  OPERATOR_ALERT_LABELS,
  type OperatorAlert,
  type OperatorAlertsPage,
} from "./operator-alerts-api";
import { operatorAlertsHref, parseOperatorAlertsSearch } from "./operator-alerts-query";
import { appendReviewRows } from "./operator-shops-query";
import { classify } from "./problems";
import { Banner, Button, type ListColumn, ListView, LoadFailure, type Navigate, Skeleton } from "./ui";
import "./operator-alerts.css";

interface LoadedPage extends OperatorAlertsPage {
  readonly search: string;
  readonly at: number;
}
const columns: readonly ListColumn<OperatorAlert>[] = [
  { label: "종류", card: "title", cell: (row) => OPERATOR_ALERT_LABELS[row.kind] },
  {
    label: "가게",
    card: "meta",
    cell: (row) =>
      row.shop ? (
        <span className="operator-alert-shop" title={row.shop.name}>
          {row.shop.name}
        </span>
      ) : (
        "가게 정보 없음"
      ),
  },
  { label: "건수", card: "meta", cell: (row) => row.count.toLocaleString("ko-KR") },
  { label: "시각", card: "meta", cell: (row) => formatKoreanDateTime(row.createdAt) },
];
export function OperatorAlertsScreen({
  onNavigate,
  onSessionExpired,
  blocked = false,
}: {
  readonly onNavigate: Navigate;
  readonly onSessionExpired: () => void;
  readonly blocked?: boolean;
}) {
  const { search } = useLocation(),
    query = useMemo(() => parseOperatorAlertsSearch(search), [search]);
  const [loaded, setLoaded] = useState<LoadedPage | null>(null),
    [loading, setLoading] = useState(true),
    [expired, setExpired] = useState(false),
    [failure, setFailure] = useState<{ readonly result: ApiFailure; readonly more: boolean } | null>(null),
    [revision, setRevision] = useState(0),
    [message, setMessage] = useState("");
  const request = useRef<AbortController | null>(null),
    blockedNow = useRef(blocked),
    pendingFocus = useRef(false),
    origin = useRef<Element | null>(null),
    status = useRef<HTMLParagraphElement>(null);
  blockedNow.current = blocked;
  const current = loaded?.search === search ? loaded : null;
  const read = useCallback(
    async (cursor: string | null, more: boolean) => {
      if (!query || request.current || blockedNow.current) return;
      const controller = new AbortController();
      request.current = controller;
      setLoading(true);
      setFailure(null);
      if (more) {
        origin.current = document.activeElement;
        setMessage("");
      } else {
        setMessage("");
        setLoaded((old) => (old?.search === search ? old : null));
      }
      try {
        const result = await fetchOperatorAlerts({ limit: query.limit, cursor }, controller.signal);
        if (controller.signal.aborted) return;
        if (result.ok) {
          setLoaded((old) => ({
            search,
            items:
              more && old?.search === search
                ? appendReviewRows(old.items, result.data.items, (row) => row.alertId)
                : result.data.items,
            nextCursor: result.data.nextCursor,
            at: more && old?.search === search ? old.at : Date.now(),
          }));
          if (more) {
            pendingFocus.current = true;
            setMessage(
              result.data.items.length
                ? `알림 ${result.data.items.length}개를 더 불러왔어요`
                : "더 불러올 알림이 없어요",
            );
          }
        } else if (result.status === 401) {
          setLoaded(null);
          setExpired(true);
          onSessionExpired();
        } else setFailure({ result, more });
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        if (request.current === controller) request.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [query, search, onSessionExpired],
  );
  useEffect(() => {
    void revision;
    void read(query?.cursor ?? null, false);
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [read, query, revision]);
  useLayoutEffect(() => {
    if (!loaded || !message || !pendingFocus.current) return;
    pendingFocus.current = false;
    const active = document.activeElement;
    if (blockedNow.current || (active && active !== document.body && active !== origin.current)) return;
    if (status.current?.isConnected) {
      status.current.focus();
      if (document.activeElement !== status.current) status.current.focus();
    }
  }, [loaded, message]);
  const firstHref = query ? operatorAlertsHref({ ...query, cursor: null }) : "/operator/alerts";
  const first = (
    <a href={firstHref} onClick={(event) => onNavigate(firstHref, event)}>
      처음부터 보기
    </a>
  );
  if (expired) return <Skeleton label="다시 로그인해 주세요" />;
  if (!query)
    return (
      <Banner tone="danger" actions={first}>
        입력한 내용을 확인해 주세요
      </Banner>
    );
  const busy = blocked || loading || (!current && !failure);
  const refresh = () => setRevision((old) => old + 1);
  return (
    <section className="operator-alerts" aria-label="운영자 알림">
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
      {current ? (
        <ListView
          label="운영자 알림 목록"
          columns={columns}
          rows={current.items}
          rowKey={(row) => row.alertId}
          empty="운영자 알림이 없어요"
        />
      ) : null}
      {busy ? <Skeleton label="알림을 불러오고 있어요" /> : null}
      {failure ? (
        failure.result.status === 422 ? (
          <Banner tone="danger" actions={first}>
            입력한 내용을 확인해 주세요
          </Banner>
        ) : (
          <LoadFailure
            failure={classify(failure.result.status, failure.result.problem, failure.result.retryAfterSeconds)}
            disabled={busy}
            onRetry={() => (failure.more ? void read(current?.nextCursor ?? null, true) : refresh())}
          />
        )
      ) : null}
      {current?.nextCursor && !failure ? (
        <Button kind="secondary" disabled={busy} busy={loading} onClick={() => void read(current.nextCursor, true)}>
          더 보기
        </Button>
      ) : null}
      {current && message ? (
        <p ref={status} tabIndex={-1} role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
