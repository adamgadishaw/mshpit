import assert from "node:assert/strict";
import test from "node:test";

import {
  artistMemorialFromResponse,
  artistMemorialListFromResponse,
  artistMemorialPublicRequest,
  artistMemorialSaveRequest,
  artistMemorialSavedFromResponse,
} from "./artistMemorialRequest.mjs";
import { ARTIST_MEMORIAL_SPOTLIGHT_MS } from "../../domain/artistMemorial.mjs";

const NOW = Date.parse("2026-08-25T12:00:00.000Z");
const STARTED = NOW - 2 * 24 * 60 * 60 * 1000;

const command = (overrides = {}) => ({
  artistKey: "artist/key",
  status: "published",
  deathDate: "2024-05-17",
  summary: "A singular performer whose songs and live shows changed generations.",
  thankYou: "Thank you for leaving the music with us.",
  accomplishments: ["Three landmark albums", "Unforgettable live performances"],
  sourceUrl: "https://news.example.org/artist/confirmed#announcement",
  sourceTitle: "Official announcement",
  confirmedIndividual: true,
  restartSpotlight: false,
  ...overrides,
});

const stored = (overrides = {}) => ({
  artistKey: "artist/key",
  artistName: "The Artist",
  status: "published",
  deathDate: "2024-05-17",
  summary: "A singular performer whose songs and live shows changed generations.",
  thankYou: "Thank you for leaving the music with us.",
  accomplishments: ["Three landmark albums", "Unforgettable live performances"],
  sourceUrl: "https://news.example.org/artist/confirmed",
  sourceTitle: "Official announcement",
  publishedAt: STARTED,
  spotlightStartedAt: STARTED,
  updatedAt: NOW,
  ...overrides,
});

test("public and admin requests encode artist identity and bind the expected account", () => {
  assert.deepEqual(artistMemorialPublicRequest({ artistKey: " artist/key ", accountId: "account-a" }), {
    path: "/api/artists/artist%2Fkey/memorial",
    expectedAccountId: "account-a",
  });
  assert.equal(artistMemorialPublicRequest({ artistKey: "artist" }).expectedAccountId, undefined);
  assert.throws(() => artistMemorialPublicRequest({ artistKey: "" }), /valid artist key/i);
  assert.throws(() => artistMemorialPublicRequest({ artistKey: "artist\u202Ekey" }), /valid artist key/i);
});

test("save requests use keyed PUT data and require an explicit individual confirmation", () => {
  const request = artistMemorialSaveRequest(command({
    expectedArtistMbid: "12345678-1234-4234-8234-123456789ABC",
  }), { accountId: "admin-a", at: NOW });
  assert.equal(request.path, "/api/admin/artist-memorials/artist%2Fkey");
  assert.equal(request.expectedAccountId, "admin-a");
  assert.deepEqual(request.body, {
    status: "published",
    deathDate: "2024-05-17",
    summary: "A singular performer whose songs and live shows changed generations.",
    thankYou: "Thank you for leaving the music with us.",
    accomplishments: ["Three landmark albums", "Unforgettable live performances"],
    sourceUrl: "https://news.example.org/artist/confirmed",
    sourceTitle: "Official announcement",
    confirmedIndividual: true,
    restartSpotlight: false,
    expectedArtistMbid: "12345678-1234-4234-8234-123456789abc",
  });
  assert.throws(
    () => artistMemorialSaveRequest(command({ confirmedIndividual: false }), { at: NOW }),
    (error) => error?.field === "confirmedIndividual",
  );
  assert.throws(
    () => artistMemorialSaveRequest(command({ expectedArtistMbid: "not-an-mbid" }), { at: NOW }),
    /expected MusicBrainz identity/i,
  );
});

test("public responses are whitelisted and spotlight activity is recomputed locally", () => {
  const memorial = artistMemorialFromResponse({
    memorial: {
      deceased: true,
      deathDate: "2024-05-17",
      summary: "A singular performer whose songs and live shows changed generations.",
      thankYou: "Thank you for leaving the music with us.",
      accomplishments: ["Three landmark albums", "Unforgettable live performances"],
      citation: { url: "https://news.example.org/artist/confirmed", title: "Official announcement" },
      spotlight: { active: false, startedAt: STARTED, endsAt: STARTED + ARTIST_MEMORIAL_SPOTLIGHT_MS },
      internalNotes: "never retain this",
    },
  }, { at: NOW });
  assert.equal(memorial.spotlight.active, true);
  assert.equal(Object.hasOwn(memorial, "internalNotes"), false);
  assert.equal(artistMemorialFromResponse({ memorial: null }, { at: NOW }), null);
  assert.throws(() => artistMemorialFromResponse({ memorial: { deceased: true } }, { at: NOW }), /invalid/i);
});

test("admin list and save responses retain only editable and clock fields", () => {
  const list = artistMemorialListFromResponse({ memorials: [{ ...stored(), reviewerEmail: "private@example.org" }] }, { at: NOW });
  assert.equal(list.length, 1);
  assert.equal(list[0].artistKey, "artist/key");
  assert.equal(list[0].spotlightActive, true);
  assert.equal(Object.hasOwn(list[0], "reviewerEmail"), false);
  assert.deepEqual(artistMemorialSavedFromResponse({ memorial: stored() }, { at: NOW }), list[0]);
  assert.throws(() => artistMemorialListFromResponse({ memorials: [stored({ publishedAt: null })] }, { at: NOW }), /missing public timestamps/i);
  assert.throws(() => artistMemorialListFromResponse({ memorials: [stored({ spotlightStartedAt: NOW + 1 })] }, { at: NOW }), /inconsistent public timestamps/i);
});
