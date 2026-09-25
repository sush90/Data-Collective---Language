"""Prosodic fingerprint, implemented exactly as specified in features.md.

The same algorithm is implemented in site/js/fingerprint.js. Any change here
must be mirrored there and re-verified with verify_js.py.

All features are normalized within the utterance (semitones relative to the
utterance median pitch, dB relative to the utterance maximum), so no speaker
statistics or identity labels are needed.
"""
import math

import numpy as np

SR = 16000            # Hz, audio is resampled to this rate
HOP = 160             # samples (10 ms)
WIN = 400             # samples (25 ms) analysis window for intensity and YIN
F0_MIN = 75.0         # Hz pitch floor
F0_MAX = 500.0        # Hz pitch ceiling
TAU_MIN = int(SR // F0_MAX)          # 32 samples
TAU_MAX = int(math.ceil(SR / F0_MIN))  # 214 samples
YIN_THRESH = 0.20     # cumulative mean normalized difference threshold (tuned vs Praat in pilot)
FLOOR_DB = -60.0      # relative intensity floor
SIL_DB = -30.0        # frames below this (relative to max) are silent
MIN_RUN = 3           # voiced runs shorter than this are removed (frames)
OCTAVE_LIMIT = 12.0   # semitones from median; beyond this a frame is an octave error
SMOOTH = 5            # moving-average length (frames) for intensity and reversals
REV_DEADZONE = 0.05   # semitones per frame; smaller changes are "flat"
PAUSE_MIN = 15        # frames (150 ms): minimum silent run counted as a pause
NUC_MIN_DB = -25.0    # nucleus peak must be louder than this
NUC_DIP_DB = 2.0      # dip needed between nuclei
PEAK_DIP_DB = 3.0     # dip needed between intensity peaks

FEATURES = [
    "f0_sd", "f0_range", "f0_slope", "f0_reversal_rate", "f0_final_slope",
    "int_sd", "int_peak_rate",
    "npvi_nuclei", "pct_voiced", "voiced_cv", "unvoiced_cv", "nuclei_rate",
    "pause_rate", "pause_mean", "silence_prop",
]


def frame_grid(n_samples):
    need = WIN + TAU_MAX
    if n_samples < need:
        return 0
    return (n_samples - need) // HOP + 1


def intensity_db(x, n_frames):
    db = np.empty(n_frames)
    for i in range(n_frames):
        seg = x[i * HOP: i * HOP + WIN]
        db[i] = 20.0 * math.log10(math.sqrt(float(np.dot(seg, seg)) / WIN) + 1e-10)
    rel = db - db.max()
    return np.maximum(rel, FLOOR_DB)


def yin_frame(frame):
    """frame has WIN + TAU_MAX samples. Returns f0 in Hz or 0.0 if unvoiced."""
    a = frame[:WIN]
    d = np.zeros(TAU_MAX + 1)
    for tau in range(1, TAU_MAX + 1):
        diff = a - frame[tau: tau + WIN]
        d[tau] = float(np.dot(diff, diff))
    cmnd = np.ones(TAU_MAX + 1)
    running = 0.0
    for tau in range(1, TAU_MAX + 1):
        running += d[tau]
        cmnd[tau] = d[tau] * tau / running if running > 0 else 1.0
    tau = TAU_MIN
    while tau < TAU_MAX:
        if cmnd[tau] < YIN_THRESH:
            while tau + 1 < TAU_MAX and cmnd[tau + 1] < cmnd[tau]:
                tau += 1
            break
        tau += 1
    if tau >= TAU_MAX:
        return 0.0
    y0, y1, y2 = cmnd[tau - 1], cmnd[tau], cmnd[tau + 1]
    denom = y0 - 2.0 * y1 + y2
    shift = 0.5 * (y0 - y2) / denom if denom != 0 else 0.0
    if abs(shift) > 1.0:
        shift = 0.0
    f0 = SR / (tau + shift)
    return f0 if F0_MIN <= f0 <= F0_MAX else 0.0


def runs(mask):
    """List of (start, length) for consecutive True values."""
    out, start = [], None
    for i, m in enumerate(mask):
        if m and start is None:
            start = i
        elif not m and start is not None:
            out.append((start, i - start))
            start = None
    if start is not None:
        out.append((start, len(mask) - start))
    return out


def drop_short_runs(voiced):
    v = voiced.copy()
    for s, n in runs(v):
        if n < MIN_RUN:
            v[s: s + n] = False
    return v


def ols_slope(t, y):
    if len(t) < 2:
        return 0.0
    tm, ym = t.mean(), y.mean()
    den = float(np.sum((t - tm) ** 2))
    return float(np.sum((t - tm) * (y - ym)) / den) if den > 0 else 0.0


def percentile(v, q):
    """Linear interpolation between closest ranks (numpy's default)."""
    s = np.sort(v)
    pos = (len(s) - 1) * q / 100.0
    lo = int(math.floor(pos))
    hi = min(lo + 1, len(s) - 1)
    return float(s[lo] + (s[hi] - s[lo]) * (pos - lo))


def cv(lengths):
    if len(lengths) < 2:
        return 0.0
    a = np.asarray(lengths, dtype=float)
    return float(a.std() / a.mean())


def merge_peaks(S, peaks, dip):
    kept = []
    for p in peaks:
        if not kept:
            kept.append(p)
            continue
        k = kept[-1]
        m = float(S[k: p + 1].min())
        if min(S[k], S[p]) - m < dip:
            if S[p] > S[k]:
                kept[-1] = p
        else:
            kept.append(p)
    return kept


def analyze(x):
    """x: mono float array at SR. Returns (features dict, info dict)."""
    x = np.asarray(x, dtype=np.float64)
    x = x - x.mean()
    n = frame_grid(len(x))
    if n < 10:
        return None, {"reason": "too short"}
    rel = intensity_db(x, n)

    loud = np.where(rel > SIL_DB)[0]
    a, b = int(loud[0]), int(loud[-1])

    f0 = np.zeros(n)
    for i in range(a, b + 1):
        if rel[i] > SIL_DB:
            f0[i] = yin_frame(x[i * HOP: i * HOP + WIN + TAU_MAX])

    voiced = drop_short_runs(f0 > 0)
    if voiced.sum() < 2:
        return None, {"reason": "no voiced pitch"}
    med = float(np.median(f0[voiced]))
    st = np.zeros(n)
    st[voiced] = 12.0 * np.log2(f0[voiced] / med)
    voiced &= np.abs(st) <= OCTAVE_LIMIT
    voiced = drop_short_runs(voiced)
    nv = int(voiced.sum())
    if nv < 2:
        return None, {"reason": "no voiced pitch"}
    med = float(np.median(f0[voiced]))
    st = np.full(n, np.nan)
    st[voiced] = 12.0 * np.log2(f0[voiced] / med)

    region = np.arange(a, b + 1)
    n_reg = len(region)
    dur = n_reg * HOP / SR
    vi = np.where(voiced)[0]
    t = vi * HOP / SR
    sv = st[vi]

    # Pitch
    k = max(5, int(math.ceil(0.2 * nv)))
    rev = 0
    for s, ln in runs(voiced):
        if ln < SMOOTH:
            continue
        seg = st[s: s + ln]
        ma = np.array([seg[j: j + SMOOTH].mean() for j in range(ln - SMOOTH + 1)])
        dif = np.diff(ma)
        signs = [1 if d > REV_DEADZONE else -1 for d in dif if abs(d) > REV_DEADZONE]
        rev += sum(1 for j in range(1, len(signs)) if signs[j] != signs[j - 1])

    # Intensity, smoothed within the region
    S = np.full(n, FLOOR_DB)
    half = SMOOTH // 2
    for i in range(a, b + 1):
        lo, hi = max(a, i - half), min(b, i + half)
        S[i] = rel[lo: hi + 1].mean()
    cand = [i for i in range(a + 1, b)
            if S[i] > S[i - 1] and S[i] >= S[i + 1] and S[i] > SIL_DB]
    peaks = merge_peaks(S, cand, PEAK_DIP_DB)
    nuc_cand = [i for i in cand
                if S[i] > NUC_MIN_DB and voiced[max(0, i - 2): i + 3].any()]
    nuclei = merge_peaks(S, nuc_cand, NUC_DIP_DB)
    if len(nuclei) >= 3:
        iv = np.diff(np.asarray(nuclei) * HOP / SR)
        npvi = float(100.0 * np.mean(np.abs(iv[:-1] - iv[1:]) / ((iv[:-1] + iv[1:]) / 2.0)))
    else:
        npvi = float("nan")

    vmask = voiced[a: b + 1]
    silent = rel[a: b + 1] < SIL_DB
    pauses = [ln for _, ln in runs(silent) if ln >= PAUSE_MIN]

    feats = {
        "f0_sd": float(sv.std()),
        "f0_range": percentile(sv, 95) - percentile(sv, 5),
        "f0_slope": ols_slope(t, sv),
        "f0_reversal_rate": rev / (nv * HOP / SR),
        "f0_final_slope": ols_slope(t[-k:], sv[-k:]),
        "int_sd": float(rel[a: b + 1].std()),
        "int_peak_rate": len(peaks) / dur,
        "npvi_nuclei": npvi,
        "pct_voiced": nv / n_reg,
        "voiced_cv": cv([ln for _, ln in runs(vmask)]),
        "unvoiced_cv": cv([ln for _, ln in runs(~vmask)]),
        "nuclei_rate": len(nuclei) / dur,
        "pause_rate": len(pauses) / dur,
        "pause_mean": (float(np.mean(pauses)) * HOP / SR) if pauses else 0.0,
        "silence_prop": float(silent.mean()),
    }
    info = {"n_voiced": nv, "n_nuclei": len(nuclei), "dur": dur, "a": a, "b": b,
            "median_f0": med, "st": st, "rel": rel, "nuclei": nuclei}
    return feats, info


def passes_quality(feats, info):
    if feats is None:
        return False, info.get("reason", "failed")
    if info["n_voiced"] < 30:
        return False, "too little voiced pitch"
    if info["n_nuclei"] < 3:
        return False, "fewer than 3 nuclei"
    if info["dur"] < 1.0:
        return False, "speech shorter than 1 s"
    if not all(np.isfinite(v) for v in feats.values()):
        return False, "non-finite feature"
    return True, "ok"
