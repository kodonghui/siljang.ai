"""Turn an artboard .dc.html (literal markup only, no holes) into a plain HTML page for local checks."""
import re, sys, pathlib
src = pathlib.Path(sys.argv[1]); out = pathlib.Path(sys.argv[2])
t = src.read_text(encoding="utf-8")
if "{{" in t: raise SystemExit("holes found in " + src.name)
title = re.search(r"<title>(.*?)</title>", t, re.S).group(1)
helmet = re.search(r"<helmet>(.*?)</helmet>", t, re.S).group(1)
body = re.search(r"<x-dc>(.*?)</x-dc>", t, re.S).group(1)
body = re.sub(r"<helmet>.*?</helmet>", "", body, flags=re.S)
out.write_text('<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>%s</title>%s</head><body>%s</body></html>' % (title, helmet, body), encoding="utf-8")
