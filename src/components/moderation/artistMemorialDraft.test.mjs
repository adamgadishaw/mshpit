import assert from "node:assert/strict";
import test from "node:test";

import {
  ARTIST_MEMORIAL_LIMITS,
  parseArtistMemorialAdminPayload,
} from "../../domain/artistMemorial.mjs";
import {
  createArtistMemorialDraft,
  isMemorialDraftCandidate,
  memorialDraftCandidates,
} from "./artistMemorialDraft.mjs";

const dolly = Object.freeze({
  name: "Dolly Parton",
  genre: "Folk",
  country: "United States",
  status: "active",
  beginYear: "1946",
  endYear: null,
  albums: Object.freeze([
    Object.freeze({ title: "The Great Pretender", year: "1984", type: "Album" }),
    Object.freeze({ title: "Burlap & Satin", year: "1983", type: "Album" }),
    Object.freeze({ title: "The Great Pretender", year: "1984", type: "Album" }),
  ]),
});

test("memorial autofill creates a private, catalog-grounded draft", () => {
  const draft = createArtistMemorialDraft({
    artistKey: "dolly parton",
    artist: dolly,
    deathDate: "2026-08-25",
    sourceTitle: "Associated Press confirmation",
    sourceUrl: "https://news.example.org/dolly-parton",
  });

  assert.deepEqual(draft, {
    artistKey: "dolly parton",
    status: "draft",
    deathDate: "2026-08-25",
    summary: "Pit remembers Dolly Parton. Dolly Parton is cataloged under Folk. Pit lists United States as the artist's country. The catalog includes The Great Pretender (1984).",
    thankYou: "Thank you, Dolly Parton, for the music.",
    accomplishmentsText: "Catalog genre: Folk\nCatalog country: United States\nCatalog release: The Great Pretender (1984)\nCatalog release: Burlap & Satin (1983)",
    sourceUrl: "https://news.example.org/dolly-parton",
    sourceTitle: "Associated Press confirmation",
    restartSpotlight: false,
  });

  const parsed = parseArtistMemorialAdminPayload({
    status: draft.status,
    deathDate: draft.deathDate,
    summary: draft.summary,
    thankYou: draft.thankYou,
    accomplishments: draft.accomplishmentsText.split("\n"),
    sourceUrl: draft.sourceUrl,
    sourceTitle: draft.sourceTitle,
    confirmedIndividual: true,
  }, { at: Date.parse("2026-08-25T12:00:00.000Z") });
  assert.equal(parsed.valid, true);
});

test("autofill preserves intentional form content while remaining a draft", () => {
  const existingForm = {
    artistKey: "DOLLY PARTON",
    status: "published",
    deathDate: "2025-01-02",
    summary: "Staff wrote this deliberate summary and it must remain untouched.",
    thankYou: "A personal thank-you from the Pit team.",
    accomplishmentsText: "A staff-verified career fact",
    sourceTitle: "Existing source",
    sourceUrl: "https://existing.example.org/announcement",
    restartSpotlight: true,
  };
  const draft = createArtistMemorialDraft({
    artistKey: "dolly parton",
    artist: dolly,
    deathDate: "2026-08-25",
    sourceTitle: "Replacement source",
    sourceUrl: "https://replacement.example.org/announcement",
    existingForm,
  });

  assert.equal(draft.status, "draft");
  assert.equal(draft.restartSpotlight, false);
  for (const field of ["deathDate", "summary", "thankYou", "accomplishmentsText", "sourceTitle", "sourceUrl"]) {
    assert.equal(draft[field], existingForm[field], field);
  }
});

test("autofill never carries identity-scoped facts to a different artist", () => {
  const draft = createArtistMemorialDraft({
    artistKey: "another artist",
    artist: { name: "Another Artist", genre: "Rock" },
    existingForm: {
      artistKey: "dolly parton",
      status: "published",
      deathDate: "2025-01-02",
      summary: "Dolly-specific memorial copy that must not cross identities.",
      thankYou: "Dolly-specific thank-you.",
      accomplishmentsText: "Dolly-specific accomplishment",
      sourceTitle: "Dolly source",
      sourceUrl: "https://existing.example.org/dolly-announcement",
      restartSpotlight: true,
    },
  });

  assert.deepEqual(draft, {
    artistKey: "another artist",
    status: "draft",
    deathDate: "",
    summary: "Pit remembers Another Artist. Another Artist is cataloged under Rock.",
    thankYou: "Thank you, Another Artist, for the music.",
    accomplishmentsText: "Catalog genre: Rock",
    sourceUrl: "",
    sourceTitle: "",
    restartSpotlight: false,
  });
});

test("missing catalog metadata produces useful copy without invented facts", () => {
  const draft = createArtistMemorialDraft({ artistKey: "catalog/key", artist: {} });
  assert.deepEqual(draft, {
    artistKey: "catalog/key",
    status: "draft",
    deathDate: "",
    summary: "Pit remembers catalog/key.",
    thankYou: "Thank you, catalog/key, for the music.",
    accomplishmentsText: "Pit catalog artist: catalog/key",
    sourceUrl: "",
    sourceTitle: "",
    restartSpotlight: false,
  });
  assert.doesNotMatch(`${draft.summary}\n${draft.thankYou}\n${draft.accomplishmentsText}`, /\b(?:died|death|passed away|award|winner)\b/iu);
});

test("catalog life-span years are never converted into career, death-date, or death claims", () => {
  const draft = createArtistMemorialDraft({
    artistKey: "the artist",
    artist: { name: "The Artist", beginYear: "1970", endYear: "2024", status: "dissolved" },
  });
  assert.equal(draft.deathDate, "");
  assert.doesNotMatch(draft.accomplishmentsText, /1970|2024|date|career/iu);
  assert.doesNotMatch(`${draft.summary}\n${draft.thankYou}\n${draft.accomplishmentsText}`, /\b(?:died|death|passed away)\b/iu);
});

test("invalid or over-limit factual inputs are omitted instead of silently altered", () => {
  const draft = createArtistMemorialDraft({
    artistKey: "the artist",
    artist: { name: "The Artist" },
    deathDate: "2026-08-25-extra",
    sourceTitle: "s".repeat(ARTIST_MEMORIAL_LIMITS.sourceTitle + 1),
    sourceUrl: `https://news.example.org/${"x".repeat(ARTIST_MEMORIAL_LIMITS.sourceUrl)}`,
  });
  assert.equal(draft.deathDate, "");
  assert.equal(draft.sourceTitle, "");
  assert.equal(draft.sourceUrl, "");
  assert.throws(
    () => createArtistMemorialDraft({ artistKey: "x".repeat(181), artist: { name: "The Artist" } }),
    /canonical artist key/i,
  );
});

test("generated fields are deterministic, deduplicated, sanitized, and bounded", () => {
  const artist = {
    name: `Name\u202e${"x".repeat(200)}`,
    genre: "  Dream   Pop  ",
    country: "Canada\u0000",
    albums: Array.from({ length: 12 }, (_, index) => ({
      title: index < 2 ? "Same Album" : `Album ${index} ${"z".repeat(200)}`,
      year: index === 2 ? "not-a-year" : "2001",
    })),
  };
  const input = { artistKey: "safe artist", artist };
  const first = createArtistMemorialDraft(input);
  const second = createArtistMemorialDraft(input);
  assert.deepEqual(first, second);
  assert.equal(first.summary.length <= ARTIST_MEMORIAL_LIMITS.summary, true);
  assert.equal(first.thankYou.length <= ARTIST_MEMORIAL_LIMITS.thankYou, true);
  const lines = first.accomplishmentsText.split("\n");
  assert.equal(lines.length <= ARTIST_MEMORIAL_LIMITS.accomplishments, true);
  assert.equal(lines.every((line) => line.length <= ARTIST_MEMORIAL_LIMITS.accomplishment), true);
  assert.equal(lines.filter((line) => line.includes("Same Album")).length, 1);
  assert.doesNotMatch(JSON.stringify(first), /[\u0000\u202e]/u);
  assert.equal(artist.name.includes("\u202e"), true, "input remains untouched");
});

test("a canonical key is required", () => {
  assert.throws(() => createArtistMemorialDraft(), /canonical artist key/i);
  assert.throws(() => createArtistMemorialDraft({ artist: { name: "No key" } }), /canonical artist key/i);
  assert.equal(createArtistMemorialDraft({ artist: { key: "artist-key", name: "Artist" } }).artistKey, "artist-key");
});

test("the picker keeps only unique MusicBrainz-backed catalog identities", () => {
  const valid = { key: "dolly parton", name: "Dolly Parton", mbid: "1d543e07-d0d2-4834-a8db-d65c50c2a856" };
  const second = { key: "another artist", name: "Another Artist", mbid: "22345678-1234-4234-8234-123456789abc" };
  assert.equal(isMemorialDraftCandidate(valid), true);
  for (const invalid of [
    null,
    { ...valid, key: "" },
    { ...valid, name: "" },
    { ...valid, mbid: null },
    { ...valid, mbid: "not-an-mbid" },
  ]) assert.equal(isMemorialDraftCandidate(invalid), false);
  assert.deepEqual(memorialDraftCandidates([valid, valid, { ...valid, mbid: "bad" }, second], { limit: 1 }), [valid]);
  assert.deepEqual(memorialDraftCandidates([valid, valid, second]), [valid, second]);
});
