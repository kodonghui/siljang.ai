/** 현재 손님의 모아 둔 신고 자료를 표시한다. 신고 접수·기한 판정·보상은 하지 않는다. */
import { CustomerNoticeTemporarilyUnavailable } from "./customer-notice-content";
import { sqlStateOf } from "./db";
import type { KakaoIssueReportCard } from "./kakao-issue-report-message";
import { normalizeLineBreaks } from "./line-breaks";
import { type ShopDb, withShopSavepoint } from "./shop-scope";

export interface IssueCardBinding {
  readonly detailsId: string;
  readonly sourceHash: string;
}
export type IssueCardSource =
  | {
      readonly available: true;
      readonly binding: IssueCardBinding;
      readonly presentation: Omit<KakaoIssueReportCard, "cardKey" | "blockId" | "expiresAt">;
    }
  | { readonly available: false; readonly reason: "not_received" | "not_ready"; readonly text: string };
function unavailable(reason: "not_received" | "not_ready"): IssueCardSource {
  return {
    available: false,
    reason,
    text: reason === "not_received" ? "지금은 할 수 없어요: 아직 받지 않은 주문이에요" : "잠시 뒤 다시 말씀해 주세요",
  };
}

async function readIssueCardSource(
  db: ShopDb,
  input: { readonly orderId: string; readonly customerId: string; readonly consultationId: string },
): Promise<IssueCardSource> {
  const source = (
    await db.run<{
      order_no: string;
      status: string;
      time_zone: string;
      handed_over_at: Date | null;
      details_id: string | null;
      description: string | null;
      health_concern: boolean | null;
      photos: { id: string; position: number }[];
    }>(
      "SELECT order_no,status,time_zone,handed_over_at,details_id,description,health_concern,photos FROM read_prepared_issue_card($1,$2,$3,$4)",
      [input.customerId, input.consultationId, input.orderId],
    )
  ).rows[0];
  if (source === undefined) return unavailable("not_ready");
  if (source.status !== "received") return unavailable("not_received");
  if (
    source.handed_over_at === null ||
    !Number.isFinite(source.handed_over_at.getTime()) ||
    source.details_id === null ||
    source.description === null ||
    source.health_concern === null
  )
    return unavailable("not_ready");
  const description = normalizeLineBreaks(source.description);
  if (!description.trim()) return unavailable("not_ready");
  const receivedAt = source.handed_over_at.toISOString();
  const data = [
    source.details_id,
    description,
    source.health_concern,
    source.photos.map((p) => [p.id, p.position]),
    receivedAt,
    source.order_no,
    source.time_zone,
  ];
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(data))));
  return {
    available: true,
    binding: {
      detailsId: source.details_id,
      sourceHash: [...hash].map((x) => x.toString(16).padStart(2, "0")).join(""),
    },
    presentation: {
      orderNo: source.order_no,
      description,
      photoCount: source.photos.length,
      showMedicalNotice: source.health_concern,
      receivedAt,
      timeZone: source.time_zone,
    },
  };
}

export async function readPreparedIssueCard(
  db: ShopDb,
  input: { readonly orderId: string; readonly customerId: string; readonly consultationId: string },
): Promise<IssueCardSource> {
  try {
    return await withShopSavepoint(db, (part) => readIssueCardSource(part, input));
  } catch (error) {
    if (sqlStateOf(error) === "42501") throw new CustomerNoticeTemporarilyUnavailable();
    throw error;
  }
}
