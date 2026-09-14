// app/lib/awake.js is a MIRRORED FILE. Mise owns it; Oberth carries a copy.
//
// David's standing rule, learned the hard way twice on Mise's own targets pair:
// never hand-edit one file of a mirrored pair. Write all copies, then have a
// test that fails when they drift. This is that test.
//
// Why a copy at all rather than a shared package: these are eight independent
// static PWAs with no build step and no node_modules at runtime, served from
// eight different GitHub Pages paths. There is nothing to share THROUGH. So
// the copy is deliberate and the divergence check is the price of it.
//
// If this fails, the fix is NOT to re-copy blindly. Read both, decide which
// direction the change was meant to travel, apply it to BOTH, and re-run this
// in both repos.
//
// If Mise is not on this machine the test SKIPS rather than fails: a missing
// sibling repo is not a defect in Oberth, and a false red here would train
// someone to ignore the suite.

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const MINE = new URL("../app/lib/awake.js", import.meta.url);
const THEIRS = "C:/Users/DATar/Projects/mise/app/lib/awake.js";

let pass = 0, fail = 0, skip = 0;
const ok = (c, msg) => { c ? (pass++, console.log("  ok   " + msg)) : (fail++, console.log("  FAIL " + msg)); };
const sha = (b) => createHash("sha256").update(b).digest("hex");

console.log("\n-- awake.js is mirrored from Mise, byte for byte --");

const mine = readFileSync(MINE);
ok(mine.length > 4000, "oberth's copy exists and is not a stub");
ok(mine.includes("wakeLock"), "it still asks for a real screen wake lock");
ok(mine.includes("TINY_MP4"), "it still carries the silent-video fallback");
// Structural, not a substring of the comments. An MP4 with sound carries a
// 'soun' handler and an 'mp4a' sample entry; this file must carry neither, or
// it takes the audio session and pauses whatever he is listening to.
const b64 = String(mine).match(/data:video\/mp4;base64,([A-Za-z0-9+/=]+)/)?.[1] || "";
const mp4 = Buffer.from(b64, "base64");
ok(mp4.length > 500, "the fallback video decodes to a real MP4");
ok(!mp4.includes(Buffer.from("soun")), "the MP4 has NO audio handler (it must never take his music)");
ok(!mp4.includes(Buffer.from("mp4a")), "the MP4 has NO audio sample entry");
ok(mp4.includes(Buffer.from("avc1")), "the MP4 does carry a video track, so frames really run");

if (!existsSync(THEIRS)) {
  skip++;
  console.log("  skip Mise is not on this machine, divergence not checked");
} else {
  const theirs = readFileSync(THEIRS);
  const a = sha(mine), b = sha(theirs);
  if (a !== b) {
    console.log("     oberth " + a.slice(0, 16) + "  " + mine.length + " bytes");
    console.log("     mise   " + b.slice(0, 16) + "  " + theirs.length + " bytes");
  }
  ok(a === b, "identical to " + THEIRS);
}

console.log("\n" + pass + " passed, " + fail + " failed, " + skip + " skipped\n");
process.exit(fail ? 1 : 0);
