// track.js: the trajectory. The signature view and the thesis of the app.
//
// Altitude is how committed each slice of the day is, discounted by how good
// those hours actually are. The curve dips where the day opens up, and an amber
// BURN MARKER sits where work should start. A day that never really dips
// (Monday: MFET 08:30, ME 274 10:30, PHYS 310 until 13:20, three-hour lab until
// 17:20, PACC 18:30) shows a high flat arc, and that is the answer, not a
// failure: there is nowhere good to burn, so the work has to move to Sunday.
//
// This is why the app is called Oberth. A burn is worth more at periapsis.

import { el, esc, mast, zone, footer, empty, todayIso, fmtDay, runway, K, lsGet } from "../../core.js";
import * as S from "../schedule.js";

let DATA = null;

async function load() {
  if (DATA) return DATA;
  const r = await fetch("./data/courses.json");
  DATA = await r.json();
  return DATA;
}

export function open(parts) {
  const root = document.getElementById("root");
  const day = (parts && parts[1]) || todayIso();
  load().then((data) => {
    if (!isStill()) return;
    root.innerHTML = "";
    const wrap = document.createElement("div");

    const horizon = S.addDays(day, 13);
    const items = S.expand(data, day, horizon);
    const planned = S.plan(data, items, null, day);

    // Everything whose FIRST block is today or already past: the honest answer
    // to "what must I start now so nothing lands late."
    const startingNow = planned.filter((p) =>
      p.effortMin > 0 && p.schedule.lst && p.schedule.lst.date <= day);

    const traj = S.trajectory(data, day, null,
      planned.flatMap((p) => p.schedule.blocks.map((b) => Object.assign({}, b, { label: p.short }))));

    const capH = (traj.capacityMin / 60).toFixed(1);
    wrap.appendChild(mast("Track", fmtDay(day), "usable hrs", capH));

    wrap.appendChild(rail(traj));

    // The periapsis readout, in words.
    const p = el("div", { class: "panel " + (traj.periapsis ? "is-burn" : "is-cliff") });
    const ph = el("div", { class: "ph" });
    ph.appendChild(el("span", { class: "pt" }, traj.periapsis ? "Periapsis" : "No periapsis"));
    ph.appendChild(el("span", { class: "pm" }, traj.periapsis
      ? esc(traj.periapsis.start + " – " + traj.periapsis.end)
      : "flat arc"));
    p.appendChild(ph);
    p.appendChild(el("p", null, traj.periapsis
      ? "Deepest free stretch today, " + Math.round(traj.periapsis.minutes / 60 * 10) / 10 +
        "h wall clock, worth " + Math.round(traj.periapsis.value / 60 * 10) / 10 + "h of real work. Burn here."
      : "Today never opens up. Anything due tomorrow had to start yesterday."));
    wrap.appendChild(p);

    wrap.appendChild(zone("start now"));
    if (!startingNow.length) {
      wrap.appendChild(empty("—", "Nothing has to start today", "Every deliverable in the next two weeks still has slack. The next one is listed below."));
    }
    startingNow.forEach((it) => wrap.appendChild(deliverable(it, day, true)));

    wrap.appendChild(zone("inbound"));
    const inbound = planned.filter((p2) => !startingNow.includes(p2)).slice(0, 14);
    if (!inbound.length) wrap.appendChild(empty("—", "Clear", "Nothing scheduled in the next fortnight."));
    inbound.forEach((it) => wrap.appendChild(deliverable(it, day, false)));

    wrap.appendChild(footer());
    root.appendChild(wrap);
  }).catch(() => {
    root.innerHTML = "";
    root.appendChild(empty("!!", "Course data did not load", "data/courses.json is missing or malformed."));
  });
}
const isStill = () => isTabTrack();
function isTabTrack() { return location.hash.replace(/^#\/?/, "").split("/")[0] === "track"; }

// ------------------------------------------------------------------ the rail
function rail(traj) {
  const box = el("div", { class: "rail" });
  const W = 720, H = 132, PAD = 10;
  const n = traj.altitude.length - 1;
  const x = (i) => PAD + (i / n) * (W - PAD * 2);
  // Altitude 0 (free and at full efficiency) sits LOW on the screen and
  // altitude 1 (fully committed) sits HIGH. This is an orbit seen from the
  // side: the dip IS periapsis, and periapsis is where you burn. Getting this
  // backwards, which the first build did, inverts the entire metaphor and puts
  // the burn markers on the peaks.
  const y = (a) => 16 + (1 - a) * (H - 52);

  const pts = traj.altitude.map((a, i) => x(i) + "," + y(a));
  const svg = [];
  svg.push('<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">');
  for (let g = 0; g <= 4; g++) {
    const yy = 16 + (g / 4) * (H - 46);
    svg.push('<line class="gridline" x1="' + PAD + '" y1="' + yy + '" x2="' + (W - PAD) + '" y2="' + yy + '"/>');
  }
  // Fill DOWN from the trace to the floor: the shaded body is the well.
  svg.push('<polygon class="fill" points="' + x(0) + ',' + (H - 22) + ' ' + pts.join(" ") + ' ' + x(n) + ',' + (H - 22) + '"/>');
  svg.push('<polyline class="trace" points="' + pts.join(" ") + '"/>');

  // now-line
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (nowMin >= traj.windowStart && nowMin <= traj.windowEnd && traj.date === todayIso()) {
    const nx = PAD + ((nowMin - traj.windowStart) / (traj.windowEnd - traj.windowStart)) * (W - PAD * 2);
    svg.push('<line class="nowline" x1="' + nx + '" y1="10" x2="' + nx + '" y2="' + (H - 22) + '"/>');
  }

  // Burn markers sit ON the curve, at the dip. Labels are de-duplicated and
  // pushed apart, because the first build rendered "MFEE264" out of two
  // overlapping labels and that is worse than no label.
  const placed = [];
  const marks = (traj.burns || [])
    .map((b) => {
      const mid = (S.mins(b.start) + S.mins(b.end)) / 2;
      return { mid, label: b.label || "" };
    })
    .filter((m) => m.mid >= traj.windowStart && m.mid <= traj.windowEnd)
    .sort((a, b) => a.mid - b.mid);

  marks.forEach((m) => {
    const bx = PAD + ((m.mid - traj.windowStart) / (traj.windowEnd - traj.windowStart)) * (W - PAD * 2);
    const idx = Math.round(((m.mid - traj.windowStart) / (traj.windowEnd - traj.windowStart)) * n);
    const by = y(traj.altitude[Math.max(0, Math.min(n, idx))]);
    svg.push('<line class="burnstem" x1="' + bx + '" y1="' + (by - 4) + '" x2="' + bx + '" y2="14"/>');
    svg.push('<circle class="burn" cx="' + bx + '" cy="' + by + '" r="4"/>');
    // one label per ~64px of width; the rest are dots only
    const clash = placed.some((px) => Math.abs(px - bx) < 64);
    if (!clash && m.label) {
      placed.push(bx);
      const anchor = bx < 60 ? "start" : bx > W - 60 ? "end" : "middle";
      svg.push('<text class="burnlabel" x="' + bx + '" y="11" text-anchor="' + anchor + '">' + esc(m.label) + '</text>');
    }
  });
  svg.push("</svg>");
  box.innerHTML = svg.join("");

  const ax = el("div", { class: "rail-x" });
  ax.appendChild(el("span", null, esc(S.clock(traj.windowStart))));
  ax.appendChild(el("span", null, "periapsis = burn here"));
  ax.appendChild(el("span", null, esc(S.clock(traj.windowEnd))));
  box.appendChild(ax);
  return box;
}

// --------------------------------------------------------------- deliverables
function deliverable(it, day, urgent) {
  const sev = it.severity;
  const cls = sev === "flatzero" || sev === "exam" ? "is-cliff" : urgent ? "is-burn" : "is-tel";
  const p = el("div", { class: "panel " + cls });

  const ph = el("div", { class: "ph" });
  ph.appendChild(el("span", { class: "pt" }, esc(it.short + " · " + it.label)));
  ph.appendChild(el("span", { class: "pm" }, esc(runway(it.due))));
  p.appendChild(ph);

  const meta = [];
  meta.push("due " + fmtDay(it.due) + " " + it.dueTime);
  if (it.effortMin) meta.push(S.fmtHrs(it.effortMin));
  if (it.submit) meta.push(it.submit);
  const m = el("div", { class: "pm" }, esc(meta.join("  ·  ")));
  m.style.marginTop = "2px";
  p.appendChild(m);

  if (sev === "flatzero") {
    const w = el("p", null, "");
    w.textContent = "Late is a FLAT ZERO. Planned a full day early on purpose.";
    w.style.color = "var(--cliff)";
    p.appendChild(w);
  } else if (it.late && it.late !== "n/a") {
    const w = el("p", null, "");
    w.textContent = "Late: " + it.late;
    p.appendChild(w);
  }

  const sch = it.schedule;
  if (sch && sch.blocks.length) {
    const b = sch.blocks[0];
    const line = el("p", null, "");
    line.style.color = urgent ? "var(--burn)" : "var(--dim)";
    line.textContent = (urgent ? "Start " : "Starts ") +
      (b.date === day ? "today " : fmtDay(b.date) + " ") + b.start +
      (sch.blocks.length > 1 ? "  (" + sch.blocks.length + " sittings)" : "");
    p.appendChild(line);
  } else if (it.effortMin > 0 && sch && !sch.feasible) {
    const line = el("p", null, "");
    line.style.color = "var(--cliff)";
    line.textContent = "Does not fit. " + S.fmtHrs(sch.shortMin) + " short of a place to put it.";
    p.appendChild(line);
  }
  if (it.note) {
    const n = el("p", null, "");
    n.textContent = it.note;
    n.style.fontSize = ".84rem";
    p.appendChild(n);
  }
  return p;
}
