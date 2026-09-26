// World map: where each language is spoken. Dots sit on a representative point of the
// speaking area; clicking one opens a card about the language. Dashed lines join the
// chosen language to its closest rhythmic neighbors, however far apart they live.
const WorldView = {
  async init() {
    const el = document.getElementById("world");
    const topo = await fetch("data/world-50m.json").then(r => r.json());
    this.countries = topojson.feature(topo, topo.objects.countries).features;
    this.borders = topojson.mesh(topo, topo.objects.countries, (a, b) => a !== b);
    this.langs = PC.data.languages.languages
      .map((L, i) => ({ ...L, i }))
      .filter(L => Number.isFinite(L.lat) && Number.isFinite(L.lon));

    this.svg = d3.select(el).append("svg").attr("role", "img")
      .attr("aria-label", "World map with a dot where each language is spoken");
    this.gMap = this.svg.append("g");
    this.gTop = this.svg.append("g");
    this.gMap.append("path").attr("class", "w-sphere");
    this.gMap.append("g").attr("class", "w-countries");
    this.gMap.append("path").attr("class", "w-borders");
    this.gMap.append("g").attr("class", "w-arcs");

    // Plain mouse-wheel scrolling scrolls the page; zooming needs Ctrl/Cmd + scroll
    // (a trackpad pinch sends ctrlKey), a touch pinch, or the buttons.
    this.zoom = d3.zoom().scaleExtent([1, 12])
      .filter(e => e.type === "wheel" ? (e.ctrlKey || e.metaKey) : (!e.ctrlKey && !e.button))
      .on("zoom", e => {
        this.t = e.transform;
        this.gMap.attr("transform", this.t);
        this.drawDots();
        this.resetBtn.hidden = this.t.k <= this.fitK * 1.05;
      });
    this.svg.call(this.zoom).on("dblclick.zoom", null);
    this.hint = d3.select(el).append("div").attr("class", "w-hint").attr("hidden", true)
      .text(`Hold ${/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"} and scroll to zoom the map`).node();
    this.svg.on("wheel.hint", e => {
      if (e.ctrlKey || e.metaKey) return;
      this.hint.hidden = false;
      clearTimeout(this.hintTimer);
      this.hintTimer = setTimeout(() => (this.hint.hidden = true), 1500);
    });
    this.resetBtn = d3.select(el).append("button").attr("class", "btn small w-reset").attr("hidden", true)
      .text("Show whole world").on("click", () => this.fitAll(true)).node();
    this.svg.on("click", e => { if (e.target === this.svg.node() || e.target.closest(".w-countries, .w-sphere")) this.closeCard(); });
    const zb = d3.select(el).append("div").attr("class", "zoom-btns");
    zb.append("button").attr("aria-label", "Zoom in").text("+").on("click", () => this.svg.transition().call(this.zoom.scaleBy, 1.6));
    zb.append("button").attr("aria-label", "Zoom out").text("−").on("click", () => this.svg.transition().call(this.zoom.scaleBy, 1 / 1.6));
    zb.append("button").attr("aria-label", "Show all languages").text("↺").on("click", () => this.fitAll(true));

    // The card sits in a wrapper outside the map box so that on phones it can flow below the map.
    const wrap = document.createElement("div");
    wrap.className = "world-wrap";
    el.parentNode.insertBefore(wrap, el);
    wrap.appendChild(el);
    this.card = d3.select(wrap).append("div").attr("class", "w-card").attr("hidden", true).node();
    this.t = d3.zoomIdentity;
    this.fitK = 1;
    this.ready = true;
    this.render(true);
  },

  // Full redraw (size, theme or selection changed). fit=true also re-frames the view.
  render(fit = false) {
    if (!this.ready) return;
    const el = document.getElementById("world");
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    const sized = w !== this.w || h !== this.h;
    this.w = w; this.h = h;
    this.svg.attr("viewBox", `0 0 ${w} ${h}`);
    this.proj = d3.geoNaturalEarth1().fitExtent([[6, 6], [w - 6, h - 6]], { type: "Sphere" });
    this.path = d3.geoPath(this.proj);
    this.zoom.translateExtent([[0, 0], [w, h]]).extent([[0, 0], [w, h]]);

    const sel = PC.data.languages.languages[PC.state.lang];
    const shaded = new Set(sel.countries || []);
    this.gMap.select(".w-sphere").attr("d", this.path({ type: "Sphere" }));
    this.gMap.select(".w-countries").selectAll("path").data(this.countries, d => d.id).join("path")
      .attr("d", this.path)
      .attr("class", d => shaded.has(d.id) ? "w-land on" : "w-land")
      .style("fill", d => shaded.has(d.id) ? PC.langColor(PC.state.lang) : null);
    this.gMap.select(".w-countries").selectAll("path.on").each(function () { this.parentNode.appendChild(this); });
    this.gMap.select(".w-borders").attr("d", this.path(this.borders));
    this.drawArcs();
    if (fit || sized) this.fitAll(false);
    else this.drawDots();
  },

  // Frame all language dots with some padding.
  fitAll(animate) {
    const pts = this.langs.map(L => this.proj([L.lon, L.lat]));
    const [x0, x1] = d3.extent(pts, p => p[0]), [y0, y1] = d3.extent(pts, p => p[1]);
    const pad = 70;
    const k = Math.max(1, Math.min(8, 0.95 / Math.max((x1 - x0 + 2 * pad) / this.w, (y1 - y0 + 2 * pad) / this.h)));
    const t = d3.zoomIdentity.translate(this.w / 2, this.h / 2).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    this.fitK = k;
    (animate ? this.svg.transition().duration(600) : this.svg).call(this.zoom.transform, t);
  },

  // Great-circle lines from the chosen language to its 3 closest rhythmic neighbors.
  drawArcs() {
    const me = PC.data.languages.languages[PC.state.lang];
    const nb = (PC.data.map.neighbours[PC.viewKey()][me.name] || []).slice(0, 3);
    const arcs = Number.isFinite(me.lat) ? nb.map((n, r) => {
      const L = PC.data.languages.languages[PC.langIndex(n.language)];
      return Number.isFinite(L.lat) ? { r, name: n.language, geo: { type: "LineString", coordinates: [[me.lon, me.lat], [L.lon, L.lat]] } } : null;
    }).filter(Boolean) : [];
    this.gMap.select(".w-arcs").selectAll("path").data(arcs, d => d.name).join("path")
      .attr("class", "w-arc")
      .attr("d", d => this.path(d.geo))
      .attr("stroke-width", d => [3, 2, 1.25][d.r]);
  },

  // Dots and labels live in screen space so they keep their size while zooming.
  // Dots that would overlap are nudged apart, with a thin leader line to the true spot.
  drawDots() {
    const t = this.t || d3.zoomIdentity;
    const nodes = this.langs.map(L => {
      const [x, y] = t.apply(this.proj([L.lon, L.lat]));
      return { L, x0: x, y0: y, x, y };
    });
    const sim = d3.forceSimulation(nodes)
      .force("x", d3.forceX(d => d.x0).strength(0.4))
      .force("y", d3.forceY(d => d.y0).strength(0.4))
      .force("c", d3.forceCollide(13))
      .stop();
    for (let i = 0; i < 120; i++) sim.tick();

    const selI = PC.state.lang;
    const top = new Set((PC.data.map.neighbours[PC.viewKey()][PC.langName(selI)] || []).slice(0, 3).map(n => n.language));
    const g = this.gTop.selectAll("g.w-dot").data(nodes, d => d.L.name).join(enter => {
      const gg = enter.append("g").attr("class", "w-dot").attr("tabindex", 0).attr("role", "button");
      gg.append("line").attr("class", "w-leader");
      gg.append("path").attr("class", "w-mark");
      gg.append("text").attr("class", "w-label");
      gg.on("click", (e, d) => { e.stopPropagation(); this.select(d.L.i); })
        .on("keydown", (e, d) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.select(d.L.i); } })
        .on("mouseenter mousemove", (e, d) => this.tip(e, d.L))
        .on("mouseleave", () => (document.getElementById("tooltip").hidden = true));
      return gg;
    });
    g.attr("aria-label", d => `${d.L.name}, ${d.L.family}. Show details.`)
      .classed("sel", d => d.L.i === selI)
      .classed("nb", d => top.has(d.L.name));
    g.select(".w-leader")
      .attr("x1", d => d.x0).attr("y1", d => d.y0).attr("x2", d => d.x).attr("y2", d => d.y)
      .attr("visibility", d => Math.hypot(d.x - d.x0, d.y - d.y0) > 3 ? "visible" : "hidden");
    g.select(".w-mark")
      .attr("d", d => PC.symbolPath(d.L.marker, d.L.i === selI ? 260 : 150))
      .attr("transform", d => `translate(${d.x},${d.y})${d.L.marker === "triangle-down" ? " rotate(180)" : ""}`)
      .attr("fill", d => PC.langColor(d.L.i));
    const off = { left: [-12, 4, "end"], right: [12, 4, "start"], top: [0, -13, "middle"], bottom: [0, 20, "middle"] };
    g.select(".w-label")
      .attr("x", d => d.x + off[d.L.label || "right"][0])
      .attr("y", d => d.y + off[d.L.label || "right"][1])
      .attr("text-anchor", d => off[d.L.label || "right"][2])
      .text(d => d.L.name);
    g.filter(d => d.L.i === selI).raise();
  },

  select(i) {
    PC.state.lang = i;
    MapView.renderSide();
    MapView.highlight();
    this.render();
    this.openCard(i);
  },

  openCard(i) {
    const L = PC.data.languages.languages[i];
    const nb = (PC.data.map.neighbours[PC.viewKey()][L.name] || []).slice(0, 3);
    const row = (k, v) => v ? `<dt>${k}</dt><dd>${PC.esc(v)}</dd>` : "";
    this.card.innerHTML = `
      <button class="w-close" aria-label="Close">&times;</button>
      <h3>${PC.swatchSVG(i, 16)} ${PC.esc(L.name)}</h3>
      <p class="w-fam">${PC.esc(L.family)} family</p>
      ${L.about ? `<p>${PC.esc(L.about)}</p>` : ""}
      <dl>${row("Where", L.where)}${row("Speakers", L.speakers_est)}
        <dt>In our data</dt><dd>${L.clips} Common Voice clips from ${L.speakers} speakers${L.caveat ? ` <span class="caveat">few speakers</span>` : ""}</dd>
        <dt>Closest in rhythm</dt><dd>${nb.map((n, r) => `${r + 1}. ${PC.esc(n.language)}${PC.isSibling(L.name, n.language) ? " (known relative)" : ""}`).join("<br>")}</dd>
      </dl>
      <div class="w-actions">
        <button class="btn small" data-act="play">&#9654; Hear a clip</button>
        <button class="btn small secondary" data-act="sound">See on sound map</button>
      </div>`;
    this.card.hidden = false;
    // Keep the card on the side of the map away from the clicked dot.
    const p = this.proj && this.t.apply(this.proj([L.lon, L.lat]));
    this.card.classList.toggle("right", !!p && p[0] < this.w / 2);
    this.card.querySelector(".w-close").addEventListener("click", () => this.closeCard());
    this.card.querySelector('[data-act="play"]').addEventListener("click", () => Player.play(PC.randomClipOf(i)));
    this.card.querySelector('[data-act="sound"]').addEventListener("click", () => MapView.setMode("sound"));
  },

  closeCard() { if (this.card) this.card.hidden = true; },

  tip(e, L) {
    const t = document.getElementById("tooltip");
    t.innerHTML = `<b>${PC.esc(L.name)}</b> &middot; ${PC.esc(L.family)}<br>${PC.esc(L.where || "")}<br>Click for details.`;
    t.hidden = false;
    t.style.left = `${Math.min(e.clientX + 14, window.innerWidth - 270)}px`;
    t.style.top = `${e.clientY + 14}px`;
  },
};
