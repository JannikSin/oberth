// Render the two recording surfaces against a stub DOM.
//
// There is no device in this loop. The app is only ever really exercised on an
// iPhone, at night, by one person, and a typo in a view does not show up as a
// failed build: it shows up as a blank tab at 23:40 when he is trying to log a
// notebook and has no laptop. That is too late and too expensive.
//
// So this is deliberately NOT a unit test of pure functions. It boots the real
// modules, with the real core.js and sync.js underneath them, and calls open()
// the way the router does. The stub is only as rich as the app actually needs;
// anything the app touches that is missing here will throw, which is the point.

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? (pass++, console.log("  ok   " + msg)) : (fail++, console.log("  FAIL " + msg)); };

// ------------------------------------------------------------- the stub ----
function makeNode(tag) {
  const n = {
    tagName: String(tag).toUpperCase(),
    children: [], attrs: {}, style: {}, dataset: {},
    _html: "", _text: "", listeners: {}, disabled: false, hidden: false, parent: null,
    appendChild(c) { c.parent = n; n.children.push(c); return c; },
    removeChild(c) { n.children = n.children.filter((x) => x !== c); return c; },
    remove() { if (n.parent) n.parent.removeChild(n); },
    setAttribute(k, v) { n.attrs[k] = String(v); },
    getAttribute(k) { return k in n.attrs ? n.attrs[k] : null; },
    removeAttribute(k) { delete n.attrs[k]; },
    addEventListener(k, fn) { (n.listeners[k] = n.listeners[k] || []).push(fn); },
    removeEventListener(k, fn) {
      n.listeners[k] = (n.listeners[k] || []).filter((f) => f !== fn);
    },
    querySelector(sel) { return n.find(sel); },
    querySelectorAll(sel) { return n.findAll(sel); },
    // Good enough for the selectors this app really uses: ".cls", "#id",
    // "tag", and the one descendant selector in core.js (".mast .alt b").
    findAll(sel) {
      const parts = String(sel).trim().split(/\s+/);
      let pool = n.all();
      parts.forEach((p) => {
        pool = pool.filter((x) => matches(x, p));
        if (parts.length > 1) pool = pool.flatMap((x) => [x, ...x.all()]);
      });
      return parts.length > 1 ? n.all().filter((x) => matches(x, parts[parts.length - 1])) : pool;
    },
    find(sel) { return n.findAll(sel)[0] || null; },
    all() { return n.children.flatMap((c) => [c, ...c.all()]); },
    click() { (n.listeners.click || []).forEach((f) => f({})); },
    get innerHTML() { return n._html; },
    set innerHTML(v) { n._html = String(v); if (v === "") n.children = []; },
    get textContent() {
      return n._text + n.children.map((c) => c.textContent).join("") + stripTags(n._html);
    },
    set textContent(v) { n._text = String(v); n.children = []; },
    get value() { return n._value || ""; },
    set value(v) { n._value = String(v); },
  };
  return n;
}
const stripTags = (h) => String(h).replace(/<[^>]*>/g, "");
function matches(node, sel) {
  if (sel.startsWith(".")) return (node.attrs.class || "").split(/\s+/).includes(sel.slice(1));
  if (sel.startsWith("#")) return node.attrs.id === sel.slice(1);
  return node.tagName === sel.toUpperCase();
}

const root = makeNode("div"); root.setAttribute("id", "root");
const tabbar = makeNode("nav"); tabbar.setAttribute("id", "tabbar");
const body = makeNode("body");

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.document = {
  visibilityState: "visible",
  body,
  createElement: makeNode,
  getElementById: (id) => (id === "root" ? root : id === "tabbar" ? tabbar : (root.find("#" + id) || body.find("#" + id))),
  querySelector: (s) => body.find(s) || root.find(s),
  querySelectorAll: (s) => root.findAll(s),
  addEventListener() {}, removeEventListener() {},
};
globalThis.window = {
  scrollTo() {}, MediaRecorder: function () {},
  addEventListener() {}, removeEventListener() {},
  indexedDB: undefined,
};
// Node 24 defines navigator as a getter-only global, so it has to be redefined
// rather than assigned.
Object.defineProperty(globalThis, "navigator", {
  value: { onLine: true, mediaDevices: {} }, configurable: true, writable: true,
});

// The Worker, stubbed. Two days of notes, one of them captured badly, which is
// the row whose warning has to appear.
let asked = null;
globalThis.fetch = async (url, opts) => {
  if (opts && opts.method === "POST") {
    asked = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  }
  const day = String(url).match(/date=([\d-]+)/)?.[1];
  const notes = day === "2026-09-13"
    ? [{ book: "updates", kind: "audio", text: "understand the the research term", at: "2026-09-13T10:55:00",
         seconds: 41, mic: "David's AirPods Pro", hz: 16000, micLevel: "bluetooth" },
       { book: "thinking", kind: "text", text: "a typed one", at: "2026-09-13T11:20:00" }]
    : [];
  return { ok: true, status: 200, json: async () => ({ date: day, notes }) };
};

// ------------------------------------------------------------------ run ----
const iso = new Date().toISOString().slice(0, 10);
store.set("oberth.key", "test-key");

console.log("\n-- the Notes tab renders --");
const notes = await import("../app/views/notes.js");
let threw = null;
try { notes.open([]); } catch (e) { threw = e; }
ok(!threw, "open() does not throw" + (threw ? ": " + threw.message : ""));
const text = root.textContent;
ok(/Notes/.test(text), "the masthead says Notes");
ok(/ask something/i.test(text), "the ask panel has its zone");
const askTa = root.findAll("TEXTAREA")[0];
ok(/Ask anything/i.test(askTa && askTa.placeholder || ""), "and its prompt");

console.log("\n-- asking files a question, and cannot answer one --");
const askBtn = root.findAll(".savebtn").find((b) => b.textContent.includes("Ask"));
ok(Boolean(askBtn), "the Ask button exists");
const ta = root.findAll("TEXTAREA")[0];
ta.value = "what is a Van der Pol oscillator";
askBtn.click();
const queued = JSON.parse(localStorage.getItem("oberth.queue") || "[]");
ok(queued.length === 1 && queued[0].type === "ask", "it queues one ask");
ok(queued[0].add[0].q === "what is a Van der Pol oscillator", "carrying the question verbatim");
ok(!("answer" in queued[0].add[0]), "and NO answer field: the phone asks, the laptop answers");

console.log("\n-- a badly captured note is flagged where the bad text is --");
await new Promise((r) => setTimeout(r, 200)); // let load()'s ten sequential fetches settle
const rendered = root.textContent;
ok(/the research term/.test(rendered), "the note text is shown");
ok(/AirPods/.test(rendered), "the microphone it was captured on is named");
ok(/16kHz/.test(rendered), "with the sample rate");
ok(/Bluetooth call path/.test(rendered), "and the warning sits on that note");

console.log("\n-- a note can be marked not mine, and it is a FLAG not a delete --");
const junkBtn = root.findAll(".savebtn").find((b) => b.textContent.includes("Not mine"));
ok(Boolean(junkBtn), "every note card carries the tidy control");
junkBtn.click();
const q2 = JSON.parse(localStorage.getItem("oberth.queue") || "[]");
const flag = q2.find((x) => x.type === "junk");
ok(Boolean(flag), "tapping it queues a junk flag");
ok(flag && flag.junk === true, "marking, not unmarking");
ok(Boolean(flag && flag.at) && Boolean(flag && flag.date),
   "addressed by date and timestamp, so it finds exactly one row");
ok(!q2.some((x) => x.type === "delete" || x.type === "remove"),
   "and NOTHING in the queue is a delete: the phone never deletes");

console.log("\n-- the Tonight lanes still build --");
root.innerHTML = "";
const tonight = await import("../app/views/tonight.js");
threw = null;
try { tonight.open(); } catch (e) { threw = e; }
ok(!threw, "open() does not throw" + (threw ? ": " + threw.message : ""));
const tt = root.textContent;
ok(/Lecture notes/.test(tt) && /Updates notebook/.test(tt) && /Thinking out loud/.test(tt),
   "all three books are there");
ok(root.findAll(".recbtn").length === 3, "each book has its own record button");

console.log("\n-- the router knows about the new tab --");
const appjs = readFileSync(new URL("../app.js", import.meta.url), "utf8");
ok(/ROUTES = \{[^}]*notes[^}]*\}/.test(appjs), "notes is a route");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
ok(/data-tab="notes"/.test(html), "and has a tab button");
const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
["./app/views/notes.js", "./app/mic.js", "./app/lib/awake.js"].forEach((f) => {
  ok(sw.includes('"' + f + '"'), f + " is precached");
});
const ver = sw.match(/CACHE_PREFIX \+ "v(\d+)"/)[1];
ok(Number(ver) >= 10, "and CACHE was bumped (v" + ver + "); a stale shell renders a broken page");

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
