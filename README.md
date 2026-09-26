# The Prosodic Commons

Hearing the world's languages by their rhythm. An interactive world map of
10 languages from 6 families, linking each language to its closest rhythmic
neighbours by prosody (pitch movement, rhythm, pauses) instead of by family
tree, plus a sound map that places every recording by its prosody. Built from
Mozilla Common Voice. Prototype for Design for Justice (Mozilla Data
Collective, Brown University).

Languages: Tatar, Bashkir (Turkic); Fang, Ewondo (Bantu); Torwali, Urdu,
Kohistani Shina (Indo-Aryan); Hazaragi (Iranian); Rioplatense Spanish
(Romance); Scottish English (Germanic). Kohistani Shina stands in for
Kashmiri, which has no dataset on Mozilla Data Collective.

* `results_summary.md`: every result, validation, limitations, draft submission answers
* `features.md`: exact fingerprint specification (Python and browser implement it identically)
* `site/`: the public website (static; no build step; no dataset audio)

## Reproduce everything

Requirements: Python 3.11+, ffmpeg, Node 18+ (only for `verify_js.py`).

```bash
# 1. Environment
python3 -m venv .venv
.venv/bin/pip install praat-parselmouth librosa numpy pandas scikit-learn umap-learn \
    matplotlib joblib pyyaml datacollective python-dotenv
brew install ffmpeg node          # macOS; use your package manager elsewhere

# 2. Data: download Common Voice Scripted Speech archives from
#    https://mozilladatacollective.com (log in, open each dataset, Download,
#    accept the terms). Then sample 300 clips per language (never unpacks everything):
.venv/bin/python ingest.py ~/Downloads/cv-corpus-*.tar.gz
#    or, for folders your browser already unpacked:
.venv/bin/python ingest.py path/to/cv-corpus-27.0-2026-09-11/tt
#    speaker panels for speaker-level fingerprints (40 speakers x 8 clips):
.venv/bin/python ingest.py --panel-code tt path/to/cv-corpus-27.0-2026-09-11/tt
#    Common Voice 26.0 regional releases (Rioplatense Spanish, Scottish English)
#    ship only train/dev/test; ingest.py uses their union as validated.tsv.
#    If an archive has no language folder inside, name it in Python:
#    ingest.ingest("archive.tar.gz", 300, 20, code="en-Scottish")

# 3. Pipeline (about 5 minutes in total on a laptop)
.venv/bin/python extract.py          # fingerprints, cached in outputs/features.csv (~20 s)
.venv/bin/python pilot.py            # optional: pilot checks vs Praat, first plot
.venv/bin/python analysis.py         # classifiers, neighbors, validation, figures (~1.5 min)
.venv/bin/python export_site.py      # website data into site/data (~25 s)
.venv/bin/python verify_js.py 20     # JS fingerprint vs Python on 20 clips (must print 0 mismatches)
```

Outputs: `outputs/*.png` (presentation figures), `outputs/results.json`,
`site/data/*.json`.

## Add a new language (one command)

```bash
.venv/bin/python add_language.py --path ~/Downloads/cv-corpus-27.0-2026-09-11-tg.tar.gz --family "Iranian"
# or an unpacked folder, or a folder already under data/:
.venv/bin/python add_language.py --path data/tg --family "Iranian" --name "Tajik"
```

This samples clips, builds a speaker panel, appends the language to
`languages.yaml`, extracts fingerprints, re-runs the analysis and re-exports
the website data. The site reads its language list from `site/data/`, so the new
language appears on the map automatically. To add known sibling pairs or
held-out tests, edit `languages.yaml`; add `lat`, `lon`, `countries`, `where`,
`speakers_est` and `about` there to place the language on the world map (see
the comments at the top of the file). The held-out family test
(`run_held_out_family`) is on now that 6 families are present.

## View the site locally

```bash
cd site && python3 -m http.server 8000      # http://localhost:8000
```

Opening `index.html` directly from disk does not work (browsers block loading
the data files); serve the folder as above.

### Live demo with the original recordings (local only)

```bash
.venv/bin/python build_local.py
cd site_local && python3 -m http.server 8000
```

`site_local/` plays the real Common Voice clips instead of the rhythm sketch.
It is git-ignored and must not be deployed: the Mozilla Data Collective terms
forbid re-hosting the dataset. The public site plays a synthesized rhythm
sketch (a tone following each clip's pitch contour plus clicks on its
syllable-like beats) instead. If the organizers approve hosting clips, set
`audio: true` in `site/config.js` and copy `site_local/audio` into `site/`.

## Deploy to Netlify

The microphone (Try Your Voice) only works over HTTPS. Netlify serves every
site over HTTPS automatically, so no extra setup is needed. `netlify.toml`
sets the publish directory to `site`.

**Option A: Netlify Drop (drag and drop, no account setup)**

1. Run `python export_site.py` if you changed anything.
2. Go to https://app.netlify.com/drop and log in.
3. Drag the **`site`** folder (not the whole project, and never `site_local`) onto the page.
4. Netlify gives you a URL like `https://random-name.netlify.app`. Rename it
   under Site configuration > Change site name.
5. To update later: open the site in Netlify > Deploys, and drag the `site` folder onto the deploy area again.

**Option B: Netlify CLI**

```bash
npm install -g netlify-cli            # or use npx netlify-cli
netlify login                         # opens the browser once
netlify deploy --dir site --prod      # first time: choose "Create & configure a new project"
# later updates: the same deploy command
```

Test the deploy on a phone as well: the layout is responsive and the
microphone works in mobile Chrome and Safari over HTTPS.

## Project layout

| File | Purpose |
|---|---|
| `languages.yaml` | languages, families, sibling pairs, held-out tests |
| `ingest.py` | sample clips and speaker panels from Common Voice archives or folders |
| `prosody.py` | the fingerprint (features.md) |
| `extract.py` | parallel, cached extraction with quality gate |
| `silence.py` | background-noise features (recording-condition check) |
| `analysis.py` | Phase 3 analysis and figures |
| `export_site.py` | website data |
| `verify_js.py` | JS vs Python parity test |
| `build_local.py` | local demo build with audio |
| `add_language.py` | one-command language addition |
| `site/js/fingerprint.js` | browser port of prosody.py |
| `site/js/world.js` | world map (country outlines in `site/data/world-50m.json`, Natural Earth via world-atlas) |

## Data and ethics

Mozilla Common Voice Scripted Speech 27.0, and the 26.0 regional releases for
Rioplatense Spanish and Scottish English, CC0, via the Mozilla Data Collective.
Only audio and anonymous contributor IDs are used; age, gender and accent
fields are never read. We never attempt to identify speakers. Original audio
is not redistributed. Try Your Voice processes audio entirely in the browser;
nothing is uploaded.
