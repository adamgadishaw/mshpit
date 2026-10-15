import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptLineupToFormat, addLineupActs, festivalDayNumber, festivalDays, formatFestivalDay, lineupComparable, lineupFromPost,
  lineupPayload, lineupRequestFields, lineupSections, moveLineupAct, normalizeSetReview, postHeadline, removeLineupAct, updateLineupAct,
} from "./lineup.mjs";
import { buildReviewCreateBody, buildReviewEditBody } from "./post-payload.mjs";
import { postMatchesEditIntent } from "./postReconciliation.mjs";
import { normalizeComposerDraft } from "./composerDraft.mjs";

test("acts are added by the format's role, edited, moved and removed", () => {
  let acts = addLineupActs([], "Omar Apollo, SZA, omar apollo", { mainArtist: "SZA" });
  assert.deepEqual(acts.map((act) => [act.name, act.role]), [["Omar Apollo", "opener"]]);
  acts = addLineupActs(acts, ["Kaytranada"], { mainArtist: "SZA" });
  acts = updateLineupAct(acts, "Kaytranada", { rating: 4.26, review: "  Great   crowd\n\n\n\nwork " });
  assert.deepEqual([acts[1].rating, normalizeSetReview(acts[1].review)], [4.5, "Great crowd\n\nwork"]);
  assert.deepEqual(moveLineupAct(acts, "Kaytranada", "up").map((act) => act.name), ["Kaytranada", "Omar Apollo"]);
  assert.equal(moveLineupAct(acts, "Omar Apollo", "up"), acts, "the first act cannot move up");
  assert.deepEqual(removeLineupAct(acts, "Omar Apollo").map((act) => act.name), ["Kaytranada"]);
  const festival = addLineupActs([], "Travis Scott", { showFormat: "festival", mainArtist: "Rolling Loud", day: "2026-07-26" });
  assert.deepEqual([festival[0].role, festival[0].day], ["festival_set", "2026-07-26"]);
});

test("payloads carry each set, and older name lists still work", () => {
  const post = { artist: "Chris Brown", showFormat: "co_headline", date: "2025-03-14", endDate: "2025-03-16",
    lineup: [{ name: "Usher", role: "co_headliner", rating: 5, review: "Wow", day: "2025-03-14", stage: "Main" }, { name: "Chris Brown" }] };
  assert.deepEqual(lineupRequestFields(post), {
    showFormat: "co_headline", endDate: "", supportingActs: ["Usher"],
    lineup: [{ name: "Usher", role: "co_headliner", rating: 5, review: "Wow", day: null, stage: null }],
  }, "the headliner never lists itself; days, stages and a last day are festival-only");
  assert.deepEqual(lineupRequestFields({ artist: "X", lineup: [{ name: "Y" }] }, { online: true }), { showFormat: "headline", endDate: "", lineup: [], supportingActs: [] });
  const festival = lineupRequestFields({ artist: "Veld", showFormat: "festival", date: "2025-08-02", endDate: "2025-08-03",
    lineup: [{ name: "Kaskade", day: "2025-08-03", stage: "Main" }] });
  assert.deepEqual([festival.endDate, festival.lineup[0]], ["2025-08-03", { name: "Kaskade", role: "festival_set", rating: null, review: "", day: "2025-08-03", stage: "Main" }]);
  assert.deepEqual(lineupPayload(["Muna"], { mainArtist: "boygenius" })[0].role, "opener");

  const show = { artist: "SZA", venue: "Scotiabank Arena", city: "Toronto", date: "2025-02-01", overall: 4, dims: {}, review: "", photos: [], setlist: [],
    showFormat: "headline", lineup: [{ name: "Omar Apollo", rating: 4, review: "Smooth" }] };
  const created = buildReviewCreateBody(show);
  assert.deepEqual([created.showFormat, created.lineup[0].rating, created.supportingActs], ["headline", 4, ["Omar Apollo"]]);
  assert.equal(Object.hasOwn(buildReviewEditBody({ ...show, lineup: undefined, supportingActs: undefined }), "lineup"), false);
  const editBody = buildReviewEditBody(show);
  const serverPost = { showFormat: "headline", endDate: "", supportingActs: [{ name: "Omar Apollo" }],
    lineup: [{ name: "Omar Apollo", artistKey: "omar apollo", role: "opener", rating: 4, review: "Smooth", day: null, stage: null, reviewPostId: null }] };
  assert.equal(postMatchesEditIntent(serverPost, { lineup: editBody.lineup, showFormat: editBody.showFormat, endDate: editBody.endDate, supportingActs: editBody.supportingActs }), true);
  assert.equal(postMatchesEditIntent({ ...serverPost, lineup: [{ ...serverPost.lineup[0], rating: 3 }] }, { lineup: editBody.lineup }), false);
  assert.deepEqual(lineupComparable([{ name: " A ", role: "bogus", rating: "x", review: 3 }]), [{ name: "A", role: "opener", rating: null, review: "", day: null, stage: null }]);

  const draft = normalizeComposerDraft({ postType: "show", artist: "Veld", showFormat: "festival", endDate: "2025-08-03",
    lineup: [{ name: "Kaskade", rating: 5, day: "2025-08-03" }] });
  assert.deepEqual([draft.showFormat, draft.endDate, draft.lineup[0].day, draft.lineup[0].rating], ["festival", "2025-08-03", "2025-08-03", 5]);
});

test("cards lead with every headliner, and sections group the lineup", () => {
  const coHeadline = { artist: "Chris Brown", showFormat: "co_headline", lineup: [{ name: "Usher", role: "co_headliner" }, { name: "Summer Walker", role: "opener" }] };
  assert.equal(postHeadline(coHeadline), "Chris Brown & Usher");
  assert.equal(postHeadline({ ...coHeadline, lineup: [...coHeadline.lineup, { name: "Ne-Yo", role: "co_headliner" }] }), "Chris Brown, Usher & Ne-Yo");
  assert.equal(postHeadline({ artist: "Rolling Loud", showFormat: "festival" }), "Rolling Loud");
  assert.deepEqual(lineupSections(coHeadline).map((section) => [section.title, section.acts.length]), [["Co-headliner", 1], ["Opener", 1]]);
  const festival = { artist: "Lollapalooza", showFormat: "festival", lineup: [
    { name: "B", role: "festival_set", day: "2025-08-03" }, { name: "A", role: "festival_set", day: "2025-08-01" }, { name: "C", role: "festival_set" },
  ] };
  assert.deepEqual(lineupSections(festival)[0].acts.map((act) => act.name), ["A", "B", "C"], "sets run in day order");
  assert.deepEqual(lineupFromPost({ artist: "boygenius", supportingActs: [{ name: "Muna", reviewPostId: "p_1" }] }).map((act) => [act.name, act.reviewPostId]), [["Muna", "p_1"]]);
});

test("festival days, labels and format switches", () => {
  assert.deepEqual(festivalDays("2025-08-01", "2025-08-03"), ["2025-08-01", "2025-08-02", "2025-08-03"]);
  assert.deepEqual(festivalDays("2025-08-01", ""), ["2025-08-01"]);
  assert.deepEqual(festivalDays("", "2025-08-03"), []);
  assert.equal(festivalDays("2025-08-01", "2025-12-01").length, 14);
  assert.equal(formatFestivalDay("2025-08-01"), "Fri, Aug 1");
  assert.equal(festivalDayNumber("2025-08-03", "2025-08-01"), 3);
  const sets = [{ name: "A", role: "festival_set", day: "2025-08-01", stage: "Tent" }];
  assert.deepEqual(adaptLineupToFormat(sets, "co_headline")[0], { name: "A", role: "co_headliner", day: null, stage: null });
  assert.deepEqual(adaptLineupToFormat(sets, "headline")[0], { name: "A", role: "opener", day: null, stage: null });
});
