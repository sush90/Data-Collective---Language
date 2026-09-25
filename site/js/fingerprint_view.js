// Fingerprint tab: animated pitch contour plus rhythm and pause bars versus the language average.
const FP_BARS = ["nuclei_rate", "npvi_nuclei", "pct_voiced", "voiced_cv", "pause_rate", "pause_mean",
  "silence_prop", "f0_range", "f0_final_slope"];
const FP_UNITS = { nuclei_rate: "/s", npvi_nuclei: "", pct_voiced: "%", voiced_cv: "", pause_rate: "/s",
  pause_mean: " s", silence_prop: "%", f0_range: " st", f0_final_slope: " st/s" };

const FingerprintView = {
  clip: null,
  async init() {
    const langs = PC.data.languages.languages;
    const sel = document.getElementById("fp-lang");
    sel.innerHTML = langs.map((l, i) => `<option value="${i}">${PC.esc(l.name)}</option>`).join("");
    sel.value = PC.state.lang;
    sel.addEventListener("change", () => this.show(PC.randomClipOf(+sel.value)));
    document.getElementById("fp-random").addEventListener("click", () => this.show(PC.randomClipOf(+sel.value)));
    document.getElementById("fp-play").addEventListener("click", () => this.clip !== null && Player.play(this.clip));
    await PC.data.contoursReady;
    this.computeRanges();
    PC.on("play", cur => { if (!document.getElementById("tab-fingerprint").hidden) this.show(cur.clip, true); });
    PC.on("tick", cur => { if (this.api && cur.clip === this.clip) this.api.at(cur.t); });
    this.onShow();
  },

  onShow() {
    if (!PC.data.contours || !this.ranges) return;
    this.show(PC.lastClip !== undefined ? PC.lastClip : PC.randomClipOf(PC.state.lang));
  },

  computeRanges() {
    // 2nd to 98th percentile of each feature across all clips, for bar scales
    this.ranges = {};
    FP_BARS.forEach(f => {
      const v = PC.data.contours.contours.map(c => c.f[f]).sort((a, b) => a - b);
      const q = p => v[Math.floor(p * (v.length - 1))];
      this.ranges[f] = [Math.min(0, q(0.02)), q(0.98)];
    });
  },

  show(clipIdx, playing = false) {
    this.clip = clipIdx;
    const c = PC.data.contours.contours[clipIdx];
    const li = PC.data.contours.clips[clipIdx].l;
    const L = PC.data.languages.languages[li];
    document.getElementById("fp-lang").value = li;
    document.getElementById("fp-meta").innerHTML =
      `${PC.swatchSVG(li)} <b>${PC.esc(L.name)}</b> (${PC.esc(L.family)}), ${c.dur.toFixed(1)} s. ` +
      `Line: pitch melody in semitones relative to the speaker's own typical pitch, so every voice is comparable. Tick marks: syllable-like beats.`;
    this.api = drawContour(document.getElementById("fp-contour"), c, PC.langColor(li));
    if (!playing) this.api.full();
    this.bars(c.f, li);
  },

  bars(f, li) {
    const L = PC.data.languages.languages[li];
    const avg = PC.data.languages.feature_means[L.name];
    const lab = PC.data.languages.feature_labels;
    const fmt = (k, v) => (FP_UNITS[k] === "%" ? `${Math.round(v * 100)}%` : `${v.toFixed(k === "npvi_nuclei" ? 0 : 2)}${FP_UNITS[k]}`);
    document.getElementById("fp-bars").innerHTML = FP_BARS.map(k => {
      const [lo, hi] = this.ranges[k];
      const pos = v => Math.max(0, Math.min(100, 100 * (v - lo) / (hi - lo)));
      return `<div class="bar-row"><span>${PC.esc(lab[k])}</span>
        <div class="bar-track" title="This clip ${fmt(k, f[k])}; ${PC.esc(L.name)} average ${fmt(k, avg[k])}">
          <div class="v" style="width:${pos(f[k])}%;background:${PC.langColor(li)}"></div>
          <div class="avg" style="left:calc(${pos(avg[k])}% - 1px)"></div></div>
        <span class="bar-val">${fmt(k, f[k])}</span></div>`;
    }).join("") +
      `<p class="hint">Coloured bar: this clip. Black line: the ${PC.esc(L.name)} average. Scales span the range seen across all languages.</p>`;
  },
};
window.FingerprintView = FingerprintView;
