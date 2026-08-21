import assert from "node:assert/strict";
import test from "node:test";

import {
  listeningHistoryReplayTrack,
  listeningHistoryRowKey,
  listeningHistoryScopeCopy,
  listeningHistoryViewState,
} from "./listeningHistoryView.mjs";

test("history replay keeps provider identity without turning the play event into a track id", () => {
  const track = listeningHistoryReplayTrack({
    playId: "event-7",
    id: "catalog-3",
    sourceId: "source-4",
    provider: "deezer",
    title: "  Nights  ",
    artist: "  Frank Ocean  ",
    videoId: "video-5",
    at: 100,
  });
  assert.equal(track.kind, "track");
  assert.equal(track.title, "Nights");
  assert.equal(track.id, "catalog-3");
  assert.equal(track.playId, "event-7");
  assert.equal(track.videoId, "video-5");
  assert.equal(listeningHistoryReplayTrack({ title: "No artist" }), null);
});

test("play events have stable distinct list keys, including repeated songs", () => {
  const song = { title: "Nights", artist: "Frank Ocean", at: 100 };
  assert.notEqual(listeningHistoryRowKey(song, 0), listeningHistoryRowKey(song, 1));
  assert.equal(listeningHistoryRowKey({ ...song, playId: "p1" }, 9), "play:p1");
});

test("history UI separates initial, empty, ready, paging, and account-handoff states", () => {
  assert.equal(listeningHistoryViewState({ signedIn: false }), "signed-out");
  assert.equal(listeningHistoryViewState({ signedIn: true, scoped: false, rows: [{ title: "stale" }] }), "loading");
  assert.equal(listeningHistoryViewState({ signedIn: true, status: "loading", rows: [] }), "loading");
  assert.equal(listeningHistoryViewState({ signedIn: true, status: "error", rows: [] }), "error");
  assert.equal(listeningHistoryViewState({ signedIn: true, status: "ready", rows: [] }), "empty");
  assert.equal(listeningHistoryViewState({ signedIn: true, status: "loading", rows: [{}] }), "refreshing");
  assert.equal(listeningHistoryViewState({ signedIn: true, status: "loading-more", rows: [{}] }), "loading-more");
  assert.equal(listeningHistoryViewState({ signedIn: true, status: "error", errorMode: "refresh", rows: [{}] }), "refresh-error");
  assert.equal(listeningHistoryViewState({ signedIn: true, status: "error", errorMode: "more", rows: [{}] }), "page-error");
  assert.equal(listeningHistoryViewState({ signedIn: true, status: "ready", rows: [{}] }), "ready");
});

test("history disclosure never claims a lifetime total", () => {
  assert.match(listeningHistoryScopeCopy(50, true), /history window/);
  assert.match(listeningHistoryScopeCopy(1, false), /not a lifetime/);
});
