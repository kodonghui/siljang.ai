import { type FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CONNECTION_FAILED } from "./api";
import { formatKoreanDateTime } from "./format-date";
import {
  fetchPaymentDestination,
  type PaymentDestination,
  type PaymentDestinationResult,
  savePaymentDestination,
} from "./payment-destination-api";
import {
  PAYMENT_FIELDS,
  type PaymentForm,
  paymentForm,
  paymentIssues,
  paymentPayload,
  rebasePayment,
} from "./payment-destination-form";
import { classify } from "./problems";
import type { ShopLicenseProps } from "./ShopLicense";
import {
  Banner,
  Button,
  CommandStatus,
  ConfirmRequired,
  fieldErrorsFor,
  LoadFailure,
  OwnerLayout,
  Skeleton,
  TextField,
} from "./ui";
import { useCommand } from "./useCommand";
import { useVersionedRead } from "./useVersionedRead";
import "./payment-destination.css";

const fields = PAYMENT_FIELDS.map((key) => `/${key}`);
const labels = {
  bankName: "은행",
  accountNumber: "계좌번호",
  holderName: "예금주",
  cardPaymentUrl: "카드 결제 링크(선택)",
};
export interface PaymentDestinationEditorProps extends ShopLicenseProps {
  readonly licenseStatus?: "pending" | "verified" | "on_hold";
  readonly onSaved?: () => void;
}
export function PaymentDestinationEditor(props: PaymentDestinationEditorProps) {
  const callbacks = useRef(props);
  callbacks.current = props;
  const [base, setBase] = useState<PaymentDestination | null>(null),
    [form, setForm] = useState<PaymentForm>(() => paymentForm(null)),
    [loaded, setLoaded] = useState(false),
    [stale, setStale] = useState(false),
    [latest, setLatest] = useState<PaymentDestination | null>(null),
    [showErrors, setShowErrors] = useState(false),
    [licenseRechecking, setLicenseRechecking] = useState(false);
  const {
    loading,
    failure: loadFailure,
    read,
    retry,
    clearFailure,
  } = useVersionedRead(fetchPaymentDestination, {
    sessionChecking: Boolean(props.sessionChecking || props.logoutPending),
    sessionFailed: Boolean(props.sessionFailed),
    allowNotSet: true,
    onLoaded: (mode, data) => {
      if (mode === "stale") setLatest(data);
      else adopt(data, undefined, true);
    },
    onNotSet: () => adopt(null, undefined, true),
    onSessionExpired: () => callbacks.current.onSessionExpired(),
    onRegisterShop: () => callbacks.current.onRegisterShop(),
  });
  const command = useCommand<Record<string, unknown>, PaymentDestinationResult>((body, key) => {
    if (callbacks.current.sessionChecking || callbacks.current.sessionFailed || callbacks.current.logoutPending)
      return Promise.resolve(CONNECTION_FAILED);
    return savePaymentDestination(body, key);
  });
  const handledDone = useRef<unknown>(null),
    handledFailure = useRef<unknown>(null),
    focusPending = useRef<string | null>(null),
    formRef = useRef<HTMLFormElement>(null),
    statusRef = useRef<HTMLElement>(null);
  const bankOptions = useId();
  const pending =
      command.busy || (!props.sessionFailed && loading) || Boolean(props.sessionChecking || props.logoutPending),
    requestsBlocked = pending || Boolean(props.sessionFailed),
    navigationLocked = requestsBlocked || command.state.kind === "confirm",
    locked = navigationLocked || Boolean(loadFailure);
  const failure = command.state.kind === "failed" ? command.state.failure : null;
  const adopt = useCallback(
    (value: PaymentDestination | null, draft?: PaymentForm, reset = false) => {
      setBase(value);
      setForm(draft ?? paymentForm(value));
      setLoaded(true);
      setStale(false);
      setLatest(null);
      setShowErrors(false);
      clearFailure();
      if (reset) command.reset();
    },
    [clearFailure, command.reset],
  );
  useEffect(() => {
    if (command.state.kind !== "done" || handledDone.current === command.state.data) return;
    handledDone.current = command.state.data;
    adopt(command.state.data.paymentDestination);
    if (command.state.data.outcome === "created") {
      setLicenseRechecking(callbacks.current.licenseStatus === "on_hold");
      if (callbacks.current.licenseStatus === "on_hold") callbacks.current.onSaved?.();
    }
  }, [command.state, adopt]);
  useEffect(() => {
    if (!failure || handledFailure.current === failure) return;
    handledFailure.current = failure;
    if (failure.outcome === "login") callbacks.current.onSessionExpired();
    if (failure.outcome === "no_shop") callbacks.current.onRegisterShop();
    if (failure.code === "version_conflict") {
      setStale(true);
      setLatest(null);
      read("stale");
    }
    if (failure.outcome === "field")
      focusPending.current =
        failure.code === "holder_not_verified"
          ? "/holderName"
          : (failure.fieldErrors.find((e) => fields.includes(e.field))?.field ?? "status");
  }, [failure, read]);
  useEffect(() => {
    const pointer = focusPending.current;
    if (!pointer || requestsBlocked) return;
    const field = Array.from(formRef.current?.querySelectorAll<HTMLElement>("[data-pointer]") ?? []).find(
      (el) => el.dataset.pointer === pointer,
    );
    const input = field?.querySelector<HTMLInputElement>("input");
    focusPending.current = null;
    (input && !input.disabled ? input : statusRef.current)?.focus();
  });
  const issues = useMemo(() => paymentIssues(form), [form]);
  const errors = fieldErrorsFor(
    [...(failure?.fieldErrors ?? []), ...issues.filter((e) => showErrors || e.code !== "required")],
    fields,
  ).byField;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (locked || stale || !loaded || command.blocked) return;
    if (issues.length) {
      setShowErrors(true);
      focusPending.current = issues[0]?.field ?? "status";
      return;
    }
    command.submit(paymentPayload(base, form));
  }
  return (
    <OwnerLayout
      screen="SCR-040"
      title="결제 수단"
      shopName={props.shopName}
      back="/owner/shop"
      busy={navigationLocked}
      onNavigate={(href, event) => {
        event.preventDefault();
        if (!navigationLocked) props.onNavigate(href);
      }}
    >
      <div className="payment-editor">
        <div className="payment-actions">
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
        {loading && !loaded ? <Skeleton rows={4} label="결제 수단을 불러오고 있어요" /> : null}
        {loadFailure ? (
          <LoadFailure
            failure={classify(loadFailure.status, loadFailure.problem, loadFailure.retryAfterSeconds)}
            disabled={requestsBlocked}
            onRetry={() => {
              if (!requestsBlocked) retry();
            }}
            onLogin={props.onSessionExpired}
            onRegisterShop={props.onRegisterShop}
          />
        ) : null}
        {command.busy ? <p role="status">처리하고 있어요. 잠시 뒤 다시 확인해 주세요</p> : null}
        {loaded ? (
          <form ref={formRef} noValidate onSubmit={submit} className="payment-form">
            {!base ? <Banner tone="accent">결제 수단을 등록해야 예약 링크가 나와요</Banner> : null}
            <p>결제 안내에는 이 계좌와 링크만 나가요. 우리 회사 계좌는 쓰지 않아요</p>
            <p>이미 나간 결제 안내의 계좌는 그대로예요.</p>
            {base ? <p>등록 시각: {formatKoreanDateTime(base.createdAt)}</p> : null}
            {base?.holderMismatchConfirmed ? <p>상호·대표자와 다른 가게 명의 계좌임을 확인했어요</p> : null}
            {stale ? (
              <section className="payment-latest" aria-label="지금 결제 수단">
                <Banner tone="warning">그 사이 바뀌었어요. 지금 상태를 확인해 주세요</Banner>
                {latest ? (
                  <>
                    <dl>
                      {PAYMENT_FIELDS.map((key) => (
                        <div key={key}>
                          <dt>{labels[key]}</dt>
                          <dd>{latest[key] ?? "아직 정하지 않았어요"}</dd>
                        </div>
                      ))}
                    </dl>
                    <p>내 입력은 아래에 남아 있어요. 같은 필드가 바뀌었으면 다시 적용한 내 값이 사용돼요.</p>
                    <Button
                      disabled={locked}
                      onClick={() => {
                        if (!locked) adopt(latest, rebasePayment(base, form, latest), true);
                      }}
                    >
                      내 변경 다시 적용
                    </Button>
                    <Button
                      disabled={locked}
                      onClick={() => {
                        if (!locked) adopt(latest, undefined, true);
                      }}
                    >
                      지금 값으로 다시 시작
                    </Button>
                  </>
                ) : null}
                {!latest && !loading ? (
                  <Button
                    disabled={locked}
                    onClick={() => {
                      if (!locked) read("stale");
                    }}
                  >
                    지금 상태 다시 읽기
                  </Button>
                ) : null}
              </section>
            ) : null}
            <section ref={statusRef} tabIndex={-1} aria-label="결제 수단 저장 결과">
              <CommandStatus
                state={command.state}
                fields={fields}
                fieldCodes={["holder_not_verified"]}
                disabled={locked}
                onRetry={() => {
                  if (!locked && !stale) command.retry();
                }}
                onReload={() => {
                  if (!locked) {
                    setStale(true);
                    setLatest(null);
                    read("stale");
                  }
                }}
                done={(data) =>
                  data.outcome === "created"
                    ? "저장했어요. 이제부터 나가는 결제 안내에 이 계좌를 써요"
                    : "바뀐 것이 없어요"
                }
              />
              {showErrors && issues.length ? <Banner tone="danger">입력한 내용을 확인해 주세요</Banner> : null}
              {licenseRechecking ? <Banner tone="accent">영업 신고를 다시 확인하고 있어요</Banner> : null}
            </section>
            <div className="payment-fields">
              {PAYMENT_FIELDS.map((key) => (
                <TextField
                  key={key}
                  pointer={`/${key}`}
                  label={labels[key]}
                  value={form[key]}
                  disabled={locked}
                  errors={errors.get(`/${key}`)}
                  note={key === "holderName" && failure?.code === "holder_not_verified" ? failure.message : undefined}
                  help={
                    key === "accountNumber"
                      ? "숫자와 '-'만, 숫자는 10~16자리로 적어 주세요"
                      : key === "cardPaymentUrl"
                        ? "https 주소를 2,048자까지 등록할 수 있어요"
                        : "30자까지 적을 수 있어요"
                  }
                  list={key === "bankName" ? bankOptions : undefined}
                  inputMode={key === "accountNumber" ? "tel" : key === "cardPaymentUrl" ? "url" : "text"}
                  autoComplete="off"
                  maxLength={key === "accountNumber" ? 40 : key === "cardPaymentUrl" ? 4096 : undefined}
                  onChange={(event) => {
                    if (locked) return;
                    const value = event.currentTarget.value;
                    command.reset();
                    setShowErrors(false);
                    setLicenseRechecking(false);
                    setForm((old) => ({ ...old, [key]: value }));
                  }}
                />
              ))}
            </div>
            <datalist id={bankOptions}>{base ? <option value={base.bankName} /> : null}</datalist>
            <footer className="payment-save">
              <Button type="submit" kind="primary" busy={command.busy} disabled={locked || stale || command.blocked}>
                저장
              </Button>
            </footer>
          </form>
        ) : null}
        <ConfirmRequired
          items={command.state.kind === "confirm" ? command.state.items : null}
          confirmLabel="가게 명의가 맞아요"
          confirmDisabled={requestsBlocked}
          onConfirm={() => {
            if (!requestsBlocked) command.confirm();
          }}
          onCancel={command.cancelConfirm}
        />
      </div>
    </OwnerLayout>
  );
}
