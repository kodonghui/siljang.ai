import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import type { ApiFailure } from "./api";
import { UUID_PATTERN } from "./api-response";
import {
  CONSULTATION_STATUSES,
  type ConsultationMessage,
  type ConsultationMessagesPage,
  fetchConsultationMessages,
  MESSAGE_AUTHORS,
  MESSAGE_DELIVERIES,
  parseConsultationMessagesSearch,
} from "./consultation-messages-api";
import { formatKoreanDateTime, formatSeoulTime } from "./format-date";
import { classify } from "./problems";
import type { ShopLicenseProps } from "./ShopLicense";
import { Banner, Button, EmptyState, LoadFailure, OwnerLayout, Skeleton, StateBox } from "./ui";
import { keepFocusInside } from "./ui/focus";

interface Received extends ConsultationMessage {
  readonly receivedAt: number;
}
interface Loaded extends Omit<ConsultationMessagesPage, "items"> {
  readonly key: string;
  readonly items: readonly Received[];
  readonly at: number;
}
const NETWORK: ApiFailure = { ok: false, status: 0, problem: null, retryAfterSeconds: null };
export function consultationPhotoExpiry(url: string, receivedAt: number) {
  try {
    const seconds = Number(new URL(url).searchParams.get("exp"));
    return Number.isSafeInteger(seconds) && seconds > 0
      ? Math.min(seconds * 1000, receivedAt + 900000)
      : receivedAt + 900000;
  } catch {
    return receivedAt;
  }
}
/** 원래 값은 이 화면의 메모리에만 둔다. 가게/상담/세션이 바뀌면 이전 자료를 즉시 가린다. */
export function ConsultationMessagesScreen(
  props: ShopLicenseProps & { readonly shopId: string; readonly consultationId?: string },
) {
  const location = useLocation();
  const consultationId =
    props.consultationId ?? /^\/owner\/consultations\/([^/]+)\/?$/.exec(location.pathname)?.[1] ?? "";
  const query = useRef(parseConsultationMessagesSearch(location.search));
  const parsed = parseConsultationMessagesSearch(location.search);
  const key = `${props.shopId}/${consultationId}${location.search}`;
  query.current = parsed;
  const validId = UUID_PATTERN.test(consultationId);
  const valid = validId && parsed !== null;
  const blocked = Boolean(props.sessionChecking || props.sessionFailed || props.logoutPending);
  const identity = useRef({ key, blocked });
  identity.current = { key, blocked };
  const callbacks = useRef(props);
  callbacks.current = props;
  const [loaded, setLoaded] = useState<Loaded | null>(null),
    [loading, setLoading] = useState(true),
    [failure, setFailure] = useState<{ result: ApiFailure; more: boolean } | null>(null);
  const [revision, setRevision] = useState(0),
    [clock, setClock] = useState(Date.now),
    [notice, setNotice] = useState("");
  const [selection, setSelection] = useState<{ id: string; index: number } | null>(null),
    [failedPhotos, setFailedPhotos] = useState<ReadonlySet<string>>(new Set());
  const request = useRef<AbortController | null>(null),
    status = useRef<HTMLParagraphElement>(null),
    focusOrigin = useRef<Element | null>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const current = !blocked && loaded?.key === key ? loaded : null;
  const read = useCallback(
    async (cursor: string | null, more: boolean) => {
      const parameters = query.current;
      if (!parameters || !UUID_PATTERN.test(consultationId) || request.current || identity.current.blocked) return;
      const controller = new AbortController();
      request.current = controller;
      setLoading(true);
      setFailure(null);
      setNotice("");
      if (more) focusOrigin.current = document.activeElement;
      else {
        setLoaded(null);
        setFailedPhotos(new Set());
      }
      try {
        const result = await fetchConsultationMessages(
          consultationId,
          { ...parameters, cursor },
          props.shopId,
          controller.signal,
        );
        if (controller.signal.aborted || identity.current.key !== key || identity.current.blocked) return;
        if (result.ok) {
          const at = Date.now();
          setClock(at);
          setLoaded((old) => {
            const prior = more && old?.key === key ? old : null;
            const ids = new Set(prior?.items.map((row) => row.messageId));
            return {
              ...result.data,
              key,
              at: prior?.at ?? at,
              items: [
                ...(prior?.items ?? []),
                ...result.data.items
                  .filter((row) => !ids.has(row.messageId))
                  .map((row) => ({ ...row, receivedAt: at })),
              ],
            };
          });
          if (more) setNotice(result.data.items.length ? `이전 대화를 불러왔어요` : `더 불러올 대화가 없어요`);
        } else {
          if (result.status === 401 || result.status === 404) {
            setLoaded(null);
            setSelection(null);
          }
          setFailure({ result, more });
          if (result.status === 401) callbacks.current.onSessionExpired();
        }
      } catch {
        if (!controller.signal.aborted && identity.current.key === key && !identity.current.blocked)
          setFailure({ result: NETWORK, more });
      } finally {
        if (request.current === controller) request.current = null;
        if (!controller.signal.aborted && identity.current.key === key) setLoading(false);
      }
    },
    [consultationId, props.shopId, key],
  );
  useEffect(() => {
    void revision;
    if (blocked || !valid) {
      setLoaded(null);
      setFailure(null);
      setSelection(null);
      setFailedPhotos(new Set());
    } else void read(query.current?.cursor ?? null, false);
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [read, revision, blocked, valid]);
  useLayoutEffect(() => {
    if (!notice || identity.current.blocked) return;
    const active = document.activeElement;
    if (active === document.body || active === focusOrigin.current) status.current?.focus();
  }, [notice]);
  useEffect(() => {
    if (!current) return;
    const deadlines = current.items
      .flatMap((row) => row.photos.map((photo) => consultationPhotoExpiry(photo.url, row.receivedAt)))
      .filter((at) => at > clock);
    const next = Math.min(...deadlines);
    const timer = Number.isFinite(next)
      ? setTimeout(() => setClock(Date.now()), Math.max(1, next - Date.now() + 1))
      : null;
    const update = () => setClock(Date.now());
    document.addEventListener("visibilitychange", update);
    return () => {
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [current, clock]);
  const busy = blocked || (valid && loading);
  const refresh = () => {
    if (!busy) {
      setSelection(null);
      setRevision((old) => old + 1);
    }
  };
  const row = selection ? current?.items.find((item) => item.messageId === selection.id) : undefined;
  const photo = row && selection ? row.photos[selection.index] : undefined;
  const photoStale = photo && row ? consultationPhotoExpiry(photo.url, row.receivedAt) <= clock : false;
  const rows =
    current?.items
      .map((item, index) => ({ item, index }))
      .sort((a, b) => Date.parse(a.item.at) - Date.parse(b.item.at) || b.index - a.index) ?? [];
  const fail = validId ? failure?.result : { status: 404 };
  return (
    <OwnerLayout
      screen="SCR-018"
      title="상담 대화"
      shopName={blocked ? "" : props.shopName}
      back="/owner"
      busy={busy}
      onNavigate={(href, event) => {
        event.preventDefault();
        if (!busy) props.onNavigate(href);
      }}
    >
      <section className="consultation-messages" aria-label="상담 대화 내용">
        <h2 ref={heading} tabIndex={-1} className="ui-sr-only">
          상담 기록
        </h2>
        {!valid && validId ? (
          <StateBox
            title="입력한 내용을 확인해 주세요"
            actions={
              <Button onClick={() => props.onNavigate(`/owner/consultations/${consultationId}`)}>처음부터 보기</Button>
            }
          />
        ) : blocked || (valid && !current && loading) ? (
          <Skeleton rows={3} label="대화를 불러오고 있어요" />
        ) : fail?.status === 404 ? (
          <StateBox
            title="찾을 수 없어요"
            actions={
              <a
                className="ui-button ui-button--secondary"
                href="/owner"
                onClick={(event) => {
                  event.preventDefault();
                  props.onNavigate("/owner");
                }}
              >
                할 일 목록으로
              </a>
            }
          />
        ) : fail?.status === 422 ? (
          <StateBox
            title="입력한 내용을 확인해 주세요"
            actions={
              <Button onClick={() => props.onNavigate(`/owner/consultations/${consultationId}`)}>처음부터 보기</Button>
            }
          />
        ) : (
          <>
            {failure ? (
              <LoadFailure
                failure={classify(failure.result.status, failure.result.problem, failure.result.retryAfterSeconds)}
                onRetry={() =>
                  failure.more ? void read(current?.nextCursor ?? null, true) : setRevision((old) => old + 1)
                }
              />
            ) : null}
            {current?.status === "deleted" ? (
              <EmptyState>보관 기간 30일이 지나 대화를 지웠어요</EmptyState>
            ) : current ? (
              <>
                <p className="consultation-meta">
                  {CONSULTATION_STATUSES[current.status]} ·{" "}
                  {current.customerChannelFriend ? "채널 친구" : "채널 친구 아님"}
                </p>
                {current.nextCursor ? (
                  <Button kind="secondary" disabled={busy} onClick={() => void read(current.nextCursor, true)}>
                    이전 대화 더 보기
                  </Button>
                ) : null}
                {loading ? <Skeleton rows={3} label="이전 대화를 불러오고 있어요" /> : null}
                <p ref={status} tabIndex={-1} role="status">
                  {notice}
                </p>
                {rows.length === 0 ? (
                  <p>남아 있는 대화가 없어요</p>
                ) : (
                  <ol className="consultation-timeline">
                    {rows.map(({ item }) => (
                      <li key={item.messageId} className={`consultation-bubble consultation-bubble--${item.direction}`}>
                        <div className="consultation-bubble__meta">
                          <strong>{MESSAGE_AUTHORS[item.author]}</strong>
                          <time dateTime={item.at} title={formatKoreanDateTime(item.at)}>
                            {formatSeoulTime(item.at)}
                          </time>
                        </div>
                        {item.text ? (
                          <MessageText text={item.text} />
                        ) : (
                          <p>
                            {item.kind === "photo"
                              ? "참고 사진"
                              : item.kind === "card"
                                ? "확인 카드"
                                : "지원하지 않는 메시지"}
                          </p>
                        )}
                        {item.author === "customer" && item.text ? (
                          <small>전화번호·계좌번호: AI에는 마스킹해서 보냄</small>
                        ) : null}
                        {item.text && /\[(?:카드번호|긴숫자)\d+\]/u.test(item.text) ? (
                          <small>원래 값을 두지 않아요</small>
                        ) : null}
                        {item.photos.length ? (
                          <div className="consultation-photos">
                            {item.photos.map((image, index) => {
                              const stale =
                                consultationPhotoExpiry(image.url, item.receivedAt) <= clock ||
                                failedPhotos.has(image.url);
                              return (
                                // biome-ignore lint/suspicious/noArrayIndexKey: 수신 안의 사진 순서는 고정이고 서명 주소는 갱신된다.
                                <div key={`${item.messageId}:${index}`}>
                                  <button
                                    type="button"
                                    className="consultation-photo"
                                    disabled={busy}
                                    aria-label={
                                      stale
                                        ? `참고 사진 ${index + 1} 다시 불러오기`
                                        : `참고 사진 ${index + 1} 크게 보기`
                                    }
                                    onClick={() => (stale ? refresh() : setSelection({ id: item.messageId, index }))}
                                  >
                                    {stale ? (
                                      "다시 불러오기"
                                    ) : (
                                      <img
                                        src={image.url}
                                        alt={`참고 사진 ${index + 1}`}
                                        loading="lazy"
                                        referrerPolicy="no-referrer"
                                        onError={() => setFailedPhotos((old) => new Set([...old, image.url]))}
                                      />
                                    )}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                        {item.delivery && ["sending", "deferred", "failed"].includes(item.delivery) ? (
                          <p className="consultation-delivery">{MESSAGE_DELIVERIES[item.delivery]}</p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
                <div className="consultation-refresh">
                  <time dateTime={new Date(current.at).toISOString()}>{formatSeoulTime(current.at)} 기준</time>
                  <Button kind="secondary" disabled={busy} onClick={refresh}>
                    새로 고침
                  </Button>
                </div>
              </>
            ) : null}
          </>
        )}
      </section>
      <PhotoDialog
        open={Boolean(!blocked && current && photo)}
        url={photoStale ? null : (photo?.url ?? null)}
        failed={Boolean(photoStale || (photo && failedPhotos.has(photo.url)))}
        busy={busy}
        onClose={() => setSelection(null)}
        onReload={refresh}
        onError={() => {
          if (photo) setFailedPhotos((old) => new Set([...old, photo.url]));
        }}
        fallback={heading}
      />
    </OwnerLayout>
  );
}
function MessageText({ text }: { readonly text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false),
    [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const line = parseFloat(getComputedStyle(node).lineHeight) || 24;
      setLong(
        node.scrollHeight ? node.scrollHeight > line * 5 + 1 : [...text].length > 80 || text.split("\n").length > 5,
      );
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [text]);
  return (
    <>
      <p ref={ref} className={`consultation-text${expanded ? " consultation-text--expanded" : ""}`}>
        {text}
      </p>
      {long ? (
        <Button kind="secondary" onClick={() => setExpanded((old) => !old)} aria-expanded={expanded}>
          {expanded ? "접기" : "더 보기"}
        </Button>
      ) : null}
    </>
  );
}
function PhotoDialog({
  open,
  url,
  failed,
  busy,
  onClose,
  onReload,
  onError,
  fallback,
}: {
  readonly open: boolean;
  readonly url: string | null;
  readonly failed: boolean;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onReload: () => void;
  readonly onError: () => void;
  readonly fallback: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    origin = useRef<HTMLElement | null>(null),
    closing = useRef(false);
  const restore = useCallback(() => {
    const target = origin.current;
    if (!target) return;
    origin.current = null;
    if (target.isConnected) target.focus();
    else if (fallback.current?.isConnected) fallback.current.focus();
  }, [fallback]);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) {
      origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      node.showModal();
      node.querySelector<HTMLButtonElement>("button")?.focus();
    } else if (!open && node.open) {
      closing.current = true;
      node.close();
      restore();
    }
  }, [open, restore]);
  useEffect(
    () => () => {
      restore();
    },
    [restore],
  );
  return (
    <dialog
      ref={ref}
      className="consultation-photo-dialog"
      aria-label="참고 사진 크게 보기"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (ref.current?.open) return;
        restore();
        if (closing.current) {
          closing.current = false;
          return;
        }
        onClose();
      }}
      onKeyDown={keepFocusInside}
    >
      <Button onClick={onClose}>닫기</Button>
      {failed ? (
        <Banner
          tone="warning"
          actions={
            <Button disabled={busy} onClick={onReload}>
              다시 불러오기
            </Button>
          }
        >
          사진 주소가 만료됐거나 사진을 열 수 없어요. 새로 불러와 주세요
        </Banner>
      ) : url ? (
        <img src={url} alt="크게 보는 참고 사진" referrerPolicy="no-referrer" onError={onError} />
      ) : null}
    </dialog>
  );
}
