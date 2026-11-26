"""06단계 API 계약의 API 83개(API-001~083). build_api.py가 OpenAPI paths로 바꾼다.

API마다 적는 것
- id·method·path·op(operationId)·tag·summary·desc·spec(SPEC ID)
- auth: owner·operator(로그인 필요), owner?·operator?(있으면 씀), skill(카카오 스킬 키), public(누구나)
- params: 경로·쿼리 매개변수. idem=True면 Idempotency-Key 헤더(DEC-04)
- body·body_examples: 요청 본문 스키마와 예시
- ok: [(상태, 스키마, {예시 이름: 값}, 헤더들)]
- errors: {상태: [오류 코드]}. 401 unauthenticated, 422 validation_failed, default internal 등은 build_api.py가 규칙대로 더함
- fields: validation_failed 예시의 필드 오류. confirm: confirmation_required 예시의 확인할 것
- omit: 응답 목록(2xx·401·403·404·409·422·default) 가운데 이 API가 반환하지 않는 것과 그 사유
- outcomes: 카카오 스킬의 결과 코드(200 예시 이름 = Siljang-Outcome 헤더 값, DEC-07)
- kinds: 케이스 유형마다 그 경우를 보여 주는 증거. 'NNN', 'NNN:코드', 'outcome:코드', 'example:이름', 'idem', 'revision',
  'closed'(응답 스키마가 닫힘), 'security', 'callback', 'screen'(08단계), 'note:…'(말로만 적은 근거)
"""
import api_examples as E

O403 = "역할마다 세션 쿠키와 경로가 나뉘고(DEC-10, DEC-11), 다른 가게 기록은 404로 숨김(DEC-02)"
O403_OPERATOR = "운영자 계정은 모두 같은 권한(첫 버전)"
O404_NOPATH = "경로에 기록 ID가 없음"
O409_READ = "읽기만 함"
O422_NOINPUT = "받는 입력이 없음"
O422_PATHONLY = "경로 ID 밖 입력이 없고, 형식이 틀린 ID도 404(DEC-02)"
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
                description=f"{what} ID(uuid). 없거나 다른 가게 것이거나 형식이 틀리면 404(DEC-02)")


def pday(example, what):
    return dict(name="day", **{"in": "path"}, required=True, example=example, schema={"type": "string", "format": "date"},
                description=f"{what}(가게 시간대의 날짜, DEC-15). 형식이 틀리면 422")


def q(name, schema, desc, example=None, required=False):
    d = dict(name=name, **{"in": "query"}, required=required, schema=schema, description=desc)
    if example is not None:
        d["example"] = example
    return d


PVERSION = dict(name="version", **{"in": "path"}, required=True, example="3",
                schema={"type": "string", "minLength": 1, "maxLength": 20},
                description="버전(1부터의 정수). 없는 버전이거나 형식이 틀리면 404(DEC-02)")
PSLUG = dict(name="slug", **{"in": "path"}, required=True, example="moonlight-cake",
             schema={"type": "string", "minLength": 1, "maxLength": 100},
             description="예약 링크 주소의 가게 몫(shops.booking_slug). 없거나 발급 전이거나 형식이 틀리면 404(DEC-02)")
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
    kw.setdefault("multi_day_confirm", False)
    kw.setdefault("outcomes", [])
    kw.setdefault("body", None)
    kw.setdefault("body_type", "json")
    kw.setdefault("body_examples", {})
    kw.setdefault("callbacks", False)
    kw.setdefault("ai", None)
    OPS.append(kw)


# ═══ 로그인 ═══════════════════════════════════════════════════════════════════
op(id="API-078", method="post", path="/owner/session/authorization", op="startOwnerLogin", tag="로그인",
   summary="사장님 로그인 시작(state)", spec=["SPEC-001"], auth="public",
   desc="카카오 로그인 버튼을 누르면 화면이 이 API를 부르고 응답의 authorizationUrl로 이동한다. 서버는 일회용 nonce를 로그인 시작 쿠키 `siljang_login`(HttpOnly·Secure·SameSite=Lax, 10분)에 두고, "
        "nonce와 만료 시각을 서버 시크릿으로 서명한 state와 nonce로 만든 PKCE code_verifier의 S256 code_challenge를 카카오 인가 주소에 담는다. nonce·state·code_verifier는 저장하지 않는다(DEC-10). "
        "MVP의 로그인 동의 항목 설정은 기본 빈 값이라 scope를 생략하며 plusfriends를 요청하지 않는다(DEC-21). "
        "카카오가 redirectUri로 돌려준 code와 state는 API-001이 받아, state가 서명·10분·쿠키의 nonce와 맞을 때만 카카오를 호출한다(RFC 6749 10.12, SPEC-001, 설계 재검토 RD-11). "
        "redirectUri는 서버 설정의 목록에 있는 것만 받는다(아니면 422 /redirectUri not_allowed). 부를 때마다 새 nonce와 state라 앞의 로그인 시작은 쓸 수 없게 된다. "
        "K-11 개발 채널은 S256의 올바른 verifier를 수락하고 틀린 verifier를 invalid_grant로 거절했다. 제품은 state와 PKCE S256을 함께 사용한다(DEC-10).",
   body="OwnerLoginStartInput", body_examples={"start": {"redirectUri": "https://siljang.example/owner/login/callback"}},
   ok=[(200, "OwnerLoginStart", {"started": E.OWNER_LOGIN_START}, ["Set-Cookie"])],
   errors={429: ["rate_limited"]},
   fields=[("/redirectUri", "not_allowed")],
   omit={"401": O401_PUBLIC, "403": "누구나 로그인을 시작함", "404": O404_NOPATH, "409": "부를 때마다 새 nonce와 state(충돌할 상태가 없음)"},
   kinds={"접근": ["note:state와 로그인 시작 쿠키로 다른 사람이 시작한 로그인 응답을 받지 않음(DEC-10)"], "입력": ["422:validation_failed"],
          "한도": ["429:rate_limited"], "반복": ["note:부를 때마다 새 state, 앞의 것은 쿠키와 맞지 않아 쓸 수 없음"],
          "노출": ["closed", "note:nonce·code_verifier는 응답에 없고 nonce는 HttpOnly 쿠키에만"], "화면": ["screen"]})

op(id="API-001", method="post", path="/owner/session", op="createOwnerSession", tag="로그인",
   summary="사장님 로그인(카카오 인가 코드)", spec=["SPEC-001", "SPEC-068"], auth="public",
   desc="카카오 로그인 화면이 redirectUri로 준 인가 코드와 state를 받는다. state가 로그인 시작(API-078)의 서명·10분과 로그인 시작 쿠키 `siljang_login`의 nonce에 맞을 때만 카카오를 호출하고, "
        "아니면 카카오를 호출하지 않고 401 kakao_login_failed(DEC-10, 설계 재검토 RD-11). 서버가 인가 코드를 nonce로 다시 만든 PKCE code_verifier와 함께 카카오 토큰으로 바꿔 "
        "카카오 로그인 사용자 번호만 남기고 토큰은 버린다(DEC-10, REQ-135). "
        "MVP 기본 설정은 plusfriends를 요청하지 않고 채널 관계 조회와 친구 여부 기록을 하지 않는다. 사장님 카카오 알림은 출시 검토로 미룸(동희님 2026-11-22 15:57 결정 카드, DEC-21). "
        "로그인 동의 항목 설정에 plusfriends를 명시해 켠 경우에만 토큰을 버리기 전에 카카오톡 채널 관계 조회(`GET https://kapi.kakao.com/v2/api/talk/channels`)를 한 번 해 "
        "사장님이 우리 서비스 채널 친구인지 남긴다(alertChannelFriend). 이 경우에도 동의하지 않았거나 조회가 실패하면 로그인은 막지 않고 친구 여부를 바꾸지 않는다. "
        "사장님 알림은 이 사용자 번호(appUserId)로 간다(DEC-21, REQ-260). "
        "세션은 HttpOnly·Secure·SameSite=Lax 쿠키 `siljang_owner`이고, 로그인 시작 쿠키는 지운다. `next`가 화면이 열 곳(가게 등록·신고증 다시 올리기·할 일 목록). "
        "카카오 로그인이 실패하거나 동의를 거부하면 우리 쪽 기록을 남기지 않음. "
        "세션은 마지막으로 쓴 때부터 30일 동안 유지하고 쓸 때마다 다시 30일로 늘린다(DEC-26). "
        "카카오는 S256 verifier를 검사한다. PKCE 없는 시험 인가는 수락됐어도 제품 로그인은 S256을 사용한다(DEC-10, K-11).",
   body="OwnerSessionInput",
   body_examples={"kakao_code": {"kakaoCode": "kc_" + E.h("kakao-code", 40), "redirectUri": "https://siljang.example/owner/login/callback",
                                  "state": E.LOGIN_STATE}},
   ok=[(200, "OwnerSessionResult", {
       "new_owner": {"owner": dict(E.OWNER, alertChannelFriend=False), "shop": None, "next": "register_shop"},
       "returning_owner": {"owner": E.OWNER, "shop": E.SHOP_SUMMARY, "next": "open_tasks"},
       "license_on_hold": {"owner": E.OWNER, "shop": dict(E.SHOP_SUMMARY, licenseStatus="on_hold"), "next": "resubmit_license"},
   }, ["Set-Cookie"])],
   errors={401: ["kakao_login_failed"], 429: ["rate_limited"], 503: ["kakao_unavailable"]},
   fields=[("/kakaoCode", "required"), ("/state", "required")],
   omit={"403": "누구나 로그인을 시도함", "404": O404_NOPATH,
         "409": "같은 카카오 계정이 동시에 들어와도 카카오 로그인 사용자 번호로 사장님 행은 하나(충돌할 상태가 없음)"},
   kinds={"접근": ["401:kakao_login_failed", "note:state가 서명·10분·로그인 시작 쿠키와 맞지 않으면 카카오를 호출하지 않음(DEC-10)"], "입력": ["422:validation_failed"], "상태": ["example:license_on_hold"],
          "외부": ["401:kakao_login_failed", "503:kakao_unavailable"], "한도": ["429:rate_limited"],
          "노출": ["closed", "note:카카오 토큰은 응답·로그에 없음(REQ-135)"], "화면": ["screen"]})

op(id="API-002", method="get", path="/owner/me", op="getOwnerMe", tag="로그인",
   summary="로그인한 사장님과 가게, 상단 배너", spec=["SPEC-001", "SPEC-067"], auth="owner",
   desc="사장님 화면을 열 때 세션을 확인한다. 세션이 없거나 만료됐으면 401이고 화면은 로그인으로 보낸 뒤 원래 주소로 돌아온다(SPEC-001). "
        "MVP 기본 설정에서는 채널 관계 재조회·친구 여부 기록·채널 추가 배너를 끈다. 기존 alertChannelFriend 보관값은 응답 형식을 위해 유지하며 현재 친구 상태 확인으로 쓰지 않는다(DEC-21). "
        "로그인 동의 항목 설정에 plusfriends를 명시해 켠 때만 `banners`의 add_alert_channel로 사장님이 우리 서비스 채널 친구가 아니라 알림이 할 일 목록에만 남는다고 안내한다(SPEC-067). "
        "친구가 아니라고 남아 있으면 마지막으로 본 지 1분이 지났을 때 우리 앱의 Admin 키로 채널 관계를 다시 조회해(target_id_type=user_id) 친구가 되었으면 배너를 빼고 보인다(DEC-21, REQ-260).",
   ok=[(200, "Me", {
       "mvp": {"owner": dict(E.OWNER, alertChannelFriend=False), "shop": E.SHOP_SUMMARY, "banners": []},
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
   omit={"401": "세션이 없거나 만료됐어도 204", "403": O403, "404": O404_NOPATH, "409": "끝낼 세션만 있음(충돌할 상태가 없음)",
         "422": O422_NOINPUT},
   kinds={"접근": ["security"], "반복": ["204", "note:두 번 호출해도 204"], "화면": ["screen"]})

op(id="API-004", method="post", path="/operator/session", op="createOperatorSession", tag="로그인",
   summary="운영자 로그인(이메일·비밀번호·2단계 인증)", spec=["SPEC-001"], auth="public",
   desc="운영자 계정으로만 운영자 화면에 들어온다(R2). 맞지 않는 것이 어느 필드인지 알리지 않는다. 15분에 5번 실패하면 429(DEC-16). "
        "세션은 HttpOnly·Secure·SameSite=Lax 쿠키 `siljang_operator`. 비밀번호는 인증 서비스로만 보내고 어디에도 남기지 않음(REQ-135). "
        "서버가 Supabase Auth에 이메일·비밀번호 로그인과 TOTP 2단계 인증을 하고, 운영자 표에 막히지 않고 2단계 인증을 켠 운영자일 때만 세션을 줌(DEC-27). "
        "Origin 헤더가 우리 화면 주소가 아니면 인증 서비스에 묻지 않고 401. Supabase가 답하지 않으면 503 `auth_unavailable`(비밀번호 단계부터 답이 없었으면 실패로 세지 않음). "
        "세션은 로그인한 때부터 12시간이 지나면 끝나고 쓴다고 늘지 않는다(DEC-26).",
   body="OperatorSessionInput",
   body_examples={"login": {"email": "ops@siljang.example", "password": "example-password-not-real", "otp": "123456"}},
   ok=[(200, "Operator", {"signed_in": E.OPERATOR}, ["Set-Cookie"])],
   errors={401: ["operator_login_failed"], 429: ["too_many_attempts"], 503: ["auth_unavailable"]},
   fields=[("/otp", "bad_format")],
   omit={"403": "누구나 로그인을 시도함", "404": O404_NOPATH, "409": "로그인은 충돌할 상태가 없음"},
   kinds={"접근": ["401:operator_login_failed"], "입력": ["422:validation_failed"], "한도": ["429:too_many_attempts"],
          "외부": ["503:auth_unavailable"], "노출": ["closed"], "화면": ["screen"]})

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
   omit={"401": "세션이 없거나 만료됐어도 204", "403": O403_OPERATOR, "404": O404_NOPATH, "409": "끝낼 세션만 있음(충돌할 상태가 없음)",
         "422": O422_NOINPUT},
   kinds={"접근": ["security"], "반복": ["204", "note:두 번 호출해도 204"], "화면": ["screen"]})

# ═══ 파일 ═════════════════════════════════════════════════════════════════════
op(id="API-007", method="post", path="/owner/uploads", op="createUpload", tag="파일",
   summary="사진 업로드(신고증·도안·완성 사진)", spec=["SPEC-002", "SPEC-004", "SPEC-053"], auth="owner",
   desc="사진 한 장을 먼저 올리고 받은 uploadId를 명령에 쓴다(1시간 안, DEC-09). 용도별 한도: 신고증 JPG·PNG·HEIC 10MB, 도안 JPG·PNG·HEIC·WEBP 10MB, "
        "완성 사진 JPG·PNG·HEIC·WEBP 20MB. 파일 종류는 내용으로 확인한다. 저장 위치는 응답에 포함하지 않는다(G6). "
        "다시 올려도 새 uploadId가 하나 더 생길 뿐이라 요청 키를 받지 않는다(DEC-04 밖). 사장님마다 1분에 30번, 아직 쓰지 않은 올린 파일(1시간 안)은 50개까지 받고, 넘으면 429 rate_limited와 Retry-After(DEC-16, 설계 재검토 RD-18).",
   body="UploadForm", body_type="multipart",
   ok=[(201, "Upload", {"license_photo": E.UPLOAD_LICENSE, "completion_photo": E.UPLOAD_COMPLETION})],
   errors={413: ["file_too_large"], 429: ["rate_limited"], 503: ["storage_unavailable"]},
   fields=[("/file", "not_allowed")],
   omit={"403": O403, "404": O404_NOPATH, "409": "올리기는 다른 기록과 충돌하지 않음"},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed", "413:file_too_large"],
          "한도": ["413:file_too_large", "429:rate_limited"], "외부": ["503:storage_unavailable"], "노출": ["closed"], "화면": ["screen"]})

# ═══ 가게 ═════════════════════════════════════════════════════════════════════
op(id="API-008", method="post", path="/owner/shop", op="registerShop", tag="가게",
   summary="가게 등록", spec=["SPEC-002", "SPEC-068"], auth="owner", idem=True,
   desc="가게 이름·연락처·사업장 주소·전자우편주소·사업자 정보(상호·대표자·사업자등록번호, 통신판매업 신고번호와 그 신고를 받은 기관이나 면제 사유, REQ-239)·영업 신고와 신고증 사진(uploadId), 개인정보 처리 위탁·재위탁 조건의 버전과 동의를 받아 가게를 '영업 신고 확인 기다림'으로 남긴다. "
        "동의하지 않으면 422 consent_required이고 넣은 값도 남기지 않는다(REQ-107). 카카오 계정 하나에 가게 하나라 두 번째는 409 already_registered(R2). "
        "같은 사업자등록번호의 다른 가게도 받고 운영자 화면에 중복을 표시한다(API-012). 신고증 사진을 옮기지 못하면 503이고 아무것도 남기지 않는다.",
   body="ShopRegistration", body_examples={"register": E.SHOP_REGISTRATION},
   ok=[(201, "Shop", {"registered": E.SHOP_PENDING})],
   errors={422: ["consent_required"], 409: ["already_registered"], 503: ["storage_unavailable"]},
   fields=[("/businessRegNo", "checksum_failed"), ("/foodBusinessType", "not_allowed"), ("/licensePhotoUploadId", "upload_not_found"),
           ("/mailOrderAuthority", "required")],
   omit={"403": O403, "404": O404_NOPATH},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "상태": ["422:consent_required", "409:already_registered"],
          "반복": ["idem", "409:already_registered"], "동시": ["201", "note:같은 사업자등록번호도 받고 운영자 화면에 중복 표시(API-012)"],
          "외부": ["503:storage_unavailable"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-009", method="get", path="/owner/shop", op="getShop", tag="가게",
   summary="내 가게 조회", spec=["SPEC-002", "SPEC-003", "SPEC-009", "SPEC-077", "SPEC-078"], auth="owner",
   desc="사장님은 자기 가게의 영업 신고 상태와 보류 이유만 본다(SPEC-003). 신고증 사진은 15분 사는 서명 주소(DEC-09). "
        "상호·대표자·사업자등록번호는 운영자가 확인한 지금 값이고, 가장 최근의 사업자 정보 변경 요청과 그 결과(보류 이유 포함)는 identityChange로 본다(SPEC-078, REQ-245).",
   ok=[(200, "Shop", {"verified": E.settings_shop(E.SHOP), "pending": E.settings_shop(E.SHOP_PENDING), "on_hold": E.settings_shop(E.SHOP_ON_HOLD),
                      "identity_change_pending": E.settings_shop(E.SHOP_IDENTITY_PENDING), "identity_change_on_hold": E.settings_shop(E.SHOP_IDENTITY_ON_HOLD)})],
   errors={404: ["shop_not_registered"]},
   omit={"403": O403, "409": O409_READ, "422": O422_NOINPUT},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:shop_not_registered"],
          "상태": ["example:on_hold", "example:identity_change_pending", "example:identity_change_on_hold"],
          "노출": ["closed"], "화면": ["screen"]})

op(id="API-010", method="patch", path="/owner/shop", op="updateShop", tag="가게",
   summary="가게 설정 수정", spec=["SPEC-077", "SPEC-009", "SPEC-017", "SPEC-024", "SPEC-025", "SPEC-052"], auth="owner", idem=True,
   desc="가게 이름·전화번호·사업장 주소·전자우편주소·픽업 장소(E14, DEC-13)·통신판매업 신고번호와 그 신고를 받은 기관(또는 면제 사유)·완성 사진 보내기(SPEC-009)·"
        "문의 끊김 시간(SPEC-025)·사장님 답 기다리는 시간(SPEC-024)·하루 AI 비용 한도(REQ-163)·한 손님의 결제 기다림 주문 한도(0~10건, 0이면 한도 없음, REQ-265)를 바꾼다(SPEC-077). 바꿀 필드만 보내고 바로 저장하며, "
        "예약 링크 페이지와 그 뒤 나가는 안내(전날 안내의 연락처·픽업 장소, 확정 안내의 가게 신원)가 바뀐 값을 쓴다(REQ-244). "
        "통신판매업 신고번호와 기관은 바꾼 뒤 값으로 보아 함께 있거나 함께 없어야 하고(아니면 빈 쪽의 필드 오류 required), 신고번호와 면제 사유 가운데 하나는 늘 있어야 한다(아니면 /mailOrderRegNo required, REQ-239). "
        "사장님 답 기다리는 시간은 그 뒤 시작된 기다림부터 쓰고(이미 시작된 기다림의 지연 안내 시각은 그대로), 문의 끊김 시간과 하루 AI 비용 한도는 저장한 때부터 쓴다(REQ-243, 05단계 A37). 결제 기다림 주문 한도는 저장한 때부터 새 기본 디자인 주문 요청에 쓰고, 지금 그보다 많은 결제 기다림 주문은 그대로 둔다(REQ-265, 05단계 A40). "
        "상호·대표자·사업자등록번호는 여기서 바꾸지 않는다(변경 요청 API-080, SPEC-078). 영업 신고 번호·종류와 신고증은 보류일 때 API-011. 바뀐 것이 없으면 outcome unchanged.",
   body="ShopUpdate",
   body_examples={"pickup_address": {"baseRevision": E.rev("shop:2"), "pickupAddress": "서울 마포구 달빛로 12, 1층", "completionPhotoEnabled": True},
                  "identity_contact": {"baseRevision": E.rev("shop:2"), "contactEmail": "moonlight@example.com", "businessAddress": "서울 마포구 달빛로 12, 2층"},
                  "wait_minutes": {"baseRevision": E.rev("shop:2"), "ownerWaitMinutes": 30},
                  "order_limit": {"baseRevision": E.rev("shop:2"), "awaitingPaymentLimit": 3}},
   ok=[(200, "ShopResult", {"updated": {"outcome": "done", "shop": E.settings_shop(E.SHOP)}, "unchanged": {"outcome": "unchanged", "shop": E.settings_shop(E.SHOP)}})],
   errors={404: ["shop_not_registered"], 409: ["version_conflict"]},
   fields=[("/contactPhone", "bad_format"), ("/ownerWaitMinutes", "out_of_range"), ("/contactEmail", "bad_format"), ("/mailOrderAuthority", "required"), ("/awaitingPaymentLimit", "out_of_range")],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:shop_not_registered"],
          "상태": ["note:기다리는 시간은 그 뒤 시작된 기다림부터, 문의 끊김 시간과 하루 AI 비용 한도는 저장한 때부터(REQ-243), 결제 기다림 주문 한도는 저장한 때부터 새 주문 요청에(REQ-265)"],
          "반복": ["idem", "example:unchanged"], "동시": ["revision", "409:version_conflict"],
          "노출": ["closed", "note:사업장 주소·전자우편주소·전화번호는 예약 링크 페이지에 보이는 가게 신원 정보(REQ-239)"], "화면": ["screen"]})

op(id="API-011", method="put", path="/owner/shop/license", op="resubmitLicense", tag="가게",
   summary="보류된 영업 신고 재업로드", spec=["SPEC-003"], auth="owner", idem=True,
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

op(id="API-080", method="post", path="/owner/shop/identity-changes", op="requestIdentityChange", tag="가게",
   summary="사업자 정보 변경 요청(상호·대표자·사업자등록번호)", spec=["SPEC-078"], auth="owner", idem=True,
   desc="상호·대표자·사업자등록번호의 새 값 셋(바꾸지 않는 값은 지금 값)과 증빙 사진(영업 신고증이나 사업자등록증 한 장, 용도 license_photo로 올린 uploadId)을 받아 "
        "변경 요청을 '확인 기다림'으로 남긴다. 요청할 때의 확인된 값도 그 요청에 남기고, 운영자가 반영(API-082)하기 전까지 가게 정보·예약 링크 페이지·확정 안내는 확인된 지금 값을 쓴다(REQ-245). "
        "세 값이 모두 지금과 같으면 남기지 않고 outcome unchanged. 확인을 기다리는 변경 요청이 이미 있으면 409 identity_change_pending이고 그 요청은 내 가게 조회(API-009)의 identityChange로 본다. "
        "영업 신고 상태와 상관없이 남길 수 있다. 증빙 사진을 옮기지 못하면 503이고 아무것도 남기지 않는다. 운영자는 사업자 정보 변경 확인 목록(API-081)에서 본다.",
   body="IdentityChangeInput", body_examples={"rename": E.IDENTITY_CHANGE_INPUT},
   ok=[(201, "ShopResult", {"requested": {"outcome": "done", "shop": E.SHOP_IDENTITY_PENDING}}),
       (200, "ShopResult", {"unchanged": {"outcome": "unchanged", "shop": E.SHOP}})],
   errors={404: ["shop_not_registered"], 409: ["version_conflict", "identity_change_pending"], 503: ["storage_unavailable"]},
   fields=[("/businessRegNo", "checksum_failed"), ("/evidencePhotoUploadId", "upload_not_found")],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated", "note:그 가게 사장님만 남김(G1)"], "입력": ["422:validation_failed"], "대상": ["404:shop_not_registered"],
          "상태": ["409:identity_change_pending"], "반복": ["idem", "example:unchanged"], "동시": ["revision", "409:version_conflict"],
          "외부": ["503:storage_unavailable"], "노출": ["closed", "note:증빙 사진은 그 가게 사장님과 운영자만 봄(G6)"], "화면": ["screen"]})

# ═══ 운영자 ═══════════════════════════════════════════════════════════════════
op(id="API-012", method="get", path="/operator/shops", op="listReviewShops", tag="운영자",
   summary="영업 신고 확인할 가게 목록", spec=["SPEC-003", "SPEC-002"], auth="operator",
   desc="이 목록에는 가게 등록 정보만 있다. 손님·주문 기록은 가게 기록 보기(API-074~077)에서 가린 값으로만 본다(SPEC-003, SPEC-073). 같은 사업자등록번호의 다른 가게가 있으면 duplicateBusinessRegNo(SPEC-002). 순서: 등록한 시각(createdAt)이 이른 가게가 앞(오래 기다린 확인부터), 같으면 가게 ID 순(DEC-14).",
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
   summary="영업 신고 확인할 가게 하나", spec=["SPEC-003", "SPEC-078"], auth="operator",
   desc="신고증 사진(서명 주소)과 넣은 신고 번호·영업 종류·상호, 가게 신원 정보(사업장 주소·전자우편주소·통신판매업 신고번호와 기관, REQ-239), 같은 사업자등록번호의 다른 가게를 보인다. "
        "확인을 기다리는 사업자 정보 변경 요청이 있으면 pendingIdentityChange로 보이고, 그 요청을 먼저 반영·보류(API-082)한 뒤 영업 신고를 정한다(SPEC-003, SPEC-078). "
        "결제 계좌는 은행·예금주·끝 4자리와 예금주가 대표자·상호와 같은지(holderMatches), 사장님이 가게 명의가 맞다고 답했는지, 예금주를 확인한 운영자·시각만 보이고 "
        "계좌번호 전체는 보이지 않는다(REQ-197, SPEC-003). 계좌가 없으면 paymentAccount가 null이고 확인됨을 남길 수 없다.",
   params=[pid("shopId", "가게", E.SHOP_ID)],
   ok=[(200, "ReviewShopDetail", {"pending": E.REVIEW_DETAIL, "on_hold": E.REVIEW_DETAIL_ON_HOLD, "no_account": E.REVIEW_DETAIL_NO_ACCOUNT,
                                  "holder_different": E.REVIEW_DETAIL_HOLDER_DIFFERENT, "identity_change_pending": E.REVIEW_DETAIL_IDENTITY_PENDING})],
   errors={404: ["not_found"]},
   omit={"403": O403_OPERATOR, "409": O409_READ, "422": O422_PATHONLY},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:not_found"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-014", method="post", path="/operator/shops/{shopId}/license-review", op="reviewLicense", tag="운영자",
   summary="영업 신고 확인·보류", spec=["SPEC-003", "SPEC-078"], auth="operator", idem=True,
   desc="운영자는 신고증과 함께 결제 계좌의 예금주가 대표자·상호와 같은지 보고 정한다(REQ-197). 확인됨이면 확인한 운영자·시각과, 그 가게의 지금 결제 계좌에 예금주를 확인한 운영자·시각을 남긴다. "
        "결제 계좌가 없으면 확인됨은 409 payment_account_missing('결제 계좌 등록 기다림')이고 보류는 남길 수 있다. "
        "확인을 기다리는 사업자 정보 변경 요청이 있으면 확인됨은 409 identity_change_pending(먼저 API-082로 반영·보류, SPEC-003·SPEC-078)이고 보류는 남길 수 있다. "
        "보류면 이유를 남기고 사장님께 우리 서비스 채널로 이유를 한 번 알린다(못 가면 할 일 목록, G4). "
        "확인됨을 다시 확인하면 unchanged. 확인됨을 보류로 바꾸기는 첫 버전에서 하지 않음(409 invalid_state, M7). "
        "다른 운영자가 먼저 정했으면 409 already_decided, 그 밖에 가게가 바뀌었으면 409 version_conflict(G3).",
   params=[pid("shopId", "가게", E.SHOP_ID)],
   body="LicenseReviewInput",
   body_examples={"verify": {"baseRevision": E.rev("shop:1"), "decision": "verified"},
                  "hold": {"baseRevision": E.rev("shop:1"), "decision": "on_hold", "holdReason": "신고증 글자가 잘 보이지 않아요. 밝은 곳에서 다시 찍어 올려 주세요"}},
   ok=[(200, "LicenseReviewResult", {"verified": {"outcome": "done", "shop": E.REVIEW_DETAIL_VERIFIED},
                                     "on_hold": {"outcome": "done", "shop": E.REVIEW_DETAIL_ON_HOLD},
                                     "unchanged": {"outcome": "unchanged", "shop": E.REVIEW_DETAIL_VERIFIED}})],
   errors={404: ["not_found"], 409: ["version_conflict", "already_decided", "invalid_state", "payment_account_missing", "identity_change_pending"]},
   fields=[("/holdReason", "required")],
   omit={"403": O403_OPERATOR},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "상태": ["409:invalid_state", "409:payment_account_missing", "409:identity_change_pending", "example:unchanged"], "반복": ["idem"], "동시": ["revision", "409:already_decided"],
          "외부": ["200", "note:사장님 알림이 못 가도 할 일 목록에 보류 이유(G4)"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-015", method="get", path="/operator/alerts", op="listOperatorAlerts", tag="운영자",
   summary="운영자 알림", spec=["SPEC-008", "SPEC-010", "SPEC-017"], auth="operator",
   desc="이미 다른 가게에 묶인 채널(SPEC-008), 처리방침 국외 이전 항목 빔(SPEC-010), 한 가게에서 5분에 AI 실패 5번(AI-1). 내용 없이 건수만(E10). 순서: 새 알림(createdAt이 늦은 것)이 앞, 같으면 알림 ID 순(DEC-14).",
   params=[CURSOR, LIMIT],
   ok=[(200, "OperatorAlertList", {"alerts": E.OPERATOR_ALERTS, "empty": E.EMPTY_PAGE})],
   fields=[("query:cursor", "bad_format")],
   omit={"403": O403_OPERATOR, "404": O404_NOPATH, "409": O409_READ},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "노출": ["closed"],
          "빈·끊김": ["example:empty"], "화면": ["screen"]})

op(id="API-081", method="get", path="/operator/identity-changes", op="listIdentityChanges", tag="운영자",
   summary="사업자 정보 변경 요청 목록", spec=["SPEC-078"], auth="operator",
   desc="운영자가 확인할 사업자 정보 변경 요청을 요청한 차례로 보인다(status가 없으면 pending). 요청마다 지금 값과 새 값, 증빙 사진(서명 주소), "
        "결제 계좌의 은행·예금주·끝 4자리와 예금주가 새 대표자·상호와 같은지(holderMatchesNew)를 보인다. 다르면 표시만 하고 막지 않는다(REQ-197). 계좌번호 전체는 보이지 않는다(SPEC-003). 순서: 요청한 시각이 이른 것이 앞, 같으면 요청 ID 순(DEC-14).",
   params=[q("status", {"type": "string", "enum": ["pending", "applied", "on_hold"]}, "변경 요청 상태로 거름. 없으면 pending", "pending"), CURSOR, LIMIT],
   ok=[(200, "IdentityChangeList", {"pending": {"items": [E.IDENTITY_REVIEW, E.IDENTITY_REVIEW_HOLDER_DIFFERENT], "nextCursor": None},
                                    "empty": E.EMPTY_PAGE})],
   fields=[("query:status", "not_allowed")],
   omit={"403": O403_OPERATOR, "404": O404_NOPATH, "409": O409_READ},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"],
          "상태": ["example:pending", "note:예금주가 새 대표자·상호와 다르면 holderMatchesNew false로 보이고 막지 않음(REQ-197)"],
          "노출": ["closed", "note:계좌는 은행·예금주·끝 4자리만(SPEC-003)"], "빈·끊김": ["example:empty"], "화면": ["screen"]})

op(id="API-082", method="post", path="/operator/identity-changes/{changeId}/review", op="reviewIdentityChange", tag="운영자",
   summary="사업자 정보 변경 반영·보류", spec=["SPEC-078", "SPEC-003"], auth="operator", idem=True,
   desc="운영자가 변경 요청을 '반영'이나 '보류(이유)'로 정한다. 반영이면 한 트랜잭션에서 그 가게의 상호·대표자·사업자등록번호가 요청할 때의 값과 같을 때만 새 값으로 바꾸고, "
        "요청을 반영함으로 두고 반영한 운영자·시각을 남기고, 사장님께 우리 서비스 채널로 한 번 알린다(할 일 없이 알림만, 못 가도 내 가게 조회의 identityChange로 결과를 봄, G4). "
        "그 뒤 예약 링크 페이지·확정 안내·운영자 화면이 새 값을 쓴다(REQ-245, 05단계 A37). 예금주가 새 대표자·상호와 달라도 막지 않고 운영자가 보고 정하며(REQ-197), 반영 뒤 계좌를 바꾸면 새 대표자·상호가 기준이다(REQ-199). "
        "보류면 이유를 남기고 사장님께 한 번 알린다. 반영·보류한 요청은 고치지 않는다: 같은 결정을 다시 보내면 unchanged, 다른 운영자가 먼저 정했으면 409 already_decided, "
        "그 밖에 요청이나 가게의 세 값이 바뀌었으면 409 version_conflict(G3).",
   params=[pid("changeId", "변경 요청", E.IDENTITY_CHANGE_ID)],
   body="IdentityChangeReviewInput",
   body_examples={"apply": {"baseRevision": E.rev("identity:1"), "decision": "applied"},
                  "hold": {"baseRevision": E.rev("identity:1"), "decision": "on_hold", "holdReason": E.IDENTITY_HOLD_REASON}},
   ok=[(200, "IdentityChangeReviewResult", {"applied": {"outcome": "done", "change": E.IDENTITY_REVIEW_APPLIED},
                                            "on_hold": {"outcome": "done", "change": E.IDENTITY_REVIEW_ON_HOLD},
                                            "unchanged": {"outcome": "unchanged", "change": E.IDENTITY_REVIEW_APPLIED}})],
   errors={404: ["not_found"], 409: ["version_conflict", "already_decided"]},
   fields=[("/holdReason", "required")],
   omit={"403": O403_OPERATOR},
   kinds={"접근": ["security", "401:unauthenticated", "note:반영·보류는 운영자만(G1)"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "상태": ["example:unchanged", "note:예금주가 새 대표자·상호와 달라도 막지 않음(REQ-197)"], "반복": ["idem"], "동시": ["revision", "409:already_decided"],
          "외부": ["200", "note:사장님 알림이 못 가도 내 가게 조회의 identityChange로 결과를 봄(G4)"], "노출": ["closed"], "화면": ["screen"]})

# ═══ 운영자: 가게 기록 보기 (설계 재검토 H4) ═══════════════════════════════════════════════
LOG_NOTE = "note:접속기록을 남기지 못하면 500 internal로 아무것도 돌려주지 않음(SPEC-074)"
op(id="API-074", method="get", path="/operator/shops/{shopId}/records", op="listShopRecords", tag="운영자",
   summary="가게 기록 목록(가린 값)", spec=["SPEC-073", "SPEC-074"], auth="operator",
   desc="손님 문제나 분쟁, 사장님의 보관 기록 요청으로 운영자가 가게의 주문(kind=orders)이나 상담(kind=consultations)을 찾는다. "
        "손님 이름은 첫 글자 밖을, 연락처는 끝 4자리 밖을 *로 가린 값만 보인다(REQ-194). 끝나고 30일이 지나 보관 기록이 된 주문은 "
        "주문번호·끝난 날·보관 기간과 keptRecordId만 있고, 내용은 사유를 적어 API-077로 연다(05단계 A22의 운영자 예외). "
        "부를 때마다 응답과 같은 트랜잭션에서 접속기록에 읽음 한 행을 남기고, 남기지 못하면 500으로 아무것도 돌려주지 않는다(SPEC-074).",
   params=[pid("shopId", "가게", E.SHOP_ID),
           q("kind", {"type": "string", "enum": ["orders", "consultations"]}, "주문·상담. 없으면 orders", "orders"), CURSOR, LIMIT],
   ok=[(200, "OperatorRecordList", {"orders": E.OP_RECORDS_ORDERS, "consultations": E.OP_RECORDS_CONSULTATIONS, "empty": E.OP_RECORDS_EMPTY})],
   errors={404: ["not_found"]},
   fields=[("query:kind", "not_allowed")],
   omit={"403": O403_OPERATOR, "409": O409_READ},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "상태": ["example:orders", "note:보관 기록이 된 주문은 주문번호·끝난 날·보관 기간과 keptRecordId만(05단계 A22)"],
          "외부": [LOG_NOTE],
          "노출": ["closed", "note:이름·연락처는 가린 값만, 사진 없음(REQ-194). 본 것도 접속기록에 읽음 한 행(REQ-196)"],
          "빈·끊김": ["example:empty"], "화면": ["screen"]})

op(id="API-075", method="get", path="/operator/shops/{shopId}/consultations/{consultationId}", op="getShopConsultation", tag="운영자",
   summary="상담 하나(가린 값)", spec=["SPEC-073", "SPEC-074"], auth="operator",
   desc="그 가게 상담의 메시지마다 발신자·시각·종류·글자 수·사진 수만 보이고 대화 글은 보이지 않는다: 번호 마스킹(SPEC-021)은 대화 속 이름·알레르기 같은 말을 가리지 않기 때문이다(REQ-227). "
        "대화 글은 사유를 적어 API-077(targetKind consultation_text, cursor에 현재 페이지의 textCursor를 넣음)로 한 페이지씩 연다. 대화 속 번호는 플레이스홀더마다 끝 4자리와 원래 값을 열 수 있는지(originalKept)를 maskedValues로 보인다. "
        "카드번호는 끝 4자리만, 주민등록번호처럼 보이는 숫자와 긴 숫자는 플레이스홀더만 있고 열 수 없다(REQ-192). 사진은 수만 보이고 열지 않는다(REQ-194). "
        "지운 상담(SPEC-065)은 status deleted와 빈 목록. 부를 때마다 접속기록에 읽음 한 행(SPEC-074). 순서: 시각(at) 순이고 새 메시지가 뒤, 같은 시각이면 남긴 차례(DEC-14). 사장님 답과 손님 안내는 이 보기에 넣지 않는다(대화 글을 보이지 않는 보기).",
   params=[pid("shopId", "가게", E.SHOP_ID), pid("consultationId", "상담", E.CONSULT_ID), CURSOR, LIMIT],
   ok=[(200, "OperatorConsultation", {"consultation": E.OP_CONSULTATION, "deleted": E.OP_CONSULTATION_DELETED})],
   errors={404: ["not_found"]},
   fields=[("query:limit", "out_of_range")],
   omit={"403": O403_OPERATOR, "409": O409_READ},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "상태": ["example:deleted"], "외부": [LOG_NOTE],
          "노출": ["closed", "note:대화 글은 보이지 않고 메시지마다 글자 수만(REQ-227), 번호는 끝 4자리만, 사진은 수만(REQ-194)"],
          "빈·끊김": ["example:deleted"], "화면": ["screen"]})

op(id="API-076", method="get", path="/operator/shops/{shopId}/orders/{orderId}", op="getShopOrder", tag="운영자",
   summary="주문 하나(가린 값)", spec=["SPEC-073", "SPEC-074"], auth="operator",
   desc="주문의 상태·픽업 시각·금액, 결제 안내와 환불 요약을 보인다. 주문자 이름·연락처와 환불 계좌는 가린 값이고, 알레르기 답과 빼야 할 재료는 답이 있는지만, "
        "참고 사진은 수만 보인다(REQ-194). 원래 값은 사유를 적어 API-077로 연다(주문자 이름·연락처는 targetKind order_contact와 orderId, 환불 계좌는 refund_account와 refundId). "
        "보관 기록이 된 주문은 404(목록의 keptRecordId로 API-077). 부를 때마다 접속기록에 읽음 한 행(SPEC-074).",
   params=[pid("shopId", "가게", E.SHOP_ID), pid("orderId", "주문", E.ORDER_ID)],
   ok=[(200, "OperatorOrder", {"order": E.OP_ORDER, "with_refund": E.OP_ORDER_REFUND})],
   errors={404: ["not_found"]},
   omit={"403": O403_OPERATOR, "409": O409_READ, "422": O422_PATHONLY},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:not_found", "note:보관 기록이 된 주문도 404(목록의 keptRecordId로 API-077)"],
          "외부": [LOG_NOTE], "노출": ["closed", "note:이름·연락처·환불 계좌는 가린 값, 알레르기 답은 있는지만, 사진은 수만(REQ-194)"],
          "화면": ["screen"]})

op(id="API-077", method="post", path="/operator/shops/{shopId}/originals", op="openOriginal", tag="운영자",
   summary="원래 값·보관 기록·대화 글 열기(사유)", spec=["SPEC-073", "SPEC-074"], auth="operator", idem=True,
   desc="운영자가 대상 하나와 사유(5~200자)를 보내면 그 값 하나만 연다(REQ-195): 대화 속 전화번호·계좌번호(masked_value), 주문자 이름·연락처(order_contact), "
        "환불 계좌(refund_account), 보관 기록(kept_record), 상담의 대화 글 한 페이지(consultation_text: targetId는 상담 ID, cursor는 첫 페이지부터 API-075의 textCursor(현재 페이지 중20개까지·10분 만료·ID 구성 검증), 번호는 플레이스홀더 그대로, REQ-227). 응답과 같은 트랜잭션에서 운영자·시각·접속지·대상·사유를 접속기록에 남기고(action open_original·open_kept), "
        "남기지 못하면 500으로 값을 돌려주지 않는다(SPEC-074). 같은 요청 키로 다시 오면 다시 열어 같은 응답을 돌려주고 접속기록도 한 행 더 남긴다(요청 키 기록에는 원래 값을 두지 않음). "
        "원래 값을 두지 않는 값(카드번호·긴 숫자, REQ-192)은 409 original_not_kept, 지우기 작업이 비운 값과 지운 상담의 대화 글(SPEC-065)은 409 original_erased이고 둘 다 접속기록에 열기 행을 남기지 않는다. "
        "연 값은 이 응답에만 있고 로그·오류 보고에는 없다(G6). 화면은 연 값을 저장하거나 내려받게 하지 않는다.",
   params=[pid("shopId", "가게", E.SHOP_ID)],
   body="OriginalOpenInput",
   body_examples={"masked_value": E.OPEN_ORIGINAL_INPUT,
                  "order_contact": {"targetKind": "order_contact", "targetId": E.ORDER_ID, "reason": "사장님 문의: 픽업 날 연락처 확인"},
                  "refund_account": {"targetKind": "refund_account", "targetId": E.REFUND["refundId"], "reason": "손님 문의: 환불이 들어오지 않음"},
                  "kept_record": {"targetKind": "kept_record", "targetId": E.KEPT_RECORD_ID, "reason": "사장님 요청: 9월 주문 분쟁 자료"},
                  "consultation_text": {"targetKind": "consultation_text", "targetId": E.CONSULT_ID, "cursor": E.OP_CONSULTATION["textCursor"], "reason": "손님 문의: 알레르기 안내 확인"}},
   ok=[(200, "OriginalValue", {"masked_value": E.ORIGINAL_MASKED, "order_contact": E.ORIGINAL_CONTACT,
                               "refund_account": E.ORIGINAL_REFUND, "kept_record": E.ORIGINAL_KEPT,
                               "consultation_text": E.ORIGINAL_CONSULTATION_TEXT})],
   errors={404: ["not_found"], 409: ["original_not_kept", "original_erased"]},
   fields=[("/reason", "too_short"), ("/targetId", "reference_not_found")],
   omit={"403": O403_OPERATOR},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"],
          "대상": ["404:not_found", "409:original_not_kept"], "상태": ["409:original_erased"],
          "반복": ["idem", "note:같은 값을 다시 열어도 그때마다 접속기록 한 행(SPEC-073)"], "외부": [LOG_NOTE],
          "노출": ["closed", "note:원래 값은 이 응답에만, 로그·오류 보고에는 없음(G6)"], "화면": ["screen"]})

# ═══ 가격표 ═══════════════════════════════════════════════════════════════════
op(id="API-016", method="get", path="/owner/price-list", op="getCurrentPriceList", tag="가격표",
   summary="현재 가격표 버전", spec=["SPEC-004"], auth="owner",
   desc="현재 버전의 옵션·옵션 규칙·도안. 아직 저장한 버전이 없으면 404 not_set이고 화면은 빈 입력을 보인다.",
   ok=[(200, "PriceList", {"current": E.PRICE_LIST})],
   errors={404: ["shop_not_registered", "not_set"]},
   omit={"403": O403, "409": O409_READ, "422": O422_NOINPUT},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:not_set"], "노출": ["closed"], "빈·끊김": ["404:not_set"], "화면": ["screen"]})

op(id="API-017", method="post", path="/owner/price-list/versions", op="createPriceListVersion", tag="가격표",
   summary="가격표 새 버전 저장", spec=["SPEC-004"], auth="owner", idem=True,
   desc="새 버전의 전체 내용을 받아 버전을 하나 올려 남긴다. 이전 버전은 '이전 버전'으로 읽기만 된다(REQ-027). 바꾼 것이 없으면 200 unchanged이고 버전은 그대로. "
        "첫 저장은 baseRevision null. 옵션 규칙끼리 충돌하면(같은 조합이 허용이자 금지) 422와 충돌한 행. 도안 그림은 uploadId(새 그림)나 sourceDesignId(이전 버전 그림). sourceDesignId가 없거나 다른 가게 도안이면 422 reference_not_found, uploadId가 없거나 지났거나 다른 사장님이 올린 것이면 422 upload_not_found(DEC-02, DEC-09). "
        "옵션·도안마다 기본 디자인 범위 안인지(inStandard)를 사장님이 고르고 그 버전에 함께 남는다(REQ-228). 값이 '부터'·'범위'인 옵션이나 범위 밖 옵션에 이은 도안을 범위에 넣으면 422 not_allowed와 그 행. "
        "범위는 버전에 남아 이미 낸 견적과 요청된 주문은 그 버전의 범위로 가른다(SPEC-013, REQ-229).",
   body="PriceListInput", body_examples={"new_version": E.PRICE_LIST_INPUT},
   ok=[(201, "PriceListResult", {"created": {"outcome": "created", "priceList": E.PRICE_LIST}}),
       (200, "PriceListResult", {"unchanged": {"outcome": "unchanged", "priceList": E.PRICE_LIST}})],
   errors={404: ["shop_not_registered"], 409: ["version_conflict"]},
   fields=[("/options/0/amount", "out_of_range"), ("/rules/0", "conflict"), ("/options/0/inStandard", "not_allowed"), ("/designs/0/inStandard", "not_allowed"), ("/designs/0/sourceDesignId", "reference_not_found")],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["note:이전 버전을 고치는 API가 없음(API-019는 읽기만)"],
          "상태": ["example:unchanged"], "반복": ["idem"], "동시": ["revision", "409:version_conflict"],
          "한도": ["422:validation_failed", "note:옵션 100개·도안 50장(스키마 maxItems)"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-018", method="get", path="/owner/price-list/versions", op="listPriceListVersions", tag="가격표",
   summary="가격표 버전 목록", spec=["SPEC-004"], auth="owner",
   desc="이전 버전은 지우지 않는다(REQ-027). 순서: 새 버전이 앞. 버전은 저장할 때마다 하나라 나누지 않고 1,000개까지 한 번에 준다(DEC-14의 예외).",
   ok=[(200, "VersionList", {"versions": E.PRICE_VERSIONS, "empty": {"items": []}})],
   errors={404: ["shop_not_registered"]},
   omit={"403": O403, "409": O409_READ, "422": O422_NOINPUT},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:shop_not_registered"], "노출": ["closed"],
          "빈·끊김": ["example:empty"], "화면": ["screen"]})

op(id="API-019", method="get", path="/owner/price-list/versions/{version}", op="getPriceListVersion", tag="가격표",
   summary="가격표 버전 하나", spec=["SPEC-004", "SPEC-013"], auth="owner",
   desc="이전 버전은 읽기만 된다(REQ-027). 이미 요청된 주문은 그 주문이 받은 버전으로 계산한다(SPEC-013).",
   params=[PVERSION],
   ok=[(200, "PriceList", {"old_version": E.PRICE_LIST_OLD})],
   errors={404: ["not_found"]},
   omit={"403": O403, "409": O409_READ, "422": O422_PATHONLY},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:not_found"], "노출": ["closed"], "화면": ["screen"]})

# ═══ 운영규정 ═════════════════════════════════════════════════════════════════
op(id="API-020", method="get", path="/owner/operating-rules", op="getCurrentOperatingRules", tag="운영규정",
   summary="현재 운영규정(없으면 템플릿)", spec=["SPEC-005"], auth="owner",
   desc="확정한 버전이 없으면 템플릿(isTemplate true)을 반환한다: 제작 전 취소 전액 환불, 견적 유효 72시간·결제 기한 12시간·신고 기한 24시간(SPEC-005). "
        "신고 기한 조문 글은 '받은 뒤 24시간 안에 알려 주시면 빨리 확인할 수 있어요'처럼 기한 뒤 신고를 막지 않는 글이다(REQ-250).",
   ok=[(200, "OperatingRules", {"current": E.RULES, "template": E.RULES_TEMPLATE})],
   errors={404: ["shop_not_registered"]},
   omit={"403": O403, "409": O409_READ, "422": O422_NOINPUT},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:shop_not_registered"], "노출": ["closed"],
          "빈·끊김": ["example:template"], "화면": ["screen"]})

op(id="API-021", method="post", path="/owner/operating-rules/versions", op="createOperatingRulesVersion", tag="운영규정",
   summary="운영규정 확정(새 버전)", spec=["SPEC-005"], auth="owner", idem=True,
   desc="조문마다 조건과 효과를 새 버전과 함께 남긴다. 제작 전 취소 환불을 전액보다 낮추면 아무것도 남기지 않고 409 confirmation_required(lowered_refund)를 반환하고, "
        "사장님이 '그래도 저장'을 누르면 confirm에 lowered_refund를 담아 다시 보낸다. 그 선택을 그 버전에 남긴다(REQ-032). "
        "단계별 환불은 hoursBeforeMin 차례로 놓으면 0시간부터 시작해 끝없음(hoursBeforeMax null)으로 끝나고 행의 hoursBeforeMax가 다음 행의 hoursBeforeMin과 같아야 한다(겹치면 422 overlaps, 비면 gap). "
        "단계별 환불 조문(staged_refund)이 있으면 단계 행이 꼭 있고(없으면 /refundTiers required), 단계 행이 있으면 그 조문이 꼭 있다(없으면 /clauses required). "
        "단계 행이 없는 버전은 맞춤 재료 주문·제작 시작 뒤 취소도 제작 전 비율로 셈한다(화면이 저장 전에 알리고 막지 않음, SPEC-005). "
        "고정 취소 수수료는 0원~1,000만 원만 보고, 주문 금액과는 환불을 계산할 때 견준다(바탕보다 크면 환불 0원, SPEC-016). "
        "취소·환불 조문으로 만든 주문 요청 확인 카드의 규정 글(끝의 청약철회 제한 문장과 미성년자 취소 고지까지, REQ-240)이 1,000자 글 둘에 들어가지 않으면(조문을 가르지 않음) 아무것도 남기지 않고 422(field /clauses, code exceeds_card_limit, REQ-184, DEC-22).",
   body="OperatingRulesInput", body_examples={"confirm": E.RULES_INPUT, "lowered_confirmed": E.RULES_INPUT_LOWERED},
   ok=[(201, "OperatingRulesResult", {"created": {"outcome": "created", "operatingRules": E.RULES}}),
       (200, "OperatingRulesResult", {"unchanged": {"outcome": "unchanged", "operatingRules": E.RULES}})],
   errors={404: ["shop_not_registered"], 409: ["version_conflict", "confirmation_required"]},
   fields=[("/refundTiers/1", "overlaps"), ("/refundTiers/0", "gap"), ("/refundTiers", "required"), ("/quoteValidHours", "out_of_range"),
           ("/clauses", "exceeds_card_limit")],
   confirm=["lowered_refund"],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:shop_not_registered"],
          "한도": ["422:validation_failed", "note:카드의 규정 글이 1,000자 글 둘을 넘으면 exceeds_card_limit(REQ-184)"],
          "상태": ["409:confirmation_required", "example:unchanged"], "반복": ["idem"], "동시": ["revision", "409:version_conflict"],
          "노출": ["closed"], "화면": ["screen"]})

op(id="API-022", method="get", path="/owner/operating-rules/versions", op="listOperatingRulesVersions", tag="운영규정",
   summary="운영규정 버전 목록", spec=["SPEC-005"], auth="owner",
   desc="이전 버전은 지우지 않는다(REQ-027). 순서: 새 버전이 앞. 버전은 저장할 때마다 하나라 나누지 않고 1,000개까지 한 번에 준다(DEC-14의 예외).",
   ok=[(200, "VersionList", {"versions": {"items": [{"version": 2, "createdAt": E.t("11-12", "11:20"), "supersededAt": None},
                                                    {"version": 1, "createdAt": E.t("11-12", "10:50"), "supersededAt": E.t("11-12", "11:20")}]},
                             "empty": {"items": []}})],
   errors={404: ["shop_not_registered"]},
   omit={"403": O403, "409": O409_READ, "422": O422_NOINPUT},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:shop_not_registered"], "노출": ["closed"],
          "빈·끊김": ["example:empty"], "화면": ["screen"]})

op(id="API-023", method="get", path="/owner/operating-rules/versions/{version}", op="getOperatingRulesVersion", tag="운영규정",
   summary="운영규정 버전 하나", spec=["SPEC-005", "SPEC-016"], auth="owner",
   desc="주문은 동의한 버전을 따른다(REQ-030). 환불 근거의 버전을 열 때 쓴다(SPEC-016).",
   params=[PVERSION],
   ok=[(200, "OperatingRules", {"old_version": dict(E.RULES, version=1, current=False, createdAt=E.t("11-12", "10:50"),
                                                    supersededAt=E.t("11-12", "11:20"), revision=E.rev("rules:1"))})],
   errors={404: ["not_found"]},
   omit={"403": O403, "409": O409_READ, "422": O422_PATHONLY},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:not_found"], "노출": ["closed"], "화면": ["screen"]})

# ═══ 결제 수단 ═════════════════════════════════════════════════════════════
op(id="API-024", method="get", path="/owner/payment-destination", op="getPaymentDestination", tag="결제 수단",
   summary="결제 수단 조회", spec=["SPEC-006"], auth="owner",
   desc="가게 명의 계좌와 카드 결제 링크. 계좌번호는 앱이 암호화해 두고 이 화면과 그 가게 손님의 결제 안내를 보일 때만 복호화한다(SPEC-006, REQ-191, DEC-19). "
        "운영자에게는 끝 4자리만 보인다(API-013).",
   ok=[(200, "PaymentDestination", {"account": E.PAYMENT_DESTINATION})],
   errors={404: ["shop_not_registered", "not_set"]},
   omit={"403": O403, "409": O409_READ, "422": O422_NOINPUT},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:not_set"], "노출": ["closed", "note:계좌번호는 이 화면과 결제 안내에만(DEC-19)"],
          "빈·끊김": ["404:not_set"], "화면": ["screen"]})

op(id="API-025", method="put", path="/owner/payment-destination", op="setPaymentDestination", tag="결제 수단",
   summary="결제 수단 등록·수정", spec=["SPEC-006"], auth="owner", idem=True,
   desc="바꾸면 새 행을 만들고 옛 행은 그만 쓴다. 이미 나간 결제 안내는 옛 계좌를 그대로 참조하고, 바꾼 뒤 만드는 결제 안내부터 새 계좌를 쓴다(REQ-198). "
        "계좌번호는 숫자와 '-', 숫자만 10~16자리인지 여기서 확인하고 앱이 암호화해 끝 4자리와 함께 남긴다(데이터베이스는 형식을 보지 않음, 05단계 E20). "
        "예금주가 상호·대표자와 다르면 409 confirmation_required(holder_mismatch)이고, 사장님이 '가게 명의가 맞다'고 하면 confirm에 담아 다시 보낸다(답을 남김). "
        "영업 신고가 확인된 가게는 새 예금주가 확인된 대표자·상호나 운영자가 확인한 예금주와 같아야 바꾸고, 다르면 409 holder_not_verified로 저장하지 않는다(REQ-199). "
        "보류된 가게에서 바꾸면 영업 신고가 다시 확인 기다림이 된다(SPEC-003). 처음 등록이 아닌 바꿈이면 사장님 카카오로 '결제 받을 계좌가 바뀌었어요' 알림을 한 번 보낸다(SPEC-067, 할 일은 만들지 않음).",
   body="PaymentDestinationInput",
   body_examples={"first": E.PAYMENT_DESTINATION_INPUT,
                  "holder_confirmed": dict(E.PAYMENT_DESTINATION_INPUT, holderName="박하늘", confirm=["holder_mismatch"])},
   ok=[(200, "PaymentDestinationResult", {"created": {"outcome": "created", "paymentDestination": E.PAYMENT_DESTINATION},
                                          "unchanged": {"outcome": "unchanged", "paymentDestination": E.PAYMENT_DESTINATION}})],
   errors={404: ["shop_not_registered"], 409: ["version_conflict", "confirmation_required", "holder_not_verified"]},
   fields=[("/accountNumber", "bad_format"), ("/cardPaymentUrl", "bad_format")],
   confirm=["holder_mismatch"],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:shop_not_registered"],
          "상태": ["409:confirmation_required", "409:holder_not_verified", "note:바꾼 계좌는 그 뒤 결제 안내부터(REQ-198)"],
          "외부": ["note:계좌를 바꾸면 사장님 카카오 알림 한 번, 못 가도 저장은 그대로(SPEC-067, G4)"], "반복": ["idem", "example:unchanged"],
          "동시": ["revision", "409:version_conflict"], "노출": ["closed"], "화면": ["screen"]})

# ═══ 영업 캘린더 ════════════════════════════════════════════════════════════════
op(id="API-026", method="get", path="/owner/calendar", op="getCalendarSettings", tag="영업 캘린더",
   summary="영업 캘린더 설정 조회", spec=["SPEC-007"], auth="owner",
   desc="요일 휴무·하루 최대 개수·주문 마감·답하는 시간·전날 안내 시각·후기 부탁 시각.",
   ok=[(200, "CalendarSettings", {"settings": E.CALENDAR})],
   errors={404: ["shop_not_registered", "not_set"]},
   omit={"403": O403, "409": O409_READ, "422": O422_NOINPUT},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:not_set"], "노출": ["closed"], "빈·끊김": ["404:not_set"], "화면": ["screen"]})

op(id="API-027", method="put", path="/owner/calendar", op="setCalendarSettings", tag="영업 캘린더",
   summary="영업 캘린더 설정 등록·수정", spec=["SPEC-007", "SPEC-052", "SPEC-061"], auth="owner", idem=True,
   desc="바꾼 기준은 그 뒤 잡는 자리에만 쓴다(R4). 바꾼 기준을 넘는 날과 주문은 그대로 두고 conflicts로 보인다. "
        "잡힌 자리나 확정 주문이 있는 요일을 휴무로 바꾸거나 하루 최대 개수를 이미 잡힌 자리보다 낮추면 저장 전에 409 confirmation_required와 conflicts의 관련 주문을 보인다(REQ-261). 전날 안내·후기 부탁 시각은 08:00~20:50(SPEC-052, SPEC-061). "
        "바꾼 전날 안내·후기 부탁 시각은 아직 보내지 않은 안내부터 쓰고(보낼 시각을 다시 셈) 이미 보낸 것은 다시 보내지 않는다(REQ-243).",
   body="CalendarSettingsInput", body_examples={"first": E.CALENDAR_INPUT},
   ok=[(200, "CalendarSettingsResult", {
       "created": {"outcome": "created", "calendar": E.CALENDAR, "conflicts": []},
       "updated_with_conflicts": {"outcome": "updated", "calendar": dict(E.CALENDAR, dailyCapacity=4, revision=E.rev("calendar:2")),
                                  "conflicts": [{"day": "2026-11-20", "capacity": 4, "held": 5, "orders": [dict(E.ORDER_REF, status="confirmed", pickupAt=E.t("11-20", "15:00")), dict(E.CUSTOM_REF, status="awaiting_payment", pickupAt=E.t("11-20", "16:00"))]}]},
       "unchanged": {"outcome": "unchanged", "calendar": E.CALENDAR, "conflicts": []}})],
   errors={404: ["shop_not_registered"], 409: ["version_conflict", "confirmation_required"]},
   fields=[("/replyEnd", "not_after_start"), ("/dayBeforeNoticeTime", "outside_window")],
   confirm=["closed_day_with_orders", "capacity_below_held"], multi_day_confirm=True,
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:shop_not_registered"],
          "상태": ["409:confirmation_required", "example:updated_with_conflicts"], "반복": ["idem", "example:unchanged"],
          "동시": ["revision", "409:version_conflict", "note:가예약과는 날짜 행 잠금 순서(G3)"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-028", method="get", path="/owner/calendar/days", op="listCalendarDays", tag="영업 캘린더",
   summary="날짜별 남은 자리와 마감 현황", spec=["SPEC-007", "SPEC-012", "SPEC-015"], auth="owner",
   desc="from~to(62일까지)의 날마다 하루 최대 개수·잡힌 자리·남은 자리·마감·마감 후 추가 수락. 남은 자리 수는 사장님 화면에만(G6). 순서: 날짜 순(from부터 to까지 하루 한 행). 나누지 않고 한 번에 준다(DEC-14의 예외).",
   params=[q("from", {"type": "string", "format": "date"}, "첫 날(가게 시간대)", "2026-11-19", True),
           q("to", {"type": "string", "format": "date"}, "끝 날. from부터 62일까지", "2026-11-23", True)],
   ok=[(200, "CalendarDayList", {"days": E.CALENDAR_DAYS})],
   errors={404: ["shop_not_registered", "not_set"]},
   fields=[("query:to", "out_of_range")],
   omit={"403": O403, "409": O409_READ},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_set"],
          "노출": ["closed", "note:남은 자리 수는 사장님에게만(G6)"], "빈·끊김": ["note:from~to의 날마다 한 행이라 빈 목록이 없음"],
          "화면": ["screen"]})

op(id="API-029", method="patch", path="/owner/calendar/days/{day}", op="updateCalendarDay", tag="영업 캘린더",
   summary="그날 휴무·하루 최대 개수·주문 마감 수정", spec=["SPEC-007", "SPEC-012", "SPEC-015"], auth="owner", idem=True,
   desc="날짜별 휴무, 그날만 다른 하루 최대 개수, 그날 주문 마감(SPEC-012)을 바꾼다. 이미 잡힌 자리는 그대로이고, 마감을 풀면 다시 잡는다. "
        "이미 마감된 날을 다시 마감하면 unchanged. 지난 날짜는 422(path:day in_past). 잡힌 자리나 확정 주문이 있는 날을 휴무로 바꾸거나 하루 최대 개수를 이미 잡힌 자리보다 낮추면 저장 전에 409 confirmation_required와 conflicts의 관련 주문을 보인다(REQ-261).",
   params=[pday("2026-11-20", "바꿀 날")],
   body="CalendarDayInput",
   body_examples={"close_orders": {"baseRevision": E.calendar_day("2026-11-20", held=5)["revision"], "manuallyClosed": True},
                  "day_off_confirmed": {"baseRevision": E.calendar_day("2026-11-20", held=5)["revision"], "closed": True,
                                        "confirm": ["closed_day_with_orders"]}},
   ok=[(200, "CalendarDayResult", {"closed_orders": {"outcome": "done", "day": E.calendar_day("2026-11-21", held=1, manual=True)},
                                   "unchanged": {"outcome": "unchanged", "day": E.calendar_day("2026-11-21", held=1, manual=True)}})],
   errors={404: ["shop_not_registered", "not_set"], 409: ["version_conflict", "confirmation_required"]},
   fields=[("path:day", "in_past")],
   confirm=["closed_day_with_orders", "capacity_below_held"],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"],
          "대상": ["422:validation_failed", "note:지난 날짜는 path:day in_past"], "상태": ["example:unchanged", "409:confirmation_required"],
          "반복": ["idem"], "동시": ["revision", "409:version_conflict"], "노출": ["closed"], "화면": ["screen"]})

# ═══ 카카오톡 채널 ════════════════════════════════════════════════════════════
op(id="API-030", method="get", path="/owner/kakao-channel", op="getKakaoChannel", tag="카카오톡 채널",
   summary="채널 연결 상태와 스킬 설정 값", spec=["SPEC-008"], auth="owner",
   desc="연결 확인 중이면 화면이 몇 초마다 다시 읽고 시험 버튼으로 닿은 블록(verifiedBlocks)을 보인다. 10분 안에 연결 문구가 그 채널에서 오지 않거나 시험 버튼 다섯이 모두 닿지 않으면 failed와 사유 후보(failureHints, 닿지 않은 블록 포함, REQ-206). 연결 확인 중이면 연결 문구(proofPhrase)와 '연결 확인 중' 선점이 풀리는 시각(claimExpiresAt)을 보인다(REQ-238). "
        "연결됨이면 먼저 보내기 상태(eventStatus: 시험 안내 결과 기다림·됨·안 됨과 사유 eventFailReason)를 보인다. 안 됨이면 그 가게의 손님 안내는 모두 다음 대화 때 전한다(REQ-180, REQ-181, DEC-20). "
        "스킬 키 값은 이 응답에 없고 버전(skill.keyVersion)·만든 시각·앞 버전 키를 받는 끝(skill.previousKeyValidUntil)만 보인다. "
        "키는 연결을 만들 때(API-031)와 바꿀 때(API-079)의 응답에만 한 번 보인다(DEC-08, REQ-237).",
   ok=[(200, "KakaoChannel", {"pending": E.CHANNEL_CHECKING, "linked": E.CHANNEL_LINKED, "failed": E.CHANNEL_FAILED,
                              "event_checking": E.CHANNEL_EVENT_CHECKING, "event_unavailable": E.CHANNEL_EVENT_UNAVAILABLE})],
   errors={404: ["shop_not_registered", "not_set"]},
   omit={"403": O403, "409": O409_READ, "422": O422_NOINPUT},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:not_set"], "외부": ["example:failed", "example:event_unavailable"],
          "상태": ["example:event_checking"],
          "노출": ["closed", "note:스킬 키 값은 없고 버전만(DEC-08, REQ-237)", "note:연결 문구는 연결 확인 중에만(REQ-238)"], "빈·끊김": ["404:not_set"], "화면": ["screen"]})

op(id="API-031", method="put", path="/owner/kakao-channel", op="setKakaoChannel", tag="카카오톡 채널",
   summary="연결할 채널(오픈빌더 봇) 설정", spec=["SPEC-008"], auth="owner", idem=True,
   desc="오픈빌더 봇 ID와 채널 공개 ID, 카드 버튼이 부를 블록 다섯의 블록 ID(blockIds, 아직 없으면 null, REQ-206)를 받아 '연결 확인 중' 연결을 만들고, "
        "오픈빌더에 넣을 스킬 주소 넷(메시지·카드·후기·안내)과 안내 블록의 이벤트 이름을 반환하고, 새 연결이면(created) 헤더 값인 스킬 키를 이 응답에만 한 번 포함한다(skillKey, DEC-08, DEC-20, REQ-237). "
        "같은 요청 키로 다시 온 요청(DEC-04)에는 그 키 버전이 지금 버전이면 같은 키를 다시 보인다. "
        "같은 봇의 블록 ID만 바꾸면 새 연결을 만들지 않고 그 연결을 '연결 확인 중'으로 되돌려 닿은 블록과 먼저 보내기 상태를 비운다(같은 봇의 연결은 하나, 05단계 `kakao_channels_bot_active_uq`). "
        "다시 연결될 때까지 그 채널의 손님 메시지에는 not_accepting으로 답한다(blocks_changed). "
        "그 봇이 다른 가게에 연결됐거나 다른 가게의 '연결 확인 중' 선점이 남았으면 묶지 않고 409 channel_linked_elsewhere, 운영자에게 알림(SPEC-008). "
        "'연결 확인 중' 연결은 저장이나 연결 확인 시작에서 30분 동안 그 봇을 잡고, 그 시각이 지나면 다른 가게가 같은 봇을 넣을 때 연결 안 됨이 되어 풀린다(claimExpiresAt, REQ-238, 남이 먼저 넣어 막힌 봇은 OPEN-10). "
        "연결된 채널을 바꾸면 새 채널이 연결될 때 옛 채널 메시지를 그만 받는다. 예약 링크는 내리지 않고 문의 버튼이 새 채널을 연다. "
        "오픈빌더의 설정 → 기본 정보의 봇 ID를 저장한다. 스킬에 붙은 끝 느낌표 하나를 제거해 기본 ID와 비교한다(DEC-28, K-09). "
        "Open: 꾸민 스킬 요청과 카카오의 요청을 가를 수단(요청 출처)이 문서에 없어 11단계 전에 카카오에 문의하고, 남이 먼저 넣어 막힌 봇은 운영자가 확인하고 풂(OPEN-10).",
   body="KakaoChannelInput", body_examples={"connect": dict(E.CHANNEL_INPUT, baseRevision=None)},
   ok=[(200, "KakaoChannelResult", {"created": {"outcome": "created", "kakaoChannel": E.CHANNEL_PENDING, "skillKey": E.SKILL_KEY_SHOWN},
                                    "unchanged": {"outcome": "unchanged", "kakaoChannel": E.CHANNEL_PENDING, "skillKey": None},
                                    "blocks_changed": {"outcome": "done", "kakaoChannel": E.CHANNEL_PENDING, "skillKey": None}})],
   errors={404: ["shop_not_registered"], 409: ["version_conflict", "channel_linked_elsewhere"]},
   fields=[("/botId", "required"), ("/blockIds/review", "too_long")],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["409:channel_linked_elsewhere", "note:30분 지난 '연결 확인 중' 선점은 다른 가게가 같은 봇을 넣을 때 풀림(REQ-238)"],
          "상태": ["note:바꾸면 새 채널이 연결될 때 옛 채널은 그만 받음", "example:blocks_changed"], "반복": ["idem", "example:unchanged"],
          "동시": ["revision", "409:version_conflict"], "노출": ["closed", "note:스킬 키는 created 응답에만 한 번(DEC-08)"], "화면": ["screen"]})

op(id="API-032", method="post", path="/owner/kakao-channel/check", op="startKakaoChannelCheck", tag="카카오톡 채널",
   summary="연결 확인 시작(10분)", spec=["SPEC-008"], auth="owner", idem=True,
   desc="'연결 확인'을 누르면 10분 동안 연결 문구와 시험 버튼을 기다린다. 응답의 연결 문구(proofPhrase, '연결 ' 뒤에 숫자 6자리)는 사장님 화면에만 보이고 저장하지 않는다(서버 시크릿과 연결 ID·연결 확인 시작 시각으로 만듦, DEC-08). "
        "사장님이 그 채널 대화창에서 이 문구를 보내 메시지 스킬(API-070)로 오면 그 사용자를 시험 사용자로 남기고 시험 버튼을 하나씩 답하며(channel_test_card), 다른 말로는 시험이 시작되지 않는다(REQ-238). "
        "버튼이 카드 스킬(API-071)이나 후기 스킬(API-072)에 닿을 때마다 그 블록을 확인됨으로 남긴다(block_verified). 다섯이 모두 닿으면 '연결됨'이 되고(channel_linked) "
        "무료 MVP에서는 손님 안내를 다음 대화 때 전한다. 실제 시험 안내의 요청/발송 결과 확인은 TASK-167 이후에 진행한다(REQ-206, REQ-180, DEC-20). 연결 확인을 시작하면 '연결 확인 중' 선점이 풀리는 시각을 그때부터 30분으로 늘린다(REQ-238). 블록 ID가 하나라도 비면 시작하지 않고 409 channel_setup_incomplete. "
        "여러 번 눌러도 연결은 하나(G2): 확인 중이면 unchanged, 연결 안 됨이면 다시 10분을 센다. 다른 가게가 그 봇을 선점/연결했으면 409 channel_linked_elsewhere이고 운영자에게 알린다. "
        "무료 MVP에서는 Event API의 실제 발신을 건너뛴다. 연결됨이면 먼저 보내기 상태와 관계없이 unchanged이고 시험 안내를 요청하거나 조회하지 않는다. 발신 권한과 월렛 연결 시험은 TASK-167에서 진행한다(DEC-20). "
        "Open: 연결 문구는 화면을 본 사장님만 알지만 그 요청이 카카오에서 왔는지는 증명하지 못함. 11단계 전에 카카오에 요청 출처를 문의(OPEN-10).",
   ok=[(200, "KakaoChannelResult", {"started": {"outcome": "done", "kakaoChannel": E.CHANNEL_CHECKING, "skillKey": None},
                                    "unchanged": {"outcome": "unchanged", "kakaoChannel": dict(E.CHANNEL_LINKED, eventStatus="unchecked", eventCheckedAt=None, eventFailReason=None), "skillKey": None}})],
   errors={404: ["shop_not_registered", "not_set"], 409: ["channel_setup_incomplete", "channel_linked_elsewhere"]},
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed", "note:본문이 없고 요청 키 헤더만 받음"],
          "대상": ["404:not_set", "409:channel_linked_elsewhere"], "상태": ["409:channel_setup_incomplete", "note:무료 MVP의 연결됨은 먼저 보내기 상태와 관계없이 unchanged"], "반복": ["idem", "example:unchanged"],
          "외부": ["note:10분 안에 연결 문구와 시험 버튼 다섯이 없으면 API-030에서 failed", "note:시험 안내 결과는 API-030의 eventStatus"],
          "노출": ["closed"], "화면": ["screen"]})

op(id="API-079", method="post", path="/owner/kakao-channel/skill-key", op="regenerateSkillKey", tag="카카오톡 채널",
   summary="스킬 키 바꾸기", spec=["SPEC-008", "SPEC-017"], auth="owner", idem=True,
   desc="지금 연결의 스킬 키를 새 버전으로 바꾸고 새 키를 이 응답에만 한 번 보인다(skillKey, DEC-08, REQ-237, 설계 재검토 RD-06). 키는 서버 시크릿과 연결 ID·버전으로 만들어 저장하지 않는다. "
        "previousKey가 keep_24h면 앞 버전 키도 바꾼 때부터 24시간 받아 사장님이 오픈빌더의 헤더 값을 바꾸고 배포하는 동안 손님 메시지가 끊기지 않고, "
        "revoke_now면 앞 버전 키를 바로 거절한다(키가 샜을 때). 그 전 버전은 늘 거절한다. "
        "같은 요청 키로 다시 온 요청(DEC-04)은 키를 다시 바꾸지 않고, 처음 결과의 버전이 지금 버전이면 같은 키를 다시 보인다(응답을 받지 못한 화면을 위해). "
        "연결이 없으면 404 not_set. 바꾼 뒤 사장님은 오픈빌더 스킬 설정의 헤더 값을 새 키로 바꾸고 배포한다.",
   body="SkillKeyRegenerateInput",
   body_examples={"keep_24h": {"baseRevision": E.CHANNEL_LINKED["revision"], "previousKey": "keep_24h"},
                  "revoke_now": {"baseRevision": E.CHANNEL_LINKED["revision"], "previousKey": "revoke_now"}},
   ok=[(200, "KakaoChannelResult", {"regenerated": {"outcome": "done", "kakaoChannel": E.CHANNEL_KEY_ROTATED, "skillKey": E.SKILL_KEY_SHOWN_V2},
                                    "revoked": {"outcome": "done", "kakaoChannel": E.CHANNEL_KEY_REVOKED, "skillKey": E.SKILL_KEY_SHOWN_V2}})],
   errors={404: ["shop_not_registered", "not_set"], 409: ["version_conflict"]},
   fields=[("/previousKey", "not_allowed")],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_set"],
          "상태": ["example:revoked", "note:앞 버전 키는 바꾼 뒤 24시간 받거나 바로 끊음(REQ-237)"], "반복": ["idem", "note:같은 요청 키로 다시 오면 키를 다시 바꾸지 않음"],
          "동시": ["revision", "409:version_conflict"], "노출": ["closed", "note:새 키는 이 응답에만 한 번(DEC-08)"], "화면": ["screen"]})

# ═══ 장부 ═════════════════════════════════════════════════════════════════════
op(id="API-033", method="get", path="/owner/ledger", op="getLedger", tag="장부",
   summary="장부 연결 상태", spec=["SPEC-009", "SPEC-064"], auth="owner",
   desc="우리가 쓰는 열의 헤더와 자리, 실패가 이어진 때와 아직 못 적은 쓰기 수(SPEC-064). 구글 OAuth 토큰은 시크릿 저장소에만 있고 응답에 없다(REQ-135).",
   ok=[(200, "LedgerLink", {"linked": E.LEDGER, "auth_lost": E.LEDGER_FAILING, "unlinked": E.LEDGER_UNLINKED})],
   errors={404: ["shop_not_registered", "not_set"]},
   omit={"403": O403, "409": O409_READ, "422": O422_NOINPUT},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:not_set"], "외부": ["example:auth_lost"], "노출": ["closed"],
          "빈·끊김": ["404:not_set"], "화면": ["screen"]})

op(id="API-034", method="post", path="/owner/ledger/authorization", op="startLedgerAuthorization", tag="장부",
   summary="구글 권한 요청 시작", spec=["SPEC-009"], auth="owner",
   desc="구글 권한 요청 화면 주소와 서버가 서명한 state를 반환한다. 기록을 바꾸지 않아 요청 키를 받지 않는다(DEC-04 밖).",
   body="LedgerAuthorizationInput", body_examples={"start": {"redirectUri": "https://siljang.example/owner/ledger/callback"}},
   ok=[(200, "LedgerAuthorization", {"authorization": E.LEDGER_AUTH})],
   errors={404: ["shop_not_registered"]},
   fields=[("/redirectUri", "not_allowed")],
   omit={"403": O403, "409": "기록을 바꾸지 않음(서명한 state만 만듦)"},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:shop_not_registered"],
          "노출": ["closed"], "화면": ["screen"]})

op(id="API-035", method="put", path="/owner/ledger", op="linkLedger", tag="장부",
   summary="장부 연결·다시 연결", spec=["SPEC-009", "SPEC-064"], auth="owner", idem=True,
   desc="구글 인가 코드와 고른 시트·탭으로 장부를 연결하고 우리 열 헤더를 만든다. 같은 이름의 사장님 열이 있으면 오른쪽 빈 열에 만들고 movedRight(REQ-127). "
        "다시 연결하면 '연결 끊김'으로 남은 주문들의 행을 지금 값으로 다시 적는다. 구글 권한이 거부되거나 시트를 열 수 없으면 연결하지 않는다.",
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
          "외부": ["422:google_authorization_failed", "503:google_unavailable"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-036", method="delete", path="/owner/ledger", op="unlinkLedger", tag="장부",
   summary="장부 연결 해제", spec=["SPEC-009"], auth="owner", idem=True,
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
   summary="예약 링크와 미충족 조건", spec=["SPEC-010"], auth="owner",
   desc="조건(가격표·운영규정·영업 캘린더·영업 신고 확인·채널 연결·결제 수단)이 모두 채워지면 서버가 처리방침을 만들고 링크를 한 번 낸다. 낸 링크는 같은 주소로 유지. "
        "미충족 조건은 missing, 막지 않지만 넣으면 좋은 것은 recommended(픽업 장소, DEC-13). 결제 수단을 조건에 더한 것은 DEC-12(REQ-164). "
        "privacy_policy는 국외 이전 항목이 비어 운영자가 채울 때까지 링크가 나가지 않음을 뜻한다.",
   ok=[(200, "BookingLink", {"issued": E.BOOKING_ISSUED, "not_ready": E.BOOKING_NOT_READY})],
   errors={404: ["shop_not_registered"]},
   omit={"403": O403, "409": O409_READ, "422": O422_NOINPUT},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:shop_not_registered"], "상태": ["example:not_ready"],
          "동시": ["note:조건 둘이 동시에 채워져도 링크는 하나(G2)"], "노출": ["closed"], "빈·끊김": ["example:not_ready"], "화면": ["screen"]})

op(id="API-038", method="get", path="/public/shops/{slug}", op="getBookingPage", tag="예약 링크",
   summary="예약 링크 페이지", spec=["SPEC-011", "SPEC-014", "SPEC-063"], auth="public",
   desc="누구나 연다. 포트폴리오(손님이 게시에 동의하고 철회하지 않은 완성 사진·후기 사진만, REQ-209), 현재 버전의 가격표(가게가 도안으로 올린 견본 사진은 손님 동의 없이 보임, REQ-210), 오늘부터 60일의 날(받음·마감·휴무, 남은 자리 수 없음), 가게 신원 정보, 처리방침 주소, 문의 주소. "
        "같은 주소에서 1분에 60번을 넘으면 429(DEC-16). 응답은 최대 60초 캐시되어 내린 사진은 예약 링크 페이지에서 5분 안에 사라진다(SPEC-063). "
        "채널을 열 수 없으면 화면이 inquiryUrl을 글로 보인다.",
   params=[PSLUG],
   ok=[(200, "BookingPage", {"page": E.BOOKING_PAGE, "no_photos": E.BOOKING_PAGE_NO_PHOTOS}, ["Cache-Control"])],
   errors={404: ["not_found"], 429: ["rate_limited"]},
   omit={"401": O401_PUBLIC, "403": O403_PUBLIC, "409": O409_READ, "422": "주소 밖 입력이 없음. 형식이 틀린 주소는 404(DEC-02)"},
   kinds={"대상": ["404:not_found"], "상태": ["note:다 참·마감·추가 수락한 날은 '마감', 휴무는 '휴무'"], "한도": ["429:rate_limited"],
          "외부": ["note:채널을 열 수 없으면 화면이 inquiryUrl을 글로"], "노출": ["closed", "note:손님 이름·주문·남은 자리 수·내부 ID 없음(G6)"],
          "빈·끊김": ["example:no_photos"], "화면": ["screen"]})

op(id="API-039", method="get", path="/public/shops/{slug}/privacy-policy", op="getPrivacyPolicy", tag="예약 링크",
   summary="가게 개인정보 처리방침", spec=["SPEC-010", "SPEC-011", "SPEC-018"], auth="public",
   desc="가장 최근 버전. 국외 이전 다섯 항목(REQ-141)을 받는 자마다 포함한다. AI 상담 고지가 이 주소를 건다(SPEC-018): 고지의 링크는 늘 가장 최근 버전을 보이고, 고지 때 게시된 버전은 05단계 consultations.ai_disclosed_policy_version에 남는다(설계 재검토 RC-20). 처리하는 개인정보 항목에 알레르기 정보(따로 동의한 손님에게서만, 쓰는 목적·보는 사람·지우는 때)를 적고, AI를 거치지 않는 입력으로 받으므로 AI 모델 회사의 국외 이전 항목에는 넣지 않는다(REQ-204, SPEC-010, SPEC-075).",
   params=[PSLUG],
   ok=[(200, "PrivacyPolicy", {"policy": E.PRIVACY}, ["Cache-Control"])],
   errors={404: ["not_found"], 429: ["rate_limited"]},
   omit={"401": O401_PUBLIC, "403": O403_PUBLIC, "409": O409_READ, "422": "주소 밖 입력이 없음. 형식이 틀린 주소는 404(DEC-02)"},
   kinds={"대상": ["404:not_found"], "한도": ["429:rate_limited"], "노출": ["closed"], "화면": ["screen"]})

# ═══ 할 일 ════════════════════════════════════════════════════════════════════
op(id="API-040", method="get", path="/owner/tasks", op="listOwnerTasks", tag="할 일",
   summary="할 일 목록", spec=["SPEC-067", "SPEC-022", "SPEC-024", "SPEC-037"], auth="owner",
   desc="사장님이 정할 일(에스컬레이션 건·맞춤 주문·결제 확인 요청·맞추는 중·결제 기한 지남·변경 요청·문제 신고·환불 결정·취소 뒤 들어온 입금·장부 다시 연결·영업 신고 보류·영업 캘린더 기준을 넘는 날·환불 보내기(REQ-173)·들어온 입금 대조(REQ-167)). 환불 보내기는 '보냄'을 표시하면 닫히고, 정한 뒤 24시간이 지나면 한 번 다시 알린다. "
        "기다림 상태(waitStatus)는 에스컬레이션 건·맞춤 주문·변경 요청·문제 신고·결제 확인 요청·맞추는 중·환불 결정에만(SPEC-024, REQ-215): 기다림·지연·답함·답 없어 닫힘. "
        "답 없어 닫힘은 에스컬레이션 건(7일)·맞춤 주문(그 픽업 날짜의 주문 마감)·변경 요청(변경 마감)·결제 확인 요청(결제 기한 상한)만이고, 맞추는 중·환불 결정·문제 신고는 지연 뒤에도 할 일 목록에 남는다(1-7). subject가 열 화면. "
        "알림은 우리 서비스 채널로 가고, 사장님이 채널 친구가 아니면 alertChannelFriend false(SPEC-067). 순서: 열린 할 일은 지연(waitStatus late)이 앞, 그다음 기다림 기한(waitDueAt)이 이른 것, 기다림 기한이 없는 할 일은 그 뒤에 연 시각(openedAt) 순. 닫힌 할 일은 닫힌 시각(closedAt)이 늦은 것이 앞. 같으면 할 일 ID 순(DEC-14, 설계 재검토 RD-13).",
   params=[q("status", {"type": "string", "enum": ["open", "closed"]}, "열림·닫힘. 없으면 open", "open"), CURSOR, LIMIT,
           {"name": "X-Expected-Shop-Id", "in": "header", "required": False, "schema": {"type": "string", "format": "uuid"},
            "description": "API-002로 확인한 가게. 사장님 웹은 첫 조회·새로 고침·추가 조회에 항상 보낸다. 현재 세션의 가게와 다르거나 형식이 틀리면 목록을 읽기 전에 401 unauthenticated이고 웹은 내 정보를 다시 확인한다. 권한이나 조회 대상을 고르는 값이 아니며 가게는 세션으로만 정한다. 헤더가 없는 기존 호출도 허용한다."}],
   ok=[(200, "OwnerTaskList", {"open_tasks": E.TASKS, "not_friend": E.TASKS_NOT_FRIEND, "empty": E.TASKS_EMPTY})],
   errors={404: ["shop_not_registered"]},
   fields=[("query:status", "not_allowed")],
   omit={"403": O403, "409": O409_READ},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:shop_not_registered"],
          "상태": ["example:not_friend"], "반복": ["note:할 일마다 한 번(이벤트 키, G2)"],
          "노출": ["closed", "note:summary에 손님 연락처·계좌·알레르기 없음(SPEC-067)"], "빈·끊김": ["example:empty"], "화면": ["screen"]})

# ═══ 에스컬레이션 건과 상담 ═════════════════════════════════════════════════════════
op(id="API-041", method="get", path="/owner/handoffs/{handoffId}", op="getHandoff", tag="에스컬레이션 건·상담",
   summary="에스컬레이션 건 하나", spec=["SPEC-022", "SPEC-023", "SPEC-021", "SPEC-079"], auth="owner",
   desc="에스컬레이션한 사유와 손님 말(전화번호·계좌번호는 원래 값으로 되돌린 글, 카드번호는 플레이스홀더와 끝 4자리, 긴 숫자는 플레이스홀더만, SPEC-021), 그 뒤 이 건에 덧붙은 질문(질문마다 사유와 관련 주문). 마감된 날 질문이면 requestedDay(마감된 날 질문은 열린 건에 덧붙지 않고 상담과 날짜마다 따로 건, SPEC-022). 다른 카카오 사용자의 사정도 관련 주문이 있으면 열린 건에 덧붙지 않고 상담과 주문마다 따로 건(SPEC-022). 추가 수락을 쓴 주문 요청이 있으면 dayUsedOrder. 결제 기다림 주문 한도 건(사유 order_limit)도 열린 건에 덧붙지 않고 상담마다 따로 건이고(SPEC-022), 그 손님의 결제 기다림 주문을 awaitingPaymentOrders로, 사장님이 고른 것을 limitDecision으로, 한도를 넘겨 받은 것을 쓴 주문 요청을 limitUsedOrder로 본다(SPEC-023). "
        "남긴 지 7일 동안 사장님 답이 없으면 서버가 status closed_no_answer와 closedAt으로 닫고 손님에게 다시 물어 달라고 한 번 알린다(REQ-216). "
        "사유가 다른 카카오 사용자(other_user)이고 관련 주문이 받은 주문인 열린 건이면 화면이 '이 주문의 문제 신고로 남기기'(API-083)를 보이고, 남긴 신고는 issueReport로 본다(SPEC-079). "
        "그 손님에게는 주문 내용·금액·주문자를 보이지 않았고, 관련 주문은 사장님 화면에만 보인다(REQ-252).",
   params=[pid("handoffId", "에스컬레이션 건", E.HANDOFF["handoffId"])],
   ok=[(200, "Handoff", {"edibility": E.HANDOFF, "closed_day": E.HANDOFF_DAY, "closed_no_answer": E.HANDOFF_CLOSED,
                         "other_user_reported": E.HANDOFF_OTHER_USER_REPORTED, "order_limit": E.HANDOFF_LIMIT})],
   errors={404: ["not_found"]},
   omit={"403": O403, "409": O409_READ, "422": O422_PATHONLY},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:not_found"], "상태": ["example:closed_no_answer", "example:order_limit"],
          "노출": ["closed", "note:원래 값은 그 가게 사장님 화면과 사유를 적고 연 운영자에게만(SPEC-021, DEC-19)"], "화면": ["screen"]})

op(id="API-042", method="post", path="/owner/handoffs/{handoffId}/answer", op="answerHandoff", tag="에스컬레이션 건·상담",
   summary="에스컬레이션 건 답변", spec=["SPEC-023", "SPEC-024", "SPEC-066", "SPEC-029"], auth="owner", idem=True,
   desc="사장님 답을 AI가 고치지 않고 그대로 손님에게 전한다(친구면 바로, 아니면 다음 대화 때 먼저, SPEC-066). 기다림 타이머를 멈춘다(SPEC-024). "
        "마감된 날 질문이면 dayDecision: 추가 수락이면 그 상담의 그 날을 24시간 동안 추가 수락한 날로 표시하고, 그 안에 그 날짜로 온 주문 요청 하나가 마감 후 추가 수락으로 자리를 잡아 dayUsedOrder로 남는다(다시 쓰지 않음, SPEC-023). 결제 기다림 주문 한도 건이면 limitDecision: 한도를 넘겨 받기면 그때부터 24시간 동안 그 상담의 기본 디자인 주문 요청 하나가 한도를 넘겨 남아 limitUsedOrder로 남고(다시 쓰지 않음), 손님에게 '사장님이 주문을 받기로 했어요'와 새 주문 요청 확인 카드(처음 카드의 버튼은 G2대로 처음 결과)를 보낸다. 받지 않음이면 '결제를 기다리는 주문을 결제하거나 취소하면 새 주문을 요청할 수 있어요'를 보낸다(SPEC-023, REQ-264). text를 함께 보내면 그 답도 그대로 전한다. 사유가 order_limit이 아닌 건에 limitDecision을 보내면 422 /limitDecision not_allowed. "
        "이미 답한 질문은 409 already_decided. 남긴 지 7일 동안 답이 없어 '답 없어 닫힘'으로 닫힌 건은 409 invalid_state(손님이 다시 물으면 새 건, REQ-216). "
        "사장님이 화면을 연 뒤 손님 말이 덧붙었으면 409 version_conflict.",
   params=[pid("handoffId", "에스컬레이션 건", E.HANDOFF["handoffId"])],
   body="HandoffAnswerInput",
   body_examples={"answer": {"baseRevision": E.HANDOFF["revision"], "text": E.HANDOFF_ANSWERED["answerText"]},
                  "accept_day": {"baseRevision": E.HANDOFF_DAY["revision"], "dayDecision": "accepted", "text": "20일 받아 드릴게요. 주문을 이어가 주세요."},
                  "accept_limit": {"baseRevision": E.HANDOFF_LIMIT["revision"], "limitDecision": "accepted"}},
   ok=[(200, "HandoffAnswerResult", {"sent": {"outcome": "done", "handoff": E.HANDOFF_ANSWERED, "delivery": "sent"},
                                     "deferred": {"outcome": "done", "handoff": E.HANDOFF_DAY_ACCEPTED, "delivery": "deferred"},
                                     "limit_accepted": {"outcome": "done", "handoff": E.HANDOFF_LIMIT_ACCEPTED, "delivery": "sent"}})],
   errors={404: ["not_found"], 409: ["version_conflict", "already_decided", "invalid_state"]},
   fields=[("/text", "too_long"), ("/limitDecision", "not_allowed")],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "상태": ["409:already_decided", "409:invalid_state", "example:limit_accepted"], "반복": ["idem"], "동시": ["revision", "409:version_conflict"],
          "외부": ["example:deferred"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-083", method="post", path="/owner/handoffs/{handoffId}/issue-report", op="reportIssueFromHandoff", tag="에스컬레이션 건·상담",
   summary="에스컬레이션 건에서 문제 신고로 남기기", spec=["SPEC-079", "SPEC-058", "SPEC-059"], auth="owner", idem=True,
   desc="주문자가 아닌 카카오 사용자가 받은 주문의 문제를 말해 넘어온 에스컬레이션 건(사유 other_user, REQ-253)에서 사장님이 '이 주문의 문제 신고로 남기기'를 누른다. "
        "서버는 그 건의 상담에 신고 내용(설명, 사진 없음)을 신고됨으로 두고, 그 건의 관련 주문에 문제 신고(reportedBy owner_from_handoff, 그 건)를 남긴다. "
        "신고 기한은 그 건이 생긴 시각으로 보고 기한 뒤면 사장님 화면에만 '기한 뒤'(late). 같은 주문에 열린 신고가 있으면 받되 첫 신고에 잇는다(SPEC-058과 같음). "
        "할 일 '문제 신고'를 올리되 사장님 알림과 문제 신고의 지연 안내(SPEC-024)는 보내지 않고, 그 건의 기다림과 7일 '답 없어 닫힘'은 그대로 돈다. 건은 이때 닫지 않는다(답할 때 닫힘, API-042). "
        "보상은 보상 결정(API-065)으로 정하고 보상 안내는 보내지 않는다. 환불은 결제한 주문자에게 돌아가 지금 환불 안내 규칙대로 알리고, 신고한 사람에게는 사장님이 그 건에 답해 결과를 전한다(DEC-24). "
        "사유가 other_user가 아니거나, 관련 주문이 없거나, 받은 주문(픽업 완료됨·퀵으로 보냄)이 아니거나, 건이 닫혔으면 남기지 않고 409 invalid_state. 다른 카카오 사용자의 사정은 관련 주문이 있으면 다른 열린 건에 덧붙지 않고 상담과 주문마다 따로 건이 되므로(SPEC-022) 그 건의 사유와 관련 주문으로 본다. "
        "이 건에서 남긴 신고가 이미 있으면 baseRevision과 상관없이 새로 남기지 않고 그 신고와 함께 200 unchanged(한 건에 신고 하나, G2). 화면을 연 뒤 손님 말이 덧붙었으면 409 version_conflict. "
        "AI·손님은 이 명령을 낼 수 없다(AI 도구에 없음).",
   params=[pid("handoffId", "에스컬레이션 건", E.HANDOFF_OTHER_USER["handoffId"])],
   body="IssueFromHandoffInput",
   body_examples={"from_handoff": {"baseRevision": E.HANDOFF_OTHER_USER["revision"], "description": E.ISSUE_FROM_HANDOFF["description"]}},
   ok=[(201, "IssueFromHandoffResult", {"created": {"outcome": "done", "issueReport": E.ISSUE_FROM_HANDOFF, "handoff": E.HANDOFF_OTHER_USER_REPORTED}}),
       (200, "IssueFromHandoffResult", {"unchanged": {"outcome": "unchanged", "issueReport": E.ISSUE_FROM_HANDOFF, "handoff": E.HANDOFF_OTHER_USER_REPORTED}})],
   errors={404: ["not_found"], 409: ["version_conflict", "invalid_state"]},
   fields=[("/description", "too_long")],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated", "note:사장님만. AI·손님은 이 명령을 낼 수 없음(AI 도구에 없음)"], "입력": ["422:validation_failed"],
          "대상": ["404:not_found"], "상태": ["409:invalid_state"], "반복": ["idem", "example:unchanged"], "동시": ["revision", "409:version_conflict"],
          "외부": ["note:문제 신고의 지연 안내(SPEC-024)와 사장님 알림은 보내지 않음. 그 건의 기다림이 그대로 돎(DEC-24)"],
          "노출": ["closed", "note:신고한 사람에게는 주문 내용·금액·주문자를 보이지 않고 보상 안내도 보내지 않음(REQ-252, DEC-24)"], "화면": ["screen"]})

op(id="API-043", method="get", path="/owner/consultations/{consultationId}/messages", op="listConsultationMessages", tag="에스컬레이션 건·상담",
   summary="상담 대화 조회", spec=["SPEC-021", "SPEC-019", "SPEC-068", "SPEC-065"], auth="owner",
   desc="그 가게 상담만. 사장님 화면에는 마스킹한 전화번호·계좌번호를 원래 값으로 되돌린 글과 참고 사진(서명 주소)이 보인다. 카드번호는 플레이스홀더와 끝 4자리, 주민등록번호처럼 보이는 숫자와 긴 숫자는 플레이스홀더만 보인다(원래 값을 두지 않음, REQ-192). "
        "그 상담의 손님 안내(05단계 notifications)도 함께 준다: 사장님 답은 author owner, 서버가 보낸 그 밖의 안내(결제 안내·확정 안내·지연 안내 등)는 author notice이고 direction outbound, kind text, 사진 없음. 안내의 at은 전한 시각(아직 못 전했으면 만든 시각), delivery는 보내는 중 sending·먼저 보냄 event_api·다음 대화 때 전할 것 deferred·그렇게 전함 delivered_later·보내지 못함 failed. 결제 안내의 계좌번호 자리는 채우지 않은 글 그대로이고, 주문이 끝나고 30일이 지나 지운 그 주문의 안내는 빠진다(SPEC-065, 설계 재검토 RD-17). "
        "순서: 시각(at) 순이고 새 메시지가 뒤, 같은 시각이면 남긴 차례(DEC-14). 기본 direction forward는 처음부터 이후 페이지를 읽는다. direction backward는 최근 limit개를 읽고 nextCursor로 그보다 이전 페이지를 읽는다. 어느 방향도 items는 시각/남긴 차례 오름차순이다. 뒤로 읽기의 reloadCursor로 같은 limit/방향을 요청하면 고정한 첫 가시성/삽입 상한과 페이지 위치에서 사진 주소를 새로 받는다. 새 메시지가 와도 그 페이지가 밀리지 않으며 새로 고침은 커서 없는 뒤로 읽기로 최신 대화를 받는다. 방향이 다른 커서는422이고 이전 정방향 커서는 그대로 쓴다. "
        "다룬 주문이 모두 끝나 상담 끝남으로 닫힌 상담(SPEC-025)은 status ended로 대화가 지우기 전까지 그대로 보이고, 그 손님의 다음 말은 새 상담에 남는다. "
        "지워진 상담(SPEC-065)은 status deleted와 빈 items.",
   params=[pid("consultationId", "상담", E.CONSULT_ID), CURSOR, LIMIT,
           q("direction", {"type": "string", "enum": ["forward", "backward"], "default": "forward"}, "앞에서 이후 페이지 또는 최근부터 이전 페이지. 응답 안에서는 항상 시각/남긴 차례 오름차순", "backward"),
           {"name": "X-Expected-Shop-Id", "in": "header", "required": False, "schema": {"type": "string", "format": "uuid"},
            "description": "API-002로 확인한 가게. 사장님 웹은 첫 조회·추가 조회·사진 재조회에 항상 보낸다. 현재 세션의 가게와 다르거나 형식이 틀리면 본문 조회와 접속기록 쓰기 전에401 unauthenticated. 권한이나 조회 대상을 고르는 값이 아니며 가게는 세션으로 정한다. 헤더가 없는 기존 호출도 허용한다."}],
   ok=[(200, "ConsultationMessagePage", {"messages": E.MESSAGES, "with_owner_reply": E.MESSAGES_WITH_REPLY,
                                         "deleted": dict(E.MESSAGES, status="deleted", items=[], nextCursor=None)})],
   errors={404: ["not_found"]},
   fields=[("query:limit", "out_of_range")],
   omit={"403": O403, "409": O409_READ},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "노출": ["closed"], "빈·끊김": ["example:deleted"], "화면": ["screen"]})

# ═══ 주문 ═════════════════════════════════════════════════════════════════════
op(id="API-044", method="get", path="/owner/orders", op="listOrders", tag="주문",
   summary="주문 목록", spec=["SPEC-031", "SPEC-037", "SPEC-068"], auth="owner",
   desc="상태·종류·픽업 날짜로 거른다. status=payment_overdue가 결제 기한 지난 주문 목록(SPEC-037)이고, paymentNotice로 결제 안내가 손님에게 전해진 시각이나 아직 못 전함(deliveredAt null)을 보인다. "
        "status=requested&kind=custom이 답할 맞춤 주문. "
        "끝나고 30일이 지나 보관 기록이 된 주문(SPEC-065, REQ-187)은 나오지 않는다. 순서: 픽업 일시(pickupAt)가 이른 주문이 앞, 같으면 요청 시각(requestedAt) 순, 그다음 주문 ID 순(DEC-14).",
   params=[q("status", {"type": "string", "enum": ["requested", "awaiting_payment", "payment_overdue", "confirmed", "received", "no_pickup", "rejected", "cancelled"]},
             "주문 상태", "requested"),
           q("kind", {"type": "string", "enum": ["standard", "custom"]}, "기본 디자인·맞춤"),
           q("pickupFrom", {"type": "string", "format": "date"}, "픽업 날짜 첫 날"),
           q("pickupTo", {"type": "string", "format": "date"}, "픽업 날짜 끝 날"), CURSOR, LIMIT],
   ok=[(200, "OrderList", {"orders": E.ORDER_LIST, "overdue": E.ORDER_LIST_OVERDUE, "awaiting_amount_confirm": E.ORDER_LIST_AWAITING_CONFIRM, "empty": E.EMPTY_PAGE})],
   errors={404: ["shop_not_registered"]},
   fields=[("query:pickupTo", "not_after_start")],
   omit={"403": O403, "409": O409_READ},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:shop_not_registered"],
          "노출": ["closed"], "빈·끊김": ["example:empty"], "화면": ["screen"]})

op(id="API-045", method="get", path="/owner/orders/{orderId}", op="getOrder", tag="주문",
   summary="주문 하나", spec=["SPEC-031", "SPEC-013", "SPEC-045", "SPEC-068"], auth="owner",
   desc="주문 내용 버전(새 버전이 앞), 참고 사진, 견적과 계산 근거(사장님께 전부, SPEC-013), 픽업 날의 자리, 결제 안내·결제·환불·변경 요청·제작(완성 사진과 사진마다의 게시 동의)·문제 신고. 주문 내용 버전마다 알레르기 정보 동의(동의함·동의 안 함·동의 필요 없음)와 알레르기 답(동의 안 함이면 없음, REQ-203). "
        "다른 가게 주문과 끝나고 30일이 지나 보관 기록이 된 주문(SPEC-065, REQ-187)이면 404(SPEC-068).",
   params=[pid("orderId", "주문", E.ORDER_ID)],
   ok=[(200, "Order", {"custom_requested": E.CUSTOM_REQUESTED, "confirmed": E.ORDER_CONFIRMED, "changed": E.ORDER_CHANGED,
                       "remake": E.ORDER_REMAKE, "custom_no_answer": E.CUSTOM_NO_ANSWER})],
   errors={404: ["not_found"]},
   omit={"403": O403, "409": O409_READ, "422": O422_PATHONLY},
   kinds={"접근": ["security", "401:unauthenticated", "404:not_found"], "대상": ["404:not_found"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-046", method="post", path="/owner/orders/{orderId}/custom-decision", op="decideCustomOrder", tag="주문",
   summary="맞춤 주문 검토(수락·금액 변경 수락·거절)", spec=["SPEC-031", "SPEC-015", "SPEC-032", "SPEC-076"], auth="owner", idem=True,
   desc="수락하면 그날 자리를 결제 기한까지 잡고 결제 안내를 낸다(SPEC-032). 그날 자리가 없으면 먼저 409 confirmation_required(overbooking)이고, "
        "사장님이 확인하면 confirm에 담아 추가 수락한다(R10). "
        "'수락'(accept)은 표시 방식이 '확정'인 견적에만 있고 견적 금액으로 간다. '부터'·'범위' 견적은 금액 변경 수락(accept_with_amount)으로 최종 금액과 사유를 넣어야 하고, "
        "accept면 422 /amount required, 견적의 아래 끝보다 낮으면 422 /amount below_quote_min(REQ-230). "
        "금액을 정하거나 바꿔 수락하면 새 주문 내용 버전(사유 포함)과 손님이 요청한 견적(requestedQuote, 표시 그대로)을 함께 보이는 결제 안내를 낸다(REQ-231). "
        "정한 금액이 손님이 본 금액(표시 방식이 '확정'이면 그 금액, '부터'는 아래 끝, '범위'는 위 끝)보다 높으면 새 금액 확인이 필요한 결제 안내(needsAmountConfirm)라, 손님이 새 금액 확인 카드에서 확인한 뒤에 계좌를 보이고 그때부터 결제 기한을 센다. "
        "확인 전의 결제 기한은 결제 기한 상한이고, 손님이 받지 않으면 손님 취소로 자리를 바로 푼다(SPEC-076, REQ-232, REQ-233). "
        "휴무일이면 409 confirmation_required(closed_day)이고 확인하면 마감 후 추가 수락으로 잡는다(REQ-221). "
        "거절이면 거절됨과 손님 안내. 이미 답한 주문은 409 already_decided, 그 사이 손님이 취소했으면 409 order_cancelled, "
        "그 픽업 날짜의 주문 마감까지 답이 없어 '답 없어 닫힘'(cancelKind no_answer)으로 닫힌 요청은 409 invalid_state(REQ-213).",
   params=[pid("orderId", "주문", E.CUSTOM_ID)],
   body="CustomDecisionInput",
   body_examples={"accept_with_amount": {"baseRevision": E.CUSTOM_REQUESTED["revision"], "decision": "accept_with_amount", "amount": 75000,
                                         "amountChangeReason": "곰돌이 얼굴 입체 장식이 더해져요", "confirm": ["overbooking"]},
                  "reject": {"baseRevision": E.CUSTOM_REQUESTED["revision"], "decision": "reject", "rejectReason": "그날은 입체 장식을 만들 시간이 없어요"}},
   ok=[(200, "OrderCommandResult", {"accepted": {"outcome": "done", "order": E.CUSTOM_ACCEPTED, "paymentRequest": E.PR_CUSTOM_OPEN},
                                    "rejected": {"outcome": "done", "order": E.CUSTOM_REJECTED, "paymentRequest": None}})],
   errors={404: ["not_found"], 409: ["version_conflict", "already_decided", "order_cancelled", "invalid_state", "confirmation_required"]},
   fields=[("/amount", "out_of_range"), ("/amount", "required"), ("/amount", "below_quote_min"), ("/amountChangeReason", "required")],
   confirm=["overbooking", "closed_day"],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "상태": ["409:already_decided", "409:order_cancelled", "409:invalid_state", "409:confirmation_required"], "반복": ["idem"],
          "동시": ["revision", "409:version_conflict"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-047", method="post", path="/owner/orders/{orderId}/overdue-decision", op="decideOverdueOrder", tag="주문",
   summary="결제 기한 지난 주문: 결제 기한 연장·취소", spec=["SPEC-038", "SPEC-039", "SPEC-015", "SPEC-032", "SPEC-037"], auth="owner", idem=True,
   desc="결제 기한 연장이면 그날 자리를 새 결제 기한까지 다시 잡고 다시 낸 결제 안내를 보낸다(SPEC-038). 새 결제 기한은 그 안내가 손님에게 전해진 때부터 센다(REQ-218). "
        "남은 자리가 없으면 409 confirmation_required(overbooking), 휴무일이 됐으면 closed_day(REQ-221), 그 픽업 날짜의 주문 마감이 지났으면 past_cutoff(새 결제 기한은 픽업 일시까지). "
        "취소면 '결제 없어 취소됨', 손님 안내 한 번, 장부 쓰기(SPEC-039). 픽업 일시가 지났으면 결제 기한 연장은 409 invalid_state(취소만). "
        "픽업 일시까지 고르지 않으면 서버가 결제 없어 취소로 두고(REQ-217) 그 뒤의 고르기는 409 invalid_state. "
        "이미 고른 주문은 409 already_decided. 그 사이 결제가 확인됐으면 409 version_conflict(G3). "
        "다시 낸 결제는 손님이 요청한 견적(requestedQuote)을 그대로 보이고, 손님이 새 금액을 아직 확인하지 않은 결제 안내를 다시 내면 다시 낸 결제도 새 금액 확인이 필요하다(SPEC-076, REQ-232).",
   params=[pid("orderId", "주문", E.CUSTOM_ID)],
   body="OverdueDecisionInput",
   body_examples={"wait": {"baseRevision": E.CUSTOM_OVERDUE["revision"], "decision": "wait"},
                  "cancel": {"baseRevision": E.CUSTOM_OVERDUE["revision"], "decision": "cancel"}},
   ok=[(200, "OrderCommandResult", {"waited": {"outcome": "done", "order": E.CUSTOM_REISSUED, "paymentRequest": E.PR_REISSUE},
                                    "cancelled": {"outcome": "done", "order": E.CUSTOM_NO_PAYMENT, "paymentRequest": None}})],
   errors={404: ["not_found"], 409: ["version_conflict", "already_decided", "invalid_state", "confirmation_required"]},
   fields=[("/decision", "not_allowed")],
   confirm=["overbooking", "closed_day", "past_cutoff"],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "상태": ["409:invalid_state", "409:already_decided", "409:confirmation_required"], "반복": ["idem"],
          "동시": ["revision", "409:version_conflict"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-048", method="post", path="/owner/orders/{orderId}/shop-cancel", op="cancelOrderByShop", tag="주문",
   summary="가게 사정 취소", spec=["SPEC-048", "SPEC-016", "SPEC-015", "SPEC-071"], auth="owner", idem=True,
   desc="주문을 '가게 사정으로 취소됨'으로 두고 자리를 풀고 손님에게 알리고 장부 쓰기를 남긴다. 운영규정에 가게 사정 취소의 보상 조문이 있으면 손님 안내에 그 효과 글을 붙이고 계산에는 넣지 않는다. "
        "받은 금액(결제 안내의 들어온 금액 합, REQ-165)이 있으면 받은 금액에서 이미 정한 환불과 따로 정할 환불을 뺀 바탕 전액을 계산값으로 한 refundPreview를 반환하고 화면은 환불 결정(API-050)으로 간다. "
        "재제작 주문이면 원래 주문의 돈으로 셈하고(refundPreview.order는 원래 주문, basis.remakeOrder는 이 주문) 환불은 원래 주문에 남긴다(SPEC-060). "
        "결제 확인 요청 중이었으면 들어온 입금 대조 할 일을 남긴다(SPEC-071). "
        "받은 주문은 409 invalid_state, 이미 가게 사정으로 취소했으면 unchanged, 다른 사유로 취소된 주문은 409 already_decided.",
   params=[pid("orderId", "주문", E.ORDER_ID)],
   body="ShopCancelInput",
   body_examples={"cancel": {"baseRevision": E.ORDER_CONFIRMED["revision"], "reason": "오븐이 고장 나 그날 만들 수 없어요"}},
   ok=[(200, "ShopCancelResult", {"cancelled_paid": {"outcome": "done", "order": E.ORDER_CANCELLED_BY_SHOP, "refundPreview": E.REFUND_PREVIEW_SHOP},
                                  "cancelled_unpaid": {"outcome": "done", "order": E.ORDER_SHOP_CANCELLED_UNPAID,
                                                       "refundPreview": None},
                                  "unchanged": {"outcome": "unchanged", "order": E.ORDER_CANCELLED_BY_SHOP, "refundPreview": None}})],
   errors={404: ["not_found"], 409: ["version_conflict", "invalid_state", "already_decided"]},
   fields=[("/reason", "required")],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "상태": ["409:invalid_state", "409:already_decided", "example:unchanged"], "반복": ["idem"],
          "동시": ["revision", "409:version_conflict"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-049", method="get", path="/owner/orders/{orderId}/refund-preview", op="getRefundPreview", tag="환불",
   summary="환불 계산 미리보기(가게 규칙)", spec=["SPEC-016", "SPEC-047", "SPEC-071"], auth="owner",
   desc="그 주문이 받은 운영규정 버전, 취소 시각(아직이면 지금), 맞춤 재료 주문·제작 시작 시각, 받은 금액으로 계산값과 근거를 낸다. "
        "받은 금액은 결제 안내의 들어온 금액 합(확인된 결제와 결제로 확인하지 않은 들어온 금액, REQ-165). "
        "정할 수 있는 가장 작은 금액은 계산값(REQ-170), 가장 큰 금액은 받은 금액 - 이미 정한 환불. 받은 금액이 0원이면 0원(SPEC-016). 같은 입력이면 같은 값. "
        "손님 취소는 SPEC-016의 차례로 셈한다: 바탕 = 받은 금액 - basis.excludedAmount(이미 정한 환불 + 따로 정할 환불의 계산값) → 맞춤 재료 주문·제작 시작 전이면 제작 전 비율, "
        "뒤면 기준 픽업 일시(basis.pickupBasisAt)까지 남은 시간(1시간 미만 버림, 지났으면 0)이 든 단계의 비율(단계가 없는 버전은 제작 전 비율) → 고정 취소 수수료를 먼저 뺌(바탕보다 크면 0원) "
        "→ 비율을 곱해 원 미만 버림 → 0원 이상 바탕 이하(예시 after_start: (36,000 - 5,000) × 50% = 15,500원). 가게 사정 취소는 바탕 전액, 금액이 내려간 변경은 내려간 금액. "
        "orderId가 재제작 주문이면 원래 주문의 받은 금액·이미 정한 환불·운영규정 버전과 재제작 주문의 시각·픽업 일시로 셈하고, order는 원래 주문, basis.remakeOrder는 재제작 주문(예시 remake_cancel, SPEC-060). "
        "취소 뒤 들어온 입금·더 들어온 금액(SPEC-071)은 paymentRequestId로 그 결제 안내에서 결제로 확인하지 않은 몫(그 결제 안내의 들어온 금액 - 결제 확인을 취소하지 않은 확인된 결제)을 계산값으로 낸다: "
        "닫힘·기한 지남 결제 안내는 들어온 금액 전액, 더 들어온 채 확인된 결제 안내는 넘은 몫만(차액 20,000원에 21,000원이면 1,000원, SPEC-016). "
        "그 결제 안내의 들어온 금액을 셈한 환불을 이미 정했으면 앞 환불이 셈한 몫(basis.excludedAmount)을 빼 새로 들어온 몫만 낸다(예시 over_received_again: 1,000원을 정한 뒤 20,000원이 또 들어오면 20,000원, 설계 재검토 남은 빈 곳).",
   params=[pid("orderId", "주문", E.ORDER_ID),
           q("cause", {"type": "string", "enum": ["customer_cancel", "shop_cancel", "change_reduced", "paid_after_cancel", "over_received"]}, "환불 사유", "customer_cancel", True),
           q("changeRequestId", {"type": "string", "minLength": 1, "maxLength": 100}, "금액이 내려간 변경(cause가 change_reduced일 때 꼭). 없거나 다른 주문 것이면 422 reference_not_found(DEC-02)"),
           q("paymentRequestId", {"type": "string", "minLength": 1, "maxLength": 100}, "돌려줄 들어온 입금의 결제 안내(cause가 paid_after_cancel·over_received일 때 꼭). 없거나 다른 주문 것이면 422 reference_not_found(DEC-02)")],
   ok=[(200, "RefundPreview", {"customer_cancel": E.REFUND_PREVIEW, "shop_cancel": E.REFUND_PREVIEW_SHOP, "over_received": E.REFUND_PREVIEW_OVER,
                               "over_received_again": E.REFUND_PREVIEW_OVER_AGAIN, "after_start": E.REFUND_PREVIEW_AFTER_START, "remake_cancel": E.REFUND_PREVIEW_REMAKE})],
   errors={404: ["not_found"]},
   fields=[("query:cause", "required"), ("query:changeRequestId", "reference_not_found")],
   omit={"403": O403, "409": O409_READ + ". 받은 금액이 0원이면 0원으로 계산(SPEC-016)"},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "반복": ["note:같은 입력이면 같은 값(SPEC-016)"], "노출": ["closed", "note:근거는 사장님께 전부"], "화면": ["screen"]})

op(id="API-050", method="post", path="/owner/orders/{orderId}/refunds", op="decideRefund", tag="환불",
   summary="환불 결정", spec=["SPEC-047", "SPEC-016", "SPEC-066", "SPEC-064", "SPEC-067", "SPEC-049", "SPEC-071"], auth="owner", idem=True,
   desc="전액 환불·일부 환불·환불 없이 취소 가운데 하나를 고른다. 보상이 아닌 환불은 계산값보다 낮을 수 없고(422 below_calculated, REQ-170) 받은 금액 - 이미 정한 환불을 넘을 수 없다(422 exceeds_received). "
        "계산값과 다르면(보상이 아니라 높을 때만 됨) 사유 1~200자가 꼭 있다(422 required, REQ-084). 환불 없이 취소는 계산값이 0원일 때만. "
        "금액이 내려간 변경(change_reduced)은 차액 돌려주기라 partial만 받고(계산값이 0원이면 none) full이면 422 not_allowed(SPEC-047). "
        "orderId가 재제작 주문이면 원래 주문의 돈으로 셈해 환불을 원래 주문에 남긴다(refund.order는 원래 주문, SPEC-060). 손님에게 환불 금액과 받는 방법을 한 번 알리고 장부 쓰기를 남긴다. "
        "돌려줄 금액이 있으면 할 일 '환불 보내기'를 열고(정한 뒤 24시간이 지나면 한 번 다시 알림, REQ-173), 계좌로 돌려줄 환불에 손님 계좌가 없으면 상담에서 묻는다(REQ-171). "
        "취소 뒤 들어온 입금·더 들어온 금액은 paymentRequestId가 꼭 있다(SPEC-071). 본문의 changeRequestId·paymentRequestId가 없거나 그 주문 것이 아니면 422 reference_not_found(DEC-02). "
        "우리는 돈을 옮기지 않는다: 사장님이 가게 계좌에서 반환한 뒤 API-061로 '보냄'을 표시한다(REQ-079). 보상 환불은 API-065. 같은 사유의 환불을 이미 정했으면 409 already_decided. "
        "취소 뒤 들어온 입금·더 들어온 금액의 환불은 그 결제 안내의 지금 들어온 금액까지 셈한 것으로 남아, 새로 들어온 몫 없이 같은 결제 안내의 환불을 또 정하면 409 already_decided이고, "
        "환불을 정한 뒤 같은 결제 안내에 또 들어온 입금(API-059 arrived)은 새 환불로 정한다(예시 over_received_again, SPEC-047, SPEC-071).",
   params=[pid("orderId", "주문", E.ORDER_ID)],
   body="RefundInput",
   body_examples={"partial": E.REFUND_INPUT,
                  "override": dict(E.REFUND_INPUT, amount=36000, decision="full", overrideReason="단골 손님이라 수수료를 받지 않아요"),
                  "none": dict(E.REFUND_INPUT, baseRevision=E.rev("order:K7Q3M9:cancelled-after-start"), decision="none", amount=0),
                  "over_received": {"baseRevision": E.ORDER_CHANGED["revision"], "cause": "over_received",
                                    "paymentRequestId": E.PR_DIFFERENCE["paymentRequestId"], "decision": "full", "amount": 1000},
                  "over_received_again": {"baseRevision": E.ORDER_CHANGED["revision"], "cause": "over_received",
                                          "paymentRequestId": E.PR_DIFFERENCE["paymentRequestId"], "decision": "full", "amount": 20000}},
   ok=[(201, "RefundResult", {"decided": {"outcome": "done", "refund": E.REFUND, "customerNotice": "sent"},
                              "deferred_notice": {"outcome": "done", "refund": E.REFUND, "customerNotice": "deferred"}})],
   errors={404: ["not_found"], 409: ["version_conflict", "already_decided", "invalid_state"]},
   fields=[("/amount", "exceeds_received"), ("/amount", "below_calculated"), ("/overrideReason", "required"), ("/paymentRequestId", "required"), ("/paymentRequestId", "reference_not_found"),
           ("/decision", "not_allowed")],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "상태": ["409:invalid_state", "409:already_decided"], "반복": ["idem"], "동시": ["revision", "409:version_conflict"],
          "외부": ["example:deferred_notice"], "노출": ["closed", "note:우리는 돈을 옮기지 않음(REQ-079)"], "화면": ["screen"]})

# ═══ 제작 ═════════════════════════════════════════════════════════════════════
op(id="API-051", method="get", path="/owner/production-days/{day}", op="getProductionDay", tag="제작",
   summary="날짜별 제작 목록과 그날 픽업", spec=["SPEC-050", "SPEC-054", "SPEC-045"], auth="owner",
   desc="확정된 주문과 재제작 주문만(SPEC-050). 픽업 시각·퀵 여부(SPEC-054), 맞춤 재료 필요·변경됨 표시. 결제 전·취소된 주문은 없다. 알레르기 정보에 동의하지 않은 주문은 요약의 allergyConsent가 declined이고 알레르기 답이 없다(REQ-203). 순서: 픽업 일시 순, 같으면 주문번호 순. 그날의 주문을 나누지 않고 한 번에 준다(DEC-14의 예외).",
   params=[pday("2026-11-20", "볼 날")],
   ok=[(200, "ProductionDay", {"day": E.PRODUCTION_DAY, "empty": E.PRODUCTION_DAY_EMPTY})],
   errors={404: ["shop_not_registered"]},
   fields=[("path:day", "bad_format")],
   omit={"403": O403, "409": O409_READ},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:shop_not_registered"],
          "노출": ["closed"], "빈·끊김": ["example:empty"], "화면": ["screen"]})

op(id="API-052", method="post", path="/owner/orders/{orderId}/production-marks", op="markProduction", tag="제작",
   summary="맞춤 재료 주문·제작 시작·완성 표시", spec=["SPEC-051", "SPEC-053", "SPEC-066"], auth="owner", idem=True,
   desc="그 시각을 남긴다. 이 시각은 환불 계산의 근거다(SPEC-051). 완성에는 사진을 5장까지 붙일 수 있고, 완성 사진 보내기를 켠 가게면 픽업 전에 손님에게 한 번 보내고 그 안내에서 사진마다 게시 동의를 묻는다(SPEC-053, REQ-207, API-073). "
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
   fields=[("/photoUploadIds", "too_many"), ("/photoUploadIds/0", "upload_not_found")],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "상태": ["409:invalid_state", "example:unchanged"], "반복": ["idem"], "동시": ["revision", "409:version_conflict"],
          "외부": ["note:손님 안내가 못 가면 다음 대화 때(SPEC-066)"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-053", method="post", path="/owner/orders/{orderId}/production-marks/undo", op="undoProductionMark", tag="제작",
   summary="표시 실행 취소(5분 이내)", spec=["SPEC-051"], auth="owner", idem=True,
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
   summary="인도(픽업 완료됨·퀵으로 보냄)", spec=["SPEC-054", "SPEC-055", "SPEC-064", "SPEC-061"], auth="owner", idem=True,
   desc="인도 시각과 함께 받은 주문으로 두고 장부 행에 적는다. 다음 날 후기 부탁이 걸린다(SPEC-061). 미수령 뒤 늦게 찾으러 와도 인도할 수 있다(SPEC-055). "
        "픽업 날짜 전이면 409 confirmation_required(not_pickup_day). 확정되지 않았거나 폐기한 주문은 409 invalid_state, 다른 방법으로 이미 인도했으면 409 already_decided.",
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
   desc="픽업 일시가 지난 확정 주문을 미수령으로 두고 장부 행에 적는다. 픽업 일시 전이면 409 invalid_state.",
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
   desc="미수령 뒤에만 폐기 시각을 남긴다. 폐기한 주문은 인도할 수 없다. 미수령이 아니면 409 invalid_state.",
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
   desc="안내 금액·입금자 이름·결제 기한·확인 요청 여부. 입금자 이름은 사장님 화면에만, AI로 보내지 않는다. 순서: 결제 기한(dueAt)이 이른 것이 앞, 기한이 없는 것(새 금액 확인 전)은 그 뒤에 보낸 시각(issuedAt) 순, 같으면 결제 안내 ID 순(DEC-14).",
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
   desc="할 일(결제 확인 요청·맞추는 중)이 여는 입금 대조 화면. 새 금액 확인이 필요한데 손님이 아직 확인하지 않은 결제 안내는 needsAmountConfirm true, amountConfirmedAt·deliveredAt null이고 결제 기한은 상한(awaiting_amount_confirm, SPEC-076).",
   params=[pid("paymentRequestId", "결제 안내", E.PR_CLAIMED["paymentRequestId"])],
   ok=[(200, "PaymentRequest", {"claimed": E.PR_CLAIMED, "mismatch": E.PR_MISMATCH, "expired": E.PR_EXPIRED,
                                "awaiting_amount_confirm": E.PR_CUSTOM_OPEN})],
   errors={404: ["not_found"]},
   omit={"403": O403, "409": O409_READ, "422": O422_PATHONLY},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:not_found"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-059", method="post", path="/owner/payment-requests/{paymentRequestId}/reconciliation", op="reconcilePaymentRequest", tag="결제 안내",
   summary="입금 대조(입금됨·미입금·금액 불일치·대조 완료·들어옴·결제 확인 취소·변경 닫기)", spec=["SPEC-034", "SPEC-035", "SPEC-036", "SPEC-045", "SPEC-015", "SPEC-064", "SPEC-070", "SPEC-071", "SPEC-044", "SPEC-076"],
   auth="owner", idem=True,
   desc="'입금됨'이면 결제 확인됨(결제 안내 하나에 하나)을 남기고 첫 결제·다시 낸 결제는 주문을 확정하고(SPEC-036), 차액 결제는 변경을 반영한다(SPEC-045). "
        "금액 불일치이면 '맞추는 중'으로 두고 결제 기한을 멈추고 자리를 지킨다(SPEC-035). 대조 완료이면 확정(차액 결제면 변경 반영). 미입금이면 확인 요청을 지운다. "
        "새 금액 확인이 필요한데 손님이 아직 확인하지 않은 결제 안내를 '입금됨'·'대조 완료'로 결제 확인하면 그 시각을 손님의 확인으로 함께 남긴다(SPEC-076). "
        "변경 닫기(close_change)는 맞추는 중인 차액 결제에만: 변경 요청을 '차액 없어 닫힘'으로 두고 주문 내용·버전은 그대로, 차액을 기다리며 잡아 둔 새 날 자리를 풀고, "
        "들어온 금액은 '더 들어온 금액'으로 돌려줄 환불을 정할 일로 남긴다(SPEC-035, REQ-235). 맞추는 중인 차액 결제가 아니면 409 invalid_state. "
        "그 사이 주문이 취소됐으면 확정하지 않고 outcome paid_after_cancel과 환불 정할 일(SPEC-036). "
        "기한이 지나 자리가 풀린 결제 안내의 '입금됨'은 409 slot_released(먼저 결제 기한 연장, R14). 같은 결과를 다시 누르면 unchanged, 다른 결과가 이미 남았으면 409 already_decided. "
        "확인과 기한 처리가 동시에 일어나면 확인이 이긴다. "
        "들어옴(arrived)은 닫힘·기한 지남 결제 안내와 확인된 결제 안내(결제를 확인한 뒤 더 들어온 입금)에 결제로 확인하지 않은 들어온 금액을 남겨 받은 금액에 넣고 환불 정할 일을 남긴다(SPEC-071, REQ-166). 들어온 입금 대조 할 일이 이 화면을 연다(REQ-167). "
        "같은 결제 안내에 또 들어온 입금은 그 결제 안내의 지금 revision으로 들어옴을 다시 남겨 들어온 금액에 더한다(같은 결과여도 unchanged가 아님, 같은 요청 키는 처음 응답, 옛 revision은 409 version_conflict). "
        "그 결제 안내의 들어온 금액을 셈한 환불을 이미 정했으면 새로 들어온 몫을 돌려줄 '더 들어온 금액' 환불 정할 일을 새로 남기고, 아직 정하지 않았으면 그 정할 일의 계산값이 커진다(예시 arrived_again, 설계 재검토 남은 빈 곳). "
        "확인된 결제 안내의 들어옴은 결제 뒤 더 들어온 입금이라 already_decided가 아니다. "
        "결제 확인 취소(void)는 제작을 시작하지 않은 확인된 결제에만: 사유와 시각을 남기고 결제 안내는 나감, 주문은 결제 기다림, 자리는 가예약으로 되돌리고 손님에게 정정 안내를 한 번 보낸다(SPEC-070, REQ-169). "
        "제작을 시작했거나, 차액 결제이거나, 반영됐거나 열린 변경 요청이나 정한 환불이 있거나, 들어온 금액이 안내 금액보다 많으면(더 들어온 금액의 환불이 먼저) 409 invalid_state(SPEC-070).",
   params=[pid("paymentRequestId", "결제 안내", E.PR_CLAIMED["paymentRequestId"])],
   body="ReconciliationInput",
   body_examples={"received": {"baseRevision": E.PR_CLAIMED["revision"], "result": "received"},
                  "mismatch": {"baseRevision": E.PR_CLAIMED["revision"], "result": "mismatch", "mismatchAmount": 31000},
                  "resolved": {"baseRevision": E.PR_MISMATCH["revision"], "result": "resolved", "resolution": "shortfall_paid"},
                  "arrived": {"baseRevision": E.rev("pr:closed"), "result": "arrived", "arrivedAmount": 36000},
                  "arrived_again": {"baseRevision": E.PR_CLOSED_ARRIVED["revision"], "result": "arrived", "arrivedAmount": 36000},
                  "void": {"baseRevision": E.PR_FIRST_PAID["revision"], "result": "void", "voidReason": E.PAYMENT_VOIDED["voidReason"]},
                  "close_change": {"baseRevision": E.PR_DIFF_MISMATCH["revision"], "result": "close_change"}},
   ok=[(200, "ReconciliationResult", {
       "confirmed": {"outcome": "done", "paymentRequest": E.PR_FIRST_PAID, "payment": E.PAYMENT, "order": E.ORDER_CONFIRMED, "changeRequest": None},
       "mismatch": {"outcome": "done", "paymentRequest": E.PR_MISMATCH, "payment": None, "order": dict(E.ORDER_AWAITING, paymentRequests=[E.PR_MISMATCH]),
                    "changeRequest": None},
       "difference_applied": {"outcome": "done", "paymentRequest": E.PR_DIFF_PAID, "payment": E.PAYMENT_DIFF, "order": E.ORDER_DIFF_APPLIED,
                              "changeRequest": E.CHANGE_DIFF_APPLIED},
       "paid_after_cancel": {"outcome": "paid_after_cancel", "paymentRequest": dict(E.PR_CLAIMED, status="closed", closedAt=E.t("11-14", "09:00"),
                                                                                    closeReason="order_cancelled", arrivedAmount=36000,
                                                                                    arrivedAt=E.t("11-14", "09:40"), revision=E.rev("pr:closed")),
                             "payment": None, "order": dict(E.ORDER_CANCELLED_UNPAID, paymentRequests=[dict(E.PR_CLAIMED, status="closed", closedAt=E.t("11-14", "09:00"),
                                                                                                      closeReason="order_cancelled", arrivedAmount=36000,
                                                                                                      arrivedAt=E.t("11-14", "09:40"), revision=E.rev("pr:closed"))]),
                             "changeRequest": None},
       "arrived": {"outcome": "done", "paymentRequest": E.PR_CLOSED_ARRIVED, "payment": None,
                   "order": dict(E.ORDER_CANCELLED_UNPAID, paymentRequests=[E.PR_CLOSED_ARRIVED]), "changeRequest": None},
       "arrived_again": {"outcome": "done", "paymentRequest": E.PR_CLOSED_ARRIVED_AGAIN, "payment": None,
                         "order": dict(E.ORDER_CANCELLED_UNPAID, paymentRequests=[E.PR_CLOSED_ARRIVED_AGAIN]), "changeRequest": None},
       "voided": {"outcome": "done", "paymentRequest": E.PR_VOIDED, "payment": E.PAYMENT_VOIDED,
                  "order": dict(E.ORDER_AWAITING, paymentRequests=[E.PR_VOIDED], payments=[E.PAYMENT_VOIDED], production=None,
                                revision=E.rev("order:K7Q3M9:voided")), "changeRequest": None},
       "change_closed": {"outcome": "done", "paymentRequest": E.PR_DIFF_CHANGE_CLOSED, "payment": None, "order": E.ORDER_CHANGE_CLOSED_BY_OWNER,
                         "changeRequest": E.CHANGE_CLOSED_BY_OWNER},
       "unchanged": {"outcome": "unchanged", "paymentRequest": E.PR_FIRST_PAID, "payment": E.PAYMENT, "order": E.ORDER_CONFIRMED, "changeRequest": None}})],
   errors={404: ["not_found"], 409: ["version_conflict", "slot_released", "already_decided", "invalid_state"]},
   fields=[("/mismatchAmount", "out_of_range"), ("/arrivedAmount", "out_of_range"), ("/voidReason", "required")],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "상태": ["409:slot_released", "409:already_decided", "example:paid_after_cancel", "example:change_closed"], "반복": ["idem", "example:unchanged"],
          "동시": ["revision", "409:version_conflict", "note:확인이 기한 처리를 이김(SPEC-034)"], "노출": ["closed"], "화면": ["screen"]})

# ═══ 환불 ═════════════════════════════════════════════════════════════════════
op(id="API-060", method="get", path="/owner/refunds/{refundId}", op="getRefund", tag="환불",
   summary="환불 하나(손님 환불 계좌 포함)", spec=["SPEC-047", "SPEC-049", "SPEC-021"], auth="owner",
   desc="정한 환불과 근거. 손님이 상담에서 알려 준 환불 계좌(SPEC-049)는 앱이 암호화해 두고, 사장님 화면에서는 원래 값으로 이 화면에만 보인다(R19, DEC-19). 운영자는 끝 4자리만 본다(API-076).",
   params=[pid("refundId", "환불", E.REFUND["refundId"])],
   ok=[(200, "Refund", {"decided": E.REFUND, "with_account": E.REFUND_WITH_ACCOUNT, "sent": E.REFUND_SENT})],
   errors={404: ["not_found"]},
   omit={"403": O403, "409": O409_READ, "422": O422_PATHONLY},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:not_found"],
          "노출": ["closed", "note:손님 계좌는 이 화면에만(R19)"], "화면": ["screen"]})

op(id="API-061", method="post", path="/owner/refunds/{refundId}/sent", op="markRefundSent", tag="환불",
   summary="환불 '보냄' 표시", spec=["SPEC-047", "SPEC-049", "SPEC-066", "SPEC-064", "SPEC-067"], auth="owner", idem=True,
   desc="사장님이 가게 계좌에서 반환하거나 카드 결제를 취소한 뒤 표시한다. 계좌로 보냈으면 그 계좌(손님이 말한 값을 고쳤으면 고친 값, 숫자만 10~16자리)를 앱이 암호화해 끝 4자리와 함께 남긴다(REQ-191). "
        "할 일 '환불 보내기'를 닫고, 손님에게 보냈다는 안내를 한 번 보내고(친구면 바로, 아니면 다음 대화 때, REQ-172) 장부 쓰기를 남긴다. "
        "환불 없이 취소한 행은 409 invalid_state. 이미 표시했으면 unchanged(안내를 다시 보내지 않음).",
   params=[pid("refundId", "환불", E.REFUND["refundId"])],
   body="RefundSentInput",
   body_examples={"bank_transfer": {"baseRevision": E.REFUND_WITH_ACCOUNT["revision"], "method": "bank_transfer",
                                    "refundAccount": {"bankName": "하늘은행", "accountNumber": "110-123-456789", "holderName": "이지우"}},
                  "card_cancel": {"baseRevision": E.REFUND["revision"], "method": "card_cancel", "refundAccount": None}},
   ok=[(200, "RefundResult", {"sent": {"outcome": "done", "refund": E.REFUND_SENT, "customerNotice": "sent"},
                              "sent_deferred": {"outcome": "done", "refund": E.REFUND_SENT, "customerNotice": "deferred"},
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
   desc="바꾸려는 내용, 묶인 주문 버전과 현재 버전, 변경 마감 시각, 새 날을 사장님이 정해야 하는지, 차액 결제(손님의 새 금액 확인 포함, SPEC-076). "
        "차액 결제 기한이 지나거나 손님이 새 금액을 받지 않으면 서버가 '차액 없어 닫힘'으로 두고 차액을 기다리며 잡아 둔 새 날 자리를 푼다(SPEC-044, REQ-233, REQ-234). "
        "맞추는 중인 차액 결제는 기한으로 닫지 않고 사장님의 '대조 완료'나 '변경 닫기'(API-059)로만 끝난다(REQ-235). "
        "변경 마감까지 사장님 답이 없으면 서버가 '답 없어 닫힘'(closed_no_answer)으로 닫고 주문은 원래대로 둔다(REQ-214).",
   params=[pid("changeRequestId", "변경 요청", E.CHANGE["changeRequestId"])],
   ok=[(200, "ChangeRequest", {"requested": E.CHANGE, "awaiting_difference": E.CHANGE_AWAITING, "closed_no_difference": E.CHANGE_CLOSED,
                               "closed_no_answer": E.CHANGE_NO_ANSWER})],
   errors={404: ["not_found"]},
   omit={"403": O403, "409": O409_READ, "422": O422_PATHONLY},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:not_found"], "상태": ["example:closed_no_difference", "example:closed_no_answer"],
          "노출": ["closed"], "화면": ["screen"]})

op(id="API-063", method="post", path="/owner/change-requests/{changeRequestId}/decision", op="decideChangeRequest", tag="변경 요청",
   summary="변경 요청 응답(수락·거절)", spec=["SPEC-042", "SPEC-043", "SPEC-045", "SPEC-015", "SPEC-032", "SPEC-076"], auth="owner", idem=True,
   desc="수락하려면 금액 방향(amountDirection: same·up·down)을 고르고, 올라감·내려감이면 차이 금액(amountDifference)을 양수로 넣는다(부호를 넣지 않음, DEC-23). 서버가 부호를 붙여 amountDelta로 남긴다. "
        "금액이 그대로거나 내려가면 바로 반영해 주문 버전을 하나 올린다(SPEC-045, 내려가면 환불 정할 일). 날짜가 바뀌면 옛 날 자리를 풀고 새 날에 확정된 자리를 잡는다(결제 안내 없음). "
        "오르면 변경 요청을 '차액 결제 기다림'으로 두고 새 금액 확인이 필요한 차액 결제 안내를 낸다(SPEC-043, SPEC-076). 손님이 새 금액을 확인하면 계좌를 보이고, 차액 결제가 확인되면 반영한다. "
        "기다리는 동안 주문 내용·버전과 옛 날의 확정된 자리는 그대로이고, 날짜도 바뀌면 새 날 자리를 차액 결제 기한까지 잡는다(REQ-234). "
        "새 날이 다 찼으면 409 confirmation_required(overbooking), 휴무일이면 closed_day(REQ-221, REQ-226). "
        "거절이면 주문은 그대로이고 손님에게 알린다. 그 사이 손님이 취소했으면 409 order_cancelled, 이미 답했으면 409 already_decided, "
        "변경 마감이 지난 변경 요청은 닫는 일이 아직 돌지 않았어도 409 invalid_state이고 '답 없어 닫힘'으로 닫는다(REQ-214). "
        "수락인데 방향이 없으면 422 /amountDirection required, 올라감·내려감인데 차이 금액이 없으면 /amountDifference required, 내려감이 지금 금액을 넘거나 올라간 새 금액이 1,000만 원을 넘으면 /amountDifference out_of_range, "
        "그대로·거절에 차이 금액을 보내면 /amountDifference not_allowed. "
        "재제작 주문의 변경 요청은 금액이 그대로일 때만 수락한다(same이 아니면 422 /amountDirection not_allowed, 차액 결제·차액 돌려주기 없음, "
        "변경 마감은 원래 주문이 받은 운영규정 버전으로 셈, SPEC-042, SPEC-060). "
        "이전 버전을 보고 만든 변경은 변경 요청 카드에서 받지 않아(SPEC-041, G9) 여기 오지 않고, 반영 쓰기는 본 버전 위에서만 된다(REQ-133).",
   params=[pid("changeRequestId", "변경 요청", E.CHANGE["changeRequestId"])],
   body="ChangeDecisionInput",
   body_examples={"accept_same": {"baseRevision": E.CHANGE["revision"], "decision": "accept", "amountDirection": "same"},
                  "accept_more": {"baseRevision": E.CHANGE_TWO_TIER["revision"], "decision": "accept", "amountDirection": "up", "amountDifference": 20000},
                  "reject": {"baseRevision": E.CHANGE_TWO_TIER["revision"], "decision": "reject", "rejectReason": "2단은 사흘 전까지만 받아요"}},
   ok=[(200, "ChangeDecisionResult", {"applied": {"outcome": "done", "changeRequest": E.CHANGE_APPLIED, "order": E.ORDER_CHANGED_APPLIED, "paymentRequest": None},
                                      "awaiting_difference": {"outcome": "done", "changeRequest": E.CHANGE_AWAITING, "order": E.ORDER_AWAITING_DIFFERENCE,
                                                              "paymentRequest": E.PR_DIFFERENCE},
                                      "rejected": {"outcome": "done", "changeRequest": E.CHANGE_REJECTED, "order": E.ORDER_CHANGE_REJECTED, "paymentRequest": None}})],
   errors={404: ["not_found"], 409: ["version_conflict", "already_decided", "order_cancelled", "invalid_state", "confirmation_required"]},
   fields=[("/amountDirection", "required"), ("/amountDirection", "not_allowed"), ("/amountDifference", "required"),
           ("/amountDifference", "out_of_range"), ("/amountDifference", "not_allowed")],
   confirm=["overbooking", "closed_day"],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:not_found"],
          "상태": ["409:order_cancelled", "409:already_decided", "409:invalid_state", "409:confirmation_required"], "반복": ["idem"],
          "동시": ["revision", "409:version_conflict", "note:한 주문에 열린 변경 요청은 하나이고 반영은 본 버전 위에서만 됨(REQ-133)"], "노출": ["closed"], "화면": ["screen"]})

# ═══ 문제 신고 ════════════════════════════════════════════════════════════════
op(id="API-064", method="get", path="/owner/issue-reports/{issueReportId}", op="getIssueReport", tag="문제 신고",
   summary="문제 신고 하나", spec=["SPEC-058", "SPEC-059", "SPEC-057", "SPEC-079"], auth="owner",
   desc="신고 사진·설명·주문 내용 버전·결제 금액, 기한 뒤인지, 먹고 아프다는 말인지, 같은 주문의 뒤 신고. "
        "보상을 정했으면 문제 종류·보상과 보상 없음의 사유나 그 밖의 보상의 한 일·금액(사장님 화면에만, SPEC-059). "
        "신고한 사람이 주문자인지 사장님이 에스컬레이션 건에서 남긴 것인지와 그 건(SPEC-079). '기한 뒤'(late)는 사장님 화면에만 보이고 손님 안내에는 쓰지 않는다(REQ-250).",
   params=[pid("issueReportId", "문제 신고", E.ISSUE["issueReportId"])],
   ok=[(200, "IssueReport", {"reported": E.ISSUE, "remake_decided": E.ISSUE_REMAKE, "other_compensation": E.ISSUE_OTHER,
                             "from_handoff": E.ISSUE_FROM_HANDOFF})],
   errors={404: ["not_found"]},
   omit={"403": O403, "409": O409_READ, "422": O422_PATHONLY},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:not_found"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-065", method="post", path="/owner/issue-reports/{issueReportId}/compensation", op="decideCompensation", tag="문제 신고",
   summary="보상 결정(문제 종류와 재제작·일부 환불·전액 환불·그 밖의 보상·없음)", spec=["SPEC-059", "SPEC-060", "SPEC-047", "SPEC-015"], auth="owner", idem=True,
   desc="보상은 사장님만 정한다(AI·손님에게 길이 없음, REQ-246). 문제 종류(spoiled 상함·변질, foreign_matter 이물, other 그 밖)를 꼭 함께 고른다(REQ-247). "
        "재제작이면 새 픽업 일시(지금 뒤 60일 안)로 결제 없는 재제작 주문을 확정으로 남기고 자리를 잡는다(SPEC-060). "
        "휴무일이면 409 confirmation_required(closed_day), 다 찬 날이면 overbooking이고 확인하면 마감 후 추가 수락으로 잡는다(REQ-221, REQ-226). 환불이면 환불 결정과 같은 한도(받은 금액 - 이미 정한 환불)로 환불을 남기고, 계산값은 고른 금액이라 다르게 정한 사유를 받지 않는다(SPEC-016, SPEC-047). "
        "상함·변질이나 이물에 보상 없음이면 저장하지 않고 409 confirmation_required(no_compensation_standard)로 소비자분쟁해결기준(공정위 고시 제2025-14호 별표, 제빵류: 교환 또는 환급)과 위험을 보이게 하고, "
        "사장님이 사유(noCompensationReason, 1~200자)를 넣고 '그래도 보상 없이 닫기'를 누르면 confirm에 담아 다시 보낸다. 확인했는데 사유가 없으면 422 /noCompensationReason required, 다른 문제 종류나 보상에 사유를 보내면 422 /noCompensationReason not_allowed(REQ-248). "
        "그 밖의 보상(other_compensation)은 사장님이 직접 처리하는 보상(예: 다른 상품, 진료비)이라 한 일(otherCompensationNote, 1~200자, 꼭)과 금액(otherCompensationAmount, 선택)만 남기고 환불·장부 쓰기를 만들지 않는다. "
        "다른 보상에 한 일·금액을 보내면 422 not_allowed(REQ-249). 보상 없음의 사유와 그 밖의 보상의 한 일은 사장님 화면에만 보이고 손님 안내에 쓰지 않는다. "
        "재제작 주문에 들어온 신고(다시 신고)는 원래 주문의 돈으로 한도를 보고 환불을 원래 주문에 남기며, 다시 재제작이면 새 재제작 주문도 원래 주문에 잇는다(SPEC-059, SPEC-060). "
        "손님에게 보상 안내를 한 번 보내고(그 밖의 보상이면 '사장님이 직접 연락해 보상을 처리해 드려요') 신고를 닫는다. "
        "사장님이 에스컬레이션 건에서 남긴 신고(reportedBy owner_from_handoff)는 보상 안내를 보내지 않고, 환불은 결제한 주문자에게 지금 환불 안내 규칙대로 가며, 신고한 사람에게는 그 건의 답(API-042)으로 결과를 전한다(DEC-24). "
        "이미 정한 보상은 고치지 않는다(409 already_decided).",
   params=[pid("issueReportId", "문제 신고", E.ISSUE["issueReportId"])],
   body="CompensationInput",
   body_examples={"remake": {"baseRevision": E.ISSUE["revision"], "problemKind": "other", "compensation": "remake", "remakePickupAt": E.t("11-25", "15:00")},
                  "partial_refund": {"baseRevision": E.ISSUE["revision"], "problemKind": "other", "compensation": "partial_refund", "refundAmount": 20000},
                  "none": {"baseRevision": E.ISSUE["revision"], "problemKind": "other", "compensation": "none"},
                  "none_spoiled_confirmed": {"baseRevision": E.ISSUE_SPOILED["revision"], "problemKind": "spoiled", "compensation": "none",
                                             "noCompensationReason": E.ISSUE_NONE_REASON["noCompensationReason"], "confirm": ["no_compensation_standard"]},
                  "other_compensation": {"baseRevision": E.ISSUE_FOREIGN["revision"], "problemKind": "foreign_matter", "compensation": "other_compensation",
                                         "otherCompensationNote": E.ISSUE_OTHER["otherCompensationNote"], "otherCompensationAmount": 30000}},
   ok=[(200, "CompensationResult", {"remake": {"outcome": "done", "issueReport": E.ISSUE_REMAKE, "remakeOrder": E.ORDER_REMAKE, "refund": None},
                                    "partial_refund": {"outcome": "done", "issueReport": E.ISSUE_PARTIAL, "remakeOrder": None, "refund": E.REFUND_COMP},
                                    "none_with_reason": {"outcome": "done", "issueReport": E.ISSUE_NONE_REASON, "remakeOrder": None, "refund": None},
                                    "other_compensation": {"outcome": "done", "issueReport": E.ISSUE_OTHER, "remakeOrder": None, "refund": None}})],
   errors={404: ["not_found"], 409: ["version_conflict", "already_decided", "confirmation_required"]},
   fields=[("/remakePickupAt", "outside_window"), ("/refundAmount", "exceeds_received"), ("/noCompensationReason", "required"),
           ("/noCompensationReason", "not_allowed"), ("/otherCompensationNote", "required")],
   confirm=["closed_day", "overbooking", "no_compensation_standard"],
   omit={"403": O403},
   kinds={"접근": ["security", "401:unauthenticated", "note:AI·손님은 보상을 정할 수 없음(AI 도구에 없음)"], "입력": ["422:validation_failed"],
          "대상": ["404:not_found"], "상태": ["409:already_decided", "409:confirmation_required"], "반복": ["idem"],
          "동시": ["revision", "409:version_conflict"],
          "노출": ["closed", "note:보상 없음의 사유와 그 밖의 보상의 한 일은 사장님 화면에만. 에스컬레이션 건에서 남긴 신고는 보상 안내를 보내지 않음(DEC-24)"], "화면": ["screen"]})

# ═══ 후기와 포트폴리오 ════════════════════════════════════════════════════════
op(id="API-066", method="get", path="/owner/reviews", op="listReviews", tag="후기·포트폴리오",
   summary="후기와 사진 게시 동의", spec=["SPEC-062", "SPEC-063"], auth="owner",
   desc="후기마다 현재 버전의 글과 사진, 사진마다 게시 동의 상태와 포트폴리오에 올렸는지. 순서: 새 후기(createdAt이 늦은 것)가 앞, 같으면 후기 ID 순(DEC-14).",
   params=[CURSOR, LIMIT],
   ok=[(200, "ReviewList", {"reviews": E.REVIEWS, "empty": E.EMPTY_PAGE})],
   errors={404: ["shop_not_registered"]},
   fields=[("query:limit", "out_of_range")],
   omit={"403": O403, "409": O409_READ},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["404:shop_not_registered"],
          "노출": ["closed"], "빈·끊김": ["example:empty"], "화면": ["screen"]})

op(id="API-067", method="get", path="/owner/portfolio", op="getPortfolio", tag="후기·포트폴리오",
   summary="포트폴리오와 올릴 수 있는 사진", spec=["SPEC-063"], auth="owner",
   desc="올린 사진과, 올릴 수 있는지 보이는 후보(완성 사진·후기 사진. 손님이 그 사진의 게시에 동의하고 철회하지 않은 사진만 올릴 수 있음, REQ-209). 가게가 도안으로 올린 견본 사진은 손님 사진이 아니라 후보에 없고 가격표에 보인다(REQ-210). 순서: 올린 사진은 올린 시각(publishedAt)이 늦은 것이 앞, 후보는 사진을 남긴 시각이 늦은 것이 앞. 나누지 않고 각각 200개까지 한 번에 준다(DEC-14의 예외).",
   ok=[(200, "Portfolio", {"portfolio": E.PORTFOLIO, "empty": {"items": [], "candidates": []}})],
   errors={404: ["shop_not_registered"]},
   omit={"403": O403, "409": O409_READ, "422": O422_NOINPUT},
   kinds={"접근": ["security", "401:unauthenticated"], "대상": ["404:shop_not_registered"], "노출": ["closed"],
          "빈·끊김": ["example:empty"], "화면": ["screen"]})

op(id="API-068", method="post", path="/owner/portfolio/items", op="addPortfolioItem", tag="후기·포트폴리오",
   summary="포트폴리오 게시", spec=["SPEC-063"], auth="owner", idem=True,
   desc="손님이 그 사진의 게시에 동의하고 철회하지 않은 사진만 올린다(완성 사진·후기 사진, REQ-209). 데이터베이스도 포트폴리오 항목의 동의가 그 사진의 것이고 동의함·철회 안 함인지 확인한다(05단계, 설계 재검토 H10). 동의하지 않았거나 철회한 사진은 409 photo_consent_missing. 이미 올렸으면 200 unchanged. 사진이 없거나 다른 가게 것이면 422 /photoId reference_not_found(DEC-02).",
   body="PortfolioInput", body_examples={"add": {"source": "review_photo", "photoId": E.REVIEW_PHOTO_1},
                                     "add_completion": {"source": "completion_photo", "photoId": E.COMPLETION_PHOTO_1}},
   ok=[(201, "PortfolioResult", {"added": {"outcome": "done", "item": E.PORTFOLIO_ITEM}}),
       (200, "PortfolioResult", {"unchanged": {"outcome": "unchanged", "item": E.PORTFOLIO_ITEM}})],
   errors={409: ["photo_consent_missing"]},
   fields=[("/photoId", "required"), ("/photoId", "reference_not_found")],
   omit={"403": O403, "404": O404_NOPATH + ". 본문의 사진 ID가 없거나 다른 가게 것이면 422(DEC-02)"},
   kinds={"접근": ["security", "401:unauthenticated"], "입력": ["422:validation_failed"], "대상": ["422:validation_failed", "note:없거나 다른 가게 사진은 reference_not_found(DEC-02)"],
          "상태": ["409:photo_consent_missing", "example:unchanged"], "반복": ["idem"],
          "동시": ["409:photo_consent_missing", "note:그 사이 손님이 동의를 철회하면 거절"], "노출": ["closed"], "화면": ["screen"]})

op(id="API-069", method="delete", path="/owner/portfolio/items/{portfolioItemId}", op="removePortfolioItem", tag="후기·포트폴리오",
   summary="포트폴리오 게시 취소", spec=["SPEC-063"], auth="owner", idem=True,
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
                    "ai_cost_limit_reached", "masking_failed", "ai_output_rejected", "card_shown", "photo_received", "photo_rejected", "photo_download_failed",
                    "unsupported_message", "rate_limited", "duplicate", "not_accepting", "channel_test_card", "server_error"]
CARD_OUTCOMES = ["allergy_saved", "allergy_declined", "orderer_saved", "order_requested", "payment_claimed", "amount_confirmed", "amount_declined", "change_requested", "order_cancelled",
                 "issue_reported", "photo_consent_saved", "consent_withdrawn", "declined", "input_invalid", "card_stale", "card_expired", "card_not_yours", "card_used", "day_full", "order_limit_reached", "retry_needed", "not_allowed_now",
                 "block_verified", "channel_linked", "not_accepting", "server_error"]
REVIEW_OUTCOMES = ["review_saved", "review_not_allowed", "review_invalid", "photo_download_failed", "duplicate", "block_verified", "channel_linked",
                   "not_accepting", "server_error"]
EVENT_OUTCOMES = ["notice_shown", "notice_test", "notice_gone"]

op(id="API-070", method="post", path="/kakao/skills/message", op="receiveCustomerMessage", tag="카카오 스킬",
   summary="손님 메시지 수신(카카오 오픈빌더 스킬)", auth="skill", callbacks=True, outcomes=MESSAGE_OUTCOMES, ai="AI-1",
   spec=["SPEC-017", "SPEC-018", "SPEC-019", "SPEC-020", "SPEC-021", "SPEC-022", "SPEC-025", "SPEC-026", "SPEC-027", "SPEC-028",
         "SPEC-033", "SPEC-040", "SPEC-041", "SPEC-046", "SPEC-049", "SPEC-056", "SPEC-057", "SPEC-066", "SPEC-068", "SPEC-069",
         "SPEC-013", "SPEC-014", "SPEC-016", "SPEC-008", "SPEC-072", "SPEC-075", "SPEC-076"],
   desc="카카오가 손님 메시지를 보내는 스킬. bot.id로 가게를 찾고(SPEC-017) 그 가게 상담(사용자 키마다 하나)을 열거나 이어간다. 헤더 Siljang-Skill-Key가 그 연결의 지금 버전 키나, 바꾼 뒤 24시간 안의 앞 버전 키가 아니면 401(DEC-08, REQ-237). "
        "처리한 모든 경우에 200과 스킬 응답을 반환하고 결과는 Siljang-Outcome 헤더와 같은 이름의 예시로 구분한다(DEC-07). "
        "답이 4초 안에 준비되면 바로 답하고(answered), 아니면 useCallback으로 응답한 뒤(callback_pending) AI-1 답을 콜백으로 보낸다(콜백 본문의 결과도 같은 이름으로 로그에 남김). "
        "전체 기한(받은 때부터 55초, AI-1)까지 답이 없으면 에스컬레이션하고(ai_timeout) 그 안내를 콜백으로 보낸다. 콜백이 켜지지 않은 요청(callbackUrl 없음)은 4초 안에 답이 없으면 그 자리에서 에스컬레이션 안내로 답한다(ai_timeout). AI 모델 실패·키 없음·사용 한도·가게 비용 한도·차례마다 호출 상한(8번)은 모두 에스컬레이션함(R7, AI-1). "
        "첫 메시지에 답하기 전에 AI 상담 고지와 처리방침 주소를 먼저 포함하고(SPEC-018), 먼저 보내지 못한 안내(손님이 친구가 아니거나 그 가게의 먼저 보내기가 안 됨, REQ-181)가 있으면 답보다 먼저 포함한다(SPEC-066). "
        "문의 끊김이나 상담 끝남으로 닫힌 손님에게도 이 안내(결제 안내·사장님 답·전날 안내 등)는 막지 않는다(REQ-212). 이때 보인 결제 안내는 그때를 전해진 시각으로 남겨 결제 기한을 그때부터 세고(REQ-218), "
        "결제 기한 상한이 지나 기한 지남이 된 결제 안내는 계좌 대신 '결제 기한이 지나 사장님이 확인하고 있어요'만 보인다(SPEC-037). "
        "새 금액 확인이 필요한 결제 안내는 계좌 대신 새 금액 확인 카드를 보이고(SPEC-076), 손님이 확인하기 전에 입금했다고 하면 입금 알리기 카드 대신 그 카드를 다시 보인다(card_shown, SPEC-033). "
        "손님이 자기 주문을 물으면 그 사용자가 요청한 주문마다 상태·픽업 일시·주문 내용 요약·금액과 결제가 확인된 시각·정한 환불과 보낸 때를 서버가 저장된 값으로 보인다(SPEC-040, REQ-241). "
        "변경·취소·문제 신고는 그 주문을 요청한 같은 카카오 사용자에게서만 받는다(REQ-251). 다른 사용자가 주문번호로 묻거나 바꾸려 하면 없는 주문번호와 같은 답을 주어 주문이 있는지 알리지 않고(REQ-252), "
        "선물로 받았다는 것처럼 사정을 말하면 사유 other_user로 에스컬레이션한다(handed_over, REQ-253). 관련 주문이 있으면 그 말은 다른 열린 건에 덧붙지 않고 상담과 주문마다 따로 건이 되어(SPEC-022) 사장님이 그 건에서 문제 신고로 남길 수 있다(API-083). "
        "신고 기한 뒤의 신고도 막지 않고 손님에게 기한이 지났다거나 권리가 없다고 말하지 않는다(REQ-250). "
        "요청마다 userRequest.user.properties.isFriend로 손님의 채널 친구 여부를 고치고, true가 아니면 친구 아님으로 둔다(REQ-219). "
        "연결 확인 중인 채널에 그 연결의 연결 문구(API-032가 사장님 화면에만 보인 '연결 ' 뒤 숫자 6자리)가 오면 그 사용자를 시험 사용자로 남기고 첫 시험 버튼을 답한다(channel_test_card, SPEC-008, REQ-238). "
        "다른 말이면 not_accepting과 같은 말로 답하고 시험을 시작하지 않는다. 시험 버튼은 그 가게가 넣은 블록 ID를 부른다(설계 재검토 H8). "
        "주문서 초안의 빈 항목과 금액 확인이 끝났는데 알레르기 정보 동의의 답이 없으면 주문 요청 카드 대신 알레르기 정보 카드(쓰는 목적·받는 항목·보는 사람·지우는 때, 동의하지 않을 수 있고 그러면 빼야 할 재료만으로 주문한다는 것, "
        "버튼 '동의하고 알려 주기'·'동의 안 함')를 보낸다(card_shown, SPEC-075, 설계 재검토 H5, 잠정, 5-2 질문 4의 답으로 다시 봄). '동의하고 알려 주기'는 AI를 거치지 않는 '알레르기 답' 블록을 열고, 동의의 답과 알레르기 답은 API-071로 온다. "
        "AI는 알레르기를 묻지 않고 손님이 대화에 적은 알레르기 말을 초안에 넣지 않는다(REQ-200, REQ-204). 동의 단계를 끈 배포에서는 동의를 묻지 않고 알레르기 답 블록 버튼만 보낸다(REQ-205). "
        "그다음 주문자 이름·연락처가 없으면 주문 요청 카드 대신 주문자 정보 카드를 보낸다(card_shown). 그 버튼 '이름·연락처 넣기'는 AI를 거치지 않는 '주문자 정보' 블록을 열고 값은 API-071로 온다(SPEC-072, 설계 재검토 H11). "
        "주문 요청 확인 카드는 출력 셋 안에서 그 버전의 취소·환불 규정 글(글 하나나 둘, 조문마다 한 줄, 끝에 청약철회 제한 문장과 미성년자 취소 고지, REQ-240)을 먼저, 요약 카드(요약에 알레르기 답이나 '알레르기 정보 동의 안 함', 버튼 둘)를 끝에 둔다. 사진 게시 동의는 주문 요청 때 묻지 않는다(완성 사진은 API-073, 후기 사진은 API-072, 설계 재검토 H10). "
        "규정 글이 1,000자를 넘으면 조문 사이에서 나눠 둘로 보내고 자르지 않는다(SPEC-028, DEC-22, 설계 재검토 H9). 카드 버튼은 그 가게가 넣은 '확인 카드' 블록 ID를 부른다. "
        "수신한 메시지에 개별 ID가 없어 정규 봇 ID·사용자 키·블록 ID·발화·수신 2초 구간의 HMAC-SHA256을 저장한다(DEC-28, K-02). "
        "콜백 주소는 공식 기준 5분 안에 한 번 사용한다. 개발 채널에서 321.1초 발신이 성공했으나 제품의 전체 기한은 수신 후 55초다(DEC-29, K-05). "
        "일반 사진의 주소는 userRequest.utterance에 왔으며 다운로드하기 전에 허용한 카카오 HTTPS 호스트와 응답 이미지 형식을 확인한다(DEC-28, K-06). "
        "중복과 첫 한도 안내 이후 분당 초과 요청에는 HTTP 200으로 template.outputs 빈 배열을 반환한다(DEC-29, K-04). "
        "Open: 봇 ID와 스킬 키를 아는 사람이 꾸민 요청과 카카오의 요청을 가를 수단(요청 출처)이 문서에 없어 11단계 전에 카카오에 문의(OPEN-10).",
   body="SkillPayload", body_examples={"message": E.SKILL_MESSAGE, "allergy_question": E.SKILL_MESSAGE_ALLERGY, "proof_phrase": E.SKILL_MESSAGE_PROOF},
   ok=[(200, "SkillResponse", {
       **{k: E.SKILL_OUTCOME_EXAMPLES[k] for k in MESSAGE_OUTCOMES},
       "duplicate": E.SKILL_NO_OUTPUT,
   }, ["Siljang-Outcome"])],
   errors={401: ["skill_key_invalid"]},
   fields=[("/userRequest", "required")],
   omit=dict(SKILL_OMIT, **{"429": "손님 메시지 한도는 결과 rate_limited(DEC-07, DEC-16)"}),
   kinds={"접근": ["security", "401:skill_key_invalid", "note:그 가게 상담·주문만 읽고 씀(REQ-134)"],
          "입력": ["422:validation_failed", "outcome:unsupported_message", "outcome:photo_rejected", "note:연결 확인 중 채널은 연결 문구만 시험을 시작함(REQ-238)"],
          "대상": ["outcome:not_accepting"], "상태": ["outcome:handed_over", "outcome:card_shown", "outcome:channel_test_card"], "반복": ["outcome:duplicate"],
          "동시": ["outcome:answered", "note:답을 만드는 동안 온 메시지는 다음 차례에 한꺼번에(3-3)"],
          "한도": ["outcome:rate_limited", "outcome:ai_cost_limit_reached", "outcome:photo_rejected", "outcome:ai_limit_reached", "note:한 차례의 모델 호출은 8번까지(AI-1, ai_calls.call_kind)"],
          "외부": ["outcome:ai_unavailable", "outcome:ai_timeout", "outcome:ai_key_missing", "outcome:ai_limit_reached", "outcome:photo_download_failed", "callback"],
          "노출": ["closed", "outcome:server_error", "note:알레르기 답은 AI 모델에 보내지 않음(REQ-204)"], "빈·끊김": ["outcome:callback_pending", "note:빈 AI 답은 다시 묻고 두 번이면 에스컬레이션함(SPEC-020)"],
          "AI": ["outcome:ai_output_rejected", "outcome:handed_over", "outcome:masking_failed"], "화면": ["screen"]})

op(id="API-071", method="post", path="/kakao/skills/card", op="pressConfirmCard", tag="카카오 스킬",
   summary="손님 확인 카드 버튼(카카오 오픈빌더 스킬)", auth="skill", outcomes=CARD_OUTCOMES,
   spec=["SPEC-069", "SPEC-029", "SPEC-030", "SPEC-033", "SPEC-041", "SPEC-046", "SPEC-058", "SPEC-063", "SPEC-015", "SPEC-032", "SPEC-040", "SPEC-072",
         "SPEC-075", "SPEC-053", "SPEC-076", "SPEC-044"],
   desc="확인 카드의 블록 버튼이 clientExtra(cardKey, choice)로 보내는 스킬. 서버는 카드 키로 저장된 카드를 찾고 그 사용자·그 주문의 현재 버전·30분 기한을 다시 본다(G9). "
        "주문 요청이면 한 트랜잭션으로 내용 확인·규정 동의·주문 요청을 남기고 초안의 알레르기 정보 동의(답·동의 글 버전·시각)와 알레르기 답을 주문 내용 버전에 옮기며, 기본 디자인이면 같은 트랜잭션에서 자리를 잡고 결제 안내까지(SPEC-029, SPEC-030). 기본 디자인 주문 요청은 같은 트랜잭션에서 그 손님 행을 잠그고 이 가게의 그 손님 결제 기다림 주문을 세어, 가게의 한도(Shop.awaitingPaymentLimit, 0이면 한도 없음)에 닿았으면 주문 요청과 자리를 남기지 않고 사유 order_limit의 에스컬레이션 건을 열고(상담마다 열린 한도 건 하나) '사장님이 확인한 뒤 알려 드릴게요'로 답한다(order_limit_reached, REQ-263). 사장님이 그 상담에서 한도를 넘겨 받은 지 24시간 안이고 아직 쓰지 않았으면 그 주문 요청이 그것을 쓰고 남는다(API-042, REQ-264). 맞춤 주문 요청은 한도로 막지 않는다(사장님이 수락할 때 봄). "
        "초안에 알레르기 정보 동의의 답이 없거나 동의했는데 알레르기 답이 없으면 주문 요청을 남기지 않고 알레르기 정보 카드를 보낸다(card_stale, REQ-201). "
        "입금 알리기·변경 요청·취소·신고·동의 철회도 같은 방법. 카드를 받은 사용자가 아니면 card_not_yours, 버전이 바뀌었으면 card_stale과 새 카드, 기한이 지났으면 card_expired와 새 카드. "
        "같은 카드를 다시 누르면 card_used와 처음 결과(G2). 아무것도 남기지 못하면 retry_needed. 카드 값은 서버 기록에서만 오고 손님 말로 바꿀 수 없다(SPEC-069). "
        "주문자 정보 카드의 '주문자 정보' 블록과 입금 알리기 카드의 '입금자 이름' 블록도 이 스킬로 오고, action.params에 customer_name·customer_phone이나 depositor_name을 담는다(설계 재검토 H11). "
        "이 값은 AI로 보내지 않는다(REQ-178). 형식(이름 1~30자, 연락처 숫자와 '-' 8~14자)이 맞으면 초안에 남기고 주문 요청 카드를 보내거나(orderer_saved, SPEC-072) 그 이름으로 결제 확인을 요청한다(payment_claimed, SPEC-033). "
        "형식이 틀리면 아무것도 남기지 않고 다시 묻는다(input_invalid). 입금 알리기 카드의 '결제 확인 요청'을 바로 누르면 입금자 이름은 주문자 이름이다(REQ-176). "
        "알레르기 정보 카드의 '동의하고 알려 주기'가 연 '알레르기 답' 블록은 받은 답을 action.params.allergy_answer에 담아 이 스킬로 온다. 답이 1~200자('없음'도 답)면 동의(동의 글 버전·시각)와 알레르기 답을 한 트랜잭션으로 초안에 남기고, "
        "주문자 이름·연락처가 없으면 주문자 정보 카드를, 있으면 주문 요청 카드를 보낸다(allergy_saved, SPEC-075, REQ-201, REQ-202). 답이 비거나 200자를 넘으면 아무것도 남기지 않고 '알레르기가 있는 재료를 200자까지 알려 주세요(없으면 없음)' 카드(알레르기 답 블록 버튼)를 다시 보낸다(input_invalid). 알레르기 정보 카드는 보낸 뒤 초안이 바뀌어도 card_stale로 거절하지 않고 받은 동의와 답을 남기며, 다음 카드를 바뀐 초안으로 만든다(SPEC-075). "
        "'동의 안 함'은 거부와 동의 글 버전·시각을 초안에 남기고 알레르기를 묻지 않은 채 다음 카드를 보낸다(allergy_declined, REQ-203). 알레르기 답은 AI 모델·로그·사장님 알림에 보내지 않는다(REQ-204, REQ-236, 설계 재검토 H5, 잠정, 5-2 질문 4의 답으로 다시 봄). "
        "완성 사진 안내(API-073)의 사진 게시 동의 카드에서 누른 '올려도 돼요'·'안 돼요'는 그 안내의 사진마다 동의를 남긴다(photo_consent_saved, SPEC-053, REQ-207, 설계 재검토 H10, 잠정, 5-2 질문 6의 답으로 다시 봄). "
        "동의를 철회하는 카드(consent_withdrawn)는 완성 사진·후기 사진의 동의 모두를 다루고, 그 사진의 올라 있는 포트폴리오 항목을 먼저 내린 뒤 철회를 남긴다(SPEC-063, REQ-209). "
        "새 금액 확인 카드(새 금액 확인이 필요한 결제 안내를 전할 때 계좌 대신 보임, SPEC-076)의 '이 금액으로 할게요'(맞춤 주문)·'바꿀게요'(변경)는 그 시각을 손님의 확인이자 결제 안내가 전해진 시각으로 남기고 계좌와 결제 기한을 보인다(amount_confirmed, REQ-232). "
        "'안 할래요'·'그대로 둘래요'는 결제 안내를 닫고, 맞춤 주문은 손님 취소(자리를 바로 풂, 받은 금액이 없어 환불 없음), 변경은 변경 요청을 '차액 없어 닫힘'으로 두고(차액을 기다리며 잡아 둔 새 날 자리는 풂) 사장님께 알린다(amount_declined, REQ-233, SPEC-044). "
        "그 사이 주문이 취소됐거나 변경 요청이 닫혔거나 결제 기한 상한이 지났으면 not_allowed_now와 지금 상태를 보인다. "
        "주문자 정보를 받아 보내는 주문 요청 확인 카드와 card_stale·card_expired의 새 카드는 API-070의 card_shown처럼 규정 글을 먼저, 요약 카드를 끝에 둔다(DEC-22). "
        "연결 확인 중에 시험 사용자가 누른 시험 버튼(clientExtra.check: card·orderer_info·allergy_answer·depositor_name)은 주문·카드를 남기지 않고 그 블록이 닿았다는 것만 남긴 뒤 다음 시험 버튼을 답하고(block_verified), "
        "다섯이 모두 닿으면 채널을 '연결됨'으로 묶고 시험 안내를 보낸다(channel_linked, SPEC-008, REQ-206, 설계 재검토 H8·H5). clientExtra에 cardKey도 check도 없으면 422.",
   body="SkillPayload", body_examples={"order_request": E.SKILL_CARD, "orderer_info": E.SKILL_ORDERER, "allergy_answer": E.SKILL_ALLERGY,
                                       "depositor_name": E.SKILL_DEPOSITOR, "photo_consent": E.SKILL_PHOTO_CONSENT,
                                       "amount_confirm": E.SKILL_AMOUNT_CONFIRM, "check_button": E.SKILL_CHECK_CARD},
   ok=[(200, "SkillTemplateResponse", {k: E.SKILL_OUTCOME_EXAMPLES[k] for k in CARD_OUTCOMES}, ["Siljang-Outcome"])],
   errors={401: ["skill_key_invalid"]},
   fields=[("/action/clientExtra/cardKey", "required")],
   omit=dict(SKILL_OMIT, **{"429": "카드는 한 번만 명령을 내려 빈도 한도가 없음"}),
   kinds={"접근": ["security", "401:skill_key_invalid", "outcome:card_not_yours"], "입력": ["422:validation_failed", "outcome:input_invalid"],
          "대상": ["outcome:not_allowed_now"], "상태": ["outcome:card_stale", "outcome:card_expired", "outcome:not_allowed_now", "outcome:block_verified", "outcome:channel_linked", "outcome:amount_declined"],
          "반복": ["outcome:card_used"], "동시": ["outcome:day_full", "outcome:card_stale"], "한도": ["outcome:order_limit_reached"], "외부": ["outcome:retry_needed"],
          "노출": ["closed", "outcome:server_error", "note:주문자 이름·연락처·입금자 이름·알레르기 답은 AI로 보내지 않음(REQ-178, REQ-204)"],
          "AI": ["outcome:card_not_yours", "outcome:card_stale", "outcome:card_expired", "note:AI가 제안한 카드의 값은 서버 기록에서만 옴(SPEC-069)"],
          "화면": ["screen"]})

op(id="API-072", method="post", path="/kakao/skills/review", op="submitReview", tag="카카오 스킬",
   summary="후기 수신(카카오 오픈빌더 스킬)", auth="skill", outcomes=REVIEW_OUTCOMES,
   spec=["SPEC-062", "SPEC-019", "SPEC-061", "SPEC-008"],
   desc="후기 부탁 안내(SPEC-061)의 버튼이 여는 오픈빌더 '후기' 블록이 보내는 스킬(DEC-18). action.params의 review_text(1~1,000자), "
        "review_photos(보안 이미지 플러그인 값: privacyAgreement·imageQuantity·secureUrls·expire, 5장까지), photo_consent(그 사진들을 가게 포트폴리오와 예약 링크 페이지에 올려도 되는지와 언제든 철회할 수 있음을 한 문장으로 후기 하나에 한 번 물은 답. 기본 동의 안 함이고 답을 사진마다 남김, REQ-208, 설계 재검토 H10, 잠정, 5-2 질문 6의 답으로 다시 봄)와 clientExtra.orderNo. "
        "받은 주문이고 그 주문을 요청한 사용자일 때만 남긴다. 사진은 서명 주소가 사는 10분 안에 내려받고 한 번 다시 받아도 실패하면 photo_download_failed. 같은 주문의 두 번째 후기는 새 버전. "
        "후기 부탁 버튼은 그 가게가 넣은 '후기' 블록 ID를 부른다. 연결 확인 중에 시험 사용자가 누른 시험 버튼(clientExtra.check: review)은 후기를 남기지 않고 그 블록이 닿았다는 것만 남기며, "
        "다섯째로 닿았으면 채널을 '연결됨'으로 묶는다(block_verified·channel_linked, SPEC-008, REQ-206). 글과 동의를 채운 PC 후기 블록은 최종 요청에서도 clientExtra.orderNo를 전달했다. 번호가 없으면 같은 사용자의 최근 후기 부탁을 사용한다. 보안 이미지 플러그인의 휴대폰 시험은 TASK-167에서 진행한다(DEC-30, K-08).",
   body="SkillPayload", body_examples={"review": E.SKILL_REVIEW, "check_button": E.SKILL_CHECK_REVIEW},
   ok=[(200, "SkillTemplateResponse", dict({k: E.SKILL_OUTCOME_EXAMPLES[k] for k in REVIEW_OUTCOMES},
                                          duplicate=E.SKILL_OUTCOME_EXAMPLES["review_saved"],
                                          block_verified=E.REVIEW_BLOCK_VERIFIED), ["Siljang-Outcome"])],
   errors={401: ["skill_key_invalid"]},
   fields=[("/action/params", "required")],
   omit=dict(SKILL_OMIT, **{"429": "후기는 주문마다 받아 빈도 한도가 없음"}),
   kinds={"접근": ["security", "401:skill_key_invalid", "outcome:review_not_allowed"], "입력": ["422:validation_failed", "outcome:review_invalid"],
          "대상": ["outcome:review_not_allowed"], "상태": ["outcome:block_verified", "outcome:channel_linked"],
          "반복": ["outcome:duplicate", "note:같은 주문의 두 번째 후기는 새 버전"],
          "한도": ["outcome:review_invalid"], "외부": ["outcome:photo_download_failed"], "노출": ["closed", "outcome:server_error"],
          "화면": ["screen"]})

op(id="API-073", method="post", path="/kakao/skills/event", op="showNotice", tag="카카오 스킬",
   summary="먼저 보내는 안내 보이기(카카오 Event API가 부르는 스킬)", auth="skill", outcomes=EVENT_OUTCOMES,
   spec=["SPEC-066", "SPEC-008", "SPEC-053", "SPEC-076", "SPEC-036"],
   desc="우리 서버가 우리 카카오 디벨로퍼스 앱의 키로 가게 봇의 Event API(이벤트 이름 siljang_notice, 받는 사람은 손님의 봇 사용자 키)를 부르면, 가게 봇의 '안내' 블록이 이 스킬을 부른다(DEC-20, 설계 재검토 H7). "
        "userRequest.params의 noticeKey로 그 가게의 안내를 찾아 저장된 글과 버튼을 보이고(notice_shown), check가 event면 연결 확인의 시험 안내를 보인다(notice_test, SPEC-008). "
        "안내 키가 없거나 그 가게 것이 아니면 짧은 글만 보인다(notice_gone). 안내 글은 서버의 정해진 템플릿이고 AI를 호출하지 않으며 광고를 넣지 않는다(SPEC-066). "
        "확정 안내는 주문 내용·픽업 일시·결제가 확인된 금액·가게의 상호·대표자·사업장 주소·전화번호(주문 확정 때의 확인된 값)를 담은 글과 그 주문의 운영규정 버전의 취소·환불 규정 글을 보인다(SPEC-036, REQ-242). "
        "완성 사진 안내(SPEC-053)는 사진과 함께, 그 사진을 가게 포트폴리오와 예약 링크 페이지에 올려도 되는지와 언제든 철회할 수 있음을 한 문장으로 묻는 사진 게시 동의 카드(버튼 '올려도 돼요'·'안 돼요', 그 가게의 '확인 카드' 블록, 30분)를 보이고, "
        "누른 답은 카드 스킬로 와서 그 안내의 사진마다 남는다(API-071 photo_consent_saved, REQ-207, 설계 재검토 H10, 잠정, 5-2 질문 6의 답으로 다시 봄). "
        "손님에게 닿았는지는 이 호출이 아니라 발송 결과 조회로 본다(REQ-182, 서버 안의 일). 안내를 만들지 못하면 200 대신 500을 반환해 카카오가 그 안내를 보내지 않게 하고(발송 결과 errorType 201), "
        "그 안내는 다음 대화 때 먼저 전한다(DEC-20이 정한 DEC-07의 예외). "
        "새 금액 확인이 필요한 결제 안내는 계좌 자리 대신 새 금액 확인 카드(맞춤 주문은 요청한 견적·정한 금액·사유와 '이 금액으로 할게요'·'안 할래요', 변경은 바뀌는 내용·지금 금액과 새 금액·차액·변경 마감과 '바꿀게요'·'그대로 둘래요', 그 가게의 '확인 카드' 블록, 30분)를 보이고, "
        "누른 답은 카드 스킬로 온다(API-071 amount_confirmed·amount_declined, SPEC-076, REQ-232). "
        "결제 안내의 글에는 계좌번호를 넣어 두지 않고 계좌 자리만 두며, 이 스킬이 보일 때 그 결제 안내의 계좌를 복호화해 채운다(SPEC-032, REQ-191). "
        "가게 채널·우리 앱·월렛의 실제 연결과 Event API 스킬 요청 확인은 출시 검토 TASK-167에서 진행한다(DEC-20).",
   body="SkillPayload", body_examples={"notice": E.SKILL_NOTICE, "event_test": E.SKILL_EVENT_TEST},
   ok=[(200, "SkillTemplateResponse", {k: E.SKILL_OUTCOME_EXAMPLES[k] for k in EVENT_OUTCOMES}, ["Siljang-Outcome"])],
   errors={401: ["skill_key_invalid"]},
   fields=[("/userRequest", "required")],
   omit=dict(SKILL_OMIT, **{"404": "경로에 기록 ID가 없음. 없는 안내 키는 결과 notice_gone(DEC-07)",
                            "409": "같은 안내 키로 다시 불려도 200과 같은 글(DEC-07)",
                            "429": "우리 서버가 보낸 이벤트로만 불림(보내는 빈도는 우리가 정함)"}),
   kinds={"접근": ["security", "401:skill_key_invalid", "note:그 가게의 안내만 보임(G1)"], "입력": ["422:validation_failed"],
          "대상": ["outcome:notice_gone"], "상태": ["outcome:notice_test"],
          "반복": ["note:같은 안내 키로 다시 불려도 같은 글(SPEC-066)"],
          "외부": ["note:안내를 만들지 못하면 500으로 카카오가 보내지 않음(errorType 201), 다음 대화 때 먼저 전함"],
          "노출": ["closed", "note:Event API에는 안내 키만 보내고 글은 이 스킬이 우리 기록에서 읽음(SPEC-066)"], "화면": ["screen"]})
