import { expect, it, vi } from "vitest";
import { LedgerUncertainError, writeLedgerSheet } from "../src/ledger-sheet-write";
import { Secret } from "../src/settings";

const id = "11111111-1111-4111-8111-111111111111";
const input = {
  file: "synthetic_sheet_1234567890",
  tab: "장부",
  access: new Secret("fake"),
  setup: { sheetId: 7, start: 26, end: 39, movedRight: false, ownershipToken: "proof", columns: [] },
  shopId: crypto.randomUUID(),
  linkId: crypto.randomUUID(),
  eventId: id,
  values: ["ABC123", "이름", "010-0000-0000", "", "", "=1+1", 1000, "", "", 0, "", ""],
};

it("정상 갱신은 주문번호 열만 조회하고 숨김 ID를 같은 원자적 셀 쓰기에 넣는다", async () => {
  const calls: string[] = [];
  const send = vi.fn(async (raw: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(raw));
    calls.push(decodeURIComponent(url.pathname));
    if (init?.method === "GET") return Response.json({ values: [["주문번호"], ["ABC123"]] });
    const body = JSON.parse(String(init?.body));
    expect(body.requests).toHaveLength(1);
    const cells = body.requests[0].updateCells.rows[0].values;
    expect(cells[5].userEnteredValue).toEqual({ stringValue: "=1+1" });
    expect(cells[12].userEnteredValue).toEqual({ stringValue: id.replaceAll("-", "") });
    return Response.json({ spreadsheetId: input.file, replies: [{}] });
  });
  await writeLedgerSheet({ ...input, uncertain: false }, { fetch: send });
  expect(calls).toHaveLength(2);
  expect(calls[0]).toContain("!AA:AA");
  expect(calls.some((url) => url.includes("developerMetadata"))).toBe(false);
});

it("불확실한 쓰기가 이미 반영됐으면 ID 열만 조회하고 다시 쓰지 않는다", async () => {
  const send = vi.fn(async (_url: string | URL | Request) =>
    Response.json({ values: [["실장님 기록 ID"], [id.replaceAll("-", "")]] }),
  );
  await writeLedgerSheet({ ...input, uncertain: true }, { fetch: send });
  expect(send).toHaveBeenCalledTimes(1);
  expect(decodeURIComponent(String(send.mock.calls[0]?.[0]))).toContain("!AM:AM");
});
it("전송 후 연결 끊김만 불확실로 분류하고 명백한 요청 거절은 구분한다", async () => {
  const send = (status: "disconnect" | "bad_request") =>
    vi.fn(async (_raw: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "GET") return Response.json({ values: [["주문번호"]] });
      if (status === "disconnect") throw new Error("connection closed");
      return new Response(null, { status: 400 });
    });
  await expect(writeLedgerSheet({ ...input, uncertain: false }, { fetch: send("disconnect") })).rejects.toBeInstanceOf(
    LedgerUncertainError,
  );
  await expect(
    writeLedgerSheet({ ...input, uncertain: false }, { fetch: send("bad_request") }),
  ).rejects.not.toBeInstanceOf(LedgerUncertainError);
});
