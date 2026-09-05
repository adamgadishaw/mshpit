import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./LogScreen.jsx", import.meta.url), "utf8");
const includes = (text, needle) => assert.ok(text.includes(needle), `Expected source to include: ${needle}`);

test("review composer offers clear in-person and online choices without a new control dependency", () => {
  includes(source, ">In person</Text>");
  includes(source, ">Watched online</Text>");
  includes(source, "chooseReviewExperience(ONLINE_REVIEW_EXPERIENCE)");
  includes(source, "chooseReviewExperience(IN_PERSON_REVIEW_EXPERIENCE)");
  assert.equal(source.includes("@react-native-segmented-control"), false);
  assert.equal(source.includes("@expo/ui"), false);
});

test("online mode requires artist, rating, and a valid YouTube source instead of a venue", () => {
  const eligibility = source.slice(source.indexOf("const youtubeUrlValid"), source.indexOf("const submitBusy"));
  includes(eligibility, "artist.trim() && onlineRating > 0 && youtubeUrlValid");
  includes(eligibility, "artist.trim() && venue.trim() && computed.overall > 0");
  includes(source, "Paste the link to the YouTube concert you are reviewing.");
  includes(source, "Paste a YouTube watch, Shorts, live, or youtu.be link.");
});

test("online submit sends its source and score without venue-backed show identity", () => {
  const submit = source.slice(source.indexOf("const submit = async () =>"), source.indexOf("\n\n  return (", source.indexOf("const submit = async () =>")));
  const onlineBranch = submit.slice(submit.indexOf("...(isOnlineReview ? {"), submit.indexOf("} : {", submit.indexOf("...(isOnlineReview ? {")));
  includes(onlineBranch, "experienceType: ONLINE_REVIEW_EXPERIENCE");
  includes(onlineBranch, "onlineTitle: onlineTitle.trim() || null");
  includes(onlineBranch, "youtubeUrl: youtubeUrl.trim()");
  includes(onlineBranch, "overall: onlineRating");
  assert.equal(onlineBranch.includes("venue:"), false);
  assert.equal(onlineBranch.includes("city:"), false);
  assert.equal(onlineBranch.includes("tour:"), false);
  assert.equal(onlineBranch.includes("date,"), false);
});

test("mode switching preserves unfinished work while payload normalization strips incompatible fields", () => {
  const transition = source.slice(source.indexOf("const chooseReviewExperience"), source.indexOf("async function uploadOriginalMedia"));
  for (const statement of [
    'setVenue("")',
    'setCity("")',
    'setTour("")',
    'setDate("")',
    'setOnlineTitle("")',
    'setYoutubeUrl("")',
    "setOnlineRating(0)",
  ]) assert.equal(transition.includes(statement), false, `Mode switch must preserve: ${statement}`);
  includes(transition, "if (next === IN_PERSON_REVIEW_EXPERIENCE && !date) setDate(todayStr)");
  assert.equal(transition.includes("setPhotos("), false);
  assert.equal(transition.includes("setMediaProject("), false);
  assert.equal(transition.includes("setPendingMediaAssets("), false);
});

test("online mode has no descriptive or companion tags while in-person keeps people who went", () => {
  includes(source, "{!memoryTextOnly && !isOnlineReview && (");
  includes(source, "tags: []");
  includes(source, '? "WHO DID YOU WATCH?" : "WHO DID YOU SEE?"');
  includes(source, '{!isStatus && !isOnlineReview ? <AttachChip icon="you" label="People with you"');
  includes(source, 'placeholder="Search people you went with"');
});

test("online identity and rating participate in checkpointing and draft restoration", () => {
  const draft = source.slice(source.indexOf("const currentDraft = useMemo"), source.indexOf("const draftFingerprint"));
  for (const field of ["experienceType,", "onlineTitle,", "youtubeUrl,", "onlineRating,"]) includes(draft, field);
  const resume = source.slice(source.indexOf("const resume = (d) =>"), source.indexOf("useEffect(() => {", source.indexOf("const resume = (d) =>")));
  includes(resume, "setExperienceType(restored.experienceType)");
  includes(resume, "setOnlineTitle(restored.onlineTitle)");
  includes(resume, "setYoutubeUrl(restored.youtubeUrl)");
  includes(resume, "setOnlineRating(restored.onlineRating)");
});
