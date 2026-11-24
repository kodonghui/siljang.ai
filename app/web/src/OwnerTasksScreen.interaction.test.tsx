// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => {
  profile = structuredClone(meExamples.mvp.value);
  tasks = structuredClone(examples.open_tasks.value);
  problem = null;
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const path = String(input);
      calls.push(path);
      if (path === "/api/owner/me") return json(profile);
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
function home() {
  return render(
    <MemoryRouter initialEntries={["/owner"]}>
      <Routes>
        <Route path="/owner/login" element={<h1>로그인 합성 목적지</h1>} />
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
