import assert from "node:assert/strict";
import test from "node:test";

import { createTicketRegistry } from "./latestWins.mjs";

test("the newest claim wins and older ones are refused", () => {
  const r = createTicketRegistry();
  const first = r.claim("album:nirvana");
  const second = r.claim("album:nirvana");
  assert.equal(r.isCurrent("album:nirvana", second), true);
  assert.equal(r.isCurrent("album:nirvana", first), false);
});

test("a slow GET cannot overwrite a rating made after it started", () => {
  // The reported bug: open an album (GET starts), rate it (POST starts and
  // finishes), then the GET lands carrying the pre-rating value.
  const r = createTicketRegistry();
  const load = r.claim("album:x");     // GET issued first
  const rate = r.claim("album:x");     // user rates while it is in flight

  assert.equal(r.isCurrent("album:x", rate), true, "the rating may write");
  assert.equal(r.isCurrent("album:x", load), false, "the stale load must not");
});

test("a failed OLD rating cannot roll back a newer successful one", () => {
  // Rate 3 stars, then 5 stars. The 3-star request fails LAST. Its rollback
  // would otherwise restore the pre-3-star value and wipe the 5.
  const r = createTicketRegistry();
  const three = r.claim("song:y");
  const five = r.claim("song:y");

  assert.equal(r.isCurrent("song:y", five), true);
  assert.equal(r.isCurrent("song:y", three), false, "the older failure must not roll back");
});

test("keys are independent", () => {
  const r = createTicketRegistry();
  const a = r.claim("album:a");
  r.claim("album:b");
  r.claim("album:b");
  assert.equal(r.isCurrent("album:a", a), true, "activity on another key is irrelevant");
});

test("an unknown key or ticket is never current", () => {
  const r = createTicketRegistry();
  assert.equal(r.isCurrent("never-claimed", 1), false);
  assert.equal(r.isCurrent("never-claimed", undefined), false);
  const t = r.claim("k");
  assert.equal(r.isCurrent("k", t + 1), false, "a ticket from the future is not current");
});

test("release and clear drop state so it cannot leak across sessions", () => {
  const r = createTicketRegistry();
  const t = r.claim("k");
  r.release("k");
  assert.equal(r.isCurrent("k", t), false);

  r.claim("a"); r.claim("b");
  assert.equal(r.size, 2);
  r.clear();
  assert.equal(r.size, 0);
});

test("claims keep increasing, so a reused key stays ordered", () => {
  const r = createTicketRegistry();
  let last = 0;
  for (let i = 0; i < 50; i++) {
    const t = r.claim("k");
    assert.ok(t > last, "tickets must be monotonic");
    last = t;
  }
  assert.equal(r.isCurrent("k", last), true);
});
