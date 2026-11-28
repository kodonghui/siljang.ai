import { expect, it } from "vitest";
import { buildLedgerCheckpoint } from "../src/ledger-checkpoint";
import { type LedgerCheckpoint, ledgerRowDigest, writeLedgerSheet } from "../src/ledger-sheet-write";
import { Secret } from "../src/settings";

const file = "synthetic_sheet_1234567890",
  orderId = crypto.randomUUID(),
  otherId = crypto.randomUUID(),
  eventId = crypto.randomUUID();
const input = {
  file,
  tab: "장부",
  access: new Secret("fake"),
  hashKey: new Secret("synthetic-hash-key"),
  setup: {
    sheetId: 1,
    start: 0,
    end: 14,
    sheetColumnCount: 14,
    movedRight: false,
    ownershipToken: "test",
    columns: [],
  },
  values: ["ABC123", "이름", "", "", "", "", 0, "", "", 0, "", ""],
  shopId: crypto.randomUUID(),
  linkId: crypto.randomUUID(),
  eventId,
  orderId,
};
const prior = (order: string, id: string) => [
  order,
  `기존 ${order}`,
  "",
  "",
  "",
  "",
  0,
  "",
  "",
  0,
  "",
  "",
  "event",
  id.replaceAll("-", ""),
];

const withDigest = async () => ({
  ...input,
  expectedDigest: await ledgerRowDigest(input.hashKey, prior("ABC123", orderId)),
});

it("다른 주문이 대상 위치로 이동해 덮였으면 원래 값을 빈 행에 되살리고 알린다", async () => {
  let rows: (string | number)[][] = [prior("ABC123", orderId), prior("XYZ789", otherId)];
  const beforeOther = prior("XYZ789", otherId);
  let writes = 0,
    reads = 0;
  const send = async (raw: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "GET") {
      reads++;
      const path = decodeURIComponent(String(raw));
      if (path.includes("!A5000:N")) return Response.json({ values: [] });
      if (path.includes("!A:A")) return Response.json({ values: [["주문번호"], ...rows.map((r) => [r[0]])] });
      if (path.includes("!A2:N2")) return Response.json({ values: [rows[0]] });
      return Response.json({ values: [["header"], ...rows] });
    }
    const req = JSON.parse(String(init?.body)).requests[0];
    writes++;
    if (writes === 1) {
      rows = [rows[1] ?? [], rows[0] ?? []];
      rows[0] = req.updateCells.rows[0].values.map(
        (v: { userEnteredValue: { stringValue?: string; numberValue?: number } }) =>
          v.userEnteredValue.stringValue ?? v.userEnteredValue.numberValue ?? "",
      );
    } else if (req.appendCells)
      rows.push(
        req.appendCells.rows[0].values.map(
          (v: { userEnteredValue?: { stringValue?: string; numberValue?: number } }) =>
            v.userEnteredValue?.stringValue ?? v.userEnteredValue?.numberValue ?? "",
        ),
      );
    return Response.json({ spreadsheetId: file, replies: [{}] });
  };
  await expect(writeLedgerSheet(await withDigest(), { fetch: send })).rejects.toThrow();
  expect(rows).toContainEqual(beforeOther);
  expect(writes).toBe(2);
  expect(reads).toBe(5);
});
it("우리 열 5000행을 넘으면 어떠한 쓰기도 하지 않는다", async () => {
  let writes = 0;
  const rows = Array.from({ length: 5002 }, (_, i) => [i === 0 ? "주문번호" : `X${String(i).padStart(6, "0")}`]);
  const send = async (_raw: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "GET") return Response.json({ values: rows });
    writes++;
    return Response.json({ spreadsheetId: file, replies: [{}] });
  };
  await expect(writeLedgerSheet(await withDigest(), { fetch: send })).rejects.toThrow();
  expect(writes).toBe(0);
});
it("다른 주문의 우리 열이 수정되면 덮어쓰거나 복원하지 않고 멈춘다", async () => {
  const rows: (string | number)[][] = [prior("ABC123", orderId), prior("XYZ789", otherId)];
  let writes = 0,
    reads = 0;
  const send = async (raw: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "GET") {
      reads++;
      if (decodeURIComponent(String(raw)).includes("!A2:N2")) return Response.json({ values: [rows[0]] });
      return Response.json({ values: [["header"], ...rows] });
    }
    writes++;
    const req = JSON.parse(String(init?.body)).requests[0];
    rows[0] = req.updateCells.rows[0].values.map(
      (v: { userEnteredValue: { stringValue?: string; numberValue?: number } }) =>
        v.userEnteredValue.stringValue ?? v.userEnteredValue.numberValue ?? "",
    );
    rows[1] = [...(rows[1] ?? [])];
    rows[1][1] = "사장님 수정";
    return Response.json({ spreadsheetId: file, replies: [{}] });
  };
  await expect(writeLedgerSheet(await withDigest(), { fetch: send })).rejects.toThrow();
  expect(writes).toBe(1);
  expect(rows[1]?.[1]).toBe("사장님 수정");
  expect(reads).toBe(3);
});
it("쓰기 직전 주문 ID가 다르면 쓰지 않고 멈춘다", async () => {
  let writes = 0;
  const row = prior("ABC123", orderId);
  const send = async (raw: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "GET")
      return Response.json({
        values: decodeURIComponent(String(raw)).includes("!A2:N2") ? [prior("XYZ789", otherId)] : [["header"], row],
      });
    writes++;
    return Response.json({ spreadsheetId: file, replies: [{}] });
  };
  await expect(writeLedgerSheet(await withDigest(), { fetch: send })).rejects.toThrow();
  expect(writes).toBe(0);
});
it("무관한 중복과 주문 식별자가 없는 부분 행은 대상 주문의 갱신을 막지 않는다", async () => {
  const target = prior("ABC123", orderId),
    duplicate = prior("XYZ789", otherId);
  let rows: (string | number)[][] = [target, duplicate, [...duplicate], ["", "메모"], ["", "다른 메모"]],
    writes = 0;
  const send = async (raw: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "GET")
      return Response.json({
        values: decodeURIComponent(String(raw)).includes("!A2:N2") ? [rows[0]] : [["header"], ...rows],
      });
    writes++;
    const cells = JSON.parse(String(init?.body)).requests[0].updateCells.rows[0].values;
    rows[0] = cells.map(
      (v: { userEnteredValue: { stringValue?: string; numberValue?: number } }) =>
        v.userEnteredValue.stringValue ?? v.userEnteredValue.numberValue ?? "",
    );
    return Response.json({ spreadsheetId: file, replies: [{}] });
  };
  await expect(writeLedgerSheet(await withDigest(), { fetch: send })).resolves.toBeUndefined();
  expect(writes).toBe(1);
});
it("쓰기 뒤 행을 정렬해도 주문 ID와 내용이 유지되면 성공한다", async () => {
  const rows: (string | number)[][] = [prior("ABC123", orderId), prior("XYZ789", otherId)];
  const send = async (raw: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "GET")
      return Response.json({
        values: decodeURIComponent(String(raw)).includes("!A2:N2") ? [rows[0]] : [["header"], ...rows],
      });
    const cells = JSON.parse(String(init?.body)).requests[0].updateCells.rows[0].values;
    rows[0] = cells.map(
      (v: { userEnteredValue: { stringValue?: string; numberValue?: number } }) =>
        v.userEnteredValue.stringValue ?? v.userEnteredValue.numberValue ?? "",
    );
    rows.reverse();
    return Response.json({ spreadsheetId: file, replies: [{}] });
  };
  await expect(writeLedgerSheet(await withDigest(), { fetch: send })).resolves.toBeUndefined();
});
it("사장님 열에 5,000번째 행 자료가 있으면 새 행 추가를 중단한다", async () => {
  let writes = 0;
  const ownerRows = Array.from({ length: 5000 }, (_, i) => (i === 4999 ? ["", "", "사장님 자료"] : []));
  const send = async (raw: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      writes++;
      return Response.json({ spreadsheetId: file, replies: [{}] });
    }
    const path = decodeURIComponent(String(raw));
    return Response.json({ values: path.includes("!A5000:T") ? ownerRows : [["header"]] });
  };
  await expect(
    writeLedgerSheet({ ...(await withDigest()), setup: { ...input.setup, sheetColumnCount: 20 } }, { fetch: send }),
  ).rejects.toThrow();
  expect(writes).toBe(0);
});
it("복구가 5,000행을 넘으면 복구 쓰기를 시작하지 않고 알린다", async () => {
  let rows: (string | number)[][] = [prior("ABC123", orderId), prior("XYZ789", otherId)],
    writes = 0;
  const ownerRows = Array.from({ length: 5000 }, (_, i) => (i === 4999 ? ["", "", "사장님 자료"] : []));
  const send = async (raw: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "GET") {
      const path = decodeURIComponent(String(raw));
      if (path.includes("!A5000:T")) return Response.json({ values: ownerRows });
      if (path.includes("!A2:N2")) return Response.json({ values: [rows[0]] });
      return Response.json({ values: [["header"], ...rows] });
    }
    writes++;
    const cells = JSON.parse(String(init?.body)).requests[0].updateCells.rows[0].values;
    rows = [
      cells.map(
        (v: { userEnteredValue: { stringValue?: string; numberValue?: number } }) =>
          v.userEnteredValue.stringValue ?? v.userEnteredValue.numberValue ?? "",
      ),
      rows[0] ?? [],
    ];
    return Response.json({ spreadsheetId: file, replies: [{}] });
  };
  await expect(
    writeLedgerSheet({ ...(await withDigest()), setup: { ...input.setup, sheetColumnCount: 20 } }, { fetch: send }),
  ).rejects.toThrow();
  expect(writes).toBe(1);
});
it("대상 주문의 사장님 수정은 주문 ID가 같아도 덮어쓰지 않는다", async () => {
  const original = prior("ABC123", orderId),
    changed = [...original];
  changed[1] = "사장님이 수정";
  const { ledgerRowDigest } = await import("../src/ledger-sheet-write");
  const key = new Secret("synthetic-hash-key"),
    expectedDigest = await ledgerRowDigest(key, original);
  let writes = 0;
  const send = async (_raw: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "GET") return Response.json({ values: [["header"], changed] });
    writes++;
    return Response.json({ spreadsheetId: file, replies: [{}] });
  };
  await expect(writeLedgerSheet({ ...input, hashKey: key, expectedDigest }, { fetch: send })).rejects.toThrow();
  expect(writes).toBe(0);
});
it("밀려 덮인 행의 수식은 계산값이나 일반 문자열로 바꾸지 않고 복구한다", async () => {
  const target = prior("ABC123", orderId),
    other = prior("XYZ789", otherId);
  other[5] = "=SUM(1,2)";
  let rows = [target, other],
    writes = 0;
  const send = async (raw: string | URL | Request, init?: RequestInit) => {
    const url = decodeURIComponent(String(raw));
    if (init?.method === "GET") {
      if (url.includes("!A5000:N")) return Response.json({ values: [] });
      if (url.includes("fields=sheets")) {
        const typedRows = [
          {},
          ...rows.map((row) => ({
            values: row.map((v) => ({
              userEnteredValue: v === "=SUM(1,2)" ? { formulaValue: v } : { stringValue: v },
            })),
          })),
        ];
        return Response.json({ sheets: [{ data: [{ rowData: typedRows }] }] });
      }
      if (url.includes("!A2:N2")) return Response.json({ values: [rows[0]] });
      return Response.json({ values: [["header"], ...rows] });
    }
    writes++;
    const request = JSON.parse(String(init?.body)).requests[0];
    if (request.updateCells) {
      const replaced = request.updateCells.rows[0].values.map(
        (cell: { userEnteredValue: { stringValue?: string; numberValue?: number } }) =>
          cell.userEnteredValue.stringValue ?? cell.userEnteredValue.numberValue ?? "",
      );
      rows = [replaced, target];
    } else {
      const restored = request.appendCells.rows[0].values;
      expect(restored[5].userEnteredValue).toEqual({ formulaValue: "=SUM(1,2)" });
      rows.push(
        restored.map(
          (cell: { userEnteredValue: { stringValue?: string; numberValue?: number; formulaValue?: string } }) =>
            cell.userEnteredValue.stringValue ??
            cell.userEnteredValue.numberValue ??
            cell.userEnteredValue.formulaValue ??
            "",
        ),
      );
    }
    return Response.json({ spreadsheetId: file, replies: [{}] });
  };
  await expect(writeLedgerSheet(await withDigest(), { fetch: send })).rejects.toThrow();
  expect(writes).toBe(2);
});
it("스냅숏 뒤 같은 주문 행이 수정되면 쓰기 직전 다시 확인해 멈춘다", async () => {
  const original = prior("ABC123", orderId),
    edited = [...original];
  edited[1] = "사장님 수정";
  let writes = 0;
  const send = async (raw: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      writes++;
      return Response.json({ spreadsheetId: file, replies: [{}] });
    }
    return Response.json({
      values: decodeURIComponent(String(raw)).includes("!A2:N2") ? [edited] : [["header"], original],
    });
  };
  await expect(writeLedgerSheet(await withDigest(), { fetch: send })).rejects.toThrow();
  expect(writes).toBe(0);
});
it("쓰는 사이 다른 주문이 새로 생기면 행 집합 변경으로 알린다", async () => {
  const rows = [prior("ABC123", orderId)];
  let writes = 0;
  const send = async (raw: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "GET")
      return Response.json({
        values: decodeURIComponent(String(raw)).includes("!A2:N2") ? [rows[0]] : [["header"], ...rows],
      });
    writes++;
    const cells = JSON.parse(String(init?.body)).requests[0].updateCells.rows[0].values;
    rows[0] = cells.map(
      (v: { userEnteredValue: { stringValue?: string; numberValue?: number } }) =>
        v.userEnteredValue.stringValue ?? v.userEnteredValue.numberValue ?? "",
    );
    rows.push(prior("XYZ789", otherId));
    return Response.json({ spreadsheetId: file, replies: [{}] });
  };
  await expect(writeLedgerSheet(await withDigest(), { fetch: send })).rejects.toMatchObject({
    affectedOrderIds: [otherId],
  });
  expect(writes).toBe(1);
});
it("사장님 열의 큰 값이 5000행 위에 있어도 경계 아래만 확인해 추가한다", async () => {
  let writes = 0;
  const send = async (raw: string | URL | Request, init?: RequestInit) => {
    const url = decodeURIComponent(String(raw));
    if (init?.method === "POST") {
      writes++;
      return Response.json({ spreadsheetId: file, replies: [{}] });
    }
    if (url.includes("!A:T")) return new Response("x".repeat(2 * 1024 * 1024 + 1));
    if (url.includes("!A5000:T")) return Response.json({ values: [] });
    if (writes)
      return Response.json({
        values: [["header"], [...input.values, eventId.replaceAll("-", ""), orderId.replaceAll("-", "")]],
      });
    return Response.json({ values: [["header"]] });
  };
  await expect(
    writeLedgerSheet({ ...input, setup: { ...input.setup, sheetColumnCount: 20 } }, { fetch: send }),
  ).resolves.toBeUndefined();
  expect(writes).toBe(1);
});
it("쓰기 직후 중단한 뒤 다른 주문 소실을 감지하고 자동 복구 대신 알린다", async () => {
  const oldTarget = prior("ABC123", orderId),
    oldOther = prior("XYZ789", otherId);
  let rows = [oldTarget, oldOther],
    checkpoint: LedgerCheckpoint | null = null,
    writes = 0,
    crashed = false;
  const send = async (raw: string | URL | Request, init?: RequestInit) => {
    const url = decodeURIComponent(String(raw));
    if (init?.method === "GET") {
      if (url.includes("!A5000:N")) return Response.json({ values: [] });
      if (url.includes("!A2:N2")) return Response.json({ values: [rows[0]] });
      if (writes === 1 && !crashed) {
        crashed = true;
        throw new Error("worker stopped");
      }
      return Response.json({ values: [["header"], ...rows] });
    }
    writes++;
    const req = JSON.parse(String(init?.body)).requests[0];
    if (req.updateCells)
      rows = [
        req.updateCells.rows[0].values.map(
          (c: { userEnteredValue: { stringValue?: string; numberValue?: number } }) =>
            c.userEnteredValue.stringValue ?? c.userEnteredValue.numberValue ?? "",
        ),
      ];
    else
      rows.push(
        req.appendCells.rows[0].values.map(
          (c: { userEnteredValue: { stringValue?: string; numberValue?: number } }) =>
            c.userEnteredValue.stringValue ?? c.userEnteredValue.numberValue ?? "",
        ),
      );
    return Response.json({ spreadsheetId: file, replies: [{}] });
  };
  const initial = {
    ...(await withDigest()),
    saveCheckpoint: async (value: LedgerCheckpoint) => {
      checkpoint = value;
    },
  };
  await expect(writeLedgerSheet(initial, { fetch: send })).rejects.toThrow();
  expect(checkpoint).toBeDefined();
  await expect(writeLedgerSheet({ ...initial, uncertain: true, checkpoint }, { fetch: send })).rejects.toMatchObject({
    affectedOrderIds: [otherId],
  });
  expect(writes).toBe(1);
  expect(rows).not.toContainEqual(oldOther);
});
it("불확실한 전송 뒤 주문 값이 바뀌어도 전송 당시 저장한 값으로 사후 확인한다", async () => {
  const previous = [...input.values, eventId.replaceAll("-", ""), orderId.replaceAll("-", "")];
  const changed = [...input.values];
  changed[1] = "새 주문 정보";
  const checkpoint = await buildLedgerCheckpoint(
    input.hashKey,
    { file, tab: input.tab, eventId, orderId },
    [],
    previous,
  );
  const send = async () => Response.json({ values: [["header"], previous] });
  let verified: string | null = null;
  await expect(
    writeLedgerSheet(
      {
        ...input,
        values: changed,
        uncertain: true,
        checkpoint,
        verifiedDigest: (value) => {
          verified = value;
        },
      },
      { fetch: send },
    ),
  ).resolves.toBeUndefined();
  expect(verified).toBe(checkpoint.sentDigest);
});
it("다른 주문이 덮였으면 충돌 알림에 피해 주문 ID도 담는다", async () => {
  let rows = [prior("ABC123", orderId), prior("XYZ789", otherId)],
    writes = 0;
  const send = async (raw: string | URL | Request, init?: RequestInit) => {
    const url = decodeURIComponent(String(raw));
    if (init?.method === "GET") {
      if (url.includes("!A5000:N")) return Response.json({ values: [] });
      if (url.includes("!A2:N2")) return Response.json({ values: [rows[0]] });
      return Response.json({ values: [["header"], ...rows] });
    }
    writes++;
    const request = JSON.parse(String(init?.body)).requests[0];
    if (request.updateCells)
      rows = [
        request.updateCells.rows[0].values.map(
          (c: { userEnteredValue: { stringValue?: string; numberValue?: number } }) =>
            c.userEnteredValue.stringValue ?? c.userEnteredValue.numberValue ?? "",
        ),
      ];
    else rows.push(prior("XYZ789", otherId));
    return Response.json({ spreadsheetId: file, replies: [{}] });
  };
  let failure: unknown;
  try {
    await writeLedgerSheet(await withDigest(), { fetch: send });
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({ affectedOrderIds: [otherId] });
  expect(writes).toBe(2);
});
it("남겨 둔 옛 기록 ID와 대상 파일에 맞는 서명으로 정상 행을 갱신한다", async () => {
  const previousEvent = crypto.randomUUID().replaceAll("-", ""),
    old = prior("ABC123", orderId);
  old[12] = previousEvent;
  let rows = [old];
  const signature = await ledgerRowDigest(input.hashKey, old);
  const send = async (raw: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "GET")
      return Response.json({
        values: decodeURIComponent(String(raw)).includes("!A2:N2") ? [rows[0]] : [["header"], ...rows],
      });
    rows = [
      JSON.parse(String(init?.body)).requests[0].updateCells.rows[0].values.map(
        (c: { userEnteredValue: { stringValue?: string; numberValue?: number } }) =>
          c.userEnteredValue.stringValue ?? c.userEnteredValue.numberValue ?? "",
      ),
    ];
    return Response.json({ spreadsheetId: file, replies: [{}] });
  };
  await expect(
    writeLedgerSheet(
      { ...input, expectedDigest: "other-target", expectedDigests: { [previousEvent]: signature } },
      { fetch: send },
    ),
  ).resolves.toBeUndefined();
});
it("복구 전 충돌 서명을 남겨 복구 직후 중단해도 영향 주문을 알린다", async () => {
  const original = prior("ABC123", orderId),
    other = prior("XYZ789", otherId);
  let rows = [original, other],
    checkpoint: LedgerCheckpoint | null = null,
    writes = 0;
  const send = async (raw: string | URL | Request, init?: RequestInit) => {
    const url = decodeURIComponent(String(raw));
    if (init?.method === "GET") {
      if (url.includes("!A5000:N")) return Response.json({ values: [] });
      if (url.includes("!A2:N2")) return Response.json({ values: [rows[0]] });
      return Response.json({ values: [["header"], ...rows] });
    }
    writes++;
    const req = JSON.parse(String(init?.body)).requests[0];
    if (req.updateCells)
      rows = [
        req.updateCells.rows[0].values.map(
          (c: { userEnteredValue: { stringValue?: string; numberValue?: number } }) =>
            c.userEnteredValue.stringValue ?? c.userEnteredValue.numberValue ?? "",
        ),
      ];
    else {
      expect(checkpoint?.conflicted).toBe(true);
      rows.push(other);
      throw new Error("worker stopped after restore");
    }
    return Response.json({ spreadsheetId: file, replies: [{}] });
  };
  const initial = {
    ...(await withDigest()),
    saveCheckpoint: async (value: LedgerCheckpoint) => {
      checkpoint = value;
    },
  };
  await expect(writeLedgerSheet(initial, { fetch: send })).rejects.toThrow();
  await expect(writeLedgerSheet({ ...initial, uncertain: true, checkpoint }, { fetch: send })).rejects.toMatchObject({
    affectedOrderIds: [otherId],
  });
  expect(writes).toBe(2);
});
it("시트 격자가 5000행보다 작으면 범위를 벗어난 경계 조회 없이 추가한다", async () => {
  let writes = 0;
  const send = async (raw: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      writes++;
      return Response.json({ spreadsheetId: file, replies: [{}] });
    }
    if (decodeURIComponent(String(raw)).includes("!A5000:")) return new Response(null, { status: 400 });
    return Response.json({
      values: writes
        ? [["header"], [...input.values, eventId.replaceAll("-", ""), orderId.replaceAll("-", "")]]
        : [["header"]],
    });
  };
  await expect(
    writeLedgerSheet({ ...input, setup: { ...input.setup, sheetRowCount: 1000 } }, { fetch: send }),
  ).resolves.toBeUndefined();
  expect(writes).toBe(1);
});
it("다른 파일에 묶인 불확실 비교 기준은 재전송하지 않고 확인 할 일로 넘긴다", async () => {
  const sent = [...input.values, eventId.replaceAll("-", ""), orderId.replaceAll("-", "")];
  const checkpoint = await buildLedgerCheckpoint(
    input.hashKey,
    { file: "another_sheet_1234567890", tab: input.tab, eventId, orderId },
    [],
    sent,
  );
  const send = async () => Response.json({ values: [["header"], sent] });
  await expect(writeLedgerSheet({ ...input, uncertain: true, checkpoint }, { fetch: send })).rejects.toMatchObject({
    name: "LedgerConflictError",
  });
});
it("비교 기준을 저장하는 동안 대상 행이 바뀌면 쓰기 직전에 다시 확인해 멈춘다", async () => {
  const original = prior("ABC123", orderId),
    edited = [...original];
  edited[1] = "사장님이 저장 중 수정";
  let current = original,
    writes = 0;
  const send = async (raw: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      writes++;
      return Response.json({ spreadsheetId: file, replies: [{}] });
    }
    return Response.json({
      values: decodeURIComponent(String(raw)).includes("!A2:N2") ? [current] : [["header"], current],
    });
  };
  await expect(
    writeLedgerSheet(
      {
        ...(await withDigest()),
        saveCheckpoint: async () => {
          current = edited;
        },
      },
      { fetch: send },
    ),
  ).rejects.toThrow();
  expect(writes).toBe(0);
});
it("불확실 쓰기와 대상 중복이 겹쳐도 먼저 다른 주문의 소실을 알린다", async () => {
  const oldTarget = prior("ABC123", orderId),
    other = prior("XYZ789", otherId);
  const sent = [...input.values, eventId.replaceAll("-", ""), orderId.replaceAll("-", "")];
  const checkpoint = await buildLedgerCheckpoint(
    input.hashKey,
    { file, tab: input.tab, eventId, orderId },
    [oldTarget, other],
    sent,
  );
  const send = async () => Response.json({ values: [["header"], sent, sent] });
  await expect(writeLedgerSheet({ ...input, uncertain: true, checkpoint }, { fetch: send })).rejects.toMatchObject({
    name: "LedgerConflictError",
    affectedOrderIds: [otherId],
  });
});
it("ID 없는 옛 행과 중복이 있어도 비교 기준의 다른 피해 주문을 알려 준다", async () => {
  const target = prior("ABC123", orderId),
    other = prior("XYZ789", otherId),
    old = ["OLD123", "옛 행"];
  const sent = [...input.values, eventId.replaceAll("-", ""), orderId.replaceAll("-", "")];
  const checkpoint = await buildLedgerCheckpoint(
    input.hashKey,
    { file, tab: input.tab, eventId, orderId },
    [target, other, old],
    sent,
  );
  const send = async () => Response.json({ values: [["header"], sent, sent, old] });
  await expect(writeLedgerSheet({ ...input, uncertain: true, checkpoint }, { fetch: send })).rejects.toMatchObject({
    name: "LedgerConflictError",
    affectedOrderIds: [otherId],
  });
});
it("읽을 수 없는 비교 기준이라도 이미 남긴 피해 주문은 알려 준다", async () => {
  const sent = [...input.values, eventId.replaceAll("-", ""), orderId.replaceAll("-", "")];
  const checkpoint = await buildLedgerCheckpoint(
    new Secret("old-key"),
    { file, tab: input.tab, eventId, orderId },
    [],
    sent,
  );
  const send = async () => Response.json({ values: [["header"], sent] });
  await expect(
    writeLedgerSheet(
      { ...input, uncertain: true, checkpoint: { ...checkpoint, conflicted: true, affectedOrderIds: [otherId] } },
      { fetch: send },
    ),
  ).rejects.toMatchObject({ name: "LedgerConflictError", affectedOrderIds: [otherId] });
});
