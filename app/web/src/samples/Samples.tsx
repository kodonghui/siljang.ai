// 공통 부품 견본(개발 서버의 /samples.html?state=…에서만). scripts/page-check.mjs가 상태마다 360·1280으로 열어
// corthex-uxui page-check와 가로 넘침을 재고 스크린샷을 남긴다. 글은 08 화면 정의의 것(견본 값은 지어낸 것).
import { type ReactNode, useEffect, useState } from "react";
import type { CommandState } from "../command";
import { FIELD_REASONS } from "../problems";
import {
  AsOf,
  Button,
  CommandStatus,
  ConfirmDialog,
  ConfirmRequired,
  EmptyState,
  fieldErrorsFor,
  LoadFailure,
  Skeleton,
  TextField,
} from "../ui";
import { useCommand } from "../useCommand";
import { fakeSend, problemResult, sampleFailure } from "./fake";
import { LAYOUT_STATES, LayoutSample, type LayoutState } from "./LayoutSamples";

export const SAMPLE_STATES = {
  loading: "불러오는 중",
  empty: "빈 목록",
  "load-failed": "불러오기 실패",
  "not-found": "찾을 수 없음",
  permission: "권한(로그인)",
  stale: "오래됨(그 사이 바뀜)",
  "as-of": "오래됨(기준 시각)",
  "field-error": "필드 오류",
  "save-failed": "저장 실패(서버 실패)",
  submitting: "보내는 중",
  done: "됨",
  "rate-limited": "요청 빈도 한도",
  "already-done": "이미 처리됨",
  "not-allowed": "그 상태에서는 할 수 없음",
  confirm: "확인 창(서버 확인)",
  "confirm-notify": "확인 창(손님에게 안내가 감)",
  flow: "흐름: 확인 창 → 새 키로 다시 보냄",
  "flow-retry": "흐름: 서버 실패 → 같은 키로 다시 시도",
  ...LAYOUT_STATES,
} as const;

export type SampleState = keyof typeof SAMPLE_STATES;

export function isSampleState(value: string | null): value is SampleState {
  return value !== null && Object.hasOwn(SAMPLE_STATES, value);
}

const noop = () => {};
const FUTURE = 8_640_000_000_000_000; // 견본의 한도는 풀리지 않게(가장 먼 Date)

function Frame({ state, children }: { readonly state: SampleState; readonly children: ReactNode }) {
  useEffect(() => {
    document.documentElement.dataset.sampleReady = state;
  }, [state]);
  return (
    <main className="sample">
      <header className="sample__head">
        <h1>부품 견본</h1>
        <p className="sample__state">
          {SAMPLE_STATES[state]} · {state}
        </p>
      </header>
      {children}
    </main>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="sample__section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Rows() {
  return (
    <ul className="sample__rows">
      <li className="sample__row">
        <span>주문 확인 요청 · 11월 20일(금) 14:00</span>
        <span className="sample__muted">2026-1120-03</span>
      </li>
      <li className="sample__row">
        <span>결제 확인 요청 · 11월 21일(토) 11:00</span>
        <span className="sample__muted">2026-1121-01</span>
      </li>
    </ul>
  );
}

const FORM_FIELDS = ["/name", "/dailyLimit", "/registrationNumber"] as const;

/** 가게 설정 폼 견본(넣은 값은 그대로 둠). errors가 있으면 필드 옆에 */
function SampleForm({ state, actions }: { readonly state: CommandState<unknown>; readonly actions: ReactNode }) {
  const errors = state.kind === "failed" ? state.failure.fieldErrors : [];
  const { byField } = fieldErrorsFor(errors, FORM_FIELDS);
  return (
    <form className="ui-stack" onSubmit={(e) => e.preventDefault()} noValidate>
      <CommandStatus state={state} fields={FORM_FIELDS} onRetry={noop} onReload={noop} />
      <TextField pointer="/name" label="가게 이름" defaultValue="달빛 케이크" errors={byField.get("/name")} />
      <TextField
        pointer="/dailyLimit"
        label="하루 최대 개수"
        inputMode="numeric"
        defaultValue={state.kind === "failed" ? "120" : "8"}
        errors={byField.get("/dailyLimit")}
        messages={{ out_of_range: "하루 최대 개수는 0~100이에요" }}
        help="0~100"
      />
      <TextField
        pointer="/registrationNumber"
        label="사업자등록번호"
        inputMode="numeric"
        defaultValue={state.kind === "failed" ? "123-45-678" : "123-45-67890"}
        errors={byField.get("/registrationNumber")}
        messages={{ bad_format: "10자리 숫자로 넣어 주세요" }}
      />
      <div className="ui-actions">{actions}</div>
    </form>
  );
}

const failed = (
  code: Parameters<typeof sampleFailure>[0],
  extra?: Record<string, unknown>,
  blockedUntil: number | null = null,
) => ({ kind: "failed", failure: sampleFailure(code, extra), blockedUntil }) as const;

function FlowConfirm() {
  const cmd = useCommand(
    fakeSend<{ closed: boolean; confirm?: string[] }, { closed: boolean }>((input) =>
      input.confirm?.includes("closed_day_with_orders")
        ? { ok: true, status: 200, data: { closed: true }, replayed: false }
        : problemResult("confirmation_required", {
            confirm: [{ kind: "closed_day_with_orders", count: 2, day: "2026-11-20" }],
          }),
    ),
  );
  return (
    <Section title="11월 20일(금)">
      <CommandStatus
        state={cmd.state}
        done={() => "휴무로 바꿨어요"}
        doneActions={<Button onClick={cmd.reset}>다시 해 보기</Button>}
      />
      <p>확정 주문 2건 · 남은 자리 3</p>
      <div className="ui-actions">
        <Button kind="primary" busy={cmd.busy} onClick={() => cmd.submit({ closed: true })} data-sample="submit">
          휴무로 바꾸기
        </Button>
      </div>
      <ConfirmRequired
        items={cmd.state.kind === "confirm" ? cmd.state.items : null}
        confirmLabel="휴무로 바꾸기"
        onConfirm={cmd.confirm}
        onCancel={cmd.cancelConfirm}
      />
    </Section>
  );
}

function FlowRetry() {
  const cmd = useCommand(
    fakeSend<{ name: string }, { saved: boolean }>((_input, call) =>
      call === 0 ? problemResult("internal") : { ok: true, status: 200, data: { saved: true }, replayed: true },
    ),
  );
  return (
    <Section title="가게 설정">
      <CommandStatus state={cmd.state} onRetry={cmd.retry} done={() => "저장했어요"} />
      <div className="ui-actions">
        <Button kind="primary" busy={cmd.busy} onClick={() => cmd.submit({ name: "달빛 케이크" })} data-sample="submit">
          저장하기
        </Button>
      </div>
    </Section>
  );
}

function StaticDialog() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Section title="맞춤 주문 요청">
        <div className="ui-actions">
          <Button kind="primary" onClick={() => setOpen(true)}>
            거절
          </Button>
        </div>
      </Section>
      <ConfirmDialog
        open={open}
        title="거절할까요?"
        confirmLabel="거절하기"
        onConfirm={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      >
        <p>손님에게 거절 안내가 가요. 거절한 요청은 되돌릴 수 없어요</p>
      </ConfirmDialog>
    </>
  );
}

function StaticConfirm() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Section title="11월 20일(금)">
        <p>확정 주문 2건 · 남은 자리 3</p>
        <div className="ui-actions">
          <Button kind="primary" onClick={() => setOpen(true)}>
            휴무로 바꾸기
          </Button>
        </div>
      </Section>
      <ConfirmRequired
        items={open ? [{ kind: "closed_day_with_orders", count: 2, day: "2026-11-20" }, { kind: "overbooking" }] : null}
        confirmLabel="휴무로 바꾸기"
        onConfirm={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

function Body({ state }: { readonly state: Exclude<SampleState, LayoutState> }) {
  switch (state) {
    case "loading":
      return (
        <Section title="할 일">
          <Skeleton rows={3} />
        </Section>
      );
    case "empty":
      return (
        <Section title="할 일">
          <EmptyState>지금 처리할 일이 없어요</EmptyState>
        </Section>
      );
    case "load-failed":
      return <LoadFailure failure={sampleFailure("internal")} onRetry={noop} />;
    case "not-found":
      return (
        <LoadFailure
          failure={sampleFailure("not_found")}
          notFoundAction={
            <a className="ui-button ui-button--secondary" href="#orders">
              주문 목록으로
            </a>
          }
        />
      );
    case "permission":
      return <LoadFailure failure={sampleFailure("unauthenticated")} onLogin={noop} loginLabel="카카오 로그인" />;
    case "stale":
      return (
        <Section title="주문 상세">
          <CommandStatus state={failed("version_conflict")} onReload={noop} />
          <Rows />
        </Section>
      );
    case "as-of":
      return (
        <Section title="할 일">
          <AsOf time="14:05" onRefresh={noop} />
          <Rows />
        </Section>
      );
    case "field-error":
      return (
        <Section title="가게 설정">
          <SampleForm
            state={failed("validation_failed", {
              errors: [
                { field: "/dailyLimit", code: "out_of_range" },
                { field: "/registrationNumber", code: "bad_format" },
                { field: "/closedNote", code: "too_long" },
              ],
            })}
            actions={<Button kind="primary">저장하기</Button>}
          />
        </Section>
      );
    case "save-failed":
      return (
        <Section title="가게 설정">
          <SampleForm state={failed("internal")} actions={<Button kind="primary">저장하기</Button>} />
        </Section>
      );
    case "submitting":
      return (
        <Section title="맞춤 주문 요청">
          <p>견적 45,000~52,000원 · 픽업 11월 20일(금) 14:00</p>
          <div className="ui-actions">
            <Button kind="primary" busy>
              수락
            </Button>
            <Button disabled>금액 변경 수락</Button>
            <Button kind="danger" disabled>
              거절
            </Button>
          </div>
        </Section>
      );
    case "done":
      return (
        <Section title="에스컬레이션 건">
          <CommandStatus
            state={{ kind: "done", data: null, replayed: false }}
            done={() => "손님에게 보냈어요"}
            doneActions={<Button kind="secondary">할 일 목록으로</Button>}
          />
          <Rows />
        </Section>
      );
    case "rate-limited":
      return (
        <Section title="가게 설정">
          <SampleForm
            state={failed("rate_limited", { retryAfterSeconds: 30 }, FUTURE)}
            actions={
              <Button kind="primary" disabled>
                저장하기
              </Button>
            }
          />
        </Section>
      );
    case "already-done":
      return (
        <Section title="결제 확인 요청">
          <CommandStatus state={failed("already_decided")} onReload={noop} />
          <Rows />
        </Section>
      );
    case "not-allowed":
      return (
        <Section title="제작 기록">
          <CommandStatus state={failed("undo_window_passed")} onReload={noop} />
          <Rows />
        </Section>
      );
    case "confirm":
      return <StaticConfirm />;
    case "confirm-notify":
      return <StaticDialog />;
    case "flow":
      return <FlowConfirm />;
    case "flow-retry":
      return <FlowRetry />;
  }
}

const isLayoutState = (state: SampleState): state is LayoutState => Object.hasOwn(LAYOUT_STATES, state);

export function Samples({ state }: { readonly state: SampleState }) {
  // 레이아웃 견본은 화면 하나를 통째로 그림(견본 레이아웃 없이)
  if (isLayoutState(state)) return <LayoutSample state={state} />;
  return (
    <Frame state={state}>
      <Body state={state} />
    </Frame>
  );
}

/** 견본 목록(상태를 고르지 않았을 때) */
export function SampleIndex() {
  return (
    <main className="sample">
      <header className="sample__head">
        <h1>부품 견본</h1>
        <p className="sample__state">필드 오류 사유 {Object.keys(FIELD_REASONS).length}개 · 상태를 고르세요</p>
      </header>
      <nav aria-label="견본 상태">
        <ul className="sample__index">
          {Object.entries(SAMPLE_STATES).map(([key, label]) => (
            <li key={key}>
              <a href={`?state=${key}`}>
                {label} · {key}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}
