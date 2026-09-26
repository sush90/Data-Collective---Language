"""Export everything the website needs into site/data/ (no audio).

  python export_site.py          # public data for site/
  python build_local.py          # then: copy of site/ plus real audio, for the live demo

Map views:
  controlled  prosody with the part predictable from background noise removed (default)
  raw         prosody features as measured
each at two levels: single clips and speaker averages (5 clips per speaker).
"""
import json
import os
import shutil
import warnings

import librosa
import numpy as np
import pandas as pd
import umap
from joblib import Parallel, delayed
from sklearn.linear_model import LinearRegression
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler

import prosody
import silence
from extract import CACHE, OUT, ROOT, choose_clips, load_config, panel_clips

warnings.filterwarnings("ignore")
SITE = os.path.join(ROOT, "site")
DATA = os.path.join(SITE, "data")
F = prosody.FEATURES
SEED = 0
K_NN = 15
SPEAKER_CLIPS = 5
# Colour = language family (validated palette, adjacent pairs, light and dark);
# languages in one family share the hue and differ by marker shape.
FAMILY_PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"]
FAMILY_PALETTE_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300"]
MARKERS = ["circle", "square", "triangle", "diamond", "triangle-down", "star"]
GEO_FIELDS = ["lat", "lon", "label", "countries", "where", "speakers_est", "about"]

cfg = load_config()
LANGS = [L["name"] for L in cfg["languages"]]
folder = {L["name"]: L["folder"] for L in cfg["languages"]}
FAMILY = {L["name"]: L["family"] for L in cfg["languages"]}
FAMILIES = list(dict.fromkeys(FAMILY[l] for l in LANGS))

# ------------------------------------------------------------------ clips and speakers
feat = pd.read_csv(CACHE)
feat = feat[feat["ok"] == True]
rows = []
for l in LANGS:
    keys = {p for _, p in choose_clips(folder[l], 300)}
    rows.append(feat[(feat.language == l) & feat.path.isin(keys)])
clips = pd.concat(rows, ignore_index=True)

spk = []
for l in LANGS:
    pc = panel_clips(folder[l])
    pan = feat[(feat.language == l) & feat.path.isin({p for _, p in pc})]
    for cid, g in pan.sort_values("path").groupby("client_id"):
        if len(g) >= SPEAKER_CLIPS:
            spk.append({"language": l, "client_id": cid, "members": list(g.head(SPEAKER_CLIPS)["path"])})
speakers = pd.DataFrame(spk)
member_rows = pd.concat([feat[(feat.language == r.language) & feat.path.isin(r.members)]
                         for r in speakers.itertuples()], ignore_index=True)

# background-noise features for every clip we use
allc = pd.concat([clips, member_rows], ignore_index=True).drop_duplicates(["language", "path"])
sil_in = allc[["language", "path", "client_id"]].copy()
sil_in["folder"] = sil_in.language.map(folder)
sil = silence.run(sil_in)
sil = sil[sil.sil_ok == True].set_index(["language", "path"])
S = silence.SIL_FEATURES

clips = clips[[(r.language, r.path) in sil.index for r in clips.itertuples()]].reset_index(drop=True)
speakers = speakers[[all((r.language, p) in sil.index for p in r.members)
                     for r in speakers.itertuples()]].reset_index(drop=True)
print(f"{len(clips)} clips, {len(speakers)} speakers on the site")

# ------------------------------------------------------------------ the two feature spaces
pscaler = StandardScaler().fit(clips[F].values)
sscaler = StandardScaler().fit(sil.loc[list(zip(clips.language, clips.path)), S].values.astype(float))
reg = LinearRegression().fit(
    sscaler.transform(sil.loc[list(zip(clips.language, clips.path)), S].values.astype(float)),
    pscaler.transform(clips[F].values))


def spaces(lang_path_pairs, raw_feats):
    Xr = pscaler.transform(raw_feats)
    Xs = sscaler.transform(sil.loc[lang_path_pairs, S].values.astype(float))
    return Xr, Xr - reg.predict(Xs)


Xc_raw, Xc_ctl = spaces(list(zip(clips.language, clips.path)), clips[F].values)
fidx = feat.set_index(["language", "path"])


def speaker_space(r):
    pairs = [(r.language, p) for p in r.members]
    a, b = spaces(pairs, fidx.loc[pairs, F].values)
    return a.mean(0), b.mean(0)


sp = [speaker_space(r) for r in speakers.itertuples()]
Xs_raw = np.array([a for a, _ in sp])
Xs_ctl = np.array([b for _, b in sp])


def centroids(X, lang, groups):
    df = pd.DataFrame(X)
    df["language"], df["g"] = lang, groups
    return df.groupby(["language", "g"]).mean().groupby("language").mean().reindex(LANGS)


def neighbours(C):
    D = np.sqrt(((C.values[:, None] - C.values[None]) ** 2).sum(-1))
    out = {}
    for i, l in enumerate(LANGS):
        order = [j for j in np.argsort(D[i]) if j != i]
        out[l] = [{"language": LANGS[j], "distance": round(float(D[i, j]), 3),
                   "similarity": round(float(1 / (1 + D[i, j])), 3)} for j in order]
    return out, D


views, neigh = {}, {}
clip_lang = clips.language.map(LANGS.index).tolist()
spk_lang = speakers.language.map(LANGS.index).tolist()
for space, Xc, Xs in [("controlled", Xc_ctl, Xs_ctl), ("raw", Xc_raw, Xs_raw)]:
    for level, X, lang, groups, nn in [("clips", Xc, clips.language.values, clips.client_id.values, 15),
                                       ("speakers", Xs, speakers.language.values, speakers.client_id.values, 10)]:
        key = f"{space}_{level}"
        emb = umap.UMAP(n_neighbors=nn, min_dist=0.3, random_state=SEED).fit_transform(X)
        emb = (emb - emb.mean(0)) / emb.std()
        nb, D = neighbours(centroids(X, lang, groups))
        neigh[key] = nb
        views[key] = {"xy": np.round(emb, 3).tolist(), "X": np.round(X, 3).tolist(),
                      "k": K_NN if level == "clips" else 10}
        print(key, {l: [n["language"] for n in nb[l][:2]] for l in LANGS})

# ------------------------------------------------------------------ contours for sonification
needed = sorted({(r.language, r.path) for r in clips.itertuples()} |
                {(r.language, p) for r in speakers.itertuples() for p in r.members})


def contour(lang, path):
    y, _ = librosa.load(os.path.join(ROOT, "data", folder[lang], "clips", path), sr=prosody.SR)
    feats, info = prosody.analyze(y)
    st = info["st"]
    a, b = info["a"], info["b"]
    seg = st[a: b + 1: 2]  # 20 ms steps over the speech region
    return {"t0": round(a * prosody.HOP / prosody.SR, 3), "dt": 0.02,
            "dur": round(len(y) / prosody.SR, 3),
            "st": [None if not np.isfinite(v) else round(float(v), 2) for v in seg],
            "nuc": [round(i * prosody.HOP / prosody.SR, 3) for i in info["nuclei"]],
            "f": {k: round(float(v), 4) for k, v in feats.items()}}


print(f"Computing contours for {len(needed)} clips...")
cons = Parallel(n_jobs=-1)(delayed(contour)(l, p) for l, p in needed)
clip_id = {k: i for i, k in enumerate(needed)}
clip_table = [{"l": LANGS.index(l), "file": f"{folder[l]}/{p}"} for l, p in needed]

# ------------------------------------------------------------------ write
os.makedirs(DATA, exist_ok=True)
R = json.load(open(os.path.join(OUT, "results.json")))
fam_idx = {f: i for i, f in enumerate(FAMILIES)}
lang_info = []
for l in LANGS:
    s = next(x for x in R["speakers"] if x["language"] == l)
    L = next(x for x in cfg["languages"] if x["name"] == l)
    fi = fam_idx[FAMILY[l]]
    within = [m for m in LANGS if FAMILY[m] == FAMILY[l]].index(l)
    lang_info.append({"name": l, "family": FAMILY[l], "color": FAMILY_PALETTE[fi], "color_dark": FAMILY_PALETTE_DARK[fi],
                      "marker": MARKERS[within], "clips": s["clips"], "speakers": s["speakers"],
                      "panel_speakers": int((speakers.language == l).sum()), "caveat": s["caveat"],
                      **{k: L[k] for k in GEO_FIELDS if k in L}})
fam_info = [{"name": f, "color": FAMILY_PALETTE[i], "color_dark": FAMILY_PALETTE_DARK[i]}
            for i, f in enumerate(FAMILIES)]

feature_means = {l: clips[clips.language == l][F].mean().round(4).to_dict() for l in LANGS}
json.dump({"languages": lang_info, "families": fam_info, "features": F, "feature_labels": R["feature_labels"],
           "feature_means": feature_means,
           "sibling_pairs": cfg.get("sibling_pairs", [])},
          open(os.path.join(DATA, "languages.json"), "w"))
json.dump({"clips": {"lang": clip_lang, "ref": [clip_id[(r.language, r.path)] for r in clips.itertuples()]},
           "speakers": {"lang": spk_lang,
                        "members": [[clip_id[(r.language, p)] for p in r.members] for r in speakers.itertuples()]},
           "views": views, "neighbours": neigh},
          open(os.path.join(DATA, "map.json"), "w"), separators=(",", ":"))
json.dump({"clips": clip_table, "contours": cons}, open(os.path.join(DATA, "contours.json"), "w"),
          separators=(",", ":"))
mel = silence.noise_mel()  # its width tells the browser how many FFT bins (0 to 7 kHz) to use
json.dump({"features": F, "p_mean": pscaler.mean_.tolist(), "p_scale": pscaler.scale_.tolist(),
           "sil_features": S, "s_mean": sscaler.mean_.tolist(), "s_scale": sscaler.scale_.tolist(),
           "reg_coef": reg.coef_.round(6).tolist(), "reg_intercept": reg.intercept_.round(6).tolist(),
           "mel": mel.astype(float).tolist()},
          open(os.path.join(DATA, "model.json"), "w"), separators=(",", ":"))
R["site_neighbours"] = neigh
json.dump(R, open(os.path.join(DATA, "validation.json"), "w"), separators=(",", ":"),
          default=lambda o: o.item() if hasattr(o, "item") else str(o))
json.dump({"neighbours": neigh}, open(os.path.join(OUT, "site_neighbours.json"), "w"), indent=1)

os.makedirs(os.path.join(SITE, "img"), exist_ok=True)
for fname in ["accuracy_summary.png", "held_out_siblings.png", "dendrogram_clips.png",
              "confusion_speakers.png", "feature_importance.png"]:
    shutil.copy(os.path.join(OUT, fname), os.path.join(SITE, "img", fname))
for fname in os.listdir(DATA):
    print(f"  site/data/{fname}: {os.path.getsize(os.path.join(DATA, fname)) / 1e3:.0f} kB")
