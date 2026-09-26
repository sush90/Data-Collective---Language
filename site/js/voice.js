// Try Your Voice: record ~5 s, compute the fingerprint on this device, place it on the map.
// Nothing is uploaded: the audio stays in this page's memory and is discarded on reload.
const VOICE_SECONDS = 5;

const VoiceView = {
  model: null,

  init() {
    const btn = document.getElementById("rec-btn");
    const status = document.getElementById("rec-status");
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      btn.disabled = true;
      status.innerHTML = `<span class="error">Recording is not available here.</span> The microphone needs a secure (https) page and a browser that supports recording, such as current Chrome, Firefox, Edge or Safari.`;
      return;
    }
    btn.addEventListener("click", () => this.record());
  },

  async loadModel() {
    if (!this.model) this.model = await fetch("data/model.json").then(r => r.json());
    return this.model;
  },

  setStatus(html) { document.getElementById("rec-status").innerHTML = html; },

  async record() {
    const btn = document.getElementById("rec-btn");
    btn.disabled = true;
    document.getElementById("voice-result").innerHTML = "";
    let stream;
    try {
      // Browser voice processing would reshape loudness and pauses, so turn it off.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
    } catch (e) {
      btn.disabled = false;
      const denied = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
      const missing = e && (e.name === "NotFoundError" || e.name === "OverconstrainedError");
      this.setStatus(denied
        ? `<span class="error">Microphone access was blocked.</span> To try it, allow the microphone for this site (click the lock or camera icon in the address bar), then press Record again. Everything else on this site works without it.`
        : missing ? `<span class="error">No microphone was found.</span> Connect one and try again.`
          : `<span class="error">Could not start recording (${PC.esc(e && e.name || "unknown error")}).</span>`);
      return;
    }
    const chunks = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    const done = new Promise(res => (rec.onstop = res));
    rec.start();
    for (let s = VOICE_SECONDS; s > 0; s--) {
      this.setStatus(`<b>Recording... ${s}</b> Read any sentence aloud in your own language.`);
      await new Promise(r => setTimeout(r, 1000));
    }
    rec.stop();
    await done;
    stream.getTracks().forEach(t => t.stop());
    this.setStatus("Analysing on your device...");
    try {
      const blob = new Blob(chunks, { type: rec.mimeType });
      const x = await this.decodeTo16k(blob);
      await this.analyse(x, blob);
    } catch (e) {
      this.setStatus(`<span class="error">Could not analyse the recording (${PC.esc(e.message || e)}).</span> Please try again.`);
    }
    btn.disabled = false;
    btn.innerHTML = "&#9679; Record again";
  },

  async decodeTo16k(blob) {
    const buf = await blob.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const audio = await ctx.decodeAudioData(buf);
    ctx.close();
    const len = Math.ceil(audio.duration * Fingerprint.SR);
    const off = new OfflineAudioContext(1, len, Fingerprint.SR);
    const src = off.createBufferSource();
    src.buffer = audio;
    src.connect(off.destination);
    src.start();
    const out = await off.startRendering();
    return out.getChannelData(0);
  },

  async analyse(x, blob) {
    const M = await this.loadModel();
    const r = Fingerprint.analyze(x);
    const [ok, reason] = Fingerprint.passesQuality(r);
    if (!ok) {
      this.setStatus(`<span class="error">We could not hear enough speech (${PC.esc(reason)}).</span> Try again a little closer to the microphone, speaking continuously for the full 5 seconds.`);
      return;
    }
    // standardized prosody, then remove the part predicted by this recording's background noise
    const z = M.features.map((f, j) => (r.features[f] - M.p_mean[j]) / M.p_scale[j]);
    const sf = Fingerprint.silenceFeatures(x, M.mel);
    let ctl, noiseNote = "";
    if (sf) {
      const s = M.sil_features.map((f, j) => (sf[f] - M.s_mean[j]) / M.s_scale[j]);
      ctl = z.map((v, j) => v - (M.reg_intercept[j] + M.reg_coef[j].reduce((acc, c, q) => acc + c * s[q], 0)));
    } else {
      ctl = z.map((v, j) => v - M.reg_intercept[j]);
      noiseNote = " There was almost no silence in your recording, so the background-noise correction used an average.";
    }
    const vecs = { controlled: ctl, raw: z };
    const place = {};
    const votes = {};
    Object.entries(PC.data.map.views).forEach(([key, view]) => {
      const X = view.X, k = view.k;
      const d = X.map(row => Math.sqrt(row.reduce((acc, v, j) => acc + (v - vecs[key.split("_")[0]][j]) ** 2, 0)));
      const idx = d.map((v, i) => i).sort((a, b) => d[a] - d[b]).slice(0, k);
      const w = idx.map(i => 1 / (d[i] + 1e-6)), W = w.reduce((a, b) => a + b, 0);
      place[key] = [0, 1].map(c => idx.reduce((acc, i, n) => acc + view.xy[i][c] * w[n], 0) / W);
      const langArr = PC.data.map[key.split("_")[1]].lang;
      const v = {};
      idx.forEach((i, n) => (v[langArr[i]] = (v[langArr[i]] || 0) + w[n] / W));
      votes[key] = v;
    });
    PC.userPoint = { views: place, votes };
    PC.emit("userpoint");
    this.render(r, votes, blob, noiseNote);
  },

  render(r, votes, blob, noiseNote) {
    const key = PC.viewKey();
    const ranked = Object.entries(votes[`${PC.state.space}_clips`]).sort((a, b) => b[1] - a[1]);
    const c = {
      t0: r.info.a * 0.01, dt: 0.02, dur: r.info.dur + r.info.a * 0.01 + 0.2,
      st: Array.from(r.info.st.slice(r.info.a, r.info.b + 1)).filter((_, i) => i % 2 === 0).map(v => (Number.isFinite(v) ? v : null)),
      nuc: r.info.nuclei.map(i => i * 0.01),
    };
    const url = URL.createObjectURL(blob); // local object URL; the audio never leaves this device
    document.getElementById("voice-result").innerHTML = `
      <h3>Your rhythm sounds closest to</h3>
      <ol class="neighbours">${ranked.slice(0, 3).map(([li, s]) => `<li><div class="nb-top"><span class="nb-name">${PC.swatchSVG(+li)} ${PC.esc(PC.langName(+li))}</span><span class="nb-score">${Math.round(s * 100)}%</span></div>
        <div class="nb-bar"><span style="width:${Math.round(s * 100)}%;background:${PC.langColor(+li)}"></span></div>
        <div class="nb-sub"><span>share of your ${PC.data.map.views[`${PC.state.space}_clips`].k} nearest clips (weighted by closeness)</span>
        <button class="btn small secondary" data-play="${li}">&#9654; Play a clip</button></div></li>`).join("")}</ol>
      <p class="hint">This compares only rhythm and melody with ${PC.data.languages.languages.length} languages in the map. If your language is not among them, it shows which of these your cadence resembles most.${noiseNote}</p>
      <div class="controls"><a class="btn" href="#map" id="voice-see">See yourself on the sound map</a> <audio controls src="${url}"></audio></div>
      <h3>Your melody</h3><div class="contour" id="voice-contour"></div>`;
    document.querySelectorAll("#voice-result [data-play]").forEach(b => b.addEventListener("click", () => Player.play(PC.randomClipOf(+b.dataset.play))));
    document.getElementById("voice-see").addEventListener("click", () => {
      PC.state.mode = "sound";
      if (MapView.svg) MapView.setMode("sound");
    });
    drawContour(document.getElementById("voice-contour"), c, "var(--ink)").full();
    this.setStatus("Done. Your star is now on the sound map.");
  },
};
window.VoiceView = VoiceView;
