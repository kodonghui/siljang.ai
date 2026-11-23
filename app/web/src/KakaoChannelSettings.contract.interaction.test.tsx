// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { KakaoChannelSettings } from "./KakaoChannelSettings";
import { ERROR_CODES } from "./problems";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const path = "/owner/kakao-channel";
const routes = [
  { path, method: "get" },
  { path, method: "put" },
  { path: `${path}/check`, method: "post" },
  { path: `${path}/skill-key`, method: "post" },
];
const rows = routes.flatMap((route) =>
  Object.entries(api.paths[route.path][route.method].responses).flatMap(([status, response]) => {
    const content = (
      response as { content: Record<string, { examples: Record<string, { value: Record<string, unknown> }> }> }
    ).content;
    return Object.entries(Object.values(content)[0]?.examples ?? {}).map(([name, example]) => ({
      ...route,
      name,
      value: example.value,
      status: status === "default" ? 500 : Number(status),
    }));
  }),
);
const example = (name: string) =>
  structuredClone(api.paths[path].get.responses[200].content["application/json"].examples[name].value);
const success = (route: (typeof routes)[number]) =>
  structuredClone(
    api.paths[route.path][route.method].responses[200].content["application/json"].examples[
      route.method === "put" ? "blocks_changed" : route.path.endsWith("/check") ? "started" : "regenerated"
    ].value,
  );
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const main = () => within(screen.getByRole("main"));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const node of document.querySelectorAll("[data-announcer]")) node.remove();
});
it("화면 원본41개와 헤더 누락 추가2개를 모두 대조한다", () => {
  expect(rows.filter((row) => row.name !== "missing_idempotency_key")).toHaveLength(41);
  expect(rows).toHaveLength(43);
});
it.each(rows)("$method $path $status $name 응답의 화면 처리", async (row) => {
  vi.useFakeTimers();
  const writes: { body: unknown; key: string | null }[] = [];
  const initial = example(row.path.endsWith("/check") ? "failed" : "linked");
  initial.eventStatus = "unchecked";
  const props = {
    shopName: "합성 계약 가게",
    onNavigate: vi.fn(),
    onSessionExpired: vi.fn(),
    onRegisterShop: vi.fn(),
    onLogout: vi.fn(),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET") {
        if (row.method === "get") return json(row.value, row.status);
        if (row.method === "put" && row.name === "created" && writes.length === 0)
          return json({ code: "not_set", traceId: "0123456789abcdef0123456789abcdef" }, 404);
        return json(initial);
      }
      writes.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
        key: new Headers(init?.headers).get("Idempotency-Key"),
      });
      return writes.length === 1 ? json(row.value, row.status) : json(success(row));
    }),
  );
  render(<KakaoChannelSettings {...props} />);
  await act(async () => {});
  if (row.method !== "get") {
    if (row.method === "put") {
      if (row.name !== "created") fireEvent.click(screen.getByRole("button", { name: "채널 바꾸기" }));
      fireEvent.change(screen.getByLabelText("봇 ID"), { target: { value: "synthetic-contract-bot" } });
      fireEvent.click(screen.getByRole("button", { name: /^저장$/ }));
    } else if (row.path.endsWith("/check")) fireEvent.click(screen.getByRole("button", { name: "다시 확인" }));
    else {
      fireEvent.click(screen.getByText("스킬 설정 값"));
      if (row.name === "revoked") fireEvent.click(screen.getByLabelText("바로 끊기"));
      fireEvent.click(screen.getByRole("button", { name: "스킬 키 바꾸기" }));
    }
    await act(async () => {});
    expect(writes).toHaveLength(1);
    expect(writes[0]?.key).toEqual(expect.any(String));
  }
  if (row.status === 200) {
    if (row.method === "get") {
      const heading = row.name === "pending" ? "연결 확인 중" : row.name === "failed" ? "연결 안 됨" : "연결됨";
      expect(main().getByRole("heading", { name: heading })).toBeTruthy();
      expect((screen.getByLabelText("봇 ID") as HTMLInputElement).value).toBe(row.value.botId);
      expect(screen.queryByLabelText("스킬 키(지금만 보임)")).toBeNull();
      if (row.name === "event_checking") expect(main().getByText("먼저 보내기 확인 중")).toBeTruthy();
      if (row.name === "event_unavailable") expect(main().getByText(/먼저 보내기 안 됨:/)).toBeTruthy();
    } else {
      const message =
        row.name === "unchanged"
          ? "바뀐 것이 없어요"
          : row.method === "put"
            ? row.name === "created"
              ? "저장했어요. 아래 스킬 설정 값을 오픈빌더에 넣어 주세요"
              : "블록 ID를 바꿨어요. 연결 확인을 다시 해 주세요"
            : row.path.endsWith("/check")
              ? "연결 확인을 시작했어요"
              : "스킬 키를 바꿨어요. 새 키를 오픈빌더 헤더 값에 넣고 배포해 주세요";
      expect(main().getByText(message)).toBeTruthy();
      if (row.value.skillKey)
        expect((screen.getByLabelText("스킬 키(지금만 보임)") as HTMLInputElement).value).toHaveLength(43);
      else expect(screen.queryByLabelText("스킬 키(지금만 보임)")).toBeNull();
    }
    return;
  }
  const code = row.value.code as keyof typeof ERROR_CODES;
  if (code === "request_in_progress") {
    expect(main().getByText("처리하고 있어요. 잠시 뒤 다시 확인해 주세요")).toBeTruthy();
    expect((screen.getByLabelText("봇 ID") as HTMLInputElement).disabled).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    return;
  }
  if (code === "unauthenticated") {
    expect(props.onSessionExpired).toHaveBeenCalledOnce();
    return;
  }
  if (code === "shop_not_registered") {
    expect(props.onRegisterShop).toHaveBeenCalledOnce();
    return;
  }
  expect(main().getAllByText(ERROR_CODES[code].message).length).toBeGreaterThan(0);
  if (code === "version_conflict") expect(main().getByRole("region", { name: "지금 채널" })).toBeTruthy();
  if (code === "channel_setup_incomplete")
    expect((screen.getByLabelText("봇 ID") as HTMLInputElement).disabled).toBe(false);
  if (code === "internal" || code === "idempotency_key_reused") {
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await act(async () => {});
    if (row.method !== "get") {
      expect(writes).toHaveLength(2);
      expect(writes[1]?.body).toEqual(writes[0]?.body);
      if (code === "internal") expect(writes[1]?.key).toBe(writes[0]?.key);
      else expect(writes[1]?.key).not.toBe(writes[0]?.key);
    }
  }
});
