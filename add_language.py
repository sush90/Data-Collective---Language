"""Add a Common Voice language in one command.

  python add_language.py --path data/<folder> --family "<family>" [--name "<Name>"]
  python add_language.py --path ~/Downloads/cv-corpus-...-xx.tar.gz --family "<family>"
  python add_language.py --path ~/mdc_raw/cv-xx/xx --family "<family>"

--path may be a folder already under data/, an extracted Common Voice folder
elsewhere, or a .tar.gz archive. The script samples clips (ingest.py), builds a
speaker panel, registers the language in languages.yaml, extracts fingerprints,
and re-runs the analysis and website export if those scripts exist.
"""
import argparse
import os
import subprocess
import sys

import pandas as pd
import yaml

import ingest

ROOT = os.path.dirname(os.path.abspath(__file__))
CFG = os.path.join(ROOT, "languages.yaml")
PY = sys.executable

NAMES = {"tt": "Tatar", "ba": "Bashkir", "sah": "Sakha", "kk": "Kazakh", "tr": "Turkish",
         "fan": "Fang", "ewo": "Ewondo", "ksf": "Bafia", "bnm": "Batanga", "hem": "Kihemba",
         "bci": "Baoule", "kab": "Kabyle", "trw": "Torwali", "bft": "Balti",
         "phr": "Pahari-Pothwari", "mki": "Dhatki", "haz": "Hazaragi", "oru": "Ormuri",
         "tg": "Tajik", "fa": "Persian"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--path", required=True)
    ap.add_argument("--family", required=True)
    ap.add_argument("--name")
    ap.add_argument("--no-rerun", action="store_true", help="skip analysis and export")
    a = ap.parse_args()
    src = os.path.abspath(os.path.expanduser(a.path))
    data_dir = os.path.join(ROOT, "data")

    # 1. Sample clips into data/<code> unless the folder is already under data/.
    if src.endswith(".tar.gz"):
        ingest.ingest(src, 300, 20)
        import tarfile
        with tarfile.open(src, "r|gz") as tf:
            code = next(m.name.split("/")[-2] for m in tf if m.name.endswith("validated.tsv"))
    elif os.path.dirname(src.rstrip("/")) == data_dir:
        code = os.path.basename(src.rstrip("/"))
    else:
        ingest.ingest_dir(src, 300, 20)
        code = os.path.basename(src.rstrip("/"))
    folder = os.path.join(data_dir, code)
    if not os.path.exists(os.path.join(folder, "validated.tsv")):
        sys.exit(f"No validated.tsv in {folder}")

    # 2. Speaker panel (from the original source when available, else clips on hand).
    panel_src = src if not os.path.dirname(src.rstrip("/")) == data_dir else folder
    try:
        ingest.add_panel(panel_src, code)
    except Exception as e:
        print(f"Speaker panel skipped ({type(e).__name__}: {e})")

    # 3. Register in languages.yaml (appended as text so comments are preserved).
    val = pd.read_csv(os.path.join(folder, "validated.tsv"), sep="\t", quoting=3, dtype=str, nrows=5)
    locale = val["locale"].iloc[0] if "locale" in val else code
    name = a.name or NAMES.get(locale, NAMES.get(code, code))
    cfg = yaml.safe_load(open(CFG))
    if any(L["folder"] == code for L in cfg["languages"]):
        print(f"{name} already in languages.yaml")
    else:
        text = open(CFG).read()
        entry = (f"  - name: {name}\n    code: {locale}\n    folder: {code}\n"
                 f"    family: {a.family}\n")
        marker = "\n# Pairs linguists"
        text = text.replace(marker, entry + marker, 1) if marker in text else text + entry
        open(CFG, "w").write(text)
        print(f"Added {name} ({locale}, family {a.family}) to languages.yaml")

    # 4. Extract, analyze, export.
    steps = [["extract.py"]]
    if not a.no_rerun:
        steps += [[s] for s in ["analysis.py", "export_site.py"] if os.path.exists(os.path.join(ROOT, s))]
    for s in steps:
        print(f"\n== {s[0]} ==")
        subprocess.run([PY, os.path.join(ROOT, s[0])], check=True)


if __name__ == "__main__":
    main()
