"""Extract a speaker-balanced subsample from Common Voice .tar.gz archives.

Never unpacks a full dataset. For each archive:
  pass 1: read only the TSV files (validated.tsv etc.)
  pass 2: extract only the selected clips (default 300, max 20 per speaker)

Usage:
  python ingest.py                      # every *.tar.gz in data/_archives and ~/Downloads
  python ingest.py path/to/file.tar.gz  # specific archives
  python ingest.py path/to/cv-corpus-xx/<code>   # an already-extracted folder
  python ingest.py --delete-archive ... # remove each archive after a successful extract
"""
import argparse
import glob
import io
import os
import re
import shutil
import tarfile

import pandas as pd

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
SEED = 0


def select_clips(df, n_total, per_speaker):
    """Round-robin across speakers so we spread over as many speakers as possible."""
    df = df.sample(frac=1.0, random_state=SEED)
    groups = {cid: list(g["path"])[:per_speaker] for cid, g in df.groupby("client_id")}
    order = sorted(groups, key=lambda c: -len(groups[c]))
    chosen, i = [], 0
    while len(chosen) < n_total and any(groups[c] for c in order):
        for c in order:
            if groups[c] and len(chosen) < n_total:
                chosen.append(groups[c].pop(0))
        i += 1
    return set(chosen)


def splits_as_validated(tsvs):
    """Regional-variant releases (e.g. Rioplatense Spanish) ship only train/dev/test.
    Common Voice fills those splits from validated clips only, so their union stands in
    for validated.tsv."""
    parts = [tsvs[n] for n in ("train.tsv", "dev.tsv", "test.tsv") if n in tsvs]
    if not parts:
        raise RuntimeError("no validated.tsv and no train/dev/test splits found")
    df = pd.concat([pd.read_csv(io.BytesIO(b), sep="\t", quoting=3, dtype=str) for b in parts])
    buf = io.BytesIO()
    df.drop_duplicates("path").to_csv(buf, sep="\t", index=False)
    return buf.getvalue()


def ingest(archive, n_total, per_speaker, code=None):
    """code names data/<code>; by default it is the archive's language folder."""
    m = re.search(r"cv-corpus-[\d.]+-[\d-]+-([A-Za-z-]+)\.tar\.gz", os.path.basename(archive))
    fixed = code
    code = code or (m.group(1) if m else None)

    tsvs = {}
    with tarfile.open(archive, "r|gz") as tf:
        for member in tf:
            if member.isfile() and member.name.endswith(".tsv"):
                parts = member.name.split("/")
                if not fixed and len(parts) > 1:
                    code = parts[-2]
                tsvs[parts[-1]] = tf.extractfile(member).read()
    if not code:
        raise RuntimeError(f"{archive}: files are not in a language folder; pass code=")
    if "validated.tsv" not in tsvs:
        tsvs["validated.tsv"] = splits_as_validated(tsvs)

    out = os.path.join(DATA, code)
    os.makedirs(os.path.join(out, "clips"), exist_ok=True)
    for name, raw in tsvs.items():
        with open(os.path.join(out, name), "wb") as f:
            f.write(raw)

    val = pd.read_csv(io.BytesIO(tsvs["validated.tsv"]), sep="\t", quoting=3,
                      usecols=["client_id", "path"], dtype=str)
    wanted = select_clips(val, n_total, per_speaker)
    got = 0
    with tarfile.open(archive, "r|gz") as tf:
        for member in tf:
            base = os.path.basename(member.name)
            if member.isfile() and base in wanted:
                with open(os.path.join(out, "clips", base), "wb") as f:
                    f.write(tf.extractfile(member).read())
                got += 1
                if got == len(wanted):
                    break
    spk = val[val["path"].isin(wanted)]["client_id"].nunique()
    print(f"{code}: validated={len(val)} speakers={val['client_id'].nunique()} "
          f"-> extracted {got} clips from {spk} speakers into data/{code}")
    return got == len(wanted)


def ingest_dir(src, n_total, per_speaker):
    """Same as ingest() but for an already-extracted Common Voice folder (<...>/<code>/)."""
    src = os.path.abspath(src)
    code = os.path.basename(src.rstrip("/"))
    out = os.path.join(DATA, code)
    os.makedirs(os.path.join(out, "clips"), exist_ok=True)
    for name in os.listdir(src):
        if name.endswith(".tsv"):
            shutil.copy(os.path.join(src, name), os.path.join(out, name))
    if not os.path.exists(os.path.join(out, "validated.tsv")):
        tsvs = {n: open(os.path.join(out, n), "rb").read() for n in os.listdir(out) if n.endswith(".tsv")}
        with open(os.path.join(out, "validated.tsv"), "wb") as f:
            f.write(splits_as_validated(tsvs))
    val = pd.read_csv(os.path.join(out, "validated.tsv"), sep="\t", quoting=3,
                      usecols=["client_id", "path"], dtype=str)
    wanted = select_clips(val, n_total, per_speaker)
    got = 0
    for base in wanted:
        f = os.path.join(src, "clips", base)
        if os.path.exists(f):
            shutil.copy(f, os.path.join(out, "clips", base))
            got += 1
    spk = val[val["path"].isin(wanted)]["client_id"].nunique()
    print(f"{code}: validated={len(val)} speakers={val['client_id'].nunique()} "
          f"-> copied {got} clips from {spk} speakers into data/{code}")
    return got == len(wanted)


def add_panel(src, code, n_speakers=40, per_speaker=8):
    """Speaker panel for speaker-level fingerprints: up to n_speakers speakers with at
    least per_speaker validated clips, per_speaker clips each. Writes data/<code>/panel.tsv
    and copies any clips not already present. src is an extracted folder or a .tar.gz."""
    out = os.path.join(DATA, code)
    if os.path.exists(os.path.join(out, "panel.tsv")):
        print(f"{code}: panel.tsv exists, keeping it")
        return
    val = pd.read_csv(os.path.join(out, "validated.tsv"), sep="\t", quoting=3,
                      usecols=["client_id", "path"], dtype=str)
    if os.path.abspath(src) == os.path.abspath(out):  # only clips already on disk
        val = val[val["path"].isin(set(os.listdir(os.path.join(out, "clips"))))]
    counts = val["client_id"].value_counts()
    eligible = sorted(counts[counts >= per_speaker].index)
    rng = pd.Series(eligible).sample(frac=1.0, random_state=SEED)
    speakers = list(rng[:n_speakers])
    panel = (val[val["client_id"].isin(speakers)]
             .sample(frac=1.0, random_state=SEED)
             .groupby("client_id").head(per_speaker)
             .sort_values(["client_id", "path"]))
    panel.to_csv(os.path.join(out, "panel.tsv"), sep="\t", index=False)
    clips_dir = os.path.join(out, "clips")
    need = set(panel["path"]) - set(os.listdir(clips_dir))
    if need and os.path.isdir(src):
        for base in need:
            shutil.copy(os.path.join(src, "clips", base), os.path.join(clips_dir, base))
    elif need:
        with tarfile.open(src, "r|gz") as tf:
            for member in tf:
                base = os.path.basename(member.name)
                if member.isfile() and base in need:
                    with open(os.path.join(clips_dir, base), "wb") as f:
                        f.write(tf.extractfile(member).read())
    print(f"{code}: panel of {len(speakers)} speakers x {per_speaker} clips "
          f"({len(need)} new clips copied)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("archives", nargs="*")
    ap.add_argument("--n", type=int, default=300)
    ap.add_argument("--per-speaker", type=int, default=20)
    ap.add_argument("--delete-archive", action="store_true")
    ap.add_argument("--panel-code", help="build a speaker panel for this data/<code> from the given source")
    a = ap.parse_args()
    paths = a.archives or sorted(
        glob.glob(os.path.join(DATA, "_archives", "*.tar.gz"))
        + glob.glob(os.path.expanduser("~/Downloads/*cv-corpus*.tar.gz")))
    if a.panel_code:
        add_panel(paths[0], a.panel_code)
        raise SystemExit
    for p in paths:
        try:
            if os.path.isdir(p):
                ingest_dir(p, a.n, a.per_speaker)
                continue
            ok = ingest(p, a.n, a.per_speaker)
            if ok and a.delete_archive:
                os.remove(p)
        except Exception as e:
            print(f"FAILED {p}: {e}")
