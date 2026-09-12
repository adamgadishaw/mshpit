import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { composerDraftFingerprint, composerDraftHasContent, normalizeComposerDraft } from "./composerDraft.mjs";
import { buildReviewCreateBody, buildReviewEditBody } from "./post-payload.mjs";
import { postMatchesEditIntent } from "./postReconciliation.mjs";
import { isCityOnlyReview } from "./showNavigation.mjs";
import { LIMITS } from "./validation.mjs";

const location = { venue: "", city: "Toronto, Ontario, Canada", eventAddress: "123 Public Event Street" };
const review = { id: "p_city_review", userId: "u_fan", kind: "review", artist: "Local artist", overall: 4.5,
  date: "2026-09-01", ...location };

test("city-only review location survives draft normalization, recovery and fingerprinting", () => {
  const draft = normalizeComposerDraft({ postType: "show", ...review });
  assert.equal(draft.venue, "");
  assert.equal(draft.city, location.city);
  assert.equal(draft.eventAddress, location.eventAddress);
  assert.deepEqual(normalizeComposerDraft(draft), draft);
  assert.equal(composerDraftHasContent({ eventAddress: location.eventAddress }), true);
  assert.notEqual(composerDraftFingerprint(draft), composerDraftFingerprint({ ...draft, eventAddress: "" }));
  assert.equal(normalizeComposerDraft({}).eventAddress, "");
});

test("city/address fields cross both write boundaries without becoming a venue", () => {
  for (const body of [buildReviewCreateBody(review), buildReviewEditBody(review)]) {
    assert.equal(body.venue, "");
    assert.equal(body.city, location.city);
    assert.equal(body.eventAddress, location.eventAddress);
    assert.equal(body.venueKey, undefined);
    assert.equal(body.archiveShowKey, undefined);
  }
  assert.equal(buildReviewEditBody({ ...review, eventAddress: "" }).eventAddress, null);
});

test("location text uses shared bounds and removes control/spoof characters", () => {
  const city = "A".repeat(90) + ", Region, Country";
  for (const build of [buildReviewCreateBody, buildReviewEditBody]) {
    const body = build({ ...review, city, eventAddress: " 123\u202e\u0000 Public  Road " });
    assert.equal(body.city, city, "qualified cities are not truncated at the legacy 60-character cap");
    assert.equal(body.eventAddress, "123 Public Road");
    assert.equal(build({ ...review, eventAddress: "x".repeat(300) }).eventAddress.length, LIMITS.eventAddress);
    assert.equal(build({ ...review, city: "x".repeat(300) }).city.length, LIMITS.city);
  }
});

test("online and non-concert drafts do not leak a hidden physical address", () => {
  for (const build of [buildReviewCreateBody, buildReviewEditBody]) {
    const body = build({ ...review, experienceType: "online" });
    assert.equal(body.eventAddress, null);
    assert.equal(body.city, "");
    assert.equal(body.venue, "");
  }
  assert.equal(normalizeComposerDraft({ ...review, postType: "show", experienceType: "online" }).eventAddress, "");
  assert.equal(normalizeComposerDraft({ ...review, postType: "status" }).eventAddress, "");
  assert.equal(normalizeComposerDraft({ ...review, postType: "memory" }).eventAddress, "");
});

test("ambiguous edit recovery verifies addresses instead of silently accepting a failed save", () => {
  assert.equal(postMatchesEditIntent(review, { eventAddress: location.eventAddress, city: location.city }), true);
  assert.equal(postMatchesEditIntent(review, { eventAddress: "Different address" }), false);
  assert.equal(postMatchesEditIntent(review, { eventAddress: null }), false);
  assert.equal(postMatchesEditIntent({ ...review, eventAddress: null }, { eventAddress: "" }), true);
  assert.equal(postMatchesEditIntent({ ...review, eventAddress: 123 }, { eventAddress: "" }), false);
  const { eventAddress: _address, ...oldResponse } = review;
  assert.equal(postMatchesEditIntent(oldResponse, { eventAddress: location.eventAddress }), false);
});

test("the real Store edit guard accepts city-only reviews and requires city for addresses", () => {
  const source = readFileSync(new URL("../store.js", import.meta.url), "utf8");
  const begin = source.indexOf("    const safe = buildReviewEditBody(changes);");
  const end = source.indexOf("    const version = previous.version", begin);
  assert.ok(begin > 0 && end > begin);
  const guard = new Function("changes", "buildReviewEditBody", `${source.slice(begin, end)}; return { ok: true, safe };`);
  assert.equal(guard(review, buildReviewEditBody).ok, true);
  assert.equal(guard({ ...review, venue: "", city: "", eventAddress: "" }, buildReviewEditBody).ok, false);
  assert.equal(guard({ ...review, venue: "Known room", city: "", eventAddress: "" }, buildReviewEditBody).ok, true);
  assert.equal(guard({ ...review, venue: "Known room", city: "" }, buildReviewEditBody).ok, false);
});

test("city-only reviews open their original post and never acquire a fake show identity", () => {
  assert.equal(isCityOnlyReview(review), true);
  assert.equal(isCityOnlyReview({ ...review, venue: "Known room" }), false);
  assert.equal(isCityOnlyReview({ ...review, performanceEvent: true }), false);
  assert.equal(isCityOnlyReview({ ...review, kind: "status" }), false);
  assert.equal(isCityOnlyReview({ ...review, experienceType: "online" }), false);
  assert.equal(isCityOnlyReview({ ...review, userId: null }), false);
  const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  assert.match(app, /isCityOnlyReview\(post\) \? \{ post \} : \{ openLog: post \}/);
  assert.match(app, /isCityOnlyReview\(log\)\) return openPost\(log, analytics\)/);
});
