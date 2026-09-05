import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../screens/ArtistScreen.jsx", import.meta.url), "utf8");
const showSource = readFileSync(new URL("../screens/ShowScreen.jsx", import.meta.url), "utf8");
const artistArchiveSource = readFileSync(new URL("../screens/ArtistArchiveScreen.jsx", import.meta.url), "utf8");
const tourArchiveSource = readFileSync(new URL("../screens/TourArchiveScreen.jsx", import.meta.url), "utf8");

test("generic memorial memories never render a dead-end View show action", () => {
  assert.match(source, /const canOpenExactShow = archiveAvailable && review\.kind !== "memory" && !!String\(review\.archiveShowKey/);
  assert.match(source, /\{canOpenExactShow \? \([\s\S]*?<Text style=\{styles\.topReviewActionText\}>View show<\/Text>[\s\S]*?\) : null\}/);
});

test("artist review actions have distinct reload-safe post and concert URLs", () => {
  assert.match(source, /href=\{postPath\(review\.id\)\}[\s\S]*?onNavigate=\{\(\) => onOpenPost\?\.\(review\)\}/);
  assert.match(source, /href=\{concertPath\(review\.archiveShowKey\)\}[\s\S]*?onNavigate=\{\(\) => onOpenShow\?\.\(review\)\}/);
  assert.match(source, /href=\{concertPath\(show\.key\)\}/);
  assert.doesNotMatch(source, /href=\{eventPath\(show\)\}/);
});

test("memorial and pre-1970 legacy profiles use distinct permanent presentation modes", () => {
  assert.match(source, /deceased \? "CREATIVE LEGACY" : liveAvailable \? "LIVE REPUTATION" : "ARTIST STATUS"/);
  assert.match(source, /New live ratings are closed\./);
  assert.match(source, /deceased \? `FAN MEMORIES/);
  assert.match(source, /sectionModel\.active === "live" && liveAvailable/);
  assert.match(source, /deceased && \(!legacyMode \|\| confirmedLegacyProfile\) && session/);
  assert.match(source, /Share a written memory/);
  assert.match(source, /PRESERVED FOR MUSIC HISTORY/);
  assert.match(source, /Photo and video uploads, live ratings, dates, tour archives, music playback, and fan clubs are closed/);
  assert.match(source, /Fans can still add written memories/);
  assert.match(source, /archiveAvailable=\{profileServicesAvailable\}/);
  assert.match(source, /profileServicesAvailable \? <View style=\{styles\.artistActions\}>/);
  assert.match(source, /const artistPostsVisible = legacyMode[\s\S]*?posts\.length > 0[\s\S]*?: profileServicesAvailable/);
  assert.match(source, /MSHPIT HISTORY NOTES/);
  assert.match(source, /These notes are not posts from the artist/);
  assert.match(source, /legacyMode \? "Mshpit editorial" : a\.name/);
});

test("direct artist and tour archive screens fail closed for protected legacy profiles", () => {
  for (const archiveSource of [artistArchiveSource, tourArchiveSource]) {
    assert.match(archiveSource, /isLegacyArtistMemorial\(memorialResource\.data\)/);
    assert.match(archiveSource, /enabled: archiveAllowed/);
    assert.match(archiveSource, /<LegacyArtistArchiveGate/);
  }
});

test("name-only artist archives resolve a canonical catalogue key before checking memorial status", () => {
  assert.match(artistArchiveSource, /useCanonicalArtistIdentity\(\{ artistName, artistKey \}\)/);
  assert.match(artistArchiveSource, /artistKey: resolvedArtistKey/);
  assert.match(artistArchiveSource, /enabled: artistIdentityStatus === "ready" && !!resolvedArtistKey/);
  assert.match(artistArchiveSource, /artistIdentityStatus === "checking" \|\| memorialAvailability === "checking"/);
  assert.match(artistArchiveSource, /onOpenTour\?\.\(tour, resolvedArtistKey\)/);
});

test("artist and show screens fail closed until memorial status is authoritative", () => {
  assert.match(source, /const liveAvailable = memorialAvailability === "living"/);
  assert.match(source, /const profileServicesAvailable = memorialKnown && !legacyMode/);
  assert.match(source, /artistPageSectionModel\(activeSection, \{ legacyMode: !profileServicesAvailable \}\)/);
  assert.match(source, /const upcoming = liveAvailable/);
  assert.match(source, /liveAvailable \? "LIVE REPUTATION" : "ARTIST STATUS"/);
  assert.match(source, /memorialKnown && sectionModel\.showCommunity/);
  assert.match(showSource, /const liveActionsAvailable = memorialAvailability === "living"/);
  assert.match(showSource, /useCanonicalArtistIdentity\(\{[\s\S]*?artistName: artist,[\s\S]*?artistKey: norm\.artistKey \|\| null/);
  assert.match(showSource, /const legacyMode = isLegacyArtistMemorial\(memorialResource\.data\)/);
  assert.match(showSource, /enabled: showPageAllowed && !!archiveShowKey/);
  assert.match(showSource, /!showPageAllowed \? \([\s\S]*?<LegacyArtistArchiveGate/);
  assert.match(showSource, /presentation\.showPostEvent && liveActionsAvailable/);
  assert.match(showSource, /liveActionsAvailable && presentation\.allowTickets/);
  assert.match(showSource, /liveActionsAvailable && lifecycleView\.trusted/);
  assert.match(showSource, /Historical ratings remain in the archive, but new live ratings are closed/);
});
