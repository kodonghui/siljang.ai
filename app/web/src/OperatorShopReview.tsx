import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { UUID_PATTERN } from "./api-response";
import { formatKoreanDateTime } from "./format-date";
import {
  fetchReviewShop,
  type IdentityReviewResult,
  type LicenseReviewResult,
  type ReviewShopDetail,
  reviewIdentityChange,
  reviewLicense,
} from "./operator-shop-review-api";
import { reviewAvailability, reviewPayload, reviewReasonIssue } from "./operator-shop-review-form";
import { classify, ERROR_CODES } from "./problems";
import { Banner, Button, CommandStatus, ConfirmDialog, Field, LoadFailure, type Navigate, Skeleton } from "./ui";
import { keepFocusInside } from "./ui/focus";
import { useCommand } from "./useCommand";
import { useVersionedRead } from "./useVersionedRead";
import "./operator-shop-review.css";

type Target = "license" | "identity";
interface Input {
  readonly target: Target;
  readonly id: string;
  readonly body: Record<string, unknown>;
}
type Output =
  | { readonly target: "license"; readonly result: LicenseReviewResult }
  | { readonly target: "identity"; readonly result: IdentityReviewResult };
interface Props {
  readonly shopId: string;
  readonly onNavigate: Navigate;
  readonly onSessionExpired: () => void;
  readonly onBusyChange: (busy: boolean) => void;
  readonly blocked?: boolean;
}
const doneText = (value: Output): string =>
  value.target === "license"
    ? value.result.outcome === "unchanged"
      ? "이미 확인된 가게예요"
      : value.result.shop.licenseStatus === "verified"
        ? "확인됨으로 남겼어요"
        : "보류로 남겼어요. 사장님께 사유를 알렸어요"
    : value.result.outcome === "unchanged"
      ? "이미 처리된 요청이에요"
      : value.result.change.status === "applied"
        ? "반영했어요. 사장님께 알렸어요"
        : "변경 요청을 보류했어요. 사장님께 이유를 알렸어요";
const time = (value: string | null) => (value === null ? "아직 확인하지 않았어요" : formatKoreanDateTime(value));

export function OperatorShopReview(props: Props) {
  const back = (
    <a href="/operator/shops" onClick={(event) => props.onNavigate("/operator/shops", event)}>
      영업 신고 확인 목록으로
    </a>
  );
  if (!UUID_PATTERN.test(props.shopId))
    return <LoadFailure failure={classify(404, null, null)} notFoundAction={back} />;
  return <ReviewDetails key={props.shopId} {...props} back={back} />;
}
function ReviewDetails(props: Props & { readonly back: ReactNode }) {
  const callbacks = useRef(props);
  callbacks.current = props;
  const [shop, setShop] = useState<ReviewShopDetail | null>(null);
  const [expired, setExpired] = useState(false);
  const [holdTarget, setHoldTarget] = useState<Target | null>(null);
  const [reasons, setReasons] = useState({ license: "", identity: "" });
  const [localIssue, setLocalIssue] = useState<ReturnType<typeof reviewReasonIssue>>(null);
  const [confirmation, setConfirmation] = useState<Input | null>(null);
  const [needsLatest, setNeedsLatest] = useState(false);
  const [photo, setPhoto] = useState<Target | null>(null);
  const [photoFailed, setPhotoFailed] = useState<Target | null>(null);
  const [duplicateLimit, setDuplicateLimit] = useState(5);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const handled = useRef<unknown>(null),
    handledFailure = useRef<unknown>(null);
  const expire = useCallback(() => {
    setShop(null);
    setExpired(true);
    callbacks.current.onSessionExpired();
  }, []);
  const load = useVersionedRead((signal) => fetchReviewShop(props.shopId, signal), {
    onLoaded: (_mode, data) => {
      setShop(data);
      setNeedsLatest(false);
      setPhotoFailed(null);
    },
    onSessionExpired: expire,
  });
  const command = useCommand<Input, Output>(async (input, key) => {
    if (input.target === "license") {
      const result = await reviewLicense(input.id, input.body, key);
      return result.ok ? { ...result, data: { target: "license", result: result.data } as const } : result;
    }
    const result = await reviewIdentityChange(input.id, input.body, key);
    return result.ok ? { ...result, data: { target: "identity", result: result.data } as const } : result;
  });
  const failure = command.state.kind === "failed" ? command.state.failure : null;
  const busy = load.loading || command.busy || confirmation !== null;
  const locked = busy || command.blocked || needsLatest || Boolean(props.blocked);
  useLayoutEffect(() => {
    props.onBusyChange(busy);
    return () => props.onBusyChange(false);
  }, [busy, props.onBusyChange]);
  useEffect(() => {
    if (holdTarget) reasonRef.current?.focus();
  }, [holdTarget]);
  useEffect(() => {
    if (command.state.kind !== "done" || handled.current === command.state.data) return;
    handled.current = command.state.data;
    if (command.state.data.target === "license") setShop(command.state.data.result.shop);
    else {
      setNeedsLatest(true);
      load.read("stale");
    }
    setHoldTarget(null);
    setLocalIssue(null);
  }, [command.state, load.read]);
  useEffect(() => {
    if (!failure || handledFailure.current === failure) return;
    handledFailure.current = failure;
    if (failure.outcome === "login") expire();
    if (failure.outcome === "field") reasonRef.current?.focus();
    if (
      [
        "version_conflict",
        "already_decided",
        "invalid_state",
        "identity_change_pending",
        "payment_account_missing",
      ].includes(failure.code ?? "")
    ) {
      setNeedsLatest(true);
      load.read("stale");
    }
  }, [failure, load.read, expire]);
  function start(target: Target, decision: "verified" | "applied" | "on_hold") {
    if (locked || !shop) return;
    const change = target === "identity" ? shop.pendingIdentityChange : null;
    if (target === "identity" && !change) return;
    if (decision === "on_hold") {
      const issue = reviewReasonIssue(reasons[target]);
      setLocalIssue(issue);
      if (issue) {
        reasonRef.current?.focus();
        return;
      }
    }
    const input: Input = {
      target,
      id: change?.changeId ?? props.shopId,
      body: reviewPayload(change?.revision ?? shop.revision, decision, reasons[target]),
    };
    if (decision === "on_hold") command.submit(input);
    else setConfirmation(input);
  }
  if (expired || failure?.outcome === "login" || load.failure?.status === 401)
    return <Skeleton label="다시 로그인해 주세요" />;
  if (failure?.outcome === "not_found") return <LoadFailure failure={failure} notFoundAction={props.back} />;
  if (!shop)
    return load.failure ? (
      <LoadFailure
        failure={classify(load.failure.status, load.failure.problem, load.failure.retryAfterSeconds)}
        onRetry={load.retry}
        notFoundAction={props.back}
      />
    ) : (
      <Skeleton label="영업 신고를 불러오고 있어요" />
    );
  const availability = reviewAvailability({
    licenseStatus: shop.licenseStatus,
    hasAccount: shop.paymentAccount !== null,
    hasPendingChange: shop.pendingIdentityChange !== null,
  });
  const change = shop.pendingIdentityChange;
  const account = shop.paymentAccount;
  const reasonErrors = [
    ...(localIssue ? [localIssue] : []),
    ...(failure?.fieldErrors.filter((error) => error.field === "/holdReason").map((error) => error.code) ?? []),
  ];
  const photoUrl = photo === "license" ? shop.licensePhotoUrl : photo === "identity" ? change?.evidencePhotoUrl : null;
  const photoButton = (target: Target, url: string, label: string) => (
    <div className="operator-review-photo">
      <button type="button" disabled={locked} onClick={() => setPhoto(target)} aria-label={`${label} 크게 보기`}>
        <img src={url} alt={label} referrerPolicy="no-referrer" onError={() => setPhotoFailed(target)} />
      </button>
      {photoFailed === target ? (
        <Banner
          tone="warning"
          actions={
            <Button disabled={busy || props.blocked} onClick={() => load.read("stale")}>
              사진 다시 불러오기
            </Button>
          }
        >
          사진을 열 수 없어요. 새 주소로 다시 불러와 주세요
        </Banner>
      ) : null}
    </div>
  );
  return (
    <section className="operator-review" aria-label="가게 영업 신고 상세">
      {command.busy ? <p role="status">{ERROR_CODES.request_in_progress.message}</p> : null}
      <div className="operator-review-toolbar">
        <a
          href={`/operator/shops/${props.shopId}/records`}
          aria-disabled={locked || undefined}
          onClick={(event) =>
            locked ? event.preventDefault() : props.onNavigate(`/operator/shops/${props.shopId}/records`, event)
          }
        >
          가게 기록 보기
        </a>
        <Button kind="secondary" disabled={busy || props.blocked} onClick={() => load.read("stale")}>
          새로 고침
        </Button>
      </div>
      <CommandStatus
        state={command.state}
        fields={["/holdReason"]}
        done={doneText}
        onRetry={command.retry}
        onReload={() => load.read("stale")}
        notFoundAction={props.back}
      />
      {load.failure ? (
        <LoadFailure
          failure={classify(load.failure.status, load.failure.problem, load.failure.retryAfterSeconds)}
          onRetry={load.retry}
          notFoundAction={props.back}
        />
      ) : null}
      {load.loading ? <Skeleton label="최신 영업 신고를 불러오고 있어요" /> : null}
      {shop.duplicates.length ? (
        <Banner tone="warning">
          <span>같은 사업자등록번호의 가게가 {shop.duplicates.length}곳 더 있어요</span>
          <ul>
            {shop.duplicates.slice(0, duplicateLimit).map((item) => (
              <li key={item.shopId}>
                <a
                  href={`/operator/shops/${item.shopId}`}
                  onClick={(event) =>
                    locked ? event.preventDefault() : props.onNavigate(`/operator/shops/${item.shopId}`, event)
                  }
                >
                  {item.name}
                </a>{" "}
                · {item.licenseStatus === "verified" ? "확인됨" : item.licenseStatus === "on_hold" ? "보류" : "확인 중"}
              </li>
            ))}
          </ul>
          {shop.duplicates.length > duplicateLimit ? (
            <Button kind="secondary" disabled={locked} onClick={() => setDuplicateLimit(20)}>
              더 보기
            </Button>
          ) : null}
        </Banner>
      ) : null}
      {change ? (
        <section className="operator-review-change" aria-label="사업자 정보 변경 요청">
          <h2>사업자 정보 변경 요청</h2>
          <p>사업자 정보 변경 요청을 먼저 반영하거나 보류해 주세요</p>
          <dl>
            {(
              [
                ["상호", change.previous.businessName, change.businessName],
                ["대표자", change.previous.representativeName, change.representativeName],
                ["사업자등록번호", change.previous.businessRegNo, change.businessRegNo],
              ] as const
            ).map(([label, previous, next]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  {previous} → {next}
                </dd>
              </div>
            ))}
          </dl>
          <p>요청 시각 {time(change.requestedAt)}</p>
          {change.paymentAccount ? (
            <p>
              {change.paymentAccount.bankName} · {change.paymentAccount.holderName} · 끝{" "}
              {change.paymentAccount.accountLast4}
              {!change.paymentAccount.holderMatchesNew ? <strong>예금주가 새 대표자·상호와 달라요</strong> : null}
            </p>
          ) : (
            <p>등록된 결제 계좌가 없어요</p>
          )}
          {photoButton("identity", change.evidencePhotoUrl, "증빙 사진")}
          <div className="ui-actions">
            <Button disabled={locked} onClick={() => start("identity", "applied")}>
              반영
            </Button>
            <Button
              kind="secondary"
              disabled={locked}
              onClick={() => {
                command.reset();
                setHoldTarget("identity");
                setLocalIssue(null);
              }}
            >
              보류
            </Button>
          </div>
        </section>
      ) : null}
      <div className="operator-review-details">
        {photoButton("license", shop.licensePhotoUrl, "신고증 사진")}
        <div>
          <h2>{shop.name}</h2>
          <dl>
            {(
              [
                ["영업 신고 번호", shop.foodLicenseNo],
                ["영업 종류", shop.foodBusinessType === "bakery" ? "제과점영업" : "즉석판매제조·가공업"],
                ["상호", shop.businessName],
                ["대표자", shop.representativeName],
                ["사업자등록번호", shop.businessRegNo],
                ["사업장 주소", shop.businessAddress],
                ["연락처", shop.contactPhone],
                ["전자우편주소", shop.contactEmail],
                ["통신판매업 신고번호", shop.mailOrderRegNo ?? "면제"],
                ["신고 기관", shop.mailOrderAuthority ?? "해당 없음"],
                ["면제 사유", shop.mailOrderExemption ?? "해당 없음"],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {shop.licenseStatus !== "pending" ? (
            <Banner tone={shop.licenseStatus === "verified" ? "success" : "warning"}>
              {shop.licenseStatus === "verified" ? "확인됨" : "보류"} · {shop.licenseReviewedBy?.displayName} ·{" "}
              {time(shop.licenseReviewedAt)}
              {shop.licenseHoldReason ? <span>{shop.licenseHoldReason}</span> : null}
            </Banner>
          ) : null}
          <h3>결제 계좌</h3>
          {account ? (
            <div>
              <p>
                {account.bankName} · {account.holderName} · 끝 {account.accountLast4}
              </p>
              <p>{account.holderMatches ? "예금주가 대표자와 같아요" : "예금주가 대표자·상호와 달라요"}</p>
              {account.holderMismatchConfirmed === true ? <p>사장님이 가게 명의가 맞다고 답함</p> : null}
              {account.holderCheckedBy ? (
                <p>
                  예금주 확인 {account.holderCheckedBy.displayName} · {time(account.holderCheckedAt)}
                </p>
              ) : null}
            </div>
          ) : failure?.code !== "payment_account_missing" ? (
            <Banner tone="warning">결제 계좌 등록을 기다리고 있어요. 사장님이 계좌를 등록하면 확인할 수 있어요</Banner>
          ) : null}
        </div>
      </div>
      {holdTarget ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            start(holdTarget, "on_hold");
          }}
        >
          <h2>{holdTarget === "license" ? "영업 신고 보류" : "변경 요청 보류"}</h2>
          <Field pointer="/holdReason" label="보류 사유" errors={reasonErrors}>
            {(ids) => (
              <textarea
                {...ids}
                ref={reasonRef}
                className="ui-field__input"
                disabled={locked}
                value={reasons[holdTarget]}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  command.reset();
                  setLocalIssue(null);
                  setReasons((old) => ({ ...old, [holdTarget]: value }));
                }}
              />
            )}
          </Field>
          <p>남은 글자 {200 - [...reasons[holdTarget]].length}자</p>
          <Button type="submit" disabled={locked} busy={command.busy}>
            보류로 남기기
          </Button>
        </form>
      ) : null}
      {availability.canHold ? (
        <div className="operator-review-actions">
          <Button
            disabled={locked || !availability.canVerify}
            busy={command.busy}
            onClick={() => start("license", "verified")}
          >
            확인됨
          </Button>
          <Button
            kind="secondary"
            disabled={locked}
            onClick={() => {
              command.reset();
              setHoldTarget("license");
              setLocalIssue(null);
            }}
          >
            보류
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmation !== null}
        title={confirmation?.target === "identity" ? "반영할까요?" : "확인됨으로 남길까요?"}
        confirmLabel={confirmation?.target === "identity" ? "반영하기" : "확인됨으로 남기기"}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          const input = confirmation;
          setConfirmation(null);
          if (input) command.submit(input);
        }}
      >
        {confirmation?.target === "identity"
          ? "예약 링크 페이지와 확정 안내가 새 값을 써요"
          : "첫 버전에서는 확인됨을 보류로 바꿀 수 없어요"}
      </ConfirmDialog>
      <PhotoViewer url={photoUrl ?? null} onClose={() => setPhoto(null)} onError={() => setPhotoFailed(photo)} />
    </section>
  );
}
function PhotoViewer({
  url,
  onClose,
  onError,
}: {
  readonly url: string | null;
  readonly onClose: () => void;
  readonly onError: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    origin = useRef<HTMLElement | null>(null);
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (url && !dialog.open) {
      origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setZoomed(false);
      dialog.showModal();
    } else if (!url && dialog.open) dialog.close();
  }, [url]);
  useEffect(
    () => () => {
      if (origin.current?.isConnected) origin.current.focus();
    },
    [],
  );
  return (
    <dialog
      ref={ref}
      className={`operator-photo-dialog${zoomed ? " operator-photo-dialog--zoomed" : ""}`}
      aria-label="신고증과 증빙 사진 크게 보기"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (ref.current?.open) return;
        if (origin.current?.isConnected) origin.current.focus();
        onClose();
      }}
      onKeyDown={keepFocusInside}
    >
      <div className="ui-actions">
        <Button onClick={onClose}>닫기</Button>
        <Button kind="secondary" onClick={() => setZoomed((old) => !old)}>
          {zoomed ? "화면에 맞추기" : "확대"}
        </Button>
      </div>
      {url ? (
        <img src={url} alt="크게 보는 신고증 또는 증빙 사진" referrerPolicy="no-referrer" onError={onError} />
      ) : null}
    </dialog>
  );
}
