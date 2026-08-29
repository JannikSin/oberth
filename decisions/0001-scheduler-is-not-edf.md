# 0001. Order work by pin, then admit, then backward pass, not by EDF

- **Status:** accepted
- **Date:** 2026-08-24
- **Deciders:** council (3 parallax lenses, 2 auditors, 5 seats, 3 cross-reviewers, chairman)
- **Tenet invoked:** the app exists to say "skip this one, you have two drops left"

## Context

The first draft of the spec said Earliest Deadline First is provably optimal for
one preemptible resource with hard deadlines. **That theorem is real and its
hypothesis is that a feasible schedule exists**, utilisation at or below 1.

David's semester is an overload problem by construction. The reason he wants the
tool at all is that the week does not obviously fit: seven courses, about 18.5
contact hours, one three-hour lab and two further two-hour blocks.

Under overload EDF is not merely suboptimal, it is degenerate. It commits to the
nearest deadline, which under overload is the job most likely already doomed,
burns the time, misses it anyway, and cascades (Locke's domino effect, 1986). Its
competitive factor under overload drops to zero.

EDF also orders by a clock and carries no value function, so it cannot
distinguish MFET's 06:59 flat zero from a one-point PHYS 310 problem. Those
differ by an order of magnitude in consequence.

## Options considered

- **EDF.** Simple, well known, one line to explain. Degenerate under exactly the
  condition this app is built for, and cannot shed load.
- **Weighted priority score.** Tunable, and unfalsifiable: any output can be
  explained after the fact by the weights.
- **Robust Earliest Deadline** (Buttazzo and Stankovic, 1993). More machinery,
  and the only one of the three that can name what to drop.

## Decision

Three phases. **PIN** flat-zero and cliff items, which do not negotiate. **ADMIT**
by comparing demand to real capacity, and where it does not fit, name what to
shed, cheapest consequence first, out loud. **PLACE** by a latest-start backward
pass over the admitted set.

## Consequences

Load shedding becomes possible, which is the single most valuable sentence the
app can produce.

**What gets worse:** the model is harder to explain and harder to debug than a
sort, and its output looks wrong until you know the rules. A four-hour task can
occupy more than four hours of wall clock, because hours are discounted by time
of day and by fatigue after long fixed blocks. MFET gets planned a full day
before its deadline rather than the night before, which looks like a bug and is
`severity: "flatzero"` buying a safety day.
