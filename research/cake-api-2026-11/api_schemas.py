"""06단계 API 계약의 스키마(components.schemas). build_api.py가 읽는다.

- 요청 칸에는 `x-corthex-column: 표.칸`을 달아 05단계 db/schema.sql의 그 칸 한도와 견준다(check_api.py C7).
- 요청·응답 객체는 모두 additionalProperties: false: 계약 밖 칸은 요청이면 422, 응답이면 계약 시험이 실패한다(G6 노출).
- 카카오 스킬 요청(SkillPayload)만 카카오가 칸을 더할 수 있어 additionalProperties를 막지 않는다.
"""

R = "#/components/schemas/"


def ref(name):
    return {"$ref": R + name}


def nullable(schema):
    """null도 받는 스키마. $ref는 anyOf로, enum은 null을 더함."""
    if "$ref" in schema:
        return {"anyOf": [schema, {"type": "null"}]}
    s = dict(schema)
    t = s.get("type")
    s["type"] = [t, "null"] if isinstance(t, str) else list(t) + ["null"]
    if "enum" in s:
        s["enum"] = list(s["enum"]) + [None]
    return s


def string(lo=None, hi=None, pattern=None, fmt=None, col=None, desc=None, enum=None):
    s = {"type": "string"}
    if enum is not None:
        s["enum"] = list(enum)
    if lo is not None:
        s["minLength"] = lo
    if hi is not None:
        s["maxLength"] = hi
    if pattern:
        s["pattern"] = pattern
    if fmt:
        s["format"] = fmt
    if desc:
        s["description"] = desc
    if col:
        s["x-corthex-column"] = col
    return s


def enum(values, col=None, desc=None):
    return string(enum=values, col=col, desc=desc)


def integer(lo, hi, col=None, desc=None):
    s = {"type": "integer", "minimum": lo, "maximum": hi}
    if desc:
        s["description"] = desc
    if col:
        s["x-corthex-column"] = col
    return s


def boolean(desc=None, col=None):
    s = {"type": "boolean"}
    if desc:
        s["description"] = desc
    if col:
        s["x-corthex-column"] = col
    return s


def arr(items, lo=0, hi=None, unique=False, desc=None):
    s = {"type": "array", "items": items, "minItems": lo}
    if hi is not None:
        s["maxItems"] = hi
    if unique:
        s["uniqueItems"] = True
    if desc:
        s["description"] = desc
    return s


def obj(props, required=(), desc=None, additional=False, **extra):
    s = {"type": "object"}
    if desc:
        s["description"] = desc
    if required:
        s["required"] = list(required)
    s["properties"] = props
    s["additionalProperties"] = additional
    s.update(extra)
    return s


def all_required(props, optional=(), desc=None, **extra):
    """응답 객체: 칸은 모두 늘 실림(값이 없으면 null). optional만 빠질 수 있음."""
    return obj(props, [k for k in props if k not in optional], desc=desc, **extra)


# ── 자주 쓰는 모양 ───────────────────────────────────────────────────────────
UUID = {"type": "string", "format": "uuid"}
DT = {"type": "string", "format": "date-time"}
DATE = {"type": "string", "format": "date"}
URL = {"type": "string", "format": "uri", "maxLength": 2048}
SIGNED_URL = {"type": "string", "format": "uri", "maxLength": 2048, "description": "15분 사는 서명 주소. 저장 위치는 싣지 않음(DEC-09)"}
REVISION = string(1, 64, r"^[A-Za-z0-9._-]+$", desc="서버가 만든 판 표시. 명령의 baseRevision에 그대로 보냄(DEC-05)")
BASE_REVISION = string(1, 64, r"^[A-Za-z0-9._-]+$", desc="화면이 본 기록의 revision. 지금과 다르면 409 version_conflict(DEC-05, G3)")
UPLOAD_ID = string(24, 204, r"^upl_[A-Za-z0-9_-]{20,200}$", desc="POST /owner/uploads가 준 ID. 1시간 안에 써야 함(DEC-09)")
ORDER_NO = string(6, 12, r"^[0-9A-Z]{6,12}$", desc="주문번호. 손님에게 보이는 유일한 번호(G6)")
PHONE_RE = r"^[0-9-]{8,14}$"
HHMM_RE = r"^([01][0-9]|2[0-3]):[0-5][0-9]$"
NOTICE_RE = r"^((0[89]|1[0-9]):[0-5][0-9]|20:([0-4][0-9]|50))$"
ACCOUNT_RE = r"^-*([0-9]-*){10,16}$"
MONEY = lambda col=None, lo=0: integer(lo, 10000000, col=col, desc="원")
CURSOR = string(1, 200, r"^[A-Za-z0-9_-]+$")

ORDER_STATUS = ["requested", "awaiting_payment", "payment_overdue", "confirmed", "received", "no_pickup", "rejected", "cancelled"]
TASK_KINDS = ["handoff", "custom_order", "change_request", "issue_report", "payment_claim", "payment_mismatch", "payment_overdue", "refund_decision", "paid_after_cancel", "stale_change", "ledger_relink", "license_on_hold", "calendar_conflict"]
HANDOFF_REASONS = ["edibility", "cannot_answer", "closed_day", "legal_medical", "customer_request", "other_user", "pre_receipt_issue", "ai_failure", "ai_cost_limit", "callback_timeout", "masking_failed", "empty_answer", "clause_missing"]
CLAUSE_KEYS = ["pre_production_cancel", "staged_refund", "cancellation_fee", "date_change_refund_basis", "shop_cancel_compensation", "other_shop_design", "issue_report_window", "quote_validity", "payment_due", "change_deadline", "custom"]
IMAGE_TYPES = ["image/jpeg", "image/png", "image/heic", "image/webp"]


def outcome(values=("done", "unchanged"), desc="done: 바꿈, unchanged: 이미 그 상태라 아무것도 바꾸지 않음(DEC-03)"):
    return string(enum=list(values), desc=desc)


def confirm_list(kinds):
    return arr(string(enum=kinds), 0, len(kinds), unique=True,
               desc="409 confirmation_required로 받은 확인할 것 가운데 사장님이 확인한 것(DEC-06)")


S = {}

# ── 오류 ────────────────────────────────────────────────────────────────────
S["Problem"] = obj({
    "type": string(1, 200, fmt="uri-reference", desc="문제 종류 주소: /problems/{code}"),
    "title": string(1, 200, desc="짧은 말. components.x-corthex.errors의 message"),
    "status": integer(400, 599, desc="이 응답의 HTTP 상태와 늘 같음"),
    "detail": string(1, 1000, desc="이번 일의 설명. 넣은 값·내부 오류 내용·비밀값·다른 가게의 존재를 싣지 않음(G6)"),
    "instance": string(1, 2048, fmt="uri-reference", desc="요청 경로"),
    "code": {"type": "string", "description": "오류 코드. components.x-corthex.errors에 있는 것만"},  # enum은 build_api.py가 채움
    "traceId": string(32, 32, r"^[0-9a-f]{32}$", desc="서버 로그의 추적 ID(W3C trace-id)"),
    "errors": arr(ref("FieldError"), 1, 50, desc="validation_failed일 때 칸마다 까닭"),
    "confirm": arr(ref("ConfirmationNeeded"), 1, 10, desc="confirmation_required일 때 확인할 것"),
    "retryAfterSeconds": integer(1, 3600, desc="429일 때 다시 부를 수 있을 때까지 초(Retry-After와 같음)"),
}, ["type", "title", "status", "code", "traceId"],
    desc="RFC 9457 Problem Details에 code와 traceId를 더한 오류 모양. 모든 오류 응답이 이 모양(application/problem+json)")

S["FieldError"] = obj({
    "field": string(1, 200, r"^((/[A-Za-z0-9_]+)+|(header|query|path):[A-Za-z0-9_-]+|file|/)$",
                    desc="요청에서 틀린 칸의 위치(JSON Pointer, 또는 header:이름·query:이름·path:이름·file). 계약에 있는 칸 이름만"),
    "code": {"type": "string", "description": "까닭 코드. components.x-corthex.fieldErrors에 있는 것만"},  # enum은 build_api.py가 채움
}, ["field", "code"], desc="칸 오류 하나. 넣은 값은 싣지 않음")

S["ConfirmationNeeded"] = obj({
    "kind": {"type": "string", "description": "확인할 것. components.x-corthex.confirmations에 있는 것만"},  # enum은 build_api.py가 채움
    "count": integer(0, 10000, desc="관련 주문 수(closed_day_with_orders)"),
    "day": DATE,
}, ["kind"], desc="저장하기 전에 사장님이 확인할 것 하나")

# ── 로그인 ──────────────────────────────────────────────────────────────────
S["OwnerSessionInput"] = obj({
    "kakaoCode": string(1, 512, r"^[A-Za-z0-9_-]+$", desc="카카오 로그인이 화면의 redirectUri로 준 인가 코드"),
    "redirectUri": string(1, 2048, r"^https://", fmt="uri", desc="카카오 로그인에 쓴 redirect_uri(서버 설정의 목록에 있는 것만)"),
}, ["kakaoCode", "redirectUri"])

S["Owner"] = all_required({
    "ownerId": UUID,
    "alertChannelFriend": boolean("우리 서비스 카카오톡 채널 친구인지. 아니면 알림은 할 일 목록에만(SPEC-067)"),
    "createdAt": DT,
})

S["ShopSummary"] = all_required({
    "shopId": UUID,
    "name": string(1, 40),
    "licenseStatus": enum(["pending", "on_hold", "verified"], desc="영업 신고: 확인 기다림·보류·확인됨"),
})

S["OwnerSessionResult"] = all_required({
    "owner": ref("Owner"),
    "shop": nullable(ref("ShopSummary")),
    "next": enum(["register_shop", "resubmit_license", "open_tasks"], desc="화면이 열 곳: 가게 등록(가게 없음)·신고증 다시 올리기(보류)·할 일 목록(SPEC-001)"),
})

S["Me"] = all_required({
    "owner": ref("Owner"),
    "shop": nullable(ref("ShopSummary")),
    "banners": arr(enum(["add_alert_channel", "license_pending", "license_on_hold", "booking_link_not_ready", "ledger_relink"]), 0, 5, unique=True,
                   desc="사장님 화면 맨 위에 보일 안내(SPEC-067의 '알림을 받으려면 채널을 추가하세요' 등)"),
})

S["OperatorSessionInput"] = obj({
    "email": string(3, 254, r"^[^@\s]+@[^@\s]+$", col="operators.email"),
    "password": string(1, 256, desc="운영자 비밀번호. 인증 서비스로만 보내고 어디에도 남기지 않음(REQ-135, OPEN-6)"),
    "otp": string(6, 6, r"^[0-9]{6}$", desc="2단계 인증 번호"),
}, ["email", "password", "otp"])

S["Operator"] = all_required({
    "operatorId": UUID,
    "displayName": string(1, 40),
})

# ── 파일 ────────────────────────────────────────────────────────────────────
S["UploadForm"] = obj({
    "purpose": enum(["license_photo", "design_image", "completion_photo"],
                    desc="용도. 신고증(JPG·PNG·HEIC, 10MB), 도안(JPG·PNG·HEIC·WEBP, 10MB), 완성 사진(JPG·PNG·HEIC·WEBP, 20MB)"),
    "file": {"type": "string", "format": "binary", "description": "사진 파일 한 장"},
}, ["purpose", "file"])

S["Upload"] = all_required({
    "uploadId": UPLOAD_ID,
    "purpose": enum(["license_photo", "design_image", "completion_photo"]),
    "contentType": enum(IMAGE_TYPES),
    "byteSize": integer(1, 20971520),
    "expiresAt": DT,
})

# ── 가게 ────────────────────────────────────────────────────────────────────
_shop_fields = {
    "name": string(1, 40, col="shops.name"),
    "contactPhone": string(8, 14, PHONE_RE, col="shops.contact_phone"),
    "businessName": string(1, 60, col="shops.business_name"),
    "representativeName": string(1, 30, col="shops.representative_name"),
    "businessRegNo": string(10, 10, r"^[0-9]{10}$", col="shops.business_reg_no", desc="사업자등록번호 10자리. 검증 숫자가 틀리면 칸 오류 checksum_failed"),
    "mailOrderRegNo": nullable(string(1, 40, col="shops.mail_order_reg_no")),
    "mailOrderExemption": nullable(string(1, 200, col="shops.mail_order_exemption", desc="통신판매업 신고번호 대신 면제 사유. 둘 가운데 하나는 꼭(REQ-106)")),
    "foodLicenseNo": string(1, 30, col="shops.food_license_no"),
    "foodBusinessType": enum(["instant_sale_manufacturing", "bakery"], col="shops.food_business_type",
                             desc="즉석판매제조·가공업, 제과점영업. 그 밖은 첫 판에서 받지 않음(칸 오류 not_allowed)"),
    "licensePhotoUploadId": dict(UPLOAD_ID, description="용도 license_photo로 올린 신고증 사진"),
}
S["ShopRegistration"] = obj(dict(_shop_fields, **{
    "entrustmentTermsVersion": string(1, 20, r"^[0-9A-Za-z.-]+$", col="shops.entrustment_terms_version", desc="화면이 보여 준 개인정보 처리 위탁·재위탁 조건의 판"),
    "entrustmentConsent": boolean("그 조건에 동의함. false면 422 consent_required, 넣은 값도 남기지 않음(REQ-107)"),
}), ["name", "contactPhone", "businessName", "representativeName", "businessRegNo", "foodLicenseNo", "foodBusinessType",
     "licensePhotoUploadId", "entrustmentTermsVersion", "entrustmentConsent"])

S["ShopUpdate"] = obj({
    "baseRevision": BASE_REVISION,
    "name": string(1, 40, col="shops.name"),
    "contactPhone": string(8, 14, PHONE_RE, col="shops.contact_phone"),
    "pickupAddress": nullable(string(1, 200, col="shops.pickup_address", desc="픽업 장소. 전날 안내에 실음(E14, DEC-13)")),
    "completionPhotoEnabled": boolean("완성 사진 보내기(SPEC-009)", col="shops.completion_photo_enabled"),
    "idleCloseHours": integer(1, 720, col="shops.idle_close_hours", desc="문의 끊김까지 시간(SPEC-025)"),
    "ownerWaitMinutes": integer(10, 1440, col="shops.owner_wait_minutes", desc="사장님 답 기다리는 시간(SPEC-024)"),
    "dailyAiCostLimitKrw": integer(0, 1000000, col="shops.daily_ai_cost_limit_krw", desc="하루 AI 비용 한도(REQ-163)"),
}, ["baseRevision"], desc="바꿀 칸만 보냄(baseRevision 밖 한 칸 이상)", minProperties=2)

S["LicenseResubmission"] = obj({
    "baseRevision": BASE_REVISION,
    "foodLicenseNo": _shop_fields["foodLicenseNo"],
    "foodBusinessType": _shop_fields["foodBusinessType"],
    "licensePhotoUploadId": _shop_fields["licensePhotoUploadId"],
}, ["baseRevision", "foodLicenseNo", "foodBusinessType", "licensePhotoUploadId"])

S["Shop"] = all_required({
    "shopId": UUID,
    "name": string(1, 40),
    "contactPhone": string(8, 14, PHONE_RE),
    "pickupAddress": nullable(string(1, 200)),
    "businessName": string(1, 60),
    "representativeName": string(1, 30),
    "businessRegNo": string(10, 10, r"^[0-9]{10}$"),
    "mailOrderRegNo": nullable(string(1, 40)),
    "mailOrderExemption": nullable(string(1, 200)),
    "foodLicenseNo": string(1, 30),
    "foodBusinessType": enum(["instant_sale_manufacturing", "bakery"]),
    "licenseStatus": enum(["pending", "on_hold", "verified"]),
    "licenseHoldReason": nullable(string(1, 200, desc="보류 이유. 사장님은 자기 가게의 상태와 이 이유만 봄(SPEC-003)")),
    "licensePhotoUrl": SIGNED_URL,
    "entrustmentTermsVersion": string(1, 20),
    "entrustmentConsentedAt": DT,
    "timeZone": enum(["Asia/Seoul"]),
    "completionPhotoEnabled": boolean(),
    "idleCloseHours": integer(1, 720),
    "ownerWaitMinutes": integer(10, 1440),
    "dailyAiCostLimitKrw": integer(0, 1000000),
    "bookingUrl": nullable(URL),
    "createdAt": DT,
    "updatedAt": DT,
    "revision": REVISION,
}, desc="사장님이 보는 가게(그 가게 사장님만)")

S["ShopResult"] = all_required({"outcome": outcome(("done", "unchanged")), "shop": ref("Shop")})

# ── 운영자 ──────────────────────────────────────────────────────────────────
S["ReviewShopSummary"] = all_required({
    "shopId": UUID,
    "name": string(1, 40),
    "businessName": string(1, 60),
    "representativeName": string(1, 30),
    "businessRegNo": string(10, 10, r"^[0-9]{10}$"),
    "foodLicenseNo": string(1, 30),
    "foodBusinessType": enum(["instant_sale_manufacturing", "bakery"]),
    "licenseStatus": enum(["pending", "on_hold", "verified"]),
    "duplicateBusinessRegNo": boolean("같은 사업자등록번호의 다른 가게가 있음(SPEC-002, 막지 않고 표시)"),
    "createdAt": DT,
    "revision": REVISION,
}, desc="운영자 확인 목록의 가게. 손님·주문 기록은 없음(SPEC-003)")

S["ReviewShopList"] = all_required({"items": arr(ref("ReviewShopSummary"), 0, 100), "nextCursor": nullable(CURSOR)})

S["ReviewShopDetail"] = all_required({
    "shopId": UUID,
    "name": string(1, 40),
    "contactPhone": string(8, 14, PHONE_RE),
    "businessName": string(1, 60),
    "representativeName": string(1, 30),
    "businessRegNo": string(10, 10, r"^[0-9]{10}$"),
    "mailOrderRegNo": nullable(string(1, 40)),
    "mailOrderExemption": nullable(string(1, 200)),
    "foodLicenseNo": string(1, 30),
    "foodBusinessType": enum(["instant_sale_manufacturing", "bakery"]),
    "licensePhotoUrl": SIGNED_URL,
    "licenseStatus": enum(["pending", "on_hold", "verified"]),
    "licenseHoldReason": nullable(string(1, 200)),
    "licenseReviewedAt": nullable(DT),
    "licenseReviewedBy": nullable(ref("Operator")),
    "duplicates": arr(all_required({"shopId": UUID, "name": string(1, 40), "licenseStatus": enum(["pending", "on_hold", "verified"])}), 0, 20,
                      desc="같은 사업자등록번호의 다른 가게"),
    "createdAt": DT,
    "revision": REVISION,
}, desc="운영자가 보는 가게 등록 정보(SPEC-003). 이 화면은 가게 등록 정보만")

S["LicenseReviewInput"] = obj({
    "baseRevision": BASE_REVISION,
    "decision": enum(["verified", "on_hold"], desc="확인됨·보류(SPEC-003). 확인됨을 보류로 바꾸기는 첫 판에서 하지 않음(M7)"),
    "holdReason": string(1, 200, col="shops.license_hold_reason", desc="보류 이유. decision이 on_hold면 꼭"),
}, ["baseRevision", "decision"])

S["LicenseReviewResult"] = all_required({"outcome": outcome(), "shop": ref("ReviewShopDetail")})

S["OperatorAlert"] = all_required({
    "alertId": UUID,
    "kind": enum(["channel_already_linked", "privacy_transfer_missing", "ai_failure_burst"],
                 desc="이미 다른 가게에 묶인 채널(SPEC-008)·처리방침 국외 이전 항목 빔(SPEC-010)·5분에 AI 실패 5번(AI-1)"),
    "shop": nullable(all_required({"shopId": UUID, "name": string(1, 40)})),
    "count": integer(0, 1000000),
    "createdAt": DT,
}, desc="운영자 알림(운영 기록 TBL-051). 내용 없이 건수만(E10)")

S["OperatorAlertList"] = all_required({"items": arr(ref("OperatorAlert"), 0, 100), "nextCursor": nullable(CURSOR)})

# ── 가격표 ──────────────────────────────────────────────────────────────────
OPTION_KEY = string(1, 40, r"^[A-Za-z0-9_-]+$", desc="이 요청 안에서 옵션을 가리키는 이름(규칙·도안이 씀). 저장되지 않음")
S["PriceOptionInput"] = obj({
    "key": OPTION_KEY,
    "group": enum(["size", "flavor", "design", "extra"], col="price_options.option_group", desc="크기·맛·디자인·더하는 옵션"),
    "name": string(1, 30, col="price_options.name"),
    "priceKind": enum(["fixed", "from", "range"], col="price_options.price_kind", desc="확정·부터·범위"),
    "amount": MONEY("price_options.amount"),
    "amountMax": nullable(MONEY("price_options.amount_max")),
    "inStandard": boolean("기본 디자인 범위 안인지. 밖이면 맞춤 주문(SPEC-013)", col="price_options.in_standard"),
    "position": integer(0, 32767, col="price_options.position"),
}, ["key", "group", "name", "priceKind", "amount", "amountMax", "inStandard", "position"])

S["PriceOptionRuleInput"] = obj({
    "kind": enum(["exclude", "surcharge"], col="price_option_rules.rule_kind", desc="함께 못 고름·함께 고르면 더하는 값"),
    "optionA": OPTION_KEY,
    "optionB": OPTION_KEY,
    "amount": nullable(integer(1, 10000000, col="price_option_rules.amount", desc="더하는 값(원). surcharge만")),
}, ["kind", "optionA", "optionB", "amount"])

S["DesignInput"] = obj({
    "name": string(1, 30, col="designs.name"),
    "uploadId": dict(UPLOAD_ID, description="새로 올린 도안 그림(용도 design_image)"),
    "sourceDesignId": dict(UUID, description="지난 판의 도안 그림을 그대로 쓸 때 그 도안 ID(같은 가게)"),
    "optionKey": nullable(OPTION_KEY),
    "inStandard": boolean(col="designs.in_standard"),
    "position": integer(0, 32767, col="designs.position"),
}, ["name", "optionKey", "inStandard", "position"],
    oneOf=[{"required": ["uploadId"]}, {"required": ["sourceDesignId"]}])

S["PriceListInput"] = obj({
    "baseRevision": nullable(BASE_REVISION),
    "options": arr(ref("PriceOptionInput"), 1, 100, desc="옵션 100개까지(SPEC-004)"),
    "rules": arr(ref("PriceOptionRuleInput"), 0, 500),
    "designs": arr(ref("DesignInput"), 0, 50, desc="도안 50장까지(SPEC-004)"),
}, ["baseRevision", "options", "rules", "designs"], desc="새 판의 전체 내용. 바꾼 것이 없으면 새 판을 만들지 않음")

S["PriceOption"] = all_required({
    "optionId": UUID,
    "group": enum(["size", "flavor", "design", "extra"]),
    "name": string(1, 30),
    "priceKind": enum(["fixed", "from", "range"]),
    "amount": MONEY(),
    "amountMax": nullable(MONEY()),
    "inStandard": boolean(),
    "position": integer(0, 32767),
})
S["PriceOptionRule"] = all_required({
    "kind": enum(["exclude", "surcharge"]),
    "optionAId": UUID,
    "optionBId": UUID,
    "amount": nullable(integer(1, 10000000)),
})
S["Design"] = all_required({
    "designId": UUID,
    "name": string(1, 30),
    "imageUrl": SIGNED_URL,
    "optionId": nullable(UUID),
    "inStandard": boolean(),
    "position": integer(0, 32767),
})
S["PriceList"] = all_required({
    "version": integer(1, 2147483647, desc="판 번호(TERM-005)"),
    "current": boolean("지금 판인지. 지난 판은 읽기만(REQ-027)"),
    "createdAt": DT,
    "supersededAt": nullable(DT),
    "options": arr(ref("PriceOption"), 0, 100),
    "rules": arr(ref("PriceOptionRule"), 0, 500),
    "designs": arr(ref("Design"), 0, 50),
    "revision": REVISION,
})
S["PriceListResult"] = all_required({"outcome": outcome(("created", "unchanged"), "created: 새 판을 만듦, unchanged: 바꾼 것이 없어 판 그대로(SPEC-004)"), "priceList": ref("PriceList")})
S["VersionSummary"] = all_required({"version": integer(1, 2147483647), "createdAt": DT, "supersededAt": nullable(DT)})
S["VersionList"] = all_required({"items": arr(ref("VersionSummary"), 0, 1000)})

# ── 운영규정 ────────────────────────────────────────────────────────────────
S["ClauseInput"] = obj({
    "key": enum(CLAUSE_KEYS, col="rule_clauses.clause_key", desc="틀의 조문 칸(custom 밖은 판마다 하나)이나 가게가 더한 조문(custom)"),
    "position": integer(1, 32767, col="rule_clauses.position"),
    "title": string(1, 60, col="rule_clauses.title"),
    "conditionText": string(1, 1000, col="rule_clauses.condition_text"),
    "effectText": string(1, 1000, col="rule_clauses.effect_text", desc="AI가 인용할 때는 이 글자 그대로(SPEC-026)"),
}, ["key", "position", "title", "conditionText", "effectText"])
S["RefundTierInput"] = obj({
    "hoursBeforeMin": integer(0, 8760, col="refund_tiers.hours_before_min"),
    "hoursBeforeMax": nullable(integer(1, 8760, col="refund_tiers.hours_before_max")),
    "refundPct": integer(0, 100, col="refund_tiers.refund_pct"),
}, ["hoursBeforeMin", "hoursBeforeMax", "refundPct"])
_rules_fields = {
    "quoteValidHours": integer(1, 720, col="operating_rules.quote_valid_hours", desc="견적 유효 기한(기본 72)"),
    "paymentDueHours": integer(1, 720, col="operating_rules.payment_due_hours", desc="결제 기한(기본 12)"),
    "issueReportHours": integer(1, 720, col="operating_rules.issue_report_hours", desc="문제 신고 기한(기본 24)"),
    "changeDeadlineHours": integer(1, 720, col="operating_rules.change_deadline_hours", desc="변경 마감: 픽업 몇 시간 전까지"),
    "cancellationFeeKrw": integer(0, 10000000, col="operating_rules.cancellation_fee_krw"),
    "preProductionRefundPct": integer(0, 100, col="operating_rules.pre_production_refund_pct", desc="제작 전 취소 환불 비율. 100 밑이면 confirm에 lowered_refund가 있어야 저장(REQ-032)"),
    "dateChangeRefundBasis": enum(["original_pickup", "new_pickup"], col="operating_rules.date_change_refund_basis"),
}
S["OperatingRulesInput"] = obj(dict({"baseRevision": nullable(BASE_REVISION)}, **_rules_fields, **{
    "clauses": arr(ref("ClauseInput"), 1, 50),
    "refundTiers": arr(ref("RefundTierInput"), 0, 20),
    "confirm": confirm_list(["lowered_refund"]),
}), ["baseRevision", *_rules_fields.keys(), "clauses", "refundTiers"])
S["Clause"] = all_required({
    "key": enum(CLAUSE_KEYS), "position": integer(1, 32767), "title": string(1, 60),
    "conditionText": string(1, 1000), "effectText": string(1, 1000),
})
S["RefundTier"] = all_required({"hoursBeforeMin": integer(0, 8760), "hoursBeforeMax": nullable(integer(1, 8760)), "refundPct": integer(0, 100)})
S["OperatingRules"] = all_required({
    "version": nullable(integer(1, 2147483647, desc="판 번호. 틀(아직 확정 전)이면 null")),
    "isTemplate": boolean("아직 확정한 판이 없어 틀의 기본값을 보임(SPEC-005)"),
    "current": boolean(),
    "quoteValidHours": integer(1, 720),
    "paymentDueHours": integer(1, 720),
    "issueReportHours": integer(1, 720),
    "changeDeadlineHours": nullable(integer(1, 720, desc="틀에서는 null(가게가 넣음)")),
    "cancellationFeeKrw": integer(0, 10000000),
    "preProductionRefundPct": integer(0, 100),
    "preProductionLoweredAck": boolean("전액보다 낮춘 판에서 '그래도 저장'을 누름(REQ-032)"),
    "dateChangeRefundBasis": nullable(enum(["original_pickup", "new_pickup"])),
    "clauses": arr(ref("Clause"), 0, 50),
    "refundTiers": arr(ref("RefundTier"), 0, 20),
    "createdAt": nullable(DT),
    "supersededAt": nullable(DT),
    "revision": nullable(REVISION),
})
S["OperatingRulesResult"] = all_required({"outcome": outcome(("created", "unchanged"), "created: 새 판, unchanged: 바꾼 것이 없음"), "operatingRules": ref("OperatingRules")})

# ── 결제 받을 곳 ────────────────────────────────────────────────────────────
S["PaymentDestinationInput"] = obj({
    "baseRevision": nullable(BASE_REVISION),
    "bankName": string(1, 30, col="payment_accounts.bank_name"),
    "accountNumber": string(10, 40, ACCOUNT_RE, col="payment_accounts.account_number", desc="숫자와 '-', 숫자만 10~16자리"),
    "holderName": string(1, 30, col="payment_accounts.holder_name"),
    "cardPaymentUrl": nullable(string(9, 2048, r"^https://", fmt="uri", col="payment_accounts.card_payment_url")),
    "confirm": confirm_list(["holder_mismatch"]),
}, ["baseRevision", "bankName", "accountNumber", "holderName", "cardPaymentUrl"])
S["PaymentDestination"] = all_required({
    "bankName": string(1, 30),
    "accountNumber": string(10, 40, ACCOUNT_RE, desc="가게 명의 계좌번호. 이 화면과 그 가게 손님의 결제 안내에만(SPEC-006)"),
    "holderName": string(1, 30),
    "holderMismatchConfirmed": nullable(boolean("예금주가 상호·대표자와 다를 때 사장님이 '가게 명의가 맞다'고 함")),
    "cardPaymentUrl": nullable(string(9, 2048, r"^https://", fmt="uri")),
    "createdAt": DT,
    "revision": REVISION,
})
S["PaymentDestinationResult"] = all_required({"outcome": outcome(("created", "unchanged"), "created: 새 줄(옛 줄은 그만 씀, 나간 결제 안내는 그대로), unchanged: 같은 값"), "paymentDestination": ref("PaymentDestination")})

# ── 영업 달력 ───────────────────────────────────────────────────────────────
S["CalendarSettingsInput"] = obj({
    "baseRevision": nullable(BASE_REVISION),
    "closedWeekdays": arr(integer(1, 7, desc="1=월 … 7=일"), 0, 7, unique=True),
    "dailyCapacity": integer(0, 100, col="business_calendars.daily_capacity"),
    "orderCutoffDays": integer(0, 30, col="business_calendars.order_cutoff_days"),
    "orderCutoffTime": string(5, 5, HHMM_RE, col="business_calendars.order_cutoff_time"),
    "replyStart": string(5, 5, HHMM_RE, col="business_calendars.reply_start"),
    "replyEnd": string(5, 5, HHMM_RE, col="business_calendars.reply_end", desc="replyStart보다 뒤(칸 오류 not_after_start)"),
    "dayBeforeNoticeTime": string(5, 5, NOTICE_RE, col="business_calendars.day_before_notice_time", desc="08:00~20:50(SPEC-052)"),
    "reviewRequestTime": string(5, 5, NOTICE_RE, col="business_calendars.review_request_time", desc="08:00~20:50(SPEC-061)"),
    "confirm": confirm_list(["closed_day_with_orders"]),
}, ["baseRevision", "closedWeekdays", "dailyCapacity", "orderCutoffDays", "orderCutoffTime", "replyStart", "replyEnd",
    "dayBeforeNoticeTime", "reviewRequestTime"])
S["CalendarSettings"] = all_required({
    "closedWeekdays": arr(integer(1, 7), 0, 7, unique=True),
    "dailyCapacity": integer(0, 100),
    "orderCutoffDays": integer(0, 30),
    "orderCutoffTime": string(5, 5, HHMM_RE),
    "replyStart": string(5, 5, HHMM_RE),
    "replyEnd": string(5, 5, HHMM_RE),
    "dayBeforeNoticeTime": string(5, 5, NOTICE_RE),
    "reviewRequestTime": string(5, 5, NOTICE_RE),
    "updatedAt": DT,
    "revision": REVISION,
})
S["CalendarConflict"] = all_required({
    "day": DATE,
    "capacity": integer(0, 100),
    "held": integer(0, 10000),
    "orders": arr(ref("OrderRef"), 1, 100),
}, desc="바꾼 기준을 넘는 날. 주문은 그대로 두고 사장님께 보임(R4)")
S["CalendarSettingsResult"] = all_required({
    "outcome": outcome(("created", "updated", "unchanged"), "created: 처음 정함, updated: 바꿈(그 뒤 잡는 자리에만), unchanged: 같은 값"),
    "calendar": ref("CalendarSettings"),
    "conflicts": arr(ref("CalendarConflict"), 0, 400),
})
S["CalendarDay"] = all_required({
    "day": DATE,
    "weekdayClosed": boolean("요일 휴무"),
    "closed": boolean("날짜별 휴무"),
    "capacityOverride": nullable(integer(0, 100, desc="그날만 다른 하루 최대 개수")),
    "capacity": integer(0, 100, desc="그날의 하루 최대 개수(가게 기준이나 그날 값)"),
    "held": integer(0, 10000, desc="잡힌 자리(잡힘 + 확정 자리)"),
    "remaining": integer(0, 100, desc="남은 자리. 사장님 화면에만(손님에게는 보이지 않음, G6)"),
    "full": boolean("하루 최대 개수에 닿아 저절로 마감됨"),
    "manuallyClosed": boolean("사장님이 누른 그날 주문 마감(SPEC-012)"),
    "overbooked": boolean("넘겨 잡은 자리가 있음(R10)"),
    "revision": REVISION,
})
S["CalendarDayList"] = all_required({"items": arr(ref("CalendarDay"), 0, 62)})
S["CalendarDayInput"] = obj({
    "baseRevision": nullable(BASE_REVISION),
    "closed": boolean("날짜별 휴무", col="calendar_days.closed"),
    "capacityOverride": nullable(integer(0, 100, col="calendar_days.capacity")),
    "manuallyClosed": boolean("그날 주문 마감(SPEC-012). 풀면 다시 잡음"),
    "confirm": confirm_list(["closed_day_with_orders"]),
}, ["baseRevision"], desc="바꿀 칸만 보냄", minProperties=2)
S["CalendarDayResult"] = all_required({"outcome": outcome(), "day": ref("CalendarDay")})

# ── 카카오톡 채널 ───────────────────────────────────────────────────────────
S["KakaoChannelInput"] = obj({
    "baseRevision": nullable(BASE_REVISION),
    "botId": string(1, 64, r"^\S+$", col="kakao_channels.bot_id", desc="오픈빌더 봇 ID(OPEN-8)"),
    "channelPublicId": nullable(string(2, 40, r"^_[A-Za-z0-9]+$", col="kakao_channels.channel_public_id", desc="채널 공개 ID(예: _xYzAbC). 예약 링크 페이지의 문의 버튼이 엶")),
}, ["baseRevision", "botId", "channelPublicId"])
S["SkillSetup"] = all_required({
    "messageSkillUrl": URL,
    "cardSkillUrl": URL,
    "reviewSkillUrl": URL,
    "headerName": enum(["Siljang-Skill-Key"]),
    "headerValue": string(43, 43, r"^[A-Za-z0-9_-]{43}$", desc="스킬 키. 오픈빌더 스킬 설정의 헤더 값에 넣음(DEC-08). 이 응답 밖과 로그에 남기지 않음"),
}, desc="사장님이 오픈빌더에 넣을 스킬 주소와 헤더")
S["KakaoChannel"] = all_required({
    "connectionId": UUID,
    "botId": string(1, 64),
    "channelPublicId": nullable(string(2, 40, r"^_[A-Za-z0-9]+$")),
    "status": enum(["pending", "linked", "failed"], desc="연결 확인 중·연결됨·연결 안 됨"),
    "checkStartedAt": nullable(DT),
    "checkExpiresAt": nullable(DT),
    "linkedAt": nullable(DT),
    "failureHints": arr(enum(["skill_url", "skill_key_header", "open_builder_deploy", "test_message_missing"]), 0, 4, unique=True,
                        desc="연결 안 됨의 까닭 후보(SPEC-008)"),
    "skill": ref("SkillSetup"),
    "revision": REVISION,
})
S["KakaoChannelResult"] = all_required({"outcome": outcome(("created", "done", "unchanged"), "created: 새 연결(연결 확인 중), done: 연결 확인을 시작함, unchanged: 같은 값이거나 이미 확인 중·연결됨"), "kakaoChannel": ref("KakaoChannel")})

# ── 장부 ────────────────────────────────────────────────────────────────────
S["LedgerAuthorizationInput"] = obj({
    "redirectUri": string(9, 2048, r"^https://", fmt="uri", desc="구글 허락 뒤 돌아올 화면 주소(서버 설정의 목록에 있는 것만)"),
}, ["redirectUri"])
S["LedgerAuthorization"] = all_required({
    "authorizationUrl": URL,
    "state": string(16, 512, r"^[A-Za-z0-9._-]+$", desc="서버가 서명한 값. 돌아온 뒤 POST /owner/ledger에 그대로"),
    "expiresAt": DT,
})
S["LedgerLinkInput"] = obj({
    "baseRevision": nullable(BASE_REVISION),
    "code": string(1, 2048, r"^\S+$", desc="구글이 준 인가 코드"),
    "state": string(16, 512, r"^[A-Za-z0-9._-]+$"),
    "spreadsheetId": string(20, 100, r"^[A-Za-z0-9_-]+$", col="ledger_links.spreadsheet_id", desc="시트 주소의 /d/ 뒤 ID"),
    "sheetName": string(1, 100, col="ledger_links.sheet_name", desc="시트 탭 이름"),
}, ["baseRevision", "code", "state", "spreadsheetId", "sheetName"])
S["LedgerLink"] = all_required({
    "status": enum(["linked", "auth_lost", "unlinked"], desc="연결됨·허락 끊김·끊음"),
    "spreadsheetId": string(20, 100, r"^[A-Za-z0-9_-]+$"),
    "sheetName": string(1, 100),
    "columns": arr(all_required({"header": string(1, 40), "column": string(1, 3, r"^[A-Z]{1,3}$")}), 1, 30, desc="우리가 쓰는 칸의 머리글과 자리"),
    "movedRight": boolean("같은 이름의 사장님 칸이 있어 우리 칸을 오른쪽 빈 칸에 만듦(REQ-127)"),
    "failingSince": nullable(DT),
    "unwrittenCount": integer(0, 100000, desc="아직 장부에 못 적은 쓰기 수"),
    "linkedAt": DT,
    "unlinkedAt": nullable(DT),
    "revision": REVISION,
})
S["LedgerResult"] = all_required({"outcome": outcome(("created", "relinked", "unchanged")), "ledger": ref("LedgerLink")})
S["LedgerUnlinkResult"] = all_required({"outcome": outcome(), "ledger": ref("LedgerLink"), "keptWrites": integer(0, 100000, desc="'연결 끊김'으로 남긴 쓰기 수. 다시 연결하면 지금 값으로 적음")})

# ── 예약 링크와 공개 페이지 ────────────────────────────────────────────────
S["BookingLink"] = all_required({
    "status": enum(["issued", "not_ready"]),
    "url": nullable(URL),
    "issuedAt": nullable(DT),
    "missing": arr(enum(["price_list", "operating_rules", "calendar", "license_verified", "kakao_channel", "payment_destination", "privacy_policy"]), 0, 7, unique=True,
                   desc="빠진 조건(SPEC-010, DEC-12). privacy_policy는 운영자가 채움"),
    "recommended": arr(enum(["pickup_address"]), 0, 1, unique=True, desc="막지 않지만 넣으면 좋은 것(DEC-13)"),
})
S["PublicPriceOption"] = all_required({
    "group": enum(["size", "flavor", "design", "extra"]), "name": string(1, 30), "priceKind": enum(["fixed", "from", "range"]),
    "amount": MONEY(), "amountMax": nullable(MONEY()), "inStandard": boolean(),
})
S["BookingPage"] = all_required({
    "shop": all_required({
        "name": string(1, 40), "businessName": string(1, 60), "representativeName": string(1, 30),
        "contactPhone": string(8, 14, PHONE_RE), "businessRegNo": string(10, 10, r"^[0-9]{10}$"),
        "mailOrderRegNo": nullable(string(1, 40)), "mailOrderExemption": nullable(string(1, 200)),
        "pickupAddress": nullable(string(1, 200)),
    }, desc="가게 신원 정보(REQ-106)"),
    "priceList": all_required({
        "version": integer(1, 2147483647),
        "options": arr(ref("PublicPriceOption"), 0, 100),
        "designs": arr(all_required({"name": string(1, 30), "imageUrl": SIGNED_URL, "inStandard": boolean()}), 0, 50),
    }),
    "days": arr(all_required({"day": DATE, "status": enum(["open", "closed", "day_off"], desc="받음·마감(다 참·마감 시각 지남·사장님 마감)·휴무. 남은 자리 수는 보이지 않음")}), 60, 61,
                desc="오늘부터 60일"),
    "portfolio": arr(all_required({"imageUrl": SIGNED_URL}), 0, 100, desc="게시 동의한 사진만. 비면 화면이 '아직 사진이 없어요'"),
    "privacyPolicyUrl": URL,
    "inquiryUrl": nullable(URL),
}, desc="예약 링크 페이지(SPEC-011). 손님 이름·주문·남은 자리 수·내부 ID 없음(G6)")
S["OverseasTransfer"] = all_required({
    "recipient": string(1, 200), "country": string(1, 100), "personalData": string(1, 500),
    "whenAndHow": string(1, 500), "purposeAndRetention": string(1, 500), "howToRefuse": string(1, 1000),
}, desc="국외 이전 다섯 항목(REQ-141)")
S["PrivacyPolicy"] = all_required({
    "shopName": string(1, 40), "version": integer(1, 2147483647), "body": string(1, 100000),
    "overseasTransfers": arr(ref("OverseasTransfer"), 1, 20), "publishedAt": DT,
})

# ── 할 일 ───────────────────────────────────────────────────────────────────
S["OrderRef"] = all_required({"orderId": UUID, "orderNo": ORDER_NO})
S["OwnerTask"] = all_required({
    "taskId": UUID,
    "kind": enum(TASK_KINDS),
    "waitStatus": nullable(enum(["waiting", "late", "parked", "answered"], desc="사장님 답 기다림(1-7)")),
    "waitDueAt": nullable(DT),
    "order": nullable(ref("OrderRef")),
    "subject": nullable(all_required({
        "type": enum(["handoff", "order", "change_request", "issue_report", "payment_request", "ledger", "shop", "calendar"]),
        "id": nullable(UUID),
    }, desc="열 화면")),
    "summary": string(0, 200, desc="보일 글감. 손님 연락처·계좌·알레르기 없음(SPEC-067)"),
    "openedAt": DT,
    "closedAt": nullable(DT),
})
S["OwnerTaskList"] = all_required({
    "items": arr(ref("OwnerTask"), 0, 100),
    "nextCursor": nullable(CURSOR),
    "alertChannelFriend": boolean("false면 화면 맨 위에 '알림을 받으려면 채널을 추가하세요'(SPEC-067)"),
})

# ── 넘긴 질문과 상담 ────────────────────────────────────────────────────────
S["CustomerLine"] = all_required({
    "at": DT,
    "text": nullable(string(0, 4000, desc="원래 값으로 되돌린 글(그 가게 사장님 화면에만, SPEC-021)")),
    "photos": arr(all_required({"url": SIGNED_URL}), 0, 10),
})
S["Handoff"] = all_required({
    "handoffId": UUID,
    "consultationId": UUID,
    "reason": enum(HANDOFF_REASONS),
    "status": enum(["open", "answered"]),
    "requestedDay": nullable(DATE),
    "order": nullable(ref("OrderRef")),
    "customerLines": arr(ref("CustomerLine"), 1, 50, desc="넘긴 손님 말과 그 뒤 덧붙은 말"),
    "customerChannelFriend": boolean(),
    "answerText": nullable(string(1, 1000)),
    "dayDecision": nullable(enum(["accepted", "declined"])),
    "dayAcceptExpiresAt": nullable(DT),
    "answeredAt": nullable(DT),
    "createdAt": DT,
    "revision": REVISION,
})
S["HandoffAnswerInput"] = obj({
    "baseRevision": BASE_REVISION,
    "text": string(1, 1000, col="handoffs.answer_text", desc="손님에게 그대로 전할 답(AI가 고치지 않음)"),
    "dayDecision": enum(["accepted", "declined"], col="handoffs.day_decision", desc="마감된 날을 받아 줄지(까닭이 closed_day일 때만)"),
}, ["baseRevision"], anyOf=[{"required": ["text"]}, {"required": ["dayDecision"]}])
S["HandoffAnswerResult"] = all_required({
    "outcome": outcome(),
    "handoff": ref("Handoff"),
    "delivery": enum(["sent", "deferred"], desc="바로 보냄(친구)·다음 대화 때 먼저 전함(SPEC-066)"),
})
S["ConsultationMessage"] = all_required({
    "messageId": UUID,
    "at": DT,
    "direction": enum(["inbound", "outbound"]),
    "author": enum(["customer", "ai", "system"]),
    "kind": enum(["text", "photo", "card", "unsupported"]),
    "text": nullable(string(0, 4000, desc="사장님 화면에는 원래 값으로 되돌린 글")),
    "photos": arr(all_required({"url": SIGNED_URL}), 0, 10),
    "delivery": nullable(enum(["skill_response", "callback", "deferred", "delivered_later", "failed"])),
})
S["ConsultationMessagePage"] = all_required({
    "consultationId": UUID,
    "status": enum(["open", "awaiting_owner", "dropped", "ordered", "deleted"]),
    "customerChannelFriend": boolean(),
    "items": arr(ref("ConsultationMessage"), 0, 100),
    "nextCursor": nullable(CURSOR),
})

# ── 주문 ────────────────────────────────────────────────────────────────────
OPTION_REF = all_required({"optionId": UUID, "name": string(1, 30)})
S["OrderDetailsVersion"] = all_required({
    "version": integer(1, 2147483647),
    "source": enum(["request", "owner_amount_change", "change_request", "remake"]),
    "createdAt": DT,
    "pickupAt": DT,
    "courierPickup": boolean("손님이 부른 퀵으로 받음(E7)"),
    "size": nullable(OPTION_REF), "flavor": nullable(OPTION_REF), "designOption": nullable(OPTION_REF),
    "design": nullable(all_required({"designId": UUID, "name": string(1, 30)})),
    "extras": arr(OPTION_REF, 0, 50),
    "designNotes": nullable(string(0, 500)), "lettering": nullable(string(0, 50)), "colors": nullable(string(0, 100)),
    "allergyAnswer": nullable(string(1, 200, desc="이 주문 밖에서 쓰지 않음(REQ-142)")),
    "excludedIngredients": nullable(string(0, 200)),
    "customerName": nullable(string(1, 30)), "customerPhone": nullable(string(8, 14, PHONE_RE)),
    "amount": MONEY(),
    "amountChangeReason": nullable(string(1, 200)),
})
S["QuoteView"] = all_required({
    "priceListVersion": integer(1, 2147483647),
    "operatingRulesVersion": integer(1, 2147483647),
    "orderKind": enum(["standard", "custom"]),
    "displayKind": enum(["fixed", "from", "range"]),
    "amount": MONEY(), "amountMax": nullable(MONEY()),
    "basis": all_required({
        "lines": arr(all_required({"group": enum(["size", "flavor", "design", "extra"]), "name": string(1, 30), "amount": MONEY()}), 0, 60),
        "surcharges": arr(all_required({"optionA": string(1, 30), "optionB": string(1, 30), "amount": integer(1, 10000000)}), 0, 60),
    }, desc="계산 근거(사장님 화면에는 전부, SPEC-013)"),
    "validUntil": DT,
    "quotedAt": DT,
})
S["PaymentRequest"] = all_required({
    "paymentRequestId": UUID,
    "order": ref("OrderRef"),
    "kind": enum(["first", "reissue", "difference"], desc="첫 결제·다시 낸 결제·차액 결제(R13)"),
    "status": enum(["open", "claimed", "mismatch", "paid", "expired", "closed"], desc="나감·확인 요청됨·맞추는 중·확인됨·기한 지남·닫힘(1-3)"),
    "amount": integer(1, 10000000),
    "requestedAmount": nullable(integer(0, 10000000, desc="금액을 바꿔 수락했으면 손님이 요청한 금액(REQ-155)")),
    "issuedAt": DT,
    "dueAt": DT,
    "claimedAt": nullable(DT),
    "claimRejectedAt": nullable(DT),
    "depositorName": nullable(string(1, 30, desc="입금자 이름(입금 대조). AI로 보내지 않음")),
    "mismatchAmount": nullable(integer(1, 100000000)),
    "paidAt": nullable(DT),
    "expiredAt": nullable(DT),
    "closedAt": nullable(DT),
    "closeReason": nullable(enum(["superseded", "order_cancelled", "change_closed"])),
    "revision": REVISION,
})
S["Payment"] = all_required({
    "paymentId": UUID, "paymentRequestId": UUID, "amount": integer(1, 10000000),
    "resolution": enum(["exact", "shortfall_paid", "excess_returned"]), "confirmedAt": DT,
})
S["RefundBasis"] = all_required({
    "operatingRulesVersion": integer(1, 2147483647),
    "clauseTitles": arr(string(1, 60), 0, 10),
    "cancelledAt": nullable(DT),
    "customMaterialOrderedAt": nullable(DT),
    "productionStartedAt": nullable(DT),
    "tierRefundPct": nullable(integer(0, 100)),
    "cancellationFeeKrw": integer(0, 10000000),
    "receivedAmount": integer(0, 100000000),
}, desc="환불 계산 근거(SPEC-016, REQ-084). 사장님께 전부")
REFUND_CAUSES = ["customer_cancel", "shop_cancel", "change_reduced", "compensation", "paid_after_cancel"]
S["RefundSummary"] = all_required({
    "refundId": UUID, "cause": enum(REFUND_CAUSES), "decision": enum(["full", "partial", "none"]),
    "amount": integer(0, 10000000), "decidedAt": DT, "sentAt": nullable(DT),
})
S["ChangeSet"] = obj({
    "size": string(1, 30), "flavor": string(1, 30), "design": string(1, 30),
    "extras": arr(string(1, 30), 0, 20),
    "designNotes": string(0, 500), "lettering": string(0, 50), "colors": string(0, 100),
    "pickupAt": DT, "courierPickup": boolean(),
}, desc="바꾸려는 내용(옵션은 이름). 서버가 그 주문의 가격표 판에서 찾음", minProperties=1)
CHANGE_STATUS = ["requested", "awaiting_difference", "applied", "rejected", "closed_no_difference", "stale", "closed_by_cancel"]
S["ChangeRequestSummary"] = all_required({
    "changeRequestId": UUID, "status": enum(CHANGE_STATUS), "baseVersion": integer(1, 2147483647), "createdAt": DT,
})
S["IssueReportSummary"] = all_required({
    "issueReportId": UUID, "status": enum(["reported", "decided", "closed"]), "late": boolean(), "reportedAt": DT,
})
S["Production"] = all_required({
    "productionId": UUID,
    "needsCustomMaterial": boolean(),
    "customMaterialOrderedAt": nullable(DT),
    "productionStartedAt": nullable(DT),
    "completedAt": nullable(DT),
    "completionPhotos": arr(all_required({"url": SIGNED_URL}), 0, 5),
    "changedAfterStart": boolean("재료 주문·제작 시작 뒤 변경이 반영됨(SPEC-045)"),
    "handedOverAt": nullable(DT),
    "handoverKind": nullable(enum(["pickup", "courier"])),
    "noPickupAt": nullable(DT),
    "discardedAt": nullable(DT),
    "undoableUntil": nullable(DT),
    "revision": REVISION,
})
S["Order"] = all_required({
    "orderId": UUID,
    "orderNo": ORDER_NO,
    "kind": enum(["standard", "custom"]),
    "status": enum(ORDER_STATUS),
    "version": integer(1, 2147483647, desc="주문 내용의 지금 판 번호"),
    "pickupAt": DT,
    "pickupDay": DATE,
    "amount": MONEY(),
    "requestedAt": DT,
    "acceptedAt": nullable(DT),
    "confirmedAt": nullable(DT),
    "rejectedAt": nullable(DT),
    "rejectReason": nullable(string(0, 200)),
    "cancelledAt": nullable(DT),
    "cancelKind": nullable(enum(["customer", "shop", "no_payment"])),
    "cancelReason": nullable(string(1, 200)),
    "remakeOf": nullable(ref("OrderRef")),
    "consultationId": UUID,
    "details": arr(ref("OrderDetailsVersion"), 1, 100, desc="주문 내용 판, 새 판이 앞"),
    "referencePhotos": arr(all_required({"url": SIGNED_URL}), 0, 10),
    "quote": nullable(ref("QuoteView")),
    "day": all_required({"capacity": integer(0, 100), "held": integer(0, 10000), "remaining": integer(0, 100), "full": boolean()},
                        desc="픽업 날의 자리(맞춤 주문 수락 화면, SPEC-031)"),
    "paymentRequests": arr(ref("PaymentRequest"), 0, 50),
    "payments": arr(ref("Payment"), 0, 50),
    "refunds": arr(ref("RefundSummary"), 0, 50),
    "changeRequests": arr(ref("ChangeRequestSummary"), 0, 50),
    "production": nullable(ref("Production")),
    "issueReports": arr(ref("IssueReportSummary"), 0, 20),
    "photoConsent": nullable(all_required({"consented": boolean(), "withdrawnAt": nullable(DT)})),
    "revision": REVISION,
}, desc="사장님이 보는 주문 하나(그 가게 것만)")
S["OrderSummary"] = all_required({
    "orderId": UUID, "orderNo": ORDER_NO, "kind": enum(["standard", "custom"]), "status": enum(ORDER_STATUS),
    "version": integer(1, 2147483647), "pickupAt": DT, "pickupDay": DATE, "amount": MONEY(),
    "courierPickup": boolean(), "customerName": nullable(string(1, 30)), "requestedAt": DT,
    "isRemake": boolean(), "revision": REVISION,
})
S["OrderList"] = all_required({"items": arr(ref("OrderSummary"), 0, 100), "nextCursor": nullable(CURSOR)})
S["CustomDecisionInput"] = obj({
    "baseRevision": BASE_REVISION,
    "decision": enum(["accept", "accept_with_amount", "reject"], desc="수락·금액 바꿔 수락·거절(SPEC-031)"),
    "amount": integer(1, 10000000, col="order_details.amount", desc="바꾼 금액. accept_with_amount만. 지금 금액과 같으면 수락으로 봄"),
    "amountChangeReason": string(1, 200, col="order_details.amount_change_reason", desc="금액을 바꾼 까닭. accept_with_amount면 꼭"),
    "rejectReason": string(0, 200, col="orders.reject_reason"),
    "confirm": confirm_list(["overbooking"]),
}, ["baseRevision", "decision"])
S["OrderCommandResult"] = all_required({
    "outcome": outcome(("done", "unchanged")),
    "order": ref("Order"),
    "paymentRequest": nullable(ref("PaymentRequest")),
}, desc="주문 명령의 결과. 결제 안내가 새로 나갔으면 paymentRequest")
S["OverdueDecisionInput"] = obj({
    "baseRevision": BASE_REVISION,
    "decision": enum(["wait", "cancel"], desc="더 기다리기(SPEC-038)·결제 없어 취소(SPEC-039)"),
    "confirm": confirm_list(["overbooking"]),
}, ["baseRevision", "decision"])
S["ShopCancelInput"] = obj({
    "baseRevision": BASE_REVISION,
    "reason": string(1, 200, col="orders.cancel_reason"),
}, ["baseRevision", "reason"])
S["RefundPreview"] = all_required({
    "order": ref("OrderRef"),
    "cause": enum(REFUND_CAUSES),
    "receivedAmount": integer(0, 100000000, desc="받은 금액(확인된 결제의 합)"),
    "refundedAmount": integer(0, 100000000, desc="이미 정한 환불의 합"),
    "calculatedAmount": integer(0, 10000000, desc="가게 규칙의 계산값"),
    "maxAmount": integer(0, 10000000, desc="정할 수 있는 가장 큰 금액(받은 금액 - 이미 정한 환불, REQ-086)"),
    "basis": ref("RefundBasis"),
})
S["ShopCancelResult"] = all_required({
    "outcome": outcome(),
    "order": ref("Order"),
    "refundPreview": nullable(ref("RefundPreview")),
}, desc="받은 금액이 있으면 refundPreview를 보이고 환불 정하기(API-050)로 감")
S["ProductionMarkInput"] = obj({
    "baseRevision": BASE_REVISION,
    "mark": enum(["custom_material_ordered", "production_started", "completed"]),
    "photoUploadIds": arr(UPLOAD_ID, 0, 5, unique=True, desc="완성 사진(용도 completion_photo). completed만, 5장까지(SPEC-053)"),
}, ["baseRevision", "mark"])
S["ProductionResult"] = all_required({
    "outcome": outcome(),
    "production": ref("Production"),
    "completionPhotoNotice": nullable(enum(["sent", "deferred", "not_sent"], desc="완성 사진 안내: 보냄·다음 대화 때·안 보냄(기능 꺼짐·사진 없음·픽업 지남)")),
})
S["ProductionUndoInput"] = obj({
    "baseRevision": BASE_REVISION,
    "mark": enum(["custom_material_ordered", "production_started", "completed"], col="production_undos.mark", desc="되돌릴 표시. 표시한 뒤 5분 안에만(SPEC-051)"),
}, ["baseRevision", "mark"])
S["HandoverInput"] = obj({
    "baseRevision": BASE_REVISION,
    "kind": enum(["pickup", "courier"], col="productions.handover_kind", desc="픽업 완료됨·퀵으로 보냄"),
    "confirm": confirm_list(["not_pickup_day"]),
}, ["baseRevision", "kind"])
S["RevisionOnlyInput"] = obj({"baseRevision": BASE_REVISION}, ["baseRevision"])
S["ProductionDay"] = all_required({
    "day": DATE,
    "items": arr(all_required({
        "order": ref("OrderRef"),
        "status": enum(["confirmed", "received", "no_pickup"]),
        "pickupAt": DT,
        "courierPickup": boolean(),
        "isRemake": boolean(),
        "summary": all_required({
            "size": nullable(string(1, 30)), "flavor": nullable(string(1, 30)), "design": nullable(string(1, 30)),
            "lettering": nullable(string(0, 50)), "colors": nullable(string(0, 100)), "designNotes": nullable(string(0, 500)),
        }),
        "production": ref("Production"),
    }), 0, 100, desc="확정된 주문과 다시 만들기 주문만, 픽업 일시 순(SPEC-050). 비면 화면이 '이날 만들 주문이 없어요'"),
})

# ── 결제 안내와 환불 ────────────────────────────────────────────────────────
S["PaymentRequestList"] = all_required({"items": arr(ref("PaymentRequest"), 0, 100), "nextCursor": nullable(CURSOR)})
S["ReconciliationInput"] = obj({
    "baseRevision": BASE_REVISION,
    "result": enum(["received", "not_received", "mismatch", "resolved"], desc="들어옴(SPEC-034)·안 들어옴·다르게 들어옴(SPEC-035)·맞춰짐"),
    "mismatchAmount": integer(1, 100000000, col="payment_requests.mismatch_amount", desc="들어온 금액. mismatch만, 안내 금액의 10배까지"),
    "resolution": enum(["shortfall_paid", "excess_returned"], col="payments.resolution", desc="맞춰짐의 까닭. resolved만"),
}, ["baseRevision", "result"])
S["ReconciliationResult"] = all_required({
    "outcome": outcome(("done", "unchanged", "paid_after_cancel"), "paid_after_cancel: 그 사이 주문이 취소돼 확정하지 않고 환불 정할 일을 남김(SPEC-036)"),
    "paymentRequest": ref("PaymentRequest"),
    "payment": nullable(ref("Payment")),
    "order": ref("Order"),
    "changeRequest": nullable(ref("ChangeRequest")),
})
S["RefundInput"] = obj({
    "baseRevision": BASE_REVISION,
    "cause": enum(["customer_cancel", "shop_cancel", "change_reduced", "paid_after_cancel"], col="refunds.cause",
                  desc="손님 취소·가게 사정 취소·금액이 내려간 변경·취소 뒤 들어온 입금. 보상 환불은 API-065"),
    "changeRequestId": dict(UUID, description="금액이 내려간 변경(cause가 change_reduced일 때 꼭)"),
    "decision": enum(["full", "partial", "none"], col="refunds.decision", desc="전액 환불·일부 환불·환불 없이 취소"),
    "amount": integer(0, 10000000, col="refunds.amount", desc="none이면 0. 받은 금액 - 이미 정한 환불을 넘으면 칸 오류 exceeds_received"),
    "overrideReason": string(1, 200, col="refunds.override_reason", desc="계산값과 다른 금액이면 꼭"),
}, ["baseRevision", "cause", "decision", "amount"], desc="주문의 baseRevision으로 정함. 같은 까닭의 환불은 한 번(G2). 우리는 돈을 옮기지 않음(REQ-079)")
REFUND_ACCOUNT_IN = obj({
    "bankName": string(1, 30, col="refunds.refund_bank_name"),
    "accountNumber": string(1, 40, r"^[0-9-]+$", col="refunds.refund_account_number"),
    "holderName": string(1, 30, col="refunds.refund_holder_name"),
}, ["bankName", "accountNumber", "holderName"])
S["Refund"] = all_required({
    "refundId": UUID,
    "order": ref("OrderRef"),
    "cause": enum(REFUND_CAUSES),
    "decision": enum(["full", "partial", "none"]),
    "amount": integer(0, 10000000),
    "calculatedAmount": integer(0, 10000000),
    "basis": ref("RefundBasis"),
    "overrideReason": nullable(string(1, 200)),
    "method": nullable(enum(["bank_transfer", "card_cancel"])),
    "refundAccount": nullable(all_required({
        "bankName": nullable(string(1, 30)), "accountNumber": string(1, 40, r"^[0-9-]+$"), "holderName": nullable(string(1, 30)),
    }, desc="환불받을 손님 계좌. 이 화면에만(R19)")),
    "decidedAt": DT,
    "sentAt": nullable(DT),
    "revision": REVISION,
})
S["RefundResult"] = all_required({
    "outcome": outcome(),
    "refund": ref("Refund"),
    "customerNotice": enum(["sent", "deferred", "none"], desc="손님 안내: 보냄·다음 대화 때·없음(환불 없이 취소)"),
})
S["RefundSentInput"] = obj({
    "baseRevision": BASE_REVISION,
    "method": enum(["bank_transfer", "card_cancel"], col="refunds.method"),
    "refundAccount": nullable(REFUND_ACCOUNT_IN),
}, ["baseRevision", "method"], desc="사장님이 돌려보낸 뒤 '보냄'을 표시. 우리는 돈을 옮기지 않음(REQ-079)")

# ── 변경 요청 ───────────────────────────────────────────────────────────────
S["ChangeRequest"] = all_required({
    "changeRequestId": UUID,
    "order": ref("OrderRef"),
    "baseVersion": integer(1, 2147483647, desc="손님 카드에 묶였던 주문 판"),
    "orderVersion": integer(1, 2147483647, desc="지금 주문 판. 다르면 반영하지 않음(REQ-133)"),
    "changes": ref("ChangeSet"),
    "newPickupAt": nullable(DT),
    "needsOwnerDay": boolean("새 날이 휴무·마감이라 받을지 사장님이 정함"),
    "status": enum(CHANGE_STATUS),
    "amountDelta": nullable(integer(-10000000, 10000000)),
    "rejectReason": nullable(string(0, 200)),
    "changeDeadlineAt": DT,
    "decidedAt": nullable(DT),
    "appliedVersion": nullable(integer(2, 2147483647)),
    "appliedAt": nullable(DT),
    "closedAt": nullable(DT),
    "createdAt": DT,
    "differencePayment": nullable(ref("PaymentRequest")),
    "revision": REVISION,
})
S["ChangeDecisionInput"] = obj({
    "baseRevision": BASE_REVISION,
    "decision": enum(["accept", "reject"]),
    "amountDelta": integer(-10000000, 10000000, col="change_requests.amount_delta", desc="받아들일 때 금액 차이: 오르면 추가 금액(1원~1,000만 원), 내려가면 음수, 그대로면 0"),
    "rejectReason": string(0, 200, col="change_requests.reject_reason"),
    "confirm": confirm_list(["overbooking"]),
}, ["baseRevision", "decision"])
S["ChangeDecisionResult"] = all_required({
    "outcome": outcome(),
    "changeRequest": ref("ChangeRequest"),
    "order": ref("Order"),
    "paymentRequest": nullable(ref("PaymentRequest")),
}, desc="금액이 오르면 차액 결제 안내(SPEC-043), 그대로·내려가면 바로 반영(SPEC-045)")

# ── 문제 신고 ───────────────────────────────────────────────────────────────
S["IssueReport"] = all_required({
    "issueReportId": UUID,
    "order": ref("OrderRef"),
    "orderVersion": integer(1, 2147483647),
    "paidAmount": integer(0, 100000000),
    "late": boolean("신고 기한 뒤에 옴(REQ-072)"),
    "status": enum(["reported", "decided", "closed"]),
    "description": nullable(string(1, 1000)),
    "healthConcern": boolean("먹고 아프다는 말(SPEC-057)"),
    "photos": arr(all_required({"url": SIGNED_URL}), 0, 5),
    "followUps": arr(all_required({"issueReportId": UUID, "reportedAt": DT}), 0, 20, desc="같은 주문의 뒤 신고(이어 붙임)"),
    "compensation": nullable(enum(["remake", "partial_refund", "full_refund", "none"])),
    "decidedAt": nullable(DT),
    "remakeOrder": nullable(ref("OrderRef")),
    "refund": nullable(ref("RefundSummary")),
    "closedAt": nullable(DT),
    "reportedAt": DT,
    "revision": REVISION,
})
S["CompensationInput"] = obj({
    "baseRevision": BASE_REVISION,
    "compensation": enum(["remake", "partial_refund", "full_refund", "none"], col="issue_reports.compensation"),
    "remakePickupAt": dict(DT, description="다시 만들기의 새 픽업 일시(지금 뒤 60일 안). remake만"),
    "refundAmount": integer(1, 10000000, col="refunds.amount", desc="일부 환불 금액. partial_refund만(SPEC-047과 같은 한도)"),
    "refundOverrideReason": string(1, 200, col="refunds.override_reason"),
    "confirm": confirm_list(["closed_day"]),
}, ["baseRevision", "compensation"])
S["CompensationResult"] = all_required({
    "outcome": outcome(),
    "issueReport": ref("IssueReport"),
    "remakeOrder": nullable(ref("Order")),
    "refund": nullable(ref("Refund")),
})

# ── 후기와 포트폴리오 ──────────────────────────────────────────────────────
S["Review"] = all_required({
    "reviewId": UUID,
    "order": ref("OrderRef"),
    "version": integer(1, 2147483647),
    "body": string(1, 1000),
    "createdAt": DT,
    "photos": arr(all_required({
        "photoId": UUID, "url": SIGNED_URL,
        "consent": enum(["consented", "not_consented", "withdrawn"]),
        "inPortfolio": boolean(),
    }), 0, 5),
})
S["ReviewList"] = all_required({"items": arr(ref("Review"), 0, 100), "nextCursor": nullable(CURSOR)})
S["PortfolioItem"] = all_required({
    "portfolioItemId": UUID,
    "source": enum(["review_photo", "completion_photo"]),
    "photoId": UUID,
    "url": SIGNED_URL,
    "publishedAt": DT,
})
S["Portfolio"] = all_required({
    "items": arr(ref("PortfolioItem"), 0, 200),
    "candidates": arr(all_required({
        "source": enum(["review_photo", "completion_photo"]), "photoId": UUID, "url": SIGNED_URL,
        "order": ref("OrderRef"), "consent": enum(["consented", "not_consented", "withdrawn"]),
    }), 0, 200, desc="올릴 수 있는지 보이는 사진들. consented만 올릴 수 있음"),
})
S["PortfolioInput"] = obj({
    "source": enum(["review_photo", "completion_photo"]),
    "photoId": UUID,
}, ["source", "photoId"])
S["PortfolioResult"] = all_required({"outcome": outcome(), "item": ref("PortfolioItem")})

# ── 카카오 스킬 ─────────────────────────────────────────────────────────────
S["SkillPayload"] = obj({
    "intent": obj({"id": string(1, 200), "name": string(0, 200)}, additional=True),
    "userRequest": obj({
        "timezone": string(1, 64),
        "lang": nullable(string(0, 16)),
        "utterance": string(0, 100000, desc="손님 말. 1,000자를 넘으면 앞 1,000자만 AI에(SPEC-017). 칸 한도 없음(messages.body_masked)"),
        "callbackUrl": string(9, 2048, r"^https://", fmt="uri", desc="콜백 주소(블록에서 콜백을 켰을 때). 한 번만, 유효 시간 안(OPEN-2)"),
        "block": obj({"id": string(1, 200), "name": string(0, 200)}, additional=True),
        "params": obj({}, desc="카카오가 붙이는 값(예: surface). 사진이 어떻게 오는지는 OPEN-3", additional=True),
        "user": obj({
            "id": string(1, 70, col="customers.kakao_user_key", desc="botUserKey(최대 70자). 손님 구분 열쇠(G1)"),
            "type": string(1, 32),
            "properties": obj({
                "botUserKey": string(1, 70), "plusfriendUserKey": string(1, 200), "appUserId": string(1, 200),
                "isFriend": boolean("채널 친구인지(REQ-120). 있으면 손님 줄에 남김"),
            }, additional=True),
        }, ["id", "type"], additional=True),
    }, ["utterance", "user"], additional=True),
    "bot": obj({"id": string(1, 64, col="kakao_channels.bot_id", desc="봇 ID. 가게를 찾는 열쇠(SPEC-017)"), "name": string(0, 200)}, ["id"], additional=True),
    "action": obj({
        "id": string(1, 200), "name": string(0, 200),
        "params": obj({
            "review_text": string(0, 100000, desc="후기 글(후기 스킬). 카카오가 보낸 값을 그대로 받고, 1~1,000자(reviews.body) 밖이면 결과 review_invalid로 알림(DEC-07)"),
            "review_photos": string(0, 100000, desc="보안 이미지 플러그인 값(JSON 글자: privacyAgreement·imageQuantity·secureUrls 'List(…)'·expire). 5장을 넘으면 review_invalid"),
            "photo_consent": string(0, 100, desc="사진 게시 동의 답(기본 동의 안 함, DEC-18)"),
        }, desc="블록 파라미터(값은 글자). 카카오가 다른 이름을 더할 수 있음", additional=True),
        "detailParams": obj({}, additional=True),
        "clientExtra": obj({
            "cardKey": string(16, 64, r"^[A-Za-z0-9_-]+$", col="confirm_cards.card_key", desc="확인 카드 키(카드 스킬, G9)"),
            "choice": enum(["confirm", "confirm_with_photo_consent", "decline"], desc="누른 버튼(카드 스킬)"),
            "orderNo": ORDER_NO,
        }, desc="버튼의 extra. 카드 스킬은 cardKey·choice, 후기 스킬은 orderNo", additional=True),
    }, ["id"], additional=True),
    "contexts": arr({"type": "object"}, 0, 50),
    "flow": obj({}, additional=True),
}, ["userRequest", "bot", "action"], additional=True,
    desc="카카오 오픈빌더가 보내는 스킬 요청(2026-11-12 공식 문서 확인). 카카오가 칸을 더할 수 있어 모르는 칸은 받음")

BUTTON = obj({
    "label": string(1, 14),
    "action": enum(["block", "message", "webLink", "phone"]),
    "blockId": string(1, 200),
    "messageText": string(1, 1000),
    "webLinkUrl": URL,
    "phoneNumber": string(8, 14, PHONE_RE),
    "extra": obj({
        "cardKey": string(16, 64, r"^[A-Za-z0-9_-]+$", col="confirm_cards.card_key"),
        "choice": enum(["confirm", "confirm_with_photo_consent", "decline"]),
        "orderNo": ORDER_NO,
    }, desc="블록 버튼이 다음 스킬 요청의 clientExtra로 넘기는 값. 내부 ID 없음(G6)"),
}, ["label", "action"])
QUICK_REPLY = obj({
    "label": string(1, 14),
    "action": enum(["message", "block"]),
    "messageText": string(1, 1000),
    "blockId": string(1, 200),
    "extra": BUTTON["properties"]["extra"],
}, ["label", "action"])
OUTPUT = {"oneOf": [
    obj({"simpleText": obj({"text": string(1, 1000)}, ["text"])}, ["simpleText"]),
    obj({"textCard": obj({
        "title": string(1, 50), "description": string(1, 400),
        "buttons": arr(BUTTON, 0, 3),
    }, ["title"])}, ["textCard"]),
    obj({"simpleImage": obj({"imageUrl": URL, "altText": string(1, 1000)}, ["imageUrl", "altText"])}, ["simpleImage"]),
]}
S["SkillTemplateResponse"] = obj({
    "version": enum(["2.0"]),
    "template": obj({
        "outputs": arr(OUTPUT, 1, 3),
        "quickReplies": arr(QUICK_REPLY, 0, 10),
    }, ["outputs"]),
}, ["version", "template"], desc="스킬 응답(카카오 응답 모양: outputs 1~3개, quickReplies 10개까지, simpleText 1,000자, textCard 제목 50자·설명 400자·버튼 3개, 버튼 이름 14자). 오류 내용·내부 ID·다른 손님 정보 없음(G6)")
S["SkillCallbackAck"] = obj({
    "version": enum(["2.0"]),
    "useCallback": {"type": "boolean", "const": True},
    "data": obj({"text": string(1, 1000)}, ["text"]),
}, ["version", "useCallback"], desc="콜백으로 답한다는 응답(SPEC-017). 답은 userRequest.callbackUrl로 감")
S["SkillResponse"] = {"oneOf": [ref("SkillTemplateResponse"), ref("SkillCallbackAck")]}
S["KakaoCallbackResult"] = obj({
    "taskId": string(1, 200), "status": enum(["SUCCESS", "FAIL", "ERROR"]),
    "message": string(0, 1000), "timestamp": {"type": "integer", "minimum": 0, "maximum": 99999999999999},
}, ["status"], additional=True, desc="카카오가 콜백 요청에 돌려주는 결과(카카오 문서)")

# ── AI-1 출력 (HTTP로 오가지 않음. 서버 안 LangGraph 노드의 구조화 출력, DEC-17) ─────────────
PLACEHOLDER_PHONE = r"^\[전화번호[0-9]{1,3}\]$"
PLACEHOLDER_ACCOUNT = r"^\[계좌번호[0-9]{1,3}\]$"
S["AiTurnOutput"] = obj({
    "reply": string(0, 600, desc="손님에게 보낼 글. 비면 서버가 '다시 한번 말씀해 주시겠어요?'(SPEC-020)"),
    "draft_patch": obj({
        "pickup_at": DT,
        "courier_pickup": boolean(col="order_drafts.courier_pickup"),
        "size": string(1, 30), "flavor": string(1, 30), "design_option": string(1, 30), "design": string(1, 30),
        "extras": arr(string(1, 30), 0, 20, unique=True),
        "design_notes": string(0, 500, col="order_drafts.design_notes"),
        "lettering": string(0, 50, col="order_drafts.lettering"),
        "colors": string(0, 100, col="order_drafts.colors"),
        "allergy_answer": string(1, 200, col="order_drafts.allergy_answer"),
        "excluded_ingredients": string(0, 200, col="order_drafts.excluded_ingredients"),
        "customer_name": string(1, 30, col="order_drafts.customer_name"),
        "customer_phone": string(1, 20, PLACEHOLDER_PHONE, desc="AI는 자리표만 봄. 서버가 원래 값으로 바꿔 저장"),
    }, desc="주문서 초안에 넣을 칸(옵션은 이름). 서버가 형식을 확인한 뒤 저장(SPEC-020)", minProperties=1),
    "quote_request": obj({
        "size": string(1, 30), "flavor": string(1, 30), "design_option": string(1, 30), "design": string(1, 30),
        "extras": arr(string(1, 30), 0, 20, unique=True), "pickup_day": DATE,
    }, desc="견적 내기에 쓸 옵션. 서버가 가게 규칙으로 계산해 남김(SPEC-013)", minProperties=1),
    "handoff": obj({
        "reason": enum(["edibility", "cannot_answer", "closed_day", "legal_medical", "customer_request", "pre_receipt_issue"]),
        "requested_day": DATE,
    }, ["reason"], desc="넘길 까닭(SPEC-022)"),
    "issue_patch": obj({
        "order_no": ORDER_NO,
        "photo_positions": arr(integer(1, 5), 0, 5, unique=True),
        "description": string(1, 1000, col="issue_details.description"),
        "health_concern": boolean(col="issue_details.health_concern"),
    }, desc="신고 내용 모으기(SPEC-057)", minProperties=1),
    "refund_account_patch": obj({
        "bank_name": string(1, 30, col="refunds.refund_bank_name"),
        "account_number": string(1, 20, PLACEHOLDER_ACCOUNT, desc="AI는 자리표만 봄. 서버가 원래 값으로 바꿔 그 환불에만 저장(SPEC-049, DEC-17)"),
        "holder_name": string(1, 30, col="refunds.refund_holder_name"),
    }, ["account_number"], desc="환불받을 손님 계좌(SPEC-049)"),
    "card": obj({
        "kind": enum(["order_request", "payment_claim", "change_request", "cancel", "issue_report", "consent_withdrawal"], col="confirm_cards.kind"),
        "order_no": ORDER_NO,
        "changes": ref("ChangeSet"),
    }, ["kind"], desc="보일 확인 카드. 서버가 허락된 종류인지·대상 주문이 이 사용자·이 가게 것인지 보고 저장된 값으로 만듦(SPEC-069)"),
}, ["reply"], desc="AI-1 상담 답 만들기의 출력 하나(손님 메시지 한 차례). HTTP로 오가지 않는 서버 안 구조화 출력(DEC-17). 서버가 확인하고 어긋나는 부분은 버림. "
          "Open: AI 모델 회사·모델은 개발 전(10단계 전)에 고르고, 고르는 날 그 회사의 약관·데이터 방침을 확인해 처리방침의 국외 이전 항목을 채움(OPEN-7)")
