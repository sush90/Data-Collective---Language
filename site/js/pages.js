// Validation and About pages. Numbers come from data/validation.json.
const Pages = {
  validation() {
    const R = PC.data.validation;
    const pct = PC.fmtPct;
    const mc = R.confusion_clips.model, ms = R.confusion_speakers.model;
    const clip = R.clip_classifier[mc], spk = R.speaker_classifier[ms];
    const noise = R.silence_classifier[mc], proSame = R.prosody_on_silence_subset[mc];
    const resid = R.prosody_residual_classifier[mc], both = R.prosody_plus_silence_classifier[mc];
    const chance = R.clip_classifier.chance_balanced;
    const modelName = m => m.replace("_", " ");
    const K = R.languages.length;

    // sibling pass/fail from the neighbour lists the map uses
    const views = [["controlled_clips", "Rhythm only, clips"], ["controlled_speakers", "Rhythm only, speaker averages"],
      ["raw_clips", "Raw, clips"], ["raw_speakers", "Raw, speaker averages"]];
    const pairs = (PC.data.languages.sibling_pairs || []).filter(([a, b]) => R.languages.includes(a) && R.languages.includes(b));
    const pf = ok => ok ? `<span class="pass">PASS</span>` : `<span class="fail">FAIL</span>`;
    const sibRows = [];
    pairs.forEach(([a, b]) => views.forEach(([key, label]) => {
      const nb = R.site_neighbours[key];
      const top = (l, n) => nb[l].slice(0, n).map(x => x.language);
      const t2 = top(a, 2).includes(b) && top(b, 2).includes(a);
      const t1 = top(a, 1)[0] === b && top(b, 1)[0] === a;
      sibRows.push(`<tr><td>${PC.esc(a)} and ${PC.esc(b)}</td><td>${label}</td><td>${pf(t2)}</td><td>${pf(t1)}${t1 ? "" : ` <small>(${PC.esc(a)}: ${PC.esc(top(a, 1)[0])}, ${PC.esc(b)}: ${PC.esc(top(b, 1)[0])})</small>`}</td></tr>`);
    }));
    const boot = (k, pair) => R[k] && R[k][pair] ? `${pct(R[k][pair].top1)}` : "n/a";
    const bootRows = pairs.map(([a, b]) => {
      const p = `${a}-${b}`;
      return `<tr><td>${PC.esc(a)} and ${PC.esc(b)}</td><td>${boot("siblings_bootstrap_residual", p)}</td><td>${boot("siblings_bootstrap_clips", p)}</td><td>${boot("siblings_bootstrap_speakers", p)}</td></tr>`;
    }).join("");

    const hoRows = R.held_out_sibling.map(h => `<tr><td>${PC.esc(h.held_out)}</td><td>${h.level === "clips" ? "single clips" : "speaker averages"}</td>
      <td>${PC.esc(h.expect_nearest)}</td><td>${PC.esc(h.nearest_2d)}</td><td>${PC.esc(h.nearest_full)}</td><td>${pf(h.pass)}</td></tr>`).join("");
    const hoPass = R.held_out_sibling.filter(h => h.pass).length;

    const r2 = R.residual_r2_by_feature, lab = R.feature_labels;
    const pitchR2 = Math.max(...["f0_sd", "f0_range", "f0_slope", "f0_reversal_rate", "f0_final_slope"].map(f => r2[f]));
    const topR2 = Object.entries(r2).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([f, v]) => `${lab[f].toLowerCase()} (${pct(v)})`).join(", ");

    const survived = pairs.map(([a, b]) => {
      const p = `${a}-${b}`, after = R.siblings_bootstrap_residual && R.siblings_bootstrap_residual[p],
        before = R.siblings_bootstrap_clips && R.siblings_bootstrap_clips[p];
      return after && before ? `${a} and ${b} remain each other's nearest neighbour in ${pct(after.top1)} of speaker resamples after the control (${pct(before.top1)} before it).` : "";
    }).join(" ");
    const fam = R.held_out_family && R.held_out_family.skipped
      ? `<p>The held-out <em>family</em> test (build the map without all Turkic languages, then project them in) is deferred until more language families are added. With only three families it would say little.</p>` : "";

    document.getElementById("validation-body").innerHTML = `
      <h2>Does it work? An honest check</h2>
      <p class="lede">We tested the idea four ways. Every test keeps speakers apart: no voice used to build a model is ever used to test it.</p>
      <div class="stat-row">
        <div class="stat"><b>${pct(clip.balanced_accuracy)}</b><span>language identified from one clip of rhythm (chance ${pct(chance)})</span></div>
        <div class="stat"><b>${pct(spk.balanced_accuracy)}</b><span>from a speaker's average over 5 clips</span></div>
        <div class="stat"><b>${pct(resid.balanced_accuracy)}</b><span>after removing everything background noise could explain</span></div>
        <div class="stat"><b>${pct(noise.balanced_accuracy)}</b><span>from background noise alone (the warning sign)</span></div>
      </div>

      <h3>1. Can rhythm alone tell languages apart?</h3>
      <p>Yes, well above chance. A classifier that sees only pitch movement, rhythm and pauses picks the right language among ${K} in ${pct(clip.balanced_accuracy)} of single clips and ${pct(spk.balanced_accuracy)} of speaker averages, where guessing would give ${pct(chance)}. When we scramble the language labels it drops to ${pct(clip.shuffled_balanced_mean)}, as it should.</p>
      <div class="table-wrap"><table>
        <tr><th>Input</th><th>Model</th><th>Balanced accuracy</th><th>Chance</th><th>Scrambled labels</th></tr>
        <tr><td>Single clips (${clip.n ? R.clip_classifier.n : ""})</td><td>${modelName(mc)}</td><td>${pct(clip.balanced_accuracy)}</td><td>${pct(chance)}</td><td>${pct(clip.shuffled_balanced_mean)}</td></tr>
        <tr><td>Speaker averages (${R.speaker_classifier.n})</td><td>${modelName(ms)}</td><td>${pct(spk.balanced_accuracy)}</td><td>${pct(R.speaker_classifier.chance_balanced)}</td><td>${pct(spk.shuffled_balanced_mean)}</td></tr>
      </table></div>

      <h3>2. The recording confound: what we found and what we did</h3>
      <div class="callout">
        <p><strong>What we found.</strong> We trained the same classifier on something that has nothing to do with speech: the background noise in the silent moments of each clip. It identified the language ${pct(noise.balanced_accuracy)} of the time, almost as well as rhythm (${pct(proSame.balanced_accuracy)} on the same clips). Each language in Common Voice was recorded by a small, separate community with its own phones, laptops and rooms, so language and recording setup are tangled together. Part of what separates these languages is microphones, not speech.</p>
        <p><strong>How we controlled for it.</strong> For every rhythm feature we removed the part that background noise can predict, then repeated the analysis on what was left. This control never looks at which language a clip is. The Cadence Map uses these noise-controlled features by default ("Rhythm only"); the "Raw" toggle shows the uncorrected version.</p>
        <p><strong>What survived.</strong> Rhythm still identifies the language ${pct(resid.balanced_accuracy)} of the time with the noise-explainable part removed, about ${(resid.balanced_accuracy / chance).toFixed(1)} times chance. Rhythm plus noise together (${pct(both.balanced_accuracy)}) beat noise alone, so rhythm carries information the recording setup does not. Background noise explains almost none of the pitch features (at most ${pct(Math.max(pitchR2, 0))} of their variation); it mainly explains ${topR2}. ${survived}</p>
        <p><strong>What we cannot rule out.</strong> Recording situations that change how people read (for example reading from a phone in a noisy room) could still shape rhythm in ways this correction cannot remove. More speakers per language, recorded in varied settings, would settle it.</p>
      </div>
      <img src="img/accuracy_summary.png" alt="Bar chart of balanced accuracy: prosody on single clips ${pct(clip.balanced_accuracy)}, speaker averages ${pct(spk.balanced_accuracy)}, prosody with noise-predictable part removed ${pct(resid.balanced_accuracy)}, background noise only ${pct(noise.balanced_accuracy)}, shuffled labels about ${pct(clip.shuffled_balanced_mean)}; chance ${pct(chance)}.">

      <h3>3. Do known sibling languages come out as rhythmic neighbours?</h3>
      <p>Linguists consider ${pairs.map(([a, b]) => `${a} and ${b}`).join(", and ")} close relatives. The tool was never told this. PASS means each language appears in the other's list of nearest neighbours. With ${K} languages, a random language lands in the top 2 half of the time, so the stricter test is "each other's single nearest".</p>
      <div class="table-wrap"><table>
        <tr><th>Pair</th><th>Map view</th><th>In each other's top 2</th><th>Each other's nearest</th></tr>
        ${sibRows.join("")}
      </table></div>
      <p>How stable is "each other's nearest" if we resample the speakers? Share of 500 resamples in which it holds:</p>
      <div class="table-wrap"><table>
        <tr><th>Pair</th><th>Noise-controlled, clips</th><th>Raw, clips</th><th>Raw, speaker averages</th></tr>
        ${bootRows}
      </table></div>

      <h3>4. Held-out sibling test</h3>
      <p>We built the map without one language, then dropped that language in as if it were brand new. Does it land next to its sibling? ${hoPass} of ${R.held_out_sibling.length} tests pass. This mirrors the real use case: a new, unmapped language finding its rhythmic neighbours.</p>
      <div class="table-wrap"><table>
        <tr><th>Held out</th><th>Level</th><th>Expected</th><th>Nearest on map</th><th>Nearest in full features</th><th>Result</th></tr>
        ${hoRows}
      </table></div>
      <img src="img/held_out_siblings.png" alt="Four maps. In each, one language was left out when the map was built and then projected in. Ewondo lands nearest Fang in both versions; Bashkir lands nearest Tatar for clips, but for speaker averages the full-feature nearest is Torwali.">
      ${fam}

      <h3>Reliability</h3>
      <div class="table-wrap"><table>
        <tr><th>Language</th><th>Family</th><th>Clips</th><th>Speakers</th><th>Note</th></tr>
        ${R.speakers.map(s => `<tr><td>${PC.esc(s.language)}</td><td>${PC.esc(s.family)}</td><td>${s.clips}</td><td>${s.speakers}</td><td>${s.caveat ? "Fewer than 30 speakers: results may reflect a handful of people" : ""}</td></tr>`).join("")}
      </table></div>
      <p>These are read sentences, not conversation, and our rhythm measures are approximations that work without transcripts. See the About page for all limitations.</p>`;
  },

  about() {
    const langs = PC.data.languages.languages, nL = langs.length;
    const minSpk = Math.min(...langs.map(l => l.speakers));
    const fewest = langs.filter(l => l.speakers === minSpk).map(l => l.name).join(", ");
    document.getElementById("about-body").innerHTML = `
      <h2>About the Prosodic Commons</h2>
      <p class="lede">Every language has a music: how its voice rises and falls, where it pauses, how its syllables march. We map languages by that music rather than by their family trees.</p>

      <h3>The problem</h3>
      <p>Most of the world's languages have no voice technology. There is no voice assistant, no screen reader and no spoken learning app that sounds like home. When tools do exist for a small language, they usually borrow their rhythm and intonation from a large one, such as Urdu, and the result sounds foreign to the people it is meant to serve. Speakers of under-resourced languages are locked out of spoken health information and learning tools.</p>

      <h3>The idea</h3>
      <p>The idea began with our professor, a Kashmiri speaker, who could hear how rhythm carries across languages that are not mutually intelligible. Two languages can share a cadence even when their words are strangers. If under-resourced languages have <strong>rhythmic neighbours</strong>, then speech tools built for one could help build tools that sound native for the other, instead of borrowing the cadence of a dominant language.</p>
      <p>The Prosodic Commons measures a short prosodic fingerprint from any recording (pitch movement, rhythm and pauses, each measured relative to the speaker's own voice) and places it on a shared map. Languages that land close together are candidate rhythmic neighbours.</p>

      <h3>Why this is a justice question</h3>
      <p><strong>Health.</strong> A family receives medicine instructions or a vaccine reminder as text, or as a robotic voice in a language they only half understand. A spoken message in their own language, with a natural cadence, is the difference between information that lands and information that is ignored.</p>
      <p><strong>Education.</strong> A child whose home language has no reading app and no voice assistant learns that technology speaks someone else's language. Tools that sound like home support early literacy and keep the language alive.</p>

      <h3>It needs only audio</h3>
      <p>The method needs no transcripts, no dictionary and no writing system. It works from recordings alone, so it applies to languages that are mostly or entirely spoken, which are exactly the languages that text-based technology leaves behind.</p>

      <h3>What the prototype shows</h3>
      <p>Using ${nL} Common Voice languages, rhythm alone identifies the language well above chance, and both pairs of known sibling languages (Tatar and Bashkir, Fang and Ewondo) come out as each other's nearest rhythmic neighbours. Part of the separation comes from recording conditions rather than speech, and we show that openly on the <a href="#validation">Validation</a> page.</p>

      <h3>Honest limitations</h3>
      <ul>
        <li><strong>Read speech.</strong> Common Voice contributors read sentences aloud. Conversation has livelier rhythm, and reading style reflects each community's text collection.</li>
        <li><strong>Approximate rhythm measures.</strong> We find syllable-like beats from loudness peaks rather than from exact vowels and consonants, which would require transcripts.</li>
        <li><strong>Few speakers.</strong> Some languages have very few speakers (${PC.esc(fewest)}: ${minSpk}), so their results may reflect a handful of people.</li>
        <li><strong>Recording conditions.</strong> Background noise alone predicts the language almost as well as rhythm does. We correct for the part we can measure, but not for everything.</li>
        <li><strong>${nL} languages.</strong> This is a proof of concept. Adding a new Common Voice language takes one command, and the map updates automatically.</li>
      </ul>

      <h3>Roadmap</h3>
      <ul>
        <li><strong>Text-to-speech from rhythmic neighbours:</strong> train voices for an under-resourced language by borrowing prosody from its closest neighbour rather than from a dominant language.</li>
        <li><strong>Listening studies with native speakers:</strong> do people hear the neighbours the map predicts? Native listeners are the real test.</li>
        <li><strong>Accent-adaptive speech recognition:</strong> use rhythmic neighbours to adapt recognisers to speakers of small languages.</li>
        <li><strong>More languages and natural speech:</strong> the rest of our target list (Torwali's neighbours in the Himalaya and Hindu Kush, more Bantu and Turkic languages), and conversational recordings.</li>
      </ul>

      <h3>Consent and community</h3>
      <p>The recordings come from Mozilla Common Voice, where volunteers chose to donate their voices under a CC0 licence. We use only the audio and anonymous contributor IDs, never age, gender or other personal details, and we never try to identify anyone. We do not re-share the original recordings; the website plays a synthesized rhythm sketch instead. Any future tool built on this work should be designed with the language communities themselves, with their consent over how their voices and languages are used.</p>
      <p>The "Try Your Voice" tab processes your recording entirely on your device. Nothing is uploaded or stored.</p>

      <h3>Data and code</h3>
      <p>Mozilla Common Voice Scripted Speech 27.0 via the Mozilla Data Collective. Fingerprint specification, analysis and this site are reproducible from the project repository (see README).</p>`;
  },
};
