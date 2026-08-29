# 0005. Tonight carries three lanes, not two

- **Status:** accepted
- **Date:** 2026-08-26
- **Deciders:** David, directly
- **Tenet invoked:** the app harvests a ritual that already happens

## Context

The app was built around two paper notebooks David reads aloud each night:
**lecture** (what was taught, where reading aloud is itself the studying) and
**updates** (what was announced, which is where deliverables come from).

On 2026-08-26 he described a third thing that is not a notebook at all:
*"Oberth is the path here and I can just talk some stuff out through that and see
what I want to continue, and from there we go and change things."*

## Options considered

- **Fold it into updates.** One fewer lane, colour and destination. Files a
  thought as a deliverable.
- **A separate app, or a notes app.** Splits the nightly ritual across two
  surfaces, which is the thing this app exists to avoid.
- **A third lane.**

## Decision

Three lanes, three colours, three destinations: lecture, updates, **thinking**.

## Consequences

A thought stays a thought. *"PHYS 306 took four hours and I do not think the
reading is doing anything"* is not a deliverable, and filing it as one turns it
into a chore he will not write again.

**What gets worse:** a third destination is a third thing to route, store and
sync, and the thinking lane has **no consumer yet**. It is currently write-only
on this laptop because `oberth_key.txt` is missing, which the Crystal doctor
flags. **A write-only lane is the exact shape of the suggest-button failure**
that went unnoticed for nine days, so this needs closing.
