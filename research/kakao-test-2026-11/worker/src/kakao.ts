// 카카오 스킬 응답 만들기. 꼴과 한도는 카카오비즈니스 가이드 '응답 타입별 JSON 포맷'과 '콜백 개발 가이드'(2026-11-15 확인).
// - template.outputs 1~3개, quickReplies 10개 이하
// - simpleText.text 1000자, textCard 단일형 title 50자·title+description 400자, 버튼 3개(세로), 버튼 이름 14자
// - 콜백을 쓰는 응답은 {version:"2.0", useCallback:true, data}이고 template는 쓰지 않음

export type QuickReply = {
  label: string;
  action: "message" | "block";
  messageText?: string;
  blockId?: string;
  extra?: Record<string, unknown>;
};

export type Button = {
  label: string;
  action: "webLink" | "message" | "block";
  webLinkUrl?: string;
  messageText?: string;
  blockId?: string;
  extra?: Record<string, unknown>;
};

export type Output = { simpleText: { text: string } } | { textCard: TextCard };

export type TextCard = { title?: string; description?: string; buttons?: Button[]; buttonLayout?: "vertical" | "horizontal" };

export type SkillResponse = {
  version: "2.0";
  template?: { outputs: Output[]; quickReplies?: QuickReply[] };
  useCallback?: boolean;
  data?: Record<string, unknown>;
};

export const LIMITS = { outputs: 3, quickReplies: 10, simpleText: 1000, cardTitle: 50, cardText: 400, buttons: 3, buttonLabel: 14 };

function clip(s: string, n: number): string {
  return [...s].length <= n ? s : [...s].slice(0, n - 1).join("") + "…";
}

function checkLabel(label: string): string {
  if ([...label].length > LIMITS.buttonLabel) throw new Error(`버튼 이름이 ${LIMITS.buttonLabel}자를 넘음: ${label}`);
  return label;
}

function checkQuickReplies(q?: QuickReply[]): QuickReply[] | undefined {
  if (!q || q.length === 0) return undefined;
  if (q.length > LIMITS.quickReplies) throw new Error(`바로가기 응답이 ${LIMITS.quickReplies}개를 넘음`);
  q.forEach((r) => checkLabel(r.label));
  return q;
}

export function simpleText(text: string, quickReplies?: QuickReply[]): SkillResponse {
  const qr = checkQuickReplies(quickReplies);
  return {
    version: "2.0",
    template: { outputs: [{ simpleText: { text: clip(text, LIMITS.simpleText) } }], ...(qr ? { quickReplies: qr } : {}) },
  };
}

export function textCard(card: TextCard, quickReplies?: QuickReply[]): SkillResponse {
  if (!card.title && !card.description) throw new Error("textCard에는 title이나 description이 있어야 함");
  if (card.buttons && card.buttons.length > LIMITS.buttons) throw new Error(`버튼이 ${LIMITS.buttons}개를 넘음`);
  card.buttons?.forEach((b) => checkLabel(b.label));
  const title = card.title ? clip(card.title, LIMITS.cardTitle) : undefined;
  const room = LIMITS.cardText - (title ? [...title].length : 0);
  const description = card.description ? clip(card.description, Math.max(1, room)) : undefined;
  const qr = checkQuickReplies(quickReplies);
  return {
    version: "2.0",
    template: {
      outputs: [{ textCard: { ...(title ? { title } : {}), ...(description ? { description } : {}), ...(card.buttons ? { buttons: card.buttons } : {}), ...(card.buttonLayout ? { buttonLayout: card.buttonLayout } : {}) } }],
      ...(qr ? { quickReplies: qr } : {}),
    },
  };
}

/** 콜백을 쓰겠다는 첫 응답. data.text는 블록의 응답 대기 문구에 쓸 수 있음(콜백 개발 가이드의 활용 예) */
export function useCallback(waitText: string): SkillResponse {
  return { version: "2.0", useCallback: true, data: { text: clip(waitText, LIMITS.simpleText) } };
}

/** 대본의 시험 메뉴(바로가기 10개). 누르면 그 말이 사용자의 발화로 나감 */
export const MENU: string[] = [
  "같은 말",
  "늦게 4",
  "늦게 6",
  "빈 응답 1",
  "콜백 시험",
  "후기 시험",
  "후기 부탁",
  "봇 ID",
  "이벤트 시험",
  "로그인 시험",
];

export function menuReplies(): QuickReply[] {
  return MENU.map((m) => ({ label: m, action: "message", messageText: m }));
}
