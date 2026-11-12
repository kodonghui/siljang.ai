import os
# 저장소 맨 위. SILJANG_ROOT로 바꿀 수 있음(기본: 이 파일 기준 두 단계 위)
ROOT = os.environ.get("SILJANG_ROOT") or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
SELF = "research/cake-terms-2026-11/"  # 규칙 파일 자신은 대상에서 뺌
EXCLUDE = {
    "research/ai-booking-pivot-2026-11/payments_legal_kr_us.md",
    "research/cake-domain-2026-11/study-retro-notes-2026-11-11.md",
    "research/cake-domain-2026-11/pc-check-2026-11-11.md",
    "research/cake-flow-2026-11/HANDOFF.md",
    "research/cake-flow-2026-11/notion-sync/proj_next.py",  # 한 번 돌린 Notion 수정 스크립트(옛 문구와 맞춰야 함)
    "research/cake-flow-2026-11/notion-sync/add_links.py",  # 같은 이유
}
EXT = (".md", ".py", ".sql", ".yaml", ".yml", ".json", ".html", ".txt", ".mmd")
def files():
    out = ["README.md"]
    for top in ["docs", "db", "api", "research", ".corthex"]:
        for dp, dn, fn in os.walk(os.path.join(ROOT, top)):
            dn[:] = [d for d in dn if d not in ("__pycache__", "node_modules")]
            for f in fn:
                rel = os.path.relpath(os.path.join(dp, f), ROOT)
                if rel.endswith(EXT) and rel not in EXCLUDE and not rel.startswith(SELF):
                    out.append(rel)
    return sorted(out)
