import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiFailure } from "./api";
import {
  fetchOperatingRules,
  type OperatingRules,
  type OperatingRulesResult,
  saveOperatingRules,
} from "./operating-rules-api";
import {
  CLAUSE_NAMES,
  type ClauseForm,
  type OperatingRulesForm,
  rebaseRules,
  rulesForm,
  rulesIssues,
  rulesPayload,
} from "./operating-rules-form";
import { classify, type FieldError, fieldReasonText } from "./problems";
import type { ShopLicenseProps } from "./ShopLicense";
import {
  Banner,
  Button,
  CommandStatus,
  ConfirmRequired,
  Field,
  fieldErrorsFor,
  LoadFailure,
  OwnerLayout,
  Skeleton,
  TextField,
} from "./ui";
import { useCommand } from "./useCommand";
import "./operating-rules.css";

const LABELS = {
  quoteValidHours: "견적 유효 기한(시간)",
  paymentDueHours: "결제 기한(시간)",
  issueReportHours: "문제 신고 기한(시간)",
  changeDeadlineHours: "변경 마감(시간)",
  cancellationFeeKrw: "취소 수수료(원)",
  preProductionRefundPct: "제작 전 취소 환불(%)",
} as const;
const NETWORK: ApiFailure = { ok: false, status: 0, problem: null, retryAfterSeconds: null };
const dateFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" });
function orderedClauses(form: OperatingRulesForm) {
  return form.clauses.filter((c) => c.enabled).sort((a, b) => a.position - b.position);
}
function pointers(form: OperatingRulesForm): string[] {
  return [
    ...Object.keys(LABELS).map((k) => `/${k}`),
    "/dateChangeRefundBasis",
    ...orderedClauses(form).flatMap((_, i) => [
      `/clauses/${i}`,
      `/clauses/${i}/title`,
      `/clauses/${i}/conditionText`,
      `/clauses/${i}/effectText`,
    ]),
    ...form.refundTiers.flatMap((_, i) => [
      `/refundTiers/${i}`,
      `/refundTiers/${i}/hoursBeforeMin`,
      `/refundTiers/${i}/hoursBeforeMax`,
      `/refundTiers/${i}/refundPct`,
    ]),
  ];
}
function TextArea(props: {
  pointer: string;
  label: string;
  value: string;
  disabled: boolean;
  errors: readonly FieldError["code"][] | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <Field pointer={props.pointer} label={props.label} errors={props.errors}>
      {(ids) => (
        <span className="ui-field__box">
          <textarea
            {...ids}
            className="ui-field__input rules-textarea"
            value={props.value}
            disabled={props.disabled}
            onChange={(e) => props.onChange(e.currentTarget.value)}
          />
        </span>
      )}
    </Field>
  );
}
export function OperatingRulesEditor(props: ShopLicenseProps) {
  const callbacks = useRef(props);
  callbacks.current = props;
  const [base, setBase] = useState<OperatingRules | null>(null),
    [form, setForm] = useState<OperatingRulesForm | null>(null),
    [loading, setLoading] = useState(true),
    [loadFailure, setLoadFailure] = useState<ApiFailure | null>(null),
    [stale, setStale] = useState(false),
    [latest, setLatest] = useState<OperatingRules | null>(null),
    [conflicts, setConflicts] = useState<string[]>([]),
    [showErrors, setShowErrors] = useState(false);
  const command = useCommand<Record<string, unknown>, OperatingRulesResult>((body, key) => {
    if (callbacks.current.sessionChecking || callbacks.current.sessionFailed || callbacks.current.logoutPending)
      return Promise.resolve(NETWORK);
    return saveOperatingRules(body, key);
  });
  const readNeeded = useRef(true);
  const activeRead = useRef<AbortController | null>(null),
    lastMode = useRef<"initial" | "stale">("initial"),
    formRef = useRef<HTMLFormElement>(null),
    statusRef = useRef<HTMLElement>(null),
    focusPending = useRef<string | null>(null),
    handledDone = useRef<unknown>(null),
    handledFailure = useRef<unknown>(null);
  const failure = command.state.kind === "failed" ? command.state.failure : null;
  const pending =
      (!props.sessionFailed && loading) || command.busy || Boolean(props.sessionChecking || props.logoutPending),
    requestsBlocked = pending || Boolean(props.sessionFailed),
    locked = requestsBlocked || command.state.kind === "confirm";
  const formValue = useRef(form);
  formValue.current = form;
  const adopt = useCallback(
    (value: OperatingRules, draft?: OperatingRulesForm, reset = false) => {
      setBase(value);
      setForm(draft ?? rulesForm(value));
      setLatest(null);
      setStale(false);
      setConflicts([]);
      setShowErrors(false);
      setLoadFailure(null);
      if (reset) command.reset();
    },
    [command.reset],
  );
  const read = useCallback(
    (mode: "initial" | "stale") => {
      if (callbacks.current.sessionChecking || callbacks.current.sessionFailed) return;
      readNeeded.current = true;
      activeRead.current?.abort();
      const controller = new AbortController();
      activeRead.current = controller;
      lastMode.current = mode;
      setLoading(true);
      setLoadFailure(null);
      void fetchOperatingRules(controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          readNeeded.current = false;
          setLoading(false);
          if (result.ok) {
            if (mode === "stale") setLatest(result.data);
            else adopt(result.data, undefined, true);
          } else {
            setLoadFailure(result);
            if (result.status === 401) callbacks.current.onSessionExpired();
            if (result.problem?.code === "shop_not_registered") callbacks.current.onRegisterShop();
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            readNeeded.current = false;
            setLoading(false);
            setLoadFailure(NETWORK);
          }
        });
    },
    [adopt],
  );
  useEffect(() => {
    if (props.sessionChecking || props.sessionFailed) {
      activeRead.current?.abort();
      return;
    }
    if (readNeeded.current) read(lastMode.current);
    return () => activeRead.current?.abort();
  }, [read, props.sessionChecking, props.sessionFailed]);
  useEffect(() => {
    if (command.state.kind !== "done" || handledDone.current === command.state.data) return;
    handledDone.current = command.state.data;
    adopt(command.state.data.operatingRules);
  }, [command.state, adopt]);
  const reveal = useCallback((pointer: string | undefined) => {
    const current = formValue.current;
    focusPending.current = current && pointer && pointers(current).includes(pointer) ? pointer : "status";
  }, []);
  useEffect(() => {
    if (!failure || handledFailure.current === failure) return;
    handledFailure.current = failure;
    if (failure.outcome === "login") callbacks.current.onSessionExpired();
    if (failure.outcome === "no_shop") callbacks.current.onRegisterShop();
    if (failure.code === "version_conflict") {
      setStale(true);
      setLatest(null);
      setConflicts([]);
      read("stale");
    }
    if (failure.outcome === "field") reveal(failure.fieldErrors[0]?.field);
  }, [failure, read, reveal]);
  useEffect(() => {
    const pointer = focusPending.current;
    if (!pointer || requestsBlocked) return;
    const field = Array.from(
      formRef.current?.querySelectorAll<HTMLElement>("[data-pointer],[data-row-pointer]") ?? [],
    ).find((el) => el.dataset.pointer === pointer || el.dataset.rowPointer === pointer);
    const input = field?.querySelector<HTMLElement>("input,select,textarea,button");
    const target = pointer === "status" || !input || input.matches(":disabled") ? statusRef.current : input;
    focusPending.current = null;
    target?.focus();
  });
  const issues = useMemo(() => (form ? rulesIssues(form) : []), [form]),
    fields = useMemo(() => (form ? pointers(form) : []), [form]);
  const allErrors = [...(failure?.fieldErrors ?? []), ...issues.filter((e) => showErrors || e.code !== "required")];
  const errors = fieldErrorsFor(allErrors, fields).byField;
  const canEdit = () => !locked;
  const mutate = (change: (old: OperatingRulesForm) => OperatingRulesForm) => {
    if (!canEdit()) return;
    command.reset();
    setShowErrors(false);
    setConflicts([]);
    setForm((old) => (old ? change(old) : old));
  };
  const rowErrors = (pointer: string) => allErrors.filter((e) => e.field === pointer);
  const notes = (pointer: string) =>
    rowErrors(pointer)
      .map((e) => fieldReasonText(e.code))
      .join(" · ");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canEdit() || stale || !form || !base) return;
    if (issues.length) {
      setShowErrors(true);
      reveal(issues[0]?.field);
      return;
    }
    command.submit(rulesPayload(base, form));
  }
  function clause(id: string, patch: Partial<ClauseForm>) {
    mutate((old) => ({ ...old, clauses: old.clauses.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  }
  const active = form ? orderedClauses(form) : [],
    indices = new Map(active.map((c, i) => [c.id, i]));
  const exceeds = allErrors.some((e) => e.code === "exceeds_card_limit"),
    paired = allErrors.some((e) => ["/clauses", "/refundTiers"].includes(e.field) && e.code === "required");
  const loadFail = loadFailure ? (
    <LoadFailure
      failure={classify(loadFailure.status, loadFailure.problem, loadFailure.retryAfterSeconds)}
      disabled={requestsBlocked}
      onRetry={() => {
        if (!requestsBlocked) read(lastMode.current);
      }}
      onLogin={props.onSessionExpired}
      onRegisterShop={props.onRegisterShop}
    />
  ) : null;
  return (
    <OwnerLayout
      screen="SCR-038"
      title="운영규정"
      shopName={props.shopName}
      back="/owner/shop"
      busy={locked}
      onNavigate={(href, event) => {
        event.preventDefault();
        if (!locked) props.onNavigate(href);
      }}
    >
      <div className="rules-editor">
        <div className="rules-actions">
          <Button
            disabled={locked || !base}
            onClick={() => {
              if (!locked && base) props.onNavigate("/owner/operating-rules/versions");
            }}
          >
            버전 이력
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
        {loading && !form ? <Skeleton rows={6} label="운영규정을 불러오고 있어요" /> : null}
        {loadFail}
        {command.busy ? <p role="status">처리하고 있어요. 잠시 뒤 다시 확인해 주세요</p> : null}
        {base && form ? (
          <form ref={formRef} onSubmit={submit} noValidate className="rules-form">
            {base.isTemplate ? (
              <Banner tone="accent">아직 확정 전이에요. 기본값을 확인하고 확정해 주세요</Banner>
            ) : (
              <p>
                운영규정 버전 {base.version}
                {base.createdAt ? ` · ${dateFormat.format(new Date(base.createdAt))} 확정` : ""}
              </p>
            )}
            {stale ? (
              <section className="rules-latest" aria-label="지금 운영규정">
                <Banner tone="warning">그 사이 바뀌었어요. 지금 상태를 확인해 주세요</Banner>
                {latest ? (
                  <>
                    <ReadRules value={latest} />
                    <p>내 입력은 아래에 남아 있어요. 같은 필드가 바뀌었으면 다시 적용한 내 값이 사용돼요.</p>
                    <Button
                      disabled={locked}
                      onClick={() => {
                        if (!canEdit()) return;
                        const result = rebaseRules(base, form, latest);
                        setConflicts(result.conflicts);
                        if (result.form) adopt(latest, result.form, true);
                      }}
                    >
                      내 변경 다시 적용
                    </Button>
                    <Button
                      disabled={locked}
                      onClick={() => {
                        if (canEdit()) adopt(latest, undefined, true);
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
                      if (canEdit()) read("stale");
                    }}
                  >
                    지금 상태 다시 읽기
                  </Button>
                ) : null}
              </section>
            ) : null}
            {conflicts.length ? (
              <Banner
                tone="warning"
                detail={
                  <ul>
                    {conflicts.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                }
              >
                대응할 수 없는 변경이 있어요. 남긴 입력과 지금 값을 비교해 주세요.
              </Banner>
            ) : null}
            <section ref={statusRef} aria-label="운영규정 확정 결과" tabIndex={-1}>
              <CommandStatus
                state={command.state}
                fields={fields}
                disabled={locked}
                onRetry={() => {
                  if (canEdit() && !stale) command.retry();
                }}
                onReload={() => {
                  if (canEdit()) {
                    setStale(true);
                    setLatest(null);
                    read("stale");
                  }
                }}
                done={(data) =>
                  data.outcome === "created"
                    ? `확정했어요. 운영규정 버전 ${data.operatingRules.version}`
                    : "바뀐 것이 없어 새 버전을 만들지 않았어요"
                }
              />
              {showErrors && issues.length ? <Banner tone="danger">입력한 내용을 확인해 주세요</Banner> : null}
            </section>
            <section className="rules-section" aria-label="기한과 환불 기준">
              <h2>기한과 환불 기준</h2>
              <div className="rules-values">
                {(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((key) => (
                  <TextField
                    key={key}
                    pointer={`/${key}`}
                    label={LABELS[key]}
                    value={form[key]}
                    inputMode="numeric"
                    disabled={locked}
                    errors={errors.get(`/${key}`)}
                    onChange={(e) => {
                      const value = e.currentTarget.value;
                      mutate((old) => ({ ...old, [key]: value }));
                    }}
                  />
                ))}
              </div>
              <Field
                pointer="/dateChangeRefundBasis"
                label="날짜 변경 환불 기준"
                errors={errors.get("/dateChangeRefundBasis")}
              >
                {(ids) => (
                  <span className="ui-field__box">
                    <select
                      {...ids}
                      className="ui-field__input"
                      value={form.dateChangeRefundBasis}
                      disabled={locked}
                      onChange={(e) => {
                        const value = e.currentTarget.value;
                        if (value === "" || value === "original_pickup" || value === "new_pickup")
                          mutate((old) => ({ ...old, dateChangeRefundBasis: value }));
                      }}
                    >
                      <option value="">기준일 선택</option>
                      <option value="original_pickup">처음 픽업 일시</option>
                      <option value="new_pickup">바꾼 픽업 일시</option>
                    </select>
                  </span>
                )}
              </Field>
              <p>문제 신고 기한이 지나도 신고할 수 있어요. 기한과 조문 글을 함께 확인해 주세요.</p>
            </section>
            <section className="rules-section" aria-label="단계별 환불">
              <h2>단계별 환불</h2>
              <p>
                {form.refundTiers.length
                  ? "맞춤 재료 주문·제작 시작 뒤 취소는 이 표로, 그 전은 제작 전 취소 비율로 계산해요. 취소 수수료를 먼저 빼고 비율을 곱해요(원 미만 버림)"
                  : "단계별 환불이 없으면 제작을 시작한 뒤의 취소도 제작 전 취소 비율로 계산돼요"}
              </p>
              {form.refundTiers.map((row, i) => {
                const pointer = `/refundTiers/${i}`;
                return (
                  <fieldset
                    key={row.id}
                    className="rules-tier"
                    data-row-pointer={pointer}
                    data-invalid={
                      allErrors.some((e) => e.field === pointer || e.field.startsWith(`${pointer}/`)) ? true : undefined
                    }
                  >
                    <legend>환불 단계 {i + 1}</legend>
                    {(["hoursBeforeMin", "hoursBeforeMax", "refundPct"] as const).map((key) => (
                      <TextField
                        key={key}
                        pointer={`${pointer}/${key}`}
                        label={
                          key === "hoursBeforeMin"
                            ? "몇 시간 전부터"
                            : key === "hoursBeforeMax"
                              ? "몇 시간 전까지"
                              : "환불 비율"
                        }
                        help={
                          key === "hoursBeforeMax" ? "비우면 끝없음" : key === "hoursBeforeMin" ? "이 값 포함" : "%"
                        }
                        value={row[key]}
                        inputMode="numeric"
                        disabled={locked}
                        errors={errors.get(`${pointer}/${key}`)}
                        onChange={(e) => {
                          const value = e.currentTarget.value;
                          mutate((old) => ({
                            ...old,
                            refundTiers: old.refundTiers.map((t) => (t.id === row.id ? { ...t, [key]: value } : t)),
                          }));
                        }}
                      />
                    ))}
                    {notes(pointer) ? <p className="ui-field__error">{notes(pointer)}</p> : null}
                    <Button
                      disabled={locked}
                      onClick={() =>
                        mutate((old) => ({ ...old, refundTiers: old.refundTiers.filter((t) => t.id !== row.id) }))
                      }
                    >
                      단계 삭제
                    </Button>
                  </fieldset>
                );
              })}
              <Button
                disabled={locked || form.refundTiers.length >= 20}
                onClick={() =>
                  mutate((old) => ({
                    ...old,
                    refundTiers: [
                      ...old.refundTiers,
                      { id: crypto.randomUUID(), hoursBeforeMin: "", hoursBeforeMax: "", refundPct: "" },
                    ],
                  }))
                }
              >
                환불 단계 추가
              </Button>
              <p>환불 단계 {form.refundTiers.length}/20개 · 0시간부터 끝없음까지 빈 구간 없이 채워 주세요.</p>
            </section>
            <section className="rules-section" aria-label="운영규정 조문">
              <h2>조문</h2>
              {exceeds ? <Banner tone="danger">주문 요청 카드에 다 들어가지 않아요. 조문을 줄여 주세요</Banner> : null}
              {paired ? <Banner tone="danger">단계별 환불 조문과 표를 함께 채워 주세요</Banner> : null}
              {form.clauses.map((row, order) => {
                const i = indices.get(row.id),
                  pointer = i === undefined ? `/draftClauses/${row.id}` : `/clauses/${i}`;
                return (
                  <fieldset
                    key={row.id}
                    className="rules-clause"
                    data-row-pointer={i === undefined ? undefined : pointer}
                    data-invalid={
                      i !== undefined && allErrors.some((e) => e.field === pointer || e.field.startsWith(`${pointer}/`))
                        ? true
                        : undefined
                    }
                  >
                    <legend>조문 {order + 1}</legend>
                    <h3>{row.title || CLAUSE_NAMES[row.key]}</h3>
                    {!row.enabled ? (
                      <Button
                        disabled={locked || active.length >= 50}
                        onClick={() =>
                          clause(row.id, { enabled: true, position: Math.max(0, ...active.map((c) => c.position)) + 1 })
                        }
                      >
                        이 조문 넣기
                      </Button>
                    ) : (
                      <Button
                        disabled={locked}
                        onClick={() =>
                          row.key === "custom"
                            ? mutate((old) => ({ ...old, clauses: old.clauses.filter((c) => c.id !== row.id) }))
                            : clause(row.id, { enabled: false })
                        }
                      >
                        조문 빼기
                      </Button>
                    )}
                    <TextField
                      pointer={`${pointer}/title`}
                      label="조문 이름"
                      value={row.title}
                      disabled={locked || !row.enabled}
                      errors={errors.get(`${pointer}/title`)}
                      onChange={(e) => clause(row.id, { title: e.currentTarget.value })}
                    />
                    <TextArea
                      pointer={`${pointer}/conditionText`}
                      label="조건"
                      value={row.conditionText}
                      disabled={locked || !row.enabled}
                      errors={errors.get(`${pointer}/conditionText`)}
                      onChange={(value) => clause(row.id, { conditionText: value })}
                    />
                    <TextArea
                      pointer={`${pointer}/effectText`}
                      label="효과"
                      value={row.effectText}
                      disabled={locked || !row.enabled}
                      errors={errors.get(`${pointer}/effectText`)}
                      onChange={(value) => clause(row.id, { effectText: value })}
                    />
                    {notes(pointer) ? <p className="ui-field__error">{notes(pointer)}</p> : null}
                  </fieldset>
                );
              })}
              <Button
                disabled={locked || active.length >= 50}
                onClick={() =>
                  mutate((old) => ({
                    ...old,
                    clauses: [
                      ...old.clauses,
                      {
                        id: crypto.randomUUID(),
                        key: "custom",
                        position: Math.max(0, ...active.map((c) => c.position)) + 1,
                        title: "",
                        conditionText: "",
                        effectText: "",
                        enabled: true,
                      },
                    ],
                  }))
                }
              >
                조문 추가
              </Button>
              <p>조문 {active.length}/50개</p>
            </section>
            <div className="rules-save">
              <Button kind="primary" type="submit" disabled={locked || stale} busy={command.busy}>
                확정
              </Button>
            </div>
          </form>
        ) : null}
        <ConfirmRequired
          items={command.state.kind === "confirm" ? command.state.items : null}
          confirmLabel="그래도 저장"
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
function ReadRules({ value }: { readonly value: OperatingRules }) {
  return (
    <div className="rules-comparison">
      <p>{value.isTemplate ? "아직 확정 전이에요" : `운영규정 버전 ${value.version}`}</p>
      <dl>
        {(Object.entries(LABELS) as [keyof typeof LABELS, string][]).map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{value[key] ?? "아직 정하지 않음"}</dd>
          </div>
        ))}
        <div>
          <dt>날짜 변경 환불 기준</dt>
          <dd>
            {value.dateChangeRefundBasis === "original_pickup"
              ? "처음 픽업 일시"
              : value.dateChangeRefundBasis === "new_pickup"
                ? "바꾼 픽업 일시"
                : "아직 정하지 않음"}
          </dd>
        </div>
      </dl>
      {value.clauses.map((row) => (
        <details key={row.position}>
          <summary>{row.title}</summary>
          <p>{row.conditionText}</p>
          <p>{row.effectText}</p>
        </details>
      ))}
      <ul>
        {value.refundTiers.map((row) => (
          <li key={JSON.stringify([row.hoursBeforeMin, row.hoursBeforeMax])}>
            {row.hoursBeforeMin}시간 전부터{" "}
            {row.hoursBeforeMax === null ? "끝없음" : `${row.hoursBeforeMax}시간 전까지`} · {row.refundPct}%
          </li>
        ))}
      </ul>
    </div>
  );
}
