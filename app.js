// app.js: the router and the boot. Five tabs, one table, no framework.
// Each tab module owns its own data, caching and rendering; this file only
// decides which one gets the screen.

import { root, tabbar, key, keyScreen, setRouter, go, el, esc, pruneDated } from "./core.js";
import { flush, flushUploads, queueNudge, syncStamp, deadLetters, revive } from "./sync.js";
import * as tonight from "./app/views/tonight.js";
import * as track from "./app/views/track.js";
import * as study from "./app/views/study.js";
import * as courses from "./app/views/courses.js";
import * as career from "./app/views/career.js";

const ROUTES = { tonight, track, study, courses, career };

function route() {
  if (!key()) { keyScreen(""); return; }
  tabbar.hidden = false;
  const h = location.hash.replace(/^#\/?/, "");
  let parts;
  try {
    parts = h.split("/").map(decodeURIComponent).filter(Boolean);
  } catch (e) { go("#/tonight"); return; }

  if (parts[0] && !ROUTES[parts[0]]) { go("#/tonight"); return; }
  const tab = ROUTES[parts[0]] ? parts[0] : "tonight";
  tabbar.querySelectorAll("button").forEach((b) => {
    b.setAttribute("aria-current", b.getAttribute("data-tab") === tab ? "true" : "false");
  });
  root.innerHTML = "";
  window.scrollTo(0, 0);
  ROUTES[tab].open(parts);
  flush();
}

setRouter(route);
tabbar.querySelectorAll("button").forEach((b) => {
  b.addEventListener("click", () => go("#/" + b.getAttribute("data-tab")));
});
window.addEventListener("hashchange", route);

// ---------------------------------------------------------- the fix bubble --
// David asked for the improvement notes on this app too. Same offline FIFO as
// Crystal's Desk, but it is a square instrument key here, not a round mirror,
// and it says what it does rather than showing an emoji. It sits outside the
// router so it survives every tab switch.
const bubble = el("button", { type: "button", class: "bubble", "aria-label": "Note an improvement" }, "FIX<br>NOTE");
const panel = el("div", { class: "bubblepanel" });
panel.hidden = true;

const ta = document.createElement("textarea");
ta.placeholder = "What should Oberth do differently?";
ta.addEventListener("input", () => {
  ta.style.height = "auto";
  ta.style.height = ta.scrollHeight + "px";
});
const row = el("div", { class: "row" });
const stat = el("span", { class: "stat" }, "");
const send = el("button", { type: "button", class: "send" }, "Log it");

send.addEventListener("click", () => {
  const text = ta.value.trim();
  if (!text) { stat.textContent = "nothing typed yet"; return; }
  const ok = queueNudge(text);
  ta.value = "";
  ta.style.height = "auto";
  stat.textContent = ok ? "logged" : "could not save on this phone";
  if (ok) setTimeout(() => { panel.hidden = true; stat.textContent = ""; }, 700);
});

row.appendChild(stat);
row.appendChild(send);
panel.appendChild(ta);
panel.appendChild(row);

bubble.addEventListener("click", () => {
  panel.hidden = !panel.hidden;
  if (!panel.hidden) { stat.textContent = ""; ta.focus(); }
});
document.body.appendChild(panel);
document.body.appendChild(bubble);

// ------------------------------------------------------------------- boot --
pruneDated();
route();
flush();
flushUploads();

// The service worker registers from here, never from an inline script, so the
// CSP can stay strict.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

// A dead letter is the one thing that must never be silent. If anything was
// rejected by the Worker, the fix bubble turns red and says how many, because
// a rejected lecture transcription is unrecoverable: the paper notebook was
// already read aloud once and he will not do it twice.
function markDead() {
  const n = deadLetters().length;
  if (n) {
    bubble.style.borderColor = "var(--cliff)";
    bubble.style.color = "var(--cliff)";
    bubble.innerHTML = esc(String(n)) + "<br>STUCK";
    bubble.setAttribute("aria-label", n + " items were rejected and are still on this phone");
  }
}
markDead();
window.addEventListener("focus", markDead);
setInterval(markDead, 30000);

// Exposed for the Courses tab's recovery control.
window.__oberthRevive = () => { const n = revive(); syncStamp(n + " retried"); return n; };
