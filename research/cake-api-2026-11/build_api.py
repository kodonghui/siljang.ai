#!/usr/bin/env python3
"""06단계 API 계약 만들기.

research/cake-api-2026-11의 목록(api_catalog.py)·스키마(api_schemas.py)·예시(api_examples.py)·API(api_ops.py)로
api/openapi.yaml을 만들고, docs/06-api/README.md의 표시(<!-- BEGIN generated:이름 --> … <!-- END generated:이름 -->) 사이를 채운다.

  python3 -B research/cake-api-2026-11/build_api.py . --write   # 파일을 씀
  python3 -B research/cake-api-2026-11/build_api.py .           # 쓰지 않고 견줌. 파일과 다르면 1로 끝남

계약을 고칠 때는 위 네 파일을 고치고 다시 만든다. api/openapi.yaml을 손으로 고치지 않는다.
"""
import copy
import json
import re
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import api_catalog as C  # noqa: E402
import api_examples as E  # noqa: E402
import api_ops as O  # noqa: E402
import api_schemas as SC  # noqa: E402

OPENAPI_PATH = "api/openapi.yaml"
README_PATH = "docs/06-api/README.md"
TITLE = "Siljang API"
VERSION = "0.1.0"
SCHEMA_REF = "#/components/schemas/"

SECURITY = {
    "owner": [{"ownerSession": []}],
    "operator": [{"operatorSession": []}],
    "owner?": [{"ownerSession": []}, {}],
    "operator?": [{"operatorSession": []}, {}],
    "skill": [{"kakaoSkillKey": []}],
    "public": [],
}
AUTH_WORDS = {"owner": "사장님", "operator": "운영자", "owner?": "사장님(없어도 됨)", "operator?": "운영자(없어도 됨)",
              "public": "누구나", "skill": "스킬 키"}
SIGNED_IN = {"owner", "operator", "skill"}

TAGS = [
    ("로그인", "사장님(카카오 로그인)과 운영자(이메일·비밀번호·2단계 인증)의 세션(DEC-10, DEC-11)"),
    ("파일", "신고증·도안·완성 사진을 먼저 올리고 uploadId로 씀(DEC-09)"),
    ("가게", "가게 등록과 설정, 영업 신고 다시 올리기"),
    ("운영자", "영업 신고 확인과 운영자 알림, 가게 기록 보기(가린 값과 사유를 적은 원래 값 열기, SPEC-073)"),
    ("가격표", "버전으로 남는 가격표(REQ-027)"),
    ("운영규정", "버전으로 남는 운영규정과 단계별 환불(SPEC-005)"),
    ("결제 수단", "가게 명의 계좌와 카드 결제 링크(SPEC-006)"),
    ("영업 캘린더", "요일 휴무·하루 최대 개수·주문 마감과 날짜별 바꾸기(SPEC-007, SPEC-012)"),
    ("카카오톡 채널", "오픈빌더 봇 연결과 스킬 설정 값(SPEC-008, DEC-08)"),
    ("장부", "구글 시트 장부 연결(SPEC-009, SPEC-064)"),
    ("예약 링크", "예약 링크 조건과 누구나 여는 예약 링크 페이지·처리방침(SPEC-010, SPEC-011)"),
    ("할 일", "사장님이 정할 일 목록(SPEC-067)"),
    ("에스컬레이션 건·상담", "AI가 에스컬레이션 건과 상담 대화(SPEC-021~024)"),
    ("주문", "주문 보기와 맞춤 주문·결제 기한·가게 사정 취소(SPEC-031, SPEC-037~039, SPEC-048)"),
    ("환불", "환불 계산과 정하기, '보냄' 표시. 우리는 돈을 옮기지 않음(REQ-079)"),
    ("제작", "제작 목록과 표시, 인도·미수령·폐기(SPEC-050~055)"),
    ("결제 안내", "입금 대조(SPEC-034~036)"),
    ("변경 요청", "손님 변경 요청에 답하기(SPEC-042~045)"),
    ("문제 신고", "문제 신고와 보상(SPEC-058~060)"),
    ("후기·포트폴리오", "후기와 사진 게시 동의, 포트폴리오(SPEC-062, SPEC-063)"),
    ("카카오 스킬", "카카오 오픈빌더가 호출하는 스킬. 늘 200과 스킬 응답(DEC-07)"),
]

EXAMPLE_SUMMARY = {
    "unchanged": "이미 그 상태라 바꾼 것 없음(DEC-03)",
    "created": "새로 만듦",
    "empty": "빈 목록",
    "updated": "바꿈",
}

STATUS_TEXT = {
    401: "로그인이나 스킬 키가 없거나 맞지 않음",
    404: "찾을 수 없음(DEC-02)",
    409: "지금 상태와 충돌해 아무것도 바꾸지 않음",
    413: "파일이 그 용도의 한도를 넘음",
    422: "입력이 계약에 맞지 않아 아무것도 바꾸지 않음(DEC-01)",
    429: "너무 자주 호출함(DEC-16)",
    503: "외부 서비스가 답하지 않아 아무것도 바꾸지 않음",
    "default": "예상하지 못한 서버 오류(500). 내용은 로그에만",
}

CONFIRM_FACTS = {
    "closed_day_with_orders": {"count": 2, "day": "2026-11-20"},
    "capacity_below_held": {"count": 2, "day": "2026-11-20"},
    "overbooking": {"day": "2026-11-20"},
    "not_pickup_day": {"day": "2026-11-20"},
    "closed_day": {"day": "2026-11-25"},
    "past_cutoff": {"day": "2026-11-20"},
}


# ── API 하나 ─────────────────────────────────────────────────────────────────
def error_codes(o):
    """API가 반환하는 오류 코드(상태 → 코드 목록). 규칙으로 더하는 것: 401 unauthenticated, 422 validation_failed,
    요청 키 API의 422 idempotency_key_reused와 409 request_in_progress."""
    errs = {int(k): list(v) for k, v in o["errors"].items()}
    if o["auth"] in ("owner", "operator"):
        errs[401] = ["unauthenticated"] + [c for c in errs.get(401, []) if c != "unauthenticated"]
    if o["idem"]:
        assert "422" not in o["omit"] and "409" not in o["omit"], o["id"] + ": 요청 키 API는 422·409를 뺄 수 없음"
    if "422" not in o["omit"]:
        rest = [c for c in errs.get(422, []) if c != "validation_failed"]
        errs[422] = ["validation_failed"] + rest + (["idempotency_key_reused"] if o["idem"] else [])
    if o["idem"]:
        errs[409] = errs.get(409, []) + ["request_in_progress"]
    return dict(sorted(errs.items()))


def path_params(o):
    return [p for p in o["params"] if isinstance(p, dict) and p.get("in") == "path"]


def instance(o):
    path = o["path"]
    for p in path_params(o):
        path = path.replace("{" + p["name"] + "}", str(p["example"]))
    return path


def field_errors(o):
    fields = list(o["fields"])
    if not fields and o["idem"]:
        fields = [("header:Idempotency-Key", "required")]
    assert fields, o["id"] + ": validation_failed 예시의 필드 오류가 없음"
    return [{"field": f, "code": c} for f, c in fields]


def problem(o, status, code, *, fields=None, detail=None, kinds=None):
    e = C.ERRORS[code]
    assert e["status"] == status, (o["id"], code, status)
    # 확인할 것이 여럿인 API는 확인할 것마다 예시 하나(첫 것만 예전 traceId 그대로)
    extra = ":" + kinds[0] if kinds and o["confirm"] and kinds[0] != o["confirm"][0] else ""
    v = {"type": f"/problems/{code}", "title": e["message"], "status": status,
         "detail": detail or e["meaning"].split(". ")[0], "instance": instance(o), "code": code,
         "traceId": E.trace(o["id"] + ":" + code + ":" + str(len(fields or [])) + extra)}
    if code == "validation_failed":
        v["errors"] = fields if fields is not None else field_errors(o)
    if code == "confirmation_required":
        items, words = [], []
        for kind in kinds or o["confirm"]:
            item = {"kind": kind, **CONFIRM_FACTS.get(kind, {})}
            if o["multi_day_confirm"]:
                item.pop("day", None)
            items.append(item)
            words.append(C.CONFIRMATIONS[kind]["message"].format(count=item.get("count", "")))
        assert items, o["id"] + ": confirmation_required에 확인할 것이 없음"
        v["confirm"] = items
        v["detail"] = " ".join(words)
    if status == 429:
        v["retryAfterSeconds"] = 30
    return v


def error_response(o, status, codes):
    examples = {}
    for code in codes:
        if code == "confirmation_required" and len(o["confirm"]) > 1:
            for i, kind in enumerate(o["confirm"]):
                examples[code if i == 0 else f"{code}_{kind}"] = {"value": problem(o, status, code, kinds=[kind])}
            continue
        examples[code] = {"value": problem(o, status, code)}
    if status == 422 and o["idem"] and o["fields"]:
        examples["missing_idempotency_key"] = {
            "summary": "요청 키 헤더가 없음(DEC-04)",
            "value": problem(o, 422, "validation_failed", fields=[{"field": "header:Idempotency-Key", "code": "required"}],
                             detail="요청 키 헤더가 없음")}
    lines = "\n".join(f"- `{c}`: {C.ERRORS[c]['meaning']}" for c in codes)
    r = {"description": f"{STATUS_TEXT[status]}\n\n{lines}"}
    if status == 429:
        r["headers"] = {"Retry-After": {"$ref": "#/components/headers/RetryAfter"}}
    r["content"] = {"application/problem+json": {"schema": {"$ref": SCHEMA_REF + "Problem"}, "examples": examples}}
    return r


def header(name, o):
    if name == "Set-Cookie" and o["path"] == "/owner/session/authorization":
        return {"description": "로그인 시작 쿠키 `siljang_login`(HttpOnly·Secure·SameSite=Lax, 10분). state의 nonce를 담고, POST /owner/session이 견준 뒤 지움(DEC-10)",
                "required": True, "schema": {"type": "string", "maxLength": 4096},
                "example": "siljang_login=example-login-not-real; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600"}
    if name == "Set-Cookie":
        cookie = "siljang_operator" if o["path"].startswith("/operator") else "siljang_owner"
        ending = o["method"] == "delete"
        value = f"{cookie}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" if ending else \
            f"{cookie}=example-session-not-real; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + \
            ("43200" if cookie == "siljang_operator" else "2592000")
        return {"description": f"세션 쿠키 `{cookie}`(HttpOnly·Secure·SameSite=Lax, DEC-10). " +
                               ("로그아웃이면 지움(Max-Age=0)" if ending else "세션 길이는 DEC-26: " + ("운영자 12시간" if cookie == "siljang_operator" else "사장님 30일, 쓰면 늘어남")),
                "required": True, "schema": {"type": "string", "maxLength": 4096}, "example": value}
    if name == "Siljang-Outcome":
        return {"description": "스킬 결과 코드(DEC-07). 200 예시 이름과 같음. 뜻은 components.x-corthex.skillOutcomes",
                "required": True, "schema": {"type": "string", "enum": list(o["outcomes"])}}
    if name == "Cache-Control":
        return {"description": "최대 60초 캐시. 내린 사진은 5분 안에 사라짐(SPEC-063)", "required": True,
                "schema": {"type": "string", "maxLength": 100}, "example": "public, max-age=60"}
    raise KeyError(name)


def ok_response(o, status, schema, examples, headers):
    names = list(examples)
    r = {"description": "성공" + (". 예시: " + ", ".join(names) if names else "")}
    if o["auth"] == "skill":
        r["description"] = "스킬 응답. 결과는 Siljang-Outcome 헤더와 같은 이름의 예시(DEC-07)"
    hdrs = {h: header(h, o) for h in headers}
    if o["idem"]:
        hdrs["Idempotency-Replayed"] = {"$ref": "#/components/headers/IdempotencyReplayed"}
    if hdrs:
        r["headers"] = hdrs
    if schema:
        ex = {}
        for name, value in examples.items():
            item = {}
            if o["auth"] == "skill" and name in C.SKILL_OUTCOMES:
                item["summary"] = C.SKILL_OUTCOMES[name]["meaning"]
            elif name in EXAMPLE_SUMMARY:
                item["summary"] = EXAMPLE_SUMMARY[name]
            item["value"] = copy.deepcopy(value)
            ex[name] = item
        r["content"] = {"application/json": {"schema": {"$ref": SCHEMA_REF + schema}, "examples": ex}}
    return r


def callbacks():
    names = ["answered", "handed_over", "ai_unavailable", "ai_timeout", "ai_output_rejected"]
    return {"kakaoCallback": {"{$request.body#/userRequest/callbackUrl}": {"post": {
        "summary": "콜백으로 답 보내기(우리 서버 → 카카오)",
        "description": "callback_pending으로 응답한 메시지의 답을 userRequest.callbackUrl로 한 번 보낸다(OPEN-2의 유효 시간 안). "
                       "본문은 스킬 응답과 같은 형식이고 결과 이름은 로그에 남긴다. 카카오가 실패를 반환하면 다시 보내지 않고 운영 기록에 남긴다.",
        "requestBody": {"required": True, "content": {"application/json": {
            "schema": {"$ref": SCHEMA_REF + "SkillTemplateResponse"},
            "examples": {n: {"summary": C.SKILL_OUTCOMES[n]["meaning"], "value": copy.deepcopy(E.SKILL_OUTCOME_EXAMPLES[n])} for n in names}}}},
        "responses": {"200": {"description": "카카오가 콜백을 받음",
                              "content": {"application/json": {"schema": {"$ref": SCHEMA_REF + "KakaoCallbackResult"},
                                                               "examples": {"success": {"value": copy.deepcopy(E.CALLBACK_RESULT)}}}}}},
    }}}}


def description(o):
    text = o["desc"]
    text += "\n\nSPEC: " + ", ".join(o["spec"])
    return text


def build_operation(o):
    d = {"operationId": o["op"], "summary": o["summary"], "description": description(o), "tags": [o["tag"]]}
    params = [{"$ref": p} if isinstance(p, str) else copy.deepcopy(p) for p in o["params"]]
    if o["idem"]:
        params.append({"$ref": "#/components/parameters/IdempotencyKey"})
    if params:
        d["parameters"] = params
    d["security"] = copy.deepcopy(SECURITY[o["auth"]])
    if o["body"]:
        if o["body_type"] == "multipart":
            content = {"multipart/form-data": {"schema": {"$ref": SCHEMA_REF + o["body"]},
                                               "encoding": {"file": {"contentType": ", ".join(SC.IMAGE_TYPES)}}}}
        else:
            content = {"application/json": {"schema": {"$ref": SCHEMA_REF + o["body"]}}}
            if o["body_examples"]:
                content["application/json"]["examples"] = {k: {"value": copy.deepcopy(v)} for k, v in o["body_examples"].items()}
        d["requestBody"] = {"required": True, "content": content}
    responses = {}
    for entry in o["ok"]:
        status, schema, examples = entry[0], entry[1], entry[2]
        headers = entry[3] if len(entry) > 3 else []
        responses[str(status)] = ok_response(o, status, schema, examples, headers)
    for status, codes in error_codes(o).items():
        responses[str(status)] = error_response(o, status, codes)
    responses["default"] = {
        "description": STATUS_TEXT["default"],
        "content": {"application/problem+json": {"schema": {"$ref": SCHEMA_REF + "Problem"},
                                                 "examples": {"internal": {"value": problem(o, 500, "internal")}}}}}
    d["responses"] = responses
    if o["callbacks"]:
        d["callbacks"] = callbacks()
    d["x-corthex"] = {"id": o["id"], "spec": list(o["spec"]), "omit": dict(o["omit"]), "kinds": copy.deepcopy(o["kinds"])}
    if o["outcomes"]:
        d["x-corthex"]["outcomes"] = list(o["outcomes"])
    if o["ai"]:
        d["x-corthex"]["ai"] = o["ai"]
    return d


# ── 계약 전체 ─────────────────────────────────────────────────────────────────
def usage():
    """오류 코드·결과·확인할 것을 쓰는 작업."""
    errs, outs, confs = {}, {}, {}
    for o in O.OPS:
        for codes in error_codes(o).values():
            for c in codes:
                errs.setdefault(c, []).append(o["id"])
        errs.setdefault("internal", []).append(o["id"])
        for c in o["outcomes"]:
            outs.setdefault(c, []).append(o["id"])
        for c in o["confirm"]:
            confs.setdefault(c, []).append(o["id"])
    return errs, outs, confs


def schemas():
    S = copy.deepcopy(SC.S)
    S["Problem"]["properties"]["code"]["enum"] = list(C.ERRORS)
    S["FieldError"]["properties"]["code"]["enum"] = list(C.FIELD_CODES)
    S["ConfirmationNeeded"]["properties"]["kind"]["enum"] = list(C.CONFIRMATIONS)
    return S


INFO_DESCRIPTION = """수제케이크 주문제작 AI 상담·예약(Siljang)의 API 계약. 05단계 테이블(db/schema.sql)과 04단계 기능 명세(SPEC-001~079)에서 만들었다.
이 파일은 research/cake-api-2026-11/build_api.py가 만든다. 손으로 고치지 않는다.

**API와 응답의 ID.** API마다 `x-corthex.id`(API-001~083)와 `x-corthex.spec`(SPEC ID). 응답 하나는 `API-001#401`처럼 쓴다.
`x-corthex.omit`은 응답 목록(2xx·422·401·403·404·409·default) 가운데 그 API가 반환하지 않는 것과 사유, `x-corthex.kinds`는 케이스 유형마다 그 경우를 보여 주는 응답·예시다.

**오류 형식.** 모든 오류는 RFC 9457 Problem Details(`application/problem+json`)에 `code`와 `traceId`를 더한 형식. 코드는 `components.x-corthex.errors`에만 있다.
입력 오류는 모두 422 `validation_failed`와 필드마다 `errors[{field, code}]`(DEC-01). 경로의 없는 ID·다른 가게 ID·형식이 틀린 ID는 같은 404, 본문·쿼리가 가리킨 다른 기록의 ID가 없거나 다른 가게 것이면 같은 422 `reference_not_found`(DEC-02). 403은 쓰지 않는다.

**명령.** 같은 상태로 가는 명령은 200과 `outcome: unchanged`(DEC-03). 사장님·운영자의 쓰기 명령은 `Idempotency-Key` 헤더(DEC-04)와 본문의 `baseRevision`(DEC-05)을 보낸다.
확인이 필요한 저장은 409 `confirmation_required`와 `confirm` 목록을 받고, 확인하면 같은 요청에 `confirm`을 담아 새 요청 키로 다시 보낸다(DEC-06).

**카카오 스킬.** 늘 200과 스킬 응답, 결과는 `Siljang-Outcome` 헤더와 같은 이름의 예시(DEC-07). 인증은 오픈빌더 헤더 값 `Siljang-Skill-Key`의 연결마다 버전이 있는 스킬 키로, 바꾼 뒤 24시간은 앞 버전도 받는다(DEC-08).

**형식.** 돈은 원 단위 정수, 시각은 가게 시간대 오프셋을 붙인 RFC 3339, 날짜는 가게 시간대의 YYYY-MM-DD(DEC-15). 목록은 `cursor`·`limit`(DEC-14).

**목 서버.** `npx @stoplight/prism-cli mock api/openapi.yaml`. 헤더 `Prefer: code=409, example=version_conflict`로 다른 응답과 예시를 고른다.
로그인 없이 호출하면 401의 첫 예시, 입력이 틀리면 422의 첫 예시(`validation_failed`)가 온다. 예시의 가게 '달빛케이크'와 모든 값은 지어낸 것이다."""


def build_document():
    ops = sorted(O.OPS, key=lambda o: o["id"])
    tag_names = [t for t, _ in TAGS]
    assert {o["tag"] for o in ops} == set(tag_names), {o["tag"] for o in ops} ^ set(tag_names)
    paths = {}
    for o in ops:
        paths.setdefault(o["path"], {})[o["method"]] = build_operation(o)
    errs, outs, confs = usage()
    x = {
        "errors": {c: {**{k: v for k, v in e.items()}, "operations": errs.get(c, [])} for c, e in C.ERRORS.items()},
        "fieldErrors": dict(C.FIELD_CODES),
        "confirmations": {k: {**v, "operations": confs.get(k, [])} for k, v in C.CONFIRMATIONS.items()},
        "skillOutcomes": {k: {**v, "operations": outs.get(k, [])} for k, v in C.SKILL_OUTCOMES.items()},
        "decisions": [{k: v for k, v in d.items()} for d in C.DECISIONS],
        "open": [dict(d) for d in C.OPEN_QUESTIONS],
        "jobs": [dict(d) for d in C.JOBS],
        "kinds": list(C.KINDS),
        "breakingChanges": [dict(d) for d in C.BREAKING_CHANGES],
    }
    doc = {
        "openapi": "3.1.0",
        "info": {"title": TITLE, "version": VERSION, "summary": "수제케이크 주문제작 AI 상담·예약 API(06단계 계약, 첫 버전)",
                 "description": INFO_DESCRIPTION,
                 "x-corthex": {"stage": "06-api", "source": "research/cake-api-2026-11/build_api.py",
                               "inputs": ["docs/04-functional-spec/spec.md", "db/schema.sql", "docs/01-domain/domain.md"]}},
        "servers": [{"url": "https://api.siljang.example", "description": "지어낸 주소. 실제 주소는 11단계에서 정함"}],
        "tags": [{"name": n, "description": d} for n, d in TAGS],
        "paths": paths,
        "components": {
            "schemas": schemas(),
            "parameters": {
                "Cursor": {"name": "cursor", "in": "query", "required": False, "description": "앞 응답의 nextCursor(DEC-14). 형식이 틀리면 422",
                           "schema": copy.deepcopy(SC.CURSOR)},
                "Limit": {"name": "limit", "in": "query", "required": False, "description": "한 번에 받을 행 수(DEC-14)",
                          "schema": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20}},
                "IdempotencyKey": {"name": "Idempotency-Key", "in": "header", "required": True,
                                   "description": "화면이 버튼마다 만든 요청 키(DEC-04, G2). 같은 키가 다시 오면 처음 결과의 상태 코드와 그 기록의 지금 상태를 반환함. 같은 키에 다른 내용은 422 idempotency_key_reused, 처리 중이면 409 request_in_progress",
                                   "schema": {"type": "string", "minLength": 16, "maxLength": 64, "pattern": "^[A-Za-z0-9_-]{16,64}$",
                                              "x-corthex-column": "request_keys.request_key"},
                                   "example": "ui-" + E.h("idempotency", 29)},
            },
            "headers": {
                "IdempotencyReplayed": {"description": "같은 요청 키로 다시 온 요청에 처음 결과(같은 상태 코드, 본문은 그 기록을 지금 다시 읽은 것)를 반환할 때만 true(DEC-04)",
                                        "schema": {"type": "string", "enum": ["true"]}},
                "RetryAfter": {"description": "다시 호출할 수 있을 때까지 초(DEC-16)", "required": True,
                               "schema": {"type": "integer", "minimum": 1, "maximum": 3600}, "example": 30},
            },
            "securitySchemes": {
                "ownerSession": {"type": "apiKey", "in": "cookie", "name": "siljang_owner",
                                 "description": "사장님 세션 쿠키(HttpOnly·Secure·SameSite=Lax). POST /owner/session/authorization의 state로 시작한 로그인에 POST /owner/session이 줌(DEC-10)"},
                "operatorSession": {"type": "apiKey", "in": "cookie", "name": "siljang_operator",
                                    "description": "운영자 세션 쿠키(HttpOnly·Secure·SameSite=Lax). POST /operator/session이 줌(DEC-11)"},
                "kakaoSkillKey": {"type": "apiKey", "in": "header", "name": "Siljang-Skill-Key",
                                  "description": "가게 연결마다 다른 스킬 키. 오픈빌더 스킬 설정의 헤더 값. 지금 버전과, 바꾼 뒤 24시간 동안의 앞 버전을 받음(DEC-08, REQ-237)"},
            },
            "x-corthex": x,
        },
    }
    return doc


# ── YAML ─────────────────────────────────────────────────────────────────────
class Dumper(yaml.SafeDumper):
    def ignore_aliases(self, data):
        return True


# YAML 1.2 읽개(Prism 등)가 글자가 아닌 값으로 읽을 수 있는 글자는 늘 따옴표로
YAML12_NON_STRING = re.compile(
    r"^([-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?|0o[0-7]+|0x[0-9a-fA-F]+|[-+]?\.(inf|Inf|INF)|\.(nan|NaN|NAN)"
    r"|true|True|TRUE|false|False|FALSE|null|Null|NULL|~|y|Y|n|N|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF)$")


def _str(dumper, data):
    if YAML12_NON_STRING.match(data):
        return dumper.represent_scalar("tag:yaml.org,2002:str", data, style='"')
    if "\n" in data:
        return dumper.represent_scalar("tag:yaml.org,2002:str", data, style="|")
    return dumper.represent_scalar("tag:yaml.org,2002:str", data)


Dumper.add_representer(str, _str)

HEADER = ("# 06단계 API 계약(OpenAPI 3.1). research/cake-api-2026-11/build_api.py가 만든 파일이라 손으로 고치지 않습니다.\n"
          "# 고칠 때: research/cake-api-2026-11의 api_catalog.py·api_schemas.py·api_examples.py·api_ops.py를 고치고\n"
          "#   python3 -B research/cake-api-2026-11/build_api.py . --write\n"
          "# 검사: research/cake-api-2026-11/check_api.py (README의 '검사' 절)\n")


def to_yaml(doc):
    return HEADER + yaml.dump(doc, Dumper=Dumper, sort_keys=False, allow_unicode=True, width=100000, default_flow_style=False)


# ── README 표 ────────────────────────────────────────────────────────────────
def cell(text):
    return str(text).replace("|", "\\|").replace("\n", " ")


def ops_table():
    rows = ["| ID | API | 방법·경로 | operationId | 호출하는 쪽 | SPEC | 응답 |", "| --- | --- | --- | --- | --- | --- | --- |"]
    for o in sorted(O.OPS, key=lambda o: o["id"]):
        statuses = [str(e[0]) for e in o["ok"]] + [str(s) for s in error_codes(o)] + ["default"]
        rows.append(f"| {o['id']} | {cell(o['summary'])} | `{o['method'].upper()} {o['path']}` | `{o['op']}` | {AUTH_WORDS[o['auth']]} | "
                    f"{', '.join(o['spec'])} | {' · '.join(statuses)} |")
    return "\n".join(rows)


def errors_table():
    errs, _, _ = usage()
    rows = ["| 코드 | 상태 | 뜻 | 화면에 보이는 말 | 화면이 할 일 | 근거 | 쓰는 API |", "| --- | --- | --- | --- | --- | --- | --- |"]
    for c, e in C.ERRORS.items():
        used = errs.get(c, [])
        where = (", ".join(used) if len(used) <= 6 else f"{len(used)}개") if used else e.get("scope", "")
        rows.append(f"| `{c}` | {e['status']} | {cell(e['meaning'])} | {cell(e['message'])} | {cell(e['client'])} | {e['spec']} | {where} |")
    return "\n".join(rows)


def outcomes_table():
    _, outs, _ = usage()
    rows = ["| 결과 | API | 뜻 | 손님에게 가는 말 | 에스컬레이션 건 | 근거 |", "| --- | --- | --- | --- | --- | --- |"]
    for c, e in C.SKILL_OUTCOMES.items():
        rows.append(f"| `{c}` | {', '.join(outs.get(c, []))} | {cell(e['meaning'])} | {cell(e['message'])} | "
                    f"{cell(e.get('handoff', ''))} | {e['spec']} |")
    return "\n".join(rows)


def confirm_table():
    _, _, confs = usage()
    rows = ["| 확인할 것 | API | 뜻 | 화면에 보이는 말 | 근거 |", "| --- | --- | --- | --- | --- |"]
    for k, v in C.CONFIRMATIONS.items():
        rows.append(f"| `{k}` | {', '.join(confs.get(k, []))} | {cell(v['meaning'])} | {cell(v['message'])} | {v['spec']} |")
    return "\n".join(rows)


def fields_table():
    rows = ["| 사유 코드 | 뜻 |", "| --- | --- |"]
    rows += [f"| `{k}` | {cell(v)} |" for k, v in C.FIELD_CODES.items()]
    return "\n".join(rows)


def decisions_table():
    rows = ["| ID | 결정 사항 | 선택안 | 사유 | 대안 | 상태 |", "| --- | --- | --- | --- | --- | --- |"]
    for d in C.DECISIONS:
        state = d.get("decided") or ("동희님 판단 필요" if d.get("needs_user") else "추천")
        rows.append(f"| {d['id']} | {cell(d['title'])} | {cell(d['choice'] + (' 예외: ' + d['exception'] if d.get('exception') else ''))} | {cell(d['why'])} | {cell(d['alt'])} | "
                    f"{cell(state)} |")
    return "\n".join(rows)


def open_table():
    rows = ["| ID | 자리 | 내용 |", "| --- | --- | --- |"]
    rows += [f"| {d['id']} | {d['where']} | {cell(d['text'])} |" for d in C.OPEN_QUESTIONS]
    return "\n".join(rows)


def jobs_table():
    rows = ["| SPEC | 서버가 하는 일 | 계약에서 보이는 곳 |", "| --- | --- | --- |"]
    rows += [f"| {d['spec']} | {cell(d['job'])} | {cell(d['seen_in'])} |" for d in C.JOBS]
    return "\n".join(rows)


def counts():
    n_resp = sum(len(o["ok"]) + len(error_codes(o)) + 1 for o in O.OPS)
    return (f"API {len(O.OPS)}개 · 응답 {n_resp}개 · 오류 코드 {len(C.ERRORS)}개 · 필드 오류 사유 {len(C.FIELD_CODES)}개 · "
            f"확인할 것 {len(C.CONFIRMATIONS)}개 · 스킬 결과 {len(C.SKILL_OUTCOMES)}개 · 결정 사항 {len(C.DECISIONS)}개 · "
            f"열린 질문 {len(C.OPEN_QUESTIONS)}개 · 서버 안의 일 {len(C.JOBS)}개 · 스키마 {len(SC.S)}개")


GENERATED = {"counts": counts, "operations": ops_table, "errors": errors_table, "field-codes": fields_table,
             "confirmations": confirm_table, "skill-outcomes": outcomes_table, "decisions": decisions_table,
             "open": open_table, "jobs": jobs_table}


def fill_readme(text):
    for name, fn in GENERATED.items():
        pat = re.compile(r"(<!-- BEGIN generated:%s -->\n).*?(<!-- END generated:%s -->)" % (re.escape(name), re.escape(name)), re.S)
        if not pat.search(text):
            raise SystemExit(f"README에 generated:{name} 표시가 없음")
        text = pat.sub(lambda m: m.group(1) + fn() + "\n" + m.group(2), text)
    return text


def main(argv):
    if len(argv) < 2:
        raise SystemExit(__doc__)
    root = Path(argv[1]).resolve()
    write = "--write" in argv
    outputs = {OPENAPI_PATH: to_yaml(build_document())}
    readme = root / README_PATH
    if readme.exists():
        outputs[README_PATH] = fill_readme(readme.read_text(encoding="utf-8"))
    else:
        print(f"참고: {README_PATH}가 없어 표를 채우지 않음")
    changed = []
    for rel, text in outputs.items():
        p = root / rel
        old = p.read_text(encoding="utf-8") if p.exists() else None
        if old != text:
            changed.append(rel)
            if write:
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(text, encoding="utf-8")
    if write:
        print("씀: " + (", ".join(changed) if changed else "바뀐 것 없음"))
        return 0
    if changed:
        print("다시 만들어야 함: " + ", ".join(changed))
        return 1
    print("만든 파일이 원본과 같음")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
