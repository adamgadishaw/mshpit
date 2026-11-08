import assert from "node:assert/strict";
import test from "node:test";
import { createIOSArtistAnnouncements, iosArtistLayout } from "./iosArtistPresentation.mjs";
import { artistReturnSnapshot, createIOSArtistReturnStore } from "./iosArtistReturn.mjs";
import { createBrowseScrollReturn } from "./iosBrowseReturn.mjs";

test("Artist detail Back restores only its retained frame, account and target", () => {
  const store = createIOSArtistReturnStore(), artist = {}, detail = {};
  store.reconcile("a", 1, [artist]);
  const lease = store.lease(artist, "Artist A");
  lease.save({ section: "about", scrollY: 600, openAlbum: 42, showAllReleases: true, reportText: "private", rows: [1] });
  store.reconcile("a", 1, [artist, detail]);
  store.reconcile("a", 1, [artist]);
  assert.equal(store.lease(artist, "Artist A"), lease);
  assert.deepEqual(lease.read(), { section: "about", scrollY: 600, openAlbum: 42, showAllReleases: true, showAllSongs: false });
  const scrolls = [], controller = createBrowseScrollReturn(lease.read().scrollY, lease.save);
  controller.onLayout({ nativeEvent: { layout: { height: 500 } } });
  controller.onContentSizeChange(300, 1500);
  controller.update({ scrollTo: value => scrolls.push(value) }, false);
  assert.equal(scrolls.length, 0);
  controller.update({ scrollTo: value => scrolls.push(value) }, true);
  assert.deepEqual(scrolls, [{ y: 600, animated: false }]);
  const fresh = {};
  store.reconcile("a", 1, [fresh]);
  assert.equal(store.lease(fresh, "Artist A").read(), undefined);
  lease.save({ section: "community" }); assert.equal(lease.read(), undefined);
  const replacement = store.lease(fresh, "Artist B");
  replacement.save({ section: "shows" });
  store.reconcile("b", 1, [fresh]);
  replacement.save({ section: "about" }); assert.equal(replacement.read(), undefined);
  const next = store.lease(fresh, "Artist B"); next.save({ section: "shows" });
  store.reconcile("b", 2, [fresh]); assert.equal(next.read(), undefined);
});

test("return snapshots are bounded and discard forms/data; evicted leases cannot write", () => {
  assert.deepEqual(artistReturnSnapshot({ section: "invalid", scrollY: Infinity, report: {}, data: [] }), { section: "overview", scrollY: 0, openAlbum: null, showAllSongs: false, showAllReleases: false });
  const store = createIOSArtistReturnStore(), frames = Array.from({ length: 13 }, () => ({}));
  store.reconcile("a", 1, frames);
  const first = store.lease(frames[0], "a");
  frames.slice(1).forEach(frame => store.lease(frame, "a"));
  first.save({ section: "about" }); assert.equal(first.read(), undefined);
});

test("font changes 1 → 2 → 3.1 → 1 change only presentation", () => {
  assert.deepEqual([1, 2, 3.1, 1].map(scale => iosArtistLayout("ios", scale)), [
    { largeText: false, singleColumn: false }, { largeText: true, singleColumn: false },
    { largeText: true, singleColumn: true }, { largeText: false, singleColumn: false },
  ]);
  for (const os of ["android", "web"]) assert.deepEqual(iosArtistLayout(os, 3.1), { largeText: false, singleColumn: false });
});

test("explicit outcomes speak once, queued; stale operations/toggles/background never speak", () => {
  let sequence = 0; const callbacks = new Map(), spoken = [];
  const announcements = createIOSArtistAnnouncements({ announce: (...args) => spoken.push(args), schedule: fn => { callbacks.set(++sequence, fn); return sequence; }, cancel: () => {} });
  announcements.configure("a:artist", true, true);
  const success = { notice: "Followed", busy: false };
  announcements.update(success, "Artist"); assert.equal(callbacks.size, 0);
  announcements.request(); announcements.update({ busy: true }, "Artist"); assert.equal(callbacks.size, 0);
  announcements.update({ ...success, scope: "stale:artist" }, "Artist"); assert.equal(callbacks.size, 0);
  announcements.update(success, "Artist"); announcements.update(success, "Artist");
  assert.equal(callbacks.size, 1); callbacks.get(1)(); callbacks.get(1)();
  assert.deepEqual(spoken, [["Followed", { queue: true }]]);
  for (const next of [["other:artist", true, true], ["a:artist", false, true], ["a:artist", true, false]]) {
    announcements.configure("a:artist", true, true); announcements.request(); announcements.update(success, "Artist");
    const pending = callbacks.get(sequence); announcements.configure(...next); pending();
  }
  assert.equal(spoken.length, 1);
  announcements.configure("a:artist", true, true); announcements.update(success, "Artist");
  assert.equal(spoken.length, 1, "reenabling does not replay old outcomes");
  announcements.request(); announcements.update({ error: "Could not join" }, "Artist");
  callbacks.get(sequence)(); assert.equal(spoken.at(-1)[0], "Could not join");
});
