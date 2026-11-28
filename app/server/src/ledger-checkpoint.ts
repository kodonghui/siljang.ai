import { toBase64Url } from "./encoding";
import type { Secret } from "./settings";

export type LedgerCell = string | number | boolean | { readonly formula: string };
export interface LedgerCheckpointRow {
  readonly key: string;
  readonly digest: string;
  readonly orderId: string | null;
}
export interface LedgerCheckpoint {
  readonly scope: string;
  readonly keyVersion: string;
  readonly sentDigest: string;
  readonly rows: readonly LedgerCheckpointRow[];
  readonly unidentifiedRows: boolean;
  readonly conflicted: boolean;
  readonly affectedOrderIds: readonly string[];
}
export interface LedgerCheckpointContext {
  readonly file: string;
  readonly tab: string;
  readonly eventId: string;
  readonly orderId: string;
}
const HASH = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function orderId(row: readonly LedgerCell[]): string | null {
  const id = row[13];
  if (typeof id !== "string" || !/^[0-9a-f]{32}$/i.test(id)) return null;
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`.toLowerCase();
}
async function signer(secret: Secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret.reveal()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return async (value: unknown) =>
    toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(JSON.stringify(value)))));
}
function keyOf(row: readonly LedgerCell[]): string | null {
  return typeof row[13] === "string" && row[13] ? `id:${row[13]}` : row[0] ? `number:${String(row[0])}` : null;
}
async function hashedRows(
  sign: Awaited<ReturnType<typeof signer>>,
  rows: readonly (readonly LedgerCell[])[],
  scope: string,
): Promise<LedgerCheckpointRow[]> {
  const entries = rows.flatMap((row) => {
    const key = keyOf(row);
    return key === null || orderId(row) === null ? [] : [{ key, row }];
  });
  return Promise.all(
    entries.map(async ({ key, row }) => ({
      key: await sign(["ledger-key-v1", scope, key]),
      digest: await sign(["ledger-row-v1", row]),
      orderId: orderId(row),
    })),
  );
}
function valid(value: unknown): value is LedgerCheckpoint {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).some(
      (k) =>
        !["scope", "keyVersion", "sentDigest", "rows", "unidentifiedRows", "conflicted", "affectedOrderIds"].includes(
          k,
        ),
    ) ||
    typeof v.scope !== "string" ||
    !HASH.test(v.scope) ||
    typeof v.keyVersion !== "string" ||
    !HASH.test(v.keyVersion) ||
    typeof v.sentDigest !== "string" ||
    !HASH.test(v.sentDigest) ||
    typeof v.unidentifiedRows !== "boolean" ||
    typeof v.conflicted !== "boolean" ||
    !Array.isArray(v.rows) ||
    v.rows.length > 5000 ||
    !Array.isArray(v.affectedOrderIds) ||
    v.affectedOrderIds.length > 5000 ||
    v.affectedOrderIds.some((id: unknown) => typeof id !== "string" || !UUID.test(id))
  )
    return false;
  return v.rows.every((r: unknown) => {
    if (typeof r !== "object" || r === null || Array.isArray(r)) return false;
    const row = r as Record<string, unknown>;
    return (
      Object.keys(row).every((k) => ["key", "digest", "orderId"].includes(k)) &&
      typeof row.key === "string" &&
      HASH.test(row.key) &&
      typeof row.digest === "string" &&
      HASH.test(row.digest) &&
      typeof row.orderId === "string" &&
      UUID.test(row.orderId)
    );
  });
}
/** 비교 기준은 원문 없이 행 서명과 해당 주문의 불투명 ID만 가진다. */
export async function buildLedgerCheckpoint(
  secret: Secret,
  context: LedgerCheckpointContext,
  before: readonly (readonly LedgerCell[])[],
  sent: readonly LedgerCell[],
): Promise<LedgerCheckpoint> {
  const sign = await signer(secret);
  const scope = await sign(["ledger-scope-v1", context.file, context.tab, context.eventId, context.orderId]);
  return {
    scope,
    keyVersion: await sign(["ledger-key-version-v1"]),
    sentDigest: await sign(["ledger-row-v1", sent]),
    rows: await hashedRows(sign, before, scope),
    unidentifiedRows: before.some((row) => keyOf(row) !== null && orderId(row) === null),
    conflicted: false,
    affectedOrderIds: [],
  };
}
export async function compareLedgerCheckpoint(
  secret: Secret,
  context: LedgerCheckpointContext,
  checkpoint: unknown,
  current: readonly (readonly LedgerCell[])[],
  excludeTarget = false,
): Promise<{ changed: boolean; affectedOrderIds: string[]; rows: LedgerCheckpointRow[] }> {
  if (!valid(checkpoint)) throw new Error("invalid ledger checkpoint");
  const sign = await signer(secret);
  if (checkpoint.keyVersion !== (await sign(["ledger-key-version-v1"]))) throw new Error("ledger key version changed");
  if (
    checkpoint.scope !== (await sign(["ledger-scope-v1", context.file, context.tab, context.eventId, context.orderId]))
  )
    throw new Error("ledger checkpoint target changed");
  const rows = await hashedRows(sign, current, checkpoint.scope),
    groups = new Map<string, { before: LedgerCheckpointRow[]; after: LedgerCheckpointRow[] }>();
  for (const [side, list] of [
    ["before", checkpoint.rows],
    ["after", rows],
  ] as const)
    for (const row of list) {
      if (excludeTarget && row.orderId === context.orderId.toLowerCase()) continue;
      const group = groups.get(row.key) ?? { before: [], after: [] };
      group[side].push(row);
      groups.set(row.key, group);
    }
  let changed = checkpoint.unidentifiedRows || current.some((row) => keyOf(row) !== null && orderId(row) === null);
  const affected = new Set<string>();
  for (const group of groups.values()) {
    const before = group.before.map((r) => r.digest).sort(),
      after = group.after.map((r) => r.digest).sort();
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changed = true;
      for (const row of [...group.before, ...group.after]) if (row.orderId) affected.add(row.orderId);
    }
  }
  return { changed, affectedOrderIds: [...affected], rows };
}
