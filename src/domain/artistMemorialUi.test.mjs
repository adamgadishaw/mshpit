import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../screens/ArtistScreen.jsx", import.meta.url), "utf8");
const showSource = readFileSync(new URL("../screens/ShowScreen.jsx", import.meta.url), "utf8");

test("generic memorial memories never render a dead-end View show action", () => {
  assert.match(source, /const canOpenExactShow = review\.kind !== "memory" && !!String\(review\.archiveShowKey/);
  assert.match(source, /\{canOpenExactShow \? \([\s\S]*?<Text style=\{styles\.topReviewActionText\}>View show<\/Text>[\s\S]*?\) : null\}/);
});

test("artist review actions have distinct reload-safe post and concert URLs", () => {
  assert.match(source, /href=\{postPath\(review\.id\)\}[\s\S]*?onNavigate=\{\(\) => onOpenPost\?\.\(review\)\}/);
  assert.match(source, /href=\{concertPath\(review\.archiveShowKey\)\}[\s\S]*?onNavigate=\{\(\) => onOpenShow\?\.\(review\)\}/);
  assert.match(source, /href=\{concertPath\(show\.key\)\}/);
  assert.doesNotMatch(source, /href=\{eventPath\(show\)\}/);
});

test("deceased artist pages replace reputation and ranking language with permanent legacy language", () => {
  assert.match(source, /deceased \? "CREATIVE LEGACY" : liveAvailable \? "LIVE REPUTATION" : "ARTIST STATUS"/);
  assert.match(source, /New live ratings are closed\./);
  assert.match(source, /deceased \? `FAN MEMORIES/);
  assert.match(source, /sectionModel\.active === "live" && liveAvailable/);
  assert.match(source, /onShareMemory\(a\.name, a\.profileKey\)/);
});

test("artist and show screens fail closed until memorial status is authoritative", () => {
  assert.match(source, /const liveAvailable = memorialAvailability === "living"/);
  assert.match(source, /const upcoming = liveAvailable/);
  assert.match(source, /liveAvailable \? "LIVE REPUTATION" : "ARTIST STATUS"/);
  assert.match(source, /memorialKnown && sectionModel\.showCommunity/);
  assert.match(showSource, /const liveActionsAvailable = memorialAvailability === "living"/);
  assert.match(showSource, /presentation\.showPostEvent && liveActionsAvailable/);
  assert.match(showSource, /liveActionsAvailable && presentation\.allowTickets/);
  assert.match(showSource, /liveActionsAvailable && lifecycleView\.trusted/);
  assert.match(showSource, /Historical ratings remain in the archive, but new live ratings are closed/);
});
