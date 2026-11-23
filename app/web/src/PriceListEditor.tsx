import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiFailure } from "./api";
import { DesignImage } from "./DesignImage";
import {
  fetchPriceList,
  type OptionGroup,
  type PriceKind,
  type PriceList,
  type PriceListResult,
  savePriceList,
} from "./price-list-api";
import { priceFieldPointers, priceListChanges, priceListIssues } from "./price-list-fields";
import {
  type DesignForm,
  OPTION_GROUPS,
  type OptionForm,
  type PriceListForm,
  priceListForm,
  priceListPayload,
  type RuleForm,
  rebasePriceList,
  removePriceOption,
} from "./price-list-form";
import { classify, type FieldReason } from "./problems";
import type { ShopLicenseProps } from "./ShopLicense";
import {
  Banner,
  Button,
  CommandStatus,
  EmptyState,
  Field,
  fieldErrorsFor,
  LoadFailure,
  OwnerLayout,
  Skeleton,
  TextField,
} from "./ui";
import { useCommand } from "./useCommand";
import { photoRejected } from "./usePhotoUpload";
import "./price-list.css";

const GROUPS: Record<OptionGroup, string> = { size: "크기", flavor: "맛", design: "디자인", extra: "추가" };
const NETWORK: ApiFailure = { ok: false, status: 0, problem: null, retryAfterSeconds: null };
const key = () => crypto.randomUUID();
type LoadMode = "initial" | "stale";
function move<T extends { key: string; position: number }>(rows: T[], from: string, to: string): T[] {
  const sorted = [...rows].sort((a, b) => a.position - b.position),
    source = sorted.find((r) => r.key === from);
  const index = sorted.findIndex((r) => r.key === to);
  if (!source || index < 0 || from === to) return rows;
  const rest = sorted.filter((r) => r.key !== from);
  rest.splice(index, 0, source);
  return rest.map((r, i) => ({ ...r, position: i + 1 }));
}
function SelectField(props: {
  pointer: string;
  label: string;
  value: string;
  choices: readonly (readonly [string, string])[];
  disabled: boolean;
  errors?: readonly FieldReason[] | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <Field pointer={props.pointer} label={props.label} errors={props.errors}>
      {(ids) => (
        <span className="ui-field__box">
          <select
            {...ids}
            className="ui-field__input"
            value={props.value}
            disabled={props.disabled}
            onChange={(e) => props.onChange(e.currentTarget.value)}
          >
            {props.choices.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </span>
      )}
    </Field>
  );
}
function StandardField(props: {
  pointer: string;
  checked: boolean;
  disabled: boolean;
  errors?: readonly FieldReason[] | undefined;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="price-check">
      <Field
        pointer={props.pointer}
        label="기본 디자인 범위"
        errors={props.errors}
        messages={{ not_allowed: "이 행은 기본 디자인 범위에 넣을 수 없어요" }}
      >
        {(ids) => (
          <input
            {...ids}
            type="checkbox"
            checked={props.checked}
            disabled={props.disabled}
            onChange={(e) => props.onChange(e.currentTarget.checked)}
          />
        )}
      </Field>
    </div>
  );
}
export function PriceListEditor(props: ShopLicenseProps) {
  const callbacks = useRef(props);
  callbacks.current = props;
  const [base, setBase] = useState<PriceList | null>(null),
    [form, setForm] = useState<PriceListForm>(() => priceListForm(null));
  const [loaded, setLoaded] = useState(false),
    [loading, setLoading] = useState(true),
    [loadFailure, setLoadFailure] = useState<ApiFailure | null>(null);
  const [group, setGroup] = useState<OptionGroup>("size"),
    [rulePage, setRulePage] = useState(0);
  const [stale, setStale] = useState(false),
    [latest, setLatest] = useState<PriceList | null>(null),
    [conflicts, setConflicts] = useState<string[]>([]);
  const [showErrors, setShowErrors] = useState(false),
    [uploadCount, setUploadCount] = useState(0),
    [discard, setDiscard] = useState<Record<string, number>>({});
  const command = useCommand<Record<string, unknown>, PriceListResult>((body, requestKey) => {
    const current = callbacks.current;
    if (current.sessionChecking || current.sessionFailed || current.logoutPending) return Promise.resolve(NETWORK);
    return savePriceList(body, requestKey);
  });
  const activeRead = useRef<AbortController | null>(null),
    lastMode = useRef<LoadMode>("initial");
  const formRef = useRef<HTMLFormElement>(null),
    formValue = useRef(form);
  formValue.current = form;
  const uploading = useRef(new Set<string>()),
    submittedPhotos = useRef<{ key: string; uploadId: string | null }[]>([]);
  const handled = useRef<unknown>(null),
    handledFailure = useRef<unknown>(null),
    focusPending = useRef<string | null>(null);
  const failure = command.state.kind === "failed" ? command.state.failure : null;
  const pending = loading || command.busy || uploadCount > 0 || Boolean(props.logoutPending || props.sessionChecking);
  const requestsBlocked = pending || Boolean(props.sessionFailed),
    locked = requestsBlocked || loadFailure !== null;
  const fields = useMemo(() => priceFieldPointers(form), [form]);
  const issues = useMemo(() => priceListIssues(form), [form]);
  const errors = fieldErrorsFor(
    [...(failure?.fieldErrors ?? []), ...issues.filter((e) => showErrors || e.code !== "required")],
    fields,
  ).byField;
  const original = useMemo(() => priceListForm(base), [base]);
  const changes = priceListChanges(base, form);
  const canEdit = () => !locked && uploading.current.size === 0;

  const read = useCallback((mode: LoadMode = "initial") => {
    lastMode.current = mode;
    activeRead.current?.abort();
    const controller = new AbortController();
    activeRead.current = controller;
    setLoading(true);
    setLoadFailure(null);
    void fetchPriceList(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) {
          if (mode === "stale") setLatest(result.data);
          else {
            setBase(result.data);
            setForm(priceListForm(result.data));
            setStale(false);
            setLatest(null);
          }
          setLoaded(true);
        } else if (mode === "initial" && result.status === 404 && result.problem?.code === "not_set") {
          setBase(null);
          setForm(priceListForm(null));
          setLoaded(true);
        } else {
          setLoadFailure(result);
          if (result.status === 401) callbacks.current.onSessionExpired();
          if (result.problem?.code === "shop_not_registered") callbacks.current.onRegisterShop();
        }
        setLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoadFailure(NETWORK);
          setLoading(false);
        }
      });
  }, []);
  useEffect(() => {
    read();
    return () => activeRead.current?.abort();
  }, [read]);
  useEffect(() => {
    if (command.state.kind !== "done" || handled.current === command.state.data) return;
    handled.current = command.state.data;
    setBase(command.state.data.priceList);
    setForm(priceListForm(command.state.data.priceList));
    setStale(false);
    setLatest(null);
    setConflicts([]);
    setShowErrors(false);
  }, [command.state]);
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
    const invalid = submittedPhotos.current.filter(
      (d, i) => d.uploadId !== null && photoRejected(failure, `/designs/${i}/uploadId`),
    );
    if (invalid.length) {
      setDiscard((old) => {
        const next = { ...old };
        for (const d of invalid) next[d.key] = (next[d.key] ?? 0) + 1;
        return next;
      });
      setForm((old) => ({
        ...old,
        designs: old.designs.map((d) =>
          invalid.some((item) => item.key === d.key && item.uploadId === d.uploadId)
            ? { ...d, uploadId: null, sourceDesignId: null }
            : d,
        ),
      }));
    }
    if (failure.outcome === "field") {
      focusPending.current = failure.fieldErrors[0]?.field ?? null;
      const field = failure.fieldErrors[0]?.field ?? "",
        optionIndex = /^\/options\/(\d+)/.exec(field)?.[1],
        ruleIndex = /^\/rules\/(\d+)/.exec(field)?.[1];
      if (optionIndex !== undefined) {
        const row = formValue.current.options[Number(optionIndex)];
        if (row) setGroup(row.group);
      }
      if (ruleIndex !== undefined) setRulePage(Math.floor(Number(ruleIndex) / 20));
    }
  }, [failure, read]);
  useEffect(() => {
    const pointer = focusPending.current;
    if (!pointer) return;
    const field = Array.from(
      formRef.current?.querySelectorAll<HTMLElement>("[data-pointer], [data-row-pointer]") ?? [],
    ).find((node) => node.dataset.pointer === pointer || node.dataset.rowPointer === pointer);
    const target =
      pointer === "/options"
        ? formRef.current?.querySelector<HTMLElement>("[data-add-option]")
        : field?.querySelector<HTMLElement>("input, select, textarea, button");
    if (target && !target.matches(":disabled")) {
      focusPending.current = null;
      target.focus();
    }
  });
  useEffect(() => {
    setRulePage((page) => Math.min(page, Math.max(0, Math.ceil(form.rules.length / 20) - 1)));
  }, [form.rules.length]);
  const photoBusy = useCallback((id: string, busy: boolean) => {
    if (busy) uploading.current.add(id);
    else uploading.current.delete(id);
    setUploadCount(uploading.current.size);
  }, []);
  function mutate(change: (old: PriceListForm) => PriceListForm) {
    if (!canEdit()) return;
    command.reset();
    setShowErrors(false);
    setConflicts([]);
    setForm(change);
  }
  function changeOption(id: string, patch: Partial<OptionForm>) {
    mutate((old) => ({
      ...old,
      options: old.options.map((o) => (o.key === id ? { ...o, ...patch } : o)),
      designs:
        patch.inStandard === false || (patch.priceKind !== undefined && patch.priceKind !== "fixed")
          ? old.designs.map((d) => (d.optionKey === id ? { ...d, inStandard: false } : d))
          : old.designs,
    }));
  }
  function changeRule(id: string, patch: Partial<RuleForm>) {
    mutate((old) => ({ ...old, rules: old.rules.map((r) => (r.key === id ? { ...r, ...patch } : r)) }));
  }
  function changeDesign(id: string, patch: Partial<DesignForm>) {
    mutate((old) => ({ ...old, designs: old.designs.map((d) => (d.key === id ? { ...d, ...patch } : d)) }));
  }
  function reorderOption(from: string, to: string) {
    mutate((old) => {
      const source = old.options.find((o) => o.key === from),
        target = old.options.find((o) => o.key === to);
      if (!source || !target || source.group !== target.group) return old;
      return {
        ...old,
        options: [
          ...old.options.filter((o) => o.group !== source.group),
          ...move(
            old.options.filter((o) => o.group === source.group),
            from,
            to,
          ),
        ],
      };
    });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canEdit() || stale || !loaded) return;
    if (issues.length) {
      setShowErrors(true);
      focusPending.current = issues[0]?.field ?? null;
      const first = issues[0]?.field ?? "",
        i = /^\/options\/(\d+)/.exec(first)?.[1];
      if (i !== undefined) {
        const row = form.options[Number(i)];
        if (row) setGroup(row.group);
      }
      return;
    }
    submittedPhotos.current = form.designs.map((d) => ({ key: d.key, uploadId: d.uploadId }));
    command.submit(priceListPayload(base, form));
  }
  const optionRows = form.options
    .map((row, i) => ({ row, i }))
    .filter((x) => x.row.group === group)
    .sort((a, b) => a.row.position - b.row.position);
  const choices = form.options.map((o) => [o.key, `${GROUPS[o.group]} · ${o.name || "새 옵션"}`] as const);
  const designChoices = [
    ["", "연결 없음"],
    ...choices.filter(([id]) => form.options.find((o) => o.key === id)?.group === "design"),
  ] as const;
  function changedOption(o: OptionForm, field: keyof OptionForm) {
    return original.options.find((row) => row.key === o.key)?.[field] !== o[field] ? "price-changed" : undefined;
  }
  return (
    <OwnerLayout
      screen="SCR-036"
      title="가격표와 도안"
      shopName={props.shopName}
      back="/owner/shop"
      busy={locked}
      onNavigate={(href, event) => {
        event.preventDefault();
        if (canEdit()) props.onNavigate(href);
      }}
    >
      <form className="price-editor" ref={formRef} onSubmit={submit} noValidate>
        {!loaded && loading ? <Skeleton rows={4} label="가격표를 불러오고 있어요" /> : null}
        {loaded && loading ? <p role="status">현재 가격표를 다시 불러오고 있어요</p> : null}
        {command.busy ? <p role="status">처리하고 있어요. 잠시 뒤 다시 확인해 주세요</p> : null}
        {loadFailure ? (
          <LoadFailure
            failure={classify(loadFailure.status, loadFailure.problem, loadFailure.retryAfterSeconds)}
            disabled={requestsBlocked}
            onRetry={() => {
              if (!requestsBlocked) read(lastMode.current);
            }}
            onLogin={props.onSessionExpired}
            onRegisterShop={props.onRegisterShop}
          />
        ) : null}
        {loadFailure && loaded ? (
          <Banner tone="warning">이전 정보를 보고 있어요. 다시 불러온 뒤 저장해 주세요.</Banner>
        ) : null}
        {loaded ? (
          <>
            <header className="price-summary">
              {base ? (
                <p>
                  가격표 버전 {base.version} ·{" "}
                  {new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", dateStyle: "short" }).format(
                    new Date(base.createdAt),
                  )}{" "}
                  저장
                </p>
              ) : (
                <EmptyState>첫 가격표를 만들어 주세요</EmptyState>
              )}
              <a
                href="/owner/price-list/versions"
                aria-disabled={locked}
                onClick={(event) => {
                  event.preventDefault();
                  if (canEdit()) props.onNavigate("/owner/price-list/versions");
                }}
              >
                버전 이력
              </a>
            </header>
            {stale && latest ? (
              <Banner
                tone="warning"
                actions={
                  <>
                    <Button
                      disabled={locked}
                      onClick={() => {
                        if (!canEdit()) return;
                        const merged = rebasePriceList(base, form, latest);
                        setConflicts(merged.conflicts);
                        if (merged.form) {
                          setBase(latest);
                          setForm(merged.form);
                          setStale(false);
                          setLatest(null);
                          command.reset();
                        }
                      }}
                    >
                      내 변경 다시 적용
                    </Button>
                    <Button
                      disabled={locked}
                      onClick={() => {
                        if (canEdit()) {
                          setBase(latest);
                          setForm(priceListForm(latest));
                          setStale(false);
                          setLatest(null);
                          setConflicts([]);
                          command.reset();
                        }
                      }}
                    >
                      내 변경을 버리고 지금 값 사용
                    </Button>
                  </>
                }
              >
                그 사이 바뀌었어요. 지금 상태를 확인해 주세요
              </Banner>
            ) : null}
            {stale && latest ? (
              <section className="price-latest" aria-label="다시 읽은 지금 가격표">
                <h2>다시 읽은 가격표 버전 {latest.version}</h2>
                <ul>
                  {latest.options.map((o) => (
                    <li key={o.optionId}>
                      {GROUPS[o.group]} · {o.name}: {o.amount.toLocaleString("ko-KR")}원
                      {o.priceKind === "from"
                        ? "부터"
                        : o.priceKind === "range"
                          ? ` ~ ${o.amountMax?.toLocaleString("ko-KR")}원`
                          : ""}
                    </li>
                  ))}
                </ul>
                <h3>지금 옵션 규칙</h3>
                <ul>
                  {latest.rules.map((rule) => (
                    <li key={JSON.stringify([rule.optionAId, rule.optionBId].sort())}>
                      {latest.options.find((o) => o.optionId === rule.optionAId)?.name} ·{" "}
                      {latest.options.find((o) => o.optionId === rule.optionBId)?.name}:{" "}
                      {rule.kind === "exclude" ? "함께 못 고름" : `${rule.amount?.toLocaleString("ko-KR")}원 더함`}
                    </li>
                  ))}
                </ul>
                <h3>지금 도안</h3>
                <ul>
                  {latest.designs.map((design) => (
                    <li key={design.designId}>
                      {design.name} ·{" "}
                      {design.optionId === null
                        ? "연결 없음"
                        : latest.options.find((o) => o.optionId === design.optionId)?.name}{" "}
                      · {design.inStandard ? "기본 디자인 범위" : "맞춤 주문으로만"}
                    </li>
                  ))}
                </ul>
                <p>내 입력은 아래 양식에 남아 있어요. 같은 필드가 바뀌었으면 다시 적용한 내 값이 사용돼요.</p>
              </section>
            ) : null}
            {conflicts.length ? (
              <Banner
                tone="warning"
                detail={
                  <ul>
                    {conflicts.map((text) => (
                      <li key={text}>{text}</li>
                    ))}
                  </ul>
                }
              >
                대응할 수 없는 변경이 있어요. 남긴 입력과 지금 값을 비교해 주세요.
              </Banner>
            ) : null}
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
                  read("stale");
                }
              }}
              done={(data) =>
                data.outcome === "created"
                  ? `저장했어요. 가격표 버전 ${data.priceList.version}`
                  : "바뀐 것이 없어 새 버전을 만들지 않았어요"
              }
            />
            {showErrors && issues.length ? (
              <Banner tone="danger" detail={form.options.length === 0 ? "옵션을 한 개 이상 추가해 주세요" : undefined}>
                입력한 내용을 확인해 주세요
              </Banner>
            ) : null}
            <section className="price-section" aria-label="가격 옵션">
              <div className="price-tabs" role="tablist" aria-label="옵션 그룹">
                {OPTION_GROUPS.map((value, index) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={group === value}
                    tabIndex={group === value ? 0 : -1}
                    disabled={locked}
                    onClick={() => {
                      if (canEdit()) setGroup(value);
                    }}
                    onKeyDown={(event) => {
                      const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                      if (!direction || !canEdit()) return;
                      event.preventDefault();
                      const next = (index + direction + OPTION_GROUPS.length) % OPTION_GROUPS.length,
                        value = OPTION_GROUPS[next];
                      if (value) setGroup(value);
                      event.currentTarget.parentElement
                        ?.querySelectorAll<HTMLButtonElement>('button[role="tab"]')
                        [next]?.focus();
                    }}
                  >
                    {GROUPS[value]}
                  </button>
                ))}
              </div>
              <div className="price-option-heading" aria-hidden="true">
                <span>옵션 이름</span>
                <span>표시 방식</span>
                <span>금액</span>
                <span>최대 금액</span>
                <span>기본 디자인 범위</span>
                <span>순서·삭제</span>
              </div>
              {optionRows.map(({ row: o, i }, localIndex) => (
                <fieldset
                  key={o.key}
                  aria-label={`${GROUPS[group]} 옵션 ${localIndex + 1}`}
                  className={`price-option ${failure?.fieldErrors.some((e) => e.field.startsWith(`/options/${i}/`)) ? "price-invalid" : ""}`}
                  disabled={locked}
                  onDragOver={(event) => {
                    if (canEdit()) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (canEdit()) reorderOption(event.dataTransfer.getData("text/plain"), o.key);
                  }}
                >
                  <legend
                    draggable={!locked}
                    onDragStart={(event) => {
                      if (!canEdit()) {
                        event.preventDefault();
                        return;
                      }
                      event.dataTransfer.setData("text/plain", o.key);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                  >
                    {o.name || "새 옵션"}
                  </legend>
                  <div className={changedOption(o, "name")}>
                    <TextField
                      pointer={`/options/${i}/name`}
                      label="옵션 이름"
                      value={o.name}
                      maxLength={30}
                      disabled={locked}
                      errors={errors.get(`/options/${i}/name`)}
                      onChange={(event) => changeOption(o.key, { name: event.currentTarget.value })}
                    />
                  </div>
                  <div className={changedOption(o, "priceKind")}>
                    <SelectField
                      pointer={`/options/${i}/priceKind`}
                      label="표시 방식"
                      value={o.priceKind}
                      errors={errors.get(`/options/${i}/priceKind`)}
                      disabled={locked}
                      choices={[
                        ["fixed", "확정"],
                        ["from", "부터"],
                        ["range", "범위"],
                      ]}
                      onChange={(value) =>
                        changeOption(o.key, {
                          priceKind: value as PriceKind,
                          ...(value === "fixed" ? {} : { inStandard: false }),
                          ...(value === "range" ? {} : { amountMax: "" }),
                        })
                      }
                    />
                  </div>
                  <div className={changedOption(o, "amount")}>
                    <TextField
                      pointer={`/options/${i}/amount`}
                      label="금액"
                      inputMode="numeric"
                      value={o.amount}
                      disabled={locked}
                      errors={errors.get(`/options/${i}/amount`)}
                      onChange={(event) => changeOption(o.key, { amount: event.currentTarget.value })}
                    />
                  </div>
                  {o.priceKind === "range" ? (
                    <div className={changedOption(o, "amountMax")}>
                      <TextField
                        pointer={`/options/${i}/amountMax`}
                        label="최대 금액"
                        inputMode="numeric"
                        value={o.amountMax}
                        disabled={locked}
                        errors={errors.get(`/options/${i}/amountMax`)}
                        onChange={(event) => changeOption(o.key, { amountMax: event.currentTarget.value })}
                      />
                    </div>
                  ) : (
                    <span className="price-no-maximum">—</span>
                  )}
                  <div className={changedOption(o, "inStandard")}>
                    <StandardField
                      pointer={`/options/${i}/inStandard`}
                      checked={o.inStandard}
                      disabled={locked || o.priceKind !== "fixed"}
                      errors={errors.get(`/options/${i}/inStandard`)}
                      onChange={(value) => changeOption(o.key, { inStandard: value })}
                    />
                    {o.priceKind !== "fixed" ? <p>맞춤 주문으로만</p> : null}
                  </div>
                  <div className="price-row-actions">
                    <Button
                      disabled={locked || localIndex === 0}
                      aria-label={`${o.name || "새 옵션"} 위로`}
                      onClick={() => {
                        const previous = optionRows[localIndex - 1];
                        if (previous) reorderOption(o.key, previous.row.key);
                      }}
                    >
                      위로
                    </Button>
                    <Button
                      disabled={locked || localIndex === optionRows.length - 1}
                      aria-label={`${o.name || "새 옵션"} 아래로`}
                      onClick={() => {
                        const next = optionRows[localIndex + 1];
                        if (next) reorderOption(o.key, next.row.key);
                      }}
                    >
                      아래로
                    </Button>
                    <Button
                      kind="danger"
                      disabled={locked}
                      onClick={() => mutate((old) => removePriceOption(old, o.key))}
                    >
                      옵션 삭제
                    </Button>
                  </div>
                </fieldset>
              ))}
              <Button
                data-add-option=""
                disabled={locked || form.options.length >= 100}
                onClick={() =>
                  mutate((old) =>
                    old.options.length >= 100
                      ? old
                      : {
                          ...old,
                          options: [
                            ...old.options,
                            {
                              key: key(),
                              group,
                              name: "",
                              priceKind: "fixed",
                              amount: "0",
                              amountMax: "",
                              inStandard: false,
                              position:
                                Math.max(0, ...old.options.filter((o) => o.group === group).map((o) => o.position)) + 1,
                            },
                          ],
                        },
                  )
                }
              >
                {GROUPS[group]} 옵션 추가
              </Button>
              <p>
                옵션 {form.options.length}/100개 · 삭제하면 연결 규칙도 지워지고 도안 연결은 해제돼요. 순서는 끌거나
                위로·아래로 바꿔요.
              </p>
            </section>
            <section className="price-section" aria-label="옵션 규칙">
              <h2>옵션 규칙</h2>
              {form.rules.slice(rulePage * 20, rulePage * 20 + 20).map((r, offset) => {
                const i = rulePage * 20 + offset,
                  rowErrors = errors.get(`/rules/${i}`);
                return (
                  <fieldset
                    key={r.key}
                    data-row-pointer={`/rules/${i}`}
                    aria-label={`옵션 규칙 ${i + 1}`}
                    className={`price-rule ${rowErrors?.length ? "price-invalid" : ""}`}
                    disabled={locked}
                  >
                    <legend>규칙 {i + 1}</legend>
                    <SelectField
                      pointer={`/rules/${i}/optionA`}
                      label="옵션 A"
                      value={r.optionA}
                      choices={[["", "옵션 선택"], ...choices]}
                      disabled={locked}
                      errors={errors.get(`/rules/${i}/optionA`)}
                      onChange={(value) => changeRule(r.key, { optionA: value })}
                    />
                    <SelectField
                      pointer={`/rules/${i}/optionB`}
                      label="옵션 B"
                      value={r.optionB}
                      choices={[["", "옵션 선택"], ...choices]}
                      disabled={locked}
                      errors={errors.get(`/rules/${i}/optionB`)}
                      onChange={(value) => changeRule(r.key, { optionB: value })}
                    />
                    <SelectField
                      pointer={`/rules/${i}/kind`}
                      label="규칙 종류"
                      value={r.kind}
                      errors={errors.get(`/rules/${i}/kind`)}
                      choices={[
                        ["exclude", "함께 못 고름"],
                        ["surcharge", "더하는 값"],
                      ]}
                      disabled={locked}
                      onChange={(value) =>
                        changeRule(r.key, {
                          kind: value as RuleForm["kind"],
                          ...(value === "exclude" ? { amount: "" } : {}),
                        })
                      }
                    />
                    {r.kind === "surcharge" ? (
                      <TextField
                        pointer={`/rules/${i}/amount`}
                        label="더하는 금액"
                        value={r.amount}
                        inputMode="numeric"
                        disabled={locked}
                        errors={errors.get(`/rules/${i}/amount`)}
                        onChange={(event) => changeRule(r.key, { amount: event.currentTarget.value })}
                      />
                    ) : null}
                    {rowErrors?.length ? (
                      <Banner tone="warning">
                        {rowErrors.includes("conflict") ? "같은 조합이 허용이자 금지예요" : "같은 조합의 규칙이 겹쳐요"}
                      </Banner>
                    ) : null}
                    <Button
                      kind="danger"
                      disabled={locked}
                      onClick={() => mutate((old) => ({ ...old, rules: old.rules.filter((row) => row.key !== r.key) }))}
                    >
                      규칙 삭제
                    </Button>
                  </fieldset>
                );
              })}
              {form.rules.length > 20 ? (
                <div className="price-row-actions">
                  <Button
                    disabled={locked || rulePage === 0}
                    onClick={() => {
                      if (canEdit()) setRulePage((n) => n - 1);
                    }}
                  >
                    이전 규칙
                  </Button>
                  <span>
                    {rulePage * 20 + 1}~{Math.min(form.rules.length, rulePage * 20 + 20)}/{form.rules.length}
                  </span>
                  <Button
                    disabled={locked || (rulePage + 1) * 20 >= form.rules.length}
                    onClick={() => {
                      if (canEdit()) setRulePage((n) => n + 1);
                    }}
                  >
                    다음 규칙
                  </Button>
                </div>
              ) : null}
              <Button
                disabled={locked || form.rules.length >= 500 || form.options.length < 2}
                onClick={() => {
                  if (!canEdit() || form.rules.length >= 500) return;
                  const first = form.options[0],
                    second = form.options[1];
                  if (!first || !second) return;
                  const nextPage = Math.floor(form.rules.length / 20);
                  mutate((old) => ({
                    ...old,
                    rules: [
                      ...old.rules,
                      { key: key(), kind: "exclude", optionA: first.key, optionB: second.key, amount: "" },
                    ],
                  }));
                  setRulePage(nextPage);
                }}
              >
                규칙 추가
              </Button>
              <p>규칙 {form.rules.length}/500개</p>
            </section>
            <section className="price-section" aria-label="도안">
              <h2>도안</h2>
              <div className="price-design-grid">
                {[...form.designs]
                  .sort((a, b) => a.position - b.position)
                  .map((d, localIndex) => {
                    const i = form.designs.findIndex((row) => row.key === d.key),
                      linked = form.options.find((o) => o.key === d.optionKey);
                    return (
                      <fieldset
                        key={d.key}
                        aria-label={`도안 ${localIndex + 1}`}
                        className="price-design"
                        disabled={locked}
                      >
                        <legend>{d.name || "새 도안"}</legend>
                        <TextField
                          pointer={`/designs/${i}/name`}
                          label="도안 이름"
                          value={d.name}
                          maxLength={30}
                          disabled={locked}
                          errors={errors.get(`/designs/${i}/name`)}
                          onChange={(event) => changeDesign(d.key, { name: event.currentTarget.value })}
                        />
                        <DesignImage
                          design={d}
                          pointer={`/designs/${i}/uploadId`}
                          errors={errors.get(`/designs/${i}/uploadId`)}
                          disabled={locked}
                          discardEpoch={discard[d.key] ?? 0}
                          onSessionExpired={props.onSessionExpired}
                          onBusy={photoBusy}
                          onStart={(id) => {
                            if (!canEdit()) return false;
                            command.reset();
                            setForm((old) => ({
                              ...old,
                              designs: old.designs.map((row) =>
                                row.key === id ? { ...row, uploadId: null, sourceDesignId: null, imageUrl: "" } : row,
                              ),
                            }));
                            return true;
                          }}
                          onUploaded={(id, upload) =>
                            setForm((old) => ({
                              ...old,
                              designs: old.designs.map((row) =>
                                row.key === id ? { ...row, uploadId: upload.uploadId, sourceDesignId: null } : row,
                              ),
                            }))
                          }
                          onPreview={(id, url) =>
                            setForm((old) => {
                              const found = old.designs.find((row) => row.key === id);
                              return !found || found.imageUrl === url
                                ? old
                                : {
                                    ...old,
                                    designs: old.designs.map((row) =>
                                      row.key === id ? { ...row, imageUrl: url } : row,
                                    ),
                                  };
                            })
                          }
                        />
                        <SelectField
                          pointer={`/designs/${i}/optionKey`}
                          label="연결 옵션"
                          value={d.optionKey ?? ""}
                          choices={designChoices}
                          disabled={locked}
                          errors={errors.get(`/designs/${i}/optionKey`)}
                          onChange={(value) => {
                            const option = form.options.find((o) => o.key === value);
                            changeDesign(d.key, {
                              optionKey: value || null,
                              ...(option && !option.inStandard ? { inStandard: false } : {}),
                            });
                          }}
                        />
                        <StandardField
                          pointer={`/designs/${i}/inStandard`}
                          checked={d.inStandard}
                          disabled={locked || Boolean(linked && !linked.inStandard)}
                          errors={errors.get(`/designs/${i}/inStandard`)}
                          onChange={(value) => changeDesign(d.key, { inStandard: value })}
                        />
                        {linked && !linked.inStandard ? <p>맞춤 주문으로만</p> : null}
                        <div className="price-row-actions">
                          <Button
                            disabled={locked || localIndex === 0}
                            aria-label={`${d.name || "새 도안"} 위로`}
                            onClick={() =>
                              mutate((old) => {
                                const sorted = [...old.designs].sort((a, b) => a.position - b.position),
                                  previous = sorted[localIndex - 1];
                                return previous ? { ...old, designs: move(old.designs, d.key, previous.key) } : old;
                              })
                            }
                          >
                            위로
                          </Button>
                          <Button
                            disabled={locked || localIndex === form.designs.length - 1}
                            aria-label={`${d.name || "새 도안"} 아래로`}
                            onClick={() =>
                              mutate((old) => {
                                const sorted = [...old.designs].sort((a, b) => a.position - b.position),
                                  next = sorted[localIndex + 1];
                                return next ? { ...old, designs: move(old.designs, d.key, next.key) } : old;
                              })
                            }
                          >
                            아래로
                          </Button>
                          <Button
                            kind="danger"
                            disabled={locked}
                            onClick={() =>
                              mutate((old) => ({ ...old, designs: old.designs.filter((row) => row.key !== d.key) }))
                            }
                          >
                            도안 삭제
                          </Button>
                        </div>
                      </fieldset>
                    );
                  })}
              </div>
              <Button
                disabled={locked || form.designs.length >= 50}
                onClick={() =>
                  mutate((old) =>
                    old.designs.length >= 50
                      ? old
                      : {
                          ...old,
                          designs: [
                            ...old.designs,
                            {
                              key: key(),
                              name: "",
                              imageUrl: "",
                              uploadId: null,
                              sourceDesignId: null,
                              baseDesignId: null,
                              optionKey: null,
                              inStandard: false,
                              position: Math.max(0, ...old.designs.map((d) => d.position)) + 1,
                            },
                          ],
                        },
                  )
                }
              >
                도안 추가
              </Button>
              <p>도안 {form.designs.length}/50장 · 한 장 10MB까지</p>
            </section>
          </>
        ) : null}
        {props.logoutFailure ? <Banner tone="danger">{props.logoutFailure.message}</Banner> : null}
        <div className="price-save-bar">
          <span>저장 전 바뀐 셀 {changes}개</span>
          <Button kind="primary" type="submit" busy={command.busy} disabled={locked || stale || !loaded}>
            저장
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
      </form>
    </OwnerLayout>
  );
}
