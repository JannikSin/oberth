// courses.js: the panel. Fixed data, gauges, and the two counters that can
// actually cost him a grade.
//
// DROPS AND CLIFFS ARE PIPS, NOT PERCENTAGES. They are countable objects with
// hard thresholds, and a percentage would lie about that. The habit-ramp
// council already barred percentages from David's daily brief for the same
// reason: a fraction reads as a grade, a grade reads as punishment, and a
// punishment display gets ignored by week three.
//
// A drop is framed as a SPENDABLE ALLOWANCE, never as an error count. "2 skips
// left, spending one this week costs you nothing" is an approach behaviour.
// "0 of 2 used" is a report card. Only one of those gets tapped.

import { el, esc, mast, zone, footer, empty, K, lsGet, lsSet, todayIso, courses as courseData } from "../../core.js";
import { queueTick, deadLetters } from "../../sync.js";

const ledgerKey = K("ledger");
const ledger = () => lsGet(ledgerKey, {});
function spend(id, n) {
  const L = ledger();
  L[id] = Math.max(0, (L[id] || 0) + n);
  lsSet(ledgerKey, L);
  queueTick(id, true, { used: L[id] });
  return L[id];
}

const load = () => courseData();

export function open(parts) {
  const root = document.getElementById("root");
  load().then((data) => {
    if (location.hash.replace(/^#\/?/, "").split("/")[0] !== "courses") return;
    root.innerHTML = "";
    const wrap = document.createElement("div");

    const L = ledger();
    const cliffLeft = data.courses.flatMap((c) => c.cliffs || [])
      .reduce((s, cf) => s + Math.max(0, cf.limit - (L[cf.id] || 0)), 0);

    wrap.appendChild(mast("Courses", data.term + " · seven enrolled", "cliff margin", String(cliffLeft)));

    // The dead-letter recovery control. Nothing else in the app can clear it,
    // so it lives where the durable data lives.
    if (deadLetters().length) {
      const d = el("div", { class: "panel is-cliff" });
      d.appendChild(el("div", { class: "ph" },
        "<span class='pt'>Rejected writes</span><span class='pm'>" + esc(String(deadLetters().length)) + " held</span>"));
      d.appendChild(el("p", null, "The server refused these and they were kept rather than destroyed. Nothing was lost."));
      const b = el("button", { type: "button", class: "savebtn" }, "Retry them");
      b.style.marginTop = "10px";
      b.addEventListener("click", () => { window.__oberthRevive(); open(parts); });
      d.appendChild(b);
      wrap.appendChild(d);
    }

    // ---- the cliffs first: they are the only thing here that fails a course
    wrap.appendChild(zone("cliffs"));
    const cliffs = data.courses.flatMap((c) => (c.cliffs || []).map((cf) => ({ c, cf })));
    if (!cliffs.length) wrap.appendChild(empty("—", "No cliffs", "No course has a hard attendance threshold."));
    cliffs.forEach(({ c, cf }) => wrap.appendChild(cliffPanel(c, cf, L, parts)));

    // ---- drops: spendable allowance
    wrap.appendChild(zone("drops you can spend"));
    const drops = data.courses.flatMap((c) => (c.drops || []).map((d) => ({ c, d })));
    if (!drops.length) wrap.appendChild(empty("—", "No drops anywhere", "Every course counts every score."));
    drops.forEach(({ c, d }) => wrap.appendChild(dropPanel(c, d, L, parts)));

    // ---- the courses themselves
    wrap.appendChild(zone("the seven"));
    data.courses.forEach((c) => wrap.appendChild(coursePanel(c)));
    (data.missingCourses || []).forEach((c) => {
      const p = el("div", { class: "panel" });
      p.appendChild(el("div", { class: "ph" },
        "<span class='pt'>" + esc(c.short) + "</span><span class='pm'>no syllabus</span>"));
      p.appendChild(el("p", null, esc(c.title + " · " + fmtMeets(c.meets))));
      p.appendChild(el("p", null, "Nothing is tracked for this course because its syllabus was never obtained."));
      wrap.appendChild(p);
    });

    wrap.appendChild(footer());
    root.appendChild(wrap);
  });
}

function cliffPanel(c, cf, L, parts) {
  const used = L[cf.id] || 0;
  const left = Math.max(0, cf.limit - used);
  const p = el("div", { class: "panel " + (left <= 1 ? "is-cliff" : "") });
  p.appendChild(el("div", { class: "ph" },
    "<span class='pt'>" + esc(c.short + " · " + cf.label) + "</span>" +
    "<span class='pm'>" + esc(left === 0 ? "NONE LEFT" : left + " left") + "</span>"));

  const g = el("div", { class: "gauge" });
  g.appendChild(el("span", { class: "gl" }, "margin"));
  const pips = el("div", { class: "pips" });
  for (let i = 0; i < cf.limit; i++) {
    pips.appendChild(el("span", { class: "pip" + (i < used ? (left <= 1 ? " danger" : " spent") : "") }));
  }
  g.appendChild(pips);
  g.appendChild(el("span", { class: "gv" }, esc(used + " used")));
  p.appendChild(g);

  // Zero renders LOUDLY as a sentence, not a number. This is the one deliberate
  // exception to "a counter at zero does not render".
  const msg = el("p", null, "");
  if (left === 0) {
    msg.textContent = "No margin left. The next one caps this course at a C.";
    msg.style.color = "var(--cliff)";
  } else {
    msg.textContent = cf.limit + " misses caps the course at " + cf.atLimit.replace("course capped at ", "") + ". More than " + cf.limit + " is " + cf.overLimit + ".";
  }
  p.appendChild(msg);

  const b = el("button", { type: "button", class: "recbtn" }, "I missed one");
  b.style.marginTop = "10px";
  b.addEventListener("click", () => {
    if (!confirm("Record a miss for " + c.short + " " + cf.label + "? " + (left - 1) + " would be left.")) return;
    spend(cf.id, 1);
    open(parts);
  });
  p.appendChild(b);
  return p;
}

function dropPanel(c, d, L, parts) {
  const used = L[d.id] || 0;
  const left = Math.max(0, d.total - used);
  const p = el("div", { class: "panel " + (left ? "is-burn" : "is-cliff") });
  p.appendChild(el("div", { class: "ph" },
    "<span class='pt'>" + esc(c.short + " · " + d.label) + "</span>" +
    "<span class='pm'>" + esc(left + " to spend") + "</span>"));

  const g = el("div", { class: "gauge" });
  g.appendChild(el("span", { class: "gl" }, "allowance"));
  const pips = el("div", { class: "pips" });
  for (let i = 0; i < d.total; i++) pips.appendChild(el("span", { class: "pip" + (i < used ? " spent" : "") }));
  g.appendChild(pips);
  g.appendChild(el("span", { class: "gv" }, esc(used + " spent")));
  p.appendChild(g);

  const msg = el("p", null, "");
  msg.textContent = left
    ? "You have " + left + " skip" + (left > 1 ? "s" : "") + ". Spending one costs you nothing."
    : "Both are gone. Every remaining score counts.";
  if (!left) msg.style.color = "var(--cliff)";
  p.appendChild(msg);

  if (left) {
    const b = el("button", { type: "button", class: "recbtn" }, "Spend one");
    b.style.marginTop = "10px";
    b.addEventListener("click", () => {
      if (!confirm("Spend a " + c.short + " drop? " + (left - 1) + " would be left.")) return;
      spend(d.id, 1);
      open(parts);
    });
    p.appendChild(b);
  }
  return p;
}

function fmtMeets(meets) {
  return (meets || []).map((m) => m.days.join("") + " " + m.start + "-" + m.end + (m.room ? " " + m.room : "")).join(" · ");
}

function coursePanel(c) {
  const p = el("div", { class: "panel is-" + (c.accent || "tel") });
  p.appendChild(el("div", { class: "ph" },
    "<span class='pt'>" + esc(c.short) + "</span><span class='pm'>" + esc(c.credits + " cr") + "</span>"));
  p.appendChild(el("p", null, esc(c.title)));
  const meets = el("div", { class: "pm" }, esc(fmtMeets(c.meets)));
  meets.style.marginTop = "6px";
  p.appendChild(meets);

  if (c.gate) {
    const g = el("p", null, "");
    g.textContent = "GATE: " + c.gate;
    g.style.color = "var(--cliff)";
    p.appendChild(g);
  }
  if (c.freebie) {
    const f = el("p", null, "");
    f.textContent = c.freebie;
    f.style.color = "var(--good)";
    p.appendChild(f);
  }
  (c.unknowns || []).forEach((u) => {
    const x = el("p", null, "");
    x.textContent = "UNKNOWN: " + u;
    x.style.color = "var(--burn)";
    p.appendChild(x);
  });
  (c.officeHours || []).forEach((oh) => {
    const o = el("div", { class: "pm" }, "");
    o.textContent = "OH " + oh.who + " · " + oh.days.join("") + " " + oh.start + "-" + oh.end + " · " + oh.room +
      (oh.assumed ? " (assumed)" : "");
    o.style.marginTop = "4px";
    o.style.color = "var(--faint)";
    p.appendChild(o);
  });
  if (c.instructor && c.instructor.emailRule) {
    const e = el("p", null, "");
    e.textContent = c.instructor.emailRule;
    e.style.color = "var(--burn)";
    p.appendChild(e);
  }
  return p;
}
