import type { FieldCrypto } from "./field-crypto";
import type { LedgerCell, LedgerCheckpoint } from "./ledger-sheet-write";

interface CheckpointContext {
  readonly shopId: string;
  readonly writeId: string;
  readonly file: string;
  readonly tab: string;
}
function isCell(value: unknown): value is LedgerCell {
  if (typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)))
    return true;
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as { formula?: unknown }).formula === "string"
  );
}
/** 비교 기준은 다른 가게·이벤트·시트로 복사해 쓸 수 없다. */
export async function sealLedgerCheckpoint(
  fields: FieldCrypto,
  context: CheckpointContext,
  checkpoint: LedgerCheckpoint,
): Promise<string> {
  return fields.seal(JSON.stringify({ file: context.file, tab: context.tab, checkpoint }), {
    purpose: "ledger_writes.checkpoint",
    shopId: context.shopId,
    recordId: context.writeId,
  });
}
export async function openLedgerCheckpoint(
  fields: FieldCrypto,
  context: CheckpointContext,
  envelope: string,
): Promise<LedgerCheckpoint> {
  const text = await fields.open(envelope, {
    purpose: "ledger_writes.checkpoint",
    shopId: context.shopId,
    recordId: context.writeId,
  });
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("invalid ledger checkpoint");
  const data = parsed as { file?: unknown; tab?: unknown; checkpoint?: unknown };
  if (
    data.file !== context.file ||
    data.tab !== context.tab ||
    typeof data.checkpoint !== "object" ||
    data.checkpoint === null ||
    Array.isArray(data.checkpoint)
  )
    throw new Error("invalid ledger checkpoint");
  const value = data.checkpoint as { before?: unknown; values?: unknown };
  if (
    !Array.isArray(value.before) ||
    value.before.length > 5000 ||
    value.before.some(
      (row: unknown) => !Array.isArray(row) || row.length !== 14 || row.some((cell: unknown) => !isCell(cell)),
    ) ||
    !Array.isArray(value.values) ||
    value.values.length !== 12 ||
    value.values.some((v: unknown) => typeof v !== "string" && (typeof v !== "number" || !Number.isFinite(v)))
  )
    throw new Error("invalid ledger checkpoint");
  return { before: value.before as LedgerCell[][], values: value.values as (string | number)[] };
}
