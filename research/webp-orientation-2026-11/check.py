"""원격 미리보기 출력의 방향·촬영 정보·알파·애니메이션을 독립 디코더로 대조한다."""

import argparse
import io
import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image, ImageChops


TRANSPOSE = {2: Image.Transpose.FLIP_LEFT_RIGHT, 3: Image.Transpose.ROTATE_180,
             4: Image.Transpose.FLIP_TOP_BOTTOM, 5: Image.Transpose.TRANSPOSE,
             6: Image.Transpose.ROTATE_270, 7: Image.Transpose.TRANSVERSE, 8: Image.Transpose.ROTATE_90}


def frames(image):
    result = []
    for i in range(image.n_frames):
        image.seek(i)
        image.load()
        result.append((image.convert("RGBA"), image.info.get("duration")))
    return result


def compare(source, output, orientation):
    original = Image.open(source)
    actual = Image.open(io.BytesIO(output))
    tags = actual.getexif()
    metadata_removed = all(k == 274 and v == 1 for k, v in tags.items()) and "xmp" not in actual.info
    before, after = frames(original), frames(actual)
    durations_match = [d for _, d in before] == [d for _, d in after]
    loop_match = original.info.get("loop") == actual.info.get("loop")
    alpha_match = len(before) == len(after)
    colors_match = alpha_match
    dimensions_match = alpha_match
    for (left, _), (right, _) in zip(before, after):
        expected = left.transpose(TRANSPOSE[orientation]) if orientation != 1 else left
        if expected.size != right.size:
            dimensions_match = alpha_match = colors_match = False
            continue
        if ImageChops.difference(expected.getchannel("A"), right.getchannel("A")).getbbox() is not None:
            alpha_match = False
        # RGB는 WebP 재인코딩을 고려해 모서리 표식의 중심을 허용 차 16으로 비교한다.
        margin = max(3, min(expected.size) // 16)
        for x, y in [(margin, margin), (expected.width - margin - 1, margin),
                     (margin, expected.height - margin - 1), (expected.width - margin - 1, expected.height - margin - 1)]:
            a, b = expected.getpixel((x, y)), right.getpixel((x, y))
            if a[3] and any(abs(a[k] - b[k]) > 16 for k in range(3)):
                colors_match = False
    checks = {"webp": actual.format == "WEBP", "metadata_removed": metadata_removed,
              "input_metadata_detected": bool(original.getexif()), "dimensions_match": dimensions_match,
              "alpha_exact": alpha_match, "corner_colors_match": colors_match,
              "frames_match": len(before) == len(after), "durations_match": durations_match, "loop_match": loop_match}
    return {"checks": checks, "passed": all(checks.values()), "output_frames": len(after),
            "output_width": actual.width, "output_height": actual.height, "output_bytes": len(output)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("--endpoint", default="http://127.0.0.1:8793")
    parser.add_argument("--name")
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    cases = json.loads((args.directory / "manifest.json").read_text())
    results = []
    output_directory = args.directory.parent / "output"
    output_directory.mkdir(exist_ok=True)
    for case in cases:
        if args.name and case["name"] != args.name:
            continue
        path = args.directory / (case["name"] + ".webp")
        request = urllib.request.Request(args.endpoint, data=path.read_bytes(), headers={"Content-Type": "image/webp"}, method="POST")
        started = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                output = response.read()
                row = {**case, "status": response.status, "response_content_type": response.headers.get("Content-Type"),
                       "elapsed_ms": round((time.monotonic() - started) * 1000), **compare(path, output, case["orientation"])}
                (output_directory / path.name).write_bytes(output)
        except urllib.error.HTTPError as error:
            data = error.read(8192).decode("utf-8", "replace")
            match = re.search(r"Error\s+(\d{4})", data)
            row = {**case, "status": error.code, "passed": False,
                   "worker_error_code": match.group(1) if match else None}
        except (OSError, ValueError) as error:
            row = {**case, "passed": False, "error_kind": type(error).__name__}
        results.append(row)
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps({"measurement": "HTTP wall time; CPU and peak Worker memory not measured", "results": results}, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps({"name": row["name"], "passed": row["passed"], "status": row.get("status"),
                          "checks": row.get("checks"), "error_kind": row.get("error_kind")}), flush=True)
        if not row["passed"]:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
