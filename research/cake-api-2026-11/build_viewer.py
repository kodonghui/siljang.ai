"""06단계 사람 보기(Swagger UI 페이지)를 원본 계약에서 다시 만든다.

    python3 -B research/cake-api-2026-11/build_viewer.py . 나갈_폴더 --css swagger-ui.css

- 원본은 `api/openapi.yaml`이다. 이 스크립트는 그것을 JSON(`openapi.json`)으로 옮기고,
  `viewer.html` 틀에 Swagger UI 5.17.14의 스타일시트를 그대로 넣어 `siljang-api-contract.html`을 만든다.
- 스타일시트는 npm 꾸러미 swagger-ui-dist@5.17.14의 `swagger-ui.css`다
  (`npm pack swagger-ui-dist@5.17.14`로 받아 `package/swagger-ui.css`). 다른 판이 섞이지 않게 SHA-256을 확인한다.
- 페이지가 원본에 더하는 것은 작업 이름 앞의 API ID와 설명 끝의 '돌려주지 않는 응답'뿐이며,
  둘 다 브라우저에서 원본의 `x-corthex`로 붙인다(`viewer.html`의 decorate).
- 만든 두 파일을 같은 Artifact 주소에 다시 올리면 사람 보기가 원본과 같아진다(`.corthex/project.json`의 06-api).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
CSS_SHA256 = "40170f0ee859d17f92131ba707329a88a070e4f66874d11365e9a77d232f6117"  # swagger-ui-dist@5.17.14 swagger-ui.css
CSS_HEADER = "/* Swagger UI 5.17.14 stylesheet (swagger-ui-dist, Apache-2.0), inlined unchanged */\n"
SOURCE_MAP = "/*# sourceMappingURL=swagger-ui.css.map*/"
SLOT = "/*SWAGGER_UI_CSS*/"


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("repo", type=Path, help="저장소 뿌리")
    ap.add_argument("out", type=Path, help="만든 파일을 둘 폴더(저장소 밖 권함)")
    ap.add_argument("--css", type=Path, required=True, help="swagger-ui-dist@5.17.14의 swagger-ui.css")
    args = ap.parse_args(argv)

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

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "openapi.json").write_text(
        json.dumps(spec, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    (args.out / "siljang-api-contract.html").write_text(template.replace(SLOT, css), encoding="utf-8")
    ops = sum(1 for item in spec["paths"].values() for k in item if k in {"get", "put", "post", "delete", "patch"})
    print(f"만듦: {args.out / 'siljang-api-contract.html'}, {args.out / 'openapi.json'} (작업 {ops}개, 계약 {spec['info']['version']})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
