import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createSessionValidationRetry } from "./sessionValidationRetry.mjs";
import { createSessionValidationCoordinator, sessionValidationOutcome } from "./sessionValidation.mjs";

test("outage retries spread, grow to a bounded delay, honor hints, and reset after recovery", () => {
  const retry = createSessionValidationRetry({ random: () => 0.5 });
  assert.deepEqual(Array.from({ length: 7 }, () => retry.next()), [7500, 15000, 30000, 45000, 45000, 45000, 45000]);
  assert.equal(retry.next({ retryAfterMs: 120000 }), 120000);
  assert.equal(retry.next({ retryAfterMs: Infinity }), 45000);
  assert.equal(retry.next({ retryAfterMs: 4e6 }), 3600000);
  retry.reset();
  assert.equal(retry.next(), 7500);
  assert.equal(createSessionValidationRetry({ random: () => 0 }).next(), 5000);
  assert.equal(createSessionValidationRetry({ random: () => 1 }).next(), 10000);
  const low = createSessionValidationRetry({ random: () => 0 });
  const high = createSessionValidationRetry({ random: () => 1 });
  for (let i = 0; i < 10; i++) { low.next(); high.next(); }
  assert.equal(low.next(), 30000);
  assert.equal(high.next(), 60000, "sustained retries retain jitter at the cap");
});

test("Store's actual timer wiring backs off, resets after authoritative recovery, and preserves strict requests", async () => {
  const source = readFileSync(new URL("../store.js", import.meta.url), "utf8");
  const schedule = source.slice(source.indexOf("const scheduleRetry = (strict, error)"), source.indexOf("const runValidation = async"));
  const wiring = source.slice(source.indexOf("coordinator = createSessionValidationCoordinator({"), source.indexOf("const stopAuthRetry ="));
  const timers = new Map();
  let sequence = 0, locks = 0, authoritative = false;
  const make = new Function("createSessionValidationRetry", "createSessionValidationCoordinator", "setTimeout", "clearTimeout", "runValidation", "lockIdentity", `
    let stopped = false, retryTimer = null, coordinator;
    const validationRetry = createSessionValidationRetry({ random: () => 0 });
    ${schedule}
    ${wiring}
    return { scheduleRetry, coordinator, stop() { stopped = true; if (retryTimer) clearTimeout(retryTimer); } };
  `);
  const store = make(createSessionValidationRetry, createSessionValidationCoordinator,
    (work, ms) => { const id = ++sequence; timers.set(id, { work, ms }); return id; },
    id => timers.delete(id), async () => ({ authoritative }), () => { locks++; });
  store.scheduleRetry(false, { retryAfterMs: 12000 });
  assert.equal([...timers.values()][0].ms, 12000);
  store.scheduleRetry(true);
  assert.equal(timers.size, 1, "replacing a pending retry cannot create a second timer");
  const first = [...timers.values()][0];
  assert.equal(first.ms, 10000);
  timers.clear(); first.work();
  await store.coordinator.validate({ force: true });
  assert.equal(locks, 1, "scheduled strict retry still locks before dispatch");
  // A successful online/manual check resets the same policy used by the timer.
  authoritative = true;
  await store.coordinator.validate({ force: true });
  store.scheduleRetry(false);
  assert.equal([...timers.values()][0].ms, 5000);
  store.stop();
  assert.equal(timers.size, 0);
  store.scheduleRetry(true);
  assert.equal(timers.size, 0, "unmounted identity effect cannot restart recovery");
  assert.match(source, /if \(authTransitions\.blocked\(\)\)[\s\S]*?publishAuthoritativeGuest\(accountBeforeValidation\)/);
  assert.match(source, /scheduleRetry\(mustStayLocked, error\)/);
});

test("retry state never bypasses strict account locking, single flight or transient identity preservation", async () => {
  const retry = createSessionValidationRetry({ random: () => 0 });
  let calls = 0, locks = 0, complete;
  const coordinator = createSessionValidationCoordinator({
    onStrictRequest: () => { locks++; },
    run: async () => { calls++; return new Promise(resolve => { complete = resolve; }); },
  });
  retry.next(); retry.next();
  const request = coordinator.validate({ force: true, strict: true });
  await Promise.resolve();
  assert.equal(locks, 1, "an account change locks immediately during an outage");
  assert.equal(calls, 1);
  assert.equal(coordinator.validate({ force: true, reason: "retry" }), request);
  complete({ authoritative: false });
  await request;
  assert.equal(retry.next(), 20000);
  assert.equal(sessionValidationOutcome({ confirmed: true, accountId: "A", error: { status: 502 } }).preserveConfirmedUi, true);
  assert.equal(sessionValidationOutcome({ confirmed: false, error: { status: 502 } }).preserveConfirmedUi, false);
  retry.reset();
  assert.equal(retry.next(), 5000);
});
