import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { composerDraftFingerprint, normalizeComposerDraft } from "../domain/composerDraft.mjs";
import { hasDetailedComposerRatings, restoredComposerDate } from "../domain/composerLogDetails.mjs";
import { normalizeMediaProject, originalMediaProjectAsset } from "../domain/mediaProject.mjs";
import { normalizeReviewExperienceType, ONLINE_REVIEW_EXPERIENCE } from "../domain/onlineReview.mjs";

const source = readFileSync(new URL("./LogScreen.jsx", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
function find(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      const result = find(child, predicate);
      if (result) return result;
    }
  }
  return null;
}
function callback(name, bindings) {
  const node = find(ast, (entry) => entry.type === "VariableDeclarator" && entry.id?.name === name)?.init;
  assert.ok(node, name);
  return new Function(...Object.keys(bindings), `return (${source.slice(node.start, node.end)});`)(...Object.values(bindings));
}

test("real draft restoration preserves unknown date, city-only location, sparse ratings, friends and media", () => {
  const values = {};
  const setters = ["DraftId", "SavedDraftFingerprint", "PostType", "Campaign", "ExperienceType", "Artist", "ArtistPicked", "ArtistKey", "Venue", "VenuePicked", "City", "EventAddress", "Tour", "Date", "OnlineTitle", "YoutubeUrl", "OnlineRating", "Dims", "Review", "TaggedPeople", "Song", "SongUrl", "PreservedPlaylist", "Photos", "MediaProject", "PendingMediaAssets", "PhotosPublic", "LandingShowcase", "ShowDetailedRatings", "ShowTour", "ShowSong", "ShowPhotos", "ShowPeople"];
  const bindings = {
    normalizeComposerDraft, composerDraftFingerprint, restoredComposerDate, hasDetailedComposerRatings,
    normalizeMediaProject, originalMediaProjectAsset, ONLINE_REVIEW_EXPERIENCE,
    draftIdRef: { current: null }, initialFingerprintRef: { current: null }, submissionIdRef: { current: "new" },
    composerId: "composer", onDraftIdentity: () => {}, isDurableMediaUrl: () => true,
    hasLandingCompatibleImage: () => false, recoverRestoredMedia: (assets) => { values.recovered = assets; },
    ...Object.fromEntries(setters.map((name) => [`set${name}`, (value) => { values[name] = value; }])),
  };
  callback("resume", bindings)({
    id: "draft", submissionId: "same-request", postType: "show", artist: "Artist", artistKey: "saved-artist",
    venue: "", city: "Toronto, Ontario, Canada", date: "", dims: { experience: 4 }, review: "Good night",
    taggedPeople: [{ id: "friend", name: "Friend", handle: "friend" }],
    photos: ["https://media.example.test/photo.webp"], photosPublic: false,
  });
  assert.equal(values.Date, "");
  assert.equal(values.Venue, "");
  assert.equal(values.City, "Toronto, Ontario, Canada");
  assert.equal(values.Dims.experience, 4);
  assert.equal(values.Dims.performance, 0);
  assert.equal(values.ShowDetailedRatings, undefined, "Restoring a sparse draft must not collapse detailed ratings.");
  assert.equal(values.ShowTour, undefined, "Restoring a draft must not collapse the tour field.");
  assert.deepEqual(values.TaggedPeople.map((person) => person.id), ["friend"]);
  assert.equal(values.ShowPeople, true);
  assert.equal(values.ArtistKey, "saved-artist");
  assert.deepEqual(values.Photos, ["https://media.example.test/photo.webp"]);
  assert.equal(values.PhotosPublic, false);
  assert.equal(bindings.submissionIdRef.current, "same-request");
});

test("real experience toggle leaves a deliberately unknown date untouched", () => {
  const writes = [];
  callback("chooseReviewExperience", {
    normalizeReviewExperienceType, experienceType: "online",
    setExperienceType: (value) => writes.push(["experience", value]),
    setPostError: (value) => writes.push(["error", value]),
    setShowDate: (value) => writes.push(["picker", value]),
    setDate: (value) => writes.push(["date", value]), date: "", todayStr: "2026-09-16",
  })("in_person");
  assert.deepEqual(writes, [["experience", "in_person"], ["error", ""], ["picker", false]]);
});

test("real submission sends unknown details honestly and failed saves keep the draft for retry", async () => {
  const posted = [], checkpoints = [], deleted = [], errors = [];
  const bindings = {
    canPost: true, submitBusy: false, postCoolingDown: false, featuredPostingBlocked: false,
    submitOperationRef: { current: false }, user: { id: "owner" },
    accountTasks: { begin: () => ({ isCurrent: () => true, finish: () => {} }) },
    setPosting: () => {}, setPostError: (value) => errors.push(value),
    persistDraftSnapshot: (value) => checkpoints.push(value), normalizeComposerDraft,
    currentDraft: { postType: "show", artist: "Artist", city: "Toronto", date: "", dims: { experience: 4 } },
    submissionIdRef: { current: "same-request" }, photos: [], isDurableMediaUrl: () => true,
    mediaProject: { assets: [] }, mediaAssetIdsMatchingPhotos: () => [], mediaProjectPublishedMedia: () => [],
    isStatus: false, isOnlineReview: false, editing: null, artist: "Artist", artistPicked: true, artistKey: "saved-artist",
    venue: "", city: "Toronto", eventAddress: "", tour: "", date: "", submittedRatings: { overall: 4, band: 0, room: 0 },
    dims: { experience: 4, performance: 0 }, photosPublic: false, landingShowcase: false, review: "", taggedPeople: [], song: null,
    onPost: async (post) => { posted.push(post); return posted.length === 1 ? { ok: false, error: new Error("Try again") } : { ok: true }; },
    showPostFailure: (error) => errors.push(error.message),
    draftIdRef: { current: "draft" }, deleteDraft: (id) => deleted.push(id),
    setDraftId: () => {}, setSavedDraftFingerprint: () => {}, composerId: "composer", onDraftIdentity: () => {},
  };
  const submit = callback("submit", bindings);
  await submit();
  assert.equal(posted[0].date, "");
  assert.equal(posted[0].venue, "");
  assert.equal(posted[0].tour, null);
  assert.equal(posted[0].band, null);
  assert.equal(posted[0].room, null);
  assert.equal(posted[0].overall, 4);
  assert.equal(posted[0].artistKey, "saved-artist");
  assert.equal(checkpoints[0].date, "");
  assert.deepEqual(deleted, []);
  assert.equal(errors.at(-1), "Try again");
  await submit();
  assert.equal(posted[1].id, posted[0].id);
  assert.deepEqual(deleted, ["draft"]);
});

test("optional details stay visible without disclosures and retain clear-to-unknown controls", () => {
  assert.match(source, /\{GROUPS\.map/);
  assert.doesNotMatch(source, /showDetailedRatings|showTour|detailDisclosure/);
  assert.match(source, /TOUR OR SPECIAL EVENT/);
  assert.doesNotMatch(source, /<ConcertLocationFields[^>]*\bcompact\b/);
  assert.match(source, /accessibilityLabel="I don't remember the concert date"/);
  assert.match(source, /accessibilityLabel="Leave the venue unknown and use the city"/);
  assert.match(source, /accessibilityLabel=\{`Leave \$\{d\.label\.toLowerCase\(\)\} unrated`\}/);
  assert.match(source, /today\.getFullYear\(\) - 1899/);
});
