// notes.js: the read side of the notebook, and the place he can ask something.
//
// WHY IT DID NOT EXIST UNTIL 2026-09-13. Tonight is a WRITE surface. It shows
// today's log as one line per entry ("read aloud, 94s, transcribing") and
// nothing more, because it was built around the act of reading the books, not
// around the pile that act produces. So for three weeks everything he said
// went in and nothing came back out on the phone. The transcripts existed, on
// the Worker, readable only by a laptop session running oberth_reflect.py.
//
// That is the exact failure the suggest button had, written down at the time
// and then repeated here: "the suggest button worked into a void for nine days
// because nothing ever read the other end."
//
// His words: "I want you to maybe add an actual note section to oberth."
//
// SECOND HALF, the asking. "I know we used to have something that was like
// 'ask me anything' and now that doesn't seem to exist so we could fix that."
// It never existed, and it is worth being exact about what did, because the
// difference is the whole design. Study's Questions panel is a MINING output:
// the Worker reads a transcript and pulls out lines that sound like questions.
// That is useful and it stays, but it is passive and it cannot be aimed. There
// has never been a box he could put a question INTO. Now there is, at the top
// of this tab, and it takes voice as well as typing because most of these get
// asked walking.
//
// A question he asks is filed OPEN and is never auto-answered here. The Worker
// refuses an answer from the phone by design: an answer he will study from
// gets researched with sources by a session, not guessed on a bus. So the loop
// is ask here, answer on the laptop, read the answer on Study.

import { el, esc, mast, zone, empty, footer, api, todayIso, shiftIso, fmtDay, hhmm, lsGet, lsSet, K } from "../../core.js";
import { queueAsk, queueJunk, syncStamp, uploadEnqueue } from "../../sync.js";
import { keepAwake } from "../lib/awake.js";
import { openMic, describeStream } from "../mic.js";

// How far back the tab reaches on open. Deliberately more than Tonight's one
// day and less than everything: the point is "what have I been saying lately",
// and a wall of six weeks is the same as no wall at all.
const WINDOW = 10;
const MORE = 21;
const CACHE = K("notes.cache");

const TAGS = {
  lecture:  { name: "LECTURE",  v: "--tel" },
  updates:  { name: "UPDATES",  v: "--burn" },
  thinking: { name: "THINKING", v: "--think" },
};

export function open(parts) {
  const wrap = document.createElement("div");
  const cached = lsGet(CACHE, []);

  wrap.appendChild(mast("Notes", "everything you have read into this app", "kept", String(cached.length)));

  wrap.appendChild(zone("ask something"));
  wrap.appendChild(askPanel());

  wrap.appendChild(zone("what you said"));
  const box = el("div", { id: "noteslist" });
  paint(box, cached, true);
  wrap.appendChild(box);

  const more = el("button", { type: "button", class: "savebtn", id: "notesmore" }, "Load three weeks");
  more.style.marginTop = "12px";
  more.addEventListener("click", () => { more.disabled = true; load(MORE, more); });
  wrap.appendChild(more);

  wrap.appendChild(footer());
  document.getElementById("root").appendChild(wrap);

  load(WINDOW, null);
}

// ------------------------------------------------------------------ load ----
// One request per day, because that is the shape of the Worker's /note route
// (`notes:<date>` is the KV key). Ten of them is fine over a warm connection
// and every one that fails is simply skipped: a day the network lost must not
// blank the days it did not.
async function load(days, btn) {
  const today = todayIso();
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = i === 0 ? today : shiftIso(-i);
    try {
      const r = await api("/note?date=" + encodeURIComponent(d));
      (r && r.notes ? r.notes : []).forEach((n) => {
        if (String(n.text || "").trim()) out.push(Object.assign({ date: d }, n));
      });
    } catch (e) { /* skip the day, keep the rest */ }
  }
  out.sort((a, b) => String(b.at || b.date).localeCompare(String(a.at || a.date)));
  lsSet(CACHE, out.slice(0, 300));
  const box = document.getElementById("noteslist");
  if (box) paint(box, out, false);
  const alt = document.querySelector(".mast .alt b");
  if (alt) alt.textContent = String(out.length);
  if (btn) { btn.disabled = false; btn.textContent = "Load three weeks"; }
}

function paint(box, rows, stale) {
  box.innerHTML = "";
  if (!rows.length) {
    box.appendChild(empty("00:00", "Nothing here yet",
      "Read a notebook aloud on Tonight and it will appear here, transcribed, the moment it comes back."));
    return;
  }
  // Flagged notes are hidden, not gone. The count is shown so the page never
  // quietly omits something: a list that hides things without saying so is the
  // same lie as a tool that repairs ninety percent in silence.
  const hidden = rows.filter((n) => n.junk).length;
  if (hidden) {
    const note = el("div", { class: "lhint" },
      esc(hidden + " note" + (hidden === 1 ? "" : "s") + " marked not mine, hidden"));
    note.style.margin = "0 0 10px";
    box.appendChild(note);
  }

  let lastDay = "";
  rows.filter((n) => !n.junk).forEach((n) => {
    if (n.date !== lastDay) {
      lastDay = n.date;
      box.appendChild(zone(fmtDay(n.date)));
    }
    box.appendChild(noteCard(n));
  });
  if (stale) syncStamp("showing the last copy, refreshing");
}

function noteCard(n) {
  const card = el("div", { class: "panel" });
  card.style.marginBottom = "10px";

  const head = el("div", { class: "lh" });
  const t = TAGS[n.book] || { name: String(n.book || "NOTE").toUpperCase(), v: "--burn" };
  const tag = el("span", { class: "lname" }, esc(t.name));
  tag.style.color = "var(" + t.v + ")";
  head.appendChild(tag);

  // The capture conditions, when the recording carried them. This is the line
  // that turns "why was that transcript bad" from an argument into a lookup.
  const bits = [];
  if (n.at) bits.push(hhmm(n.at));
  if (n.kind === "audio" && n.seconds) bits.push(n.seconds + "s");
  if (n.course) bits.push(n.course);
  if (n.mic) bits.push(n.mic + (n.hz ? " " + Math.round(n.hz / 100) / 10 + "kHz" : ""));
  if (n.interrupted) bits.push("cut short");
  head.appendChild(el("span", { class: "lhint" }, esc(bits.join(" · "))));
  card.appendChild(head);

  // Transcribed text is arbitrary dictated content and never goes through
  // innerHTML. Same rule as Tonight's log.
  const body = document.createElement("p");
  body.textContent = String(n.text || "");
  body.style.margin = "8px 0 0";
  body.style.whiteSpace = "pre-wrap";
  card.appendChild(body);

  // A low-quality capture is flagged where the bad transcript is, not in a
  // settings screen he will never open.
  if (n.micLevel === "bluetooth" || n.micLevel === "voice") {
    const w = el("div", { class: "lhint" },
      esc("Recorded over the Bluetooth call path, so the words above are working from about a third of the detail. "
        + "Take the earbuds out before reading a notebook."));
    w.style.marginTop = "8px";
    w.style.color = "var(--burn)";
    card.appendChild(w);
  }
  // The tidy control. One tap, after the fact, reversible: the only write
  // modality with a non-zero rate in his whole portfolio.
  const bar = el("div", { class: "recbar" });
  const junk = el("button", { type: "button", class: "savebtn" }, "Not mine");
  junk.style.fontSize = ".72rem";
  junk.addEventListener("click", () => {
    queueJunk(n.date, n.at, true);
    n.junk = true;
    card.style.display = "none";
    syncStamp("1 note marked not mine");
  });
  bar.appendChild(junk);
  card.appendChild(bar);

  return card;
}

// ------------------------------------------------------------------- ask ----
function askPanel() {
  const box = el("div", { class: "panel" });

  const ta = document.createElement("textarea");
  ta.placeholder = "Ask anything: a thing you did not follow in lecture, a word you did not know, something you want looked up properly.";
  ta.setAttribute("aria-label", "Ask a question");
  ta.addEventListener("input", () => {
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
    send.disabled = !ta.value.trim();
  });
  box.appendChild(ta);

  const bar = el("div", { class: "recbar" });
  const rec = el("button", { type: "button", class: "recbtn", "data-on": "0" });
  rec.appendChild(el("span", { class: "dot" }));
  const rlbl = el("span", null, "Say it");
  rec.appendChild(rlbl);
  const elapsed = el("span", { class: "el" }, "");
  rec.appendChild(elapsed);
  const send = el("button", { type: "button", class: "savebtn" }, "Ask");
  send.disabled = true;
  bar.appendChild(rec); bar.appendChild(send);
  box.appendChild(bar);

  const note = el("div", { class: "lhint" }, "");
  note.style.marginTop = "8px";
  box.appendChild(note);

  send.addEventListener("click", () => {
    const q = ta.value.trim();
    if (!q) return;
    const ok = queueAsk(q, "asked on the Notes tab");
    ta.value = "";
    ta.style.height = "auto";
    send.disabled = true;
    note.textContent = ok
      ? "Asked. It is filed open, and it gets answered with sources rather than guessed at. The answer appears on Study."
      : "Saved on this phone only; it will send when there is signal.";
  });

  // Speaking a question goes down the SAME audio path as a notebook, into the
  // thinking book, because a spoken question is a thought and the mining pass
  // already pulls questions out of thinking transcripts. Typing it is the
  // precise route; speaking it is the one he will actually use while walking.
  wireRecorder(rec, rlbl, elapsed, note);

  return box;
}

// A second, smaller copy of Tonight's recorder. Kept separate rather than
// shared because the two differ in destination and in what they say afterwards,
// and a shared one would grow flags until neither was readable. If a third
// appears, that is the moment to extract it, not before.
function wireRecorder(rec, lbl, elapsed, note) {
  let mr = null, chunks = [], t0 = 0, timer = null, release = null, mic = null, interrupted = false;
  const stopHold = () => { if (release) { try { release(); } catch (e) {} release = null; } };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && mr && mr.state === "recording") {
      interrupted = true;
      try { mr.stop(); } catch (e) {}
    }
  });

  rec.addEventListener("click", async () => {
    if (mr && mr.state === "recording") { mr.stop(); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      note.textContent = "This phone will not record here. Type the question instead.";
      return;
    }
    try {
      const stream = await openMic(navigator.mediaDevices);
      mic = describeStream(stream);
      chunks = []; interrupted = false;
      try { mr = new MediaRecorder(stream, { audioBitsPerSecond: 128000 }); }
      catch (e) { mr = new MediaRecorder(stream); }
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = async () => {
        clearInterval(timer);
        stopHold();
        stream.getTracks().forEach((t) => t.stop());
        rec.setAttribute("data-on", "0");
        lbl.textContent = "Say it";
        elapsed.textContent = "";
        const secs = Math.round((Date.now() - t0) / 1000);
        if (!chunks.length) { note.textContent = "Nothing was captured."; return; }
        const blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
        try {
          await uploadEnqueue(blob, {
            book: "thinking", date: todayIso(), seconds: secs,
            mic: mic ? mic.label : null, hz: mic ? mic.hz : null,
            micLevel: mic ? mic.level : null, mime: mr.mimeType || null,
            interrupted: interrupted || undefined,
          });
          note.textContent = (interrupted ? "Your phone locked, so this was saved at " + secs + "s and sent. "
                                          : "Sent (" + secs + "s). ")
            + "Anything in it that sounds like a question gets pulled out and filed.";
        } catch (e) {
          note.textContent = "Could not store the recording on this phone.";
        }
      };
      mr.start(5000);
      t0 = Date.now();
      rec.setAttribute("data-on", "1");
      lbl.textContent = "Stop";
      let holdNote = "";
      const paint = () => {
        note.textContent = "Recording, screen held."
          + (mic ? " " + mic.short + "." : "") + holdNote
          + (mic && mic.warn ? "\n\n" + mic.warn : "");
      };
      release = keepAwake((st) => { holdNote = st.held ? "" : " " + st.reason; paint(); });
      timer = setInterval(() => {
        const s = Math.round((Date.now() - t0) / 1000);
        elapsed.textContent = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
      }, 250);
      paint();
    } catch (e) {
      stopHold();
      note.textContent = "Microphone permission was refused.";
    }
  });
}
