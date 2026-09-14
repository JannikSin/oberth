// The two things that decide whether a night's notes come back readable:
// which microphone recorded them, and whether the vocabulary the model is
// primed with actually reached the model.
//
// Both are silent failures. A Bluetooth capture does not error, it just comes
// back wrong. An over-budget prompt does not error either, it is truncated
// from the end, so the newest terms (the ones added BECAUSE they fail) are
// exactly the ones dropped. Neither would ever show up as a bug report; they
// show up as "the transcripts are bad" three weeks later, which is what
// happened.

import { readFileSync } from "node:fs";
import { judgeInput, AUDIO_CONSTRAINTS } from "../app/mic.js";

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? (pass++, console.log("  ok   " + msg)) : (fail++, console.log("  FAIL " + msg)); };

console.log("\n-- the capture David actually used on 2026-09-13 --");
// iOS reports a real device name once permission is granted. This is the case
// that produced an unrelated four-word phrase in place of a research term.
const air = judgeInput({ sampleRate: 16000, channelCount: 1 }, "David's AirPods Pro");
ok(air.level === "bluetooth", "AirPods are called out as the Bluetooth voice path");
ok(/take them out/i.test(air.warn || ""), "and the advice is the actionable half, not a diagnosis");
ok(air.short.includes("16 kHz"), "the rate is shown so it is a measurement, not an opinion");

console.log("\n-- the capture he should be using --");
const phone = judgeInput({ sampleRate: 48000, channelCount: 1 }, "iPhone Microphone");
ok(phone.level === "good", "the phone's own mic at 48 kHz passes clean");
ok(phone.warn === null, "and says nothing, because a warning that always fires is ignored");

console.log("\n-- the label is trusted over the rate, deliberately --");
// Safari can report the AudioContext rate rather than the hardware rate, so a
// Bluetooth capture may still claim 48000. The name is the stronger signal.
const lying = judgeInput({ sampleRate: 48000 }, "AirPods Pro (Hands-Free)");
ok(lying.level === "bluetooth", "a Bluetooth name wins even when the rate looks fine");

console.log("\n-- a low rate is caught even with no useful name --");
const anon = judgeInput({ sampleRate: 8000 }, "");
ok(anon.level === "voice", "8 kHz is the call path whatever it calls itself");
ok(anon.label === "unknown mic", "and an empty label says so rather than printing nothing");

console.log("\n-- it never throws on the shapes a browser really returns --");
ok(judgeInput(null, undefined).level === "unknown", "no settings at all");
ok(judgeInput({}, "").level === "unknown", "empty settings object");
ok(judgeInput({ sampleRate: 0 }, "Mic").hz === null, "a zero rate is absent, not zero");
ok(judgeInput({ sampleRate: 44100 }, "USB Audio").level === "good", "44.1 kHz still counts as full quality");

console.log("\n-- the constraints are the ones that matter, not decoration --");
ok(AUDIO_CONSTRAINTS.echoCancellation === false,
   "echo cancellation OFF (it routes capture through the telephony DSP)");
ok(AUDIO_CONSTRAINTS.noiseSuppression === false, "noise suppression OFF, same DSP");
ok(AUDIO_CONSTRAINTS.autoGainControl === true,
   "but gain control ON, because he records at arm's length in rooms of every loudness");
ok(AUDIO_CONSTRAINTS.channelCount === 1, "mono; a duplicated channel is wasted upload");

console.log("\n-- the vocabulary: public floor clean, private list inside budget --");
// The REAL list moved to Worker KV on 2026-09-14, because this repo is PUBLIC
// and the list had grown to carry his course codes, six professor surnames,
// his research lab, his clubs and an employer he is applying to. Two things to
// check now: the floor that ships must stay impersonal, and the private list,
// when it is on this machine, must fit whisper's prompt.
const src = readFileSync(new URL("../worker/src/index.js", import.meta.url), "utf8");
const floorBlock = src.match(/const VOCAB_FLOOR = \[([\s\S]*?)\]\.join/)[1].replace(/\/\/.*$/gm, "");
const floor = [...floorBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
ok(floor.length > 5, "the public floor exists, so transcription works before KV is seeded");

// THE GATE THAT KEEPS THIS REPO PUBLISHABLE. If someone adds a course code, a
// professor, a lab or an employer to the floor "just for now", this fails
// before it is pushed.
//
// Deliberately an ALLOWLIST, not a deny-list. The first version of this check
// listed the sensitive terms so it could reject them, which meant a public
// test file enumerating exactly which words identify him: self-defeating. An
// allowlist publishes nothing and is the stronger check anyway, because it
// catches identifiers nobody thought to ban.
const GENERIC = new Set([
  "Gradescope", "Brightspace", "Lagrangian", "Hamiltonian", "Coriolis",
  "periapsis", "configuration space", "state space", "metric tensor",
  "Einstein summation", "contravariant", "covariant", "nonlinear dynamics",
  "OpenFOAM", "ANSYS", "Siemens NX", "Teamcenter",
]);
const leaked = floor.filter((t) => !GENERIC.has(t));
ok(leaked.length === 0,
   "and every term in it is on the generic allowlist"
   + (leaked.length ? "; NOT allowed: " + leaked.join(", ") : ""));
// Shape check too, so a course code cannot be waved through by being added to
// the allowlist in the same commit.
const CODE_SHAPE = /^[A-Z]{2,5} ?[0-9]{3}$/;
ok(!floor.some((t) => CODE_SHAPE.test(t)), "and none of them is shaped like a course code");

let priv = null;
try {
  priv = JSON.parse(readFileSync(new URL("../data/vocab.json", import.meta.url), "utf8")).terms;
} catch (e) { /* gitignored, so absent on a fresh clone. That is the point. */ }

if (!priv) {
  console.log("     data/vocab.json absent (gitignored), budget check skipped");
} else {
  const joined = priv.join(", ");
  const est = Math.ceil(joined.length / 3.5);
  console.log("     " + priv.length + " terms, " + joined.length + " chars, about " + est + " tokens of 224");
  ok(est <= 224, "the live vocabulary fits the prompt cap (over-budget silently drops the NEWEST terms)");
  ok(est <= 200, "with headroom, so the next session can add a measured miss without a rebuild");
  ok(priv.includes("ME 239"), "his eighth course is primed");
  ok(priv.length > floor.length, "and the live list is richer than the public floor");
}

console.log("\n-- and the language is pinned --");
ok(/fd\.append\("language", "en"\)/.test(src),
   "language=en (an unpinned model reaches for other languages' caption boilerplate)");

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
