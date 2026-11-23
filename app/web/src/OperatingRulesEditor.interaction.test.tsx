// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { OperatingRulesEditor } from "./OperatingRulesEditor";
import { OwnerArea } from "./OwnerArea";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const examples = api.paths["/owner/operating-rules"].get.responses[200].content["application/json"].examples;
const traceId = "0123456789abcdef0123456789abcdef";
let unchanged: boolean;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
let current: typeof examples.current.value,
  loads: number,
  sends: { body: Record<string, unknown>; key: string | null }[];
let loadProblem: { status: number; code: string } | null,
  saveProblem: { status: number; code: string; errors?: { field: string; code: string }[] } | null;
let inProgress: boolean, hold: boolean;
beforeEach(() => {
  current = structuredClone(examples.current.value);
  loads = 0;
  sends = [];
  loadProblem = saveProblem = null;
  inProgress = hold = unchanged = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      if (String(input) === "/api/owner/operating-rules") {
        loads++;
        return loadProblem ? json({ ...loadProblem, traceId }, loadProblem.status) : json(current);
      }
      if (String(input) === "/api/owner/operating-rules/versions") {
        const body = JSON.parse(String(init?.body));
        sends.push({ body, key: new Headers(init?.headers).get("Idempotency-Key") });
        if (hold) return new Promise(() => {});
        if (saveProblem && sends.length === 1) {
          if (saveProblem.code === "version_conflict")
            current = { ...current, version: 3, revision: "synthetic-v3", paymentDueHours: 24 };
          return json({ ...saveProblem, traceId }, saveProblem.status);
        }
        if (unchanged) return json({ outcome: "unchanged", operatingRules: current });
        if (inProgress && sends.length === 1) return json({ code: "request_in_progress", traceId }, 409);
        if (Number(body.preProductionRefundPct) < 100 && !body.confirm?.includes("lowered_refund"))
          return json({ code: "confirmation_required", confirm: [{ kind: "lowered_refund" }], traceId }, 409);
        current = {
          ...current,
          ...body,
          version: current.version === null ? 1 : current.version + 1,
          isTemplate: false,
          current: true,
          createdAt: "2026-11-23T12:00:00Z",
          supersededAt: null,
          revision: "synthetic-saved",
          preProductionLoweredAck: Number(body.preProductionRefundPct) < 100,
        };
        return json({ outcome: "created", operatingRules: current }, 201);
      }
      return json({ code: "not_found", traceId }, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  for (const node of document.querySelectorAll("[data-announcer]")) node.remove();
  vi.unstubAllGlobals();
});
const main = () => within(screen.getByRole("main"));
function area(extra: { sessionChecking?: boolean; sessionFailed?: boolean } = {}) {
  const props = {
    shopName: "합성 운영규정 가게",
    onNavigate: vi.fn(),
    onSessionExpired: vi.fn(),
    onRegisterShop: vi.fn(),
    onLogout: vi.fn(),
    ...extra,
  };
  return { ...render(<OperatingRulesEditor {...props} />), props };
}
const loaded = () => main().findByText(/운영규정 버전 2/);
const save = () => fireEvent.click(screen.getByRole("button", { name: "확정" }));
it("현재 기한과 조문 원문을 읽고 새 버전으로 확정한다", async () => {
  area();
  await loaded();
  fireEvent.change(screen.getByLabelText("견적 유효 기한(시간)"), { target: { value: "120" } });
  save();
  await main().findByText("확정했어요. 운영규정 버전 3");
  expect(sends[0]?.body).toMatchObject({
    baseRevision: examples.current.value.revision,
    quoteValidHours: 120,
    paymentDueHours: 12,
  });
  expect(sends[0]?.body.clauses).toEqual(examples.current.value.clauses);
});
it("미확정 템플릿의 필수 정책을 비워두면 저장하지 않고 정하면 첫 버전을 만든다", async () => {
  current = structuredClone(examples.template.value);
  area();
  await main().findByText("아직 확정 전이에요. 기본값을 확인하고 확정해 주세요");
  expect((screen.getByLabelText("견적 유효 기한(시간)") as HTMLInputElement).value).toBe("72");
  save();
  await main().findByText("입력한 내용을 확인해 주세요");
  expect(sends).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("변경 마감(시간)"), { target: { value: "48" } });
  fireEvent.change(screen.getByLabelText("날짜 변경 환불 기준"), { target: { value: "original_pickup" } });
  save();
  await main().findByText("확정했어요. 운영규정 버전 1");
});
it("환불을 낮추면 근거 확인 뒤 새 키/확인 값으로만 저장하고 돌아가기는 보존한다", async () => {
  area();
  await loaded();
  fireEvent.change(screen.getByLabelText("제작 전 취소 환불(%)"), { target: { value: "50" } });
  save();
  const dialog = await screen.findByRole("dialog", { name: "저장하기 전에 확인해 주세요" });
  expect(dialog.textContent).toContain("약관법");
  expect(sends).toHaveLength(1);
  fireEvent.click(within(dialog).getByRole("button", { name: "돌아가기" }));
  expect((screen.getByLabelText("제작 전 취소 환불(%)") as HTMLInputElement).value).toBe("50");
  expect(sends).toHaveLength(1);
  save();
  const again = await screen.findByRole("dialog", { name: "저장하기 전에 확인해 주세요" });
  fireEvent.click(within(again).getByRole("button", { name: "그래도 저장" }));
  await main().findByText("확정했어요. 운영규정 버전 3");
  expect(sends[2]?.body.confirm).toEqual(["lowered_refund"]);
  expect(sends[2]?.key).not.toBe(sends[1]?.key);
});
it.each([
  { status: 401, code: "unauthenticated", callback: "onSessionExpired" },
  { status: 404, code: "shop_not_registered", callback: "onRegisterShop" },
] as const)("조회 $code를 권한 경로로 보낸다", async (problem) => {
  loadProblem = problem;
  const view = area();
  await waitFor(() => expect(view.props[problem.callback]).toHaveBeenCalledOnce());
});
it("조회 실패는 추적 ID/재시도 뒤 양식을 연다", async () => {
  loadProblem = { status: 500, code: "internal" };
  area();
  await main().findByText(`추적 ID: ${traceId}`);
  loadProblem = null;
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await loaded();
  expect(loads).toBe(2);
});
it.each([
  { status: 401, code: "unauthenticated", callback: "onSessionExpired" },
  { status: 404, code: "shop_not_registered", callback: "onRegisterShop" },
] as const)("확정 $code도 입력을 남기고 권한 경로로 보낸다", async (problem) => {
  saveProblem = problem;
  const view = area();
  await loaded();
  save();
  await waitFor(() => expect(view.props[problem.callback]).toHaveBeenCalledOnce());
});
it("확정 서버 실패는 입력을 남기고 같은 키로 다시 보내며 성공은 한 번 보인다", async () => {
  saveProblem = { status: 500, code: "internal" };
  area();
  await loaded();
  fireEvent.change(screen.getByLabelText("결제 기한(시간)"), { target: { value: "24" } });
  save();
  await main().findByText(`추적 ID: ${traceId}`);
  expect((screen.getByLabelText("결제 기한(시간)") as HTMLInputElement).value).toBe("24");
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await main().findByText("확정했어요. 운영규정 버전 3");
  expect(sends[1]?.key).toBe(sends[0]?.key);
});
it("충돌은 내 견적 기한을 보존하고 다른 기기의 결제 기한 위에 다시 적용한다", async () => {
  saveProblem = { status: 409, code: "version_conflict" };
  area();
  await loaded();
  fireEvent.change(screen.getByLabelText("견적 유효 기한(시간)"), { target: { value: "120" } });
  save();
  fireEvent.click(await screen.findByRole("button", { name: "내 변경 다시 적용" }));
  expect((screen.getByLabelText("견적 유효 기한(시간)") as HTMLInputElement).value).toBe("120");
  expect((screen.getByLabelText("결제 기한(시간)") as HTMLInputElement).value).toBe("24");
  save();
  await main().findByText("확정했어요. 운영규정 버전 4");
  expect(sends[1]?.body.baseRevision).toBe("synthetic-v3");
});
it("처리 중 자동 재시도도 세션 확인 실패 뒤에는 전송하지 않는다", async () => {
  inProgress = true;
  const view = area();
  await loaded();
  save();
  await main().findByText("처리하고 있어요. 잠시 뒤 다시 확인해 주세요");
  view.rerender(<OperatingRulesEditor {...view.props} sessionFailed />);
  await act(() => new Promise<void>((done) => setTimeout(done, 1150)));
  expect(sends).toHaveLength(1);
  expect((screen.getByRole("button", { name: "로그아웃" }) as HTMLButtonElement).disabled).toBe(false);
});
it("확정 처리 중 다른 입력과 메뉴/로그아웃을 잠근다", async () => {
  hold = true;
  area();
  await loaded();
  save();
  await waitFor(() => expect(sends).toHaveLength(1));
  expect((screen.getByLabelText("결제 기한(시간)") as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "로그아웃" }) as HTMLButtonElement).disabled).toBe(true);
});

it("변경 없는 200 응답은 새 버전 없이 결과를 알린다", async () => {
  unchanged = true;
  area();
  await loaded();
  save();
  await main().findByText("바뀐 것이 없어 새 버전을 만들지 않았어요");
  expect(sends).toHaveLength(1);
  expect(main().getByText(/운영규정 버전 2/)).toBeTruthy();
});
it("서버의 카드 길이 422는 조문과 입력을 남기고 해당 조문 글에 초점을 보낸다", async () => {
  saveProblem = {
    status: 422,
    code: "validation_failed",
    errors: [
      { field: "/clauses", code: "exceeds_card_limit" },
      { field: "/clauses/0", code: "exceeds_card_limit" },
    ],
  };
  area();
  await loaded();
  const clause = within(screen.getByRole("group", { name: "조문 1" }));
  const effect = clause.getByLabelText("효과") as HTMLTextAreaElement;
  fireEvent.change(effect, { target: { value: "합성 조문을 보존합니다" } });
  save();
  await main().findByText("주문 요청 카드에 다 들어가지 않아요. 조문을 줄여 주세요");
  expect(effect.value).toBe("합성 조문을 보존합니다");
  expect(screen.getByRole("group", { name: "조문 1" }).getAttribute("data-invalid")).toBe("true");
  expect(document.activeElement).toBe(clause.getByLabelText("조건"));
});
it("처리 중 409는 같은 본문과 키로 자동 재시도해 확정한다", async () => {
  inProgress = true;
  area();
  await loaded();
  save();
  await main().findByText("확정했어요. 운영규정 버전 3", {}, { timeout: 3000 });
  expect(sends).toHaveLength(2);
  expect(sends[1]).toEqual(sends[0]);
});
it("환불 확인 창이 열린 뒤 세션 재확인에 실패하면 확인 전송만 잠그고 돌아갈 수 있다", async () => {
  const view = area();
  await loaded();
  fireEvent.change(screen.getByLabelText("제작 전 취소 환불(%)"), { target: { value: "50" } });
  save();
  await screen.findByRole("dialog", { name: "저장하기 전에 확인해 주세요" });
  view.rerender(<OperatingRulesEditor {...view.props} sessionFailed />);
  const dialog = within(screen.getByRole("dialog", { name: "저장하기 전에 확인해 주세요" }));
  expect((dialog.getByRole("button", { name: "그래도 저장" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(dialog.getByRole("button", { name: "그래도 저장" }));
  expect(sends).toHaveLength(1);
  fireEvent.click(dialog.getByRole("button", { name: "돌아가기" }));
  expect((screen.getByLabelText("제작 전 취소 환불(%)") as HTMLInputElement).value).toBe("50");
});
it.each(["pending", "verified", "on_hold"] as const)(
  "실제 운영규정 경로에서 %s 가게 권한을 먼저 확인한다",
  async (status) => {
    const transport = fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/owner/me")
          return json({
            owner: {
              ownerId: "00000000-0000-4000-8000-000000000051",
              alertChannelFriend: false,
              createdAt: "2026-11-23T12:00:00Z",
            },
            shop: { shopId: "00000000-0000-4000-8000-000000000052", name: "합성 규정 가게", licenseStatus: status },
          });
        return transport(input, init);
      }),
    );
    render(
      <MemoryRouter initialEntries={["/owner/operating-rules"]}>
        <Routes>
          <Route path="/owner/shop/license" element={<p>신고 수정 합성 목적지</p>} />
          <Route path="/owner/*" element={<OwnerArea />} />
        </Routes>
      </MemoryRouter>,
    );
    if (status === "on_hold") {
      await screen.findByText("신고 수정 합성 목적지");
      expect(loads).toBe(0);
    } else {
      await screen.findByText(/운영규정 버전 2/);
      expect(loads).toBe(1);
    }
  },
);

it.each(["checking", "failed"] as const)("첫 세션 %s 중에는 규정을 읽지 않고 확인 뒤 한 번만 읽는다", async (state) => {
  const view = area(state === "checking" ? { sessionChecking: true } : { sessionFailed: true });
  await act(async () => {});
  expect(loads).toBe(0);
  if (state === "failed")
    expect((screen.getByRole("button", { name: "로그아웃" }) as HTMLButtonElement).disabled).toBe(false);
  view.rerender(<OperatingRulesEditor {...view.props} sessionChecking={false} sessionFailed={false} />);
  await loaded();
  expect(loads).toBe(1);
  view.rerender(<OperatingRulesEditor {...view.props} sessionChecking />);
  view.rerender(<OperatingRulesEditor {...view.props} sessionChecking={false} sessionFailed={false} />);
  await loaded();
  expect(loads).toBe(1);
});

it("직접 쓴 조문은 빼면 양식 행에서도 없어지고 기본 조문 선택지는 남는다", async () => {
  area();
  await loaded();
  const before = screen.getAllByRole("group", { name: /^조문 / }).length;
  fireEvent.click(screen.getByRole("button", { name: "조문 추가" }));
  const added = screen.getByRole("group", { name: `조문 ${before + 1}` });
  fireEvent.click(within(added).getByRole("button", { name: "조문 빼기" }));
  expect(screen.getAllByRole("group", { name: /^조문 / })).toHaveLength(before);
  expect(screen.getAllByRole("button", { name: "이 조문 넣기" }).length).toBeGreaterThan(0);
});
it("조문 50개와 환불 단계 20개가 차면 추가를 막는다", async () => {
  current = {
    ...current,
    clauses: Array.from({ length: 50 }, (_, i) => ({
      key: "custom",
      position: i + 1,
      title: `합성 조문 ${i + 1}`,
      conditionText: "합성 조건",
      effectText: "합성 효과",
    })),
    refundTiers: Array.from({ length: 20 }, (_, i) => ({
      hoursBeforeMin: i,
      hoursBeforeMax: i === 19 ? null : i + 1,
      refundPct: 50,
    })),
  };
  area();
  await loaded();
  for (const name of ["조문 추가", "환불 단계 추가"]) {
    const button = screen.getByRole("button", { name }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
  }
  expect(screen.getByText("조문 50/50개")).toBeTruthy();
  expect(sends).toHaveLength(0);
});
it("요청 키 재사용 422는 입력을 남기고 새 키로 다시 확정한다", async () => {
  saveProblem = { status: 422, code: "idempotency_key_reused" };
  area();
  await loaded();
  fireEvent.change(screen.getByLabelText("결제 기한(시간)"), { target: { value: "24" } });
  save();
  const retry = await main().findByRole("button", { name: "다시 시도" });
  fireEvent.click(retry);
  await main().findByText("확정했어요. 운영규정 버전 3");
  expect(sends[1]?.body).toEqual(sends[0]?.body);
  expect(sends[1]?.key).not.toBe(sends[0]?.key);
});

it("충돌 뒤 최신 규정 조회가 실패해도 입력을 남기고 복구한 값 위에 다시 적용한다", async () => {
  saveProblem = { status: 409, code: "version_conflict" };
  area();
  await loaded();
  fireEvent.change(screen.getByLabelText("견적 유효 기한(시간)"), { target: { value: "120" } });
  loadProblem = { status: 500, code: "internal" };
  save();
  const retry = await main().findByRole("button", { name: "다시 시도" });
  expect((screen.getByLabelText("견적 유효 기한(시간)") as HTMLInputElement).value).toBe("120");
  expect((screen.getByRole("button", { name: "확정" }) as HTMLButtonElement).disabled).toBe(true);
  loadProblem = null;
  fireEvent.click(retry);
  fireEvent.click(await main().findByRole("button", { name: "내 변경 다시 적용" }));
  expect((screen.getByLabelText("결제 기한(시간)") as HTMLInputElement).value).toBe("24");
  expect((screen.getByLabelText("견적 유효 기한(시간)") as HTMLInputElement).value).toBe("120");
});

it("조문을 모두 빼면 확정하지 않고 하나 이상 넣으라는 이유를 알린다", async () => {
  area();
  await loaded();
  for (const button of screen.getAllByRole("button", { name: "조문 빼기" })) fireEvent.click(button);
  save();
  await within(screen.getByRole("region", { name: "운영규정 확정 결과" })).findByText("조문을 하나 이상 넣어 주세요");
  expect(sends).toHaveLength(0);
});
it("직접 쓴 조문 뒤 기본 조문을 넣어도 화면과 저장 본문의 순서가 같다", async () => {
  area();
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "조문 추가" }));
  const rows = screen.getAllByRole("group", { name: /^조문 / });
  const last = rows.at(-1);
  if (!last) throw new Error("직접 쓴 조문 없음");
  const custom = within(last);
  fireEvent.change(custom.getByLabelText("조문 이름"), { target: { value: "직접 쓴 합성 조문" } });
  fireEvent.change(custom.getByLabelText("조건"), { target: { value: "합성 조건" } });
  fireEvent.change(custom.getByLabelText("효과"), { target: { value: "합성 효과" } });
  const add = screen.getAllByRole("button", { name: "이 조문 넣기" })[0];
  if (!add) throw new Error("기본 조문 선택지 없음");
  const fieldset = add.closest("fieldset");
  if (!fieldset) throw new Error("기본 조문 없음");
  const title = (within(fieldset).getByLabelText("조문 이름") as HTMLInputElement).value;
  fireEvent.click(add);
  const activeRows = screen
    .getAllByRole("group", { name: /^조문 / })
    .filter((row) => within(row).queryByRole("button", { name: "조문 빼기" }));
  expect(
    activeRows.map((row) => (within(row).getByLabelText("조문 이름") as HTMLInputElement).value).slice(-2),
  ).toEqual(["직접 쓴 합성 조문", title]);
  expect(activeRows.map((row) => row.querySelector("legend")?.textContent)).toEqual(
    activeRows.map((_, i) => `조문 ${i + 1}`),
  );
});
it("세션 확인 실패에는 진행 중 조회 골격을 남기지 않는다", async () => {
  area({ sessionFailed: true });
  await act(async () => {});
  expect(screen.queryByText("운영규정을 불러오고 있어요")).toBeNull();
});
it("연결된 이력 화면으로 가는 버튼은 운영규정 이력 경로를 연다", async () => {
  const view = area();
  await loaded();
  fireEvent.click(screen.getByRole("link", { name: "버전 이력" }));
  expect(view.props.onNavigate).toHaveBeenCalledWith("/owner/operating-rules/versions");
});

it("현재 규정 조회가 실패해도 독립된 버전 이력 링크를 연다", async () => {
  loadProblem = { status: 500, code: "internal" };
  const view = area();
  await main().findByText(`추적 ID: ${traceId}`);
  const link = screen.getByRole("link", { name: "버전 이력" });
  expect(link.getAttribute("href")).toBe("/owner/operating-rules/versions");
  fireEvent.click(link);
  expect(view.props.onNavigate).toHaveBeenCalledWith("/owner/operating-rules/versions");
});
