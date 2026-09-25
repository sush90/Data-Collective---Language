"""Verify that site/js/fingerprint.js computes the same fingerprint as prosody.py.

Decodes N dataset clips once with ffmpeg (16 kHz mono float32), feeds the identical
samples to Python and to Node, and compares all 15 prosodic features plus the 16
background-noise features.  Usage: python verify_js.py [N]
"""
import json
import os
import subprocess
import sys
import tempfile

import numpy as np

import prosody
import silence
from extract import ROOT, choose_clips, load_config

N = int(sys.argv[1]) if len(sys.argv) > 1 else 20
TOL = 1e-6  # relative tolerance
cfg = load_config()
clips = []
per = -(-N // len(cfg["languages"]))  # ceil, then trim to N
for L in cfg["languages"]:
    for _, p in choose_clips(L["folder"], 300)[:per]:
        clips.append(os.path.join(ROOT, "data", L["folder"], "clips", p))
clips = clips[:N]

tmp = tempfile.mkdtemp()
raws = []
for k, c in enumerate(clips):
    out = os.path.join(tmp, f"{k}.f32")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", c, "-ac", "1", "-ar", "16000",
                    "-f", "f32le", out], check=True)
    raws.append(out)

js = r"""
const fs = require('fs'); const fp = require(process.argv[2]);
const model = JSON.parse(fs.readFileSync(process.argv[3]));
const out = process.argv.slice(4).map(f => {
  const b = fs.readFileSync(f); const x = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
  const r = fp.analyze(x);
  return { f: r.features, q: fp.passesQuality(r), s: fp.silenceFeatures(x, model.mel) };
});
console.log(JSON.stringify(out));
"""
jsfile = os.path.join(tmp, "run.js")
open(jsfile, "w").write(js)
res = subprocess.run(["node", jsfile, os.path.join(ROOT, "site/js/fingerprint.js"),
                      os.path.join(ROOT, "site/data/model.json")] + raws,
                     capture_output=True, text=True, check=True)
js_out = json.loads(res.stdout)

worst, mism, qual_mism = {}, [], 0
for k, (c, r) in enumerate(zip(clips, js_out)):
    x = np.fromfile(raws[k], dtype=np.float32)
    pf, info = prosody.analyze(x)
    ok, _ = prosody.passes_quality(pf, info)
    if ok != r["q"][0]:
        qual_mism += 1
    ps = silence.silence_features_array(x)
    pairs = [(f, pf[f] if pf else None, (r["f"] or {}).get(f)) for f in prosody.FEATURES] + \
            [(f, ps[f] if ps else None, (r["s"] or {}).get(f)) for f in silence.SIL_FEATURES]
    for f, a, b in pairs:
        if a is not None and not np.isfinite(a) and b is None:
            continue  # NaN in both (JSON encodes JavaScript NaN as null)
        if a is None or b is None:
            if (a is None) != (b is None):
                mism.append((os.path.basename(c), f, a, b))
            continue
        if not np.isfinite(a) and (b is None or not np.isfinite(b)):
            continue
        rel = abs(a - b) / max(1e-9, abs(a), abs(b))
        worst[f] = max(worst.get(f, 0), rel)
        if rel > TOL:
            mism.append((os.path.basename(c), f, a, b))

print(f"Compared {len(clips)} clips, {len(prosody.FEATURES)} prosodic + {len(silence.SIL_FEATURES)} noise features")
print(f"Quality-gate disagreements: {qual_mism}")
print("Worst relative difference per feature:")
for f in prosody.FEATURES + silence.SIL_FEATURES:
    print(f"  {f:18s} {worst.get(f, 0):.2e}")
print(f"Mismatches above {TOL:g}: {len(mism)}")
for m in mism[:20]:
    print("  ", m)
sys.exit(1 if mism or qual_mism else 0)
