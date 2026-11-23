import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import type { ApiFailure } from "./api";
import { formatKoreanDateTime, formatSeoulTime } from "./format-date";
import {
  type ChangeStatus,
  fetchIdentityChanges,
  fetchReviewShops,
  type IdentityChangeSummary,
  type ReviewShop,
} from "./operator-shops-api";
import { appendReviewRows, operatorEmptyMessage, operatorListHref, parseOperatorList } from "./operator-shops-query";
import { classify } from "./problems";
import { Banner, Button, type ListColumn, ListView, LoadFailure, type Navigate, Skeleton } from "./ui";
import "./operator-shops.css";

type Row = ReviewShop | IdentityChangeSummary;
interface LoadedPage {
  readonly search: string;
  readonly items: readonly Row[];
  readonly nextCursor: string | null;
  readonly at: number;
}
const rowKey = (row: Row) => ("changeId" in row ? row.changeId : row.shopId);
const short = (text: string) => (
  <span className="operator-shops-short" title={text}>
    {text}
  </span>
);
const shopColumns: readonly ListColumn<ReviewShop>[] = [
  { label: "가게 이름", card: "title", cell: (row) => short(row.name) },
  { label: "상호", card: "body", cell: (row) => short(row.businessName) },
  { label: "대표자", card: "meta", cell: (row) => short(row.representativeName) },
  {
    label: "사업자등록번호",
    card: "meta",
    cell: (row) => (
      <>
        {row.businessRegNo}
        {row.duplicateBusinessRegNo ? <strong className="operator-shops-warning">사업자등록번호 중복</strong> : null}
      </>
    ),
  },
  { label: "영업 신고 번호", card: "meta", cell: (row) => row.foodLicenseNo },
  {
    label: "영업 종류",
    card: "meta",
    cell: (row) => (row.foodBusinessType === "bakery" ? "제과점영업" : "즉석판매제조·가공업"),
  },
  { label: "등록 시각", card: "meta", cell: (row) => formatKoreanDateTime(row.createdAt) },
];
const changeColumns: readonly ListColumn<IdentityChangeSummary>[] = [
  { label: "가게 이름", card: "title", cell: (row) => short(row.shop.name) },
  { label: "상호 변경", card: "body", cell: (row) => short(`${row.previous.businessName} → ${row.businessName}`) },
  {
    label: "대표자 변경",
    card: "meta",
    cell: (row) => short(`${row.previous.representativeName} → ${row.representativeName}`),
  },
  { label: "사업자등록번호 변경", card: "meta", cell: (row) => `${row.previous.businessRegNo} → ${row.businessRegNo}` },
  {
    label: "결제 계좌",
    card: "body",
    cell: (row) =>
      row.paymentAccount ? (
        <>
          {row.paymentAccount.bankName} · {row.paymentAccount.holderName} · 끝 {row.paymentAccount.accountLast4}
          {!row.paymentAccount.holderMatchesNew ? (
            <strong className="operator-shops-warning">예금주가 새 대표자·상호와 달라요</strong>
          ) : null}
        </>
      ) : (
        "등록된 결제 계좌가 없어요"
      ),
  },
  { label: "요청 시각", card: "meta", cell: (row) => formatKoreanDateTime(row.requestedAt) },
];

export function OperatorShopsList({
  onNavigate,
  onSessionExpired,
  blocked = false,
}: {
  readonly onNavigate: Navigate;
  readonly onSessionExpired: () => void;
  readonly blocked?: boolean;
}) {
  const { search } = useLocation();
  const navigate = useNavigate();
  const filter = useMemo(() => parseOperatorList(search), [search]);
  const [loaded, setLoaded] = useState<LoadedPage | null>(null);
  const [failure, setFailure] = useState<{ readonly result: ApiFailure; readonly more: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  const [revision, setRevision] = useState(0);
  const request = useRef<AbortController | null>(null);
  const blockedNow = useRef(blocked);
  blockedNow.current = blocked;
  const current = loaded?.search === search ? loaded : null;
  const read = useCallback(
    async (cursor: string | null, more: boolean) => {
      if (!filter || request.current || blockedNow.current) return;
      const controller = new AbortController();
      request.current = controller;
      setLoading(true);
      setFailure(null);
      if (!more) setLoaded((old) => (old?.search === search ? old : null));
      try {
        const result =
          filter.tab === "shops"
            ? await fetchReviewShops({ status: filter.status, cursor }, controller.signal)
            : await fetchIdentityChanges({ status: filter.status, cursor }, controller.signal);
        if (controller.signal.aborted) return;
        if (result.ok) {
          setLoaded((old) => ({
            search,
            items:
              more && old?.search === search
                ? appendReviewRows<Row>(old.items, result.data.items, rowKey)
                : result.data.items,
            nextCursor: result.data.nextCursor,
            at: more && old?.search === search ? old.at : Date.now(),
          }));
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
    [filter, search, onSessionExpired],
  );
  useEffect(() => {
    void revision;
    void read(filter?.cursor ?? null, false);
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [read, filter, revision]);
  const refresh = () => setRevision((old) => old + 1);
  const firstHref = filter ? operatorListHref({ ...filter, cursor: null }) : "/operator/shops";
  const initialLink = (
    <a href={firstHref} onClick={(event) => onNavigate(firstHref, event)}>
      처음부터 보기
    </a>
  );
  if (expired) return <Skeleton label="다시 로그인해 주세요" />;
  if (!filter)
    return (
      <Banner tone="danger" actions={initialLink}>
        입력한 내용을 확인해 주세요
      </Banner>
    );
  const busy = blocked || loading || (current === null && failure === null);
  const tabs = [
    { label: "확인 중", tab: "shops", status: "pending" },
    { label: "보류", tab: "shops", status: "on_hold" },
    { label: "확인됨", tab: "shops", status: "verified" },
    { label: "사업자 정보 변경", tab: "identity", status: "pending" },
  ] as const;
  const failureView = failure ? (
    failure.result.status === 422 ? (
      <Banner tone="danger" actions={initialLink}>
        입력한 내용을 확인해 주세요
      </Banner>
    ) : (
      <LoadFailure
        failure={classify(failure.result.status, failure.result.problem, failure.result.retryAfterSeconds)}
        disabled={busy}
        onRetry={() => (failure.more ? void read(current?.nextCursor ?? null, true) : refresh())}
      />
    )
  ) : null;
  return (
    <section className="operator-shops" aria-label="가게 확인 목록">
      <nav className="operator-shops-tabs" aria-label="가게 확인 상태">
        {tabs.map((tab) => {
          const href =
            tab.tab === "shops"
              ? operatorListHref({ tab: "shops", status: tab.status, cursor: null })
              : operatorListHref({ tab: "identity", status: "pending", cursor: null });
          return (
            <a
              key={tab.label}
              href={href}
              aria-current={
                filter.tab === tab.tab && (tab.tab === "identity" || filter.status === tab.status) ? "page" : undefined
              }
              aria-disabled={blocked || undefined}
              onClick={(event) => (blocked ? event.preventDefault() : onNavigate(href, event))}
            >
              {tab.label}
            </a>
          );
        })}
      </nav>
      {filter.tab === "identity" ? (
        <label className="operator-shops-filter">
          변경 상태
          <select
            aria-label="사업자 정보 변경 상태"
            value={filter.status}
            disabled={blocked}
            onChange={(event) => {
              // select 변경은 같은 출처의 고정 목록 주소만 사용한다.
              const href = operatorListHref({
                tab: "identity",
                status: event.target.value as ChangeStatus,
                cursor: null,
              });
              navigate(href, { replace: true });
            }}
          >
            <option value="pending">확인 중</option>
            <option value="on_hold">보류</option>
            <option value="applied">반영됨</option>
          </select>
        </label>
      ) : null}
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
        filter.tab === "shops" ? (
          <ListView
            label="영업 신고 확인 목록"
            columns={shopColumns}
            rows={current.items as readonly ReviewShop[]}
            rowKey={(row) => row.shopId}
            href={(row) => `/operator/shops/${row.shopId}`}
            onNavigate={onNavigate}
            empty={operatorEmptyMessage(filter)}
          />
        ) : (
          <ListView
            label="사업자 정보 변경 요청 목록"
            columns={changeColumns}
            rows={current.items as readonly IdentityChangeSummary[]}
            rowKey={(row) => row.changeId}
            href={(row) => `/operator/shops/${row.shop.shopId}`}
            onNavigate={onNavigate}
            empty={operatorEmptyMessage(filter)}
          />
        )
      ) : null}
      {busy ? <Skeleton label="목록을 불러오고 있어요" /> : null}
      {failureView}
      {current?.nextCursor && !failure ? (
        <Button kind="secondary" disabled={busy} busy={busy} onClick={() => void read(current.nextCursor, true)}>
          더 보기
        </Button>
      ) : null}
    </section>
  );
}
