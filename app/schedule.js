// schedule.js: the Oberth effect, in code.
//
// ============================================================================
// WHY THIS IS NOT EDF.
//
// The first draft of the spec said "Earliest Deadline First is provably optimal
// for one preemptible resource with hard deadlines." That theorem is real and
// its hypothesis is that A FEASIBLE SCHEDULE EXISTS, i.e. utilisation <= 1.
// David's semester is an overload problem by construction; the reason he wants
// this tool at all is that the week does not obviously fit. Under overload EDF
// is not merely suboptimal, it is degenerate: it commits to the nearest
// deadline, which under overload is the job most likely already doomed, burns
// the time, misses it anyway, and cascades (Locke's domino effect, 1986).
// Its competitive factor under overload drops to zero.
//
// Worse for this particular user: EDF orders by a clock and has no value
// function, so it cannot distinguish MFET's 6:59 AM FLAT ZERO from PHYS 310's
// one-point-per-problem. Those differ by an order of magnitude in consequence.
// And the single most valuable sentence this app can say is "skip this one,
// you have 2 drops left", which is a LOAD SHEDDING decision. Shedding needs
// value density. EDF cannot do it.
//
// So the order here is the standard corrective (Robust Earliest Deadline,
// Buttazzo and Stankovic 1993):
//     1. PIN     flat-zero and cliff items. They do not negotiate.
//     2. ADMIT   compare demand to real capacity; if it does not fit, name
//                what to shed, cheapest-consequence first, and say so.
//     3. PLACE   latest-start backward pass over the admitted set.
// Established by the 2026-08-24 council. Do not "simplify" this back to EDF.
// ============================================================================

const DAYCODE = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

// Free time is not available time. An empty calendar at 02:00 is not four
// hours of capacity, and a scheduler that thinks it is will confidently
// produce garbage. Hard walls, a per-day cap, and a minimum viable block so
// four hours cannot be diced into eleven-minute slivers.
export const DEFAULT_WINDOW = {
  start: "08:00",
  end: "22:30",
  maxMinutesPerDay: 300,        // weekday ceiling on actual homework
  maxMinutesWeekend: 420,       // Saturday and Sunday genuinely hold more
  minBlockMinutes: 45,
};

// A single flat daily cap made every day identical to the planner. After the
// PHYS 310 end-time correction on 2026-08-26, raw usable time ran Mon 395,
// Tue 560, Wed 610, Thu 630, Fri 805, Sat/Sun 870 minutes, and a flat 300
// ceiling erased all of it: Saturday looked exactly like Monday. The ceiling
// is about how much homework a person will really do in a day, and that is
// plainly higher on a weekend, so it varies.
function capFor(iso, w) {
  const c = dayCodeOf(iso);
  return (c === "SA" || c === "SU")
    ? (w.maxMinutesWeekend || w.maxMinutesPerDay)
    : w.maxMinutesPerDay;
}

// ---------------------------------------------------------------- efficiency
// An hour is not an hour. This is the Oberth effect stated as a number, and it
// is the difference between a scheduler that is useful and one that confidently
// fills Monday night.
//
// Found by the first test run: Monday's raw gaps total 450 minutes, which after
// the daily cap made Monday look exactly as capable as Wednesday. It is not.
// 17:20-22:30 on Monday follows a THREE HOUR machine shop lab; Wednesday 13:20
// is the freshest block of the week. Treating them as equal is the same error
// as believing an empty calendar at 02:00 means four hours of capacity.
//
// So usable capacity is minutes TIMES efficiency, and blocks are placed into
// the most efficient room available rather than merely the latest.
// Calibrated after the first run made a 4h pset cost 7.5h of wall clock. Late
// work is worse, not half-speed; 0.65 puts a 22:00 hour at about two thirds of
// a 09:00 hour, which is defensible. Raising the floor further would stop the
// curve meaning anything.
const EFFICIENCY = [
  { until: 12 * 60, w: 1.00 },   // morning, best
  { until: 17 * 60, w: 0.95 },   // afternoon
  { until: 20 * 60, w: 0.85 },   // evening
  { until: 24 * 60, w: 0.65 },   // late; real work, at a real discount
];
/** Efficiency of the minute at `t`, before fatigue. */
export function efficiencyAt(t) {
  for (const b of EFFICIENCY) if (t < b.until) return b.w;
  return 0.5;
}
/** Fatigue: a long fixed block taxes the hours that follow it. */
function fatiguePenalty(busy, t) {
  let worst = 1;
  busy.forEach((b) => {
    if (t < b.end) return;
    const since = t - b.end;
    const length = b.end - b.start;
    if (length < 100 || since > 180) return;      // only long blocks, decaying over 3h
    const depth = Math.min(0.35, (length / 60) * 0.09);
    worst = Math.min(worst, 1 - depth * (1 - since / 180));
  });
  return worst;
}
/** Weighted value of a span, 0..(end-start). */
export function weightedMinutes(busy, start, end) {
  let s = 0;
  for (let t = start; t < end; t += 5) s += 5 * efficiencyAt(t) * fatiguePenalty(busy, t);
  return Math.round(s);
}

const mins = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + (m || 0);
};
const clock = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
const p2 = (n) => String(n).padStart(2, "0");
const isoOf = (d) => d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());

export function dayCodeOf(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return DAYCODE[new Date(y, m - 1, d).getDay()];
}
export function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return isoOf(dt);
}
export function eachDay(fromIso, toIso) {
  const out = [];
  let cur = fromIso;
  let guard = 0;
  while (cur <= toIso && guard++ < 400) { out.push(cur); cur = addDays(cur, 1); }
  return out;
}

// ------------------------------------------------------- fixed commitments --
/** Every class, lab and meeting on a given day, as {start,end} minute spans. */
export function busyOn(data, iso) {
  if ((data.noClassDays || []).includes(iso)) return [];
  const code = dayCodeOf(iso);
  const out = [];
  const push = (c, m) => {
    if (!m.days.includes(code)) return;
    out.push({
      start: mins(m.start), end: mins(m.end),
      label: c.short + (m.kind === "lab" ? " lab" : ""),
      code: c.code, accent: c.accent || "tel",
    });
  };
  (data.courses || []).forEach((c) => (c.meets || []).forEach((m) => push(c, m)));
  (data.missingCourses || []).forEach((c) => (c.meets || []).forEach((m) => push(c, m)));
  // Clubs and training are commitments too. Leaving them out is why the first
  // test run thought Monday evening was five free hours.
  (data.commitments || []).forEach((c) => (c.meets || []).forEach((m) => push(c, m)));
  return out.sort((a, b) => a.start - b.start);
}

/** The gaps inside the declared working window, after fixed commitments. */
export function freeOn(data, iso, win) {
  const w = win || DEFAULT_WINDOW;
  const lo = mins(w.start), hi = mins(w.end);
  const busy = busyOn(data, iso)
    .map((b) => ({ start: Math.max(b.start, lo), end: Math.min(b.end, hi) }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);

  const gaps = [];
  let cur = lo;
  busy.forEach((b) => {
    if (b.start > cur) gaps.push({ start: cur, end: b.start });
    cur = Math.max(cur, b.end);
  });
  if (cur < hi) gaps.push({ start: cur, end: hi });
  return gaps.filter((g) => g.end - g.start >= w.minBlockMinutes);
}

/**
 * Usable capacity on a day, in EFFECTIVE minutes: raw gap minutes discounted
 * by time of day and by fatigue from long fixed blocks, then capped. Monday's
 * 450 raw minutes are worth far less than Wednesday's because most of them sit
 * after 17:20 and follow a three-hour lab.
 */
export function capacityOn(data, iso, win) {
  const w = win || DEFAULT_WINDOW;
  const busy = busyOn(data, iso);
  const eff = freeOn(data, iso, w).reduce((s, g) => s + weightedMinutes(busy, g.start, g.end), 0);
  return Math.min(eff, capFor(iso, w));
}

/** Raw, unweighted gap minutes. Useful for showing the honest wall-clock. */
export function rawCapacityOn(data, iso, win) {
  const w = win || DEFAULT_WINDOW;
  return freeOn(data, iso, w).reduce((s, g) => s + (g.end - g.start), 0);
}

// ------------------------------------------------------------- deliverables --
/**
 * Expand the per-course rules into concrete dated deliverables in a window.
 * This is the thing that means David never types an assignment in: the
 * syllabus already said it, so the machine writes it and he reads it.
 */
export function expand(data, fromIso, toIso) {
  const out = [];
  const days = eachDay(fromIso, toIso);
  const noClass = new Set(data.noClassDays || []);

  (data.courses || []).forEach((c) => {
    (c.rules || []).forEach((r) => {
      if (Array.isArray(r.dates)) {
        r.dates.filter((d) => d >= fromIso && d <= toIso).forEach((d) => out.push(mk(c, r, d)));
        return;
      }
      if (!Array.isArray(r.byday)) return;
      days.forEach((d) => {
        if (noClass.has(d)) return;
        if (r.byday.includes(dayCodeOf(d))) out.push(mk(c, r, d));
      });
    });
    (c.milestones || []).forEach((m) => {
      if (m.date >= fromIso && m.date <= toIso) {
        out.push({
          id: m.id, course: c.code, short: c.short, accent: c.accent || "tel",
          label: m.label, due: m.date, dueTime: "23:59",
          effortMin: Math.round((m.effortH || 2) * 60),
          late: "n/a", severity: "medium", kind: "milestone",
        });
      }
    });
    (c.exams || []).forEach((e) => {
      if (e.date >= fromIso && e.date <= toIso) {
        out.push({
          id: e.id, course: c.code, short: c.short, accent: "cliff",
          label: e.label, due: e.date, dueTime: e.start || "23:59",
          effortMin: 0, severity: "exam", kind: "exam", room: e.room || null,
        });
      }
    });
  });

  return out.sort((a, b) => (a.due + a.dueTime).localeCompare(b.due + b.dueTime));
}

function mk(c, r, dateIso) {
  return {
    id: r.id + "@" + dateIso,
    ruleId: r.id, course: c.code, short: c.short, accent: c.accent || "tel",
    label: r.label, due: dateIso, dueTime: r.dueTime || "23:59",
    effortMin: Math.round((r.effortH || 1) * 60),
    submit: r.submit || null, late: r.late || null,
    severity: r.severity || "medium",
    note: r.note || null, kind: "recurring",
  };
}

// -------------------------------------------------------- 1. PIN, 2. ADMIT --
// Consequence ranking. This is the value function EDF does not have, and it is
// the ONLY thing that lets the app tell him what to drop.
const SEVERITY_RANK = { exam: 0, flatzero: 1, hard: 2, medium: 3, soft: 4 };
export const isPinned = (d) => d.severity === "exam" || d.severity === "flatzero";

/**
 * Does the week fit? If not, name what to shed, cheapest consequence first.
 * Returns { demandMin, capacityMin, fits, shed: [...] }.
 */
export function admit(data, items, fromIso, toIso, win) {
  const capacityMin = eachDay(fromIso, toIso)
    .reduce((s, d) => s + capacityOn(data, d, win), 0);
  const work = items.filter((i) => i.effortMin > 0);
  const demandMin = work.reduce((s, i) => s + i.effortMin, 0);

  if (demandMin <= capacityMin) {
    return { demandMin, capacityMin, fits: true, shed: [] };
  }
  // Shed from the cheapest consequence upward, never touching pinned items.
  const order = work.slice().sort((a, b) =>
    (SEVERITY_RANK[b.severity] ?? 3) - (SEVERITY_RANK[a.severity] ?? 3));
  const shed = [];
  let over = demandMin - capacityMin;
  for (const it of order) {
    if (over <= 0) break;
    if (isPinned(it)) continue;
    shed.push(it);
    over -= it.effortMin;
  }
  return { demandMin, capacityMin, fits: false, shed, stillOver: Math.max(0, over) };
}

// ------------------------------------------------------------- 3. PLACE ----
/**
 * Latest-start backward pass. Walk backwards from the due datetime over free
 * intervals, consuming effort, to find the last moment work can begin and
 * still land. slack = LST - now. THIS is the answer to "it's due Friday but
 * Friday is full, so when do I actually start."
 *
 * Returns { blocks: [{date,start,end}], lst: {date,time} | null, feasible }.
 */
export function backwardPass(data, item, win, notBefore) {
  const w = win || DEFAULT_WINDOW;
  let need = item.effortMin;
  const blocks = [];
  const floor = notBefore || addDays(item.due, -21);
  let guard = 0;

  // SAFETY MARGIN on items with no recovery path. A flat-zero deadline that
  // the plan satisfies at 22:30 the night before is technically feasible and
  // practically reckless: one bad evening and the mark is gone with no drop to
  // spend. MFET's 06:59 Tuesday is the case this exists for. Pinned items get
  // a full day of buffer, so the plan lands them Sunday and Monday night
  // becomes the fallback rather than the plan.
  // An early-morning deadline makes the due day itself worthless: 06:59 means
  // there is no working hour on Tuesday at all, so the last usable day is
  // Monday. The safety day comes off THAT, not off the due date, which is what
  // finally lands MFET on Sunday instead of at 22:30 the night before.
  const dueMin = mins(item.dueTime || "23:59");
  const lastUsable = dueMin < 12 * 60 ? addDays(item.due, -1) : item.due;
  const safetyDays = item.severity === "flatzero" ? 1 : 0;
  let day = safetyDays ? addDays(lastUsable, -safetyDays) : lastUsable;

  while (need > 0 && day >= floor && guard++ < 60) {
    const dueCut = day === item.due ? mins(item.dueTime) : mins(w.end);
    // A 06:59 deadline means the day OF is worth nothing; the work is the
    // night before. Falling through to the previous day is the correct and
    // non-obvious behaviour that makes MFET land on Sunday.
    let room = Math.min(capFor(day, w), capacityOn(data, day, w));
    const busy = busyOn(data, day);
    const gaps = freeOn(data, day, w)
      .map((g) => ({ start: g.start, end: Math.min(g.end, dueCut) }))
      .filter((g) => g.end - g.start >= w.minBlockMinutes)
      .sort((a, b) => b.end - a.end); // latest first: this is the backward pass

    for (const g of gaps) {
      if (need <= 0 || room <= 0) break;
      // Consume the gap from its END (latest start), but credit EFFECTIVE
      // minutes against the requirement. A late, post-lab hour buys less than
      // a fresh morning hour, so poor rooms cost more wall clock and the pass
      // naturally keeps walking back to better days instead of stuffing the
      // work into Monday night.
      let spanEnd = g.end;
      while (need > 0 && room > 0 && spanEnd - g.start >= Math.min(w.minBlockMinutes, need)) {
        const take = Math.min(spanEnd - g.start, Math.max(w.minBlockMinutes, need), room);
        if (take < Math.min(w.minBlockMinutes, need)) break;
        const eff = weightedMinutes(busy, spanEnd - take, spanEnd);
        blocks.push({
          date: day, start: clock(spanEnd - take), end: clock(spanEnd),
          minutes: take, effective: eff,
        });
        need -= eff; room -= take; spanEnd -= take;
        if (eff <= 0) break;
      }
    }
    day = addDays(day, -1);
  }

  blocks.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  // The backward walk can carve one gap into several adjoining takes. Nobody
  // wants to read "20:42-21:27, 21:27-22:30"; that is one sitting.
  const merged = [];
  blocks.forEach((b) => {
    const last = merged[merged.length - 1];
    if (last && last.date === b.date && last.end === b.start) {
      last.end = b.end;
      last.minutes += b.minutes;
      last.effective += b.effective;
    } else merged.push(Object.assign({}, b));
  });
  blocks.length = 0;
  merged.forEach((b) => blocks.push(b));
  const first = blocks[0] || null;
  return {
    blocks,
    lst: first ? { date: first.date, time: first.start } : null,
    feasible: need <= 0,
    shortMin: Math.max(0, need),
  };
}

/** Convenience: plan a whole set, pinned first, then by consequence. */
export function plan(data, items, win, notBefore) {
  const ordered = items.slice().sort((a, b) => {
    const p = (isPinned(b) ? 1 : 0) - (isPinned(a) ? 1 : 0);
    if (p) return p;
    const s = (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3);
    if (s) return s;
    return (a.due + a.dueTime).localeCompare(b.due + b.dueTime);
  });
  return ordered.map((it) => Object.assign({}, it, { schedule: backwardPass(data, it, win, notBefore) }));
}

// ---------------------------------------------------------- the periapsis --
/**
 * The rail. Altitude is how committed each slice of the day is; the curve dips
 * where the day opens up. Periapsis is the deepest free stretch, which is where
 * a burn is worth most. A day that never dips (Monday) returns no periapsis,
 * and that is the point: there is nowhere to burn, so the work has to move.
 */
export function trajectory(data, iso, win, burns) {
  const w = win || DEFAULT_WINDOW;
  const lo = mins(w.start), hi = mins(w.end);
  const SLICES = 60;
  const step = (hi - lo) / SLICES;
  const busy = busyOn(data, iso);

  // Altitude 1 = fully committed. Altitude 0 = free AND at full efficiency.
  // A free but late, post-lab hour sits around 0.5, so the curve never bottoms
  // out on Monday night and periapsis lands where a burn is genuinely worth
  // most. This is the whole metaphor, and it is computed, not decorative.
  const alt = [];
  for (let i = 0; i <= SLICES; i++) {
    const t = lo + i * step;
    const inBusy = busy.some((b) => t >= b.start && t < b.end);
    alt.push(inBusy ? 1 : 1 - efficiencyAt(t) * fatiguePenalty(busy, t));
  }
  // Smooth so it reads as a trajectory rather than a bar chart. A commitment
  // pulls the neighbouring slices up: transitions cost you too.
  const smooth = alt.map((_, i) => {
    let s = 0, n = 0;
    for (let k = -3; k <= 3; k++) {
      const j = i + k;
      if (j < 0 || j >= alt.length) continue;
      const wgt = 4 - Math.abs(k);
      s += alt[j] * wgt; n += wgt;
    }
    return s / n;
  });

  // Periapsis is the most VALUABLE free stretch, not the longest. Monday's
  // five-hour post-lab evening loses to Wednesday's fresh afternoon, which is
  // the correct answer and the reason the metaphor earns its place.
  const free = freeOn(data, iso, w);
  const scored = free.map((g) => Object.assign({}, g, { value: weightedMinutes(busy, g.start, g.end) }));
  const deepest = scored.slice().sort((a, b) => b.value - a.value)[0] || null;

  return {
    date: iso,
    windowStart: lo, windowEnd: hi,
    altitude: smooth,
    busy,
    free: scored,
    periapsis: deepest ? {
      start: clock(deepest.start), end: clock(deepest.end),
      minutes: deepest.end - deepest.start, value: deepest.value,
      startMin: deepest.start, endMin: deepest.end,
    } : null,
    burns: (burns || []).filter((b) => b.date === iso),
    capacityMin: capacityOn(data, iso, w),
  };
}

export const fmtHrs = (m) => (m % 60 === 0 ? (m / 60) + "h" : (m / 60).toFixed(1) + "h");
export { clock, mins };
