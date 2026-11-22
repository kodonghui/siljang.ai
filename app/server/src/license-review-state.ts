/** 가게·지금 계좌·대기 중인 신원 변경을 함께 가리키는 불투명 버전. */
import { toBase64Url } from "./encoding";

export interface ReviewState {
  readonly revision_state: string;
  readonly review_marker: string;
}

async function hash(value: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

export async function reviewRevision(row: ReviewState): Promise<string> {
  return `${await hash(row.revision_state)}.${(await hash(row.review_marker)).slice(0, 16)}`;
}

export interface ReviewSummaryRow extends ReviewState {
  readonly id: string;
  readonly name: string;
  readonly business_name: string;
  readonly representative_name: string;
  readonly business_reg_no: string;
  readonly food_license_no: string;
  readonly food_business_type: string;
  readonly license_status: string;
  readonly duplicate: boolean;
  readonly created_at: Date;
  readonly time_zone: string;
  readonly cursor_at: string;
}
