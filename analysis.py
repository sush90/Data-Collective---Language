"""Phase 3: language classification, neighbours, validation, recording-condition check.

Reads outputs/features.csv (from extract.py). Writes:
  outputs/results.json          every number the summary and website use
  outputs/umap_clips.csv        final 2D map of clips
  outputs/umap_speakers.csv     final 2D map of speaker averages
  outputs/scaler.json           standardization parameters for the browser
  outputs/*.png                 presentation figures
"""
import json
import os
import warnings

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import umap
from scipy.cluster.hierarchy import dendrogram, linkage
from scipy.spatial.distance import squareform
from sklearn.ensemble import RandomForestClassifier
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, balanced_accuracy_score, confusion_matrix
from sklearn.model_selection import GroupKFold, RepeatedStratifiedKFold
from sklearn.neighbors import NearestNeighbors
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

import prosody
import silence
from extract import CACHE, OUT, choose_clips, load_config, panel_clips

warnings.filterwarnings("ignore")
F = prosody.FEATURES
SEED = 0
N_SHUFFLE = 10
K_NN = 15
MIN_SPEAKERS = 30          # below this, a language gets a reliability caveat
SPEAKER_CLIPS = 5          # clips averaged per speaker

# Validated categorical palette (dataviz validator, all-pairs, with marker shapes as
# secondary encoding). Assigned in languages.yaml order, never cycled by rank.
PALETTE5 = ["#2a78d6", "#eda100", "#008300", "#4a3aa7", "#e34948"]
PALETTE8 = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"]
MARKERS = ["o", "s", "^", "D", "v", "*", "P", "X"]
# 4 family colours: validated all-pairs (dataviz validator)
FAMILY_PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#4a3aa7"]
INK, MUTED = "#0b0b0b", "#52514e"
plt.rcParams.update({"font.size": 16, "axes.titlesize": 20, "axes.labelsize": 17,
                     "xtick.labelsize": 15, "ytick.labelsize": 15, "legend.fontsize": 15,
                     "axes.edgecolor": MUTED, "axes.labelcolor": INK, "text.color": INK,
                     "xtick.color": MUTED, "ytick.color": MUTED, "figure.facecolor": "white",
                     "axes.spines.top": False, "axes.spines.right": False})

cfg = load_config()
LANGS = [L["name"] for L in cfg["languages"]]
FAMILY = {L["name"]: L["family"] for L in cfg["languages"]}
FAMILIES = list(dict.fromkeys(FAMILY[l] for l in LANGS))
# Up to 5 languages: a palette validated for scatter plots. Beyond 5 no palette separates
# every pair, so each language also gets its own marker shape (secondary encoding).
PALETTE = PALETTE5 if len(LANGS) <= 5 else PALETTE8
COLOR = {l: PALETTE[i % len(PALETTE)] for i, l in enumerate(LANGS)}
MARK = {l: MARKERS[i % len(MARKERS)] for i, l in enumerate(LANGS)}
FCOLOR = {f: FAMILY_PALETTE[i % len(FAMILY_PALETTE)] for i, f in enumerate(FAMILIES)}
R = {"languages": LANGS, "families": FAMILY, "features": F}


def savefig(fig, name):
    fig.savefig(os.path.join(OUT, name), dpi=200, bbox_inches="tight")
    plt.close(fig)


# --------------------------------------------------------------------------- data
feat = pd.read_csv(CACHE)
feat = feat[feat["ok"] == True]
folder = {L["name"]: L["folder"] for L in cfg["languages"]}

clip_rows = []
for L in cfg["languages"]:
    keys = {p for _, p in choose_clips(L["folder"], 300)}
    clip_rows.append(feat[(feat.language == L["name"]) & feat.path.isin(keys)])
clips = pd.concat(clip_rows, ignore_index=True)

spk_rows, spk_members = [], {}
for L in cfg["languages"]:
    pc = panel_clips(L["folder"])
    pan = feat[(feat.language == L["name"]) & feat.path.isin({p for _, p in pc})]
    for cid, g in pan.sort_values("path").groupby("client_id"):
        if len(g) >= SPEAKER_CLIPS:
            g = g.head(SPEAKER_CLIPS)
            spk_rows.append({"language": L["name"], "client_id": cid, **g[F].mean().to_dict()})
            spk_members[cid] = list(g["path"])
speakers = pd.DataFrame(spk_rows)

scaler = StandardScaler().fit(clips[F].values)
Xc = scaler.transform(clips[F].values)
Xs = scaler.transform(speakers[F].values)
yc, ys = clips.language.values, speakers.language.values
gc = clips.client_id.values

# ------------------------------------------------------------ speakers per language
spk_table = []
for l in LANGS:
    n_spk = clips[clips.language == l].client_id.nunique()
    spk_table.append({"language": l, "family": FAMILY[l],
                      "clips": int((clips.language == l).sum()), "speakers": int(n_spk),
                      "panel_speakers": int((speakers.language == l).sum()),
                      "caveat": n_spk < MIN_SPEAKERS})
R["speakers"] = spk_table
print(pd.DataFrame(spk_table).to_string(index=False))


# ------------------------------------------------------------------ classifiers
def models():
    return {
        "logistic_regression": make_pipeline(
            StandardScaler(), LogisticRegression(max_iter=5000, class_weight="balanced", C=1.0)),
        "random_forest": RandomForestClassifier(
            n_estimators=400, min_samples_leaf=2, class_weight="balanced",
            random_state=SEED, n_jobs=-1),
    }


def cv_predict(model, X, y, splits):
    pred = np.empty(len(y), dtype=object)
    for tr, te in splits:
        m = model.fit(X[tr], y[tr])
        pred[te] = m.predict(X[te])
    return pred


def evaluate(X, y, groups, level):
    """Speaker-disjoint CV. Clip level: GroupKFold by client_id.
    Speaker level: one row per speaker, so stratified folds are speaker-disjoint."""
    rng = np.random.default_rng(SEED)
    if level == "clip":
        splits = list(GroupKFold(n_splits=5).split(X, y, groups))
    else:
        splits = list(RepeatedStratifiedKFold(n_splits=5, n_repeats=1, random_state=SEED).split(X, y))
    counts = pd.Series(y).value_counts()
    out = {"n": int(len(y)), "chance_majority": float(counts.max() / len(y)),
           "chance_balanced": 1.0 / len(counts)}
    preds = {}
    for name, model in models().items():
        pred = cv_predict(model, X, y, splits)
        preds[name] = pred
        # shuffled-label baseline: permute language labels across SPEAKERS
        shuf_acc, shuf_bal = [], []
        spk = pd.Series(y, index=groups).groupby(level=0).first()
        for _ in range(N_SHUFFLE):
            perm = dict(zip(spk.index, rng.permutation(spk.values)))
            ysh = np.array([perm[g] for g in groups])
            p = cv_predict(model, X, ysh, splits)
            shuf_acc.append(accuracy_score(ysh, p))
            shuf_bal.append(balanced_accuracy_score(ysh, p))
        out[name] = {"accuracy": float(accuracy_score(y, pred)),
                     "balanced_accuracy": float(balanced_accuracy_score(y, pred)),
                     "shuffled_accuracy_mean": float(np.mean(shuf_acc)),
                     "shuffled_balanced_mean": float(np.mean(shuf_bal)),
                     "shuffled_balanced_max": float(np.max(shuf_bal))}
    return out, preds, splits


print("\nClassifying clips (speaker-disjoint GroupKFold)...")
R["clip_classifier"], clip_preds, clip_splits = evaluate(clips[F].values, yc, gc, "clip")
print(json.dumps(R["clip_classifier"], indent=1))
print("\nClassifying speaker averages...")
R["speaker_classifier"], spk_preds, _ = evaluate(speakers[F].values, ys, speakers.client_id.values, "speaker")
print(json.dumps(R["speaker_classifier"], indent=1))


def plot_confusion(y, pred, title, name):
    cm = confusion_matrix(y, pred, labels=LANGS, normalize="true")
    fig, ax = plt.subplots(figsize=(9, 8))
    ax.imshow(cm, cmap="Blues", vmin=0, vmax=1)
    for i in range(len(LANGS)):
        for j in range(len(LANGS)):
            ax.text(j, i, f"{cm[i, j]:.0%}", ha="center", va="center", fontsize=16,
                    color="white" if cm[i, j] > 0.55 else INK)
    ax.set_xticks(range(len(LANGS)), LANGS, rotation=30, ha="right")
    ax.set_yticks(range(len(LANGS)), LANGS)
    ax.set_xlabel("Predicted language")
    ax.set_ylabel("True language")
    ax.set_title(title, loc="left")
    ax.spines[:].set_visible(False)
    savefig(fig, name)
    return cm


best_clip = max(("logistic_regression", "random_forest"),
                key=lambda m: R["clip_classifier"][m]["balanced_accuracy"])
best_spk = max(("logistic_regression", "random_forest"),
               key=lambda m: R["speaker_classifier"][m]["balanced_accuracy"])
cm_clip = plot_confusion(yc, clip_preds[best_clip],
                         f"Which language? Single clips ({best_clip.replace('_', ' ')})", "confusion_clips.png")
cm_spk = plot_confusion(ys, spk_preds[best_spk],
                        f"Which language? Speaker averages ({best_spk.replace('_', ' ')})", "confusion_speakers.png")
R["confusion_clips"] = {"model": best_clip, "labels": LANGS, "matrix": cm_clip.round(4).tolist()}
R["confusion_speakers"] = {"model": best_spk, "labels": LANGS, "matrix": cm_spk.round(4).tolist()}

# ----------------------------------------------------------- neighbours & siblings
def speaker_balanced_centroids(X, lang, groups):
    df = pd.DataFrame(X, columns=F)
    df["language"], df["g"] = lang, groups
    return df.groupby(["language", "g"])[F].mean().groupby("language").mean().reindex(LANGS)


def distances(C):
    D = np.sqrt(((C.values[:, None, :] - C.values[None, :, :]) ** 2).sum(-1))
    return pd.DataFrame(D, index=C.index, columns=C.index)


def neighbours(D):
    out = {}
    for l in LANGS:
        d = D.loc[l].drop(l).sort_values()
        out[l] = [{"language": o, "distance": float(v), "similarity": float(1 / (1 + v))}
                  for o, v in d.items()]
    return out


def sibling_table(D):
    rows = []
    for a, b in cfg.get("sibling_pairs", []):
        if a not in LANGS or b not in LANGS:
            continue
        top2 = lambda l: list(D.loc[l].drop(l).sort_values().index[:2])
        top1 = lambda l: D.loc[l].drop(l).idxmin()
        rows.append({"pair": f"{a}-{b}", "a_in_b_top2": a in top2(b), "b_in_a_top2": b in top2(a),
                     "a_top1_is_b": top1(a) == b, "b_top1_is_a": top1(b) == a})
        rows[-1]["pass_top2"] = rows[-1]["a_in_b_top2"] and rows[-1]["b_in_a_top2"]
        rows[-1]["pass_top1"] = rows[-1]["a_top1_is_b"] and rows[-1]["b_top1_is_a"]
    return rows


def bootstrap_siblings(X, lang, groups, n=500):
    """Resample speakers within each language; how often does each pair pass?"""
    rng = np.random.default_rng(SEED)
    df = pd.DataFrame(X, columns=F)
    df["language"], df["g"] = lang, groups
    spk_means = df.groupby(["language", "g"])[F].mean().reset_index()
    by_lang = {l: spk_means[spk_means.language == l][F].values for l in LANGS}
    hits = {}
    for _ in range(n):
        C = pd.DataFrame({l: by_lang[l][rng.integers(0, len(by_lang[l]), len(by_lang[l]))].mean(0)
                          for l in LANGS}, index=F).T
        for r in sibling_table(distances(C)):
            h = hits.setdefault(r["pair"], {"top2": 0, "top1": 0})
            h["top2"] += r["pass_top2"]
            h["top1"] += r["pass_top1"]
    return {k: {"top2": v["top2"] / n, "top1": v["top1"] / n} for k, v in hits.items()}


for level, X, lang, groups in [("clips", Xc, yc, gc), ("speakers", Xs, ys, speakers.client_id.values)]:
    C = speaker_balanced_centroids(X, lang, groups)
    D = distances(C)
    R[f"centroid_distances_{level}"] = D.round(4).to_dict()
    R[f"neighbours_{level}"] = neighbours(D)
    R[f"siblings_{level}"] = sibling_table(D)
    R[f"siblings_bootstrap_{level}"] = bootstrap_siblings(X, lang, groups)
    print(f"\nCentroid distances ({level}):\n{D.round(2).to_string()}")
    print(f"Sibling validation ({level}):", json.dumps(R[f'siblings_{level}'], indent=1))
    print(f"Bootstrap pass rates ({level}):", R[f"siblings_bootstrap_{level}"])

# symmetric confusion as a second, classifier-based view of closeness
sym = (cm_clip + cm_clip.T) / 2
R["confusion_neighbours_clips"] = {
    l: [LANGS[j] for j in np.argsort(-np.where(np.arange(len(LANGS)) == i, -1, sym[i]))[:2]]
    for i, l in enumerate(LANGS)}

# chance for the sibling test with K languages
K = len(LANGS)
R["sibling_chance"] = {"top2_one_direction": 2 / (K - 1), "top1_one_direction": 1 / (K - 1)}

# -------------------------------------------------------------------- dendrogram
for level in ["clips", "speakers"]:
    D = pd.DataFrame(R[f"centroid_distances_{level}"]).reindex(index=LANGS, columns=LANGS)
    Z = linkage(squareform(D.values, checks=False), method="average")
    fig, ax = plt.subplots(figsize=(max(10, 1.6 * len(LANGS)), 6.5))
    dn = dendrogram(Z, labels=LANGS, ax=ax, color_threshold=0, above_threshold_color=MUTED,
                    leaf_font_size=17, leaf_rotation=30 if len(LANGS) > 5 else 0)
    if len(LANGS) > 5:
        for t in ax.get_xticklabels():
            t.set_ha("right")
    for t in ax.get_xticklabels():
        t.set_color(FCOLOR[FAMILY[t.get_text()]])
        t.set_fontweight("bold")
    ax.set_ylabel("Prosodic distance")
    ax.set_title(f"Languages clustered by rhythm ({'speaker averages' if level == 'speakers' else 'clips'})\n"
                 "label color = language family", loc="left")
    handles = [plt.Line2D([], [], color=FCOLOR[f], lw=6) for f in FAMILIES]
    ax.legend(handles, FAMILIES, frameon=False, loc="upper center",
              bbox_to_anchor=(0.5, -0.28 if len(LANGS) > 5 else -0.12), ncol=len(FAMILIES))
    ax.spines[["left"]].set_color(MUTED)
    savefig(fig, f"dendrogram_{level}.png")
    R[f"dendrogram_{level}"] = {"order": dn["ivl"], "linkage": Z.round(4).tolist()}

# ---------------------------------------------------------------- feature importance
print("\nFeature importance...")
imp = np.zeros(len(F))
for tr, te in clip_splits:
    m = models()["random_forest"].fit(clips[F].values[tr], yc[tr])
    pi = permutation_importance(m, clips[F].values[te], yc[te], n_repeats=5,
                                random_state=SEED, scoring="balanced_accuracy", n_jobs=-1)
    imp += pi.importances_mean / len(clip_splits)


def eta_squared(X, y):
    out = []
    for j in range(X.shape[1]):
        v = X[:, j]
        ss_t = ((v - v.mean()) ** 2).sum()
        ss_b = sum(((y == l).sum() * (v[y == l].mean() - v.mean()) ** 2) for l in np.unique(y))
        out.append(ss_b / ss_t)
    return np.array(out)


eta = eta_squared(Xs, ys)
fi = pd.DataFrame({"feature": F, "permutation_importance": imp, "eta_squared_speakers": eta}) \
    .sort_values("permutation_importance", ascending=False)
R["feature_importance"] = fi.round(4).to_dict(orient="records")
print(fi.round(3).to_string(index=False))
LABEL = {"f0_sd": "Pitch spread (SD)", "f0_range": "Pitch range (5-95%)", "f0_slope": "Overall pitch slope",
         "f0_reversal_rate": "Pitch reversals / s", "f0_final_slope": "Final pitch slope",
         "int_sd": "Loudness spread", "int_peak_rate": "Loudness peaks / s",
         "npvi_nuclei": "Rhythm variability (nPVI)", "pct_voiced": "% voiced",
         "voiced_cv": "Voiced-stretch variability", "unvoiced_cv": "Unvoiced-stretch variability",
         "nuclei_rate": "Syllable-like beats / s", "pause_rate": "Pauses / s",
         "pause_mean": "Mean pause length", "silence_prop": "Share of silence"}
R["feature_labels"] = LABEL
fig, ax = plt.subplots(figsize=(11, 8))
fs = fi.iloc[::-1]
ax.barh([LABEL[f] for f in fs.feature], fs.permutation_importance, color=PALETTE[0], height=0.7)
ax.axvline(0, color=MUTED, lw=1)
ax.set_xlabel("Drop in balanced accuracy when shuffled")
ax.set_title("Which rhythm features tell languages apart?", loc="left")
ax.grid(axis="x", color="#e6e5e0")
ax.set_axisbelow(True)
savefig(fig, "feature_importance.png")

# ---------------------------------------------------------------- UMAP helpers
def fit_umap(X, n_neighbors):
    return umap.UMAP(n_neighbors=n_neighbors, min_dist=0.3, random_state=SEED).fit(X)


def knn_place(X_ref, emb_ref, X_new, k=K_NN):
    """Browser placement rule: weighted kNN average of reference 2D positions."""
    nn = NearestNeighbors(n_neighbors=k).fit(X_ref)
    d, idx = nn.kneighbors(X_new)
    w = 1.0 / (d + 1e-6)
    return (emb_ref[idx] * w[..., None]).sum(1) / w.sum(1, keepdims=True), idx


# ------------------------------------------------------------- held-out siblings
def held_out(level, held, expect):
    if level == "clips":
        df, groups = clips, clips.client_id.values
    else:
        df, groups = speakers, speakers.client_id.values
    tr = (df.language != held).values
    sc = StandardScaler().fit(df[F].values[tr])
    Xtr, Xte = sc.transform(df[F].values[tr]), sc.transform(df[F].values[~tr])
    ytr = df.language.values[tr]
    um = fit_umap(Xtr, 15 if level == "clips" else 10)
    e_tr, e_te = um.embedding_, um.transform(Xte)
    others = [l for l in LANGS if l != held]
    # nearest language centroid (speaker-balanced) in full feature space and in 2D
    Cf = speaker_balanced_centroids(np.vstack([Xtr, Xte]), np.r_[ytr, [held] * (~tr).sum()],
                                    np.r_[groups[tr], groups[~tr]])
    d_full = {l: float(np.linalg.norm(Cf.loc[held] - Cf.loc[l])) for l in others}
    E = pd.DataFrame(np.vstack([e_tr, e_te]), columns=["x", "y"])
    E["language"], E["g"] = np.r_[ytr, [held] * (~tr).sum()], np.r_[groups[tr], groups[~tr]]
    C2 = E.groupby(["language", "g"])[["x", "y"]].mean().groupby("language").mean()
    d_2d = {l: float(np.linalg.norm(C2.loc[held] - C2.loc[l])) for l in others}
    # kNN vote of each held-out item among the training items
    _, idx = NearestNeighbors(n_neighbors=K_NN).fit(Xtr).kneighbors(Xte)
    votes = pd.Series([pd.Series(ytr[i]).value_counts().idxmax() for i in idx])
    share = float((votes == expect).mean())
    # base rate: share of training items that are the expected sibling
    base = float((ytr == expect).mean())
    return {"held_out": held, "expect_nearest": expect, "level": level,
            "nearest_full": min(d_full, key=d_full.get), "nearest_2d": min(d_2d, key=d_2d.get),
            "distances_full": d_full, "distances_2d": d_2d,
            "knn_vote_share_expected": share, "knn_vote_distribution": votes.value_counts(normalize=True).round(3).to_dict(),
            "expected_share_of_training": base,
            "pass": min(d_full, key=d_full.get) == expect and min(d_2d, key=d_2d.get) == expect,
            "embedding_train": e_tr, "embedding_test": e_te, "train_lang": ytr}


print("\nHeld-out sibling tests...")
R["held_out_sibling"] = []
ho_plots = []
for t in cfg.get("held_out_sibling_tests", []):
    if t["held_out"] not in LANGS or t["expect_nearest"] not in LANGS:
        continue
    for level in ["clips", "speakers"]:
        r = held_out(level, t["held_out"], t["expect_nearest"])
        ho_plots.append(r)
        R["held_out_sibling"].append({k: v for k, v in r.items()
                                      if k not in ("embedding_train", "embedding_test", "train_lang")})
        print(f"  {level}: hold out {r['held_out']} -> nearest (full) {r['nearest_full']}, "
              f"nearest (2D) {r['nearest_2d']}, kNN votes for {r['expect_nearest']}: "
              f"{r['knn_vote_share_expected']:.0%} (base rate {r['expected_share_of_training']:.0%})")

fig, axes = plt.subplots(2, 2, figsize=(16, 13))
for ax, r in zip(axes.flat, ho_plots):
    for l in LANGS:
        m = r["train_lang"] == l
        if m.any():
            ax.scatter(*r["embedding_train"][m].T, s=14 if r["level"] == "clips" else 40, c=COLOR[l],
                       marker=MARK[l], alpha=0.35, label=l, linewidths=0)
    ax.scatter(*r["embedding_test"].T, s=60 if r["level"] == "clips" else 120, c=COLOR[r["held_out"]],
               marker=MARK[r["held_out"]], edgecolors="white", linewidths=1.2,
               label=f"{r['held_out']} (projected in)")
    verdict = "PASS" if r["pass"] else "FAIL"
    lvl = "single clips" if r["level"] == "clips" else "speaker averages"
    ax.set_title(f"Hold out {r['held_out']}, {lvl}  [{verdict}]\n"
                 f"nearest on map: {r['nearest_2d']}   nearest in full features: {r['nearest_full']}",
                 loc="left", fontsize=16)
    ax.set_xticks([]); ax.set_yticks([])
fig.suptitle("Held-out sibling test: map built without one language, then that language projected in\n"
             "(large outlined marks = the held-out language; faint marks = languages the map was built on)",
             x=0.01, ha="left", fontsize=19)
handles = [plt.Line2D([], [], marker=MARK[l], color=COLOR[l], ls="", markersize=11, label=l) for l in LANGS]
fig.legend(handles=handles, loc="lower center", ncol=len(LANGS), frameon=False, fontsize=16)
fig.tight_layout(rect=(0, 0.04, 1, 1))
savefig(fig, "held_out_siblings.png")

# held-out family test only when it is meaningful
hf = cfg.get("held_out_family")
fam_langs = [l for l in LANGS if FAMILY[l] == hf]
other_fams = {FAMILY[l] for l in LANGS if FAMILY[l] != hf}
if cfg.get("run_held_out_family", False) and hf and len(fam_langs) >= 2 and len(other_fams) >= 2:
    tr = ~clips.language.isin(fam_langs).values
    sc = StandardScaler().fit(clips[F].values[tr])
    Xtr, Xte = sc.transform(clips[F].values[tr]), sc.transform(clips[F].values[~tr])
    um = fit_umap(Xtr, 15)
    e_te = um.transform(Xte)
    E = pd.DataFrame(np.vstack([um.embedding_, e_te]), columns=["x", "y"])
    E["language"] = np.r_[clips.language.values[tr], clips.language.values[~tr]]
    C2 = E.groupby("language")[["x", "y"]].mean()
    res = {}
    for l in fam_langs:
        d = {o: float(np.linalg.norm(C2.loc[l] - C2.loc[o])) for o in C2.index if o != l}
        res[l] = {"nearest": min(d, key=d.get), "distances": d}
    R["held_out_family"] = {"family": hf, "results": res,
                            "pass": all(FAMILY[v["nearest"]] == hf for v in res.values())}
else:
    R["held_out_family"] = {"family": hf, "skipped": True,
                            "reason": "deferred until more families are present (set run_held_out_family: true "
                                      "in languages.yaml once Tajik and Balti are added)"}
print("Held-out family test:", R["held_out_family"])

# ------------------------------------------------------- recording-condition check
print("\nRecording-condition check (silence-only features)...")
sil_in = clips[["language", "path", "client_id"]].copy()
sil_in["folder"] = sil_in.language.map(folder)
sil = silence.run(sil_in)
sil = sil.merge(clips[["language", "path"]], on=["language", "path"])
sil = sil[sil.sil_ok == True].reset_index(drop=True)
Xsil = sil[silence.SIL_FEATURES].values.astype(float)
R["silence_classifier"], sil_preds, _ = evaluate(Xsil, sil.language.values, sil.client_id.values, "clip")
# same clips, prosody only, for a like-for-like comparison
pro_same = clips.set_index(["language", "path"]).loc[list(zip(sil.language, sil.path)), F].values
R["prosody_on_silence_subset"], _, _ = evaluate(pro_same, sil.language.values, sil.client_id.values, "clip")
# prosody without the pause/silence features that could absorb recording conditions
F_np = [f for f in F if f not in ("pause_rate", "pause_mean", "silence_prop", "unvoiced_cv", "int_sd")]
R["prosody_no_pause_features"], _, _ = evaluate(clips[F_np].values, yc, gc, "clip")
R["prosody_no_pause_features"]["features"] = F_np
sb = R["silence_classifier"][best_clip]["balanced_accuracy"]
pb = R["prosody_on_silence_subset"][best_clip]["balanced_accuracy"]
# Flag if background noise alone beats chance by more than 15 points.
R["confound_flag"] = bool(sb > R["silence_classifier"]["chance_balanced"] + 0.15)
print(f"  silence-only balanced acc {sb:.2f} vs prosody {pb:.2f} "
      f"(chance {R['silence_classifier']['chance_balanced']:.2f}); confound flag = {R['confound_flag']}")
print(f"  prosody without pause/silence/loudness-spread features: "
      f"{R['prosody_no_pause_features'][best_clip]['balanced_accuracy']:.2f}")

# Does prosody carry language information BEYOND recording conditions?
# Remove from each prosody feature what the silence features predict (out-of-fold linear
# regression, never using language labels), then classify and compare siblings again.
from sklearn.linear_model import LinearRegression
from sklearn.model_selection import cross_val_predict
Xp_sub = StandardScaler().fit_transform(pro_same)
Xsil_s = StandardScaler().fit_transform(Xsil)
gk = list(GroupKFold(n_splits=5).split(Xsil_s, groups=sil.client_id.values))
explained = cross_val_predict(LinearRegression(), Xsil_s, Xp_sub, cv=gk)
resid = Xp_sub - explained
R["residual_r2_by_feature"] = {f: float(1 - resid[:, j].var() / Xp_sub[:, j].var()) for j, f in enumerate(F)}
R["prosody_residual_classifier"], _, _ = evaluate(resid, sil.language.values, sil.client_id.values, "clip")
R["prosody_plus_silence_classifier"], _, _ = evaluate(np.hstack([Xp_sub, Xsil_s]), sil.language.values,
                                                       sil.client_id.values, "clip")
Dr = distances(speaker_balanced_centroids(resid, sil.language.values, sil.client_id.values))
R["centroid_distances_residual"] = Dr.round(4).to_dict()
R["siblings_residual"] = sibling_table(Dr)
R["siblings_bootstrap_residual"] = bootstrap_siblings(resid, sil.language.values, sil.client_id.values)
print(f"  prosody after removing noise-predictable part: balanced acc "
      f"{R['prosody_residual_classifier'][best_clip]['balanced_accuracy']:.2f}; "
      f"prosody+noise {R['prosody_plus_silence_classifier'][best_clip]['balanced_accuracy']:.2f}")
print("  residual centroid distances:\n" + Dr.round(2).to_string())
print("  residual siblings:", R["siblings_residual"], R["siblings_bootstrap_residual"])
print("  share of each prosody feature predictable from noise (R2):",
      {k: round(v, 2) for k, v in R["residual_r2_by_feature"].items()})

# accuracy summary figure
fig, ax = plt.subplots(figsize=(12, 7))
bars = [("Prosody, single clips", R["clip_classifier"][best_clip]["balanced_accuracy"], "#2a78d6"),
        ("Prosody, speaker averages", R["speaker_classifier"][best_spk]["balanced_accuracy"], "#184f95"),
        ("Prosody with noise-predictable\npart removed (clips)", R["prosody_residual_classifier"][best_clip]["balanced_accuracy"], "#5598e7"),
        ("Background noise only\n(recording check)", sb, "#9a9890"),
        ("Shuffled labels (clips)", R["clip_classifier"][best_clip]["shuffled_balanced_mean"], "#c9c8c1")]
ax.barh([b[0] for b in bars][::-1], [b[1] for b in bars][::-1], color=[b[2] for b in bars][::-1], height=0.65)
for i, b in enumerate(bars[::-1]):
    ax.text(b[1] + 0.01, i, f"{b[1]:.0%}", va="center", fontsize=17, color=INK)
ax.axvline(1 / len(LANGS), color=INK, ls="--", lw=1.5)
ax.text(1 / len(LANGS) + 0.008, -0.62, f"chance {1 / len(LANGS):.0%}", fontsize=15, color=INK, va="bottom")
ax.set_xlim(0, 1)
ax.set_xlabel("Balanced accuracy (speaker-disjoint cross-validation)")
ax.set_title("Can rhythm alone tell these languages apart?", loc="left", pad=16)
savefig(fig, "accuracy_summary.png")

# ------------------------------------------------------------------ final maps
print("\nFinal UMAP maps...")
um_c = fit_umap(Xc, 15)
um_s = fit_umap(Xs, 10)
emb_c, emb_s = um_c.embedding_, um_s.embedding_


# how faithful is the browser's kNN placement? leave-one-out on the clip map
def knn_fidelity(X, emb, k=K_NN):
    nn = NearestNeighbors(n_neighbors=k + 1).fit(X)
    d, idx = nn.kneighbors(X)
    d, idx = d[:, 1:], idx[:, 1:]
    w = 1 / (d + 1e-6)
    est = (emb[idx] * w[..., None]).sum(1) / w.sum(1, keepdims=True)
    err = np.linalg.norm(est - emb, axis=1)
    spread = np.linalg.norm(emb - emb.mean(0), axis=1).mean()
    return float(np.median(err) / spread)


R["knn_placement_error"] = {"clips": knn_fidelity(Xc, emb_c), "speakers": knn_fidelity(Xs, emb_s, 10)}
print("  kNN placement median error / map spread:", R["knn_placement_error"])

pd.DataFrame({"language": yc, "path": clips.path, "client_id": clips.client_id,
              "x": emb_c[:, 0], "y": emb_c[:, 1]}).to_csv(os.path.join(OUT, "umap_clips.csv"), index=False)
pd.DataFrame({"language": ys, "client_id": speakers.client_id, "x": emb_s[:, 0], "y": emb_s[:, 1],
              "members": ["|".join(spk_members[c]) for c in speakers.client_id]}) \
    .to_csv(os.path.join(OUT, "umap_speakers.csv"), index=False)
json.dump({"features": F, "mean": scaler.mean_.tolist(), "scale": scaler.scale_.tolist()},
          open(os.path.join(OUT, "scaler.json"), "w"), indent=1)

for level, emb, lab, s in [("clips", emb_c, yc, 16), ("speakers", emb_s, ys, 70)]:
    fig, ax = plt.subplots(figsize=(12, 9))
    for l in LANGS:
        m = lab == l
        ax.scatter(*emb[m].T, s=s, c=COLOR[l], marker=MARK[l], alpha=0.7, edgecolors="white",
                   linewidths=0.4, label=f"{l} ({FAMILY[l]})")
        cx, cy = np.median(emb[m], axis=0)
        ax.text(cx, cy, l, fontsize=18, fontweight="bold", ha="center", va="center", color=INK,
                bbox=dict(boxstyle="round,pad=0.25", fc="white", ec=COLOR[l], alpha=0.85))
    ax.set_xticks([]); ax.set_yticks([])
    ax.spines[:].set_visible(False)
    ax.set_title(f"The cadence map: {'single clips' if level == 'clips' else 'speaker averages (5 clips each)'}",
                 loc="left")
    ax.legend(frameon=False, loc="upper left", bbox_to_anchor=(1, 1))
    savefig(fig, f"cadence_map_{level}.png")

json.dump(R, open(os.path.join(OUT, "results.json"), "w"), indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o))
print("\nWrote outputs/results.json and figures.")
