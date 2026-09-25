"""Build site_local/: a copy of site/ that plays the original recordings, for a live demo.

  python build_local.py
  cd site_local && python -m http.server 8000     # then open http://localhost:8000

site_local/ is git-ignored and must never be deployed: the Mozilla Data Collective
terms forbid re-hosting Common Voice audio. The public site/ has no audio files.
Flip to real audio online only if the organizers approve (set audio: true in site/config.js
and copy audio/ into site/).
"""
import json
import os
import shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC, DST = os.path.join(ROOT, "site"), os.path.join(ROOT, "site_local")

if os.path.exists(DST):
    shutil.rmtree(DST)
shutil.copytree(SRC, DST)
with open(os.path.join(DST, "config.js"), "w") as f:
    f.write("// LOCAL DEMO BUILD: plays original Common Voice recordings. Do not deploy.\n"
            "window.PC_CONFIG = { audio: true };\n")
clips = json.load(open(os.path.join(SRC, "data", "contours.json")))["clips"]
n = 0
for c in clips:
    src = os.path.join(ROOT, "data", *c["file"].split("/")[:1], "clips", c["file"].split("/")[1])
    dst = os.path.join(DST, "audio", c["file"])
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy(src, dst)
    n += 1
size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(DST) for f in fs) / 1e6
print(f"site_local/ built with {n} audio clips ({size:.0f} MB). Serve it with:\n"
      f"  cd site_local && python -m http.server 8000")
