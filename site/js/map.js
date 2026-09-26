// Map tab: neighbours panel, plus two views of the languages: the world map (where each
// is spoken, js/world.js) and the sound map (every clip placed by its prosody).
const MapView = {
  init() {
    const langs = PC.data.languages.languages;
    const sel = document.getElementById("lang-select");
    sel.innerHTML = langs.map((l, i) => `<option value="${i}">${PC.esc(l.name)} (${PC.esc(l.family)})</option>`).join("");
    sel.addEventListener("change", () => {
      PC.state.lang = +sel.value;
      this.renderSide();
      this.highlight();
      WorldView.render();
      if (WorldView.card && !WorldView.card.hidden) WorldView.openCard(PC.state.lang);
    });
    document.querySelectorAll(".map-area .seg button").forEach(b => b.addEventListener("click", () => {
      const key = Object.keys(b.dataset)[0];
      if (key === "mode") return this.setMode(b.dataset.mode);
      PC.state[key] = b.dataset[key];
      b.parentElement.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
      this.renderSide();
      this.renderMap();
      WorldView.render();
    }));
    document.getElementById("play-self").addEventListener("click", () => Player.play(PC.randomClipOf(PC.state.lang)));
    document.getElementById("audio-note").textContent = (window.PC_CONFIG && PC_CONFIG.audio)
      ? "Playing the original Common Voice recordings (local demo build)."
      : "You hear a rhythm sketch: a tone that follows each clip's pitch melody, with soft clicks on its syllable-like beats. Original recordings are not shared online, to respect the dataset license and the speakers' privacy.";
    this.buildSvg();
    this.renderSide();
    this.renderMap();
    WorldView.init().catch(e => {
      document.getElementById("world").innerHTML = `<p class="error" style="padding:1rem">Could not load the world map (${PC.esc(e.message)}).</p>`;
    });
    window.addEventListener("resize", () => { this.renderMap(); WorldView.render(); });
    this.setMode(PC.state.mode);
    PC.on("play", cur => this.showNowPlaying(cur));
    PC.on("tick", cur => this.np && this.np.at(cur.t));
    PC.on("userpoint", () => this.renderMap());
  },

  setMode(mode) {
    PC.state.mode = mode;
    document.querySelectorAll('.map-area [data-mode]').forEach(x => x.classList.toggle("on", x.dataset.mode === mode));
    document.getElementById("world").hidden = mode !== "world";
    document.getElementById("map").hidden = mode !== "sound";
    if (mode !== "world") WorldView.closeCard();
    this.renderSide();
    if (mode === "world") WorldView.render(); else this.renderMap();
  },

  renderSide() {
    const i = PC.state.lang, L = PC.data.languages.languages[i];
    document.getElementById("self-name").textContent = L.name;
    document.getElementById("lang-meta").innerHTML =
      `${PC.swatchSVG(i)} ${PC.esc(L.family)} &middot; ${L.clips} clips from ${L.speakers} speakers` +
      (L.caveat ? `<br><span class="caveat">Few speakers: treat with caution</span>` : "");
    const nb = PC.data.map.neighbours[PC.viewKey()][L.name];
    const maxSim = Math.max(...nb.map(n => n.similarity));
    const ol = document.getElementById("neighbour-list");
    ol.innerHTML = nb.map((n, r) => {
      const j = PC.langIndex(n.language);
      const sib = PC.isSibling(L.name, n.language) ? `<span class="sib-tag" title="Linguists consider these close relatives">known sibling</span>` : "";
      return `<li>
        <div class="nb-top"><span class="nb-name">${PC.swatchSVG(j)} ${r + 1}. ${PC.esc(n.language)} ${sib}</span>
          <span class="nb-score">${n.similarity.toFixed(2)}</span></div>
        <div class="nb-bar"><span style="width:${(100 * n.similarity / maxSim).toFixed(0)}%;background:${PC.langColor(j)}"></span></div>
        <div class="nb-sub"><span>${PC.esc(PC.data.languages.languages[j].family)}</span>
          <button class="btn small secondary" data-play="${j}">&#9654; Play a clip</button></div>
      </li>`;
    }).join("");
    ol.querySelectorAll("[data-play]").forEach(b =>
      b.addEventListener("click", () => Player.play(PC.randomClipOf(+b.dataset.play))));
    document.getElementById("lang-select").value = i;
    const space = PC.state.space === "controlled"
      ? "Rhythm only: the part of each feature that background noise can predict has been removed, so the map reflects speech rather than microphones."
      : "Raw: features as measured. Recording conditions (microphones, rooms) also shape this view.";
    const level = PC.state.level === "clips" ? "Each point is one clip." : "Each point is one speaker, averaged over 5 clips.";
    const nbBasis = PC.state.level === "clips" ? "single clips" : "speaker averages";
    document.getElementById("map-caption").textContent = PC.state.mode === "sound"
      ? `${level} ${space} Nearby points have similar rhythm and melody. Hover to see the language, click to listen, scroll or pinch to zoom.`
      : `Each dot marks where a language is spoken; shaded countries show where the chosen language is used. Dashed lines join it to its 3 closest rhythmic neighbors (thicker = closer), measured on ${nbBasis}. Click a dot to read about the language, scroll or pinch to zoom.`;
  },

  buildSvg() {
    const el = document.getElementById("map");
    this.svg = d3.select(el).append("svg");
    this.g = this.svg.append("g");
    this.zoom = d3.zoom().scaleExtent([0.7, 12]).on("zoom", e => {
      this.g.attr("transform", e.transform);
      this.g.selectAll(".pt").attr("transform", d => `translate(${d.px},${d.py}) scale(${1 / e.transform.k})${d.rot}`);
      this.g.selectAll(".me-star").attr("transform", d => `translate(${d.px},${d.py}) scale(${1 / e.transform.k})`);
    });
    this.svg.call(this.zoom);
    const zb = d3.select(el).append("div").attr("class", "zoom-btns");
    zb.append("button").attr("aria-label", "Zoom in").text("+").on("click", () => this.svg.transition().call(this.zoom.scaleBy, 1.5));
    zb.append("button").attr("aria-label", "Zoom out").text("−").on("click", () => this.svg.transition().call(this.zoom.scaleBy, 1 / 1.5));
    zb.append("button").attr("aria-label", "Reset zoom").text("↺").on("click", () => this.svg.transition().call(this.zoom.transform, d3.zoomIdentity));
  },

  renderMap() {
    const el = document.getElementById("map");
    const w = el.clientWidth, h = el.clientHeight;
    this.renderLegend();
    if (!w || !h) return;  // sound map hidden
    this.svg.attr("viewBox", `0 0 ${w} ${h}`);
    const view = PC.data.map.views[PC.viewKey()];
    const lvl = PC.state.level;
    const langArr = PC.data.map[lvl].lang;
    const pad = 28;
    const xs = view.xy.map(p => p[0]), ys = view.xy.map(p => p[1]);
    const x = d3.scaleLinear().domain(d3.extent(xs)).range([pad, w - pad]);
    const y = d3.scaleLinear().domain(d3.extent(ys)).range([h - pad, pad]);
    this.scales = { x, y };
    const size = lvl === "clips" ? (w < 600 ? 34 : 48) : (w < 600 ? 90 : 130);
    const langs = PC.data.languages.languages;
    const pts = view.xy.map((p, k) => {
      const li = langArr[k], L = langs[li];
      return { k, li, px: x(p[0]), py: y(p[1]), marker: L.marker, rot: L.marker === "triangle-down" ? " rotate(180)" : "" };
    });
    const k = d3.zoomTransform(this.svg.node()).k;
    this.g.selectAll(".pt").data(pts, d => `${lvl}-${d.k}`).join("path")
      .attr("class", "pt")
      .attr("d", d => PC.symbolPath(d.marker, size))
      .attr("transform", d => `translate(${d.px},${d.py}) scale(${1 / k})${d.rot}`)
      .on("mouseenter", (e, d) => this.tip(e, d))
      .on("mousemove", (e, d) => this.tip(e, d))
      .on("mouseleave", () => (document.getElementById("tooltip").hidden = true))
      .on("click", (e, d) => this.clickPoint(d));
    this.colorPoints();
    this.highlight();
    // user's own recording, if any
    const up = PC.userPoint && PC.userPoint.views[PC.viewKey()];
    const me = this.g.selectAll(".me-star").data(up ? [{ px: x(up[0]), py: y(up[1]) }] : []);
    me.join(enter => {
      const gg = enter.append("g").attr("class", "me-star");
      gg.append("path").attr("d", d3.symbol(d3.symbolStar, 520)()).attr("fill", "var(--ink)").attr("stroke", "var(--surface)").attr("stroke-width", 2);
      gg.append("text").attr("y", -20).attr("text-anchor", "middle").attr("font-weight", 700).attr("fill", "var(--ink)").text("You");
      return gg;
    }).attr("transform", d => `translate(${d.px},${d.py}) scale(${1 / k})`);
    this.renderLegend();
  },

  // Colour = family; marker shape tells languages of one family apart.
  colorPoints() {
    this.g.selectAll(".pt").attr("fill", d => PC.langColor(d.li));
  },

  highlight() {
    const i = PC.state.lang;
    this.g.selectAll(".pt").classed("dim", d => d.li !== i && !this.isTopNeighbour(d.li));
    this.g.selectAll(".pt").filter(d => d.li === i).raise();
  },

  isTopNeighbour(li) {
    const nb = PC.data.map.neighbours[PC.viewKey()][PC.langName(PC.state.lang)];
    return nb[0] && nb[0].language === PC.langName(li);
  },

  renderLegend() {
    const langs = PC.data.languages.languages;
    const html = PC.data.languages.families.map(f =>
      `<span class="lg-fam"><b>${PC.esc(f.name)}</b>${langs.map((l, i) => l.family === f.name
        ? `<span>${PC.swatchSVG(i)} ${PC.esc(l.name)}</span>` : "").join("")}</span>`).join("");
    const note = PC.state.mode === "sound"
      ? "Colour shows the language family; shape tells its languages apart. Bright: the chosen language and its nearest neighbor. Faded: the rest."
      : "Colour shows the language family; shape tells its languages apart.";
    document.getElementById("legend").innerHTML = html + `<span class="lg-note">${note}</span>`;
  },

  tip(e, d) {
    const t = document.getElementById("tooltip");
    const L = PC.data.languages.languages[d.li];
    t.innerHTML = `<b>${PC.esc(L.name)}</b> &middot; ${PC.esc(L.family)}<br>${PC.state.level === "clips" ? "one clip" : "one speaker (5 clips)"}. Click to listen.`;
    t.hidden = false;
    t.style.left = `${Math.min(e.clientX + 14, window.innerWidth - 270)}px`;
    t.style.top = `${e.clientY + 14}px`;
  },

  clickPoint(d) {
    const clip = PC.state.level === "clips"
      ? PC.data.map.clips.ref[d.k]
      : PC.data.map.speakers.members[d.k][0];
    Player.play(clip);
  },

  showNowPlaying(cur) {
    const el = document.getElementById("now-playing");
    el.hidden = false;
    const L = PC.data.languages.languages[cur.lang];
    el.innerHTML = `<div class="nb-top"><span class="nb-name">${PC.swatchSVG(cur.lang)} Now playing: ${PC.esc(L.name)}</span>
      <a href="#fingerprint" class="btn small secondary" id="np-open">Open fingerprint</a></div><div class="contour"></div>`;
    this.np = drawContour(el.querySelector(".contour"), cur.contour, PC.langColor(cur.lang), { compact: true });
    PC.lastClip = cur.clip;
  },
};
