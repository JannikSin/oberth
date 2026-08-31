// ledger.js: the spendable-allowance ledger, shared by Courses and Track.
//
// One localStorage map, `oberth.ledger`, keyed by drop/cliff id, counting how
// many of each allowance have been SPENT. Courses renders it as pips; Track
// spends from it when a deliverable is skipped. It lives in its own module so
// the two tabs cannot drift apart on the arithmetic, and so an undo on Track
// refunds the exact drop it spent.
//
// Every change is queued to the Worker via the tick pipe, same as before.

import { K, lsGet, lsSet } from "../core.js";
import { queueTick } from "../sync.js";

const KEY = K("ledger");

export const ledger = () => lsGet(KEY, {});

export function spend(id, n) {
  const L = ledger();
  L[id] = Math.max(0, (L[id] || 0) + n);
  lsSet(KEY, L);
  queueTick(id, true, { used: L[id] });
  return L[id];
}

export function refund(id, n) {
  const L = ledger();
  L[id] = Math.max(0, (L[id] || 0) - n);
  lsSet(KEY, L);
  queueTick(id, false, { used: L[id] });
  return L[id];
}

/** How many of a drop pool are left, given its total. */
export function left(id, total) {
  return Math.max(0, total - (ledger()[id] || 0));
}

/** Find the drop pool a rule spends from, or null. */
export function dropFor(data, dropId) {
  if (!dropId) return null;
  for (const c of data.courses || []) {
    for (const d of c.drops || []) if (d.id === dropId) return d;
  }
  return null;
}
