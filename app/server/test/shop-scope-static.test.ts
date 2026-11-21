import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIND_SHAPE, LAST_RUN_SHAPE } from "../src/due-sources";
import { namesShopTable, SHOP_TABLES, SHOP_TABLES_WITHOUT_ID, scopeViolations } from "../src/sql-scope";
import { EXPR, serverSources, stringLiterals } from "./support/source-scan";

// 가게 범위 밖 SQL을 서버 코드에서 찾는 정적 검사(TASK-019; 05 A9·E1). CI의 시험 단계에서 돈다.
// 가게 테이블 목록(sql-scope.ts의 SHOP_TABLES)은 손으로 적었고, 여기서 05(db/schema.sql)와 같은지 본다.

const schema = readFileSync(new URL("../../../db/schema.sql", import.meta.url), "utf8");
const tables = [...schema.matchAll(/^CREATE TABLE (\w+) \(\n([\s\S]*?)^\);/gm)].map((m) => ({
  name: m[1] as string,
  body: m[2] as string,
}));
const sources = serverSources(new URL("../src/", import.meta.url));

/**
 * 날 데이터베이스 연결(가게 조건을 보지 않는 Queryable·RequestDb)을 쥐는 표시. 이 표시가 있는 파일에는 가게 테이블 SQL이
 * 없어야 한다(가게 테이블은 가게 범위 연결 ShopDb로만). 표시: 맥락의 db 꺼내기, db.ts의 날 연결 형식·연결기 가져오기,
 * 요청 키 명령의 날 실행기(runCommand, 가게 범위 경로는 ShopRequest.command를 씀).
 */
const RAW_ACCESS = [
  /\bget\(\s*["']db["']\s*\)/,
  /\.var\.db\b/,
  /import[^;]*\b(Queryable|RequestDb|DbConnector|pgConnector)\b[^;]*from\s+["']\.{1,2}\/(?:[\w-]+\/)*db["']/,
  /\brunCommand\b/,
];

/**
 * 날 연결로 가게 테이블을 쓰는 것을 허락한 파일과 까닭. 가게 범위가 정해지기 전에 가게를 찾는 해석기(TASK-020 세션,
 * TASK-028 채널, TASK-021·159 운영자, TASK-044·045 예약 링크), 가게 등록(TASK-032), 여러 가게를 도는 서버 작업(TASK-023)이
 * 생기면 까닭을 적어 더한다.
 */
const RAW_SHOP_SQL_ALLOWED: Record<string, string> = {
  "owner-session.ts": "세션의 사장님 ID로 가게 요약 하나만 조회. allowedCrossShop이 정확한 SQL을 별도로 제한함",
  "ops-events.ts":
    "운영 기록(TBL-051)은 가게와 무관한 것(shop_id 빈 값)도 남겨 가게 범위 밖에서 쓴다. 쓰기만 하고 내용 없이 건수만",
};

/** 가게 범위를 만들 수 있는 파일(해석기)과 까닭. 해석기를 만드는 작업이 더한다. */
const SCOPE_MAKERS: Record<string, string> = {
  "shop-scope.ts": "정의",
  "owner-login.ts": "살아 있는 사장님 세션과 그 계정의 가게만으로 범위를 만듦(TASK-020)",
  "kakao-skill-auth.ts": "정규 봇 ID로 찾은 연결의 스킬 키를 확인한 뒤 그 가게 범위만 만듦(06 DEC-08)",
  "kakao-callback-queue.ts": "내부 큐의 가게·메시지 ID로 한 수신 행을 처리하는 작업 범위만 만듦",
  "job-runner.ts":
    "서버 안의 일 실행기(TASK-023): 때가 된 행의 가게 ID로 그 행 하나를 잡고 처리하는 범위(출처 job)만 만든다. 가게 ID는 due-sources.ts의 찾기 결과",
};

/**
 * 가게 범위 밖의 읽기(여러 가게에서 때가 된 행 찾기, TASK-023)를 둘 수 있는 파일과 그 꼴. 꼴은 이 시험이 따로 적어
 * (src의 FIND_SHAPE·LAST_RUN_SHAPE와 같은지 봄) src를 고쳐 넓히지 못하게 한다. 찾기는 가게 ID·행 ID·때만 돌려주고,
 * 행의 내용은 그 가게 범위 연결(ShopDb)로만 읽는다. 이 파일은 날 연결을 쥐지 않는다(SQL 글만).
 */
const CROSS_SHOP_FILE = "due-sources.ts";
const CROSS_SHOP_SHAPES: readonly RegExp[] = [
  /^SELECT t\.shop_id, t\.id, t\.([a-z_]+) AS due_at FROM ([a-z_]+) t WHERE (.+) AND t\.\1 <= \$1 ORDER BY t\.\1, t\.id LIMIT \$2$/,
  /^SELECT max\(t\.created_at\) AS last_at FROM ops_events t WHERE t\.kind = \$1 AND t\.shop_id IS NULL AND t\.created_at >= \$2 AND t\.created_at < \$3$/,
];

/** 가게 범위 밖 읽기로 허락한 SQL인지(그 파일의 그 꼴만). 꼴 안의 조건에 다른 테이블을 끌어오는 하위 질의는 받지 않는다. */
function allowedCrossShop(file: string, sql: string): boolean {
  if (file === "owner-session.ts") {
    return (
      sql.replace(/\s+/g, " ").trim() === "SELECT id, name, license_status, time_zone FROM shops WHERE owner_id = $1"
    );
  }
  if (file === "kakao-skill-auth.ts") {
    return (
      sql.replace(/\s+/g, " ").trim() ===
      "SELECT id, shop_id, status, skill_key_version, previous_key_until FROM kakao_channels WHERE bot_id = $1 AND status IN ('pending', 'linked')"
    );
  }
  if (file !== CROSS_SHOP_FILE) return false;
  if (!CROSS_SHOP_SHAPES.some((re) => re.test(sql))) return false;
  return (sql.match(/\b(from|join)\b/gi) ?? []).length === 1 && !sql.includes(EXPR.trim());
}

/** 가게 범위를 만드는 표시: createShopScope를 부르거나 가져오거나 이름 글자로 꺼냄(주석·오류 글의 언급은 치지 않음). */
const MAKES_SCOPE = /\bcreateShopScope\s*\(|import[^;]*\bcreateShopScope\b|["'`]createShopScope["'`]/;

/**
 * 사장님 범위(가게가 정해지기 전에도 여는 경로의 사장님, TASK-022)를 만들 수 있는 파일과 까닭. 사장님 세션 해석기
 * (TASK-020)가 더한다.
 */
const OWNER_SCOPE_MAKERS: Record<string, string> = {
  "owner-scope.ts": "정의",
  "owner-login.ts": "쿠키의 세션에서 찾은 사장님과 가게 요약만 담음(TASK-020)",
};

/** 사장님 범위를 만드는 표시(MAKES_SCOPE와 같은 꼴). */
const MAKES_OWNER_SCOPE = /\bcreateOwnerScope\s*\(|import[^;]*\bcreateOwnerScope\b|["'`]createOwnerScope["'`]/;

/** 운영자 범위(로그인한 운영자, TASK-021)를 만들 수 있는 파일과 까닭. */
const OPERATOR_SCOPE_MAKERS: Record<string, string> = {
  "operator-scope.ts": "정의",
  "operator-login.ts":
    "운영자 세션 해석기(resolveOperatorSession): 쿠키의 살아 있는 세션과 막히지 않은 운영자에서만 만든다",
};

/** 운영자 범위를 만드는 표시(MAKES_SCOPE와 같은 꼴). */
const MAKES_OPERATOR_SCOPE =
  /\bcreateOperatorScope\s*\(|import[^;]*\bcreateOperatorScope\b|["'`]createOperatorScope["'`]/;

/** SQL 테이블 이름 자리에 값을 끼워 넣어도 되는 파일(테이블 이름이 SHOP_TABLES 형식으로만 들어옴). */
const TABLE_INTERPOLATION_ALLOWED = new Set(["shop-scope.ts"]);

const SQL_START = /^\s*(select|insert|update|delete|with)\b/i;

/** 서버 코드의 글자 값 가운데 가게 테이블을 이름으로 드는 SQL. */
function shopSql(text: string): string[] {
  return stringLiterals(text).filter((lit) => SQL_START.test(lit) && namesShopTable(lit.replaceAll(EXPR, " x ")));
}

describe("05와 같은 가게 테이블 목록", () => {
  it("shop_id 열을 가진 테이블이 SHOP_TABLES와 같음(05 E1)", () => {
    expect(tables.length).toBe(61);
    const withShopId = tables.filter((t) => /^\s+shop_id\s/m.test(t.body)).map((t) => t.name);
    expect([...SHOP_TABLES].sort()).toEqual(withShopId.sort());
  });

  it("id(uuid) 기본 키가 없는 가게 테이블이 SHOP_TABLES_WITHOUT_ID와 같음", () => {
    const without = tables
      .filter((t) => (SHOP_TABLES as readonly string[]).includes(t.name))
      .filter((t) => !/^\s+id\s+uuid\s+PRIMARY KEY/m.test(t.body))
      .map((t) => t.name);
    expect([...SHOP_TABLES_WITHOUT_ID].sort()).toEqual(without.sort());
  });

  it("가게 테이블과 이름이 같은 열이 없음(검사가 테이블 이름의 자리를 가리는 바탕)", () => {
    const names = new Set<string>([...SHOP_TABLES, "shops"]);
    for (const t of tables) {
      const columns = [...t.body.matchAll(/^ {2}([a-z_][a-z0-9_]*)\s/gm)].map((m) => m[1] as string);
      for (const c of columns) expect(names.has(c), `${t.name}.${c}`).toBe(false);
    }
  });
});

describe("서버 코드의 SQL(정적 검사)", () => {
  it("서버 코드를 읽음(파일과 SQL이 있음)", () => {
    expect(sources.map((s) => s.name)).toEqual(expect.arrayContaining(["app.ts", "shop-scope.ts", "request-key.ts"]));
    expect(sources.flatMap((s) => shopSql(s.text)).length).toBeGreaterThan(0);
  });

  it("가게 테이블을 드는 SQL은 모두 가게 조건을 지킴(가게 테이블마다 shop_id = $1)", () => {
    const found: string[] = [];
    for (const s of sources) {
      for (const sql of shopSql(s.text)) {
        if (allowedCrossShop(s.name, sql)) continue;
        const violations = scopeViolations(sql.replaceAll(EXPR, " x "));
        if (violations.length > 0) found.push(`${s.name}: ${violations.join(", ")}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("날 연결을 쥔 파일에는 가게 테이블 SQL이 없음(허락한 파일과 까닭 말고)", () => {
    const found: string[] = [];
    for (const s of sources) {
      if (!RAW_ACCESS.some((re) => re.test(s.text))) continue;
      if (Object.hasOwn(RAW_SHOP_SQL_ALLOWED, s.name)) continue;
      if (shopSql(s.text).some((sql) => !allowedCrossShop(s.name, sql))) found.push(s.name);
    }
    expect(found).toEqual([]);
    for (const [name, why] of Object.entries(RAW_SHOP_SQL_ALLOWED)) {
      expect(
        sources.some((s) => s.name === name),
        name,
      ).toBe(true);
      expect(why.length).toBeGreaterThan(10);
    }
  });

  it("가게 범위 밖 찾기는 due-sources.ts의 정한 꼴뿐이고, 그 파일은 날 연결을 쥐지 않음(TASK-023)", () => {
    expect(CROSS_SHOP_SHAPES.map((re) => re.source)).toEqual([FIND_SHAPE.source, LAST_RUN_SHAPE.source]);
    const file = sources.find((s) => s.name === CROSS_SHOP_FILE);
    expect(file).toBeDefined();
    const text = (file as { text: string }).text;
    expect(RAW_ACCESS.some((re) => re.test(text))).toBe(false);
    expect(text).not.toMatch(/from\s+["']\.\/db["']/);
    const unscoped = shopSql(text).filter((sql) => scopeViolations(sql.replaceAll(EXPR, " x ")).length > 0);
    expect(unscoped.length).toBeGreaterThan(0);
    for (const sql of unscoped) expect(allowedCrossShop(CROSS_SHOP_FILE, sql), sql).toBe(true);
    // 꼴을 벗어난 것은 받지 않음: 다른 열을 돌려주기, 테이블 잇기, 다른 파일.
    const find =
      "SELECT t.shop_id, t.id, t.due_at AS due_at FROM payment_requests t WHERE t.status = 'open' AND t.due_at <= $1 ORDER BY t.due_at, t.id LIMIT $2";
    expect(allowedCrossShop(CROSS_SHOP_FILE, find)).toBe(true);
    expect(allowedCrossShop("job-runner.ts", find)).toBe(false);
    expect(allowedCrossShop(CROSS_SHOP_FILE, find.replace("t.shop_id, t.id,", "t.shop_id, t.id, t.amount,"))).toBe(
      false,
    );
    expect(
      allowedCrossShop(
        CROSS_SHOP_FILE,
        find.replace("WHERE t.status", "WHERE t.id IN (SELECT o.id FROM orders o) AND t.status"),
      ),
    ).toBe(false);
  });

  it("SQL의 테이블 이름 자리에 값을 끼워 넣지 않음(정적 검사가 테이블을 볼 수 있게)", () => {
    const found: string[] = [];
    for (const s of sources) {
      if (TABLE_INTERPOLATION_ALLOWED.has(s.name)) continue;
      for (const lit of stringLiterals(s.text)) {
        if (/\b(from|join|into|update|using|table)\s+__expr__/i.test(lit)) found.push(s.name);
      }
    }
    expect(found).toEqual([]);
  });

  it("가게 범위는 정한 파일(해석기)만 만듦", () => {
    const found = sources
      .filter((s) => MAKES_SCOPE.test(s.text) && !Object.hasOwn(SCOPE_MAKERS, s.name))
      .map((s) => s.name);
    expect(found).toEqual([]);
    const casts = sources.filter((s) => /\bas\s+ShopScope\b/.test(s.text)).map((s) => s.name);
    expect(casts).toEqual([]);
    expect(MAKES_SCOPE.test("const s = createShopScope (id, via);")).toBe(true);
    expect(MAKES_SCOPE.test('import { createShopScope as make } from "./shop-scope";')).toBe(true);
    expect(MAKES_SCOPE.test('const make = m["createShopScope"];')).toBe(true);
    expect(MAKES_SCOPE.test("/** createShopScope로 만든 것만 받는다. */")).toBe(false);
  });

  it("사장님 범위도 정한 파일(해석기)만 만듦(TASK-022)", () => {
    const found = sources
      .filter((s) => MAKES_OWNER_SCOPE.test(s.text) && !Object.hasOwn(OWNER_SCOPE_MAKERS, s.name))
      .map((s) => s.name);
    expect(found).toEqual([]);
    const casts = sources.filter((s) => /\bas\s+OwnerScope\b/.test(s.text)).map((s) => s.name);
    expect(casts).toEqual([]);
    for (const name of Object.keys(OWNER_SCOPE_MAKERS)) {
      expect(
        sources.some((s) => s.name === name && MAKES_OWNER_SCOPE.test(s.text)),
        name,
      ).toBe(true);
    }
    expect(MAKES_OWNER_SCOPE.test("const o = createOwnerScope(id);")).toBe(true);
    expect(MAKES_OWNER_SCOPE.test("/** createOwnerScope로 만든 것만 받는다. */")).toBe(false);
  });

  it("운영자 범위도 정한 파일(정의와 운영자 세션 해석기)만 만듦(TASK-021)", () => {
    const found = sources
      .filter((s) => MAKES_OPERATOR_SCOPE.test(s.text) && !Object.hasOwn(OPERATOR_SCOPE_MAKERS, s.name))
      .map((s) => s.name);
    expect(found).toEqual([]);
    const casts = sources.filter((s) => /\bas\s+OperatorScope\b/.test(s.text)).map((s) => s.name);
    expect(casts).toEqual([]);
    for (const name of Object.keys(OPERATOR_SCOPE_MAKERS)) {
      expect(
        sources.some((s) => s.name === name && MAKES_OPERATOR_SCOPE.test(s.text)),
        name,
      ).toBe(true);
    }
    expect(MAKES_OPERATOR_SCOPE.test("return createOperatorScope(id, name);")).toBe(true);
    expect(MAKES_OPERATOR_SCOPE.test("/** createOperatorScope로만 만들고 */")).toBe(false);
  });
});

describe("정적 검사의 글자 값 읽개", () => {
  it("주석·정규식을 건너뛰고 템플릿의 끼운 값을 바꿈", () => {
    const src = `const a = "x\\"y"; // "주석 글"
const r = /["'\`]/g; const half = 4 / 2 / 1;
/* 'block' */ const t = \`SELECT \${f(\`in \${'z'}\`)} FROM orders\`;
const u = text.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');`;
    const lits = stringLiterals(src);
    expect(lits).toEqual(expect.arrayContaining(['x\\"y', `SELECT ${EXPR} FROM orders`, `in ${EXPR}`, "z", "\\\\$&"]));
    expect(lits).not.toContain("주석 글");
    expect(lits).not.toContain("block");
    expect(lits.length).toBe(5);
  });

  it("어긴 SQL을 담은 파일을 잡음", () => {
    const bad = 'export const q = (db) => db.query("SELECT o.id FROM orders o WHERE o.id = $1", [id]);';
    const sqls = shopSql(bad);
    expect(sqls).toHaveLength(1);
    expect(scopeViolations(sqls[0] as string)).toContain("unscoped orders o");
  });
});
