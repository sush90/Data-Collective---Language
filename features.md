# Prosodic fingerprint specification

This is the single source of truth for the fingerprint. `prosody.py` (Python) and
`site/js/fingerprint.js` (browser) implement it identically. `verify_js.py`
checks that they agree on real clips.

Design rules:

* **Dynamics only, normalized within the utterance.** Pitch is in semitones
  relative to the utterance's own median; intensity is in dB relative to the
  utterance's own maximum. No speaker statistics, no age or gender labels, no
  absolute pitch level. A 5 second recording is enough to compute everything.
* **No transcripts.** Nothing depends on text, phonemes or a writing system.
* Features marked **(proxy)** approximate a linguistic quantity that would
  normally need phoneme or syllable alignment.

## 1. Input

| Parameter | Value |
|---|---|
| Sample rate | 16000 Hz, mono. Python decodes mp3 with `librosa.load(sr=16000)`; the browser resamples the microphone signal to 16000 Hz. |
| DC removal | subtract the mean of the whole signal |
| Precision | float64 throughout |

## 2. Frames

| Parameter | Value |
|---|---|
| Hop | 160 samples (10 ms) |
| Window `W` | 400 samples (25 ms), rectangular |
| Pitch floor / ceiling | 75 Hz / 500 Hz |
| `TAU_MIN` | floor(16000 / 500) = 32 samples |
| `TAU_MAX` | ceil(16000 / 75) = 214 samples |
| Number of frames | `floor((N - (W + TAU_MAX)) / HOP) + 1` (0 if `N < W + TAU_MAX`) |

Frame `i` starts at sample `i * HOP`. Its time is `i * HOP / 16000` seconds.

## 3. Intensity

For frame `i`, over samples `[i*HOP, i*HOP + W)`:

```
rms_i = sqrt(sum(x^2) / W)
db_i  = 20 * log10(rms_i + 1e-10)
rel_i = max(db_i - max_j(db_j), -60)          # dB relative to utterance max, floor -60
```

**Speech region:** `a` = first frame with `rel > -30`, `b` = last such frame
(inclusive). This trims leading and trailing silence. All features below use
only frames `a..b`. Region duration `dur = (b - a + 1) * HOP / 16000`.

## 4. Pitch (YIN)

Computed only for frames in `a..b` with `rel > -30` (others are unvoiced).
Frame samples `f = x[i*HOP : i*HOP + W + TAU_MAX]`.

1. Difference: `d(tau) = sum_{j=0}^{W-1} (f[j] - f[j+tau])^2` for `tau = 1..TAU_MAX`.
2. Cumulative mean normalized difference: `c(0) = 1`;
   `c(tau) = d(tau) * tau / sum_{k=1}^{tau} d(k)` (1 if the sum is 0).
3. Search `tau` from `TAU_MIN` to `TAU_MAX - 1`: take the first `tau` with
   `c(tau) < 0.20`, then keep moving right while `tau + 1 < TAU_MAX` and
   `c(tau+1) < c(tau)`. If none is found, the frame is unvoiced.
4. Parabolic refinement on `c`: `s = 0.5 (c[tau-1] - c[tau+1]) / (c[tau-1] - 2c[tau] + c[tau+1])`
   (0 if the denominator is 0 or `|s| > 1`). `f0 = 16000 / (tau + s)`.
5. Unvoiced if `f0` is outside 75..500 Hz.

The threshold 0.20 was chosen in the pilot by comparison with Praat
(see results_summary.md): about 98% of frames we call voiced are voiced in
Praat, with a median disagreement of about 0.05 semitones.

**Cleanup:**

1. `voiced = f0 > 0`; set voiced runs shorter than 3 frames to unvoiced.
2. `st = 12 log2(f0 / median(f0 over voiced))`; frames with `|st| > 12`
   (octave errors) become unvoiced; drop voiced runs shorter than 3 frames again.
3. Recompute the median over the remaining voiced frames and recompute `st`.
   Median uses the usual definition (mean of the two middle values when even).

`nv` = number of voiced frames. `t_k`, `st_k` = times and semitones of voiced frames in order.

## 5. Features (15)

### Pitch (semitones relative to the utterance median)

| Feature | Definition |
|---|---|
| `f0_sd` | population standard deviation of `st_k` |
| `f0_range` | 95th minus 5th percentile of `st_k` (linear interpolation: position `(n-1) q / 100` in the sorted list) |
| `f0_slope` | ordinary least squares slope of `st_k` on `t_k`, semitones per second |
| `f0_reversal_rate` | Within each voiced run of at least 5 frames: 5-frame moving average (valid positions only), first differences, keep only differences with absolute value > 0.05, count sign changes between consecutive kept differences. Sum over runs, divided by voiced time `nv * 0.01` s. |
| `f0_final_slope` | OLS slope over the last `k = max(5, ceil(0.2 nv))` voiced frames (the final contour) |

### Intensity (dB relative to the utterance maximum)

Smoothed intensity `S_i` = mean of `rel` over frames `max(a, i-2) .. min(b, i+2)`.
Candidate peaks: frames `i` with `a < i < b`, `S_i > S_{i-1}`, `S_i >= S_{i+1}` and `S_i > -30`.

**Peak merging with dip `D`:** go through candidates in time order keeping a list. For
a new candidate `p` with last kept peak `k`, let `m = min(S_k..S_p)`. If
`min(S_k, S_p) - m < D`, the two are one peak: replace `k` with `p` if `S_p > S_k`,
otherwise drop `p`. Otherwise append `p`.

| Feature | Definition |
|---|---|
| `int_sd` | population standard deviation of `rel` over `a..b` |
| `int_peak_rate` | number of peaks after merging candidates with `D = 3 dB`, divided by `dur` |

### Rhythm (proxies)

**Syllable-like nuclei (proxy for syllables):** candidates with `S_i > -25` and
at least one voiced frame within `i-2..i+2`, merged with `D = 2 dB`.

| Feature | Definition |
|---|---|
| `nuclei_rate` | nuclei per second of `dur` (**proxy** for syllable rate) |
| `npvi_nuclei` | intervals `d_k` between consecutive nuclei times; `100 * mean(|d_k - d_{k+1}| / ((d_k + d_{k+1}) / 2))`. Needs at least 3 nuclei. (**proxy**: the linguistic nPVI uses vowel durations from phoneme alignment; here we use inter-nucleus intervals.) |
| `pct_voiced` | `nv / (b - a + 1)` (**proxy** for %V, the vocalic proportion) |
| `voiced_cv` | std / mean of voiced run lengths in `a..b` (0 if fewer than 2 runs) (**proxy** for VarcoV) |
| `unvoiced_cv` | same for unvoiced runs in `a..b` (**proxy** for VarcoC; includes pauses) |

### Pauses

Silent frames: `rel < -30` within `a..b`. A pause is a run of at least 15 silent frames (150 ms).

| Feature | Definition |
|---|---|
| `pause_rate` | pauses per second of `dur` |
| `pause_mean` | mean pause length in seconds (0 if none) |
| `silence_prop` | silent frames / `(b - a + 1)` |

## 6. Quality gate

A clip is kept only if extraction succeeds and: `nv >= 30` (0.3 s of voiced
pitch), at least 3 nuclei, `dur >= 1.0` s, and all 15 features are finite.
Dropped clips are recorded with their reason in `outputs/features.csv`.

## 7. Standardization and placement (browser)

The browser standardizes a new fingerprint with the exported per-feature
mean and standard deviation (fit on the kept clips of all languages), then
places it on the map by weighted k-nearest-neighbour averaging over the
exported clip fingerprints (k = 15, weight = 1 / (distance + 1e-6)) in the
standardized 15-dimensional space. No UMAP runs in the browser.

## 8. Speaker-level fingerprints

For each language, a speaker panel (`data/<code>/panel.tsv`) lists up to 40
speakers with at least 8 validated clips, 8 clips each. A speaker fingerprint is
the mean of the first 5 of that speaker's clips (sorted by file name) that pass
the quality gate; speakers with fewer than 5 good clips are excluded. Every
speaker average therefore covers exactly 5 clips.
