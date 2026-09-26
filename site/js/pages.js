// Validation and About pages. Numbers come from data/validation.json (outputs/results.json);
// the wording describes the 10-language run in results_summary.md.
const Pages = {
  validation() {
    const R = PC.data.validation;
    const pct = PC.fmtPct;
    const mc = R.confusion_clips.model;
    const clip = R.clip_classifier[mc], spk = R.speaker_classifier[R.confusion_speakers.model];
    const noise = R.silence_classifier[mc], resid = R.prosody_residual_classifier[mc];
    const chance = R.clip_classifier.chance_balanced;
    const n = R.languages.length;
    const recall = name => R.confusion_speakers.matrix[R.languages.indexOf(name)][R.languages.indexOf(name)];
    const boot = (level, pair) => (R[`siblings_bootstrap_${level}`][pair] || {}).top1;
    const pairs = [["Tatar", "Bashkir"], ["Fang", "Ewondo"], ["Torwali", "Kohistani Shina"]];
    const fam = R.held_out_family || {};
    const hos = R.held_out_sibling || [];
    const hosPass = hos.filter(h => h.pass).length;

    document.getElementById("validation-body").innerHTML = `
      <h2>Does it work? An honest check</h2>
      <p class="lede">We kept our tests simple and ran every one of them the same way: the speakers used to build the model were never used to test it, so the model can't just memorize voices. This run covers ${n} languages from ${new Set(Object.values(R.families)).size} language families.</p>

      <h3>Can rhythm alone tell languages apart?</h3>
      <p>Yes, well above chance. With ${n} languages, random guessing gets ${pct(chance)} right. From rhythm alone (pitch movement, beats, and pauses), our model picked the right language ${pct(clip.balanced_accuracy)} of the time from a single clip, and ${pct(spk.balanced_accuracy)} when we averaged five clips from the same speaker.</p>

      <h3>Is it just hearing the microphones?</h3>
      <p>Partly. Each language in Common Voice was recorded by its own community, on its own phones and in its own rooms. When we trained the model on nothing but the background noise between words, it still guessed the language ${pct(noise.balanced_accuracy)} of the time.</p>
      <p>So we removed everything in our rhythm measurements that the background noise could explain, and tested again. Rhythm still identified the language ${pct(resid.balanced_accuracy)} of the time, almost four times chance. Some of what separates these languages is recording conditions, but a real rhythmic signal remains.</p>
      <p>The new languages make the pattern clearer. The languages recorded by only a handful of people are the easiest to recognize: Hazaragi, with 7 speakers, is recognized ${pct(recall("Hazaragi"))} of the time from speaker averages. Rioplatense Spanish, with hundreds of speakers on hundreds of devices, is recognized only ${pct(recall("Rioplatense Spanish"))} of the time and sits in the middle of the map, close to many languages. A small community's recordings share a sound; a large community's do not.</p>
      <img src="img/accuracy_summary.png" alt="Bar chart of balanced accuracy: rhythm on single clips ${pct(clip.balanced_accuracy)}, speaker averages ${pct(spk.balanced_accuracy)}, rhythm with the noise-predictable part removed ${pct(resid.balanced_accuracy)}, background noise only ${pct(noise.balanced_accuracy)}, shuffled labels about ${pct(clip.shuffled_balanced_mean)}; chance ${pct(chance)}.">

      <h3>Does it find languages we know are related?</h3>
      <p>We included three pairs that linguists consider close relatives. The model was never told this. We re-ran the comparison 500 times on random resamples of speakers and counted how often each pair came out as <em>each other's</em> closest rhythmic neighbor. For comparison, a language would pick a given other language as its closest by pure chance only ${pct(R.sibling_chance.top1_one_direction)} of the time, and both picking each other is rarer still.</p>
      <div class="table-wrap"><table>
        <tr><th>Pair</th><th>Single clips</th><th>Speaker averages</th><th>Noise removed</th></tr>
        ${pairs.map(([a, b]) => { const p = `${a}-${b}`; return `<tr><td>${PC.esc(a)} and ${PC.esc(b)}</td>
          <td>${pct(boot("clips", p))}</td><td>${pct(boot("speakers", p))}</td><td>${pct(boot("residual", p))}</td></tr>`; }).join("")}
      </table></div>
      <p><strong>Fang and Ewondo</strong> hold up best. <strong>Tatar and Bashkir</strong> are a clear pair for single clips, but not for speaker averages, where Tatar's closest match is Urdu.</p>
      <p><strong>Torwali and Kohistani Shina</strong>, two Dardic languages from neighboring valleys in northern Pakistan, are a one-way match. Kohistani Shina's closest rhythmic neighbor is Torwali in every version of the map. But Torwali's closest is usually Rioplatense Spanish, which sits near the middle of the map for the reason above. Kohistani Shina has only 9 speakers, so this is a first look, not a finding.</p>

      <h3>Can it place a language it has never seen?</h3>
      <p>We built the map without Ewondo, then added it as if it were a brand-new language. It landed next to Fang. We did the same with Bashkir: it landed next to Tatar for single clips, but next to Rioplatense Spanish for speaker averages. ${hosPass} of ${hos.length} tests passed.</p>
      ${fam.results ? `<p>With six families on the map we could finally run a harder version: we removed the whole ${PC.esc(fam.family)} family (Tatar and Bashkir) and added each one back on its own. ${Object.entries(fam.results).map(([l, r]) => `${PC.esc(l)} landed nearest ${PC.esc(r.nearest)}`).join(", and ")}, so ${fam.pass ? "each found its own family among the other languages" : "the test failed"}.</p>` : ""}

      <h3>Do English and Spanish sound different?</h3>
      <p>We expected so. Linguists often describe English as "stress-timed" (stressed syllables at a steady beat, others squeezed between them) and Spanish as "syllable-timed" (each syllable taking similar time). Instead, Scottish English and Rioplatense Spanish came out as each other's closest neighbors in most views.</p>
      <p>We don't trust that result. The noise-only check puts these two closer together than any other pair of languages: both come from the same Common Voice release of regional recordings, made by many contributors on similar equipment. Our beat detector also finds syllable-like peaks in loudness rather than measuring vowel and consonant lengths, which is what the classic rhythm studies use. So this test does not confirm the textbook contrast, and we can't yet tell whether the method or the recordings are responsible.</p>

      <h3>What this doesn't show</h3>
      <p>These are read sentences, not natural conversation. Our rhythm measures are approximations, since we don't have transcripts. Spanish and English are each a single regional variety, not the whole language. Kohistani Shina stands in for Kashmiri, which has no dataset yet. And some languages have very few speakers: Hazaragi 7, Kohistani Shina 9, Ewondo and Torwali 26 each, so their results may reflect just a handful of people.</p>

      <div class="table-wrap"><table class="small-table">
        <tr><th>Language</th><th>Family</th><th>Clips</th><th>Speakers</th></tr>
        ${R.speakers.map(s => `<tr><td>${PC.esc(s.language)}</td><td>${PC.esc(s.family)}</td><td>${s.clips}</td><td>${s.speakers}${s.caveat ? " *" : ""}</td></tr>`).join("")}
      </table></div>
      <p class="hint">* Fewer than 30 speakers: treat with caution.</p>`;
  },

  about() {
    const n = PC.data.languages.languages.length;
    const nf = PC.data.languages.families.length;
    const R = PC.data.validation;
    const mc = R.confusion_clips.model;
    const ratio = Math.round(R.clip_classifier[mc].balanced_accuracy / R.clip_classifier.chance_balanced);
    document.getElementById("about-body").innerHTML = `
      <h2>About the Prosodic Commons</h2>
      <p class="lede">Every language has a music: how voices rise and fall, where speakers pause, how syllables move in time. We map languages by that music, and show it on a map of the world.</p>

      <h3>The problem</h3>
      <p>Most of the world's languages have no voice technology. No voice assistant, no screen reader, no spoken learning app that sounds like home.</p>
      <p>When a tool does exist for a small language, it is usually built on top of a large, dominant language nearby, such as Urdu, Persian, Swahili, Russian, or English, and it inherits that language's rhythm and intonation. To native speakers, the result sounds foreign. This locks speakers of under-resourced languages out of spoken health information and learning tools.</p>

      <h3>The idea</h3>
      <p>This project started with us. Our team members grew up speaking different languages from roughly the same part of the world. When we talk, something interesting happens: even in languages we don't speak, we sometimes catch a familiar word, or recognize the rhythm and melody of a sentence well enough to follow the gist of what someone is saying.</p>
      <p>That made us wonder: what if languages that share a region or a history also share a cadence, even when their vocabularies have drifted apart? If so, every under-resourced language might have a <strong>rhythmic neighbor</strong>, a language that sounds close to it, even if speakers of the two can't fully understand each other.</p>
      <p>That matters for technology. Today, a voice tool for a small language borrows its rhythm from whichever big language has the most data. We think it should borrow from the language that actually sounds closest. Finding those neighbors is the first step, and it is what this prototype does.</p>

      <h3>How it works</h3>
      <p>From any recording, we measure a short prosodic fingerprint: how the pitch moves, where the beats fall, and how long the pauses are. Each measurement is relative to that recording's own voice, so it captures how someone speaks, not whether their voice is high or low.</p>
      <p>The <strong>world map</strong> shows where each language is spoken. Click a language to read about it; dashed lines join it to the three languages whose rhythm is closest, which are often not its geographic neighbors. The <strong>sound map</strong> places every recording by its fingerprint alone, so languages that land close together sound alike.</p>

      <h3>Why this is a justice question</h3>
      <p><strong>Health.</strong> A family receives medicine instructions or a vaccine reminder as text they cannot easily read, or as a robotic voice in a language they only half understand. A spoken message in their own language, with a natural cadence, is the difference between information that lands and information that gets ignored.</p>
      <p><strong>Education.</strong> A child whose home language has no reading app and no voice assistant learns early that technology speaks someone else's language. Tools that sound like home support early literacy and help keep a language alive.</p>

      <h3>It needs only audio</h3>
      <p>The method needs no transcripts, no dictionary, and no writing system. It works from recordings alone, so it applies to languages that are mostly or entirely spoken, which are exactly the languages text-based technology leaves behind.</p>

      <h3>What the prototype shows</h3>
      <p>We compared ${n} Common Voice languages from ${nf} families across Africa, Europe, South and Central Asia, and South America: from Torwali and Kohistani Shina, spoken in mountain valleys of northern Pakistan, to English and Spanish, two of the most widely spoken languages on Earth. Rhythm alone identifies the language about ${ratio} times better than chance.</p>
      <p>Without being told which languages are related, the map places Fang and Ewondo as each other's closest rhythmic neighbors, Tatar and Bashkir too when looking at single clips, and Kohistani Shina's closest neighbor is always Torwali.</p>
      <p>Adding English and Spanish also taught us something about the data: languages recorded by a small community are easier to tell apart than languages recorded by thousands of people on thousands of devices. We show that openly on the <a href="#validation">Validation</a> page.</p>

      <h3>Honest limitations</h3>
      <dl class="items">
        <dt>Read speech</dt>
        <dd>Common Voice contributors read sentences aloud. Natural conversation has livelier rhythm.</dd>
        <dt>Approximate rhythm measures</dt>
        <dd>We find syllable-like beats from loudness peaks, not from exact vowels and consonants, which would require transcripts.</dd>
        <dt>Few speakers</dt>
        <dd>Some languages have very few speakers (Hazaragi: 7, Kohistani Shina: 9), so their results may reflect a handful of people.</dd>
        <dt>Recording conditions</dt>
        <dd>Background noise alone predicts the language almost as well as rhythm does, because each language was recorded by its own community. We correct for what we can measure, but not for everything.</dd>
        <dt>One variety per language</dt>
        <dd>Spanish is Rioplatense Spanish (Argentina and Uruguay) and English is Scottish English: single regional varieties, not the whole language.</dd>
        <dt>Kashmiri</dt>
        <dd>We wanted Kashmiri, but it has no dataset on the Mozilla Data Collective yet. Kohistani Shina, a Dardic relative, stands in for it.</dd>
        <dt>Map locations</dt>
        <dd>Each dot marks a representative place where the language is spoken, not a boundary. Speaker numbers are rough published estimates.</dd>
        <dt>Proof of concept</dt>
        <dd>This is ${n} languages. Adding a new Common Voice language takes one command, and both maps update automatically.</dd>
      </dl>

      <h3>What's next</h3>
      <dl class="items">
        <dt>Text-to-speech from rhythmic neighbors</dt>
        <dd>Build voices for under-resourced languages by borrowing prosody from their closest neighbor instead of from a dominant language.</dd>
        <dt>Listening studies with native speakers</dt>
        <dd>Do people hear the neighbors the map predicts? Native listeners are the real test.</dd>
        <dt>Accent-inclusive speech recognition</dt>
        <dd>Use rhythmic neighbors to help recognizers understand speakers of small languages.</dd>
        <dt>More languages and natural speech</dt>
        <dd>Kashmiri and other languages of South and Central Asia as their datasets appear, more of Africa and beyond, and conversational recordings.</dd>
      </dl>

      <h3>Consent and community</h3>
      <p>The recordings come from Mozilla Common Voice, where volunteers chose to donate their voices. We use only the audio and anonymous contributor IDs, never age, gender, accent labels, or other personal details, and we never try to identify anyone.</p>
      <p>We do not re-share the original recordings; the website plays a synthesized rhythm sketch instead. Any future tool built on this work should be designed with the language communities themselves, with their consent over how their voices and languages are used.</p>
      <p>Try Your Voice processes your recording entirely on your device. Nothing is uploaded or stored.</p>

      <h3>Data and code</h3>
      <p>Mozilla Common Voice Scripted Speech 27.0, and the 26.0 regional releases for Rioplatense Spanish and Scottish English, via the Mozilla Data Collective. Country outlines from Natural Earth (public domain). The fingerprint specification, analysis, and this site are reproducible from the project repository (see README).</p>`;
  },
};
