// 대본(docs/10-wbs/kakao-test-script.md)의 항목 K-01~K-11을 받은 요청에서 고르고, 항목마다 보낼 답을 만든다.
// I/O(KV·fetch·잠깐 기다리기)는 index.ts가 하고, 여기는 입력만으로 답을 정하는 함수만 둔다(단위 시험 대상).

import { menuReplies, simpleText, textCard, type QuickReply, type SkillResponse } from "./kakao.ts";
import { shapeOf, type Json } from "./mask.ts";

export type Payload = {
  userRequest?: {
    utterance?: string;
    callbackUrl?: string;
    params?: Record<string, Json>;
    block?: { id?: string; name?: string };
    user?: { id?: string; type?: string; properties?: Record<string, Json> };
  };
  bot?: { id?: string; name?: string };
  action?: { params?: Record<string, Json>; detailParams?: Record<string, Json>; clientExtra?: Record<string, Json> | null };
  [k: string]: Json | undefined | object;
};

/** 후기 블록의 파라미터 이름(대본 1절에서 이 이름으로 만듦) */
export const REVIEW_PARAMS = { text: "review_text", photos: "photos", consent: "consent" } as const;

export type ItemId =
  | "K-00" // 시험 메뉴·모르는 말
  | "K-01" // 시험 시작
  | "K-02" // 같은 말
  | "K-03a" // 늦게 4
  | "K-03b" // 늦게 6
  | "K-04-1" | "K-04-2" | "K-04-3" | "K-04-4" // 빈 응답
  | "K-05" // 콜백
  | "K-06" // 사진 메시지
  | "K-07" // 후기 블록(바로)
  | "K-07-setup" // 후기 블록이 아닌 곳에 '후기 시험'이 옴
  | "K-08" // 후기 부탁 카드 보내기
  | "K-08b" // 후기 부탁 버튼으로 연 후기 블록
  | "K-09" // 봇 ID
  | "K-10" // Event API 부르기
  | "K-10b" // Event API로 부른 스킬 요청
  | "K-11"; // 카카오 로그인 PKCE

export function norm(s: string | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function str(v: Json | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** userRequest(콜백 주소 빼고)와 action 어디에서든 주소를 모음. 사진 메시지(OPEN-3)가 어느 필드로 오는지 보려고 */
export function findUrls(p: Payload): { path: string; url: string }[] {
  const out: { path: string; url: string }[] = [];
  const re = /https?:\/\/[^\s()"'<>,]+/g;
  const scan = (path: string, v: Json | undefined) => {
    if (typeof v === "string") {
      for (const m of v.matchAll(re)) out.push({ path, url: m[0] });
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => scan(`${path}[${i}]`, x));
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) scan(`${path}.${k}`, x);
    }
  };
  for (const [k, v] of Object.entries(p.userRequest ?? {})) if (k !== "callbackUrl") scan(`userRequest.${k}`, v as Json);
  scan("action", p.action as Json);
  // 같은 주소가 params와 detailParams에 함께 오면 하나로
  const seen = new Set<string>();
  return out.filter((x) => (seen.has(x.url) ? false : (seen.add(x.url), true)));
}

export function isReviewRequest(p: Payload): boolean {
  const ps = p.action?.params ?? {};
  return REVIEW_PARAMS.text in ps || REVIEW_PARAMS.photos in ps || REVIEW_PARAMS.consent in ps;
}

export function classify(p: Payload): ItemId {
  const u = norm(p.userRequest?.utterance);
  const extra = p.action?.clientExtra ?? {};
  if (str(p.userRequest?.params?.check) === "event") return "K-10b";
  if (isReviewRequest(p)) return extra && typeof extra === "object" && "orderNo" in extra ? "K-08b" : "K-07";
  if (p.userRequest?.callbackUrl || u.startsWith("콜백") || (extra && typeof extra === "object" && "delay" in extra)) return "K-05";
  switch (u) {
    case "시험 시작":
    case "시험 메뉴":
      return "K-01";
    case "같은 말":
      return "K-02";
    case "늦게 4":
      return "K-03a";
    case "늦게 6":
      return "K-03b";
    case "빈 응답 1":
      return "K-04-1";
    case "빈 응답 2":
      return "K-04-2";
    case "빈 응답 3":
      return "K-04-3";
    case "빈 응답 4":
      return "K-04-4";
    case "후기 시험":
      return "K-07-setup";
    case "후기 부탁":
      return "K-08";
    case "봇 ID":
      return "K-09";
    case "이벤트 시험":
      return "K-10";
    case "로그인 시험":
      return "K-11";
  }
  if (findUrls(p).length > 0) return "K-06";
  return "K-00";
}

/** 늦은 답 항목의 기다림(ms). 카카오 스킬 제한 5초(바꿀 수 없음, 스킬 만들기 문서) 바로 앞과 뒤 */
export const LATE_MS: Partial<Record<ItemId, number>> = { "K-03a": 4500, "K-03b": 6000 };

/** 빈 응답 네 가지(OPEN-4): 상태 코드와 본문 */
export function emptyVariant(item: ItemId): { status: number; body: string | null } | null {
  switch (item) {
    case "K-04-1":
      return { status: 200, body: JSON.stringify({ version: "2.0", template: { outputs: [] } }) };
    case "K-04-2":
      return { status: 200, body: "" };
    case "K-04-3":
      return { status: 200, body: JSON.stringify({ version: "2.0" }) };
    case "K-04-4":
      return { status: 204, body: null };
    default:
      return null;
  }
}

/** 콜백 기다림(초): clientExtra.delay가 먼저, 없으면 발화의 숫자, 없으면 3초. 0~600초로 자름 */
export function callbackDelay(p: Payload): number {
  const extra = p.action?.clientExtra;
  const fromExtra = extra && typeof extra === "object" ? Number((extra as Record<string, Json>).delay) : NaN;
  const m = norm(p.userRequest?.utterance).match(/(\d{1,3})/);
  const n = Number.isFinite(fromExtra) ? fromExtra : m ? Number(m[1]) : 3;
  return Math.min(600, Math.max(0, Math.round(n)));
}

/** 콜백 시험에서 이어 누를 기다림(초). 280초는 문서의 유효 시간 5분 안, 320초는 밖 */
export const CALLBACK_DELAYS = [20, 50, 280, 320];

export function callbackReplies(callbackBlockId: string | null): QuickReply[] {
  return CALLBACK_DELAYS.map((d) =>
    callbackBlockId
      ? { label: `콜백 ${d}초`, action: "block", blockId: callbackBlockId, messageText: `콜백 ${d}초`, extra: { delay: d } }
      : { label: `콜백 ${d}초`, action: "message", messageText: `콜백 ${d}초` },
  );
}

export function startReply(info: { recordKey: string; ms: number; colo: string; isFriend: boolean; hasAppUserId: boolean }): SkillResponse {
  return simpleText(
    [
      "시험 서버가 받았어요(K-01).",
      `- 기록: ${info.recordKey}`,
      `- 서버 처리: ${info.ms}ms`,
      `- Cloudflare 데이터센터: ${info.colo}`,
      `- 채널 친구(isFriend): ${info.isFriend ? "예" : "값 없음"}`,
      `- appUserId: ${info.hasAppUserId ? "있음" : "없음"}`,
      "아래 시험 메뉴에서 대본의 차례대로 눌러 주세요.",
    ].join("\n"),
    menuReplies(),
  );
}

/** K-02 답. 후보 키는 2초 묶음 번호가 같은 요청끼리만 같으므로 번호와 시각을 뺀 키를 함께 보임 */
export function sameReply(info: { dedupKey: string; dedupNoTimeKey: string; dedupBucket: number; bodyHash: string; newIdPaths: string[] }): SkillResponse {
  return simpleText(
    [
      "같은 말을 받았어요(K-02).",
      `- 같은 요청 거르기 후보 키(OPEN-1): ${info.dedupKey.slice(0, 9)}`,
      `- 2초 묶음 번호 끝 4자리: ${String(info.dedupBucket).slice(-4)}`,
      `- 시각을 뺀 키: ${info.dedupNoTimeKey.slice(0, 9)}`,
      `- 본문 해시: ${info.bodyHash.slice(0, 9)}`,
      `- 메시지 ID처럼 보이는 새 경로: ${info.newIdPaths.length ? info.newIdPaths.join(", ") : "없음"}`,
      "2초 안에 한 번 더, 10초 뒤에 한 번 더 보내 주세요.",
    ].join("\n"),
  );
}

export function lateReply(item: ItemId, elapsedMs: number): SkillResponse {
  return simpleText(`늦은 답 시험(${item}): 받은 지 ${(elapsedMs / 1000).toFixed(1)}초 뒤에 답했어요.`);
}

export function botIdReply(botId: string): { reply: SkillResponse; recorded: SkillResponse } {
  const shape = shapeOf(botId);
  const tail = botId.replace(/!$/, "").slice(-4);
  const lines = (t: string) =>
    [
      "봇 ID 시험(K-09, OPEN-8).",
      `- 받은 봇 ID의 꼴: ${shape}`,
      `- 끝 4자: ${t}`,
      "`챗봇 관리자센터` 설정의 봇 ID와 글자 수·끝 4자가 같은지 보세요(대화창에만 보이고 기록에는 끝 4자를 남기지 않아요).",
    ].join("\n");
  return { reply: simpleText(lines(tail)), recorded: simpleText(lines("****")) };
}

export function photoReply(found: { path: string }[], fetched: string[]): SkillResponse {
  const where = [...new Set(found.map((f) => f.path))].join(", ") || "없음";
  return simpleText(["사진 메시지 시험(K-06, OPEN-3).", `- 주소가 온 곳: ${where}`, ...fetched.map((f, i) => `- 받기 ${i + 1}: ${f}`)].join("\n"));
}

export function reviewReply(item: "K-07" | "K-08b", info: { textLen: number | null; photos: string[]; consent: string | null; extraKeys: string[]; orderNo: string | null; pending: boolean }): SkillResponse {
  const head =
    item === "K-07"
      ? "후기 블록 요청을 받았어요(K-07). 서버가 이 블록을 기억했어요."
      : info.orderNo
        ? `후기 부탁 버튼의 extra가 남았어요(K-08, OPEN-12): orderNo ${info.orderNo}`
        : "후기 부탁 버튼으로 열었지만 extra가 남지 않았어요(K-08, OPEN-12).";
  return simpleText(
    [
      head,
      `- 글: ${info.textLen === null ? "없음" : `${info.textLen}자`}`,
      `- 사진: ${info.photos.length}장${info.photos.length ? "" : "(보안 이미지 값 없음)"}`,
      ...info.photos.map((f, i) => `  ${i + 1}) ${f}`),
      `- 게시 동의 답: ${info.consent ?? "없음"}`,
      `- clientExtra 키: ${info.extraKeys.length ? info.extraKeys.join(", ") : "없음"}`,
    ].join("\n"),
  );
}

export function reviewAskCard(reviewBlockId: string, orderNo: string): SkillResponse {
  return textCard({
    title: "후기 부탁 시험(K-08)",
    description: "아래 버튼을 누르고 글·사진·게시 동의를 차례로 답해 주세요. 마지막에 서버가 extra가 남았는지 알려 드려요.",
    buttons: [{ label: "후기 남기기", action: "block", blockId: reviewBlockId, extra: { orderNo } }],
  });
}

/** ticket: login.ts makeTicket(30분). 버튼 주소에 붙여 카드를 받은 사람만 로그인 시험을 열게 함 */
export function loginCard(origin: string, ticket: string): SkillResponse {
  const at = (mode: string) => `${origin}/login/start?mode=${mode}&t=${encodeURIComponent(ticket)}`;
  return textCard({
    title: "카카오 로그인 PKCE 시험(K-11)",
    description: "버튼을 위에서부터 하나씩 눌러 로그인하고, 결과 화면을 사진으로 남겨 주세요. 토큰은 서버에 남기지 않아요.",
    buttons: [
      { label: "① PKCE", action: "webLink", webLinkUrl: at("pkce") },
      { label: "② PKCE 틀린 값", action: "webLink", webLinkUrl: at("pkce_wrong") },
      { label: "③ PKCE 없이", action: "webLink", webLinkUrl: at("plain") },
    ],
  });
}

export function menuReply(unknown: boolean): SkillResponse {
  return simpleText(`${unknown ? "대본에 없는 말이에요. " : ""}시험 메뉴예요. 대본의 차례대로 눌러 주세요.`, menuReplies());
}

/** 사진을 받으러 갈 호스트: 카카오 쪽 도메인만. 대화창에 아무 주소나 적어 서버가 그 주소로 요청하게 만들지 못하게.
 *  로컬 시험의 가짜 서버처럼 더할 호스트는 extra(쉼표로 나눈 목록, Worker 변수 EXTRA_IMAGE_HOSTS) */
export const IMAGE_HOSTS = ["kakaocdn.net", "kakao.com", "kakao.co.kr", "daumcdn.net"];

export function imageHostAllowed(url: string, extra?: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const more = (extra ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const h = u.hostname.toLowerCase();
  return [...IMAGE_HOSTS, ...more].some((d) => h === d || h.endsWith(`.${d}`));
}

/** 보안 이미지 플러그인 값(JSON 글)에서 사진 주소 목록. secureUrls는 "List(주소, 주소)" 꼴(플러그인 문서의 예) */
export function secureImageUrls(v: Json | undefined): string[] {
  if (typeof v !== "string") return [];
  let urls = "";
  try {
    const o = JSON.parse(v) as Record<string, Json>;
    urls = typeof o.secureUrls === "string" ? o.secureUrls : "";
  } catch {
    urls = v;
  }
  return [...urls.matchAll(/https?:\/\/[^\s()"'<>,]+/g)].map((m) => m[0]);
}
