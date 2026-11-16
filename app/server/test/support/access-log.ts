import { expect } from "vitest";
import { ACCESS_LOG_APIS } from "../../src/access-log";
import { type DbConnector, pgConnector, type Queryable } from "../../src/db";
import { ERRORS } from "../../src/problem";
import { type RouteDecl, routeKey } from "../../src/routes";
import { contract } from "./contract";

/**
 * 접속기록 시험 도우미(TASK-024; 04 SPEC-074, 05 A24·TBL-053, 06 README 5절 '접속기록').
 * 뒤 TASK가 자기 API(06 API-040~066, 074~077)를 붙일 때 같은 도우미로 본다:
 * - expectOneAccessRow: 그 경로를 부르면 접속기록이 한 행 늘고 그 행이 무엇인지.
 * - expectFailClosed: 접속기록 넣기가 실패하면 500 internal이고 응답에 개인정보가 없고 행이 늘지 않음
 *   (앱을 failingAccessInsert 연결기로 만들어 부름).
 * - accessRegistryGaps: 앱의 선언이 06과 맞는지(06의 접속기록 API는 accessRoute로, API 번호는 06의 방법·경로와 같게).
 */

/** 시험의 접속지: 문서용 주소(RFC 5737, RFC 3849). Cloudflare가 넣는 헤더 이름(소문자). */
export const CLIENT_IP_HEADER = "cf-connecting-ip";
export const TEST_IPV4 = "203.0.113.24";
export const TEST_IPV6 = "2001:db8::24";

export interface AccessLogRow {
  readonly id: string;
  readonly shop_id: string;
  readonly actor_kind: "owner" | "operator";
  readonly owner_id: string | null;
  readonly operator_id: string | null;
  readonly action: "read" | "change" | "open_original" | "open_kept";
  readonly api_id: string;
  readonly request_path: string;
  readonly subject_ids: readonly string[];
  readonly target_kind: string | null;
  readonly target_id: string | null;
  readonly reason: string | null;
  readonly client_ip: string;
  /** accessed_at(마이크로초까지, 1970년부터의 글). 같은 트랜잭션의 now()와 견줄 때. */
  readonly accessed_us: string;
  /** 행 전체의 글(개인정보 값이 없는지 훑을 때). */
  readonly row_text: string;
}

/** 가게 하나의 접속기록(넣은 차례). 시험의 연결로 읽는다(가게 조건은 시험이 직접 줌). */
export async function accessLogRows(db: Queryable, shopId: string): Promise<AccessLogRow[]> {
  const r = await db.query<AccessLogRow>(
    `SELECT id, shop_id, actor_kind, owner_id, operator_id, action, api_id, request_path, subject_ids, target_kind,
            target_id, reason, client_ip, (extract(epoch FROM accessed_at) * 1000000)::bigint::text AS accessed_us,
            t::text AS row_text
       FROM access_logs t WHERE shop_id = $1 ORDER BY accessed_at, id`,
    [shopId],
  );
  return r.rows;
}

/** 지금까지의 행 수(가게마다). */
export async function accessLogCount(db: Queryable, shopId: string): Promise<number> {
  const r = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM access_logs WHERE shop_id = $1", [shopId]);
  return r.rows[0]?.n ?? 0;
}

/**
 * 접속기록 넣기만 실패하게 바꾼 연결기. 넣는 SQL의 테이블 이름을 없는 이름으로 바꿔 진짜 데이터베이스 오류(42P01)가 나게 한다
 * (트랜잭션 안이면 그 트랜잭션이 되돌려짐). 다른 SQL은 그대로 보낸다.
 */
export function failingAccessInsert(inner: DbConnector = pgConnector): DbConnector {
  const breakSql = (sql: string) => sql.replace(/INSERT INTO access_logs\b/, "INSERT INTO access_logs_unavailable");
  return (url) => {
    const db = inner(url);
    return {
      query: (sql, params) => db.query(breakSql(sql), params),
      transaction: (fn) => db.transaction((tx) => fn({ query: (sql, params) => tx.query(breakSql(sql), params) })),
      close: () => db.close(),
    };
  };
}

/** 경로를 부르고 접속기록이 정확히 한 행 늘었는지 본다. 늘어난 행을 돌려준다. */
export async function expectOneAccessRow(
  db: Queryable,
  shopId: string,
  call: () => Promise<Response>,
  expected: Partial<Omit<AccessLogRow, "id" | "accessed_us" | "row_text">>,
): Promise<{ readonly res: Response; readonly text: string; readonly row: AccessLogRow }> {
  const before = await accessLogRows(db, shopId);
  const res = await call();
  const text = await res.text();
  expect(res.status, text).toBeGreaterThanOrEqual(200);
  expect(res.status, text).toBeLessThan(300);
  const after = await accessLogRows(db, shopId);
  expect(after.length, "접속기록이 한 행 늘어야 함").toBe(before.length + 1);
  const known = new Set(before.map((r) => r.id));
  const row = after.find((r) => !known.has(r.id));
  if (row === undefined) throw new Error("new access log row not found");
  expect(row).toMatchObject(expected);
  return { res, text, row };
}

/**
 * 접속기록 넣기가 실패하는 앱으로 부르면: 500 internal(06 Problem), 응답에 개인정보 값이 없음, 접속기록이 늘지 않음.
 * pii는 그 경로가 성공하면 돌려줄 손님 개인정보 값들(시험 자료의 이름·연락처 등).
 */
export async function expectFailClosed(
  db: Queryable,
  shopId: string,
  call: () => Promise<Response>,
  pii: readonly string[],
): Promise<void> {
  const before = await accessLogCount(db, shopId);
  const res = await call();
  const text = await res.text();
  expect(res.status, text).toBe(ERRORS.internal.status);
  expect(res.headers.get("content-type")).toBe("application/problem+json");
  expect((JSON.parse(text) as { code?: string }).code).toBe("internal");
  for (const value of pii) expect(text).not.toContain(value);
  expect(await accessLogCount(db, shopId)).toBe(before);
}

/** 06의 operation 하나(방법, 06 꼴 경로, API 번호, 세션 종류). */
export interface ContractOperation {
  readonly method: string;
  readonly path: string;
  readonly id: string;
  readonly schemes: readonly string[];
  /** x-corthex.spec(그 API가 따르는 04 SPEC). */
  readonly spec: readonly string[];
}

interface Operation {
  readonly security?: readonly Record<string, unknown>[];
  readonly "x-corthex"?: { readonly id?: string; readonly spec?: readonly string[] };
}

export function contractOperations(): ContractOperation[] {
  return Object.entries(contract.paths).flatMap(([path, ops]) =>
    Object.entries(ops as Record<string, Operation>)
      .filter(([m]) => ["get", "post", "put", "patch", "delete"].includes(m))
      .map(([m, op]) => ({
        method: m.toUpperCase(),
        path,
        id: op["x-corthex"]?.id ?? "",
        schemes: (op.security ?? []).flatMap((s) => Object.keys(s)),
        spec: op["x-corthex"]?.spec ?? [],
      })),
  );
}

/** 06 꼴 경로({이름})를 앱의 선언 꼴(:이름)로. */
export function honoPath(contractPath: string): string {
  return contractPath.replace(/\{([A-Za-z]+)\}/g, ":$1");
}

/**
 * 06이 접속기록을 남기게 한 API: components.x-corthex.jobs의 SPEC-074 항목 seen_in('API-040~066, API-074~077(…)')의
 * 범위를 편 것. 06 README 5절 '접속기록'과 같은 범위다(시험이 둘 다 봄).
 */
export function contractAccessApis(): string[] {
  const components = (
    contract as unknown as { components: { "x-corthex": { jobs: { spec: string; seen_in: string }[] } } }
  ).components;
  const job = components["x-corthex"].jobs.find((j) => j.spec === "SPEC-074");
  if (job === undefined) throw new Error("SPEC-074 is not in components.x-corthex.jobs");
  const ids: string[] = [];
  for (const m of job.seen_in.matchAll(/API-(\d{3})(?:~(\d{3}))?/g)) {
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    for (let n = from; n <= to; n += 1) ids.push(`API-${String(n).padStart(3, "0")}`);
  }
  return ids;
}

/**
 * 앱의 선언과 06을 견준다. 어긋난 것을 글로 돌려준다(없으면 빈 목록).
 * - 06의 (방법, 경로)가 접속기록 API인 선언은 accessRoute(access가 그 API 번호)여야 함.
 * - accessRoute는 06에 같은 (방법, 경로)가 있고 그 API 번호가 access와 같아야 함.
 */
export function accessRegistryGaps(routes: readonly RouteDecl[]): string[] {
  const operations = contractOperations();
  const logged = new Set(ACCESS_LOG_APIS.keys());
  const gaps: string[] = [];
  for (const decl of routes) {
    const key = routeKey(decl.method, decl.path);
    const hit = operations.find((o) => o.method === decl.method && honoPath(o.path) === decl.path);
    const access = decl.kind === "shop" ? decl.access : undefined;
    if (hit !== undefined && logged.has(hit.id) && access !== hit.id) {
      gaps.push(`${key}: 06 ${hit.id} leaves an access log, declare it with accessRoute(…, "${hit.id}", …)`);
      continue;
    }
    if (access === undefined) continue;
    if (hit === undefined) gaps.push(`${key}: accessRoute ${access} is not a 06 operation`);
    else if (hit.id !== access) gaps.push(`${key}: accessRoute says ${access} but 06 says ${hit.id}`);
  }
  return gaps;
}
