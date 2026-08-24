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

import { el, esc, mast, zone, footer, empty, K, lsGet, lsSet, go, todayIso } from "../../core.js";
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
  wrap.appendChild(mast("Study", "cards built from your notes", "due now", String(due.length)));

  if (!bank.cards.length) {
    wrap.appendChild(empty("∅", "No cards yet",
      "Cards are generated from the lecture notebook. Read a night's notes aloud on Tonight and the deck builds itself."));
    const b = el("button", { type: "button", class: "savebtn" }, "Go to Tonight");
    b.style.width = "100%";
    b.addEventListener("click", () => go("#/tonight"));
    wrap.appendChild(b);
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
