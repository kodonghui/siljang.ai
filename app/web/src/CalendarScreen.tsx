import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { CalendarConflictList } from "./CalendarConflictList";
import { type CalendarDay, type CalendarDayResult, fetchCalendarDays, saveCalendarDay } from "./calendar-api";
import {
  type CalendarForm,
  calendarForm,
  calendarPatch,
  calendarPeriod,
  monthCells,
  rebaseCalendarDay,
  shiftCalendarMonth,
  todayCalendarDate,
} from "./calendar-form";
import { formatKoreanDate as dayLabel, formatSeoulTime } from "./format-date";
import { classify, ERROR_CODES, type FieldError } from "./problems";
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
import { useVersionedRead } from "./useVersionedRead";
import "./calendar-screen.css";

const fields = ["/closed", "/capacityOverride", "/manuallyClosed"];
const monthLabel = (month: string) => `${Number(month.slice(0, 4))}년 ${Number(month.slice(5))}월`;
function gridDays(month: string) {
  const cursor = new Date(`${month}-01T00:00:00Z`);
  cursor.setUTCDate(1 - cursor.getUTCDay());
  return monthCells(month).map((day) => {
    const key = cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    return { key, day };
  });
}
interface Saved extends CalendarDayResult {
  readonly notice: string;
}
export function CalendarScreen(props: ShopLicenseProps) {
  const location = useLocation();
  const month = new URLSearchParams(location.search).get("month") ?? todayCalendarDate().slice(0, 7);
  const period = calendarPeriod(month);
  const [items, setItems] = useState<readonly CalendarDay[] | null>(null);
  const [empty, setEmpty] = useState(false),
    [base, setBase] = useState<CalendarDay | null>(null);
  const [form, setForm] = useState<CalendarForm | null>(null),
    [localErrors, setLocalErrors] = useState<FieldError[]>([]);
  const [stale, setStale] = useState(false),
    [latest, setLatest] = useState<CalendarDay | null>(null);
  const [unchanged, setUnchanged] = useState(false);
  const [asOf, setAsOf] = useState<number | null>(null);
  const navigationLocked = Boolean(props.sessionChecking || props.logoutPending);
  const blocked = navigationLocked || Boolean(props.sessionFailed);
  const {
    loading,
    failure: loadFailure,
    read,
    retry,
    deferRead,
  } = useVersionedRead((signal) => fetchCalendarDays(period?.from ?? "", period?.to ?? "", signal), {
    sessionChecking: navigationLocked,
    sessionFailed: Boolean(props.sessionFailed) || period === null,
    allowNotSet: true,
    onLoaded: (_mode, value) => {
      setEmpty(false);
      setItems(value.items);
      setAsOf(Date.now());
      const selected = value.items.find((item) => item.day === base?.day);
      if (selected && base && form) {
        const dirty = calendarPatch(base, form) !== null;
        if (!dirty || selected.revision === base.revision) {
          setBase(selected);
          if (!dirty) setForm(calendarForm(selected));
          setLatest(null);
          setStale(false);
          if (command.state.kind === "failed" && command.state.failure.code === "version_conflict") command.reset();
        } else {
          setLatest(selected);
          setStale(true);
        }
      }
    },
    onNotSet: () => {
      setEmpty(true);
      setItems(null);
      setBase(null);
      setForm(null);
    },
    onSessionExpired: props.onSessionExpired,
    onRegisterShop: props.onRegisterShop,
  });
  const command = useCommand<Record<string, unknown>, Saved>(async (body, key) => {
    const response = await saveCalendarDay(base?.day ?? "", body, key);
    if (!response.ok) return response;
    const manualOnly =
      !response.data.day.closed && Object.keys(body).filter((key) => fields.includes(`/${key}`)).length === 1;
    const notice =
      response.data.outcome === "unchanged"
        ? "이미 그렇게 되어 있어요"
        : manualOnly && body.manuallyClosed === true
          ? "그날 주문을 마감했어요"
          : manualOnly && body.manuallyClosed === false
            ? "다시 받아요"
            : "저장했어요";
    return { ...response, data: { ...response.data, notice } };
  });
  const handled = useRef<unknown>(null),
    handledFailure = useRef<unknown>(null);
  const locked = blocked || loading || command.busy || command.blocked || command.state.kind === "confirm";
  const past = base !== null && base.day < todayCalendarDate();
  const outside = base !== null && items !== null && !items.some((item) => item.day === base.day);
  const failure = command.state.kind === "failed" ? command.state.failure : null;
  const fieldErrors = fieldErrorsFor([...localErrors, ...(failure?.fieldErrors ?? [])], fields).byField;
  const loadedMonth = useRef(month);
  useEffect(() => {
    if (loadedMonth.current === month) return;
    loadedMonth.current = month;
    setItems(null);
    setEmpty(false);
    setStale(false);
    setLatest(null);
    if (period) read();
  }, [month, period, read]);
  useEffect(() => {
    if (command.state.kind === "done" && handled.current !== command.state) {
      handled.current = command.state;
      const value = command.state.data.day;
      setBase(value);
      setForm(calendarForm(value));
      setLocalErrors([]);
      setStale(false);
      setItems((old) => old?.map((item) => (item.day === value.day ? value : item)) ?? null);
    }
    if (command.state.kind === "failed" && handledFailure.current !== command.state) {
      handledFailure.current = command.state;
      const problem = command.state.failure;
      if (problem.outcome === "login") props.onSessionExpired();
      else if (problem.outcome === "no_shop") props.onRegisterShop();
      else if (problem.code === "not_set") {
        setEmpty(true);
        setItems(null);
        setBase(null);
        setForm(null);
        command.reset();
      } else if (problem.code === "version_conflict") {
        setStale(true);
        setLatest(null);
        read("stale");
      }
    }
  }, [command.state, command.reset, props.onSessionExpired, props.onRegisterShop, read]);
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
  const go = (href: string, event: { preventDefault(): void }) => {
    event.preventDefault();
    if (!navigationLocked && !command.busy) props.onNavigate(href);
  };
  const select = (value: CalendarDay) => {
    if (locked) return;
    setBase(value);
    setForm(calendarForm(value));
    setStale(false);
    setLatest(null);
    setLocalErrors([]);
    setUnchanged(false);
    command.reset();
  };
  const edit = (patch: Partial<CalendarForm>) => {
    if (locked || stale || past || outside || !form) return;
    setForm({ ...form, ...patch });
    setUnchanged(false);
    setLocalErrors([]);
    command.reset();
  };
  const submit = (event: { preventDefault(): void }) => {
    event.preventDefault();
    if (locked || stale || outside || !base || !form || base.day < todayCalendarDate()) return;
    const cap = form.capacityOverride.trim();
    const errors: FieldError[] =
      cap && (!/^\d+$/.test(cap) || Number(cap) > 100)
        ? [{ field: "/capacityOverride", code: /^\d+$/.test(cap) ? "out_of_range" : "bad_format" }]
        : [];
    setLocalErrors(errors);
    if (errors.length) return;
    const body = calendarPatch(base, form);
    if (!body) {
      setUnchanged(true);
      command.reset();
      return;
    }
    setUnchanged(false);
    command.submit(body);
  };
  const move = (offset: number) => {
    if (locked) return;
    const next = shiftCalendarMonth(month, offset);
    if (!next || !calendarPeriod(next)) return;
    command.reset();
    props.onNavigate(`/owner/calendar?month=${next}`);
  };
  const reset = (keep: boolean) => {
    if (locked || !base || !form || !latest) return;
    setForm(keep ? rebaseCalendarDay(base, form, latest) : calendarForm(latest));
    setBase(latest);
    setStale(false);
    setLatest(null);
    setLocalErrors([]);
    command.reset();
  };
  const invalidQuery = !period || loadFailure?.problem?.code === "validation_failed";
  return (
    <OwnerLayout
      screen="SCR-032"
      title="영업 캘린더"
      shopName={props.shopName}
      back="/owner/shop"
      busy={navigationLocked || command.busy}
      onNavigate={go}
    >
      <div className="calendar-screen">
        <div className="calendar-toolbar">
          {asOf !== null ? <p>{formatSeoulTime(asOf)} 기준</p> : null}
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
          <a
            href="/owner/calendar/settings"
            aria-disabled={navigationLocked || command.busy || undefined}
            tabIndex={navigationLocked || command.busy ? -1 : undefined}
            onClick={(event) => go("/owner/calendar/settings", event)}
          >
            영업 캘린더 설정
          </a>
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
        {invalidQuery ? (
          <Banner
            tone="danger"
            actions={
              <Button onClick={() => props.onNavigate("/owner/calendar")} disabled={navigationLocked}>
                처음부터 보기
              </Button>
            }
          >
            {ERROR_CODES.validation_failed.message}
          </Banner>
        ) : null}
        {loading && !items && period ? (
          <section className="calendar-workspace" aria-label="영업 캘린더를 불러오고 있어요" aria-busy="true">
            <div className="calendar-months">
              {[month, shiftCalendarMonth(month, 1)].map((value, index) =>
                value ? (
                  <section key={value} className={`calendar-month${index ? " calendar-month--second" : ""}`}>
                    <h2>{monthLabel(value)}</h2>
                    <div className="calendar-grid" aria-hidden="true">
                      {gridDays(value).map((cell) => (
                        <span className="calendar-day calendar-placeholder" key={cell.key} />
                      ))}
                    </div>
                  </section>
                ) : null,
              )}
            </div>
            <Skeleton label="날짜 설정을 불러오고 있어요" rows={5} />
          </section>
        ) : null}
        {loadFailure && !invalidQuery ? (
          <LoadFailure
            failure={classify(loadFailure.status, loadFailure.problem, loadFailure.retryAfterSeconds)}
            disabled={locked}
            onRetry={retry}
            onLogin={props.onSessionExpired}
            onRegisterShop={props.onRegisterShop}
          />
        ) : null}
        {empty ? (
          <section aria-label="캘린더 미설정">
            <h2>아직 정하지 않았어요</h2>
            <a href="/owner/calendar/settings" onClick={(event) => go("/owner/calendar/settings", event)}>
              영업 캘린더 설정하기
            </a>
          </section>
        ) : null}
        {items && period ? (
          <>
            <div className="calendar-toolbar">
              <Button
                disabled={locked || !calendarPeriod(shiftCalendarMonth(month, -1) ?? "")}
                onClick={() => move(-1)}
              >
                이전 달
              </Button>
              <Button disabled={locked || !calendarPeriod(shiftCalendarMonth(month, 1) ?? "")} onClick={() => move(1)}>
                다음 달
              </Button>
            </div>
            <p>잡힌 자리/하루 최대 개수 · 휴무 · 다 참 · 마감 · 추가 수락</p>
            <div className="calendar-workspace">
              <div className="calendar-months">
                {[month, shiftCalendarMonth(month, 1)].map((value, index) =>
                  value ? (
                    <section
                      className={`calendar-month${index ? " calendar-month--second" : ""}`}
                      aria-label={monthLabel(value)}
                      key={value}
                    >
                      <h2>{monthLabel(value)}</h2>
                      <div className="calendar-grid">
                        {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
                          <span className="calendar-weekday" key={day}>
                            {day}
                          </span>
                        ))}
                        {gridDays(value).map(({ day, key }) => {
                          const item = items.find((row) => row.day === day);
                          if (!item) return <span key={key} />;
                          const labels =
                            item.weekdayClosed || item.closed
                              ? "휴무"
                              : item.manuallyClosed
                                ? "마감"
                                : item.overbooked
                                  ? "추가 수락"
                                  : item.full
                                    ? "다 참"
                                    : "";
                          return (
                            <button
                              type="button"
                              className="calendar-day"
                              key={item.day}
                              aria-label={`${dayLabel(item.day)} ${item.held}/${item.capacity}${labels ? ` ${labels}` : ""}`}
                              aria-pressed={base?.day === item.day}
                              aria-current={item.day === todayCalendarDate() ? "date" : undefined}
                              disabled={locked}
                              onClick={() => select(item)}
                            >
                              <span>{Number(item.day.slice(8))}</span>
                              <span>
                                {item.held}/<wbr />
                                {item.capacity}
                              </span>
                              {labels ? <span className="calendar-day-status">{labels}</span> : null}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ) : null,
                )}
              </div>
              <section className="calendar-panel" aria-label="날짜별 설정">
                {base && form ? (
                  <>
                    <h2>{dayLabel(base.day)}</h2>
                    <p>
                      잡힌 자리 {base.held} · 남은 자리 {base.remaining}
                    </p>
                    <p>주간 기준: {base.weekdayClosed ? "휴무" : "영업일"}</p>
                    <CommandStatus
                      state={command.state}
                      disabled={locked}
                      fields={fields}
                      done={(result) => result.notice}
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
                    {unchanged ? <Banner tone="success">이미 그렇게 되어 있어요</Banner> : null}
                    {stale ? (
                      <section aria-label="지금 날짜 설정">
                        <Banner tone="warning">그 사이 바뀌었어요. 지금 상태를 확인해 주세요</Banner>
                        {latest ? (
                          <>
                            <p>지금 하루 최대 개수: {latest.capacity}</p>
                            <p>지금 휴무: {latest.weekdayClosed || latest.closed ? "휴무" : "영업일"}</p>
                            <p>지금 주문 마감: {latest.manuallyClosed ? "마감" : "받음"}</p>
                            <p>
                              지금 잡힌 자리: {latest.held} · 남은 자리: {latest.remaining}
                            </p>
                            <Button disabled={locked} onClick={() => reset(true)}>
                              내 변경 다시 적용
                            </Button>
                            <Button disabled={locked} onClick={() => reset(false)}>
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
                    {outside && base ? (
                      <Banner
                        tone="warning"
                        actions={
                          <Button
                            disabled={locked}
                            onClick={() => props.onNavigate(`/owner/calendar?month=${base.day.slice(0, 7)}`)}
                          >
                            선택한 날짜로 돌아가기
                          </Button>
                        }
                      >
                        선택한 날짜는 지금 보는 기간 밖이에요. 그 날짜의 달로 돌아가 주세요.
                      </Banner>
                    ) : null}
                    <form aria-label="그날 설정" noValidate onSubmit={submit}>
                      {past ? <p>지난 날짜는 보기만 할 수 있어요</p> : null}
                      <Field pointer="/closed" label="그날 휴무" errors={fieldErrors.get("/closed")}>
                        {(ids) => (
                          <input
                            {...ids}
                            type="checkbox"
                            checked={form.closed}
                            disabled={locked || stale || past || outside}
                            onChange={(event) => edit({ closed: event.target.checked })}
                          />
                        )}
                      </Field>
                      <TextField
                        pointer="/capacityOverride"
                        label="그날 하루 최대 개수"
                        help="0~100개, 비우면 주간 기준을 써요"
                        inputMode="numeric"
                        value={form.capacityOverride}
                        disabled={locked || stale || past || outside}
                        errors={fieldErrors.get("/capacityOverride")}
                        onChange={(event) => edit({ capacityOverride: event.target.value })}
                      />
                      <Field
                        pointer="/manuallyClosed"
                        label="그날 주문 마감"
                        errors={fieldErrors.get("/manuallyClosed")}
                      >
                        {(ids) => (
                          <input
                            {...ids}
                            type="checkbox"
                            checked={form.manuallyClosed}
                            disabled={locked || stale || past || outside}
                            onChange={(event) => edit({ manuallyClosed: event.target.checked })}
                          />
                        )}
                      </Field>
                      {localErrors.length ? <Banner tone="danger">입력한 내용을 확인해 주세요</Banner> : null}
                      <Button
                        type="submit"
                        kind="primary"
                        disabled={locked || stale || past || outside}
                        busy={command.busy}
                      >
                        저장
                      </Button>
                    </form>
                  </>
                ) : (
                  <p>날짜를 누르면 그날 설정을 볼 수 있어요</p>
                )}
              </section>
            </div>
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
          <CalendarConflictList
            values={(command.state.conflicts ?? []).filter((item) => item.day === base?.day)}
            disabled={blocked}
          />
        ) : null}
      </ConfirmRequired>
    </OwnerLayout>
  );
}
