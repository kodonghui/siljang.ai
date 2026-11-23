/** SCR-015의401 복구. 같은 사장님의 글 값만 이 탭에서1시간 보관하고 사진/동의는 저장하지 않는다. */
export const REGISTRATION_DRAFT_KEY = "siljang.owner.registration";
export const REGISTRATION_DRAFT_TTL_MS = 60 * 60 * 1000;
export const REGISTRATION_TEXT_FIELDS = [
  "name",
  "contactPhone",
  "businessAddress",
  "contactEmail",
  "businessName",
  "representativeName",
  "businessRegNo",
  "mailOrderRegNo",
  "mailOrderAuthority",
  "mailOrderExemption",
  "foodLicenseNo",
  "foodBusinessType",
] as const;
export type RegistrationField = (typeof REGISTRATION_TEXT_FIELDS)[number];
export type RegistrationValues = Record<RegistrationField, string>;
export const EMPTY_REGISTRATION = Object.fromEntries(
  REGISTRATION_TEXT_FIELDS.map((key) => [key, ""]),
) as RegistrationValues;
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
function session(): DraftStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}
export function clearRegistrationDraft(storage: DraftStorage | undefined = session()): void {
  if (expiryTimer !== undefined) {
    clearTimeout(expiryTimer);
    expiryTimer = undefined;
  }
  try {
    storage?.removeItem(REGISTRATION_DRAFT_KEY);
  } catch {
    /* 저장소를 막아도 등록/로그아웃은 동작한다. */
  }
}
export function saveRegistrationDraft(
  ownerId: string,
  values: RegistrationValues,
  now = Date.now(),
  storage: DraftStorage | undefined = session(),
): void {
  const text = Object.fromEntries(REGISTRATION_TEXT_FIELDS.map((key) => [key, values[key]]));
  try {
    if (!storage) return;
    const serialized = JSON.stringify({ ownerId, savedAt: now, values: text });
    storage.setItem(REGISTRATION_DRAFT_KEY, serialized);
    if (expiryTimer !== undefined) clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => {
      try {
        if (storage.getItem(REGISTRATION_DRAFT_KEY) === serialized) clearRegistrationDraft(storage);
      } catch {
        /* 저장소가 막혀도 화면을 멈추지 않는다. */
      }
    }, REGISTRATION_DRAFT_TTL_MS);
  } catch {
    /* 비밀 값이나 입력을 로그에 쓰지 않는다. */
  }
}
export function readRegistrationDraft(
  ownerId: string,
  now = Date.now(),
  storage: DraftStorage | undefined = session(),
): RegistrationValues | null {
  try {
    const raw = storage?.getItem(REGISTRATION_DRAFT_KEY);
    if (!raw) return null;
    const item: unknown = JSON.parse(raw);
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error("invalid_draft");
    const draft = item as Record<string, unknown>;
    if (
      draft.ownerId !== ownerId ||
      typeof draft.savedAt !== "number" ||
      !Number.isFinite(draft.savedAt) ||
      draft.savedAt > now ||
      now - draft.savedAt >= REGISTRATION_DRAFT_TTL_MS ||
      typeof draft.values !== "object" ||
      draft.values === null ||
      Array.isArray(draft.values)
    )
      throw new Error("expired_or_other_owner");
    const fields = draft.values as Record<string, unknown>;
    if (REGISTRATION_TEXT_FIELDS.some((key) => typeof fields[key] !== "string" || (fields[key] as string).length > 400))
      throw new Error("invalid_fields");
    return Object.fromEntries(REGISTRATION_TEXT_FIELDS.map((key) => [key, fields[key]])) as RegistrationValues;
  } catch {
    clearRegistrationDraft(storage);
    return null;
  }
}
