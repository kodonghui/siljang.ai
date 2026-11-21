"""학원컴의 기존 시험 Worker에 합성 검사를 실행하고 공개 결과만 가져온다."""

import argparse
import base64
import importlib.util
import json
import os
import re
import selectors
import subprocess
import sys
import time
import uuid
import zipfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--bundle", type=Path, required=True)
parser.add_argument("--input", type=Path, required=True)
parser.add_argument("--source", required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
if len(args.source) != 40 or any(c not in "0123456789abcdef" for c in args.source):
    raise SystemExit("source_sha_invalid")
here = Path(__file__).resolve().parent
args.output.mkdir(parents=True, exist_ok=True)
folder = "siljang-photo-existing-" + uuid.uuid4().hex[:10]
cases = json.loads((args.input / "manifest.json").read_text())
if len(cases) != 20 or any(not c["name"].replace("-", "").isalnum() for c in cases):
    raise SystemExit("synthetic_manifest_invalid")
credentials = {"account": os.environ.get("CLOUDFLARE_ACCOUNT_ID"),
               "token": os.environ.get("CLOUDFLARE_API_TOKEN"), "source": args.source}
if not credentials["account"] or not credentials["token"]:
    raise SystemExit("credentials_absent")


def command(script):
    return ["ssh", "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "academy-pc",
            "powershell", "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
            base64.b64encode(script.encode("utf-16le")).decode()]


def remote(script, timeout=30):
    return subprocess.run(command(script), capture_output=True, timeout=timeout)


def emit(row):
    print(json.dumps(row, ensure_ascii=False), flush=True)


metadata = {"worker": "siljang-kakao-test", "baseline": "448d489b-225f-4ddf-84f7-fa3a525a5a18",
            "folder": folder, "host": "academy-pc", "source": args.source}
(args.output / "public-controller.json").write_text(json.dumps(metadata, indent=2))
setup = remote("$ErrorActionPreference='Stop';New-Item -ItemType Directory -Path (Join-Path $env:USERPROFILE '" + folder + "')|Out-Null")
if setup.returncode:
    raise SystemExit("setup_failed")
archive = args.output / "public-input.zip"
with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as z:
    z.write(args.input / "manifest.json", "manifest.json")
    for case in cases:
        z.write(args.input / (case["name"] + ".webp"), case["name"] + ".webp")
for source, name in [(args.bundle, "probe.mjs"), (here / "existing-driver.mjs", "driver.mjs"), (archive, "input.zip")]:
    r = subprocess.run(["scp", "-q", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
                        str(source), "academy-pc:" + folder + "/" + name], capture_output=True, timeout=120)
    if r.returncode:
        raise SystemExit("public_transfer_failed")
emit({"event": "photo_existing_public_transfer", "files": 3, "inputs": len(cases)})
script = r'''
$ErrorActionPreference='Stop';$p=[Console]::In.ReadLine()|ConvertFrom-Json
$env:CLOUDFLARE_ACCOUNT_ID=$p.account;$env:CLOUDFLARE_API_TOKEN=$p.token
$env:SILJANG_SOURCE_SHA=$p.source;$env:WRANGLER_SEND_METRICS='false';$env:CI='1';$env:NO_UPDATE_NOTIFIER='1'
$folder=Join-Path $env:USERPROFILE 'FOLDER'
try {
 Expand-Archive -LiteralPath (Join-Path $folder 'input.zip') -DestinationPath (Join-Path $folder 'input')
 $env:SILJANG_PROBE_FOLDER=$folder
 $env:SILJANG_WRANGLER_CLI=Join-Path $env:LOCALAPPDATA 'siljang-tools\node_modules\wrangler\wrangler-dist\cli.js'
 & node (Join-Path $folder 'driver.mjs') 2>$null
 $siljangExit=$LASTEXITCODE
 Compress-Archive -Path (Join-Path $folder 'output'),(Join-Path $folder 'report.json') -DestinationPath (Join-Path $folder 'result.zip')
 exit $siljangExit
} catch {@{event='photo_existing_transport_setup_failed'}|ConvertTo-Json -Compress;exit 1}
'''.replace("'FOLDER'", "'" + folder + "'")
p = subprocess.Popen(command(script), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
p.stdin.write((json.dumps(credentials) + "\n").encode())
p.stdin.close()
selector = selectors.DefaultSelector()
selector.register(p.stdout, selectors.EVENT_READ)
buffer = b""
records = []
deadline = time.monotonic() + 760
while selector.get_map() and time.monotonic() < deadline:
    for key, _ in selector.select(timeout=1):
        chunk = os.read(key.fd, 8192)
        if not chunk:
            selector.unregister(key.fileobj)
            continue
        buffer += chunk
        while b"\n" in buffer:
            line, buffer = buffer.split(b"\n", 1)
            try:
                row = json.loads(line.decode("utf-8-sig"))
                if isinstance(row, dict) and str(row.get("event", "")).startswith("photo_existing_"):
                    records.append(row)
                    (args.output / "controller-events.json").write_text(json.dumps({**metadata, "records": records}, indent=2))
                    emit(row)
            except ValueError:
                pass
if selector.get_map():
    p.kill()
    emit({"event": "photo_existing_transport_timeout", "rollback_unconfirmed": True})
else:
    p.wait(timeout=10)
error = p.stderr.read()
emit({"event": "photo_existing_transport_finished", "exitCode": p.poll(), "parserError": b"ParserError" in error})
result_zip = args.output / "result.zip"
copied = subprocess.run(["scp", "-q", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
                         "academy-pc:" + folder + "/result.zip", str(result_zip)], capture_output=True, timeout=150)
if copied.returncode:
    emit({"event": "photo_existing_result_transfer_failed", "exitCode": copied.returncode})
    raise SystemExit(1)
with zipfile.ZipFile(result_zip) as z:
    if sum(item.file_size for item in z.infolist()) > 128 * 1024 * 1024:
        raise SystemExit("result_archive_too_large")
    for item in z.infolist():
        name = item.filename.replace("\\", "/")
        if name.endswith("/"):
            continue
        if name != "report.json" and not re.fullmatch(r"output/(?:stream|multipart)-[a-z0-9-]+\.webp", name):
            raise SystemExit("result_archive_path_invalid")
        destination = args.output / "received" / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(z.read(item))
# Node 실행이 종료한 뒤 자기 공개 파일 폴더만 정리한다. Worker 복구는 Node의 finally가 맡는다.
if p.poll() is not None:
    cleaned = remote("$folder=Join-Path $env:USERPROFILE '" + folder + "';Remove-Item -LiteralPath $folder -Recurse -Force;@{event='photo_existing_folder_cleanup';absent=(!(Test-Path -LiteralPath $folder))}|ConvertTo-Json -Compress")
    for line in cleaned.stdout.decode("utf-8-sig", errors="replace").splitlines():
        try:
            row = json.loads(line)
            if row.get("event") == "photo_existing_folder_cleanup":
                emit(row)
        except ValueError:
            pass
report = json.loads((args.output / "received/report.json").read_text())
spec = importlib.util.spec_from_file_location("independent_webp", here / "check.py")
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)
independent = []
by_name = {c["name"]: c for c in cases}
for row in report["results"]:
    case = by_name[row["name"]]
    result = {**row, "passed": False}
    path = args.output / "received/output" / (row["mode"] + "-" + row["name"] + ".webp")
    if path.is_file():
        result.update(checker.compare(args.input / (row["name"] + ".webp"), path.read_bytes(), case["orientation"]))
    independent.append(result)
report["independent_results"] = independent
(args.output / "independent-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
emit({"event": "photo_existing_independent_result", "cases": len(independent), "passed": sum(r["passed"] for r in independent)})
raise SystemExit(0 if p.returncode == 0 and len(independent) == 40 and all(r["passed"] for r in independent) else 1)
