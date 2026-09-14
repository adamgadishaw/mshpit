import assert from "node:assert/strict";
import test from "node:test";
import { needsPublicFrameIdentity, resolvePublicFrameIdentity } from "./publicFrameIdentity.mjs";

test("already-authoritative artist/profile frames need no lookup and preserve selected context", async () => {
  for (const frame of [{ artistName: "A/B", artistPublicSlug: "artist-stable-2" }, { profileId: "u1", profileHandle: "fanone" }]) {
    assert.equal(needsPublicFrameIdentity(frame), false);
    const result = await resolvePublicFrameIdentity(frame, { resolveArtist() { assert.fail("Unnecessary lookup"); }, loadUser() { assert.fail("Unnecessary lookup"); } });
    assert.equal(result.frame, frame);
    assert.ok(result.path);
  }
  assert.equal(needsPublicFrameIdentity({ settings: true }), false);
  assert.equal(await resolvePublicFrameIdentity({ settings: true }), null);
});

test("missing artist identity uses the authoritative slug, never its guessed display-name slug", async () => {
  const frame = { artistName: "An alias", analytics: "selected" };
  const controller = new AbortController();
  const calls = [];
  const result = await resolvePublicFrameIdentity(frame, { signal: controller.signal, resolveArtist: async (...args) => {
    calls.push(args); return { name: "Canonical artist", publicSlug: "stored-collision-7", norm: "canonical artist" };
  } });
  assert.equal(calls[0][0], "An alias");
  assert.equal(calls[0][1].signal, controller.signal);
  assert.equal(result.path, "/artist/stored-collision-7");
  assert.equal(result.frame.artistName, "Canonical artist");
  assert.equal(result.frame.analytics, "selected");
  assert.equal(frame.artistPublicSlug, undefined);
});

test("unresolved, transient and malformed artist slugs stay unavailable instead of inventing a route", async () => {
  for (const artist of [null, { name: "Name only" }, { publicSlug: "provider-preview", transient: true }, { publicSlug: "not/a/slug" }, { publicSlug: "Unnormalized Name" }]) {
    assert.equal(await resolvePublicFrameIdentity({ artistName: "A band" }, { resolveArtist: async () => artist }), null);
  }
  assert.equal(needsPublicFrameIdentity({ artistName: "Preview" }, { resolveArtistMeta: () => ({ publicSlug: "preview", transient: true }) }), true);
});

test("archive identity keeps archive intent and resolves the stored artist key", async () => {
  const result = await resolvePublicFrameIdentity({ artistArchive: { name: "Band", focus: "history" } }, { resolveArtist: async () => ({ name: "Band", norm: "band key", publicSlug: "band-2" }) });
  assert.equal(result.path, "/artist/band-2/concerts");
  assert.equal(result.frame.artistArchive.artistKey, "band key");
  assert.equal(result.frame.artistArchive.focus, "history");
});

test("profile lookup accepts only a ready matching account and preserves its authoritative handle", async () => {
  const frame = { profileId: "u1" };
  const good = await resolvePublicFrameIdentity(frame, { loadUser: async () => ({ status: "ready", user: { id: "u1", handle: "newhandle" } }) });
  assert.deepEqual(good, { frame: { profileId: "u1", profileHandle: "newhandle" }, path: "/u/newhandle" });
  for (const result of [null, { status: "stale", user: { id: "u1", handle: "old" } }, { status: "unavailable" }, { status: "ready", user: { id: "u2", handle: "wrong" } }, { status: "ready", user: { id: "u1" } }]) {
    assert.equal(await resolvePublicFrameIdentity(frame, { loadUser: async () => result }), null);
  }
});

test("artist-owned profiles resolve to their artist page, not a duplicate fan profile", async () => {
  const result = await resolvePublicFrameIdentity({ profileId: "u_artist" }, {
    loadUser: async () => ({ status: "ready", user: { id: "u_artist", handle: "artistuser" } }),
    profileFrame: (id, user) => ({ artistName: "Public band" }),
    resolveArtist: async () => ({ name: "Public band", publicSlug: "public-band" }),
  });
  assert.equal(result.path, "/artist/public-band");
  assert.equal(result.frame.profileId, undefined);
});

test("cancellation rejects promptly even when an older lookup implementation ignores its signal", async () => {
  let finish;
  const controller = new AbortController();
  const result = resolvePublicFrameIdentity({ artistName: "Delayed" }, { signal: controller.signal, resolveArtist: () => new Promise((resolve) => { finish = resolve; }) });
  controller.abort();
  await assert.rejects(result, (error) => error.name === "AbortError");
  finish({ publicSlug: "too-late" });
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(resolvePublicFrameIdentity({ profileId: "u1" }, { signal: alreadyAborted.signal, loadUser() { assert.fail("Aborted lookup must never start"); } }), (error) => error.name === "AbortError");
});

test("transport errors propagate to the caller's retry UI", async () => {
  const failure = new Error("Temporary read failure");
  await assert.rejects(resolvePublicFrameIdentity({ artistName: "Band" }, { resolveArtist: async () => { throw failure; } }), (error) => error === failure);
});
