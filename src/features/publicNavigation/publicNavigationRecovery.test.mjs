import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createArtistLookupController } from "../artistSearch/artistLookupController.mjs";
import { artistLookupFailureMessage } from "../artistSearch/artistSearchApi.mjs";
import { needsPublicFrameIdentity } from "../../domain/publicFrameIdentity.mjs";
import { recoverPublicNavigation } from "./publicNavigationRecovery.mjs";

const source = readFileSync(new URL("../../../App.js", import.meta.url), "utf8");
const start = source.indexOf("  const navigateCandidate = async");
const end = source.indexOf("  const go =", start);
assert.ok(start >= 0 && end > start);
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture({ loader } = {}) {
  let now = 1_000;
  const calls = [], notices = [], committed = [];
  const publicLookup = { lookup: null };
  const session = { id: "a" }, sessionRef = { current: session }, publicRouteRequestRef = { current: null };
  const publicNavigationPendingRef = { current: null }, publicLookupOwnerRef = { current: publicLookup };
  const cancelPublicRoute = () => { publicLookup.lookup?.cancel(); publicNavigationPendingRef.current = null; publicRouteRequestRef.current?.abort(); publicRouteRequestRef.current = null; };
  const commit = (frame) => { cancelPublicRoute(); committed.push(frame); };
  const bindings = {
    remoteArtistMeta: () => null, userById: () => null, commitGo: commit, commitReplace: commit,
    web: true, needsPublicFrameIdentity, publicNavigationPendingRef, publicLookupOwnerRef,
    createArtistLookupController: () => createArtistLookupController({ clock: () => now }), artistLookupFailureMessage,
    cancelPublicRoute, publicLookup, publicLookupScope: "a", session, sessionRef, publicRouteRequestRef,
    loadPublicRecovery: loader || (async () => ({ recoverPublicNavigation })),
    setPublicNavigationNotice: (value) => notices.push(value),
    resolveNavigationArtist: (name, options) => new Promise((resolve, reject) => calls.push({ kind: "artist", name, options, resolve, reject })),
    loadUser: (id, options) => new Promise((resolve, reject) => calls.push({ kind: "profile", id, options, resolve, reject })),
    publicIdentityFrame: (id, user) => user.artistName ? { artistName: user.artistName } : { profileId: id },
  };
  const navigate = new Function(...Object.keys(bindings), `${source.slice(start, end)}\nreturn navigateCandidate;`)(...Object.values(bindings));
  return { navigate, calls, notices, committed, publicLookup, sessionRef, cancelPublicRoute,
    changeOwner: () => { publicLookupOwnerRef.current = {}; }, advance: (ms) => { now += ms; } };
}

test("web navigation blocks rapid duplicate lookup and preserves a provider cooldown across targets", async () => {
  const f = fixture();
  const first = f.navigate({ artistName: "Unknown" });
  await f.navigate({ artistName: "Unknown" });
  assert.equal(f.calls.length, 1);
  const error = Object.assign(new Error("Provider down"), { serverCode: "PROVIDER_UNAVAILABLE", status: 502, retryAfterMs: 7_200_000, retryAt: 7_201_000 });
  f.calls[0].reject(error); await first;
  assert.equal(f.notices.at(-1).error, error); assert.equal(f.committed.length, 0);
  await f.navigate({ artistName: "Other" });
  assert.equal(f.calls.length, 1, "changing the target cannot bypass provider cooldown");
  f.advance(7_200_000);
  assert.equal(f.calls.length, 1, "there is no scheduled automatic retry");
  const retry = f.navigate({ artistName: "Unknown" });
  await settle();
  assert.equal(f.calls.length, 2);
  f.calls[1].resolve({ name: "Unknown", publicSlug: "stored", key: "stored" }); await retry;
  assert.equal(f.committed[0].artistPublicSlug, "stored");
});

test("replacement navigation cancels old lookup and rejects a late success", async () => {
  const f = fixture();
  const old = f.navigate({ artistName: "Old" });
  await settle();
  const next = f.navigate({ artistName: "Next" });
  await settle();
  assert.equal(f.calls[0].options.signal.aborted, true);
  f.calls[0].resolve({ name: "Old", publicSlug: "old" }); await old;
  assert.equal(f.committed.length, 0);
  f.calls[1].resolve(null); await next;
  assert.match(f.notices.at(-1).message, /does not have an available page/);
  assert.equal(f.notices.at(-1).error, undefined, "confirmed missing identity is not a provider failure");
});

test("account cancellation fences old navigation, while stored links bypass directory cooldown", async () => {
  const f = fixture();
  const old = f.navigate({ artistName: "Old" });
  await settle();
  f.publicLookup.lookup.reset(); f.sessionRef.current = { id: "b" }; f.sessionRef.current = { id: "a" };
  f.calls[0].resolve({ name: "Old", publicSlug: "old" }); await old;
  assert.equal(f.committed.length, 0);
  await f.navigate({ artistName: "Saved", artistPublicSlug: "saved" });
  assert.equal(f.calls.length, 1); assert.equal(f.committed[0].artistPublicSlug, "saved");
});

test("an artist outage does not block an unrelated unresolved user profile", async () => {
  const f = fixture();
  const artist = f.navigate({ artistName: "Unavailable" });
  await settle();
  f.calls[0].reject(Object.assign(new Error("Provider down"), { serverCode: "PROVIDER_UNAVAILABLE", retryAt: 7_201_000 }));
  await artist;
  const profile = f.navigate({ profileId: "user-a" });
  await settle();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].kind, "profile");
  f.calls[1].resolve({ status: "ready", user: { id: "user-a", handle: "available-user" } }); await profile;
  assert.equal(f.committed[0].profileHandle, "available-user");
  assert.equal(f.calls.filter((call) => call.kind === "artist").length, 1);
});

test("same artist with a different destination or transition replaces pending navigation", async () => {
  for (const nextTarget of [
    { candidate: { artistArchive: { name: "Unknown", focus: "history" } }, transition: undefined },
    { candidate: { artistName: "Unknown" }, transition: "replace" },
  ]) {
    const f = fixture();
    const old = f.navigate({ artistName: "Unknown" });
    await settle();
    const next = f.navigate(nextTarget.candidate, nextTarget.transition);
    await settle();
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[0].options.signal.aborted, true);
    f.calls[0].resolve({ name: "Unknown", key: "old", publicSlug: "old" }); await old;
    assert.equal(f.committed.length, 0);
    f.calls[1].resolve({ name: "Unknown", key: "correct", publicSlug: "correct" }); await next;
    const frame = f.committed[0];
    assert.equal(frame.artistArchive?.publicSlug || frame.artistPublicSlug, "correct");
    if (nextTarget.candidate.artistArchive) assert.equal(frame.artistArchive.focus, "history");
  }
});

test("an obsolete profile read cannot dispatch a projected artist lookup before passive cancellation", async () => {
  const f = fixture();
  const pending = f.navigate({ profileId: "artist-user" }); await settle();
  assert.equal(f.calls[0].kind, "profile");
  f.changeOwner();
  f.calls[0].resolve({ status: "ready", user: { id: "artist-user", artistName: "Artist" } });
  await pending;
  assert.equal(f.calls.length, 1);
  assert.equal(f.committed.length, 0);
});

test("cancelling during recovery module loading cannot dispatch an obsolete artist request", async () => {
  let completeLoad;
  const loaded = new Promise(resolve => { completeLoad = resolve; });
  const f = fixture({ loader: () => loaded });
  const pending = f.navigate({ artistName: "Old" });
  f.cancelPublicRoute();
  completeLoad({ recoverPublicNavigation });
  await pending;
  assert.equal(f.calls.length, 0);
  assert.equal(f.committed.length, 0);
});

test("recovery chunk failure remains a recoverable manual navigation error", async () => {
  let attempts = 0;
  const f = fixture({ loader: async () => {
    if (++attempts === 1) throw new Error("Chunk unavailable");
    return { recoverPublicNavigation };
  } });
  await f.navigate({ artistName: "Unknown" });
  assert.match(f.notices.at(-1).error.message, /Chunk unavailable/);
  assert.equal(f.calls.length, 0);
  const retry = f.navigate({ artistName: "Unknown" }); await settle();
  assert.equal(f.calls.length, 1);
  f.calls[0].resolve({ name: "Unknown", publicSlug: "known" }); await retry;
  assert.equal(f.committed[0].artistPublicSlug, "known");
});
