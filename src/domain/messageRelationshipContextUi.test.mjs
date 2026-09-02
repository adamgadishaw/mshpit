import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("DM reads use server-projected relationship context and skip repeat polling work", () => {
  const api = source("../../server/api.js");
  const store = source("../store.js");
  assert.match(api, /messageRelationshipContextService\.forPeers\(/u);
  assert.match(api, /messageRelationshipContextService\.forPair\(/u);
  assert.match(api, /relationshipContext:/u);
  assert.match(store, /normalizeMessageRelationshipContext/u);
  assert.match(store, /if \(!includeContext\) queryParams\.set\("context", "0"\)/u);
  assert.doesNotMatch(store, /relationshipContext[^\n]*sharedShows/u);
});

test("Inbox and Thread surface compact relationship context without new Store state", () => {
  const inbox = source("../screens/InboxScreen.jsx");
  const thread = source("../screens/ThreadScreen.jsx");
  assert.match(inbox, /messageRelationshipChips\(t\.relationshipContext\)/u);
  assert.match(thread, /messageRelationshipSummary\(relationshipContext\)/u);
  assert.match(thread, /relationshipLoadedRef/u);
  assert.match(thread, /includeContext/u);
  assert.doesNotMatch(thread, /useStore\([^)]*relationshipContext/u);
});
