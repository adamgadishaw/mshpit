import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const composer = readFileSync(new URL("../screens/LogScreen.jsx", import.meta.url), "utf8");
const store = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
const artist = readFileSync(new URL("../screens/ArtistScreen.jsx", import.meta.url), "utf8");

test("projected memories reopen in the lightweight, identity-locked editor", () => {
  assert.match(composer, /editing\.kind === "memory" \? "memory"/);
  assert.match(composer, /const memoryEditLocked = !!editing && isMemorialMemory/);
  assert.match(composer, /isMemorialMemory && !memoryEditLocked \? \{ artist: artist\.trim\(\), artistKey \} : \{\}/);
  assert.match(composer, /The artist identity and existing media stay unchanged/);
  assert.match(composer, /!memoryTextOnly \? <>[\s\S]*?ADD TO YOUR POST/);
});

test("confirmed legacy profiles open a words-only memory composer", () => {
  assert.match(artist, /const confirmedLegacyProfile = legacyMode && currentConfirmedArtistPage\?\.legacyProfile === true/);
  assert.match(artist, /Share a written memory/);
  assert.match(artist, /legacyProfile: confirmedLegacyProfile/);
  assert.match(app, /legacyArtistProfile: options\.legacyProfile === true/);
  assert.match(app, /legacyArtistProfile=\{nav\.legacyArtistProfile === true\}/);
  assert.match(composer, /const protectedLegacyMemory = !editing && isMemorialMemory && legacyArtistProfile === true/);
  assert.match(composer, /const memoryTextOnly = memoryEditLocked \|\| protectedLegacyMemory/);
  assert.match(composer, /!memoryTextOnly && !isOnlineReview && \(showSong \|\| song\?\.videoId\)/);
  assert.match(composer, /!memoryTextOnly && \(showPhotos \|\| photos\.length > 0 \|\| pendingMediaAssets\.length > 0\)/);
  assert.match(composer, /protectedLegacyMemory \? \{ legacyArtistProfile: true \} : \{\}/);
  assert.match(store, /buildMemoryCreateBody\(safe, \{ textOnly: log\.legacyArtistProfile === true \}\)/);
});

test("memory PATCHes use the dedicated text-only payload and reconciliation path", () => {
  const memoryBranch = store.match(/if \(\(previous\.kind \|\| changes\.kind\) === "memory"\)[\s\S]*?\n    \}/)?.[0] || "";
  assert.match(memoryBranch, /buildMemoryEditBody\(changes, \{ version \}\)/);
  assert.match(memoryBranch, /saveMemoryPostEdit\(id, body, \{ apiClient: api \}\)/);
  assert.doesNotMatch(memoryBranch, /artistKey|photosPublic|mediaAssetIds|song:/);
});
