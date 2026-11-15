// 스킬 응답 만들기 단위 시험. 한도는 카카오 '응답 타입별 JSON 포맷'·'콜백 개발 가이드'(2026-11-15 확인)
import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMITS, MENU, menuReplies, simpleText, textCard, useCallback } from "../src/kakao.ts";

test("simpleText: 1000자에서 자르고 바로가기 응답을 붙임", () => {
  const r = simpleText("가".repeat(1200), [{ label: "메뉴", action: "message", messageText: "메뉴" }]);
  const text = (r.template?.outputs[0] as { simpleText: { text: string } }).simpleText.text;
  assert.equal([...text].length, LIMITS.simpleText);
  assert.ok(text.endsWith("…"));
  assert.equal(r.version, "2.0");
  assert.equal(r.template?.quickReplies?.length, 1);
  assert.equal(simpleText("짧음").template?.quickReplies, undefined);
});

test("바로가기 응답 10개 넘거나 이름 14자 넘으면 오류", () => {
  const many = Array.from({ length: 11 }, (_, i) => ({ label: `q${i}`, action: "message" as const, messageText: `q${i}` }));
  assert.throws(() => simpleText("x", many));
  assert.throws(() => simpleText("x", [{ label: "가".repeat(15), action: "message", messageText: "x" }]));
});

test("textCard: 버튼 3개까지, 제목 50자, 제목+설명 400자", () => {
  assert.throws(() => textCard({ title: "t", buttons: Array.from({ length: 4 }, () => ({ label: "b", action: "message" as const, messageText: "b" })) }));
  assert.throws(() => textCard({ title: "t", buttons: [{ label: "가".repeat(15), action: "message", messageText: "b" }] }));
  assert.throws(() => textCard({}));
  const r = textCard({ title: "제".repeat(60), description: "설".repeat(500) });
  const card = (r.template?.outputs[0] as { textCard: { title: string; description: string } }).textCard;
  assert.equal([...card.title].length, LIMITS.cardTitle);
  assert.equal([...card.title].length + [...card.description].length, LIMITS.cardText);
});

test("useCallback: template 없이 useCallback true와 data", () => {
  const r = useCallback("잠시만요");
  assert.deepEqual(r, { version: "2.0", useCallback: true, data: { text: "잠시만요" } });
});

test("시험 메뉴: 바로가기 10개, 이름 14자 이하, 누르면 같은 말이 나감", () => {
  const q = menuReplies();
  assert.equal(q.length, MENU.length);
  assert.ok(q.length <= LIMITS.quickReplies);
  for (const r of q) {
    assert.ok([...r.label].length <= LIMITS.buttonLabel);
    assert.equal(r.action, "message");
    assert.equal(r.messageText, r.label);
  }
});
