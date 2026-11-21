"""합성 원본에서 브라우저가 보여야 할 첫 프레임의 방향·모서리 표식을 독립 생성한다."""

import argparse
import json
from pathlib import Path

from PIL import Image

TRANSPOSE = {
    2: Image.Transpose.FLIP_LEFT_RIGHT, 3: Image.Transpose.ROTATE_180,
    4: Image.Transpose.FLIP_TOP_BOTTOM, 5: Image.Transpose.TRANSPOSE,
    6: Image.Transpose.ROTATE_270, 7: Image.Transpose.TRANSVERSE,
    8: Image.Transpose.ROTATE_90,
}

parser = argparse.ArgumentParser()
parser.add_argument("directory", type=Path)
parser.add_argument("expected", type=Path)
args = parser.parse_args()
rows = []
for case in json.loads((args.directory / "manifest.json").read_text()):
    with Image.open(args.directory / (case["name"] + ".webp")) as source:
        image = source.convert("RGBA")
    if case["orientation"] != 1:
        image = image.transpose(TRANSPOSE[case["orientation"]])
    margin = max(3, min(image.size) // 16)
    points = [(margin, margin), (image.width - margin - 1, margin),
              (margin, image.height - margin - 1),
              (image.width - margin - 1, image.height - margin - 1)]
    rows.append({"name": case["name"], "width": image.width, "height": image.height,
                 "points": [{"x": x, "y": y, "rgba": image.getpixel((x, y))} for x, y in points]})
args.expected.write_text(json.dumps(rows, indent=2) + "\n")
