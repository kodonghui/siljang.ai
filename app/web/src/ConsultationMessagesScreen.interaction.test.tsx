// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { OwnerArea } from "./OwnerArea";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const profile = api.paths["/owner/me"].get.responses[200].content["application/json"].examples.mvp.value;
const examples =
  api.paths["/owner/consultations/{consultationId}/messages"].get.responses[200].content["application/json"].examples;
let page: typeof examples.messages.value;
beforeEach(() => {
  page = structuredClone(examples.messages.value);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const path = String(input);
      return path === "/api/owner/me"
        ? Response.json(profile)
        : path.startsWith("/api/owner/consultations/")
          ? Response.json(page)
          : Response.json({ code: "not_found", traceId: "0123456789abcdef0123456789abcdef" }, { status: 404 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function open() {
  return render(
    <MemoryRouter initialEntries={[`/owner/consultations/${page.consultationId}`]}>
      <Routes>
        <Route path="/owner/login" element={<h1>합성 로그인 목적지</h1>} />
        <Route path="/owner/*" element={<OwnerArea />} />
      </Routes>
    </MemoryRouter>,
  );
}
it("사장님 상담 주소에서 실제 계약의 메시지와 시각·발신자를 표시한다", async () => {
  open();
  expect(await screen.findByRole("heading", { name: "상담 대화" })).toBeTruthy();
  expect(await screen.findByText("손님", { exact: true })).toBeTruthy();
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([input]) =>
        String(input).startsWith(`/api/owner/consultations/${page.consultationId}/messages`),
      ),
  ).toBe(true);
});
