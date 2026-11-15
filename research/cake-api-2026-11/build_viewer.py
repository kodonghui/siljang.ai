"""06단계 검토 도구(Swagger UI 페이지)를 원본 계약에서 다시 만든다.

    python3 -B research/cake-api-2026-11/build_viewer.py . 나갈_폴더 --css swagger-ui.css

- 원본은 `api/openapi.yaml`이다. 이 스크립트는 그것을 JSON(`openapi.json`)으로 옮기고,
  `viewer.html` 템플릿에 Swagger UI 5.17.14의 스타일시트를 그대로 넣어 `siljang-api-contract.html`을 만든다.
- 스타일시트는 npm 꾸러미 swagger-ui-dist@5.17.14의 `swagger-ui.css`다
  (`npm pack swagger-ui-dist@5.17.14`로 받아 `package/swagger-ui.css`). 다른 버전이 섞이지 않게 SHA-256을 확인한다.
- 페이지가 원본에 더하는 것은 API 이름 앞의 API ID와 설명 끝의 '반환하지 않는 응답'뿐이며,
  둘 다 브라우저에서 원본의 `x-corthex`로 붙인다(`viewer.html`의 decorate).
- 머리말의 계약 버전과 숫자(API·응답·오류 코드·결정 사항·열린 질문)는 원본에서 세어 `viewer.html`의
  `{{…}}` 자리에 넣는다. 손으로 적으면 계약이 바뀔 때 낡는다(2026-11-15에 API 72개로 남아 있었음).
  '고침' 날짜는 `api/openapi.yaml`을 마지막으로 바꾼 커밋의 날짜(KST)이고, `--changed`로 줄 수 있다.
- 만든 두 파일을 같은 Artifact 주소에 다시 올리면 검토 도구가 원본과 같아진다(`.corthex/project.json`의 06-api).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
CSS_SHA256 = "40170f0ee859d17f92131ba707329a88a070e4f66874d11365e9a77d232f6117"  # swagger-ui-dist@5.17.14 swagger-ui.css
CSS_HEADER = "/* Swagger UI 5.17.14 stylesheet (swagger-ui-dist, Apache-2.0), inlined unchanged */\n"
SOURCE_MAP = "/*# sourceMappingURL=swagger-ui.css.map*/"
SLOT = "/*SWAGGER_UI_CSS*/"
METHODS = {"get", "put", "post", "delete", "patch"}
CONFIRMED = "2026-11-12"  # 06단계 확정(docs/06-api/README.md 14절). 머리말에는 이 날짜 뒤에 고친 날을 붙인다.


def last_changed(repo: Path) -> str:
    """api/openapi.yaml을 마지막으로 바꾼 커밋의 날짜(KST). git이 없거나 기록이 없으면 빈 글."""
    try:
        r = subprocess.run(
            ["git", "-C", str(repo), "log", "-1", "--format=%cd", "--date=format-local:%Y-%m-%d", "--", "api/openapi.yaml"],
            capture_output=True, text=True, env={**os.environ, "TZ": "Asia/Seoul"}, timeout=60,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    day = r.stdout.strip()
    return day if r.returncode == 0 and re.fullmatch(r"\d{4}-\d{2}-\d{2}", day) else ""


def facts(spec: dict, changed: str) -> dict[str, str]:
    """머리말 자리에 넣을 값. 숫자는 모두 원본 계약에서 센다."""
    ops = [op for item in spec["paths"].values() for k, op in item.items() if k in METHODS]
    catalogs = spec["components"]["x-corthex"]
    return {
        "{{CONTRACT_VERSION}}": str(spec["info"]["version"]),
        "{{CHANGED}}": f" · {changed} 고침" if changed and changed > CONFIRMED else "",
        "{{API_COUNT}}": str(len(ops)),
        "{{RESPONSE_COUNT}}": str(sum(len(op["responses"]) for op in ops)),
        "{{ERROR_COUNT}}": str(len(catalogs["errors"])),
        "{{DECISION_COUNT}}": str(len(catalogs["decisions"])),
        "{{OPEN_COUNT}}": str(len(catalogs["open"])),
    }


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("repo", type=Path, help="저장소 뿌리")
    ap.add_argument("out", type=Path, help="만든 파일을 둘 폴더(저장소 밖 권함)")
    ap.add_argument("--css", type=Path, required=True, help="swagger-ui-dist@5.17.14의 swagger-ui.css")
    ap.add_argument("--changed", help="머리말의 '고침' 날짜(YYYY-MM-DD). 없으면 api/openapi.yaml의 마지막 커밋 날짜")
    args = ap.parse_args(argv)
    if args.changed and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.changed):
        print(f"--changed는 YYYY-MM-DD: {args.changed}", file=sys.stderr)
        return 1

    css_bytes = args.css.read_bytes()
    digest = hashlib.sha256(css_bytes).hexdigest()
    if digest != CSS_SHA256:
        print(f"스타일시트가 swagger-ui-dist@5.17.14의 것과 다름: {digest}", file=sys.stderr)
        return 1
    css = css_bytes.decode("utf-8").rstrip()
    if css.endswith(SOURCE_MAP):
        css = css[: -len(SOURCE_MAP)].rstrip()

    spec = yaml.safe_load((args.repo / "api" / "openapi.yaml").read_text(encoding="utf-8"))
    template = (HERE / "viewer.html").read_text(encoding="utf-8")
    if template.count(SLOT) != 1:
        print("viewer.html에 스타일시트 자리가 하나가 아님", file=sys.stderr)
        return 1
    values = facts(spec, args.changed or last_changed(args.repo))
    for slot, value in values.items():
        if template.count(slot) != 1:
            print(f"viewer.html에 {slot} 자리가 하나가 아님", file=sys.stderr)
            return 1
        template = template.replace(slot, value)
    if "{{" in template:
        print("viewer.html에 채우지 않은 {{…}} 자리가 남음", file=sys.stderr)
        return 1

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "openapi.json").write_text(
        json.dumps(spec, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    (args.out / "siljang-api-contract.html").write_text(template.replace(SLOT, css), encoding="utf-8")
    changed = values["{{CHANGED}}"].strip(" ·") or "고침 날짜 없음"
    print(f"만듦: {args.out / 'siljang-api-contract.html'}, {args.out / 'openapi.json'} "
          f"(API {values['{{API_COUNT}}']}개, 응답 {values['{{RESPONSE_COUNT}}']}개, 오류 코드 {values['{{ERROR_COUNT}}']}개, "
          f"결정 사항 {values['{{DECISION_COUNT}}']}개, 열린 질문 {values['{{OPEN_COUNT}}']}개, "
          f"계약 {values['{{CONTRACT_VERSION}}']}, {changed})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
