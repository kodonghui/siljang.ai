"""06단계 API 계약의 예시 값. build_api.py가 응답·요청 예시로 포함한다.

모두 지어낸 가게(달빛케이크)의 값이다. 실제 사람·가게·계좌·연락처가 아니며 시크릿도 없다.
ID는 이름에서 만든 고정 uuid라 다시 만들어도 같다. check_api.py가 모든 예시를 스키마로 확인한다.
"""
import hashlib
import uuid
from datetime import date, timedelta

NS = uuid.UUID("6f1c2a4e-0d3b-4c5a-9e7f-1a2b3c4d5e6f")


def uid(name):
    return str(uuid.uuid5(NS, name))


def h(name, n=32):
    return hashlib.sha256(name.encode()).hexdigest()[:n]


def trace(name):
    return h("trace:" + name, 32)


def rev(name):
    return h("rev:" + name, 12)


def surl(name):
    return f"https://files.siljang.example/v1/{h('file:' + name, 24)}?exp=1763619300&sig={h('sig:' + name, 32)}"


def t(day, hm="00:00", sec="00"):
    """가게 시간대(+09:00) 시각. day는 '11-20'처럼 2026년의 월-일."""
    return f"2026-{day}T{hm}:{sec}+09:00"


def brn_check_digit(first9):
    w = [1, 3, 7, 1, 3, 7, 1, 3, 5]
    d = [int(c) for c in first9]
    s = sum(a * b for a, b in zip(d, w)) + (d[8] * 5) // 10
    return str((10 - s % 10) % 10)


BRN = "123456789" + brn_check_digit("123456789")   # 지어낸 사업자등록번호(검증 숫자는 맞음)
SKILL_KEY = "EXAMPLE_" + "0" * 35                 # 지어낸 스킬 키(43자). 실제 키가 아님

SHOP_ID = uid("shop:moonlight")
OWNER_ID = uid("owner:moonlight")
OPERATOR_ID = uid("operator:hanbit")
OTHER_SHOP_ID = uid("shop:starlight")
BOT_ID = "6740a1b2c3d4e5f6a7b8c9d0"
USER_KEY = "Xq7bK2mN9pR4sT1v"
CALLBACK_URL = "https://callback.kakao.example/v1/callbacks/" + h("cb", 24)
API = "https://api.siljang.example"

# ── 로그인 ──────────────────────────────────────────────────────────────────
OWNER = {"ownerId": OWNER_ID, "alertChannelFriend": True, "createdAt": t("11-12", "10:01")}
SHOP_SUMMARY = {"shopId": SHOP_ID, "name": "달빛케이크", "licenseStatus": "verified"}
OPERATOR = {"operatorId": OPERATOR_ID, "displayName": "운영자 한빛"}

# ── 파일 ────────────────────────────────────────────────────────────────────
UPLOAD_LICENSE = {
    "uploadId": "upl_" + h("upload:license", 24), "purpose": "license_photo", "contentType": "image/jpeg",
    "byteSize": 2483120, "expiresAt": t("11-12", "11:03"),
}
UPLOAD_COMPLETION = dict(UPLOAD_LICENSE, uploadId="upl_" + h("upload:completion", 24), purpose="completion_photo", byteSize=3120044,
                         expiresAt=t("11-20", "12:40"))

# ── 가게 ────────────────────────────────────────────────────────────────────
SHOP = {
    "shopId": SHOP_ID, "name": "달빛케이크", "contactPhone": "010-1234-5678", "pickupAddress": "서울 마포구 달빛로 12, 1층",
    "businessName": "달빛케이크", "representativeName": "김달빛", "businessRegNo": BRN,
    "mailOrderRegNo": "제2026-서울마포-0123호", "mailOrderExemption": None,
    "foodLicenseNo": "2026-0123456", "foodBusinessType": "instant_sale_manufacturing",
    "licenseStatus": "verified", "licenseHoldReason": None, "licensePhotoUrl": surl("license"),
    "entrustmentTermsVersion": "2026.11", "entrustmentConsentedAt": t("11-12", "10:05"),
    "timeZone": "Asia/Seoul", "completionPhotoEnabled": True, "idleCloseHours": 24, "ownerWaitMinutes": 120,
    "dailyAiCostLimitKrw": 5000, "bookingUrl": "https://siljang.example/s/moonlight-cake",
    "createdAt": t("11-12", "10:05"), "updatedAt": t("11-12", "15:20"), "revision": rev("shop:3"),
}
SHOP_PENDING = dict(SHOP, licenseStatus="pending", pickupAddress=None, completionPhotoEnabled=False, bookingUrl=None,
                    updatedAt=t("11-12", "10:05"), revision=rev("shop:1"))
SHOP_ON_HOLD = dict(SHOP_PENDING, licenseStatus="on_hold", licenseHoldReason="신고증 글자가 잘 보이지 않아요. 밝은 곳에서 다시 찍어 올려 주세요",
                    updatedAt=t("11-12", "13:40"), revision=rev("shop:2"))

SHOP_REGISTRATION = {
    "name": "달빛케이크", "contactPhone": "010-1234-5678", "businessName": "달빛케이크", "representativeName": "김달빛",
    "businessRegNo": BRN, "mailOrderRegNo": "제2026-서울마포-0123호", "mailOrderExemption": None,
    "foodLicenseNo": "2026-0123456", "foodBusinessType": "instant_sale_manufacturing",
    "licensePhotoUploadId": UPLOAD_LICENSE["uploadId"], "entrustmentTermsVersion": "2026.11", "entrustmentConsent": True,
}

# ── 운영자 ──────────────────────────────────────────────────────────────────
PAYMENT_ACCOUNT_REVIEW = {"bankName": "달빛은행", "holderName": "김달빛", "accountLast4": "4567", "holderMatches": True,
                          "holderMismatchConfirmed": None, "holderCheckedAt": None, "holderCheckedBy": None, "createdAt": t("11-12", "11:30")}
REVIEW_SUMMARY = {
    "shopId": SHOP_ID, "name": "달빛케이크", "businessName": "달빛케이크", "representativeName": "김달빛", "businessRegNo": BRN,
    "foodLicenseNo": "2026-0123456", "foodBusinessType": "instant_sale_manufacturing", "licenseStatus": "pending",
    "duplicateBusinessRegNo": False, "createdAt": t("11-12", "10:05"), "revision": rev("shop:1"),
}
REVIEW_DETAIL = {
    "shopId": SHOP_ID, "name": "달빛케이크", "contactPhone": "010-1234-5678", "businessName": "달빛케이크",
    "representativeName": "김달빛", "businessRegNo": BRN, "mailOrderRegNo": "제2026-서울마포-0123호", "mailOrderExemption": None,
    "foodLicenseNo": "2026-0123456", "foodBusinessType": "instant_sale_manufacturing", "licensePhotoUrl": surl("license"),
    "licenseStatus": "pending", "licenseHoldReason": None, "licenseReviewedAt": None, "licenseReviewedBy": None,
    "duplicates": [], "paymentAccount": PAYMENT_ACCOUNT_REVIEW, "createdAt": t("11-12", "10:05"), "revision": rev("shop:1"),
}
REVIEW_DETAIL_VERIFIED = dict(REVIEW_DETAIL, licenseStatus="verified", licenseReviewedAt=t("11-12", "11:30"),
                              licenseReviewedBy=OPERATOR, revision=rev("shop:2v"),
                              paymentAccount=dict(PAYMENT_ACCOUNT_REVIEW, holderCheckedAt=t("11-12", "11:30"), holderCheckedBy=OPERATOR))
REVIEW_DETAIL_NO_ACCOUNT = dict(REVIEW_DETAIL, paymentAccount=None)
REVIEW_DETAIL_HOLDER_DIFFERENT = dict(REVIEW_DETAIL, paymentAccount=dict(PAYMENT_ACCOUNT_REVIEW, holderName="박하늘", holderMatches=False,
                                                                         holderMismatchConfirmed=True))
REVIEW_DETAIL_ON_HOLD = dict(REVIEW_DETAIL, licenseStatus="on_hold", licenseHoldReason=SHOP_ON_HOLD["licenseHoldReason"],
                             licenseReviewedAt=t("11-12", "13:40"), licenseReviewedBy=OPERATOR, revision=rev("shop:2"))
OPERATOR_ALERTS = {"items": [
    {"alertId": uid("alert:1"), "kind": "ai_failure_burst", "shop": {"shopId": SHOP_ID, "name": "달빛케이크"}, "count": 5, "createdAt": t("11-12", "16:02")},
    {"alertId": uid("alert:2"), "kind": "channel_already_linked", "shop": {"shopId": OTHER_SHOP_ID, "name": "별빛베이커리"}, "count": 1, "createdAt": t("11-12", "14:10")},
], "nextCursor": None}

# ── 가격표 ──────────────────────────────────────────────────────────────────
OPT = {k: uid("option:v4:" + k) for k in ["1ho", "2ho", "cream", "choco", "basic", "character", "candle", "two_tier"]}
PRICE_OPTIONS = [
    {"optionId": OPT["1ho"], "group": "size", "name": "1호", "priceKind": "fixed", "amount": 35000, "amountMax": None, "inStandard": True, "position": 1},
    {"optionId": OPT["2ho"], "group": "size", "name": "2호", "priceKind": "fixed", "amount": 45000, "amountMax": None, "inStandard": True, "position": 2},
    {"optionId": OPT["cream"], "group": "flavor", "name": "생크림", "priceKind": "fixed", "amount": 0, "amountMax": None, "inStandard": True, "position": 1},
    {"optionId": OPT["choco"], "group": "flavor", "name": "초코", "priceKind": "fixed", "amount": 3000, "amountMax": None, "inStandard": True, "position": 2},
    {"optionId": OPT["basic"], "group": "design", "name": "기본 레터링", "priceKind": "fixed", "amount": 0, "amountMax": None, "inStandard": True, "position": 1},
    {"optionId": OPT["character"], "group": "design", "name": "캐릭터 그림", "priceKind": "from", "amount": 20000, "amountMax": None, "inStandard": False, "position": 2},
    {"optionId": OPT["candle"], "group": "extra", "name": "초 추가", "priceKind": "fixed", "amount": 1000, "amountMax": None, "inStandard": True, "position": 1},
    {"optionId": OPT["two_tier"], "group": "extra", "name": "2단", "priceKind": "range", "amount": 40000, "amountMax": 60000, "inStandard": False, "position": 2},
]


def _pair(a, b):
    return (a, b) if a < b else (b, a)


_a, _b = _pair(OPT["2ho"], OPT["character"])
_c, _d = _pair(OPT["1ho"], OPT["two_tier"])
PRICE_RULES = [
    {"kind": "surcharge", "optionAId": _a, "optionBId": _b, "amount": 5000},
    {"kind": "exclude", "optionAId": _c, "optionBId": _d, "amount": None},
]
DESIGNS = [
    {"designId": uid("design:heart"), "name": "하트 레터링", "imageUrl": surl("design:heart"), "optionId": OPT["basic"], "inStandard": True, "position": 1},
    {"designId": uid("design:bear"), "name": "곰돌이", "imageUrl": surl("design:bear"), "optionId": OPT["character"], "inStandard": False, "position": 2},
]
PRICE_LIST = {"version": 4, "current": True, "createdAt": t("11-12", "11:10"), "supersededAt": None,
              "options": PRICE_OPTIONS, "rules": PRICE_RULES, "designs": DESIGNS, "revision": rev("price:4")}
PRICE_LIST_OLD = dict(PRICE_LIST, version=3, current=False, createdAt=t("11-12", "10:40"), supersededAt=t("11-12", "11:10"),
                      revision=rev("price:3"))
PRICE_VERSIONS = {"items": [
    {"version": 4, "createdAt": t("11-12", "11:10"), "supersededAt": None},
    {"version": 3, "createdAt": t("11-12", "10:40"), "supersededAt": t("11-12", "11:10")},
]}
PRICE_LIST_INPUT = {
    "baseRevision": rev("price:3"),
    "options": [
        {"key": "1ho", "group": "size", "name": "1호", "priceKind": "fixed", "amount": 35000, "amountMax": None, "inStandard": True, "position": 1},
        {"key": "2ho", "group": "size", "name": "2호", "priceKind": "fixed", "amount": 45000, "amountMax": None, "inStandard": True, "position": 2},
        {"key": "cream", "group": "flavor", "name": "생크림", "priceKind": "fixed", "amount": 0, "amountMax": None, "inStandard": True, "position": 1},
        {"key": "basic", "group": "design", "name": "기본 레터링", "priceKind": "fixed", "amount": 0, "amountMax": None, "inStandard": True, "position": 1},
        {"key": "character", "group": "design", "name": "캐릭터 그림", "priceKind": "from", "amount": 20000, "amountMax": None, "inStandard": False, "position": 2},
    ],
    "rules": [{"kind": "surcharge", "optionA": "2ho", "optionB": "character", "amount": 5000}],
    "designs": [
        {"name": "하트 레터링", "sourceDesignId": uid("design:heart"), "optionKey": "basic", "inStandard": True, "position": 1},
        {"name": "곰돌이", "uploadId": "upl_" + h("upload:bear", 24), "optionKey": "character", "inStandard": False, "position": 2},
    ],
}

# ── 운영규정 ────────────────────────────────────────────────────────────────
CLAUSES = [
    {"key": "pre_production_cancel", "position": 1, "title": "제작 전 취소",
     "conditionText": "맞춤 재료를 주문하기 전이고 제작을 시작하기 전에 취소하는 경우", "effectText": "취소 수수료 5,000원을 뺀 금액을 모두 돌려드립니다."},
    {"key": "staged_refund", "position": 2, "title": "제작 뒤 취소",
     "conditionText": "맞춤 재료를 주문했거나 제작을 시작한 뒤 취소하는 경우", "effectText": "픽업 72시간 전까지는 50%, 그 뒤에는 돌려드리지 않습니다."},
    {"key": "other_shop_design", "position": 3, "title": "다른 가게 디자인",
     "conditionText": "다른 가게의 시그니처·캐릭터·로고 디자인을 원하는 경우", "effectText": "다른 가게 디자인은 받지 않습니다."},
    {"key": "change_deadline", "position": 4, "title": "변경 마감",
     "conditionText": "주문 내용을 바꾸려는 경우", "effectText": "픽업 48시간 전까지만 바꿀 수 있습니다."},
]
TIERS = [
    {"hoursBeforeMin": 72, "hoursBeforeMax": None, "refundPct": 50},
    {"hoursBeforeMin": 0, "hoursBeforeMax": 72, "refundPct": 0},
]
RULES = {
    "version": 2, "isTemplate": False, "current": True, "quoteValidHours": 72, "paymentDueHours": 12, "issueReportHours": 24,
    "changeDeadlineHours": 48, "cancellationFeeKrw": 5000, "preProductionRefundPct": 100, "preProductionLoweredAck": False,
    "dateChangeRefundBasis": "original_pickup", "clauses": CLAUSES, "refundTiers": TIERS,
    "createdAt": t("11-12", "11:20"), "supersededAt": None, "revision": rev("rules:2"),
}
RULES_TEMPLATE = {
    "version": None, "isTemplate": True, "current": False, "quoteValidHours": 72, "paymentDueHours": 12, "issueReportHours": 24,
    "changeDeadlineHours": None, "cancellationFeeKrw": 0, "preProductionRefundPct": 100, "preProductionLoweredAck": False,
    "dateChangeRefundBasis": None,
    "clauses": [{"key": "pre_production_cancel", "position": 1, "title": "제작 전 취소",
                 "conditionText": "맞춤 재료를 주문하기 전이고 제작을 시작하기 전에 취소하는 경우", "effectText": "취소 수수료만 빼고 모두 돌려드립니다."}],
    "refundTiers": [], "createdAt": None, "supersededAt": None, "revision": None,
}
RULES_INPUT = {
    "baseRevision": rev("rules:1"), "quoteValidHours": 72, "paymentDueHours": 12, "issueReportHours": 24, "changeDeadlineHours": 48,
    "cancellationFeeKrw": 5000, "preProductionRefundPct": 100, "dateChangeRefundBasis": "original_pickup",
    "clauses": CLAUSES, "refundTiers": TIERS,
}
RULES_INPUT_LOWERED = dict(RULES_INPUT, preProductionRefundPct=50, confirm=["lowered_refund"])

# ── 결제 수단 ────────────────────────────────────────────────────────────
PAYMENT_DESTINATION = {
    "bankName": "달빛은행", "accountNumber": "123456-01-234567", "holderName": "김달빛", "holderMismatchConfirmed": None,
    "cardPaymentUrl": None, "createdAt": t("11-12", "11:30"), "revision": rev("account:1"),
}
PAYMENT_DESTINATION_INPUT = {"baseRevision": None, "bankName": "달빛은행", "accountNumber": "123456-01-234567",
                             "holderName": "김달빛", "cardPaymentUrl": None}

# ── 영업 캘린더 ───────────────────────────────────────────────────────────────
CALENDAR = {
    "closedWeekdays": [1], "dailyCapacity": 5, "orderCutoffDays": 2, "orderCutoffTime": "18:00", "replyStart": "09:00",
    "replyEnd": "21:00", "dayBeforeNoticeTime": "18:00", "reviewRequestTime": "11:00", "updatedAt": t("11-12", "11:40"),
    "revision": rev("calendar:1"),
}
CALENDAR_INPUT = {
    "baseRevision": None, "closedWeekdays": [1], "dailyCapacity": 5, "orderCutoffDays": 2, "orderCutoffTime": "18:00",
    "replyStart": "09:00", "replyEnd": "21:00", "dayBeforeNoticeTime": "18:00", "reviewRequestTime": "11:00",
}


def calendar_day(d, *, held=0, capacity=5, closed=False, weekday_closed=False, manual=False, override=None, overbooked=False):
    full = held >= capacity
    return {"day": d, "weekdayClosed": weekday_closed, "closed": closed, "capacityOverride": override, "capacity": capacity,
            "held": held, "remaining": max(capacity - held, 0), "full": full, "manuallyClosed": manual, "overbooked": overbooked,
            "revision": rev("day:" + d + str(held) + str(closed) + str(manual))}


CALENDAR_DAYS = {"items": [
    calendar_day("2026-11-19", held=2),
    calendar_day("2026-11-20", held=5),
    calendar_day("2026-11-21", held=1),
    calendar_day("2026-11-22", held=0, closed=True),
    calendar_day("2026-11-23", weekday_closed=True),
]}

# ── 주문 ────────────────────────────────────────────────────────────────────
ORDER_ID = uid("order:K7Q3M9")
ORDER_NO = "K7Q3M9"
CUSTOM_ID = uid("order:P4X8N2")
CUSTOM_NO = "P4X8N2"
REMAKE_ID = uid("order:R2D5T7")
REMAKE_NO = "R2D5T7"
CONSULT_ID = uid("consultation:1")
ORDER_REF = {"orderId": ORDER_ID, "orderNo": ORDER_NO}
CUSTOM_REF = {"orderId": CUSTOM_ID, "orderNo": CUSTOM_NO}
REMAKE_REF = {"orderId": REMAKE_ID, "orderNo": REMAKE_NO}


def opt(key, name):
    return {"optionId": OPT[key], "name": name}


DETAILS_V1 = {
    "version": 1, "source": "request", "createdAt": t("11-12", "13:05"), "pickupAt": t("11-20", "14:00"), "courierPickup": False,
    "size": opt("1ho", "1호"), "flavor": opt("cream", "생크림"), "designOption": opt("basic", "기본 레터링"),
    "design": {"designId": uid("design:heart"), "name": "하트 레터링"}, "extras": [opt("candle", "초 추가")],
    "designNotes": None, "lettering": "생일 축하해 지우야", "colors": "연분홍", "allergyAnswer": "없음", "allergyConsent": "agreed",
    "excludedIngredients": None, "customerName": "이지우", "customerPhone": "010-9876-5432", "amount": 36000,
    "amountChangeReason": None,
}
DETAILS_V2 = dict(DETAILS_V1, version=2, source="change_request", createdAt=t("11-15", "10:20"), lettering="생일 축하해 지우야!")
CUSTOM_DETAILS_V1 = dict(DETAILS_V1, size=opt("2ho", "2호"), designOption=opt("character", "캐릭터 그림"),
                         design={"designId": uid("design:bear"), "name": "곰돌이"}, extras=[],
                         designNotes="사진처럼 곰돌이 얼굴을 크게", lettering="HAPPY BIRTHDAY", colors="하늘색",
                         customerName="박하늘", customerPhone="010-2222-3333", amount=70000, createdAt=t("11-12", "14:10"),
                         pickupAt=t("11-20", "16:00"))
CUSTOM_DETAILS_V2 = dict(CUSTOM_DETAILS_V1, version=2, source="owner_amount_change", createdAt=t("11-12", "15:00"),
                         amount=75000, amountChangeReason="곰돌이 얼굴 입체 장식이 더해져요")
QUOTE = {
    "priceListVersion": 4, "operatingRulesVersion": 2, "orderKind": "custom", "displayKind": "from", "amount": 70000,
    "amountMax": None,
    "basis": {"lines": [
        {"group": "size", "name": "2호", "amount": 45000},
        {"group": "flavor", "name": "생크림", "amount": 0},
        {"group": "design", "name": "캐릭터 그림", "amount": 20000},
    ], "surcharges": [{"optionA": "2호", "optionB": "캐릭터 그림", "amount": 5000}]},
    "validUntil": t("11-15", "14:08"), "quotedAt": t("11-12", "14:08"),
}
PR_FIRST_PAID = {
    "paymentRequestId": uid("pr:K7Q3M9:1"), "order": ORDER_REF, "kind": "first", "status": "paid", "amount": 36000,
    "requestedAmount": None, "issuedAt": t("11-12", "13:05"), "dueAt": t("11-13", "01:05"), "claimedAt": t("11-12", "13:40"),
    "claimRejectedAt": None, "depositorName": "이지우", "mismatchAmount": None, "arrivedAmount": 36000, "arrivedAt": t("11-12", "14:02"),
    "paidAt": t("11-12", "14:02"), "expiredAt": None,
    "closedAt": None, "closeReason": None, "revision": rev("pr:K7Q3M9:1:paid"),
}
PR_CLAIMED = dict(PR_FIRST_PAID, status="claimed", paidAt=None, arrivedAmount=None, arrivedAt=None, revision=rev("pr:K7Q3M9:1:claimed"))
PR_CUSTOM_OPEN = {
    "paymentRequestId": uid("pr:P4X8N2:1"), "order": CUSTOM_REF, "kind": "first", "status": "open", "amount": 75000,
    "requestedAmount": 70000, "issuedAt": t("11-12", "15:00"), "dueAt": t("11-13", "03:00"), "claimedAt": None,
    "claimRejectedAt": None, "depositorName": None, "mismatchAmount": None, "arrivedAmount": None, "arrivedAt": None,
    "paidAt": None, "expiredAt": None, "closedAt": None, "closeReason": None, "revision": rev("pr:P4X8N2:1:open"),
}
PR_MISMATCH = dict(PR_CLAIMED, status="mismatch", mismatchAmount=31000, arrivedAmount=31000, arrivedAt=t("11-12", "14:02"),
                   revision=rev("pr:K7Q3M9:1:mismatch"))
PR_EXPIRED = dict(PR_CUSTOM_OPEN, status="expired", expiredAt=t("11-13", "03:00"), revision=rev("pr:P4X8N2:1:expired"))
PR_REISSUE = dict(PR_CUSTOM_OPEN, paymentRequestId=uid("pr:P4X8N2:2"), kind="reissue", requestedAmount=None,
                  issuedAt=t("11-13", "09:10"), dueAt=t("11-13", "21:10"), revision=rev("pr:P4X8N2:2:open"))
PR_DIFFERENCE = {
    "paymentRequestId": uid("pr:K7Q3M9:diff"), "order": ORDER_REF, "kind": "difference", "status": "open", "amount": 20000,
    "requestedAmount": None, "issuedAt": t("11-15", "10:20"), "dueAt": t("11-15", "22:20"), "claimedAt": None,
    "claimRejectedAt": None, "depositorName": None, "mismatchAmount": None, "arrivedAmount": None, "arrivedAt": None,
    "paidAt": None, "expiredAt": None, "closedAt": None, "closeReason": None, "revision": rev("pr:K7Q3M9:diff:open"),
}
PAYMENT = {"paymentId": uid("payment:K7Q3M9:1"), "paymentRequestId": PR_FIRST_PAID["paymentRequestId"], "amount": 36000,
           "resolution": "exact", "confirmedAt": t("11-12", "14:02"), "voidedAt": None, "voidReason": None}
# 잘못 누른 결제 확인을 제작 시작 전에 취소함(SPEC-070): 결제 안내는 나감, 주문은 결제 기다림, 제작 행 없음
PAYMENT_VOIDED = dict(PAYMENT, voidedAt=t("11-12", "14:20"), voidReason="다른 손님이 보낸 돈을 이 주문의 결제로 잘못 확인했어요")
PR_VOIDED = dict(PR_FIRST_PAID, status="open", claimedAt=None, depositorName=None, arrivedAmount=None, arrivedAt=None, paidAt=None,
                 revision=rev("pr:K7Q3M9:1:voided"))
# 손님이 취소한 뒤 닫힌 결제 안내에 들어온 입금을 남김(SPEC-071)
PR_CLOSED_ARRIVED = dict(PR_CLAIMED, status="closed", closedAt=t("11-14", "09:00"), closeReason="order_cancelled",
                         arrivedAmount=36000, arrivedAt=t("11-14", "09:40"), revision=rev("pr:K7Q3M9:1:closed:arrived"))
PRODUCTION = {
    "productionId": uid("production:K7Q3M9"), "needsCustomMaterial": False, "customMaterialOrderedAt": None,
    "productionStartedAt": None, "completedAt": None, "completionPhotos": [], "changedAfterStart": False,
    "handedOverAt": None, "handoverKind": None, "noPickupAt": None, "discardedAt": None, "undoableUntil": None,
    "revision": rev("production:K7Q3M9:0"),
}
PRODUCTION_STARTED = dict(PRODUCTION, productionStartedAt=t("11-19", "15:00"), undoableUntil=t("11-19", "15:05"),
                          revision=rev("production:K7Q3M9:started"))
PRODUCTION_DONE = dict(PRODUCTION_STARTED, completedAt=t("11-20", "11:30"), undoableUntil=t("11-20", "11:35"),
                       completionPhotos=[{"url": surl("completion:1"), "consent": "consented"}], revision=rev("production:K7Q3M9:done"))
PRODUCTION_HANDED = dict(PRODUCTION_DONE, handedOverAt=t("11-20", "14:05"), handoverKind="pickup", undoableUntil=None,
                         revision=rev("production:K7Q3M9:handed"))
PRODUCTION_NO_PICKUP = dict(PRODUCTION_DONE, noPickupAt=t("11-20", "20:10"), undoableUntil=None, revision=rev("production:K7Q3M9:nopickup"))
PRODUCTION_DISCARDED = dict(PRODUCTION_NO_PICKUP, discardedAt=t("11-21", "10:00"), revision=rev("production:K7Q3M9:discarded"))

ORDER_CONFIRMED = {
    "orderId": ORDER_ID, "orderNo": ORDER_NO, "kind": "standard", "status": "confirmed", "version": 1,
    "pickupAt": t("11-20", "14:00"), "pickupDay": "2026-11-20", "amount": 36000, "requestedAt": t("11-12", "13:05"),
    "acceptedAt": None, "confirmedAt": t("11-12", "14:02"), "rejectedAt": None, "rejectReason": None, "cancelledAt": None,
    "cancelKind": None, "cancelReason": None, "remakeOf": None, "consultationId": CONSULT_ID, "details": [DETAILS_V1],
    "referencePhotos": [], "quote": dict(QUOTE, orderKind="standard", displayKind="fixed", amount=36000,
                                          basis={"lines": [{"group": "size", "name": "1호", "amount": 35000},
                                                           {"group": "flavor", "name": "생크림", "amount": 0},
                                                           {"group": "design", "name": "기본 레터링", "amount": 0},
                                                           {"group": "extra", "name": "초 추가", "amount": 1000}],
                                                 "surcharges": []},
                                          validUntil=t("11-15", "13:00"), quotedAt=t("11-12", "13:00")),
    "day": {"capacity": 5, "held": 5, "remaining": 0, "full": True},
    "paymentRequests": [PR_FIRST_PAID], "payments": [PAYMENT], "refunds": [], "changeRequests": [],
    "production": PRODUCTION, "issueReports": [],
    "revision": rev("order:K7Q3M9:confirmed"),
}
ORDER_AWAITING = dict(ORDER_CONFIRMED, status="awaiting_payment", confirmedAt=None, paymentRequests=[PR_CLAIMED], payments=[],
                      production=None, revision=rev("order:K7Q3M9:awaiting"))
ORDER_CANCELLED_BY_SHOP = dict(ORDER_CONFIRMED, status="cancelled", cancelledAt=t("11-14", "09:00"), cancelKind="shop",
                               cancelReason="오븐이 고장 나 그날 만들 수 없어요", production=None,
                               revision=rev("order:K7Q3M9:shopcancel"))
ORDER_CANCELLED_BY_CUSTOMER = dict(ORDER_CONFIRMED, status="cancelled", cancelledAt=t("11-14", "09:00"), cancelKind="customer",
                                   production=None, revision=rev("order:K7Q3M9:customercancel"))
ORDER_CHANGED = dict(ORDER_CONFIRMED, version=2, details=[DETAILS_V2, DETAILS_V1], revision=rev("order:K7Q3M9:v2"))
ORDER_RECEIVED = dict(ORDER_CONFIRMED, status="received", production=PRODUCTION_HANDED, revision=rev("order:K7Q3M9:received"))
CUSTOM_REQUESTED = {
    "orderId": CUSTOM_ID, "orderNo": CUSTOM_NO, "kind": "custom", "status": "requested", "version": 1,
    "pickupAt": t("11-20", "16:00"), "pickupDay": "2026-11-20", "amount": 70000, "requestedAt": t("11-12", "14:10"),
    "acceptedAt": None, "confirmedAt": None, "rejectedAt": None, "rejectReason": None, "cancelledAt": None, "cancelKind": None,
    "cancelReason": None, "remakeOf": None, "consultationId": uid("consultation:2"), "details": [CUSTOM_DETAILS_V1],
    "referencePhotos": [{"url": surl("reference:bear")}], "quote": QUOTE,
    "day": {"capacity": 5, "held": 5, "remaining": 0, "full": True},
    "paymentRequests": [], "payments": [], "refunds": [], "changeRequests": [], "production": None, "issueReports": [],
    "revision": rev("order:P4X8N2:requested"),
}
CUSTOM_ACCEPTED = dict(CUSTOM_REQUESTED, status="awaiting_payment", version=2, amount=75000, acceptedAt=t("11-12", "15:00"),
                       details=[CUSTOM_DETAILS_V2, CUSTOM_DETAILS_V1], paymentRequests=[PR_CUSTOM_OPEN],
                       day={"capacity": 5, "held": 6, "remaining": 0, "full": True}, revision=rev("order:P4X8N2:accepted"))
CUSTOM_REJECTED = dict(CUSTOM_REQUESTED, status="rejected", rejectedAt=t("11-12", "15:00"),
                       rejectReason="그날은 입체 장식을 만들 시간이 없어요", revision=rev("order:P4X8N2:rejected"))
CUSTOM_OVERDUE = dict(CUSTOM_ACCEPTED, status="payment_overdue", paymentRequests=[PR_EXPIRED],
                      day={"capacity": 5, "held": 5, "remaining": 0, "full": True}, revision=rev("order:P4X8N2:overdue"))
CUSTOM_REISSUED = dict(CUSTOM_ACCEPTED, paymentRequests=[PR_REISSUE, PR_EXPIRED],
                       day={"capacity": 5, "held": 6, "remaining": 0, "full": True}, revision=rev("order:P4X8N2:reissued"))
CUSTOM_NO_PAYMENT = dict(CUSTOM_OVERDUE, status="cancelled", cancelledAt=t("11-13", "09:12"), cancelKind="no_payment",
                         revision=rev("order:P4X8N2:nopayment"))
REMAKE_DETAILS = dict(DETAILS_V1, source="remake", createdAt=t("11-21", "12:00"), pickupAt=t("11-25", "15:00"), amount=0)
ORDER_REMAKE = dict(ORDER_CONFIRMED, orderId=REMAKE_ID, orderNo=REMAKE_NO, pickupAt=t("11-25", "15:00"), pickupDay="2026-11-25",
                    amount=0, requestedAt=t("11-21", "12:00"), confirmedAt=t("11-21", "12:00"), remakeOf=ORDER_REF,
                    details=[REMAKE_DETAILS], quote=None, day={"capacity": 5, "held": 3, "remaining": 2, "full": False},
                    paymentRequests=[], payments=[], production=dict(PRODUCTION, productionId=uid("production:R2D5T7"),
                                                                     revision=rev("production:R2D5T7:0")),
                    revision=rev("order:R2D5T7:confirmed"))


def summary(o, courier=False):
    return {"orderId": o["orderId"], "orderNo": o["orderNo"], "kind": o["kind"], "status": o["status"], "version": o["version"],
            "pickupAt": o["pickupAt"], "pickupDay": o["pickupDay"], "amount": o["amount"], "courierPickup": courier,
            "customerName": o["details"][0]["customerName"], "requestedAt": o["requestedAt"], "isRemake": o["remakeOf"] is not None,
            "revision": o["revision"]}


ORDER_LIST = {"items": [summary(CUSTOM_REQUESTED), summary(ORDER_CONFIRMED)], "nextCursor": "b3JkZXI6MjAyNi0xMS0yMA"}
ORDER_LIST_OVERDUE = {"items": [summary(CUSTOM_OVERDUE)], "nextCursor": None}
EMPTY_PAGE = {"items": [], "nextCursor": None}

# ── 환불 ────────────────────────────────────────────────────────────────────
REFUND_BASIS = {
    "operatingRulesVersion": 2, "clauseTitles": ["제작 전 취소"], "cancelledAt": t("11-14", "09:00"),
    "customMaterialOrderedAt": None, "productionStartedAt": None, "tierRefundPct": None, "cancellationFeeKrw": 5000,
    "receivedAmount": 36000,
}
REFUND_PREVIEW = {"order": ORDER_REF, "cause": "customer_cancel", "receivedAmount": 36000, "confirmedAmount": 36000,
                  "unconfirmedAmount": 0, "refundedAmount": 0, "calculatedAmount": 31000, "minAmount": 31000, "maxAmount": 36000,
                  "basis": REFUND_BASIS}
REFUND_PREVIEW_SHOP = dict(REFUND_PREVIEW, cause="shop_cancel", calculatedAmount=36000, minAmount=36000,
                           basis=dict(REFUND_BASIS, clauseTitles=["가게 사정 취소"], cancellationFeeKrw=0))
REFUND = {
    "refundId": uid("refund:K7Q3M9:1"), "order": ORDER_REF, "cause": "customer_cancel", "decision": "partial", "amount": 31000,
    "calculatedAmount": 31000, "basis": REFUND_BASIS, "overrideReason": None, "method": None, "refundAccount": None,
    "decidedAt": t("11-14", "10:00"), "sentAt": None, "revision": rev("refund:1:decided"),
}
REFUND_WITH_ACCOUNT = dict(REFUND, refundAccount={"bankName": "하늘은행", "accountNumber": "110-123-456789", "holderName": "이지우"},
                           revision=rev("refund:1:account"))
REFUND_SENT = dict(REFUND_WITH_ACCOUNT, method="bank_transfer", sentAt=t("11-14", "11:30"), revision=rev("refund:1:sent"))
REFUND_SUMMARY = {"refundId": REFUND["refundId"], "cause": "customer_cancel", "decision": "partial", "amount": 31000,
                  "decidedAt": t("11-14", "10:00"), "sentAt": None}
REFUND_INPUT = {"baseRevision": ORDER_CANCELLED_BY_CUSTOMER["revision"], "cause": "customer_cancel", "decision": "partial",
                "amount": 31000}

# ── 변경 요청 ───────────────────────────────────────────────────────────────
CHANGE = {
    "changeRequestId": uid("change:K7Q3M9:1"), "order": ORDER_REF, "baseVersion": 1, "orderVersion": 1,
    "changes": {"lettering": "생일 축하해 지우야!"}, "newPickupAt": None, "needsOwnerDay": False, "status": "requested",
    "amountDelta": None, "rejectReason": None, "changeDeadlineAt": t("11-18", "14:00"), "decidedAt": None, "appliedVersion": None,
    "appliedAt": None, "closedAt": None, "createdAt": t("11-15", "10:00"), "differencePayment": None,
    "revision": rev("change:1:requested"),
}
CHANGE_APPLIED = dict(CHANGE, status="applied", amountDelta=0, decidedAt=t("11-15", "10:20"), appliedVersion=2,
                      appliedAt=t("11-15", "10:20"), orderVersion=2, revision=rev("change:1:applied"))
CHANGE_TWO_TIER = dict(CHANGE, changeRequestId=uid("change:K7Q3M9:2"), changes={"extras": ["초 추가", "2단"]},
                       revision=rev("change:2:requested"))
CHANGE_AWAITING = dict(CHANGE_TWO_TIER, status="awaiting_difference", amountDelta=20000, decidedAt=t("11-15", "10:20"),
                       differencePayment=PR_DIFFERENCE, revision=rev("change:2:awaiting"))
CHANGE_CLOSED = dict(CHANGE_AWAITING, status="closed_no_difference", closedAt=t("11-15", "22:20"),
                     differencePayment=dict(PR_DIFFERENCE, status="closed", closedAt=t("11-15", "22:20"), closeReason="change_closed",
                                            revision=rev("pr:diff:closed")),
                     revision=rev("change:2:closed"))
CHANGE_REJECTED = dict(CHANGE_TWO_TIER, status="rejected", decidedAt=t("11-15", "10:20"), rejectReason="2단은 사흘 전까지만 받아요",
                       revision=rev("change:2:rejected"))
CHANGE_SUMMARY = {"changeRequestId": CHANGE["changeRequestId"], "status": "applied", "baseVersion": 1, "createdAt": t("11-15", "10:00")}

# ── 문제 신고 ───────────────────────────────────────────────────────────────
ISSUE = {
    "issueReportId": uid("issue:K7Q3M9:1"), "order": ORDER_REF, "orderVersion": 1, "paidAmount": 36000, "late": False,
    "status": "reported", "description": "케이크 옆면이 무너져 있었어요", "healthConcern": False,
    "photos": [{"url": surl("issue:1")}, {"url": surl("issue:2")}], "followUps": [], "compensation": None, "decidedAt": None,
    "remakeOrder": None, "refund": None, "closedAt": None, "reportedAt": t("11-20", "18:30"), "revision": rev("issue:1:reported"),
}
ISSUE_REMAKE = dict(ISSUE, status="closed", compensation="remake", decidedAt=t("11-21", "12:00"), remakeOrder=REMAKE_REF,
                    closedAt=t("11-21", "12:00"), revision=rev("issue:1:remake"))
REFUND_COMP = dict(REFUND, refundId=uid("refund:K7Q3M9:comp"), cause="compensation", amount=20000, calculatedAmount=20000,
                   basis=dict(REFUND_BASIS, clauseTitles=[], cancelledAt=None, cancellationFeeKrw=0),
                   decidedAt=t("11-21", "12:00"), revision=rev("refund:comp"))
ISSUE_PARTIAL = dict(ISSUE, status="closed", compensation="partial_refund", decidedAt=t("11-21", "12:00"),
                     refund={"refundId": REFUND_COMP["refundId"], "cause": "compensation", "decision": "partial", "amount": 20000,
                             "decidedAt": t("11-21", "12:00"), "sentAt": None},
                     closedAt=t("11-21", "12:00"), revision=rev("issue:1:partial"))
ISSUE_SUMMARY = {"issueReportId": ISSUE["issueReportId"], "status": "reported", "late": False, "reportedAt": t("11-20", "18:30")}

# ── 에스컬레이션 건과 상담 ────────────────────────────────────────────────────────
HANDOFF = {
    "handoffId": uid("handoff:1"), "consultationId": CONSULT_ID, "reason": "edibility", "status": "open", "requestedDay": None,
    "order": None, "customerLines": [{"at": t("11-12", "12:40"), "text": "땅콩 알레르기가 있는데 먹어도 되나요?", "photos": []}],
    "customerChannelFriend": True, "answerText": None, "dayDecision": None, "dayAcceptExpiresAt": None, "answeredAt": None,
    "createdAt": t("11-12", "12:40"), "revision": rev("handoff:1:open"),
}
HANDOFF_ANSWERED = dict(HANDOFF, status="answered", answerText="땅콩은 쓰지 않지만 같은 주방에서 견과류를 다뤄요. 걱정되시면 드시지 않는 게 좋아요.",
                        answeredAt=t("11-12", "13:00"), revision=rev("handoff:1:answered"))
HANDOFF_DAY = dict(HANDOFF, handoffId=uid("handoff:2"), reason="closed_day", requestedDay="2026-11-20",
                   customerLines=[{"at": t("11-12", "16:00"), "text": "20일이 마감이라던데 그래도 안 될까요?", "photos": []}],
                   customerChannelFriend=False, revision=rev("handoff:2:open"))
HANDOFF_DAY_ACCEPTED = dict(HANDOFF_DAY, status="answered", dayDecision="accepted", dayAcceptExpiresAt=t("11-13", "16:30"),
                            answeredAt=t("11-12", "16:30"), revision=rev("handoff:2:answered"))
MESSAGES = {
    "consultationId": CONSULT_ID, "status": "awaiting_owner", "customerChannelFriend": True,
    "items": [
        {"messageId": uid("msg:1"), "at": t("11-12", "12:39"), "direction": "outbound", "author": "system", "kind": "text",
         "text": "AI가 상담해요. 개인정보 처리방침: https://siljang.example/s/moonlight-cake/privacy", "photos": [], "delivery": "skill_response"},
        {"messageId": uid("msg:2"), "at": t("11-12", "12:39"), "direction": "inbound", "author": "customer", "kind": "text",
         "text": "1호 생크림 케이크 얼마예요? 010-9876-5432로 연락 주세요", "photos": [], "delivery": None},
        {"messageId": uid("msg:3"), "at": t("11-12", "12:39", "03"), "direction": "outbound", "author": "ai", "kind": "text",
         "text": "1호 생크림 케이크는 35,000원이에요. 이 금액은 11월 15일 12:39까지 유효하고, 견적만으로 그날 자리를 잡아 두지는 않아요.",
         "photos": [], "delivery": "skill_response"},
        {"messageId": uid("msg:4"), "at": t("11-12", "12:40"), "direction": "inbound", "author": "customer", "kind": "text",
         "text": "땅콩 알레르기가 있는데 먹어도 되나요?", "photos": [], "delivery": None},
    ],
    "nextCursor": None,
}

# ── 할 일 ───────────────────────────────────────────────────────────────────
TASKS = {"items": [
    {"taskId": uid("task:1"), "kind": "handoff", "waitStatus": "waiting", "waitDueAt": t("11-12", "14:40"), "order": None,
     "subject": {"type": "handoff", "id": HANDOFF["handoffId"]}, "summary": "먹어도 되는지 묻는 질문", "openedAt": t("11-12", "12:40"),
     "closedAt": None},
    {"taskId": uid("task:2"), "kind": "custom_order", "waitStatus": "late", "waitDueAt": t("11-12", "16:10"), "order": CUSTOM_REF,
     "subject": {"type": "order", "id": CUSTOM_ID}, "summary": "맞춤 주문 11/20 16:00, 그날 남은 자리 0", "openedAt": t("11-12", "14:10"),
     "closedAt": None},
    {"taskId": uid("task:3"), "kind": "payment_claim", "waitStatus": None, "waitDueAt": None, "order": ORDER_REF,
     "subject": {"type": "payment_request", "id": PR_CLAIMED["paymentRequestId"]}, "summary": "입금 확인 요청 36,000원",
     "openedAt": t("11-12", "13:40"), "closedAt": None},
    {"taskId": uid("task:4"), "kind": "refund_send", "waitStatus": None, "waitDueAt": None, "order": ORDER_REF,
     "subject": {"type": "refund", "id": REFUND["refundId"]}, "summary": "환불 보내기 31,000원(정한 지 24시간 지남)",
     "openedAt": t("11-14", "10:00"), "closedAt": None},
    {"taskId": uid("task:5"), "kind": "arrival_check", "waitStatus": None, "waitDueAt": None, "order": CUSTOM_REF,
     "subject": {"type": "payment_request", "id": PR_CUSTOM_OPEN["paymentRequestId"]}, "summary": "입금했다고 알린 뒤 취소한 주문의 들어온 입금 대조 75,000원",
     "openedAt": t("11-13", "09:12"), "closedAt": None},
], "nextCursor": None, "alertChannelFriend": True}
TASKS_NOT_FRIEND = dict(TASKS, items=TASKS["items"][:1], alertChannelFriend=False)
TASKS_EMPTY = {"items": [], "nextCursor": None, "alertChannelFriend": True}

# ── 채널과 장부 ─────────────────────────────────────────────────────────────
SKILL_SETUP = {
    "messageSkillUrl": API + "/kakao/skills/message", "cardSkillUrl": API + "/kakao/skills/card",
    "reviewSkillUrl": API + "/kakao/skills/review", "eventSkillUrl": API + "/kakao/skills/event", "eventName": "siljang_notice",
    "headerName": "Siljang-Skill-Key", "headerValue": SKILL_KEY,
}
# 가게 봇에서 카드 버튼이 부르는 블록 다섯의 블록 ID(설계 재검토 H8·H5). 스킬 요청 예시의 block.id와 같은 값
BLOCK_IDS = {"card": h("block:확인 카드", 24), "ordererInfo": h("block:주문자 정보", 24), "allergyAnswer": h("block:알레르기 답", 24),
             "depositorName": h("block:입금자 이름", 24), "review": h("block:후기", 24)}
ALL_BLOCKS = ["card", "orderer_info", "allergy_answer", "depositor_name", "review"]
CHANNEL_ID = uid("kakao-channel:1")
CHANNEL_PENDING = {
    "connectionId": CHANNEL_ID, "botId": BOT_ID, "channelPublicId": "_xMoonCake", "status": "pending", "checkStartedAt": None,
    "checkExpiresAt": None, "linkedAt": None, "failureHints": [], "blockIds": BLOCK_IDS, "verifiedBlocks": [],
    "eventStatus": "unchecked", "eventCheckedAt": None, "eventFailReason": None, "skill": SKILL_SETUP, "revision": rev("channel:1:pending"),
}
CHANNEL_CHECKING = dict(CHANNEL_PENDING, checkStartedAt=t("11-12", "11:50"), checkExpiresAt=t("11-12", "12:00"),
                        verifiedBlocks=["card", "orderer_info"], revision=rev("channel:1:checking"))
CHANNEL_LINKED = dict(CHANNEL_CHECKING, status="linked", linkedAt=t("11-12", "11:53"), verifiedBlocks=ALL_BLOCKS,
                      eventStatus="ready", eventCheckedAt=t("11-12", "11:55"), revision=rev("channel:1:linked"))
CHANNEL_EVENT_CHECKING = dict(CHANNEL_LINKED, eventStatus="checking", eventCheckedAt=None, revision=rev("channel:1:event-checking"))
CHANNEL_EVENT_UNAVAILABLE = dict(CHANNEL_LINKED, eventStatus="unavailable", eventFailReason="wallet_missing",
                                 revision=rev("channel:1:event-unavailable"))
CHANNEL_FAILED = dict(CHANNEL_CHECKING, status="failed", verifiedBlocks=["card", "orderer_info", "allergy_answer", "depositor_name"],
                      failureHints=["review_block", "open_builder_deploy"], revision=rev("channel:1:failed"))
CHANNEL_INPUT = {"botId": BOT_ID, "channelPublicId": "_xMoonCake", "blockIds": BLOCK_IDS}
LEDGER_AUTH = {"authorizationUrl": "https://accounts.google.com/o/oauth2/v2/auth?client_id=example&state=" + h("state", 24),
               "state": "st." + h("state", 40), "expiresAt": t("11-12", "12:10")}
LEDGER = {
    "status": "linked", "spreadsheetId": "1Ab" + h("sheet", 40), "sheetName": "주문 장부",
    "columns": [{"header": "주문번호", "column": "A"}, {"header": "픽업 일시", "column": "B"}, {"header": "금액", "column": "C"},
                {"header": "상태", "column": "D"}],
    "movedRight": False, "failingSince": None, "unwrittenCount": 0, "linkedAt": t("11-12", "12:00"), "unlinkedAt": None,
    "revision": rev("ledger:1:linked"),
}
LEDGER_MOVED = dict(LEDGER, columns=[{"header": "주문번호", "column": "F"}, {"header": "픽업 일시", "column": "G"},
                                     {"header": "금액", "column": "H"}, {"header": "상태", "column": "I"}], movedRight=True,
                    revision=rev("ledger:1:moved"))
LEDGER_FAILING = dict(LEDGER, status="auth_lost", failingSince=t("11-13", "09:00"), unwrittenCount=3, revision=rev("ledger:1:lost"))
LEDGER_UNLINKED = dict(LEDGER, status="unlinked", unlinkedAt=t("11-14", "09:00"), unwrittenCount=2, revision=rev("ledger:1:unlinked"))
LEDGER_INPUT = {"code": "4/" + h("gcode", 30), "state": LEDGER_AUTH["state"], "spreadsheetId": LEDGER["spreadsheetId"],
                "sheetName": "주문 장부"}

# ── 예약 링크와 공개 페이지 ────────────────────────────────────────────────
BOOKING_ISSUED = {"status": "issued", "url": "https://siljang.example/s/moonlight-cake", "issuedAt": t("11-12", "12:05"),
                  "missing": [], "recommended": []}
BOOKING_NOT_READY = {"status": "not_ready", "url": None, "issuedAt": None, "missing": ["license_verified", "payment_destination"],
                     "recommended": ["pickup_address"]}


def booking_days():
    out = []
    start = date(2026, 11, 12)
    for i in range(61):
        d = start + timedelta(days=i)
        if d.isoweekday() == 1:
            s = "day_off"
        elif d.isoformat() in ("2026-11-20", "2026-11-12", "2026-11-13"):
            s = "closed"
        else:
            s = "open"
        out.append({"day": d.isoformat(), "status": s})
    return out


BOOKING_PAGE = {
    "shop": {"name": "달빛케이크", "businessName": "달빛케이크", "representativeName": "김달빛", "contactPhone": "010-1234-5678",
             "businessRegNo": BRN, "mailOrderRegNo": "제2026-서울마포-0123호", "mailOrderExemption": None,
             "pickupAddress": "서울 마포구 달빛로 12, 1층"},
    "priceList": {"version": 4, "options": [{k: v for k, v in o.items() if k not in ("optionId", "position")} for o in PRICE_OPTIONS],
                  "designs": [{"name": d["name"], "imageUrl": d["imageUrl"], "inStandard": d["inStandard"]} for d in DESIGNS]},
    "days": booking_days(),
    "portfolio": [{"imageUrl": surl("portfolio:1")}, {"imageUrl": surl("portfolio:2")}],
    "privacyPolicyUrl": "https://siljang.example/s/moonlight-cake/privacy",
    "inquiryUrl": "https://pf.kakao.com/_xMoonCake/chat",
}
BOOKING_PAGE_NO_PHOTOS = dict(BOOKING_PAGE, portfolio=[])
PRIVACY = {
    "shopName": "달빛케이크", "version": 1,
    "body": "달빛케이크(이하 '가게')는 케이크 주문 상담과 예약을 위해 다음과 같이 개인정보를 처리합니다. 1. 처리하는 개인정보: 카카오 사용자 키, 상담 대화, 주문자 이름·연락처, 알레르기 정보(따로 동의한 손님에게서만) …",
    "overseasTransfers": [{
        "recipient": "AI 모델 회사(개발 전에 정함, OPEN-7)", "country": "정한 회사의 처리 지역", "personalData": "마스킹한 상담 대화(전화·계좌·카드 번호는 플레이스홀더)",
        "whenAndHow": "손님 메시지마다 암호화된 연결로 보냄", "purposeAndRetention": "상담 답 만들기. 회사 약관의 가장 짧은 보관",
        "howToRefuse": "AI 상담을 원하지 않으면 가게 연락처로 주문할 수 있어요. 거부하면 AI 상담을 쓸 수 없어요",
    }],
    "publishedAt": t("11-12", "12:05"),
}

# ── 제작 ────────────────────────────────────────────────────────────────────
PRODUCTION_DAY = {"day": "2026-11-20", "items": [
    {"order": ORDER_REF, "status": "confirmed", "pickupAt": t("11-20", "14:00"), "courierPickup": False, "isRemake": False,
     "summary": {"size": "1호", "flavor": "생크림", "designOption": "기본 레터링", "design": "하트 레터링",
                 "lettering": "생일 축하해 지우야", "colors": "연분홍", "designNotes": None, "extras": ["초 추가"],
                 "allergyAnswer": "없음", "allergyConsent": "agreed", "excludedIngredients": None, "referencePhotoCount": 0},
     "production": PRODUCTION_STARTED},
]}
PRODUCTION_DAY_EMPTY = {"day": "2026-11-24", "items": []}

# ── 후기와 포트폴리오 ──────────────────────────────────────────────────────
REVIEW_PHOTO_1 = uid("review-photo:1")
REVIEW_PHOTO_2 = uid("review-photo:2")
COMPLETION_PHOTO_1 = uid("completion-photo:1")
REVIEWS = {"items": [{
    "reviewId": uid("review:1"), "order": ORDER_REF, "version": 1, "body": "글씨가 정말 예쁘고 맛있었어요!", "createdAt": t("11-21", "11:20"),
    "photos": [
        {"photoId": REVIEW_PHOTO_1, "url": surl("review:1"), "consent": "consented", "inPortfolio": True},
        {"photoId": REVIEW_PHOTO_2, "url": surl("review:2"), "consent": "not_consented", "inPortfolio": False},
    ]}], "nextCursor": None}
PORTFOLIO_ITEM = {"portfolioItemId": uid("portfolio:1"), "source": "review_photo", "photoId": REVIEW_PHOTO_1, "url": surl("review:1"),
                  "publishedAt": t("11-21", "12:00")}
PORTFOLIO = {"items": [PORTFOLIO_ITEM], "candidates": [
    {"source": "review_photo", "photoId": REVIEW_PHOTO_1, "url": surl("review:1"), "order": ORDER_REF, "consent": "consented"},
    {"source": "review_photo", "photoId": REVIEW_PHOTO_2, "url": surl("review:2"), "order": ORDER_REF, "consent": "not_consented"},
    {"source": "completion_photo", "photoId": COMPLETION_PHOTO_1, "url": surl("completion:1"), "order": ORDER_REF, "consent": "consented"},
]}

# ── 카카오 스킬 요청 ────────────────────────────────────────────────────────


def skill_request(utterance, *, action="message", params=None, client_extra=None, block="상담", callback=True, friend=True):
    ur = {
        "timezone": "Asia/Seoul", "params": {"surface": "Kakaotalk.plusfriend"},
        "block": {"id": h("block:" + block, 24), "name": block}, "utterance": utterance, "lang": "ko",
        "user": {"id": USER_KEY, "type": "botUserKey",
                 "properties": {"botUserKey": USER_KEY, "plusfriendUserKey": "pf" + h("pfkey", 10), "isFriend": friend}},
    }
    if callback:
        ur["callbackUrl"] = CALLBACK_URL
    return {
        "intent": {"id": h("block:" + block, 24), "name": block},
        "userRequest": ur,
        "bot": {"id": BOT_ID, "name": "달빛케이크"},
        "action": {"id": h("action:" + action, 24), "name": action + "_skill", "params": params or {}, "detailParams": {},
                   "clientExtra": client_extra or {}},
    }


SKILL_MESSAGE = skill_request("1호 생크림 케이크 얼마예요?")
SKILL_MESSAGE_ALLERGY = skill_request("땅콩 알레르기가 있는데 먹어도 되나요?")
SKILL_CARD = skill_request("규정에 동의하고 주문 요청", action="card", block="확인 카드", callback=False,
                           client_extra={"cardKey": "ck_" + h("card:order", 30), "choice": "confirm"})
SKILL_ORDERER = skill_request("이름·연락처 넣기", action="card", block="주문자 정보", callback=False,
                              params={"customer_name": "이지우", "customer_phone": "010-9876-5432"},
                              client_extra={"cardKey": "ck_" + h("card:orderer", 30), "choice": "confirm"})
SKILL_DEPOSITOR = skill_request("입금자 이름 넣기", action="card", block="입금자 이름", callback=False,
                                params={"depositor_name": "이민호"},
                                client_extra={"cardKey": "ck_" + h("card:payclaim", 30), "choice": "confirm"})
# 알레르기 정보 카드의 '동의하고 알려 주기'가 연 '알레르기 답' 블록(설계 재검토 H5, SPEC-075)
SKILL_ALLERGY = skill_request("동의하고 알려 주기", action="card", block="알레르기 답", callback=False,
                              params={"allergy_answer": "땅콩"},
                              client_extra={"cardKey": "ck_" + h("card:allergy", 30), "choice": "confirm"})
# 완성 사진 안내의 사진 게시 동의 카드(설계 재검토 H10, SPEC-053)
SKILL_PHOTO_CONSENT = skill_request("올려도 돼요", action="card", block="확인 카드", callback=False,
                                    client_extra={"cardKey": "ck_" + h("card:photo-consent", 30), "choice": "confirm"})
SKILL_CHECK_CARD = skill_request("시험: 확인 카드", action="card", block="확인 카드", callback=False, client_extra={"check": "card"})
SKILL_CHECK_REVIEW = skill_request("시험: 후기", action="review", block="후기", callback=False,
                                   params={"review_text": "연결 시험", "photo_consent": "동의 안 함"}, client_extra={"check": "review"})
NOTICE_ID = uid("notification:1")
SKILL_NOTICE = skill_request("", action="notice", block="안내", callback=False)
SKILL_NOTICE["userRequest"]["params"]["noticeKey"] = NOTICE_ID
SKILL_EVENT_TEST = skill_request("", action="notice", block="안내", callback=False)
SKILL_EVENT_TEST["userRequest"]["params"]["check"] = "event"
SKILL_REVIEW = skill_request("후기 남기기", action="review", block="후기", callback=False,
                             params={"review_text": "글씨가 정말 예쁘고 맛있었어요!",
                                     "review_photos": '{"privacyAgreement":"Y","imageQuantity":"2","secureUrls":"List(https://talk.kakao.example/p/1,https://talk.kakao.example/p/2)","expire":"2026-11-21T11:30:00"}',
                                     "photo_consent": "동의"},
                             client_extra={"orderNo": ORDER_NO})


# ── 카카오 스킬 응답 ────────────────────────────────────────────────────────
def text(*lines, quick=None):
    r = {"version": "2.0", "template": {"outputs": [{"simpleText": {"text": s}} for s in lines]}}
    if quick:
        r["template"]["quickReplies"] = quick
    return r


def card(title, description, buttons):
    return {"version": "2.0", "template": {"outputs": [{"textCard": {"title": title, "description": description, "buttons": buttons}}]}}


def card_button(label, card_key, choice):
    return {"label": label, "action": "block", "blockId": BLOCK_IDS["card"], "extra": {"cardKey": card_key, "choice": choice}}


def check_button(label, block, key):
    """연결 확인의 시험 버튼: 그 가게가 넣은 블록 ID를 부르고 extra.check에 블록 이름(SPEC-008, 설계 재검토 H8)"""
    return {"label": label, "action": "block", "blockId": BLOCK_IDS[key], "extra": {"check": block}}


# 주문 요청 확인 카드(설계 재검토 H9, DEC-22): 그 버전의 취소·환불 규정 글을 먼저, 요약 카드를 끝에 둠.
# 규정 글이 1,000자를 넘으면 조문 사이에서 나눠 글 둘(1/2, 2/2)로 보내고 청약철회 문장은 둘째 끝에. 자르지 않음
CARD_CLAUSE_KEYS = ("pre_production_cancel", "staged_refund", "cancellation_fee", "date_change_refund_basis",
                    "shop_cancel_compensation", "custom")  # 04단계 SPEC-028의 취소·환불 조문
RULES_TEXT = ("취소·환불 규정(운영규정 버전 %d)\n" % RULES["version"]
              + "".join("· %s: %s → %s\n" % (c["title"], c["conditionText"], c["effectText"])
                        for c in CLAUSES if c["key"] in CARD_CLAUSE_KEYS)
              + "주문제작이라 청약철회가 제한될 수 있어요")


def order_card(summary, card_key, notice=None):
    description = (notice + " · " if notice else "") + summary
    return {"version": "2.0", "template": {"outputs": [
        {"simpleText": {"text": RULES_TEXT}},
        {"textCard": {"title": "주문 요청 확인", "description": description, "buttons": [
            card_button("규정에 동의하고 주문 요청", card_key, "confirm"),
            card_button("안 할래요", card_key, "decline")]}}]}}


# 알레르기 정보 카드(설계 재검토 H5, SPEC-075): 주문자 정보 카드와 주문 요청 카드 앞. 동의 글은 우리 서비스가 쓰고 버전을 붙임
ALLERGY_TEXT = ("알레르기 정보는 이 주문의 케이크를 만드는 데만 써요. 알레르기가 있는 재료만 받고, 이 가게 사장님만 보며, 주문이 끝나고 30일 뒤 지워요. "
                "동의하지 않아도 돼요. 그러면 알레르기는 묻지 않고 빼야 할 재료만으로 주문해요")
ALLERGY_CARD = card("알레르기 정보", ALLERGY_TEXT, [
    {"label": "동의하고 알려 주기", "action": "block", "blockId": BLOCK_IDS["allergyAnswer"],
     "extra": {"cardKey": "ck_" + h("card:allergy", 30), "choice": "confirm"}},
    card_button("동의 안 함", "ck_" + h("card:allergy", 30), "decline")])
# 주문자 정보 카드(설계 재검토 H11, SPEC-072)
ORDERER_CARD_OUTPUT = {"textCard": {"title": "주문자 정보", "description": "주문하시는 분의 이름과 연락처를 넣어 주세요. 이 정보는 AI에 보내지 않아요",
                                    "buttons": [{"label": "이름·연락처 넣기", "action": "block", "blockId": BLOCK_IDS["ordererInfo"],
                                                 "extra": {"cardKey": "ck_" + h("card:orderer", 30), "choice": "confirm"}}]}}


ADD_FRIEND = "채널을 추가하시면 답을 바로 받아 보실 수 있어요."
HANDED_OVER = "사장님 확인 뒤 답드릴게요."
CK = "ck_" + h("card:order", 30)
ORDER_SUMMARY = "11월 20일 14:00 픽업 · 1호 생크림 · 문구 '생일 축하해 지우야' · 알레르기: 없음 · 주문자 이지우 010-9876-5432 · 36,000원"
SKILL_OUTCOME_EXAMPLES = {
    # 손님 메시지
    "answered": text("1호 생크림 케이크는 35,000원이에요. 이 금액은 11월 15일 12:39까지 유효하고, 견적만으로 그날 자리를 잡아 두지는 않아요."),
    "callback_pending": {"version": "2.0", "useCallback": True, "data": {"text": "답을 준비하고 있어요"}},
    "handed_over": text(HANDED_OVER, ADD_FRIEND),
    "ai_unavailable": text(HANDED_OVER),
    "ai_timeout": text(HANDED_OVER),
    "ai_key_missing": text(HANDED_OVER),
    "ai_limit_reached": text(HANDED_OVER),
    "ai_cost_limit_reached": text(HANDED_OVER),
    "masking_failed": text(HANDED_OVER),
    "ai_output_rejected": text("1호 생크림 케이크는 35,000원이에요. 결제가 확인되면 주문이 확정돼요."),
    "card_shown": ALLERGY_CARD,
    "photo_received": text("사진을 받았어요"),
    "photo_rejected": text("사진은 한 장 20MB, 한 상담에 10장까지 받을 수 있어요"),
    "unsupported_message": text("글이나 사진으로 말씀해 주세요"),
    "rate_limited": text("잠시 뒤 다시 말씀해 주세요"),
    "duplicate": text("1호 생크림 케이크는 35,000원이에요. 이 금액은 11월 15일 12:39까지 유효하고, 견적만으로 그날 자리를 잡아 두지는 않아요."),
    "not_accepting": text("아직 상담을 받지 않아요. 가게로 연락해 주세요: 010-1234-5678"),
    "channel_test_card": card("연결 확인", "테스트 메시지를 받았어요. 시험 버튼 5개를 하나씩 눌러 주세요(1/5 확인 카드)",
                              [check_button("시험: 확인 카드", "card", "card")]),
    "server_error": text("잠시 뒤 다시 말씀해 주세요"),
    # 연결 확인의 시험 버튼(카드·후기 스킬)
    "block_verified": card("연결 확인", "확인 카드 블록이 닿았어요(1/5). 다음 시험 버튼을 눌러 주세요",
                           [check_button("시험: 주문자 정보", "orderer_info", "ordererInfo")]),
    "channel_linked": text("버튼 블록 5개가 모두 닿아 연결됐어요. 곧 이 채널로 시험 안내를 하나 보내 드려요"),
    # 먼저 보내는 안내(안내 스킬)
    "notice_shown": text("주문이 확정됐어요. 11월 20일 14:00에 뵐게요."),
    "notice_test": text("시험 안내예요. 이 안내가 보이면 손님에게 안내를 먼저 보낼 수 있어요"),
    "notice_gone": text("지금은 전할 안내가 없어요"),
    # 확인 카드 버튼
    "allergy_saved": {"version": "2.0", "template": {"outputs": [ORDERER_CARD_OUTPUT]}},
    "allergy_declined": {"version": "2.0", "template": {"outputs": [
        {"simpleText": {"text": "알겠어요. 알레르기는 묻지 않고 빼야 할 재료만으로 주문을 이어갈게요"}}, ORDERER_CARD_OUTPUT]}},
    "orderer_saved": order_card(ORDER_SUMMARY, CK),
    "order_requested": text("주문을 요청했어요(주문번호 K7Q3M9). 결제가 확인되면 확정돼요.",
                            "입금하실 곳: 달빛은행 123456-01-234567 김달빛 · 36,000원 · 11월 13일 01:05까지"),
    "payment_claimed": text("사장님께 알렸어요. 확인되면 알려 드릴게요"),
    "change_requested": text("변경을 요청했어요. 사장님이 보고 알려 드려요"),
    "order_cancelled": text("주문을 취소했어요. 환불은 사장님이 정한 뒤 알려 드려요"),
    "issue_reported": text("신고를 받았어요. 사장님이 보시고 정하실 거예요"),
    "photo_consent_saved": text("알려 주셔서 고마워요. 사진 게시 동의는 언제든 철회할 수 있어요"),
    "consent_withdrawn": text("사진 게시 동의를 철회했어요. 곧 사진이 내려가요"),
    "declined": text("알겠어요. 더 궁금한 것이 있으면 말씀해 주세요"),
    "input_invalid": card("주문자 정보", "이름은 1~30자, 연락처는 숫자와 '-'로 8~14자로 넣어 주세요. 이 정보는 AI에 보내지 않아요",
                          [{"label": "이름·연락처 넣기", "action": "block", "blockId": BLOCK_IDS["ordererInfo"],
                            "extra": {"cardKey": "ck_" + h("card:orderer", 30), "choice": "confirm"}}]),
    "card_stale": order_card(ORDER_SUMMARY.replace("36,000원", "38,000원"), "ck_" + h("card:order:2", 30),
                             notice="내용이 바뀌었어요. 새 카드를 확인해 주세요"),
    "card_expired": order_card(ORDER_SUMMARY, "ck_" + h("card:order:3", 30), notice="시간이 지나 새 카드를 보내 드려요"),
    "card_not_yours": text("이 버튼은 카드를 받은 분만 누를 수 있어요"),
    "card_used": text("주문을 요청했어요(주문번호 K7Q3M9). 결제가 확인되면 확정돼요."),
    "day_full": text("그 사이 그날이 다 찼어요. 이날은 어떠세요?",
                     quick=[{"label": "11월 19일", "action": "message", "messageText": "11월 19일로 할게요"},
                            {"label": "11월 21일", "action": "message", "messageText": "11월 21일로 할게요"}]),
    "retry_needed": text("다시 눌러 주세요"),
    "not_allowed_now": text("지금은 할 수 없어요: 이미 받은 주문이에요"),
    # 후기
    "review_saved": text("후기를 남겨 주셔서 고마워요"),
    "review_not_allowed": text("받으신 주문에만 후기를 남길 수 있어요"),
    "review_invalid": text("후기는 1,000자, 사진은 5장까지 남길 수 있어요"),
    "photo_download_failed": text("사진을 받지 못했어요. 다시 보내 주세요"),
}
# 후기 스킬의 block_verified: 후기 블록이 닿았지만 아직 닿지 않은 블록이 있음(API-072)
REVIEW_BLOCK_VERIFIED = card("연결 확인", "후기 블록이 닿았어요. 아직 닿지 않은 블록이 있어요. 이 시험 버튼을 눌러 주세요",
                             [check_button("시험: 입금자 이름", "depositor_name", "depositorName")])
CALLBACK_RESULT = {"taskId": h("task", 16), "status": "SUCCESS", "message": "OK", "timestamp": 1763619300000}

# ── 운영자: 가게 기록 보기와 원래 값 열기(설계 재검토 H4) ──────────────────────────────
KEPT_ORDER_ID = uid("order:H2W6Y1")
KEPT_RECORD_ID = uid("kept:H2W6Y1")
OP_MASKED_PHONE_ID = uid("masked:1")
OP_ORDER_ROW = {"orderId": ORDER_ID, "orderNo": ORDER_NO, "kept": False, "keptRecordId": None, "status": "confirmed",
                "pickupAt": t("11-20", "14:00"), "amount": 36000, "customerNameMasked": "이**", "customerPhoneMasked": "***-****-5432",
                "finishedAt": None, "contractKeepUntil": None, "createdAt": t("11-12", "13:05")}
OP_KEPT_ROW = {"orderId": KEPT_ORDER_ID, "orderNo": "H2W6Y1", "kept": True, "keptRecordId": KEPT_RECORD_ID, "status": None,
               "pickupAt": None, "amount": None, "customerNameMasked": None, "customerPhoneMasked": None,
               "finishedAt": t("09-05", "15:10"), "contractKeepUntil": "2031-09-05T15:10:00+09:00", "createdAt": t("08-30", "10:00")}
OP_RECORDS_ORDERS = {"kind": "orders", "orders": [OP_ORDER_ROW, OP_KEPT_ROW], "consultations": [], "nextCursor": None}
OP_RECORDS_CONSULTATIONS = {"kind": "consultations", "orders": [], "nextCursor": None, "consultations": [
    {"consultationId": CONSULT_ID, "status": "awaiting_owner", "startedAt": t("11-12", "12:39"), "lastMessageAt": t("11-12", "12:41"),
     "orderNos": [], "maskedValueCount": 2}]}
OP_RECORDS_EMPTY = {"kind": "orders", "orders": [], "consultations": [], "nextCursor": None}
OP_CONSULTATION = {
    "consultationId": CONSULT_ID, "status": "awaiting_owner",
    "maskedValues": [
        {"maskedValueId": OP_MASKED_PHONE_ID, "kind": "phone", "placeholder": "[전화번호1]", "last4": "5432", "originalKept": True},
        {"maskedValueId": uid("masked:2"), "kind": "card", "placeholder": "[카드번호1]", "last4": "1111", "originalKept": False},
    ],
    "items": [
        {"messageId": uid("msg:1"), "at": t("11-12", "12:39"), "direction": "outbound", "author": "system", "kind": "text",
         "textMasked": "AI가 상담해요. 개인정보 처리방침: https://siljang.example/s/moonlight-cake/privacy", "photoCount": 0},
        {"messageId": uid("msg:2"), "at": t("11-12", "12:39"), "direction": "inbound", "author": "customer", "kind": "text",
         "textMasked": "1호 생크림 케이크 얼마예요? [전화번호1]로 연락 주세요", "photoCount": 0},
        {"messageId": uid("msg:5"), "at": t("11-12", "12:41"), "direction": "inbound", "author": "customer", "kind": "photo",
         "textMasked": None, "photoCount": 2},
        {"messageId": uid("msg:6"), "at": t("11-12", "12:41", "30"), "direction": "inbound", "author": "customer", "kind": "text",
         "textMasked": "결제는 카드 [카드번호1]로 할게요", "photoCount": 0},
    ],
    "nextCursor": None,
}
OP_CONSULTATION_DELETED = dict(OP_CONSULTATION, status="deleted", maskedValues=[], items=[], nextCursor=None)
OP_ORDER = {
    "orderId": ORDER_ID, "orderNo": ORDER_NO, "kind": "standard", "status": "confirmed", "pickupAt": t("11-20", "14:00"), "amount": 36000,
    "customerNameMasked": "이**", "customerPhoneMasked": "***-****-5432", "allergyAnswered": True, "excludedIngredientsAnswered": False,
    "referencePhotoCount": 0, "consultationId": CONSULT_ID,
    "paymentRequests": [{"paymentRequestId": PR_FIRST_PAID["paymentRequestId"], "kind": "first", "status": "paid", "amount": 36000,
                         "issuedAt": t("11-12", "13:05"), "paidAt": t("11-12", "14:02")}],
    "refunds": [], "createdAt": t("11-12", "13:05"),
}
OP_ORDER_REFUND = dict(OP_ORDER, status="cancelled", refunds=[
    {"refundId": REFUND["refundId"], "cause": "customer_cancel", "decision": "partial", "amount": 31000, "decidedAt": t("11-14", "10:00"),
     "sentAt": None, "refundAccount": {"bankName": "하늘은행", "accountMasked": "***-***-**6789", "holderNameMasked": "이**"}}])
OPEN_ORIGINAL_INPUT = {"targetKind": "masked_value", "targetId": OP_MASKED_PHONE_ID, "reason": "손님 문의: 픽업 연락이 안 됨"}
ORIGINAL_BASE = {"targetKind": "masked_value", "targetId": OP_MASKED_PHONE_ID, "openedAt": t("11-14", "10:20"),
                 "maskedValue": None, "orderContact": None, "refundAccount": None, "keptRecord": None}
ORIGINAL_MASKED = dict(ORIGINAL_BASE, maskedValue={"placeholder": "[전화번호1]", "kind": "phone", "value": "010-9876-5432"})
ORIGINAL_CONTACT = dict(ORIGINAL_BASE, targetKind="order_contact", targetId=ORDER_ID,
                        orderContact={"customerName": "이지우", "customerPhone": "010-9876-5432"})
ORIGINAL_REFUND = dict(ORIGINAL_BASE, targetKind="refund_account", targetId=REFUND["refundId"],
                       refundAccount={"bankName": "하늘은행", "accountNumber": "110-123-456789", "holderName": "이지우"})
KEPT_RECORD = {
    "keptRecordId": KEPT_RECORD_ID, "orderNo": "H2W6Y1", "customerName": "정해밀", "finishedAt": t("09-05", "15:10"),
    "contractKeepUntil": "2031-09-05T15:10:00+09:00", "issueKeepUntil": None, "issuePurgedAt": None,
    "details": [{"version": 1, "createdAt": t("08-30", "10:00"), "pickupAt": t("09-05", "15:00"), "amount": 45000,
                 "summary": "2호 · 생크림 · 기본 레터링"}],
    "payments": [{"kind": "first", "status": "paid", "amount": 45000, "issuedAt": t("08-30", "10:00"), "paidAt": t("08-30", "11:20")}],
    "refunds": [],
}
ORIGINAL_KEPT = dict(ORIGINAL_BASE, targetKind="kept_record", targetId=KEPT_RECORD_ID, keptRecord=KEPT_RECORD)
