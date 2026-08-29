# Decision records

One file per settled decision. **Numbered, never renumbered, never deleted.**

This folder is what `DOCTRINE.md` used to try to hold in a single "settled, do
not re-litigate" list. That list was a snapshot with no history: it could go
stale and nothing could say so. A real example, found 2026-08-29: Anvil's
`CLAUDE.md` asserted a fact about Mise that had been false for eleven days, and
there was no mechanism anywhere to mark it superseded.

## The format

Michael Nygard's, 2011, unchanged since. Five fields:

**Title** (short, in the file name) · **Status** · **Context** · **Decision** ·
**Consequences**

## Status values

- `proposed` - written, not yet agreed
- `accepted` - in force
- `rejected` - considered and not taken. **Kept**, because the next person to
  propose it needs to find the argument that was already had.
- `deprecated` - no longer relevant, nothing replaced it
- `superseded by NNNN` - replaced. **The old record is never edited or deleted.**

## The rules

1. **A reversed decision is superseded, never rewritten.** Write a new record,
   set the old one's status, and link both ways.
2. **Context is written in the present tense of the time it was written**, and is
   never updated later. It is a record of what was known then, which is the only
   thing that makes the decision judgeable in hindsight.
3. **Consequences includes the bad ones.** A record with only upsides was
   written to justify, not to decide.
4. **Cite the tenet.** If a doctrine tenet decided the tie, name it. That
   citation is what makes tenets falsifiable: a tenet cited in no decision for
   six months is doing no work and gets cut.
5. **Numbers are permanent.** Gaps are fine.

## Adding one

Copy `0000-template.md`, take the next number, write it, link it from the
relevant doctrine clause if there is one.
