// Shared data, state and helpers.
const PC = {
  data: {},
  state: { space: "controlled", level: "clips", color: "language", lang: 0 },
  listeners: {},
  on(evt, fn) { (this.listeners[evt] = this.listeners[evt] || []).push(fn); },
  emit(evt, arg) { (this.listeners[evt] || []).forEach(fn => fn(arg)); },
};

PC.load = async function () {
  const get = f => fetch(`data/${f}`).then(r => { if (!r.ok) throw new Error(f); return r.json(); });
  const [languages, map, validation] = await Promise.all([get("languages.json"), get("map.json"), get("validation.json")]);
  PC.data.languages = languages;
  PC.data.map = map;
  PC.data.validation = validation;
  // contours are large; load in the background
  PC.data.contoursReady = get("contours.json").then(c => (PC.data.contours = c));
};

PC.isDark = () => {
  const t = document.documentElement.getAttribute("data-theme");
  if (t) return t === "dark";
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
};
PC.langColor = i => { const L = PC.data.languages.languages[i]; return PC.isDark() ? L.color_dark : L.color; };
PC.familyColor = name => {
  const f = PC.data.languages.families.find(x => x.name === name);
  return PC.isDark() ? f.color_dark : f.color;
};
PC.symbol = {
  circle: d3.symbolCircle, square: d3.symbolSquare, triangle: d3.symbolTriangle,
  diamond: d3.symbolDiamond, "triangle-down": d3.symbolTriangle,
};
PC.symbolPath = (marker, size) => {
  const p = d3.symbol(PC.symbol[marker] || d3.symbolCircle, size)();
  return p;
};
PC.langName = i => PC.data.languages.languages[i].name;
PC.langIndex = name => PC.data.languages.languages.findIndex(l => l.name === name);
PC.isSibling = (a, b) => (PC.data.languages.sibling_pairs || []).some(
  ([x, y]) => (x === a && y === b) || (x === b && y === a));
PC.viewKey = () => `${PC.state.space}_${PC.state.level}`;

// A random clip (index into contours) of language i
PC.randomClipOf = i => {
  const refs = PC.data.map.clips.ref.filter((_, k) => PC.data.map.clips.lang[k] === i);
  return refs[Math.floor(Math.random() * refs.length)];
};

// Tiny swatch: coloured marker shape as inline SVG
PC.swatchSVG = (i, size = 14) => {
  const L = PC.data.languages.languages[i];
  const rot = L.marker === "triangle-down" ? ' transform="rotate(180)"' : "";
  return `<svg class="swatch" viewBox="-8 -8 16 16" width="${size}" height="${size}" aria-hidden="true">` +
    `<path d="${PC.symbolPath(L.marker, 90)}" fill="${PC.langColor(i)}"${rot}/></svg>`;
};

PC.fmtPct = v => `${Math.round(v * 100)}%`;
PC.esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
