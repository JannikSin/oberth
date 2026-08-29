# 0004. Prefix every storage key and cache with `oberth`, and delete only own-prefix caches

- **Status:** accepted
- **Date:** 2026-08-24
- **Deciders:** session guesthouse
- **Tenet invoked:** none. This is an invariant, recorded here for its history.

## Context

Every one of David's PWAs is served from `janniksin.github.io`. localStorage,
IndexedDB and Cache Storage are scoped **per origin, not per path**, so all of
them share one namespace.

Mise shipped `keys.filter((k) => k !== CACHE_VERSION)` in its service worker's
activate handler, which deletes **every** cache on the origin. It evicted Tally,
Finesse, Bonmot, Grandstand and aimap's shells on every Mise deploy **for 22
days** before anyone noticed, because the symptom is a slow reload in a different
app from the one that caused it.

## Options considered

- **Serve each app from its own subdomain.** Solves it completely, and costs DNS
  setup, certificates and a Pages arrangement that does not currently exist.
- **Prefix everything and filter deletes.** Free, and relies on discipline.

## Decision

localStorage keys are `oberth.` prefixed. `DB_NAME` is `oberth`. The cache is
`oberth-shell-vN`, registered with scope `./`, never at the origin root. The
`activate` handler filters `caches.keys()` by `oberth-shell-` **before** deleting
anything.

## Consequences

Oberth cannot damage a sibling app, and a sibling cannot read its data.

**What gets worse:** it is enforced by discipline, not by the platform. One
unprefixed key added later reintroduces the whole class of bug silently, and the
symptom shows up in a different app. **A test should guard this;** Anvil has
`tests/origin.test.js` and Oberth does not yet.

**Superseded-fact note:** documents elsewhere in the fleet state that Mise is the
last app still deleting every cache. True when written, false since 2026-08-18,
verified 2026-08-29. Every app on the origin is now prefix-scoped.
