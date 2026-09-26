# The Prosodic Commons: results summary

All numbers come from `outputs/results.json` and `outputs/site_neighbours.json`,
produced by `python analysis.py` and `python export_site.py`. Figures are in
`outputs/`. Live site: https://prosodic-commons.netlify.app

Current run: **10 languages from 6 families** (Tatar, Bashkir, Fang, Ewondo,
Torwali, Hazaragi, Urdu, Kohistani Shina, Rioplatense Spanish, Scottish
English), 2,442 clips and 272 speaker averages. With 10 languages, chance
is 10%.

## In one paragraph

Using only rhythm and melody (no words, no transcripts, no speaker identity), a
classifier tells ten Common Voice languages apart at **40% balanced accuracy
on single clips and 47% on speaker averages, against 10% chance**, with no
speaker ever appearing in both training and testing. All three known sibling
pairs come out as each other's nearest rhythmic neighbour at the clip level,
with bootstrap stability of 61% (**Tatar and Bashkir**), 72% (**Fang and
Ewondo**) and 35% (**Torwali and Kohistani Shina**). The main caveat is
serious: **background noise alone predicts the language at 35%**, almost as
well as prosody. After removing everything noise can predict, prosody still
reaches 37% (almost 4 times chance). The new languages sharpen the confound:
languages recorded by a handful of people are the easiest to recognise
(Hazaragi, 7 speakers: 71%), while Rioplatense Spanish, with 285 speakers, is
recognised only 15% of the time and sits near the centre of the space, where it
is a top neighbour of many languages. **Scottish English and Rioplatense Spanish
come out as close neighbours**, against the textbook stress-timed versus
syllable-timed contrast, but they are also the closest pair on background noise
alone, so this result is not interpretable.

## Data

| Language | Family | Clips kept | Speakers (clip sample) | Speakers in speaker panel | Reliability caveat |
|---|---|---|---|---|---|
| Tatar | Turkic | 262 | 241 | 39 | |
| Bashkir | Turkic | 269 | 269 | 39 | |
| Fang | Bantu | 223 | 38 | 26 | |
| Ewondo | Bantu | 293 | 26 | 21 | fewer than 30 speakers |
| Torwali | Indo-Aryan (Dardic branch) | 291 | 26 | 18 | fewer than 30 speakers |
| Hazaragi | Iranian | 129 | 7 | 7 | **only 7 speakers** |
| Urdu | Indo-Aryan | 288 | 288 | 40 | |
| Kohistani Shina | Indo-Aryan (Dardic branch) | 127 | 9 | 6 | **only 9 speakers** |
| Rioplatense Spanish | Romance | 285 | 285 | 39 | |
| Scottish English | Germanic | 275 | 200 | 37 | |

* Source: Mozilla Common Voice Scripted Speech 27.0 (CC0), via Mozilla Data
  Collective. Rioplatense Spanish and Scottish English come from the Common
  Voice **26.0 regional releases** (0.45 GB and 0.8 GB), chosen over the full
  Spanish (52 GB) and English (95 GB) archives. These releases contain only
  train/dev/test splits, which Common Voice fills from validated clips, so
  `ingest.py` uses their union in place of `validated.tsv`.
* Clip sample: up to 300 validated clips per language, at most 20 per speaker,
  spread over as many speakers as possible (frozen in `data/<code>/sample.tsv`).
  Hazaragi (7 speakers) and Kohistani Shina (9) are limited by the per-speaker
  cap to 140 and 131 clips.
* Quality gate (features.md section 6) dropped 229 of 2,671 clips: Tatar 38,
  Bashkir 31, **Fang 77 (26%)**, Ewondo 7, Torwali 9, Hazaragi 11, Urdu 12,
  Kohistani Shina 4, Rioplatense Spanish 15, Scottish English 25.
  Fang clips often contain very little speech.
* Speaker panel: up to 40 speakers with at least 8 clips; each speaker
  fingerprint is the mean of exactly 5 good clips, so speaker averages are
  comparable across languages.
* **Kashmiri:** Mozilla Data Collective has no Kashmiri dataset (searched by
  name and by the codes `ks` and `kas`). **Kohistani Shina**, a Dardic
  language of the Shina group spoken in Kohistan, northern Pakistan, stands in
  for it; it also gives a third known-sibling pair with Torwali.
* **Dari:** Mozilla Data Collective has no separate Dari (Afghan Persian)
  dataset. Hazaragi (listed as "Hazargi" in Common Voice), a Dari variety
  spoken by the Hazara people, is the closest available and is labelled
  "Hazaragi" throughout.
* Not yet included: Nepali (dataset terms not yet accepted for API download),
  Tajik and Balti. Each is one `add_language.py` command.
* Age, gender and accent columns were never read.

## Method

* **Fingerprint:** 15 prosodic features per clip (features.md), all normalized
  within the utterance: pitch in semitones relative to the clip's own median,
  intensity in dB relative to the clip's own maximum. Pitch uses our own YIN
  implementation so that the browser runs the identical algorithm. Against
  Praat on 50 pilot clips, median pitch disagreement is 0.04 to 0.06
  semitones and gross errors (over 1 semitone) are 1 to 6% of frames.
* **Browser parity:** `verify_js.py` runs the JavaScript fingerprint in Node
  on 20 dataset clips and compares with Python: 0 mismatches across all 31
  features (15 prosodic, 16 background-noise), quality-gate decisions identical.
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
* **Sound map:** UMAP (15 neighbours, min_dist 0.3). The browser places new
  recordings by weighted k-nearest-neighbour averaging (k = 15) of exported
  positions; leave-one-out placement error is 10% of the map's average spread
  for clips and 18% for speaker averages.
* **World map:** each language is drawn at a representative point of its
  speaking area (hand-entered in `languages.yaml` with the countries where it
  is spoken, a short description and a rough speaker estimate). Lines join the
  selected language to its 3 nearest rhythmic neighbours from the analysis
  above; geography plays no part in the analysis. Country outlines: Natural
  Earth 1:50m via world-atlas (public domain).
* **Colour:** one validated colour per family (6 slots of the default
  categorical palette), with a marker shape per language inside its family,
  in the figures and on the site.

## 1. Can rhythm tell languages apart?

| Setting | Model | Accuracy | Balanced accuracy | Chance (balanced) | Shuffled labels (balanced) |
|---|---|---|---|---|---|
| Single clips (n = 2,442) | Logistic regression | 35.3% | 38.6% | 10.0% | 8.9% |
| Single clips | Random forest | 37.9% | **40.3%** | 10.0% | 9.6% |
| Speaker averages (n = 272) | Logistic regression | 44.1% | **47.2%** | 10.0% | 8.6% |
| Speaker averages | Random forest | 40.4% | 44.6% | 10.0% | 10.2% |

Majority-class chance is 12.0% for clips and 14.7% for speaker averages. No
shuffled run exceeded 14.7% balanced accuracy.

**Recognition by language (speaker averages, logistic regression, share
correct, main confusions):**

| Language | Correct | Most often mistaken for |
|---|---|---|
| Hazaragi | 71% | Urdu 14%, Tatar 14% |
| Fang | 65% | Ewondo 19% |
| Bashkir | 56% | Tatar 15%, Ewondo 13% |
| Kohistani Shina | 50% | Torwali 33% |
| Ewondo | 48% | Fang 19% |
| Scottish English | 46% | Rioplatense Spanish 16% |
| Tatar | 44% | Bashkir 13%, Urdu 10% |
| Urdu | 42% | Rioplatense Spanish 12% |
| Torwali | 33% | Rioplatense Spanish 22% |
| Rioplatense Spanish | 15% | Urdu 18%, Torwali 18% |

Confusions follow the sibling pairs (Fang/Ewondo, Tatar/Bashkir, and Kohistani
Shina mistaken for Torwali a third of the time). Recognition also tracks
community size: the two best-recognised languages have 7 and 38 speakers,
the worst has 285. A small community's recordings share a sound (devices,
rooms, a few voices); a large community's do not.

## 2. Rhythmic neighbours

Top 2 neighbours by centroid distance (lower = closer), raw features:

| Language | Clips: 1st, 2nd | Speaker averages: 1st, 2nd |
|---|---|---|
| Tatar | Bashkir 0.71, Rioplatense Spanish 0.78 | **Urdu 0.85**, Rioplatense Spanish 0.99 |
| Bashkir | Tatar 0.71, Torwali 1.07 | **Rioplatense Spanish 1.05**, Tatar 1.16 |
| Fang | Ewondo 1.37, Scottish English 2.18 | Ewondo 1.43, Scottish English 2.41 |
| Ewondo | Fang 1.37, Rioplatense Spanish 1.74 | Fang 1.43, Bashkir 1.55 |
| Torwali | Kohistani Shina 1.00, Rioplatense Spanish 1.02 | **Rioplatense Spanish 0.66**, Bashkir 1.23 |
| Hazaragi | Urdu 1.51, Tatar 1.58 | Urdu 1.33, Tatar 1.46 |
| Urdu | Tatar 1.16, Bashkir 1.17 | Tatar 0.85, Rioplatense Spanish 1.21 |
| Kohistani Shina | Torwali 1.00, Rioplatense Spanish 1.73 | Torwali 1.81, Rioplatense Spanish 2.05 |
| Rioplatense Spanish | Tatar 0.78, Scottish English 0.79 | Torwali 0.66, Scottish English 0.99 |
| Scottish English | Rioplatense Spanish 0.79, Tatar 1.21 | Rioplatense Spanish 0.99, Tatar 1.06 |

Noise-controlled ("Rhythm only", the site default), similarity scores:

| Language | Clips: 1st, 2nd | Speaker averages: 1st, 2nd |
|---|---|---|
| Tatar | Bashkir 0.60, Rioplatense Spanish 0.57 | Urdu 0.53, Bashkir 0.51 |
| Bashkir | Tatar 0.60, Urdu 0.54 | Tatar 0.51, Rioplatense Spanish 0.50 |
| Fang | Ewondo 0.48, Rioplatense Spanish 0.42 | Ewondo 0.52, Torwali 0.40 |
| Ewondo | Rioplatense Spanish 0.49, Fang 0.48 | Fang 0.52, Rioplatense Spanish 0.48 |
| Torwali | Rioplatense Spanish 0.52, Tatar 0.51 | Rioplatense Spanish 0.59, Scottish English 0.48 |
| Hazaragi | Tatar 0.41, Urdu 0.40 | Urdu 0.43, Tatar 0.41 |
| Urdu | Bashkir 0.54, Tatar 0.51 | Tatar 0.53, Bashkir 0.48 |
| Kohistani Shina | Torwali 0.49, Ewondo 0.41 | Torwali 0.37, Rioplatense Spanish 0.36 |
| Rioplatense Spanish | Scottish English 0.63, Tatar 0.57 | Torwali 0.59, Scottish English 0.56 |
| Scottish English | Rioplatense Spanish 0.63, Tatar 0.47 | Rioplatense Spanish 0.56, Tatar 0.50 |

**Rioplatense Spanish as a hub.** Spanish is the nearest neighbour of 1 to 3
other languages depending on the view. With 285 speakers recorded on many
devices, its centroid sits near the middle of the feature space, so centroid
distance favours it. Read "nearest is Spanish" as "no clear neighbour" rather
than as a rhythmic kinship.

**Dendrogram vs families** (`dendrogram_clips.png`, `dendrogram_speakers.png`):
at the clip level the first merges are exactly the three sibling pairs plus
Spanish and English: Tatar and Bashkir (0.71), Spanish and English (0.79),
Torwali and Kohistani Shina (1.00), Fang and Ewondo (1.37). Urdu joins the
Turkic pair, Hazaragi joins everything else late, and the Bantu pair splits
off first. At the speaker level the tree mixes families: Torwali pairs with
Spanish and Tatar with Urdu, and Kohistani Shina (6 panel speakers) splits off
alone. So the clip-level tree recovers every known pair; the speaker-level
tree recovers only Bantu.

## 3. Torwali, Urdu and Kohistani Shina

Question: is Torwali's nearest rhythmic neighbour Urdu? **No.**

| Map view | Torwali's nearest | Kohistani Shina's rank | Urdu's rank (of 9) |
|---|---|---|---|
| Rhythm only, clips | Rioplatense Spanish | 3rd | 7th |
| Rhythm only, speaker averages | Rioplatense Spanish | 8th | 7th |
| Raw, clips | **Kohistani Shina** | 1st | 5th |
| Raw, speaker averages | Rioplatense Spanish | 7th | 5th |

In the other direction, **Kohistani Shina's nearest neighbour is Torwali in
all four views**. The two Dardic languages are neighbours in the Hindu Kush,
and the relationship shows up one way; Torwali's own nearest is usually the
hub (Spanish). Both Torwali and Urdu are Indo-Aryan, but a shared family
label need not mean shared cadence. Torwali has 26 speakers and Kohistani
Shina 9, so this is tentative.

## 4. Known-sibling validation

With 10 languages, a given language is another's single nearest by chance
11% of the time and lands in its top 2 of 9 22% of the time.

| Pair | Level | Each in other's top 2 | Each other's nearest | Bootstrap: top 2 both ways | Bootstrap: nearest both ways |
|---|---|---|---|---|---|
| Tatar-Bashkir | Clips | PASS | PASS | 98% | 61% |
| Fang-Ewondo | Clips | PASS | PASS | 82% | 72% |
| Torwali-Kohistani Shina | Clips | PASS | PASS | 47% | 35% |
| Tatar-Bashkir | Speaker averages | FAIL | FAIL (Tatar's nearest is Urdu) | 14% | 2% |
| Fang-Ewondo | Speaker averages | PASS | PASS | 60% | 46% |
| Torwali-Kohistani Shina | Speaker averages | FAIL | FAIL (Torwali's nearest is Spanish) | 1% | 0% |
| Tatar-Bashkir | Noise-controlled clips | PASS | PASS | 92% | 60% |
| Fang-Ewondo | Noise-controlled clips | PASS | FAIL (Ewondo's nearest is Spanish) | 49% | 23% |
| Torwali-Kohistani Shina | Noise-controlled clips | FAIL | FAIL (Torwali's nearest is Spanish) | 21% | 13% |

All three pairs pass at the clip level. Speaker averages weaken the Turkic
and Dardic pairs, as before; adding Spanish pulls several languages toward
the centre.

## 5. Held-out sibling and family tests

The standardization and UMAP map were fit without one language; that
language was then projected in. PASS means its nearest language is the
expected sibling both on the 2D map and in the full feature space.

| Held out | Level | Nearest on map | Nearest in full features | Result | kNN votes for sibling (base rate) |
|---|---|---|---|---|---|
| Ewondo | Clips | Fang | Fang | PASS | 17% (10%) |
| Ewondo | Speaker averages | Fang | Fang | PASS | 24% (10%) |
| Bashkir | Clips | Tatar | Tatar | PASS | 17% (12%) |
| Bashkir | Speaker averages | Rioplatense Spanish | Rioplatense Spanish | FAIL | 36% (17%) |

At the level of the language as a whole, the held-out language lands nearest
its sibling in 3 of 4 cases. At the level of individual clips the pull is
weak: only a few points above the base rate.

**Held-out family test (new, now that 6 families are present):** the space
was fit without the whole Turkic family, then Tatar and Bashkir were each
projected in. Tatar's nearest is Bashkir (distance 0.31) and Bashkir's nearest
is Tatar: **PASS**.

## 6. Recording-condition check (confound)

The same speaker-disjoint classifier trained on 16 features taken only from
the non-speech portions of each clip (background level, noise spectrum shape,
leading and trailing silence):

| Features | Balanced accuracy (random forest, clips) |
|---|---|
| Prosody (same 2,434 clips) | 40.2% |
| **Background noise only** | **34.7%** |
| Prosody with everything noise can predict removed | 37.2% |
| Prosody without pause, silence and loudness-spread features | 36.6% |
| Prosody plus noise | 47.0% |
| Chance | 10.0% |

**Flag: recording conditions are a strong confound.** Each language was
recorded by a different community of contributors with their own devices and
rooms, so language and recording setup are tangled together.

* Noise predicts mainly the silence and pause features (R² of 0.44 for share
  of silence, 0.25 for loudness spread, 0.24 for pause rate, 0.16 for pause
  length) and almost none of the pitch features (R² at most 0.02).
* With the noise-predictable part removed, prosody still separates languages
  at almost 4 times chance (37.2%), and prosody plus noise (47.0%) beats noise
  alone (34.7%), so prosody carries information the recording setup does not.
* **Spanish and English are the closest pair of all on noise alone**
  (distance 0.59). Both come from the same Common Voice 26.0 regional
  releases, recorded by many contributors on similar equipment. Their
  closeness in prosody therefore cannot be separated from recording
  similarity, and the expected stress-timed (English) versus syllable-timed
  (Spanish) contrast is **not confirmed**. Our rhythm proxies also come from
  intensity peaks, not the vowel and consonant interval measures (%V, ΔC)
  used in the classic rhythm-class studies.
* Not ruled out: recording situations that change how people read would affect
  prosody in ways a linear noise control cannot remove.

## 7. Which features separate languages

| Feature | Permutation importance | Eta squared (speaker averages) |
|---|---|---|
| Pitch range (5 to 95%) | 0.051 | 0.29 |
| Share of voiced frames | 0.044 | 0.18 |
| Syllable-like beats per second (proxy) | 0.042 | 0.34 |
| Loudness peaks per second | 0.039 | 0.45 |
| Overall pitch slope | 0.028 | 0.12 |
| Share of silence | 0.024 | 0.25 |

Pitch range and tempo lead. Share of silence ranks sixth and is also the
feature most affected by recording conditions. Final pitch slope: Tatar and
Bashkir end utterances with a steep fall (about -6 semitones per second), and
so do Torwali (about -5) and Rioplatense Spanish (about -5), while Fang,
Ewondo, Hazaragi, Urdu and Scottish English are flatter (about -2 to -3).
Kohistani Shina has the steepest final fall of all (about -13), which from 9
speakers may reflect individual reading styles.

## Limitations

* **Read speech, not conversation.** Common Voice speakers read sentences
  aloud; read prosody is flatter than natural speech and reflects each
  community's text corpus.
* **Rhythm proxies.** Syllable-like nuclei come from intensity peaks, not
  phoneme alignment; nPVI and the voiced/unvoiced variability measures
  approximate %V, VarcoV and VarcoC without transcripts.
* **Few speakers.** Hazaragi has 7 speakers and Kohistani Shina 9; Ewondo and
  Torwali 26; Fang 38. Results for these languages may reflect a handful of
  individuals.
* **One variety per language.** Spanish is Rioplatense Spanish and English is
  Scottish English, each from a Common Voice 26.0 regional release, not the
  whole language.
* **Kashmiri substitute.** Kohistani Shina stands in for Kashmiri, which has
  no dataset on Mozilla Data Collective.
* **Recording conditions** predict language nearly as well as prosody (section 6),
  and large, varied communities (Spanish) sit near the centre of the space.
* **Ten languages and three sibling pairs.** The findings are a proof of
  concept, not evidence that prosody maps families in general.
* **World map facts** (locations, speaker estimates) are hand-entered
  approximations, shown for orientation only.
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
Mozilla Data Collective: Tatar, Bashkir, Fang, Ewondo, Torwali, Hazaragi,
Urdu and Kohistani Shina; plus the Common Voice 26.0 regional releases for
Rioplatense Spanish and Scottish English. 2,442 clips plus a 272-speaker
panel. Age, gender and accent labels were never used.

**Methods:** A 15-feature prosodic fingerprint normalized within each
utterance (pitch relative to the speaker's own median, loudness relative to
the clip's maximum, rhythm from syllable-like intensity peaks, pauses),
computed identically in Python and in the browser (verified on 20 clips).
Speaker-disjoint language classification, language centroid distances with
bootstrap stability, clustering compared with family trees, known-sibling,
held-out-sibling and held-out-family validation, and a recording-condition
control using features from background noise only; the public map uses
noise-controlled features and shows each language on a world map with lines
to its rhythmic neighbours.

**Preliminary results:** Prosody alone identifies the language at 40% (single
clips) and 47% (speaker averages) versus 10% chance. All three known sibling
pairs are each other's nearest rhythmic neighbour at the clip level (Tatar and
Bashkir in 61% of bootstrap resamples, Fang and Ewondo 72%, Torwali and
Kohistani Shina 35%), and the clip-level clustering recovers all three pairs.
Kohistani Shina's nearest neighbour is Torwali in every view. A language held
out of the map lands next to its sibling in 3 of 4 tests, and the held-out
Turkic family finds itself. Torwali's nearest neighbour is not Urdu. Honest
caveats: background noise alone predicts the language at 35%, so recording
conditions explain much of the separation (prosody still reaches 37% after
controlling for them); languages with few speakers are easiest to recognise;
and Spanish and English look alike in prosody but also in background noise,
so the expected contrast between them is not confirmed.

**Application area:** Health and education for under-resourced languages:
voice tools that deliver spoken health information and learning support in a
voice that sounds native, bootstrapped from rhythmic neighbours rather than
from dominant languages like Urdu or English.

**Potential users and stakeholders:** Community health workers; teachers;
NGOs serving these communities; community language organizations; developers
building voice tools for underserved languages.
