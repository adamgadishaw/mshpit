import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createSessionValidationCoordinator,
  SESSION_RESUME_MIN_BACKGROUND_MS,
  SESSION_VALIDATION_FRESHNESS_MS,
  sessionValidationOutcome,
} from "./sessionValidation.mjs";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

test("brief returns do no validation and a stale foreground validates once", async () => {
  let clock = 1_000;
  let requests = 0;
  let strictLocks = 0;
  const coordinator = createSessionValidationCoordinator({
    now: () => clock,
    run: async () => {
      requests += 1;
      return { authoritative: true };
    },
    onStrictRequest: () => { strictLocks += 1; },
  });
  coordinator.markAuthoritative();

  coordinator.background();
  clock += SESSION_RESUME_MIN_BACKGROUND_MS - 1;
  assert.equal((await coordinator.resume()).reason, "brief-background");
  assert.equal(requests, 0);

  coordinator.background();
  clock += SESSION_RESUME_MIN_BACKGROUND_MS + 1;
  assert.equal((await coordinator.resume()).reason, "fresh");
  assert.equal(requests, 0);

  coordinator.background();
  clock += SESSION_VALIDATION_FRESHNESS_MS + 1;
  assert.equal((await coordinator.resume()).kind, "completed");
  assert.equal(requests, 1);
  assert.equal(strictLocks, 0);
});

test("overlapping foreground events share one request", async () => {
  let clock = 10_000;
  let requests = 0;
  const response = deferred();
  const coordinator = createSessionValidationCoordinator({
    now: () => clock,
    run: async () => {
      requests += 1;
      await response.promise;
      return { authoritative: true };
    },
  });
  coordinator.markAuthoritative();
  coordinator.background();
  clock += SESSION_VALIDATION_FRESHNESS_MS + 1;

  const first = coordinator.resume();
  const overlap = coordinator.validate({ force: true, reason: "duplicate-active" });
  assert.strictEqual(overlap, first);
  await Promise.resolve();
  assert.equal(requests, 1);
  response.resolve();
  await Promise.all([first, overlap]);
  assert.equal(requests, 1);
  assert.equal(coordinator.snapshot().inFlight, false);
});

test("an auth-epoch event supersedes a quiet request and waits for one fresh strict request", async () => {
  let requests = 0;
  let locks = 0;
  const contexts = [];
  const responses = [deferred(), deferred()];
  const coordinator = createSessionValidationCoordinator({
    run: async (context) => {
      const requestIndex = requests;
      requests += 1;
      contexts.push(context);
      await responses[requestIndex].promise;
      return { authoritative: true };
    },
    onStrictRequest: () => { locks += 1; },
  });

  const quiet = coordinator.validate({ force: true, reason: "resume" });
  await Promise.resolve();
  const strict = coordinator.validate({ force: true, strict: true, reason: "auth-epoch" });
  assert.strictEqual(strict, quiet);
  assert.equal(requests, 1);
  assert.equal(locks, 1);
  assert.equal(contexts[0].isSuperseded(), true);

  responses[0].resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests, 2);
  assert.equal(contexts[1].strictRequested, true);
  assert.equal(contexts[1].isSuperseded(), false);

  responses[1].resolve();
  await Promise.all([quiet, strict]);
  assert.equal(requests, 2);
});

test("validation outcomes separate unchanged identity, account switch, logout, and network failure", () => {
  assert.deepEqual(
    sessionValidationOutcome({ confirmed: true, accountId: "u_a", user: { id: "u_a" } }),
    { kind: "same-account", arrivingAccountId: "u_a" },
  );
  assert.deepEqual(
    sessionValidationOutcome({ confirmed: true, accountId: "u_a", user: { id: "u_b" } }),
    { kind: "account-changed", departingAccountId: "u_a", arrivingAccountId: "u_b" },
  );
  assert.deepEqual(
    sessionValidationOutcome({ confirmed: true, accountId: "u_a", user: null }),
    { kind: "authoritative-guest", departingAccountId: "u_a" },
  );
  assert.deepEqual(
    sessionValidationOutcome({ confirmed: true, accountId: "u_a", error: { status: 401 } }),
    { kind: "authoritative-guest", departingAccountId: "u_a" },
  );
  assert.deepEqual(
    sessionValidationOutcome({ confirmed: true, accountId: "u_a", error: new Error("offline") }),
    { kind: "transient-failure", preserveConfirmedUi: true },
  );
  assert.deepEqual(
    sessionValidationOutcome({ confirmed: true, accountId: "u_a", user: {} }),
    { kind: "invalid-response", preserveConfirmedUi: true },
  );
  assert.deepEqual(
    sessionValidationOutcome({ confirmed: false, accountId: null, user: { id: "   " } }),
    { kind: "invalid-response", preserveConfirmedUi: false },
  );
});

test("Store keeps same-account foreground validation mounted and skips account hydrations", () => {
  const source = readFileSync(new URL("../store.js", import.meta.url), "utf8");
  const validationStart = source.indexOf("// Cold boot blocks on the HttpOnly-cookie handshake.");
  const validationEnd = source.indexOf("// Server-first auth", validationStart);
  assert.ok(validationStart >= 0 && validationEnd > validationStart);
  const validation = source.slice(validationStart, validationEnd);
  const runStart = validation.indexOf("const runValidation = async");
  const requestStart = validation.indexOf('api("/api/me"', runStart);
  const requestBoundary = validation.slice(runStart, requestStart);

  assert.match(validation, /createSessionValidationCoordinator\(\{/);
  assert.match(validation, /coordinator\.resume\(\)/);
  assert.match(validation, /hydrateAccount: false/);
  assert.match(validation, /void revalidateCachedFeed\(\)/);
  assert.doesNotMatch(validation, /feedRefreshRef\.current\.wake\(\)/);
  assert.doesNotMatch(validation, /hydrateFeed\(/);
  assert.match(validation, /strict: true, reason: "auth-epoch"/);
  assert.match(validation, /context\.isSuperseded\(\)/);
  assert.match(validation, /outcome\.kind === "invalid-response"/);
  assert.match(validation, /window\.addEventListener\("pagehide", onPageHide\)/);
  assert.match(validation, /window\.addEventListener\("pageshow", onPageShow\)/);
  assert.match(requestBoundary, /if \(!confirmedBeforeValidation\) lockIdentity\(\)/);
  assert.doesNotMatch(requestBoundary, /sessionRef\.current = null/);
  assert.doesNotMatch(requestBoundary, /adoptFeedAccount\(null\)/);

  const absorbStart = source.indexOf("const absorbServerUser =");
  const hydrateStart = source.indexOf('api("/api/me/following")', absorbStart);
  assert.ok(absorbStart >= 0 && hydrateStart > absorbStart);
  assert.match(source.slice(absorbStart, hydrateStart), /if \(!hydrateAccount\) return merged/);
});
