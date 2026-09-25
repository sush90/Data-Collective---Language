// Plays a clip: the real recording in the local demo build, otherwise a rhythm
// sonification (a tone following the pitch contour plus soft clicks at the
// syllable-like beats), generated in the browser from precomputed JSON.
const Player = {
  ctx: null, nodes: [], audio: null, raf: null, current: null,

  getCtx() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  },

  stop() {
    this.nodes.forEach(n => { try { n.stop(); } catch (e) { /* already stopped */ } });
    this.nodes = [];
    if (this.audio) { this.audio.pause(); this.audio = null; }
    cancelAnimationFrame(this.raf);
    if (this.current) PC.emit("stop", this.current);
    this.current = null;
  },

  async play(clipIdx) {
    await PC.data.contoursReady;
    this.stop();
    const c = PC.data.contours.contours[clipIdx];
    const meta = PC.data.contours.clips[clipIdx];
    let clock, duration = c.dur;
    if (window.PC_CONFIG && PC_CONFIG.audio) {
      const a = new Audio(`audio/${meta.file}`);
      this.audio = a;
      await a.play().catch(() => {});
      clock = () => a.currentTime;
      a.onended = () => this.stop();
    } else {
      const ctx = this.getCtx();
      const t0 = ctx.currentTime + 0.05;
      this.sonify(ctx, c, t0);
      clock = () => ctx.currentTime - t0;
    }
    this.current = { clip: clipIdx, lang: meta.l, clock, duration, contour: c };
    PC.emit("play", this.current);
    const tick = () => {
      const t = clock();
      PC.emit("tick", { ...this.current, t });
      if (t < duration + 0.1) this.raf = requestAnimationFrame(tick);
      else this.stop();
    };
    this.raf = requestAnimationFrame(tick);
  },

  sonify(ctx, c, t0) {
    const base = 196; // Hz; the contour is relative, so any comfortable reference pitch works
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    osc.type = "triangle";
    filt.type = "lowpass"; filt.frequency.value = 1800;
    gain.gain.setValueAtTime(0, t0);
    osc.connect(filt).connect(gain).connect(ctx.destination);
    let voiced = false;
    c.st.forEach((v, k) => {
      const t = t0 + c.t0 + k * c.dt;
      if (v !== null) {
        osc.frequency.setValueAtTime(base * Math.pow(2, v / 12), t);
        if (!voiced) gain.gain.setTargetAtTime(0.16, t, 0.01);
        voiced = true;
      } else if (voiced) {
        gain.gain.setTargetAtTime(0, t, 0.015);
        voiced = false;
      }
    });
    gain.gain.setTargetAtTime(0, t0 + c.t0 + c.st.length * c.dt, 0.02);
    osc.start(t0);
    osc.stop(t0 + c.dur + 0.2);
    this.nodes.push(osc);
    // soft clicks at syllable-like beats
    c.nuc.forEach(tn => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = 1320;
      const t = t0 + tn;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.22, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 0.07);
      this.nodes.push(o);
    });
  },
};

// Small pitch-contour drawing that animates with playback. Used on the map and the Fingerprint tab.
function drawContour(el, c, color, opts = {}) {
  el.innerHTML = "";
  const w = el.clientWidth || 600, h = el.clientHeight || 200;
  const m = { l: opts.compact ? 34 : 50, r: 10, t: 10, b: opts.compact ? 22 : 36 };
  const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${w} ${h}`);
  const pts = c.st.map((v, k) => ({ t: c.t0 + k * c.dt, v }));
  const ext = d3.extent(pts.filter(p => p.v !== null), p => p.v);
  const lim = Math.max(6, Math.abs(ext[0] || 0), Math.abs(ext[1] || 0));
  const x = d3.scaleLinear().domain([0, c.dur]).range([m.l, w - m.r]);
  const y = d3.scaleLinear().domain([-lim, lim]).range([h - m.b, m.t]);
  const ink = getComputedStyle(document.documentElement).getPropertyValue("--ink-2");
  const grid = getComputedStyle(document.documentElement).getPropertyValue("--line");
  svg.append("g").attr("transform", `translate(0,${y(0)})`)
    .append("line").attr("x1", m.l).attr("x2", w - m.r).attr("stroke", grid).attr("stroke-dasharray", "4 4");
  svg.append("g").attr("transform", `translate(${m.l},0)`)
    .call(d3.axisLeft(y).ticks(opts.compact ? 3 : 5).tickFormat(d => `${d > 0 ? "+" : ""}${d}`))
    .call(g => g.selectAll("text").attr("fill", ink).style("font-size", opts.compact ? "10px" : "12px"))
    .call(g => g.selectAll("line,path").attr("stroke", grid));
  svg.append("g").attr("transform", `translate(0,${h - m.b})`)
    .call(d3.axisBottom(x).ticks(opts.compact ? 4 : 8).tickFormat(d => `${d}s`))
    .call(g => g.selectAll("text").attr("fill", ink).style("font-size", opts.compact ? "10px" : "12px"))
    .call(g => g.selectAll("line,path").attr("stroke", grid));
  if (!opts.compact) {
    svg.append("text").attr("x", 12).attr("y", h / 2).attr("transform", `rotate(-90,12,${h / 2})`)
      .attr("text-anchor", "middle").attr("fill", ink).style("font-size", "12px").text("semitones from own median");
  }
  // beats
  svg.append("g").selectAll("line").data(c.nuc).join("line")
    .attr("x1", d => x(d)).attr("x2", d => x(d)).attr("y1", h - m.b).attr("y2", h - m.b - 8)
    .attr("stroke", ink).attr("stroke-width", 2);
  const line = d3.line().defined(p => p.v !== null).x(p => x(p.t)).y(p => y(p.v)).curve(d3.curveMonotoneX);
  svg.append("path").datum(pts).attr("d", line).attr("fill", "none").attr("stroke", grid).attr("stroke-width", 2);
  const live = svg.append("path").attr("fill", "none").attr("stroke", color).attr("stroke-width", 3)
    .attr("stroke-linecap", "round");
  const head = svg.append("line").attr("y1", m.t).attr("y2", h - m.b).attr("stroke", color).attr("opacity", .5);
  const api = {
    at(t) {
      live.datum(pts.filter(p => p.t <= t)).attr("d", line);
      head.attr("x1", x(Math.min(t, c.dur))).attr("x2", x(Math.min(t, c.dur)));
    },
    full() { live.datum(pts).attr("d", line); head.attr("opacity", 0); },
  };
  api.at(0);
  return api;
}
