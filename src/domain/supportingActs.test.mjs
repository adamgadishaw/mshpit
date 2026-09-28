import assert from "node:assert/strict";
import test from "node:test";
import { addSupportingActs, openerSearchTerm, openerSuggestions, ordinalWord, parseTimesSeen, pickSupportingAct, supportingActNames, supportingActsForDisplay, supportingActsHeading, timesSeenSentence } from "./supportingActs.mjs";

test("opener search looks up the name being typed and keeps earlier typed names on a pick", () => {
  assert.equal(openerSearchTerm("  Muna,  phoebe   bri "), "phoebe bri");
  assert.equal(openerSearchTerm("Muna,"), "");
  assert.equal(openerSearchTerm(null), "");
  assert.deepEqual(pickSupportingAct(["Lucy Dacus"], "Muna, phoe", "Phoebe Bridgers", { mainArtist: "boygenius" }), ["Lucy Dacus", "Muna", "Phoebe Bridgers"]);
  assert.deepEqual(pickSupportingAct([], "boyg", "boygenius", { mainArtist: "boygenius" }), [], "the headliner is never its own opener");
});

test("opener suggestions skip the headliner, names already added, and duplicates", () => {
  const results = [
    { key: "a_boygenius", name: "boygenius", genre: "Indie" },
    { key: "a_muna", name: "MUNA", genre: "Pop", country: "US" },
    { key: "a_phoebe", name: "Phoebe Bridgers", genre: "Indie", country: "US" },
    { key: "a_phoebe_2", name: "phoebe bridgers" },
    { name: "  " },
    null,
    { key: "a_lucy", name: "Lucy Dacus", genre: 7 },
  ];
  assert.deepEqual(openerSuggestions(results, { acts: ["Muna"], mainArtist: "boygenius" }), [
    { key: "a_phoebe", name: "Phoebe Bridgers", detail: "Indie · US" },
    { key: "a_lucy", name: "Lucy Dacus", detail: "" },
  ]);
  assert.equal(openerSuggestions(results, { limit: 1 }).length, 1);
  assert.deepEqual(openerSuggestions(undefined), []);
});

test("openers are added from typed text without repeats or the headliner", () => {
  assert.deepEqual(addSupportingActs(["Muna"], "phoebe bridgers, MUNA,\nboygenius", { mainArtist: "boygenius" }), ["Muna", "phoebe bridgers"]);
  assert.deepEqual(supportingActNames([{ name: " Sprints " }, "Honeyglaze", 3, null]), ["Sprints", "Honeyglaze"]);
  assert.equal(addSupportingActs([], Array.from({ length: 20 }, (_, index) => `Act ${index}`).join(",")).length, 12);
});

test("display keeps only safe slugs and review ids", () => {
  assert.deepEqual(supportingActsForDisplay([
    { name: "Muna", artistPublicSlug: "muna", reviewPostId: "p_abc123" },
    { name: "Bad", artistPublicSlug: "../x", reviewPostId: "javascript:1" },
    { name: "" },
  ]), [
    { name: "Muna", artistPublicSlug: "muna", reviewPostId: "p_abc123" },
    { name: "Bad", artistPublicSlug: null, reviewPostId: null },
  ]);
  assert.equal(supportingActsHeading(), "Openers");
  assert.equal(supportingActsHeading({ festival: true }), "Also saw");
});

test("times seen reads as a sentence and only accepts whole numbers", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinalWord), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
  assert.equal(timesSeenSentence(1, "Radiohead"), "Your first time seeing Radiohead");
  assert.equal(timesSeenSentence(3, "Radiohead"), "Your 3rd time seeing Radiohead");
  assert.equal(timesSeenSentence(0, "Radiohead"), "");
  assert.deepEqual(["4", " 12 ", "0", "2.5", "1000", "x", ""].map(parseTimesSeen), [4, 12, null, null, null, null, null]);
});

test("review payloads, drafts and edit reconciliation carry openers and times seen", async () => {
  const { buildReviewCreateBody, buildReviewEditBody } = await import("./post-payload.mjs");
  const { postMatchesEditIntent } = await import("./postReconciliation.mjs");
  const { normalizeComposerDraft } = await import("./composerDraft.mjs");
  const show = { id: "c1", artist: "boygenius", venue: "History", city: "Toronto", date: "2024-03-01", overall: 4, dims: {}, review: "", photos: [],
    setlist: [], supportingActs: ["Muna", "boygenius", "muna"], timesSeen: "3" };
  const created = buildReviewCreateBody(show);
  assert.deepEqual(created.supportingActs, ["Muna"]);
  assert.equal(created.timesSeen, 3);
  assert.equal(Object.hasOwn(buildReviewCreateBody({ ...show, timesSeen: null }), "timesSeen"), false, "automatic unless the person set it");
  const online = buildReviewCreateBody({ ...show, experienceType: "online", youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" });
  assert.deepEqual([online.supportingActs, Object.hasOwn(online, "timesSeen")], [[], false]);

  assert.equal(Object.hasOwn(buildReviewEditBody({ ...show, supportingActs: undefined, timesSeen: undefined }), "supportingActs"), false,
    "an edit without the list leaves the openers alone");
  const edit = buildReviewEditBody(show);
  assert.deepEqual([edit.supportingActs, edit.timesSeen], [["Muna"], 3]);

  const serverPost = { supportingActs: [{ name: "Muna", artistKey: "muna", artistPublicSlug: "muna", reviewPostId: null }], seen: 3 };
  assert.equal(postMatchesEditIntent(serverPost, { supportingActs: ["Muna"], timesSeen: 3 }), true);
  assert.equal(postMatchesEditIntent(serverPost, { supportingActs: ["Muna", "Sprints"] }), false);
  assert.equal(postMatchesEditIntent({ ...serverPost, seen: 5 }, { timesSeen: 3 }), false);

  const draft = normalizeComposerDraft({ postType: "show", artist: "boygenius", supportingActs: ["Muna", "boygenius"], timesSeen: 3 });
  assert.deepEqual([draft.supportingActs, draft.timesSeen], [["Muna"], 3]);
  const status = normalizeComposerDraft({ postType: "status", supportingActs: ["Muna"], timesSeen: 3 });
  assert.deepEqual([status.supportingActs, status.timesSeen], [[], null]);
});
