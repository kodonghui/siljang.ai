/**
 * 가게 조건 검사(TASK-019; 04 G1·SPEC-068, 05 A9). 가게 테이블을 읽고 쓰는 SQL이 테이블마다 가게 조건을 갖는지 본다.
 * 가게 범위 연결(shop-scope.ts의 ShopDb)이 SQL을 보내기 전에 부르고, 서버 코드의 SQL 글을 훑는 정적 시험
 * (test/shop-scope-static.test.ts)도 같은 함수를 쓴다. 데이터베이스는 가게가 섞인 행만 막고(05 E1 복합 외래 키)
 * 다른 가게 행을 읽는 일은 막지 않는다(05 A9). 그래서 앱이 SQL마다 본다.
 *
 * 가게 조건: $1이 이 가게 ID다(ShopDb가 채움). 아래를 모두 지켜야 한다.
 * 1. 문장은 SELECT·WITH·INSERT·UPDATE·DELETE 하나(끝의 ; 하나만).
 * 2. FROM·JOIN·UPDATE·DELETE FROM·USING으로 든 가게 테이블마다, 그 테이블의 shop_id가 $1과 같다는 조건이
 *    (a) 그 테이블이 든 단계(괄호 묶음, UNION으로 나뉜 조각)의 WHERE에 AND로만 이어져 있거나
 *    (b) 그 테이블을 든 JOIN(안쪽·LEFT)의 ON에 AND로만 이어져 있다. 괄호 밖 OR가 있는 조건은 치지 않는다.
 *    `X.shop_id = Y.shop_id`는 Y가 가게 조건을 가지면 X도 갖는다. shops(가게 자체)의 가게 조건은 `X.id = $1`.
 *    별칭 없는 `shop_id = $1`은 그 단계의 FROM에 테이블이 하나일 때만 친다.
 * 3. INSERT는 열 목록의 첫 열이 shop_id이고 그 값이 $1이다(VALUES 줄마다, 또는 SELECT의 첫 값).
 * 4. shop_id는 $1이나 다른 테이블의 shop_id(shops는 id)하고만 =로 견주거나 넣는다(SET shop_id = $2로 다른 가게로 옮기기,
 *    WHERE shop_id = $2로 다른 가게 읽기를 막음).
 * 5. ON CONFLICT … DO UPDATE는 충돌 대상 열에 shop_id가 있다(다른 가게의 행을 고치지 않게).
 * 6. 별칭은 문장 안에서 하나씩이고 가게 테이블 이름을 다른 테이블의 별칭으로 쓰지 않는다. 가게 테이블 이름은 FROM·JOIN·
 *    UPDATE·INSERT INTO·DELETE FROM·USING 자리와 `이름.열`에만 쓴다(TABLE 문, LOCK, 알아보지 못한 자리를 막음).
 * 한계: 함수·뷰 안의 SQL은 보지 못한다(05에 업무 코드가 부르는 함수·뷰 없음). $1에 다른 가게 ID를 넣는 일은 ShopDb가
 * 막는다($1을 스스로 채움). 실행 중에 이어 붙인 SQL은 정적 시험이 아니라 ShopDb의 실행 중 검사가 본다.
 */

/** 05의 가게에 딸린 테이블: shop_id 열을 가진 54개(db/schema.sql, 05 E1). 시험이 05와 데이터베이스와 같은지 본다. */
export const SHOP_TABLES = [
  "access_logs",
  "ai_calls",
  "ai_tool_calls",
  "business_calendars",
  "calendar_days",
  "change_requests",
  "completion_photos",
  "confirm_cards",
  "consultations",
  "customers",
  "designs",
  "file_deletions",
  "handoff_questions",
  "handoffs",
  "issue_details",
  "issue_photos",
  "issue_reports",
  "kakao_channels",
  "kept_records",
  "ledger_links",
  "ledger_rows",
  "ledger_writes",
  "masked_values",
  "messages",
  "notifications",
  "operating_rules",
  "ops_events",
  "order_detail_extras",
  "order_details",
  "order_draft_extras",
  "order_drafts",
  "orders",
  "owner_alerts",
  "owner_tasks",
  "payment_accounts",
  "payment_requests",
  "payments",
  "photo_consents",
  "portfolio_items",
  "price_lists",
  "price_option_rules",
  "price_options",
  "privacy_policies",
  "production_undos",
  "productions",
  "quotes",
  "reference_photos",
  "refund_tiers",
  "refunds",
  "review_photos",
  "reviews",
  "rule_clauses",
  "shop_identity_changes",
  "slot_holds",
] as const;

export type ShopTable = (typeof SHOP_TABLES)[number];

/** id(uuid) 기본 키가 없는 가게 테이블 넷. 경로·본문의 ID 하나로 행을 찾지 않는다. */
export const SHOP_TABLES_WITHOUT_ID = [
  "business_calendars",
  "calendar_days",
  "order_detail_extras",
  "order_draft_extras",
] as const;

/** 경로·본문의 ID로 행을 찾는 가게 테이블(id uuid 기본 키). */
export type IdShopTable = Exclude<ShopTable, (typeof SHOP_TABLES_WITHOUT_ID)[number]>;

/** 가게 자체(05 TBL-003). 가게 조건은 id = $1. */
const SHOPS = "shops";
const SCOPED = new Set<string>([...SHOP_TABLES, SHOPS]);

/** SQL이 가게 테이블을 하나라도 이름으로 드는지(정적 시험이 검사할 글을 고를 때). */
export function namesShopTable(sql: string): boolean {
  return tokenize(stripSql(sql)).some((t) => SCOPED.has(t.v));
}

/** 주석·글자 값·$$ 글을 비우고 따옴표 이름을 벗겨 소문자로. 글자 값 안의 테이블 이름은 테이블이 아니다. */
export function stripSql(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i] as string;
    const next = sql[i + 1];
    if (ch === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? n : end;
      out += " ";
      continue;
    }
    if (ch === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql.startsWith("/*", i)) {
          depth += 1;
          i += 2;
        } else if (sql.startsWith("*/", i)) {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      out += " ";
      continue;
    }
    if (ch === "'") {
      const backslash = /(^|[^a-z0-9_$])e$/i.test(out);
      i += 1;
      while (i < n) {
        const c = sql[i];
        if (backslash && c === "\\") {
          i += 2;
          continue;
        }
        if (c === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      out += " '' ";
      continue;
    }
    if (ch === '"') {
      let name = "";
      i += 1;
      while (i < n) {
        const c = sql[i] as string;
        if (c === '"') {
          if (sql[i + 1] === '"') {
            name += '"';
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        name += c;
        i += 1;
      }
      out += ` ${name} `;
      continue;
    }
    if (ch === "$") {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
      if (tag !== null && !/[A-Za-z0-9_$]$/.test(out)) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        i = end === -1 ? n : end + tag[0].length;
        out += " '' ";
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out.toLowerCase();
}

interface Tok {
  readonly v: string;
  /** 괄호 깊이. 여는 괄호와 닫는 괄호는 바깥 깊이다. */
  readonly depth: number;
  /** 이 낱말을 감싼 가장 안쪽 괄호 묶음(0은 맨 바깥). */
  readonly group: number;
  /** 단계: 괄호 묶음과 그 안에서 UNION·EXCEPT·INTERSECT로 나뉜 조각. */
  level: string;
}

const TOKEN =
  /(\s+)|([a-z_][a-z0-9_$]*)|(\$[0-9]+)|([0-9][0-9.]*)|('')|(::|=>|<>|!=|<=|>=|\|\||->>|->|#>>|#>|@>|<@)|([\s\S])/y;
const WORD = /^[a-z_][a-z0-9_$]*$/;

function tokenize(s: string): Tok[] {
  const toks: Tok[] = [];
  const stack = [0];
  let groups = 0;
  let i = 0;
  while (i < s.length) {
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(s);
    if (m === null) break;
    i = TOKEN.lastIndex;
    if (m[1] !== undefined) continue;
    const v = m[0];
    const top = stack[stack.length - 1] ?? 0;
    if (v === "(") {
      toks.push({ v, depth: stack.length - 1, group: top, level: "" });
      groups += 1;
      stack.push(groups);
      continue;
    }
    if (v === ")" && stack.length > 1) {
      stack.pop();
      toks.push({ v, depth: stack.length - 1, group: stack[stack.length - 1] ?? 0, level: "" });
      continue;
    }
    toks.push({ v, depth: stack.length - 1, group: top, level: "" });
  }
  const segments = new Map<number, number>();
  for (const t of toks) {
    const seg = segments.get(t.group) ?? 0;
    t.level = `${t.group}:${seg}`;
    if (t.v === "union" || t.v === "except" || t.v === "intersect") segments.set(t.group, seg + 1);
  }
  return toks;
}

/** 테이블 이름 뒤에 와도 별칭이 아닌 낱말. */
const NOT_ALIAS = new Set([
  "where",
  "on",
  "using",
  "set",
  "join",
  "inner",
  "left",
  "right",
  "full",
  "cross",
  "natural",
  "outer",
  "group",
  "order",
  "limit",
  "offset",
  "fetch",
  "for",
  "returning",
  "union",
  "except",
  "intersect",
  "having",
  "window",
  "values",
  "select",
  "default",
  "lateral",
  "tablesample",
  "and",
  "or",
  "not",
  "when",
  "then",
  "else",
  "end",
  "from",
  "into",
  "with",
  "do",
  "only",
  "as",
  "overriding",
]);

const END_WHERE = new Set([
  "group",
  "order",
  "limit",
  "offset",
  "fetch",
  "for",
  "returning",
  "union",
  "except",
  "intersect",
  "window",
  "having",
  "on",
  "do",
  ";",
]);
const END_ON = new Set([...END_WHERE, "join", "left", "right", "inner", "full", "cross", "natural", "where", ","]);

type ItemKind = "from" | "join" | "update" | "delete" | "insert";

interface Ref {
  readonly table: string;
  readonly alias: string;
  readonly kind: ItemKind;
  readonly join: "inner" | "left" | "right" | "full" | "cross" | "natural" | null;
  readonly level: string;
  /** 테이블 이름 낱말의 자리. */
  readonly at: number;
  /** 별칭 다음 자리. */
  readonly end: number;
}

interface Item {
  readonly level: string;
  readonly ref: Ref | null;
}

type Side =
  | { readonly kind: "param1" }
  | { readonly kind: "col"; readonly alias: string | null; readonly col: string }
  | { readonly kind: "other" };

function isWord(v: string | undefined): v is string {
  return v !== undefined && WORD.test(v);
}

function matching(toks: readonly Tok[], open: number): number {
  const depth = toks[open]?.depth ?? 0;
  for (let k = open + 1; k < toks.length; k += 1) {
    const t = toks[k];
    if (t !== undefined && t.v === ")" && t.depth === depth) return k;
  }
  return toks.length - 1;
}

function joinTypeAt(toks: readonly Tok[], k: number): Ref["join"] {
  let j = k - 1;
  if (toks[j]?.v === "outer") j -= 1;
  const w = toks[j]?.v;
  if (w === "left" || w === "right" || w === "full" || w === "inner") {
    return toks[j - 1]?.v === "natural" ? "natural" : w;
  }
  if (w === "cross" || w === "natural") return w;
  return "inner";
}

/** FROM·JOIN 따위 뒤의 항목 하나를 읽는다. */
function readItem(
  toks: readonly Tok[],
  start: number,
  kind: ItemKind,
  join: Ref["join"],
  level: string,
): { next: number; item: Item | null } {
  let q = start;
  if (toks[q]?.v === "only") q += 1;
  if (toks[q]?.v === "lateral") q += 1;
  const head = toks[q];
  if (head === undefined) return { next: q, item: null };
  if (head.v === "(") {
    q = matching(toks, q) + 1;
    if (toks[q]?.v === "as") q += 1;
    if (isWord(toks[q]?.v) && !NOT_ALIAS.has(toks[q]?.v as string)) q += 1;
    return { next: q, item: { level, ref: null } };
  }
  if (!isWord(head.v) || NOT_ALIAS.has(head.v)) return { next: q, item: null };
  let table = head.v;
  let at = q;
  q += 1;
  if (table === "public" && toks[q]?.v === "." && isWord(toks[q + 1]?.v)) {
    table = toks[q + 1]?.v as string;
    at = q + 1;
    q += 2;
  } else if (toks[q]?.v === ".") {
    // 다른 스키마의 테이블이나 함수 안의 열(extract(epoch from o.x))이다. 이 검사의 테이블이 아니다.
    return { next: q, item: null };
  }
  if (kind !== "insert" && toks[q]?.v === "(") {
    q = matching(toks, q) + 1;
    if (toks[q]?.v === "as") q += 1;
    if (isWord(toks[q]?.v) && !NOT_ALIAS.has(toks[q]?.v as string)) q += 1;
    return { next: q, item: { level, ref: null } };
  }
  let alias = table;
  if (toks[q]?.v === "as") q += 1;
  const maybe = toks[q]?.v;
  if (isWord(maybe) && !NOT_ALIAS.has(maybe)) {
    alias = maybe;
    q += 1;
  }
  return { next: q, item: { level, ref: { table, alias, kind, join, level, at, end: q } } };
}

function readItems(toks: readonly Tok[]): Item[] {
  const items: Item[] = [];
  for (let k = 0; k < toks.length; k += 1) {
    const t = toks[k] as Tok;
    const prev = toks[k - 1]?.v;
    let kind: ItemKind;
    let join: Ref["join"] = null;
    if (t.v === "from") {
      if (prev === "distinct") continue;
      kind = prev === "delete" ? "delete" : "from";
    } else if (t.v === "join") {
      kind = "join";
      join = joinTypeAt(toks, k);
    } else if (t.v === "update") {
      if (prev === "do" || prev === "for" || prev === "key") continue;
      kind = "update";
    } else if (t.v === "into") {
      if (prev !== "insert") continue;
      kind = "insert";
    } else if (t.v === "using") {
      // DELETE … USING 목록. JOIN … USING (열)은 테이블이 아니다.
      if (toks[k + 1]?.v === "(") continue;
      kind = "from";
    } else {
      continue;
    }
    let q = k + 1;
    for (;;) {
      const read = readItem(toks, q, kind, join, t.level);
      if (read.item !== null) items.push(read.item);
      q = read.next;
      if (kind !== "from" || read.item === null) break;
      const comma = toks[q];
      if (comma === undefined || comma.v !== "," || comma.depth !== t.depth) break;
      q += 1;
    }
  }
  return items;
}

function clause(toks: readonly Tok[], start: number, depth: number, ends: ReadonlySet<string>): Tok[] {
  const out: Tok[] = [];
  for (let k = start; k < toks.length; k += 1) {
    const t = toks[k] as Tok;
    if (t.depth < depth) break;
    if (t.depth === depth && ends.has(t.v)) break;
    out.push(t);
  }
  return out;
}

/** AND로 나눈 조건들. 괄호 밖 OR가 있으면 아무 조건도 확실하지 않아 null. 감싼 괄호는 벗겨 안을 나눈다. */
function conjuncts(ts: readonly Tok[], depth: number): Tok[][] | null {
  const parts: Tok[][] = [[]];
  for (const t of ts) {
    if (t.depth === depth && t.v === "or") return null;
    if (t.depth === depth && t.v === "and") {
      parts.push([]);
      continue;
    }
    parts[parts.length - 1]?.push(t);
  }
  const out: Tok[][] = [];
  for (const p of parts) {
    const first = p[0];
    const last = p[p.length - 1];
    const wrapped =
      p.length >= 2 &&
      first?.v === "(" &&
      last?.v === ")" &&
      first.depth === depth &&
      p.slice(1, -1).every((t) => t.depth > depth);
    if (wrapped) {
      const inner = conjuncts(p.slice(1, -1), depth + 1);
      if (inner !== null) out.push(...inner);
      continue;
    }
    out.push(p);
  }
  return out;
}

function side(ts: readonly Tok[]): Side {
  let xs = ts;
  while (xs.length >= 3 && xs[xs.length - 2]?.v === "::" && isWord(xs[xs.length - 1]?.v)) xs = xs.slice(0, -2);
  if (xs.length === 1 && xs[0]?.v === "$1") return { kind: "param1" };
  if (xs.length === 1 && isWord(xs[0]?.v)) return { kind: "col", alias: null, col: xs[0]?.v as string };
  if (xs.length === 3 && isWord(xs[0]?.v) && xs[1]?.v === "." && isWord(xs[2]?.v)) {
    return { kind: "col", alias: xs[0]?.v as string, col: xs[2]?.v as string };
  }
  return { kind: "other" };
}

/** `A = B` 꼴의 조건이면 두 쪽. */
function equality(part: readonly Tok[]): [Side, Side] | null {
  const depth = part[0]?.depth;
  const eqs = part.filter((t) => t.v === "=" && t.depth === depth);
  if (eqs.length !== 1) return null;
  const i = part.indexOf(eqs[0] as Tok);
  return [side(part.slice(0, i)), side(part.slice(i + 1))];
}

/** = 바로 앞의 값(별칭.열, 열, $n, ::형 붙은 것). 다른 꼴이면 other. */
function operandBefore(toks: readonly Tok[], e: number): Side {
  let j = e - 1;
  while (j >= 2 && isWord(toks[j]?.v) && toks[j - 1]?.v === "::") j -= 2;
  const t = toks[j];
  if (t === undefined) return { kind: "other" };
  if (/^\$[0-9]+$/.test(t.v)) return t.v === "$1" ? { kind: "param1" } : { kind: "other" };
  if (!isWord(t.v)) return { kind: "other" };
  if (toks[j - 1]?.v === "." && isWord(toks[j - 2]?.v))
    return { kind: "col", alias: toks[j - 2]?.v as string, col: t.v };
  return { kind: "col", alias: null, col: t.v };
}

function operandAfter(toks: readonly Tok[], e: number): Side {
  const t = toks[e + 1];
  if (t === undefined) return { kind: "other" };
  if (/^\$[0-9]+$/.test(t.v)) return t.v === "$1" ? { kind: "param1" } : { kind: "other" };
  if (!isWord(t.v)) return { kind: "other" };
  if (toks[e + 2]?.v === "." && isWord(toks[e + 3]?.v))
    return { kind: "col", alias: t.v, col: toks[e + 3]?.v as string };
  return { kind: "col", alias: null, col: t.v };
}

function isShopIdCol(s: Side): boolean {
  return s.kind === "col" && s.col === "shop_id";
}

/** INSERT INTO 가게테이블 (shop_id, …) VALUES ($1, …)[, ($1, …)] 또는 … SELECT $1, … */
function insertScoped(toks: readonly Tok[], ref: Ref): boolean {
  let q = ref.end;
  if (toks[q]?.v !== "(") return false;
  const closeCols = matching(toks, q);
  if (toks[q + 1]?.v !== "shop_id" || ![",", ")"].includes(toks[q + 2]?.v ?? "")) return false;
  q = closeCols + 1;
  const firstValueIsParam1 = (at: number): number => {
    let k = at;
    if (toks[k]?.v !== "$1") return -1;
    k += 1;
    while (toks[k]?.v === "::" && isWord(toks[k + 1]?.v)) k += 2;
    return k;
  };
  if (toks[q]?.v === "values") {
    q += 1;
    for (;;) {
      if (toks[q]?.v !== "(") return false;
      const close = matching(toks, q);
      const after = firstValueIsParam1(q + 1);
      if (
        after === -1 ||
        ![",", ")"].includes(toks[after]?.v ?? "") ||
        toks[after]?.depth !== (toks[q]?.depth ?? 0) + 1
      ) {
        return false;
      }
      q = close + 1;
      if (toks[q]?.v !== ",") return true;
      q += 1;
    }
  }
  if (toks[q]?.v === "select") {
    const after = firstValueIsParam1(q + 1);
    return after !== -1 && [",", "from"].includes(toks[after]?.v ?? "");
  }
  return false;
}

/** 가게 조건을 어긴 곳의 목록(빈 목록이면 지킴). 값은 싣지 않고 규칙과 테이블·별칭 이름만. */
export function scopeViolations(sql: string): string[] {
  const toks = tokenize(stripSql(sql));
  const out: string[] = [];
  const first = toks[0]?.v;
  if (first === undefined || !["select", "with", "insert", "update", "delete"].includes(first)) {
    out.push(`statement ${first ?? "(empty)"}`);
  }
  toks.forEach((t, k) => {
    if (t.v === ";" && k !== toks.length - 1) out.push("statement ;");
  });

  const items = readItems(toks);
  const refs = items.flatMap((it) => (it.ref === null ? [] : [it.ref]));
  const shopRefs = refs.filter((r) => SCOPED.has(r.table));

  // 6. 별칭과 가게 테이블 이름의 자리. 가게 테이블의 별칭은 문장 안에서 하나(다른 단계의 같은 별칭과 헷갈리지 않게).
  const count = new Map<string, number>();
  for (const r of refs) count.set(r.alias, (count.get(r.alias) ?? 0) + 1);
  for (const r of shopRefs) if ((count.get(r.alias) ?? 0) > 1) out.push(`alias ${r.alias} repeated`);
  for (const r of refs)
    if (r.alias !== r.table && SCOPED.has(r.alias)) out.push(`alias ${r.alias} is a shop table name`);
  const aliases = new Map(shopRefs.map((r) => [r.alias, r] as const));
  const refAt = new Set(refs.map((r) => r.at));
  toks.forEach((t, k) => {
    if (!SCOPED.has(t.v) || refAt.has(k)) return;
    if (toks[k + 1]?.v === "." || toks[k - 1]?.v === ".") return;
    out.push(`name ${t.v} outside from`);
  });

  // 4. shop_id는 $1이나 다른 shop_id(shops는 id)하고만 견줌
  const shopsAliases = new Set(shopRefs.filter((r) => r.table === SHOPS).map((r) => r.alias));
  const okPartner = (s: Side): boolean =>
    s.kind === "param1" ||
    (s.kind === "col" && s.col === "shop_id") ||
    (s.kind === "col" && s.col === "id" && s.alias !== null && shopsAliases.has(s.alias));
  toks.forEach((t, k) => {
    if (t.v !== "=") return;
    const left = operandBefore(toks, k);
    const right = operandAfter(toks, k);
    if ((isShopIdCol(left) && !okPartner(right)) || (isShopIdCol(right) && !okPartner(left))) {
      out.push("compare shop_id with something other than $1");
    }
  });

  // 5. ON CONFLICT … DO UPDATE는 충돌 대상에 shop_id
  toks.forEach((t, k) => {
    if (t.v !== "on" || toks[k + 1]?.v !== "conflict") return;
    let q = k + 2;
    let target = false;
    if (toks[q]?.v === "(") {
      const close = matching(toks, q);
      target = toks.slice(q + 1, close).some((x) => x.v === "shop_id" && x.depth === (toks[q]?.depth ?? 0) + 1);
      q = close + 1;
    }
    for (let j = q; j < toks.length; j += 1) {
      if (toks[j]?.v === "do") {
        if (toks[j + 1]?.v === "update" && !target) out.push("conflict update without shop_id");
        break;
      }
    }
  });

  // 2·3. 가게 테이블마다 가게 조건
  const whereParts = new Map<string, Tok[][]>();
  toks.forEach((t, k) => {
    if (t.v !== "where") return;
    const parts = conjuncts(clause(toks, k + 1, t.depth, END_WHERE), t.depth) ?? [];
    whereParts.set(t.level, [...(whereParts.get(t.level) ?? []), ...parts]);
  });
  const onParts = new Map<Ref, Tok[][]>();
  for (const r of shopRefs) {
    if (r.kind !== "join" || (r.join !== "inner" && r.join !== "left")) continue;
    const on = toks[r.end];
    if (on?.v !== "on") continue;
    onParts.set(r, conjuncts(clause(toks, r.end + 1, on.depth, END_ON), on.depth) ?? []);
  }
  const fromItems = new Map<string, number>();
  for (const it of items) {
    if (it.ref?.kind === "insert") continue;
    fromItems.set(it.level, (fromItems.get(it.level) ?? 0) + 1);
  }
  const scopeCol = (r: Ref) => (r.table === SHOPS ? "id" : "shop_id");
  const refersTo = (s: Side, r: Ref, unqualified: boolean): boolean =>
    s.kind === "col" &&
    s.col === scopeCol(r) &&
    (s.alias === r.alias || (s.alias === null && unqualified && (fromItems.get(r.level) ?? 0) === 1));
  const bound = new Set<Ref>();
  const bindsVia = (r: Ref, parts: readonly Tok[][], unqualified: boolean): boolean => {
    for (const p of parts) {
      const eq = equality(p);
      if (eq === null) continue;
      for (const [mine, other] of [eq, [eq[1], eq[0]]] as const) {
        if (!refersTo(mine, r, unqualified)) continue;
        if (other.kind === "param1") return true;
        if (other.kind === "col" && other.alias !== null) {
          const o = aliases.get(other.alias);
          if (o !== undefined && o !== r && bound.has(o) && other.col === scopeCol(o)) return true;
        }
      }
    }
    return false;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const r of shopRefs) {
      if (bound.has(r)) continue;
      const ok =
        r.kind === "insert"
          ? insertScoped(toks, r)
          : bindsVia(r, whereParts.get(r.level) ?? [], true) || bindsVia(r, onParts.get(r) ?? [], false);
      if (ok) {
        bound.add(r);
        changed = true;
      }
    }
  }
  for (const r of shopRefs) {
    if (!bound.has(r)) out.push(`${r.kind === "insert" ? "insert" : "unscoped"} ${r.table} ${r.alias}`);
  }
  return [...new Set(out)];
}
