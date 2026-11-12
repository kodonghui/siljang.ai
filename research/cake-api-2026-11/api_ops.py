"""06단계 API 계약의 작업 72개(API-001~072). build_api.py가 OpenAPI paths로 바꾼다.

작업마다 적는 것
- id·method·path·op(operationId)·tag·summary·desc·spec(SPEC ID)
- auth: owner·operator(로그인 필요), owner?·operator?(있으면 씀), skill(카카오 스킬 키), public(누구나)
- params: 경로·쿼리 매개변수. idem=True면 Idempotency-Key 헤더(DEC-04)
- body·body_examples: 요청 본문 스키마와 예시
- ok: [(상태, 스키마, {예시 이름: 값}, 헤더들)]
- errors: {상태: [오류 코드]}. 401 unauthenticated, 422 validation_failed, default internal 등은 build_api.py가 규칙대로 더함
- fields: validation_failed 예시의 칸 오류. confirm: confirmation_required 예시의 확인할 것
- omit: 응답 표(2xx·401·403·404·409·422·default) 가운데 이 작업이 돌려주지 않는 것과 그 까닭
- outcomes: 카카오 스킬의 결과 코드(200 예시 이름 = Siljang-Outcome 헤더 값, DEC-07)
- kinds: 경우의 종류마다 그 경우를 보여 주는 증거. 'NNN', 'NNN:코드', 'outcome:코드', 'example:이름', 'idem', 'revision',
  'closed'(응답 스키마가 닫힘), 'security', 'callback', 'screen'(08단계), 'note:…'(말로만 적은 근거)
"""
import api_examples as E

O403 = "역할마다 세션 쿠키와 경로가 나뉘고(DEC-10, DEC-11), 다른 가게 기록은 404로 숨김(DEC-02)"
O403_OPERATOR = "운영자 계정은 모두 같은 권한(첫 판)"
O404_NOPATH = "경로에 기록 ID가 없음"
O409_READ = "읽기만 함"
O422_NOINPUT = "받는 입력이 없음"
O422_PATHONLY = "경로 ID 밖 입력이 없고, 모양이 틀린 ID도 404(DEC-02)"
O401_PUBLIC = "누구나 엶(로그인 없음)"
O403_PUBLIC = "누가 열어도 같은 공개 정보"
SKILL_OMIT = {
    "403": "가게·손님 구분은 결과 코드로 알리고 HTTP 403을 쓰지 않음(DEC-07)",
    "404": "경로에 기록 ID가 없음. 연결 안 된 채널은 결과 not_accepting(DEC-07)",
    "409": "같은 요청·이미 누른 카드도 200과 처음 결과(duplicate·card_used, DEC-07)",
}


def pid(name, what, example):
    return dict(name=name, **{"in": "path"}, required=True, example=example,
                schema={"type": "string", "minLength": 1, "maxLength": 100},
                description=f"{what} ID(uuid). 없거나 다른 가게 것이거나 모양이 틀리면 404(DEC-02)")


def pday(example, what):
    return dict(name="day", **{"in": "path"}, required=True, example=example, schema={"type": "string", "format": "date"},
                description=f"{what}(가게 시간대의 날짜, DEC-15). 모양이 틀리면 422")


def q(name, schema, desc, example=None, required=False):
    d = dict(name=name, **{"in": "query"}, required=required, schema=schema, description=desc)
    if example is not None:
        d["example"] = example
    return d


PVERSION = dict(name="version", **{"in": "path"}, required=True, example="3",
                schema={"type": "string", "minLength": 1, "maxLength": 20},
                description="판 번호(1부터의 정수). 없는 판이거나 모양이 틀리면 404(DEC-02)")
PSLUG = dict(name="slug", **{"in": "path"}, required=True, example="moonlight-cake",
             schema={"type": "string", "minLength": 1, "maxLength": 100},
             description="예약 링크 주소의 가게 몫(shops.booking_slug). 없거나 발급 전이거나 모양이 틀리면 404(DEC-02)")
CURSOR = "#/components/parameters/Cursor"
LIMIT = "#/components/parameters/Limit"

OPS = []


def op(**kw):
    kw.setdefault("params", [])
    kw.setdefault("errors", {})
    kw.setdefault("omit", {})
    kw.setdefault("idem", False)
    kw.setdefault("fields", [])
    kw.setdefault("confirm", [])
    kw.setdefault("outcomes", [])
    kw.setdefault("body", None)
    kw.setdefault("body_type", "json")
    kw.setdefault("body_examples", {})
    kw.setdefault("callbacks", False)
    kw.setdefault("ai", None)
    OPS.append(kw)


# ═══ 로그인 ═══════════════════════════════════════════════════════════════════
op(id="API-001", method="post", path="/owner/session", op="createOwnerSession", tag="로그인",
   summary="사장님 로그인(카카오 인가 코드)", spec=["SPEC-001", "SPEC-068"], auth="public",
   desc="카카오 로그인 화면이 redirectUri로 준 인가 코드를 서버가 카카오 토큰으로 바꿔 카카오 회원번호만 남기고 토큰은 버린다(DEC-10, REQ-135). "
        "세션은 HttpOnly·Secure·SameSite=Lax 쿠키 `siljang_owner`. `next`가 화면이 열 곳(가게 등록·신고증 다시 올리기·할 일 목록). "
        "카카오 로그인이 실패하거나 동의를 거부하면 우리 쪽 기록을 남기지 않음. "
        "Open: 세션 길이는 사장님 30일(쓰면 늘어남)을 첫 값으로 제안, 개발 전에 정함(OPEN-5).",
   body="OwnerSessionInput",
   body_examples={"kakao_code": {"kakaoCode": "kc_" + E.h("kakao-code", 40), "redirectUri": "https://siljang.example/owner/login/callback"}},
   ok=[(200, "OwnerSessionResult", {
       "new_owner": {"owner": dict(E.OWNER, alertChannelFriend=False), "shop": None, "next": "register_shop"},
       "returning_owner": {"owner": E.OWNER, "shop": E.SHOP_SUMMARY, "next": "open_tasks"},
       "license_on_hold": {"owner": E.OWNER, "shop": dict(E.SHOP_SUMMARY, licenseStatus="on_hold"), "next": "resubmit_license"},
   }, ["Set-Cookie"])],
   errors={401: ["kakao_login_failed"], 429: ["rate_limited"], 503: ["kakao_unavailable"]},
   fields=[("/kakaoCode", "required")],
   omit={"403": "누구나 로그인을 시도함", "404": O404_NOPATH,
         "409": "같은 카카오 계정이 동시에 들어와도 카카오 회원번호로 사장님 줄은 하나(부딪힐 상태가 없음)"},
   kinds={"접근": ["401:kakao_login_failed"], "입력": ["422:validation_failed"], "상태": ["example:license_on_hold"],
          "바깥": ["401:kakao_login_failed", "503:kakao_unavailable"], "한도": ["429:rate_limited"],
          "노출": ["closed", "note:카카오 토큰은 응답·로그에 없음(REQ-135)"], "화면": ["screen"]})

op(id="API-002", method="get", path="/owner/me", op="getOwnerMe", tag="로그인",
   summary="로그인한 사장님과 가게, 화면 맨 위 안내", spec=["SPEC-001", "SPEC-067"], auth="owner",
   desc="사장님 화면을 열 때 세션을 확인한다. 세션이 없거나 끝났으면 401이고 화면은 로그인으로 보낸 뒤 원래 주소로 돌아온다(SPEC-001). "
        "`banners`의 add_alert_channel은 사장님이 우리 서비스 채널 친구가 아니라 알림이 할 일 목록에만 남는다는 안내(SPEC-067).",
   ok=[(200, "Me", {
       "friend": {"owner": E.OWNER, "shop": E.SHOP_SUMMARY, "banners": []},
       "not_friend": {"owner": dict(E.OWNER, alertChannelFriend=False), "shop": E.SHOP_SUMMARY, "banners": ["add_alert_channel"]},
       "no_shop": {"owner": E.OWNER, "shop": None, "banners": []},
   })],
   omit={"403": O403, "404": O404_NOPATH + ". 가게가 없으면 shop이 null", "409": O409_READ, "422": O422_NOINPUT},
   kinds={"접근": ["security", "401:unauthenticated"], "상태": ["example:not_friend"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-003", method="delete", path="/owner/session", op="deleteOwnerSession", tag="로그인",
   summary="사장님 로그아웃", spec=["SPEC-001"], auth="owner?",
   desc="세션을 끝내고 쿠키를 지운다. 세션이 없어도 204(로그아웃은 늘 성공).",
   ok=[(204, None, {}, ["Set-Cookie"])],
   omit={"401": "세션이 없거나 끝났어도 204", "403": O403, "404": O404_NOPATH, "409": "끝낼 세션만 있음(부딪힐 상태가 없음)",
         "422": O422_NOINPUT},
   kinds={"접근": ["security"], "반복": ["204", "note:두 번 불러도 204"], "화면": ["screen"]})

op(id="API-004", method="post", path="/operator/session", op="createOperatorSession", tag="로그인",
   summary="운영자 로그인(이메일·비밀번호·2단계 인증)", spec=["SPEC-001"], auth="public",
   desc="운영자 계정으로만 운영자 화면에 들어온다(R2). 맞지 않는 것이 어느 칸인지 알리지 않는다. 15분에 5번 실패하면 429(DEC-16). "
        "세션은 HttpOnly·Secure·SameSite=Lax 쿠키 `siljang_operator`. 비밀번호는 인증 서비스로만 보내고 어디에도 남기지 않음(REQ-135). "
        "Open: 운영자 인증 서비스는 개발 전에 고름. 고른 서비스가 자기 로그인 화면을 쓰면 이 작업을 그 흐름으로 바꾸고, 그 서비스가 답하지 않을 때의 503을 더함(OPEN-6). "
        "Open: 세션 길이 12시간을 첫 값으로 제안(OPEN-5).",
   body="OperatorSessionInput",
   body_examples={"login": {"email": "ops@siljang.example", "password": "example-password-not-real", "otp": "123456"}},
   ok=[(200, "Operator", {"signed_in": E.OPERATOR}, ["Set-Cookie"])],
   errors={401: ["operator_login_failed"], 429: ["too_many_attempts"]},
   fields=[("/otp", "bad_format")],
   omit={"403": "누구나 로그인을 시도함", "404": O404_NOPATH, "409": "로그인은 부딪힐 상태가 없음"},
   kinds={"접근": ["401:operator_login_failed"], "입력": ["422:validation_failed"], "한도": ["429:too_many_attempts"],
          "노출": ["closed"], "화면": ["screen"]})

op(id="API-005", method="get", path="/operator/me", op="getOperatorMe", tag="로그인",
   summary="로그인한 운영자", spec=["SPEC-001"], auth="operator",
   desc="운영자 화면을 열 때 세션을 확인한다. 운영자 세션이 없으면 401(DEC-11).",
   ok=[(200, "Operator", {"operator": E.OPERATOR})],
   omit={"403": O403_OPERATOR, "404": O404_NOPATH, "409": O409_READ, "422": O422_NOINPUT},
   kinds={"접근": ["security", "401:unauthenticated"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-006", method="delete", path="/operator/session", op="deleteOperatorSession", tag="로그인",
   summary="운영자 로그아웃", spec=["SPEC-001"], auth="operator?",
   desc="운영자 세션을 끝내고 쿠키를 지운다. 세션이 없어도 204.",
   ok=[(204, None, {}, ["Set-Cookie"])],
   omit={"401": "세션이 없거나 끝났어도 204", "403": O403_OPERATOR, "404": O404_NOPATH, "409": "끝낼 세션만 있음(부딪힐 상태가 없음)",
         "422": O422_NOINPUT},
   kinds={"접근": ["security"], "반복": ["204", "note:두 번 불러도 204"], "화면": ["screen"]})

# ═══ 파일 ═════════════════════════════════════════════════════════════════════
op(id="API-007", method="post", path="/owner/uploads", op="createUpload", tag="파일",
   summary="사진 올리기(신고증·도안·완성 사진)", spec=["SPEC-002", "SPEC-004", "SPEC-053"], auth="owner",
   desc="사진 한 장을 먼저 올리고 받은 uploadId를 명령에 쓴다(1시간 안, DEC-09). 용도별 한도: 신고증 JPG·PNG·HEIC 10MB, 도안 JPG·PNG·HEIC·WEBP 10MB, "
        "완성 사진 JPG·PNG·HEIC·WEBP 20MB. 파일 종류는 내용으로 확인한다. 저장 위치는 응답에 싣지 않는다(G6). "
        "다시 올려도 새 uploadId가 하나 더 생길 뿐이라 요청 키를 받지 않는다(DEC-04 밖).",
   body="UploadForm", body_type="multipart",
   ok=[(201, "Upload", {"license_photo": E.UPLOAD_LICENSE, "completion_photo": E.UPLOAD_COMPLETION})],
   errors={413: ["file_too_large"], 503: ["storage_unavailable"]},
   fields=[("/file", "not_allowed")],
   omit={"403": O403, "404": O404_NOPATH, "409": "올리기는 다른 기록과 부딪히지 않음"},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed", "413:file_too_large"],
          "한도": ["413:file_too_large"], "바깥": ["503:storage_unavailable"], "노출": ["closed"], "화면": ["screen"]})

# ═══ 가게 ═════════════════════════════════════════════════════════════════════
op(id="API-008", method="post", path="/owner/shop", op="registerShop", tag="가게",
   summary="가게 등록", spec=["SPEC-002", "SPEC-068"], auth="owner", idem=True,
   desc="가게 이름·연락처·사업자 정보·영업 신고와 신고증 사진(uploadId), 개인정보 처리 위탁·재위탁 조건의 판과 동의를 받아 가게를 '영업 신고 확인 기다림'으로 남긴다. "
        "동의하지 않으면 422 consent_required이고 넣은 값도 남기지 않는다(REQ-107). 카카오 계정 하나에 가게 하나라 두 번째는 409 already_registered(R2). "
        "같은 사업자등록번호의 다른 가게도 받고 운영자 화면에 겹침을 표시한다(API-012). 신고증 사진을 옮기지 못하면 503이고 아무것도 남기지 않는다.",
   body="ShopRegistration", body_examples={"register": E.SHOP_REGISTRATION},
   ok=[(201, "Shop", {"registered": E.SHOP_PENDING})],
   errors={422: ["consent_required"], 409: ["already_registered"], 503: ["storage_unavailable"]},
   fields=[("/businessRegNo", "checksum_failed"), ("/foodBusinessType", "not_allowed"), ("/licensePhotoUploadId", "upload_not_found")],
   omit={"403": O403, "404": O404_NOPATH},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "상태": ["422:consent_required", "409:already_registered"],
          "반복": ["idem", "409:already_registered"], "동시": ["201", "note:같은 사업자등록번호도 받고 운영자 화면에 겹침 표시(API-012)"],
          "바깥": ["503:storage_unavailable"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-009", method="get", path="/owner/shop", op="getShop", tag="가게",
   summary="내 가게 보기", spec=["SPEC-002", "SPEC-003", "SPEC-009"], auth="owner",
   desc="사장님은 자기 가게의 영업 신고 상태와 보류 이유만 본다(SPEC-003). 신고증 사진은 15분 사는 서명 주소(DEC-09).",
   ok=[(200, "Shop", {"verified": E.SHOP, "pending": E.SHOP_PENDING, "on_hold": E.SHOP_ON_HOLD})],
   errors={404: ["shop_not_registered"]},
   omit={"403": O403, "409": O409_READ, "422": O422_NOINPUT},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:shop_not_registered"], "상태": ["example:on_hold"],
          "노출": ["closed"], "화면": ["screen"]})

op(id="API-010", method="patch", path="/owner/shop", op="updateShop", tag="가게",
   summary="가게 설정 바꾸기", spec=["SPEC-009", "SPEC-017", "SPEC-024", "SPEC-025", "SPEC-052"], auth="owner", idem=True,
   desc="이름·연락처·픽업 장소(E14, DEC-13)·완성 사진 보내기(SPEC-009)·문의 끊김 시간(SPEC-025)·사장님 답 기다리는 시간(SPEC-024)·하루 AI 비용 한도(REQ-163)를 바꾼다. "
        "바꿀 칸만 보낸다. 사업자 정보와 영업 신고는 여기서 바꾸지 않는다(신고증은 API-011). 바뀐 것이 없으면 outcome unchanged.",
   body="ShopUpdate",
   body_examples={"pickup_address": {"baseRevision": E.rev("shop:2"), "pickupAddress": "서울 마포구 달빛로 12, 1층", "completionPhotoEnabled": True}},
   ok=[(200, "ShopResult", {"updated": {"outcome": "done", "shop": E.SHOP}, "unchanged": {"outcome": "unchanged", "shop": E.SHOP}})],
   errors={404: ["shop_not_registered"], 409: ["version_conflict"]},
   fields=[("/contactPhone", "bad_format"), ("/ownerWaitMinutes", "out_of_range")],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:shop_not_registered"],
          "반복": ["idem", "example:unchanged"], "동시": ["revision", "409:version_conflict"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-011", method="put", path="/owner/shop/license", op="resubmitLicense", tag="가게",
   summary="보류된 영업 신고 다시 올리기", spec=["SPEC-003"], auth="owner", idem=True,
   desc="보류된 가게의 사장님이 신고 번호·영업 종류·신고증 사진을 다시 올리면 '확인 기다림'으로 돌아가고 보류 이유는 지워진다. 보류가 아니면 409 invalid_state.",
   body="LicenseResubmission",
   body_examples={"resubmit": {"baseRevision": E.rev("shop:2"), "foodLicenseNo": "2026-0123456",
                               "foodBusinessType": "instant_sale_manufacturing", "licensePhotoUploadId": E.UPLOAD_LICENSE["uploadId"]}},
   ok=[(200, "ShopResult", {"resubmitted": {"outcome": "done", "shop": dict(E.SHOP_PENDING, revision=E.rev("shop:3p"))}})],
   errors={404: ["shop_not_registered"], 409: ["version_conflict", "invalid_state"]},
   fields=[("/licensePhotoUploadId", "upload_wrong_purpose")],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:shop_not_registered"],
          "상태": ["409:invalid_state"], "반복": ["idem"], "동시": ["revision", "409:version_conflict"], "노출": ["closed"], "화면": ["screen"]})

# ═══ 운영자 ═══════════════════════════════════════════════════════════════════
op(id="API-012", method="get", path="/operator/shops", op="listReviewShops", tag="운영자",
   summary="영업 신고 확인할 가게 목록", spec=["SPEC-003", "SPEC-002"], auth="operator",
   desc="운영자 화면에는 가게 등록 정보만 있고 손님·주문 기록은 없다(SPEC-003). 같은 사업자등록번호의 다른 가게가 있으면 duplicateBusinessRegNo(SPEC-002).",
   params=[q("status", {"type": "string", "enum": ["pending", "on_hold", "verified"]}, "영업 신고 상태로 거름. 없으면 pending", "pending"), CURSOR, LIMIT],
   ok=[(200, "ReviewShopList", {"pending": {"items": [E.REVIEW_SUMMARY, dict(E.REVIEW_SUMMARY, shopId=E.OTHER_SHOP_ID, name="별빛베이커리",
                                                                             businessName="별빛베이커리", representativeName="최별빛",
                                                                             duplicateBusinessRegNo=True, revision=E.rev("shop:star"))],
                                            "nextCursor": None},
                                "empty": E.EMPTY_PAGE})],
   fields=[("query:limit", "out_of_range")],
   omit={"403": O403_OPERATOR, "404": O404_NOPATH, "409": O409_READ},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"],
          "동시": ["200", "note:같은 사업자등록번호는 duplicateBusinessRegNo로 표시(SPEC-002)"], "노출": ["closed"],
          "빈·끊김": ["example:empty"], "화면": ["screen"]})

op(id="API-013", method="get", path="/operator/shops/{shopId}", op="getReviewShop", tag="운영자",
   summary="영업 신고 확인할 가게 하나", spec=["SPEC-003"], auth="operator",
   desc="신고증 사진(서명 주소)과 넣은 신고 번호·영업 종류·상호, 같은 사업자등록번호의 다른 가게를 보인다.",
   params=[pid("shopId", "가게", E.SHOP_ID)],
   ok=[(200, "ReviewShopDetail", {"pending": E.REVIEW_DETAIL, "on_hold": E.REVIEW_DETAIL_ON_HOLD})],
   errors={404: ["not_found"]},
   omit={"403": O403_OPERATOR, "409": O409_READ, "422": O422_PATHONLY},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:not_found"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-014", method="post", path="/operator/shops/{shopId}/license-review", op="reviewLicense", tag="운영자",
   summary="영업 신고 확인·보류", spec=["SPEC-003"], auth="operator", idem=True,
   desc="확인됨이면 확인한 운영자·시각을, 보류면 이유를 남기고 사장님께 우리 서비스 채널로 이유를 한 번 알린다(못 가면 할 일 목록, G4). "
        "확인됨을 다시 확인하면 unchanged. 확인됨을 보류로 바꾸기는 첫 판에서 하지 않음(409 invalid_state, M7). "
        "다른 운영자가 먼저 정했으면 409 already_decided, 그 밖에 가게가 바뀌었으면 409 version_conflict(G3).",
   params=[pid("shopId", "가게", E.SHOP_ID)],
   body="LicenseReviewInput",
   body_examples={"verify": {"baseRevision": E.rev("shop:1"), "decision": "verified"},
                  "hold": {"baseRevision": E.rev("shop:1"), "decision": "on_hold", "holdReason": "신고증 글자가 잘 보이지 않아요. 밝은 곳에서 다시 찍어 올려 주세요"}},
   ok=[(200, "LicenseReviewResult", {"verified": {"outcome": "done", "shop": E.REVIEW_DETAIL_VERIFIED},
                                     "on_hold": {"outcome": "done", "shop": E.REVIEW_DETAIL_ON_HOLD},
                                     "unchanged": {"outcome": "unchanged", "shop": E.REVIEW_DETAIL_VERIFIED}})],
   errors={404: ["not_found"], 409: ["version_conflict", "already_decided", "invalid_state"]},
   fields=[("/holdReason", "required")],
   omit={"403": O403_OPERATOR},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "상태": ["409:invalid_state", "example:unchanged"], "반복": ["idem"], "동시": ["revision", "409:already_decided"],
          "바깥": ["200", "note:사장님 알림이 못 가도 할 일 목록에 보류 이유(G4)"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-015", method="get", path="/operator/alerts", op="listOperatorAlerts", tag="운영자",
   summary="운영자 알림", spec=["SPEC-008", "SPEC-010", "SPEC-017"], auth="operator",
   desc="이미 다른 가게에 묶인 채널(SPEC-008), 처리방침 국외 이전 항목 빔(SPEC-010), 한 가게에서 5분에 AI 실패 5번(AI-1). 내용 없이 건수만(E10).",
   params=[CURSOR, LIMIT],
   ok=[(200, "OperatorAlertList", {"alerts": E.OPERATOR_ALERTS, "empty": E.EMPTY_PAGE})],
   fields=[("query:cursor", "bad_format")],
   omit={"403": O403_OPERATOR, "404": O404_NOPATH, "409": O409_READ},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "노출": ["closed"],
          "빈·끊김": ["example:empty"], "화면": ["screen"]})

# ═══ 가격표 ═══════════════════════════════════════════════════════════════════
op(id="API-016", method="get", path="/owner/price-list", op="getCurrentPriceList", tag="가격표",
   summary="지금 가격표 판", spec=["SPEC-004"], auth="owner",
   desc="지금 판의 옵션·옵션 규칙·도안. 아직 저장한 판이 없으면 404 not_set이고 화면은 빈 입력을 보인다.",
   ok=[(200, "PriceList", {"current": E.PRICE_LIST})],
   errors={404: ["shop_not_registered", "not_set"]},
   omit={"403": O403, "409": O409_READ, "422": O422_NOINPUT},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:not_set"], "노출": ["closed"], "빈·끊김": ["404:not_set"], "화면": ["screen"]})

op(id="API-017", method="post", path="/owner/price-list/versions", op="createPriceListVersion", tag="가격표",
   summary="가격표 새 판 저장", spec=["SPEC-004"], auth="owner", idem=True,
   desc="새 판의 전체 내용을 받아 판 번호를 하나 올려 남긴다. 옛 판은 '지난 판'으로 읽기만 된다(REQ-027). 바꾼 것이 없으면 200 unchanged이고 판 번호는 그대로. "
        "첫 저장은 baseRevision null. 옵션 규칙끼리 부딪히면(같은 조합이 허용이자 금지) 422와 부딪힌 줄. 도안 그림은 uploadId(새 그림)나 sourceDesignId(지난 판 그림).",
   body="PriceListInput", body_examples={"new_version": E.PRICE_LIST_INPUT},
   ok=[(201, "PriceListResult", {"created": {"outcome": "created", "priceList": E.PRICE_LIST}}),
       (200, "PriceListResult", {"unchanged": {"outcome": "unchanged", "priceList": E.PRICE_LIST}})],
   errors={404: ["shop_not_registered"], 409: ["version_conflict"]},
   fields=[("/options/0/amount", "out_of_range"), ("/rules/0", "conflict")],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["note:지난 판을 고치는 작업이 없음(API-019는 읽기만)"],
          "상태": ["example:unchanged"], "반복": ["idem"], "동시": ["revision", "409:version_conflict"],
          "한도": ["422:validation_failed", "note:옵션 100개·도안 50장(스키마 maxItems)"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-018", method="get", path="/owner/price-list/versions", op="listPriceListVersions", tag="가격표",
   summary="가격표 판 목록", spec=["SPEC-004"], auth="owner",
   desc="새 판이 앞. 지난 판은 지우지 않는다(REQ-027).",
   ok=[(200, "VersionList", {"versions": E.PRICE_VERSIONS, "empty": {"items": []}})],
   errors={404: ["shop_not_registered"]},
   omit={"403": O403, "409": O409_READ, "422": O422_NOINPUT},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:shop_not_registered"], "노출": ["closed"],
          "빈·끊김": ["example:empty"], "화면": ["screen"]})

op(id="API-019", method="get", path="/owner/price-list/versions/{version}", op="getPriceListVersion", tag="가격표",
   summary="가격표 판 하나", spec=["SPEC-004", "SPEC-013"], auth="owner",
   desc="지난 판은 읽기만 된다(REQ-027). 이미 요청된 주문은 그 주문이 받은 판으로 계산한다(SPEC-013).",
   params=[PVERSION],
   ok=[(200, "PriceList", {"old_version": E.PRICE_LIST_OLD})],
   errors={404: ["not_found"]},
   omit={"403": O403, "409": O409_READ, "422": O422_PATHONLY},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:not_found"], "노출": ["closed"], "화면": ["screen"]})

# ═══ 운영규정 ═════════════════════════════════════════════════════════════════
op(id="API-020", method="get", path="/owner/operating-rules", op="getCurrentOperatingRules", tag="운영규정",
   summary="지금 운영규정(없으면 틀)", spec=["SPEC-005"], auth="owner",
   desc="확정한 판이 없으면 틀(isTemplate true)을 돌려준다: 제작 전 취소 전액 환불, 견적 유효 72시간·결제 기한 12시간·신고 기한 24시간(SPEC-005).",
   ok=[(200, "OperatingRules", {"current": E.RULES, "template": E.RULES_TEMPLATE})],
   errors={404: ["shop_not_registered"]},
   omit={"403": O403, "409": O409_READ, "422": O422_NOINPUT},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:shop_not_registered"], "노출": ["closed"],
          "빈·끊김": ["example:template"], "화면": ["screen"]})

op(id="API-021", method="post", path="/owner/operating-rules/versions", op="createOperatingRulesVersion", tag="운영규정",
   summary="운영규정 확정(새 판)", spec=["SPEC-005"], auth="owner", idem=True,
   desc="조문마다 조건과 효과를 새 판 번호와 함께 남긴다. 제작 전 취소 환불을 전액보다 낮추면 아무것도 남기지 않고 409 confirmation_required(lowered_refund)를 돌려주고, "
        "사장님이 '그래도 저장'을 누르면 confirm에 lowered_refund를 담아 다시 보낸다. 그 선택을 그 판에 남긴다(REQ-032). 단계별 환불 기간이 겹치거나 비면 422.",
   body="OperatingRulesInput", body_examples={"confirm": E.RULES_INPUT, "lowered_confirmed": E.RULES_INPUT_LOWERED},
   ok=[(201, "OperatingRulesResult", {"created": {"outcome": "created", "operatingRules": E.RULES}}),
       (200, "OperatingRulesResult", {"unchanged": {"outcome": "unchanged", "operatingRules": E.RULES}})],
   errors={404: ["shop_not_registered"], 409: ["version_conflict", "confirmation_required"]},
   fields=[("/refundTiers/1", "overlaps"), ("/quoteValidHours", "out_of_range")],
   confirm=["lowered_refund"],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:shop_not_registered"],
          "상태": ["409:confirmation_required", "example:unchanged"], "반복": ["idem"], "동시": ["revision", "409:version_conflict"],
          "노출": ["closed"], "화면": ["screen"]})

op(id="API-022", method="get", path="/owner/operating-rules/versions", op="listOperatingRulesVersions", tag="운영규정",
   summary="운영규정 판 목록", spec=["SPEC-005"], auth="owner",
   desc="새 판이 앞. 옛 판은 지우지 않는다(REQ-027).",
   ok=[(200, "VersionList", {"versions": {"items": [{"version": 2, "createdAt": E.t("11-12", "11:20"), "supersededAt": None},
                                                    {"version": 1, "createdAt": E.t("11-12", "10:50"), "supersededAt": E.t("11-12", "11:20")}]},
                             "empty": {"items": []}})],
   errors={404: ["shop_not_registered"]},
   omit={"403": O403, "409": O409_READ, "422": O422_NOINPUT},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:shop_not_registered"], "노출": ["closed"],
          "빈·끊김": ["example:empty"], "화면": ["screen"]})

op(id="API-023", method="get", path="/owner/operating-rules/versions/{version}", op="getOperatingRulesVersion", tag="운영규정",
   summary="운영규정 판 하나", spec=["SPEC-005", "SPEC-016"], auth="owner",
   desc="주문은 동의한 판을 따른다(REQ-030). 환불 근거의 판을 열 때 쓴다(SPEC-016).",
   params=[PVERSION],
   ok=[(200, "OperatingRules", {"old_version": dict(E.RULES, version=1, current=False, createdAt=E.t("11-12", "10:50"),
                                                    supersededAt=E.t("11-12", "11:20"), revision=E.rev("rules:1"))})],
   errors={404: ["not_found"]},
   omit={"403": O403, "409": O409_READ, "422": O422_PATHONLY},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:not_found"], "노출": ["closed"], "화면": ["screen"]})

# ═══ 결제 받을 곳 ═════════════════════════════════════════════════════════════
op(id="API-024", method="get", path="/owner/payment-destination", op="getPaymentDestination", tag="결제 받을 곳",
   summary="결제 받을 곳 보기", spec=["SPEC-006"], auth="owner",
   desc="가게 명의 계좌와 카드 결제 링크. 계좌번호는 이 화면과 그 가게 손님의 결제 안내에만 보인다(DEC-19).",
   ok=[(200, "PaymentDestination", {"account": E.PAYMENT_DESTINATION})],
   errors={404: ["shop_not_registered", "not_set"]},
   omit={"403": O403, "409": O409_READ, "422": O422_NOINPUT},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:not_set"], "노출": ["closed", "note:계좌번호는 이 화면과 결제 안내에만(DEC-19)"],
          "빈·끊김": ["404:not_set"], "화면": ["screen"]})

op(id="API-025", method="put", path="/owner/payment-destination", op="setPaymentDestination", tag="결제 받을 곳",
   summary="결제 받을 곳 등록·바꾸기", spec=["SPEC-006"], auth="owner", idem=True,
   desc="바꾸면 새 줄을 만들고 옛 줄은 그만 쓴다. 이미 나간 결제 안내는 옛 계좌를 그대로 가리킨다. "
        "예금주가 상호·대표자와 다르면 409 confirmation_required(holder_mismatch)이고, 사장님이 '가게 명의가 맞다'고 하면 confirm에 담아 다시 보낸다(답을 남김).",
   body="PaymentDestinationInput",
   body_examples={"first": E.PAYMENT_DESTINATION_INPUT,
                  "holder_confirmed": dict(E.PAYMENT_DESTINATION_INPUT, holderName="박하늘", confirm=["holder_mismatch"])},
   ok=[(200, "PaymentDestinationResult", {"created": {"outcome": "created", "paymentDestination": E.PAYMENT_DESTINATION},
                                          "unchanged": {"outcome": "unchanged", "paymentDestination": E.PAYMENT_DESTINATION}})],
   errors={404: ["shop_not_registered"], 409: ["version_conflict", "confirmation_required"]},
   fields=[("/accountNumber", "bad_format"), ("/cardPaymentUrl", "bad_format")],
   confirm=["holder_mismatch"],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:shop_not_registered"],
          "상태": ["409:confirmation_required", "note:바꾼 계좌는 그 뒤 결제 안내부터"], "반복": ["idem", "example:unchanged"],
          "동시": ["revision", "409:version_conflict"], "노출": ["closed"], "화면": ["screen"]})

# ═══ 영업 달력 ════════════════════════════════════════════════════════════════
op(id="API-026", method="get", path="/owner/calendar", op="getCalendarSettings", tag="영업 달력",
   summary="영업 달력 기준 보기", spec=["SPEC-007"], auth="owner",
   desc="요일 휴무·하루 최대 개수·주문 마감·답하는 시간·전날 안내 시각·후기 부탁 시각.",
   ok=[(200, "CalendarSettings", {"settings": E.CALENDAR})],
   errors={404: ["shop_not_registered", "not_set"]},
   omit={"403": O403, "409": O409_READ, "422": O422_NOINPUT},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:not_set"], "노출": ["closed"], "빈·끊김": ["404:not_set"], "화면": ["screen"]})

op(id="API-027", method="put", path="/owner/calendar", op="setCalendarSettings", tag="영업 달력",
   summary="영업 달력 기준 정하기·바꾸기", spec=["SPEC-007", "SPEC-052", "SPEC-061"], auth="owner", idem=True,
   desc="바꾼 기준은 그 뒤 잡는 자리에만 쓴다(R4). 바꾼 기준을 넘는 날과 주문은 그대로 두고 conflicts로 보인다. "
        "확정 주문이 있는 요일을 휴무로 바꾸면 409 confirmation_required(closed_day_with_orders, 건수). 전날 안내·후기 부탁 시각은 08:00~20:50(SPEC-052, SPEC-061).",
   body="CalendarSettingsInput", body_examples={"first": E.CALENDAR_INPUT},
   ok=[(200, "CalendarSettingsResult", {
       "created": {"outcome": "created", "calendar": E.CALENDAR, "conflicts": []},
       "updated_with_conflicts": {"outcome": "updated", "calendar": dict(E.CALENDAR, dailyCapacity=4, revision=E.rev("calendar:2")),
                                  "conflicts": [{"day": "2026-11-20", "capacity": 4, "held": 5, "orders": [E.ORDER_REF, E.CUSTOM_REF]}]},
       "unchanged": {"outcome": "unchanged", "calendar": E.CALENDAR, "conflicts": []}})],
   errors={404: ["shop_not_registered"], 409: ["version_conflict", "confirmation_required"]},
   fields=[("/replyEnd", "not_after_start"), ("/dayBeforeNoticeTime", "outside_window")],
   confirm=["closed_day_with_orders"],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:shop_not_registered"],
          "상태": ["409:confirmation_required", "example:updated_with_conflicts"], "반복": ["idem", "example:unchanged"],
          "동시": ["revision", "409:version_conflict", "note:자리 잡기와는 날짜 줄 잠금 순서(G3)"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-028", method="get", path="/owner/calendar/days", op="listCalendarDays", tag="영업 달력",
   summary="날짜별 남은 자리와 마감 현황", spec=["SPEC-007", "SPEC-012", "SPEC-015"], auth="owner",
   desc="from~to(62일까지)의 날마다 하루 최대 개수·잡힌 자리·남은 자리·마감·넘겨 잡음. 남은 자리 수는 사장님 화면에만(G6).",
   params=[q("from", {"type": "string", "format": "date"}, "첫 날(가게 시간대)", "2026-11-19", True),
           q("to", {"type": "string", "format": "date"}, "끝 날. from부터 62일까지", "2026-11-23", True)],
   ok=[(200, "CalendarDayList", {"days": E.CALENDAR_DAYS})],
   errors={404: ["shop_not_registered", "not_set"]},
   fields=[("query:to", "out_of_range")],
   omit={"403": O403, "409": O409_READ},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_set"],
          "노출": ["closed", "note:남은 자리 수는 사장님에게만(G6)"], "빈·끊김": ["note:from~to의 날마다 한 줄이라 빈 목록이 없음"],
          "화면": ["screen"]})

op(id="API-029", method="patch", path="/owner/calendar/days/{day}", op="updateCalendarDay", tag="영업 달력",
   summary="그날 휴무·하루 최대 개수·주문 마감 바꾸기", spec=["SPEC-007", "SPEC-012", "SPEC-015"], auth="owner", idem=True,
   desc="날짜별 휴무, 그날만 다른 하루 최대 개수, 그날 주문 마감(SPEC-012)을 바꾼다. 이미 잡힌 자리는 그대로이고, 마감을 풀면 다시 잡는다. "
        "이미 마감된 날을 다시 마감하면 unchanged. 지난 날짜는 422(path:day in_past). 확정 주문이 있는 날을 휴무로 바꾸면 409 confirmation_required.",
   params=[pday("2026-11-20", "바꿀 날")],
   body="CalendarDayInput",
   body_examples={"close_orders": {"baseRevision": E.calendar_day("2026-11-20", held=5)["revision"], "manuallyClosed": True},
                  "day_off_confirmed": {"baseRevision": E.calendar_day("2026-11-20", held=5)["revision"], "closed": True,
                                        "confirm": ["closed_day_with_orders"]}},
   ok=[(200, "CalendarDayResult", {"closed_orders": {"outcome": "done", "day": E.calendar_day("2026-11-21", held=1, manual=True)},
                                   "unchanged": {"outcome": "unchanged", "day": E.calendar_day("2026-11-21", held=1, manual=True)}})],
   errors={404: ["shop_not_registered", "not_set"], 409: ["version_conflict", "confirmation_required"]},
   fields=[("path:day", "in_past")],
   confirm=["closed_day_with_orders"],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"],
          "대상": ["422:validation_failed", "note:지난 날짜는 path:day in_past"], "상태": ["example:unchanged", "409:confirmation_required"],
          "반복": ["idem"], "동시": ["revision", "409:version_conflict"], "노출": ["closed"], "화면": ["screen"]})

# ═══ 카카오톡 채널 ════════════════════════════════════════════════════════════
op(id="API-030", method="get", path="/owner/kakao-channel", op="getKakaoChannel", tag="카카오톡 채널",
   summary="채널 연결 상태와 스킬 설정 값", spec=["SPEC-008"], auth="owner",
   desc="연결 확인 중이면 화면이 몇 초마다 다시 읽는다. 10분 안에 시험 메시지가 오지 않으면 failed와 까닭 후보(failureHints). "
        "skill.headerValue는 오픈빌더 스킬 설정의 헤더 값(DEC-08)이라 이 응답에만 싣는다.",
   ok=[(200, "KakaoChannel", {"pending": E.CHANNEL_CHECKING, "linked": E.CHANNEL_LINKED, "failed": E.CHANNEL_FAILED})],
   errors={404: ["shop_not_registered", "not_set"]},
   omit={"403": O403, "409": O409_READ, "422": O422_NOINPUT},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:not_set"], "바깥": ["example:failed"],
          "노출": ["closed", "note:스킬 키는 이 응답에만(DEC-08)"], "빈·끊김": ["404:not_set"], "화면": ["screen"]})

op(id="API-031", method="put", path="/owner/kakao-channel", op="setKakaoChannel", tag="카카오톡 채널",
   summary="연결할 채널(오픈빌더 봇) 정하기", spec=["SPEC-008"], auth="owner", idem=True,
   desc="오픈빌더 봇 ID와 채널 공개 ID를 받아 '연결 확인 중' 연결을 만들고, 오픈빌더에 넣을 스킬 주소와 헤더 값을 돌려준다(DEC-08). "
        "그 봇이 이미 다른 가게에 묶였으면 묶지 않고 409 channel_linked_elsewhere, 운영자에게 알림(SPEC-008). "
        "연결된 채널을 바꾸면 새 채널이 연결될 때 옛 채널 메시지를 그만 받는다. 예약 링크는 내리지 않고 문의 버튼이 새 채널을 연다. "
        "Open: 사장님이 봇 ID를 찾는 곳은 07·08단계 연결 안내에서 정하고, 봇 ID 모양은 첫 시험 메시지에서 확인(OPEN-8).",
   body="KakaoChannelInput", body_examples={"connect": dict(E.CHANNEL_INPUT, baseRevision=None)},
   ok=[(200, "KakaoChannelResult", {"created": {"outcome": "created", "kakaoChannel": E.CHANNEL_PENDING},
                                    "unchanged": {"outcome": "unchanged", "kakaoChannel": E.CHANNEL_PENDING}})],
   errors={404: ["shop_not_registered"], 409: ["version_conflict", "channel_linked_elsewhere"]},
   fields=[("/botId", "required")],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["409:channel_linked_elsewhere"],
          "상태": ["note:바꾸면 새 채널이 연결될 때 옛 채널은 그만 받음"], "반복": ["idem", "example:unchanged"],
          "동시": ["revision", "409:version_conflict"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-032", method="post", path="/owner/kakao-channel/check", op="startKakaoChannelCheck", tag="카카오톡 채널",
   summary="연결 확인 시작(10분)", spec=["SPEC-008"], auth="owner", idem=True,
   desc="'연결 확인'을 누르면 10분 동안 그 봇의 시험 메시지를 기다린다. 시험 메시지가 메시지 스킬(API-070)로 오면 채널이 '연결됨'이 된다. "
        "여러 번 눌러도 연결은 하나(G2): 확인 중이거나 연결됨이면 unchanged, 연결 안 됨이면 다시 10분을 센다.",
   ok=[(200, "KakaoChannelResult", {"started": {"outcome": "done", "kakaoChannel": E.CHANNEL_CHECKING},
                                    "unchanged": {"outcome": "unchanged", "kakaoChannel": E.CHANNEL_LINKED}})],
   errors={404: ["shop_not_registered", "not_set"]},
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed", "note:본문이 없고 요청 키 헤더만 받음"],
          "대상": ["404:not_set"], "반복": ["idem", "example:unchanged"],
          "바깥": ["note:10분 안에 시험 메시지가 없으면 API-030에서 failed"], "노출": ["closed"], "화면": ["screen"]})

# ═══ 장부 ═════════════════════════════════════════════════════════════════════
op(id="API-033", method="get", path="/owner/ledger", op="getLedger", tag="장부",
   summary="장부 연결 상태", spec=["SPEC-009", "SPEC-064"], auth="owner",
   desc="우리가 쓰는 칸의 머리글과 자리, 실패가 이어진 때와 아직 못 적은 쓰기 수(SPEC-064). 구글 허락 토큰은 비밀값 저장소에만 있고 응답에 없다(REQ-135).",
   ok=[(200, "LedgerLink", {"linked": E.LEDGER, "auth_lost": E.LEDGER_FAILING, "unlinked": E.LEDGER_UNLINKED})],
   errors={404: ["shop_not_registered", "not_set"]},
   omit={"403": O403, "409": O409_READ, "422": O422_NOINPUT},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:not_set"], "바깥": ["example:auth_lost"], "노출": ["closed"],
          "빈·끊김": ["404:not_set"], "화면": ["screen"]})

op(id="API-034", method="post", path="/owner/ledger/authorization", op="startLedgerAuthorization", tag="장부",
   summary="구글 허락 받기 시작", spec=["SPEC-009"], auth="owner",
   desc="구글 허락 화면 주소와 서버가 서명한 state를 돌려준다. 기록을 바꾸지 않아 요청 키를 받지 않는다(DEC-04 밖).",
   body="LedgerAuthorizationInput", body_examples={"start": {"redirectUri": "https://siljang.example/owner/ledger/callback"}},
   ok=[(200, "LedgerAuthorization", {"authorization": E.LEDGER_AUTH})],
   errors={404: ["shop_not_registered"]},
   fields=[("/redirectUri", "not_allowed")],
   omit={"403": O403, "409": "기록을 바꾸지 않음(서명한 state만 만듦)"},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:shop_not_registered"],
          "노출": ["closed"], "화면": ["screen"]})

op(id="API-035", method="put", path="/owner/ledger", op="linkLedger", tag="장부",
   summary="장부 연결·다시 연결", spec=["SPEC-009", "SPEC-064"], auth="owner", idem=True,
   desc="구글 인가 코드와 고른 시트·탭으로 장부를 연결하고 우리 칸 머리글을 만든다. 같은 이름의 사장님 칸이 있으면 오른쪽 빈 칸에 만들고 movedRight(REQ-127). "
        "다시 연결하면 '연결 끊김'으로 남은 주문들의 줄을 지금 값으로 다시 적는다. 구글 허락이 거부되거나 시트를 열 수 없으면 연결하지 않는다.",
   body="LedgerLinkInput", body_examples={"link": dict(E.LEDGER_INPUT, baseRevision=None)},
   ok=[(200, "LedgerResult", {"created": {"outcome": "created", "ledger": E.LEDGER},
                              "moved_right": {"outcome": "created", "ledger": E.LEDGER_MOVED},
                              "relinked": {"outcome": "relinked", "ledger": dict(E.LEDGER, revision=E.rev("ledger:2"))}})],
   errors={404: ["shop_not_registered"], 409: ["version_conflict"], 422: ["google_authorization_failed", "sheet_not_accessible"],
           503: ["google_unavailable"]},
   fields=[("/spreadsheetId", "bad_format")],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed", "example:moved_right"],
          "대상": ["422:sheet_not_accessible"], "상태": ["example:relinked"], "반복": ["idem"], "동시": ["revision", "409:version_conflict"],
          "바깥": ["422:google_authorization_failed", "503:google_unavailable"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-036", method="delete", path="/owner/ledger", op="unlinkLedger", tag="장부",
   summary="장부 끊기", spec=["SPEC-009"], auth="owner", idem=True,
   desc="그 뒤 쓰기는 하지 않고, 기다리던 쓰기는 버리지 않고 '연결 끊김'으로 남긴다(keptWrites). 이미 끊었으면 unchanged.",
   ok=[(200, "LedgerUnlinkResult", {"unlinked": {"outcome": "done", "ledger": E.LEDGER_UNLINKED, "keptWrites": 2},
                                    "unchanged": {"outcome": "unchanged", "ledger": E.LEDGER_UNLINKED, "keptWrites": 2}})],
   errors={404: ["shop_not_registered", "not_set"]},
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed", "note:본문이 없고 요청 키 헤더만 받음"],
          "대상": ["404:not_set"], "상태": ["example:unlinked"],
          "반복": ["idem", "example:unchanged"], "노출": ["closed"], "화면": ["screen"]})

# ═══ 예약 링크 ════════════════════════════════════════════════════════════════
op(id="API-037", method="get", path="/owner/booking-link", op="getBookingLink", tag="예약 링크",
   summary="예약 링크와 빠진 조건", spec=["SPEC-010"], auth="owner",
   desc="조건(가격표·운영규정·영업 달력·영업 신고 확인·채널 연결·결제 받을 곳)이 모두 채워지면 서버가 처리방침을 만들고 링크를 한 번 낸다. 낸 링크는 같은 주소로 유지. "
        "빠진 조건은 missing, 막지 않지만 넣으면 좋은 것은 recommended(픽업 장소, DEC-13). 결제 받을 곳을 조건에 더한 것은 DEC-12(REQ-164). "
        "privacy_policy는 국외 이전 항목이 비어 운영자가 채울 때까지 링크가 나가지 않음을 뜻한다.",
   ok=[(200, "BookingLink", {"issued": E.BOOKING_ISSUED, "not_ready": E.BOOKING_NOT_READY})],
   errors={404: ["shop_not_registered"]},
   omit={"403": O403, "409": O409_READ, "422": O422_NOINPUT},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:shop_not_registered"], "상태": ["example:not_ready"],
          "동시": ["note:조건 둘이 동시에 채워져도 링크는 하나(G2)"], "노출": ["closed"], "빈·끊김": ["example:not_ready"], "화면": ["screen"]})

op(id="API-038", method="get", path="/public/shops/{slug}", op="getBookingPage", tag="예약 링크",
   summary="예약 링크 페이지", spec=["SPEC-011", "SPEC-014", "SPEC-063"], auth="public",
   desc="누구나 연다. 포트폴리오(게시 동의한 사진만), 지금 판의 가격표, 오늘부터 60일의 날(받음·마감·휴무, 남은 자리 수 없음), 가게 신원 정보, 처리방침 주소, 문의 주소. "
        "같은 주소에서 1분에 60번을 넘으면 429(DEC-16). 응답은 최대 60초 캐시되어 내린 사진은 5분 안에 사라진다(SPEC-063). "
        "채널을 열 수 없으면 화면이 inquiryUrl을 글로 보인다.",
   params=[PSLUG],
   ok=[(200, "BookingPage", {"page": E.BOOKING_PAGE, "no_photos": E.BOOKING_PAGE_NO_PHOTOS}, ["Cache-Control"])],
   errors={404: ["not_found"], 429: ["rate_limited"]},
   omit={"401": O401_PUBLIC, "403": O403_PUBLIC, "409": O409_READ, "422": "주소 밖 입력이 없음. 모양이 틀린 주소는 404(DEC-02)"},
   kinds={"대상": ["404:not_found"], "상태": ["note:다 참·마감·받아 준 날은 '마감', 휴무는 '휴무'"], "한도": ["429:rate_limited"],
          "바깥": ["note:채널을 열 수 없으면 화면이 inquiryUrl을 글로"], "노출": ["closed", "note:손님 이름·주문·남은 자리 수·내부 ID 없음(G6)"],
          "빈·끊김": ["example:no_photos"], "화면": ["screen"]})

op(id="API-039", method="get", path="/public/shops/{slug}/privacy-policy", op="getPrivacyPolicy", tag="예약 링크",
   summary="가게 개인정보 처리방침", spec=["SPEC-010", "SPEC-011", "SPEC-018"], auth="public",
   desc="가장 늦은 판. 국외 이전 다섯 항목(REQ-141)을 받는 자마다 싣는다. AI 상담 고지가 이 주소를 건다(SPEC-018).",
   params=[PSLUG],
   ok=[(200, "PrivacyPolicy", {"policy": E.PRIVACY}, ["Cache-Control"])],
   errors={404: ["not_found"], 429: ["rate_limited"]},
   omit={"401": O401_PUBLIC, "403": O403_PUBLIC, "409": O409_READ, "422": "주소 밖 입력이 없음. 모양이 틀린 주소는 404(DEC-02)"},
   kinds={"대상": ["404:not_found"], "한도": ["429:rate_limited"], "노출": ["closed"], "화면": ["screen"]})

# ═══ 할 일 ════════════════════════════════════════════════════════════════════
op(id="API-040", method="get", path="/owner/tasks", op="listOwnerTasks", tag="할 일",
   summary="할 일 목록", spec=["SPEC-067", "SPEC-022", "SPEC-024", "SPEC-037"], auth="owner",
   desc="사장님이 정할 일(넘긴 질문·맞춤 주문·결제 확인 요청·맞추는 중·결제 기한 지남·변경 요청·문제 신고·환불 정하기·취소 뒤 입금·옛 판 변경·장부 다시 연결·영업 신고 보류·달력 기준을 넘는 날). "
        "기다림 상태(waitStatus)는 넘긴 질문·맞춤 주문·변경 요청·문제 신고에만(SPEC-024). subject가 열 화면. "
        "알림은 우리 서비스 채널로 가고, 사장님이 채널 친구가 아니면 alertChannelFriend false(SPEC-067).",
   params=[q("status", {"type": "string", "enum": ["open", "closed"]}, "열림·닫힘. 없으면 open", "open"), CURSOR, LIMIT],
   ok=[(200, "OwnerTaskList", {"open_tasks": E.TASKS, "not_friend": E.TASKS_NOT_FRIEND, "empty": E.TASKS_EMPTY})],
   errors={404: ["shop_not_registered"]},
   fields=[("query:status", "not_allowed")],
   omit={"403": O403, "409": O409_READ},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:shop_not_registered"],
          "상태": ["example:not_friend"], "반복": ["note:할 일마다 한 번(사건 키, G2)"],
          "노출": ["closed", "note:summary에 손님 연락처·계좌·알레르기 없음(SPEC-067)"], "빈·끊김": ["example:empty"], "화면": ["screen"]})

# ═══ 넘긴 질문과 상담 ═════════════════════════════════════════════════════════
op(id="API-041", method="get", path="/owner/handoffs/{handoffId}", op="getHandoff", tag="넘긴 질문·상담",
   summary="넘긴 질문 하나", spec=["SPEC-022", "SPEC-023", "SPEC-021"], auth="owner",
   desc="넘긴 까닭과 손님 말(원래 값으로 되돌린 글, SPEC-021), 그 뒤 덧붙은 말. 마감된 날 질문이면 requestedDay.",
   params=[pid("handoffId", "넘긴 질문", E.HANDOFF["handoffId"])],
   ok=[(200, "Handoff", {"edibility": E.HANDOFF, "closed_day": E.HANDOFF_DAY})],
   errors={404: ["not_found"]},
   omit={"403": O403, "409": O409_READ, "422": O422_PATHONLY},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:not_found"],
          "노출": ["closed", "note:원래 값은 그 가게 사장님 화면에만(SPEC-021, DEC-19)"], "화면": ["screen"]})

op(id="API-042", method="post", path="/owner/handoffs/{handoffId}/answer", op="answerHandoff", tag="넘긴 질문·상담",
   summary="넘긴 질문에 답하기", spec=["SPEC-023", "SPEC-024", "SPEC-066"], auth="owner", idem=True,
   desc="사장님 답을 AI가 고치지 않고 그대로 손님에게 전한다(친구면 바로, 아니면 다음 대화 때 먼저, SPEC-066). 기다림 타이머를 멈춘다(SPEC-024). "
        "마감된 날 질문이면 dayDecision: 받아 줌이면 그 상담의 그 날을 24시간 동안 넘겨 잡게 표시한다. "
        "이미 답한 질문은 409 already_decided. 사장님이 화면을 연 뒤 손님 말이 덧붙었으면 409 version_conflict.",
   params=[pid("handoffId", "넘긴 질문", E.HANDOFF["handoffId"])],
   body="HandoffAnswerInput",
   body_examples={"answer": {"baseRevision": E.HANDOFF["revision"], "text": E.HANDOFF_ANSWERED["answerText"]},
                  "accept_day": {"baseRevision": E.HANDOFF_DAY["revision"], "dayDecision": "accepted", "text": "20일 받아 드릴게요. 주문을 이어가 주세요."}},
   ok=[(200, "HandoffAnswerResult", {"sent": {"outcome": "done", "handoff": E.HANDOFF_ANSWERED, "delivery": "sent"},
                                     "deferred": {"outcome": "done", "handoff": E.HANDOFF_DAY_ACCEPTED, "delivery": "deferred"}})],
   errors={404: ["not_found"], 409: ["version_conflict", "already_decided"]},
   fields=[("/text", "too_long")],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "상태": ["409:already_decided"], "반복": ["idem"], "동시": ["revision", "409:version_conflict"],
          "바깥": ["example:deferred"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-043", method="get", path="/owner/consultations/{consultationId}/messages", op="listConsultationMessages", tag="넘긴 질문·상담",
   summary="상담 대화 보기", spec=["SPEC-021", "SPEC-019", "SPEC-068", "SPEC-065"], auth="owner",
   desc="그 가게 상담만. 사장님 화면에는 가린 번호를 원래 값으로 되돌린 글과 참고 사진(서명 주소)이 보인다. 새 메시지가 뒤. 지워진 상담(SPEC-065)은 status deleted와 빈 items.",
   params=[pid("consultationId", "상담", E.CONSULT_ID), CURSOR, LIMIT],
   ok=[(200, "ConsultationMessagePage", {"messages": E.MESSAGES,
                                         "deleted": dict(E.MESSAGES, status="deleted", items=[], nextCursor=None)})],
   errors={404: ["not_found"]},
   fields=[("query:limit", "out_of_range")],
   omit={"403": O403, "409": O409_READ},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "노출": ["closed"], "빈·끊김": ["example:deleted"], "화면": ["screen"]})

# ═══ 주문 ═════════════════════════════════════════════════════════════════════
op(id="API-044", method="get", path="/owner/orders", op="listOrders", tag="주문",
   summary="주문 목록", spec=["SPEC-031", "SPEC-037", "SPEC-068"], auth="owner",
   desc="상태·종류·픽업 날짜로 거른다. status=payment_overdue가 결제 기한 지난 주문 목록(SPEC-037), status=requested&kind=custom이 답할 맞춤 주문.",
   params=[q("status", {"type": "string", "enum": ["requested", "awaiting_payment", "payment_overdue", "confirmed", "received", "no_pickup", "rejected", "cancelled"]},
             "주문 상태", "requested"),
           q("kind", {"type": "string", "enum": ["standard", "custom"]}, "기본 디자인·맞춤"),
           q("pickupFrom", {"type": "string", "format": "date"}, "픽업 날짜 첫 날"),
           q("pickupTo", {"type": "string", "format": "date"}, "픽업 날짜 끝 날"), CURSOR, LIMIT],
   ok=[(200, "OrderList", {"orders": E.ORDER_LIST, "overdue": E.ORDER_LIST_OVERDUE, "empty": E.EMPTY_PAGE})],
   errors={404: ["shop_not_registered"]},
   fields=[("query:pickupTo", "not_after_start")],
   omit={"403": O403, "409": O409_READ},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:shop_not_registered"],
          "노출": ["closed"], "빈·끊김": ["example:empty"], "화면": ["screen"]})

op(id="API-045", method="get", path="/owner/orders/{orderId}", op="getOrder", tag="주문",
   summary="주문 하나", spec=["SPEC-031", "SPEC-013", "SPEC-045", "SPEC-068"], auth="owner",
   desc="주문 내용 판(새 판이 앞), 참고 사진, 견적과 계산 근거(사장님께 전부, SPEC-013), 픽업 날의 자리, 결제 안내·결제·환불·변경 요청·제작·문제 신고·사진 게시 동의. "
        "다른 가게 주문이면 404(SPEC-068).",
   params=[pid("orderId", "주문", E.ORDER_ID)],
   ok=[(200, "Order", {"custom_requested": E.CUSTOM_REQUESTED, "confirmed": E.ORDER_CONFIRMED, "changed": E.ORDER_CHANGED,
                       "remake": E.ORDER_REMAKE})],
   errors={404: ["not_found"]},
   omit={"403": O403, "409": O409_READ, "422": O422_PATHONLY},
   kinds={"접근": ["security", "401:unauthenticated", "404:not_found"], "대상": ["404:not_found"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-046", method="post", path="/owner/orders/{orderId}/custom-decision", op="decideCustomOrder", tag="주문",
   summary="맞춤 주문에 답하기(수락·금액 바꿔 수락·거절)", spec=["SPEC-031", "SPEC-015", "SPEC-032"], auth="owner", idem=True,
   desc="수락하면 그날 자리를 결제 기한까지 잡고 결제 안내를 낸다(SPEC-032). 그날 자리가 없으면 먼저 409 confirmation_required(overbooking)이고, "
        "사장님이 확인하면 confirm에 담아 넘겨 잡는다(R10). 금액을 바꿔 수락하면 새 주문 내용 판(까닭 포함)과 요청 금액을 함께 보이는 결제 안내. "
        "거절이면 거절됨과 손님 안내. 이미 답한 주문은 409 already_decided, 그 사이 손님이 취소했으면 409 order_cancelled.",
   params=[pid("orderId", "주문", E.CUSTOM_ID)],
   body="CustomDecisionInput",
   body_examples={"accept": {"baseRevision": E.CUSTOM_REQUESTED["revision"], "decision": "accept"},
                  "accept_with_amount": {"baseRevision": E.CUSTOM_REQUESTED["revision"], "decision": "accept_with_amount", "amount": 75000,
                                         "amountChangeReason": "곰돌이 얼굴 입체 장식이 더해져요", "confirm": ["overbooking"]},
                  "reject": {"baseRevision": E.CUSTOM_REQUESTED["revision"], "decision": "reject", "rejectReason": "그날은 입체 장식을 만들 시간이 없어요"}},
   ok=[(200, "OrderCommandResult", {"accepted": {"outcome": "done", "order": E.CUSTOM_ACCEPTED, "paymentRequest": E.PR_CUSTOM_OPEN},
                                    "rejected": {"outcome": "done", "order": E.CUSTOM_REJECTED, "paymentRequest": None}})],
   errors={404: ["not_found"], 409: ["version_conflict", "already_decided", "order_cancelled", "invalid_state", "confirmation_required"]},
   fields=[("/amount", "out_of_range"), ("/amountChangeReason", "required")],
   confirm=["overbooking"],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "상태": ["409:already_decided", "409:order_cancelled", "409:confirmation_required"], "반복": ["idem"],
          "동시": ["revision", "409:version_conflict"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-047", method="post", path="/owner/orders/{orderId}/overdue-decision", op="decideOverdueOrder", tag="주문",
   summary="결제 기한 지난 주문: 더 기다리기·취소", spec=["SPEC-038", "SPEC-039", "SPEC-015", "SPEC-032", "SPEC-037"], auth="owner", idem=True,
   desc="더 기다리기면 그날 자리를 새 결제 기한까지 다시 잡고 다시 낸 결제 안내를 보낸다(SPEC-038). 남은 자리가 없으면 409 confirmation_required(overbooking). "
        "취소면 '결제 없어 취소됨', 손님 안내 한 번, 장부 쓰기(SPEC-039). 픽업 일시나 주문 마감이 지났으면 더 기다리기는 409 invalid_state(취소만). "
        "이미 고른 주문은 409 already_decided. 그 사이 결제가 확인됐으면 409 version_conflict(G3).",
   params=[pid("orderId", "주문", E.CUSTOM_ID)],
   body="OverdueDecisionInput",
   body_examples={"wait": {"baseRevision": E.CUSTOM_OVERDUE["revision"], "decision": "wait"},
                  "cancel": {"baseRevision": E.CUSTOM_OVERDUE["revision"], "decision": "cancel"}},
   ok=[(200, "OrderCommandResult", {"waited": {"outcome": "done", "order": E.CUSTOM_REISSUED, "paymentRequest": E.PR_REISSUE},
                                    "cancelled": {"outcome": "done", "order": E.CUSTOM_NO_PAYMENT, "paymentRequest": None}})],
   errors={404: ["not_found"], 409: ["version_conflict", "already_decided", "invalid_state", "confirmation_required"]},
   fields=[("/decision", "not_allowed")],
   confirm=["overbooking"],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "상태": ["409:invalid_state", "409:already_decided", "409:confirmation_required"], "반복": ["idem"],
          "동시": ["revision", "409:version_conflict"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-048", method="post", path="/owner/orders/{orderId}/shop-cancel", op="cancelOrderByShop", tag="주문",
   summary="가게 사정 취소", spec=["SPEC-048", "SPEC-016", "SPEC-015"], auth="owner", idem=True,
   desc="주문을 '가게 사정으로 취소됨'으로 두고 자리를 풀고 손님에게 알리고 장부 쓰기를 남긴다. 받은 금액이 있으면 전액을 계산값으로 한 refundPreview를 돌려주고 화면은 환불 정하기(API-050)로 간다. "
        "받은 주문은 409 invalid_state, 이미 가게 사정으로 취소했으면 unchanged, 다른 까닭으로 취소된 주문은 409 already_decided.",
   params=[pid("orderId", "주문", E.ORDER_ID)],
   body="ShopCancelInput",
   body_examples={"cancel": {"baseRevision": E.ORDER_CONFIRMED["revision"], "reason": "오븐이 고장 나 그날 만들 수 없어요"}},
   ok=[(200, "ShopCancelResult", {"cancelled_paid": {"outcome": "done", "order": E.ORDER_CANCELLED_BY_SHOP, "refundPreview": E.REFUND_PREVIEW_SHOP},
                                  "cancelled_unpaid": {"outcome": "done", "order": dict(E.ORDER_CANCELLED_BY_SHOP, paymentRequests=[], payments=[]),
                                                       "refundPreview": None},
                                  "unchanged": {"outcome": "unchanged", "order": E.ORDER_CANCELLED_BY_SHOP, "refundPreview": None}})],
   errors={404: ["not_found"], 409: ["version_conflict", "invalid_state", "already_decided"]},
   fields=[("/reason", "required")],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "상태": ["409:invalid_state", "409:already_decided", "example:unchanged"], "반복": ["idem"],
          "동시": ["revision", "409:version_conflict"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-049", method="get", path="/owner/orders/{orderId}/refund-preview", op="getRefundPreview", tag="환불",
   summary="환불 계산 미리 보기(가게 규칙)", spec=["SPEC-016", "SPEC-047"], auth="owner",
   desc="그 주문이 받은 운영규정 판, 취소 시각(아직이면 지금), 맞춤 재료 주문·제작 시작 시각, 받은 금액으로 계산값과 근거를 낸다. "
        "정할 수 있는 가장 큰 금액은 받은 금액 - 이미 정한 환불(REQ-086). 받은 금액이 0원이면 0원(SPEC-016). 같은 입력이면 같은 값.",
   params=[pid("orderId", "주문", E.ORDER_ID),
           q("cause", {"type": "string", "enum": ["customer_cancel", "shop_cancel", "change_reduced", "paid_after_cancel"]}, "환불 까닭", "customer_cancel", True),
           q("changeRequestId", {"type": "string", "minLength": 1, "maxLength": 100}, "금액이 내려간 변경(cause가 change_reduced일 때 꼭). 없거나 다른 주문 것이면 404")],
   ok=[(200, "RefundPreview", {"customer_cancel": E.REFUND_PREVIEW, "shop_cancel": E.REFUND_PREVIEW_SHOP})],
   errors={404: ["not_found"]},
   fields=[("query:cause", "required")],
   omit={"403": O403, "409": O409_READ + ". 받은 금액이 0원이면 0원으로 계산(SPEC-016)"},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "반복": ["note:같은 입력이면 같은 값(SPEC-016)"], "노출": ["closed", "note:근거는 사장님께 전부"], "화면": ["screen"]})

op(id="API-050", method="post", path="/owner/orders/{orderId}/refunds", op="decideRefund", tag="환불",
   summary="환불 정하기", spec=["SPEC-047", "SPEC-016", "SPEC-066", "SPEC-064"], auth="owner", idem=True,
   desc="전액 환불·일부 환불·환불 없이 취소 가운데 하나를 고른다. 금액은 받은 금액 - 이미 정한 환불을 넘을 수 없다(422 exceeds_received). "
        "계산값과 다르면 까닭이 꼭 있다. 손님에게 환불 금액과 받는 방법을 한 번 알리고 장부 쓰기를 남긴다. "
        "우리는 돈을 옮기지 않는다: 사장님이 가게 계좌에서 돌려보낸 뒤 API-061로 '보냄'을 표시한다(REQ-079). 보상 환불은 API-065. 같은 까닭의 환불을 이미 정했으면 409 already_decided.",
   params=[pid("orderId", "주문", E.ORDER_ID)],
   body="RefundInput",
   body_examples={"partial": E.REFUND_INPUT,
                  "override": dict(E.REFUND_INPUT, amount=36000, decision="full", overrideReason="단골 손님이라 수수료를 받지 않아요"),
                  "none": dict(E.REFUND_INPUT, decision="none", amount=0, overrideReason="제작 뒤 취소라 돌려드리지 않아요")},
   ok=[(201, "RefundResult", {"decided": {"outcome": "done", "refund": E.REFUND, "customerNotice": "sent"},
                              "deferred_notice": {"outcome": "done", "refund": E.REFUND, "customerNotice": "deferred"}})],
   errors={404: ["not_found"], 409: ["version_conflict", "already_decided", "invalid_state"]},
   fields=[("/amount", "exceeds_received"), ("/overrideReason", "required")],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "상태": ["409:invalid_state", "409:already_decided"], "반복": ["idem"], "동시": ["revision", "409:version_conflict"],
          "바깥": ["example:deferred_notice"], "노출": ["closed", "note:우리는 돈을 옮기지 않음(REQ-079)"], "화면": ["screen"]})

# ═══ 제작 ═════════════════════════════════════════════════════════════════════
op(id="API-051", method="get", path="/owner/production-days/{day}", op="getProductionDay", tag="제작",
   summary="날짜별 제작 목록과 그날 픽업", spec=["SPEC-050", "SPEC-054", "SPEC-045"], auth="owner",
   desc="확정된 주문과 다시 만들기 주문만, 픽업 일시 순(SPEC-050). 픽업 시각·퀵 여부(SPEC-054), 맞춤 재료 필요·변경됨 표시. 결제 전·취소된 주문은 없다.",
   params=[pday("2026-11-20", "볼 날")],
   ok=[(200, "ProductionDay", {"day": E.PRODUCTION_DAY, "empty": E.PRODUCTION_DAY_EMPTY})],
   errors={404: ["shop_not_registered"]},
   fields=[("path:day", "bad_format")],
   omit={"403": O403, "409": O409_READ},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:shop_not_registered"],
          "노출": ["closed"], "빈·끊김": ["example:empty"], "화면": ["screen"]})

op(id="API-052", method="post", path="/owner/orders/{orderId}/production-marks", op="markProduction", tag="제작",
   summary="맞춤 재료 주문·제작 시작·완성 표시", spec=["SPEC-051", "SPEC-053", "SPEC-066"], auth="owner", idem=True,
   desc="그 시각을 남긴다. 이 시각은 환불 계산의 근거다(SPEC-051). 완성에는 사진을 5장까지 붙일 수 있고, 완성 사진 보내기를 켠 가게면 픽업 전에 손님에게 한 번 보낸다(SPEC-053). "
        "이미 남긴 표시는 unchanged. 취소된 주문은 409 invalid_state.",
   params=[pid("orderId", "주문", E.ORDER_ID)],
   body="ProductionMarkInput",
   body_examples={"started": {"baseRevision": E.PRODUCTION["revision"], "mark": "production_started"},
                  "completed": {"baseRevision": E.PRODUCTION_STARTED["revision"], "mark": "completed",
                                "photoUploadIds": [E.UPLOAD_COMPLETION["uploadId"]]}},
   ok=[(200, "ProductionResult", {"started": {"outcome": "done", "production": E.PRODUCTION_STARTED, "completionPhotoNotice": None},
                                  "completed_sent": {"outcome": "done", "production": E.PRODUCTION_DONE, "completionPhotoNotice": "sent"},
                                  "unchanged": {"outcome": "unchanged", "production": E.PRODUCTION_STARTED, "completionPhotoNotice": None}})],
   errors={404: ["not_found"], 409: ["version_conflict", "invalid_state"]},
   fields=[("/photoUploadIds", "too_many")],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "상태": ["409:invalid_state", "example:unchanged"], "반복": ["idem"], "동시": ["revision", "409:version_conflict"],
          "바깥": ["note:손님 안내가 못 가면 다음 대화 때(SPEC-066)"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-053", method="post", path="/owner/orders/{orderId}/production-marks/undo", op="undoProductionMark", tag="제작",
   summary="잘못 누른 표시 되돌리기(5분 안)", spec=["SPEC-051"], auth="owner", idem=True,
   desc="표시한 뒤 5분 안에만 되돌리고 되돌린 기록을 남긴다. 5분이 지나면 409 undo_window_passed.",
   params=[pid("orderId", "주문", E.ORDER_ID)],
   body="ProductionUndoInput",
   body_examples={"undo": {"baseRevision": E.PRODUCTION_STARTED["revision"], "mark": "production_started"}},
   ok=[(200, "ProductionResult", {"undone": {"outcome": "done", "production": dict(E.PRODUCTION, revision=E.rev("production:K7Q3M9:undone")),
                                             "completionPhotoNotice": None}})],
   errors={404: ["not_found"], 409: ["version_conflict", "undo_window_passed", "invalid_state"]},
   fields=[("/mark", "not_allowed")],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "상태": ["409:undo_window_passed", "409:invalid_state"], "반복": ["idem"], "동시": ["revision", "409:version_conflict"],
          "노출": ["closed"], "화면": ["screen"]})

op(id="API-054", method="post", path="/owner/orders/{orderId}/handover", op="handOverOrder", tag="제작",
   summary="넘기기(픽업 완료됨·퀵으로 보냄)", spec=["SPEC-054", "SPEC-055", "SPEC-064", "SPEC-061"], auth="owner", idem=True,
   desc="넘긴 시각과 함께 받은 주문으로 두고 장부 줄에 적는다. 다음 날 후기 부탁이 걸린다(SPEC-061). 미수령 뒤 늦게 찾으러 와도 넘길 수 있다(SPEC-055). "
        "픽업 날짜 전이면 409 confirmation_required(not_pickup_day). 확정되지 않았거나 폐기한 주문은 409 invalid_state, 다른 방법으로 이미 넘겼으면 409 already_decided.",
   params=[pid("orderId", "주문", E.ORDER_ID)],
   body="HandoverInput",
   body_examples={"pickup": {"baseRevision": E.ORDER_CONFIRMED["revision"], "kind": "pickup"},
                  "early_courier": {"baseRevision": E.ORDER_CONFIRMED["revision"], "kind": "courier", "confirm": ["not_pickup_day"]}},
   ok=[(200, "OrderCommandResult", {"received": {"outcome": "done", "order": E.ORDER_RECEIVED, "paymentRequest": None},
                                    "unchanged": {"outcome": "unchanged", "order": E.ORDER_RECEIVED, "paymentRequest": None}})],
   errors={404: ["not_found"], 409: ["version_conflict", "invalid_state", "already_decided", "confirmation_required"]},
   fields=[("/kind", "not_allowed")],
   confirm=["not_pickup_day"],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "상태": ["409:invalid_state", "409:confirmation_required", "example:unchanged"], "반복": ["idem"],
          "동시": ["revision", "409:version_conflict"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-055", method="post", path="/owner/orders/{orderId}/no-pickup", op="markNoPickup", tag="제작",
   summary="미수령 표시", spec=["SPEC-055", "SPEC-064"], auth="owner", idem=True,
   desc="픽업 일시가 지난 확정 주문을 미수령으로 두고 장부 줄에 적는다. 픽업 일시 전이면 409 invalid_state.",
   params=[pid("orderId", "주문", E.ORDER_ID)],
   body="RevisionOnlyInput", body_examples={"no_pickup": {"baseRevision": E.ORDER_CONFIRMED["revision"]}},
   ok=[(200, "OrderCommandResult", {"no_pickup": {"outcome": "done", "order": dict(E.ORDER_CONFIRMED, status="no_pickup",
                                                                                     production=E.PRODUCTION_NO_PICKUP,
                                                                                     revision=E.rev("order:K7Q3M9:nopickup")),
                                                   "paymentRequest": None},
                                    "unchanged": {"outcome": "unchanged", "order": dict(E.ORDER_CONFIRMED, status="no_pickup",
                                                                                         production=E.PRODUCTION_NO_PICKUP,
                                                                                         revision=E.rev("order:K7Q3M9:nopickup")),
                                                  "paymentRequest": None}})],
   errors={404: ["not_found"], 409: ["version_conflict", "invalid_state"]},
   fields=[("/baseRevision", "required")],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "상태": ["409:invalid_state", "example:unchanged"], "반복": ["idem"], "동시": ["revision", "409:version_conflict"],
          "노출": ["closed"], "화면": ["screen"]})

op(id="API-056", method="post", path="/owner/orders/{orderId}/discard", op="discardOrder", tag="제작",
   summary="미수령 케이크 폐기", spec=["SPEC-055"], auth="owner", idem=True,
   desc="미수령 뒤에만 폐기 시각을 남긴다. 폐기한 주문은 넘길 수 없다. 미수령이 아니면 409 invalid_state.",
   params=[pid("orderId", "주문", E.ORDER_ID)],
   body="RevisionOnlyInput", body_examples={"discard": {"baseRevision": E.rev("order:K7Q3M9:nopickup")}},
   ok=[(200, "OrderCommandResult", {"discarded": {"outcome": "done", "order": dict(E.ORDER_CONFIRMED, status="no_pickup",
                                                                                     production=E.PRODUCTION_DISCARDED,
                                                                                     revision=E.rev("order:K7Q3M9:discarded")),
                                                   "paymentRequest": None}})],
   errors={404: ["not_found"], 409: ["version_conflict", "invalid_state"]},
   fields=[("/baseRevision", "required")],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "상태": ["409:invalid_state"], "반복": ["idem"], "동시": ["revision", "409:version_conflict"], "노출": ["closed"], "화면": ["screen"]})

# ═══ 결제 안내 ════════════════════════════════════════════════════════════════
op(id="API-057", method="get", path="/owner/payment-requests", op="listPaymentRequests", tag="결제 안내",
   summary="입금 대조 목록", spec=["SPEC-034", "SPEC-033", "SPEC-035", "SPEC-037"], auth="owner",
   desc="안내 금액·입금자 이름·결제 기한·확인 요청 여부. 입금자 이름은 사장님 화면에만, AI로 보내지 않는다.",
   params=[q("status", {"type": "string", "enum": ["open", "claimed", "mismatch", "paid", "expired", "closed"]}, "결제 안내 상태", "claimed"),
           CURSOR, LIMIT],
   ok=[(200, "PaymentRequestList", {"claimed": {"items": [E.PR_CLAIMED, E.PR_CUSTOM_OPEN], "nextCursor": None}, "empty": E.EMPTY_PAGE})],
   errors={404: ["shop_not_registered"]},
   fields=[("query:status", "not_allowed")],
   omit={"403": O403, "409": O409_READ},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:shop_not_registered"],
          "노출": ["closed"], "빈·끊김": ["example:empty"], "화면": ["screen"]})

op(id="API-058", method="get", path="/owner/payment-requests/{paymentRequestId}", op="getPaymentRequest", tag="결제 안내",
   summary="결제 안내 하나", spec=["SPEC-034", "SPEC-035"], auth="owner",
   desc="할 일(결제 확인 요청·맞추는 중)이 여는 입금 대조 화면.",
   params=[pid("paymentRequestId", "결제 안내", E.PR_CLAIMED["paymentRequestId"])],
   ok=[(200, "PaymentRequest", {"claimed": E.PR_CLAIMED, "mismatch": E.PR_MISMATCH, "expired": E.PR_EXPIRED})],
   errors={404: ["not_found"]},
   omit={"403": O403, "409": O409_READ, "422": O422_PATHONLY},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:not_found"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-059", method="post", path="/owner/payment-requests/{paymentRequestId}/reconciliation", op="reconcilePaymentRequest", tag="결제 안내",
   summary="입금 대조(들어옴·안 들어옴·다르게 들어옴·맞춰짐)", spec=["SPEC-034", "SPEC-035", "SPEC-036", "SPEC-045", "SPEC-015", "SPEC-064"],
   auth="owner", idem=True,
   desc="들어옴이면 결제 확인됨(결제 안내 하나에 하나)을 남기고 첫 결제·다시 낸 결제는 주문을 확정하고(SPEC-036), 차액 결제는 변경을 반영한다(SPEC-045). "
        "다르게 들어옴이면 '맞추는 중'으로 두고 결제 기한을 멈추고 자리를 지킨다(SPEC-035). 맞춰짐이면 확정. 안 들어옴이면 확인 요청을 지운다. "
        "그 사이 주문이 취소됐으면 확정하지 않고 outcome paid_after_cancel과 환불 정할 일(SPEC-036). "
        "기한이 지나 자리가 풀린 결제 안내의 들어옴은 409 slot_released(먼저 더 기다리기, R14). 같은 결과를 다시 누르면 unchanged, 다른 결과가 이미 남았으면 409 already_decided. "
        "확인과 기한 처리가 겹치면 확인이 이긴다.",
   params=[pid("paymentRequestId", "결제 안내", E.PR_CLAIMED["paymentRequestId"])],
   body="ReconciliationInput",
   body_examples={"received": {"baseRevision": E.PR_CLAIMED["revision"], "result": "received"},
                  "mismatch": {"baseRevision": E.PR_CLAIMED["revision"], "result": "mismatch", "mismatchAmount": 31000},
                  "resolved": {"baseRevision": E.PR_MISMATCH["revision"], "result": "resolved", "resolution": "shortfall_paid"}},
   ok=[(200, "ReconciliationResult", {
       "confirmed": {"outcome": "done", "paymentRequest": E.PR_FIRST_PAID, "payment": E.PAYMENT, "order": E.ORDER_CONFIRMED, "changeRequest": None},
       "mismatch": {"outcome": "done", "paymentRequest": E.PR_MISMATCH, "payment": None, "order": E.ORDER_AWAITING, "changeRequest": None},
       "difference_applied": {"outcome": "done", "paymentRequest": dict(E.PR_DIFFERENCE, status="paid", paidAt=E.t("11-15", "12:00"),
                                                                      revision=E.rev("pr:diff:paid")),
                              "payment": dict(E.PAYMENT, paymentId=E.uid("payment:K7Q3M9:diff"), paymentRequestId=E.PR_DIFFERENCE["paymentRequestId"],
                                              amount=20000, confirmedAt=E.t("11-15", "12:00")),
                              "order": E.ORDER_CHANGED, "changeRequest": dict(E.CHANGE_AWAITING, status="applied", appliedVersion=2,
                                                                               appliedAt=E.t("11-15", "12:00"), orderVersion=2,
                                                                               revision=E.rev("change:2:applied"))},
       "paid_after_cancel": {"outcome": "paid_after_cancel", "paymentRequest": dict(E.PR_CLAIMED, status="closed", closedAt=E.t("11-14", "09:00"),
                                                                                    closeReason="order_cancelled", revision=E.rev("pr:closed")),
                             "payment": None, "order": E.ORDER_CANCELLED_BY_CUSTOMER, "changeRequest": None},
       "unchanged": {"outcome": "unchanged", "paymentRequest": E.PR_FIRST_PAID, "payment": E.PAYMENT, "order": E.ORDER_CONFIRMED, "changeRequest": None}})],
   errors={404: ["not_found"], 409: ["version_conflict", "slot_released", "already_decided", "invalid_state"]},
   fields=[("/mismatchAmount", "out_of_range")],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "상태": ["409:slot_released", "409:already_decided", "example:paid_after_cancel"], "반복": ["idem", "example:unchanged"],
          "동시": ["revision", "409:version_conflict", "note:확인이 기한 처리를 이김(SPEC-034)"], "노출": ["closed"], "화면": ["screen"]})

# ═══ 환불 ═════════════════════════════════════════════════════════════════════
op(id="API-060", method="get", path="/owner/refunds/{refundId}", op="getRefund", tag="환불",
   summary="환불 하나(손님 환불 계좌 포함)", spec=["SPEC-047", "SPEC-049", "SPEC-021"], auth="owner",
   desc="정한 환불과 근거. 손님이 상담에서 알려 준 환불 계좌(SPEC-049)는 원래 값으로 이 화면에만 보인다(R19, DEC-19).",
   params=[pid("refundId", "환불", E.REFUND["refundId"])],
   ok=[(200, "Refund", {"decided": E.REFUND, "with_account": E.REFUND_WITH_ACCOUNT, "sent": E.REFUND_SENT})],
   errors={404: ["not_found"]},
   omit={"403": O403, "409": O409_READ, "422": O422_PATHONLY},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:not_found"],
          "노출": ["closed", "note:손님 계좌는 이 화면에만(R19)"], "화면": ["screen"]})

op(id="API-061", method="post", path="/owner/refunds/{refundId}/sent", op="markRefundSent", tag="환불",
   summary="환불 '보냄' 표시", spec=["SPEC-047", "SPEC-049"], auth="owner", idem=True,
   desc="사장님이 가게 계좌에서 돌려보내거나 카드 결제를 취소한 뒤 표시한다. 계좌로 보냈으면 그 계좌(손님이 말한 값을 고쳤으면 고친 값)를 남긴다. "
        "환불 없이 취소한 줄은 409 invalid_state. 이미 표시했으면 unchanged.",
   params=[pid("refundId", "환불", E.REFUND["refundId"])],
   body="RefundSentInput",
   body_examples={"bank_transfer": {"baseRevision": E.REFUND_WITH_ACCOUNT["revision"], "method": "bank_transfer",
                                    "refundAccount": {"bankName": "하늘은행", "accountNumber": "110-123-456789", "holderName": "이지우"}},
                  "card_cancel": {"baseRevision": E.REFUND["revision"], "method": "card_cancel", "refundAccount": None}},
   ok=[(200, "RefundResult", {"sent": {"outcome": "done", "refund": E.REFUND_SENT, "customerNotice": "none"},
                              "unchanged": {"outcome": "unchanged", "refund": E.REFUND_SENT, "customerNotice": "none"}})],
   errors={404: ["not_found"], 409: ["version_conflict", "invalid_state"]},
   fields=[("/refundAccount/accountNumber", "bad_format")],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "상태": ["409:invalid_state", "example:unchanged"], "반복": ["idem"], "동시": ["revision", "409:version_conflict"],
          "노출": ["closed"], "화면": ["screen"]})

# ═══ 변경 요청 ════════════════════════════════════════════════════════════════
op(id="API-062", method="get", path="/owner/change-requests/{changeRequestId}", op="getChangeRequest", tag="변경 요청",
   summary="변경 요청 하나", spec=["SPEC-042", "SPEC-041", "SPEC-043", "SPEC-044"], auth="owner",
   desc="바꾸려는 내용, 묶인 주문 판과 지금 판, 변경 마감 시각, 새 날을 사장님이 정해야 하는지, 차액 결제. 차액 결제 기한이 지나면 서버가 '차액 없어 닫힘'으로 둔다(SPEC-044).",
   params=[pid("changeRequestId", "변경 요청", E.CHANGE["changeRequestId"])],
   ok=[(200, "ChangeRequest", {"requested": E.CHANGE, "awaiting_difference": E.CHANGE_AWAITING, "closed_no_difference": E.CHANGE_CLOSED})],
   errors={404: ["not_found"]},
   omit={"403": O403, "409": O409_READ, "422": O422_PATHONLY},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:not_found"], "상태": ["example:closed_no_difference"],
          "노출": ["closed"], "화면": ["screen"]})

op(id="API-063", method="post", path="/owner/change-requests/{changeRequestId}/decision", op="decideChangeRequest", tag="변경 요청",
   summary="변경 요청에 답하기(받아들임·거절)", spec=["SPEC-042", "SPEC-043", "SPEC-045", "SPEC-015", "SPEC-032"], auth="owner", idem=True,
   desc="금액이 그대로거나 내려가면 바로 반영해 주문 판을 하나 올린다(SPEC-045, 내려가면 환불 정할 일). 오르면 차액 결제 안내를 내고(SPEC-043) 확인되면 반영한다. "
        "날짜가 바뀌면 옛 날 자리를 풀고 새 날에 확정 자리를 잡는다(결제 안내 없음). 새 날이 다 찼으면 409 confirmation_required(overbooking). "
        "거절이면 주문은 그대로이고 손님에게 알린다. 그 사이 손님이 취소했으면 409 order_cancelled, 옛 판을 보고 만든 변경이면 409 stale_change, 이미 답했으면 409 already_decided.",
   params=[pid("changeRequestId", "변경 요청", E.CHANGE["changeRequestId"])],
   body="ChangeDecisionInput",
   body_examples={"accept_same": {"baseRevision": E.CHANGE["revision"], "decision": "accept", "amountDelta": 0},
                  "accept_more": {"baseRevision": E.CHANGE_TWO_TIER["revision"], "decision": "accept", "amountDelta": 20000},
                  "reject": {"baseRevision": E.CHANGE_TWO_TIER["revision"], "decision": "reject", "rejectReason": "2단은 사흘 전까지만 받아요"}},
   ok=[(200, "ChangeDecisionResult", {"applied": {"outcome": "done", "changeRequest": E.CHANGE_APPLIED, "order": E.ORDER_CHANGED, "paymentRequest": None},
                                      "awaiting_difference": {"outcome": "done", "changeRequest": E.CHANGE_AWAITING, "order": E.ORDER_CONFIRMED,
                                                              "paymentRequest": E.PR_DIFFERENCE},
                                      "rejected": {"outcome": "done", "changeRequest": E.CHANGE_REJECTED, "order": E.ORDER_CONFIRMED, "paymentRequest": None}})],
   errors={404: ["not_found"], 409: ["version_conflict", "already_decided", "order_cancelled", "stale_change", "confirmation_required"]},
   fields=[("/amountDelta", "out_of_range")],
   confirm=["overbooking"],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "상태": ["409:order_cancelled", "409:already_decided", "409:confirmation_required"], "반복": ["idem"],
          "동시": ["revision", "409:version_conflict", "409:stale_change"], "노출": ["closed"], "화면": ["screen"]})

# ═══ 문제 신고 ════════════════════════════════════════════════════════════════
op(id="API-064", method="get", path="/owner/issue-reports/{issueReportId}", op="getIssueReport", tag="문제 신고",
   summary="문제 신고 하나", spec=["SPEC-058", "SPEC-059", "SPEC-057"], auth="owner",
   desc="신고 사진·설명·주문 내용 판·결제 금액, 기한 뒤인지, 먹고 아프다는 말인지, 같은 주문의 뒤 신고.",
   params=[pid("issueReportId", "문제 신고", E.ISSUE["issueReportId"])],
   ok=[(200, "IssueReport", {"reported": E.ISSUE, "remake_decided": E.ISSUE_REMAKE})],
   errors={404: ["not_found"]},
   omit={"403": O403, "409": O409_READ, "422": O422_PATHONLY},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:not_found"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-065", method="post", path="/owner/issue-reports/{issueReportId}/compensation", op="decideCompensation", tag="문제 신고",
   summary="보상 정하기(다시 만들기·일부 환불·전액 환불·없음)", spec=["SPEC-059", "SPEC-060", "SPEC-047", "SPEC-015"], auth="owner", idem=True,
   desc="보상은 사장님만 정한다(AI·손님에게 길이 없음). 다시 만들기면 새 픽업 일시(지금 뒤 60일 안)로 결제 없는 다시 만들기 주문을 확정으로 남기고 자리를 잡는다(SPEC-060, 다 찬 날이면 넘겨 잡음). "
        "휴무일이면 409 confirmation_required(closed_day). 환불이면 환불 정하기와 같은 한도로 환불을 남긴다(SPEC-047). 손님에게 보상 안내를 한 번 보내고 신고를 닫는다. "
        "이미 정한 보상은 고치지 않는다(409 already_decided).",
   params=[pid("issueReportId", "문제 신고", E.ISSUE["issueReportId"])],
   body="CompensationInput",
   body_examples={"remake": {"baseRevision": E.ISSUE["revision"], "compensation": "remake", "remakePickupAt": E.t("11-25", "15:00")},
                  "partial_refund": {"baseRevision": E.ISSUE["revision"], "compensation": "partial_refund", "refundAmount": 20000},
                  "none": {"baseRevision": E.ISSUE["revision"], "compensation": "none"}},
   ok=[(200, "CompensationResult", {"remake": {"outcome": "done", "issueReport": E.ISSUE_REMAKE, "remakeOrder": E.ORDER_REMAKE, "refund": None},
                                    "partial_refund": {"outcome": "done", "issueReport": E.ISSUE_PARTIAL, "remakeOrder": None, "refund": E.REFUND_COMP}})],
   errors={404: ["not_found"], 409: ["version_conflict", "already_decided", "confirmation_required"]},
   fields=[("/remakePickupAt", "outside_window"), ("/refundAmount", "exceeds_received")],
   confirm=["closed_day"],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated", "note:AI·손님은 보상을 정할 수 없음(AI 도구에 없음)"], "입력": ["422:validation_failed"],
          "대상": ["404:not_found"], "상태": ["409:already_decided", "409:confirmation_required"], "반복": ["idem"],
          "동시": ["revision", "409:version_conflict"], "노출": ["closed"], "화면": ["screen"]})

# ═══ 후기와 포트폴리오 ════════════════════════════════════════════════════════
op(id="API-066", method="get", path="/owner/reviews", op="listReviews", tag="후기·포트폴리오",
   summary="후기와 사진 게시 동의", spec=["SPEC-062", "SPEC-063"], auth="owner",
   desc="후기마다 지금 판의 글과 사진, 사진마다 게시 동의 상태와 포트폴리오에 올렸는지.",
   params=[CURSOR, LIMIT],
   ok=[(200, "ReviewList", {"reviews": E.REVIEWS, "empty": E.EMPTY_PAGE})],
   errors={404: ["shop_not_registered"]},
   fields=[("query:limit", "out_of_range")],
   omit={"403": O403, "409": O409_READ},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:shop_not_registered"],
          "노출": ["closed"], "빈·끊김": ["example:empty"], "화면": ["screen"]})

op(id="API-067", method="get", path="/owner/portfolio", op="getPortfolio", tag="후기·포트폴리오",
   summary="포트폴리오와 올릴 수 있는 사진", spec=["SPEC-063"], auth="owner",
   desc="올린 사진과, 올릴 수 있는지 보이는 후보(게시 동의한 사진만 올릴 수 있음).",
   ok=[(200, "Portfolio", {"portfolio": E.PORTFOLIO, "empty": {"items": [], "candidates": []}})],
   errors={404: ["shop_not_registered"]},
   omit={"403": O403, "409": O409_READ, "422": O422_NOINPUT},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:shop_not_registered"], "노출": ["closed"],
          "빈·끊김": ["example:empty"], "화면": ["screen"]})

op(id="API-068", method="post", path="/owner/portfolio/items", op="addPortfolioItem", tag="후기·포트폴리오",
   summary="포트폴리오에 올리기", spec=["SPEC-063"], auth="owner", idem=True,
   desc="게시 동의한 사진만 올린다. 동의하지 않았거나 거둔 사진은 409 photo_consent_missing. 이미 올렸으면 200 unchanged. 사진이 없거나 다른 가게 것이면 404.",
   body="PortfolioInput", body_examples={"add": {"source": "review_photo", "photoId": E.REVIEW_PHOTO_1}},
   ok=[(201, "PortfolioResult", {"added": {"outcome": "done", "item": E.PORTFOLIO_ITEM}}),
       (200, "PortfolioResult", {"unchanged": {"outcome": "unchanged", "item": E.PORTFOLIO_ITEM}})],
   errors={404: ["not_found"], 409: ["photo_consent_missing"]},
   fields=[("/photoId", "required")],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "상태": ["409:photo_consent_missing", "example:unchanged"], "반복": ["idem"],
          "동시": ["409:photo_consent_missing", "note:그 사이 손님이 동의를 거두면 거절"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-069", method="delete", path="/owner/portfolio/items/{portfolioItemId}", op="removePortfolioItem", tag="후기·포트폴리오",
   summary="포트폴리오에서 내리기", spec=["SPEC-063"], auth="owner", idem=True,
   desc="내린 사진은 예약 링크 페이지에서 5분 안에 사라진다. 이미 내렸으면 unchanged.",
   params=[pid("portfolioItemId", "포트폴리오 항목", E.PORTFOLIO_ITEM["portfolioItemId"])],
   ok=[(200, "PortfolioResult", {"removed": {"outcome": "done", "item": E.PORTFOLIO_ITEM},
                                 "unchanged": {"outcome": "unchanged", "item": E.PORTFOLIO_ITEM}})],
   errors={404: ["not_found"]},
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed", "note:본문이 없고 요청 키 헤더만 받음"],
          "대상": ["404:not_found"], "반복": ["idem", "example:unchanged"],
          "노출": ["closed", "note:예약 링크 페이지에서 5분 안에 사라짐"], "화면": ["screen"]})

# ═══ 카카오 스킬 ══════════════════════════════════════════════════════════════
MESSAGE_OUTCOMES = ["answered", "callback_pending", "handed_over", "ai_unavailable", "ai_timeout", "ai_key_missing", "ai_limit_reached",
                    "ai_cost_limit_reached", "masking_failed", "ai_output_rejected", "card_shown", "photo_received", "photo_rejected",
                    "unsupported_message", "rate_limited", "duplicate", "not_accepting", "channel_linked", "server_error"]
CARD_OUTCOMES = ["order_requested", "payment_claimed", "change_requested", "order_cancelled", "issue_reported", "consent_withdrawn",
                 "declined", "card_stale", "card_expired", "card_not_yours", "card_used", "day_full", "retry_needed", "not_allowed_now",
                 "not_accepting", "server_error"]
REVIEW_OUTCOMES = ["review_saved", "review_not_allowed", "review_invalid", "photo_download_failed", "duplicate", "not_accepting", "server_error"]

op(id="API-070", method="post", path="/kakao/skills/message", op="receiveCustomerMessage", tag="카카오 스킬",
   summary="손님 메시지 받기(카카오 오픈빌더 스킬)", auth="skill", callbacks=True, outcomes=MESSAGE_OUTCOMES, ai="AI-1",
   spec=["SPEC-017", "SPEC-018", "SPEC-019", "SPEC-020", "SPEC-021", "SPEC-022", "SPEC-025", "SPEC-026", "SPEC-027", "SPEC-028",
         "SPEC-033", "SPEC-040", "SPEC-041", "SPEC-046", "SPEC-049", "SPEC-056", "SPEC-057", "SPEC-066", "SPEC-068", "SPEC-069",
         "SPEC-013", "SPEC-014", "SPEC-016", "SPEC-008"],
   desc="카카오가 손님 메시지를 보내는 스킬. bot.id로 가게를 찾고(SPEC-017) 그 가게 상담(사용자 키마다 하나)을 열거나 잇는다. 헤더 Siljang-Skill-Key가 그 연결의 키가 아니면 401(DEC-08). "
        "처리한 모든 경우에 200과 스킬 응답을 돌려주고 결과는 Siljang-Outcome 헤더와 같은 이름의 예시로 구분한다(DEC-07). "
        "답이 4초 안에 준비되면 바로 답하고(answered), 아니면 useCallback으로 응답한 뒤(callback_pending) AI-1 답을 콜백으로 보낸다(콜백 본문의 결과도 같은 이름으로 로그에 남김). "
        "콜백 기한(유효 시간 - 5초)까지 답이 없으면 넘기고(ai_timeout) 그 안내를 콜백으로 보낸다. 콜백이 켜지지 않은 요청(callbackUrl 없음)은 4초 안에 답이 없으면 그 자리에서 넘김 안내로 답한다(ai_timeout). AI 모델 실패·키 없음·사용 한도·가게 비용 한도는 모두 넘김(R7). "
        "첫 메시지에 답하기 전에 AI 상담 고지와 처리방침 주소를 먼저 싣고(SPEC-018), 친구가 아닌 손님에게 못 보낸 안내가 있으면 답보다 먼저 싣는다(SPEC-066). "
        "연결 확인 중인 채널의 시험 메시지면 채널을 가게에 묶는다(channel_linked, SPEC-008). "
        "Open: 카카오 메시지 ID가 문서에 없어 같은 요청 거르기 키를 (봇 ID, 사용자 키, 블록 ID, 발화, 받은 시각 2초 단위)의 해시로 둠. 개발 전 실제 요청으로 확인(OPEN-1). "
        "Open: 콜백 유효 시간이 문서 안에서 5분과 1분으로 어긋남. 개발 전 시험으로 정함(OPEN-2). "
        "Open: 사진 메시지가 스킬 요청에 어떻게 오는지 문서에 없음(OPEN-3). "
        "Open: 빈 응답이 되는지 문서에 없어, 같은 메시지 반복과 한도 넘은 메시지에도 짧은 말을 다시 보냄(OPEN-4).",
   body="SkillPayload", body_examples={"message": E.SKILL_MESSAGE, "allergy_question": E.SKILL_MESSAGE_ALLERGY},
   ok=[(200, "SkillResponse", {k: E.SKILL_OUTCOME_EXAMPLES[k] for k in MESSAGE_OUTCOMES}, ["Siljang-Outcome"])],
   errors={401: ["skill_key_invalid"]},
   fields=[("/userRequest", "required")],
   omit=dict(SKILL_OMIT, **{"429": "손님 메시지 한도는 결과 rate_limited(DEC-07, DEC-16)"}),
   kinds={"접근": ["security", "401:skill_key_invalid", "note:그 가게 상담·주문만 읽고 씀(REQ-134)"],
          "입력": ["422:validation_failed", "outcome:unsupported_message", "outcome:photo_rejected"],
          "대상": ["outcome:not_accepting"], "상태": ["outcome:handed_over", "outcome:card_shown"], "반복": ["outcome:duplicate"],
          "동시": ["outcome:answered", "note:답을 만드는 동안 온 메시지는 다음 차례에 한꺼번에(3-3)"],
          "한도": ["outcome:rate_limited", "outcome:ai_cost_limit_reached", "outcome:photo_rejected"],
          "바깥": ["outcome:ai_unavailable", "outcome:ai_timeout", "outcome:ai_key_missing", "outcome:ai_limit_reached", "callback"],
          "노출": ["closed", "outcome:server_error"], "빈·끊김": ["outcome:callback_pending", "note:빈 AI 답은 다시 묻고 두 번이면 넘김(SPEC-020)"],
          "AI": ["outcome:ai_output_rejected", "outcome:handed_over", "outcome:masking_failed"], "화면": ["screen"]})

op(id="API-071", method="post", path="/kakao/skills/card", op="pressConfirmCard", tag="카카오 스킬",
   summary="손님 확인 카드 버튼(카카오 오픈빌더 스킬)", auth="skill", outcomes=CARD_OUTCOMES,
   spec=["SPEC-069", "SPEC-029", "SPEC-030", "SPEC-033", "SPEC-041", "SPEC-046", "SPEC-058", "SPEC-063", "SPEC-015", "SPEC-032", "SPEC-040"],
   desc="확인 카드의 블록 버튼이 clientExtra(cardKey, choice)로 보내는 스킬. 서버는 카드 키로 저장된 카드를 찾고 그 사용자·그 주문의 지금 판·30분 기한을 다시 본다(G9). "
        "주문 요청이면 한 거래로 내용 확인·규정 동의·사진 게시 동의·주문 요청을 남기고, 기본 디자인이면 같은 거래에서 자리를 잡고 결제 안내까지(SPEC-029, SPEC-030). "
        "입금 알리기·변경 요청·취소·신고·동의 거두기도 같은 방법. 카드를 받은 사용자가 아니면 card_not_yours, 판이 바뀌었으면 card_stale과 새 카드, 기한이 지났으면 card_expired와 새 카드. "
        "같은 카드를 다시 누르면 card_used와 처음 결과(G2). 아무것도 남기지 못하면 retry_needed. 카드 값은 서버 기록에서만 오고 손님 말로 바꿀 수 없다(SPEC-069).",
   body="SkillPayload", body_examples={"order_request": E.SKILL_CARD},
   ok=[(200, "SkillTemplateResponse", {k: E.SKILL_OUTCOME_EXAMPLES[k] for k in CARD_OUTCOMES}, ["Siljang-Outcome"])],
   errors={401: ["skill_key_invalid"]},
   fields=[("/action/clientExtra/cardKey", "required")],
   omit=dict(SKILL_OMIT, **{"429": "카드는 한 번만 명령을 내려 빈도 한도가 없음"}),
   kinds={"접근": ["security", "401:skill_key_invalid", "outcome:card_not_yours"], "입력": ["422:validation_failed"],
          "대상": ["outcome:not_allowed_now"], "상태": ["outcome:card_stale", "outcome:card_expired", "outcome:not_allowed_now"],
          "반복": ["outcome:card_used"], "동시": ["outcome:day_full", "outcome:card_stale"], "바깥": ["outcome:retry_needed"],
          "노출": ["closed", "outcome:server_error"],
          "AI": ["outcome:card_not_yours", "outcome:card_stale", "outcome:card_expired", "note:AI가 제안한 카드의 값은 서버 기록에서만 옴(SPEC-069)"],
          "화면": ["screen"]})

op(id="API-072", method="post", path="/kakao/skills/review", op="submitReview", tag="카카오 스킬",
   summary="후기 받기(카카오 오픈빌더 스킬)", auth="skill", outcomes=REVIEW_OUTCOMES,
   spec=["SPEC-062", "SPEC-019", "SPEC-061"],
   desc="후기 부탁 안내(SPEC-061)의 버튼이 여는 오픈빌더 '후기' 블록이 보내는 스킬(DEC-18). action.params의 review_text(1~1,000자), "
        "review_photos(보안 이미지 플러그인 값: privacyAgreement·imageQuantity·secureUrls·expire, 5장까지), photo_consent(게시 동의, 기본 동의 안 함)와 clientExtra.orderNo. "
        "받은 주문이고 그 주문을 요청한 사용자일 때만 남긴다. 사진은 서명 주소가 사는 10분 안에 내려받고 한 번 다시 받아도 실패하면 photo_download_failed. 같은 주문의 두 번째 후기는 새 판.",
   body="SkillPayload", body_examples={"review": E.SKILL_REVIEW},
   ok=[(200, "SkillTemplateResponse", dict({k: E.SKILL_OUTCOME_EXAMPLES[k] for k in REVIEW_OUTCOMES},
                                          duplicate=E.SKILL_OUTCOME_EXAMPLES["review_saved"]), ["Siljang-Outcome"])],
   errors={401: ["skill_key_invalid"]},
   fields=[("/action/params", "required")],
   omit=dict(SKILL_OMIT, **{"429": "후기는 주문마다 받아 빈도 한도가 없음"}),
   kinds={"접근": ["security", "401:skill_key_invalid", "outcome:review_not_allowed"], "입력": ["422:validation_failed", "outcome:review_invalid"],
          "대상": ["outcome:review_not_allowed"], "반복": ["outcome:duplicate", "note:같은 주문의 두 번째 후기는 새 판"],
          "한도": ["outcome:review_invalid"], "바깥": ["outcome:photo_download_failed"], "노출": ["closed", "outcome:server_error"],
          "화면": ["screen"]})
