import { readBytesLimited } from "./body";
import { GoogleLedgerUnavailableError } from "./ledger-google-auth";
import { LEDGER_HEADERS, ledgerColumnName } from "./ledger-sheet-columns";
import type { LedgerSheetSetup } from "./ledger-sheet-setup";
import type { Secret } from "./settings";
import { isUuid } from "./shop-scope";

/** 같은 이벤트는 원자적 메타데이터 ID와 셀 쓰기를 함께 적용한다. */
export async function writeLedgerSheet(
  input: {
    readonly file: string;
    readonly tab: string;
    readonly access: Secret;
    readonly setup: LedgerSheetSetup;
    readonly values: readonly (string | number)[];
    readonly shopId: string;
    readonly linkId: string;
    readonly eventId: string;
  },
  options: { readonly fetch?: typeof fetch; readonly timeoutMs?: number } = {},
): Promise<void> {
  if (
    !/^[A-Za-z0-9_-]{20,100}$/.test(input.file) ||
    !/^[0-9A-Z]{6,8}$/.test(String(input.values[0])) ||
    input.values.length !== LEDGER_HEADERS.length ||
    input.setup.end !== input.setup.start + LEDGER_HEADERS.length ||
    !isUuid(input.shopId) ||
    !isUuid(input.linkId) ||
    !isUuid(input.eventId) ||
    input.tab.length < 1 ||
    input.tab.length > 100
  )
    throw new TypeError("invalid ledger row");
  const first = ledgerColumnName(input.setup.start),
    tab = `'${input.tab.replaceAll("'", "''")}'`,
    base = `https://sheets.googleapis.com/v4/spreadsheets/${input.file}`,
    send = options.fetch ?? fetch;
  async function request(
    url: string,
    method: string,
    body?: string,
    allowMissing = false,
  ): Promise<Record<string, unknown> | null> {
    const response = await send(url, {
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
      if (allowMissing && response.status === 404) return null;
      throw new GoogleLedgerUnavailableError();
    }
    const raw: unknown = JSON.parse(
      new TextDecoder().decode(
        await readBytesLimited(response, 2 * 1024 * 1024, () => new GoogleLedgerUnavailableError()),
      ),
    );
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new GoogleLedgerUnavailableError();
    return raw as Record<string, unknown>;
  }
  try {
    const lookup = new URL(`${base}/values/${encodeURIComponent(`${tab}!${first}:${first}`)}`);
    lookup.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");
    const data = await request(lookup.href, "GET"),
      rows = data?.values ?? [];
    if (!Array.isArray(rows) || rows.length > 100000 || rows.some((row) => !Array.isArray(row) || row.length > 1))
      throw new GoogleLedgerUnavailableError();
    const matches = rows.flatMap((row, index) => (index > 0 && row[0] === input.values[0] ? [index] : []));
    if (matches.length > 1) throw new GoogleLedgerUnavailableError();
    const row = matches[0];
    // 기존 마커가 있고 행도 있으면 앞 요청이 이미 적용됐다. 삭제된 행은 새 세대로 복구한다.
    for (let generation = 0; generation < 100; generation++) {
      const marker = `${input.shopId.toLowerCase()}:${input.linkId.toLowerCase()}:${input.eventId.toLowerCase()}:${input.setup.sheetId}:${input.setup.start}:${generation}`;
      for (let salt = 0; salt < 32; salt++) {
        const hash = new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`siljang-ledger:${marker}:${salt}`)),
        );
        const id = new DataView(hash.buffer).getUint32(0) & 0x7fffffff || 1;
        const existing = await request(`${base}/developerMetadata/${id}`, "GET", undefined, true);
        if (existing !== null) {
          if (
            existing.metadataKey !== "siljang_ledger_event_v1" ||
            existing.metadataValue !== marker ||
            existing.visibility !== "PROJECT"
          )
            continue;
          if (row !== undefined) return;
          break;
        }
        const cells = input.values.map((value) => ({
          userEnteredValue: typeof value === "number" ? { numberValue: value } : { stringValue: value },
        }));
        const write =
          row === undefined
            ? {
                appendCells: {
                  sheetId: input.setup.sheetId,
                  rows: [{ values: [...Array.from({ length: input.setup.start }, () => ({})), ...cells] }],
                  fields: "userEnteredValue",
                },
              }
            : {
                updateCells: {
                  start: { sheetId: input.setup.sheetId, rowIndex: row, columnIndex: input.setup.start },
                  rows: [{ values: cells }],
                  fields: "userEnteredValue",
                },
              };
        const body = JSON.stringify({
          requests: [
            write,
            {
              createDeveloperMetadata: {
                developerMetadata: {
                  metadataId: id,
                  metadataKey: "siljang_ledger_event_v1",
                  metadataValue: marker,
                  visibility: "PROJECT",
                  location: { sheetId: input.setup.sheetId },
                },
              },
            },
          ],
        });
        const result = await request(`${base}:batchUpdate`, "POST", body);
        if (result?.spreadsheetId !== input.file || !Array.isArray(result.replies) || result.replies.length !== 2)
          throw new GoogleLedgerUnavailableError();
        return;
      }
    }
    throw new GoogleLedgerUnavailableError();
  } catch {
    throw new GoogleLedgerUnavailableError();
  }
}
