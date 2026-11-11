import test from "node:test";
import assert from "node:assert/strict";
import { creatorEntityForComposer, creatorUpdateDraft, creatorUpdateError } from "./creatorUpdate.mjs";
import { normalizeComposerDraft, composerDraftFingerprint, composerDraftHasContent } from "./composerDraft.mjs";
import { buildStatusCreateBody } from "./post-payload.mjs";
import { notificationDestination } from "./notificationDeepLink.mjs";

const base = { entityType: "artist", entityKey: "example", kind: "show", title: "Tour starts", date: "2026-11-30", location: "Toronto", url: "https://example.test/tickets" };
test("interrupted creator draft keeps fields, stable submission identity and media for a safe retry", () => {
  const update = creatorUpdateDraft(base);
  const draft = normalizeComposerDraft({ postType: "status", submissionId: "post_retry_123", creatorUpdate: update, review: "Join us", mediaProject: { assets: [] } });
  const restored = normalizeComposerDraft(JSON.parse(JSON.stringify(draft)));
  assert.deepEqual(restored.creatorUpdate, update);
  assert.equal(restored.submissionId, "post_retry_123");
  assert.equal(composerDraftFingerprint(restored), composerDraftFingerprint(draft));
  assert.equal(composerDraftHasContent(draft), true);
  assert.deepEqual(buildStatusCreateBody({ ...restored, id: restored.submissionId }).creatorUpdate, update);
  assert.equal(creatorUpdateError(update), null);
  assert.notEqual(composerDraftFingerprint(draft), composerDraftFingerprint({ ...draft, creatorUpdate: { ...update, date: "2026-12-01" } }));
});
test("incomplete drafts remain recoverable, malformed publication fails, ordinary drafts stay ordinary", () => {
  const incomplete = creatorUpdateDraft({ ...base, date: "2026-", title: "" });
  assert.equal(normalizeComposerDraft({ postType: "status", creatorUpdate: incomplete }).creatorUpdate.date, "2026-");
  assert.ok(creatorUpdateError(incomplete));
  assert.ok(creatorUpdateError({ ...creatorUpdateDraft(base), date: "2026-02-30" }));
  assert.equal(normalizeComposerDraft({ postType: "status", review: "Fan post" }).creatorUpdate, null);
  assert.equal(creatorEntityForComposer({ id: "a", role: "fan" }, base), null);
  assert.equal(creatorEntityForComposer({ id: "a", role: "artist", artistName: "Example" }, base).entityKey, "example");
  assert.equal(creatorEntityForComposer({ id: "b", role: "venue" }, base), null);
  assert.equal(creatorEntityForComposer(null, base), null);
});
test("creator updates open the exact existing post, separately from artist news", () => {
  assert.deepEqual(notificationDestination({ type: "creator_update", postId: "p_creator" }), { kind: "post", postId: "p_creator" });
  assert.deepEqual(notificationDestination({ type: "creator_update" }), { kind: "unavailable" });
});
