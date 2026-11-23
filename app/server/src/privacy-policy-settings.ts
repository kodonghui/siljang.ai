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
  origin: string;
  transfers: readonly OverseasTransfer[];
}

const LIMITS = { recipient: 200, country: 100, whenAndHow: 500, purposeAndRetention: 500, howToRefuse: 1000 } as const;
const AI_DATA = "상담 대화와 도안 사진. 주문자 이름·연락처·입금자 이름·알레르기 정보는 제외합니다.";
const SERVER_DATA = "상담 대화·도안 사진·주문 기록, 주문자 이름·연락처·입금자 이름과 따로 동의한 알레르기 정보";

/** 빠진/잘못된 설정은 이 기능만 미충족으로 둔다. 다른 API나 상태 확인을 막지 않는다. */
export function readPrivacyPolicySettings(
  env: Readonly<Record<string, unknown>>,
  provider: AiProvider | undefined,
): PrivacyPolicySettings | null {
  if (
    provider === undefined ||
    typeof env.PUBLIC_APP_ORIGIN !== "string" ||
    typeof env.PRIVACY_TRANSFER_SETTINGS !== "string"
  )
    return null;
  let origin: URL;
  try {
    origin = new URL(env.PUBLIC_APP_ORIGIN);
  } catch {
    return null;
  }
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    return null;
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
    if (!["anthropic", "openai", "supabase", "cloudflare"].includes(String(entry.provider))) return null;
    if (Object.keys(entry).length !== 6) return null;
    const fields = {} as Omit<OverseasTransfer, "personalData">;
    for (const [key, max] of Object.entries(LIMITS)) {
      const value = entry[key];
      if (typeof value !== "string" || value.trim() === "" || [...value].length > max || value.includes("\0"))
        return null;
      fields[key as keyof typeof LIMITS] = value.trim();
    }
    if (entry.provider !== provider && entry.provider !== "supabase" && entry.provider !== "cloudflare") continue;
    seen.add(String(entry.provider));
    transfers.push({ ...fields, personalData: entry.provider === provider ? AI_DATA : SERVER_DATA });
  }
  if (![provider, "supabase", "cloudflare"].every((name) => seen.has(name))) return null;
  return { origin: origin.origin, transfers };
}
