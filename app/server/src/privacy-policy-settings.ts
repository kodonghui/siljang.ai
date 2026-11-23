/** TASK-044. 받는 회사·나라는 배포 설정에서만 받고 개인정보 항목은 서버의 처리 범위로 정한다. */
import type { AiProvider } from "./ai-prices";

export interface OverseasTransfer {
  recipient: string;
  country: string;
  personalData: string;
  whenAndHow: string;
  purposeAndRetention: string;
  howToRefuse: string;
}
export interface PrivacyPolicySettings {
  transfers: readonly OverseasTransfer[];
}

const LIMITS = { recipient: 200, country: 100, whenAndHow: 500, purposeAndRetention: 500, howToRefuse: 1000 } as const;
const AI_DATA = "개인정보를 가린 상담 대화와 도안 사진";
const SERVER_DATA = "상담 대화·도안 사진·주문 기록, 주문자 이름·연락처·입금자 이름과 따로 동의한 알레르기 정보";

/** 빠진/잘못된 설정은 이 기능만 미충족으로 둔다. 다른 API나 상태 확인을 막지 않는다. */
export function readPrivacyPolicySettings(
  env: Readonly<Record<string, unknown>>,
  provider: AiProvider | undefined,
): PrivacyPolicySettings | null {
  const origin = readPublicAppOrigin(env.PUBLIC_APP_ORIGIN);
  if (provider === undefined || origin === null || typeof env.PRIVACY_TRANSFER_SETTINGS !== "string") return null;
  let records: unknown;
  try {
    records = JSON.parse(env.PRIVACY_TRANSFER_SETTINGS);
  } catch {
    return null;
  }
  if (!Array.isArray(records) || records.length < 3 || records.length > 20) return null;
  const transfers: OverseasTransfer[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    if (typeof record !== "object" || record === null || Array.isArray(record)) return null;
    const entry = record as Record<string, unknown>;
    if (
      typeof entry.provider !== "string" ||
      !["anthropic", "openai", "supabase", "cloudflare"].includes(entry.provider)
    )
      return null;
    if (Object.keys(entry).length !== 6) return null;
    const fields = {} as Omit<OverseasTransfer, "personalData">;
    for (const [key, max] of Object.entries(LIMITS)) {
      const value = entry[key];
      if (typeof value !== "string" || value.trim() === "" || [...value].length > max || value.includes("\0"))
        return null;
      fields[key as keyof typeof LIMITS] = value.trim();
    }
    if (seen.has(entry.provider)) return null;
    seen.add(entry.provider);
    if (entry.provider !== provider && entry.provider !== "supabase" && entry.provider !== "cloudflare") continue;
    transfers.push({ ...fields, personalData: entry.provider === provider ? AI_DATA : SERVER_DATA });
  }
  if (![provider, "supabase", "cloudflare"].every((name) => seen.has(name))) return null;
  return { transfers };
}

export function readPublicAppOrigin(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
      return null;
    return url.origin;
  } catch {
    return null;
  }
}
