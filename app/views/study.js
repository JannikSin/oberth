// study.js: the burn card. One card, full bleed, two verdicts.
//
// The engine is Bonmot's, lifted whole: app/srs.js is a thin wrapper over
// vendored ts-fsrs (FSRS-6), two-button grading, fuzz disabled so scheduling
// is deterministic and testable. There was no reason to write a second
// scheduler and every reason not to.
//
// Decks are GENERATED from the lecture notebook, never authored by hand. That
// is the whole point of reading the notes aloud: the transcript is the source
// and the cards fall out of it. An empty deck here is not a bug, it means a
// night has not been read yet.

import { el, esc, mast, zone, footer, empty, K, lsGet, lsSet, go, todayIso, api, fmtDay } from "../../core.js";
import { queueGrade } from "../../sync.js";
import { newProgress, grade, isDue, dueInDays } from "../srs.js";

const progKey = K("srs");
const allProgress = () => lsGet(progKey, {});
const saveProgress = (p) => lsSet(progKey, p);

let DECKS = null;
async function loadDecks() {
  if (DECKS) return DECKS;
  try {
    DECKS = await (await fetch("./data/decks.json")).json();
  } catch (e) {
    DECKS = { decks: [], cards: [] };
  }
  return DECKS;
}

function dueCards(bank, now) {
  const P = allProgress();
  return bank.cards.filter((c) => {
    const p = P[c.id];
    if (!p) return true;              // never seen: it is due
    return isDue(p, now);
  });
}

export function open(parts) {
  const root = document.getElementById("root");
  loadDecks().then((bank) => {
    if (location.hash.replace(/^#\/?/, "").split("/")[0] !== "study") return;
    const deckId = parts && parts[1];
    root.innerHTML = "";
    if (deckId) return runDeck(root, bank, deckId);
    return picker(root, bank);
  });
}

function picker(root, bank) {
  const wrap = document.createElement("div");
  const now = new Date();
  const due = dueCards(bank, now);
  wrap.appendChild(mast("Study", "questions and cards from your notes", "due now", String(due.length)));

  // Questions come first. They are the thing he actually generates every night
  // ("What is a Vanderpool oscillator? I don't know"), and until decks exist
  // they are the only real content on this tab.
  wrap.appendChild(zone("your questions"));
  wrap.appendChild(questionsPanel());

  if (!bank.cards.length) {
    wrap.appendChild(zone("decks"));
    wrap.appendChild(empty("∅", "No cards yet",
      "Deck generation is parked. When it is built, cards come from the lecture notebook."));
    wrap.appendChild(footer());
    root.appendChild(wrap);
    return;
  }

  wrap.appendChild(zone("decks"));
  const P = allProgress();
  (bank.decks || []).forEach((d) => {
    const cards = bank.cards.filter((c) => c.deck === d.id);
    const dueN = cards.filter((c) => !P[c.id] || isDue(P[c.id], now)).length;
    const p = el("div", { class: "panel " + (dueN ? "is-burn" : "") });
    p.appendChild(el("div", { class: "ph" },
      "<span class='pt'>" + esc(d.name || d.id) + "</span>" +
      "<span class='pm'>" + esc(dueN ? dueN + " due" : "clear") + "</span>"));
    p.appendChild(el("p", null, esc(cards.length + " cards" + (d.course ? " · " + d.course : ""))));
    if (dueN) {
      const b = el("button", { type: "button", class: "savebtn" }, "Run " + dueN);
      b.style.marginTop = "10px";
      b.addEventListener("click", () => go("#/study/" + encodeURIComponent(d.id)));
      p.appendChild(b);
    }
    wrap.appendChild(p);
  });

  wrap.appendChild(footer());
  root.appendChild(wrap);
}

function runDeck(root, bank, deckId) {
  const deck = (bank.decks || []).find((d) => d.id === deckId);
  const now = new Date();
  const P = allProgress();
  const queue = bank.cards
    .filter((c) => c.deck === deckId)
    .filter((c) => !P[c.id] || isDue(P[c.id], now))
    .sort((a, b) => {
      const pa = P[a.id], pb = P[b.id];
      const da = pa ? dueInDays(pa, now) : -999;
      const db = pb ? dueInDays(pb, now) : -999;
      return da - db;             // most overdue first, new cards ahead of all
    });

  let i = 0, revealed = false;

  function paint() {
    root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.appendChild(mast(deck ? deck.name || deck.id : "Deck", "burn card", "left", String(queue.length - i)));

    if (i >= queue.length) {
      wrap.appendChild(empty("✓", "Deck clear", "Every card in this deck is scheduled forward. Come back when it is due."));
      const b = el("button", { type: "button", class: "savebtn" }, "Back to decks");
      b.style.width = "100%";
      b.addEventListener("click", () => go("#/study"));
      wrap.appendChild(b);
      wrap.appendChild(footer());
      root.appendChild(wrap);
      return;
    }

    const c = queue[i];
    const card = el("div", { class: "card" });
    const q = el("div", { class: "q" });
    q.textContent = c.front;                     // generated content: never innerHTML
    card.appendChild(q);
    if (revealed) {
      const a = el("div", { class: "a" });
      a.textContent = c.back;
      card.appendChild(a);
    }
    wrap.appendChild(card);

    if (!revealed) {
      const b = el("button", { type: "button", class: "savebtn" }, "Show");
      b.style.width = "100%";
      b.addEventListener("click", () => { revealed = true; paint(); });
      wrap.appendChild(b);
    } else {
      const v = el("div", { class: "verdicts" });
      const again = el("button", { type: "button", class: "again" }, "Again");
      const good = el("button", { type: "button", class: "good" }, "Got it");
      again.addEventListener("click", () => mark(c, "again"));
      good.addEventListener("click", () => mark(c, "good"));
      v.appendChild(again); v.appendChild(good);
      wrap.appendChild(v);
    }

    wrap.appendChild(footer());
    root.appendChild(wrap);
  }

  function mark(c, rating) {
    const P2 = allProgress();
    const prev = P2[c.id] || newProgress(c.id, new Date());
    const next = grade(prev, rating, new Date());
    P2[c.id] = next;
    saveProgress(P2);
    queueGrade(c.id, rating, next);
    i++; revealed = false;
    paint();
  }

  paint();
}


// ------------------------------------------------------------- questions ----
// David reads his notes back and narrates questions into them. Those lines used
// to disappear into a wall of transcript. The Worker mines them at
// transcription time and files them OPEN; answers are written back from the
// laptop with sources, never guessed, for the same reason a fabricated
// flashcard is worse than no flashcard.
const QCACHE = K("questions");

function questionsPanel() {
  const box = el("div", { id: "qbox" });
  paintQuestions(box, lsGet(QCACHE, []));
  api("/questions").then((d) => {
    const qs = d.questions || [];
    lsSet(QCACHE, qs);
    const live = document.getElementById("qbox");
    if (live) paintQuestions(live, qs);
  }).catch(() => {});
  return box;
}

function paintQuestions(box, qs) {
  box.innerHTML = "";
  if (!qs.length) {
    box.appendChild(empty("?", "No questions yet",
      "When you wonder aloud while reading your notes, it gets pulled out and lands here."));
    return;
  }
  // Answered first: those are the payoff. Open ones below, so the list reads
  // as "here is what you asked and here is what came back".
  const answered = qs.filter((q) => q.status === "answered");
  const open = qs.filter((q) => q.status !== "answered");

  answered.slice().reverse().forEach((q) => box.appendChild(qCard(q, true)));
  open.slice().reverse().forEach((q) => box.appendChild(qCard(q, false)));
}

function qCard(q, answered) {
  const p = el("div", { class: "panel " + (answered ? "is-tel" : "is-burn") });

  const ph = el("div", { class: "ph" });
  const t = el("span", { class: "pt" });
  t.textContent = q.q;
  t.style.textTransform = "none";
  t.style.fontSize = "1rem";
  ph.appendChild(t);
  ph.appendChild(el("span", { class: "pm" }, esc(answered ? "answered" : "looking")));
  p.appendChild(ph);

  if (q.why) {
    const w = el("div", { class: "pm" }, "");
    w.textContent = q.why;
    w.style.marginTop = "4px";
    w.style.textTransform = "none";
    w.style.letterSpacing = "0";
    w.style.fontStyle = "italic";
    p.appendChild(w);
  }

  if (!answered) {
    const n = el("p", null, "");
    n.textContent = "Not answered yet.";
    p.appendChild(n);
    return p;
  }

  // Long answers collapse. A five-paragraph answer at the top of the tab is
  // the same mistake the rail was.
  const body = el("div", null, "");
  const full = String(q.answer || "");
  const short = full.length > 260;
  const para = (txt) => {
    const d = el("p", null, "");
    d.textContent = txt;
    d.style.color = "var(--ink)";
    d.style.fontSize = ".93rem";
    return d;
  };
  const render = (expanded) => {
    body.innerHTML = "";
    const txt = expanded || !short ? full : full.slice(0, 240).trim() + "…";
    txt.split("\n\n").filter(Boolean).forEach((chunk) => body.appendChild(para(chunk.trim())));
    if (short) {
      const b = el("button", { type: "button", class: "recbtn" }, expanded ? "Less" : "Read it");
      b.style.marginTop = "8px";
      b.addEventListener("click", () => render(!expanded));
      body.appendChild(b);
    }
    if (expanded && Array.isArray(q.sources) && q.sources.length) {
      const s = el("div", { class: "pm" }, "");
      s.style.marginTop = "8px";
      s.style.textTransform = "none";
      s.style.letterSpacing = "0";
      q.sources.forEach((u) => {
        const a = el("a", { href: u, target: "_blank", rel: "noopener noreferrer" }, esc(u.slice(0, 70)));
        a.style.display = "block";
        a.style.fontSize = ".76rem";
        s.appendChild(a);
      });
      body.appendChild(s);
    }
  };
  render(false);
  p.appendChild(body);
  return p;
}
