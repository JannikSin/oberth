# Oberth

David's academic app. Named for Hermann Oberth and the Oberth effect: a burn is
worth more at periapsis, where you are deepest in the well and moving fastest.
The same hour of work is worth more at the right moment. That is the thesis, and
the whole interface exists to say it.

**Live:** `janniksin.github.io/oberth` (GitHub Pages, deploys from `main`).
Worker: `oberth.janniksin.workers.dev` (transcription relay + sync store).

## What it is for

Every night David reads two paper notebooks aloud:

- **Lecture notes.** Reading them aloud is how he remembers them, so the act IS
  the studying and the transcript is a by-product that feeds study guides and
  spaced-repetition cards.
- **Updates notebook.** Homework, project milestones, things to buy. This is
  where deliverables come from, and it is why he never types in an assignment:
  he already wrote it down in class.

Everything else hangs off those two streams.

## Tabs

| Tab | Layout language | Does |
|---|---|---|
| **Tonight** | the log book | Two ruled lanes, voice capture, tonight's log |
| **Track** | the trajectory | The periapsis rail, burn markers, what to start now |
| **Study** | the burn card | FSRS review, one card, two verdicts |
| **Courses** | the panel | Course facts, drop allowances, cliff counters |
| **Career** | the manifest | Dated external deadlines |

Plus the **FIX NOTE** key on every tab, which is Oberth's own improvement inbox.

## Rules that are not negotiable

1. **Storage keys are prefixed `oberth.`, always.** Every one of David's PWAs
   shares `janniksin.github.io`: one origin, one localStorage, one IndexedDB
   namespace. An unprefixed key collides with Crystal's.
2. **The service worker filters `caches.keys()` by `oberth-shell-`** before
   deleting anything. Mise deleted five sibling apps' caches on every deploy for
   22 days because it did not. See the comment at the top of `sw.js`.
3. **A rejected write is BURIED, never destroyed.** Crystal's sync drops the
   queue head on any 4xx and then stamps "synced". Oberth dead-letters it and
   says so on screen. A lost lecture transcription is unrecoverable: the paper
   was already read aloud once and he will not do it twice.
4. **The scheduler is not EDF.** See the header of `app/schedule.js`. Pin, then
   admit, then backward pass. Do not "simplify" it back.
5. **Drops and cliffs render as pips, never percentages.** A fraction reads as a
   grade, and a grade reads as punishment.

## Layout

```
index.html          shell + tab bar
app.css             the whole design system
app.js              router, boot, the FIX NOTE bubble
core.js             storage, dates, DOM, key screen
sync.js             two pipes: JSON FIFO + audio blobs, with dead letters
app/schedule.js     pin -> admit -> backward pass, the periapsis model
app/srs.js          FSRS wrapper (lifted from Bonmot)
app/views/*.js      one module per tab, each exports open(parts)
data/courses.json   the syllabus rulebook, i.e. the generator's input
data/decks.json     generated cards (empty until a night has been read)
vendor/ts-fsrs.mjs  the scheduler, vendored
worker/             Cloudflare Worker (not written yet)
tests/              node tests, no framework
```

## Run it

```
python -m http.server 8791
# http://localhost:8791/index.html
node tests/schedule.test.mjs
```

The app asks for an access key on first load. Until the Worker exists, any
string works locally: `localStorage.setItem("oberth.key", "devkey")`.
