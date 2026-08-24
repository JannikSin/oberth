# Oberth, notes for a session working here

Read `README.md` first. This file holds the things that will bite you.

**Any session that does real work here also updates Crystal**: the
`Lanes/Academics` note, `System/Changelog`, and `Accomplishments/Log`. That is
the standing every-vault-reports-to-Crystal rule (L13), not a suggestion.

## Provenance

Built 2026-08-24 (session **guesthouse**) after a full OPUS council on whether
this app should exist at all: 3 parallax lenses, 2 auditors, 5 seats, 3
cross-reviewers, chairman.

**The council ruled AGAINST it**, 90% confidence, on the ground that iOS
partitions IndexedDB per home-screen install, so a separate academic app cannot
surface a work block on Crystal's Today rail without a server round trip.

**David overruled it, and his reasons defeat the council's own arguments:**

1. The "ninth app" framing was wrong. Tally, Finesse, Grandstand, Bonmot and
   aimap are passion apps with no daily obligation. The function set is Crystal
   and this. Two.
2. The partitioning objection assumed the bridge had to be software. He writes
   sheets every night, so he IS the sync layer, and a more reliable one than a
   Worker round trip through a queue that currently drops records.
3. The chairman's own rule, "an app is earned by a physical act that happens at
   a fixed time whether or not the app exists", RETURNS BUILD IT once you know
   about the nightly two-notebook read. Nobody in the sitting knew.

Full record: Crystal `System/Academic-App-Spec.md`, `Sessions/2026-08-24-guesthouse.md`.

## The behavioural constraint that shaped every write surface

Measured, not assumed:

- **47 human ticks** across 10 of 23 days in Crystal's `Daily/_ticks/`, every one
  stamped `via: phone`, all in retroactive bursts (10 ticks in 19 seconds).
- **0 of 228** cooked confirmations in Mise across 8 plan files. The button
  exists, but `recipe.js:61` gates it behind starting a stopwatch BEFORE cooking,
  with no retroactive path.
- **0 sessions** in Anvil, and the one workout he did log was destroyed by a
  `useState` that iOS discarded, with the warning gated permanently off.

So: **he writes readily to one-tap retroactive controls and never to
start-a-session-first controls, and he tolerates multi-day gaps with batch
catch-up.**

Any control added here must be one tap, after the fact. Nothing may require him
to start something before the event. Nothing may depend on daily fidelity.

## Deliberate things that look like bugs

- **The trajectory dips where the day is FREE.** Low is periapsis, periapsis is
  where you burn. The first build had it inverted and the metaphor collapsed.
- **A 4h task can occupy more than 4h of wall clock.** Hours are discounted by
  time of day and by fatigue following long fixed blocks. That is the Oberth
  effect expressed as a number, and it is why the model puts MFET on Sunday.
- **MFET is planned a full day before its flat-zero deadline**, not the night
  before. `severity: "flatzero"` buys a safety day, because a plan that finishes
  at 22:30 before a 06:59 no-recovery deadline is reckless even when feasible.
- **`data/decks.json` is empty.** Cards are generated from transcriptions.
  Seeding it with invented physics would be worse than empty: a card he studies
  from has to be correct.
- **Career lives here despite the council's 4-1 vote.** The masthead always
  shows the nearest external deadline, so the council's risk (burying the
  highest-stakes lane) fails loudly rather than quietly.

## Not built yet, in rough priority order

1. **The Cloudflare Worker** (`worker/`). Nothing syncs until it exists and is
   deployed. The client queues offline and waits, which is correct behaviour,
   but no data leaves the phone.
2. **Server-side transcription.** `sync.js` uploads audio to `/audio`; the Worker
   must call Deepgram. David already has Nova-3 wired in `Projects/voicetype`,
   and `vocab.txt` there is the keyword-boost list worth reusing for course
   jargon (Coriolis, Teamcenter, Lagrangian).
3. **Deck generation from transcripts.** Bonmot's `tools/review_import.mjs` is
   the working pattern; point it at a lecture instead of a paper. Local by
   default via `dispatch.py paddington`, cloud when the laptop is closed.
4. **PHYS 310 content.** The urgent one. Midterm 1 is 2026-09-21, the course is
   90% exams on a curve with no drops, and there is currently no study material
   anywhere.
5. Clubs and research sections.
6. Light mode is defined in tokens but has never been looked at on a device.

## Before you touch the service worker

Bump `CACHE` on ANY change to a precached file. A phone holding old CSS while
fetching new markup renders a broken page, and the user cannot tell that from a
bug in the app.
