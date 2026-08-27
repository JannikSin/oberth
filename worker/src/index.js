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

// Course jargon whisper would otherwise mangle. This is the vocab.txt idea,
// moved server-side where the transcription actually happens.
// Terms added 2026-08-26 after reading David's first real notes back. The
// misses were specific and they will recur every week, so they are worth the
// prompt budget: "Vanderpool" for Van der Pol, "Mankowski" for Minkowski,
// "Bonneville" for Bonmot, "4.11" for PHYS 411.
const VOCAB = [
  "PHYS 310", "PHYS 306", "PHYS 411", "ME 274", "ME 264", "ME 290", "MFET 163", "EPICS",
  "Lagrangian", "Hamiltonian", "Coriolis", "periapsis", "phase space",
  "configuration space", "state space", "Van der Pol oscillator",
  "Minkowski space", "metric tensor", "Einstein summation",
  "contravariant", "covariant", "superscript", "subscript", "tensor",
  "simple harmonic oscillator", "nonlinear dynamics", "helix",
  "Teamcenter", "Siemens NX", "Gradescope", "Brightspace", "Bonmot", "Oberth",
  "metrology", "micrometer", "profilometer", "CNC", "lathe", "sheet metal",
  "Nolte", "Giannios", "Gibert", "Krousgrill", "Ghoshal", "Fuerst", "Beth Hess",
  "kinematics", "kinetics", "impulse", "momentum", "residue theorem",
  "chain rule", "trig identities", "continuous function", "inverse",
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

const PHONE_POST = ["/note", "/audio", "/grade", "/tick", "/nudge"];
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
async function transcribe(env, blob, filename) {
  if (!env.GROQ_API_KEY) return { ok: false, why: "no GROQ_API_KEY set on the Worker" };
  const fd = new FormData();
  fd.append("file", blob, filename || "read.webm");
  fd.append("model", "whisper-large-v3-turbo");
  fd.append("response_format", "verbose_json");
  fd.append("prompt", VOCAB);
  fd.append("temperature", "0");

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

  // Prompt echo: given non-speech, the model will sometimes hand the
  // vocabulary list straight back. Storing that as a night's lecture notes
  // would be worse than storing nothing.
  const vocabWords = new Set(VOCAB.toLowerCase().split(/[,\s]+/).filter((w) => w.length > 3));
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
        });
        return json(200, { ok: false, why: t.why, blobId });
      }

      const n = await appendNote(env, date, {
        book, kind: "audio", text: t.text, at: new Date().toISOString(),
        seconds: meta.seconds || null, duration: t.duration, blobId,
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
      if (who !== "laptop") return json(403, { error: "laptop only" });
      const b = (await readJson(request)) || {};
      const store = await getJson(env, "questions", []);
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
        b.add.forEach((a) => store.push({
          id: "q" + Date.now() + Math.random().toString(36).slice(2, 6),
          q: clip(a.q, 400), why: clip(a.why, 400),
          date: safeDate(a.date), book: clip(a.book, 20) || "lecture",
          askedAt: new Date().toISOString(),
          status: a.answer ? "answered" : "open",
          answer: a.answer ? clip(a.answer, 6000) : null,
          sources: Array.isArray(a.sources) ? a.sources.slice(0, 8).map((u) => clip(u, 300)) : null,
          answeredAt: a.answer ? new Date().toISOString() : null,
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
