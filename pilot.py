"""Phase 1 pilot: sanity checks and a first plot on the cached pilot features.

Run after:  python extract.py --per-lang 50
"""
import os
import warnings

import librosa
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import parselmouth
import umap
from sklearn.preprocessing import StandardScaler

import prosody
from extract import CACHE, OUT, ROOT, choose_clips, load_config

cfg = load_config()
langs = [L["name"] for L in cfg["languages"]]
folder = {L["name"]: L["folder"] for L in cfg["languages"]}
wanted = {p for L in cfg["languages"] for _, p in choose_clips(L["folder"], 50)}
df = pd.read_csv(CACHE)
df = df[df["path"].isin(wanted) & (df["ok"] == True)].reset_index(drop=True)

# 1. Pitch cross-check: our YIN vs Praat on 10 clips per language.
rows = []
for lang in langs:
    for p in df[df.language == lang]["path"].head(10):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            y, _ = librosa.load(os.path.join(ROOT, "data", folder[lang], "clips", p), sr=prosody.SR)
        _, info = prosody.analyze(y)
        snd = parselmouth.Sound(y.astype(np.float64), sampling_frequency=prosody.SR)
        pitch = snd.to_pitch_ac(time_step=prosody.HOP / prosody.SR,
                                pitch_floor=prosody.F0_MIN, pitch_ceiling=prosody.F0_MAX)
        n = len(info["st"])
        times = (np.arange(n) * prosody.HOP + prosody.WIN / 2) / prosody.SR
        praat = np.array([pitch.get_value_at_time(t) for t in times])
        ours = info["median_f0"] * 2 ** (info["st"] / 12.0)
        both = np.isfinite(ours) & np.isfinite(praat) & (praat > 0)
        err_st = np.abs(12 * np.log2(ours[both] / praat[both]))
        rows.append({"language": lang,
                     "voiced_agree": float(np.mean(np.isfinite(ours) == (np.isfinite(praat) & (praat > 0)))),
                     "median_abs_err_st": float(np.median(err_st)) if both.any() else np.nan,
                     "gross_err_pct": float(np.mean(err_st > 1.0) * 100) if both.any() else np.nan})
chk = pd.DataFrame(rows).groupby("language").mean().reindex(langs)
print("YIN vs Praat pitch (10 clips per language):")
print(chk.round(3).to_string())

# 2. Feature summary by language.
print("\nFeature means by language:")
print(df.groupby("language")[prosody.FEATURES].mean().reindex(langs).T.round(2).to_string())
print("\nFeature pairs with |r| > 0.85 (possible redundancy):")
c = df[prosody.FEATURES].corr()
for i, a in enumerate(prosody.FEATURES):
    for b in prosody.FEATURES[i + 1:]:
        if abs(c.loc[a, b]) > 0.85:
            print(f"  {a} ~ {b}: r = {c.loc[a, b]:.2f}")

# 3. First plot: UMAP of pilot clips.
X = StandardScaler().fit_transform(df[prosody.FEATURES].values)
emb = umap.UMAP(n_neighbors=15, min_dist=0.2, random_state=0).fit_transform(X)
fig, ax = plt.subplots(figsize=(9, 7))
for lang in langs:
    m = (df.language == lang).values
    ax.scatter(emb[m, 0], emb[m, 1], s=28, alpha=0.75, label=f"{lang} (n={m.sum()})")
ax.set_title("Pilot: prosodic fingerprints, 5 languages x 50 clips (UMAP)", fontsize=14)
ax.set_xticks([]); ax.set_yticks([])
ax.legend(fontsize=12, frameon=False)
fig.tight_layout()
os.makedirs(OUT, exist_ok=True)
fig.savefig(os.path.join(OUT, "pilot_umap.png"), dpi=150)
print("\nSaved outputs/pilot_umap.png")
