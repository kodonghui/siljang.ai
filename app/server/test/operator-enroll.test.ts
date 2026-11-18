import { afterAll, describe, expect, it } from "vitest";
import { supabaseAuth } from "../src/operator-auth";
import { Secret } from "../src/settings";
import { checkArgs, EnrollError, type EnrollIo, enrollOperator, parseArgs } from "../tools/operator-enroll";
import { collectLogs, describeDb, newUuid, testDb } from "./support/db";
import { SupabaseMock, testPublishableKey } from "./support/supabase-mock";

// 운영자 등록 도구(TASK-021, tools/operator-enroll.ts)를 모의 Supabase와 시험 데이터베이스로 본다(진짜 호출 0번).

const KEY = testPublishableKey();
const NOW = new Date("2026-11-18T03:00:00.000Z");

/** 입력을 차례로 주고 화면에 쓴 줄을 모으는 가짜 터미널. */
function fakeIo(answers: { password: string; codes: string[] }) {
  const printed: string[] = [];
  const asked: string[] = [];
  const codes = [...answers.codes];
  const io: EnrollIo = {
    async ask(q) {
      asked.push(q);
      const next = codes.shift();
      if (next === undefined) throw new Error("no more answers");
      return next;
    },
    async askHidden(q) {
      asked.push(q);
      return answers.password;
    },
    print(line) {
      printed.push(line);
    },
  };
  return { io, printed, asked };
}

function setup() {
  const mock = new SupabaseMock(KEY);
  const auth = supabaseAuth(
    { url: "https://project.supabase.example", publishableKey: new Secret(KEY) },
    { fetch: mock.fetch },
  );
  return { mock, auth };
}

describe("등록 도구의 인자", () => {
  it("이메일은 소문자로, 이름은 1~40자, 명령 인자는 --email·--name 둘", () => {
    expect(checkArgs({ email: " Op@Ops.Example ", displayName: " 운영자 " })).toEqual({
      email: "op@ops.example",
      displayName: "운영자",
    });
    expect(() => checkArgs({ email: "no-at", displayName: "a" })).toThrow(EnrollError);
    expect(() => checkArgs({ email: "a@b.example", displayName: "" })).toThrow(EnrollError);
    expect(() => checkArgs({ email: "a@b.example", displayName: "가".repeat(41) })).toThrow(EnrollError);
    expect(parseArgs(["--email", "a@b.example", "--name", "운영자"])).toEqual({
      email: "a@b.example",
      displayName: "운영자",
    });
    expect(parseArgs(["--email", "a@b.example"])).toBeNull();
    expect(parseArgs(["--email", "a@b.example", "--name", "x", "--password", "y"])).toBeNull();
  });
});

const db = testDb();
afterAll(async () => {
  await db.close();
});

describeDb("운영자 등록 도구(모의 Supabase)", () => {
  it("새 TOTP를 등록하고 운영자 행을 만들어 mfa_enrolled_at을 채움. 비밀 값은 화면 한 번뿐이고 데이터베이스·로그에 없음", async () => {
    const { mock, auth } = setup();
    const email = `enroll-${newUuid()}@ops.example`;
    const password = `pw-${newUuid()}`;
    const user = mock.addUser(email, password, null);
    // 지난번에 끝내지 못한 확인 전 인자 하나.
    user.factors.push({
      id: newUuid(),
      type: "totp",
      status: "unverified",
      friendlyName: "old",
      secret: "OLD",
      code: "1",
    });
    const t = fakeIo({ password, codes: ["975310"] });
    const result = await enrollOperator({ auth, db, now: () => NOW, io: t.io }, { email, displayName: "운영자 등록" });
    expect(result.totp).toBe("new");
    expect(result.disabled).toBe(false);
    expect(user.factors.map((f) => [f.friendlyName, f.status])).toEqual([["siljang-operator", "verified"]]);
    const row = await db.query<{ id: string; email: string; display_name: string; mfa_enrolled_at: Date }>(
      "SELECT id, email, display_name, mfa_enrolled_at FROM operators WHERE lower(email) = $1",
      [email],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]?.id).toBe(result.operatorId);
    expect(row.rows[0]?.display_name).toBe("운영자 등록");
    expect(row.rows[0]?.mfa_enrolled_at.toISOString()).toBe(NOW.toISOString());
    // 비밀 글자는 화면에 한 번, 비밀번호는 어디에도 없음.
    const screen = t.printed.join("\n");
    expect(screen.split("KRSXG5CTMVRXEZLU").length - 1).toBe(2);
    expect(screen).not.toContain(password);
    expect(t.asked[0]).toContain("보이지 않음");
    const stored = JSON.stringify(row.rows);
    for (const s of [password, "KRSXG5CTMVRXEZLU", "975310"]) expect(stored).not.toContain(s);
    expect(mock.liveTokens()).toBe(0);
    // 그 뒤 로그인할 수 있음: 같은 Supabase 사용자로 비밀번호·번호가 맞음.
    const signed = await auth.signInWithPassword(email, password);
    expect(signed?.user.factors?.filter((f) => f.status === "verified")).toHaveLength(1);
  });

  it("이미 확인된 TOTP가 있으면 번호로 확인만 하고 다시 등록하지 않음, 막힌 운영자는 풀지 않음", async () => {
    const { mock, auth } = setup();
    const email = `enroll-${newUuid()}@ops.example`;
    const password = `pw-${newUuid()}`;
    const user = mock.addUser(email, password, "112233");
    const before = new Date("2026-11-01T00:00:00Z");
    await db.query(
      "INSERT INTO operators (email, display_name, mfa_enrolled_at, disabled_at) VALUES ($1, '옛 이름', $2, $2)",
      [email, before],
    );
    const t = fakeIo({ password, codes: ["112233"] });
    const result = await enrollOperator({ auth, db, now: () => NOW, io: t.io }, { email, displayName: "새 이름" });
    expect(result).toMatchObject({ totp: "existing", disabled: true });
    expect(user.factors).toHaveLength(1);
    const row = await db.query<{ display_name: string; mfa_enrolled_at: Date; disabled_at: Date | null }>(
      "SELECT display_name, mfa_enrolled_at, disabled_at FROM operators WHERE lower(email) = $1",
      [email],
    );
    expect(row.rows[0]?.display_name).toBe("새 이름");
    expect(row.rows[0]?.mfa_enrolled_at.toISOString()).toBe(before.toISOString());
    expect(row.rows[0]?.disabled_at).not.toBeNull();
    expect(t.printed.join("\n")).toContain("막혀 있어요");
  });

  it("비밀번호·번호가 틀리면 운영자 행을 만들지 않고, 확인하지 못한 등록은 지움", async () => {
    const { mock, auth } = setup();
    const email = `enroll-${newUuid()}@ops.example`;
    const password = `pw-${newUuid()}`;
    const user = mock.addUser(email, password, null);
    const wrongPw = fakeIo({ password: "wrong", codes: [] });
    await expect(
      enrollOperator({ auth, db, now: () => NOW, io: wrongPw.io }, { email, displayName: "a" }),
    ).rejects.toThrow(EnrollError);
    const wrongCode = fakeIo({ password, codes: ["000000"] });
    await expect(
      enrollOperator({ auth, db, now: () => NOW, io: wrongCode.io }, { email, displayName: "a" }),
    ).rejects.toThrow("번호가 맞지 않아");
    expect(user.factors).toEqual([]);
    const notSix = fakeIo({ password, codes: ["12ab"] });
    await expect(
      enrollOperator({ auth, db, now: () => NOW, io: notSix.io }, { email, displayName: "a" }),
    ).rejects.toThrow("숫자 6자리");
    const rows = await db.query("SELECT 1 FROM operators WHERE lower(email) = $1", [email]);
    expect(rows.rows).toHaveLength(0);
    expect(mock.liveTokens()).toBe(0);
    expect(collectLogs().lines).toEqual([]);
  });
});
