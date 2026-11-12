"""Parse the working-tree domain.md with the hub's own stage-01 parser and list its warnings."""
import importlib.util, json, sys
from collections import Counter
from pathlib import Path
from types import SimpleNamespace

scripts = Path(sys.argv[1])
repo = Path(sys.argv[2])
spec = importlib.util.spec_from_file_location("hubmod", scripts / "hub.py")
hub = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hub)
h = SimpleNamespace(**vars(hub))
settings = json.loads((repo / ".corthex/project.json").read_text(encoding="utf-8"))
h.picture_ids = h.IdFormat(settings.get("ids"))
rel = "docs/01-domain/domain.md"
checks = []
pic = hub.companion("domain").parse([(rel, (repo / rel).read_text(encoding="utf-8"))], checks, h, "")
print("contexts", len(pic["contexts"]), "rows", sum(len(c["rows"]) for c in pic["contexts"]),
      "aggregates", len(pic["aggregates"]), "read_models", len(pic["read_models"]),
      "dependencies", len(pic["dependencies"]), "hotspots", len(pic["hotspots"]))
print("hotspot states", dict(Counter(x["state"] for x in pic["hotspots"])))
print("timeline", [(t["lane"], len(t["places"])) for t in pic.get("timeline", [])])
print("checks", len(checks))
for c in checks:
    print(" ", c)
