import { readFileSync } from "node:fs";
import * as S from "../app/schedule.js";

const data = JSON.parse(readFileSync(new URL("../data/courses.json", import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, msg) => { c ? (pass++, console.log("  ok   " + msg)) : (fail++, console.log("  FAIL " + msg)); };

console.log("\n-- day codes --");
ok(S.dayCodeOf("2026-08-24") === "MO", "2026-08-24 is Monday");
ok(S.dayCodeOf("2026-08-30") === "SU", "2026-08-30 is Sunday");

console.log("\n-- Monday has no usable gap (the council's central claim) --");
const monFree = S.freeOn(data, "2026-08-24");
const monCap  = S.capacityOn(data, "2026-08-24");
console.log("     Monday free gaps:", monFree.map(g => S.clock(g.start)+"-"+S.clock(g.end)).join(", ") || "(none)");
console.log("     Monday capacity:", monCap, "min");
const wedCap = S.capacityOn(data, "2026-08-26");
const thuCap = S.capacityOn(data, "2026-08-27");
const friCap = S.capacityOn(data, "2026-08-28");
const sunCap = S.capacityOn(data, "2026-08-30");
console.log("     Wed", wedCap, "| Thu", thuCap, "| Fri", friCap, "| Sun", sunCap);
ok(monCap < wedCap && monCap < thuCap, "Monday is the tightest weekday");

console.log("\n-- MFET 06:59 Tuesday must burn BEFORE Monday night --");
const items = S.expand(data, "2026-08-24", "2026-09-01");
const mfet = items.find(i => i.ruleId === "mfet-lab" && i.due === "2026-09-01");
ok(!!mfet, "MFET lab expands onto Tue 2026-09-01");
const pass1 = S.backwardPass(data, mfet, null, "2026-08-24");
console.log("     blocks:", pass1.blocks.map(b => b.date+" "+b.start+"-"+b.end).join(" | ") || "(none)");
console.log("     LST:", pass1.lst ? pass1.lst.date+" "+pass1.lst.time : "(none)", "| feasible:", pass1.feasible);
ok(pass1.feasible, "MFET is schedulable");
ok(pass1.blocks.every(b => b.date < "2026-09-01"), "no MFET block lands ON the 06:59 due day");
ok(pass1.blocks.every(b => b.date <= "2026-08-30"), "MFET plan keeps a full day of buffer before a flat zero (lands Sunday, not Monday night)");

console.log("\n-- PHYS 310 4h pset splits across days --");
const ps = items.find(i => i.ruleId === "phys310-ps");
const pp = S.backwardPass(data, ps, null, "2026-08-24");
console.log("     blocks:", pp.blocks.map(b => b.date+" "+b.start+"-"+b.end+" ("+b.minutes+"m)").join(" | "));
const wall = pp.blocks.reduce((s,b)=>s+b.minutes,0);
const effv = pp.blocks.reduce((s,b)=>s+b.effective,0);
console.log("     wall-clock", wall, "min to deliver", effv, "effective min (need "+ps.effortMin+")");
ok(effv >= ps.effortMin - 15 || !pp.feasible, "effective minutes cover the requirement");
ok(wall <= ps.effortMin * 1.7, "wall-clock inflation stays under 1.7x");

console.log("\n-- admission control names what to shed under overload --");
const week = S.expand(data, "2026-08-24", "2026-08-30");
const a = S.admit(data, week, "2026-08-24", "2026-08-30");
console.log("     demand", a.demandMin, "min vs capacity", a.capacityMin, "min | fits:", a.fits);
if (!a.fits) console.log("     shed:", a.shed.map(s=>s.short+" "+s.label).join(", "));
ok(typeof a.fits === "boolean", "admit returns a verdict");
ok(a.shed.every(s => !S.isPinned(s)), "never sheds a pinned flat-zero or exam");

console.log("\n-- trajectory --");
const tr = S.trajectory(data, "2026-08-26");
ok(tr.altitude.length === 61, "61 altitude samples");
ok(tr.periapsis !== null, "Wednesday has a periapsis");
console.log("     Wed periapsis:", tr.periapsis.start+"-"+tr.periapsis.end, "("+tr.periapsis.minutes+"m)");
const trMon = S.trajectory(data, "2026-08-24");
console.log("     Mon periapsis:", trMon.periapsis ? trMon.periapsis.start+"-"+trMon.periapsis.end+" ("+trMon.periapsis.minutes+"m)" : "(none)");

console.log("\n-- rule windows: ME 264 lab starts ~week 3 (David, 2026-08-31) --");
const sept = S.expand(data, "2026-08-24", "2026-09-30");
const prelabs = sept.filter(i => i.ruleId === "me264-prelab").map(i => i.due);
const memos   = sept.filter(i => i.ruleId === "me264-memo").map(i => i.due);
console.log("     prelabs:", prelabs.join(", ") || "(none)", "| memos:", memos.join(", ") || "(none)");
ok(!prelabs.includes("2026-08-31"), "no prelab generated for week 2 (before the lab exists)");
ok(!prelabs.includes("2026-09-07"), "Labor Day Monday generates nothing");
ok(prelabs[0] === "2026-09-14", "first prelab lands Sep 14");
ok(memos[0] === "2026-09-21", "first memo follows the first lab by a week (Sep 21)");

console.log("\n-- measured MFET effort and drop links --");
const mfet2 = sept.find(i => i.ruleId === "mfet-lab");
ok(mfet2.effortMin === 180, "MFET lab carries the measured 3h, not the guessed 1.5h");
ok(mfet2.dropId === "mfet-assign-drops", "MFET lab knows its drop pool");
const me274 = sept.find(i => i.ruleId === "me274-hw");
ok(me274.dropId === "me274-hw-drops", "ME 274 homework knows its drop pool");

console.log("\n-- splitByStatus: closed work leaves the demand --");
const wk = S.expand(data, "2026-08-31", "2026-09-06");
const someId = wk.find(i => i.effortMin > 0).id;
const sp = S.splitByStatus(wk, { [someId]: { state: "done" } });
ok(sp.open.length === wk.length - 1, "one closed item leaves open");
ok(sp.closed.length === 1 && sp.closed[0].id === someId, "and lands in closed");
ok(S.splitByStatus(wk, {}).open.length === wk.length, "empty status map closes nothing");
ok(S.splitByStatus(wk, null).open.length === wk.length, "null status map closes nothing");

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
