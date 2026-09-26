// Try Your Voice: record 3 sentences of ~5 s, fingerprint them on this device, place them on the map.
// Nothing is uploaded: the audio stays in this page's memory and is discarded on reload.
const VOICE_SECONDS = 5;
const VOICE_TAKES = 3;

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
    // Several short takes, each a different sentence, matched together: in a speaker-disjoint
    // test on the dataset, 3 takes put the right language first 40% of the time vs 33% for one.
    const takes = [];
    const wait = ms => new Promise(r => setTimeout(r, ms));
    try {
      for (let t = 1; t <= VOICE_TAKES; t++) {
        let take = null;
        for (let attempt = 0; attempt < 2 && !take; attempt++) {
          if (t > 1 || attempt > 0) {
            this.setStatus(attempt ? `<b>We couldn't hear enough speech in sentence ${t}.</b> Let's try it once more...`
              : `<b>Good.</b> Get ready for sentence ${t} of ${VOICE_TAKES}...`);
            await wait(1800);
          }
          take = await this.recordTake(stream, t);
        }
        if (take) takes.push(take);
      }
    } catch (e) {
      this.setStatus(`<span class="error">Could not analyse the recording (${PC.esc(e.message || e)}).</span> Please try again.`);
    }
    stream.getTracks().forEach(tr => tr.stop());
    if (takes.length) {
      this.setStatus("Analysing on your device...");
      await this.analyse(takes);
    } else if (!document.querySelector("#rec-status .error")) {
      this.setStatus(`<span class="error">We could not hear enough speech.</span> Try again a little closer to the microphone, speaking continuously for the full ${VOICE_SECONDS} seconds of each sentence.`);
    }
    btn.disabled = false;
    btn.innerHTML = "&#9679; Record again";
  },

  // One take: record, decode and fingerprint. Returns null if it fails the quality gate.
  async recordTake(stream, t) {
    const chunks = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    const done = new Promise(res => (rec.onstop = res));
    rec.start();
    for (let s = VOICE_SECONDS; s > 0; s--) {
      this.setStatus(`<b>Sentence ${t} of ${VOICE_TAKES}: recording... ${s}</b> Read any sentence aloud in your own language.`);
      await new Promise(r => setTimeout(r, 1000));
    }
    rec.stop();
    await done;
    const blob = new Blob(chunks, { type: rec.mimeType });
    const x = await this.decodeTo16k(blob);
    const r = Fingerprint.analyze(x);
    return Fingerprint.passesQuality(r)[0] ? { x, r, blob } : null;
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

  // Noise-controlled fingerprint of one take (same steps as export_site.py).
  controlled(M, take) {
    const z = M.features.map((f, j) => (take.r.features[f] - M.p_mean[j]) / M.p_scale[j]);
    const sf = Fingerprint.silenceFeatures(take.x, M.mel);
    if (!sf) return { z, ctl: z.map((v, j) => v - M.reg_intercept[j]), noNoise: true };
    const s = M.sil_features.map((f, j) => (sf[f] - M.s_mean[j]) / M.s_scale[j]);
    return { z, ctl: z.map((v, j) => v - (M.reg_intercept[j] + M.reg_coef[j].reduce((acc, c, q) => acc + c * s[q], 0))) };
  },

  async analyse(takes) {
    const M = await this.loadModel();
    const fps = takes.map(t => this.controlled(M, t));
    const noiseNote = fps.some(f => f.noNoise)
      ? " One of your recordings had almost no silence, so its background-noise correction used an average." : "";
    const place = {};
    const votes = {};
    Object.entries(PC.data.map.views).forEach(([key, view]) => {
      const [space, level] = key.split("_");
      const langArr = PC.data.map[level].lang;
      // Languages with more points would win votes by default, so divide each language's
      // vote by its share of the points (in the offline test this lifted accuracy).
      const nLang = PC.data.languages.languages.length;
      const share = Array(nLang).fill(0);
      langArr.forEach(l => (share[l] += 1 / langArr.length));
      const sum = Array(nLang).fill(0), xy = [0, 0];
      fps.forEach(fp => {
        const vec = space === "controlled" ? fp.ctl : fp.z;
        const d = view.X.map(row => Math.sqrt(row.reduce((acc, v, j) => acc + (v - vec[j]) ** 2, 0)));
        const idx = d.map((_, i) => i).sort((a, b) => d[a] - d[b]).slice(0, view.k);
        const w = idx.map(i => 1 / (d[i] + 1e-6)), W = w.reduce((a, b) => a + b, 0);
        [0, 1].forEach(c => (xy[c] += idx.reduce((acc, i, n) => acc + view.xy[i][c] * w[n], 0) / W / fps.length));
        const v = Array(nLang).fill(0);
        idx.forEach((i, n) => (v[langArr[i]] += w[n] / share[langArr[i]]));
        const V = v.reduce((a, b) => a + b, 0);
        v.forEach((x, l) => (sum[l] += x / V / fps.length));
      });
      place[key] = xy;
      votes[key] = Object.fromEntries(sum.map((v, l) => [l, v]).filter(([, v]) => v > 0));
    });
    PC.userPoint = { views: place, votes };
    PC.emit("userpoint");
    this.render(takes, votes, noiseNote);
  },

  render(takes, votes, noiseNote) {
    const r = takes[0].r;
    const ranked = Object.entries(votes[`${PC.state.space}_clips`]).sort((a, b) => b[1] - a[1]);
    const c = {
      t0: r.info.a * 0.01, dt: 0.02, dur: r.info.dur + r.info.a * 0.01 + 0.2,
      st: Array.from(r.info.st.slice(r.info.a, r.info.b + 1)).filter((_, i) => i % 2 === 0).map(v => (Number.isFinite(v) ? v : null)),
      nuc: r.info.nuclei.map(i => i * 0.01),
    };
    // local object URLs; the audio never leaves this device
    const players = takes.map(t => `<audio controls src="${URL.createObjectURL(t.blob)}"></audio>`).join(" ");
    document.getElementById("voice-result").innerHTML = `
      <h3>Your rhythm sounds closest to</h3>
      <ol class="neighbours">${ranked.slice(0, 3).map(([li, s]) => `<li><div class="nb-top"><span class="nb-name">${PC.swatchSVG(+li)} ${PC.esc(PC.langName(+li))}</span><span class="nb-score">${Math.round(s * 100)}%</span></div>
        <div class="nb-bar"><span style="width:${Math.round(s * 100)}%;background:${PC.langColor(+li)}"></span></div>
        <div class="nb-sub"><span>match score</span>
        <button class="btn small secondary" data-play="${li}">&#9654; Play a clip</button></div></li>`).join("")}</ol>
      <p class="hint">Match score: for each of your ${takes.length} recording${takes.length > 1 ? "s" : ""}, the ${PC.data.map.views[`${PC.state.space}_clips`].k} most similar dataset clips vote, closer clips counting more, adjusted so that languages with more clips don't win by default; the votes are then averaged.${noiseNote}</p>
      <p class="callout">This is a comparison, not a language detector. From rhythm and melody alone, even on the dataset's own recordings, this method puts the right language first about 4 times in 10 and in the top three about 7 times in 10. Your microphone, your accent, and the variety on the map all matter: our Spanish is Rioplatense (Argentina and Uruguay) and our English is Scottish, and Spanish is the hardest language on the map to recognize. If your language is not on the map, this shows which of these your cadence resembles most.</p>
      <div class="controls"><a class="btn" href="#map" id="voice-see">See yourself on the sound map</a> ${players}</div>
      <h3>Your melody${takes.length > 1 ? " (first sentence)" : ""}</h3><div class="contour" id="voice-contour"></div>`;
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
