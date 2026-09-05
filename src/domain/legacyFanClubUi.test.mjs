import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const directory = readFileSync(new URL("../screens/FanClubsScreen.jsx", import.meta.url), "utf8");
const club = readFileSync(new URL("../screens/FanClubScreen.jsx", import.meta.url), "utf8");
const artist = readFileSync(new URL("../screens/ArtistScreen.jsx", import.meta.url), "utf8");

test("fan-club discovery only presents server-active or explicitly eligible artists", () => {
  assert.match(directory, /fanClubSearchResults\(active, artistsAlphabetical\(1000\), query, 40\)/);
  assert.match(directory, /Find an active artist fan club/);
  assert.doesNotMatch(directory, /Find any artist's fan club|Permanent chats for every artist/);
});

test("fan-club chat and metadata stay closed until canonical memorial policy allows them", () => {
  assert.match(club, /useCanonicalArtistIdentity\(\{ artistName: routeArtistName \}\)/);
  assert.match(club, /enabled: artistIdentityStatus === "ready" && !!canonicalArtistKey/);
  assert.match(club, /const fanClubAllowed = artistIdentityStatus === "ready"/);
  assert.match(club, /enabled: fanClubAllowed && !!artistKey && member/);
  assert.match(club, /if \(!fanClubAllowed \|\| !artistKey \|\| member\) return undefined/);
  assert.match(club, /<LegacyArtistArchiveGate/);
  assert.match(club, /state=\{profileGateState\}/);
});

test("legacy profile identity and editorial content require a current projected response", () => {
  assert.match(artist, /const currentConfirmedArtistPage = confirmedArtistPage\?\.scope === artistPageProofScope/);
  assert.match(artist, /if \(controller\.signal\.aborted \|\| !result\?\.ok\) return/);
  assert.match(artist, /legacyProfile: result\.legacyProfile === true/);
  assert.match(artist, /legacyProfile: pageResult\.legacyProfile === true/);
  assert.match(artist, /confirmedPage: currentConfirmedArtistPage/);
  assert.match(artist, /gallery=\{heroGallery\}/);
  assert.doesNotMatch(artist, /gallery=\{gallery\}[\s\S]{0,100}ArtistCinematicCarousel/);
});
