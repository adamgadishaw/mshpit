import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createArtistLookupController, artistLookupRetryDelay } from "./artistLookupController.mjs";
import { artistLookupFailureMessage } from "./artistSearchApi.mjs";

const failure = (hint) => Object.assign(new Error("Directory unavailable"), { serverCode: "PROVIDER_UNAVAILABLE", status: 502, retryAfterMs: hint });

test("rapid clicks start once and cancellation/account roundtrips cannot revive an old request", () => {
  const control = createArtistLookupController();
  const first = control.begin("account-a", "Original");
  assert.ok(first);
  assert.equal(control.begin("account-a", "Original"), null);
  control.cancel();
  assert.equal(first.controller.signal.aborted, true);
  assert.equal(control.isCurrent(first), false);
  const edited = control.begin("account-a", "Edited");
  control.reset();
  const foreign = control.begin("account-b", "Original");
  control.reset();
  const current = control.begin("account-a", "Original");
  assert.equal(control.isCurrent(first), false);
  assert.equal(control.isCurrent(edited), false);
  assert.equal(control.isCurrent(foreign), false);
  assert.equal(control.isCurrent(current), true);
  control.finish(first);
  assert.equal(control.isCurrent(current), true, "late cleanup cannot unlock the current request");
});

test("directory outage cooldown survives edits, honors finite hints, and enables only a manual retry", () => {
  let now = 10_000;
  const control = createArtistLookupController({ clock: () => now });
  const first = control.begin("account-a", "Unknown");
  assert.equal(control.fail(first, failure(1000)), now + 1000);
  control.finish(first);
  control.cancel();
  assert.equal(control.begin("account-a", "Another unknown"), null, "one-letter edits cannot bypass a provider outage");
  now += 999;
  assert.equal(control.begin("account-a", "Unknown"), null);
  now += 1;
  const retry = control.begin("account-a", "Unknown");
  assert.ok(retry);
  assert.equal(control.retryAt("account-a"), 0);
  assert.equal(control.fail(first, failure()), 0, "obsolete failures cannot extend the cooldown");
});

test("only provider unavailable and rate-limit errors impose a bounded cooldown, never auth", () => {
  assert.equal(artistLookupRetryDelay(failure()), 30_000);
  for (const hint of [NaN, Infinity, -1]) assert.equal(artistLookupRetryDelay(failure(hint)), 30_000);
  assert.equal(artistLookupRetryDelay(failure(999_999_999)), 3_600_000);
  assert.equal(artistLookupRetryDelay({ status: 429, retryAfterMs: 7000 }), 7000);
  for (const error of [{ status: 401 }, { status: 403 }, { code: "PIT-AUTH-004" }, { status: 502 }, { name: "AbortError" }, { ...failure(), retryable: false }]) {
    assert.equal(artistLookupRetryDelay(error), 0);
  }
});

const source = readFileSync(new URL("../../screens/SearchScreen.jsx", import.meta.url), "utf8");
const start = source.indexOf("  const lookUp = async (name) => {");
const end = source.indexOf("  const openTicket =", start);
assert.ok(start >= 0 && end > start);

function screenLookupFixture() {
  const control = createArtistLookupController();
  const lookupScopeRef = { current: "account-a:query" };
  const updates = [], opened = [], requests = [], recent = [];
  const scope = "account-a:query";
  const resolveArtist = (name, options) => new Promise((resolve, reject) => requests.push({ name, options, resolve, reject }));
  const make = new Function("lookupRequestRef", "searchAccountScope", "lookupScope", "lookupScopeRef", "updateLookupState", "resolveArtist", "addRecentSearch", "onOpenArtist", "artistLookupFailureMessage", source.slice(start, end) + "\nreturn lookUp;");
  const lookUp = make({ current: control }, "account-a", scope, lookupScopeRef,
    value => updates.push(value), resolveArtist, value => recent.push(value), value => opened.push(value), artistLookupFailureMessage);
  return { control, lookupScopeRef, updates, opened, requests, recent, lookUp };
}

test("actual Search action retains the typed request on failure and blocks rapid duplicate work", async () => {
  const f = screenLookupFixture();
  const first = f.lookUp("Typed Artist");
  await f.lookUp("Typed Artist");
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].name, "Typed Artist");
  assert.ok(f.requests[0].options.signal);
  f.requests[0].reject(failure());
  await first;
  assert.equal(f.opened.length, 0);
  assert.equal(f.recent.length, 0);
  assert.match(f.updates.find(row => row.message)?.message, /temporarily unavailable/);
  assert.deepEqual(f.updates.at(-1), { busy: false });
  await f.lookUp("Typed Artist");
  assert.equal(f.requests.length, 1);
});

test("actual Search action does not navigate after a text/account cancellation, and previews stay transient", async () => {
  const stale = screenLookupFixture();
  const pending = stale.lookUp("Old Query");
  stale.control.reset();
  stale.lookupScopeRef.current = "account-b:query";
  stale.lookupScopeRef.current = "account-a:query";
  assert.equal(stale.requests[0].options.signal.aborted, true);
  stale.requests[0].resolve({ name: "Old Query", transient: true });
  await pending;
  assert.equal(stale.opened.length, 0);
  const fresh = screenLookupFixture();
  const current = fresh.lookUp("Fresh");
  fresh.requests[0].resolve({ key: "fresh", name: "Fresh", publicSlug: "fresh", transient: true });
  await current;
  assert.equal(fresh.opened[0].transient, true);
});

test("choosing a saved artist synchronously cancels directory lookup before navigating", () => {
  const start = source.indexOf("  const openArtist = (artist) => {");
  const end = source.indexOf("  const openVenue =", start);
  const control = createArtistLookupController();
  const pending = control.begin("account-a", "Unknown");
  const opened = [];
  const openArtist = new Function("lookupRequestRef", "updateLookupState", "addRecentSearch", "onOpenArtist",
    source.slice(start, end) + "\nreturn openArtist;")({ current: control }, () => {}, () => {}, value => {
    assert.equal(pending.controller.signal.aborted, true);
    opened.push(value);
  });
  const saved = { name: "Saved", key: "saved", publicSlug: "saved-canonical" };
  openArtist(saved);
  assert.equal(opened[0], saved);
  assert.equal(control.isCurrent(pending), false);
});
