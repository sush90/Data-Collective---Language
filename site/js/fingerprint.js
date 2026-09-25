// Prosodic fingerprint in plain JavaScript: a line-by-line port of prosody.py,
// following features.md exactly. Runs in the browser and in Node (verify_js.py).
(function (root) {
  const SR = 16000, HOP = 160, WIN = 400, F0_MIN = 75, F0_MAX = 500;
  const TAU_MIN = Math.floor(SR / F0_MAX);   // 32
  const TAU_MAX = Math.ceil(SR / F0_MIN);    // 214
  const YIN_THRESH = 0.20, FLOOR_DB = -60, SIL_DB = -30, MIN_RUN = 3, OCTAVE_LIMIT = 12;
  const SMOOTH = 5, REV_DEADZONE = 0.05, PAUSE_MIN = 15, NUC_MIN_DB = -25, NUC_DIP_DB = 2, PEAK_DIP_DB = 3;
  const FEATURES = ["f0_sd", "f0_range", "f0_slope", "f0_reversal_rate", "f0_final_slope",
    "int_sd", "int_peak_rate", "npvi_nuclei", "pct_voiced", "voiced_cv", "unvoiced_cv", "nuclei_rate",
    "pause_rate", "pause_mean", "silence_prop"];

  const mean = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; };
  const std = a => { const m = mean(a); let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - m) ** 2; return Math.sqrt(s / a.length); };
  const median = a => { const s = Array.from(a).sort((x, y) => x - y); const n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

  function frameGrid(n) { const need = WIN + TAU_MAX; return n < need ? 0 : Math.floor((n - need) / HOP) + 1; }

  function frameDb(x, n) {
    const db = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0; const o = i * HOP;
      for (let j = 0; j < WIN; j++) s += x[o + j] * x[o + j];
      db[i] = 20 * Math.log10(Math.sqrt(s / WIN) + 1e-10);
    }
    return db;
  }

  function yinFrame(x, o) {
    const d = new Float64Array(TAU_MAX + 1);
    for (let tau = 1; tau <= TAU_MAX; tau++) {
      let s = 0;
      for (let j = 0; j < WIN; j++) { const df = x[o + j] - x[o + j + tau]; s += df * df; }
      d[tau] = s;
    }
    const c = new Float64Array(TAU_MAX + 1); c[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= TAU_MAX; tau++) { running += d[tau]; c[tau] = running > 0 ? d[tau] * tau / running : 1; }
    let tau = TAU_MIN;
    while (tau < TAU_MAX) {
      if (c[tau] < YIN_THRESH) { while (tau + 1 < TAU_MAX && c[tau + 1] < c[tau]) tau++; break; }
      tau++;
    }
    if (tau >= TAU_MAX) return 0;
    const y0 = c[tau - 1], y1 = c[tau], y2 = c[tau + 1];
    const den = y0 - 2 * y1 + y2;
    let shift = den !== 0 ? 0.5 * (y0 - y2) / den : 0;
    if (Math.abs(shift) > 1) shift = 0;
    const f0 = SR / (tau + shift);
    return f0 >= F0_MIN && f0 <= F0_MAX ? f0 : 0;
  }

  function runs(mask) {
    const out = []; let start = -1;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] && start < 0) start = i;
      else if (!mask[i] && start >= 0) { out.push([start, i - start]); start = -1; }
    }
    if (start >= 0) out.push([start, mask.length - start]);
    return out;
  }
  function dropShortRuns(v) {
    const o = v.slice();
    runs(o).forEach(([s, n]) => { if (n < MIN_RUN) for (let i = s; i < s + n; i++) o[i] = 0; });
    return o;
  }
  function olsSlope(t, y) {
    if (t.length < 2) return 0;
    const tm = mean(t), ym = mean(y); let num = 0, den = 0;
    for (let i = 0; i < t.length; i++) { num += (t[i] - tm) * (y[i] - ym); den += (t[i] - tm) ** 2; }
    return den > 0 ? num / den : 0;
  }
  function percentile(v, q) {
    const s = Array.from(v).sort((a, b) => a - b);
    const pos = (s.length - 1) * q / 100, lo = Math.floor(pos), hi = Math.min(lo + 1, s.length - 1);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }
  function cv(lengths) { return lengths.length < 2 ? 0 : std(lengths) / mean(lengths); }
  function mergePeaks(S, peaks, dip) {
    const kept = [];
    for (const p of peaks) {
      if (!kept.length) { kept.push(p); continue; }
      const k = kept[kept.length - 1];
      let m = Infinity; for (let i = k; i <= p; i++) m = Math.min(m, S[i]);
      if (Math.min(S[k], S[p]) - m < dip) { if (S[p] > S[k]) kept[kept.length - 1] = p; }
      else kept.push(p);
    }
    return kept;
  }

  // input: Float32Array or Float64Array at 16 kHz.
  // Returns {features, info}; features is null if extraction fails.
  function analyze(input) {
    const N = input.length;
    const x = new Float64Array(N);
    const m0 = mean(input);
    for (let i = 0; i < N; i++) x[i] = input[i] - m0;
    const n = frameGrid(N);
    if (n < 10) return { features: null, info: { reason: "too short" } };
    const db = frameDb(x, n);
    let dmax = -Infinity; for (let i = 0; i < n; i++) dmax = Math.max(dmax, db[i]);
    const rel = new Float64Array(n);
    for (let i = 0; i < n; i++) rel[i] = Math.max(db[i] - dmax, FLOOR_DB);

    let a = -1, b = -1;
    for (let i = 0; i < n; i++) if (rel[i] > SIL_DB) { if (a < 0) a = i; b = i; }

    const f0 = new Float64Array(n);
    for (let i = a; i <= b; i++) if (rel[i] > SIL_DB) f0[i] = yinFrame(x, i * HOP);

    let voiced = dropShortRuns(Array.from(f0, v => (v > 0 ? 1 : 0)));
    let vf = f0.filter((_, i) => voiced[i]);
    if (vf.length < 2) return { features: null, info: { reason: "no voiced pitch" } };
    let med = median(vf);
    for (let i = 0; i < n; i++) if (voiced[i] && Math.abs(12 * Math.log2(f0[i] / med)) > OCTAVE_LIMIT) voiced[i] = 0;
    voiced = dropShortRuns(voiced);
    vf = f0.filter((_, i) => voiced[i]);
    const nv = vf.length;
    if (nv < 2) return { features: null, info: { reason: "no voiced pitch" } };
    med = median(vf);
    const st = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) if (voiced[i]) st[i] = 12 * Math.log2(f0[i] / med);

    const nReg = b - a + 1, dur = nReg * HOP / SR;
    const vi = []; for (let i = 0; i < n; i++) if (voiced[i]) vi.push(i);
    const t = vi.map(i => i * HOP / SR), sv = vi.map(i => st[i]);

    const k = Math.max(5, Math.ceil(0.2 * nv));
    let rev = 0;
    runs(voiced).forEach(([s, ln]) => {
      if (ln < SMOOTH) return;
      const ma = [];
      for (let j = 0; j <= ln - SMOOTH; j++) { let q = 0; for (let u = 0; u < SMOOTH; u++) q += st[s + j + u]; ma.push(q / SMOOTH); }
      const signs = [];
      for (let j = 1; j < ma.length; j++) { const d = ma[j] - ma[j - 1]; if (Math.abs(d) > REV_DEADZONE) signs.push(d > REV_DEADZONE ? 1 : -1); }
      for (let j = 1; j < signs.length; j++) if (signs[j] !== signs[j - 1]) rev++;
    });

    const S = new Float64Array(n).fill(FLOOR_DB);
    const half = Math.floor(SMOOTH / 2);
    for (let i = a; i <= b; i++) {
      const lo = Math.max(a, i - half), hi = Math.min(b, i + half);
      let q = 0; for (let u = lo; u <= hi; u++) q += rel[u];
      S[i] = q / (hi - lo + 1);
    }
    const cand = [];
    for (let i = a + 1; i < b; i++) if (S[i] > S[i - 1] && S[i] >= S[i + 1] && S[i] > SIL_DB) cand.push(i);
    const peaks = mergePeaks(S, cand, PEAK_DIP_DB);
    const nucCand = cand.filter(i => {
      if (!(S[i] > NUC_MIN_DB)) return false;
      for (let u = Math.max(0, i - 2); u < Math.min(n, i + 3); u++) if (voiced[u]) return true;
      return false;
    });
    const nuclei = mergePeaks(S, nucCand, NUC_DIP_DB);
    let npvi = NaN;
    if (nuclei.length >= 3) {
      const iv = []; for (let j = 1; j < nuclei.length; j++) iv.push((nuclei[j] - nuclei[j - 1]) * HOP / SR);
      let q = 0; for (let j = 0; j < iv.length - 1; j++) q += Math.abs(iv[j] - iv[j + 1]) / ((iv[j] + iv[j + 1]) / 2);
      npvi = 100 * q / (iv.length - 1);
    }

    const vmask = voiced.slice(a, b + 1);
    const silent = Array.from(rel.slice(a, b + 1), v => (v < SIL_DB ? 1 : 0));
    const pauses = runs(silent).map(r => r[1]).filter(l => l >= PAUSE_MIN);
    const relReg = rel.slice(a, b + 1);

    const features = {
      f0_sd: std(sv),
      f0_range: percentile(sv, 95) - percentile(sv, 5),
      f0_slope: olsSlope(t, sv),
      f0_reversal_rate: rev / (nv * HOP / SR),
      f0_final_slope: olsSlope(t.slice(-k), sv.slice(-k)),
      int_sd: std(relReg),
      int_peak_rate: peaks.length / dur,
      npvi_nuclei: npvi,
      pct_voiced: nv / nReg,
      voiced_cv: cv(runs(vmask).map(r => r[1])),
      unvoiced_cv: cv(runs(vmask.map(v => 1 - v)).map(r => r[1])),
      nuclei_rate: nuclei.length / dur,
      pause_rate: pauses.length / dur,
      pause_mean: pauses.length ? mean(pauses) * HOP / SR : 0,
      silence_prop: mean(silent),
    };
    return { features, info: { n_voiced: nv, n_nuclei: nuclei.length, dur, a, b, median_f0: med, st, nuclei } };
  }

  function passesQuality(r) {
    if (!r.features) return [false, r.info.reason || "failed"];
    if (r.info.n_voiced < 30) return [false, "too little voiced pitch"];
    if (r.info.n_nuclei < 3) return [false, "fewer than 3 syllable-like beats"];
    if (r.info.dur < 1.0) return [false, "speech shorter than 1 s"];
    if (!FEATURES.every(f => Number.isFinite(r.features[f]))) return [false, "non-finite feature"];
    return [true, "ok"];
  }

  // Background-noise features (silence.py), needed to place a recording on the noise-controlled map.
  // mel: 8 x 201 filterbank exported from librosa in model.json.
  function silenceFeatures(input, mel) {
    const N = input.length, m0 = mean(input);
    const x = new Float64Array(N); for (let i = 0; i < N; i++) x[i] = input[i] - m0;
    const n = frameGrid(N);
    const db = frameDb(x, n);
    let dmax = -Infinity; for (let i = 0; i < n; i++) dmax = Math.max(dmax, db[i]);
    const sil = Array.from(db, v => (v - dmax < SIL_DB ? 1 : 0));
    const silIdx = [], loud = [];
    for (let i = 0; i < n; i++) (sil[i] ? silIdx : loud).push(i);
    if (silIdx.length < 5) return null;
    const nb = WIN / 2 + 1, p = new Float64Array(nb);
    const hann = new Float64Array(WIN);
    for (let j = 0; j < WIN; j++) hann[j] = 0.5 - 0.5 * Math.cos(2 * Math.PI * j / (WIN - 1));
    const cosT = new Float64Array(WIN * nb), sinT = new Float64Array(WIN * nb);
    for (let f = 0; f < nb; f++) for (let j = 0; j < WIN; j++) {
      const ang = 2 * Math.PI * f * j / WIN; cosT[f * WIN + j] = Math.cos(ang); sinT[f * WIN + j] = Math.sin(ang);
    }
    const fr = new Float64Array(WIN);
    for (const i of silIdx) {
      for (let j = 0; j < WIN; j++) fr[j] = x[i * HOP + j] * hann[j];
      for (let f = 0; f < nb; f++) {
        let re = 0, im = 0; const o = f * WIN;
        for (let j = 0; j < WIN; j++) { re += fr[j] * cosT[o + j]; im -= fr[j] * sinT[o + j]; }
        p[f] += re * re + im * im + 1e-12;
      }
    }
    for (let f = 0; f < nb; f++) p[f] /= silIdx.length;
    const freqs = Array.from({ length: nb }, (_, f) => f * SR / WIN);
    let tot = 0, cen = 0, logm = 0;
    for (let f = 0; f < nb; f++) { tot += p[f]; cen += freqs[f] * p[f]; logm += Math.log(p[f]); }
    let cum = 0, roll = freqs[nb - 1];
    for (let f = 0; f < nb; f++) { cum += p[f]; if (cum / tot >= 0.95) { roll = freqs[f]; break; } }
    const bands = mel.map(row => { let s = 0; for (let f = 0; f < nb; f++) s += row[f] * p[f]; return 10 * Math.log10(s + 1e-12); });
    const bm = mean(bands);
    const sdb = silIdx.map(i => db[i]);
    const out = {
      noise_db_mean: mean(sdb), noise_db_sd: std(sdb),
      lead_sil_s: loud.length ? loud[0] * HOP / SR : 0,
      trail_sil_s: loud.length ? (n - 1 - loud[loud.length - 1]) * HOP / SR : 0,
      sil_frac: silIdx.length / n,
      noise_flatness: Math.exp(logm / nb) / (tot / nb),
      noise_centroid_hz: cen / tot, noise_rolloff_hz: roll,
    };
    bands.forEach((v, k) => (out[`noise_band${k}`] = v - bm));
    return out;
  }

  const api = { SR, FEATURES, analyze, passesQuality, silenceFeatures };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Fingerprint = api;
})(typeof window !== "undefined" ? window : globalThis);
