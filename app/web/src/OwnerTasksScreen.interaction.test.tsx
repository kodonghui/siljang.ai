// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { OwnerArea } from "./OwnerArea";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const meExamples = api.paths["/owner/me"].get.responses[200].content["application/json"].examples;
const examples = api.paths["/owner/tasks"].get.responses[200].content["application/json"].examples;
const traceId = "0123456789abcdef0123456789abcdef";
let profile: typeof meExamples.mvp.value;
let tasks: typeof examples.open_tasks.value;
let problem: { status: number; code: string } | null;
let calls: string[];
let profileProblem: { status: number; code: string } | null;
let taskResponse: ((path: string) => Promise<Response>) | null;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => {
  profile = structuredClone(meExamples.mvp.value);
  tasks = structuredClone(examples.open_tasks.value);
  problem = null;
  calls = [];
  profileProblem = null;
  taskResponse = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const path = String(input);
      calls.push(path);
      if (path === "/api/owner/me")
        return profileProblem ? json({ ...profileProblem, traceId }, profileProblem.status) : json(profile);
      if (path.startsWith("/api/owner/tasks") && taskResponse) return taskResponse(path);
      if (path.startsWith("/api/owner/tasks"))
        return problem ? json({ code: problem.code, traceId }, problem.status) : json(tasks);
      return json({ code: "not_found", traceId }, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  for (const node of document.querySelectorAll("[data-announcer]")) node.remove();
  vi.unstubAllGlobals();
});
function home(entry = "/owner") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/owner/login" element={<h1>로그인 합성 목적지</h1>} />
        <Route path="/owner/shop/new" element={<h1>가게 등록 합성 목적지</h1>} />
        <Route path="/owner/*" element={<OwnerArea />} />
      </Routes>
    </MemoryRouter>,
  );
}
it("사장님 홈은 열린 할 일 요약과 지연 표시를 보인다", async () => {
  home();
  await screen.findByRole("heading", { name: /^할 일$/ });
  for (const task of tasks.items) expect((await screen.findAllByText(task.summary)).length).toBeGreaterThan(0);
  expect(screen.getByRole("tab", { name: "열린 할 일" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "처리한 일" })).toBeTruthy();
  expect(screen.getAllByText("지연", { exact: true }).length).toBeGreaterThan(0);
  expect(calls.some((path) => path.startsWith("/api/owner/tasks"))).toBe(true);
});
it("빈 할 일은 가게 이름을 보존하고 빈 안내를 보인다", async () => {
  tasks.items = [];
  home();
  await screen.findByText("지금 처리할 일이 없어요");
  expect(screen.getAllByText(profile.shop.name).length).toBeGreaterThan(0);
});
it("할 일 조회500은 추적 ID와 재시도 뒤 회복한다", async () => {
  problem = { status: 500, code: "internal" };
  home();
  await screen.findByText(`추적 ID: ${traceId}`);
  problem = null;
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await screen.findAllByText(tasks.items[0].summary);
});
it("할 일401은 내용을 남기지 않고 로그인으로 돌아간다", async () => {
  problem = { status: 401, code: "unauthenticated" };
  home();
  await screen.findByRole("heading", { name: "로그인 합성 목적지" });
  expect(screen.queryByText(tasks.items[0].summary)).toBeNull();
});
it("MVP는 친구아님 응답이어도 우리 서비스 채널 배너를 보이지 않는다", async () => {
  profile = structuredClone(meExamples.not_friend.value);
  tasks = structuredClone(examples.not_friend.value);
  home();
  await screen.findAllByText(tasks.items[0].summary);
  expect(screen.queryByText("알림을 받으려면 우리 서비스 채널을 추가하세요")).toBeNull();
  expect(screen.queryByRole("link", { name: "채널 추가" })).toBeNull();
});

it("API002 friend의 배너 없는 이름과 목록을 보인다", async () => {
  profile = structuredClone(meExamples.friend.value);
  home();
  await screen.findAllByText(tasks.items[0].summary);
  expect(screen.getAllByText(profile.shop.name).length).toBeGreaterThan(0);
});
it("API002 no_shop은 할 일을 읽지 않고 등록으로 간다", async () => {
  profile = structuredClone(meExamples.no_shop.value);
  home();
  await screen.findByRole("heading", { name: "가게 등록 합성 목적지" });
  expect(calls.some((x) => x.startsWith("/api/owner/tasks"))).toBe(false);
});
it("API002 401은 목록 요청 없이 로그인으로 간다", async () => {
  profileProblem = { status: 401, code: "unauthenticated" };
  home();
  await screen.findByRole("heading", { name: "로그인 합성 목적지" });
  expect(calls.some((x) => x.startsWith("/api/owner/tasks"))).toBe(false);
});
it("API002 default는 추적 ID를 보이고 목록을 보내지 않는다", async () => {
  profileProblem = { status: 500, code: "internal" };
  home();
  await screen.findByText(`추적 ID: ${traceId}`);
  expect(calls.some((x) => x.startsWith("/api/owner/tasks"))).toBe(false);
});
it("API040 404는 목록을 버리고 등록으로 간다", async () => {
  problem = { status: 404, code: "shop_not_registered" };
  home();
  await screen.findByRole("heading", { name: "가게 등록 합성 목적지" });
  expect(screen.queryByText(tasks.items[0].summary)).toBeNull();
});
it("API040 422는 필터를 초기화할 수 있다", async () => {
  problem = { status: 422, code: "validation_failed" };
  home("/owner?limit=1&cursor=old");
  await screen.findByText("입력한 내용을 확인해 주세요");
  expect(screen.getByRole("link", { name: "처음부터 보기" }).getAttribute("href")).toBe("/owner?limit=1");
});
it("잘못된 URL은 요청 없이 오류를 보이고 처음부터 복귀한다", async () => {
  home("/owner?status=unknown");
  await screen.findByText("입력한 내용을 확인해 주세요");
  expect(calls.some((x) => x.startsWith("/api/owner/tasks"))).toBe(false);
  fireEvent.click(screen.getByRole("link", { name: "처음부터 보기" }));
  await screen.findAllByText(tasks.items[0].summary);
});
it("보류 중에도 홈에서 사유와 수정 경로를 찾는다", async () => {
  profile.shop.licenseStatus = "on_hold";
  profile.banners = ["license_on_hold"];
  home();
  await screen.findAllByText(tasks.items[0].summary);
  expect(screen.getByRole("link", { name: "보류 사유 보기" }).getAttribute("href")).toBe("/owner/shop/license");
});
it("닫힌 탭은 커서를 버리고 답 없어 닫힘을 보인다", async () => {
  home();
  await screen.findAllByText(tasks.items[0].summary);
  tasks.items[0].closedAt = "2026-11-24T12:00:00+09:00";
  tasks.items[0].waitStatus = "closed_no_answer";
  fireEvent.click(screen.getByRole("tab", { name: "처리한 일" }));
  await screen.findAllByText("답 없어 닫힘");
  expect(calls.some((x) => x.includes("status=closed"))).toBe(true);
  expect(screen.getByRole("tab", { name: "처리한 일" }).getAttribute("aria-selected")).toBe("true");
});
it("추가 조회 실패 뒤 같은 커서로 재시도하고 중복을 하나로 합친다", async () => {
  tasks.nextCursor = "next-page";
  const first = structuredClone(tasks.items[0]);
  home();
  await screen.findAllByText(first.summary);
  problem = { status: 500, code: "internal" };
  fireEvent.click(screen.getByRole("button", { name: "더 보기" }));
  await screen.findByText(`추적 ID: ${traceId}`);
  expect(screen.getAllByText(first.summary).length).toBeGreaterThan(0);
  problem = null;
  tasks.items = [
    first,
    { ...structuredClone(first), taskId: "00000000-0000-4000-8000-000000000099", summary: "추가 합성 할 일" },
  ];
  tasks.nextCursor = null;
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await screen.findAllByText("추가 합성 할 일");
  expect(calls.filter((x) => x.includes("cursor=next-page"))).toHaveLength(2);
  const rows = within(screen.getByRole("table")).getAllByRole("row");
  expect(rows.filter((x) => x.textContent?.includes(first.summary))).toHaveLength(1);
});
it("새로 고침 실패는 기존 목록과 기준 시각을 남긴다", async () => {
  home();
  await screen.findAllByText(tasks.items[0].summary);
  problem = { status: 500, code: "internal" };
  fireEvent.click(screen.getByRole("button", { name: "새로 고침" }));
  await screen.findByText(`추적 ID: ${traceId}`);
  expect(screen.getAllByText(tasks.items[0].summary).length).toBeGreaterThan(0);
  expect(screen.getByText(/기준이에요/)).toBeTruthy();
});
it("배너 네 개는 처음 세 개만 보이고 더 펼칠 수 있다", async () => {
  profile.banners = ["license_pending", "license_on_hold", "booking_link_not_ready", "ledger_relink"];
  home();
  await screen.findAllByText(tasks.items[0].summary);
  expect(screen.queryByRole("link", { name: "장부 보기" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "배너 1개 더" }));
  expect(screen.getByRole("link", { name: "장부 보기" })).toBeTruthy();
});
