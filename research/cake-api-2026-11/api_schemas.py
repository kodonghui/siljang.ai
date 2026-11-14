"""06단계 API 계약의 스키마(components.schemas). build_api.py가 읽는다.

- 요청 필드에는 `x-corthex-column: 테이블.컬럼`을 달아 05단계 db/schema.sql의 그 컬럼 한도와 견준다(check_api.py C7).
- 요청·응답 객체는 모두 additionalProperties: false: 계약 밖 필드는 요청이면 422, 응답이면 계약 테스트가 실패한다(G6 노출).
- 카카오 스킬 요청(SkillPayload)만 카카오가 필드를 더할 수 있어 additionalProperties를 막지 않는다.
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
    """응답 객체: 필드는 모두 늘 실림(값이 없으면 null). optional만 빠질 수 있음."""
    return obj(props, [k for k in props if k not in optional], desc=desc, **extra)


# ── 자주 쓰는 형식 ───────────────────────────────────────────────────────────
UUID = {"type": "string", "format": "uuid"}
DT = {"type": "string", "format": "date-time"}
DATE = {"type": "string", "format": "date"}
URL = {"type": "string", "format": "uri", "maxLength": 2048}
SIGNED_URL = {"type": "string", "format": "uri", "maxLength": 2048, "description": "15분 사는 서명 주소. 저장 위치는 포함하지 않음(DEC-09)"}
REVISION = string(1, 64, r"^[A-Za-z0-9._-]+$", desc="서버가 만든 버전 표시. 명령의 baseRevision에 그대로 보냄(DEC-05)")
BASE_REVISION = string(1, 64, r"^[A-Za-z0-9._-]+$", desc="화면이 본 기록의 revision. 지금과 다르면 409 version_conflict(DEC-05, G3)")
ORDER_REVISION = string(1, 64, r"^[A-Za-z0-9._-]+$", desc="주문의 잠금 번호(orders.lock_version)로 만든 revision. 상태·시각·금액을 쓸 때마다 바뀜. 명령의 baseRevision에 그대로 보냄(DEC-05, 설계 재검토 H12)")
CHANGE_REVISION = string(1, 64, r"^[A-Za-z0-9._-]+$", desc="변경 요청의 잠금 번호(change_requests.lock_version)로 만든 revision. 쓸 때마다 바뀜(DEC-05, 설계 재검토 H12)")
UPLOAD_ID = string(24, 204, r"^upl_[A-Za-z0-9_-]{20,200}$", desc="POST /owner/uploads가 준 ID. 1시간 안에 써야 함(DEC-09)")
ORDER_NO = string(6, 12, r"^[0-9A-Z]{6,12}$", desc="주문번호. 손님에게 보이는 유일한 번호(G6)")
PHONE_RE = r"^[0-9-]{8,14}$"
HHMM_RE = r"^([01][0-9]|2[0-3]):[0-5][0-9]$"
NOTICE_RE = r"^((0[89]|1[0-9]):[0-5][0-9]|20:([0-4][0-9]|50))$"
ACCOUNT_RE = r"^-*([0-9]-*){10,16}$"
MONEY = lambda col=None, lo=0: integer(lo, 10000000, col=col, desc="원")
CURSOR = string(1, 200, r"^[A-Za-z0-9_-]+$")

ORDER_STATUS = ["requested", "awaiting_payment", "payment_overdue", "confirmed", "received", "no_pickup", "rejected", "cancelled"]
TASK_KINDS = ["handoff", "custom_order", "change_request", "issue_report", "payment_claim", "payment_mismatch", "payment_overdue", "refund_decision", "paid_after_cancel", "ledger_relink", "license_on_hold", "calendar_conflict", "refund_send", "arrival_check"]
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
    "detail": string(1, 1000, desc="이번 일의 설명. 넣은 값·내부 오류 내용·시크릿·다른 가게의 존재를 포함하지 않음(G6)"),
    "instance": string(1, 2048, fmt="uri-reference", desc="요청 경로"),
    "code": {"type": "string", "description": "오류 코드. components.x-corthex.errors에 있는 것만"},  # enum은 build_api.py가 채움
    "traceId": string(32, 32, r"^[0-9a-f]{32}$", desc="서버 로그의 추적 ID(W3C trace-id)"),
    "errors": arr(ref("FieldError"), 1, 50, desc="validation_failed일 때 필드마다 사유"),
    "confirm": arr(ref("ConfirmationNeeded"), 1, 10, desc="confirmation_required일 때 확인할 것"),
    "retryAfterSeconds": integer(1, 3600, desc="429일 때 다시 호출할 수 있을 때까지 초(Retry-After와 같음)"),
}, ["type", "title", "status", "code", "traceId"],
    desc="RFC 9457 Problem Details에 code와 traceId를 더한 오류 형식. 모든 오류 응답이 이 형식(application/problem+json)")

S["FieldError"] = obj({
    "field": string(1, 200, r"^((/[A-Za-z0-9_]+)+|(header|query|path):[A-Za-z0-9_-]+|file|/)$",
                    desc="요청에서 틀린 필드의 위치(JSON Pointer, 또는 header:이름·query:이름·path:이름·file). 계약에 있는 필드 이름만"),
    "code": {"type": "string", "description": "사유 코드. components.x-corthex.fieldErrors에 있는 것만"},  # enum은 build_api.py가 채움
}, ["field", "code"], desc="필드 오류 하나. 넣은 값은 포함하지 않음")

S["ConfirmationNeeded"] = obj({
    "kind": {"type": "string", "description": "확인할 것. components.x-corthex.confirmations에 있는 것만"},  # enum은 build_api.py가 채움
    "count": integer(0, 10000, desc="관련 주문 수(closed_day_with_orders)"),
    "day": DATE,
}, ["kind"], desc="저장하기 전에 사장님이 확인할 것 하나")

# ── 로그인 ──────────────────────────────────────────────────────────────────
S["OwnerSessionInput"] = obj({
    "kakaoCode": string(1, 512, r"^[A-Za-z0-9_-]+$", desc="카카오 로그인이 화면의 redirectUri로 준 인가 코드"),
    "redirectUri": string(1, 2048, r"^https://", fmt="uri", desc="카카오 로그인에 쓴 redirect_uri(서버 설정의 목록에 있는 것만)"),
    "state": string(16, 512, r"^[A-Za-z0-9._-]+$", desc="로그인 시작(API-078)이 준 state. 카카오가 redirectUri로 돌려준 값 그대로. 서명·10분·로그인 시작 쿠키와 맞아야 함(DEC-10)"),
}, ["kakaoCode", "redirectUri", "state"])

S["OwnerLoginStartInput"] = obj({
    "redirectUri": string(1, 2048, r"^https://", fmt="uri", desc="카카오 로그인에 쓸 redirect_uri(서버 설정의 목록에 있는 것만, 아니면 not_allowed)"),
}, ["redirectUri"])

S["OwnerLoginStart"] = all_required({
    "authorizationUrl": dict(URL, description="카카오 인가 주소. client_id·redirect_uri·response_type=code·state·code_challenge(S256)를 담음. 화면은 이 주소로 이동함(DEC-10, OPEN-11)"),
    "state": string(16, 512, r"^[A-Za-z0-9._-]+$", desc="서버가 nonce와 만료 시각을 서명한 값. 저장하지 않음. 카카오가 redirectUri로 돌려주면 API-001에 그대로 보냄(DEC-10)"),
    "expiresAt": dict(DT, description="state와 로그인 시작 쿠키가 지나는 시각(10분 뒤)"),
}, desc="사장님 로그인 시작: 카카오 인가 주소와 state. nonce는 로그인 시작 쿠키 siljang_login에만 있음")

S["Owner"] = all_required({
    "ownerId": UUID,
    "alertChannelFriend": boolean("우리 서비스 카카오톡 채널 친구인지. 로그인 때의 채널 관계 조회와 알림 발송 결과로 고침(DEC-21, REQ-183). 아니면 알림은 할 일 목록에만(SPEC-067)"),
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
    "businessRegNo": string(10, 10, r"^[0-9]{10}$", col="shops.business_reg_no", desc="사업자등록번호 10자리. 검증 숫자가 틀리면 필드 오류 checksum_failed"),
    "mailOrderRegNo": nullable(string(1, 40, col="shops.mail_order_reg_no")),
    "mailOrderExemption": nullable(string(1, 200, col="shops.mail_order_exemption", desc="통신판매업 신고번호 대신 면제 사유. 둘 가운데 하나는 꼭(REQ-106)")),
    "foodLicenseNo": string(1, 30, col="shops.food_license_no"),
    "foodBusinessType": enum(["instant_sale_manufacturing", "bakery"], col="shops.food_business_type",
                             desc="즉석판매제조·가공업, 제과점영업. 그 밖은 첫 버전에서 받지 않음(필드 오류 not_allowed)"),
    "licensePhotoUploadId": dict(UPLOAD_ID, description="용도 license_photo로 올린 신고증 사진"),
}
S["ShopRegistration"] = obj(dict(_shop_fields, **{
    "entrustmentTermsVersion": string(1, 20, r"^[0-9A-Za-z.-]+$", col="shops.entrustment_terms_version", desc="화면이 보여 준 개인정보 처리 위탁·재위탁 조건의 버전"),
    "entrustmentConsent": boolean("그 조건에 동의함. false면 422 consent_required, 넣은 값도 남기지 않음(REQ-107)"),
}), ["name", "contactPhone", "businessName", "representativeName", "businessRegNo", "foodLicenseNo", "foodBusinessType",
     "licensePhotoUploadId", "entrustmentTermsVersion", "entrustmentConsent"])

S["ShopUpdate"] = obj({
    "baseRevision": BASE_REVISION,
    "name": string(1, 40, col="shops.name"),
    "contactPhone": string(8, 14, PHONE_RE, col="shops.contact_phone"),
    "pickupAddress": nullable(string(1, 200, col="shops.pickup_address", desc="픽업 장소. 전날 안내에 포함함(E14, DEC-13)")),
    "completionPhotoEnabled": boolean("완성 사진 보내기(SPEC-009)", col="shops.completion_photo_enabled"),
    "idleCloseHours": integer(1, 720, col="shops.idle_close_hours", desc="문의 끊김까지 시간(SPEC-025)"),
    "ownerWaitMinutes": integer(10, 1440, col="shops.owner_wait_minutes", desc="사장님 답 기다리는 시간(SPEC-024)"),
    "dailyAiCostLimitKrw": integer(0, 1000000, col="shops.daily_ai_cost_limit_krw", desc="하루 AI 비용 한도(REQ-163)"),
}, ["baseRevision"], desc="바꿀 필드만 보냄(baseRevision 밖 한 필드 이상)", minProperties=2)

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
}, desc="운영자 확인 목록의 가게. 손님·주문 기록은 가게 기록 보기(API-074~077)에서 가린 값으로만(SPEC-003, SPEC-073)")

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
    "paymentAccount": nullable(all_required({
        "bankName": string(1, 30),
        "holderName": string(1, 30),
        "accountLast4": string(4, 4, r"^[0-9]{4}$", desc="계좌번호 끝 4자리. 계좌번호 전체는 운영자에게도 보이지 않음(SPEC-003)"),
        "holderMatches": boolean("예금주가 신고증의 대표자나 상호와 같음(REQ-197)"),
        "holderMismatchConfirmed": nullable(boolean("예금주가 다를 때 사장님이 '가게 명의가 맞다'고 답함(SPEC-006)")),
        "holderCheckedAt": nullable(DT),
        "holderCheckedBy": nullable(ref("Operator")),
        "createdAt": DT,
    }, desc="지금 쓰는 결제 계좌(은행·예금주·끝 4자리)와 예금주를 확인한 운영자·시각. 없으면 null이고 확인됨을 남길 수 없음(409 payment_account_missing, REQ-197)")),
    "createdAt": DT,
    "revision": REVISION,
}, desc="운영자가 보는 가게 등록 정보와 결제 계좌의 은행·예금주·끝 4자리(SPEC-003). 손님·주문 기록은 없음")

S["LicenseReviewInput"] = obj({
    "baseRevision": BASE_REVISION,
    "decision": enum(["verified", "on_hold"], desc="확인됨·보류(SPEC-003). 확인됨을 보류로 바꾸기는 첫 버전에서 하지 않음(M7)"),
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
OPTION_KEY = string(1, 40, r"^[A-Za-z0-9_-]+$", desc="이 요청 안에서 옵션을 참조하는 이름(규칙·도안이 씀). 저장되지 않음")
S["PriceOptionInput"] = obj({
    "key": OPTION_KEY,
    "group": enum(["size", "flavor", "design", "extra"], col="price_options.option_group", desc="크기·맛·디자인·더하는 옵션"),
    "name": string(1, 30, col="price_options.name"),
    "priceKind": enum(["fixed", "from", "range"], col="price_options.price_kind", desc="확정·부터·범위"),
    "amount": MONEY("price_options.amount"),
    "amountMax": nullable(MONEY("price_options.amount_max")),
    "inStandard": boolean("기본 디자인 범위 안인지. 사장님이 옵션마다 고르고 이 가격표 버전에 함께 남음. 값이 '확정'(fixed)인 옵션만 넣을 수 있고 '부터'·'범위'를 넣으면 422 not_allowed(REQ-228). 범위 밖 옵션을 고른 주문은 맞춤 주문(SPEC-013, REQ-229)", col="price_options.in_standard"),
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
    "sourceDesignId": dict(UUID, description="이전 버전의 도안 그림을 그대로 쓸 때 그 도안 ID(같은 가게)"),
    "optionKey": nullable(OPTION_KEY),
    "inStandard": boolean("기본 디자인 범위 안인지. 사장님이 도안마다 고르고 이 가격표 버전에 함께 남음. 이은 디자인 옵션(optionKey)이 범위 밖이면 넣을 수 없어 422 not_allowed(REQ-228)", col="designs.in_standard"),
    "position": integer(0, 32767, col="designs.position"),
}, ["name", "optionKey", "inStandard", "position"],
    oneOf=[{"required": ["uploadId"]}, {"required": ["sourceDesignId"]}])

S["PriceListInput"] = obj({
    "baseRevision": nullable(BASE_REVISION),
    "options": arr(ref("PriceOptionInput"), 1, 100, desc="옵션 100개까지(SPEC-004)"),
    "rules": arr(ref("PriceOptionRuleInput"), 0, 500),
    "designs": arr(ref("DesignInput"), 0, 50, desc="도안 50장까지(SPEC-004)"),
}, ["baseRevision", "options", "rules", "designs"], desc="새 버전의 전체 내용. 바꾼 것이 없으면 새 버전을 만들지 않음")

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
    "version": integer(1, 2147483647, desc="버전(TERM-005)"),
    "current": boolean("현재 버전인지. 이전 버전은 읽기만(REQ-027)"),
    "createdAt": DT,
    "supersededAt": nullable(DT),
    "options": arr(ref("PriceOption"), 0, 100),
    "rules": arr(ref("PriceOptionRule"), 0, 500),
    "designs": arr(ref("Design"), 0, 50),
    "revision": REVISION,
})
S["PriceListResult"] = all_required({"outcome": outcome(("created", "unchanged"), "created: 새 버전을 만듦, unchanged: 바꾼 것이 없어 버전 그대로(SPEC-004)"), "priceList": ref("PriceList")})
S["VersionSummary"] = all_required({"version": integer(1, 2147483647), "createdAt": DT, "supersededAt": nullable(DT)})
S["VersionList"] = all_required({"items": arr(ref("VersionSummary"), 0, 1000)})

# ── 운영규정 ────────────────────────────────────────────────────────────────
S["ClauseInput"] = obj({
    "key": enum(CLAUSE_KEYS, col="rule_clauses.clause_key", desc="템플릿의 조문 필드(custom 밖은 버전마다 하나)나 가게가 더한 조문(custom)"),
    "position": integer(1, 32767, col="rule_clauses.position"),
    "title": string(1, 60, col="rule_clauses.title"),
    "conditionText": string(1, 1000, col="rule_clauses.condition_text"),
    "effectText": string(1, 1000, col="rule_clauses.effect_text", desc="AI가 인용할 때는 이 글자 그대로(SPEC-026)"),
}, ["key", "position", "title", "conditionText", "effectText"])
S["RefundTierInput"] = obj({
    "hoursBeforeMin": integer(0, 8760, col="refund_tiers.hours_before_min", desc="기준 픽업 일시 몇 시간 전부터(이 값 포함). 남은 시간은 1시간 미만을 버림(SPEC-016)"),
    "hoursBeforeMax": nullable(integer(1, 8760, col="refund_tiers.hours_before_max", desc="몇 시간 전까지(이 값 뺌). null이면 끝없음")),
    "refundPct": integer(0, 100, col="refund_tiers.refund_pct"),
}, ["hoursBeforeMin", "hoursBeforeMax", "refundPct"])
_rules_fields = {
    "quoteValidHours": integer(1, 720, col="operating_rules.quote_valid_hours", desc="견적 유효 기한(기본 72)"),
    "paymentDueHours": integer(1, 720, col="operating_rules.payment_due_hours", desc="결제 기한(기본 12)"),
    "issueReportHours": integer(1, 720, col="operating_rules.issue_report_hours", desc="문제 신고 기한(기본 24)"),
    "changeDeadlineHours": integer(1, 720, col="operating_rules.change_deadline_hours", desc="변경 마감: 픽업 몇 시간 전까지"),
    "cancellationFeeKrw": integer(0, 10000000, col="operating_rules.cancellation_fee_krw",
                                  desc="고정 취소 수수료 0원~1,000만 원. 저장할 때는 주문 금액과 견주지 않고, 환불 계산에서 비율보다 먼저 빼며 바탕보다 크면 환불 0원(SPEC-005, SPEC-016)"),
    "preProductionRefundPct": integer(0, 100, col="operating_rules.pre_production_refund_pct",
                                      desc="제작 전 취소 환불 비율. 100 밑이면 confirm에 lowered_refund가 있어야 저장(REQ-032). 단계별 환불이 없는 버전은 맞춤 재료 주문·제작 시작 뒤 취소에도 씀(SPEC-016)"),
    "dateChangeRefundBasis": enum(["original_pickup", "new_pickup"], col="operating_rules.date_change_refund_basis",
                                  desc="날짜를 바꾼 주문의 환불 기준일: 처음 픽업일(주문 내용 첫 버전)·바꾼 픽업일. 단계별 환불의 남은 시간을 이 픽업 일시까지로 셈(SPEC-016)"),
}
S["OperatingRulesInput"] = obj(dict({"baseRevision": nullable(BASE_REVISION)}, **_rules_fields, **{
    "clauses": arr(ref("ClauseInput"), 1, 50),
    "refundTiers": arr(ref("RefundTierInput"), 0, 20,
                       desc="단계별 환불. hoursBeforeMin 차례로 놓으면 0시간부터 시작해 끝없음(hoursBeforeMax null)으로 끝나고, 행의 hoursBeforeMax가 다음 행의 "
                            "hoursBeforeMin과 같음(겹치면 overlaps, 비면 gap). 단계별 환불 조문(staged_refund)과 함께 있거나 함께 없음(SPEC-005)"),
    "confirm": confirm_list(["lowered_refund"]),
}), ["baseRevision", *_rules_fields.keys(), "clauses", "refundTiers"])
S["Clause"] = all_required({
    "key": enum(CLAUSE_KEYS), "position": integer(1, 32767), "title": string(1, 60),
    "conditionText": string(1, 1000), "effectText": string(1, 1000),
})
S["RefundTier"] = all_required({"hoursBeforeMin": integer(0, 8760), "hoursBeforeMax": nullable(integer(1, 8760)), "refundPct": integer(0, 100)})
S["OperatingRules"] = all_required({
    "version": nullable(integer(1, 2147483647, desc="버전. 템플릿(아직 확정 전)이면 null")),
    "isTemplate": boolean("아직 확정한 버전이 없어 템플릿의 기본값을 보임(SPEC-005)"),
    "current": boolean(),
    "quoteValidHours": integer(1, 720),
    "paymentDueHours": integer(1, 720),
    "issueReportHours": integer(1, 720),
    "changeDeadlineHours": nullable(integer(1, 720, desc="템플릿에서는 null(가게가 넣음)")),
    "cancellationFeeKrw": integer(0, 10000000),
    "preProductionRefundPct": integer(0, 100),
    "preProductionLoweredAck": boolean("전액보다 낮춘 버전에서 '그래도 저장'을 누름(REQ-032)"),
    "dateChangeRefundBasis": nullable(enum(["original_pickup", "new_pickup"])),
    "clauses": arr(ref("Clause"), 0, 50),
    "refundTiers": arr(ref("RefundTier"), 0, 20),
    "createdAt": nullable(DT),
    "supersededAt": nullable(DT),
    "revision": nullable(REVISION),
})
S["OperatingRulesResult"] = all_required({"outcome": outcome(("created", "unchanged"), "created: 새 버전, unchanged: 바꾼 것이 없음"), "operatingRules": ref("OperatingRules")})

# ── 결제 수단 ────────────────────────────────────────────────────────────
S["PaymentDestinationInput"] = obj({
    "baseRevision": nullable(BASE_REVISION),
    "bankName": string(1, 30, col="payment_accounts.bank_name"),
    "accountNumber": string(10, 40, ACCOUNT_RE, desc="숫자와 '-', 숫자만 10~16자리. 형식은 여기서만 확인하고 데이터베이스에는 앱이 암호화한 값과 끝 4자리만 둠(05단계 E20, payment_accounts.account_number_enc·account_last4)"),
    "holderName": string(1, 30, col="payment_accounts.holder_name"),
    "cardPaymentUrl": nullable(string(9, 2048, r"^https://", fmt="uri", col="payment_accounts.card_payment_url")),
    "confirm": confirm_list(["holder_mismatch"]),
}, ["baseRevision", "bankName", "accountNumber", "holderName", "cardPaymentUrl"])
S["PaymentDestination"] = all_required({
    "bankName": string(1, 30),
    "accountNumber": string(10, 40, ACCOUNT_RE, desc="가게 명의 계좌번호. 앱이 암호화해 두고 이 화면과 그 가게 손님의 결제 안내를 보일 때만 복호화함(SPEC-006, REQ-191). 운영자에게는 끝 4자리만"),
    "holderName": string(1, 30),
    "holderMismatchConfirmed": nullable(boolean("예금주가 상호·대표자와 다를 때 사장님이 '가게 명의가 맞다'고 함")),
    "cardPaymentUrl": nullable(string(9, 2048, r"^https://", fmt="uri")),
    "createdAt": DT,
    "revision": REVISION,
})
S["PaymentDestinationResult"] = all_required({"outcome": outcome(("created", "unchanged"), "created: 새 행(옛 행은 그만 씀, 나간 결제 안내는 그대로), unchanged: 같은 값"), "paymentDestination": ref("PaymentDestination")})

# ── 영업 캘린더 ───────────────────────────────────────────────────────────────
S["CalendarSettingsInput"] = obj({
    "baseRevision": nullable(BASE_REVISION),
    "closedWeekdays": arr(integer(1, 7, desc="1=월 … 7=일"), 0, 7, unique=True),
    "dailyCapacity": integer(0, 100, col="business_calendars.daily_capacity"),
    "orderCutoffDays": integer(0, 30, col="business_calendars.order_cutoff_days"),
    "orderCutoffTime": string(5, 5, HHMM_RE, col="business_calendars.order_cutoff_time"),
    "replyStart": string(5, 5, HHMM_RE, col="business_calendars.reply_start"),
    "replyEnd": string(5, 5, HHMM_RE, col="business_calendars.reply_end", desc="replyStart보다 뒤(필드 오류 not_after_start)"),
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
    "full": boolean("하루 최대 개수에 닿아 자동으로 마감됨"),
    "manuallyClosed": boolean("사장님이 누른 그날 주문 마감(SPEC-012)"),
    "overbooked": boolean("마감 후 추가 수락한 자리가 있음(R10)"),
    "revision": REVISION,
})
S["CalendarDayList"] = all_required({"items": arr(ref("CalendarDay"), 0, 62)})
S["CalendarDayInput"] = obj({
    "baseRevision": nullable(BASE_REVISION),
    "closed": boolean("날짜별 휴무", col="calendar_days.closed"),
    "capacityOverride": nullable(integer(0, 100, col="calendar_days.capacity")),
    "manuallyClosed": boolean("그날 주문 마감(SPEC-012). 풀면 다시 잡음"),
    "confirm": confirm_list(["closed_day_with_orders"]),
}, ["baseRevision"], desc="바꿀 필드만 보냄", minProperties=2)
S["CalendarDayResult"] = all_required({"outcome": outcome(), "day": ref("CalendarDay")})

# ── 카카오톡 채널 ───────────────────────────────────────────────────────────
BLOCK_NAMES = ["card", "orderer_info", "allergy_answer", "depositor_name", "review"]
S["KakaoChannelInput"] = obj({
    "baseRevision": nullable(BASE_REVISION),
    "botId": string(1, 64, r"^\S+$", col="kakao_channels.bot_id", desc="오픈빌더 봇 ID(OPEN-8)"),
    "channelPublicId": nullable(string(2, 40, r"^_[A-Za-z0-9]+$", col="kakao_channels.channel_public_id", desc="채널 공개 ID(예: _xYzAbC). 예약 링크 페이지의 문의 버튼이 엶")),
    "blockIds": obj({
        "card": nullable(string(1, 100, r"^\S+$", col="kakao_channels.card_block_id", desc="'확인 카드' 블록 ID. 확인 카드 버튼이 부름(SPEC-069)")),
        "ordererInfo": nullable(string(1, 100, r"^\S+$", col="kakao_channels.orderer_block_id", desc="'주문자 정보' 블록 ID. 주문자 정보 카드 버튼이 부름(SPEC-072)")),
        "allergyAnswer": nullable(string(1, 100, r"^\S+$", col="kakao_channels.allergy_block_id", desc="'알레르기 답' 블록 ID. 알레르기 정보 카드의 '동의하고 알려 주기' 버튼이 부름(SPEC-075)")),
        "depositorName": nullable(string(1, 100, r"^\S+$", col="kakao_channels.depositor_block_id", desc="'입금자 이름' 블록 ID. 결제 확인 요청 카드 버튼이 부름(SPEC-033)")),
        "review": nullable(string(1, 100, r"^\S+$", col="kakao_channels.review_block_id", desc="'후기' 블록 ID. 후기 부탁 버튼이 부름(SPEC-061)")),
    }, ["card", "ordererInfo", "allergyAnswer", "depositorName", "review"],
        desc="카드 버튼이 부를 가게 봇 블록 다섯의 블록 ID(REQ-206, 설계 재검토 H8·H5). 아직 만들지 않은 블록은 null이고, 다섯이 모두 있어야 연결 확인을 시작함(API-032)"),
}, ["baseRevision", "botId", "channelPublicId", "blockIds"])
S["SkillSetup"] = all_required({
    "messageSkillUrl": URL,
    "cardSkillUrl": URL,
    "reviewSkillUrl": URL,
    "eventSkillUrl": URL,
    "eventName": enum(["siljang_notice"], desc="가게 봇의 '안내' 블록에 붙일 Event API 이벤트 이름. 그 블록이 안내 스킬(eventSkillUrl, API-073)을 부름(DEC-20)"),
    "headerName": enum(["Siljang-Skill-Key"]),
    "keyVersion": integer(1, 10000, col="kakao_channels.skill_key_version", desc="지금 스킬 키의 버전. 바꿀 때마다 1 늘어남(REQ-237). 키 값은 이 응답에 없음(DEC-08)"),
    "keyIssuedAt": dict(DT, description="지금 버전의 스킬 키를 만든 시각"),
    "previousKeyValidUntil": nullable(dict(DT, description="앞 버전 키도 받는 끝(바꾼 때부터 24시간). 바로 끊었거나 바꾼 적이 없으면 null(REQ-237)")),
}, desc="사장님이 오픈빌더에 넣을 스킬 주소 넷(메시지·카드·후기·안내)과 헤더 이름, 안내 블록의 이벤트 이름, 스킬 키의 버전. 키 값은 만들 때와 바꿀 때의 응답(skillKey)에만 한 번(DEC-08)")
S["SkillKey"] = all_required({
    "headerName": enum(["Siljang-Skill-Key"]),
    "headerValue": string(43, 43, r"^[A-Za-z0-9_-]{43}$", desc="스킬 키. 오픈빌더 스킬 설정의 헤더 값에 넣음(DEC-08). 이 응답에만 한 번 보이고 다시 볼 수 없음(잃으면 API-079로 바꿈). 로그에 남기지 않음"),
    "keyVersion": integer(1, 10000, col="kakao_channels.skill_key_version", desc="이 키의 버전(REQ-237)"),
}, desc="새 스킬 키. 연결을 만든 응답(API-031 created)과 키를 바꾼 응답(API-079)에만 한 번")
S["KakaoChannel"] = all_required({
    "connectionId": UUID,
    "botId": string(1, 64),
    "channelPublicId": nullable(string(2, 40, r"^_[A-Za-z0-9]+$")),
    "status": enum(["pending", "linked", "failed"], desc="연결 확인 중·연결됨·연결 안 됨"),
    "checkStartedAt": nullable(DT),
    "checkExpiresAt": nullable(DT),
    "linkedAt": nullable(DT),
    "proofPhrase": nullable(string(9, 9, r"^연결 [0-9]{6}$", desc="연결 문구. 연결 확인 중에만 있고 사장님 화면에만 보임. 그 채널 대화창에서 이 문구를 보내야 시험이 시작됨(REQ-238). 서버 시크릿과 연결 ID·연결 확인 시작 시각으로 만들어 저장하지 않음(DEC-08)")),
    "claimExpiresAt": nullable(dict(DT, description="'연결 확인 중' 선점이 풀리는 시각(저장이나 연결 확인 시작에서 30분). 지나면 다른 가게가 같은 봇을 넣을 때 이 연결은 연결 안 됨(REQ-238). 연결 확인 중이 아니면 null")),
    "failureHints": arr(enum(["skill_url", "skill_key_header", "open_builder_deploy", "test_message_missing",
                              "card_block", "orderer_block", "allergy_block", "depositor_block", "review_block"]), 0, 9, unique=True,
                        desc="연결 안 됨의 사유 후보(SPEC-008). test_message_missing은 연결 문구가 10분 안에 그 채널에서 오지 않음(REQ-238). card_block·orderer_block·allergy_block·depositor_block·review_block은 시험 버튼이 우리 스킬에 닿지 않은 블록(REQ-206)"),
    "blockIds": all_required({
        "card": nullable(string(1, 100)), "ordererInfo": nullable(string(1, 100)), "allergyAnswer": nullable(string(1, 100)),
        "depositorName": nullable(string(1, 100)), "review": nullable(string(1, 100)),
    }, desc="넣은 블록 ID 다섯(REQ-206)"),
    "verifiedBlocks": arr(enum(BLOCK_NAMES), 0, 5, unique=True, desc="연결 확인 때 시험 버튼으로 우리 스킬에 닿은 블록. 다섯이 모두 닿아야 연결됨(REQ-206)"),
    "eventStatus": enum(["unchecked", "checking", "ready", "unavailable"],
                        desc="먼저 보내기(Event API): 아직 안 봄·시험 안내 결과 기다림·됨·안 됨. 안 됨이면 그 가게의 손님 안내는 모두 다음 대화 때 전함(REQ-180, REQ-181)"),
    "eventCheckedAt": nullable(DT),
    "eventFailReason": nullable(enum(["app_not_linked", "wallet_missing", "event_block", "event_skill", "owner_not_friend", "not_delivered", "kakao_error"],
                                     desc="먼저 보내기가 안 되는 사유: 가게 채널이 우리 앱에 연결 안 됨·우리 월렛이 봇에 없음·이벤트 이름이나 배포·안내 스킬·사장님이 가게 채널 친구가 아님·닿지 않음·카카오 오류")),
    "skill": ref("SkillSetup"),
    "revision": REVISION,
})
S["KakaoChannelResult"] = all_required({"outcome": outcome(("created", "done", "unchanged"), "created: 새 연결(연결 확인 중), done: 연결 확인이나 시험 안내를 시작함, 같은 봇의 블록 ID를 바꿔 다시 확인하게 함, 스킬 키를 바꿈(API-079), unchanged: 같은 값이거나 이미 확인 중·연결됨(먼저 보내기 됨이거나 시험 중)"), "kakaoChannel": ref("KakaoChannel"),
                                        "skillKey": nullable(ref("SkillKey"))},
                                       desc="skillKey는 새 연결(created)과 스킬 키를 바꾼 응답(API-079)에만 있고 그 밖에는 null(DEC-08, REQ-237)")
S["SkillKeyRegenerateInput"] = obj({
    "baseRevision": BASE_REVISION,
    "previousKey": enum(["keep_24h", "revoke_now"], desc="앞 버전 키: keep_24h는 바꾼 때부터 24시간 더 받음(오픈빌더의 헤더 값을 바꾸고 배포하는 동안 손님 메시지가 끊기지 않게), revoke_now는 바로 거절(키가 샜을 때). 그 전 버전은 늘 거절(REQ-237)"),
}, ["baseRevision", "previousKey"])

# ── 장부 ────────────────────────────────────────────────────────────────────
S["LedgerAuthorizationInput"] = obj({
    "redirectUri": string(9, 2048, r"^https://", fmt="uri", desc="구글 권한 요청 뒤 돌아올 화면 주소(서버 설정의 목록에 있는 것만)"),
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
    "status": enum(["linked", "auth_lost", "unlinked"], desc="연결됨·권한 해제됨·끊음"),
    "spreadsheetId": string(20, 100, r"^[A-Za-z0-9_-]+$"),
    "sheetName": string(1, 100),
    "columns": arr(all_required({"header": string(1, 40), "column": string(1, 3, r"^[A-Z]{1,3}$")}), 1, 30, desc="우리가 쓰는 열의 헤더와 자리"),
    "movedRight": boolean("같은 이름의 사장님 열이 있어 우리 열을 오른쪽 빈 열에 만듦(REQ-127)"),
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
                   desc="미충족 조건(SPEC-010, DEC-12, REQ-164). privacy_policy는 운영자가 채움"),
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
        "designs": arr(all_required({"name": string(1, 30), "imageUrl": SIGNED_URL, "inStandard": boolean()}), 0, 50,
                       desc="가게가 도안으로 올린 견본 사진. 손님 사진이 아니라 게시 동의 없이 보임(REQ-210)"),
    }),
    "days": arr(all_required({"day": DATE, "status": enum(["open", "closed", "day_off"], desc="받음·마감(다 참·마감 시각 지남·사장님 마감)·휴무. 남은 자리 수는 보이지 않음")}), 60, 61,
                desc="오늘부터 60일"),
    "portfolio": arr(all_required({"imageUrl": SIGNED_URL}), 0, 100, desc="손님이 게시에 동의하고 철회하지 않은 완성 사진·후기 사진만(REQ-209). 비면 화면이 '아직 사진이 없어요'"),
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
    "waitStatus": nullable(enum(["waiting", "late", "answered", "closed_no_answer"],
                                desc="사장님 답 기다림(1-7): 기다림·지연(지연 안내와 다시 알림을 보낸 뒤 할 일 목록에 남음)·답함·답 없어 닫힘. "
                                     "에스컬레이션 건·맞춤 주문·변경 요청·문제 신고·결제 확인 요청·맞추는 중·환불 결정에만(REQ-215). "
                                     "답 없어 닫힘은 에스컬레이션 건·맞춤 주문·변경 요청·결제 확인 요청만")),
    "waitDueAt": nullable(dict(DT, description="지연 안내를 보낼 시각(기다리는 시간을 답하는 시간 안에서만 셈, REQ-118). 답 없어 닫는 때(1-7)와 다름")),
    "order": nullable(ref("OrderRef")),
    "subject": nullable(all_required({
        "type": enum(["handoff", "order", "change_request", "issue_report", "payment_request", "refund", "ledger", "shop", "calendar"]),
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

# ── 에스컬레이션 건과 상담 ────────────────────────────────────────────────────────
S["CustomerLine"] = all_required({
    "at": DT,
    "text": nullable(string(0, 4000, desc="전화번호·계좌번호는 원래 값으로 되돌린 글(그 가게 사장님 화면에만, SPEC-021). 카드번호는 플레이스홀더와 끝 4자리, 긴 숫자는 플레이스홀더만(REQ-192)")),
    "photos": arr(all_required({"url": SIGNED_URL}), 0, 10),
    "reason": enum(HANDOFF_REASONS, desc="이 말의 사유. 첫 줄은 에스컬레이션 건의 사유이고, 덧붙은 질문은 질문마다 남은 사유(05단계 handoff_questions). 마감된 날 질문은 덧붙지 않고 날짜마다 따로 건이 됨(SPEC-022)"),
    "order": dict(nullable(ref("OrderRef")), description="이 말과 관련된 주문. 첫 줄은 에스컬레이션 건의 주문, 덧붙은 질문은 질문마다 남은 주문. 없으면 null"),
})
S["Handoff"] = all_required({
    "handoffId": UUID,
    "consultationId": UUID,
    "reason": enum(HANDOFF_REASONS),
    "status": enum(["open", "answered", "closed_no_answer"], desc="열림·답함·답 없어 닫힘(남긴 지 7일 동안 사장님 답이 없음, REQ-216)"),
    "requestedDay": nullable(DATE),
    "order": nullable(ref("OrderRef")),
    "customerLines": arr(ref("CustomerLine"), 1, 50, desc="에스컬레이션한 손님 말과 그 뒤 이 건에 덧붙은 질문(질문마다 사유와 관련 주문, SPEC-022)"),
    "customerChannelFriend": boolean(),
    "answerText": nullable(string(1, 1000)),
    "dayDecision": nullable(enum(["accepted", "declined"])),
    "dayAcceptExpiresAt": nullable(DT),
    "dayUsedOrder": dict(nullable(ref("OrderRef")), description="추가 수락을 쓴 주문 요청: dayAcceptExpiresAt 전에 그 날짜로 와서 마감 후 추가 수락으로 자리를 잡은 주문 하나. 쓰면 다시 쓰지 않음(SPEC-023). 아니면 null"),
    "answeredAt": nullable(DT),
    "closedAt": nullable(dict(DT, description="답 없어 닫힌 시각(남긴 지 7일, REQ-216). 닫힌 건에 답하면 409 invalid_state")),
    "createdAt": DT,
    "revision": REVISION,
})
S["HandoffAnswerInput"] = obj({
    "baseRevision": BASE_REVISION,
    "text": string(1, 1000, col="handoffs.answer_text", desc="손님에게 그대로 전할 답(AI가 고치지 않음)"),
    "dayDecision": enum(["accepted", "declined"], col="handoffs.day_decision", desc="마감된 날에 추가로 받을지(사유가 closed_day일 때만)"),
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
    "text": nullable(string(0, 4000, desc="사장님 화면에는 전화번호·계좌번호를 원래 값으로 되돌린 글. 카드번호는 플레이스홀더와 끝 4자리, 긴 숫자는 플레이스홀더만(REQ-192)")),
    "photos": arr(all_required({"url": SIGNED_URL}), 0, 10),
    "delivery": nullable(enum(["skill_response", "callback", "deferred", "delivered_later", "failed"])),
})
S["ConsultationMessagePage"] = all_required({
    "consultationId": UUID,
    "status": enum(["open", "awaiting_owner", "dropped", "ordered", "ended", "deleted"]),
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
    "allergyAnswer": nullable(string(1, 200, desc="이 주문 밖에서 쓰지 않음(REQ-236). 알레르기 정보에 동의하지 않은 주문은 null(REQ-203)")),
    "allergyConsent": enum(["agreed", "declined", "not_required"],
                           desc="알레르기 정보 동의: 동의함·동의 안 함(알레르기는 묻지 않고 빼야 할 재료만 받음, REQ-203)·동의 필요 없음(동의 단계를 끈 배포, REQ-205). 주문 요청 때 초안에서 옮김(REQ-201, SPEC-029). 설계 재검토 H5, 잠정, 5-2 질문 4의 답으로 다시 봄"),
    "excludedIngredients": nullable(string(0, 200)),
    "customerName": nullable(string(1, 30)), "customerPhone": nullable(string(8, 14, PHONE_RE)),
    "amount": MONEY(),
    "amountChangeReason": nullable(string(1, 200)),
})
S["QuoteView"] = all_required({
    "priceListVersion": integer(1, 2147483647),
    "operatingRulesVersion": integer(1, 2147483647),
    "orderKind": enum(["standard", "custom"], desc="기본 디자인·맞춤. 가게 규칙이 그 가격표 버전의 기본 디자인 범위로 가름: 범위 밖 옵션·도안, 참고 사진, 빼야 할 재료 가운데 하나라도 있거나 표시 방식이 '확정'이 아니면 맞춤(REQ-229, SPEC-013). AI가 정하지 않음"),
    "displayKind": enum(["fixed", "from", "range"], desc="표시 방식('확정'·'부터'·'범위'). '부터'면 amount가 아래 끝, '범위'면 amount~amountMax(SPEC-013)"),
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
    "requestedQuote": nullable(all_required({
        "displayKind": enum(["fixed", "from", "range"], desc="손님이 받은 견적의 표시 방식"),
        "amount": MONEY(), "amountMax": nullable(MONEY()),
    }, desc="금액을 정하거나 바꿔 수락한 맞춤 주문에서 손님이 요청한 견적(표시 그대로: '50,000원', '50,000원부터', '50,000~70,000원'). 다시 낸 결제도 같은 값, 그 밖은 null(REQ-231)")),
    "needsAmountConfirm": boolean("새 금액 확인이 필요한 결제 안내: 손님이 본 금액(견적이 금액 하나면 그 금액, '부터'면 아래 끝, '범위'면 위 끝)보다 높게 정한 맞춤 주문의 첫 결제와 확인받기 전에 다시 낸 결제, 금액이 오르는 변경의 차액 결제. 손님이 확인하기 전에는 계좌를 보이지 않음(SPEC-076, REQ-232)"),
    "amountConfirmedAt": nullable(dict(DT, description="손님이 새 금액을 확인한 시각. 이때가 전해진 시각(deliveredAt)이고 결제 기한을 이때부터 셈. 확인 전에 들어온 돈을 사장님이 결제로 확인('입금됨'·'대조 완료')했으면 그 시각(SPEC-076)")),
    "amountDeclinedAt": nullable(dict(DT, description="손님이 새 금액을 받지 않은 시각. 결제 안내는 닫힘(맞춤 주문은 손님 취소, 변경은 변경 요청이 차액 없어 닫힘, REQ-233)")),
    "issuedAt": DT,
    "deliveredAt": nullable(dict(DT, description="결제 안내가 손님에게 전해진 시각: 대화 중 답으로 보임·먼저 보낸 안내가 닿음·다음 대화 때 전함. "
                                                 "null이면 아직 못 전함(SPEC-032, SPEC-037). 새 금액 확인이 필요하면 손님이 확인한 시각(amountConfirmedAt, SPEC-076)")),
    "dueAt": dict(DT, description="결제 기한: 전해진 시각에 운영규정의 결제 기한(기본 12시간)을 더한 때와 결제 기한 상한 가운데 이른 쪽. "
                                   "전해지기 전에는 상한(REQ-218). 새 금액 확인이 필요한 결제 안내는 손님이 확인하기 전에는 상한(REQ-232)"),
    "dueCapAt": dict(DT, description="결제 기한 상한: 첫 결제·다시 낸 결제는 그 픽업 날짜의 주문 마감(이미 지났으면 픽업 일시), "
                                      "차액 결제는 변경 마감. 낼 때 정함. 확인 요청됨도 이때 기한 지남(REQ-218, REQ-223)"),
    "claimedAt": nullable(DT),
    "claimRejectedAt": nullable(DT),
    "depositorName": nullable(string(1, 30, desc="입금자 이름(입금 대조). AI로 보내지 않음")),
    "mismatchAmount": nullable(integer(1, 100000000)),
    "arrivedAmount": nullable(integer(1, 100000000, desc="들어온 금액(받은 금액의 몫, REQ-165). 확인됨은 안내 금액 이상, 맞추는 중은 다르게 들어온 금액, 닫힘·기한 지남은 사장님이 들어왔다고 남긴 금액(SPEC-071). 나감·확인 요청됨은 null")),
    "arrivedAt": nullable(DT),
    "paidAt": nullable(DT),
    "expiredAt": nullable(DT),
    "closedAt": nullable(DT),
    "closeReason": nullable(enum(["superseded", "order_cancelled", "change_closed"], desc="새 결제 안내·주문 취소(맞춤 주문의 새 금액을 받지 않음 포함)·변경 요청이 닫힘(차액의 새 금액을 받지 않음·변경 닫기 포함)")),
    "revision": REVISION,
})
S["Payment"] = all_required({
    "paymentId": UUID, "paymentRequestId": UUID, "amount": integer(1, 10000000),
    "resolution": enum(["exact", "shortfall_paid", "excess_returned"]), "confirmedAt": DT,
    "voidedAt": nullable(DT),
    "voidReason": nullable(string(1, 200, desc="결제 확인을 취소한 사유(REQ-169). 사장님 화면에만")),
}, desc="확인된 결제. voidedAt이 있으면 사장님이 결제 확인을 취소한 것이라 받은 금액에 들지 않음(SPEC-070)")
S["RefundBasis"] = all_required({
    "operatingRulesVersion": integer(1, 2147483647),
    "clauseTitles": arr(string(1, 60), 0, 10),
    "cancelledAt": nullable(DT),
    "customMaterialOrderedAt": nullable(DT),
    "productionStartedAt": nullable(DT),
    "tierRefundPct": nullable(integer(0, 100, desc="쓴 단계별 환불 비율(맞춤 재료 주문·제작 시작 뒤 손님 취소). 아니면 null")),
    "preProductionRefundPct": nullable(integer(0, 100, desc="쓴 제작 전 취소 비율(맞춤 재료 주문·제작 시작 전 손님 취소, 단계별 환불이 없는 버전은 뒤에도). 아니면 null")),
    "pickupBasisAt": nullable(dict(DT, description="단계별 환불의 남은 시간을 센 기준 픽업 일시(날짜를 바꾼 주문은 운영규정의 기준일에 따라 첫 버전이나 지금 픽업 일시). 단계 비율을 쓰지 않으면 null")),
    "cancellationFeeKrw": integer(0, 10000000, desc="먼저 뺀 고정 취소 수수료(손님 취소만, 그 밖은 0)"),
    "receivedAmount": integer(0, 100000000, desc="받은 금액(REQ-165). 재제작 주문의 일이면 원래 주문의 받은 금액"),
    "excludedAmount": integer(0, 100000000, desc="받은 금액에서 빼 바탕을 만든 금액: 이미 정한 환불 합계 + 따로 정할 환불의 계산값(아직 정하지 않은 금액이 내려간 변경·취소 뒤 들어온 입금·더 들어온 금액)"),
    "remakeOrder": dict(nullable(ref("OrderRef")), description="재제작 주문의 취소·다시 신고의 보상이면 그 재제작 주문(시각과 픽업 일시는 이 주문 것). 돈과 환불은 원래 주문(SPEC-060). 아니면 null"),
}, desc="환불 계산 근거(SPEC-016, REQ-084). 사장님께 전부. 손님 취소의 차례: 바탕 = receivedAmount - excludedAmount → 고정 취소 수수료를 먼저 뺌(바탕보다 크면 0원) → "
        "비율(tierRefundPct나 preProductionRefundPct)을 곱해 원 미만 버림 → 0원 이상 바탕 이하. 가게 사정 취소는 바탕 전액, 금액이 내려간 변경은 내려간 금액, 보상은 고른 금액")
REFUND_CAUSES = ["customer_cancel", "shop_cancel", "change_reduced", "compensation", "paid_after_cancel", "over_received"]
S["RefundSummary"] = all_required({
    "refundId": UUID, "cause": enum(REFUND_CAUSES), "decision": enum(["full", "partial", "none"]),
    "amount": integer(0, 100000000), "decidedAt": DT, "sentAt": nullable(DT),
})
S["ChangeSet"] = obj({
    "size": string(1, 30), "flavor": string(1, 30), "design": string(1, 30),
    "extras": arr(string(1, 30), 0, 20),
    "designNotes": string(0, 500), "lettering": string(0, 50), "colors": string(0, 100),
    "pickupAt": DT, "courierPickup": boolean(),
}, desc="바꾸려는 내용(옵션은 이름). 서버가 그 주문의 가격표 버전에서 찾음", minProperties=1)
CHANGE_STATUS = ["requested", "awaiting_difference", "applied", "rejected", "closed_no_difference", "closed_by_cancel",
                 "closed_no_answer"]
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
    "completionPhotos": arr(all_required({
        "url": SIGNED_URL,
        "consent": enum(["consented", "not_consented", "withdrawn"],
                        desc="그 사진의 게시 동의. 완성 사진 안내에서 사진마다 받고 답이 없으면 not_consented(REQ-207). 설계 재검토 H10, 잠정, 5-2 질문 6의 답으로 다시 봄"),
    }), 0, 5, desc="완성 사진과 사진마다의 게시 동의(SPEC-053). 포트폴리오에 올리는 것은 API-067·068"),
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
    "version": integer(1, 2147483647, desc="주문 내용의 지금 버전. 상태만 바뀌면 오르지 않음(동시 변경은 revision으로 견줌)"),
    "pickupAt": DT,
    "pickupDay": DATE,
    "amount": MONEY(),
    "requestedAt": DT,
    "acceptedAt": nullable(DT),
    "confirmedAt": nullable(DT),
    "rejectedAt": nullable(DT),
    "rejectReason": nullable(string(0, 200)),
    "cancelledAt": nullable(DT),
    "cancelKind": nullable(enum(["customer", "shop", "no_payment", "no_answer"],
                                desc="손님이 취소함·가게 사정으로 취소됨·결제 없어 취소됨(사장님이 고르거나 픽업 일시까지 고르지 않음, REQ-217)·"
                                     "답 없어 닫힘(맞춤 주문 요청에 그 픽업 날짜의 주문 마감까지 사장님 답이 없음, REQ-213)")),
    "cancelReason": nullable(string(1, 200)),
    "remakeOf": nullable(ref("OrderRef")),
    "consultationId": UUID,
    "details": arr(ref("OrderDetailsVersion"), 1, 100, desc="주문 내용 버전, 새 버전이 앞"),
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
    "revision": ORDER_REVISION,
}, desc="사장님이 보는 주문 하나(그 가게 것만)")
S["OrderSummary"] = all_required({
    "orderId": UUID, "orderNo": ORDER_NO, "kind": enum(["standard", "custom"]), "status": enum(ORDER_STATUS),
    "version": integer(1, 2147483647), "pickupAt": DT, "pickupDay": DATE, "amount": MONEY(),
    "courierPickup": boolean(), "customerName": nullable(string(1, 30)), "requestedAt": DT,
    "isRemake": boolean(),
    "paymentNotice": nullable(all_required({
        "status": enum(["open", "claimed", "mismatch", "paid", "expired", "closed"]),
        "deliveredAt": nullable(DT),
        "dueAt": DT,
    }, desc="가장 최근 결제 안내의 상태, 손님에게 전해진 시각(null이면 아직 못 전함. 새 금액 확인이 필요하면 손님이 아직 확인하지 않음, SPEC-076), 결제 기한. "
            "결제 기한 지난 주문 목록이 보임(SPEC-037). 결제 안내가 없으면 null")),
    "revision": ORDER_REVISION,
})
S["OrderList"] = all_required({"items": arr(ref("OrderSummary"), 0, 100), "nextCursor": nullable(CURSOR)})
S["CustomDecisionInput"] = obj({
    "baseRevision": BASE_REVISION,
    "decision": enum(["accept", "accept_with_amount", "reject"], desc="수락·금액 변경 수락·거절(SPEC-031). accept는 표시 방식이 '확정'인 견적에만(견적 금액으로 감). '부터'·'범위' 견적은 accept_with_amount로 최종 금액을 넣어야 하고 accept면 422 /amount required(REQ-230)"),
    "amount": integer(1, 10000000, col="order_details.amount", desc="정한 금액. accept_with_amount만. '부터'·'범위' 견적은 아래 끝 이상(낮으면 422 below_quote_min, REQ-230). '확정' 견적에서 견적 금액과 같으면 수락으로 봄. 손님이 본 금액(표시 방식이 '확정'이면 그 금액, '부터'는 아래 끝, '범위'는 위 끝)보다 높으면 결제 안내는 손님의 새 금액 확인을 기다림(SPEC-076, REQ-232)"),
    "amountChangeReason": string(1, 200, col="order_details.amount_change_reason", desc="금액을 정하거나 바꾼 이유. accept_with_amount면 꼭. 손님에게 결제 안내와 새 금액 확인 카드로 그대로 보임(REQ-231)"),
    "rejectReason": string(0, 200, col="orders.reject_reason"),
    "confirm": confirm_list(["overbooking", "closed_day"]),
}, ["baseRevision", "decision"])
S["OrderCommandResult"] = all_required({
    "outcome": outcome(("done", "unchanged")),
    "order": ref("Order"),
    "paymentRequest": nullable(ref("PaymentRequest")),
}, desc="주문 명령의 결과. 결제 안내가 새로 나갔으면 paymentRequest")
S["OverdueDecisionInput"] = obj({
    "baseRevision": BASE_REVISION,
    "decision": enum(["wait", "cancel"], desc="결제 기한 연장(SPEC-038)·결제 없어 취소(SPEC-039)"),
    "confirm": confirm_list(["overbooking", "closed_day", "past_cutoff"]),
}, ["baseRevision", "decision"])
S["ShopCancelInput"] = obj({
    "baseRevision": BASE_REVISION,
    "reason": string(1, 200, col="orders.cancel_reason"),
}, ["baseRevision", "reason"])
S["RefundPreview"] = all_required({
    "order": ref("OrderRef"),
    "cause": enum(REFUND_CAUSES),
    "receivedAmount": integer(0, 100000000, desc="받은 금액: 그 주문 결제 안내의 들어온 금액 합(REQ-165) = confirmedAmount + unconfirmedAmount"),
    "confirmedAmount": integer(0, 100000000, desc="확인된 결제의 합(결제 확인을 취소한 것은 빼고)"),
    "unconfirmedAmount": integer(0, 100000000, desc="결제로 확인하지 않은 들어온 금액: 맞추는 중의 들어온 금액, 안내 금액을 넘어 들어온 금액, 사장님이 들어왔다고 남긴 금액(SPEC-071)"),
    "refundedAmount": integer(0, 100000000, desc="이미 정한 환불의 합"),
    "calculatedAmount": integer(0, 100000000, desc="가게 규칙의 계산값(maxAmount를 넘지 않음). 손님이 취소 카드에서 본 금액. 손님 취소는 바탕에서 수수료를 먼저 빼고(바탕보다 크면 0원) 비율을 곱해 원 미만 버림(basis, SPEC-016). "
                                               "취소 뒤 들어온 입금·더 들어온 금액은 그 결제 안내에서 결제로 확인하지 않은 몫(들어온 금액 - 확인된 결제, SPEC-016·071)"),
    "minAmount": integer(0, 100000000, desc="정할 수 있는 가장 작은 금액 = 계산값(REQ-170). 낮으면 422 below_calculated"),
    "maxAmount": integer(0, 100000000, desc="정할 수 있는 가장 큰 금액(받은 금액 - 이미 정한 환불, REQ-165)"),
    "basis": ref("RefundBasis"),
}, desc="환불 계산 미리보기. order는 돈을 받고 환불을 남길 주문(재제작 주문이면 원래 주문, 그 재제작 주문은 basis.remakeOrder)")
S["ShopCancelResult"] = all_required({
    "outcome": outcome(),
    "order": ref("Order"),
    "refundPreview": nullable(ref("RefundPreview")),
}, desc="받은 금액이 있으면 refundPreview를 보이고 환불 결정(API-050)으로 감")
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
            "size": nullable(string(1, 30)), "flavor": nullable(string(1, 30)), "designOption": nullable(string(1, 30)),
            "design": nullable(string(1, 30)),
            "lettering": nullable(string(0, 50)), "colors": nullable(string(0, 100)), "designNotes": nullable(string(0, 500)),
            "extras": arr(string(1, 30), 0, 20, desc="더하는 옵션 이름(REQ-177)"),
            "allergyAnswer": nullable(string(1, 200, col="order_details.allergy_answer",
                                             desc="알레르기 답('없음'도 답). 알레르기 정보에 동의하지 않은 주문은 null. 그 주문의 행에만 보이고 할 일 요약·사장님 알림·장부에는 넣지 않음(REQ-236, REQ-177)")),
            "allergyConsent": enum(["agreed", "declined", "not_required"],
                                   desc="알레르기 정보 동의. declined면 allergyAnswer가 null이고 화면은 '알레르기: 동의 안 함(빼야 할 재료만 받음)'(REQ-203, SPEC-050)"),
            "excludedIngredients": nullable(string(1, 200, col="order_details.excluded_ingredients", desc="빼야 할 재료. 없으면 null이고 화면은 '없음'(REQ-177)")),
            "referencePhotoCount": integer(0, 10, desc="참고 사진 수. 사진은 주문 화면(SCR-028)에서 봄"),
        }, desc="주문 내용 현재 버전(SPEC-050, 설계 재검토 H6)"),
        "production": ref("Production"),
    }), 0, 100, desc="확정된 주문과 재제작 주문만, 픽업 일시 순(SPEC-050). 알레르기 답·빼야 할 재료·더하는 옵션까지(REQ-177). 비면 화면이 '이날 만들 주문이 없어요'"),
})

# ── 결제 안내와 환불 ────────────────────────────────────────────────────────
S["PaymentRequestList"] = all_required({"items": arr(ref("PaymentRequest"), 0, 100), "nextCursor": nullable(CURSOR)})
S["ReconciliationInput"] = obj({
    "baseRevision": BASE_REVISION,
    "result": enum(["received", "not_received", "mismatch", "resolved", "arrived", "void", "close_change"],
                   desc="입금됨(SPEC-034)·미입금·금액 불일치(SPEC-035)·대조 완료·들어옴(닫힘·기한 지남 결제 안내에 들어온 입금, SPEC-071)·결제 확인 취소(SPEC-070)·"
                        "변경 닫기(맞추는 중인 차액 결제만: 변경 요청을 차액 없어 닫힘으로 두고 들어온 금액은 '더 들어온 금액' 환불로, SPEC-035, REQ-235)"),
    "mismatchAmount": integer(1, 100000000, col="payment_requests.mismatch_amount", desc="들어온 금액. mismatch만, 안내 금액의 10배까지"),
    "arrivedAmount": integer(1, 100000000, col="payment_requests.arrived_amount", desc="들어온 금액. arrived만, 안내 금액의 10배까지(SPEC-071)"),
    "voidReason": string(1, 200, col="payments.void_reason", desc="결제 확인을 취소한 사유. void만, 제작 시작 전(REQ-169)"),
    "resolution": enum(["shortfall_paid", "excess_returned"], col="payments.resolution", desc="대조 완료의 사유. resolved만"),
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
    "cause": enum(["customer_cancel", "shop_cancel", "change_reduced", "paid_after_cancel", "over_received"], col="refunds.cause",
                  desc="손님 취소·가게 사정 취소·금액이 내려간 변경·취소 뒤 들어온 입금·더 들어온 금액(SPEC-071). 보상 환불은 API-065"),
    "changeRequestId": dict(UUID, description="금액이 내려간 변경(cause가 change_reduced일 때 꼭)"),
    "paymentRequestId": dict(UUID, description="돌려줄 들어온 입금의 결제 안내(cause가 paid_after_cancel·over_received일 때 꼭, SPEC-071)"),
    "decision": enum(["full", "partial", "none"], col="refunds.decision",
                     desc="전액 환불·일부 환불·환불 없이 취소(계산값이 0원일 때만, REQ-170). 금액이 내려간 변경(change_reduced)은 차액 돌려주기라 partial(계산값 0원이면 none)만, full이면 필드 오류 not_allowed(SPEC-047)"),
    "amount": integer(0, 100000000, col="refunds.amount", desc="none이면 0. 계산값보다 낮으면 필드 오류 below_calculated(REQ-170), 받은 금액 - 이미 정한 환불을 넘으면 exceeds_received"),
    "overrideReason": string(1, 200, col="refunds.override_reason", desc="계산값과 다른 금액(보상이 아니라 높은 금액만 됨)이면 꼭 1~200자(없으면 필드 오류 required, REQ-084). 같으면 보내지 않음"),
}, ["baseRevision", "cause", "decision", "amount"], desc="주문의 baseRevision으로 정함. 같은 사유의 환불은 한 번(G2). 우리는 돈을 옮기지 않음(REQ-079). "
                                                      "경로의 주문이 재제작 주문이면 원래 주문의 돈으로 셈해 환불을 원래 주문에 남김(SPEC-060)")
REFUND_ACCOUNT_IN = obj({
    "bankName": string(1, 30, col="refunds.refund_bank_name"),
    "accountNumber": string(10, 40, ACCOUNT_RE, desc="숫자와 '-', 숫자만 10~16자리. 데이터베이스에는 앱이 암호화한 값과 끝 4자리만 둠(REQ-191, refunds.refund_account_enc·refund_account_last4)"),
    "holderName": string(1, 30, col="refunds.refund_holder_name"),
}, ["bankName", "accountNumber", "holderName"])
S["Refund"] = all_required({
    "refundId": UUID,
    "order": ref("OrderRef"),
    "cause": enum(REFUND_CAUSES),
    "decision": enum(["full", "partial", "none"]),
    "amount": integer(0, 100000000),
    "calculatedAmount": integer(0, 100000000),
    "basis": ref("RefundBasis"),
    "overrideReason": nullable(string(1, 200, desc="계산값과 다르게 정한 사유. 같거나 보상이면 null")),
    "method": nullable(enum(["bank_transfer", "card_cancel"])),
    "refundAccount": nullable(all_required({
        "bankName": nullable(string(1, 30)), "accountNumber": string(1, 40, r"^[0-9-]+$"), "holderName": nullable(string(1, 30)),
    }, desc="환불받을 손님 계좌. 사장님 화면에서는 이 화면에만(R19). 운영자는 끝 4자리만 보고 사유를 적어 엶(API-077)")),
    "decidedAt": DT,
    "sentAt": nullable(DT),
    "revision": REVISION,
}, desc="정한 환불. order는 환불을 남긴 주문(재제작 주문의 취소·보상 환불은 원래 주문, 그 재제작 주문은 basis.remakeOrder, SPEC-060)")
S["RefundResult"] = all_required({
    "outcome": outcome(),
    "refund": ref("Refund"),
    "customerNotice": enum(["sent", "deferred", "none"], desc="손님 안내: 보냄·다음 대화 때·없음(환불 없이 취소, 이미 표시한 보냄)"),
})
S["RefundSentInput"] = obj({
    "baseRevision": BASE_REVISION,
    "method": enum(["bank_transfer", "card_cancel"], col="refunds.method"),
    "refundAccount": nullable(REFUND_ACCOUNT_IN),
}, ["baseRevision", "method"], desc="사장님이 반환한 뒤 '보냄'을 표시. 우리는 돈을 옮기지 않음(REQ-079)")

# ── 변경 요청 ───────────────────────────────────────────────────────────────
S["ChangeRequest"] = all_required({
    "changeRequestId": UUID,
    "order": ref("OrderRef"),
    "baseVersion": integer(1, 2147483647, desc="손님 카드에 묶였던 주문 버전"),
    "orderVersion": integer(1, 2147483647, desc="지금 주문 버전. 다르면 반영하지 않음(REQ-133)"),
    "orderAmount": integer(0, 10000000, col="order_details.amount", desc="지금 주문 버전의 금액(원, 재제작 주문은 0). 변경 요청 화면이 수락 전 결과 한 줄의 새 금액(지금 금액에 고른 방향과 차이 금액을 더하거나 뺌)과 내려감의 한도(지금 금액 이하)를 보임(SPEC-042)"),
    "changes": ref("ChangeSet"),
    "newPickupAt": nullable(DT),
    "needsOwnerDay": boolean("새 날이 휴무·마감이라 받을지 사장님이 정함"),
    "status": enum(CHANGE_STATUS, desc="요청됨·차액 결제 기다림(손님의 새 금액 확인과 차액 맞추는 중을 포함하고 differencePayment의 상태로 가름)·반영됨·거절됨·차액 없어 닫힘(차액 결제 기한 지남·손님이 새 금액을 받지 않음·변경 닫기)·주문 취소로 닫힘·답 없어 닫힘(1-5)"),
    "amountDelta": nullable(integer(-10000000, 10000000, desc="수락한 금액 차이: 사장님이 고른 방향과 양수 차이 금액으로 서버가 셈(올라감 +, 내려감 -, 그대로 0, DEC-23). 답하기 전은 null")),
    "rejectReason": nullable(string(0, 200)),
    "changeDeadlineAt": DT,
    "decidedAt": nullable(DT),
    "appliedVersion": nullable(integer(2, 2147483647)),
    "appliedAt": nullable(DT),
    "closedAt": nullable(DT),
    "createdAt": DT,
    "differencePayment": nullable(ref("PaymentRequest")),
    "revision": CHANGE_REVISION,
})
S["ChangeDecisionInput"] = obj({
    "baseRevision": BASE_REVISION,
    "decision": enum(["accept", "reject"]),
    "amountDirection": enum(["same", "up", "down"], desc="수락할 때 금액 방향: 그대로·올라감·내려감. 수락이면 꼭(없으면 422 required). 부호를 넣지 않음(DEC-23). 재제작 주문의 변경 요청은 same만(아니면 422 not_allowed, 차액 결제·차액 돌려주기 없음, SPEC-042, SPEC-060)"),
    "amountDifference": integer(1, 10000000, col="change_requests.amount_delta", desc="올라감·내려감의 차이 금액(양수, 원). up·down이면 꼭(없으면 422 required), same이나 거절이면 받지 않음(422 not_allowed). 내려감은 지금 금액 이하, 올라감은 새 금액이 1,000만 원 이하(아니면 422 out_of_range). 서버가 올라감은 +, 내려감은 -로 amountDelta에 남김(DEC-23)"),
    "rejectReason": string(0, 200, col="change_requests.reject_reason"),
    "confirm": confirm_list(["overbooking", "closed_day"]),
}, ["baseRevision", "decision"])
S["ChangeDecisionResult"] = all_required({
    "outcome": outcome(),
    "changeRequest": ref("ChangeRequest"),
    "order": ref("Order"),
    "paymentRequest": nullable(ref("PaymentRequest")),
}, desc="금액이 오르면 새 금액 확인이 필요한 차액 결제 안내(SPEC-043, SPEC-076), 그대로·내려가면 바로 반영(SPEC-045)")

# ── 문제 신고 ───────────────────────────────────────────────────────────────
S["IssueReport"] = all_required({
    "issueReportId": UUID,
    "order": ref("OrderRef"),
    "orderVersion": integer(1, 2147483647),
    "paidAmount": integer(0, 100000000, desc="결제 금액(받은 금액, REQ-165). 재제작 주문에 들어온 신고(다시 신고)면 원래 주문의 받은 금액(SPEC-059)"),
    "late": boolean("신고 기한 뒤에 옴(REQ-072)"),
    "status": enum(["reported", "decided", "closed"]),
    "description": nullable(string(1, 1000)),
    "healthConcern": boolean("먹고 아프다는 말(SPEC-057)"),
    "photos": arr(all_required({"url": SIGNED_URL}), 0, 5),
    "followUps": arr(all_required({"issueReportId": UUID, "reportedAt": DT}), 0, 20, desc="같은 주문의 뒤 신고(연결)"),
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
    "remakePickupAt": dict(DT, description="재제작의 새 픽업 일시(지금 뒤 60일 안). remake만"),
    "refundAmount": integer(1, 100000000, col="refunds.amount",
                            desc="일부 환불 금액. partial_refund만(SPEC-047과 같은 한도: 받은 금액 - 이미 정한 환불, 재제작 주문에 들어온 신고면 원래 주문의 것). "
                                 "보상은 고른 금액이 계산값이라 다르게 정한 사유를 받지 않음(SPEC-059)"),
    "confirm": confirm_list(["closed_day", "overbooking"]),
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
    }), 0, 200, desc="올릴 수 있는지 보이는 완성 사진·후기 사진. consented(동의하고 철회하지 않음)만 올릴 수 있음(REQ-209)"),
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
        "utterance": string(0, 100000, desc="손님 말. 1,000자를 넘으면 앞 1,000자만 AI에(SPEC-017). 필드 한도 없음(messages.body_masked)"),
        "callbackUrl": string(9, 2048, r"^https://", fmt="uri", desc="콜백 주소(블록에서 콜백을 켰을 때). 한 번만, 유효 시간 안(OPEN-2)"),
        "block": obj({"id": string(1, 200), "name": string(0, 200)}, additional=True),
        "params": obj({
            "noticeKey": dict(UUID, description="Event API 요청의 params로 우리가 넘긴 안내 ID(안내 스킬 API-073). 손님에게 보이지 않음(SPEC-066)"),
            "check": enum(["event"], desc="연결 확인의 시험 안내(안내 스킬 API-073, SPEC-008)"),
        }, desc="카카오가 붙이는 값(예: surface)과 Event API 요청의 params. 사진이 어떻게 오는지는 OPEN-3", additional=True),
        "user": obj({
            "id": string(1, 70, col="customers.kakao_user_key", desc="botUserKey(최대 70자). 손님 구분 키(G1)"),
            "type": string(1, 32),
            "properties": obj({
                "botUserKey": string(1, 70), "plusfriendUserKey": string(1, 200), "appUserId": string(1, 200),
                "isFriend": boolean("채널 친구인지(REQ-120). 요청마다 손님 행을 고침: true면 친구, 없거나 false면 친구 아님(REQ-219)"),
            }, additional=True),
        }, ["id", "type"], additional=True),
    }, ["utterance", "user"], additional=True),
    "bot": obj({"id": string(1, 64, col="kakao_channels.bot_id", desc="봇 ID. 가게를 찾는 키(SPEC-017)"), "name": string(0, 200)}, ["id"], additional=True),
    "action": obj({
        "id": string(1, 200), "name": string(0, 200),
        "params": obj({
            "review_text": string(0, 100000, desc="후기 글(후기 스킬). 카카오가 보낸 값을 그대로 받고, 1~1,000자(reviews.body) 밖이면 결과 review_invalid로 알림(DEC-07)"),
            "review_photos": string(0, 100000, desc="보안 이미지 플러그인 값(JSON 글자: privacyAgreement·imageQuantity·secureUrls 'List(…)'·expire). 5장을 넘으면 review_invalid"),
            "photo_consent": string(0, 100, desc="후기 사진의 게시 동의 답: 그 사진들을 가게 포트폴리오와 예약 링크 페이지에 올려도 되는지(언제든 철회할 수 있음). 기본 동의 안 함이고 답을 사진마다 남김(REQ-208, DEC-18)"),
            "customer_name": string(0, 1000, desc="주문자 이름(주문자 정보 블록, SPEC-072). AI를 거치지 않음. 1~30자 밖이면 결과 input_invalid로 다시 물음(REQ-175, REQ-178)"),
            "customer_phone": string(0, 1000, desc="주문자 연락처(주문자 정보 블록, SPEC-072). AI를 거치지 않음. 숫자와 '-' 8~14자가 아니면 input_invalid"),
            "depositor_name": string(0, 1000, desc="입금자 이름(입금자 이름 블록, SPEC-033). AI를 거치지 않음. 1~30자 밖이면 input_invalid. 이 블록을 거치지 않고 '결제 확인 요청'을 누르면 주문자 이름(REQ-176)"),
            "allergy_answer": string(0, 1000, desc="알레르기 답(알레르기 답 블록, SPEC-075). 알레르기 정보 카드의 '동의하고 알려 주기'가 연 블록이 받음. AI를 거치지 않음. 1~200자 밖이면 결과 input_invalid로 다시 물음('없음'도 답, REQ-202, REQ-204)"),
        }, desc="블록 파라미터(값은 글자). 카카오가 다른 이름을 더할 수 있음", additional=True),
        "detailParams": obj({}, additional=True),
        "clientExtra": obj({
            "cardKey": string(16, 64, r"^[A-Za-z0-9_-]+$", col="confirm_cards.card_key", desc="확인 카드 키(카드 스킬, G9)"),
            "choice": enum(["confirm", "decline"], desc="누른 버튼(카드 스킬). 알레르기 정보 카드는 동의하고 알려 주기·동의 안 함, 사진 게시 동의 카드는 올려도 돼요·안 돼요"),
            "orderNo": ORDER_NO,
            "check": enum(BLOCK_NAMES, desc="연결 확인의 시험 버튼이 부른 블록(SPEC-008, REQ-206). 주문·카드·후기를 남기지 않음"),
        }, desc="버튼의 extra. 카드 스킬은 cardKey·choice(주문자 정보·알레르기 답·입금자 이름 블록도 같고 값은 action.params로), 후기 스킬은 orderNo, 연결 확인의 시험 버튼은 check", additional=True),
    }, ["id"], additional=True),
    "contexts": arr({"type": "object"}, 0, 50),
    "flow": obj({}, additional=True),
}, ["userRequest", "bot", "action"], additional=True,
    desc="카카오 오픈빌더가 보내는 스킬 요청(2026-11-12 공식 문서 확인). 카카오가 필드를 더할 수 있어 모르는 필드는 받음")

BUTTON = obj({
    "label": string(1, 14),
    "action": enum(["block", "message", "webLink", "phone"]),
    "blockId": string(1, 200),
    "messageText": string(1, 1000),
    "webLinkUrl": URL,
    "phoneNumber": string(8, 14, PHONE_RE),
    "extra": obj({
        "cardKey": string(16, 64, r"^[A-Za-z0-9_-]+$", col="confirm_cards.card_key"),
        "choice": enum(["confirm", "decline"]),
        "orderNo": ORDER_NO,
        "check": enum(BLOCK_NAMES),
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
}, ["version", "template"], desc="스킬 응답(카카오 응답 형식: outputs 1~3개, quickReplies 10개까지, simpleText 1,000자, textCard 제목 50자·설명 400자·버튼 3개, 버튼 이름 14자). 오류 내용·내부 ID·다른 손님 정보 없음(G6)")
S["SkillCallbackAck"] = obj({
    "version": enum(["2.0"]),
    "useCallback": {"type": "boolean", "const": True},
    "data": obj({"text": string(1, 1000)}, ["text"]),
}, ["version", "useCallback"], desc="콜백으로 답한다는 응답(SPEC-017). 답은 userRequest.callbackUrl로 감")
S["SkillResponse"] = {"oneOf": [ref("SkillTemplateResponse"), ref("SkillCallbackAck")]}
S["KakaoCallbackResult"] = obj({
    "taskId": string(1, 200), "status": enum(["SUCCESS", "FAIL", "ERROR"]),
    "message": string(0, 1000), "timestamp": {"type": "integer", "minimum": 0, "maximum": 99999999999999},
}, ["status"], additional=True, desc="카카오가 콜백 요청에 반환하는 결과(카카오 문서)")

# ── AI-1 출력 (HTTP로 오가지 않음. 서버 안 LangGraph 노드의 구조화 출력, DEC-17) ─────────────
PLACEHOLDER_PHONE = r"^\[전화번호[0-9]{1,3}\]$"
PLACEHOLDER_ACCOUNT = r"^\[계좌번호[0-9]{1,3}\]$"
S["AiTurnOutput"] = obj({
    "reply": string(0, 600, desc="손님에게 보낼 글. 비면 서버가 '다시 한번 말씀해 주시겠어요?'(SPEC-020)"),
    "draft_patch": obj({
        "pickup_day": dict(DATE, description="원하는 픽업 날짜(가게 시간대). 날짜만 들었으면 날짜만 넣음(SPEC-020)"),
        "pickup_time": string(5, 5, HHMM_RE, col="order_drafts.pickup_time", desc="원하는 픽업 시각(가게 시간대, HH:MM). 초안에 날짜가 없으면 시각만은 받지 않음"),
        "courier_pickup": boolean(col="order_drafts.courier_pickup"),
        "size": string(1, 30), "flavor": string(1, 30), "design_option": string(1, 30), "design": string(1, 30),
        "extras": arr(string(1, 30), 0, 20, unique=True),
        "design_notes": string(0, 500, col="order_drafts.design_notes"),
        "lettering": string(0, 50, col="order_drafts.lettering"),
        "colors": string(0, 100, col="order_drafts.colors"),
        "excluded_ingredients": string(0, 200, col="order_drafts.excluded_ingredients"),
    }, desc="주문서 초안에 넣을 필드(옵션은 이름). 서버가 형식을 확인한 뒤 저장(SPEC-020). 주문자 이름·연락처는 AI가 넣지 않고 주문자 정보 블록으로만 받음(SPEC-072, REQ-178). 알레르기 답도 AI가 넣지 않고 알레르기 정보 동의 뒤 알레르기 답 블록으로만 받음(SPEC-075, REQ-200, REQ-204)", minProperties=1),
    "quote_request": obj({
        "size": string(1, 30), "flavor": string(1, 30), "design_option": string(1, 30), "design": string(1, 30),
        "extras": arr(string(1, 30), 0, 20, unique=True), "pickup_day": DATE,
    }, desc="견적 내기에 쓸 옵션. 서버가 가게 규칙으로 계산해 남김(SPEC-013)", minProperties=1),
    "handoff": obj({
        "reason": enum(["edibility", "cannot_answer", "closed_day", "legal_medical", "customer_request", "pre_receipt_issue"]),
        "requested_day": DATE,
    }, ["reason"], desc="에스컬레이션할 이유(SPEC-022)"),
    "issue_patch": obj({
        "order_no": ORDER_NO,
        "photo_positions": arr(integer(1, 5), 0, 5, unique=True),
        "description": string(1, 1000, col="issue_details.description"),
        "health_concern": boolean(col="issue_details.health_concern"),
    }, desc="신고 내용 모으기(SPEC-057)", minProperties=1),
    "refund_account_patch": obj({
        "bank_name": string(1, 30, col="refunds.refund_bank_name"),
        "account_number": string(1, 20, PLACEHOLDER_ACCOUNT, desc="AI는 플레이스홀더만 봄. 서버가 원래 값으로 바꿔 앱이 암호화해 그 환불에만 저장(끝 4자리는 따로, SPEC-049, REQ-191, DEC-17)"),
        "holder_name": string(1, 30, col="refunds.refund_holder_name"),
    }, ["account_number"], desc="환불받을 손님 계좌(SPEC-049)"),
    "card": obj({
        "kind": enum(["order_request", "payment_claim", "change_request", "cancel", "issue_report", "consent_withdrawal"], col="confirm_cards.kind"),
        "order_no": ORDER_NO,
        "changes": ref("ChangeSet"),
    }, ["kind"], desc="보일 확인 카드. 서버가 허용된 종류인지·대상 주문이 이 사용자·이 가게 것인지 보고 저장된 값으로 만듦(SPEC-069)"),
}, ["reply"], desc="AI-1 상담 답 만들기의 출력 하나(손님 메시지 한 차례). HTTP로 오가지 않는 서버 안 구조화 출력(DEC-17). 서버가 확인하고 어긋나는 부분은 버림. "
          "Open: AI 모델 회사·모델은 개발 전(10단계 전)에 고르고, 고르는 날 그 회사의 약관·데이터 방침을 확인해 처리방침의 국외 이전 항목을 채움(OPEN-7)")

# ── 운영자: 가게 기록 보기와 원래 값 열기 (설계 재검토 H4, SPEC-073·074) ─────────────────
MASKED_NAME = string(1, 30, r"^[^*\s]\**$", desc="가린 이름: 첫 글자 밖은 *(SPEC-073)")
MASKED_DIGITS = string(4, 40, r"^[*-]*[0-9]{4}$", desc="가린 번호: 끝 4자리 밖은 *(SPEC-073)")
CONSULT_STATUS = ["open", "awaiting_owner", "dropped", "ordered", "ended", "deleted"]
PR_KINDS = ["first", "reissue", "difference"]
PR_STATUS = ["open", "claimed", "mismatch", "paid", "expired", "closed"]
OPEN_TARGETS = ["masked_value", "order_contact", "refund_account", "kept_record", "consultation_text"]

S["OperatorOrderRow"] = all_required({
    "orderId": UUID,
    "orderNo": ORDER_NO,
    "kept": boolean("끝나고 30일이 지나 보관 기록이 됨. true면 주문번호·끝난 날·보관 기간과 keptRecordId만 있고 나머지는 null(SPEC-073, 05단계 A22)"),
    "keptRecordId": nullable(dict(UUID, description="보관 기록 ID. 내용은 사유를 적어 API-077(targetKind kept_record)로 엶")),
    "status": nullable(enum(ORDER_STATUS)),
    "pickupAt": nullable(DT),
    "amount": nullable(MONEY()),
    "customerNameMasked": nullable(MASKED_NAME),
    "customerPhoneMasked": nullable(MASKED_DIGITS),
    "finishedAt": nullable(DT),
    "contractKeepUntil": nullable(dict(DT, description="계약·결제 기록을 둘 때까지(끝난 날부터 5년, 잠정)")),
    "createdAt": DT,
}, desc="운영자가 보는 주문 한 행(가린 값, SPEC-073)")
S["OperatorConsultationRow"] = all_required({
    "consultationId": UUID,
    "status": enum(CONSULT_STATUS),
    "startedAt": DT,
    "lastMessageAt": nullable(DT),
    "orderNos": arr(ORDER_NO, 0, 20, desc="이 상담에서 다룬 주문번호"),
    "maskedValueCount": integer(0, 1000, desc="대화 속 마스킹한 번호 수"),
}, desc="운영자가 보는 상담 한 행. 대화 내용은 없음(SPEC-073)")
S["OperatorRecordList"] = all_required({
    "kind": enum(["orders", "consultations"]),
    "orders": arr(ref("OperatorOrderRow"), 0, 100, desc="kind가 orders일 때. 아니면 빈 목록"),
    "consultations": arr(ref("OperatorConsultationRow"), 0, 100, desc="kind가 consultations일 때. 아니면 빈 목록"),
    "nextCursor": nullable(CURSOR),
})
S["OperatorMaskedValue"] = all_required({
    "maskedValueId": UUID,
    "kind": enum(["phone", "account", "card", "long_number"]),
    "placeholder": string(5, 12, r"^\[(전화번호|계좌번호|카드번호|긴숫자)[0-9]{1,3}\]$"),
    "last4": nullable(string(4, 4, r"^[0-9]{4}$", desc="끝 4자리. 긴 숫자는 null(REQ-192)")),
    "originalKept": boolean("원래 값이 있어 사유를 적고 열 수 있음(전화번호·계좌번호). 카드번호·긴 숫자는 false(REQ-192)"),
})
S["OperatorMessage"] = all_required({
    "messageId": UUID,
    "at": DT,
    "direction": enum(["inbound", "outbound"]),
    "author": enum(["customer", "ai", "system"]),
    "kind": enum(["text", "photo", "card", "unsupported"]),
    "textLength": integer(0, 4000, desc="대화 글의 글자 수만. 번호 마스킹은 대화 속 이름·알레르기 같은 말을 가리지 않아 글은 보이지 않고, 사유를 적어 API-077(targetKind consultation_text)로 엶(REQ-227)"),
    "photoCount": integer(0, 10, desc="사진 수만. 사진은 보이지 않음(REQ-194)"),
}, desc="운영자가 보는 메시지 하나: 발신자·시각·종류·글자 수·사진 수만(REQ-227)")
S["OperatorMessageText"] = all_required({
    "messageId": UUID,
    "at": DT,
    "author": enum(["customer", "ai", "system"]),
    "textMasked": nullable(string(0, 4000, desc="마스킹한 글(번호는 플레이스홀더 그대로, SPEC-021). 끝 4자리는 API-075의 maskedValues에서. 글이 없는 메시지(사진 등)는 null")),
}, desc="사유를 적어 연 대화 글의 메시지 하나(REQ-227, SPEC-073)")
S["OperatorConsultation"] = all_required({
    "consultationId": UUID,
    "status": enum(CONSULT_STATUS),
    "maskedValues": arr(ref("OperatorMaskedValue"), 0, 200, desc="대화 속 플레이스홀더마다 끝 4자리와 열 수 있는지"),
    "items": arr(ref("OperatorMessage"), 0, 100),
    "nextCursor": nullable(CURSOR),
}, desc="운영자가 보는 상담 하나(가린 값, SPEC-073). 메시지마다 발신자·시각·종류·글자 수·사진 수만 있고 대화 글은 없음(REQ-227). 지운 상담은 status deleted와 빈 목록")
S["OperatorOrder"] = all_required({
    "orderId": UUID,
    "orderNo": ORDER_NO,
    "kind": enum(["standard", "custom"]),
    "status": enum(ORDER_STATUS),
    "pickupAt": DT,
    "amount": MONEY(),
    "customerNameMasked": nullable(MASKED_NAME),
    "customerPhoneMasked": nullable(MASKED_DIGITS),
    "allergyAnswered": boolean("알레르기 답이 있음. 답은 보이지 않음(REQ-194)"),
    "excludedIngredientsAnswered": boolean("빼야 할 재료 답이 있음. 답은 보이지 않음(REQ-194)"),
    "referencePhotoCount": integer(0, 10, desc="참고 사진 수. 사진은 보이지 않음(REQ-194)"),
    "consultationId": nullable(UUID),
    "paymentRequests": arr(all_required({
        "paymentRequestId": UUID, "kind": enum(PR_KINDS), "status": enum(PR_STATUS),
        "amount": integer(1, 10000000), "issuedAt": DT, "paidAt": nullable(DT),
    }), 0, 20, desc="결제 안내 요약. 입금자 이름은 보이지 않음"),
    "refunds": arr(all_required({
        "refundId": UUID, "cause": enum(REFUND_CAUSES), "decision": enum(["full", "partial", "none"]),
        "amount": integer(0, 100000000), "decidedAt": DT, "sentAt": nullable(DT),
        "refundAccount": nullable(all_required({
            "bankName": nullable(string(1, 30)), "accountMasked": MASKED_DIGITS, "holderNameMasked": nullable(MASKED_NAME),
        }, desc="가린 환불 계좌. 원래 값은 사유를 적어 API-077(targetKind refund_account)로")),
    }), 0, 20),
    "createdAt": DT,
}, desc="운영자가 보는 주문 하나(가린 값, SPEC-073)")
S["OriginalOpenInput"] = obj({
    "targetKind": enum(OPEN_TARGETS, col="access_logs.target_kind",
                       desc="대화 속 전화번호·계좌번호(maskedValueId)·주문자 이름과 연락처(orderId)·환불 계좌(refundId)·보관 기록(keptRecordId)·상담의 대화 글(consultationId, REQ-227)"),
    "targetId": dict(UUID, description="연 대상의 ID(targetKind마다 위의 ID)"),
    "cursor": dict(CURSOR, description="consultation_text만: 열 페이지. API-075에서 보고 있는 페이지의 커서이고 첫 페이지면 넣지 않음. 그 페이지의 메시지 20개까지의 대화 글을 엶"),
    "reason": string(5, 200, col="access_logs.reason", desc="사유 5~200자(REQ-195). 접속기록에 남음"),
}, ["targetKind", "targetId", "reason"], desc="원래 값이나 보관 기록 하나, 상담의 대화 글 한 페이지를 사유와 함께 엶(SPEC-073, REQ-227)")
S["KeptRecord"] = all_required({
    "keptRecordId": UUID,
    "orderNo": ORDER_NO,
    "customerName": nullable(string(1, 30, desc="주문자 이름(재제작 주문은 null)")),
    "finishedAt": DT,
    "contractKeepUntil": DT,
    "issueKeepUntil": nullable(DT),
    "issuePurgedAt": nullable(DT),
    "details": arr(all_required({
        "version": integer(1, 2147483647), "createdAt": DT, "pickupAt": DT, "amount": MONEY(), "summary": string(1, 300),
    }), 1, 50, desc="주문 내용 버전(계약 기록). 연락처·알레르기 답·문구·디자인 설명은 지워져 없음"),
    "payments": arr(all_required({
        "kind": enum(PR_KINDS), "status": enum(PR_STATUS), "amount": integer(1, 10000000), "issuedAt": DT, "paidAt": nullable(DT),
    }), 0, 20),
    "refunds": arr(all_required({
        "cause": enum(REFUND_CAUSES), "decision": enum(["full", "partial", "none"]), "amount": integer(0, 100000000),
        "decidedAt": DT, "sentAt": nullable(DT),
    }), 0, 20),
}, desc="보관 기록(REQ-187, 05단계 A22): 주문자 이름·끝난 날·보관 기간과 계약·결제 기록. 운영자가 사유를 적어 열 때만(SPEC-073)")
S["OriginalValue"] = all_required({
    "targetKind": enum(OPEN_TARGETS),
    "targetId": UUID,
    "openedAt": DT,
    "maskedValue": nullable(all_required({"placeholder": string(5, 12), "kind": enum(["phone", "account"]), "value": string(1, 40)})),
    "orderContact": nullable(all_required({"customerName": nullable(string(1, 30)), "customerPhone": nullable(string(8, 14, PHONE_RE))})),
    "refundAccount": nullable(all_required({"bankName": nullable(string(1, 30)), "accountNumber": string(10, 40, ACCOUNT_RE),
                                            "holderName": nullable(string(1, 30))})),
    "keptRecord": nullable(ref("KeptRecord")),
    "consultationText": nullable(all_required({
        "consultationId": UUID,
        "items": arr(ref("OperatorMessageText"), 0, 20, desc="그 페이지의 메시지(API-075의 기본 페이지와 같은 20개까지)"),
    }, desc="연 상담의 대화 글 한 페이지(REQ-227). 다른 페이지도 사유를 적어 엶")),
}, desc="연 원래 값·보관 기록·대화 글 한 페이지(targetKind의 필드만 있고 나머지는 null). 이 응답과 그 화면에만 있고 로그·오류 보고에는 없음(G6)")
