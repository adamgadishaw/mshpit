import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const landing = source("../screens/LandingScreen.jsx");
const presentation = source("./landingPresentation.mjs");

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

test("landing copy is one promise and two actions, without the retired busy sections", () => {
  const combined = `${landing}\n${presentation}`;
  assert.match(combined, /Remember every show\./);
  assert.match(combined, /Browse concerts/);
  assert.match(combined, /Create an account/);
  assert.doesNotMatch(landing, /proofRail|journeyRail|liveRail|feedbackLink|kickerLine|scrimAmber|HOME_JOURNEY_LINE|What would make you come back/);
  assert.doesNotMatch(combined, /Shows ahead\. Rooms waiting\.|Find \u2192 Attend|rooms in the PIT|Explore the PIT/);
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

test("compact phone hero is the headline, one sentence and two full-width actions", () => {
  assert.match(landing, /title=\{LANDING_IDENTITY_COPY\.browseAction\}/);
  assert.match(landing, /headlineCompact:\s*\{[^}]*fontSize:\s*36[^}]*lineHeight:\s*39/s);
  assert.match(landing, /subCompact:\s*\{[^}]*fontSize:\s*15/s);
  assert.equal((landing.match(/fullWidth=\{compact\}/g) || []).length, 2);
});

test("landing text stays at 12px or larger", () => {
  const sizes = [...landing.matchAll(/fontSize:\s*([\d.]+)/g)].map((match) => Number(match[1]));
  assert.ok(sizes.length > 0);
  assert.deepEqual(sizes.filter((size) => size < 12), []);
});

test("landing header keeps one distinct information link instead of duplicate directory destinations", () => {
  const header = landing.slice(landing.indexOf("function WebPublicNav"), landing.indexOf("function LandingPhotoCredit"));
  assert.match(header, /href="\/about"[\s\S]*?>About<\/Text>/);
  assert.doesNotMatch(header, /href="\/artists"|href="\/events"/);
});

test("landing concert entry opens the event directory and category links remain crawlable", () => {
  const app = source("../../App.js");
  assert.match(app, /onBrowse=\{\(\) => openPublicDirectory\("events"\)\}/);
  assert.match(app, /category === "artists"[\s\S]{0,60}openPublicDirectory\("artists"\)/);
  assert.match(app, /category === "venues"\) go\(\{ venues: true \}\)/);
  assert.match(app, /category === "cities"\) go\(\{ cityGuide: \{ directory: true \} \}\)/);
  assert.match(landing, /href="\/events"\s+onPress=\{onBrowse\}/);
  assert.match(landing, /<PublicPressableLink key=\{item.key\} href=\{item.href\}/);
  assert.match(landing, /browseLink:\s*\{[^}]*minHeight:\s*44/);
});
