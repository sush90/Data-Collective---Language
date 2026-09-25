"""Extract prosodic fingerprints for every language in languages.yaml.

Usage:
  python extract.py                # up to 300 clips per language
  python extract.py --per-lang 50  # pilot

Results are cached in outputs/features.csv (one row per clip, including
failed clips with their drop reason), so re-runs only process new clips.
"""
import argparse
import os
import warnings

import librosa
import numpy as np
import pandas as pd
import yaml
from joblib import Parallel, delayed

import prosody

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "outputs")
CACHE = os.path.join(OUT, "features.csv")
MAX_PER_SPEAKER = 20
SEED = 0


def load_config():
    with open(os.path.join(ROOT, "languages.yaml")) as f:
        return yaml.safe_load(f)


def choose_clips(folder, n_total):
    """Round-robin over speakers: as many speakers as possible, max 20 clips each.
    The first full-size choice is frozen in data/<folder>/sample.tsv for reproducibility."""
    d = os.path.join(ROOT, "data", folder)
    frozen = os.path.join(d, "sample.tsv")
    if os.path.exists(frozen):
        s = pd.read_csv(frozen, sep="\t", dtype=str)
        return list(zip(s["client_id"], s["path"]))[:n_total]
    val = pd.read_csv(os.path.join(d, "validated.tsv"), sep="\t", quoting=3,
                      usecols=["client_id", "path"], dtype=str)
    present = set(os.listdir(os.path.join(d, "clips")))
    val = val[val["path"].isin(present)].sample(frac=1.0, random_state=SEED)
    groups = {c: list(g["path"])[:MAX_PER_SPEAKER] for c, g in val.groupby("client_id")}
    order = sorted(groups)
    chosen = []
    while len(chosen) < n_total and any(groups[c] for c in order):
        for c in order:
            if groups[c] and len(chosen) < n_total:
                chosen.append((c, groups[c].pop(0)))
    if n_total >= 300:
        pd.DataFrame(chosen, columns=["client_id", "path"]).to_csv(frozen, sep="\t", index=False)
    return chosen


def panel_clips(folder):
    """(client_id, path) pairs from data/<folder>/panel.tsv, if a speaker panel exists."""
    f = os.path.join(ROOT, "data", folder, "panel.tsv")
    if not os.path.exists(f):
        return []
    pan = pd.read_csv(f, sep="\t", dtype=str)
    return list(zip(pan["client_id"], pan["path"]))


def process(lang, folder, client_id, path):
    row = {"language": lang, "path": path, "client_id": client_id}
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            y, _ = librosa.load(os.path.join(ROOT, "data", folder, "clips", path),
                                sr=prosody.SR, mono=True)
        feats, info = prosody.analyze(y)
        ok, reason = prosody.passes_quality(feats, info)
        row.update(feats or {})
        row.update({"ok": ok, "reason": reason, "clip_sec": len(y) / prosody.SR,
                    "n_voiced": (info or {}).get("n_voiced", 0)})
    except Exception as e:  # extraction failure is a quality-gate drop, not a crash
        row.update({"ok": False, "reason": f"error: {type(e).__name__}"})
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-lang", type=int, default=300)
    ap.add_argument("--jobs", type=int, default=-1)
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    cfg = load_config()
    cache = pd.read_csv(CACHE) if os.path.exists(CACHE) else pd.DataFrame(columns=["path"])
    done = set(zip(cache.get("language", []), cache["path"]))

    todo, wanted = [], []
    for L in cfg["languages"]:
        seen = set()
        for cid, p in choose_clips(L["folder"], a.per_lang) + panel_clips(L["folder"]):
            if p in seen:
                continue
            seen.add(p)
            wanted.append(p)
            if (L["name"], p) not in done:
                todo.append((L["name"], L["folder"], cid, p))
                done.add((L["name"], p))
    print(f"{len(wanted)} clips requested, {len(todo)} new to process")
    if todo:
        rows = Parallel(n_jobs=a.jobs, verbose=5)(delayed(process)(*t) for t in todo)
        cache = pd.concat([cache, pd.DataFrame(rows)], ignore_index=True)
        cache.to_csv(CACHE, index=False)

    sample = {(L["name"], p) for L in cfg["languages"] for _, p in choose_clips(L["folder"], a.per_lang)}
    df = cache[[k in sample for k in zip(cache["language"], cache["path"])]]
    rep = df.groupby("language").agg(clips=("path", "size"), kept=("ok", "sum"),
                                      speakers_kept=("client_id", lambda s: s[df.loc[s.index, "ok"] == True].nunique()))
    rep["dropped"] = rep["clips"] - rep["kept"]
    print("\nQuality gate per language (clip sample):")
    print(rep.to_string())
    drops = df[df["ok"] != True].groupby(["language", "reason"]).size()
    if len(drops):
        print("\nDrop reasons:")
        print(drops.to_string())
    for L in cfg["languages"]:
        pc = panel_clips(L["folder"])
        if pc:
            pan = cache[(cache["language"] == L["name"]) & cache["path"].isin({p for _, p in pc})
                        & (cache["ok"] == True)]
            full = (pan.groupby("client_id").size() >= 5).sum()
            print(f"Speaker panel {L['name']}: {full} of {len(set(c for c, _ in pc))} speakers have >= 5 good clips")


if __name__ == "__main__":
    main()
