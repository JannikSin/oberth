// Oberth Worker: the private relay between David's phone, his laptop, and Groq.
//
// The public Pages app is an empty shell. Everything it renders lives here in
// KV behind one secret key.
//
//   POST /note            phone saves a notebook transcription  {book,text,...}
//   GET  /note?date=      the day's notes (both books)
//   POST /audio           phone uploads a read-aloud recording (multipart),
//                         it is transcribed by Groq and stored as a note
//   POST /grade           phone pushes one FSRS grade
//   GET  /grade           all card progress
//   POST /tick            phone spends a drop / records a miss / ticks an item
//   GET  /tick            the ledger
//   POST /nudge           an improvement note from the FIX NOTE key
//   GET  /nudge           laptop drains them
//   DELETE /nudge?id=     laptop consumes one after filing it
//   GET  /questions       open + answered questions mined from the notes
//   POST /questions       laptop writes answers back (or adds a question)
//   POST /career          laptop pushes the career manifest
//   GET  /career          the manifest
//   GET  /health          liveness, no auth, no data
//
// ============================================================================
// THE NEVER-4XX RULE.
//
// /note, /audio and /nudge MUST NOT return any 4xx except 401.
//
// The client drops a queue head it cannot retry, and although Oberth's sync.js
// dead-letters instead of destroying (unlike Crystal's, which reports "synced"
// after discarding), a rejected lecture transcription is still the worst thing
// this system can do. The paper notebook was read aloud ONCE. He will not do it
// twice. So these routes accept anything shaped remotely right, clamp it, and
// store it. Validation failures are recorded in the stored record as a `warn`
// field, never as a refusal.
// ============================================================================
//
// Auth: x-oberth-key header only, never a query param. Two roles.
//   OBERTH_KEY  laptop. Everything, including draining /nudge and pushing career.
//   PHONE_KEY   phone. GET what it renders, POST only what the user taps.
// Both accept a comma-separated rotation set (OBERTH_KEYS / PHONE_KEYS) so a
// key can be swapped without a window of 401s.

const ORIGIN = "https://janniksin.github.io";
const CORS = {
  "access-control-allow-origin": ORIGIN,
  "access-control-allow-headers": "content-type, x-oberth-key",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  vary: "origin",
};
const NOSNIFF = "x-content-type-options";

const MAX_BODY = 512 * 1024;
const AUDIO_CAP = 12 * 1024 * 1024;   // ~20 min of opus; a long read-aloud
const AUDIO_TTL = 7 * 24 * 3600;      // keep the bytes a week in case transcription was wrong
const NUDGE_TTL = 60 * 24 * 3600;     // backstop if the laptop never drains

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9._@:-]{1,120}$/;
// "thinking" added 2026-08-26: him talking about how a course is actually
// going, which is neither lecture content nor a deliverable. It is stored
// like the others and mined for questions like the others, but nothing
// downstream turns it into a card or a due date.
const BOOKS = ["lecture", "updates", "thinking"];

// Course jargon whisper would otherwise mangle, passed as the `prompt`.
//
// THE REAL LIST LIVES IN KV, NOT HERE. Moved 2026-09-14 (zephyr) for exactly
// the reason `data/courses.json` was moved in commit 8d1f09c: this repo is
// PUBLIC, and the list had grown to carry his course codes, six professor
// surnames, his research lab, his clubs and an employer he is applying to.
// Between them those describe his timetable and his intentions under his real
// name. Same doctrine as the rulebook: the Pages app is an empty shell and
// every byte of personal content sits behind the key.
//
// What is left below is a FLOOR, not the list: generic engineering and
// dynamics vocabulary that identifies nobody, used only when KV has no
// `vocab` key. Push the real one with `node tools/push-vocab.mjs`.
//
// BUDGET: whisper caps the prompt at 224 tokens and OVERFLOW IS SILENT, it
// drops the TAIL. Adding a term means removing one. tests/mic.test.mjs fails
// past 200.
const VOCAB_FLOOR = [
  "Gradescope", "Brightspace", "Lagrangian", "Hamiltonian",
  "Coriolis", "periapsis", "configuration space", "state space",
  "metric tensor", "Einstein summation", "contravariant", "covariant",
  "nonlinear dynamics", "OpenFOAM", "ANSYS", "Siemens NX",
  "Teamcenter",
].join(", ");

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", [NOSNIFF]: "nosniff", ...CORS },
  });
}

function keySet(env, ...names) {
  const out = [];
  for (const n of names) {
    for (const part of String(env[n] || "").split(",")) {
      const k = part.trim();
      if (k) out.push(k);
    }
  }
  return out;
}

// Constant-time-ish compare. Length short-circuits; key length is not the
// secret, the bytes are.
function sameKey(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function role(request, env) {
  const k = request.headers.get("x-oberth-key") || "";
  if (!k) return null;
  for (const b of keySet(env, "OBERTH_KEY", "OBERTH_KEYS")) if (sameKey(k, b)) return "laptop";
  for (const p of keySet(env, "PHONE_KEY", "PHONE_KEYS")) if (sameKey(k, p)) return "phone";
  return null;
}

// /questions is on this list as of 2026-09-13 so the phone can ASK. The route
// itself still refuses a phone-supplied ANSWER, which is the half that matters:
// an answer he will study from gets researched with sources on the laptop, not
// typed on a bus. Asking and answering are different privileges and the split
// is enforced inside the handler, not here.
const PHONE_POST = ["/note", "/audio", "/grade", "/tick", "/nudge", "/questions", "/junk"];
const PHONE_GET = ["/note", "/grade", "/tick", "/career", "/courses", "/questions"];
function phoneAllowed(method, path) {
  if (method === "GET") return PHONE_GET.includes(path);
  if (method === "POST") return PHONE_POST.includes(path);
  return false;                       // the phone never deletes
}

const clip = (v, n) => String(v == null ? "" : v).slice(0, n);
const todayIso = () => new Date().toISOString().slice(0, 10);
const safeDate = (d) => (DATE_RE.test(String(d || "")) ? d : todayIso());

async function readJson(request) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > MAX_BODY) return null;
  try { return await request.json(); } catch (e) { return null; }
}

// ---------------------------------------------------------------- Groq ------
// whisper-large-v3-turbo. Free tier, daily reset, and the key already exists.
//
// THE PROMPT ECHO HAZARD, found while testing this: whisper is a generative
// model, and given audio with no speech in it, it will happily emit the
// vocabulary prompt back as the transcript. A silent recording would come back
// reading "PHYS 310, Lagrangian, Coriolis, Teamcenter..." and be stored as that
// night's lecture notes. So: check no_speech_prob, and reject any result that
// is mostly just the prompt echoed.
// The vocabulary, from KV, with the public floor as the fallback. Cached per
// isolate: a KV read per transcription is wasteful and the list changes rarely.
let VOCAB_CACHE = null;
async function vocab(env) {
  if (VOCAB_CACHE) return VOCAB_CACHE;
  const v = await getJson(env, "vocab", null);
  const list = v && Array.isArray(v.terms) && v.terms.length ? v.terms : null;
  VOCAB_CACHE = list ? list.join(", ") : VOCAB_FLOOR;
  return VOCAB_CACHE;
}

async function transcribe(env, blob, filename) {
  if (!env.GROQ_API_KEY) return { ok: false, why: "no GROQ_API_KEY set on the Worker" };
  const fd = new FormData();
  fd.append("file", blob, filename || "read.webm");
  fd.append("model", "whisper-large-v3-turbo");
  fd.append("response_format", "verbose_json");
  fd.append("prompt", await vocab(env));
  fd.append("temperature", "0");
  // Pin the language. Without it whisper spends capacity deciding what
  // language this is, and a low-quality capture is exactly when it decides
  // wrong. The 2026-09-13 note that came back as an Australian promo URL is
  // the signature of that: an English speaker, a degraded mic, and a model
  // free to reach for any language's caption-farm boilerplate.
  fd.append("language", "en");

  let res;
  try {
    res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: "Bearer " + env.GROQ_API_KEY },
      body: fd,
    });
  } catch (e) {
    return { ok: false, why: "groq unreachable" };
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return { ok: false, why: "groq " + res.status + " " + clip(t, 160) };
  }
  const out = await res.json().catch(() => null);
  if (!out) return { ok: false, why: "groq returned nothing parseable" };

  const text = String(out.text || "").trim();
  const segs = Array.isArray(out.segments) ? out.segments : [];
  const dur = Number(out.duration || 0);
  if (!text) return { ok: false, why: "no speech found", duration: dur };

  // ---- the hallucination gate -------------------------------------------
  // MEASURED, not guessed. Against three seconds of PURE DIGITAL SILENCE,
  // whisper-large-v3-turbo returned no_speech_prob = 0.0000 and the text
  // " www.patreon.com". On another run it returned "Thank you". So
  // no_speech_prob is worthless here and was removed as a signal.
  //
  // What actually separates them:
  //   avg_logprob   real speech measured -0.36; silence measured -0.81
  //   words/second  real speech ~2 to 3; silence produced 0.33
  // Plus the well-documented set of phrases whisper emits over silence,
  // which come from its YouTube-caption training data.
  const avgLogprob = segs.length
    ? segs.reduce((s, x) => s + (x.avg_logprob ?? 0), 0) / segs.length
    : 0;
  const allWords = text.toLowerCase().split(/[^a-z0-9.']+/).filter(Boolean);
  const wps = dur > 0 ? allWords.length / dur : 0;

  const JUNK = [
    "thank you", "thanks for watching", "thank you for watching", "please subscribe",
    "subscribe", "www.patreon.com", "patreon.com", "subtitles by", "amara.org",
    "you", "bye", "bye.", "the end", "outro", "music", "applause",
  ];
  const flat = text.toLowerCase().replace(/[^a-z. ]/g, "").trim();
  if (JUNK.includes(flat)) {
    return { ok: false, why: "no speech in that recording", duration: dur, signal: "junk phrase" };
  }
  if (dur >= 2 && wps < 0.5) {
    return { ok: false, why: "no speech in that recording", duration: dur, signal: "words/sec " + wps.toFixed(2) };
  }
  if (allWords.length < 15 && avgLogprob < -0.7) {
    return { ok: false, why: "that recording was too unclear to keep", duration: dur, signal: "avg_logprob " + avgLogprob.toFixed(2) };
  }

  // Caption-farm promos. These are the SAME failure as "Thank you", from the
  // same YouTube training data, but neither length nor confidence catches
  // them. MEASURED 2026-09-13 (zephyr), from a note that was actually STORED:
  // a stray recording in the UPDATES lane came back as
  //   "For more information, visit www.feyyout.com.au"
  // and it survived every gate above. Seven words, so the < 15 rule applied,
  // but avg_logprob was healthy (the model is confident when it recites its
  // own training data), and words/second cleared 0.5. It then sat in his
  // notebook between two real notes, which is exactly the thing this gate
  // exists to prevent: a night's notes he cannot trust is worse than none.
  //
  // What separates it is SHAPE, not quality. A short transcript that is a
  // promo stem, or that is mostly a web address, is never something he said
  // into this app. Rejection is not destructive: the blob is kept, the failed
  // note is filed with its reason, and the phone is told why.
  const PROMO = /(for more information|more info(rmation)?,? visit|visit (our |the )?(website|www)|thanks? for watching|please subscribe|subscribe to (our|the)|subtitles? (by|provided)|captions? by|transcription by|translated by|amara\.org|patreon|all rights reserved|copyright ©)/;
  const DOMAINISH = /\b(?:www\.[a-z0-9-]{2,}|[a-z0-9-]{3,}\.(?:com|org|net|io|tv|me|co))\b/;
  const lower = text.toLowerCase();
  if (allWords.length < 15 && PROMO.test(lower)) {
    return { ok: false, why: "no speech in that recording", duration: dur, signal: "caption-farm promo" };
  }
  if (allWords.length < 12 && DOMAINISH.test(lower)) {
    return { ok: false, why: "no speech in that recording", duration: dur, signal: "caption-farm url" };
  }

  // Prompt echo: given non-speech, the model will sometimes hand the
  // vocabulary list straight back. Storing that as a night's lecture notes
  // would be worse than storing nothing.
  const vocabWords = new Set((await vocab(env)).toLowerCase().split(/[,\s]+/).filter((w) => w.length > 3));
  const words = allWords.filter((w) => w.length > 3);
  const echoed = words.length ? words.filter((w) => vocabWords.has(w)).length / words.length : 0;
  if (words.length < 40 && echoed > 0.5) {
    return { ok: false, why: "no speech in that recording (the model echoed its own vocabulary)", duration: dur, signal: "echo " + echoed.toFixed(2) };
  }

  return { ok: true, text, duration: dur, language: out.language, avgLogprob };
}

// ------------------------------------------------------- question mining ----
// David narrates questions while reading his notes back: "What is a Vanderpool
// oscillator? I don't know." "physics 4.11, I want to look into that." Those
// are the highest-value lines in a transcript and they were vanishing into a
// wall of text.
//
// This pulls them out at transcription time and files them OPEN. It does NOT
// answer them. A wrong physics answer he studies from is the same hazard as a
// fabricated flashcard: answering is done deliberately, with sources, and the
// answer is written back through POST /questions.
async function mineQuestions(env, text, meta) {
  if (!env.GROQ_API_KEY || !text || text.length < 40) return [];
  const sys = "Extract only genuine open questions the speaker wants answered later: things they said they do not know, want to look up, or need to find out. Ignore rhetorical questions, self-answered questions, and course logistics they already stated. Return STRICT JSON: an array of objects {\"q\": \"the question, rewritten as a clear standalone question\", \"why\": \"a short quote from the text that shows they asked it\"}. Return [] if there are none. No prose, no markdown fences.";
  let res;
  try {
    res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer " + env.GROQ_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0,
        max_tokens: 700,
        messages: [{ role: "system", content: sys }, { role: "user", content: text.slice(0, 12000) }],
      }),
    });
  } catch (e) { return []; }
  if (!res.ok) return [];
  const out = await res.json().catch(() => null);
  const raw = out && out.choices && out.choices[0] && out.choices[0].message
    ? String(out.choices[0].message.content || "") : "";
  let arr;
  try {
    arr = JSON.parse(raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
  } catch (e) { return []; }
  if (!Array.isArray(arr)) return [];

  const store = await getJson(env, "questions", []);
  const seen = new Set(store.map((x) => String(x.q || "").toLowerCase().trim()));
  const added = [];
  for (const it of arr.slice(0, 12)) {
    const q = clip(it && it.q, 400).trim();
    if (!q || seen.has(q.toLowerCase())) continue;
    seen.add(q.toLowerCase());
    const rec = {
      id: "q" + Date.now() + Math.random().toString(36).slice(2, 6),
      q, why: clip(it && it.why, 400),
      date: meta.date, book: meta.book,
      askedAt: new Date().toISOString(),
      status: "open", answer: null, sources: null, answeredAt: null,
    };
    store.push(rec);
    added.push(rec);
  }
  if (added.length) await env.STORE.put("questions", JSON.stringify(store));
  return added;
}

// ------------------------------------------------------------ KV helpers ----
async function getJson(env, key, fallback) {
  try {
    const v = await env.STORE.get(key);
    return v ? JSON.parse(v) : fallback;
  } catch (e) { return fallback; }
}

async function appendNote(env, date, record) {
  const key = "notes:" + date;
  const rows = await getJson(env, key, []);

  // Double-submit guard.
  //
  // FIRST DIAGNOSIS, 2026-09-13, and it was HALF RIGHT: the UPDATES lane held
  // "Okay. There's a lot of things to do..." twice, 39 seconds apart, byte for
  // byte, which reads as one tap that looked like it did nothing, tapped again.
  // The guard written that day was time-boxed to five minutes so a genuinely
  // repeated thought later in the day would still land.
  //
  // CORRECTED 2026-09-14, by the same note appearing a THIRD time at 21:09,
  // five hours after the first two and therefore outside that window. Three
  // notes arrived within five SECONDS of each other at 21:09, which is the
  // offline upload queue flushing a backlog, not a person talking. So the
  // duplicate was never a double tap at all: it is the upload retrying, and
  // `at` on an audio note is stamped by this Worker at UPLOAD time rather than
  // at recording time, so a time window compares the wrong two clocks.
  //
  // THE RULE THAT ACTUALLY HOLDS: two separate recordings of a human being
  // talking do not transcribe to byte-identical text. Whisper is not that
  // repeatable and he does not speak that repeatably. So for an AUDIO note,
  // identical text on the same day is a re-delivery however far apart the
  // timestamps are, and the window is dropped entirely.
  //
  // Typed notes keep a window, because a person really can type the same short
  // line twice on purpose, and typing carries no transcription noise to tell
  // one from the other.
  //
  // Nothing is destroyed either way: the audio blob is stored before this runs.
  const text = String(record.text || "").trim();
  if (text) {
    const now = Date.parse(record.at || "") || Date.now();
    const isAudio = record.kind === "audio";
    const dupe = rows.some((r) => {
      if (r.book !== record.book) return false;
      if (String(r.text || "").trim() !== text) return false;
      if (isAudio && r.kind === "audio") return true;   // same KV day key
      return Math.abs((Date.parse(r.at || "") || 0) - now) < 5 * 60 * 1000;
    });
    if (dupe) return rows.length;
  }

  rows.push(record);
  await env.STORE.put(key, JSON.stringify(rows));
  return rows.length;
}

// ------------------------------------------------------------------ router --
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method;

    if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    // Liveness carries no data and needs no key, so a phone with a bad key can
    // still tell "the server is down" from "my key is wrong".
    if (path === "/health") {
      return json(200, { ok: true, app: "oberth", at: new Date().toISOString(), groq: !!env.GROQ_API_KEY });
    }

    const who = role(request, env);
    if (!who) return json(401, { error: "bad key" });
    if (who === "phone" && !phoneAllowed(method, path)) return json(403, { error: "not allowed from the phone" });

    // ---------------------------------------------------------------- /note
    if (path === "/note" && method === "POST") {
      const b = (await readJson(request)) || {};
      const warn = [];
      let book = clip(b.book, 20);
      if (!BOOKS.includes(book)) { warn.push("unknown book '" + book + "'"); book = "lecture"; }
      const text = clip(b.text, 40000);
      if (!text) warn.push("empty text");
      const date = safeDate(b.date);
      // Never refuse. See THE NEVER-4XX RULE at the top of this file.
      const n = await appendNote(env, date, {
        book, text, course: clip(b.course, 40) || null,
        at: clip(b.at, 30) || new Date().toISOString(),
        kind: "text", warn: warn.length ? warn : undefined,
      });
      const mined = await mineQuestions(env, text, { date, book });
      return json(200, { ok: true, stored: n, questions: mined.length, warn: warn.length ? warn : undefined });
    }

    if (path === "/note" && method === "GET") {
      const date = safeDate(url.searchParams.get("date"));
      return json(200, { date, notes: await getJson(env, "notes:" + date, []) });
    }

    // --------------------------------------------------------------- /audio
    if (path === "/audio" && method === "POST") {
      const len = Number(request.headers.get("content-length") || 0);
      if (len > AUDIO_CAP) {
        // The one place a large body is refused, and the client keeps the bytes.
        return json(200, { ok: false, why: "recording too large (" + Math.round(len / 1048576) + " MB); kept on the phone" });
      }
      let form;
      try { form = await request.formData(); } catch (e) { form = null; }
      if (!form) return json(200, { ok: false, why: "could not read the upload; kept on the phone" });

      const audio = form.get("audio");
      let meta = {};
      try { meta = JSON.parse(form.get("meta") || "{}"); } catch (e) { meta = {}; }
      const date = safeDate(meta.date);
      const book = BOOKS.includes(meta.book) ? meta.book : "lecture";

      if (!audio || typeof audio === "string") {
        return json(200, { ok: false, why: "no audio in the upload; kept on the phone" });
      }

      // READ THE UPLOAD EXACTLY ONCE.
      // The first version called audio.arrayBuffer() to store the blob and then
      // handed the SAME File to the Groq FormData. A consumed stream cannot be
      // re-read, so the first request of a fresh isolate happened to work and
      // every one after it reset the connection (curl reported HTTP 000, which
      // reads as "the server is down" rather than "the route has a bug").
      // Buffer once, then build a fresh Blob for the upstream call.
      const bytes = await audio.arrayBuffer();
      const type = audio.type || "audio/webm";

      // Keep the bytes for a week regardless of what transcription does. If the
      // transcript is wrong or empty, the recording is still recoverable, which
      // is the whole point of not destroying anything.
      const blobId = "audio:" + date + ":" + book + ":" + Date.now();
      try {
        await env.STORE.put(blobId, bytes, { expirationTtl: AUDIO_TTL });
      } catch (e) { /* storage is a nicety here; transcription is the product */ }

      const t = await transcribe(env, new Blob([bytes], { type }), "read." + (type.includes("wav") ? "wav" : "webm"));
      if (!t.ok) {
        await appendNote(env, date, {
          book, kind: "audio", text: "", at: new Date().toISOString(),
          seconds: meta.seconds || null, blobId, failed: t.why,
          mic: clip(meta.mic, 80) || null,
          hz: Number(meta.hz) > 0 ? Number(meta.hz) : null,
          micLevel: clip(meta.micLevel, 16) || null,
          interrupted: meta.interrupted ? true : undefined,
        });
        return json(200, { ok: false, why: t.why, blobId });
      }

      // The capture conditions ride with the note. Without them a bad
      // transcript is an argument; with them it is a lookup. See app/mic.js.
      const n = await appendNote(env, date, {
        book, kind: "audio", text: t.text, at: new Date().toISOString(),
        seconds: meta.seconds || null, duration: t.duration, blobId,
        mic: clip(meta.mic, 80) || null,
        hz: Number(meta.hz) > 0 ? Number(meta.hz) : null,
        micLevel: clip(meta.micLevel, 16) || null,
        mime: clip(meta.mime, 40) || null,
        interrupted: meta.interrupted ? true : undefined,
      });
      const mined = await mineQuestions(env, t.text, { date, book });
      return json(200, { ok: true, text: t.text, duration: t.duration, stored: n, questions: mined.length });
    }

    // --------------------------------------------------------------- /grade
    if (path === "/grade" && method === "POST") {
      const b = (await readJson(request)) || {};
      const id = clip(b.id, 120);
      if (!ID_RE.test(id)) return json(200, { ok: false, why: "bad card id, not stored" });
      const all = await getJson(env, "srs", {});
      all[id] = { progress: b.progress, rating: clip(b.rating, 10), at: clip(b.at, 30) };
      await env.STORE.put("srs", JSON.stringify(all));
      return json(200, { ok: true, cards: Object.keys(all).length });
    }
    if (path === "/grade" && method === "GET") {
      return json(200, { srs: await getJson(env, "srs", {}) });
    }

    // ---------------------------------------------------------------- /tick
    if (path === "/tick" && method === "POST") {
      const b = (await readJson(request)) || {};
      const id = clip(b.id, 120);
      if (!ID_RE.test(id)) return json(200, { ok: false, why: "bad id, not stored" });
      const led = await getJson(env, "ledger", {});
      led[id] = { done: !!b.done, used: b.used ?? null, lane: clip(b.lane, 20) || null, at: clip(b.at, 30) };
      await env.STORE.put("ledger", JSON.stringify(led));
      return json(200, { ok: true });
    }
    if (path === "/tick" && method === "GET") {
      return json(200, { ledger: await getJson(env, "ledger", {}) });
    }

    // --------------------------------------------------------------- /nudge
    // The improvement inbox. One KV key per note so a laptop drain can consume
    // them individually. Never refuses.
    if (path === "/nudge" && method === "POST") {
      const b = (await readJson(request)) || {};
      const text = clip(b.text, 8000);
      const id = "nudge:" + Date.now() + ":" + Math.random().toString(36).slice(2, 8);
      await env.STORE.put(id, JSON.stringify({
        id, text, date: safeDate(b.date), at: clip(b.at, 30) || new Date().toISOString(),
      }), { expirationTtl: NUDGE_TTL });
      return json(200, { ok: true, id });
    }
    if (path === "/nudge" && method === "GET") {
      if (who !== "laptop") return json(403, { error: "laptop only" });
      const list = await env.STORE.list({ prefix: "nudge:" });
      const out = [];
      for (const k of list.keys) {
        const v = await getJson(env, k.name, null);
        if (v) out.push(v);
      }
      out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
      return json(200, { nudges: out });
    }
    if (path === "/nudge" && method === "DELETE") {
      if (who !== "laptop") return json(403, { error: "laptop only" });
      const id = url.searchParams.get("id") || "";
      if (!id.startsWith("nudge:")) return json(400, { error: "bad id" });
      await env.STORE.delete(id);
      return json(200, { ok: true });
    }

    // ------------------------------------------------------------ /questions
    if (path === "/questions" && method === "GET") {
      return json(200, { questions: await getJson(env, "questions", []) });
    }
    // The laptop writes answers back. This is deliberately laptop-only: an
    // answer he will study from gets researched with sources, not guessed.
    if (path === "/questions" && method === "POST") {
      const b = (await readJson(request)) || {};
      const store = await getJson(env, "questions", []);
      // The phone may add a question and nothing else. Answering stays
      // laptop-only for the reason above the route: a studied answer is
      // researched, not guessed, and a phone that could write `answer` would
      // eventually write one.
      if (who !== "laptop" && (Array.isArray(b.answers) || (Array.isArray(b.add) && b.add.some((a) => a && a.answer)))) {
        return json(403, { error: "the phone can ask, not answer" });
      }
      if (Array.isArray(b.answers)) {
        const byId = new Map(store.map((x) => [x.id, x]));
        b.answers.forEach((a) => {
          const rec = byId.get(a.id);
          if (!rec) return;
          rec.answer = clip(a.answer, 6000);
          rec.sources = Array.isArray(a.sources) ? a.sources.slice(0, 8).map((u) => clip(u, 300)) : null;
          rec.status = "answered";
          rec.answeredAt = new Date().toISOString();
        });
      }
      if (Array.isArray(b.add)) {
        const mayAnswer = who === "laptop";
        b.add.forEach((a) => store.push({
          id: "q" + Date.now() + Math.random().toString(36).slice(2, 6),
          q: clip(a.q, 400), why: clip(a.why, 400),
          date: safeDate(a.date), book: clip(a.book, 20) || "lecture",
          askedAt: new Date().toISOString(),
          asked: who === "laptop" ? "session" : "david",
          status: (mayAnswer && a.answer) ? "answered" : "open",
          answer: (mayAnswer && a.answer) ? clip(a.answer, 6000) : null,
          sources: mayAnswer && Array.isArray(a.sources) ? a.sources.slice(0, 8).map((u) => clip(u, 300)) : null,
          answeredAt: (mayAnswer && a.answer) ? new Date().toISOString() : null,
        }));
      }
      await env.STORE.put("questions", JSON.stringify(store));
      return json(200, { ok: true, total: store.length });
    }

    // ------------------------------------------------------------- /courses
    // The syllabus rulebook lives HERE, not in the Pages repo.
    //
    // GitHub Pages will not serve a private repo on David's plan, so the app
    // repo has to be public. His course schedule names the room he is in at
    // every hour of every weekday, under his real name, which is not something
    // to publish to satisfy a hosting constraint. Same doctrine as Crystal:
    // the Pages app is an empty shell and every byte of content is in KV
    // behind the key.
    if (path === "/courses" && method === "POST") {
      if (who !== "laptop") return json(403, { error: "laptop only" });
      const b = (await readJson(request)) || {};
      if (!b || !Array.isArray(b.courses)) return json(400, { error: "courses[] required" });
      await env.STORE.put("courses", JSON.stringify(b));
      return json(200, { ok: true, courses: b.courses.length });
    }
    if (path === "/courses" && method === "GET") {
      const v = await getJson(env, "courses", null);
      if (!v) return json(200, { courses: [], missing: true });
      return json(200, v);
    }

    // ---------------------------------------------------------------- /junk
    // Mark a note as not-his. NOT a delete, and that is the whole design.
    //
    // `phoneAllowed` has said "the phone never deletes" since the first build,
    // and that rule is right: a tap on a phone in a pocket must never be able
    // to destroy a night's lecture notes. But whisper WILL hallucinate again
    // (it stored "For more information, visit <a url>" as a note on
    // 2026-09-13), and leaving junk in the notebook with no way to clear it
    // teaches him not to trust the page.
    //
    // So the phone FLAGS and nothing is destroyed. The note keeps its text and
    // its audio blob, the Notes tab stops showing it, question mining can skip
    // it, and a laptop session can purge or restore later with full context.
    // Reversible from the same button.
    if (path === "/junk" && method === "POST") {
      const b = (await readJson(request)) || {};
      const date = safeDate(b.date);
      const at = clip(b.at, 40);
      const key = "notes:" + date;
      const rows = await getJson(env, key, []);
      let hit = 0;
      rows.forEach((r) => {
        if (String(r.at || '') !== at) return;
        hit++;
        if (b.junk === false) delete r.junk;
        else r.junk = true;
      });
      if (hit) await env.STORE.put(key, JSON.stringify(rows));
      return json(200, { ok: true, marked: hit, junk: b.junk !== false });
    }

    // --------------------------------------------------------------- /vocab
    // Personal content, so it is laptop-only to write and never shipped in
    // the repo. The phone never needs to read it: transcription is server side.
    if (path === "/vocab" && method === "POST") {
      if (who !== "laptop") return json(403, { error: "laptop only" });
      const b = (await readJson(request)) || {};
      if (!b || !Array.isArray(b.terms)) return json(400, { error: "terms[] required" });
      await env.STORE.put("vocab", JSON.stringify({ terms: b.terms.map((t) => clip(t, 60)) }));
      VOCAB_CACHE = null;
      return json(200, { ok: true, terms: b.terms.length });
    }
    if (path === "/vocab" && method === "GET") {
      if (who !== "laptop") return json(403, { error: "laptop only" });
      return json(200, await getJson(env, "vocab", { terms: [] }));
    }

    // -------------------------------------------------------------- /career
    if (path === "/career" && method === "POST") {
      if (who !== "laptop") return json(403, { error: "laptop only" });
      const b = (await readJson(request)) || {};
      if (!b || !Array.isArray(b.items)) return json(400, { error: "items[] required" });
      await env.STORE.put("career", JSON.stringify(b));
      return json(200, { ok: true, items: b.items.length });
    }
    if (path === "/career" && method === "GET") {
      return json(200, await getJson(env, "career", { items: [] }));
    }

    return json(404, { error: "no such route" });
  },
};
