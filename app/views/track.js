// track.js: the day. One day at a time, arrows either side.
//
// ============================================================================
// THE RAIL IS GONE. David, 2026-08-25: "it has some graph at the top that
// means nothing to me."
//
// The periapsis trajectory was my idea, not his need. It was the signature
// element of the design and it turned out to be decoration, sitting at the top
// of the tab he opens daily and pushing the actual answer below the fold. The
// scheduling model underneath it survives and still decides WHEN to start
// things; only the picture is gone. If a thing cannot be read at a glance by
// the one person who uses it, it is not an instrument, it is an ornament.
// ============================================================================
//
// What he asked for instead: the day, arrows to step between days, that day's
// recurring assignments, and the updates captured that day.

import {
  el, esc, zone, footer, empty, todayIso, fmtDay, runway, courses,
  K, lsGet, lsSet, nowIso, api,
} from "../../core.js";
import { queueTick } from "../../sync.js";
import * as L from "../ledger.js";
import * as S from "../schedule.js";

const isHere = () => location.hash.replace(/^#\/?/, "").split("/")[0] === "track";
const logKey = (d) => K("log." + d);

// ----------------------------------------------------------------- status --
// { instanceId: { state: "done" | "skipped", at, drop? } }. One tap, after
// the fact, batch catch-up friendly: exactly the write shape the behavioural
// record in CLAUDE.md says he actually uses. Nothing here requires starting
// anything before the event.
const SKEY = K("status");
const status = () => lsGet(SKEY, {});
function setStatus(id, entry) {
  const s = status();
  if (entry) s[id] = entry; else delete s[id];
  lsSet(SKEY, s);
}

let COURSES = null; // the loaded rulebook, for drop-pool lookups in rows

export function open(parts) {
  const root = document.getElementById("root");
  const day = (parts && parts[1] && /^\d{4}-\d{2}-\d{2}$/.test(parts[1])) ? parts[1] : todayIso();

  courses().then((data) => {
    if (!isHere()) return;
    root.innerHTML = "";
    const wrap = document.createElement("div");

    COURSES = data;
    // A fortnight forward is enough to place anything; a week BACK is what
    // lets an unfinished deliverable surface as OVERDUE instead of vanishing,
    // and gives a retroactive tick a row to tap.
    const st = status();
    const items = S.expand(data, S.addDays(day, -7), S.addDays(day, 13));
    const split = S.splitByStatus(items, st);
    const planned = S.plan(data, split.open.filter((i) => i.due >= day), null, day);
    const rerender = () => open(parts);

    const dueToday = planned.filter((p) => p.due === day);
    const startToday = planned.filter((p) =>
      p.effortMin > 0 && p.due !== day &&
      p.schedule.blocks.some((b) => b.date === day));
    const overdue = day === todayIso()
      ? split.open.filter((i) => i.due < day && i.kind !== "exam")
      : [];
    const landed = split.closed.filter((i) => i.due === day);
    const capH = (S.capacityOn(data, day) / 60).toFixed(1);

    wrap.appendChild(dayNav(day, capH));

    if (overdue.length) {
      wrap.appendChild(zone("overdue"));
      overdue.forEach((it) => wrap.appendChild(row(it, day, true, rerender)));
    }

    wrap.appendChild(zone("due " + (day === todayIso() ? "today" : "this day")));
    if (!dueToday.length) {
      wrap.appendChild(empty("—", "Nothing due", "No deliverable lands on this day."));
    }
    dueToday.forEach((it) => wrap.appendChild(row(it, day, true, rerender)));

    wrap.appendChild(zone("work this day"));
    if (!startToday.length) {
      wrap.appendChild(empty("—", "No work scheduled", "Nothing due later needs to start on this day."));
    }
    startToday.forEach((it) => wrap.appendChild(row(it, day, false, rerender)));

    // The landed zone: this day's deliverables that were ticked or skipped,
    // each with a one-tap undo. A mistap must cost one tap to reverse, and a
    // skip's drop is refunded on the way back so the ledger never drifts.
    if (landed.length) {
      wrap.appendChild(zone("landed"));
      landed.forEach((it) => wrap.appendChild(closedPanel(it, st[it.id], rerender)));
    }

    wrap.appendChild(zone("updates"));
    wrap.appendChild(updatesPanel(day));

    wrap.appendChild(zone("classes"));
    wrap.appendChild(classesPanel(data, day));

    wrap.appendChild(footer());
    root.appendChild(wrap);

    // Swipe as well as tap. A day view that only moves by hitting a small
    // arrow is a day view he will not step through.
    let x0 = null;
    wrap.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    wrap.addEventListener("touchend", (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0;
      x0 = null;
      if (Math.abs(dx) < 60) return;
      location.hash = "#/track/" + S.addDays(day, dx < 0 ? 1 : -1);
    }, { passive: true });
  }).catch(() => {
    root.innerHTML = "";
    root.appendChild(empty("!!", "Could not load your courses",
      "The Worker did not answer. The app keeps a copy, so this usually means a bad key or no signal."));
  });
}

// ------------------------------------------------------------------ day nav
function dayNav(day, capH) {
  const box = el("div", { class: "daynav" });

  const prev = el("button", { type: "button", class: "daybtn", "aria-label": "Previous day" }, "&#8249;");
  prev.addEventListener("click", () => { location.hash = "#/track/" + S.addDays(day, -1); });

  const mid = el("div", { class: "daymid" });
  const isToday = day === todayIso();
  mid.appendChild(el("div", { class: "dayname" }, esc(fmtDay(day))));
  const sub = el("div", { class: "daysub" });
  sub.textContent = (isToday ? "today" : runway(day).toLowerCase()) + "  ·  " + capH + "h usable";
  mid.appendChild(sub);
  // Tapping the middle always returns to today, which is the one move a
  // day-stepper always needs and usually lacks.
  if (!isToday) {
    mid.style.cursor = "pointer";
    mid.setAttribute("title", "Back to today");
    mid.addEventListener("click", () => { location.hash = "#/track/" + todayIso(); });
  }

  const next = el("button", { type: "button", class: "daybtn", "aria-label": "Next day" }, "&#8250;");
  next.addEventListener("click", () => { location.hash = "#/track/" + S.addDays(day, 1); });

  box.appendChild(prev); box.appendChild(mid); box.appendChild(next);
  return box;
}

// ---------------------------------------------------------------- one item
function row(it, day, isDue, rerender) {
  const sev = it.severity;
  const cls = sev === "flatzero" || sev === "exam" ? "is-cliff" : isDue ? "is-burn" : "is-tel";
  const p = el("div", { class: "panel " + cls });

  const ph = el("div", { class: "ph" });
  ph.appendChild(el("span", { class: "pt" }, esc(it.short + " · " + it.label)));
  ph.appendChild(el("span", { class: "pm" }, esc(isDue ? it.dueTime : runway(it.due))));
  p.appendChild(ph);

  const meta = [];
  if (!isDue) meta.push("due " + fmtDay(it.due) + " " + it.dueTime);
  if (it.effortMin) meta.push(S.fmtHrs(it.effortMin));
  if (it.submit) meta.push(it.submit);
  if (meta.length) {
    const m = el("div", { class: "pm" }, esc(meta.join("  ·  ")));
    m.style.marginTop = "2px";
    p.appendChild(m);
  }

  if (sev === "flatzero") {
    const w = el("p", null, "");
    w.textContent = "Late is a FLAT ZERO.";
    w.style.color = "var(--cliff)";
    p.appendChild(w);
  }

  if (!isDue && it.schedule) {
    const b = it.schedule.blocks.filter((x) => x.date === day);
    if (b.length) {
      const line = el("p", null, "");
      line.style.color = "var(--burn)";
      line.textContent = b.map((x) => x.start + "–" + x.end).join(",  ");
      p.appendChild(line);
    }
  }
  if (isDue && it.effortMin > 0 && it.schedule && it.schedule.lst) {
    const l = it.schedule.lst;
    const line = el("p", null, "");
    line.style.color = l.date < day ? "var(--cliff)" : "var(--burn)";
    line.textContent = l.date < day
      ? "Should have started " + fmtDay(l.date) + "."
      : "Start " + l.time + ".";
    p.appendChild(line);
  }

  // ---- controls. One tap, after the fact, no starting anything first: the
  // behavioural constraint in CLAUDE.md is the law here. DONE has no confirm
  // (undo lives in the landed zone); SKIP confirms because it spends a real
  // drop from the same ledger the Courses tab renders as pips.
  if (it.kind !== "exam" && rerender) {
    const ctl = el("div", null, "");
    ctl.style.cssText = "display:flex;gap:8px;align-items:center;margin-top:10px";
    const done = el("button", { type: "button", class: "recbtn" }, "Done");
    done.addEventListener("click", () => {
      setStatus(it.id, { state: "done", at: nowIso() });
      queueTick(it.id, true, { state: "done" });
      rerender();
    });
    ctl.appendChild(done);

    const pool = L.dropFor(COURSES, it.dropId);
    if (pool) {
      const leftN = L.left(pool.id, pool.total);
      if (leftN > 0) {
        const skip = el("button", { type: "button", class: "recbtn" }, "Skip · " + leftN + " left");
        skip.addEventListener("click", () => {
          if (!confirm("Skip " + it.short + " " + it.label + " and spend a drop? " + (leftN - 1) + " would be left.")) return;
          L.spend(pool.id, 1);
          setStatus(it.id, { state: "skipped", at: nowIso(), drop: pool.id });
          queueTick(it.id, true, { state: "skipped", drop: pool.id });
          rerender();
        });
        ctl.appendChild(skip);
      } else {
        const none = el("span", { class: "pm" }, "no skips left — this one counts");
        none.style.color = "var(--cliff)";
        ctl.appendChild(none);
      }
    }
    p.appendChild(ctl);
  }
  return p;
}

// A closed deliverable: dimmed, stated plainly, one tap to reverse.
function closedPanel(it, entry, rerender) {
  const p = el("div", { class: "panel" });
  p.style.opacity = ".72";
  const ph = el("div", { class: "ph" });
  ph.appendChild(el("span", { class: "pt" }, esc(it.short + " · " + it.label)));
  ph.appendChild(el("span", { class: "pm" }, entry.state === "skipped" ? "SKIPPED" : "DONE"));
  p.appendChild(ph);
  const m = el("div", { class: "pm" }, esc("due " + it.dueTime +
    (entry.state === "skipped" ? "  ·  spent a drop" : "")));
  m.style.marginTop = "2px";
  p.appendChild(m);
  const b = el("button", { type: "button", class: "recbtn" }, "Undo");
  b.style.marginTop = "8px";
  b.addEventListener("click", () => {
    if (entry.state === "skipped" && entry.drop) L.refund(entry.drop, 1);
    setStatus(it.id, null);
    queueTick(it.id, false, { state: "undone" });
    rerender();
  });
  p.appendChild(b);
  return p;
}

// ----------------------------------------------------------------- updates
// What the updates notebook said on this day. Reads the local log first so it
// works offline, then refreshes from the Worker, because the transcript of a
// read-aloud only exists server-side.
function updatesPanel(day) {
  const box = el("div", { class: "panel is-burn", id: "updbox" });
  paintUpdates(box, lsGet(logKey(day), []).filter((r) => r.book === "updates"), day);

  api("/note?date=" + day).then((d) => {
    if (!isHere()) return;
    const rows = (d.notes || []).filter((r) => r.book === "updates");
    const live = document.getElementById("updbox");
    if (live && rows.length) paintUpdates(live, rows, day);
  }).catch(() => {});
  return box;
}

function paintUpdates(box, rows, day) {
  box.innerHTML = "";
  if (!rows.length) {
    box.appendChild(empty("—", "Nothing read yet",
      day === todayIso()
        ? "Read the updates page aloud on Tonight and it lands here."
        : "No updates were logged on this day."));
    return;
  }
  rows.forEach((r) => {
    const line = el("div", { class: "logrow" });
    line.appendChild(el("span", { class: "t" }, esc(String(r.at || "").slice(11, 16))));
    const x = el("span", { class: "x" });
    // Dictated content, never innerHTML.
    x.textContent = r.text || (r.failed ? "(recording failed: " + r.failed + ")" : "(recording, transcribing)");
    if (r.failed) x.style.color = "var(--cliff)";
    line.appendChild(x);
    box.appendChild(line);
  });
}

// ----------------------------------------------------------------- classes
function classesPanel(data, day) {
  const box = el("div", { class: "panel" });
  const busy = S.busyOn(data, day);
  if (!busy.length) {
    box.appendChild(empty("—", "No classes", "Nothing on the timetable for this day."));
    return box;
  }
  busy.forEach((b) => {
    const line = el("div", { class: "gauge" });
    const t = el("span", { class: "gl" });
    t.textContent = b.label;
    line.appendChild(t);
    line.appendChild(el("span", { class: "gv" }, esc(S.clock(b.start) + "–" + S.clock(b.end))));
    box.appendChild(line);
  });
  return box;
}
