// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { KakaoChannelSettings } from "./KakaoChannelSettings";

const api = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const getExample = (name: string) =>
  structuredClone(
    api.paths["/owner/kakao-channel"].get.responses[200].content["application/json"].examples[name].value,
  );
const resultExample = (suffix: string, method: string, name: string) =>
  structuredClone(
    api.paths[`/owner/kakao-channel${suffix}`][method].responses[200].content["application/json"].examples[name].value,
  );
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const traceId = "0123456789abcdef0123456789abcdef";
let current: ReturnType<typeof getExample>, empty: boolean;
let problem: { code: string; status: number } | null;
let calls: { path: string; method: string; body: unknown; key: string | null }[];
beforeEach(() => {
  current = getExample("linked");
  current.eventStatus = "unchecked";
  empty = false;
  problem = null;
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input),
        method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ path: url, method, body, key: new Headers(init?.headers).get("Idempotency-Key") });
      if (method === "GET")
        return problem
          ? json({ ...problem, traceId }, problem.status)
          : empty
            ? json({ code: "not_set", traceId }, 404)
            : json(current);
      if (method === "PUT") {
        const response = resultExample("", "put", "created");
        current = {
          ...response.kakaoChannel,
          botId: body.botId,
          channelPublicId: body.channelPublicId,
          blockIds: body.blockIds,
        };
        empty = false;
        return json({ ...response, kakaoChannel: current });
      }
      const response = url.endsWith("/skill-key")
        ? resultExample("/skill-key", "post", body.previousKey === "revoke_now" ? "revoked" : "regenerated")
        : resultExample("/check", "post", "started");
      current = response.kakaoChannel;
      return json(response);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const n of document.querySelectorAll("[data-announcer]")) n.remove();
});
function area(extra: { sessionChecking?: boolean; sessionFailed?: boolean } = {}) {
  const props = {
    shopName: "합성 채널 가게",
    onNavigate: vi.fn(),
    onSessionExpired: vi.fn(),
    onRegisterShop: vi.fn(),
    onLogout: vi.fn(),
    ...extra,
  };
  return { ...render(<KakaoChannelSettings {...props} />), props };
}
const main = () => within(screen.getByRole("main"));
const loaded = () => screen.findByLabelText("봇 ID");
it("무료 MVP 연결됨은 다음 대화 안내와 설정을 보이고 실제 발신을 부르지 않는다", async () => {
  area();
  await loaded();
  await main().findByRole("heading", { name: "연결됨" });
  expect(main().getByText("손님 안내는 다음 대화 때 전해요")).toBeTruthy();
  expect(calls).toHaveLength(1);
  expect(calls[0]?.method).toBe("GET");
});
it("미설정은 봇/선택 ID를 저장하고 일회성 키를 지금 화면에서만 보인다", async () => {
  empty = true;
  area();
  await loaded();
  fireEvent.change(screen.getByLabelText("봇 ID"), { target: { value: "synthetic-new-bot" } });
  fireEvent.click(screen.getByRole("button", { name: /^저장$/ }));
  await main().findByText("저장했어요. 아래 스킬 설정 값을 오픈빌더에 넣어 주세요");
  const input = screen.getByLabelText("스킬 키(지금만 보임)") as HTMLInputElement;
  expect(input.value).toHaveLength(43);
  expect(calls[1]?.body).toMatchObject({ baseRevision: null, botId: "synthetic-new-bot", channelPublicId: null });
  expect(main().getByText("이 키는 지금만 보여요. 잃으면 스킬 키를 바꿔요")).toBeTruthy();
});
it("옛 키를 바로 끊기로 바꾸면 실제 previousKey와 새 키를 표시한다", async () => {
  area();
  await loaded();
  fireEvent.click(screen.getByText("스킬 설정 값"));
  fireEvent.click(screen.getByLabelText("바로 끊기"));
  fireEvent.click(screen.getByRole("button", { name: "스킬 키 바꾸기" }));
  await main().findByText("스킬 키를 바꿨어요. 새 키를 오픈빌더 헤더 값에 넣고 배포해 주세요");
  expect(calls.find((c) => c.path.endsWith("/skill-key"))?.body).toMatchObject({
    baseRevision: expect.any(String),
    previousKey: "revoke_now",
  });
  expect((screen.getByLabelText("스킬 키(지금만 보임)") as HTMLInputElement).value).toHaveLength(43);
  expect(main().getByText("옛 키는 바로 끊었어요. 배포할 때까지 손님 메시지를 받지 않아요")).toBeTruthy();
});
it.each([
  { code: "unauthenticated", status: 401, callback: "onSessionExpired" },
  { code: "shop_not_registered", status: 404, callback: "onRegisterShop" },
] as const)("조회 $code는 권한 경로로 간다", async (p) => {
  problem = p;
  const view = area();
  await waitFor(() => expect(view.props[p.callback]).toHaveBeenCalledOnce());
});
it("조회 서버 실패는 추적 ID와 재시도를 보이고 뒤로 나갈 수 있다", async () => {
  problem = { code: "internal", status: 500 };
  const view = area();
  await main().findByText(`추적 ID: ${traceId}`);
  fireEvent.click(screen.getByRole("link", { name: "뒤로" }));
  expect(view.props.onNavigate).toHaveBeenCalledWith("/owner/shop");
  problem = null;
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await loaded();
});
it.each(["checking", "failed"] as const)("첫 세션 %s에는 채널을 요청하지 않는다", async (state) => {
  const view = area(state === "checking" ? { sessionChecking: true } : { sessionFailed: true });
  await Promise.resolve();
  expect(calls).toHaveLength(0);
  view.rerender(<KakaoChannelSettings {...view.props} sessionChecking={false} sessionFailed={false} />);
  await loaded();
  expect(calls).toHaveLength(1);
});
