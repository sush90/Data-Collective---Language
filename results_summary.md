# The Prosodic Commons: results summary

All numbers come from `outputs/results.json`, produced by `python analysis.py`.
Figures are in `outputs/`. Date of run: 2026-09-25.

## In one paragraph

Using only rhythm and melody (no words, no transcripts, no speaker identity), a
classifier tells five Common Voice languages apart at **47% balanced accuracy on
single clips and 59% on speaker averages, against 20% chance**, with no speaker
ever appearing in both training and testing. Both known sibling pairs come out
as each other's nearest rhythmic neighbour: **Tatar and Bashkir** (robust: 96%
of bootstrap resamples) and **Fang and Ewondo** (less stable: 74%). Held-out
tests agree in 3 of 4 cases. The main caveat is serious: **background noise
alone predicts the language at 45%**, almost as well as prosody, so a large part
of what separates these datasets is how and where they were recorded. After
removing everything noise can predict from the prosody features, prosody still
reaches 41% and the Tatar-Bashkir pairing survives unchanged, so there is a
real rhythmic signal, but it is smaller than the headline accuracy suggests.

## Data

| Language | Family | Clips kept | Speakers (clip sample) | Speakers in speaker panel | Reliability caveat |
|---|---|---|---|---|---|
| Tatar | Turkic | 262 | 241 | 39 | |
| Bashkir | Turkic | 269 | 269 | 39 | |
| Fang | Bantu | 223 | 38 | 26 | |
| Ewondo | Bantu | 293 | 26 | 21 | fewer than 30 speakers |
| Torwali | Indo-Aryan (Dardic) | 291 | 26 | 18 | fewer than 30 speakers |

* Source: Mozilla Common Voice Scripted Speech 27.0 (CC0), via Mozilla Data Collective.
* Clip sample: up to 300 validated clips per language, at most 20 per speaker,
  spread over as many speakers as possible (frozen in `data/<code>/sample.tsv`).
* Quality gate (features.md section 6) dropped 163 of 1,500 clips: Tatar 38,
  Bashkir 31, **Fang 77 (26%)**, Ewondo 7, Torwali 9. Fang clips often contain
  very little speech (short, quiet or mostly silent recordings).
* Speaker panel: up to 40 speakers with at least 8 clips; each speaker
  fingerprint is the mean of exactly 5 good clips, so speaker averages are
  comparable across languages. 143 speakers in total.
* Tajik and Balti were not downloaded in time; the pipeline adds them with one command.
* Age and gender columns were never read.

## Method

* **Fingerprint:** 15 prosodic features per clip (features.md), all normalized
  within the utterance: pitch in semitones relative to the clip's own median,
  intensity in dB relative to the clip's own maximum. Pitch uses our own YIN
  implementation so that the browser runs the identical algorithm. Against
  Praat on 50 pilot clips, median pitch disagreement is 0.04 to 0.06
  semitones and gross errors (over 1 semitone) are 1 to 6% of frames.
* **Classifiers:** logistic regression and random forest, 5-fold GroupKFold by
  `client_id` for clips (no speaker in both train and test); stratified 5-fold
  for speaker averages (one row per speaker, so also speaker-disjoint).
  Shuffled-label baseline: language labels permuted across speakers, 10 repeats.
* **Neighbours:** Euclidean distance between speaker-balanced language
  centroids in the standardized 15-feature space (each speaker counts once, so
  a language with many clips per speaker is not over-weighted). Similarity
  shown on the site is 1 / (1 + distance). Stability by bootstrap over speakers (500 resamples).
* **Map:** UMAP (15 neighbours, min_dist 0.3) of standardized features. The
  browser places new recordings by weighted k-nearest-neighbour averaging
  (k = 15) of exported clip positions; leave-one-out placement error is 12% of
  the map's average spread for clips and 22% for speaker averages.

## 1. Can rhythm tell languages apart?

| Setting | Model | Accuracy | Balanced accuracy | Chance (balanced) | Shuffled labels (balanced) |
|---|---|---|---|---|---|
| Single clips (n = 1,338) | Logistic regression | 44.8% | 44.9% | 20% | 21.6% |
| Single clips | Random forest | 46.9% | **47.4%** | 20% | 20.0% |
| Speaker averages (n = 143) | Logistic regression | 59.4% | **58.9%** | 20% | 20.8% |
| Speaker averages | Random forest | 61.5% | 57.8% | 20% | 19.4% |

Majority-class chance is 22% for clips and 27% for speaker averages.
No shuffled run exceeded 25.5% balanced accuracy.

Averaging 5 clips per speaker raises accuracy by about 12 points, confirming
that single clips are noisy and a language's rhythm shows up more clearly per speaker.

**Confusions (speaker averages, logistic regression, row = true language):**
Tatar is mistaken for Bashkir 21% of the time and Bashkir for Tatar 23%;
Fang is mistaken for Ewondo 31%. The classifier's errors fall mostly within
the sibling pairs (`confusion_speakers.png`, `confusion_clips.png`).

## 2. Rhythmic neighbours

Top 2 neighbours by centroid distance (lower = closer):

| Language | Clips: 1st, 2nd | Speaker averages: 1st, 2nd |
|---|---|---|
| Tatar | Bashkir 0.71, Torwali 1.07 | Bashkir 1.18, Torwali 1.31 |
| Bashkir | Tatar 0.71, Torwali 1.02 | Torwali 1.15, Tatar 1.18 |
| Fang | Ewondo 1.34, Tatar 2.27 | Ewondo 1.37, Torwali 2.43 |
| Ewondo | Fang 1.34, Torwali 1.65 | Fang 1.37, Bashkir 1.45 |
| Torwali | Bashkir 1.02, Tatar 1.07 | Bashkir 1.15, Tatar 1.31 |

**Dendrogram vs families** (`dendrogram_clips.png`, `dendrogram_speakers.png`):
the top-level split is exactly Bantu versus non-Bantu in both. Within the
non-Bantu branch the clip-level tree groups Tatar with Bashkir first, then
adds Torwali, which matches the family tree. The speaker-level tree instead
joins Bashkir with Torwali first (1.15 versus 1.18 to Tatar, a very small
margin), which disagrees with the families. Torwali, the only Indo-Aryan
language, sits close to the Turkic pair rather than on its own branch; with one
Indo-Aryan language we cannot tell whether that reflects areal contact, shared
reading style, or recording conditions.

## 3. Known-sibling validation

With 5 languages, a given language lands in another's top 2 of 4 by chance 50%
of the time and is its single nearest 25% of the time, so we report both.

| Pair | Level | Each in other's top 2 | Each other's nearest | Bootstrap: top 2 both ways | Bootstrap: nearest both ways |
|---|---|---|---|---|---|
| Tatar-Bashkir | Clips | PASS | PASS | 100% | 96% |
| Fang-Ewondo | Clips | PASS | PASS | 86% | 74% |
| Tatar-Bashkir | Speaker averages | PASS | FAIL (Bashkir's nearest is Torwali) | 84% | 43% |
| Fang-Ewondo | Speaker averages | PASS | PASS | 64% | 47% |
| Tatar-Bashkir | Noise-controlled prosody | PASS | PASS | 100% | 97% |
| Fang-Ewondo | Noise-controlled prosody | PASS | FAIL (Ewondo's nearest is Torwali) | 77% | 38% |

The speaker-level rows use only 18 to 39 speakers per language, which is why
their bootstrap rates are lower than the clip-level rows.

## 4. Held-out sibling test

The standardization and UMAP map were fit without one language; that
language was then projected in. PASS means its nearest language is the
expected sibling both on the 2D map and in the full feature space.

| Held out | Level | Nearest on map | Nearest in full features | Result | kNN votes for sibling (base rate) |
|---|---|---|---|---|---|
| Ewondo | Clips | Fang | Fang | PASS | 22% (21%) |
| Ewondo | Speaker averages | Fang | Fang | PASS | 24% (21%) |
| Bashkir | Clips | Tatar | Tatar | PASS | 42% (25%) |
| Bashkir | Speaker averages | Tatar | Torwali | FAIL | 44% (38%) |

At the level of the language as a whole (its centroid), the held-out language
lands nearest its sibling in 3 of 4 cases. At the level of individual clips it
is much weaker: an individual projected Ewondo clip is no more likely to have
Fang neighbours than the base rate, while Bashkir clips are clearly drawn to
Tatar (42% versus 25%). The original held-out *family* test is deferred until
Tajik and Balti add more families (`run_held_out_family` in languages.yaml).

## 5. Recording-condition check (confound)

We trained the same speaker-disjoint classifier on 16 features taken only from
the non-speech portions of each clip: background level, noise spectrum shape,
leading and trailing silence.

| Features | Balanced accuracy (random forest, clips) |
|---|---|
| Prosody (same 1,337 clips) | 48.3% |
| **Background noise only** | **44.9%** |
| Prosody with everything noise can predict removed | 40.5% |
| Prosody without pause, silence and loudness-spread features | 42.9% |
| Prosody plus noise | 53.4% |
| Chance | 20% |

**Flag: recording conditions are a strong confound.** In these datasets each
language was recorded by a different, small community of contributors with
their own devices and rooms, so language and recording setup are tangled
together. What we can say:

* Noise predicts only the silence and pause features to any real degree
  (R² of 0.39 for share of silence, 0.22 for pause rate, 0.14 for pause length,
  0.17 for loudness spread) and essentially none of the pitch features (R² about 0).
* With the noise-predictable part removed, prosody still separates languages
  at twice chance (40.5%), and prosody plus noise (53.4%) beats noise alone
  (44.9%), so prosody carries information that the recording setup does not.
* The Tatar-Bashkir pairing survives the noise control at full strength; the
  Fang-Ewondo pairing weakens.
* What we cannot rule out: recording habits that change *how people read*
  (for example, reading from a phone in a noisy room) would affect prosody in
  ways a linear noise control cannot remove.

## 6. Which features separate languages

Permutation importance (drop in balanced accuracy, random forest, held-out folds)
and eta squared (share of variance between languages, speaker averages):

| Feature | Permutation importance | Eta squared |
|---|---|---|
| Loudness peaks per second | 0.062 | 0.58 |
| Syllable-like beats per second (proxy) | 0.048 | 0.47 |
| Share of silence | 0.031 | 0.28 |
| Pitch range (5 to 95%) | 0.024 | 0.16 |
| Final pitch slope | 0.017 | 0.06 |
| Overall pitch slope | 0.015 | 0.13 |

Tempo (beats per second) dominates. Share of silence is third, and it is also the
feature most affected by recording conditions. Pitch features matter less
individually, but the final pitch slope is where the Turkic pair stands out:
both Tatar and Bashkir end utterances with a steep fall (about -7 semitones
per second) while Fang, Ewondo and Torwali are much flatter (-1 to -2).
Pitch spread and pitch range are nearly redundant (r = 0.94).

## Limitations

* **Read speech, not conversation.** Common Voice speakers read sentences
  aloud. Read prosody is flatter and more uniform than natural speech, and it
  reflects each community's text corpus.
* **Rhythm proxies.** Syllable-like nuclei come from intensity peaks, not
  phoneme alignment; nPVI and the voiced/unvoiced variability measures
  approximate the linguistic measures (%V, VarcoV, VarcoC) without transcripts.
* **Few speakers.** Ewondo and Torwali have 26 speakers each; Fang has 38.
  Results for these languages may reflect a handful of individuals.
* **Recording conditions** predict language nearly as well as prosody (section 5).
* **Only five languages and two sibling pairs.** With so few languages, "in
  the top 2" is a weak test (50% chance per direction). The findings are a
  proof of concept, not evidence that prosody maps families in general.
* **Mp3 compression** (Common Voice clips are low-bitrate mp3) reduces pitch
  tracking reliability; about 3% of voiced frames have gross pitch errors.

## Draft answers for the submission form

**Team name:** [TEAM NAME]

**Research question:** Do underresourced languages have "rhythmic neighbours",
related or nearby languages whose prosody (rhythm, pitch movement, pauses,
loudness) is measurably similar, so that speech technology built for one could
help build tools that sound native for the other? Can we find those
neighbours from audio alone, without transcripts?

**Dataset chosen:** Mozilla Common Voice Scripted Speech 27.0 (CC0) from the
Mozilla Data Collective: Tatar, Bashkir, Fang, Ewondo and Torwali, 300 clips
per language plus a 143-speaker panel, 2,283 clips in total. Age and gender
labels were never used.

**Methods:** A 15-feature prosodic fingerprint normalized within each
utterance (pitch in semitones relative to the speaker's own median, loudness
relative to the clip's maximum, rhythm from syllable-like intensity peaks,
pauses), computed identically in Python and in the browser. Speaker-disjoint
language classification (logistic regression, random forest), language
centroid distances with bootstrap stability, clustering compared against
family trees, known-sibling and held-out-sibling validation, and a
recording-condition control using features from background noise only.

**Preliminary results:** Prosody alone identifies the language at 47%
(single clips) and 59% (speaker averages) versus 20% chance. Tatar and Bashkir
are each other's nearest rhythmic neighbour in 96% of bootstrap resamples;
Fang and Ewondo in 74%. Clustering splits Bantu from non-Bantu exactly. A
language held out of the map lands next to its sibling in 3 of 4 tests. Honest
caveat: background noise alone predicts the language at 45%, so recording
conditions explain much of the separation; after controlling for them prosody
still reaches 41% and the Tatar-Bashkir pairing is unchanged.

**Application area:** Health and education for underresourced languages:
voice tools that deliver spoken health information and learning support in a
voice that sounds native, bootstrapped from rhythmic neighbours rather than
from dominant languages like Urdu.

**Potential users and stakeholders:** Community health workers; teachers;
NGOs serving these communities; community language organizations; developers
building voice tools for underserved languages.
