"""사람 사진 없이 합성 WebP를 만든다. 실행: python3 fixtures.py /tmp/출력폴더."""

import json
import random
import struct
import sys
from pathlib import Path

from PIL import Image, ImageDraw, TiffImagePlugin


def exif(orientation):
    tags = Image.Exif()
    tags[274] = orientation
    tags[271] = "Siljang synthetic camera"
    tags[306] = "2026:11:21 00:00:00"
    rational = TiffImagePlugin.IFDRational
    tags[34853] = {1: "N", 2: (rational(1), rational(15), rational(0)), 3: "E", 4: (rational(2), rational(30), rational(0))}
    return tags


def picture(width, height, frame=0, noise=False):
    if noise:
        pixels = random.Random(2601121 + frame).randbytes(width * height * 4)
        image = Image.frombytes("RGBA", (width, height), pixels)
    else:
        image = Image.new("RGBA", (width, height))
    draw = ImageDraw.Draw(image)
    colors = [(220, 20, 30, 32), (20, 210, 30, 96), (20, 30, 220, 160), (210, 190, 20, 224)]
    edge = max(8, min(width, height) // 4)
    corners = [(0, 0), (width - edge, 0), (0, height - edge), (width - edge, height - edge)]
    if not noise:
        edge = min(width, height) // 2
    for i, (x, y) in enumerate(corners):
        draw.rectangle((x, y, x + edge - 1, y + edge - 1), fill=colors[(i + frame) % 4])
    return image


def pad_metadata(path, size):
    data = bytearray(path.read_bytes())
    padding = size - len(data) - 8
    if padding < 0 or padding % 2:
        raise ValueError("cannot pad input to exact size")
    data.extend(b"XMP " + struct.pack("<I", padding) + b" " * padding)
    # Pillow의 EXIF 포함 WebP는 VP8X가 첫 청크다. XMP 플래그와 RIFF 길이만 고친다.
    if data[12:16] != b"VP8X":
        raise ValueError("missing VP8X")
    data[20] |= 0x04
    data[4:8] = struct.pack("<I", len(data) - 8)
    path.write_bytes(data)


def main():
    directory = Path(sys.argv[1])
    directory.mkdir(parents=True, exist_ok=True)
    rows = []

    def save(name, frames, orientation, durations=None, loop=3, padded=None):
        path = directory / f"{name}.webp"
        kwargs = {"lossless": True, "method": 0, "exif": exif(orientation)}
        if len(frames) > 1:
            kwargs.update(save_all=True, append_images=frames[1:], duration=durations, loop=loop)
        frames[0].save(path, **kwargs)
        if padded:
            pad_metadata(path, padded)
        rows.append({"name": name, "orientation": orientation, "input_bytes": path.stat().st_size,
                     "width": frames[0].width, "height": frames[0].height,
                     "frames": len(frames), "durations": durations, "loop": loop if len(frames) > 1 else None})

    for orientation in range(1, 9):
        save(f"still-{orientation}", [picture(160, 96)], orientation)
        save(f"animated-{orientation}", [picture(160, 96, i) for i in range(3)], orientation, [80, 120, 200])
    save("large-pixels-6", [picture(4000, 3000)], 6)
    save("input-10mib-7", [picture(1792, 1440, noise=True)], 7, padded=10 * 1024 * 1024)
    save("input-20mib-8", [picture(2520, 2048, noise=True)], 8, padded=20 * 1024 * 1024)
    save("frames-40-5", [picture(320, 192, i) for i in range(40)], 5,
         [80 + i % 5 * 10 for i in range(40)], loop=7)
    (directory / "manifest.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"files": len(rows), "largest_input_bytes": max(r["input_bytes"] for r in rows)}))


if __name__ == "__main__":
    main()
