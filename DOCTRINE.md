# Oberth: the doctrine

> [!warning] **This is a v1 doctrine, and the standard moved on 2026-08-29.**
> Everything below is true and came out of this app's own history, so none of it is wasted. But the
> six-article shape was invented rather than researched, and the research (Amazon tenets, Nygard's
> Architecture Decision Records, design-doc non-goals) says these are **three documents, not one**.
> **What changes:** the prohibitions become *invariants* with a test named against each, the
> "settled" list becomes numbered decision records that can be marked *superseded* instead of
> silently going stale, the failure table becomes an incidents file, and the doctrine itself is
> capped at one page. **Awaiting David's review and go.** Standard: Crystal `System/App-Doctrine.md`.

**What this file is.** The governing principles of this app: what it is for, what
it will never do, which decisions are already settled, and how to tell a good
change from a bad one. `README.md` says what the app is. `CLAUDE.md` says what
will bite you. **This says what is true regardless of the code**, and it outranks
both when they disagree.

Written 2026-08-28 (session **trinity**) at David's instruction: *"does oberth
have a core principals doctrine we need that for every app now."* Oberth is the
first. The reusable shape is Crystal `System/App-Doctrine.md`.

**A session may not quietly overrule an article here.** Propose the change, say
which article and why the reason behind it no longer holds, and get David's named
yes. An article whose stated reason has actually expired should be struck, not
worked around.

---

## Article 0. The job

**Oberth exists so that the two paper notebooks David already reads aloud every
night become the semester's schedule, its study material and its deliverable
list, without him entering anything.**

He was going to read those notebooks whether or not this app existed. That is the
entire justification for a ninth icon on the home screen, and it is the sentence
the 2026-08-24 council did not have when it voted the app down 90/10. Every
feature is measured against it. A feature that adds a second ritual, rather than
harvesting the one that already happens, is off-doctrine no matter how good it is.

---

## Article 1. The one behaviour everything is built around

**He writes readily to one-tap retroactive controls, and never to
start-a-session-first controls.** This is measured across his whole portfolio,
not assumed:

| Control | Modality | Uses |
|---|---|---|
| Crystal brief ticks | one tap, retroactive, phone | **47** across 10 of 23 days, in bursts (10 in 19 seconds) |
| Mise cooked confirmation | gated behind starting a stopwatch first | **0 of 228** |
| Anvil session log | start a session, then log | **0** |

**Therefore, and without exception:**

1. Every write is **one tap**.
2. Every write is **valid after the fact**. Nothing may require him to press
   something before the event it records.
3. Everything tolerates **multi-day gaps** and rewards batch catch-up.

A control that violates this is rejected on sight, however good it looks in a
mockup. The 0-of-228 was not a discoverability problem and a nicer button would
not have fixed it.

---

## Article 2. What Oberth will never do

1. **Never ask him to enter an assignment.** It arrives from the updates
   notebook. The moment he is typing in a due date, the app has failed at
   Article 0 and is a worse version of a calendar.
2. **Never destroy a rejected write.** A 4xx moves the delta to a visible dead
   letter and the liveness line says so in words. Crystal drops the queue head
   and then stamps "synced", which is how a rejected record dies while the screen
   reports success. A lost lecture transcription is unrecoverable: the paper was
   read aloud once and he will not do it twice.
3. **Never render a fraction as a grade.** Drops and cliffs are pips. A
   percentage reads as a grade and a grade reads as punishment, on a screen whose
   job is to tell him he has two drops left and may skip this one.
4. **Never invent study material.** An empty deck is honest and says a night has
   not been read yet. A generated card containing invented physics is a lie he
   would then study from, which is worse than every empty screen in the app.
5. **Never depend on daily fidelity.** Three days of silence is the normal case,
   not the failure case, and nothing may degrade because of it.
6. **Never require the laptop for something he needs on the phone.** The laptop
   is where things are built. The phone is where they are used.

---

## Article 3. Settled. Do not re-litigate

Each of these was decided once, for a reason, and has already survived at least
one attempt to simplify it away.

- **The scheduler is not EDF.** Pin, then admit, then backward pass (Robust
  Earliest Deadline, Buttazzo and Stankovic 1993). EDF's optimality assumes a
  feasible schedule exists; his semester is an overload problem by construction,
  and under overload EDF's competitive factor is zero. EDF also has no value
  function, so it cannot tell MFET's 06:59 flat zero from a one-point PHYS 310
  problem, and cannot say the most valuable sentence this app has: *skip this
  one, you have two drops left.* See the header of `app/schedule.js`.
- **The trajectory rail is gone and stays gone.** David, 2026-08-25: *"it has
  some graph at the top that means nothing to me."* The scheduling model
  underneath it survives; only the picture was removed. **If a thing cannot be
  read at a glance by the one person who uses it, it is not an instrument, it is
  an ornament.** That sentence generalises and is the reason this article exists.
- **Transcription gating is measured, not principled.** Against three seconds of
  pure digital silence, `no_speech_prob` returned **0.0000** and the model
  returned `" www.patreon.com"` and `"Thank you"`. The working gate is a
  junk-phrase denylist, words-per-second below 0.5, `avg_logprob` below -0.7, and
  a vocabulary-echo check. Do not "simplify" this to `no_speech_prob`.
- **Storage keys are prefixed `oberth.`, and the service worker filters
  `caches.keys()` by `oberth-shell-` before deleting anything.** One origin is
  shared with Crystal, Grandstand, Tally, Finesse, Bonmot and aimap. Mise deleted
  five sibling apps' caches on every deploy for 22 days.
- **Tonight has three lanes, not two.** Lecture, updates, thinking. Thinking is
  not a notebook, it is him talking, and folding it into updates turns a thought
  into a chore: *"PHYS 306 took four hours and I do not think the reading is
  doing anything"* is not a deliverable.
- **Career lives in this app** despite the council's 4-1 vote against, because
  the masthead always shows the nearest external deadline, so the council's
  stated risk of burying the highest-stakes lane fails loudly rather than
  quietly.

---

## Article 4. How to tell a good change from a bad one

In order. A change that fails any of these is not ready, whatever the tests say.

1. **Does it survive three days of him not opening the app?** If it needs
   yesterday to have gone right, it is off-doctrine.
2. **Is it one tap, retroactive, on the phone?** See Article 1.
3. **If it produces words, is the short version on top?** The machine already
   writes about 33 documents a week across his setup and his reading is the
   scarce resource, not compute. Long is not thorough. Long is unread.
4. **Did you watch it work on the real device?** A green test suite and a phone
   holding stale CSS look identical from here. Bump `CACHE` on any change to a
   precached file.
5. **Does the output land where he actually looks?** Three separate times in
   August the machinery worked perfectly and the delivery did not: the fitness
   ramp wrote 15,857 characters into a folder he does not open, the conditioning
   programme rendered on no screen, the podcast sweep ran off a list he had
   already worked through. **A green job with no reader is the same as no job.**

---

## Article 5. The failure modes this app is specifically armed against

Named because they have all actually happened here or in a sibling app, and an
unnamed failure mode gets rebuilt.

| Failure | Where it happened | The armour |
|---|---|---|
| Silent data loss reported as success | Crystal `/ticks`, live | Dead letters, visible, in words |
| Decoration mistaken for an instrument | the periapsis rail | Article 4, test 1 |
| Machinery without delivery | three times in August | Article 4, test 5 |
| Built but not wired | Crystal's morning trigger, unregistered 3 days | Watch it fire once, then say so |
| Sibling cache eviction | Mise, 22 days, five apps | `oberth-shell-` prefix filter |
| A model's confident silence | Whisper on pure silence | The measured gate, Article 3 |

---

## Article 6. Kill conditions

**PROPOSED, not adopted. Needs David's named yes.** Every standing structure in
this setup gets a kill review, and a doctrine with no kill condition is one that
can never be found wrong.

Review at the end of the fall term, **2026-12-18**. Oberth has failed at Article
0, and should be retired back into Crystal, if by then:

- **fewer than 30 nights** were read into it across the semester, meaning the
  ritual it was built to harvest was not actually harvested; **or**
- he **entered more deliverables by hand than arrived from the updates
  notebook**, meaning it became a worse calendar; **or**
- the **Study tab was never used in a week containing an exam**, meaning the
  cards were never worth the transcription.

Passing means it stays and the review moves to the end of the spring term.

---

*Companion documents: `README.md` (what it is), `CLAUDE.md` (what will bite you),
Crystal `System/Academic-App-Spec.md` (the council record),
Crystal `System/App-Doctrine.md` (this shape, for the other apps).*
