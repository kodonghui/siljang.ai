import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DUE_SOURCES, FIND_SHAPE, LAST_RUN_SHAPE } from "../src/due-sources";
import { isPurgeFindSql, PURGE_SOURCES } from "../src/purge-sources";
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
  "public-shop.ts": "공개 예약 주소로 발급된 가게 ID 하나만 찾는 정확한 SQL(TASK-044)",
  "operator-alert-directory.ts": "실제 운영자 알림 세 종류의 ID/가게 요약/건수/시각만 읽는 정확한 한 SQL(TASK-035)",
  "operator-shop-directory.ts":
    "인증된 운영자의 등록/사업자 변경 목록과 중복 표시 세 읽기만 허용. 정확한 SQL과 반환 열을 별도로 제한함(TASK-034·036)",
  "operator-shop.ts":
    "실제 운영자 세션 인증 뒤 가게/변경 요청에서 가게 ID 하나만 찾음. 정확한 두 SQL만 허용(TASK-034·036)",
  "owner-shop-db.ts": "등록 전 사장님 소유 가게의 ID 조회와 등록만 허용. 정확한 두 SQL을 별도로 제한함(TASK-032)",
  "owner-session.ts": "세션의 사장님 ID로 가게 요약 하나만 조회. allowedCrossShop이 정확한 SQL을 별도로 제한함",
  "ops-events.ts":
    "운영 기록(TBL-051)은 가게와 무관한 것(shop_id 빈 값)도 남겨 가게 범위 밖에서 쓴다. 쓰기만 하고 내용 없이 건수만",
};

/** 가게 범위를 만들 수 있는 파일(해석기)과 까닭. 해석기를 만드는 작업이 더한다. */
const SCOPE_MAKERS: Record<string, string> = {
  "public-shop.ts": "공개 예약 주소의 발급된 가게에 읽기 범위만 만듦(TASK-044)",
  "operator-shop.ts": "실제 운영자 세션을 확인하고 경로에서 찾은 가게 하나만 여는 해석기(TASK-034)",
  "owner-shop-db.ts": "인증된 사장님 소유 확인 또는 자기 계정의 새 등록 뒤 가게 범위를 만듦(TASK-032)",
  "shop-scope.ts": "정의",
  "owner-login.ts": "살아 있는 사장님 세션과 그 계정의 가게만으로 범위를 만듦(TASK-020)",
  "kakao-skill-auth.ts": "정규 봇 ID로 찾은 연결의 스킬 키를 확인한 뒤 그 가게 범위만 만듦(06 DEC-08)",
  "kakao-callback-queue.ts": "내부 큐 또는 만료 찾기의 가게·메시지 ID로 한 수신 행을 처리하는 작업 범위만 만듦",
  "job-runner.ts":
    "서버 안의 일 실행기(TASK-023): 때가 된 행의 가게 ID로 그 행 하나를 잡고 처리하는 범위(출처 job)만 만든다. 가게 ID는 due-sources.ts의 찾기 결과",
  "purge-runner.ts":
    "TASK-158: purge-sources.ts에서 찾은 가게·행 ID의 보관 처리 범위만 만든다. 내용은 가게 범위의 짧은 트랜잭션에서 읽고 쓴다",
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

const OPERATOR_DIRECTORY_SQL = [
  "SELECT i.*,i.xmin::text AS identity_version,s.name AS shop_name,s.license_status,s.time_zone, s.business_name AS current_business_name,s.representative_name AS current_representative_name,s.business_reg_no AS current_business_reg_no, p.id AS account_id,p.xmin::text AS account_version,p.bank_name,p.holder_name,p.account_last4,o.display_name AS reviewer_name, to_char(i.requested_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS cursor_at FROM shop_identity_changes i JOIN shops s ON s.id=i.shop_id LEFT JOIN payment_accounts p ON p.shop_id=i.shop_id AND p.retired_at IS NULL LEFT JOIN operators o ON o.id=i.reviewed_by WHERE i.status=$1 AND ($2::timestamptz IS NULL OR (i.requested_at,i.id)>($2::timestamptz,$3::uuid)) ORDER BY i.requested_at,i.id LIMIT $4",
  "SELECT s.id,s.name,s.business_name,s.representative_name,s.business_reg_no,s.food_license_no,s.food_business_type,s.license_status,s.created_at,s.time_zone, to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS cursor_at, EXISTS(SELECT 1 FROM shops d WHERE d.business_reg_no=s.business_reg_no AND d.id<>s.id) AS duplicate, concat(s.id,':',s.xmin::text,':',coalesce((SELECT concat(p.id,':',p.xmin::text) FROM payment_accounts p WHERE p.shop_id=s.id AND p.retired_at IS NULL),'-'),':',coalesce((SELECT concat(i.id,':',i.xmin::text) FROM shop_identity_changes i WHERE i.shop_id=s.id AND i.status='pending'),'-')) AS revision_state, concat(s.license_reviewed_by,':',extract(epoch FROM s.license_reviewed_at)) AS review_marker FROM shops s WHERE s.license_status=$1 AND ($2::timestamptz IS NULL OR (s.created_at,s.id)>($2::timestamptz,$3::uuid)) ORDER BY s.created_at,s.id LIMIT $4",
  'SELECT d.id AS "shopId",d.name,d.license_status AS "licenseStatus" FROM shops d JOIN shops s ON s.business_reg_no=d.business_reg_no WHERE s.id=$1 AND d.id<>s.id ORDER BY d.created_at,d.id LIMIT 20',
];

/** 가게 범위 밖 읽기로 허락한 SQL인지(그 파일의 그 꼴만). 꼴 안의 조건에 다른 테이블을 끌어오는 하위 질의는 받지 않는다. */
function allowedCrossShop(file: string, sql: string): boolean {
  if (file === "public-shop.ts")
    return (
      sql.replace(/\s+/g, " ").trim() === "SELECT id FROM shops WHERE booking_slug=$1 AND booking_issued_at IS NOT NULL"
    );
  if (file === "operator-alert-directory.ts")
    return (
      sql.replace(/\s+/g, " ").trim() ===
      "SELECT e.id,e.kind,e.count,e.created_at,s.id AS shop_id,s.name AS shop_name,s.time_zone, to_char(e.created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS cursor_at FROM ops_events e LEFT JOIN shops s ON s.id=e.shop_id WHERE e.kind IN ('channel_already_linked','privacy_transfer_missing','ai_failure_burst') AND ($1::timestamptz IS NULL OR e.created_at<$1::timestamptz OR (e.created_at=$1::timestamptz AND e.id>$2::uuid)) ORDER BY e.created_at DESC,e.id ASC LIMIT $3"
    );
  if (file === "operator-shop-directory.ts") return OPERATOR_DIRECTORY_SQL.includes(sql.replace(/\s+/g, " ").trim());
  if (file === "operator-shop.ts")
    return ["SELECT id FROM shops WHERE id=$1", "SELECT shop_id AS id FROM shop_identity_changes WHERE id=$1"].includes(
      sql.replace(/\s+/g, " ").trim(),
    );
  if (file === "owner-shop-db.ts") {
    const text = sql.replace(/\s+/g, " ").trim();
    return (
      text === "SELECT id FROM shops WHERE owner_id = $1" ||
      text ===
        "INSERT INTO shops (id, owner_id, name, contact_phone, business_address, contact_email, business_name, representative_name, business_reg_no, mail_order_reg_no, mail_order_authority, mail_order_exemption, food_license_no, food_business_type, license_photo_key, entrustment_terms_version, entrustment_consented_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17, $17)"
    );
  }
  if (file === "kakao-callback-sources.ts") {
    return (
      sql.replace(/\s+/g, " ").trim() ===
      "SELECT t.shop_id, t.id, t.kakao_callback_deadline_at AS due_at FROM messages t WHERE t.direction = 'inbound' AND t.kakao_callback_enc IS NOT NULL AND t.kakao_callback_deadline_at <= $1 ORDER BY t.kakao_callback_deadline_at, t.id LIMIT $2"
    );
  }
  if (file === "purge-sources.ts") {
    const text = sql.replace(/\s+/g, " ").trim();
    if (text === "SELECT count(*)::int AS count FROM file_deletions") return true;
    return (
      /^SELECT t\.shop_id, t\.id, t\.([a-z_]+) AS due_at FROM (orders|consultations|kept_records|customers|access_logs|ai_tool_calls|file_deletions) t WHERE .+ ORDER BY t\.\1, t\.id LIMIT \$2$/.test(
        text,
      ) &&
      !/\b(insert|update|delete|union|intersect|except|returning)\b/i.test(text) &&
      !text.includes(EXPR.trim()) &&
      [...text.matchAll(/\bSELECT (.*?) FROM\b/gi)].every(
        (m, i) => i === 0 || /^(1|[a-z_]+\.(id|order_id|day_used_order_id|limit_used_order_id))$/i.test(m[1] ?? ""),
      )
    );
  }
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
  // TASK-076/134: 여러 가게에서 고르는 값은 상담/확정 주문의 ID·시각뿐이다. 하위 질의도 같은 후보 가게다.
  if (file === CROSS_SHOP_FILE) {
    const found = FIND_SHAPE.exec(sql);
    const consultation = found?.[2] === "consultations";
    const dayBefore = found?.[2] === "orders" && found[1] === "confirmed_at";
    if (consultation || dayBefore) {
      const where = found[3] ?? "";
      if (
        !(consultation ? /^t\.status = '(open|ordered|awaiting_owner)' AND / : /^t\.status = 'confirmed' AND /).test(
          where,
        ) ||
        /\b(insert|update|delete|union|intersect|except|returning)\b/i.test(sql) ||
        sql.includes(EXPR.trim())
      )
        return false;
      if (
        ![...sql.matchAll(/\bSELECT (.*?) FROM\b/gi)].every(
          (m, i) => i === 0 || /^(1|[a-z_]+\.(id|order_id|day_used_order_id|limit_used_order_id))$/i.test(m[1] ?? ""),
        )
      )
        return false;
      const table = consultation ? "consultations" : "orders";
      const dueColumn = consultation ? "last_customer_message_at" : "confirmed_at";
      const guarded = `SELECT t.id FROM ${table} t WHERE t.shop_id = $1 AND t.id = $2 AND ${where.replaceAll("$1", "$3")} AND t.${dueColumn} <= $3 FOR UPDATE SKIP LOCKED`;
      return scopeViolations(guarded).length === 0;
    }
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
  "license-resubmission.ts": "실제 인증된 사장님 가게 범위에서 같은 사장님 증빙 범위로만 변환(TASK-033)",
  "identity-change-request.ts": "실제 인증된 사장님 가게 범위에서 같은 사장님 증빙 범위로만 변환(TASK-036)",
  "owner-scope.ts": "정의",
  "owner-login.ts": "쿠키의 세션에서 찾은 사장님과 가게 요약만 담음(TASK-020)",
  "price-lists.ts": "실제 인증된 사장님 출처의 가게 범위를 같은 사장님 사진 범위로 변환(TASK-038)",
};

/** 사장님 범위를 만드는 표시(MAKES_SCOPE와 같은 꼴). */
const MAKES_OWNER_SCOPE =
  /\b(?:createOwnerScope|ownerOfShopScope)\s*\(|import[^;]*\b(?:createOwnerScope|ownerOfShopScope)\b|["'`](?:createOwnerScope|ownerOfShopScope)["'`]/;

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
  it("등록 전 SQL은 자기 사장님의 가게 ID 조회와 정한 등록뿐임", () => {
    const sqls = shopSql(sources.find((s) => s.name === "owner-shop-db.ts")?.text ?? "");
    expect(sqls).toHaveLength(2);
    for (const sql of sqls) expect(allowedCrossShop("owner-shop-db.ts", sql)).toBe(true);
    for (const bad of [
      "SELECT * FROM shops WHERE owner_id = $1",
      "SELECT id FROM shops WHERE id = $1",
      "SELECT id FROM shops WHERE owner_id = $1 OR true",
    ])
      expect(allowedCrossShop("owner-shop-db.ts", bad)).toBe(false);
    expect(allowedCrossShop("shops.ts", sqls[0] ?? "")).toBe(false);
  });
  it("운영자 목록/중복은 정한 세 읽기뿐이고 다른 파일/추가 열/조건 제거는 막음", () => {
    const queries = shopSql(sources.find((s) => s.name === "operator-shop-directory.ts")?.text ?? "");
    expect(queries).toHaveLength(3);
    for (const sql of queries) {
      expect(allowedCrossShop("operator-shop-directory.ts", sql)).toBe(true);
      expect(allowedCrossShop("operator-shop.ts", sql)).toBe(false);
      expect(allowedCrossShop("operator-shop-directory.ts", sql.replace("SELECT ", "SELECT s.owner_id,"))).toBe(false);
      expect(allowedCrossShop("operator-shop-directory.ts", sql.replace(/WHERE [^\n]+/, "WHERE true"))).toBe(false);
    }
    expect(allowedCrossShop("operator-shop.ts", "SELECT id FROM shops WHERE id=$1")).toBe(true);
    expect(allowedCrossShop("operator-shop.ts", "SELECT * FROM shops WHERE id=$1")).toBe(false);
    expect(allowedCrossShop("operator-shop.ts", "SELECT shop_id AS id FROM shop_identity_changes WHERE id=$1")).toBe(
      true,
    );
    expect(allowedCrossShop("operator-shop.ts", "SELECT * FROM shop_identity_changes WHERE id=$1")).toBe(false);
  });
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

  it("문의 끊김 찾기는 후보 가게의 메타데이터만 읽고 다른 가게·원문·추가 출력은 막음", () => {
    const find = DUE_SOURCES.consultation_open.find;
    expect(allowedCrossShop(CROSS_SHOP_FILE, find)).toBe(true);
    for (const bad of [
      find.replace("t.shop_id, t.id,", "t.shop_id, t.id, t.customer_id,"),
      find.replace("s.id = t.shop_id", "s.id <> t.shop_id"),
      find.replace("h.shop_id = t.shop_id", "true"),
      find.replace("SELECT 1 FROM shops", "SELECT s.contact_phone FROM shops"),
      find.replace("WHERE t.status = 'open'", "WHERE true OR t.status = 'open'"),
    ])
      expect(allowedCrossShop(CROSS_SHOP_FILE, bad)).toBe(false);
    expect(allowedCrossShop("consultation-idle.ts", find)).toBe(false);
  });

  it("전날 안내 찾기는 후보 가게의 설정/안내 조건만 읽고 다른 가게·원문·추가 출력은 막음", () => {
    const find = DUE_SOURCES.order_day_before.find;
    expect(allowedCrossShop(CROSS_SHOP_FILE, find)).toBe(true);
    for (const bad of [
      find.replace("t.shop_id, t.id,", "t.shop_id, t.id, t.customer_id,"),
      find.replace("s.id = t.shop_id", "s.id <> t.shop_id"),
      find.replace("b.shop_id = s.id", "b.shop_id <> s.id"),
      find.replace("n.shop_id = t.shop_id", "true"),
      find.replace("SELECT 1 FROM shops", "SELECT s.contact_phone FROM shops"),
      find.replace("WHERE t.status = 'confirmed'", "WHERE true OR t.status = 'confirmed'"),
    ]) {
      expect(bad).not.toBe(find);
      expect(allowedCrossShop(CROSS_SHOP_FILE, bad)).toBe(false);
    }
    expect(allowedCrossShop("day-before-notice.ts", find)).toBe(false);
  });

  it("운영자 알림은 정확한 한 읽기만 허용하고 상세/다른 종류/가게 조건 우회를 막음", () => {
    const source = sources.find((s) => s.name === "operator-alert-directory.ts");
    expect(source).toBeDefined();
    const queries = shopSql(source?.text ?? "");
    expect(queries).toHaveLength(1);
    const sql = queries[0] as string;
    expect(allowedCrossShop("operator-alert-directory.ts", sql)).toBe(true);
    expect(allowedCrossShop("operator-alerts.ts", sql)).toBe(false);
    for (const bad of [
      sql.replace("e.id,e.kind", "e.id,e.detail,e.kind"),
      sql.replace("'ai_failure_burst'", "'purge_run'"),
      sql.replace("ON s.id=e.shop_id", "ON true"),
      `${sql}; UPDATE ops_events SET count=0`,
      `${sql} UNION SELECT * FROM shops`,
    ])
      expect(allowedCrossShop("operator-alert-directory.ts", bad), bad).toBe(false);
  });

  it("콜백 만료 찾기는 전용 파일의 식별자/기한 조회 하나만 허용함", () => {
    const source = sources.find((s) => s.name === "kakao-callback-sources.ts");
    expect(source).toBeDefined();
    const text = (source as { text: string }).text;
    expect(RAW_ACCESS.some((re) => re.test(text))).toBe(false);
    const queries = shopSql(text);
    expect(queries).toHaveLength(1);
    const sql = queries[0] as string;
    expect(allowedCrossShop("kakao-callback-sources.ts", sql)).toBe(true);
    expect(allowedCrossShop("kakao-callback-queue.ts", sql)).toBe(false);
    expect(allowedCrossShop("kakao-callback-sources.ts", sql.replace("t.id,", "t.id, t.kakao_callback_enc,"))).toBe(
      false,
    );
    expect(allowedCrossShop("kakao-callback-sources.ts", sql.replace("'inbound'", "'outbound'"))).toBe(false);
    expect(
      allowedCrossShop("kakao-callback-sources.ts", sql.replace("AND t.kakao_callback_deadline_at <= $1", "")),
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

  it("기간 지우기의 전역 후보는 ID·시각과 존재 여부만 읽고 내용을 돌려주거나 쓰지 않음", () => {
    const file = sources.find((s) => s.name === "purge-sources.ts");
    expect(file).toBeDefined();
    expect(RAW_ACCESS.some((re) => re.test(file?.text ?? ""))).toBe(false);
    const sqls = shopSql(file?.text ?? "");
    expect(sqls).toHaveLength(10);
    for (const sql of sqls) expect(allowedCrossShop("purge-sources.ts", sql), sql).toBe(true);
    for (const source of Object.values(PURGE_SOURCES)) {
      expect(isPurgeFindSql(source.sql)).toBe(true);
      for (const bad of [
        source.sql.replace("t.shop_id, t.id,", "t.shop_id, t.customer_name, t.id,"),
        `${source.sql} UNION SELECT * FROM customers`,
        `${source.sql}; DELETE FROM orders`,
        source.sql.replace("LIMIT $2", "LIMIT $2 RETURNING customer_name"),
      ]) {
        expect(allowedCrossShop("purge-sources.ts", bad)).toBe(false);
        expect(isPurgeFindSql(bad)).toBe(false);
      }
    }
    const extraContent = PURGE_SOURCES.customers.sql.replace(
      "SELECT 1 FROM consultations",
      "select c.customer_name from consultations",
    );
    expect(allowedCrossShop("purge-sources.ts", extraContent)).toBe(false);
    expect(isPurgeFindSql(extraContent)).toBe(false);
    expect(allowedCrossShop("purge-runner.ts", PURGE_SOURCES.orders.sql)).toBe(false);
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

  it.each([
    "ownerOfShopScope(scope)",
    'import { ownerOfShopScope as own } from "./owner-scope";',
    'factory["ownerOfShopScope"]',
  ])("사장님 범위 변환도 생성 검사에 잡힘: %s", (code) => {
    expect(MAKES_OWNER_SCOPE.test(code)).toBe(true);
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
