/** SCR010 표시 전용. 신고 내용 저장·손님 확인·명령은 업무 처리기가 맡는다. */
export interface KakaoIssueReportCard {
  readonly orderNo: string;
  readonly receivedAt: string;
  readonly description: string;
  readonly photoCount: number;
  readonly showMedicalNotice: boolean;
  readonly expiresAt: string;
  readonly timeZone: string;
  readonly cardKey: string;
  readonly blockId: string;
}
export type KakaoIssueReportView =
  | ({ readonly state: "normal" | "stale" | "expired" } & KakaoIssueReportCard)
  | { readonly state: "stale"; readonly reason: "not_received" }
  | { readonly state: "done"; readonly outcome: "issue_reported" | "declined" }
  | { readonly state: "permission"; readonly reason: "card_not_yours" }
  | { readonly state: "permission"; readonly reason: "not_accepting"; readonly contactPhone: string }
  | { readonly state: "error"; readonly reason: "retry_needed" | "server_error" };
export type KakaoIssueReportOutput =
  | { readonly simpleText: { readonly text: string } }
  | {
      readonly textCard: {
        readonly title: string;
        readonly description: string;
        readonly buttons: readonly {
          readonly label: string;
          readonly action: "block";
          readonly blockId: string;
          readonly extra: { readonly cardKey: string; readonly choice: "confirm" | "decline" };
        }[];
      };
    };
export interface KakaoIssueReportBody {
  readonly version: "2.0";
  readonly template: { readonly outputs: readonly KakaoIssueReportOutput[] };
}
/** 초기 실패 시험의 빈 표시. 상태별 구현과 공통 발신 연결은 다음 커밋에서 채운다. */
export function kakaoIssueReportMessage(_view: KakaoIssueReportView): KakaoIssueReportBody {
  return { version: "2.0", template: { outputs: [] } };
}
