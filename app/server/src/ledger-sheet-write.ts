import { readBytesLimited } from "./body";
import { GoogleLedgerUnavailableError } from "./ledger-google-auth";
import { LEDGER_HEADERS, ledgerColumnName } from "./ledger-sheet-columns";
import type { LedgerSheetSetup } from "./ledger-sheet-setup";
import type { Secret } from "./settings";

/** 이미 소유권을 검증한 열에서 주문번호로 행을 찾아 RAW로만 쓴다. */
export async function writeLedgerSheet(
  input: {
    readonly file: string;
    readonly tab: string;
    readonly access: Secret;
    readonly setup: LedgerSheetSetup;
    readonly values: readonly (string | number)[];
  },
  options: { readonly fetch?: typeof fetch; readonly timeoutMs?: number } = {},
): Promise<void> {
  if (
    !/^[A-Za-z0-9_-]{20,100}$/.test(input.file) ||
    !/^[0-9A-Z]{6,8}$/.test(String(input.values[0])) ||
    input.values.length !== LEDGER_HEADERS.length ||
    input.setup.end !== input.setup.start + LEDGER_HEADERS.length ||
    input.tab.length < 1 ||
    input.tab.length > 100
  )
    throw new TypeError("invalid ledger row");
  const first = ledgerColumnName(input.setup.start),
    last = ledgerColumnName(input.setup.end - 1),
    tab = `'${input.tab.replaceAll("'", "''")}'`,
    base = `https://sheets.googleapis.com/v4/spreadsheets/${input.file}/values/`,
    send = options.fetch ?? fetch;
  async function request(url: URL, method: string, body?: string): Promise<Record<string, unknown>> {
    const response = await send(url.href, {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
      headers: {
        Authorization: `Bearer ${input.access.reveal()}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body }),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new GoogleLedgerUnavailableError();
    }
    const bytes = await readBytesLimited(response, 2 * 1024 * 1024, () => new GoogleLedgerUnavailableError());
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new GoogleLedgerUnavailableError();
    return parsed as Record<string, unknown>;
  }
  try {
    const lookup = new URL(base + encodeURIComponent(`${tab}!${first}:${first}`));
    lookup.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");
    const data = await request(lookup, "GET"),
      rows = data.values ?? [];
    if (!Array.isArray(rows) || rows.length > 100000 || rows.some((row) => !Array.isArray(row) || row.length > 1))
      throw new GoogleLedgerUnavailableError();
    const matches = rows.flatMap((row, index) => (index > 0 && row[0] === input.values[0] ? [index + 1] : []));
    if (matches.length > 1) throw new GoogleLedgerUnavailableError();
    const row = matches[0];
    const url = new URL(
      base +
        encodeURIComponent(row === undefined ? `${tab}!${first}:${last}` : `${tab}!${first}${row}:${last}${row}`) +
        (row === undefined ? ":append" : ""),
    );
    url.searchParams.set("valueInputOption", "RAW");
    if (row === undefined) url.searchParams.set("insertDataOption", "OVERWRITE");
    const result = await request(
      url,
      row === undefined ? "POST" : "PUT",
      JSON.stringify({ majorDimension: "ROWS", values: [input.values] }),
    );
    const updates = row === undefined ? result.updates : result;
    if (
      typeof updates !== "object" ||
      updates === null ||
      Array.isArray(updates) ||
      (updates as Record<string, unknown>).updatedRows !== 1
    )
      throw new GoogleLedgerUnavailableError();
  } catch {
    throw new GoogleLedgerUnavailableError();
  }
}
