import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { fetchOwner } from "./owner";
import { fetchOwnerTasks, ownerTasksHref, parseOwnerTasksSearch, TASK_LABELS, taskHref } from "./owner-tasks-api";

const api = parse(readFileSync(new URL("../../../api/openapi.yaml", import.meta.url), "utf8"));
const examples = api.paths["/owner/tasks"].get.responses[200].content["application/json"].examples;
let value: typeof examples.open_tasks.value;
const query = { status: "open", limit: 20, cursor: null } as const;
beforeEach(() => {
  value = structuredClone(examples.open_tasks.value);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(value))),
  );
});
afterEach(() => vi.unstubAllGlobals());
it.each(Object.keys(examples))("API040 실제 계약 예시 %s를 읽는다", async (name) => {
  value = structuredClone(examples[name].value);
  const r = await fetchOwnerTasks(query);
  expect(r.ok).toBe(true);
  expect(vi.mocked(fetch).mock.calls[0]).toMatchObject([
    "/api/owner/tasks?status=open&limit=20",
    { credentials: "same-origin", cache: "no-store" },
  ]);
});
it.each([
  "?status=other",
  "?limit=0",
  "?limit=101",
  "?limit=1.5",
  "?limit=NaN",
  "?cursor=",
  "?cursor=%2Fprivate",
  "?cursor=" + "a".repeat(201),
  "?status=open&status=closed",
  "?limit=1&limit=2",
  "?cursor=a&cursor=b",
])("잘못된 주소 %s를 요청 전에 거른다", (search) => expect(parseOwnerTasksSearch(search)).toBeNull());
it("기본·닫힌 상태·최대100개·불투명 커서를 주소 왕복으로 보존한다", () => {
  expect(parseOwnerTasksSearch("")).toEqual(query);
  const q = { status: "closed", limit: 100, cursor: "opaque-cursor_1" } as const;
  expect(parseOwnerTasksSearch(ownerTasksHref(q).slice("/owner".length))).toEqual(q);
});
it.each([
  [
    "알 수 없는 종류",
    (v: typeof value) => {
      v.items[0].kind = "__proto__";
    },
  ],
  [
    "틀린 대상 종류",
    (v: typeof value) => {
      v.items[0].subject.type = "shop";
    },
  ],
  [
    "틀린 대상 ID",
    (v: typeof value) => {
      v.items[0].subject.id = "javascript:example";
    },
  ],
  [
    "긴 요약",
    (v: typeof value) => {
      v.items[0].summary = "가".repeat(201);
    },
  ],
  [
    "널 문자 요약",
    (v: typeof value) => {
      v.items[0].summary = "합성\0요약";
    },
  ],
  [
    "틀린 시각",
    (v: typeof value) => {
      v.items[0].openedAt = "어제";
    },
  ],
  [
    "틀린 기다림",
    (v: typeof value) => {
      v.items[0].waitStatus = "unknown";
    },
  ],
  [
    "틀린 주문번호",
    (v: typeof value) => {
      v.items[0].order.orderNo = "1234567";
    },
  ],
  [
    "중복 ID",
    (v: typeof value) => {
      v.items.push(structuredClone(v.items[0]));
    },
  ],
  [
    "큰 페이지",
    (v: typeof value) => {
      v.items = Array(21).fill(v.items[0]);
    },
  ],
  [
    "틀린 다음 커서",
    (v: typeof value) => {
      v.nextCursor = "/private";
    },
  ],
  [
    "틀린 친구 값",
    (v: typeof value) => {
      v.alertChannelFriend = "false";
    },
  ],
] as const)("API040 %s 응답을 화면으로 넘기지 않는다", async (_name, mutate) => {
  mutate(value);
  expect((await fetchOwnerTasks(query)).ok).toBe(false);
});
it("같은 커서로 순환하는 다음 페이지는 거절한다", async () => {
  value.nextCursor = "same";
  expect((await fetchOwnerTasks({ ...query, cursor: "same" })).ok).toBe(false);
});
it("200자 요약과 닫힘 라벨은 보존하고 계약 밖 개인정보 필드는 버린다", async () => {
  value.items[0].summary = "가".repeat(200);
  value.items[0].waitStatus = "closed_no_answer";
  value.items[0].phone = "example-phone";
  value.items[0].order.private = "example-private";
  value.private = "example-private";
  const r = await fetchOwnerTasks(query);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.data.items[0]?.summary.length).toBe(200);
  expect(r.data.items[0]?.waitStatus).toBe("closed_no_answer");
  expect(JSON.stringify(r.data)).not.toContain("example-private");
  expect(JSON.stringify(r.data)).not.toContain("example-phone");
});
it.each([
  ["handoff", "handoffs", ""],
  ["custom_order", "orders", "/custom-decision"],
  ["change_request", "change-requests", ""],
  ["issue_report", "issue-reports", ""],
  ["payment_claim", "payment-requests", ""],
  ["payment_mismatch", "payment-requests", ""],
  ["arrival_check", "payment-requests", ""],
  ["payment_overdue", "orders", "/overdue-decision"],
  ["refund_decision", "orders", "/refund-decision"],
  ["paid_after_cancel", "orders", "/refund-decision"],
  ["refund_send", "refunds", ""],
] as const)("%s는 해당 작업의 안전한 내부 주소로 간다", (kind, path, action) => {
  const id = value.items[0].taskId;
  expect(taskHref({ ...value.items[0], kind, subject: { type: "order", id } })).toBe(`/owner/${path}/${id}${action}`);
  expect(taskHref({ ...value.items[0], kind, subject: null })).toBeNull();
});
it("설정성 세 종류는 정한 내부 화면만 열고 미지의 주소는 만들지 않는다", () => {
  for (const [kind, path] of [
    ["ledger_relink", "/owner/ledger"],
    ["license_on_hold", "/owner/shop/license"],
    ["calendar_conflict", "/owner/calendar"],
  ] as const)
    expect(taskHref({ ...value.items[0], kind })).toBe(path);
  expect(Object.keys(TASK_LABELS)).toHaveLength(14);
});
it.each(([["unknown"], ["license_pending", "license_pending"], []] as const).map((banners) => ({ banners })))(
  "홈 배너 %j는 중복/알 수 없는 종류를 검증한다",
  async ({ banners }) => {
    const me = structuredClone(
      api.paths["/owner/me"].get.responses[200].content["application/json"].examples.mvp.value,
    );
    me.banners = [...banners];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(me))),
    );
    const r = await fetchOwner(new AbortController().signal, true);
    expect(r.ok).toBe(banners.length === 0);
  },
);
it("홈이 아닌 신원 확인은 배너 없는 이전 소비자의 계약을 유지한다", async () => {
  const me = structuredClone(api.paths["/owner/me"].get.responses[200].content["application/json"].examples.mvp.value);
  delete me.banners;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(me))),
  );
  expect((await fetchOwner(new AbortController().signal)).ok).toBe(true);
  expect((await fetchOwner(new AbortController().signal, true)).ok).toBe(false);
});
