// sw.js: Oberth's service worker.
//
// ============================================================================
// THE PREFIX GUARD IS NOT OPTIONAL.
//
// Every one of David's PWAs lives on janniksin.github.io, ONE ORIGIN. That
// means caches.keys() from here enumerates Mise's caches, Anvil's, Bonmot's,
// Grandstand's, Tally's, Finesse's, AIMap's and Crystal's. A cleanup that
// deletes "every cache that is not mine" deletes THEIRS.
//
// That is not hypothetical. Mise shipped exactly that bug and evicted five
// sibling apps on every deploy for 22 days, 2026-07-27 to 2026-08-18. It was
// fixed in code and never written into Lessons-Learned, so nothing stops the
// next app from reintroducing it. This comment is that missing lesson.
//
// RULE: filter by the oberth- prefix before deleting anything, forever.
// ============================================================================

const CACHE_PREFIX = "oberth-shell-";
const CACHE = CACHE_PREFIX + "v2";

// Bump CACHE on ANY change to a precached file. A phone holding old CSS while
// fetching new markup renders a broken page, and the user cannot tell that
// from a bug in the app.
const PRECACHE = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./core.js",
  "./sync.js",
  "./app/schedule.js",
  "./app/ledger.js",
  "./app/srs.js",
  "./app/views/tonight.js",
  "./app/views/track.js",
  "./app/views/study.js",
  "./app/views/courses.js",
  "./app/views/career.js",
  "./vendor/ts-fsrs.mjs",
  "./data/courses.json",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  // addAll is all-or-nothing: one 404 fails the whole install and the old SW
  // stays live, which is the correct failure. A half-populated cache is worse
  // than none because it serves a partial app.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE)  // <- the guard
        .map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;          // never cache a POST
  if (url.origin !== location.origin) return;      // never cache the Worker
  // data/*.json is the course rulebook and changes when a syllabus does, so it
  // is network-first: correctness beats a few hundred milliseconds.
  if (url.pathname.includes("/data/")) {
    e.respondWith(
      fetch(e.request).then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
