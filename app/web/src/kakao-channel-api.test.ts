import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { fetchKakaoChannel, rotateKakaoSkillKey, saveKakaoChannel, startKakaoChannelCheck } from "./kakao-channel-api";

const contract = parse(readFileSync(resolve(process.cwd(), "../../api/openapi.yaml"), "utf8"));
const base = "/owner/kakao-channel";
const routes = [
  { path: base, method: "get", call: () => fetchKakaoChannel() },
  {
    path: base,
    method: "put",
    call: () =>
      saveKakaoChannel(
        {
          baseRevision: null,
          botId: "synthetic-bot",
          channelPublicId: null,
          blockIds: { card: null, ordererInfo: null, allergyAnswer: null, depositorName: null, review: null },
        },
        "synthetic-request",
      ),
  },
  { path: `${base}/check`, method: "post", call: () => startKakaoChannelCheck("synthetic-request") },
  {
    path: `${base}/skill-key`,
    method: "post",
    call: () => rotateKakaoSkillKey({ baseRevision: "synthetic-v1", previousKey: "keep_24h" }, "synthetic-request"),
  },
];
const cases = routes.flatMap((route) =>
  Object.entries(contract.paths[route.path][route.method].responses).flatMap(([status, response]) => {
    const r = response as { content: Record<string, { examples: Record<string, { value: unknown }> }> };
    const media = r.content[status === "200" ? "application/json" : "application/problem+json"];
    if (!media) throw new Error("계약 응답 자료 없음");
    const examples = media.examples;
    return Object.entries(examples).map(([name, example]) => ({
      ...route,
      status: status === "default" ? 500 : Number(status),
      name,
      value: example.value,
    }));
  }),
);
afterEach(() => vi.unstubAllGlobals());
it.each(cases)("$method $path $status $name 응답의 계약 응답과 요청 경계", async (row) => {
  const transport = vi.fn(async () => new Response(JSON.stringify(row.value), { status: row.status }));
  vi.stubGlobal("fetch", transport);
  const result = await row.call();
  expect(result.ok).toBe(row.status === 200);
  if (!result.ok) expect(result.status).toBe(row.status);
  expect(transport).toHaveBeenCalledOnce();
  const [path, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
  expect(path).toBe(`/api${row.path}`);
  expect(init.credentials).toBe("same-origin");
  const key = new Headers(init.headers).get("Idempotency-Key");
  if (row.method === "get") {
    expect(init.cache).toBe("no-store");
    expect(key).toBeNull();
  } else {
    expect(key).toBe("synthetic-request");
    expect(init.method).toBe(row.method.toUpperCase());
  }
});
const linked = () =>
  structuredClone(contract.paths[base].get.responses[200].content["application/json"].examples.linked.value);
it("조회는 취소 신호를 전달하고 계약 밖의 비밀 필드를 화면 데이터에서 뺀다", async () => {
  const value = linked();
  value.skillKey = "조회에 있으면 안 되는 합성 값";
  value.skill.headerValue = value.skillKey;
  const transport = vi.fn(async () => new Response(JSON.stringify(value)));
  vi.stubGlobal("fetch", transport);
  const controller = new AbortController();
  const result = await fetchKakaoChannel(controller.signal);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("조회 실패");
  expect(result.data).not.toHaveProperty("skillKey");
  expect(result.data.skill).not.toHaveProperty("headerValue");
  expect((transport.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBe(controller.signal);
});
it.each([
  "봇 길이",
  "블록 누락",
  "중복 검증 블록",
  "검증 블록 범위",
  "상태",
  "연결 문구",
  "시각",
  "키 버전",
  "헤더 이름",
  "스킬 주소",
  "사유 중복",
  "revision",
])("잘못된 성공 응답 %s를 거절", async (kind) => {
  const value = linked();
  if (kind === "봇 길이") value.botId = "a".repeat(65);
  if (kind === "블록 누락") delete value.blockIds.card;
  if (kind === "중복 검증 블록") value.verifiedBlocks = ["card", "card"];
  if (kind === "검증 블록 범위") value.verifiedBlocks = ["other"];
  if (kind === "상태") value.status = "other";
  if (kind === "연결 문구") value.proofPhrase = "연결 12345";
  if (kind === "시각") value.linkedAt = "bad-date";
  if (kind === "키 버전") value.skill.keyVersion = 0;
  if (kind === "헤더 이름") value.skill.headerName = "Other-Header";
  if (kind === "스킬 주소") value.skill.messageSkillUrl = "javascript:alert(1)";
  if (kind === "사유 중복") value.failureHints = ["skill_url", "skill_url"];
  if (kind === "revision") value.revision = "has space";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(value))),
  );
  expect(await fetchKakaoChannel()).toMatchObject({ ok: false, status: 502 });
});
it.each(["짧은 키", "다른 버전", "확인의 키", "회전의 빈 키"])("일회성 키 %s의 잘못된 결과를 거절", async (kind) => {
  const response = structuredClone(
    contract.paths[`${base}/skill-key`].post.responses[200].content["application/json"].examples.regenerated.value,
  );
  if (kind === "짧은 키") response.skillKey.headerValue = "a";
  if (kind === "다른 버전") response.skillKey.keyVersion = response.kakaoChannel.skill.keyVersion + 1;
  if (kind === "회전의 빈 키") response.skillKey = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(response))),
  );
  const result =
    kind === "확인의 키"
      ? await startKakaoChannelCheck("synthetic-request")
      : await rotateKakaoSkillKey({ baseRevision: "synthetic-v1", previousKey: "keep_24h" }, "synthetic-request");
  expect(result).toMatchObject({ ok: false, status: 502 });
});
it.each(["status", "eventStatus", "outcome"])(
  "문자열이 아닌 %s는 강제 변환 없이 잘못된 응답으로 처리",
  async (kind) => {
    const value =
      kind === "outcome"
        ? structuredClone(
            contract.paths[`${base}/skill-key`].post.responses[200].content["application/json"].examples.regenerated
              .value,
          )
        : linked();
    value[kind] = { toString: null };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(value))),
    );
    const result =
      kind === "outcome"
        ? await rotateKakaoSkillKey({ baseRevision: "synthetic-v1", previousKey: "keep_24h" }, "synthetic-request")
        : await fetchKakaoChannel();
    expect(result).toMatchObject({ ok: false, status: 502 });
  },
);
