import assert from "node:assert/strict";
import test from "node:test";
import { createIOSDetailRetention, iosDetailCanRetain, IOS_RETAINED_DETAIL_LIMIT } from "./iosDetailRetention.mjs";

const feed = Object.freeze({ tab: "feed" });
const artist = name => ({ artistName: name });
const profile = id => ({ profileId: id, profileHandle: `@${id}`, profileSection: "posts" });
const show = id => ({ openLog: { id } });
const post = id => ({ post: { id } });
function fixture(options) {
  const owner = createIOSDetailRetention(options);
  let frames = [feed], scope = "viewer:1", privacyRevision = 0, serial = 0;
  const prepare = (nextFrames = frames, extra = {}) => owner.plan({ frames: nextFrames, scope, privacyRevision,
    element: { marker: ++serial }, ...extra });
  function commit(nextFrames = frames, extra = {}, presented = true) {
    frames = nextFrames;
    const next = prepare(frames, extra);
    owner.commit(next);
    const active = next.entries.find(entry => entry.occurrence === next.top);
    if (active && presented) owner.ready(active, true, { active: true, privacyRevision: extra.privacyRevision ?? privacyRevision });
    return next;
  }
  return { owner, prepare, commit, get frames() { return frames; }, set scope(value) { scope = value; }, set privacy(value) { privacyRevision = value; } };
}
const active = plan => plan.entries.find(entry => entry.occurrence === plan.top);

test("only the four audited readable families and supported metadata are retained", () => {
  for (const frame of [artist("One"), profile("one"), show("one"), post("one")]) assert.equal(iosDetailCanRetain(frame), true);
  for (const frame of [null, [], {}, feed, { profileId: "" }, { artistName: "One", post: {} },
    { profileId: "one", edit: true }, { openLog: {}, report: null }, { profileHandle: "@one" }, { venueId: "one" }]) {
    assert.equal(iosDetailCanRetain(frame), false);
  }
});

test("initial direct or deep entry mounts only the presented top, never reconstructing a predecessor", () => {
  const f = fixture(), frames = [feed, profile("one"), artist("Two"), show("three")];
  const next = f.commit(frames);
  assert.equal(next.entries.length, 1);
  assert.equal(active(next).occurrence.frame, frames[3]);
  assert.equal(next.previous, null);
  assert.equal(next.history.length, 4);
});

test("push reveals the actual committed predecessor and stores its last committed raw element", () => {
  const f = fixture(), a = profile("one"), b = artist("Two");
  const first = f.commit([feed, a]), firstEntry = active(first), firstElement = first.elements.get(firstEntry);
  const second = f.commit([feed, a, b]);
  assert.equal(second.previous, firstEntry);
  assert.equal(second.elements.get(firstEntry), firstElement);
  assert.equal(second.entries.length, 2);
  assert.equal(f.owner.current(firstEntry), false);
  assert.equal(f.owner.current(active(second)), true);
});

test("Back retains the same occurrence and replaces its old callbacks with fresh active props", () => {
  const f = fixture(), a = profile("one"), b = show("two");
  const first = f.commit([feed, a]), entry = active(first), oldElement = first.elements.get(entry);
  f.commit([feed, a, b]);
  const fresh = { callbackGeneration: 3 }, back = f.commit([feed, a], { element: fresh });
  assert.equal(active(back), entry);
  assert.equal(back.elements.get(entry), fresh);
  assert.notEqual(back.elements.get(entry), oldElement);
  assert.equal(back.entries.length, 1);
  assert.equal(f.owner.current(entry), true);
});

test("duplicate targets remain separate occurrences, even when the same frame object is reused", () => {
  const f = fixture(), a = artist("One");
  const first = f.commit([feed, a]), lower = active(first);
  const second = f.commit([feed, a, a]), upper = active(second);
  assert.notEqual(lower, upper);
  assert.notEqual(lower.occurrence.id, upper.occurrence.id);
  assert.equal(second.previous, lower);
  assert.equal(active(f.commit([feed, a])), lower);
});

test("an unpresented lazy top is evicted on push and cannot become a fabricated backdrop", () => {
  const f = fixture(), a = profile("one"), b = artist("Two"), c = show("three");
  const first = f.commit([feed, a]), shown = active(first);
  const lazy = f.commit([feed, a, b], {}, false), waiting = active(lazy);
  const next = f.commit([feed, a, b, c]);
  assert.equal(next.entries.includes(waiting), false);
  assert.equal(next.entries.includes(shown), true);
  assert.equal(next.previous, null);
  assert.equal(next.history.length, 4);
});

test("a previously presented but currently suspended predecessor is evicted before it can mount hidden", () => {
  const f = fixture(), a = profile("one"), b = artist("Two");
  const first = f.commit([feed, a]), entry = active(first);
  f.owner.ready(entry, false);
  const next = f.commit([feed, a, b]);
  assert.equal(next.entries.includes(entry), false);
  assert.equal(next.previous, null);
  f.owner.ready(entry, true, { active: false, privacyRevision: 0 });
  assert.equal(f.prepare().previous, null, "an evicted Suspense completion cannot restore retention");
});

test("hidden readiness cannot mark an occurrence as previously presented", () => {
  const f = fixture(), a = artist("One");
  const next = f.commit([feed, a], {}, false), entry = active(next);
  f.owner.ready(entry, true, { active: false, privacyRevision: 0 });
  assert.equal(entry.ready, true);
  assert.equal(entry.presented, false);
});

test("privacy invalidation evicts every covered occurrence while preserving active mount identity", () => {
  const f = fixture(), a = profile("one"), b = artist("Two");
  const first = f.commit([feed, a]), covered = active(first);
  const second = f.commit([feed, a, b]), top = active(second);
  f.privacy = 1;
  const revoked = f.commit();
  assert.equal(active(revoked), top);
  assert.equal(revoked.entries.includes(covered), false);
  assert.equal(revoked.previous, null);
  assert.equal(top.privacyRevision, 0, "fresh active rendering must not restamp mount proof");
  assert.equal(f.owner.contains(covered), false);
});

test("an active mount from an older privacy generation cannot later reappear as a retained preview", () => {
  const f = fixture(), a = profile("one"), b = show("two");
  const first = f.commit([feed, a]), old = active(first);
  f.privacy = 1;
  f.commit();
  const pushed = f.commit([feed, a, b]);
  assert.equal(pushed.entries.includes(old), false);
  assert.equal(pushed.previous, null);
  const back = f.commit([feed, a]);
  assert.notEqual(active(back), old);
  assert.equal(active(back).privacyRevision, 1);
});

test("account or auth scope changes remount rather than reusing private state", () => {
  const f = fixture(), a = profile("one"), b = post("two");
  f.commit([feed, a]);
  const old = f.commit([feed, a, b]), oldTop = active(old);
  f.scope = "viewer:2";
  const next = f.commit();
  assert.equal(next.entries.length, 1);
  assert.notEqual(active(next), oldTop);
  assert.notEqual(active(next).occurrence, oldTop.occurrence);
  assert.equal(next.previous, null);
});

test("unsupported and protected routes are hard retention barriers without editing logical history", () => {
  const f = fixture(), a = profile("one"), composer = { log: {} }, b = show("two");
  f.commit([feed, a]);
  const protectedRoute = f.commit([feed, a, composer]);
  assert.deepEqual(protectedRoute.entries, []);
  assert.equal(protectedRoute.history.length, 3);
  const next = f.commit([feed, a, composer, b]);
  assert.equal(next.entries.length, 1);
  assert.equal(next.previous, null);
  assert.equal(next.history.length, 4);
});

test("disabling retention immediately clears mounted entries and reopening mounts only current top", () => {
  const f = fixture(), a = profile("one"), b = show("two");
  f.commit([feed, a]);
  const before = f.commit([feed, a, b]);
  assert.equal(f.commit(f.frames, { enabled: false }).entries.length, 0);
  const after = f.commit();
  assert.equal(after.entries.length, 1);
  assert.notEqual(active(before), active(after));
});

test("capacity is bounded without dropping navigation history or recreating evicted predecessors", () => {
  const f = fixture(), frames = [feed];
  for (let i = 0; i < IOS_RETAINED_DETAIL_LIMIT + 3; i++) { frames.push(profile(`p${i}`)); f.commit([...frames]); }
  const next = f.prepare();
  assert.equal(next.entries.length, IOS_RETAINED_DETAIL_LIMIT);
  assert.equal(next.history.length, IOS_RETAINED_DETAIL_LIMIT + 4);
  const back = f.commit(frames.slice(0, 4));
  assert.equal(back.entries.length, 1);
  assert.equal(back.previous, null);
  assert.equal(back.history.length, 4);
});

test("a replacement branch discards removed descendants but preserves the shared prefix", () => {
  const f = fixture(), a = profile("one"), b = artist("Two"), c = show("three"), d = post("four");
  const first = f.commit([feed, a]), lower = active(first);
  const branch = f.commit([feed, a, b, c]), oldTop = active(branch);
  const next = f.commit([feed, a, d]);
  assert.equal(next.previous, lower);
  assert.equal(next.entries.includes(oldTop), false);
  assert.equal(next.history.length, 3);
});

test("discarded concurrent plans cannot replace committed raw elements, evict mounts, or admit commands", () => {
  const f = fixture(), a = profile("one"), b = artist("Two");
  const first = f.commit([feed, a]), lower = active(first), element = first.elements.get(lower);
  const abandoned = f.prepare([feed, a, b], { element: { abandoned: true }, privacyRevision: 5 });
  assert.equal(f.owner.current(lower), true);
  assert.equal(f.owner.current(active(abandoned)), false);
  const real = f.prepare([feed, a, b]);
  assert.equal(real.previous, lower);
  assert.equal(real.elements.get(lower), element);
  assert.equal(real.entries.includes(active(abandoned)), false);
});

test("same target with a replacement frame object is a new occurrence, not stale state reuse", () => {
  const f = fixture(), first = f.commit([feed, profile("one")]);
  const next = f.commit([feed, profile("one")]);
  assert.notEqual(active(first), active(next));
  assert.equal(next.entries.length, 1);
});

test("readiness changes are idempotent and old generations cannot manufacture presentation proof", () => {
  const f = fixture(), next = f.commit([feed, profile("one")], {}, false), entry = active(next);
  assert.equal(f.owner.ready(entry, true, { active: true, privacyRevision: 1 }), true);
  assert.equal(entry.presented, false);
  assert.equal(f.owner.ready(entry, true, { active: true, privacyRevision: 1 }), false);
  assert.equal(f.owner.ready(entry, true, { active: true, privacyRevision: 0 }), true);
  assert.equal(f.owner.ready(entry, false), true);
  assert.equal(f.owner.ready(entry, false), false);
});
