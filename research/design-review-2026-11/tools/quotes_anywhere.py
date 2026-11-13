# 지적의 인용이 위치에 적힌 파일에 없을 때, 저장소의 단계 문서 전체(docs, api, db, design, 목업 보드)에서 찾아 어느 파일에 있는지 보인다.
# 사용: python3 -B quotes_anywhere.py <repo root> <review md> [지적 ID ...]
import re, sys, html
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
root = Path(sys.argv[1]); md = Path(sys.argv[2]); want = set(sys.argv[3:])
def norm(s): return re.sub(r"\s+", " ", s).strip()
files = []
for pat in ["docs/**/*.md", "docs/**/*.yaml", "docs/**/*.html", "api/*.yaml", "db/*.sql", "design/*.json", "research/cake-mockup-2026-11/canvas/project/*.html"]:
    files += [p for p in root.glob(pat) if p.is_file()]
texts = {}
for p in files:
    t = p.read_text(encoding="utf-8", errors="replace")
    if p.suffix == ".html":
        t = html.unescape(re.sub(r"<[^>]+>", " ", t))
    texts[str(p.relative_to(root))] = norm(t)
txt = md.read_text(encoding="utf-8")
for part in re.split(r"(?m)^(?=###\s+R[A-E]-\d+)", txt):
    m = re.match(r"###\s+(R[A-E]-\d+)", part)
    if not m or (want and m.group(1) not in want): continue
    ev = re.search(r"(?ms)^\s*-\s*\**근거\**\s*[:：](.*?)(?=^\s*-\s*\**(?:왜 중요한가|고치는 방향|확실도)\**\s*[:：])", part)
    blk = ev.group(1) if ev else part
    qs = [q for q in re.findall(r"[\"“]([^\"”\n]{8,})[\"”]", blk)]
    print("==", m.group(1))
    for q in qs:
        # 인용 안의 생략 기호로 나눠 조각마다 찾음
        pieces = [norm(x) for x in re.split(r"…|\.\.\.", q) if len(norm(x)) >= 6]
        res = []
        for pc in pieces:
            hits = [f for f, t in texts.items() if pc in t]
            res.append((pc[:50], hits[:3], len(hits)))
        ok = all(r[2] > 0 for r in res)
        print(("  OK " if ok else "  ?? ") + q[:90])
        if not ok:
            for pc, h, n in res:
                if n == 0: print("       없음:", pc)
