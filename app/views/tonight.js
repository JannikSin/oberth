// tonight.js: the nightly ritual, and the reason this app exists.
//
// David keeps TWO paper notebooks and reads them both at the end of the day:
//   LECTURE  what was taught. Reading it aloud is how he remembers it, so the
//            act is the study, and the transcript is a by-product that feeds
//            study guides and cards.
//   UPDATES  what was announced. Homework, project milestones, things to buy.
//            This is where deliverables come from, which is why he never has
//            to "enter an assignment": he already wrote it down in class.
//   THINKING what he makes of it. Added 2026-08-26, and it is not a notebook:
//            it is him talking. "Oberth is the path here and I can just talk
//            some stuff out through that and see what I want to continue, and
//            from there we go and change things."
//
// Conflating any two of these would lose exactly the distinctions that make the
// whole thing work, so they are three lanes with three colours and three
// destinations. The third one in particular must not be folded into UPDATES:
// "PHYS 306 took four hours and I do not think the reading is doing anything"
// is not a deliverable, and filing it as one turns a thought into a chore.
//
// The write is ONE TAP, RETROACTIVE, and BATCHED, because that is the only
// write modality with a non-zero rate in his entire portfolio: 47 ticks on the
// Crystal brief, all from the phone, all after the fact, against 0 of 228 on a
// control gated behind starting a timer first. Nothing here asks him to start
// a session before the event.

import { el, esc, mast, zone, empty, footer, K, lsGet, lsSet, todayIso, nowIso, hhmm, isTab } from "../../core.js";
import { queueNote, uploadEnqueue, syncStamp, uploadStatus } from "../../sync.js";
import { keepAwake } from "../lib/awake.js";
import { openMic, describeStream } from "../mic.js";

const logKey = (d) => K("log." + d);
const readLog = (d) => lsGet(logKey(d), []);

function appendLog(date, entry) {
  const rows = readLog(date);
  rows.push(entry);
  return lsSet(logKey(date), rows);
}

const BOOKS = [
  { id: "lecture", name: "Lecture notes", cls: "lecture",
    hint: "read it aloud", placeholder: "Read today's lecture pages out loud, or type them here." },
  { id: "updates", name: "Updates notebook", cls: "updates",
    hint: "homework, projects, buys", placeholder: "Read the updates page: what was assigned, moved, or announced." },
  // No paper behind this one, which is the point. It exists because he cannot
  // budget time for courses whose real cost he has not measured, and he would
  // rather talk that out than log a number. Nothing here is graded, scheduled,
  // or turned into a card.
  { id: "thinking", name: "Thinking out loud", cls: "thinking",
    hint: "how it is going, what to keep",
    placeholder: "How did today actually go? What took longer than it should have, what is working, what do you want to keep doing?" },
];

export function open() {
  const date = todayIso();
  const wrap = document.createElement("div");

  const done = readLog(date);
  // "both books" was true when there were two lanes. The third is not a book
  // and is not owed, so the line says what is actually asked for.
  wrap.appendChild(mast("Tonight", "read the books, then say what you make of them",
                        "logged", String(done.length)));

  const lanes = el("div", { class: "lanes" });
  BOOKS.forEach((b) => lanes.appendChild(lane(b, date)));
  wrap.appendChild(lanes);

  wrap.appendChild(zone("tonight's log"));
  wrap.appendChild(logList(date));

  wrap.appendChild(footer());
  document.getElementById("root").appendChild(wrap);
  syncStamp("synced");
  uploadStatus().then((s) => {
    if (s.dead) syncStamp(s.dead + " recording(s) not sent");
    else if (s.live) syncStamp(s.live + " recording(s) uploading");
  });
}

function lane(book, date) {
  const l = el("div", { class: "lane " + book.cls });

  const head = el("div", { class: "lh" });
  head.appendChild(el("span", { class: "lname" }, esc(book.name)));
  head.appendChild(el("span", { class: "lhint" }, esc(book.hint)));
  l.appendChild(head);

  const body = el("div", { class: "lbody" });
  const ta = document.createElement("textarea");
  ta.placeholder = book.placeholder;
  ta.setAttribute("aria-label", book.name);
  body.appendChild(ta);

  // ---- the recording bar ----
  const bar = el("div", { class: "recbar" });
  const rec = el("button", { type: "button", class: "recbtn", "data-on": "0" });
  const dot = el("span", { class: "dot" });
  const lbl = el("span", null, "Read aloud");
  const elapsed = el("span", { class: "el" }, "");
  rec.appendChild(dot); rec.appendChild(lbl); rec.appendChild(elapsed);

  const save = el("button", { type: "button", class: "savebtn" }, "Save");
  save.disabled = true;
  bar.appendChild(rec); bar.appendChild(save);
  body.appendChild(bar);

  const note = el("div", { class: "lhint" }, "");
  note.style.marginTop = "8px";
  body.appendChild(note);

  ta.addEventListener("input", () => { save.disabled = !ta.value.trim(); });

  // MediaRecorder, not the Web Speech API: speech recognition is unreliable in
  // an installed iOS PWA and dies without network. Recording always works, the
  // bytes are kept on the phone until they land, and transcription happens
  // server-side where the vocabulary already lives.
  //
  // THREE THINGS WERE ADDED 2026-09-13 (zephyr) AFTER DAVID LOST A RECORDING:
  // "I had issues where I was talking and my phone turned off and stuff got
  // interrupted and failed and that was very bad."
  //
  //   1. THE SCREEN IS HELD while recording, by the same module Mise uses, so
  //      the phone does not lock under him mid-sentence.
  //   2. THE RECORDING IS SAVED IF IT IS INTERRUPTED ANYWAY. This is the part
  //      that actually answers his complaint, because a wake lock is a request
  //      the OS may refuse and Low Power Mode does refuse it. If the page is
  //      hidden while recording, the recorder is stopped deliberately and what
  //      was captured so far is uploaded. He loses the tail, never the whole
  //      thing, and he is told which happened.
  //   3. IT RECORDS IN CHUNKS. A timeslice means data has already left the
  //      encoder every few seconds, so an abrupt stop has something to save
  //      rather than an empty buffer.
  let mr = null, chunks = [], t0 = 0, timer = null, release = null, mic = null;

  const stopHold = () => { if (release) { try { release(); } catch (e) {} release = null; } };

  // If the phone locks or he switches apps, save rather than lose. Bound once
  // per lane and harmless when nothing is recording.
  const onHidden = () => {
    if (document.visibilityState === "hidden" && mr && mr.state === "recording") {
      interrupted = true;
      try { mr.stop(); } catch (e) {}
    }
  };
  let interrupted = false;
  document.addEventListener("visibilitychange", onHidden);

  rec.addEventListener("click", async () => {
    if (mr && mr.state === "recording") {
      mr.stop();
      return;
    }
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      note.textContent = "This phone will not record here. Type the notes instead.";
      return;
    }
    try {
      const stream = await openMic(navigator.mediaDevices);
      mic = describeStream(stream);
      chunks = [];
      interrupted = false;
      // 128 kbps mono opus is well above what speech needs and still small:
      // a 10-minute read is about 9 MB, inside the Worker's upload cap. The
      // default on some builds is 32 kbps, which is audibly worse.
      let opts = { audioBitsPerSecond: 128000 };
      try { mr = new MediaRecorder(stream, opts); }
      catch (e) { mr = new MediaRecorder(stream); }
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = async () => {
        clearInterval(timer);
        stopHold();
        stream.getTracks().forEach((t) => t.stop());
        rec.setAttribute("data-on", "0");
        lbl.textContent = "Read aloud";
        elapsed.textContent = "";
        const secs = Math.round((Date.now() - t0) / 1000);
        if (!chunks.length) { note.textContent = "Nothing was captured."; return; }
        const blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
        try {
          await uploadEnqueue(blob, {
            book: book.id, date, seconds: secs, at: nowIso(),
            // The capture conditions ride along so a bad transcript can be
            // explained later instead of argued about.
            mic: mic ? mic.label : null,
            hz: mic ? mic.hz : null,
            micLevel: mic ? mic.level : null,
            mime: mr.mimeType || null,
            interrupted: interrupted || undefined,
          });
          // Stopping SENDS. Crystal learned this the hard way: David kept
          // pressing Send afterwards because nothing said so.
          note.textContent = interrupted
            ? "Your phone locked or you left the app, so this was saved at " + secs
              + "s and sent. Nothing before that point was lost."
            : "Sent (" + secs + "s). It transcribes on the server; the text lands here when it returns.";
          appendLog(date, { book: book.id, kind: "audio", seconds: secs, at: nowIso() });
          refreshLog(date);
        } catch (e) {
          note.textContent = "Could not store the recording on this phone.";
        }
      };
      // Five-second slices. Small enough that an interruption costs almost
      // nothing, large enough that the encoder is not churning.
      mr.start(5000);
      t0 = Date.now();
      rec.setAttribute("data-on", "1");
      lbl.textContent = "Stop";

      // Hold the screen for as long as this runs. The module prefers a real
      // wake lock and falls back to a silent frame loop when the OS refuses
      // one, which is what Low Power Mode does.
      let holdNote = "";
      release = keepAwake((st) => {
        holdNote = st.held ? "" : " " + st.reason;
        paintNote();
      });

      const paintNote = () => {
        const m = mic && mic.warn ? "\n\n" + mic.warn : "";
        note.textContent = "Recording, screen held."
          + (mic ? " " + mic.short + "." : "")
          + holdNote + m;
      };

      timer = setInterval(() => {
        const s = Math.round((Date.now() - t0) / 1000);
        elapsed.textContent = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
      }, 250);
      paintNote();
    } catch (e) {
      stopHold();
      note.textContent = "Microphone permission was refused.";
    }
  });

  save.addEventListener("click", () => {
    const text = ta.value.trim();
    if (!text) return;
    const ok = queueNote(book.id, text, null);
    const stored = appendLog(date, { book: book.id, kind: "text", text, at: nowIso() });
    ta.value = "";
    ta.style.height = "auto";
    save.disabled = true;
    note.textContent = (ok && stored) ? "Saved." : "Saved on this phone only; it will sync.";
    refreshLog(date);
  });

  l.appendChild(body);
  return l;
}

function logList(date) {
  const box = el("div", { class: "panel", id: "tonightlog" });
  paintLog(box, date);
  return box;
}

function refreshLog(date) {
  const box = document.getElementById("tonightlog");
  if (box) paintLog(box, date);
  const alt = document.querySelector(".mast .alt b");
  if (alt) alt.textContent = String(readLog(date).length);
}

function paintLog(box, date) {
  box.innerHTML = "";
  const rows = readLog(date);
  if (!rows.length) {
    box.appendChild(empty("00:00", "Nothing read yet", "Both notebooks are still closed. Reading one aloud takes a few minutes and is the whole point."));
    return;
  }
  rows.slice().reverse().forEach((r) => {
    const row = el("div", { class: "logrow" });
    row.appendChild(el("span", { class: "t" }, esc(hhmm(r.at))));
    const x = el("span", { class: "x" });
    const tag = r.book === "lecture" ? "LECTURE" : r.book === "thinking" ? "THINKING" : "UPDATES";
    const head = el("b", null, esc(tag) + " · ");
    head.style.color = r.book === "lecture" ? "var(--tel)"
      : r.book === "thinking" ? "var(--think)" : "var(--burn)";
    head.style.fontFamily = "var(--din-alt)";
    head.style.fontSize = ".72rem";
    head.style.letterSpacing = ".1em";
    x.appendChild(head);
    // Transcribed text is arbitrary dictated content and never goes through
    // innerHTML.
    const body = document.createElement("span");
    body.textContent = r.kind === "audio"
      ? "read aloud, " + r.seconds + "s, transcribing"
      : String(r.text || "").slice(0, 400);
    x.appendChild(body);
    row.appendChild(x);
    box.appendChild(row);
  });
}
