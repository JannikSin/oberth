// Push the transcription vocabulary into Worker KV.
//
// The list is personal content: course codes, professor surnames, a research
// lab, clubs, employers. This repo is PUBLIC, so the list is gitignored at
// data/vocab.json and lives in KV, exactly like the course rulebook (commit
// 8d1f09c). `worker/src/index.js` carries only a generic floor used when KV
// has no vocab key.
//
//   Usage:  OBERTH_KEY=<laptop key> node tools/push-vocab.mjs [--dry-run]
//
// Reads back after writing, because a POST returning ok proves nothing. Same
// lesson as the courses rulebook, learned the hard way on 2026-09-06.

import { readFileSync } from "node:fs";

const WORKER = "https://oberth.janniksin.workers.dev";
const KEY = process.env.OBERTH_KEY;
const DRY = process.argv.includes("--dry-run");

if (!KEY) {
  console.error("Set OBERTH_KEY (the laptop key). The phone key cannot write /vocab.");
  process.exit(1);
}

const file = new URL("../data/vocab.json", import.meta.url);
let terms;
try {
  terms = JSON.parse(readFileSync(file, "utf8")).terms;
} catch (e) {
  console.error("Could not read data/vocab.json: " + e.message);
  process.exit(1);
}
if (!Array.isArray(terms) || !terms.length) {
  console.error("data/vocab.json has no terms[].");
  process.exit(1);
}

// The budget is real and overflow is SILENT: whisper caps the prompt at 224
// tokens and drops the TAIL, so an over-long list quietly loses whichever
// terms were added last, which are the ones added because they fail.
const joined = terms.join(", ");
const est = Math.ceil(joined.length / 3.5);
console.log(`${terms.length} terms, ${joined.length} chars, about ${est} tokens of 224`);
if (est > 200) {
  console.error("REFUSING: over the 200-token working limit. Remove a term before adding one.");
  process.exit(1);
}

if (DRY) {
  console.log(joined);
  console.log("\nDry run, nothing sent.");
  process.exit(0);
}

const post = await fetch(WORKER + "/vocab", {
  method: "POST",
  headers: { "content-type": "application/json", "x-oberth-key": KEY },
  body: JSON.stringify({ terms }),
});
console.log("POST /vocab ->", post.status, await post.text());

const back = await fetch(WORKER + "/vocab", { headers: { "x-oberth-key": KEY } });
const live = await back.json();
const ok = Array.isArray(live.terms) && live.terms.length === terms.length;
console.log(`GET /vocab -> ${live.terms ? live.terms.length : 0} terms  ${ok ? "MATCHES" : "MISMATCH"}`);
process.exit(ok ? 0 : 1);
