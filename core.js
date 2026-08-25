// core.js: the shared spine. Storage, dates, DOM, the key screen, the router
// handle. Every tab module imports from here and nothing imports from a tab.

export const WORKER = "https://oberth.janniksin.workers.dev";
export const HISTORY_DAYS = 8;

export const root = document.getElementById("root");
export const tabbar = document.getElementById("tabbar");

// ---------------------------------------------------------------- storage --
// Every localStorage call is guarded. Safari throws on quota and in private
// mode, and a throw here would white-screen the app on boot. lsSet returns
// FALSE on failure so callers can tell the user their write did not land,
// which is the whole difference between a bug and a lie.
export function lsGet(k, fallback) {
  try {
    const v = localStorage.getItem(k);
    return v == null ? fallback : JSON.parse(v);
  } catch (e) { return fallback; }
}
export function lsSet(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch (e) { return false; }
}
export function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

// Storage keys are prefixed `oberth.` WITHOUT EXCEPTION. All of David's PWAs
// share the janniksin.github.io origin, which means one localStorage and one
// IndexedDB namespace for the whole fleet. An unprefixed key here would
// collide with Crystal's. This is the rule that keeps the fleet from eating
// itself; there is a test for it.
export const K = (suffix) => "oberth." + suffix;

export function key() { return localStorage.getItem(K("key")) || ""; }
export function setKey(v) { try { localStorage.setItem(K("key"), v); } catch (e) {} }
export function forgetPhone() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith("oberth."))
      .forEach((k) => localStorage.removeItem(k));
  } catch (e) {}
  location.reload();
}

// Drop dated payload caches older than HISTORY_DAYS so a phone that has run
// for a semester does not carry a semester of stale JSON.
export function pruneDated() {
  const keep = new Set();
  for (let i = 0; i < HISTORY_DAYS; i++) keep.add(shiftIso(-i));
  try {
    Object.keys(localStorage).forEach((k) => {
      const m = k.match(/^oberth\.(?:log|plan)\.(\d{4}-\d{2}-\d{2})$/);
      if (m && !keep.has(m[1])) localStorage.removeItem(k);
    });
  } catch (e) {}
}

// ------------------------------------------------------------------ dates --
const p2 = (n) => String(n).padStart(2, "0");
export function isoOf(d) { return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()); }
export function todayIso() { return isoOf(new Date()); }
export function shiftIso(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return isoOf(d);
}
export function nowIso() {
  const d = new Date();
  return isoOf(d) + "T" + p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds());
}
export function hhmm(iso) {
  const m = String(iso).match(/T(\d{2}):(\d{2})/);
  return m ? m[1] + ":" + m[2] : "";
}
export function fmtDay(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
export function daysUntil(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const t = new Date(y, m - 1, d);
  const n = new Date(); n.setHours(0, 0, 0, 0);
  return Math.round((t - n) / 864e5);
}
// "in 3 days" reads worse than the thing David actually needs, which is how
// much runway is left. Negative is overdue and says so.
export function runway(iso) {
  const n = daysUntil(iso);
  if (n < 0) return Math.abs(n) + "d OVERDUE";
  if (n === 0) return "TODAY";
  if (n === 1) return "TOMORROW";
  return "T-" + n + "d";
}

// -------------------------------------------------------------------- DOM --
export function el(tag, attrs, html) {
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (html != null) n.innerHTML = html;
  return n;
}
export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function mast(title, sub, altLabel, altValue) {
  const m = el("div", { class: "mast" });
  const l = el("div", { class: "l" });
  l.appendChild(el("h1", null, esc(title)));
  if (sub) l.appendChild(el("div", { class: "sub" }, esc(sub)));
  m.appendChild(l);
  if (altValue != null) {
    const a = el("div", { class: "alt" });
    a.innerHTML = "<b class='num'>" + esc(altValue) + "</b>" + esc(altLabel || "");
    m.appendChild(a);
  }
  return m;
}
export function zone(label) {
  return el("div", { class: "zone" }, "<span>" + esc(label) + "</span>");
}
export function empty(glyph, title, text) {
  return el("div", { class: "empty" },
    "<div class='g'>" + esc(glyph) + "</div><h3>" + esc(title) + "</h3><p>" + esc(text) + "</p>");
}

// ------------------------------------------------------------------- net --
export function api(path) {
  return fetch(WORKER + path, { headers: { "x-oberth-key": key() } })
    .then((r) => {
      if (r.status === 401) { keyScreen("That key was rejected."); throw new Error("401"); }
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    });
}

// ------------------------------------------------------- the course rulebook
// The syllabus data does NOT ship in this repo. GitHub Pages will not serve a
// private repo on David's plan, so the app repo is public, and his course
// schedule names the room he is in at every hour of every weekday under his
// real name. That is not something to publish to satisfy a hosting
// constraint. It lives in the Worker's KV behind the key, which is the same
// doctrine Crystal uses: the Pages app is an empty shell.
//
// Cached in localStorage so the app still renders offline and on a cold plane.
let COURSES = null;
export async function courses() {
  if (COURSES) return COURSES;
  const cached = lsGet(K("courses"), null);
  try {
    const fresh = await api("/courses");
    if (fresh && Array.isArray(fresh.courses) && fresh.courses.length) {
      COURSES = fresh;
      lsSet(K("courses"), fresh);
      return fresh;
    }
    if (cached) { COURSES = cached; return cached; }
    return fresh || { courses: [] };
  } catch (e) {
    if (cached) { COURSES = cached; return cached; }
    throw e;
  }
}

// ---------------------------------------------------------------- router --
let router = () => {};
export function setRouter(fn) { router = fn; }
export function go(hash) {
  if (location.hash === hash) router();
  else location.hash = hash;
}
export function isTab(name) {
  return location.hash.replace(/^#\/?/, "").split("/")[0] === name;
}

// ------------------------------------------------------------- key screen --
export function keyScreen(err) {
  tabbar.hidden = true;
  root.innerHTML = "";
  const w = el("div", { class: "keyscreen" });
  w.appendChild(el("div", { class: "brand" }, "Oberth"));
  w.appendChild(el("div", { class: "tag" }, "burn at periapsis"));
  const inp = el("input", { type: "password", placeholder: "access key", autocomplete: "off", "aria-label": "Access key" });
  const btn = el("button", { type: "button" }, "Unlock");
  const e = el("div", { class: "err" }, esc(err || ""));
  const submit = () => {
    const v = inp.value.trim();
    if (!v) { e.textContent = "Paste the key first."; return; }
    setKey(v);
    location.hash = "#/tonight";
    router();
  };
  btn.addEventListener("click", submit);
  inp.addEventListener("keydown", (ev) => { if (ev.key === "Enter") submit(); });
  w.appendChild(inp); w.appendChild(btn); w.appendChild(e);
  root.appendChild(w);
  inp.focus();
}

export function footer() {
  const f = el("div", { class: "foot" });
  f.appendChild(el("span", { id: "syncline", class: "syncline" }, "—"));
  const b = el("span", null, "Forget this phone");
  b.style.cursor = "pointer";
  b.addEventListener("click", () => { if (confirm("Clear Oberth's key and data on this phone?")) forgetPhone(); });
  f.appendChild(b);
  return f;
}
