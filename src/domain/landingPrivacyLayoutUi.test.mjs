import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const landing = source("../screens/LandingScreen.jsx");
const presentation = source("./landingPresentation.mjs");
const journey = source("./homeJourney.mjs");

test("phone landing has one genuine scroll owner without a fixed-height clipping trap", () => {
  assert.equal((landing.match(/<ScrollView\b/g) || []).length, 1);
  assert.match(landing, /<ScrollView\s+style=\{styles\.content\}/);
  assert.doesNotMatch(landing, /<ScrollView[\s\S]{0,180}boxNonePointerEvents/);
  assert.match(landing, /contentInsetAdjustmentBehavior="automatic"/);
  assert.match(landing, /automaticallyAdjustsScrollIndicatorInsets/);
  assert.match(landing, /wrap:\s*\{[^}]*flex:\s*1[^}]*minHeight:\s*0[^}]*\}/s);
  assert.doesNotMatch(landing, /wrap:\s*\{[^}]*overflow:\s*"hidden"/s);
  assert.match(landing, /content:\s*\{[^}]*flex:\s*1[^}]*minHeight:\s*0[^}]*\}/s);
  assert.match(landing, /scrollNarrow:\s*\{[^}]*justifyContent:\s*"flex-start"[^}]*flexGrow:\s*1|scrollNarrow:\s*\{[^}]*flexGrow:\s*1[^}]*justifyContent:\s*"flex-start"/s);
  assert.match(landing, /scrollNarrowCompact:\s*\{[^}]*justifyContent:\s*"center"[^}]*paddingTop:\s*72[^}]*paddingBottom:\s*14/s);
  assert.doesNotMatch(landing, /scrollNarrow:\s*\{[^}]*(?:height|maxHeight):/s);
});

test("phone proof cards stay in three equal readable columns", () => {
  assert.match(landing, /proofRailCompact:\s*\{[^}]*flexDirection:\s*"row"[^}]*flexWrap:\s*"nowrap"/s);
  assert.match(landing, /proofItemCompact:\s*\{[^}]*flex:\s*1[^}]*flexBasis:\s*0[^}]*flexDirection:\s*"column"/s);
  assert.match(landing, /compact\s*\?\s*styles\.proofItemDividerCompact/);
  assert.doesNotMatch(landing, /proofItemCompactFull|proofItemDividerCompactFull/);
});

test("phone live header lets its title shrink without clipping the worldwide badge", () => {
  assert.match(landing, /<View style=\{styles\.liveRailHeadCopy\}>/);
  assert.match(landing, /liveRailHeadCopy:\s*\{\s*flex:\s*1,\s*minWidth:\s*0\s*\}/);
  assert.match(landing, /worldPill:\s*\{[^}]*flexShrink:\s*0/s);
});

test("landing copy names the exact actions and removes theatrical placeholders", () => {
  const combined = `${landing}\n${presentation}\n${journey}`;
  assert.match(combined, /Find a show, log and rate it, share a review or photo, and connect with other fans\./);
  assert.match(combined, /Browse shows and artists/);
  assert.match(combined, /Upcoming concerts and show discussions/);
  assert.match(combined, /concert venues/);
  assert.doesNotMatch(combined, /Shows ahead\. Rooms waiting\.|Find → Attend → Log → Share → Connect|rooms in the PIT|Explore the PIT/);
});

test("landing uses one bounded community photo layer with a direct fallback", () => {
  assert.doesNotMatch(landing, /\/api\/landing\/media/);
  assert.match(landing, /discoverySidebar\?\.landingMedia/);
  assert.match(landing, /normalizeLandingCommunityMedia\([^)]*discoverySidebar\?\.landingMedia[\s\S]*resolvePath:\s*resolveLandingMediaPath/);
  assert.equal((landing.match(/<ExpoImage\b/g) || []).length, 1);
  assert.match(landing, /source=\{\{\s*uri:\s*currentLandingUri\s*\}\}/);
  assert.match(landing, /previewSrc\(currentLandingPhoto\.uri, landingPreviewWidth\)/);
  assert.match(landing, /landingSourceStage === 0[\s\S]*setPhotoSourceState\(\{ scope: landingSourceScope, stage: 1 \}\)/);
  assert.match(landing, /cachePolicy="memory-disk"/);
  assert.match(landing, /priority="high"/);
  assert.match(landing, /loading="eager"/);
  assert.match(landing, /allowDownscaling/);
  assert.match(landing, /enforceEarlyResizing/);
  assert.match(landing, /onDisplay=\{\(\) => setDisplayedPhotoId\(currentLandingPhoto\.id\)\}/);
  assert.match(landing, /const appActive = useAppActive\(\)/);
  assert.match(landing, /if\s*\(!appActive\s*\|\|\s*reduceMotion\s*\|\|\s*visibleLandingMedia\.length\s*<\s*2\)\s*return undefined;[\s\S]*setPhotoIndex[\s\S]*7000/);
  assert.match(landing, /visibleLandingMedia\.length\s*<\s*2[\s\S]*displayedPhotoId\s*!==\s*currentLandingPhoto\?\.id\)\s*return undefined;[\s\S]*ExpoImage\.prefetch\(previewSrc\(next\.uri, landingPreviewWidth\),\s*"disk"\)/);
  assert.doesNotMatch(landing, /reduceMotion\s*\|\|\s*!wide/,
    "phones warm only the next frame after the current photo is displayed");
  assert.match(landing, /setTimeout\(\(\) => setFailedPhotoIds\(new Set\(\)\),\s*30_000\)/);
  assert.match(landing, /\[appActive, landingMediaRevision\]/);
  assert.doesNotMatch(landing, /images\.unsplash\.com|STOCK_SLIDES/);
  assert.match(landing, /<Svg width="100%" height="100%"/);
  assert.match(landing, /<BrandMark size=\{34\} \/>/);
  assert.doesNotMatch(landing, /<BrandMark[^>]*\bcolor=/);
  assert.doesNotMatch(landing, /pit-favicon-v1/);
});

test("compact phone hero keeps secondary sections out of the first-screen composition", () => {
  assert.match(landing, /\{!compact && <View[\s\S]*styles\.journeyRail/);
  assert.match(landing, /\{!compact && hasLandingLive \? \(/);
  assert.match(landing, /\{!compact && !!onSuggestion && \(/);
  assert.match(landing, /title=\{compact \? "Browse shows" : LANDING_IDENTITY_COPY\.browseAction\}/);
  assert.match(landing, /headlineCompact:\s*\{[^}]*fontSize:\s*34[^}]*lineHeight:\s*36/s);
  assert.match(landing, /proofItemCompact:\s*\{[^}]*minHeight:\s*78/s);
});

test("landing header keeps one distinct information link instead of duplicate directory destinations", () => {
  assert.match(landing, /href="\/about"[\s\S]*?>About<\/Text>/);
  assert.doesNotMatch(landing, /href="\/artists"/);
  assert.doesNotMatch(landing, /href="\/events"/);
});
