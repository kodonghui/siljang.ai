// 공통 부품의 표시(renderToString). 브라우저에서 누르는 것(포커스 가둠·Esc·요청 키)은 scripts/page-check.mjs가 본다.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CommandState } from "../command";
import { CONFIRMATIONS, classify, ERROR_CODES, type ErrorCode, parseProblem } from "../problems";
import {
  AsOf,
  announcement,
  BACK_LABEL,
  BUSY_LABEL,
  Button,
  CommandStatus,
  ConfirmDialog,
  ConfirmRequired,
  clockText,
  EmptyState,
  Field,
  fieldErrorsFor,
  LoadFailure,
  RELOAD_LABEL,
  RETRY_LABEL,
  Skeleton,
  TextField,
} from ".";

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const noop = () => {};

const failure = (code: ErrorCode, extra: Record<string, unknown> = {}) =>
  classify(ERROR_CODES[code].status, parseProblem({ code, traceId: TRACE, ...extra }, ERROR_CODES[code].status), null);
const failed = (code: ErrorCode, extra: Record<string, unknown> = {}, blockedUntil: number | null = null) =>
  ({ kind: "failed", failure: failure(code, extra), blockedUntil }) as const satisfies CommandState<unknown>;

/** 태그를 뺀 글(화면에 보이는 것) */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

describe("G7: 명령 결과 일곱을 서로 다르게 알린다", () => {
  const cases: [string, CommandState<unknown>, { tone: string; says: string; action?: string }][] = [
    ["성공", { kind: "done", data: null, replayed: false }, { tone: "success", says: "손님에게 보냈어요" }],
    [
      "이미 처리됨",
      failed("already_decided"),
      { tone: "warning", says: ERROR_CODES.already_decided.message, action: RELOAD_LABEL },
    ],
    [
      "이미 바뀜",
      failed("version_conflict"),
      { tone: "warning", says: ERROR_CODES.version_conflict.message, action: RELOAD_LABEL },
    ],
    [
      "그 상태에서는 할 수 없음",
      failed("invalid_state", { detail: "확정되지 않은 주문이에요" }),
      { tone: "warning", says: ERROR_CODES.invalid_state.message, action: RELOAD_LABEL },
    ],
    [
      "필드 오류",
      failed("validation_failed", { errors: [{ field: "/name", code: "required" }] }),
      { tone: "danger", says: ERROR_CODES.validation_failed.message },
    ],
    ["찾을 수 없음", failed("not_found"), { tone: "statebox", says: ERROR_CODES.not_found.message }],
    ["서버 실패", failed("internal"), { tone: "danger", says: ERROR_CODES.internal.message, action: RETRY_LABEL }],
  ];

  it.each(cases)("%s", (_name, state, want) => {
    const html = renderToString(
      <CommandStatus
        state={state}
        fields={["/name"]}
        done={() => "손님에게 보냈어요"}
        onReload={noop}
        onRetry={noop}
      />,
    );
    expect(html).toContain(want.tone === "statebox" ? "ui-statebox--error" : `ui-banner--${want.tone}`);
    expect(text(html)).toContain(want.says);
    if (want.action !== undefined) expect(text(html)).toContain(want.action);
  });

  it("일곱의 모습(톤·말·버튼)이 모두 다르다", () => {
    const shown = cases.map(([, state]) =>
      text(
        renderToString(
          <CommandStatus
            state={state}
            fields={["/name"]}
            done={() => "손님에게 보냈어요"}
            onReload={noop}
            onRetry={noop}
          />,
        ),
      ),
    );
    expect(new Set(shown).size).toBe(7);
  });

  it("'그 상태에서는 할 수 없음'은 서버의 detail을 보이고, 서버 실패는 추적 ID를 보인다", () => {
    const notAllowed = renderToString(
      <CommandStatus state={failed("invalid_state", { detail: "확정되지 않은 주문이에요" })} onReload={noop} />,
    );
    expect(text(notAllowed)).toContain("확정되지 않은 주문이에요");
    const server = renderToString(<CommandStatus state={failed("internal")} onRetry={noop} />);
    expect(text(server)).toContain(`추적 ID: ${TRACE}`);
  });

  it("다시 보내지 않는 실패에는 '다시 시도'가 없고, 한도로 막힌 동안 '다시 시도'는 꺼진다", () => {
    const storage = renderToString(<CommandStatus state={failed("storage_unavailable")} onRetry={noop} />);
    expect(text(storage)).not.toContain(RETRY_LABEL);
    const blocked = renderToString(<CommandStatus state={failed("internal", {}, Date.now() + 1000)} onRetry={noop} />);
    expect(blocked).toMatch(/<button[^>]*disabled=""[^>]*>다시 시도/);
  });

  it("보내기 전·보내는 중·확인 창에서는 아무것도 그리지 않는다(버튼이 '처리하고 있어요', 확인 창은 따로)", () => {
    for (const state of [{ kind: "idle" }, { kind: "submitting" }, { kind: "confirm", items: [] }] as const) {
      expect(renderToString(<CommandStatus state={state} />)).toBe("");
    }
  });

  it("필드 오류: 화면이 그린 필드의 오류는 필드 옆, 그 밖의 위치는 폼 위 목록에", () => {
    const state = failed("validation_failed", {
      errors: [
        { field: "/name", code: "required" },
        { field: "/closedNote", code: "too_long" },
        { field: "/", code: "bad_json" },
      ],
    });
    const html = text(renderToString(<CommandStatus state={state} fields={["/name"]} />));
    expect(html).toContain("글자 수가 너무 많아요");
    expect(html).toContain("보낸 내용을 읽지 못했어요");
    expect(html).not.toContain("꼭 넣어 주세요");
  });

  it("코드 하나로 오는 필드 쪽 오류(시트 주소 등)는 필드에 붙였으면 폼 위에 되풀이하지 않는다", () => {
    const state = failed("sheet_not_accessible");
    expect(text(renderToString(<CommandStatus state={state} />))).toContain(ERROR_CODES.sheet_not_accessible.message);
    expect(text(renderToString(<CommandStatus state={state} fieldCodes={["sheet_not_accessible"]} />))).not.toContain(
      ERROR_CODES.sheet_not_accessible.message,
    );
  });

  it("로그인·가게 등록은 그리로 가는 버튼", () => {
    const login = text(
      renderToString(<CommandStatus state={failed("unauthenticated")} onLogin={noop} loginLabel="카카오 로그인" />),
    );
    expect(login).toContain(ERROR_CODES.unauthenticated.message);
    expect(login).toContain("카카오 로그인");
    const shop = text(renderToString(<CommandStatus state={failed("shop_not_registered")} onRegisterShop={noop} />));
    expect(shop).toContain("가게 등록");
  });

  it("화면 읽기 알림: 실패는 assertive, 성공은 polite, 필드 오류는 '입력한 내용을 확인해 주세요'", () => {
    expect(announcement(failed("internal"))).toEqual({ text: ERROR_CODES.internal.message, level: "assertive" });
    expect(announcement(failed("consent_required"))).toEqual({
      text: ERROR_CODES.validation_failed.message,
      level: "assertive",
    });
    expect(announcement({ kind: "done", data: null, replayed: false }, "저장했어요")).toEqual({
      text: "저장했어요",
      level: "polite",
    });
    expect(announcement({ kind: "submitting" })).toBeNull();
  });
});

describe("불러오기 실패(LoadFailure)", () => {
  it("서버 실패는 상자·추적 ID·'다시 시도'", () => {
    const html = text(renderToString(<LoadFailure failure={failure("internal")} onRetry={noop} />));
    expect(html).toContain(ERROR_CODES.internal.message);
    expect(html).toContain(`추적 ID: ${TRACE}`);
    expect(html).toContain(RETRY_LABEL);
  });

  it("로그인이 필요하면 로그인 상자, 찾을 수 없으면 돌아가는 길", () => {
    const login = text(
      renderToString(<LoadFailure failure={failure("unauthenticated")} onLogin={noop} loginLabel="카카오 로그인" />),
    );
    expect(login).toContain("다시 로그인해 주세요");
    expect(login).toContain("로그인하면 이 화면으로 돌아와요");
    const nf = text(
      renderToString(<LoadFailure failure={failure("not_found")} notFoundAction={<a href="#o">주문 목록으로</a>} />),
    );
    expect(nf).toContain("찾을 수 없어요");
    expect(nf).toContain("주문 목록으로");
  });
});

describe("필드(aria-invalid·aria-describedby)", () => {
  it("오류가 있으면 aria-invalid와 오류 줄·도움말을 가리킨다(화면이 준 글이 먼저)", () => {
    const html = renderToString(
      <TextField
        pointer="/dailyLimit"
        label="하루 최대 개수"
        errors={["out_of_range"]}
        messages={{ out_of_range: "하루 최대 개수는 0~100이에요" }}
        help="0~100"
        defaultValue="120"
      />,
    );
    const id = /<label for="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeDefined();
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain(`aria-describedby="${id}-e ${id}-h"`);
    expect(html).toContain(`id="${id}-e"`);
    expect(html).toContain("하루 최대 개수는 0~100이에요");
    expect(html).toContain('value="120"');
    expect(html).toContain("ui-field__box--invalid");
  });

  it("오류가 없으면 aria-invalid가 없고 도움말만 가리킨다", () => {
    const html = renderToString(<TextField pointer="/name" label="가게 이름" help="40자까지" />);
    expect(html).not.toContain("aria-invalid");
    expect(html).toMatch(/aria-describedby="[^"]+-h"/);
    expect(renderToString(<TextField pointer="/name" label="가게 이름" />)).not.toContain("aria-describedby");
  });

  it("사유 코드 없는 글(note)도 오류 줄, 입력은 어떤 요소든 ids를 받는다", () => {
    const html = renderToString(
      <Field pointer="/holder" label="예금주" note={ERROR_CODES.holder_not_verified.message}>
        {(ids) => <select {...ids} />}
      </Field>,
    );
    expect(html).toMatch(/<select[^>]*aria-invalid="true"/);
    expect(text(html)).toContain(ERROR_CODES.holder_not_verified.message);
  });

  it("06 errors를 필드 포인터로 나누고 화면에 없는 위치는 rest로", () => {
    const { byField, rest } = fieldErrorsFor(
      [
        { field: "/name", code: "required" },
        { field: "/name", code: "required" },
        { field: "/name", code: "too_long" },
        { field: "header:Content-Type", code: "not_allowed" },
      ],
      ["/name"],
    );
    expect(byField.get("/name")).toEqual(["required", "too_long"]);
    expect(rest).toEqual([{ field: "header:Content-Type", code: "not_allowed" }]);
  });
});

describe("버튼·확인 창·상태 부품", () => {
  it("보내는 중 버튼은 aria-disabled와 '처리하고 있어요'(포커스는 남음), 기본 type은 button", () => {
    const busy = renderToString(
      <Button kind="primary" busy>
        수락
      </Button>,
    );
    expect(busy).toContain('aria-disabled="true"');
    expect(busy).not.toMatch(/\sdisabled=""/);
    expect(text(busy)).toBe(BUSY_LABEL);
    expect(renderToString(<Button>수락</Button>)).toContain('type="button"');
  });

  it("확인 창은 제목·본문을 가리키고 '돌아가기'가 먼저, 액션 이름이 뒤", () => {
    const html = renderToString(
      <ConfirmDialog open title="거절할까요?" confirmLabel="거절하기" onConfirm={noop} onCancel={noop}>
        <p>손님에게 거절 안내가 가요</p>
      </ConfirmDialog>,
    );
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`<h2 id="${labelledBy}"`);
    expect(html).toContain(`id="${describedBy}"`);
    expect(html.indexOf(BACK_LABEL)).toBeLessThan(html.indexOf("거절하기"));
    expect(html).toMatch(/^<dialog class="ui-dialog"/);
  });

  it("서버가 요구한 확인은 06 제목과 확인할 것마다 06 글", () => {
    const html = text(
      renderToString(
        <ConfirmRequired
          items={[{ kind: "closed_day_with_orders", count: 2, day: "2026-11-20" }, { kind: "overbooking" }]}
          confirmLabel="휴무로 바꾸기"
          onConfirm={noop}
          onCancel={noop}
        />,
      ),
    );
    expect(html).toContain(ERROR_CODES.confirmation_required.message);
    expect(html).toContain("11월 20일: 이날 확정 주문 2건은 그대로 남아요. 휴무로 바꿀까요?");
    expect(html).toContain(CONFIRMATIONS.overbooking);
  });

  it("불러오는 중·빈 상태·기준 시각", () => {
    const loading = renderToString(<Skeleton rows={2} />);
    expect(loading).toContain('aria-busy="true"');
    expect(loading.match(/ui-skeleton__row/g)).toHaveLength(2);
    expect(text(loading)).toBe("불러오고 있어요");
    expect(text(renderToString(<EmptyState>지금 처리할 일이 없어요</EmptyState>))).toBe("지금 처리할 일이 없어요");
    const asOf = text(renderToString(<AsOf time="14:05" onRefresh={noop} />));
    expect(asOf).toContain("14:05 기준이에요");
    expect(asOf).toContain("새로 고침");
    expect(clockText(new Date("2026-11-16T05:05:00Z"), "Asia/Seoul")).toBe("14:05");
  });
});
