import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("composer people search is abortable, bounded, recoverable, and submitted", () => {
  const composer = source("../screens/LogScreen.jsx");
  assert.match(composer, /const controller = new AbortController\(\)/);
  assert.match(composer, /searchPeople\(query, \{[\s\S]*?postTagEligibleOnly: true,[\s\S]*?postId: editing\?\.id \|\| null/);
  assert.match(composer, /taggedPeople\.length >= MAX_POST_TAGGED_PEOPLE/);
  assert.match(composer, /label="Friends"/);
  assert.match(composer, /No matching friends found\./);
  assert.match(composer, /accessibilityLiveRegion="polite"/);
  assert.match(composer, /if \(!showPeople \|\| query\.length < 2[\s\S]*?setPeopleError\(""\)/);
  assert.match(composer, /panels: \{ song: showSong, photos: showPhotos, playlist: showPlaylist, people: showPeople \}/);
  assert.ok((composer.match(/\n\s+taggedPeople,/g) || []).length >= 3, "draft and both post modes carry selected people");
  const store = source("../store.js");
  const service = source("../features/people/services/peopleSearchApi.mjs");
  assert.match(store, /searchPeopleRequest\(q, \{ signal, postTagEligibleOnly, postId \}\)/);
  assert.match(service, /params\.set\("scope", "post_tag"\)/);
  assert.match(service, /if \(targetPostId\) params\.set\("postId", targetPostId\)/);
});

test("feed chips link to profiles and expose a real 44 point self-removal control", () => {
  const card = source("../components/TicketStub.jsx");
  assert.match(card, /onOpenProfile\(person\.id\)/);
  assert.match(card, /accessibilityRole=\{onOpenProfile \? "link" : undefined\}/);
  assert.match(card, /onRemoveMyPostTag\?\.\(log\.id\)/);
  assert.equal((card.match(/onRemoveSelf=\{onRemoveMyPostTag \? removeSelfTag : undefined\}/g) || []).length, 2);
  assert.match(card, /taggedPersonProfile: \{ minHeight: 44/);
  assert.match(card, /taggedPersonRemove: \{ width: 44, height: 44/);
});

test("tag removal is injected through Root instead of deepening TicketStub's Store dependency", () => {
  const app = source("../../App.js");
  const card = source("../components/TicketStub.jsx");
  const feed = source("../screens/FeedScreen.jsx");
  const postScreen = source("../screens/PostScreen.jsx");
  const profile = source("../screens/ProfileScreen.jsx");
  const storeRead = card.match(/const \{([^}]+)\} = useStore\(\);/)?.[1] || "";

  assert.doesNotMatch(storeRead, /\bremoveMyPostTag\b/);
  assert.match(storeRead, /\blikeInfo\b/);
  assert.match(storeRead, /\bcommentsFor\b/);
  assert.match(app, /\bremoveMyPostTag,\s*\n\s*\} = useStore\(\)/);
  assert.match(app, /<FeedScreen[\s\S]*?onRemoveMyPostTag=\{removeMyPostTag\}[\s\S]*?\/>/);
  assert.match(app, /<PostScreen[^>]*onRemoveMyPostTag=\{removeMyPostTag\}/);
  assert.match(app, /<ProfileScreen[^>]*onRemoveMyPostTag=\{removeMyPostTag\}/);
  assert.match(feed, /<TicketStub[\s\S]*?onRemoveMyPostTag=\{onRemoveMyPostTag\}[\s\S]*?\/>/);
  assert.match(postScreen, /<TicketStub[\s\S]*?onRemoveMyPostTag=\{onRemoveMyPostTag\}[\s\S]*?\/>/);
  assert.match(profile, /<TicketStub[\s\S]*?onRemoveMyPostTag=\{onRemoveMyPostTag\}/);
});

test("notification-fetched post details resolve server-confirmed local tag overrides", () => {
  const card = source("../components/TicketStub.jsx");
  const postScreen = source("../screens/PostScreen.jsx");
  assert.match(card, /onSelfTagRemoved\?\.\(result\)/);
  assert.match(postScreen, /withRemovedSelfPostTag\(current, \{/);
  assert.match(postScreen, /applyPostLocalOverride\(/);
  assert.match(postScreen, /onRemoveMyPostTag=\{onRemoveMyPostTag\}/);
  assert.match(postScreen, /onSelfTagRemoved=\{reconcileSelfTagRemoval\}/);
});

test("profile-wall friend chips receive a real profile-navigation callback", () => {
  const app = source("../../App.js");
  const profile = source("../screens/ProfileScreen.jsx");
  assert.match(app, /<ProfileScreen[^>]*onOpenProfile=\{openProfile\}/);
  assert.match(profile, /onOpenProfile=\{onOpenProfile\}/);
  assert.doesNotMatch(profile, /onOpenProfile=\{\(\) => \{\}\}/);
});
