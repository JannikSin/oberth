# 0002. Remove the periapsis trajectory rail from Track

- **Status:** accepted
- **Date:** 2026-08-25
- **Deciders:** David, directly
- **Tenet invoked:** an instrument is read at a glance by the one person who uses it

## Context

The periapsis trajectory was the signature element of the design and the visual
argument for the app's whole name. It sat at the top of Track, the tab opened
daily.

David, 2026-08-25: *"it has some graph at the top that means nothing to me."*

It was pushing the actual answer, which is what to start today, below the fold.

## Options considered

- **Keep and explain it.** Add a legend or an onboarding line. Costs a permanent
  explanation for a thing that should have been self-evident.
- **Keep it lower down.** Retains the cost of rendering and maintaining a
  decoration, just further from the eye.
- **Remove the picture, keep the model.**

## Decision

Remove the rail. **The scheduling model underneath survives unchanged** and still
decides when to start things. Only the picture is gone. Track becomes a day view
with arrows either side.

## Consequences

The tab now leads with the answer. The app's name refers to a model the interface
no longer draws, which is fine.

**What gets worse:** nothing on screen now teaches the periapsis idea, so the
reasoning behind the ordering is invisible and lives only in `app/schedule.js`
and record 0001. A future session may mistake the ordering for arbitrary.

**The general rule this produced**, now cited elsewhere: *if a thing cannot be
read at a glance by the one person who uses it, it is not an instrument, it is an
ornament.*
