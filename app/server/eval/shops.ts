/**
 * 평가용 합성 가게 셋(TASK-027; REQ-139). 이름·규정·옵션은 이 평가를 위해 지은 것이고 실제 가게가 아니다.
 *
 * - AI 입력에는 04 AI-1 '입력'대로 가게 이름, 운영규정(현재 버전), 옵션 이름이 들어간다. 가격표의 금액은 넣지 않는다.
 *   금액은 서버가 계산한 값(사례의 quote)만 AI에 간다(SPEC-013 'AI 상담은 이 계산값만 씀').
 * - 운영규정 글은 AI-1의 '조문 읽기' 도구가 돌려줄 글을 미리 넣은 것이다(기준 프롬프트 버전 0은 도구 없이 부름, prompt-v0.ts).
 * - 처리방침 주소는 풀리지 않는 이름(RFC 2606 .invalid)이다. 서버의 AI 상담 고지(SPEC-018)를 매길 때 이 주소를 찾는다.
 */
import type { ShopKey } from "./types";

export interface EvalShop {
  readonly key: ShopKey;
  /** ai_calls 꼴 결과의 shop_id(합성, 데이터베이스에 없음). */
  readonly id: string;
  readonly name: string;
  readonly policyUrl: string;
  readonly options: {
    readonly sizes: readonly string[];
    readonly flavors: readonly string[];
    readonly designs: readonly string[];
    readonly extras: readonly string[];
  };
  readonly regulationVersion: number;
  readonly articles: readonly { readonly no: number; readonly title: string; readonly text: string }[];
  /**
   * 운영규정 조문의 영업·픽업 시간(가게 시간대 'HH:MM', 양 끝 포함)과 쉬는 요일(0=일요일). 답의 날짜·시각을 서버 판단과
   * 견줄 때 쓴다(judgment.ts). 조문 글과 같은지 시험이 본다(test/eval-score.test.ts).
   */
  readonly hours: { readonly open: string; readonly close: string };
  readonly closedWeekdays: readonly number[];
  /**
   * 운영규정 조문의 때별 규칙(픽업 며칠 전, 0=당일). change·cancel은 변경·취소를 받는 가장 늦은 날(그날 이전이면 받음),
   * refund는 [며칠 전부터, 환불 비율 %]를 며칠 전이 큰 차례로 둔 표다. 조문에 없는 규칙은 비워 둔다(그 말을 하면 사람 검토).
   * 답의 변경·취소·환불 말을 견줄 때 쓴다(judgment.ts). 조문 글과 같은지 시험이 본다(test/eval-score.test.ts).
   */
  readonly timed: {
    readonly change?: number;
    readonly cancel?: number;
    readonly refund?: readonly (readonly [fromDays: number, percent: number])[];
  };
}

export const EVAL_SHOPS: Readonly<Record<ShopKey, EvalShop>> = {
  S1: {
    key: "S1",
    hours: { open: "11:00", close: "20:00" },
    closedWeekdays: [1],
    timed: {
      change: 3,
      cancel: 0,
      refund: [
        [3, 100],
        [2, 50],
        [0, 0],
      ],
    },
    id: "00000000-0000-4000-8000-0000000e0001",
    name: "가나다 케이크(시험 가게)",
    policyUrl: "https://shop-s1.example.invalid/privacy",
    options: {
      sizes: ["미니", "1호", "2호", "3호"],
      flavors: ["생크림", "초코", "고구마"],
      designs: ["기본 레터링", "꽃 데코", "캐릭터 디자인"],
      extras: ["초", "칼", "토퍼", "메시지 카드"],
    },
    regulationVersion: 2,
    articles: [
      {
        no: 1,
        title: "영업 시간과 픽업",
        text: "픽업은 가게에서 화요일부터 일요일 11:00~20:00에 합니다. 월요일은 쉽니다.",
      },
      {
        no: 2,
        title: "주문 변경과 취소",
        text: "주문 변경은 픽업 3일 전까지 받습니다. 취소하면 픽업 3일 전까지는 전액, 2일 전에는 결제 금액의 50%를 환불하고, 전날과 당일에는 환불하지 않습니다.",
      },
      { no: 3, title: "결제", text: "결제는 계좌 이체로 받고, 결제 기한은 주문 수락 뒤 24시간입니다." },
      { no: 4, title: "퀵으로 받기", text: "손님이 부른 퀵으로 받을 수 있고 퀵 비용은 손님이 냅니다." },
    ],
  },
  S2: {
    key: "S2",
    hours: { open: "12:00", close: "19:00" },
    closedWeekdays: [1, 2],
    timed: {
      change: 2,
      cancel: 0,
      refund: [
        [2, 100],
        [0, 0],
      ],
    },
    id: "00000000-0000-4000-8000-0000000e0002",
    name: "마바사 디저트(시험 가게)",
    policyUrl: "https://shop-s2.example.invalid/privacy",
    options: {
      sizes: ["미니", "1호", "2호", "2단"],
      flavors: ["바닐라", "딸기", "얼그레이"],
      designs: ["기본", "레터링", "그림 디자인"],
      extras: ["초", "폭죽 초", "토퍼"],
    },
    regulationVersion: 1,
    articles: [
      { no: 1, title: "영업 시간", text: "수요일부터 일요일 12:00~19:00에 엽니다. 월요일과 화요일은 쉽니다." },
      {
        no: 2,
        title: "변경과 취소",
        text: "변경은 픽업 2일 전까지 받습니다. 취소는 픽업 2일 전까지 전액 환불하고 그 뒤에는 환불하지 않습니다.",
      },
      { no: 3, title: "2단 케이크", text: "2단 케이크는 맞춤 주문이라 사장님이 디자인을 보고 금액을 정합니다." },
    ],
  },
  S3: {
    key: "S3",
    hours: { open: "10:00", close: "18:00" },
    closedWeekdays: [],
    timed: { cancel: 3 },
    id: "00000000-0000-4000-8000-0000000e0003",
    name: "아자차 베이크(시험 가게)",
    policyUrl: "https://shop-s3.example.invalid/privacy",
    options: {
      sizes: ["1호", "2호"],
      flavors: ["생크림", "초코"],
      designs: ["기본", "레터링"],
      extras: ["초"],
    },
    regulationVersion: 1,
    articles: [
      { no: 1, title: "픽업", text: "픽업은 가게에서 10:00~18:00에 합니다." },
      { no: 2, title: "취소", text: "취소는 픽업 3일 전까지 받습니다." },
    ],
  },
};

/** 평가 사례의 '오늘'(가게 시간대). AI 입력에 넣어 '이번 주 토요일' 같은 말을 풀게 한다. */
export const EVAL_TODAY = "2026-11-16(월) 14:00";
