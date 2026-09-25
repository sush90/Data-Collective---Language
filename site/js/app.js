// Tab routing and start-up.
const TABS = ["map", "fingerprint", "voice", "validation", "about"];
const inited = {};

function showTab() {
  const name = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "map";
  TABS.forEach(t => (document.getElementById(`tab-${t}`).hidden = t !== name));
  document.querySelectorAll(".tabs a").forEach(a => a.classList.toggle("active", a.dataset.tab === name));
  if (!inited[name]) {
    inited[name] = true;
    const init = { map: () => MapView.init(), fingerprint: () => window.FingerprintView && FingerprintView.init(),
      voice: () => window.VoiceView && VoiceView.init(), validation: () => Pages.validation(), about: () => Pages.about() }[name];
    init();
  } else if (name === "map") {
    MapView.renderMap();
  } else if (name === "fingerprint" && window.FingerprintView) {
    FingerprintView.onShow();
  }
}

(async function () {
  try {
    await PC.load();
  } catch (e) {
    document.querySelector("main").innerHTML = `<p class="error">Could not load data (${PC.esc(e.message)}). If you opened index.html directly from disk, serve the folder instead: <code>python -m http.server</code> inside site/.</p>`;
    return;
  }
  window.addEventListener("hashchange", showTab);
  showTab();
})();
