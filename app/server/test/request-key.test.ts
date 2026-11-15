import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { readJsonBody } from "../src/body";
import { recordOpsEvent } from "../src/ops-events";
import { ApiError, ERROR_CODES, ERRORS, fieldError } from "../src/problem";
import { canonicalJson, isStoredError, PROCESSING_SECONDS, requestHash, runCommand } from "../src/request-key";
import { Secret } from "../src/settings";
import {
  collectLogs,
  describeDb,
  newProbe,
  newRequestKey,
  newUuid,
  TEST_HASH_KEY,
  testDb,
  testEnv,
} from "./support/db";

// 요청 키(04 G2, 06 DEC-04, 05 TBL-050)를 시험 명령 하나로 본다. 명령은 운영 기록(ops_events)에 한 행을 넣고,
// 다시 온 요청에는 그 행을 지금 다시 읽어 돌려준다. 행마다 detail.probe로 이 시험의 행만 센다.

/** 명령 처리를 시험이 멈췄다 풀 수 있게 하는 문. */
function gate() {
  let open: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

interface TestBody {
  readonly probe: number;
  readonly count?: number;
  readonly fail?: "conflict" | "validation" | "confirm" | "crash" | "no_content";
}

function commandApp(opts: { hold?: Promise<void>; entered?: () => void; sink?: (l: string) => void } = {}) {
  const app = createApp({ logSink: opts.sink ?? (() => {}) });
  app.post("/test/shops/:shopRef/events", async (c) => {
    const body = (await readJsonBody(c)) as TestBody;
    const actorId = c.req.header("x-test-actor") ?? "";
    return runCommand(c, {
      command: "TEST-001",
      actor: { kind: "owner", id: actorId },
      pathIds: [c.req.param("shopRef")],
      body,
      async execute(tx) {
        if (body.fail === "validation") throw fieldError("/count", "out_of_range");
        if (body.fail === "confirm")
          throw new ApiError("confirmation_required", { confirm: [{ kind: "overbooking" }] });
        const id = await recordOpsEvent(tx, {
          kind: "purge_run",
          count: body.count ?? 1,
          detail: { probe: body.probe },
        });
        opts.entered?.();
        if (opts.hold !== undefined) await opts.hold;
        if (body.fail === "conflict") throw new ApiError("version_conflict");
        if (body.fail === "crash")
          throw new TypeError("insert failed: SELECT secret FROM private_table WHERE phone = '010-1234-5678'");
        if (body.fail === "no_content")
          return { status: 204, code: "deleted", ref: { opsEventId: id }, body: undefined };
        return { status: 201, code: "created", ref: { opsEventId: id }, body: { id, count: body.count ?? 1 } };
      },
      async render(db, stored) {
        if (stored.status === 204) return undefined;
        const r = await db.query<{ id: string; count: number }>("SELECT id, count FROM ops_events WHERE id = $1", [
          stored.ref.opsEventId,
        ]);
        const row = r.rows[0];
        if (row === undefined) throw new ApiError("not_found");
        return { id: row.id, count: row.count };
      },
    });
  });
  return app;
}

function send(
  app: ReturnType<typeof commandApp>,
  key: string | null,
  body: unknown,
  actor: string,
  shopRef = "s1",
  rawBody?: string,
) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-test-actor": actor };
  if (key !== null) headers["Idempotency-Key"] = key;
  return app.request(
    `/api/test/shops/${shopRef}/events`,
    { method: "POST", headers, body: rawBody ?? JSON.stringify(body) },
    testEnv(),
  );
}

describe("요청 키 헤더(데이터베이스 전)", () => {
  const cases: [string | null, string][] = [
    [null, "required"],
    ["", "required"],
    ["a".repeat(15), "too_short"],
    ["a".repeat(65), "too_long"],
    [`${"a".repeat(20)} b`, "bad_format"],
    [`${"a".repeat(20)}/b`, "bad_format"],
  ];
  for (const [key, reason] of cases) {
    it(`${key === null ? "없음" : `${key.length}자`} → 422 ${reason}`, async () => {
      const res = await send(commandApp(), key, { probe: 1 }, newUuid());
      expect(res.status).toBe(422);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.code).toBe("validation_failed");
      expect(body.errors).toEqual([{ field: "header:Idempotency-Key", code: reason }]);
    });
  }

  it("JSON이 아닌 본문은 422 bad_json(/)", async () => {
    const res = await send(commandApp(), newRequestKey(), null, newUuid(), "s1", "{not json");
    expect(res.status).toBe(422);
    expect(((await res.json()) as Record<string, unknown>).errors).toEqual([{ field: "/", code: "bad_json" }]);
  });

  it("REQUEST_HASH_KEY가 없으면 500 internal이고 로그에는 이름만", async () => {
    const { lines, sink } = collectLogs();
    const app = commandApp({ sink });
    const res = await app.request(
      "/api/test/shops/s1/events",
      {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": newRequestKey(), "x-test-actor": newUuid() },
        body: "{}",
      },
      { APP_ENV: "development" },
    );
    expect(res.status).toBe(500);
    expect(lines.join("\n")).toContain('"errorName":"MissingSettingError"');
  });
});

describe("요청 지문", () => {
  const key = new Secret(TEST_HASH_KEY);

  it("본문의 키 차례가 달라도 같은 지문, 값·명령·경로 ID가 다르면 다른 지문(16진수 64자)", async () => {
    const a = await requestHash(key, "API-010", ["o1"], { b: 1, a: { y: [1, 2], x: null } });
    const b = await requestHash(key, "API-010", ["o1"], { a: { x: null, y: [1, 2] }, b: 1 });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(await requestHash(key, "API-010", ["o1"], { b: 2, a: { y: [1, 2], x: null } })).not.toBe(a);
    expect(await requestHash(key, "API-011", ["o1"], { b: 1, a: { y: [1, 2], x: null } })).not.toBe(a);
    expect(await requestHash(key, "API-010", ["o2"], { b: 1, a: { y: [1, 2], x: null } })).not.toBe(a);
    expect(await requestHash(new Secret(`${TEST_HASH_KEY}-other`), "API-010", ["o1"], { b: 1 })).not.toBe(
      await requestHash(key, "API-010", ["o1"], { b: 1 }),
    );
  });

  it("정렬한 JSON은 undefined 속성을 빼고 배열 차례는 그대로", () => {
    expect(canonicalJson({ z: 1, a: undefined, m: [3, 1] })).toBe('{"m":[3,1],"z":1}');
    expect(canonicalJson("한글")).toBe('"한글"');
  });
});

describe("처음 결과로 남기는 오류", () => {
  it("남기는 것은 다시 만들 때 덧붙일 것이 없는 4xx뿐(422·401·405·429·확인 요청·5xx는 남기지 않음)", () => {
    const stored = ERROR_CODES.filter((code) => isStoredError(code));
    for (const code of stored) {
      const status = ERRORS[code].status;
      expect(status >= 400 && status < 500, code).toBe(true);
      expect([401, 405, 422, 429], code).not.toContain(status);
    }
    for (const code of ["validation_failed", "confirmation_required", "method_not_allowed", "internal"] as const) {
      expect(isStoredError(code), code).toBe(false);
    }
    expect(isStoredError("not_found")).toBe(true);
    expect(isStoredError("version_conflict")).toBe(true);
  });
});

describeDb("요청 키로 같은 요청 한 번(데이터베이스)", () => {
  const db = testDb();
  afterAll(() => db.close());

  async function opsCount(probe: number): Promise<number> {
    const r = await db.query<{ n: string }>(
      "SELECT count(*) AS n FROM ops_events WHERE (detail->>'probe')::bigint = $1",
      [probe],
    );
    return Number(r.rows[0]?.n ?? -1);
  }

  async function keyRow(actor: string, key: string) {
    const r = await db.query<Record<string, unknown>>(
      `SELECT state, command, response_status, response_code, response_ref, processing_expires_at, done_at
       FROM request_keys WHERE actor_kind = 'owner' AND actor_id = $1 AND request_key = $2`,
      [actor, key],
    );
    return r.rows[0];
  }

  beforeAll(async () => {
    // 마이그레이션한 데이터베이스인지 먼저 본다.
    const r = await db.query<{ n: string }>("SELECT count(*) AS n FROM pg_tables WHERE tablename = 'request_keys'");
    expect(r.rows[0]?.n).toBe("1");
  });

  it("처음 요청은 처리하고 끝남(상태 코드·결과 종류·가리킨 ID)을 남긴다. 처음 본문은 남기지 않는다", async () => {
    const [actor, key, probe] = [newUuid(), newRequestKey(), newProbe()];
    const res = await send(commandApp(), key, { probe, count: 5 }, actor);
    expect(res.status).toBe(201);
    expect(res.headers.get("Idempotency-Replayed")).toBeNull();
    const body = (await res.json()) as { id: string; count: number };
    expect(body.count).toBe(5);
    const row = await keyRow(actor, key);
    expect(row).toMatchObject({ state: "done", command: "TEST-001", response_status: 201, response_code: "created" });
    expect(row?.response_ref).toEqual({ opsEventId: body.id });
    expect(row?.processing_expires_at).toBeNull();
    expect(row?.done_at).toBeInstanceOf(Date);
    expect(await opsCount(probe)).toBe(1);
  });

  it("같은 키·같은 본문은 처음 상태 코드로, 그 기록을 지금 다시 읽은 본문과 Idempotency-Replayed: true. 두 번 남지 않음", async () => {
    const [actor, key, probe] = [newUuid(), newRequestKey(), newProbe()];
    const app = commandApp();
    const first = (await (await send(app, key, { probe, count: 5 }, actor)).json()) as { id: string };
    await db.query("UPDATE ops_events SET count = 7 WHERE id = $1", [first.id]);
    // 본문의 키 차례가 달라도 같은 요청
    const again = await app.request(
      "/api/test/shops/s1/events",
      {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": key, "x-test-actor": actor },
        body: `{"count":5,"probe":${probe}}`,
      },
      testEnv(),
    );
    expect(again.status).toBe(201);
    expect(again.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await again.json()).toEqual({ id: first.id, count: 7 });
    expect(await opsCount(probe)).toBe(1);
  });

  it("204 결과도 다시 오면 204와 Idempotency-Replayed", async () => {
    const [actor, key, probe] = [newUuid(), newRequestKey(), newProbe()];
    const app = commandApp();
    expect((await send(app, key, { probe, fail: "no_content" }, actor)).status).toBe(204);
    const again = await send(app, key, { probe, fail: "no_content" }, actor);
    expect(again.status).toBe(204);
    expect(again.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await again.text()).toBe("");
    expect(await opsCount(probe)).toBe(1);
  });

  it("같은 키에 다른 본문이나 다른 경로 ID는 422 idempotency_key_reused이고 처음 결과는 그대로", async () => {
    const [actor, key, probe] = [newUuid(), newRequestKey(), newProbe()];
    const app = commandApp();
    expect((await send(app, key, { probe, count: 1 }, actor)).status).toBe(201);
    const other = await send(app, key, { probe, count: 2 }, actor);
    expect(other.status).toBe(422);
    expect(((await other.json()) as Record<string, unknown>).code).toBe("idempotency_key_reused");
    const otherPath = await send(app, key, { probe, count: 1 }, actor, "s2");
    expect(otherPath.status).toBe(422);
    expect(await opsCount(probe)).toBe(1);
    expect((await keyRow(actor, key))?.response_status).toBe(201);
  });

  it("누른 사람이 다르면 같은 키도 따로 처리한다", async () => {
    const [key, probe] = [newRequestKey(), newProbe()];
    const app = commandApp();
    expect((await send(app, key, { probe }, newUuid())).status).toBe(201);
    expect((await send(app, key, { probe }, newUuid())).status).toBe(201);
    expect(await opsCount(probe)).toBe(2);
  });

  it("처리 중에 같은 키가 오면 409 request_in_progress이고, 끝난 뒤에는 처음 결과를 돌려준다", async () => {
    const [actor, key, probe] = [newUuid(), newRequestKey(), newProbe()];
    const hold = gate();
    const entered = gate();
    const slow = commandApp({ hold: hold.promise, entered: entered.open });
    const firstRes = send(slow, key, { probe }, actor);
    await entered.promise;
    const during = await send(commandApp(), key, { probe }, actor);
    expect(during.status).toBe(409);
    expect(((await during.json()) as Record<string, unknown>).code).toBe("request_in_progress");
    expect((await keyRow(actor, key))?.state).toBe("processing");
    hold.open();
    expect((await firstRes).status).toBe(201);
    const after = await send(commandApp(), key, { probe }, actor);
    expect(after.status).toBe(201);
    expect(after.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await opsCount(probe)).toBe(1);
  });

  it("같은 키가 동시에 여러 번 와도 한 번만 처리한다", async () => {
    const [actor, key, probe] = [newUuid(), newRequestKey(), newProbe()];
    const app = commandApp();
    const results = await Promise.all(Array.from({ length: 6 }, () => send(app, key, { probe }, actor)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201).length).toBeGreaterThanOrEqual(1);
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
    const fresh = results.filter((r) => r.status === 201 && r.headers.get("Idempotency-Replayed") === null);
    expect(fresh).toHaveLength(1);
    expect(await opsCount(probe)).toBe(1);
  });

  it(`처리하던 요청이 ${PROCESSING_SECONDS}초 기한을 넘기면 다음 요청이 이어받고, 늦게 끝난 앞 요청은 되돌려 409`, async () => {
    const [actor, key, probe] = [newUuid(), newRequestKey(), newProbe()];
    const hold = gate();
    const entered = gate();
    const stuck = send(commandApp({ hold: hold.promise, entered: entered.open }), key, { probe }, actor);
    await entered.promise;
    // 처리하던 서버가 멈춘 것처럼 기한을 지난 시각으로 돌린다.
    await db.query(
      `UPDATE request_keys SET processing_expires_at = clock_timestamp() - interval '1 second'
       WHERE actor_kind = 'owner' AND actor_id = $1 AND request_key = $2`,
      [actor, key],
    );
    const takeover = await send(commandApp(), key, { probe }, actor);
    expect(takeover.status).toBe(201);
    expect(takeover.headers.get("Idempotency-Replayed")).toBeNull();
    hold.open();
    const late = await stuck;
    expect(late.status).toBe(409);
    expect(((await late.json()) as Record<string, unknown>).code).toBe("request_in_progress");
    expect(await opsCount(probe)).toBe(1);
    expect((await keyRow(actor, key))?.state).toBe("done");
  });

  it("기한이 지난 처리 중 행(서버가 멈춤)은 같은 지문만 이어받고, 다른 지문은 422", async () => {
    const [actor, key, probe] = [newUuid(), newRequestKey(), newProbe()];
    const body = { probe };
    const hash = await requestHash(new Secret(TEST_HASH_KEY), "TEST-001", ["s1"], body);
    await db.query(
      `INSERT INTO request_keys (actor_kind, actor_id, request_key, command, request_hash, state, processing_expires_at)
       VALUES ('owner', $1, $2, 'TEST-001', $3, 'processing', clock_timestamp() - interval '1 second')`,
      [actor, key, hash],
    );
    const other = await send(commandApp(), key, { probe, count: 9 }, actor);
    expect(other.status).toBe(422);
    expect(((await other.json()) as Record<string, unknown>).code).toBe("idempotency_key_reused");
    expect((await keyRow(actor, key))?.state).toBe("processing");
    const same = await send(commandApp(), key, body, actor);
    expect(same.status).toBe(201);
    expect(same.headers.get("Idempotency-Replayed")).toBeNull();
    expect((await keyRow(actor, key))?.state).toBe("done");
    expect(await opsCount(probe)).toBe(1);
  });

  it("기한 안의 처리 중 행은 같은 지문이어도 이어받지 않는다(409)", async () => {
    const [actor, key, probe] = [newUuid(), newRequestKey(), newProbe()];
    const hash = await requestHash(new Secret(TEST_HASH_KEY), "TEST-001", ["s1"], { probe });
    await db.query(
      `INSERT INTO request_keys (actor_kind, actor_id, request_key, command, request_hash, state, processing_expires_at)
       VALUES ('owner', $1, $2, 'TEST-001', $3, 'processing', clock_timestamp() + interval '30 seconds')`,
      [actor, key, hash],
    );
    const res = await send(commandApp(), key, { probe }, actor);
    expect(res.status).toBe(409);
    expect(await opsCount(probe)).toBe(0);
  });

  it("명령 안의 입력 검사 실패(422)는 남기지 않아 같은 키로 다시 보낼 수 있다", async () => {
    const [actor, key, probe] = [newUuid(), newRequestKey(), newProbe()];
    const app = commandApp();
    const bad = await send(app, key, { probe, fail: "validation" }, actor);
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as Record<string, unknown>).errors).toEqual([{ field: "/count", code: "out_of_range" }]);
    expect(await keyRow(actor, key)).toBeUndefined();
    expect((await send(app, key, { probe }, actor)).status).toBe(201);
    expect(await opsCount(probe)).toBe(1);
  });

  it("확인 요청(409 confirmation_required)은 남기지 않고, 다시 보내면 confirm 목록을 다시 받는다", async () => {
    const [actor, key, probe] = [newUuid(), newRequestKey(), newProbe()];
    const app = commandApp();
    for (let i = 0; i < 2; i += 1) {
      const res = await send(app, key, { probe, fail: "confirm" }, actor);
      expect(res.status).toBe(409);
      expect(res.headers.get("Idempotency-Replayed")).toBeNull();
      expect(((await res.json()) as Record<string, unknown>).confirm).toEqual([{ kind: "overbooking" }]);
    }
    expect(await keyRow(actor, key)).toBeUndefined();
  });

  it("서버 오류(5xx)는 명령의 쓰기를 되돌리고 키를 남기지 않으며, 오류 내용은 응답·로그에 없다", async () => {
    const [actor, key, probe] = [newUuid(), newRequestKey(), newProbe()];
    const { lines, sink } = collectLogs();
    const res = await send(commandApp({ sink }), key, { probe, fail: "crash" }, actor);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ code: "internal", status: 500 });
    for (const s of [text, lines.join("\n")]) {
      expect(s).not.toContain("010-1234-5678");
      expect(s).not.toContain("private_table");
      expect(s).not.toContain("SELECT");
    }
    expect(lines.join("\n")).toContain('"errorName":"TypeError"');
    expect(await opsCount(probe)).toBe(0);
    expect(await keyRow(actor, key)).toBeUndefined();
  });

  it("남기는 오류(409 version_conflict)는 끝남으로 남기고, 다시 오면 같은 409와 Idempotency-Replayed", async () => {
    const [actor, key, probe] = [newUuid(), newRequestKey(), newProbe()];
    const app = commandApp();
    const first = await send(app, key, { probe, fail: "conflict" }, actor);
    expect(first.status).toBe(409);
    expect(((await first.json()) as Record<string, unknown>).code).toBe("version_conflict");
    expect(await opsCount(probe)).toBe(0);
    expect(await keyRow(actor, key)).toMatchObject({
      state: "done",
      response_status: 409,
      response_code: "version_conflict",
    });
    const again = await send(app, key, { probe, fail: "conflict" }, actor);
    expect(again.status).toBe(409);
    expect(again.headers.get("Idempotency-Replayed")).toBe("true");
    expect(again.headers.get("content-type")).toBe("application/problem+json");
    expect(((await again.json()) as Record<string, unknown>).code).toBe("version_conflict");
  });
});
