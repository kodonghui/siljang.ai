// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { KakaoChannelSettings } from "./KakaoChannelSettings";
import { OwnerArea } from "./OwnerArea";

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
  vi.useRealTimers();
  vi.restoreAllMocks();
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

function pending() {
  current = getExample("pending");
  current.checkStartedAt = new Date().toISOString();
  current.checkExpiresAt = new Date(Date.now() + 600000).toISOString();
  current.verifiedBlocks = ["card"];
}
it("연결 확인은 남은 시간과 블록별 닿음/기다림을 보여 준다", async () => {
  pending();
  area();
  await loaded();
  expect(main().getByText("남은 시간 10:00")).toBeTruthy();
  const blocks = main().getByRole("list", { name: "블록 확인 상태" });
  expect(blocks.textContent).toContain("확인 카드: 닿음");
  expect(blocks.textContent).toContain("주문자 정보: 기다림");
});
it("먼저 보내기 사유는 코드 대신 확인할 곳을 한국어로 알린다", async () => {
  current.eventStatus = "unavailable";
  current.eventFailReason = "event_block";
  area();
  await loaded();
  expect(main().getByText("먼저 보내기 안 됨: 안내 블록의 이벤트 이름과 배포를 확인해 주세요")).toBeTruthy();
});
it("5초 상태 조회는 연결됨이 되면 멈추고 실제 발신 API를 부르지 않는다", async () => {
  vi.useFakeTimers();
  pending();
  area();
  await act(async () => {});
  current = getExample("linked");
  current.eventStatus = "unchecked";
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(main().getByRole("heading", { name: "연결됨" })).toBeTruthy();
  expect(calls).toHaveLength(2);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(calls).toHaveLength(2);
});
function holdStatus() {
  const transport = fetch;
  let reads = 0,
    finish: ((value: Response) => void) | undefined,
    signal: AbortSignal | null | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/owner/kakao-channel" && (!init?.method || init.method === "GET") && ++reads === 2) {
        calls.push({ path: String(input), method: "GET", body: null, key: null });
        signal = init?.signal;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }
      return transport(input, init);
    }),
  );
  return { signal: () => signal, finish: (response: Response) => finish?.(response) };
}
it("상태 조회 중 편집을 시작하면 읽기를 취소하고 늦은401로 입력을 덮지 않는다", async () => {
  vi.useFakeTimers();
  pending();
  const status = holdStatus();
  const view = area();
  await act(async () => {});
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(calls).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "채널 바꾸기" }));
  expect(status.signal()?.aborted).toBe(true);
  fireEvent.change(screen.getByLabelText("봇 ID"), { target: { value: "synthetic-mine" } });
  await act(async () => {
    status.finish(json({ code: "unauthenticated", traceId }, 401));
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect((screen.getByLabelText("봇 ID") as HTMLInputElement).value).toBe("synthetic-mine");
  expect(calls).toHaveLength(2);
  expect(view.props.onSessionExpired).not.toHaveBeenCalled();
});
it("세션 확인은 진행 중 상태 조회를 취소하고 회복 뒤 한 번 재개한다", async () => {
  vi.useFakeTimers();
  pending();
  const status = holdStatus();
  const view = area();
  await act(async () => {});
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(calls).toHaveLength(2);
  view.rerender(<KakaoChannelSettings {...view.props} sessionChecking />);
  expect(status.signal()?.aborted).toBe(true);
  await act(async () => {
    status.finish(json({ code: "unauthenticated", traceId }, 401));
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(calls).toHaveLength(2);
  expect(view.props.onSessionExpired).not.toHaveBeenCalled();
  view.rerender(<KakaoChannelSettings {...view.props} sessionChecking={false} />);
  await act(async () => {});
  expect(calls).toHaveLength(3);
});

it("확인 기한 마지막 조회 뒤 서버가 pending이어도 자동 조회를 멈춘다", async () => {
  vi.useFakeTimers();
  pending();
  current.checkExpiresAt = new Date(Date.now() + 2000).toISOString();
  area();
  await act(async () => {});
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(calls).toHaveLength(2);
  expect(main().getByText("남은 시간 0:00")).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(calls).toHaveLength(2);
});
it("숨긴 탭은 상태 조회를 취소하고 돌아온 뒤에만 다시 읽는다", async () => {
  vi.useFakeTimers();
  pending();
  const status = holdStatus();
  area();
  await act(async () => {});
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(calls).toHaveLength(2);
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  fireEvent(document, new Event("visibilitychange"));
  expect(status.signal()?.aborted).toBe(true);
  await act(async () => {
    status.finish(json(current));
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(calls).toHaveLength(2);
  visibility.mockReturnValue("visible");
  fireEvent(document, new Event("visibilitychange"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(calls).toHaveLength(3);
});
it.each(["verified", "pending"])("실제 경로는 %s 가게의 채널 화면을 연다", async (licenseStatus) => {
  const transport = fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/owner/me")
        return json({
          owner: {
            ownerId: "d3898f13-62a2-4e3e-bd60-9797a6dfc506",
            alertChannelFriend: false,
            createdAt: "2026-11-15T00:00:00Z",
          },
          shop: { shopId: "1dc0769d-8fb3-46da-af01-729ec0ea63db", name: "합성 가게", licenseStatus },
        });
      return transport(input, init);
    }),
  );
  render(
    <MemoryRouter initialEntries={["/owner/kakao-channel/"]}>
      <Routes>
        <Route path="/owner/*" element={<OwnerArea />} />
      </Routes>
    </MemoryRouter>,
  );
  await loaded();
  expect(screen.getByRole("heading", { name: "카카오톡 채널 연결" })).toBeTruthy();
});

it("편집 중 상태 다시 보기는 잠겨 입력을 덮어쓰지 않는다", async () => {
  area();
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "채널 바꾸기" }));
  fireEvent.change(screen.getByLabelText("봇 ID"), { target: { value: "synthetic-mine" } });
  const button = screen.getByRole("button", { name: "연결 상태 다시 보기" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(calls).toHaveLength(1);
  expect((screen.getByLabelText("봇 ID") as HTMLInputElement).value).toBe("synthetic-mine");
});

it("보류 가게는 채널 API를 부르기 전에 영업 신고로 간다", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json({
        owner: {
          ownerId: "d3898f13-62a2-4e3e-bd60-9797a6dfc506",
          alertChannelFriend: false,
          createdAt: "2026-11-15T00:00:00Z",
        },
        shop: { shopId: "1dc0769d-8fb3-46da-af01-729ec0ea63db", name: "합성 가게", licenseStatus: "on_hold" },
      }),
    ),
  );
  render(
    <MemoryRouter initialEntries={["/owner/kakao-channel"]}>
      <Routes>
        <Route path="/owner/shop/license" element={<p>영업 신고 경로</p>} />
        <Route path="/owner/*" element={<OwnerArea />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByText("영업 신고 경로");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toBe("/api/owner/me");
});
it("충돌 뒤 바꾼 필드만 최신 revision에 다시 적용하고 새 키로 저장한다", async () => {
  area();
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "채널 바꾸기" }));
  fireEvent.change(screen.getByLabelText("봇 ID"), { target: { value: "synthetic-mine" } });
  const transport = fetch;
  let conflict = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT" && conflict) {
        conflict = false;
        calls.push({
          path: String(input),
          method: "PUT",
          body: JSON.parse(String(init.body)),
          key: new Headers(init.headers).get("Idempotency-Key"),
        });
        current = { ...current, botId: "synthetic-other", channelPublicId: "_latest", revision: "synthetic-latest" };
        return json({ code: "version_conflict", traceId }, 409);
      }
      return transport(input, init);
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: /^저장$/ }));
  await main().findByText("지금 봇 ID: synthetic-other");
  expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "내 변경 다시 적용" }));
  expect((screen.getByLabelText("봇 ID") as HTMLInputElement).value).toBe("synthetic-mine");
  expect((screen.getByLabelText("채널 공개 ID(선택)") as HTMLInputElement).value).toBe("_latest");
  fireEvent.click(screen.getByRole("button", { name: /^저장$/ }));
  await main().findByText("저장했어요. 아래 스킬 설정 값을 오픈빌더에 넣어 주세요");
  const writes = calls.filter((c) => c.method === "PUT");
  expect(writes).toHaveLength(2);
  expect(writes[1]?.body).toMatchObject({
    botId: "synthetic-mine",
    channelPublicId: "_latest",
    baseRevision: "synthetic-latest",
  });
  expect(writes[1]?.key).not.toBe(writes[0]?.key);
});
it.each(["version", "connection"])("상태 조회에서 %s이 바뀌면 이전 일회성 키를 지운다", async (kind) => {
  area();
  await loaded();
  fireEvent.click(screen.getByText("스킬 설정 값"));
  fireEvent.click(screen.getByRole("button", { name: "스킬 키 바꾸기" }));
  await main().findByText("스킬 키를 바꿨어요. 새 키를 오픈빌더 헤더 값에 넣고 배포해 주세요");
  expect(screen.getByLabelText("스킬 키(지금만 보임)")).toBeTruthy();
  if (kind === "version") current.skill.keyVersion++;
  else current.connectionId = "2d1e0bcc-7200-4ff5-a5eb-188736ef9dec";
  fireEvent.click(screen.getByRole("button", { name: "연결 상태 다시 보기" }));
  await waitFor(() => expect(screen.queryByLabelText("스킬 키(지금만 보임)")).toBeNull());
});

it("채널 편집 중에는 키 교체도 잠겨 별도 명령이 입력을 버리지 않는다", async () => {
  area();
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "채널 바꾸기" }));
  fireEvent.click(screen.getByText("스킬 설정 값"));
  expect((screen.getByRole("button", { name: "스킬 키 바꾸기" }) as HTMLButtonElement).disabled).toBe(true);
});
it("블록 누락으로 확인을 시작하지 못하면 빈 필드와 초점을 보인다", async () => {
  current = getExample("failed");
  current.blockIds.card = null;
  const transport = fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST" ? json({ code: "channel_setup_incomplete", traceId }, 409) : transport(input, init),
    ),
  );
  area();
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "다시 확인" }));
  await main().findByText("버튼 블록 ID 5개를 모두 넣어 주세요");
  const input = screen.getByLabelText("확인 카드");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  await waitFor(() => expect(document.activeElement).toBe(input));
});
