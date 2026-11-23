// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { OperatingRulesEditor } from "./OperatingRulesEditor";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const examples = api.paths["/owner/operating-rules"].get.responses[200].content["application/json"].examples;
const traceId = "0123456789abcdef0123456789abcdef";
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
  inProgress = hold = false;
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
function area() {
  const props = {
    shopName: "합성 운영규정 가게",
    onNavigate: vi.fn(),
    onSessionExpired: vi.fn(),
    onRegisterShop: vi.fn(),
    onLogout: vi.fn(),
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
