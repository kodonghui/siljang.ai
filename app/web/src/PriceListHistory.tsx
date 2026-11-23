import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiFailure } from "./api";
import type { PriceList } from "./price-list-api";
import {
  fetchPriceListVersion,
  fetchPriceListVersions,
  type PriceVersions,
  priceVersion,
} from "./price-list-history-api";
import { classify } from "./problems";
import type { ShopLicenseProps } from "./ShopLicense";
import { Banner, Button, EmptyState, ListView, LoadFailure, OwnerLayout, Skeleton } from "./ui";
import "./price-list-history.css";

type Read<T> = { kind: "loading" } | { kind: "failed"; failure: ApiFailure } | { kind: "ready"; data: T };
const network: ApiFailure = { ok: false, status: 0, problem: null, retryAfterSeconds: null };
const dateFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul",
  dateStyle: "short",
  timeStyle: "short",
});
const date = (value: string) => dateFormatter.format(new Date(value));
const groups = { size: "크기", flavor: "맛", design: "디자인", extra: "추가" };
const money = (list: PriceList["options"][number]) =>
  list.priceKind === "from"
    ? `${list.amount.toLocaleString("ko-KR")}원부터`
    : list.priceKind === "range"
      ? `${list.amount.toLocaleString("ko-KR")}~${list.amountMax?.toLocaleString("ko-KR")}원`
      : `${list.amount.toLocaleString("ko-KR")}원`;
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
export function PriceListHistory(props: ShopLicenseProps & { readonly version?: string | null }) {
  const callbacks = useRef(props);
  callbacks.current = props;
  const [list, setList] = useState<Read<PriceVersions>>({ kind: "loading" }),
    [detail, setDetail] = useState<{ key: string; read: Read<PriceList> } | null>(null),
    [shown, setShown] = useState(20);
  const listCompleted = useRef(false),
    readyVersion = useRef<string | null>(null);
  const listRequest = useRef<AbortController | null>(null),
    detailRequest = useRef<AbortController | null>(null),
    permission = useRef(false),
    more = useRef<HTMLDivElement | null>(null);
  const wide = useWide(),
    explicit = props.version !== null && props.version !== undefined;
  const selected = explicit
    ? String(priceVersion(props.version ?? "") ?? props.version)
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
    void fetchPriceListVersions(controller.signal)
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
  }, [report]);
  useEffect(() => {
    if (props.sessionChecking || props.sessionFailed) {
      listRequest.current?.abort();
      return;
    }
    if (!listCompleted.current) readList();
    return () => listRequest.current?.abort();
  }, [readList, props.sessionChecking, props.sessionFailed]);
  const readDetail = useCallback(
    (value: string) => {
      if (callbacks.current.sessionChecking || callbacks.current.sessionFailed) return;
      readyVersion.current = null;
      detailRequest.current?.abort();
      const controller = new AbortController();
      detailRequest.current = controller;
      setDetail({ key: value, read: { kind: "loading" } });
      void fetchPriceListVersion(value, controller.signal)
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
    [report],
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
  const navigate = (path: string) => {
    if (!locked) props.onNavigate(path);
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
        <Button disabled={locked} onClick={() => navigate("/owner/price-list/versions")}>
          버전 목록으로
        </Button>
      }
    />
  );
  return (
    <OwnerLayout
      screen="SCR-037"
      title="가격표 버전 이력"
      shopName={props.shopName}
      back={explicit ? "/owner/price-list/versions" : "/owner/price-list"}
      busy={locked}
      onNavigate={(href, event) => {
        event.preventDefault();
        navigate(href);
      }}
    >
      <div className="price-history">
        <p>이전 버전은 고칠 수 없어요</p>
        <div className="price-history__actions">
          <Button disabled={locked} onClick={() => navigate("/owner/price-list")}>
            현재 가격표로
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
        <div className="price-history__panes">
          <section
            className={`price-history__versions ${explicit && !wide ? "ui-wide-only" : ""}`}
            aria-label="가격표 버전 목록"
          >
            {list.kind === "loading" ? (
              <Skeleton rows={4} label="가격표 버전 목록을 불러오고 있어요" />
            ) : list.kind === "failed" ? (
              failure(list.failure, readList)
            ) : list.data.items.length === 0 ? (
              <EmptyState>
                아직 저장한 가격표가 없어요
                <Button disabled={locked} onClick={() => navigate("/owner/price-list")}>
                  가격표 만들기
                </Button>
              </EmptyState>
            ) : (
              <>
                <ul>
                  {list.data.items.slice(0, shown).map((item) => (
                    <li key={item.version}>
                      <a
                        href={`/owner/price-list/versions/${item.version}`}
                        aria-current={selected === String(item.version) ? (explicit ? "page" : "true") : undefined}
                        aria-disabled={locked}
                        onClick={(event) => {
                          event.preventDefault();
                          navigate(`/owner/price-list/versions/${item.version}`);
                        }}
                      >
                        <strong>
                          버전 {item.version}
                          {item.supersededAt === null ? " · 현재" : ""}
                        </strong>
                        <span>저장 시각 {date(item.createdAt)}</span>
                        {item.supersededAt !== null ? <span>바뀐 시각 {date(item.supersededAt)}</span> : null}
                      </a>
                    </li>
                  ))}
                </ul>
                {shown < total ? (
                  <>
                    <div ref={more} className="price-history__more" aria-hidden="true" />
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
            <section className="price-history__detail" aria-label="고른 가격표">
              {currentDetail === null || currentDetail.kind === "loading" ? (
                <Skeleton rows={4} label="고른 버전을 불러오고 있어요" />
              ) : currentDetail.kind === "failed" ? (
                failure(currentDetail.failure, () => readDetail(selected))
              ) : (
                <VersionDetails list={currentDetail.data} />
              )}
              {explicit && currentDetail?.kind !== "failed" ? (
                <Button disabled={locked} onClick={() => navigate("/owner/price-list/versions")}>
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
function VersionDetails({ list }: { readonly list: PriceList }) {
  const option = (id: string) => list.options.find((o) => o.optionId === id)?.name ?? "연결 없음";
  return (
    <>
      <h2>버전 {list.version} (고른 버전)</h2>
      <p>
        저장 시각 {date(list.createdAt)}
        {list.current ? " · 현재" : list.supersededAt ? ` · 바뀐 시각 ${date(list.supersededAt)}` : ""}
      </p>
      <section>
        <h3>옵션</h3>
        <ListView
          label="고른 버전 옵션"
          rows={list.options}
          rowKey={(row) => row.optionId}
          empty="옵션이 없어요"
          columns={[
            { label: "이름", cell: (row) => row.name, card: "title" },
            { label: "그룹", cell: (row) => groups[row.group], card: "meta" },
            { label: "금액", cell: money, card: "body" },
            {
              label: "기본 디자인 범위",
              cell: (row) => (row.inStandard ? "범위 안" : "맞춤 주문으로만"),
              card: "meta",
            },
          ]}
        />
      </section>
      <section>
        <h3>옵션 규칙</h3>
        <ListView
          label="고른 버전 옵션 규칙"
          rows={list.rules}
          rowKey={(row) => JSON.stringify([row.optionAId, row.optionBId])}
          empty="옵션 규칙이 없어요"
          columns={[
            { label: "옵션 A", cell: (row) => option(row.optionAId), card: "title" },
            { label: "옵션 B", cell: (row) => option(row.optionBId), card: "meta" },
            {
              label: "규칙",
              cell: (row) =>
                row.kind === "exclude" ? "함께 못 고름" : `${row.amount?.toLocaleString("ko-KR")}원 더함`,
              card: "body",
            },
          ]}
        />
      </section>
      <section>
        <h3>도안</h3>
        {list.designs.length === 0 ? (
          <EmptyState>도안이 없어요</EmptyState>
        ) : (
          <ul className="price-history__designs">
            {list.designs.map((design) => (
              <li key={design.designId}>
                <HistoryImage design={design} />
                <strong>{design.name}</strong>
                <span>{design.optionId === null ? "연결 없음" : option(design.optionId)}</span>
                <span>{design.inStandard ? "기본 디자인 범위" : "맞춤 주문으로만"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
function HistoryImage({ design }: { readonly design: PriceList["designs"][number] }) {
  const [failed, setFailed] = useState<string | null>(null);
  return failed === design.imageUrl ? (
    <p>도안 그림을 불러오지 못했어요.</p>
  ) : (
    <img
      src={design.imageUrl}
      alt={`${design.name} 그림`}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(design.imageUrl)}
    />
  );
}
