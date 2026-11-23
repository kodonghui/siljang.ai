import { useEffect, useId, useRef, useState } from "react";
import { CalendarConflictList } from "./CalendarConflictList";
import {
  type CalendarSettings,
  type CalendarSettingsResult,
  fetchCalendarSettings,
  saveCalendarSettings,
} from "./calendar-settings-api";
import {
  type CalendarSettingsForm,
  rebaseSettings,
  SETTING_NUMBERS,
  SETTING_TIMES,
  settingsChanged,
  settingsForm,
  settingsIssues,
  settingsPayload,
} from "./calendar-settings-form";
import { formatKoreanDateTime } from "./format-date";
import { classify, type FieldError, fieldReasonText } from "./problems";
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
import "./calendar-settings-screen.css";

type SettingKey = (typeof SETTING_NUMBERS)[number] | (typeof SETTING_TIMES)[number];
const fields = ["closedWeekdays", ...SETTING_NUMBERS, ...SETTING_TIMES].map((key) => `/${key}`);
const weekdays = ["월", "화", "수", "목", "금", "토", "일"] as const;
const controls: Record<SettingKey, { label: string; help: string }> = {
  dailyCapacity: { label: "하루 최대 개수", help: "0~100개. 바꾼 기준은 그 뒤 잡는 자리에만 써요" },
  orderCutoffDays: { label: "주문 마감(픽업일 며칠 전)", help: "0~30일 전. 0이면 픽업일 당일이에요" },
  orderCutoffTime: { label: "주문 마감 시각", help: "정한 날짜의 이 시각부터 마감해요" },
  replyStart: { label: "답하는 시간 시작", help: "이 시각부터 답해요" },
  replyEnd: { label: "답하는 시간 끝", help: "시작보다 뒤로 정해 주세요" },
  dayBeforeNoticeTime: { label: "전날 안내 시각", help: "08:00~20:50. 아직 보내지 않은 안내부터 써요" },
  reviewRequestTime: { label: "후기 부탁 시각", help: "08:00~20:50. 아직 보내지 않은 안내부터 써요" },
};
const doneText = (value: CalendarSettingsResult) =>
  value.outcome === "unchanged"
    ? "바뀐 것이 없어요"
    : value.conflicts.length
      ? "저장했어요. 새 기준을 넘는 날이 있어요"
      : "저장했어요";
export function CalendarSettingsScreen(props: ShopLicenseProps) {
  const [loaded, setLoaded] = useState(false),
    [empty, setEmpty] = useState(false);
  const [base, setBase] = useState<CalendarSettings | null>(null),
    [form, setForm] = useState<CalendarSettingsForm>(() => settingsForm(null));
  const [stale, setStale] = useState(false),
    [latest, setLatest] = useState<CalendarSettings | null>(null);
  const [localErrors, setLocalErrors] = useState<FieldError[]>([]),
    [unchanged, setUnchanged] = useState(false);
  const formRef = useRef<HTMLFormElement>(null),
    weekId = useId();
  const navigationLocked = Boolean(props.sessionChecking || props.logoutPending),
    blocked = navigationLocked || Boolean(props.sessionFailed);
  const {
    loading,
    failure: loadFailure,
    read,
    retry,
    deferRead,
  } = useVersionedRead(fetchCalendarSettings, {
    sessionChecking: navigationLocked,
    sessionFailed: Boolean(props.sessionFailed),
    allowNotSet: true,
    onLoaded: (_mode, value) => {
      setEmpty(false);
      setUnchanged(false);
      if (command.state.kind === "done" && command.state.data.calendar.revision !== value.revision) command.reset();
      if (!loaded) {
        setBase(value);
        setForm(settingsForm(value));
        setLoaded(true);
        setEmpty(false);
      } else if (base && (!settingsChanged(base, form) || value.revision === base.revision)) {
        if (!settingsChanged(base, form)) setForm(settingsForm(value));
        setBase(value);
        setEmpty(false);
        setLatest(null);
        setStale(false);
        if (command.state.kind === "failed" && command.state.failure.code === "version_conflict") command.reset();
      } else {
        setLatest(value);
        setStale(true);
      }
    },
    onNotSet: () => {
      setBase(null);
      if (!loaded) setForm(settingsForm(null));
      setLoaded(true);
      setEmpty(true);
    },
    onSessionExpired: props.onSessionExpired,
    onRegisterShop: props.onRegisterShop,
  });
  const command = useCommand<Record<string, unknown>, CalendarSettingsResult>(saveCalendarSettings);
  const handled = useRef<unknown>(null),
    handledFailure = useRef<unknown>(null);
  const locked = blocked || loading || command.busy || command.blocked || command.state.kind === "confirm";
  const failure = command.state.kind === "failed" ? command.state.failure : null;
  const errors = fieldErrorsFor([...localErrors, ...(failure?.fieldErrors ?? [])], fields).byField;
  const weekErrors = errors.get("/closedWeekdays") ?? [];
  useEffect(() => {
    if (command.state.kind === "done" && handled.current !== command.state) {
      handled.current = command.state;
      setBase(command.state.data.calendar);
      setForm(settingsForm(command.state.data.calendar));
      setEmpty(false);
      setStale(false);
      setLatest(null);
      setLocalErrors([]);
    }
    if (command.state.kind === "failed" && handledFailure.current !== command.state) {
      handledFailure.current = command.state;
      const problem = command.state.failure;
      if (problem.outcome === "login") props.onSessionExpired();
      else if (problem.outcome === "no_shop") props.onRegisterShop();
      else if (problem.code === "version_conflict") {
        setStale(true);
        setLatest(null);
        read("stale");
      }
    }
  }, [command.state, props.onSessionExpired, props.onRegisterShop, read]);
  useEffect(() => {
    if (localErrors.length || (command.state.kind === "failed" && command.state.failure.fieldErrors.length))
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [localErrors, command.state]);
  useEffect(() => {
    const show = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setStale(base !== null);
        setLatest(null);
        deferRead(base ? "stale" : "initial");
      }
    };
    window.addEventListener("pageshow", show);
    return () => window.removeEventListener("pageshow", show);
  }, [base, deferRead]);
  const edit = (patch: Partial<CalendarSettingsForm>) => {
    if (locked || stale) return;
    setForm((old) => ({ ...old, ...patch }));
    setLocalErrors([]);
    setUnchanged(false);
    command.reset();
  };
  const submit = (event: { preventDefault(): void }) => {
    event.preventDefault();
    if (locked || stale || !loaded) return;
    const issues = settingsIssues(form);
    setLocalErrors(issues);
    if (issues.length) return;
    if (!settingsChanged(base, form)) {
      setUnchanged(true);
      command.reset();
      return;
    }
    setUnchanged(false);
    command.submit(settingsPayload(base, form));
  };
  const adopt = (keepMine: boolean) => {
    if (locked || !latest) return;
    setForm(keepMine ? rebaseSettings(base, form, latest) : settingsForm(latest));
    setBase(latest);
    setEmpty(false);
    setStale(false);
    setLatest(null);
    setLocalErrors([]);
    setUnchanged(false);
    command.reset();
  };
  const go = (href: string, event: { preventDefault(): void }) => {
    event.preventDefault();
    if (!navigationLocked && !command.busy) props.onNavigate(href);
  };
  const control = (key: SettingKey) => {
    const numeric = key === "dailyCapacity" || key === "orderCutoffDays";
    return (
      <TextField
        key={key}
        pointer={`/${key}`}
        label={controls[key].label}
        help={controls[key].help}
        value={form[key]}
        type={numeric ? "text" : "time"}
        inputMode={numeric ? "numeric" : undefined}
        step={numeric ? undefined : 60}
        errors={errors.get(`/${key}`)}
        disabled={locked || stale}
        onChange={(event) => edit({ [key]: event.target.value })}
      />
    );
  };
  return (
    <OwnerLayout
      screen="SCR-033"
      title="영업 캘린더 설정"
      shopName={props.shopName}
      back="/owner/calendar"
      busy={navigationLocked || command.busy}
      onNavigate={go}
    >
      <div className="calendar-settings-screen">
        <div className="calendar-settings-toolbar">
          <Button
            disabled={locked}
            busy={loading}
            onClick={() => {
              if (!locked) {
                setStale(base !== null);
                setLatest(null);
                read(base ? "stale" : "initial");
              }
            }}
          >
            새로 고침
          </Button>
          <Button
            disabled={navigationLocked || command.busy}
            busy={Boolean(props.logoutPending)}
            onClick={() => {
              if (!navigationLocked && !command.busy) props.onLogout();
            }}
          >
            로그아웃
          </Button>
        </div>
        {props.logoutFailure ? <Banner tone="danger">{props.logoutFailure.message}</Banner> : null}
        {loading && !loaded ? <Skeleton label="영업 캘린더 설정을 불러오고 있어요" rows={8} /> : null}
        {loadFailure ? (
          <LoadFailure
            failure={classify(loadFailure.status, loadFailure.problem, loadFailure.retryAfterSeconds)}
            disabled={locked}
            onRetry={retry}
            onLogin={props.onSessionExpired}
            onRegisterShop={props.onRegisterShop}
          />
        ) : null}
        {loaded ? (
          <>
            {empty ? <Banner tone="warning">처음 정해요. 기본값을 확인하고 저장해 주세요</Banner> : null}
            {base ? <p>마지막 저장 {formatKoreanDateTime(base.updatedAt)}</p> : null}
            <CommandStatus
              state={command.state}
              fields={fields}
              disabled={locked}
              done={doneText}
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
            />
            {unchanged ? <Banner tone="success">바뀐 것이 없어요</Banner> : null}
            {command.state.kind === "done" ? (
              <CalendarConflictList values={command.state.data.conflicts} disabled={locked} />
            ) : null}
            {stale ? (
              <section aria-label="지금 캘린더 설정">
                <Banner tone="warning">그 사이 바뀌었어요. 지금 상태를 확인해 주세요</Banner>
                {latest ? (
                  <>
                    <p>지금 하루 최대 개수: {latest.dailyCapacity}</p>
                    <p>
                      지금 쉬는 요일:{" "}
                      {latest.closedWeekdays.map((day) => `${weekdays[day - 1]}요일`).join(" · ") || "없음"}
                    </p>
                    <p>
                      지금 주문 마감: 픽업일 {latest.orderCutoffDays}일 전 {latest.orderCutoffTime}
                    </p>
                    <p>지금 전날 안내 시각: {latest.dayBeforeNoticeTime}</p>
                    <p>지금 후기 부탁 시각: {latest.reviewRequestTime}</p>
                    <p>
                      지금 답하는 시간: {latest.replyStart}~{latest.replyEnd}
                    </p>
                    <Button disabled={locked} onClick={() => adopt(true)}>
                      내 변경 다시 적용
                    </Button>
                    <Button disabled={locked} onClick={() => adopt(false)}>
                      지금 값으로 다시 시작
                    </Button>
                  </>
                ) : !loading ? (
                  <Button disabled={locked} onClick={() => read("stale")}>
                    지금 상태 다시 읽기
                  </Button>
                ) : null}
              </section>
            ) : null}
            <form
              ref={formRef}
              aria-label="영업 캘린더 설정"
              className="calendar-settings-form"
              noValidate
              onSubmit={submit}
            >
              {localErrors.length ? <Banner tone="danger">입력한 내용을 확인해 주세요</Banner> : null}
              <fieldset
                className="calendar-settings-weekdays"
                disabled={locked || stale}
                aria-invalid={weekErrors.length ? true : undefined}
                aria-describedby={weekErrors.length ? `${weekId}-errors` : `${weekId}-help`}
                tabIndex={-1}
              >
                <legend>쉬는 요일</legend>
                <div>
                  {weekdays.map((label, index) => {
                    const day = index + 1;
                    return (
                      <Button
                        key={label}
                        aria-label={`${label}요일`}
                        aria-pressed={form.closedWeekdays.includes(day)}
                        disabled={locked || stale}
                        onClick={() =>
                          edit({
                            closedWeekdays: form.closedWeekdays.includes(day)
                              ? form.closedWeekdays.filter((item) => item !== day)
                              : [...form.closedWeekdays, day],
                          })
                        }
                      >
                        {label}
                      </Button>
                    );
                  })}
                </div>
                <p id={`${weekId}-help`}>쉬는 요일을 눌러 주세요. 바꾼 기준은 그 뒤 잡는 자리에만 써요</p>
                {weekErrors.length ? (
                  <p id={`${weekId}-errors`} className="calendar-settings-field-error">
                    {weekErrors.map((code) => fieldReasonText(code)).join(" · ")}
                  </p>
                ) : null}
              </fieldset>
              {control("dailyCapacity")}
              {(
                [
                  ["orderCutoffDays", "orderCutoffTime"],
                  ["replyStart", "replyEnd"],
                  ["dayBeforeNoticeTime", "reviewRequestTime"],
                ] as const
              ).map((pair) => (
                <div className="calendar-settings-pair" key={pair[0]}>
                  {pair.map(control)}
                </div>
              ))}
              <Button type="submit" kind="primary" disabled={locked || stale} busy={command.busy}>
                저장
              </Button>
            </form>
          </>
        ) : null}
      </div>
      <ConfirmRequired
        items={command.state.kind === "confirm" ? command.state.items : null}
        confirmLabel={
          command.state.kind === "confirm" && command.state.items.length === 1
            ? command.state.items[0]?.kind === "closed_day_with_orders"
              ? "휴무로 바꾸기"
              : "개수 줄이기"
            : "그대로 저장"
        }
        confirmDisabled={blocked}
        onConfirm={() => {
          if (!blocked) command.confirm();
        }}
        onCancel={command.cancelConfirm}
      >
        {command.state.kind === "confirm" ? (
          <CalendarConflictList values={command.state.conflicts ?? []} disabled={blocked} />
        ) : null}
      </ConfirmRequired>
    </OwnerLayout>
  );
}
