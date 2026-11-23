import { expect, it } from "vitest";
import { request } from "./api";

it("사진 올리기는 multipart 본문을 그대로 보내며 Content-Type/요청 키를 만들지 않음", async () => {
  const form = new FormData();
  form.set("purpose", "license_photo");
  form.set("file", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "synthetic.png");
  let seen: RequestInit | undefined;
  const result = await request("/owner/uploads", {
    method: "POST",
    body: form,
    fetch: async (_url, init) => {
      seen = init;
      return new Response(JSON.stringify({ purpose: "license_photo", uploadId: `upl_${"a".repeat(24)}` }), {
        status: 201,
      });
    },
  });
  expect(result.ok).toBe(true);
  expect(seen?.body).toBe(form);
  const headers = new Headers(seen?.headers);
  expect(headers.has("content-type")).toBe(false);
  expect(headers.has("Idempotency-Key")).toBe(false);
  expect(seen?.credentials).toBe("same-origin");
});

import { ENTRUSTMENT_TERMS_VERSION, registrationPayload } from "./registration";
import { EMPTY_REGISTRATION } from "./registration-draft";

it("신고번호와 신고 기관 또는 면제 사유를 한 쌍으로 보내고 표시한 위탁 버전을 함께 보냄", () => {
  const values = {
    ...EMPTY_REGISTRATION,
    mailOrderRegNo: "2026-합성",
    mailOrderAuthority: "합성 구청",
    mailOrderExemption: "예전 면제 사유",
  };
  expect(registrationPayload(values, "synthetic-upload", true)).toMatchObject({
    mailOrderRegNo: "2026-합성",
    mailOrderAuthority: "합성 구청",
    mailOrderExemption: null,
    entrustmentTermsVersion: ENTRUSTMENT_TERMS_VERSION,
    entrustmentConsent: true,
  });
  expect(registrationPayload({ ...values, mailOrderRegNo: "" }, "synthetic-upload", false)).toMatchObject({
    mailOrderRegNo: null,
    mailOrderAuthority: null,
    mailOrderExemption: "예전 면제 사유",
    entrustmentConsent: false,
  });
});
