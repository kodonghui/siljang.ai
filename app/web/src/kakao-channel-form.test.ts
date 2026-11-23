import { expect, it } from "vitest";
import type { KakaoChannel } from "./kakao-channel-api";
import { channelForm, channelIssues, channelPayload, rebaseChannel } from "./kakao-channel-form";

const channel = {
  botId: "synthetic-bot",
  channelPublicId: "_synthetic",
  blockIds: {
    card: "card",
    ordererInfo: "orderer",
    allergyAnswer: "allergy",
    depositorName: "depositor",
    review: "review",
  },
  revision: "synthetic-v1",
} as KakaoChannel;
it("미설정은 빈 양식이고 저장할 때 빈 선택 ID만 null로 보낸다", () => {
  const form = { ...channelForm(null), botId: "synthetic-new" };
  expect(channelPayload(null, form)).toEqual({
    baseRevision: null,
    botId: "synthetic-new",
    channelPublicId: null,
    blockIds: { card: null, ordererInfo: null, allergyAnswer: null, depositorName: null, review: null },
  });
  expect(channelIssues(form)).toEqual([]);
});
it("ID 공백·길이·공개 ID 형식은 해당 필드에 붙이고 코드 포인트로 센다", () => {
  const form = channelForm(channel);
  form.botId = "";
  form.channelPublicId = "wrong";
  form.blockIds.card = "has space";
  form.blockIds.review = "😀".repeat(101);
  expect(channelIssues(form)).toEqual(
    expect.arrayContaining([
      { field: "/botId", code: "required" },
      { field: "/channelPublicId", code: "bad_format" },
      { field: "/blockIds/card", code: "bad_format" },
      { field: "/blockIds/review", code: "too_long" },
    ]),
  );
  form.botId = "😀".repeat(64);
  form.channelPublicId = "";
  form.blockIds.card = "card";
  form.blockIds.review = "😀".repeat(100);
  expect(channelIssues(form)).toEqual([]);
});
it("충돌은 내가 바꾼 블록만 최신 ID 위에 적용하고 지운 선택 값도 유지한다", () => {
  const mine = channelForm(channel);
  mine.blockIds.card = "mine-card";
  mine.channelPublicId = "";
  const latest = {
    ...channel,
    botId: "remote-bot",
    blockIds: { ...channel.blockIds, review: "remote-review" },
    revision: "synthetic-v2",
  };
  const form = rebaseChannel(channel, mine, latest);
  expect(channelPayload(latest, form)).toMatchObject({
    baseRevision: "synthetic-v2",
    botId: "remote-bot",
    channelPublicId: null,
    blockIds: { card: "mine-card", review: "remote-review" },
  });
});
