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
  assert.match(landing, /scrollNarrowCompact:\s*\{\s*paddingBottom:\s*128\s*\}/);
  assert.doesNotMatch(landing, /scrollNarrow:\s*\{[^}]*(?:height|maxHeight):/s);
});

test("phone proof cards use two readable columns and a full-width rating row", () => {
  assert.match(landing, /proofRailCompact:\s*\{[^}]*flexDirection:\s*"row"[^}]*flexWrap:\s*"wrap"[^}]*justifyContent:\s*"space-between"/s);
  assert.match(landing, /proofItemCompact:\s*\{[^}]*flexBasis:\s*"48%"/s);
  assert.match(landing, /proofItemCompactFull:\s*\{\s*flexBasis:\s*"100%"\s*\}/);
  assert.match(landing, /compact && index === 2 && styles\.proofItemCompactFull/);
});

test("landing copy names the exact actions and removes theatrical placeholders", () => {
  const combined = `${landing}\n${presentation}\n${journey}`;
  assert.match(combined, /Find a show, log and rate it, share a review or photo, and connect with other fans\./);
  assert.match(combined, /Browse shows and artists/);
  assert.match(combined, /Upcoming concerts and show discussions/);
  assert.match(combined, /concert venues/);
  assert.doesNotMatch(combined, /Shows ahead\. Rooms waiting\.|Find → Attend → Log → Share → Connect|rooms in the PIT|Explore the PIT/);
});

test("landing startup makes no showcase or automatic remote-media request", () => {
  assert.doesNotMatch(landing, /\/api\/landing\/media|landingSlideUri|ExpoImage\.prefetch/);
  assert.doesNotMatch(landing, /buildLandingSlideDeck|landingSlideFrame|landingVisibleSlideIndices/);
  assert.doesNotMatch(landing, /source=\{\{\s*uri:/);
  assert.match(landing, /<Svg width="100%" height="100%"/);
  assert.match(landing, /source=\{require\("\.\.\/\.\.\/assets\/pit-favicon-v1\.png"\)\}/);
});
