// 사장님·운영자 화면의 메뉴와 화면마다 속한 1뎁스(TASK-182, 08 W4, 09 방향 A).
// 메뉴 항목·순서·이름은 08 README W4, 화면 ID·주소·1뎁스는 07 sitemap.yaml을 따른다(layout.test.tsx가 대조).
// 손님 화면(카카오)과 사장님 알림(SCR-019, 카카오톡 서비스 채널)은 이 메뉴 밖이다.

export type MenuShell = "owner" | "operator";

export interface MenuItem {
  /** 메뉴에 보이는 이름(08 W4) */
  readonly label: string;
  /** 그 1뎁스 화면(07) */
  readonly screen: string;
  /** 07 경로 */
  readonly path: string;
}

/** 사장님 메뉴 7개: 07 화면 트리 사장님 로그인(SCR-014) 아래 1뎁스에서 가게 등록(SCR-015)을 뺀 것 */
export const OWNER_MENU: readonly MenuItem[] = [
  { label: "할 일", screen: "SCR-016", path: "/owner" },
  { label: "주문", screen: "SCR-020", path: "/owner/orders" },
  { label: "입금 대조", screen: "SCR-028", path: "/owner/payment-requests" },
  { label: "제작", screen: "SCR-030", path: "/owner/production" },
  { label: "픽업", screen: "SCR-031", path: "/owner/pickups" },
  { label: "영업 캘린더", screen: "SCR-032", path: "/owner/calendar" },
  { label: "가게 설정", screen: "SCR-034", path: "/owner/shop" },
];

/**
 * 운영자 메뉴 2개(08 W4·SCR-047 정의·09). 07의 운영자 1뎁스는 셋(SCR-047·049·050)이지만 가게 기록 보기(SCR-050)는
 * 영업 신고 확인(SCR-048)에서 여는 화면이라 메뉴에 두지 않고 '영업 신고 확인'을 표시한다(09 목업과 같음).
 */
export const OPERATOR_MENU: readonly MenuItem[] = [
  { label: "영업 신고 확인", screen: "SCR-047", path: "/operator/shops" },
  { label: "운영자 알림", screen: "SCR-049", path: "/operator/alerts" },
];

export const MENUS: Readonly<Record<MenuShell, readonly MenuItem[]>> = { owner: OWNER_MENU, operator: OPERATOR_MENU };

/** 메뉴의 접근성 이름(09 README 5절 '정의에 없는 접근성 이름') */
export const MENU_NAME: Readonly<Record<MenuShell, string>> = { owner: "사장님 메뉴", operator: "운영자 메뉴" };
/** 메뉴 머리의 이름(09 목업) */
export const MENU_BRAND: Readonly<Record<MenuShell, string>> = { owner: "Siljang 사장님", operator: "Siljang 운영자" };
/** 360 위쪽 막대의 아이콘 버튼(09) */
export const OPEN_MENU_LABEL = "메뉴 열기";
export const GO_BACK_LABEL = "뒤로";
/** 360 열린 메뉴를 닫는 버튼(09에 그리지 않은 상태라 이 작업에서 붙인 이름) */
export const CLOSE_MENU_LABEL = "메뉴 닫기";
/** 운영자 메뉴 아래(09 목업) */
export const LOGOUT_LABEL = "로그아웃";

/**
 * 화면 → 그 화면이 속한 1뎁스 메뉴 화면. 07 화면 트리의 1뎁스 조상이고, 가게 기록 보기(SCR-050)만 '영업 신고 확인'(SCR-047)이다
 * (TASK-182 끝난 조건, 09 목업). 메뉴가 있는 사장님·운영자 웹 화면만 둔다.
 */
export const SCREEN_SECTION: Readonly<Record<string, string>> = {
  "SCR-016": "SCR-016",
  "SCR-017": "SCR-016",
  "SCR-018": "SCR-016",
  "SCR-020": "SCR-020",
  "SCR-021": "SCR-020",
  "SCR-022": "SCR-020",
  "SCR-023": "SCR-020",
  "SCR-024": "SCR-020",
  "SCR-025": "SCR-020",
  "SCR-026": "SCR-020",
  "SCR-027": "SCR-020",
  "SCR-028": "SCR-028",
  "SCR-029": "SCR-028",
  "SCR-030": "SCR-030",
  "SCR-031": "SCR-031",
  "SCR-032": "SCR-032",
  "SCR-033": "SCR-032",
  "SCR-034": "SCR-034",
  "SCR-035": "SCR-034",
  "SCR-036": "SCR-034",
  "SCR-037": "SCR-034",
  "SCR-038": "SCR-034",
  "SCR-039": "SCR-034",
  "SCR-040": "SCR-034",
  "SCR-041": "SCR-034",
  "SCR-042": "SCR-034",
  "SCR-043": "SCR-034",
  "SCR-044": "SCR-034",
  "SCR-045": "SCR-034",
  "SCR-047": "SCR-047",
  "SCR-048": "SCR-047",
  "SCR-049": "SCR-049",
  "SCR-050": "SCR-047",
};

/** 그 화면이 속한 메뉴 항목. 메뉴가 없는 화면이거나 그 메뉴의 화면이 아니면 오류(화면 작업의 잘못) */
export function sectionOf(shell: MenuShell, screen: string): MenuItem {
  const section = SCREEN_SECTION[screen];
  const item = MENUS[shell].find((m) => m.screen === section);
  if (item === undefined) throw new Error(`${screen}은(는) ${MENU_NAME[shell]}의 화면이 아님`);
  return item;
}

/** 메뉴 항목 화면 자체인지(360 위쪽 막대의 첫 버튼이 '메뉴 열기'). 아니면 '뒤로'(08 레이아웃의 ←) */
export function isMenuScreen(shell: MenuShell, screen: string): boolean {
  return MENUS[shell].some((m) => m.screen === screen);
}
