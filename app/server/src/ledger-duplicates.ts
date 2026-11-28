export interface LedgerCandidateRow {
  readonly index: number;
  readonly owned: readonly unknown[];
  readonly other: readonly unknown[];
}

/** 삭제는 같은 ID·같은 값에 더해 사장님 열이 비어 있는 중복 행만 허용한다. */
export function planLedgerDuplicateCleanup(
  rows: readonly LedgerCandidateRow[],
  id: string,
  expected: readonly unknown[],
) {
  if (!id || expected.length === 0 || expected.at(-1) !== id) throw new TypeError("invalid ledger ID");
  if (rows.some((row) => !Number.isSafeInteger(row.index) || row.index < 1)) throw new TypeError("invalid ledger row");
  const matching = rows.filter((row) => row.owned.at(-1) === id).sort((a, b) => a.index - b.index);
  if (matching.length < 2) return { remove: [] as number[], attention: false };
  const remove: number[] = [];
  let attention = false;
  for (const row of matching.slice(1)) {
    const oursMatch = row.owned.length === expected.length && row.owned.every((value, i) => value === expected[i]);
    const otherEmpty = row.other.every((value) => value === "" || value === null || value === undefined);
    if (oursMatch && otherEmpty) remove.push(row.index);
    else attention = true;
  }
  return { remove, attention };
}
