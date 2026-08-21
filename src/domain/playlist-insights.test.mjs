import assert from "node:assert/strict";
import test from "node:test";

import {
  playlistCandidateVarietyNote,
  playlistHasTrack,
  playlistTrackIdentity,
  playlistVarietySummary,
} from "./playlist-insights.mjs";

test("playlist identity mirrors the server's strongest available track evidence", () => {
  assert.equal(playlistTrackIdentity({ videoId: "abcdefghijk", sourceId: "other" }), "youtube:abcdefghijk");
  assert.equal(playlistTrackIdentity({ url: "https://youtu.be/abcdefghijk?t=3" }), "youtube:abcdefghijk");
  assert.equal(playlistTrackIdentity({ url: "youtube.com/shorts/abcdefghijk" }), "youtube:abcdefghijk");
  assert.equal(playlistTrackIdentity({ url: "https://www.youtube-nocookie.com/embed/abcdefghijk" }), "youtube:abcdefghijk");
  assert.equal(playlistTrackIdentity({ sourceId: "ABC", provider: "Spotify" }), "source:spotify:abc");
  assert.equal(playlistTrackIdentity({ id: "ABC" }), "source:unknown:abc");
  assert.equal(playlistTrackIdentity({ url: "HTTPS://EXAMPLE.COM/Track" }), "url:https://example.com/track");
  assert.equal(playlistTrackIdentity({ title: "  Song ", artist: " Artist " }), "text:artist|song");
});

test("duplicate detection catches equivalent YouTube links before add", () => {
  const playlist = { tracks: [{ title: "Live", videoId: "abcdefghijk" }] };
  assert.equal(playlistHasTrack(playlist, { title: "Live again", url: "https://www.youtube.com/watch?v=abcdefghijk" }), true);
  assert.equal(playlistHasTrack(playlist, { title: "Studio", videoId: "12345678901" }), false);
});

test("variety summary reports only metadata supported by every track", () => {
  assert.equal(playlistVarietySummary([]), "0 songs");
  assert.equal(playlistVarietySummary([
    { title: "One", artist: "A", genre: "Rock" },
    { title: "Two", artist: "B", genres: ["Rock", "Soul"] },
    { title: "Three", artist: "A", genre: "Soul" },
  ]), "3 songs · 2 artists · 2 genres");
  assert.equal(playlistVarietySummary([
    { title: "One", artist: "A", genre: "Rock" },
    { title: "Two", artist: "", genre: "Soul" },
  ]), "2 songs · 2 genres");
  assert.equal(playlistVarietySummary([
    { title: "One", artist: "A", genre: "Rock" },
    { title: "Two", artist: "B" },
  ]), "2 songs · 2 artists");
});

test("candidate notes are factual and withhold variety claims when metadata is incomplete", () => {
  const playlist = [
    { title: "One", artist: "A", genre: "Rock" },
    { title: "Two", artist: "B", genre: "Rock" },
  ];
  assert.equal(playlistCandidateVarietyNote(playlist, { title: "Three", artist: "C", genre: "Soul" }), "Adds a new artist and a new genre to the mix.");
  assert.equal(playlistCandidateVarietyNote(playlist, { title: "Four", artist: "A", genre: "Soul" }), "Adds a new genre to the mix.");
  assert.equal(playlistCandidateVarietyNote([...playlist, { title: "Unknown" }], { title: "Five", artist: "D", genre: "Jazz" }), null);
  assert.equal(playlistCandidateVarietyNote(playlist, playlist[0]), "Already added");
});
