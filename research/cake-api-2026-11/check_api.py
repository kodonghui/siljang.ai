#!/usr/bin/env python3
"""06단계 API 계약 검사: CORTHEX 06-api 계약의 검사를 한 번에 돌린다.

검사 (실패가 하나라도 있으면 끝 상태 1)
  A0  build_api.py로 다시 만들어도 api/openapi.yaml과 README 표가 그대로
  A1  OpenAPI 3.1 문서로 맞음(openapi-spec-validator)
  A2  API마다 API ID(API-001부터 차례대로, 중복되지 않음)·operationId(중복되지 않음)·SPEC ID 하나 이상. SPEC ID는 04단계에 있는 것
  A3  04단계 SPEC마다 API나 서버 안의 일(components.x-corthex.jobs)이 있음
  A4  API마다 응답 목록(2xx·422·401·403·404·409·default)을 포함하거나 x-corthex.omit에 사유를 적음. 400은 쓰지 않음(DEC-01).
      경로에 기록 ID가 있으면 404, 입력이 있으면 422
  A5  내용이 있는 응답마다 이름 붙은 예시가 하나 이상. 모든 예시(요청·응답·콜백·매개변수·헤더)가 스키마(형식 포함)에 맞음.
      시각 예시는 가게 시간대 오프셋(+09:00, DEC-15). 스킬 200의 예시 이름 = 결과 목록 = Siljang-Outcome 헤더 값
  A6  오류 응답은 모두 Problem 형식(application/problem+json). 예시의 status가 응답과 같고, code가 목록에 같은 상태로 있고,
      type·title이 목록과 같음. 필드 오류의 필드가 그 요청에 있고, 확인할 것이 그 요청의 confirm 값에 있음.
      422의 첫 예시는 validation_failed, 로그인 API의 401 첫 예시는 unauthenticated(스킬은 skill_key_invalid). 429는 Retry-After
  A7  요청 필드마다 한도(글자 maxLength, 수 minimum·maximum, 목록 maxItems). 열린 객체는 카카오 스킬 요청 안에만.
      x-corthex-column이 참조하는 테이블.컬럼이 db/schema.sql에 있음
  A8  API마다 security가 있고, 로그인이 꼭 필요한 API는 401을 가짐. 쓴 보안 방식이 모두 정의됨
  A9  케이스 유형: API가 적은 근거가 모두 계약에 있고, 근거가 있으면 그 종류를 적음(보안→접근, 422→입력, 404→대상,
      요청 키→반복, baseRevision→동시, 429→한도, 503→외부), 목록 API는 빈 목록 예시, AI를 호출하는 API(x-corthex.ai)는 실패 넷
      (모델 실패·느림·키 없음·사용 한도)과 쓰기 전 확인 실패가 저마다 결과 코드를 가짐. 말로만 적은 근거(note:)는 세어 보고함
  A10 열린 질문(OPEN)마다 그 자리 설명에 'Open:'과 그 ID가 있고, 'Open:'마다 OPEN ID가 있음
  A11 계약에 나온 DEC ID가 모두 목록에 있고, 목록의 DEC가 모두 계약 어딘가(결정 사항 목록 밖)에 쓰임
  A12 계약에 나온 API ID가 모두 있는 API
  A13 깨지는 변화: 앞 계약(--base 파일, 없으면 main의 api/openapi.yaml)과 견줘 깨지는 변화가 모두 x-corthex.breakingChanges에 있음
  A14 노출: 성공 응답 스키마의 객체가 모두 닫혀 있고, 손님·공개 응답(/public/·카카오 스킬)에 uuid가 없고, 시크릿 같은 이름의 필드가 없음
  D1  (--db) db/schema.sql을 빈 DB에 적용하고, x-corthex-column 필드마다 계약이 허용하는 값을 만들어(hypothesis-jsonschema로
      고르게, 그리고 가장 긴·가장 짧은 글자, 가장 작은·큰 수, 고를 값 모두) 그 컬럼의 타입과 한 컬럼 CHECK에 넣어 봄. varchar(n)은 maxLength ≤ n
  M1  (--mock) 목 서버: API마다 맞는 요청은 계약의 2xx와 그 예시, 로그인 없으면 401 첫 예시, 틀린 입력은 422 첫 예시,
      응답·예시마다 'Prefer: code=…, example=…'로 그 예시가 그대로 옴

쓰는 법(저장소 맨 위에서, research/cake-api-2026-11/requirements.txt를 깐 파이썬으로)
  python -B research/cake-api-2026-11/check_api.py . [--db DSN] [--mock URL] [--base 파일] [--keep]
  --db를 빼면 D1을, --mock을 빼면 M1을 '미확인'으로 보고함. 검사용 DB api_check_schema를 만들고 끝나면 지움(--keep이면 남김).
  같은 이름의 DB가 있으면 지우고 다시 만드니 검사용 서버에서만 돌림.
"""
from __future__ import annotations

import copy
import datetime as dt
import importlib.util
import json
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
OPENAPI = "api/openapi.yaml"
README = "docs/06-api/README.md"
SCHEMA_SQL = "db/schema.sql"
SPEC_ROWS = "research/cake-spec-2026-11/spec_rows.py"
DB_NAME = "api_check_schema"
METHODS = ("get", "post", "put", "patch", "delete")
TABLE_KEYS = ("422", "401", "403", "404", "409")
SECRET_NAME = re.compile(r"(?i)(token|secret|password|passwd|storage|bucket|credential|private)")
ROOT_URI = "urn:siljang-openapi"


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


class Report:
    def __init__(self) -> None:
        self.rows: list[tuple[str, str, str]] = []

    def add(self, key: str, ok: bool | None, text: str, details: list[str] | None = None) -> None:
        word = {True: "통과", False: "실패", None: "미확인"}[ok]
        self.rows.append((key, word, text))
        print(f"{word} {key} {text}")
        for d in (details or [])[:40]:
            print(f"      {d}")
        if details and len(details) > 40:
            print(f"      … 그 밖에 {len(details) - 40}개")

    def summary(self) -> int:
        n = {w: sum(1 for _, x, _ in self.rows if x == w) for w in ("통과", "실패", "미확인")}
        print(f"\n검사 {len(self.rows)}개: 통과 {n['통과']}, 실패 {n['실패']}, 미확인 {n['미확인']}")
        return 1 if n["실패"] else 0


# ── 문서 다루기 ───────────────────────────────────────────────────────────────
class Doc:
    def __init__(self, data: dict) -> None:
        self.data = data
        self.ops = []  # (path, method, operation)
        for path, item in data["paths"].items():
            for m in METHODS:
                if m in item:
                    self.ops.append((path, m, item[m]))
        self.ops.sort(key=lambda t: t[2]["x-corthex"]["id"])

    def get(self, pointer: str):
        node = self.data
        for part in pointer.lstrip("#/").split("/"):
            part = part.replace("~1", "/").replace("~0", "~")
            node = node[int(part)] if isinstance(node, list) else node[part]
        return node

    def deref(self, node):
        seen = 0
        while isinstance(node, dict) and "$ref" in node:
            node = self.get(node["$ref"])
            seen += 1
            if seen > 20:
                raise RuntimeError("$ref 고리")
        return node

    def params(self, op: dict) -> list[dict]:
        return [self.deref(p) for p in op.get("parameters", [])]

    def body_schema(self, op: dict):
        rb = op.get("requestBody")
        if not rb:
            return None, None
        for mt, media in rb["content"].items():
            return mt, media.get("schema")
        return None, None


def esc(part: str) -> str:
    return str(part).replace("~", "~0").replace("/", "~1")


def ptr(*parts) -> str:
    return "#/" + "/".join(esc(p) for p in parts)


def xid(op: dict) -> str:
    return op["x-corthex"]["id"]


def is_signed_in(op: dict) -> bool:
    sec = op.get("security")
    return bool(sec) and all(req for req in sec)


def walk_schema(doc: Doc, schema, path: str, visit, seen=None):
    """스키마 안의 모든 하위 스키마를 (스키마, 위치)로 방문. $ref는 한 번씩만 따라감."""
    if seen is None:
        seen = set()
    if isinstance(schema, dict) and "$ref" in schema:
        ref = schema["$ref"]
        if ref in seen:
            return
        seen = seen | {ref}
        walk_schema(doc, doc.get(ref), path, visit, seen)
        return
    if not isinstance(schema, dict):
        return
    visit(schema, path)
    for k in ("anyOf", "oneOf", "allOf"):
        for i, sub in enumerate(schema.get(k, [])):
            walk_schema(doc, sub, f"{path}", visit, seen)
    for name, sub in schema.get("properties", {}).items():
        walk_schema(doc, sub, f"{path}/{name}", visit, seen)
    if isinstance(schema.get("items"), dict):
        walk_schema(doc, schema["items"], f"{path}/[]", visit, seen)
    if isinstance(schema.get("additionalProperties"), dict):
        walk_schema(doc, schema["additionalProperties"], f"{path}/*", visit, seen)


def schema_types(s: dict) -> set:
    t = s.get("type")
    if t is None:
        return set()
    return {t} if isinstance(t, str) else set(t)


# ── 예시 검사(jsonschema 2020-12, 문서 전체를 한 자원으로) ─────────────────────
def make_validator_factory(doc: Doc):
    from jsonschema import Draft202012Validator, FormatChecker
    from referencing import Registry, Resource
    from referencing.jsonschema import DRAFT202012

    registry = Registry().with_resource(ROOT_URI, Resource(contents=doc.data, specification=DRAFT202012))
    fc = FormatChecker()

    @fc.checks("uri", raises=ValueError)
    def _uri(value):
        if not isinstance(value, str):
            return True
        p = urllib.parse.urlsplit(value)
        if not p.scheme or not p.netloc or re.search(r"[\s<>\"{}|\\^`]", value):
            raise ValueError("주소 형식이 아님")
        return True

    @fc.checks("uri-reference", raises=ValueError)
    def _uri_ref(value):
        if isinstance(value, str) and re.search(r"[\s<>\"{}|\\^`]", value):
            raise ValueError("주소 참조 형식이 아님")
        return True

    cache = {}

    def validator_for(pointer: str):
        if pointer not in cache:
            frag = urllib.parse.quote(pointer[1:], safe="/~")
            cache[pointer] = Draft202012Validator({"$ref": f"{ROOT_URI}#{frag}"}, registry=registry, format_checker=fc)
        return cache[pointer]

    return validator_for


DATE_TIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")


def date_times(doc: Doc, schema, value, out: list, where: str):
    """스키마가 date-time이라 하는 값을 모음(+09:00 확인용)."""
    s = doc.deref(schema) if isinstance(schema, dict) else None
    if not isinstance(s, dict):
        return
    for k in ("anyOf", "oneOf"):
        for sub in s.get(k, []):
            date_times(doc, sub, value, out, where)
    if s.get("format") == "date-time" and isinstance(value, str):
        out.append((where, value))
    if isinstance(value, dict):
        for name, sub in s.get("properties", {}).items():
            if name in value:
                date_times(doc, sub, value[name], out, f"{where}/{name}")
    if isinstance(value, list) and isinstance(s.get("items"), dict):
        for i, v in enumerate(value):
            date_times(doc, s["items"], v, out, f"{where}/{i}")


# ── A0~A14 ───────────────────────────────────────────────────────────────────
def a0_build(root: Path, rep: Report, text: str) -> None:
    try:
        build = load("build_api", HERE / "build_api.py")
        fresh = build.to_yaml(build.build_document())
        bad = []
        if fresh != text:
            bad.append(f"{OPENAPI}가 원본 목록과 다름: build_api.py . --write로 다시 만듦")
        readme = root / README
        if readme.exists():
            r = readme.read_text(encoding="utf-8")
            if build.fill_readme(r) != r:
                bad.append(f"{README}의 표가 원본 목록과 다름")
        else:
            bad.append(f"{README}가 없음")
        rep.add("A0", not bad, "build_api.py로 다시 만들어도 계약 파일과 README 표가 그대로", bad)
    except Exception as e:  # noqa: BLE001
        rep.add("A0", False, f"build_api.py를 돌리지 못함: {e}")


def a1_valid(rep: Report, doc: Doc) -> None:
    try:
        from openapi_spec_validator import validate
        validate(doc.data)
        rep.add("A1", doc.data.get("openapi", "").startswith("3.1"), f"OpenAPI {doc.data.get('openapi')} 문서로 맞음(openapi-spec-validator)")
    except Exception as e:  # noqa: BLE001
        rep.add("A1", False, "OpenAPI 문서로 맞지 않음", [str(e)[:500]])


def a2_ids(rep: Report, doc: Doc, spec_ids: set) -> None:
    bad = []
    ids = [xid(op) for _, _, op in doc.ops]
    want = [f"API-{i:03d}" for i in range(1, len(ids) + 1)]
    if ids != want:
        bad.append(f"API ID가 API-001부터 차례대로가 아님: {sorted(set(want) ^ set(ids))[:10]}")
    names = [op.get("operationId") for _, _, op in doc.ops]
    dup = sorted({n for n in names if names.count(n) > 1})
    if dup or None in names:
        bad.append(f"operationId가 없거나 중복됨: {dup}")
    for path, m, op in doc.ops:
        spec = op["x-corthex"].get("spec") or []
        if not spec:
            bad.append(f"{xid(op)} SPEC ID 없음")
        for s in spec:
            if s not in spec_ids:
                bad.append(f"{xid(op)} 04단계에 없는 {s}")
    rep.add("A2", not bad, f"API {len(ids)}개에 API ID·operationId·SPEC ID가 있음", bad)


def a3_coverage(rep: Report, doc: Doc, spec_ids: set) -> None:
    by_ops = {s for _, _, op in doc.ops for s in op["x-corthex"]["spec"]}
    jobs = {j["spec"] for j in doc.data["components"]["x-corthex"]["jobs"]}
    missing = sorted(spec_ids - by_ops - jobs)
    only_jobs = sorted((spec_ids & jobs) - by_ops)
    rep.add("A3", not missing, f"SPEC {len(spec_ids)}개 모두 API나 서버 안의 일이 있음(API {len(spec_ids & by_ops)}개, "
                               f"서버 안의 일만 {len(only_jobs)}개: {', '.join(only_jobs) or '없음'})", [f"{s} 없음" for s in missing])


def has_id_param(doc: Doc, op: dict) -> bool:
    return any(p["in"] == "path" and p.get("schema", {}).get("format") != "date" for p in doc.params(op))


def has_input(doc: Doc, op: dict) -> bool:
    return bool(op.get("requestBody")) or any(p["in"] != "path" or p.get("schema", {}).get("format") == "date" for p in doc.params(op))


def a4_table(rep: Report, doc: Doc) -> None:
    bad = []
    for path, m, op in doc.ops:
        i, res, omit = xid(op), op["responses"], op["x-corthex"].get("omit", {})
        if not any(k.startswith("2") for k in res):
            bad.append(f"{i} 성공 응답 없음")
        if "400" in res:
            bad.append(f"{i} 400을 씀(DEC-01: 입력 오류는 422)")
        if "default" not in res:
            bad.append(f"{i} default 없음")
        for k in TABLE_KEYS:
            if (k in res) == (k in omit):
                bad.append(f"{i} {k}: " + ("포함하기도 하고 뺀 이유도 적음" if k in res else "포함하지도 않고 뺀 이유도 없음"))
        for k, why in omit.items():
            if not isinstance(why, str) or len(why.strip()) < 4:
                bad.append(f"{i} omit {k}의 사유가 비었음")
            if k in res:
                bad.append(f"{i} omit {k}인데 응답에 있음")
        if has_id_param(doc, op) and "404" not in res:
            bad.append(f"{i} 경로에 기록 ID가 있는데 404 없음")
        if has_input(doc, op) and "422" not in res:
            bad.append(f"{i} 입력이 있는데 422 없음")
    rep.add("A4", not bad, f"API {len(doc.ops)}개가 응답 목록을 모두 포함하거나 뺀 이유를 적음", bad)


def iter_examples(doc: Doc):
    """(위치 설명, 스키마 포인터, 값, 응답 상태 또는 None, API)을 모두 냄."""
    for path, m, op in doc.ops:
        base = ("paths", path, m)
        for pi, p in enumerate(op.get("parameters", [])):
            if "$ref" in p:
                continue
            if "example" in p:
                yield f"{xid(op)} 매개변수 {p['name']}", ptr(*base, "parameters", pi, "schema"), p["example"], None, op
        rb = op.get("requestBody")
        if rb:
            for mt, media in rb["content"].items():
                for name, ex in (media.get("examples") or {}).items():
                    yield f"{xid(op)} 요청 {name}", ptr(*base, "requestBody", "content", mt, "schema"), ex["value"], None, op
        for status, resp in op["responses"].items():
            for hname, h in (resp.get("headers") or {}).items():
                if "$ref" not in h and "example" in h:
                    yield f"{xid(op)}#{status} 헤더 {hname}", ptr(*base, "responses", status, "headers", hname, "schema"), h["example"], status, op
            for mt, media in (resp.get("content") or {}).items():
                for name, ex in (media.get("examples") or {}).items():
                    yield f"{xid(op)}#{status} {name}", ptr(*base, "responses", status, "content", mt, "schema"), ex["value"], status, op
        for cb_name, cb in (op.get("callbacks") or {}).items():
            for expr, item in cb.items():
                for cm, cop in item.items():
                    cbase = (*base, "callbacks", cb_name, expr, cm)
                    for mt, media in cop.get("requestBody", {}).get("content", {}).items():
                        for name, ex in (media.get("examples") or {}).items():
                            yield f"{xid(op)} 콜백 요청 {name}", ptr(*cbase, "requestBody", "content", mt, "schema"), ex["value"], None, op
                    for status, resp in cop.get("responses", {}).items():
                        for mt, media in (resp.get("content") or {}).items():
                            for name, ex in (media.get("examples") or {}).items():
                                yield f"{xid(op)} 콜백 응답 {name}", ptr(*cbase, "responses", status, "content", mt, "schema"), ex["value"], status, op
    for name, p in doc.data["components"].get("parameters", {}).items():
        if "example" in p:
            yield f"매개변수 {name}", ptr("components", "parameters", name, "schema"), p["example"], None, None
    for name, h in doc.data["components"].get("headers", {}).items():
        if "example" in h:
            yield f"헤더 {name}", ptr("components", "headers", name, "schema"), h["example"], None, None


def example_consistency(value) -> list[str]:
    """한 응답 예시 안의 기록끼리 맞는지(설계 재검토 RD-12): 같은 ID의 기록은 같은 status·revision, 확정 시각이 있는 주문(재제작 밖)에는
    확인된 결제가 있음, 명령 결과의 위쪽 기록(결제 안내·결제·변경 요청 등)은 같은 주문의 목록에도 있음. 기록은 첫 키가 ...Id인 객체."""
    found, recs = [], []

    def walk(v, path):
        if isinstance(v, dict):
            keys = list(v)
            if keys and keys[0].endswith("Id") and isinstance(v[keys[0]], str):
                recs.append((keys[0], v[keys[0]], path or "/", v))
            for k, x in v.items():
                walk(x, f"{path}/{k}")
        elif isinstance(v, list):
            for i, x in enumerate(v):
                walk(x, f"{path}/{i}")

    walk(value, "")
    first = {}
    for key, rid, path, obj in recs:
        if (key, rid) not in first:
            first[(key, rid)] = (path, obj)
            continue
        p0, o0 = first[(key, rid)]
        diff = [f"{f} {o0[f]!r}≠{obj[f]!r}" for f in ("status", "revision") if f in o0 and f in obj and o0[f] != obj[f]]
        if diff:
            found.append(f"같은 {key}의 {p0}와 {path}가 다름({', '.join(diff)})")
    for key, rid, path, obj in recs:
        if key == "orderId" and isinstance(obj.get("payments"), list) and obj.get("confirmedAt") and not obj.get("remakeOf"):
            if not any(not pay.get("voidedAt") for pay in obj["payments"]):
                found.append(f"주문 {path}에 확정 시각이 있는데 확인된 결제가 없음")
    order = value.get("order") if isinstance(value, dict) else None
    if isinstance(order, dict) and "orderId" in order:
        pr_ids = {pr.get("paymentRequestId") for pr in order.get("paymentRequests") or []}
        top_pr = value.get("paymentRequest") if isinstance(value.get("paymentRequest"), dict) else {}
        for key, rec in value.items():
            lst = key + "s"
            if key == "order" or not isinstance(rec, dict) or not rec or not isinstance(order.get(lst), list):
                continue
            own = next(iter(rec))
            ref = rec.get("order")
            mine = (isinstance(ref, dict) and ref.get("orderId") == order["orderId"]) or (
                key == "payment" and (rec.get("paymentRequestId") in pr_ids or (
                    top_pr.get("paymentRequestId") == rec.get("paymentRequestId")
                    and (top_pr.get("order") or {}).get("orderId") == order["orderId"])))
            if mine and rec.get(own) not in {x.get(own) for x in order[lst] if isinstance(x, dict)}:
                found.append(f"위쪽 {key}가 같은 주문의 order.{lst}에 없음")
    return found


def a5_examples(rep: Report, doc: Doc, validator_for) -> None:
    bad, n, consistent = [], 0, 0
    for path, m, op in doc.ops:
        for status, resp in op["responses"].items():
            for mt, media in (resp.get("content") or {}).items():
                if not media.get("examples"):
                    bad.append(f"{xid(op)}#{status} {mt}에 이름 붙은 예시가 없음")
        if op["x-corthex"].get("outcomes"):
            outs = op["x-corthex"]["outcomes"]
            ok200 = op["responses"]["200"]
            names = list(ok200["content"]["application/json"]["examples"])
            hdr = ok200.get("headers", {}).get("Siljang-Outcome", {}).get("schema", {}).get("enum", [])
            if sorted(names) != sorted(outs) or sorted(hdr) != sorted(outs):
                bad.append(f"{xid(op)}#200 예시 이름·결과 목록·Siljang-Outcome 값이 다름: {sorted(set(names) ^ set(outs) | set(hdr) ^ set(outs))}")
    offsets = []
    for where, pointer, value, status, op in iter_examples(doc):
        n += 1
        errs = sorted(validator_for(pointer).iter_errors(value), key=lambda e: list(e.absolute_path))
        for e in errs[:3]:
            loc = "/" + "/".join(str(x) for x in e.absolute_path)
            bad.append(f"{where} {loc}: {e.message[:160]}")
        if status is not None and str(status).startswith("2") and op is not None:
            schema = doc.get(pointer)
            date_times(doc, schema, value, offsets, where)
            consistent += 1
            bad += [f"{where} 예시 안 기록이 어긋남(RD-12): {x}" for x in example_consistency(value)]
    wrong_offset = [f"{w}: {v}" for w, v in offsets if not v.endswith("+09:00")]
    bad += [f"시각이 가게 시간대(+09:00)가 아님(DEC-15) {x}" for x in wrong_offset]
    rep.add("A5", not bad, f"예시 {n}개가 모두 스키마에 맞고(형식: date·date-time·uuid·uri 포함), 내용이 있는 응답마다 예시가 있음, "
                           f"성공 응답의 시각 {len(offsets)}개가 +09:00, 성공 응답 예시 {consistent}개 안의 같은 기록·확정과 결제·명령 결과와 주문 목록이 맞음", bad)


def pointer_exists(doc: Doc, op: dict, field: str) -> bool:
    if ":" in field and not field.startswith("/"):
        where, name = field.split(":", 1)
        return any(p["in"] == where and p["name"] == name for p in doc.params(op))
    mt, schema = doc.body_schema(op)
    if schema is None:
        return False
    if field == "/":
        return True
    parts = field.strip("/").split("/")

    def walk(s, i):
        s = doc.deref(s)
        if i == len(parts):
            return True
        for k in ("anyOf", "oneOf", "allOf"):
            if any(walk(sub, i) for sub in s.get(k, [])):
                return True
        part = parts[i]
        if part in s.get("properties", {}):
            return walk(s["properties"][part], i + 1)
        if part.isdigit() and isinstance(s.get("items"), dict):
            return walk(s["items"], i + 1)
        return s.get("additionalProperties", True) is not False and "properties" in s and i == len(parts) - 1

    return walk(schema, 0)


def confirm_values(doc: Doc, op: dict) -> set:
    mt, schema = doc.body_schema(op)
    if not schema:
        return set()
    s = doc.deref(schema)
    c = s.get("properties", {}).get("confirm")
    if not c:
        return set()
    return set(doc.deref(c).get("items", {}).get("enum", []))


def a6_errors(rep: Report, doc: Doc) -> None:
    bad, n = [], 0
    x = doc.data["components"]["x-corthex"]
    errors = x["errors"]
    for path, m, op in doc.ops:
        i = xid(op)
        for status, resp in op["responses"].items():
            if status.startswith("2"):
                continue
            want = 500 if status == "default" else int(status)
            content = resp.get("content") or {}
            if list(content) != ["application/problem+json"]:
                bad.append(f"{i}#{status} 오류 응답의 형식이 application/problem+json 하나가 아님: {list(content)}")
                continue
            media = content["application/problem+json"]
            if media.get("schema", {}).get("$ref") != "#/components/schemas/Problem":
                bad.append(f"{i}#{status} Problem 스키마가 아님")
            examples = list(media.get("examples", {}).items())
            if status == "422" and examples and examples[0][1]["value"].get("code") != "validation_failed":
                bad.append(f"{i}#422 첫 예시가 validation_failed가 아님(목 서버가 틀린 입력에 첫 예시를 반환함)")
            if status == "401" and is_signed_in(op) and examples:
                first = examples[0][1]["value"].get("code")
                need = "skill_key_invalid" if any("kakaoSkillKey" in r for r in op["security"]) else "unauthenticated"
                if first != need:
                    bad.append(f"{i}#401 첫 예시가 {need}가 아님")
            if status == "429" and "Retry-After" not in (resp.get("headers") or {}):
                bad.append(f"{i}#429 Retry-After 헤더 없음")
            for name, ex in examples:
                n += 1
                v = ex["value"]
                code = v.get("code")
                where = f"{i}#{status} {name}"
                if v.get("status") != want:
                    bad.append(f"{where} status {v.get('status')} ≠ 응답 {want}")
                if code not in errors:
                    bad.append(f"{where} 목록에 없는 코드 {code}")
                    continue
                if errors[code]["status"] != want:
                    bad.append(f"{where} 코드 {code}의 목록 상태는 {errors[code]['status']}")
                if v.get("type") != f"/problems/{code}" or v.get("title") != errors[code]["message"]:
                    bad.append(f"{where} type·title이 목록과 다름")
                if not re.fullmatch(r"[0-9a-f]{32}", str(v.get("traceId", ""))):
                    bad.append(f"{where} traceId 형식")
                if code == "validation_failed":
                    if not v.get("errors"):
                        bad.append(f"{where} 필드 오류 없음")
                    for fe in v.get("errors", []):
                        if not pointer_exists(doc, op, fe["field"]):
                            bad.append(f"{where} 요청에 없는 필드 {fe['field']}")
                if code == "confirmation_required":
                    allowed = confirm_values(doc, op)
                    for c in v.get("confirm", []):
                        if c["kind"] not in allowed:
                            bad.append(f"{where} 요청의 confirm에 없는 {c['kind']}")
                if status == "429" and "retryAfterSeconds" not in v:
                    bad.append(f"{where} retryAfterSeconds 없음")
    rep.add("A6", not bad, f"오류 응답 예시 {n}개가 Problem 형식이고 코드·상태·필드가 맞음", bad)


def schema_columns(sql: str) -> dict:
    cols = {}
    for m in re.finditer(r"CREATE TABLE (\w+) \((.*?)\n\);", sql, re.S):
        names = set()
        for line in m.group(2).splitlines():
            mm = re.match(r"\s+([a-z_][a-z0-9_]*)\s+(?!KEY\b)", line)
            if mm and mm.group(1) not in ("constraint", "primary", "unique", "check", "foreign", "exclude"):
                names.add(mm.group(1))
        cols[m.group(1)] = names
    return cols


def request_schemas(doc: Doc):
    """(위치, 스키마)를 냄: 요청 본문과 매개변수."""
    for path, m, op in doc.ops:
        mt, schema = doc.body_schema(op)
        if schema:
            yield f"{xid(op)} 본문", schema, op
        for p in doc.params(op):
            yield f"{xid(op)} {p['in']}:{p['name']}", p["schema"], op


def a7_limits(rep: Report, doc: Doc, root: Path) -> list:
    bad, open_ok, fields = [], [], []
    cols = schema_columns((root / SCHEMA_SQL).read_text(encoding="utf-8"))

    for where, schema, op in request_schemas(doc):
        def visit(s, path, where=where, op=op):
            types = schema_types(s)
            limited = "enum" in s or "const" in s
            if "string" in types and not limited and "maxLength" not in s and s.get("format") not in ("date", "date-time", "uuid", "binary"):
                bad.append(f"{where}{path} 글자 한도(maxLength) 없음")
            if types & {"integer", "number"} and not limited and not ("minimum" in s and "maximum" in s):
                bad.append(f"{where}{path} 수 한도(minimum·maximum) 없음")
            if "array" in types and "maxItems" not in s:
                bad.append(f"{where}{path} 목록 한도(maxItems) 없음")
            if "object" in types and s.get("additionalProperties", True) is not False:
                if "SkillPayload" in json.dumps(op.get("requestBody", {})):
                    open_ok.append(f"{where}{path}")
                else:
                    bad.append(f"{where}{path} 열린 객체(카카오 스킬 요청 밖)")
            if "x-corthex-column" in s:
                fields.append((where + path, s["x-corthex-column"], s))
        walk_schema(doc, schema, "", visit)
    for where, col, s in fields:
        t, _, c = col.partition(".")
        if c not in cols.get(t, set()):
            bad.append(f"{where}: {col}이 {SCHEMA_SQL}에 없음")
    uniq = sorted({c for _, c, _ in fields})
    rep.add("A7", not bad, f"요청 필드마다 한도가 있고, 테이블.컬럼 {len(uniq)}개({len(fields)}자리)가 스키마에 있음. 열린 객체는 카카오 스킬 요청 안 {len(set(open_ok))}곳만", bad)
    return fields


def a8_security(rep: Report, doc: Doc) -> None:
    bad = []
    schemes = set(doc.data["components"].get("securitySchemes", {}))
    for path, m, op in doc.ops:
        i = xid(op)
        if "security" not in op:
            bad.append(f"{i} security 없음")
            continue
        for req in op["security"]:
            for name in req:
                if name not in schemes:
                    bad.append(f"{i} 정의되지 않은 보안 방식 {name}")
        if is_signed_in(op) and "401" not in op["responses"]:
            bad.append(f"{i} 로그인이 필요한데 401 없음")
    pub = [xid(op) for _, _, op in doc.ops if op.get("security") == []]
    opt = [xid(op) for _, _, op in doc.ops if op.get("security") and not is_signed_in(op)]
    rep.add("A8", not bad, f"API마다 security가 있고 로그인이 필요한 API는 401을 가짐(누구나 {len(pub)}개: {', '.join(pub)}; "
                           f"없어도 되는 {len(opt)}개: {', '.join(opt)})", bad)


def ok_schemas(doc: Doc, op: dict):
    for status, resp in op["responses"].items():
        if status.startswith("2"):
            for mt, media in (resp.get("content") or {}).items():
                yield status, media["schema"], media.get("examples", {})


def closed_problems(doc: Doc, schema) -> list:
    out = []

    def visit(s, path):
        if "object" in schema_types(s) and s.get("additionalProperties", True) is not False:
            out.append(path or "/")
    walk_schema(doc, schema, "", visit)
    return out


def a9_kinds(rep: Report, doc: Doc) -> None:
    kinds_all = doc.data["components"]["x-corthex"]["kinds"]
    bad, notes, ai_ops = [], 0, []
    ai_codes = {"ai_unavailable", "ai_timeout", "ai_key_missing", "ai_limit_reached"}
    for path, m, op in doc.ops:
        i, res, kinds = xid(op), op["responses"], op["x-corthex"].get("kinds", {})
        outs = set(op["x-corthex"].get("outcomes", []))
        idem = any(p.get("$ref", "").endswith("/IdempotencyKey") for p in op.get("parameters", []))
        mt, body = doc.body_schema(op)
        body_s = doc.deref(body) if body else {}
        revision = "baseRevision" in body_s.get("properties", {}) and "baseRevision" in body_s.get("required", [])
        ok_names = {n for _, _, exs in ok_schemas(doc, op) for n in exs}
        for k in kinds:
            if k not in kinds_all:
                bad.append(f"{i} 모르는 종류 {k}")
        for k, evs in kinds.items():
            if not evs:
                bad.append(f"{i} {k}: 근거 없음")
            for ev in evs:
                if ev.startswith("note:"):
                    notes += 1
                    continue
                mm = re.fullmatch(r"(\d{3})(?::(\w+))?", ev)
                if mm:
                    st, code = mm.groups()
                    if st not in res:
                        bad.append(f"{i} {k}: 응답 {st} 없음")
                    elif code:
                        codes = {e["value"].get("code") for mt2, media in (res[st].get("content") or {}).items()
                                 for e in media.get("examples", {}).values()}
                        if code not in codes:
                            bad.append(f"{i} {k}: {st}에 {code} 예시 없음")
                elif ev.startswith("outcome:"):
                    if ev[8:] not in outs:
                        bad.append(f"{i} {k}: 결과 {ev[8:]} 없음")
                elif ev.startswith("example:"):
                    if ev[8:] not in ok_names:
                        bad.append(f"{i} {k}: 성공 예시 {ev[8:]} 없음")
                elif ev == "idem":
                    if not idem:
                        bad.append(f"{i} {k}: 요청 키 없음")
                elif ev == "revision":
                    if not revision:
                        bad.append(f"{i} {k}: baseRevision 없음")
                elif ev == "closed":
                    for st, schema, _ in ok_schemas(doc, op):
                        if closed_problems(doc, schema):
                            bad.append(f"{i} {k}: {st} 응답 스키마가 닫혀 있지 않음")
                elif ev == "security":
                    if not op.get("security"):
                        bad.append(f"{i} {k}: security 없음")
                elif ev == "callback":
                    if not op.get("callbacks"):
                        bad.append(f"{i} {k}: 콜백 없음")
                elif ev == "screen":
                    pass
                else:
                    bad.append(f"{i} {k}: 모르는 근거 {ev}")
        need = []
        if op.get("security"):
            need.append("접근")
        if "422" in res:
            need.append("입력")
        if "404" in res:
            need.append("대상")
        if idem:
            need.append("반복")
        if revision:
            need.append("동시")
        if "429" in res:
            need.append("한도")
        if "503" in res:
            need.append("외부")
        need.append("화면")
        for k in need:
            if k not in kinds:
                bad.append(f"{i} 근거가 있는데 종류 {k}를 적지 않음")
        if idem and "idem" not in kinds.get("반복", []):
            bad.append(f"{i} 반복에 idem 없음")
        if revision and "revision" not in kinds.get("동시", []):
            bad.append(f"{i} 동시에 revision 없음")
        for st, schema, exs in ok_schemas(doc, op):
            s = doc.deref(schema)
            if "items" in s.get("properties", {}) and "array" in schema_types(doc.deref(s["properties"]["items"])):
                empties = [n for n, e in exs.items() if isinstance(e["value"], dict) and e["value"].get("items") == []]
                evs = kinds.get("빈·끊김", [])
                if not empties and not any(e.startswith("note:") for e in evs):
                    bad.append(f"{i} 목록 응답에 빈 목록 예시 없음")
                elif empties and not any(e == f"example:{n}" for n in empties for e in evs):
                    bad.append(f"{i} 빈·끊김에 빈 목록 예시({', '.join(empties)})를 적지 않음")
        if op["x-corthex"].get("ai"):
            if "AI" not in kinds:
                bad.append(f"{i} AI를 호출하는데 종류 AI를 적지 않음")
            if not ai_codes <= outs:
                bad.append(f"{i} AI 실패 결과가 모자람: {sorted(ai_codes - outs)}")
            if "ai_output_rejected" not in outs:
                bad.append(f"{i} 쓰기 전 확인 실패(ai_output_rejected) 결과가 없음")
            ai_ops.append(i)
    rep.add("A9", not bad, f"케이스 유형 근거가 모두 계약에 있음(말로만 적은 근거 {notes}개). AI를 호출하는 API {', '.join(ai_ops) or '없음'}은 "
                           f"모델 실패·느림·키 없음·사용 한도와 쓰기 전 확인 실패가 저마다 결과 코드를 가짐", bad)


def text_of(node) -> str:
    return json.dumps(node, ensure_ascii=False)


def a10_open(rep: Report, doc: Doc) -> None:
    bad = []
    by_id = {xid(op): op for _, _, op in doc.ops}
    for q in doc.data["components"]["x-corthex"]["open"]:
        for where in [w.strip() for w in q["where"].split(",")]:
            if where.startswith("API-"):
                d = by_id.get(where, {}).get("description", "")
            elif where.startswith("components.schemas."):
                d = doc.data["components"]["schemas"].get(where.split(".")[-1], {}).get("description", "")
            else:
                bad.append(f"{q['id']} 모르는 자리 {where}")
                continue
            if not re.search(r"Open:[^\n]*?\(" + re.escape(q["id"]) + r"\)", d):
                bad.append(f"{q['id']}: {where} 설명에 'Open: …({q['id']})'가 없음")
    texts = [op.get("description", "") for _, _, op in doc.ops] + \
            [s.get("description", "") for s in doc.data["components"]["schemas"].values()]
    for t in texts:
        for seg in t.split("Open:")[1:]:
            if not re.search(r"\(OPEN-\d+\)", seg.split("Open:")[0]):
                bad.append(f"OPEN ID 없는 'Open:': {seg[:60]}")
    n = len(doc.data["components"]["x-corthex"]["open"])
    rep.add("A10", not bad, f"열린 질문 {n}개가 모두 그 자리 설명에 'Open:'으로 있음", bad)


def a11_decisions(rep: Report, doc: Doc) -> None:
    data = copy.deepcopy(doc.data)
    decs = [d["id"] for d in data["components"]["x-corthex"].pop("decisions")]
    t = text_of(data)
    used = set(re.findall(r"DEC-\d{2}", t))
    unknown = sorted(used - set(decs))
    unused = [d for d in decs if d not in used]
    # DEC-14: 목록을 주는 API는 설명에 '순서:'가 있고, 나누지 않는 목록은 DEC-14의 예외에 적힌 것만(설계 재검토 RD-13)
    dec14 = next((d for d in doc.data["components"]["x-corthex"]["decisions"] if d["id"] == "DEC-14"), {})
    dec14_text = " ".join(str(v) for v in dec14.values())
    lists, order_bad = 0, []
    for path, m, op in doc.ops:
        ok = op["responses"].get("200") or op["responses"].get("201") or {}
        media = (ok.get("content") or {}).get("application/json")
        if not media:
            continue
        props = doc.deref(media["schema"]).get("properties", {})
        if "items" not in props or doc.deref(props["items"]).get("type") != "array":
            continue
        lists += 1
        if "순서:" not in op.get("description", ""):
            order_bad.append(f"{xid(op)} 목록의 정렬 순서('순서:')가 설명에 없음(DEC-14)")
        api_no = xid(op).split("-")[1]
        if "nextCursor" not in props and xid(op) not in dec14_text and f"·{api_no}" not in dec14_text:
            order_bad.append(f"{xid(op)} 커서 없는 목록이 DEC-14의 예외에 없음")
    rep.add("A11", not unknown and not unused and not order_bad,
            f"결정 사항 {len(decs)}개가 모두 계약에 쓰이고, 계약의 DEC ID가 모두 목록에 있음. 목록을 주는 API {lists}개가 모두 정렬 순서를 적고 커서 없는 목록은 DEC-14의 예외에 있음",
            [f"목록에 없는 {u}" for u in unknown] + [f"계약에 쓰이지 않은 {u}" for u in unused] + order_bad)


def a12_api_refs(rep: Report, doc: Doc) -> None:
    ids = {xid(op) for _, _, op in doc.ops}
    t = text_of(doc.data)
    refs = set(re.findall(r"API-\d{3}", t))
    unknown = sorted(refs - ids)
    rep.add("A12", not unknown, f"계약에 나온 API ID {len(refs)}개가 모두 있는 API", [f"없는 {u}" for u in unknown])


def breaking_changes(old: dict, new: dict) -> list[str]:
    out = []
    o_ops = {(p, m): op for p, item in old.get("paths", {}).items() for m, op in item.items() if m in METHODS}
    n_ops = {(p, m): op for p, item in new.get("paths", {}).items() for m, op in item.items() if m in METHODS}
    for k, op in o_ops.items():
        if k not in n_ops:
            out.append(f"API 없앰: {k[1].upper()} {k[0]}")
            continue
        for st in op.get("responses", {}):
            if st not in n_ops[k].get("responses", {}):
                out.append(f"응답 없앰: {k[1].upper()} {k[0]} {st}")
        o_req = {p.get("name") for p in op.get("parameters", []) if p.get("required")}
        n_req = {p.get("name") for p in n_ops[k].get("parameters", []) if p.get("required")}
        for name in sorted(n_req - o_req - {None}):
            out.append(f"꼭 넣을 매개변수 더함: {k[1].upper()} {k[0]} {name}")
    oe, ne = old.get("components", {}).get("x-corthex", {}).get("errors", {}), new["components"]["x-corthex"]["errors"]
    for c in oe:
        if c not in ne:
            out.append(f"오류 코드 없앰: {c}")
        elif oe[c].get("status") != ne[c].get("status"):
            out.append(f"오류 코드 상태 바꿈: {c}")
    os_, ns = old.get("components", {}).get("schemas", {}), new["components"]["schemas"]
    for name, s in os_.items():
        if name not in ns:
            out.append(f"스키마 없앰: {name}")
            continue
        n = ns[name]
        for prop, ps in s.get("properties", {}).items():
            if prop not in n.get("properties", {}):
                out.append(f"필드 없앰: {name}.{prop}")
            elif ps.get("type") != n["properties"][prop].get("type"):
                out.append(f"필드 타입 바꿈: {name}.{prop}")
            elif "enum" in ps and set(ps["enum"]) - set(n["properties"][prop].get("enum", ps["enum"])):
                out.append(f"고를 값 없앰: {name}.{prop}")
        for req in set(n.get("required", [])) - set(s.get("required", [])):
            out.append(f"꼭 넣을 필드 더함: {name}.{req}")
    return out


def a13_breaking(rep: Report, doc: Doc, root: Path, base: str | None) -> None:
    listed = doc.data["components"]["x-corthex"].get("breakingChanges")
    if listed is None:
        rep.add("A13", False, "components.x-corthex.breakingChanges 목록이 없음")
        return
    old_text, src = None, None
    if base:
        old_text, src = Path(base).read_text(encoding="utf-8"), base
    else:
        r = subprocess.run(["git", "-C", str(root), "show", f"main:{OPENAPI}"], capture_output=True, text=True)
        if r.returncode == 0:
            old_text, src = r.stdout, f"main:{OPENAPI}"
    if old_text is None:
        rep.add("A13", listed == [], f"앞 계약이 없음(main에 {OPENAPI} 없음, 첫 버전). 깨지는 변화 목록이 비어 있음")
        return
    found = breaking_changes(yaml.safe_load(old_text), doc.data)
    whats = {b.get("what") for b in listed if isinstance(b, dict)}
    missing = [f for f in found if f not in whats]
    rep.add("A13", not missing, f"{src}와 견준 깨지는 변화 {len(found)}개가 모두 목록에 있음", missing)


def a14_exposure(rep: Report, doc: Doc) -> None:
    bad = []
    allowed_secretish = set()
    for path, m, op in doc.ops:
        i = xid(op)
        customer = path.startswith("/public/") or any("kakaoSkillKey" in r for r in (op.get("security") or []))
        for st, schema, _ in ok_schemas(doc, op):
            for p in closed_problems(doc, schema):
                bad.append(f"{i}#{st} 닫히지 않은 객체 {p}")

            def visit(s, path, i=i, st=st, customer=customer):
                if customer and s.get("format") == "uuid":
                    bad.append(f"{i}#{st} 손님·공개 응답에 uuid {path}")
                for name in s.get("properties", {}):
                    if SECRET_NAME.search(name) and name not in allowed_secretish:
                        bad.append(f"{i}#{st} 시크릿 같은 이름 {path}/{name}")
            walk_schema(doc, schema, "", visit)
    rep.add("A14", not bad, "성공 응답 스키마가 모두 닫혀 있고, 손님·공개 응답에 uuid가 없고, 시크릿 같은 이름의 필드가 없음", bad)


# ── D1: 계약이 허용하는 값을 DB 컬럼에 넣어 봄 ─────────────────────────────────────
class Pg:
    def __init__(self, base: str) -> None:
        self.base = base.strip()

    def conn(self, db: str) -> str:
        return f"{self.base} dbname={db}".strip()

    def run(self, db: str, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", *args, self.conn(db)], capture_output=True, text=True)

    def recreate(self, db: str) -> None:
        r = self.run("postgres", "-c", f"DROP DATABASE IF EXISTS {db}", "-c", f"CREATE DATABASE {db} TEMPLATE template0")
        if r.returncode:
            raise RuntimeError(r.stderr.strip())

    def drop(self, db: str) -> None:
        self.run("postgres", "-c", f"DROP DATABASE IF EXISTS {db}")

    def apply(self, db: str, path: Path) -> str:
        r = self.run(db, "-1", "-f", str(path))
        return r.stderr.strip() if r.returncode else ""


BASE_TYPES = {"varchar": "text", "bpchar": "text", "text": "text", "int2": "smallint", "int4": "integer", "int8": "bigint",
              "numeric": "numeric", "bool": "boolean", "date": "date", "time": "time", "timestamptz": "timestamptz", "uuid": "uuid"}


def clean_schema(doc: Doc, s):
    s = copy.deepcopy(doc.deref(s))
    for k in list(s):
        if k.startswith("x-") or k in ("description", "example", "examples"):
            s.pop(k)
    return s


def d1_db(root: Path, rep: Report, doc: Doc, fields: list, base: str | None, keep: bool, examples: int = 60) -> None:
    if base is None:
        rep.add("D1", None, "DB 견주기: --db를 주지 않아 미확인")
        return
    try:
        import psycopg2
        from hypothesis import HealthCheck, given, settings
        from hypothesis_jsonschema import from_schema
    except ImportError as e:
        rep.add("D1", None, f"DB 견주기: 도구가 없어 미확인({e})")
        return
    pg = Pg(base)
    try:
        pg.recreate(DB_NAME)
        err = pg.apply(DB_NAME, root / SCHEMA_SQL)
        if err:
            rep.add("D1", False, f"{SCHEMA_SQL}를 빈 DB에 적용하지 못함", [err[:500]])
            return
        conn = psycopg2.connect(pg.conn(DB_NAME))
        conn.autocommit = True
        cur = conn.cursor()
        bad, notes, tried, values, length_checked = [], [], set(), 0, set()
        for where, col, s in fields:
            schema = clean_schema(doc, s)
            key = (col, json.dumps(schema, sort_keys=True, ensure_ascii=False))
            if key in tried:
                continue
            tried.add(key)
            table, _, column = col.partition(".")
            cur.execute("""SELECT t.typname, a.atttypmod, a.attnum, c.oid FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
                           JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_type t ON t.oid = a.atttypid
                           WHERE n.nspname = 'public' AND c.relname = %s AND a.attname = %s AND a.attnum > 0 AND NOT a.attisdropped""",
                        (table, column))
            row = cur.fetchone()
            if not row:
                bad.append(f"{where}: DB에 {col} 없음")
                continue
            typname, typmod, attnum, relid = row
            if typname not in BASE_TYPES:
                notes.append(f"{col}: {typname} 타입은 견주지 않음")
                continue
            if typname == "varchar" and typmod > 4:
                if schema.get("maxLength", 10 ** 9) > typmod - 4:
                    bad.append(f"{where}: maxLength {schema.get('maxLength')} > {col} varchar({typmod - 4})")
            cur.execute("""SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
                           WHERE conrelid = %s AND contype = 'c' AND array_length(conkey, 1) = 1 AND conkey[1] = %s""", (relid, attnum))
            checks = [(n, re.sub(r"^CHECK \((.*)\)( NOT VALID)?$", r"\1", d)) for n, d in cur.fetchall()]
            cast = BASE_TYPES[typname]
            pattern = schema.get("pattern") or ""
            # 글자 수 CHECK는 끝값을 바로 견줌(만든 값이 닿지 못하는 길이도)
            for name, expr in checks:
                lo = re.search(r"char_length\(%s\) >= (\d+)" % re.escape(column), expr)
                hi = re.search(r"char_length\(%s\) <= (\d+)" % re.escape(column), expr)
                if hi and schema.get("maxLength", 10 ** 9) > int(hi.group(1)):
                    bad.append(f"{where}: maxLength {schema.get('maxLength')} > {col}의 {name}({hi.group(1)}자까지)")
                if lo and schema.get("minLength", 0) < int(lo.group(1)) and "enum" not in schema:
                    bad.append(f"{where}: minLength {schema.get('minLength', 0)} < {col}의 {name}({lo.group(1)}자부터)")
                if hi or lo:
                    length_checked.add(col)
            failing: list = []

            def evaluate(v):
                try:
                    cur.execute(f"SELECT %s::{cast}", (v if not isinstance(v, bool) else v,))
                except Exception as e:  # noqa: BLE001
                    return f"{cast}로 바꿀 수 없음: {str(e).splitlines()[0]}"
                for name, expr in checks:
                    try:
                        cur.execute(f"SELECT ({expr}) FROM (SELECT %s::{cast} AS {column}) AS t", (v,))
                        ok = cur.fetchone()[0]
                    except Exception as e:  # noqa: BLE001
                        return f"{name}을 셈하지 못함: {str(e).splitlines()[0]}"
                    if ok is False:
                        return f"{name}에 막힘"
                return None

            # 고르게 만든 값에 더해 끝값: 글자는 가장 긴·가장 짧은 길이, 수는 가장 작은·큰 값, 고를 값은 모두
            strategies = []
            try:
                strategies.append(("고르게", from_schema(schema), examples))
                if "string" in schema_types(schema) and "enum" not in schema:
                    if "maxLength" in schema:
                        strategies.append(("가장 긴", from_schema(dict(schema, minLength=schema["maxLength"])), 10))
                    strategies.append(("가장 짧은", from_schema(dict(schema, maxLength=schema.get("minLength", 0))), 5))
            except Exception as e:  # noqa: BLE001
                notes.append(f"{col}: 값을 만들지 못함({type(e).__name__})")
                continue
            direct = list(schema.get("enum", []))
            if schema_types(schema) & {"integer", "number"}:
                direct += [schema[k] for k in ("minimum", "maximum") if k in schema]
            counter = [0]

            def check_value(v):
                if v is None:
                    return None
                if isinstance(v, str) and ("\x00" in v or (pattern.endswith("$") and v.endswith("\n"))):
                    return None
                counter[0] += 1
                return evaluate(v)

            for v in direct:
                why = check_value(v)
                if why:
                    bad.append(f"{where}: 계약이 허용하는 끝값 {v!r}이 {col}의 {why}")
            for label, strategy, n_ex in strategies:
                @settings(max_examples=n_ex, deadline=None, database=None, derandomize=True,
                          suppress_health_check=list(HealthCheck))
                @given(strategy)
                def probe(v):
                    why = check_value(v)
                    if why:
                        failing.append((v, why))
                        raise AssertionError(why)

                try:
                    probe()
                except AssertionError:
                    v, why = failing[-1]
                    bad.append(f"{where}: 계약이 허용하는 값({label}) {v!r}이 {col}의 {why}")
                except Exception as e:  # noqa: BLE001
                    if not (label == "가장 긴" and col in length_checked):
                        notes.append(f"{col}: {label} 값을 만들지 못함({type(e).__name__}). 글자 수 CHECK가 없어 고르게 만든 값으로만 견줌")
            values += counter[0]
        conn.close()
        cols = sorted({c for _, c, _ in fields})
        rep.add("D1", not bad, f"테이블.컬럼 {len(cols)}개({len(tried)}가지 필드 스키마)에 계약이 허용하는 값 {values}개를 넣어 봄: 타입·CHECK·varchar 길이에 막힌 값 없음"
                               f"(NUL 글자와 줄바꿈으로 끝나는 값은 뺌). 글자 수 CHECK가 있는 컬럼 {len(length_checked)}개는 끝값을 바로 견줌",
                bad + [f"참고: {n}" for n in notes])
    except Exception as e:  # noqa: BLE001
        rep.add("D1", None, f"DB 견주기: 미확인({e})")
    finally:
        if not keep:
            pg.drop(DB_NAME)


# ── M1: 목 서버 ──────────────────────────────────────────────────────────────
def m1_mock(rep: Report, doc: Doc, url: str | None, skill_key: str) -> None:
    if not url:
        rep.add("M1", None, "목 서버: --mock을 주지 않아 미확인")
        return
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    bad, sent = [], 0

    def call(method, path, *, body=None, headers=None, multipart=None):
        nonlocal sent
        sent += 1
        h = dict(headers or {})
        data = None
        if multipart is not None:
            boundary = "siljangboundary" + uuid.uuid4().hex
            parts = []
            for name, (value, filename, ctype) in multipart.items():
                disp = f'form-data; name="{name}"' + (f'; filename="{filename}"' if filename else "")
                parts.append(f"--{boundary}\r\nContent-Disposition: {disp}\r\n" + (f"Content-Type: {ctype}\r\n" if ctype else "") + "\r\n")
                parts.append(value)
                parts.append("\r\n")
            parts.append(f"--{boundary}--\r\n")
            data = b"".join(p.encode() if isinstance(p, str) else p for p in parts)
            h["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        elif body is not None:
            data = json.dumps(body, ensure_ascii=False).encode()
            h["Content-Type"] = "application/json"
        req = urllib.request.Request(url.rstrip("/") + path, data=data, method=method.upper(), headers=h)
        try:
            with opener.open(req, timeout=20) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, (json.loads(raw) if raw else None)
            except json.JSONDecodeError:
                return e.code, raw.decode(errors="replace")[:200]

    for path, m, op in doc.ops:
        i = xid(op)
        params = doc.params(op)
        p = path
        query = {}
        for prm in params:
            if prm["in"] == "path":
                p = p.replace("{" + prm["name"] + "}", urllib.parse.quote(str(prm["example"]), safe=""))
            elif prm["in"] == "query" and prm.get("required"):
                query[prm["name"]] = prm["example"]
        if query:
            p += "?" + urllib.parse.urlencode(query)
        cred = {}
        sec = op.get("security") or []
        names = {n for r in sec for n in r}
        cookies = []
        if "ownerSession" in names:
            cookies.append("siljang_owner=example-session-not-real")
        if "operatorSession" in names:
            cookies.append("siljang_operator=example-session-not-real")
        if cookies:
            cred["Cookie"] = "; ".join(cookies)
        if "kakaoSkillKey" in names:
            cred["Siljang-Skill-Key"] = skill_key
        idem = {}
        for prm in params:
            if prm["in"] == "header" and prm["name"] == "Idempotency-Key":
                idem["Idempotency-Key"] = prm["example"]
        mt, schema = doc.body_schema(op)
        body, multipart = None, None
        if mt == "application/json":
            exs = op["requestBody"]["content"][mt].get("examples", {})
            body = next(iter(exs.values()))["value"] if exs else None
        elif mt == "multipart/form-data":
            multipart = {"purpose": ("license_photo", None, None), "file": (b"\xff\xd8\xff\xe0" + b"0" * 64, "license.jpg", "image/jpeg")}
        ok_status = [s for s in op["responses"] if s.startswith("2")]

        # 1) 맞는 요청
        st, got = call(m, p, body=body, headers={**cred, **idem}, multipart=multipart)
        if str(st) not in ok_status:
            bad.append(f"{i} 맞는 요청이 {st}(계약 2xx: {ok_status}) {str(got)[:120]}")
        else:
            exs = [e["value"] for media in (op["responses"][str(st)].get("content") or {}).values() for e in media.get("examples", {}).values()]
            if exs and got not in exs:
                bad.append(f"{i} 맞는 요청의 {st} 본문이 계약 예시와 다름")
        # 2) 로그인 없이
        if is_signed_in(op):
            st, got = call(m, p, body=body, headers=idem, multipart=multipart)
            want = next(iter(op["responses"]["401"]["content"]["application/problem+json"]["examples"].values()))["value"]["code"]
            if st != 401 or not isinstance(got, dict) or got.get("code") != want:
                bad.append(f"{i} 로그인 없이 {st} {str(got)[:100]}(기대 401 {want})")
        # 3) 틀린 입력
        if "422" in op["responses"]:
            if mt == "application/json":
                st, got = call(m, p, body={}, headers={**cred, **idem})
            elif mt == "multipart/form-data":
                st, got = call(m, p, headers={**cred, **idem}, multipart={"purpose": ("not_a_purpose", None, None)})
            elif idem:
                st, got = call(m, p, headers=cred)
            else:
                bad_q, p_bad = {}, None
                for prm in params:
                    s = prm.get("schema", {})
                    if prm["in"] == "query":
                        if s.get("type") == "integer":
                            bad_q[prm["name"]] = str(s.get("maximum", 100) + 1)
                        elif s.get("format") == "date":
                            bad_q[prm["name"]] = "not-a-date"
                        elif "enum" in s:
                            bad_q[prm["name"]] = "not_allowed_value"
                    elif prm["in"] == "path" and s.get("format") == "date":
                        p_bad = p.replace(urllib.parse.quote(str(prm["example"]), safe=""), "not-a-date", 1)
                if p_bad:
                    st, got = call(m, p_bad, headers=cred)
                elif bad_q:
                    st, got = call(m, path + "?" + urllib.parse.urlencode({**query, **bad_q}), headers=cred)
                else:
                    st, got = None, None
            if st is not None and (st != 422 or not isinstance(got, dict) or got.get("code") != "validation_failed"):
                bad.append(f"{i} 틀린 입력이 {st} {str(got)[:100]}(기대 422 validation_failed)")
        # 4) 응답·예시마다 Prefer
        for status, resp in op["responses"].items():
            code = "500" if status == "default" else status
            contents = resp.get("content") or {}
            if not contents:
                st, got = call(m, p, body=body, headers={**cred, **idem, "Prefer": f"code={code}"}, multipart=multipart)
                if str(st) != code:
                    bad.append(f"{i} Prefer code={code}가 {st}")
                continue
            for media in contents.values():
                for name, ex in media.get("examples", {}).items():
                    st, got = call(m, p, body=body, headers={**cred, **idem, "Prefer": f"code={code}, example={name}"}, multipart=multipart)
                    if str(st) != code or got != ex["value"]:
                        bad.append(f"{i} Prefer code={code}, example={name}가 {st}" + ("" if str(st) != code else " 본문이 예시와 다름"))
    rep.add("M1", not bad, f"목 서버({url})에 요청 {sent}개: 맞는 요청·로그인 없음·틀린 입력·응답 예시마다 계약대로", bad)


# ── 실행 ─────────────────────────────────────────────────────────────────────
def main(argv: list[str]) -> int:
    if not argv or argv[0].startswith("-"):
        print(__doc__)
        return 2
    root = Path(argv[0]).resolve()

    def opt(name):
        return argv[argv.index(name) + 1] if name in argv else None

    text = (root / OPENAPI).read_text(encoding="utf-8")
    doc = Doc(yaml.safe_load(text))
    rows = load("spec_rows", root / SPEC_ROWS).ROWS
    spec_ids = {r["id"] for r in rows if r.get("status") != "삭제"}
    rep = Report()
    a0_build(root, rep, text)
    a1_valid(rep, doc)
    a2_ids(rep, doc, spec_ids)
    a3_coverage(rep, doc, spec_ids)
    a4_table(rep, doc)
    validator_for = make_validator_factory(doc)
    a5_examples(rep, doc, validator_for)
    a6_errors(rep, doc)
    fields = a7_limits(rep, doc, root)
    a8_security(rep, doc)
    a9_kinds(rep, doc)
    a10_open(rep, doc)
    a11_decisions(rep, doc)
    a12_api_refs(rep, doc)
    a13_breaking(rep, doc, root, opt("--base"))
    a14_exposure(rep, doc)
    d1_db(root, rep, doc, fields, opt("--db"), "--keep" in argv)
    examples_mod = load("api_examples", HERE / "api_examples.py")
    m1_mock(rep, doc, opt("--mock"), examples_mod.SKILL_KEY)
    return rep.summary()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
