import assert from "node:assert/strict";
import test from "node:test";
import { discoverPhotoCity, discoverPhotoCountry } from "../../domain/discoverPhotoLocation.mjs";
import { discoverPhotosPresentation, discoverPhotosScope, fetchDiscoverPhotos, visibleDiscoverPhotos } from "./discoverPhotosApi.mjs";

test("photo geography accepts Toronto with province, explicit countries, and does not guess ambiguous London", () => {
  assert.equal(discoverPhotoCountry("Toronto"), "canada");
  assert.equal(discoverPhotoCountry("Toronto, Ontario"), "canada");
  assert.equal(discoverPhotoCountry("Toronto, Ontario, CA"), "canada");
  assert.equal(discoverPhotoCountry("Toronto, ON"), "canada");
  assert.equal(discoverPhotoCountry("Los Angeles, CA"), "united states");
  assert.equal(discoverPhotoCountry("London, ON"), "canada");
  assert.equal(discoverPhotoCountry("London"), "");
  assert.equal(discoverPhotoCountry("London, England"), "united kingdom");
  assert.equal(discoverPhotoCountry("New private venue, Canada"), "canada");
  assert.equal(discoverPhotoCountry("Unknown city"), "");
  assert.equal(discoverPhotoCity(" Toronto, Ontario "), "toronto");
});

test("Worldwide photo request has no implicit country or nearby city and failures reject", async () => {
  const calls = [];
  const photo = { uri: "https://media.example.test/toronto.webp", kind: "image", photosPublic: true };
  const apiClient = async (path, options) => { calls.push({ path, options }); return { photos: [photo] }; };
  assert.deepEqual(await fetchDiscoverPhotos({ apiClient }), [photo]);
  assert.equal(calls[0].path, "/api/discover/photos?limit=30");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.timeoutMs, 12_000);
  await fetchDiscoverPhotos({ apiClient, region: "CA" });
  assert.match(calls[1].path, /country=canada/);
  const failure = new Error("temporary backend failure");
  await assert.rejects(fetchDiscoverPhotos({ apiClient: async () => { throw failure; } }), failure);
  await assert.rejects(fetchDiscoverPhotos({ apiClient: async () => ({ photos: null }) }), /could not be read/);
});

test("photo result adapter rejects unsafe media and local removals and blocks apply immediately", async () => {
  const allowed = { postId: "public", ownerId: "owner", kind: "image", photosPublic: true, uri: "https://media.example.test/ok.webp" };
  const photos = await fetchDiscoverPhotos({ apiClient: async () => ({ photos: [allowed,
    { ...allowed, uri: "http://insecure.example/test.jpg" },
    { ...allowed, photosPublic: false }, { ...allowed, kind: "unknown" }, null,
  ] }) });
  assert.deepEqual(photos, [allowed]);
  assert.deepEqual(visibleDiscoverPhotos(photos, { removedIds: ["public"] }), []);
  assert.deepEqual(visibleDiscoverPhotos(photos, { blockedIds: ["owner"] }), []);
});

test("scope/account changes never present stale tiles or false empty while hydration is pending", () => {
  const member = discoverPhotosScope({ accountId: "member", region: "Canada" });
  const guest = discoverPhotosScope({ region: "Canada" });
  assert.notEqual(member, guest);
  assert.equal(guest, discoverPhotosScope({ region: "CA" }));
  const old = { scopeKey: member, status: "ready", photos: [{ id: "private-to-members" }] };
  assert.deepEqual(discoverPhotosPresentation(old, guest), { photos: [], status: "loading", error: false });
  assert.deepEqual(discoverPhotosPresentation(null, guest), { photos: [], status: "loading", error: false });
  assert.deepEqual(discoverPhotosPresentation({ scopeKey: guest, status: "error", photos: [] }, guest), { photos: [], status: "error", error: true });
});
