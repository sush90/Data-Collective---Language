"""Download Common Voice archives via the official Mozilla Data Collective SDK,
then extract a speaker-balanced subsample with ingest.py and delete the archive.

Requires MDC_API_KEY in .env (create at https://mozilladatacollective.com/profile/credentials).
Usage: python download_mdc.py [Name ...]   # default: all, in priority order
"""
import os
import sys

from dotenv import load_dotenv

ROOT = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(ROOT, ".env"))
from datacollective import download_dataset  # noqa: E402

import ingest  # noqa: E402

# Priority order requested by the team.
DATASETS = [
    ("Bashkir", "cmu62jhk700nwo107l41a2fch"),
    ("Fang", "cmu6w9dop01evo107tkrje7so"),
    ("Ewondo", "cmu6256q100mmo107kx3ckjvw"),
    ("Torwali", "cmu628w7b00o5nq07h5idxz3c"),
    ("Balti", "cmu5uslps007vo1077pshfat3"),
    ("Tajik", "cmu5olbz200y1mi07tfs34bue"),
    ("Hazargi", "cmu5q40l70102mh07pce6f3im"),
    ("Pahari-Pothwari", "cmu624zk200ntnq078ppl1wqw"),
    ("Dhatki", "cmu61f7ki00k0o107hb8spwbv"),
    ("Ormuri", "cmu5vtr4000b6nq07zds24rqx"),
    ("Kihemba", "cmu5qzwev001inq07iz1xotu0"),
    ("Bafia", "cmu628q4x00mwo107kf1ras86"),
    ("Batanga", "cmu628bzf00mso107fjgodugu"),
    ("Sakha", "cmu62cfot00nco107nwfu13mz"),
    ("Kazakh", "cmu5pcyw70104mi07526gdxh5"),
    ("Baoule", "cmu625dl700nxnq07jev059gj"),
]

if __name__ == "__main__":
    if not os.environ.get("MDC_API_KEY"):
        sys.exit("MDC_API_KEY is empty. Add it to .env first.")
    only = set(sys.argv[1:])
    arch_dir = os.path.join(ROOT, "data", "_archives")
    os.makedirs(arch_dir, exist_ok=True)
    for name, ds_id in DATASETS:
        if only and name not in only:
            continue
        try:
            path = download_dataset(ds_id, download_directory=arch_dir, show_progress=False)
            print(f"[downloaded] {name}: {path}", flush=True)
            if ingest.ingest(str(path), 300, 20):
                os.remove(path)
        except Exception as e:
            print(f"[FAILED] {name}: {type(e).__name__}: {e}", flush=True)
