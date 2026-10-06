// brief.js: the night-before pre-read, at the top of Tonight.
//
// David, 2026-10-05: "study should be in oberth i dont use oberth but i need
// to and that is the whole point of app." The 9 pm phone push deep-links to
// #/tonight/tomorrow, so the pre-read is what gets him into Oberth every night.
//
// The laptop builds a typeset PDF (Crystal System/Class-Prep) and posts it as
// page images, so the math arrives exactly as typeset and nothing here needs a
// math library. The ticks are one tap, after the fact, per class: the only
// write he actually uses (see CLAUDE.md, the behavioural constraint).
//
// Offline: the last brief is kept in the Cache API under an oberth- name the
// service worker's cleanup does not match. NOT localStorage, which is one 5 MB
// box shared by every app on janniksin.github.io.

import { el, esc, zone, WORKER, key, todayIso, shiftIso, fmtDay } from "../../core.js";

const CACHE = "oberth-brief-v1";
const LAST = "https://oberth.local/brief/last";
const TICKS = [["got", "Got it"], ["shaky", "Shaky"], ["lost", "Lost"]];

// Before 5 pm the day's own brief still matters (read it before class);
// after that, the next class day's.
export const fromDate = (now = new Date()) => (now.getHours() < 17 ? todayIso() : shiftIso(1));

async function load() {
  const from = fromDate();
  try {
    const r = await fetch(WORKER + "/brief?from=" + from, { headers: { "x-oberth-key": key() } });
    if (!r.ok) throw new Error(String(r.status));
    const d = await r.json();
    if (!d.none) {
      try { const c = await caches.open(CACHE); await c.put(LAST, new Response(JSON.stringify(d))); } catch (e) {}
    }
    return d;
  } catch (e) {
    try {
      const c = await caches.open(CACHE);
      const hit = await c.match(LAST);
      if (hit) {
        const d = await hit.json();
        if (d.date >= from) return Object.assign(d, { offline: true });
      }
    } catch (e2) {}
    return { none: true, offline: true };
  }
}

function postTick(date, code, tick) {
  return fetch(WORKER + "/brief/tick", {
    method: "POST",
    headers: { "content-type": "application/json", "x-oberth-key": key() },
    body: JSON.stringify({ date, code, tick }),
  }).then((r) => r.json()).catch(() => null);
}

export function briefCard(focus) {
  const box = el("section", { class: "brief", id: "tomorrow" });
  box.appendChild(zone("pre-read"));
  const body = el("div", { class: "briefbody" }, "<p class='dim'>Loading the pre-read&hellip;</p>");
  box.appendChild(body);
  load().then((d) => paint(body, d, focus));
  return box;
}

function paint(body, d, focus) {
  body.innerHTML = "";
  if (d.none) {
    body.appendChild(el("p", { class: "dim" },
      d.offline ? "Offline, and no pre-read saved on this phone yet." : "No pre-read posted for the next class day yet."));
    return;
  }
  const label = d.date === todayIso() ? "Today" : d.date === shiftIso(1) ? "Tomorrow" : fmtDay(d.date);
  body.appendChild(el("h2", { class: "briefhead" },
    esc(label) + " <span>" + esc(d.title || "") + "</span>" + (d.offline ? " <em>saved copy</em>" : "")));

  const list = el("div", { class: "briefclasses" });
  const ticks = d.ticks || {};
  (d.classes || []).forEach((c) => {
    const row = el("div", { class: "bclass" });
    row.appendChild(el("div", { class: "bmeta" },
      "<b>" + esc(c.short) + "</b> <span>" + esc(c.time) + "</span>"));
    row.appendChild(el("div", { class: "btopic" }, esc(c.topic)));
    const tk = el("div", { class: "bticks" });
    TICKS.forEach(([v, name]) => {
      const b = el("button", { type: "button", "data-v": v,
        "aria-pressed": ticks[c.code] && ticks[c.code].tick === v ? "true" : "false" }, name);
      b.addEventListener("click", () => {
        const on = b.getAttribute("aria-pressed") === "true";
        tk.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", "false"));
        if (!on) b.setAttribute("aria-pressed", "true");
        postTick(d.date, c.code, on ? "" : v);
      });
      tk.appendChild(b);
    });
    row.appendChild(tk);
    list.appendChild(row);
  });
  body.appendChild(list);

  const pages = el("div", { class: "briefpages" });
  (d.pages || []).forEach((src, i) => {
    const img = el("img", { src, alt: "Pre-read page " + (i + 1), loading: "lazy" });
    pages.appendChild(img);
  });
  if (!(d.pages || []).length) pages.appendChild(el("p", { class: "dim" }, "No pages in this pre-read."));

  // Collapsed by default on Tonight, open when he arrived from the phone push.
  const det = el("details", { class: "briefread" });
  if (focus) det.setAttribute("open", "");
  det.appendChild(el("summary", null, "Read it (" + (d.pages || []).length + " pages)"));
  det.appendChild(pages);
  body.appendChild(det);
  if (focus) setTimeout(() => body.parentNode && body.parentNode.scrollIntoView && body.parentNode.scrollIntoView(), 0);
}
