#!/usr/bin/env node
// patch-courses.mjs — apply the 2026-08-31 rulebook corrections to Worker KV.
//
// The rulebook lives in the Worker (decision: keep the timetable out of the
// public repo), so course-data fixes cannot ride a git push. This script GETs
// the live rulebook, applies the corrections below idempotently, shows the
// diff, and POSTs it back. POST /courses needs the LAPTOP key.
//
//   Usage:  OBERTH_KEY=<laptop key> node tools/patch-courses.mjs [--dry-run]
//
// Corrections carried (session sandbox, from David's own reports):
//   1. MFET lab effort 1.5h -> 3h. Measured: the 2026-08-30 set ran to 2 AM
//      (textbook quizzes, follow-along NX, syllabus quizzes, videos, pre-lab).
//   2. MFET note: do NX ON CAMPUS (PHYS 022, TA hours M-Th 5:30-7:30);
//      AppsAnywhere off campus is unusable over the VPN.
//   3. ME 264 lab starts ~week 3: prelab rule windowed from 2026-09-01 (first
//      instance Sep 14 after Labor Day), memo from 2026-09-15 (first Sep 21).
//      VERIFY the real dates on Brightspace.
//   4. Drop pools linked to the rules that spend them, which is what lets the
//      Track tab offer "Skip · N left" on the exact assignment.

const WORKER = "https://oberth.janniksin.workers.dev";
const KEY = process.env.OBERTH_KEY;
const DRY = process.argv.includes("--dry-run");

if (!KEY) {
  console.error("Set OBERTH_KEY (the laptop key). The phone key cannot POST /courses.");
  process.exit(1);
}

const PATCHES = [
  { ruleId: "mfet-lab", set: { effortH: 3, dropId: "mfet-assign-drops" },
    appendNote: "Measured 2026-08-30: the weekly set ran to 2 AM. Do NX ON CAMPUS (PHYS 022, TA hrs M-Th 5:30-7:30); AppsAnywhere off campus is unusable." },
  { ruleId: "mfet-quiz", set: { effortH: 0.5, dropId: "mfet-quiz-drops" } },
  { ruleId: "mfet-prep", set: { effortH: 0.3 } },
  { ruleId: "me274-hw", set: { dropId: "me274-hw-drops" } },
  { ruleId: "me264-prelab", set: { from: "2026-09-01" },
    appendNote: "Lab does not start until ~week 3 (David, 2026-08-31); Labor Day pushes the first lab to ~Sep 14. VERIFY on Brightspace." },
  { ruleId: "me264-memo", set: { from: "2026-09-15" },
    appendNote: "First report follows the first real lab by a week (~Sep 21). VERIFY on Brightspace." },
];

const res = await fetch(WORKER + "/courses", { headers: { "x-oberth-key": KEY } });
if (!res.ok) { console.error("GET /courses failed:", res.status); process.exit(1); }
const data = await res.json();
if (!Array.isArray(data.courses) || !data.courses.length) {
  console.error("The Worker returned no courses. Refusing to write over that.");
  process.exit(1);
}

let changes = 0;
for (const p of PATCHES) {
  const rule = data.courses.flatMap((c) => c.rules || []).find((r) => r.id === p.ruleId);
  if (!rule) { console.warn("  ?  rule not found:", p.ruleId); continue; }
  for (const [k, v] of Object.entries(p.set || {})) {
    if (rule[k] !== v) { console.log(`  ~  ${p.ruleId}.${k}: ${JSON.stringify(rule[k])} -> ${JSON.stringify(v)}`); rule[k] = v; changes++; }
  }
  if (p.appendNote && !(rule.note || "").includes(p.appendNote.slice(0, 30))) {
    rule.note = rule.note ? rule.note + " " + p.appendNote : p.appendNote;
    console.log(`  +  ${p.ruleId}.note appended`);
    changes++;
  }
}

if (!changes) { console.log("Nothing to change; the rulebook already carries all of it."); process.exit(0); }
if (DRY) { console.log(`\n--dry-run: ${changes} change(s) NOT written.`); process.exit(0); }

data.updatedAt = new Date().toISOString().slice(0, 10);
const put = await fetch(WORKER + "/courses", {
  method: "POST",
  headers: { "content-type": "application/json", "x-oberth-key": KEY },
  body: JSON.stringify(data),
});
if (!put.ok) { console.error("POST /courses failed:", put.status); process.exit(1); }
console.log(`\nWrote ${changes} change(s). Phones pick it up on their next /courses refresh.`);
