// sync.js: everything that leaves the phone.
//
// Two pipes, deliberately separate:
//   1. oberth.queue in localStorage: small JSON deltas (a saved note, a card
//      grade, a deliverable tick, an improvement note). Strict FIFO, one in
//      flight, survives a cold start.
//   2. the `uploads` IndexedDB store: audio blobs from the nightly read-aloud.
//      Blobs NEVER touch localStorage, never get base64'd, and never ride
//      inside the JSON queue, so a 6MB recording can never wedge a tick.
//
// ============================================================================
// THE DEAD LETTER RULE, and why this file differs from Crystal's.
//
// Crystal's sync.js drops the queue head on ANY 4xx except 401, on the
// reasoning that the Worker has judged the payload and retrying forever wedges
// everything behind it. That reasoning is right. The consequence was not
// thought through: after the drop, flush() recurses, finds an empty queue, and
// stamps the word "synced" on the screen. So a record the Worker REJECTED is
// destroyed and the interface reports success. Crystal's own worker carries a
// comment proving someone found this and hardened exactly one route (/desk)
// against it, leaving /ticks live. Found by the 2026-08-24 council.
//
// Oberth does not inherit it. A rejected delta is moved to a visible DEAD
// LETTER, the liveness line says so in words, and nothing is ever silently
// destroyed. Losing a lecture transcription this way would be unrecoverable:
// the paper notebook is the only other copy and the point of the ritual is
// that he already read it aloud once.
// ============================================================================

import { WORKER, K, key, lsGet, lsSet, nowIso, todayIso } from "./core.js";

const QKEY = K("queue");
const DKEY = K("dead");

export const qLen = () => lsGet(QKEY, []).length;
export const deadLetters = () => lsGet(DKEY, []);
export const clearDead = () => lsSet(DKEY, []);

// --------------------------------------------------------------- liveness --
// One dated, human-readable sentence, rendered wherever #syncline exists. It
// reports what is true, including "nothing is reaching the server", and it
// carries the time it last CHANGED, because a green light that has been green
// for eleven days because its updater died is worse than no light at all.
let lastStamp = "";
export function syncStamp(msg) {
  if (msg !== lastStamp) {
    lastStamp = msg;
    lsSet(K("stamp"), { msg, at: nowIso() });
  }
  const n = document.getElementById("syncline");
  if (n) {
    const dead = deadLetters().length;
    n.textContent = dead ? msg + " · " + dead + " NOT SENT" : msg;
    n.style.color = dead ? "var(--cliff)" : "";
  }
}
export function lastStampInfo() { return lsGet(K("stamp"), null); }

// ------------------------------------------------------------ the JSON pipe --
function enqueue(item) {
  const q = lsGet(QKEY, []);
  q.push(item);
  const ok = lsSet(QKEY, q);
  if (!ok) syncStamp("not saved on this phone");
  flush();
  return ok;
}

/** A saved notebook transcription. `book` is "lecture" | "updates". */
export function queueNote(book, text, courseCode) {
  return enqueue({
    type: "note", book, text,
    course: courseCode || null,
    date: todayIso(), at: nowIso(),
  });
}

/** An FSRS grade on one card. */
export function queueGrade(cardId, rating, progress) {
  return enqueue({ type: "grade", id: cardId, rating, progress, date: todayIso(), at: nowIso() });
}

/** A deliverable ticked done, or a drop deliberately spent. */
export function queueTick(id, done, extra) {
  return enqueue(Object.assign({ type: "tick", id, done: !!done, date: todayIso(), at: nowIso() }, extra || {}));
}

/** An improvement note. Same idea as Crystal's Desk, same offline FIFO. */
export function queueNudge(text) {
  return enqueue({ type: "nudge", text, date: todayIso(), at: nowIso() });
}

const PATHS = { note: "/note", grade: "/grade", tick: "/tick", nudge: "/nudge" };

let flushing = false;

export function flush() {
  if (flushing) return;
  const q = lsGet(QKEY, []);
  if (!q.length) { syncStamp("synced"); flushUploads(); return; }
  if (!navigator.onLine) { syncStamp(q.length + " waiting for signal"); return; }
  if (!key()) { syncStamp(q.length + " waiting for the key"); return; }

  flushing = true;
  const d = q[0];
  const path = PATHS[d.type];
  if (!path) { // unknown type: dead-letter it rather than loop forever
    flushing = false;
    bury(d, "unknown type " + d.type);
    return;
  }

  fetch(WORKER + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-oberth-key": key() },
    body: JSON.stringify(d),
  }).then((r) => {
    flushing = false;
    if (r.ok) { shift(); flush(); return; }
    if (r.status === 401) {
      // An auth STATE, not a bad delta. The key screen is already up and the
      // delta is still good, so it waits.
      syncStamp(q.length + " waiting for a valid key");
      return;
    }
    if (r.status >= 400 && r.status < 500) {
      // The Worker judged the payload. Retrying wedges the queue, so it comes
      // off the head, but it is BURIED where it can be seen and recovered,
      // never destroyed.
      return r.text().then((why) => {
        shift();
        bury(d, "HTTP " + r.status + " " + String(why).slice(0, 140));
        flush();
      }).catch(() => { shift(); bury(d, "HTTP " + r.status); flush(); });
    }
    syncStamp(q.length + " not synced (" + r.status + ")");
  }).catch(() => {
    flushing = false;
    syncStamp(q.length + " saved on phone, will sync");
  });
}

function shift() {
  const q2 = lsGet(QKEY, []);
  q2.shift();
  lsSet(QKEY, q2);
}

function bury(item, why) {
  const dead = lsGet(DKEY, []);
  dead.push({ item, why, at: nowIso() });
  lsSet(DKEY, dead);
  syncStamp("1 rejected, kept on this phone");
}

/** Put every dead letter back on the queue. Used by the "retry" control. */
export function revive() {
  const dead = lsGet(DKEY, []);
  if (!dead.length) return 0;
  const q = lsGet(QKEY, []);
  dead.forEach((d) => q.push(d.item));
  lsSet(QKEY, q);
  lsSet(DKEY, []);
  flush();
  return dead.length;
}

// ------------------------------------------------------------- the blob pipe --
const DB_NAME = "oberth";   // own database name; the origin is shared with the
const STORE = "uploads";    // rest of the fleet, so this must never be generic
const DB_VERSION = 1;

function db() {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB_NAME, DB_VERSION);
    rq.onupgradeneeded = () => {
      const d = rq.result;
      if (!d.objectStoreNames.contains(STORE)) {
        d.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}

/** Store an audio blob for upload. Returns the local id. */
export async function uploadEnqueue(blob, meta) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, "readwrite");
    const rq = tx.objectStore(STORE).add({
      blob, meta: meta || {}, tries: 0, dead: false, at: nowIso(),
    });
    rq.onsuccess = () => { resolve(rq.result); flushUploads(); };
    rq.onerror = () => reject(rq.error);
  });
}

async function allUploads() {
  const d = await db();
  return new Promise((resolve, reject) => {
    const rq = d.transaction(STORE, "readonly").objectStore(STORE).getAll();
    rq.onsuccess = () => resolve(rq.result || []);
    rq.onerror = () => reject(rq.error);
  });
}
async function putUpload(rec) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const rq = d.transaction(STORE, "readwrite").objectStore(STORE).put(rec);
    rq.onsuccess = () => resolve();
    rq.onerror = () => reject(rq.error);
  });
}
async function delUpload(id) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const rq = d.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
    rq.onsuccess = () => resolve();
    rq.onerror = () => reject(rq.error);
  });
}

let pumping = false;
const MAX_TRIES = 6;

export async function flushUploads() {
  if (pumping || !navigator.onLine || !key()) return;
  pumping = true;
  try {
    const rows = (await allUploads()).filter((r) => !r.dead);
    for (const r of rows) {
      const fd = new FormData();
      fd.append("audio", r.blob, "read.webm");
      fd.append("meta", JSON.stringify(r.meta || {}));
      let ok = false;
      try {
        const res = await fetch(WORKER + "/audio", {
          method: "POST", headers: { "x-oberth-key": key() }, body: fd,
        });
        ok = res.ok;
        if (!ok && res.status >= 400 && res.status < 500 && res.status !== 401) {
          // permanently rejected: mark dead so it stops eating the pump, but
          // keep the bytes so the audio is recoverable
          r.dead = true; r.why = "HTTP " + res.status;
          await putUpload(r);
          syncStamp("a recording was rejected, kept on this phone");
          continue;
        }
      } catch (e) { ok = false; }

      if (ok) { await delUpload(r.id); continue; }

      r.tries = (r.tries || 0) + 1;
      if (r.tries >= MAX_TRIES) { r.dead = true; r.why = "gave up after " + MAX_TRIES; }
      await putUpload(r);
      break; // one at a time; back off and let the next event retry
    }
    const left = (await allUploads()).filter((r) => !r.dead).length;
    const dead = (await allUploads()).filter((r) => r.dead).length;
    if (dead) syncStamp(dead + " recording(s) not sent");
    else if (left) syncStamp(left + " recording(s) uploading");
  } catch (e) { /* IDB unavailable: the JSON pipe still works */ }
  pumping = false;
}

/** How many audio blobs are still on this phone, live and dead. */
export async function uploadStatus() {
  try {
    const rows = await allUploads();
    return { live: rows.filter((r) => !r.dead).length, dead: rows.filter((r) => r.dead).length };
  } catch (e) { return { live: 0, dead: 0 }; }
}

window.addEventListener("online", () => { flush(); flushUploads(); });
window.addEventListener("focus", () => { flush(); flushUploads(); });
