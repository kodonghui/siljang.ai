/**
 * 서버 안의 일 등록부(TASK-023). 06 README 10절(api/openapi.yaml의 components.x-corthex.jobs)의 13개가 모두 여기 있다.
 * test/jobs.test.ts가 06과 견주어 하나라도 빠지거나 06에 새 일이 생기면 실패하고, 맡는 작업이 WBS에 그 SPEC으로 있는지,
 * TASK-023 뒤에 오는지도 본다.
 *
 * - runs: 도는 꼴. minute(1분마다 찾음), shop_time(가게가 정한 시각의 일. 그 시각을 time.ts로 UTC로 바꿔 행의 때에 두면
 *   1분마다 찾힘), day(하루 한 번 03:00 Asia/Seoul = UTC 18:00, 그날 시작 표시는 ops_events의 purge_run),
 *   request(요청 안에서 응답과 같은 트랜잭션으로 하는 일. 실행기가 돌리지 않음).
 * - sources: 찾을 곳(due-sources.ts). 빈 것은 맡는 작업이 05의 인덱스를 보고 정한다(note에 적음).
 * - 처리(handler)는 맡는 작업이 JOB_HANDLERS에 더한다. 이번에는 바탕만 두어 처리가 붙은 일이 없다.
 */
import type { DueSourceName } from "./due-sources";
import type { ItemHandler, RunnableJob } from "./job-runner";

export type JobCadence =
  | { readonly every: "minute" }
  | { readonly every: "shop_time" }
  | { readonly every: "day"; readonly at: string; readonly timeZone: string; readonly marker: "purge_run" }
  | { readonly every: "request" };

export interface JobEntry {
  /** 06 10절의 SPEC. */
  readonly spec: string;
  /** 로그와 가게 범위의 출처에 쓰는 이름(소문자·숫자·_). */
  readonly name: string;
  /** 처리를 맡는 작업(WBS). */
  readonly task: string;
  readonly runs: JobCadence;
  readonly sources: readonly DueSourceName[];
  /** 무엇을 기다리는지, 아직 정하지 않은 것은 맡는 작업이 무엇을 정하는지. */
  readonly note: string;
}

const MINUTE = { every: "minute" } as const;
const SHOP_TIME = { every: "shop_time" } as const;

export const JOBS: readonly JobEntry[] = [
  {
    spec: "SPEC-024",
    name: "owner_wait",
    task: "TASK-075",
    runs: MINUTE,
    sources: ["owner_task_wait", "handoff_open"],
    note: "기다리는 시간이 지난 할 일(지연 안내·다시 알림)과 남긴 지 7일 된 열린 에스컬레이션 건(기준 시각 지금 − 7일). 맞춤 주문 요청의 주문 마감·변경 요청의 변경 마감으로 닫기는 TASK-075가 05 인덱스를 보고 곳을 더함",
  },
  {
    spec: "SPEC-025",
    name: "consultation_idle",
    task: "TASK-076",
    runs: MINUTE,
    sources: [],
    note: "문의 끊김·상담 끝남. 가게마다 끊김 시간이 달라(API-010) TASK-076이 consultations_idle_idx·consultations_ordered_idx로 찾는 꼴을 정함",
  },
  {
    spec: "SPEC-037",
    name: "payment_due",
    task: "TASK-098",
    runs: MINUTE,
    sources: ["payment_due", "payment_claim_cap"],
    note: "결제 기한이 지난 첫 결제·다시 낸 결제 안내, 결제 기한 상한이 지난 확인 요청",
  },
  {
    spec: "SPEC-044",
    name: "difference_due",
    task: "TASK-119",
    runs: MINUTE,
    sources: ["difference_due", "difference_claim_cap"],
    note: "기한이 지난 차액 결제 안내, 결제 기한 상한(변경 마감)이 지난 차액 결제의 확인 요청",
  },
  {
    spec: "SPEC-052",
    name: "day_before_notice",
    task: "TASK-134",
    runs: SHOP_TIME,
    sources: [],
    note: "전날 안내 행을 가게가 정한 시각(scheduled_for)으로 만들고 그 시각을 next_attempt_at에도 두면 SPEC-066의 notification_send가 보냄. 만드는 때는 TASK-134가 정함",
  },
  {
    spec: "SPEC-061",
    name: "review_request",
    task: "TASK-144",
    runs: SHOP_TIME,
    sources: [],
    note: "후기 부탁 행을 인도 다음 날 가게가 정한 시각으로 만들면 notification_send가 보냄. 보내기 직전 문제 신고·재제작 주문 다시 보기는 TASK-144가 보내는 처리에 더함",
  },
  {
    spec: "SPEC-064",
    name: "ledger_write",
    task: "TASK-157",
    runs: MINUTE,
    sources: ["ledger_write"],
    note: "장부 쓰기와 다시 적기(retry.ts의 nextLedgerAttemptAt). 구글 시트 호출은 leased 처리, 24시간 실패 알림은 TASK-157",
  },
  {
    spec: "SPEC-065",
    name: "purge",
    task: "TASK-158",
    runs: { every: "day", at: "03:00", timeZone: "Asia/Seoul", marker: "purge_run" },
    sources: [],
    note: "지난 기록 지우기 여덟 차례. 지울 곳(consultations_dropped_idx·consultations_ended_idx·kept_records_issue_due_idx 등)과 지운 수·남은 수 기록은 TASK-158",
  },
  {
    spec: "SPEC-066",
    name: "customer_notice",
    task: "TASK-104",
    runs: MINUTE,
    sources: ["notification_send", "notification_check"],
    note: "손님 안내 보내기(G4 다시 보내기)와 발송 결과 조회(1·5·30분). 카카오 Event API 호출은 leased 처리",
  },
  {
    spec: "SPEC-067",
    name: "owner_alert",
    task: "TASK-072",
    runs: MINUTE,
    sources: ["owner_alert_send", "owner_alert_check"],
    note: "사장님 알림 보내기(1분 안 같은 종류 묶음, G4)와 발송 결과 조회(1·5·30분). 카카오 Event API 호출은 leased 처리",
  },
  {
    spec: "SPEC-008",
    name: "channel_check",
    task: "TASK-043",
    runs: MINUTE,
    sources: [],
    note: "연결 확인 10분과 '연결 확인 중' 선점(kakao_channels.claim_expires_at). 05에 그 때의 인덱스가 없어 TASK-043이 정함",
  },
  {
    spec: "SPEC-074",
    name: "access_log",
    task: "TASK-024",
    runs: { every: "request" },
    sources: [],
    note: "접속기록은 사장님·운영자 API가 응답과 같은 트랜잭션에서 남김(SPEC-074). 06 10절이 서버 안의 일로 세어 완결 시험이 13개를 다 보도록 등록부에 두되 실행기는 돌리지 않음",
  },
  {
    spec: "SPEC-047",
    name: "refund_send_realert",
    task: "TASK-123",
    runs: MINUTE,
    sources: [],
    note: "환불을 정한 뒤 24시간 동안 '보냄'이 없으면 한 번 다시 알림. 찾을 곳(할 일의 기다림이나 환불 행)은 TASK-123이 05 인덱스를 보고 정함",
  },
];

export type JobName = string;

/** 처리. 맡는 작업이 이름으로 더한다(cutoff는 지난 시간으로 세는 곳의 기준 시각). */
export interface JobHandlerEntry {
  readonly handler: ItemHandler;
  readonly cutoff?: (source: DueSourceName, now: Date) => Date;
}

/** 처리가 붙은 일. 이번에는 없다(맡는 작업이 더함). */
export const JOB_HANDLERS: Readonly<Record<JobName, JobHandlerEntry>> = {};

/** 등록부와 처리로 실행기에 넘길 일을 만든다. 처리가 없거나 요청 안에서 하는 일은 빠진다. */
export function runnableJobs(
  entries: readonly JobEntry[] = JOBS,
  handlers: Readonly<Record<JobName, JobHandlerEntry>> = JOB_HANDLERS,
): RunnableJob[] {
  const out: RunnableJob[] = [];
  for (const e of entries) {
    const h = Object.hasOwn(handlers, e.name) ? handlers[e.name] : undefined;
    if (h === undefined || e.runs.every === "request") continue;
    const common = {
      name: e.name,
      sources: e.sources,
      handler: h.handler,
      ...(h.cutoff !== undefined ? { cutoff: h.cutoff } : {}),
    };
    if (e.runs.every === "day") {
      out.push({ ...common, every: "day", at: e.runs.at, timeZone: e.runs.timeZone, marker: e.runs.marker });
    } else {
      out.push({ ...common, every: "minute" });
    }
  }
  return out;
}
