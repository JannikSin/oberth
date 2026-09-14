// mic.js: what microphone actually recorded, and whether it was the right one.
//
// WHY THIS EXISTS. David, 2026-09-13, looking at a day of mangled transcripts
// (a research term came back as an unrelated four-word phrase, a building name as
// two different wrong surnames): "check audio quality, it should have been from airpods and
// on an apple phone so should have really good quality right??"
//
// Reasonable, and backwards, and it is worth being precise about why.
//
// AirPods are an excellent OUTPUT device and a poor INPUT device, and the
// reason is Bluetooth, not Apple. Playback runs over A2DP, which is one-way
// and buffered, so it can afford a high bitrate. The moment any app opens the
// microphone, the link has to become two-way and low-latency, so iOS switches
// the earbuds into the voice path (HFP, or Apple's newer wideband equivalent).
// That path is built for phone calls: mono, heavily processed, and sampled at
// 16 kHz or below where the iPhone's own mic array runs at 48 kHz. Consonants
// are the first thing to go, which is exactly the failure in his transcripts:
// the vowels survive and the word is wrong.
//
// This is the SAME finding voicetype hit on Windows on 2026-09-07 (session
// dresden, Crystal System/Voice-Typing): "Windows can only reach AirPods over
// HFP, the compressed telephone path... that is the whole 3.8% vs 10-14% WER
// gap." Two operating systems, one cause. It was never a Windows bug.
//
// So the answer is: for RECORDING, take the AirPods out. The iPhone's built-in
// mic is the better instrument here, and it is the one already in his hand.
//
// This module does not argue that in the abstract. It MEASURES it: every
// recording now carries the device label and sample rate it was captured at,
// the app says so on screen while he records, and the note keeps it. If a
// future transcript is bad, the first question ("what was it recorded on?")
// has an answer on the record instead of a guess.

/**
 * Constraints for getUserMedia.
 *
 * `echoCancellation: false` is the load-bearing one and it is NOT a style
 * choice. With echo cancellation on, Safari and Chrome route capture through
 * the platform's voice-processing unit, which is a telephony DSP: it
 * downsamples, gates, and ducks anything it decides is not near-field speech.
 * That is correct for a call and wrong for dictation, where the whole product
 * is the consonants. Turning it off is what lets the browser open the plain
 * high-rate input path.
 *
 * `autoGainControl` stays ON deliberately. He records at arm's length, walking,
 * in rooms of wildly different loudness, and a level that drifts is worse for
 * transcription than a level that is nudged. Noise suppression stays OFF for
 * the same reason echo cancellation does: it is part of the same voice DSP.
 *
 * Every field is a REQUEST. A browser may ignore any of them, which is the
 * entire reason report() below reads back what actually happened rather than
 * trusting what was asked for.
 */
export const AUDIO_CONSTRAINTS = {
  channelCount: 1,          // speech is mono; a fake second channel is wasted bytes
  sampleRate: 48000,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: true,
};

/** Bluetooth voice-path devices, by the names the platforms actually report. */
const BT_HINTS = [
  "airpod", "bluetooth", "headset", "hands-free", "handsfree", "hfp",
  "beats", "buds", "wireless",
];

/**
 * Judge a capture from what the platform reported about it.
 *
 * Deliberately conservative about the two signals, because they lie in
 * opposite directions and neither is trustworthy alone:
 *
 *   - The LABEL is the strong signal on iOS. Safari hands over a real device
 *     name once permission is granted, and "David's AirPods Pro" is not
 *     ambiguous.
 *   - The SAMPLE RATE is the strong signal everywhere else, but on iOS it can
 *     report the AudioContext's rate rather than the hardware's, so a
 *     Bluetooth capture can still claim 48000. It is therefore treated as
 *     evidence FOR a problem when it is low, and never as proof of absence
 *     when it is high.
 *
 * @param {{sampleRate?: number, channelCount?: number, deviceId?: string}|null} settings
 * @param {string} [label]
 * @returns {{hz: number|null, label: string, level: "good"|"voice"|"bluetooth"|"unknown", warn: string|null, short: string}}
 */
export function judgeInput(settings, label) {
  const s = settings || {};
  const hz = Number(s.sampleRate) > 0 ? Number(s.sampleRate) : null;
  const name = String(label || "").trim();
  const lower = name.toLowerCase();
  const bt = BT_HINTS.some((h) => lower.includes(h));

  const shown = name || "unknown mic";
  const short = shown + (hz ? " · " + Math.round(hz / 100) / 10 + " kHz" : "");

  if (bt) {
    return {
      hz, label: shown, level: "bluetooth", short,
      warn: "Recording through " + shown + ". Bluetooth earbuds drop to the phone-call "
          + "audio path the moment a mic opens, which is about a third of the detail. "
          + "Take them out and use the phone itself; the transcript will be noticeably better.",
    };
  }
  if (hz !== null && hz <= 24000) {
    return {
      hz, label: shown, level: "voice", short,
      warn: "This captured at " + Math.round(hz / 1000) + " kHz, which is the phone-call "
          + "audio path rather than the full-quality one. If anything is paired over "
          + "Bluetooth, disconnect it and record again.",
    };
  }
  if (hz !== null && hz >= 44100) {
    return { hz, label: shown, level: "good", short, warn: null };
  }
  return { hz, label: shown, level: "unknown", short, warn: null };
}

/**
 * Pull the honest description of a live capture off its track.
 * Never throws: this runs inside a recorder start path and a failure to
 * describe the mic must not stop him recording.
 * @param {MediaStream} stream
 */
export function describeStream(stream) {
  try {
    const track = stream.getAudioTracks()[0];
    if (!track) return judgeInput(null, "");
    const settings = typeof track.getSettings === "function" ? track.getSettings() : {};
    return judgeInput(settings, track.label);
  } catch (e) {
    return judgeInput(null, "");
  }
}

/**
 * Ask for the best capture the browser will give, then fall back.
 *
 * The fallback matters: Firefox and some Android builds reject an
 * over-specified audio constraint set outright rather than negotiating, and a
 * refused constraint must never become "this phone will not record".
 * @param {MediaDevices} md
 */
export async function openMic(md) {
  try {
    return await md.getUserMedia({ audio: AUDIO_CONSTRAINTS });
  } catch (e) {
    // OverconstrainedError and friends. Take whatever it will give.
    return await md.getUserMedia({ audio: true });
  }
}
