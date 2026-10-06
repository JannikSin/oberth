// The night-before pre-read: the Worker's /brief routes against an in-memory
// KV, then the Tonight card against a stub DOM fed by that same Worker.
// Run: node tests/brief.test.mjs

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? (pass++, console.log("  ok   " + msg)) : (fail++, console.log("  FAIL " + msg)); };

// ------------------------------------------------------------- fake KV ----
const kv = new Map();
const STORE = {
  get: async (k) => (kv.has(k) ? kv.get(k) : null),
  put: async (k, v) => { kv.set(k, v); },
  list: async ({ prefix }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }),
  delete: async (k) => { kv.delete(k); },
};
const env = { STORE, OBERTH_KEY: "laptop-k", PHONE_KEY: "phone-k" };
const worker = (await import("../worker/src/index.js")).default;
const call = (method, path, who, body) => worker.fetch(new Request("https://w" + path, {
  method, headers: { "x-oberth-key": who, "content-type": "application/json" },
  body: body ? JSON.stringify(body) : undefined,
}), env).then(async (r) => ({ status: r.status, body: await r.json() }));

const PNG = "data:image/png;base64,iVBORw0KGgo=";
console.log("\n-- the laptop posts a pre-read, the phone reads it --");
let r = await call("POST", "/brief", "laptop-k", {
  date: "2026-10-06", title: "PHYS 306, ME 264, ME 290, ME 239, MFET",
  classes: [{ code: "PHYS30600", short: "PHYS 306", time: "10:30 am", topic: "Complex numbers <script>" }],
  pages: [PNG, "javascript:alert(1)", PNG],
});
ok(r.body.ok && r.body.pages === 2, "stored, and a non-image page is dropped");
r = await call("POST", "/brief", "phone-k", { date: "2026-10-07", pages: [PNG] });
ok(r.status === 403, "the phone cannot write a pre-read");
await call("POST", "/brief", "laptop-k", { date: "2026-10-09", classes: [], pages: [PNG] });
r = await call("GET", "/brief?from=2026-10-07", "phone-k");
ok(r.body.date === "2026-10-09", "from= returns the next class day on or after it (Wed has none, Fri does)");
r = await call("GET", "/brief?from=2026-10-06", "phone-k");
ok(r.body.date === "2026-10-06" && r.body.pages.length === 2, "and the day itself when it has one");
r = await call("GET", "/brief?from=2026-12-31", "phone-k");
ok(r.body.none === true, "nothing after the term says none, not an error");
r = await call("POST", "/brief", "laptop-k", { title: "no date" });
ok(r.status === 200 && r.body.ok === false, "a bad post is refused with 200 ok:false (never-4xx rule)");

console.log("\n-- one tap per class, after the fact --");
r = await call("POST", "/brief/tick", "phone-k", { date: "2026-10-06", code: "PHYS30600", tick: "shaky" });
ok(r.body.ok && r.body.ticks.PHYS30600.tick === "shaky", "the phone can tick");
r = await call("GET", "/brief?from=2026-10-06", "phone-k");
ok(r.body.ticks.PHYS30600.tick === "shaky", "and the tick comes back with the brief");
r = await call("POST", "/brief/tick", "phone-k", { date: "2026-10-06", code: "PHYS30600", tick: "" });
ok(!("PHYS30600" in r.body.ticks), "tapping it again clears it");
r = await call("POST", "/brief/tick", "phone-k", { date: "2026-10-06", code: "PHYS30600", tick: "rm -rf" });
ok(!("PHYS30600" in r.body.ticks), "an unknown tick value stores nothing");

// ------------------------------------------------------------ stub DOM ----
function makeNode(tag) {
  const n = {
    tagName: String(tag).toUpperCase(), children: [], attrs: {}, listeners: {}, _html: "", parent: null,
    appendChild(c) { c.parent = n; n.children.push(c); return c; },
    setAttribute(k, v) { n.attrs[k] = String(v); },
    getAttribute(k) { return k in n.attrs ? n.attrs[k] : null; },
    addEventListener(k, fn) { (n.listeners[k] = n.listeners[k] || []).push(fn); },
    querySelectorAll(sel) { return n.all().filter((x) => x.tagName === sel.toUpperCase()); },
    all() { return n.children.flatMap((c) => [c, ...c.all()]); },
    click() { (n.listeners.click || []).forEach((f) => f({})); },
    get innerHTML() { return n._html; },
    set innerHTML(v) { n._html = String(v); if (v === "") n.children = []; },
    get text() { return n._html.replace(/<[^>]*>/g, "") + n.children.map((c) => c.text).join(" "); },
  };
  return n;
}
const ls = new Map([["oberth.key", "phone-k"]]);
globalThis.localStorage = { getItem: (k) => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
globalThis.document = { createElement: makeNode, getElementById: () => makeNode("div") };
globalThis.window = { scrollTo() {} };
const cacheStore = new Map();
globalThis.caches = { open: async () => ({
  put: async (k, v) => cacheStore.set(k, await v.text()),
  match: async (k) => (cacheStore.has(k) ? new Response(cacheStore.get(k)) : undefined),
}) };
let online = true;
globalThis.fetch = async (url, opts = {}) => {
  if (!online) throw new Error("offline");
  const u = new URL(url);
  return worker.fetch(new Request("https://w" + u.pathname + u.search, {
    method: opts.method || "GET", headers: opts.headers, body: opts.body,
  }), env);
};

const { briefCard, fromDate } = await import("../app/views/brief.js");
// The card reads fromDate() (today before 5 pm, tomorrow after), so the fixture
// goes on that same day; a fixed "tomorrow" broke whenever the suite ran before 5 pm.
const day = fromDate();
await call("POST", "/brief", "laptop-k", {
  date: day, title: "test day",
  classes: [{ code: "ME27400", short: "ME 274", time: "10:30 am", topic: "Newton <b>2</b>" }], pages: [PNG, PNG],
});
const settle = () => new Promise((res) => setTimeout(res, 50));

console.log("\n-- the Tonight card --");
ok(fromDate(new Date(2026, 9, 5, 21)) > fromDate(new Date(2026, 9, 5, 9)), "after 5 pm it looks at the next day, before 5 pm at today");
let card = briefCard(true); await settle();
let body = card.children[1];
ok(/ME 274/.test(body.text) && /Newton/.test(body.text), "shows the class and its topic");
ok(!body.all().some((x) => /<b>2<\/b>/.test(x._html)), "topic text is escaped, never injected as markup");
ok(body.all().filter((x) => x.tagName === "IMG").length === 2, "both pages render as images");
const det = body.all().find((x) => x.tagName === "DETAILS");
ok(det && det.getAttribute("open") !== null, "arriving from the phone push opens the pages");
const btn = body.all().find((x) => x.tagName === "BUTTON" && x._html === "Shaky");
btn.click(); await settle();
r = await call("GET", "/brief?from=" + day, "phone-k");
ok(btn.getAttribute("aria-pressed") === "true" && r.body.ticks.ME27400.tick === "shaky", "a tap marks it and reaches the Worker");

online = false;
card = briefCard(false); await settle();
body = card.children[1];
ok(/saved copy/.test(body.text) && /ME 274/.test(body.text), "offline, the saved copy still shows");
ok(body.all().find((x) => x.tagName === "DETAILS").getAttribute("open") === null, "opened from the tab, the pages start folded");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
