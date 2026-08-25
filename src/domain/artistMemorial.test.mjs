import test from "node:test";
import assert from "node:assert/strict";

import {
  ARTIST_MEMORIAL_SPOTLIGHT_MS,
  parseArtistMemorialAdminPayload,
  projectArtistMemorialPublic,
  transitionArtistMemorial,
} from "./artistMemorial.mjs";

const NOW = Date.parse("2026-08-25T12:00:00.000Z");

const payload = (overrides = {}) => ({
  status: "published",
  deathDate: "2024-05-17",
  summary: "A singular performer whose songs and live shows changed generations.",
  thankYou: "Thank you for leaving the music with us.",
  accomplishments: ["Three landmark albums", "A career of unforgettable live performances"],
  sourceUrl: "https://news.example.org/artist/confirmed#announcement",
  sourceTitle: "Official announcement",
  confirmedIndividual: true,
  ...overrides,
});

test("admin parsing explicitly projects one verified memorial payload", () => {
  const result = parseArtistMemorialAdminPayload(payload(), { at: NOW });
  assert.equal(result.valid, true);
  assert.deepEqual(result.payload, {
    status: "published",
    deathDate: "2024-05-17",
    summary: "A singular performer whose songs and live shows changed generations.",
    thankYou: "Thank you for leaving the music with us.",
    accomplishments: ["Three landmark albums", "A career of unforgettable live performances"],
    sourceUrl: "https://news.example.org/artist/confirmed",
    sourceTitle: "Official announcement",
    confirmedIndividual: true,
    restartSpotlight: false,
  });

  const extra = parseArtistMemorialAdminPayload(payload({ reviewedBy: "u_admin" }), { at: NOW });
  assert.deepEqual(extra, {
    valid: false,
    field: "reviewedBy",
    message: "That field is not part of an artist memorial.",
  });
});

test("death dates are exact ISO calendar dates and never future dates", () => {
  for (const deathDate of ["2026-02-30", "2027-01-01", "2026-8-1", "2026-08-01T00:00:00Z", "0999-12-31", 20260801]) {
    const result = parseArtistMemorialAdminPayload(payload({ deathDate }), { at: NOW });
    assert.equal(result.valid, false, String(deathDate));
    assert.equal(result.field, "deathDate");
  }
  assert.equal(parseArtistMemorialAdminPayload(payload({ deathDate: "2026-08-25" }), { at: NOW }).valid, true);
});

test("copy, accomplishment and source boundaries fail closed", () => {
  const invalidCases = [
    [payload({ summary: "Too short" }), "summary"],
    [payload({ thankYou: "" }), "thankYou"],
    [payload({ accomplishments: [] }), "accomplishments"],
    [payload({ accomplishments: Array.from({ length: 9 }, (_, index) => `Accomplishment ${index}`) }), "accomplishments"],
    [payload({ accomplishments: ["A defining album", "a defining album"] }), "accomplishments"],
    [payload({ sourceUrl: "http://news.example.org/artist" }), "sourceUrl"],
    [payload({ sourceUrl: "https://user:pass@news.example.org/artist" }), "sourceUrl"],
    [payload({ sourceUrl: "https://127.0.0.1/private" }), "sourceUrl"],
    [payload({ sourceUrl: "https://[fc00::1]/private" }), "sourceUrl"],
    [payload({ sourceUrl: "https://intranet/private" }), "sourceUrl"],
    [payload({ sourceUrl: ["https://one.example", "https://two.example"] }), "sourceUrl"],
    [payload({ confirmedIndividual: false }), "confirmedIndividual"],
    [payload({ confirmedIndividual: "yes" }), "confirmedIndividual"],
    [payload({ restartSpotlight: "yes" }), "restartSpotlight"],
    [payload({ status: "draft", restartSpotlight: true }), "restartSpotlight"],
  ];
  for (const [input, field] of invalidCases) {
    const result = parseArtistMemorialAdminPayload(input, { at: NOW });
    assert.equal(result.valid, false, field);
    assert.equal(result.field, field);
  }
  const missingConfirmation = payload();
  delete missingConfirmation.confirmedIndividual;
  const missingResult = parseArtistMemorialAdminPayload(missingConfirmation, { at: NOW });
  assert.equal(missingResult.valid, false);
  assert.equal(missingResult.field, "confirmedIndividual");
});

test("first publication starts a 30-day spotlight and ordinary edits do not renew it", () => {
  const first = transitionArtistMemorial(null, payload(), { at: NOW });
  assert.equal(first.valid, true);
  assert.equal(first.record.publishedAt, NOW);
  assert.equal(first.record.spotlightStartedAt, NOW);
  assert.equal(Object.hasOwn(first.record, "confirmedIndividual"), false);
  assert.equal(Object.hasOwn(first.record, "restartSpotlight"), false);

  const later = NOW + 5 * 24 * 60 * 60 * 1000;
  const edited = transitionArtistMemorial(first.record, payload({ summary: "An updated summary that remains long enough for the memorial page." }), { at: later });
  assert.equal(edited.record.publishedAt, NOW);
  assert.equal(edited.record.spotlightStartedAt, NOW);

  const restarted = transitionArtistMemorial(edited.record, payload({ restartSpotlight: true }), { at: later });
  assert.equal(restarted.record.publishedAt, NOW);
  assert.equal(restarted.record.spotlightStartedAt, later);

  const draft = transitionArtistMemorial(restarted.record, payload({ status: "draft" }), { at: later + 1 });
  assert.equal(draft.record.publishedAt, null);
  assert.equal(draft.record.spotlightStartedAt, null);
  const republished = transitionArtistMemorial(draft.record, payload(), { at: later + 2 });
  assert.equal(republished.record.publishedAt, later + 2);
  assert.equal(republished.record.spotlightStartedAt, later + 2);

  const repaired = transitionArtistMemorial({
    ...first.record,
    publishedAt: NOW + ARTIST_MEMORIAL_SPOTLIGHT_MS,
    spotlightStartedAt: NOW + ARTIST_MEMORIAL_SPOTLIGHT_MS,
  }, payload(), { at: NOW });
  assert.equal(repaired.record.publishedAt, NOW);
  assert.equal(repaired.record.spotlightStartedAt, NOW);
});

test("public projection keeps the deceased marker after the spotlight expires", () => {
  const record = transitionArtistMemorial(null, payload(), { at: NOW }).record;
  const during = projectArtistMemorialPublic({
    ...record,
    reviewerId: "u_private_admin",
    internalNotes: "not public",
  }, { at: NOW + ARTIST_MEMORIAL_SPOTLIGHT_MS - 1 });
  assert.equal(during.deceased, true);
  assert.equal(during.spotlight.active, true);
  assert.equal(during.spotlight.startedAt, NOW);
  assert.equal(during.spotlight.endsAt, NOW + ARTIST_MEMORIAL_SPOTLIGHT_MS);
  assert.deepEqual(during.citation, {
    url: "https://news.example.org/artist/confirmed",
    title: "Official announcement",
  });
  assert.equal(Object.hasOwn(during, "status"), false);
  assert.equal(Object.hasOwn(during, "reviewerId"), false);
  assert.equal(JSON.stringify(during).includes("not public"), false);

  const after = projectArtistMemorialPublic(record, { at: NOW + ARTIST_MEMORIAL_SPOTLIGHT_MS });
  assert.equal(after.deceased, true);
  assert.equal(after.spotlight.active, false);
});

test("drafts and malformed stored records have no public projection", () => {
  const draft = transitionArtistMemorial(null, payload({ status: "draft" }), { at: NOW }).record;
  assert.equal(projectArtistMemorialPublic(draft, { at: NOW }), null);
  assert.equal(projectArtistMemorialPublic({ ...draft, status: "published", sourceUrl: "javascript:alert(1)" }, { at: NOW }), null);
  assert.throws(() => parseArtistMemorialAdminPayload(payload(), { at: "not-a-time" }), /valid timestamp/i);
});
