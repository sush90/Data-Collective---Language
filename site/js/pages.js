// Validation and About pages. Numbers match results_summary.md (data/validation.json).
const Pages = {
  validation() {
    const R = PC.data.validation;
    const pct = PC.fmtPct;
    const mc = R.confusion_clips.model;
    const clip = R.clip_classifier[mc], spk = R.speaker_classifier[R.confusion_speakers.model];
    const noise = R.silence_classifier[mc], resid = R.prosody_residual_classifier[mc];
    const chance = R.clip_classifier.chance_balanced;

    document.getElementById("validation-body").innerHTML = `
      <h2>Does it work? An honest check</h2>
      <p class="lede">We had 24 hours, so we kept our tests simple. In every test, the speakers used to build the model were never used to test it, so the model can't just memorize voices.</p>

      <h3>Can rhythm alone tell languages apart?</h3>
      <p>Mostly, yes. With 7 languages, random guessing gets 14% right. From rhythm alone (pitch movement, beats, and pauses), our model picked the right language 46% of the time from a single clip, and 57% when we averaged five clips from the same speaker.</p>

      <h3>Is it just hearing the microphones?</h3>
      <p>Partly, and this surprised us. Each language in Common Voice was recorded by its own small community, on its own phones and in its own rooms. When we trained the model on nothing but the background noise between words, it still guessed the language 44% of the time.</p>
      <p>So we removed everything in our rhythm measurements that the background noise could explain, and tested again. Rhythm still identified the language 40% of the time, almost three times chance. The pitch features were barely affected; the noise mostly explained pauses and silence. Our takeaway: some of what separates these languages is recording conditions, but a real rhythmic signal remains. Recordings of more speakers in more varied settings would settle it.</p>
      <img src="img/accuracy_summary.png" alt="Bar chart of balanced accuracy: rhythm on single clips ${pct(clip.balanced_accuracy)}, speaker averages ${pct(spk.balanced_accuracy)}, rhythm with the noise-predictable part removed ${pct(resid.balanced_accuracy)}, background noise only ${pct(noise.balanced_accuracy)}, shuffled labels about ${pct(clip.shuffled_balanced_mean)}; chance ${pct(chance)}.">

      <h3>Does it find languages we know are related?</h3>
      <p>We included two pairs linguists consider close relatives: Tatar and Bashkir, and Fang and Ewondo. The model was never told this. Fang and Ewondo came out as each other's closest rhythmic neighbor in every version of the map. Tatar and Bashkir did too for single clips, but not for speaker averages, where Tatar's closest match was Urdu.</p>

      <h3>Can it place a language it has never seen?</h3>
      <p>We built the map without Ewondo, then added it as if it were a brand-new language. It landed next to Fang. We did the same with Bashkir: it landed next to Tatar for single clips, but next to Torwali for speaker averages. Three out of four tests passed.</p>

      <h3>What this doesn't show</h3>
      <p>These are read sentences, not natural conversation. Our rhythm measures are approximations, since we don't have transcripts. And some languages have very few speakers: Ewondo and Torwali have 26 each, and Hazaragi only 7, so their results may reflect just a handful of people.</p>

      <div class="table-wrap"><table class="small-table">
        <tr><th>Language</th><th>Family</th><th>Speakers</th></tr>
        ${R.speakers.map(s => `<tr><td>${PC.esc(s.language)}</td><td>${PC.esc(s.family)}</td><td>${s.speakers}</td></tr>`).join("")}
      </table></div>`;
  },

  about() {
    document.getElementById("about-body").innerHTML = `
      <h2>About the Prosodic Commons</h2>
      <p class="lede">Every language has a music: how voices rise and fall, where speakers pause, how syllables move in time. We map languages by that music instead of by their family trees.</p>

      <h3>The problem</h3>
      <p>Most of the world's languages have no voice technology. No voice assistant, no screen reader, no spoken learning app that sounds like home.</p>
      <p>When a tool does exist for a small language, it is usually built on top of a large, dominant language nearby, such as Urdu, Persian, Swahili, Russian, or English, and it inherits that language's rhythm and intonation. To native speakers, the result sounds foreign. This locks speakers of under-resourced languages out of spoken health information and learning tools.</p>

      <h3>The idea</h3>
      <p>This project started with us. Our team members grew up speaking different languages from roughly the same part of the world. When we talk, something interesting happens: even in languages we don't speak, we sometimes catch a familiar word, or recognize the rhythm and melody of a sentence well enough to follow the gist of what someone is saying.</p>
      <p>That made us wonder: what if languages that share a region or a history also share a cadence, even when their vocabularies have drifted apart? If so, every under-resourced language might have a <strong>rhythmic neighbor</strong>, a language that sounds close to it, even if speakers of the two can't fully understand each other.</p>
      <p>That matters for technology. Today, a voice tool for a small language borrows its rhythm from whichever big language has the most data. We think it should borrow from the language that actually sounds closest. Finding those neighbors is the first step, and it is what this prototype does.</p>

      <h3>How it works</h3>
      <p>From any recording, we measure a short prosodic fingerprint: how the pitch moves, where the beats fall, and how long the pauses are. Each measurement is relative to that recording's own voice, so it captures how someone speaks, not whether their voice is high or low.</p>
      <p>We then place every fingerprint on a shared map. Languages that land close together are candidate rhythmic neighbors.</p>

      <h3>Why this is a justice question</h3>
      <p><strong>Health.</strong> A family receives medicine instructions or a vaccine reminder as text they cannot easily read, or as a robotic voice in a language they only half understand. A spoken message in their own language, with a natural cadence, is the difference between information that lands and information that gets ignored.</p>
      <p><strong>Education.</strong> A child whose home language has no reading app and no voice assistant learns early that technology speaks someone else's language. Tools that sound like home support early literacy and help keep a language alive.</p>

      <h3>It needs only audio</h3>
      <p>The method needs no transcripts, no dictionary, and no writing system. It works from recordings alone, so it applies to languages that are mostly or entirely spoken, which are exactly the languages text-based technology leaves behind.</p>

      <h3>What the prototype shows</h3>
      <p>Using 7 Common Voice languages, rhythm alone identifies the language about three times better than chance. Without being told which languages are related, the map places Fang and Ewondo as each other's closest rhythmic neighbors, and Tatar and Bashkir too when looking at single clips.</p>
      <p>Part of the separation comes from recording conditions rather than speech, and we show that openly on the <a href="#validation">Validation</a> page.</p>

      <h3>Honest limitations</h3>
      <dl class="items">
        <dt>Read speech</dt>
        <dd>Common Voice contributors read sentences aloud. Natural conversation has livelier rhythm.</dd>
        <dt>Approximate rhythm measures</dt>
        <dd>We find syllable-like beats from loudness peaks, not from exact vowels and consonants, which would require transcripts.</dd>
        <dt>Few speakers</dt>
        <dd>Some languages have very few speakers (Hazaragi: 7), so their results may reflect a handful of people.</dd>
        <dt>Recording conditions</dt>
        <dd>Background noise alone predicts the language almost as well as rhythm does, because each language was recorded by its own small community. We correct for what we can measure, but not for everything.</dd>
        <dt>Proof of concept</dt>
        <dd>This is 7 languages. Adding a new Common Voice language takes one command, and the map updates automatically.</dd>
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
        <dd>More families across South and Central Asia, Africa, and beyond, and conversational recordings.</dd>
      </dl>

      <h3>Consent and community</h3>
      <p>The recordings come from Mozilla Common Voice, where volunteers chose to donate their voices. We use only the audio and anonymous contributor IDs, never age, gender, or other personal details, and we never try to identify anyone.</p>
      <p>We do not re-share the original recordings; the website plays a synthesized rhythm sketch instead. Any future tool built on this work should be designed with the language communities themselves, with their consent over how their voices and languages are used.</p>
      <p>Try Your Voice processes your recording entirely on your device. Nothing is uploaded or stored.</p>

      <h3>Data and code</h3>
      <p>Mozilla Common Voice Scripted Speech 27.0 via the Mozilla Data Collective. The fingerprint specification, analysis, and this site are reproducible from the project repository (see README).</p>`;
  },
};
