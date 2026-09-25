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


def ingest(archive, n_total, per_speaker):
    m = re.search(r"cv-corpus-[\d.]+-[\d-]+-([A-Za-z-]+)\.tar\.gz", os.path.basename(archive))
    code_hint = m.group(1) if m else None

    tsvs, code = {}, code_hint
    with tarfile.open(archive, "r|gz") as tf:
        for member in tf:
            if member.isfile() and member.name.endswith(".tsv"):
                parts = member.name.split("/")
                code = parts[-2]
                tsvs[parts[-1]] = tf.extractfile(member).read()
    if "validated.tsv" not in tsvs:
        raise RuntimeError(f"{archive}: no validated.tsv found")

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
    val = pd.read_csv(os.path.join(src, "validated.tsv"), sep="\t", quoting=3,
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


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("archives", nargs="*")
    ap.add_argument("--n", type=int, default=300)
    ap.add_argument("--per-speaker", type=int, default=20)
    ap.add_argument("--delete-archive", action="store_true")
    a = ap.parse_args()
    paths = a.archives or sorted(
        glob.glob(os.path.join(DATA, "_archives", "*.tar.gz"))
        + glob.glob(os.path.expanduser("~/Downloads/*cv-corpus*.tar.gz")))
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
