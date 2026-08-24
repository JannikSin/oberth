// career.js: the manifest. Dated rows, status ticks, no ornament.
//
// The 2026-08-24 council ruled 4-1 that career should NOT move out of Crystal,
// on the grounds that it is the only lane with EXTERNAL deadlines that do not
// move for a lab report, and burying it in a container opened when homework is
// due means opening it least in the weeks recruiting closes.
//
// David overruled that, and his reason holds: he intends to work the lane here,
// alongside research and clubs, because for him career IS the academic project.
// So it lives here. The council's risk is real though, so this tab shows the
// nearest external deadline in the masthead at all times: if it drifts, it
// drifts loudly rather than quietly.
//
// Career items are the one class of thing in Oberth that is NOT generated from
// a syllabus, so this tab reads from a pushed payload the way Crystal's does.

import { el, esc, mast, zone, footer, empty, K, lsGet, lsSet, api, todayIso, fmtDay, runway, daysUntil } from "../../core.js";
import { queueTick } from "../../sync.js";

const CACHE = K("career");
const doneKey = K("career.done");
const doneSet = () => lsGet(doneKey, {});

export function open(parts) {
  const root = document.getElementById("root");
  const cached = lsGet(CACHE, null);
  paint(root, cached);
  // Refresh in the background; a stale board still beats a spinner.
  api("/career").then((data) => {
    lsSet(CACHE, data);
    if (location.hash.replace(/^#\/?/, "").split("/")[0] === "career") paint(root, data);
  }).catch(() => {});
}

function paint(root, data) {
  root.innerHTML = "";
  const wrap = document.createElement("div");
  const items = (data && data.items) || [];
  const D = doneSet();
  const open_ = items.filter((i) => !D[i.id] && !i.done);
  const next = open_.filter((i) => i.due).sort((a, b) => a.due.localeCompare(b.due))[0];

  wrap.appendChild(mast("Career", "external deadlines do not move",
    next ? "next" : "", next ? runway(next.due) : "—"));

  if (!items.length) {
    wrap.appendChild(empty("—", "Nothing pushed yet",
      "Career items are pushed from the laptop. Until the Worker is live this tab stays empty on purpose rather than inventing rows."));
    wrap.appendChild(footer());
    root.appendChild(wrap);
    return;
  }

  // A deadline inside two weeks is amber whatever else is happening. This is
  // the council's concern, wired rather than argued.
  wrap.appendChild(zone("open"));
  if (!open_.length) wrap.appendChild(empty("✓", "Clear", "No open career items."));
  open_.sort((a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999")))
    .forEach((it) => wrap.appendChild(row(it, D, root, data)));

  const closed = items.filter((i) => D[i.id] || i.done);
  if (closed.length) {
    wrap.appendChild(zone("closed"));
    closed.forEach((it) => wrap.appendChild(row(it, D, root, data)));
  }

  wrap.appendChild(footer());
  root.appendChild(wrap);
}

function row(it, D, root, data) {
  const isDone = !!(D[it.id] || it.done);
  const near = it.due && daysUntil(it.due) <= 14 && !isDone;
  const p = el("div", { class: "panel " + (isDone ? "" : near ? "is-burn" : "is-tel") });

  const ph = el("div", { class: "ph" });
  const t = el("span", { class: "pt" });
  t.textContent = it.title || it.id;
  if (isDone) { t.style.color = "var(--faint)"; t.style.textDecoration = "line-through"; }
  ph.appendChild(t);
  ph.appendChild(el("span", { class: "pm" }, esc(it.due ? runway(it.due) : (it.kind || ""))));
  p.appendChild(ph);

  if (it.org || it.due) {
    const m = el("div", { class: "pm" }, "");
    m.textContent = [it.org, it.due ? fmtDay(it.due) : null].filter(Boolean).join("  ·  ");
    m.style.marginTop = "2px";
    p.appendChild(m);
  }
  if (it.note) {
    const n = el("p", null, "");
    n.textContent = it.note;
    p.appendChild(n);
  }

  if (!isDone) {
    const b = el("button", { type: "button", class: "recbtn" }, "Done");
    b.style.marginTop = "10px";
    b.addEventListener("click", () => {
      const s = doneSet();
      s[it.id] = true;
      lsSet(doneKey, s);
      queueTick(it.id, true, { lane: "career" });
      paint(root, data);
    });
    p.appendChild(b);
  }
  return p;
}
