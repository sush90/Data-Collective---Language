"""Recording-condition features from the NON-speech frames of each clip.

If these alone predict the language, the prosody classifier may be picking up
microphones, rooms or codecs rather than rhythm. Cached to outputs/silence.csv.
"""
import os
import warnings

import librosa
import numpy as np
import pandas as pd
from joblib import Parallel, delayed

import prosody
from extract import OUT, ROOT, load_config

CACHE = os.path.join(OUT, "silence.csv")
SIL_FEATURES = ["noise_db_mean", "noise_db_sd", "lead_sil_s", "trail_sil_s", "sil_frac",
                "noise_flatness", "noise_centroid_hz", "noise_rolloff_hz"] + \
               [f"noise_band{k}" for k in range(8)]


def silence_features(path):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        y, _ = librosa.load(path, sr=prosody.SR, mono=True)
    x = y.astype(np.float64) - y.mean()
    n = prosody.frame_grid(len(x))
    db = np.array([20 * np.log10(np.sqrt(np.mean(x[i * prosody.HOP: i * prosody.HOP + prosody.WIN] ** 2)) + 1e-10)
                   for i in range(n)])
    rel = db - db.max()
    sil = rel < prosody.SIL_DB
    if sil.sum() < 5:
        return None
    loud = np.where(~sil)[0]
    frames = np.stack([x[i * prosody.HOP: i * prosody.HOP + prosody.WIN] for i in np.where(sil)[0]])
    spec = np.abs(np.fft.rfft(frames * np.hanning(prosody.WIN), axis=1)) ** 2 + 1e-12
    freqs = np.fft.rfftfreq(prosody.WIN, 1 / prosody.SR)
    p = spec.mean(axis=0)
    cum = np.cumsum(p) / p.sum()
    mel = librosa.filters.mel(sr=prosody.SR, n_fft=prosody.WIN, n_mels=8)
    bands = 10 * np.log10(mel @ p + 1e-12)
    return {
        "noise_db_mean": float(db[sil].mean()),     # absolute dBFS: mic gain and room noise
        "noise_db_sd": float(db[sil].std()),
        "lead_sil_s": loud[0] * prosody.HOP / prosody.SR,
        "trail_sil_s": (n - 1 - loud[-1]) * prosody.HOP / prosody.SR,
        "sil_frac": float(sil.mean()),
        "noise_flatness": float(np.exp(np.mean(np.log(p))) / np.mean(p)),
        "noise_centroid_hz": float((freqs * p).sum() / p.sum()),
        "noise_rolloff_hz": float(freqs[np.searchsorted(cum, 0.95)]),
        **{f"noise_band{k}": float(bands[k] - bands.mean()) for k in range(8)},
    }


def run(clips):
    """clips: DataFrame with language, folder, path, client_id."""
    cache = pd.read_csv(CACHE) if os.path.exists(CACHE) else pd.DataFrame(columns=["language", "path"])
    done = set(zip(cache["language"], cache["path"]))
    todo = [r for r in clips.itertuples() if (r.language, r.path) not in done]

    def one(r):
        f = silence_features(os.path.join(ROOT, "data", r.folder, "clips", r.path))
        return {"language": r.language, "path": r.path, "client_id": r.client_id,
                "sil_ok": f is not None, **(f or {})}

    if todo:
        rows = Parallel(n_jobs=-1)(delayed(one)(r) for r in todo)
        cache = pd.concat([cache, pd.DataFrame(rows)], ignore_index=True)
        cache.to_csv(CACHE, index=False)
    return cache
