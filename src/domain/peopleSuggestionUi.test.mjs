import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("desktop rail presents clickable public fan identities with an explicit follow action", () => {
  const rail = read("../components/Rails.jsx");
  const app = read("../../App.js");
  assert.match(rail, /PEOPLE NEAR YOU/);
  assert.match(rail, /PEOPLE TO FOLLOW/);
  assert.match(rail, /profilePath\(person\.handle\)/);
  assert.match(rail, /onOpenProfile\?\.\(person\.id\)/);
  assert.match(rail, /onFollowUser\?\.\(person\.id\)/);
  assert.match(rail, /suggestion\.reason/);
  assert.match(rail, /<Avatar user=\{person\} size=\{38\}/);
  assert.match(app, /onOpenProfile=\{openProfile\}/);
  assert.match(app, /onFollowUser=\{follow\}/);
  assert.match(app, /isBlocked=\{isBlocked\}/);
});

test("shared profile media uses disk caching, recycling, and a visible fallback", () => {
  const avatar = read("../components/Avatar.jsx");
  const smartImage = read("../components/SmartImage.jsx");
  assert.match(avatar, /from "expo-image"/);
  assert.match(avatar, /cachePolicy="memory-disk"/);
  assert.match(avatar, /recyclingKey=/);
  assert.match(avatar, /onError=\{\(\) => setFailedUri/);
  assert.match(smartImage, /from "expo-image"/);
  assert.match(smartImage, /cachePolicy = "memory-disk"/);
  assert.ok((smartImage.match(/cachePolicy=\{cachePolicy\}/g) || []).length >= 2);
  assert.match(smartImage, /recyclingKey=/);
  assert.match(smartImage, /PHOTO UNAVAILABLE/);
  const moderation = read("../components/moderation/ModerationConsole.jsx");
  assert.match(moderation, /cachePolicy="none"/);
});

test("privacy settings distinguish loading, failed, and authoritative empty block lists", () => {
  const settings = read("../screens/SettingsScreen.jsx");
  const store = read("../store.js");
  assert.match(settings, /blockedDirectoryStatus === "loading"/);
  assert.match(settings, /blockedDirectoryStatus === "error"/);
  assert.match(settings, /blockedDirectoryStatus === "ready" && blocked\.length === 0/);
  assert.match(settings, /Existing blocks are still enforced/);
  assert.match(store, /const refreshBlockedDirectory = async/);
  assert.match(store, /return \{ ok: false, error \}/);
});
