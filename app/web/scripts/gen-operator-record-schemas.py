#!/usr/bin/env python3
"""Extract the SCR-050 response contracts from OpenAPI."""
import json
import subprocess
from pathlib import Path
import yaml
root = Path(__file__).resolve().parents[3]
all_schemas = yaml.safe_load((root / "api/openapi.yaml").read_text())["components"]["schemas"]
selected = {}
def collect(value):
    if isinstance(value, dict):
        ref = value.get("$ref")
        if ref:
            name = ref.rsplit("/", 1)[-1]
            if name not in selected:
                selected[name] = all_schemas[name]
                collect(selected[name])
        for item in value.values():
            collect(item)
    elif isinstance(value, list):
        for item in value:
            collect(item)
for name in ("OperatorRecordList", "OperatorConsultation", "OperatorOrder", "OriginalValue"):
    selected[name] = all_schemas[name]
    collect(selected[name])
output = root / "app/web/src/operator-record-schemas.json"
output.write_text(json.dumps(selected, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
subprocess.run([str(root / "app/node_modules/.bin/biome"), "format", "--write", str(output)], cwd=root / "app", check=True)
