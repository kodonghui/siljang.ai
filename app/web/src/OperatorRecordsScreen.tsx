import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useLocation } from "react-router";
import { type ApiFailure, newRequestKey } from "./api";
import {
  fetchOperatorConsultation,
  fetchOperatorOrder,
  fetchOperatorRecords,
  type OperatorOriginalInput,
  type OperatorRecordKind,
  openOperatorOriginal,
} from "./operator-records-api";
import { classify } from "./problems";
import { type Navigate, Skeleton } from "./ui";
import { keepFocusInside } from "./ui/focus";
import "./operator-records.css";

type Data = Record<string, unknown>;
type Target = { kind: OperatorOriginalInput["targetKind"]; id: string; label: string; cursor?: string };
const rows = (value: unknown): Data[] => (Array.isArray(value) ? (value as Data[]) : []);
const text = (value: unknown) => (value == null ? "—" : String(value));
const names: Record<string, string> = {
  confirmed: "확정",
  requested: "요청",
  awaiting_payment: "결제 대기",
  payment_overdue: "결제 기한 지남",
  received: "인도 완료",
  no_pickup: "미수령",
  rejected: "거절",
  cancelled: "취소",
  open: "진행 중",
  awaiting_owner: "사장님 확인 대기",
  dropped: "종료",
  ordered: "주문 완료",
  ended: "종료",
  deleted: "삭제됨",
  first: "첫 결제",
  reissue: "재발행",
  difference: "차액",
  paid: "입금 확인",
  claimed: "입금 확인 요청",
  mismatch: "금액 불일치",
  expired: "만료",
  closed: "종료",
  customer: "손님",
  ai: "AI",
  system: "시스템",
  text: "글",
  photo: "사진",
  card: "카드",
  unsupported: "지원하지 않는 메시지",
  phone: "전화번호",
  account: "계좌번호",
  full: "전액",
  partial: "일부",
  none: "없음",
  customer_cancel: "손님 취소",
  shop_cancel: "가게 사정 취소",
  change_reduced: "변경 차액",
  compensation: "보상",
  paid_after_cancel: "취소 뒤 입금",
  over_received: "초과 입금",
};
function display(value: unknown): string {
  if (typeof value === "string") {
    if (names[value]) return names[value];
    if (/^\d{4}-\d\d-\d\dT/.test(value))
      return new Date(value).toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        dateStyle: "medium",
        timeStyle: "short",
      });
  }
  return typeof value === "number" ? value.toLocaleString("ko-KR") : text(value);
}
const formattedFields = new Set([
  "status",
  "kind",
  "cause",
  "decision",
  "author",
  "at",
  "createdAt",
  "pickupAt",
  "finishedAt",
  "contractKeepUntil",
  "issueKeepUntil",
  "issuePurgedAt",
  "issuedAt",
  "paidAt",
  "decidedAt",
  "sentAt",
  "amount",
  "version",
]);
function Value({ value, field }: { readonly value: unknown; readonly field?: string }) {
  if (Array.isArray(value))
    return (
      <ul>
        {value.map((item) => (
          <li key={JSON.stringify(item)}>
            <Value value={item} />
          </li>
        ))}
      </ul>
    );
  if (typeof value === "object" && value !== null)
    return (
      <dl>
        {Object.entries(value)
          .filter(([key]) => Object.hasOwn(labels, key))
          .map(([key, item]) => (
            <div key={key}>
              <dt>{labels[key] ?? key}</dt>
              <dd>
                {key === "textMasked" && typeof item === "string" ? (
                  <LongText value={item} />
                ) : (
                  <Value value={item} field={key} />
                )}
              </dd>
            </div>
          ))}
      </dl>
    );
  return <>{field && formattedFields.has(field) ? display(value) : text(value)}</>;
}
function LongText({ value }: { readonly value: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false),
    [overflow, setOverflow] = useState(false);
  useEffect(() => {
    if (expanded) return;
    const measure = () => {
      const node = ref.current;
      if (node) setOverflow(node.scrollHeight > node.clientHeight);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [expanded]);
  return (
    <div>
      <p ref={ref} className={expanded ? "" : "operator-records-clamp"}>
        {value}
      </p>
      {overflow ? (
        <button type="button" onClick={() => setExpanded(!expanded)}>
          {expanded ? "접기" : "더 보기"}
        </button>
      ) : null}
    </div>
  );
}
const labels: Record<string, string> = {
  customerName: "주문자",
  customerPhone: "연락처",
  value: "원래 값",
  placeholder: "표시",
  kind: "종류",
  bankName: "은행",
  accountNumber: "계좌번호",
  holderName: "예금주",
  orderNo: "주문번호",
  finishedAt: "끝난 시각",
  contractKeepUntil: "보관 기간",
  details: "주문 내용",
  payments: "결제",
  refunds: "환불",
  author: "발신자",
  at: "시각",
  textMasked: "대화 글",
  amount: "금액",
  status: "상태",
  pickupAt: "픽업",
  summary: "내용",
  version: "버전",
  issuedAt: "안내 시각",
  paidAt: "입금 시각",
  decidedAt: "결정 시각",
  sentAt: "송금 시각",
  createdAt: "기록 시각",
  issueKeepUntil: "보관 기한",
  issuePurgedAt: "삭제 시각",
  cause: "사유",
  decision: "결정",
  refundAccount: "환불 계좌",
  accountMasked: "계좌번호",
  holderNameMasked: "예금주",
  items: "메시지",
};
export function OperatorRecordsScreen({
  shopId,
  path,
  onNavigate,
  onSessionExpired,
  blocked = false,
  onBusyChange,
}: {
  readonly shopId: string;
  readonly path: string;
  readonly onNavigate: Navigate;
  readonly onSessionExpired: () => void;
  readonly blocked?: boolean;
  readonly onBusyChange?: (busy: boolean) => void;
}) {
  const { search } = useLocation();
  const params = new URLSearchParams(search),
    filter = params.get("kind"),
    cursor = params.get("cursor");
  const invalidQuery =
    params.getAll("kind").length > 1 ||
    params.getAll("cursor").length > 1 ||
    (filter !== null && filter !== "orders" && filter !== "consultations") ||
    (cursor !== null && !/^[A-Za-z0-9_-]{1,200}$/.test(cursor));
  const [kind, setKind] = useState<OperatorRecordKind>(
    path.includes("/consultations/") || filter === "consultations" ? "consultations" : "orders",
  );
  const initialKind = useRef(kind);
  const [list, setList] = useState<Data | null>(null),
    [detail, setDetail] = useState<Data | null>(null);
  const [selected, setSelected] = useState<Data | null>(null),
    [target, setTarget] = useState<Target | null>(null),
    [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [unavailable, setUnavailable] = useState<Record<string, string>>({});
  const [detailCursor, setDetailCursor] = useState<string | undefined>();
  const suppressDirect = useRef(false);
  const [retry, setRetry] = useState<
    | { type: "list"; append: boolean; cursor?: string }
    | { type: "detail"; row: Data; kind: OperatorRecordKind; cursor?: string }
    | null
  >(null);
  const [opened, setOpened] = useState<Data | null>(null),
    [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0),
    [at, setAt] = useState(0);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  const controller = useRef<AbortController | null>(null),
    active = useRef(true),
    lock = useRef(false),
    sequence = useRef(0);
  const clear = useCallback(() => {
    sequence.current++;
    controller.current?.abort();
    controller.current = null;
    lock.current = false;
    setLoading(false);
    setBusy(false);
    setOpened(null);
    setTarget(null);
    setReason("");
  }, []);
  const failed = useCallback(
    (result: ApiFailure, keepList = false) => {
      if (result.status === 401) {
        clear();
        setList(null);
        setDetail(null);
        setSelected(null);
        onSessionExpired();
      } else {
        if (result.status >= 500 || result.status === 0) {
          if (!keepList) setList(null);
          setDetail(null);
          if (!keepList) setSelected(null);
          setOpened(null);
        }
        setFailure(result);
      }
    },
    [clear, onSessionExpired],
  );
  const load = useCallback(
    async (cursor?: string, append = false) => {
      if (lock.current) return;
      const request = new AbortController();
      controller.current = request;
      lock.current = true;
      setLoading(true);
      setFailure(null);
      try {
        const result = await fetchOperatorRecords(shopId, kind, cursor, request.signal);
        if (request.signal.aborted) return;
        if (!result.ok) {
          failed(result, append);
          if (result.status !== 401) setRetry({ type: "list", append, ...(cursor ? { cursor } : {}) });
          return false;
        } else {
          setList((old) =>
            append && old
              ? {
                  ...result.data,
                  orders: [...rows(old.orders), ...rows(result.data.orders)],
                  consultations: [...rows(old.consultations), ...rows(result.data.consultations)],
                }
              : result.data,
          );
          setRetry(null);
          if (!append) setAt(Date.now());
          return true;
        }
      } catch (error) {
        if (!request.signal.aborted) throw error;
        return false;
      } finally {
        if (controller.current === request) {
          controller.current = null;
          lock.current = false;
          if (active.current) setLoading(false);
        }
      }
    },
    [shopId, kind, failed],
  );
  const choose = useCallback(
    async (row: Data, directKind: OperatorRecordKind = kind, pageCursor?: string) => {
      clear();
      setFailure(null);
      setSelected(row);
      setDetail(null);
      if (row.kept) return;
      const id = text(directKind === "orders" ? row.orderId : row.consultationId),
        request = new AbortController();
      controller.current = request;
      lock.current = true;
      setLoading(true);
      try {
        const result =
          directKind === "orders"
            ? await fetchOperatorOrder(shopId, id, request.signal)
            : await fetchOperatorConsultation(shopId, id, pageCursor, request.signal);
        if (request.signal.aborted) return;
        if (result.ok) {
          setRetry(null);
          setDetailCursor(pageCursor);
          setDetail(result.data);
        } else {
          failed(result, true);
          if (result.status !== 401)
            setRetry({ type: "detail", row, kind: directKind, ...(pageCursor ? { cursor: pageCursor } : {}) });
        }
      } catch (error) {
        if (!request.signal.aborted) throw error;
      } finally {
        if (controller.current === request) {
          controller.current = null;
          lock.current = false;
          if (active.current) setLoading(false);
        }
      }
    },
    [clear, failed, kind, shopId],
  );
  const openDirect = useCallback(async () => {
    const parts = path.split("/"),
      type = parts[4],
      id = parts[5];
    if (!suppressDirect.current && id && type === kind && (type === "orders" || type === "consultations"))
      await choose(
        type === "orders" ? { orderId: id } : { consultationId: id },
        type,
        type === "consultations" ? (cursor ?? undefined) : undefined,
      );
  }, [path, kind, cursor, choose]);
  useEffect(() => {
    active.current = true;
    void revision;
    let cancelled = false;
    void (async () => {
      try {
        if (invalidQuery) return;
        const directConsultation = path.includes("/consultations/");
        const loaded = await load(
          !directConsultation && initialKind.current === kind ? (cursor ?? undefined) : undefined,
        );
        if (cancelled || !loaded) return;
        await openDirect();
      } catch (error) {
        if (!cancelled) throw error;
      }
    })();
    return () => {
      cancelled = true;
      active.current = false;
      sequence.current++;
      controller.current?.abort();
      controller.current = null;
      lock.current = false;
    };
  }, [load, revision, path, openDirect, kind, invalidQuery, cursor]);
  const sensitiveActive = useRef(false);
  sensitiveActive.current = target !== null;
  useEffect(() => {
    const hide = () => flushSync(() => clear());
    const history = () => {
      if (sensitiveActive.current) flushSync(() => clear());
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) flushSync(() => clear());
    };
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", restore);
    window.addEventListener("popstate", history);
    window.addEventListener("hashchange", history);
    return () => {
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", restore);
      window.removeEventListener("popstate", history);
      window.removeEventListener("hashchange", history);
    };
  }, [clear]);
  const modal = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const node = modal.current;
    if (target && node && !node.open) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      node.showModal();
    }
    return () => {
      if (node?.open) node.close();
      previousFocus.current?.focus();
      previousFocus.current = null;
    };
  }, [target]);
  async function nextConsultationPage() {
    if (!detail || typeof detail.nextCursor !== "string" || lock.current) return;
    clear();
    setFailure(null);
    setDetail(null);
    const request = new AbortController();
    controller.current = request;
    lock.current = true;
    setLoading(true);
    try {
      const result = await fetchOperatorConsultation(
        shopId,
        text(detail.consultationId),
        detail.nextCursor,
        request.signal,
      );
      if (request.signal.aborted) return;
      if (result.ok) {
        setDetailCursor(detail.nextCursor as string);
        setRetry(null);
        setDetail(result.data);
      } else {
        failed(result, true);
        if (result.status !== 401)
          setRetry({
            type: "detail",
            row: { consultationId: detail.consultationId },
            kind: "consultations",
            cursor: detail.nextCursor as string,
          });
      }
    } catch (error) {
      if (!request.signal.aborted) throw error;
    } finally {
      if (controller.current === request) {
        controller.current = null;
        lock.current = false;
        if (active.current) setLoading(false);
      }
    }
  }
  function show(next: Target) {
    clear();
    setFailure(null);
    if (unavailable[`${next.kind}:${next.id}`]) return;
    setNotice("");
    setTarget(next);
  }
  async function submit() {
    if (!target || lock.current || blocked || [...reason].length < 5 || [...reason].length > 200) return;
    const request = new AbortController(),
      key = newRequestKey(),
      current = sequence.current;
    controller.current = request;
    lock.current = true;
    setBusy(true);
    setFailure(null);
    const input: OperatorOriginalInput = {
      targetKind: target.kind,
      targetId: target.id,
      reason,
      ...(target.cursor ? { cursor: target.cursor } : {}),
    };
    try {
      for (;;) {
        const result = await openOperatorOriginal(shopId, input, key, request.signal);
        if (request.signal.aborted || current !== sequence.current) return;
        if (result.ok) {
          setOpened(result.data);
          break;
        }
        if (result.status === 409 && result.problem?.code === "request_in_progress") {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 1000);
            request.signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
          });
          if (request.signal.aborted) return;
          continue;
        }
        const code = result.problem?.code;
        if (result.status === 404 || code === "original_erased" || code === "original_not_kept") {
          const label =
            code === "original_not_kept"
              ? "원래 값을 두지 않아요"
              : code === "original_erased"
                ? "지워진 값이에요"
                : "찾을 수 없어요";
          setNotice(label);
          setUnavailable((old) => ({ ...old, [`${target.kind}:${target.id}`]: label }));
          if (code === "original_erased" && target.kind === "consultation_text") {
            setDetail((old) =>
              old
                ? { ...old, status: "deleted", items: [], maskedValues: [], nextCursor: null, textCursor: null }
                : null,
            );
          } else if (result.status === 404 || (code === "original_erased" && target.kind === "order_contact")) {
            suppressDirect.current = true;
            setSelected(null);
            setDetail(null);
            setRevision((n) => n + 1);
          }
          clear();
          setFailure(null);
        } else failed(result);
        break;
      }
    } catch (error) {
      if (!request.signal.aborted) throw error;
    } finally {
      if (controller.current === request) {
        controller.current = null;
        lock.current = false;
        if (active.current) setBusy(false);
      }
    }
  }
  const disabled = loading || busy || blocked;
  const error = failure ? classify(failure.status, failure.problem, failure.retryAfterSeconds) : null;
  const source = kind === "orders" ? rows(list?.orders) : rows(list?.consultations);
  if (invalidQuery)
    return (
      <section>
        <p role="alert">입력한 내용을 확인해 주세요</p>
        <a
          href={`/operator/shops/${encodeURIComponent(shopId)}/records`}
          onClick={(event) => onNavigate(`/operator/shops/${encodeURIComponent(shopId)}/records`, event)}
        >
          처음부터 보기
        </a>
      </section>
    );
  return (
    <section className="operator-records" aria-label="가게 기록 보기">
      <p>이 화면에서 본 것과 연 것은 접속기록에 남아요.</p>
      {at ? (
        <p>
          {new Date(at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" })}{" "}
          기준{" "}
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              clear();
              setDetail(null);
              setSelected(null);
              setRevision((n) => n + 1);
            }}
          >
            새로 고침
          </button>
        </p>
      ) : null}
      {notice ? <div role="alert">{notice}</div> : null}
      {error ? (
        <div role="alert">
          {error.message} {failure?.problem?.traceId ? `추적 ID: ${failure.problem.traceId}` : ""}{" "}
          {failure?.status === 422 && retry?.cursor ? (
            <a
              href={
                retry.type === "detail" && retry.kind === "consultations"
                  ? `/operator/shops/${encodeURIComponent(shopId)}/consultations/${encodeURIComponent(text(retry.row.consultationId))}`
                  : `/operator/shops/${encodeURIComponent(shopId)}/records`
              }
              onClick={(event) => {
                const href =
                  retry.type === "detail" && retry.kind === "consultations"
                    ? `/operator/shops/${encodeURIComponent(shopId)}/consultations/${encodeURIComponent(text(retry.row.consultationId))}`
                    : `/operator/shops/${encodeURIComponent(shopId)}/records`;
                onNavigate(href, event);
              }}
            >
              처음부터 보기
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => {
              if (retry?.type === "list")
                void (async () => {
                  const loaded = await load(retry.cursor, retry.append);
                  if (loaded && !retry.append) await openDirect();
                })();
              else if (retry?.type === "detail") void choose(retry.row, retry.kind, retry.cursor);
              else setRevision((n) => n + 1);
            }}
          >
            다시 시도
          </button>
        </div>
      ) : null}
      <div className="operator-records-tabs">
        <button
          type="button"
          aria-pressed={kind === "orders"}
          disabled={disabled}
          onClick={() => {
            if (kind === "orders") return;
            clear();
            setDetail(null);
            setSelected(null);
            setList(null);
            setKind("orders");
          }}
        >
          주문
        </button>
        <button
          type="button"
          aria-pressed={kind === "consultations"}
          disabled={disabled}
          onClick={() => {
            if (kind === "consultations") return;
            clear();
            setDetail(null);
            setSelected(null);
            setList(null);
            setKind("consultations");
          }}
        >
          상담
        </button>
      </div>
      <div className={`operator-records-columns${selected ? " has-selection" : ""}`}>
        <div>
          <h2>{kind === "orders" ? "주문" : "상담"} 목록</h2>
          {loading ? <Skeleton /> : null}
          {list && !source.length ? <p>조건에 맞는 기록이 없어요</p> : null}
          <ul>
            {source.map((row) => (
              <li key={text(row.orderId ?? row.consultationId)}>
                <button type="button" disabled={disabled} onClick={() => void choose(row)}>
                  {kind === "orders" ? (
                    <>
                      {text(row.orderNo)} ·{" "}
                      {row.kept ? (
                        <>
                          보관 기록 · {display(row.finishedAt)} 끝남 · {display(row.contractKeepUntil)}까지 보관
                        </>
                      ) : (
                        <>
                          {display(row.status)} · {display(row.pickupAt)} 픽업 · {text(row.customerNameMasked)} ·{" "}
                          {text(row.customerPhoneMasked)}
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      {display(row.status)} · 시작 {display(row.startedAt)} · 마지막 {display(row.lastMessageAt)} · 주문{" "}
                      {Array.isArray(row.orderNos) && row.orderNos.length ? row.orderNos.join(", ") : "없음"} · 가린
                      번호 {display(row.maskedValueCount)}개
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {typeof list?.nextCursor === "string" ? (
            <button type="button" disabled={disabled} onClick={() => void load(list.nextCursor as string, true)}>
              더 보기
            </button>
          ) : null}
        </div>
        <div>
          <button
            type="button"
            className="operator-records-back"
            onClick={() => {
              clear();
              setSelected(null);
              setDetail(null);
            }}
          >
            목록으로 돌아가기
          </button>
          <h2>기록 상세</h2>
          {loading && selected ? <Skeleton label="기록을 불러오고 있어요" /> : null}
          {selected?.kept ? (
            <>
              <p>보관 기록 {text(selected.orderNo)}</p>
              {unavailable[`kept_record:${text(selected.keptRecordId)}`] ? (
                <p>{unavailable[`kept_record:${text(selected.keptRecordId)}`]}</p>
              ) : (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    show({
                      kind: "kept_record",
                      id: text(selected.keptRecordId),
                      label: `보관 기록 ${text(selected.orderNo)}`,
                    })
                  }
                >
                  보관 기록 열기
                </button>
              )}
            </>
          ) : null}
          {detail && kind === "orders" ? (
            <>
              <p>
                주문번호 {text(detail.orderNo)} · {display(detail.status)}
              </p>
              <p>
                픽업 {display(detail.pickupAt)} · 금액 {display(detail.amount)}원
              </p>
              <p>
                주문자 {text(detail.customerNameMasked)} · {text(detail.customerPhoneMasked)}
              </p>
              {unavailable[`order_contact:${text(detail.orderId)}`] ? (
                <p>{unavailable[`order_contact:${text(detail.orderId)}`]}</p>
              ) : (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    show({ kind: "order_contact", id: text(detail.orderId), label: "주문자 이름과 연락처" })
                  }
                >
                  주문자 원래 값 열기
                </button>
              )}
              <p>
                알레르기 {detail.allergyAnswered ? "답 있음" : "답 없음"} · 빼야 할 재료{" "}
                {detail.excludedIngredientsAnswered ? "답 있음" : "답 없음"} · 사진 {text(detail.referencePhotoCount)}장
              </p>
              <h3>결제 안내</h3>
              <Value value={detail.paymentRequests} />
              <h3>환불</h3>
              {rows(detail.refunds).map((refund) => (
                <div key={text(refund.refundId)}>
                  <Value value={refund} />
                  {unavailable[`refund_account:${text(refund.refundId)}`] ? (
                    <p>{unavailable[`refund_account:${text(refund.refundId)}`]}</p>
                  ) : refund.refundAccount ? (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => show({ kind: "refund_account", id: text(refund.refundId), label: "환불 계좌" })}
                    >
                      환불 계좌 원래 값 열기
                    </button>
                  ) : null}
                </div>
              ))}
            </>
          ) : null}
          {detail && kind === "consultations" ? (
            detail.status === "deleted" ? (
              <p>보관 기간 30일이 지나 대화를 지웠어요</p>
            ) : (
              <>
                {unavailable[`consultation_text:${text(detail.consultationId)}`] ? (
                  <p>{unavailable[`consultation_text:${text(detail.consultationId)}`]}</p>
                ) : (
                  <button
                    type="button"
                    disabled={disabled || typeof detail.textCursor !== "string"}
                    onClick={() =>
                      show({
                        kind: "consultation_text",
                        id: text(detail.consultationId),
                        label: "이 상담의 대화 글(보고 있는 페이지)",
                        cursor: text(detail.textCursor),
                      })
                    }
                  >
                    대화 글 열기
                  </button>
                )}
                <ul>
                  {rows(detail.items).map((item) => (
                    <li key={text(item.messageId)}>
                      {display(item.author)} · {display(item.at)} · {display(item.kind)} · 글 {text(item.textLength)}자
                      · 사진 {text(item.photoCount)}장
                    </li>
                  ))}
                </ul>
                {typeof detail.nextCursor === "string" ? (
                  <button type="button" disabled={disabled} onClick={() => void nextConsultationPage()}>
                    다음 대화 페이지
                  </button>
                ) : null}
                <ul>
                  {rows(detail.maskedValues).map((value) => (
                    <li key={text(value.maskedValueId)}>
                      {text(value.placeholder)} …{text(value.last4)}{" "}
                      {unavailable[`masked_value:${text(value.maskedValueId)}`] ? (
                        unavailable[`masked_value:${text(value.maskedValueId)}`]
                      ) : value.originalKept ? (
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() =>
                            show({
                              kind: "masked_value",
                              id: text(value.maskedValueId),
                              label: text(value.placeholder),
                            })
                          }
                        >
                          원래 값 열기
                        </button>
                      ) : (
                        "원래 값을 두지 않아요"
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )
          ) : null}
        </div>
      </div>
      {target ? (
        <dialog
          ref={modal}
          className="operator-records-dialog"
          aria-modal="true"
          aria-labelledby="open-title"
          onKeyDown={keepFocusInside}
          onCancel={(event) => {
            event.preventDefault();
            if (!busy) clear();
          }}
        >
          <div>
            <h2 id="open-title">{target.label}</h2>
            {opened ? (
              <>
                <p>
                  접속기록에 남겼어요 · {display(opened.openedAt)} · {reason}
                </p>
                <Value
                  value={
                    opened[
                      {
                        masked_value: "maskedValue",
                        order_contact: "orderContact",
                        refund_account: "refundAccount",
                        kept_record: "keptRecord",
                        consultation_text: "consultationText",
                      }[target.kind]
                    ]
                  }
                />
                <button type="button" onClick={clear}>
                  닫기
                </button>
              </>
            ) : (
              <>
                <p>연 값과 사유는 접속기록에 남아요. 저장하거나 내려받을 수 없어요.</p>
                <label htmlFor="open-reason">사유</label>
                <textarea
                  id="open-reason"
                  value={reason}
                  maxLength={200}
                  disabled={busy}
                  onChange={(event) => setReason(event.target.value)}
                />
                <p>{[...reason].length}/200</p>
                {error ? <p role="alert">{error.message}</p> : null}
                {target.kind === "consultation_text" &&
                failure?.problem?.code === "validation_failed" &&
                failure.problem.errors.some((entry) => entry.field === "/cursor") ? (
                  <button
                    type="button"
                    onClick={() => {
                      const id = target.id;
                      clear();
                      void choose({ consultationId: id }, "consultations", detailCursor);
                    }}
                  >
                    대화 페이지 다시 불러오기
                  </button>
                ) : null}
                <div className="operator-records-actions">
                  <button type="button" disabled={busy} onClick={clear}>
                    돌아가기
                  </button>
                  <button type="button" disabled={disabled || [...reason].length < 5} onClick={() => void submit()}>
                    {busy ? "처리하고 있어요" : "사유를 적고 열기"}
                  </button>
                </div>
              </>
            )}
          </div>
        </dialog>
      ) : null}
      <a href="/operator/shops" onClick={(event) => onNavigate("/operator/shops", event)}>
        영업 신고 확인 목록으로
      </a>
    </section>
  );
}
