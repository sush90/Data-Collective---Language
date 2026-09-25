# The Prosodic Commons: results summary

All numbers come from `outputs/results.json` and `outputs/site_neighbours.json`,
produced by `python analysis.py` and `python export_site.py`. Figures are in
`outputs/`. Live site: https://prosodic-commons.netlify.app

Current run: **7 languages** (Tatar, Bashkir, Fang, Ewondo, Torwali, Hazargi
(Dari), Urdu), 1,755 clips and 190 speaker averages. With 7 languages, chance
is 14.3%.

## In one paragraph

Using only rhythm and melody (no words, no transcripts, no speaker identity), a
classifier tells seven Common Voice languages apart at **46% balanced accuracy
on single clips and 57% on speaker averages, against 14% chance**, with no
speaker ever appearing in both training and testing. Both known sibling pairs
come out as each other's nearest rhythmic neighbour at the clip level:
**Tatar and Bashkir** (96% of bootstrap resamples) and **Fang and Ewondo**
(75%). The main caveat is serious: **background noise alone predicts the
language at 44%**, almost as well as prosody, so a large part of what separates
these datasets is how and where they were recorded. After removing everything
noise can predict, prosody still reaches 40% (almost 3 times chance) and both
sibling pairs stay each other's nearest neighbour, though less stably (Tatar
and Bashkir 69% of resamples, Fang and Ewondo 44%). **Torwali's nearest
rhythmic neighbour is not Urdu**: it is Bashkir or Tatar, and Urdu ranks 3rd
to 5th depending on the view.

## Data

| Language | Family | Clips kept | Speakers (clip sample) | Speakers in speaker panel | Reliability caveat |
|---|---|---|---|---|---|
| Tatar | Turkic | 262 | 241 | 39 | |
| Bashkir | Turkic | 269 | 269 | 39 | |
| Fang | Bantu | 223 | 38 | 26 | |
| Ewondo | Bantu | 293 | 26 | 21 | fewer than 30 speakers |
| Torwali | Indo-Aryan (Dardic branch) | 291 | 26 | 18 | fewer than 30 speakers |
| Hazargi (Dari) | Iranian | 129 | 7 | 7 | **only 7 speakers** |
| Urdu | Indo-Aryan | 288 | 288 | 40 | |

* Source: Mozilla Common Voice Scripted Speech 27.0 (CC0), via Mozilla Data Collective.
* Clip sample: up to 300 validated clips per language, at most 20 per speaker,
  spread over as many speakers as possible (frozen in `data/<code>/sample.tsv`).
  Hazargi has only 7 speakers, so the cap allows 140 clips.
* Quality gate (features.md section 6) dropped 185 of 1,940 clips: Tatar 38,
  Bashkir 31, **Fang 77 (26%)**, Ewondo 7, Torwali 9, Hazargi 11, Urdu 12.
  Fang clips often contain very little speech.
* Speaker panel: up to 40 speakers with at least 8 clips; each speaker
  fingerprint is the mean of exactly 5 good clips, so speaker averages are
  comparable across languages.
* **Dari:** Mozilla Data Collective has no separate Dari (Afghan Persian)
  dataset. Hazargi (Hazaragi), a Dari variety spoken by the Hazara people, is
  the closest available and is labelled "Hazargi (Dari)".
* Not yet included: Nepali (dataset terms not yet accepted for API download),
  Tajik and Balti. Each is one `add_language.py` command.
* Torwali was relabelled from "Indo-Aryan (Dardic)" to "Indo-Aryan" when Urdu
  was added, so that the family comparison treats them as one family.
* Age and gender columns were never read.

## Method

* **Fingerprint:** 15 prosodic features per clip (features.md), all normalized
  within the utterance: pitch in semitones relative to the clip's own median,
  intensity in dB relative to the clip's own maximum. Pitch uses our own YIN
  implementation so that the browser runs the identical algorithm. Against
  Praat on 50 pilot clips, median pitch disagreement is 0.04 to 0.06
  semitones and gross errors (over 1 semitone) are 1 to 6% of frames.
* **Browser parity:** `verify_js.py` runs the JavaScript fingerprint in Node
  on 20 dataset clips and compares with Python: 0 mismatches across all 31
  features (15 prosodic, 16 background-noise), worst relative difference 9e-14,
  quality-gate decisions identical.
* **Classifiers:** logistic regression and random forest, 5-fold GroupKFold by
  `client_id` for clips (no speaker in both train and test); stratified 5-fold
  for speaker averages (one row per speaker, so also speaker-disjoint).
  Shuffled-label baseline: language labels permuted across speakers, 10 repeats.
* **Neighbours:** Euclidean distance between speaker-balanced language
  centroids in the standardized 15-feature space (each speaker counts once).
  Similarity shown on the site is 1 / (1 + distance). Stability by bootstrap
  over speakers (500 resamples).
* **Noise control:** each prosody feature has the part predictable from the
  16 background-noise features removed by linear regression (never using
  language labels). The website map uses these noise-controlled features by
  default, with a toggle to the raw features.
* **Map:** UMAP (15 neighbours, min_dist 0.3). The browser places new
  recordings by weighted k-nearest-neighbour averaging (k = 15) of exported
  positions; leave-one-out placement error is 11% of the map's average spread
  for clips and 21% for speaker averages.

## 1. Can rhythm tell languages apart?

| Setting | Model | Accuracy | Balanced accuracy | Chance (balanced) | Shuffled labels (balanced) |
|---|---|---|---|---|---|
| Single clips (n = 1,755) | Logistic regression | 43.1% | 45.3% | 14.3% | 15.1% |
| Single clips | Random forest | 44.0% | **45.9%** | 14.3% | 13.9% |
| Speaker averages (n = 190) | Logistic regression | 55.3% | **57.1%** | 14.3% | 15.9% |
| Speaker averages | Random forest | 54.2% | 56.6% | 14.3% | 14.3% |

Majority-class chance is 16.7% for clips and 21.1% for speaker averages. No
shuffled run exceeded 23.4% balanced accuracy.

**Confusions (speaker averages, logistic regression, row = true language):**
Fang is mistaken for Ewondo 27% of the time; Tatar for Bashkir 18% and for
Urdu 15%; Bashkir for Tatar 15%. Hazargi is recognised 71% of the time, but
with only 7 speakers this likely reflects those individuals and their
recording setups as much as the language (`confusion_speakers.png`).

## 2. Rhythmic neighbours

Top 2 neighbours by centroid distance (lower = closer), raw features:

| Language | Clips: 1st, 2nd | Speaker averages: 1st, 2nd |
|---|---|---|
| Tatar | Bashkir 0.71, Torwali 1.06 | **Urdu 0.85**, Bashkir 1.16 |
| Bashkir | Tatar 0.71, Torwali 1.04 | Tatar 1.16, Torwali 1.18 |
| Fang | Ewondo 1.35, Tatar 2.35 | Ewondo 1.39, Torwali 2.50 |
| Ewondo | Fang 1.35, Torwali 1.71 | Fang 1.39, Bashkir 1.50 |
| Torwali | Bashkir 1.04, Tatar 1.06 | Bashkir 1.18, Tatar 1.29 |
| Hazargi (Dari) | Urdu 1.51, Tatar 1.60 | Urdu 1.33, Tatar 1.47 |
| Urdu | Tatar 1.13, Bashkir 1.16 | Tatar 0.85, Hazargi 1.33 |

Noise-controlled ("Rhythm only", the site default), similarity scores:

| Language | Clips: 1st, 2nd | Speaker averages: 1st, 2nd |
|---|---|---|
| Tatar | Bashkir 0.60, Urdu 0.54 | Urdu 0.54, Bashkir 0.52 |
| Bashkir | Tatar 0.60, Urdu 0.57 | Tatar 0.52, Urdu 0.50 |
| Fang | Ewondo 0.51, Hazargi 0.41 | Ewondo 0.54, Torwali 0.42 |
| Ewondo | Fang 0.51, Torwali 0.51 | Fang 0.54, Torwali 0.49 |
| Torwali | Tatar 0.51, Ewondo 0.51 | Ewondo 0.49, Tatar 0.44 |
| Hazargi (Dari) | Urdu 0.42, Tatar 0.42 | Urdu 0.44, Tatar 0.42 |
| Urdu | Bashkir 0.57, Tatar 0.54 | Tatar 0.54, Bashkir 0.50 |

**Dendrogram vs families** (`dendrogram_clips.png`, `dendrogram_speakers.png`):
the first split separates the two Bantu languages from everything else, in
both versions, matching the family tree. Hazargi (Iranian) joins the rest
next, on its own. The remaining group mixes families: at the clip level Tatar
and Bashkir join first (matching the Turkic family), then Torwali, then Urdu;
at the speaker level Tatar pairs with Urdu and Bashkir pairs with Torwali, and the two pairs then merge. So the
tree recovers Bantu cleanly, keeps the Turkic pair together only at the clip
level, and does not group the two Indo-Aryan languages (Torwali and Urdu)
together at either level.

## 3. Torwali and Urdu

Question: is Torwali's nearest rhythmic neighbour Urdu? **No.**

| Map view | Torwali's neighbours, closest first | Urdu's rank |
|---|---|---|
| Rhythm only, clips | Tatar, Ewondo, Bashkir, Fang, Urdu, Hazargi | 5th of 6 |
| Rhythm only, speaker averages | Ewondo, Tatar, Bashkir, Fang, Urdu, Hazargi | 5th of 6 |
| Raw, clips | Bashkir, Tatar, Urdu, Ewondo, Hazargi, Fang | 3rd of 6 |
| Raw, speaker averages | Bashkir, Tatar, Urdu, Ewondo, Hazargi, Fang | 3rd of 6 |

Bootstrap over speakers (raw clips, 500 resamples): Torwali's nearest is
Bashkir in 55% and Tatar in 44% of resamples; Urdu is never its nearest
(rank 3 in 70%, rank 4 in 29%). Both are Indo-Aryan, but Torwali belongs to
the Dardic branch of the Hindu Kush, far from Urdu, so a shared family label
need not mean shared cadence. Torwali has only 26 speakers, so this is tentative.

## 4. Known-sibling validation

With 7 languages, a given language lands in another's top 2 of 6 by chance 33%
of the time and is its single nearest 17% of the time.

| Pair | Level | Each in other's top 2 | Each other's nearest | Bootstrap: top 2 both ways | Bootstrap: nearest both ways |
|---|---|---|---|---|---|
| Tatar-Bashkir | Clips | PASS | PASS | 100% | 96% |
| Fang-Ewondo | Clips | PASS | PASS | 87% | 75% |
| Tatar-Bashkir | Speaker averages | PASS | FAIL (Tatar's nearest is Urdu) | 64% | 9% |
| Fang-Ewondo | Speaker averages | PASS | PASS | 68% | 53% |
| Tatar-Bashkir | Noise-controlled clips | PASS | PASS | 98% | 69% |
| Fang-Ewondo | Noise-controlled clips | PASS | PASS | 71% | 44% |

Adding Urdu weakened the Turkic result at the speaker level: Urdu speaker
averages sit very close to Tatar ones. The clip-level result is unchanged.

## 5. Held-out sibling test

The standardization and UMAP map were fit without one language; that
language was then projected in. PASS means its nearest language is the
expected sibling both on the 2D map and in the full feature space.

| Held out | Level | Nearest on map | Nearest in full features | Result | kNN votes for sibling (base rate) |
|---|---|---|---|---|---|
| Ewondo | Clips | Fang | Fang | PASS | 20% (15%) |
| Ewondo | Speaker averages | Fang | Fang | PASS | 19% (15%) |
| Bashkir | Clips | Tatar | Tatar | PASS | 26% (18%) |
| Bashkir | Speaker averages | Torwali | Torwali | FAIL | 38% (26%) |

At the level of the language as a whole, the held-out language lands nearest
its sibling in 3 of 4 cases. At the level of individual clips the pull is
weak: only a few points above the base rate. The held-out *family* test is
deferred (`run_held_out_family` in languages.yaml).

## 6. Recording-condition check (confound)

The same speaker-disjoint classifier trained on 16 features taken only from
the non-speech portions of each clip (background level, noise spectrum shape,
leading and trailing silence):

| Features | Balanced accuracy (random forest, clips) |
|---|---|
| Prosody (same 1,752 clips) | 46.2% |
| **Background noise only** | **43.9%** |
| Prosody with everything noise can predict removed | 40.1% |
| Prosody without pause, silence and loudness-spread features | 42.7% |
| Prosody plus noise | 53.9% |
| Chance | 14.3% |

**Flag: recording conditions are a strong confound.** Each language was
recorded by a different, small community of contributors with their own
devices and rooms, so language and recording setup are tangled together.

* Noise predicts mainly the silence and pause features (R² of 0.40 for share
  of silence, 0.22 for pause rate and for loudness spread, 0.16 for pause
  length) and very little of the pitch features (R² at most 0.06).
* With the noise-predictable part removed, prosody still separates languages
  at almost 3 times chance (40.1%), and prosody plus noise (53.9%) beats noise
  alone (43.9%), so prosody carries information the recording setup does not.
* Both sibling pairs survive the control as each other's nearest at the clip
  level, but less stably (section 4).
* Not ruled out: recording situations that change how people read would affect
  prosody in ways a linear noise control cannot remove.

## 7. Which features separate languages

| Feature | Permutation importance | Eta squared (speaker averages) |
|---|---|---|
| Pitch range (5 to 95%) | 0.049 | 0.28 |
| Syllable-like beats per second (proxy) | 0.048 | 0.42 |
| Loudness peaks per second | 0.047 | 0.54 |
| Overall pitch slope | 0.037 | 0.14 |
| Share of silence | 0.032 | 0.28 |
| Loudness spread | 0.025 | 0.20 |

Tempo and pitch range lead. Share of silence ranks fifth and is also the
feature most affected by recording conditions. Final pitch slope: Tatar and
Bashkir end utterances with a steep fall (about -6 semitones per second),
and so does Torwali (about -5), while Fang, Ewondo, Urdu and Hazargi are
flatter (about -2 to -3). This shared final fall is one reason Torwali sits
next to the Turkic pair. Pitch spread and pitch range are strongly correlated.

## Limitations

* **Read speech, not conversation.** Common Voice speakers read sentences
  aloud; read prosody is flatter than natural speech and reflects each
  community's text corpus.
* **Rhythm proxies.** Syllable-like nuclei come from intensity peaks, not
  phoneme alignment; nPVI and the voiced/unvoiced variability measures
  approximate %V, VarcoV and VarcoC without transcripts.
* **Few speakers.** Hazargi has 7 speakers; Ewondo and Torwali 26; Fang 38.
  Results for these languages may reflect a handful of individuals.
* **Recording conditions** predict language nearly as well as prosody (section 6).
* **Seven languages and two sibling pairs.** The findings are a proof of
  concept, not evidence that prosody maps families in general.
* **Mp3 compression** reduces pitch tracking reliability; about 3% of voiced
  frames have gross pitch errors.

## Draft answers for the submission form

**Team name:** [TEAM NAME]

**Research question:** Do under-resourced languages have "rhythmic neighbours",
related or nearby languages whose prosody (rhythm, pitch movement, pauses,
loudness) is measurably similar, so that speech technology built for one could
help build tools that sound native for the other? Can we find those
neighbours from audio alone, without transcripts?

**Dataset chosen:** Mozilla Common Voice Scripted Speech 27.0 (CC0) from the
Mozilla Data Collective: Tatar, Bashkir, Fang, Ewondo, Torwali, Hazargi (Dari)
and Urdu; 1,755 clips plus a 190-speaker panel. Age and gender labels were
never used.

**Methods:** A 15-feature prosodic fingerprint normalized within each
utterance (pitch relative to the speaker's own median, loudness relative to
the clip's maximum, rhythm from syllable-like intensity peaks, pauses),
computed identically in Python and in the browser (verified on 20 clips).
Speaker-disjoint language classification, language centroid distances with
bootstrap stability, clustering compared with family trees, known-sibling and
held-out-sibling validation, and a recording-condition control using features
from background noise only; the public map uses noise-controlled features.

**Preliminary results:** Prosody alone identifies the language at 46% (single
clips) and 57% (speaker averages) versus 14% chance. Tatar and Bashkir are
each other's nearest rhythmic neighbour in 96% of bootstrap resamples; Fang
and Ewondo in 75%. Clustering separates Bantu from the rest exactly. A
language held out of the map lands next to its sibling in 3 of 4 tests.
Torwali's nearest neighbour is Tatar or Bashkir, not Urdu. Honest caveat:
background noise alone predicts the language at 44%, so recording conditions
explain much of the separation; after controlling for them prosody still
reaches 40% and both sibling pairs remain nearest neighbours, less stably.

**Application area:** Health and education for under-resourced languages:
voice tools that deliver spoken health information and learning support in a
voice that sounds native, bootstrapped from rhythmic neighbours rather than
from dominant languages like Urdu.

**Potential users and stakeholders:** Community health workers; teachers;
NGOs serving these communities; community language organizations; developers
building voice tools for underserved languages.
