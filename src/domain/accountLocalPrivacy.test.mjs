import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  PLAYER_POSITION_STORAGE_KEY,
  PLAYER_STATE_STORAGE_KEY,
  accountPrivatePayloadsAfterLogout,
  accountScopedPrivateStorageKeys,
  purgeAccountLocalPrivacy,
  purgeAccountMediaDraftFiles,
} from "./accountLocalPrivacy.mjs";
import { createJsonPersistence } from "../lib/persistenceAdapter.mjs";

const memoryPersistence = () => {
  const values = new Map();
  const persistence = createJsonPersistence({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  });
  return { values, ...persistence };
};

test("logout payload policy removes only the departing account from shared stores", () => {
  const result = accountPrivatePayloadsAfterLogout({
    accountId: "account-a",
    drafts: [
      { id: "draft-a", ownerId: "account-a", text: "private A" },
      { id: "draft-b", ownerId: "account-b", text: "private B" },
      { id: "quarantined", ownerId: "__pit_legacy_draft_unclaimed__" },
    ],
    follows: { "account-a": ["fan-1"], "account-b": ["fan-2"] },
  });
  assert.deepEqual(result.drafts.map((draft) => draft.id), ["draft-b", "quarantined"]);
  assert.deepEqual(result.follows, { "account-b": ["fan-2"] });
});

test("logout purges every account-a private cache while preserving account-b and public caches", () => {
  const persistence = memoryPersistence();
  const privateA = accountScopedPrivateStorageKeys("account-a");
  const privateB = accountScopedPrivateStorageKeys("account-b");
  for (const key of privateA) persistence.save(key, { owner: "account-a" });
  for (const key of privateB) persistence.save(key, { owner: "account-b" });
  persistence.save("pit.drafts", [
    { id: "draft-a", ownerId: "account-a" },
    { id: "draft-b", ownerId: "account-b" },
  ]);
  persistence.save("pit.follows", { "account-a": ["fan-1"], "account-b": ["fan-2"] });
  persistence.save("pit.blocked", ["blocked-by-a"]);
  persistence.save("pit.myLikes", { postA: true });
  persistence.save("pit.analytics.v2", [{ id: "legacy-device-global-event" }]);
  persistence.save("pit.activeComposer", { composerId: "composer-a" });
  persistence.save("pit.pendingComposerPicker", { composerId: "composer-a", requestId: "picker-a" });
  persistence.save("pit.stack", [{ thread: { id: "private-thread-a" } }]);
  persistence.save(PLAYER_STATE_STORAGE_KEY, { ownerId: "account-a", state: { list: [{ title: "Secret song" }] } });
  persistence.save(PLAYER_POSITION_STORAGE_KEY, { ownerId: "account-b", position: { key: "safe-b", ms: 1000 } });
  persistence.save("pit.tourDates", [{ id: "public-show" }]);

  const result = purgeAccountLocalPrivacy({
    accountId: "account-a",
    load: persistence.load,
    save: persistence.save,
    remove: persistence.remove,
  });

  assert.equal(result.purged, true);
  for (const key of privateA) assert.equal(persistence.values.has(key), false, key);
  for (const key of privateB) assert.deepEqual(persistence.load(key, null), { owner: "account-b" }, key);
  assert.deepEqual(persistence.load("pit.drafts", []), [{ id: "draft-b", ownerId: "account-b" }]);
  assert.deepEqual(persistence.load("pit.follows", {}), { "account-b": ["fan-2"] });
  assert.equal(persistence.values.has("pit.blocked"), false);
  assert.equal(persistence.values.has("pit.myLikes"), false);
  assert.equal(persistence.values.has("pit.analytics.v2"), false);
  assert.equal(persistence.values.has("pit.activeComposer"), false);
  assert.equal(persistence.values.has("pit.pendingComposerPicker"), false);
  assert.equal(persistence.values.has("pit.stack"), false);
  assert.equal(persistence.values.has(PLAYER_STATE_STORAGE_KEY), false);
  assert.deepEqual(persistence.load(PLAYER_POSITION_STORAGE_KEY, null), {
    ownerId: "account-b",
    position: { key: "safe-b", ms: 1000 },
  });
  assert.deepEqual(persistence.load("pit.tourDates", []), [{ id: "public-show" }]);
});

test("logout with no authenticated account is a no-op", () => {
  const persistence = memoryPersistence();
  persistence.save("pit.blocked", ["guest-choice"]);
  assert.deepEqual(purgeAccountLocalPrivacy({
    accountId: null,
    load: persistence.load,
    save: persistence.save,
    remove: persistence.remove,
  }), { purged: false, accountId: null, drafts: [], follows: {} });
  assert.deepEqual(persistence.load("pit.blocked", []), ["guest-choice"]);
});

test("media draft cleanup retries transient filesystem failures", async () => {
  let attempts = 0;
  let reported = false;
  const result = await purgeAccountMediaDraftFiles({
    accountId: "account-a",
    deleteForOwner: async (ownerId) => {
      assert.equal(ownerId, "account-a");
      attempts += 1;
      return attempts === 3;
    },
    retryDelays: [10, 20],
    wait: async () => {},
    onFailure: () => { reported = true; },
  });

  assert.deepEqual(result, { deleted: true, attempts: 3, skipped: false });
  assert.equal(reported, false);
});

test("media draft cleanup surfaces a durable failure after retrying", async () => {
  const failures = [];
  const result = await purgeAccountMediaDraftFiles({
    accountId: "account-a",
    deleteForOwner: async () => false,
    retryDelays: [0, 0],
    wait: async () => {},
    onFailure: (error) => failures.push(error),
  });

  assert.deepEqual(result, { deleted: false, attempts: 3, skipped: false });
  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /could not be removed/i);
});

test("authoritative revalidation purge wins after another tab rewrites the departed account", () => {
  const persistence = memoryPersistence();
  const accountAKeys = accountScopedPrivateStorageKeys("account-a");
  for (const key of accountAKeys) persistence.save(key, { owner: "account-a", firstTab: true });
  persistence.save("pit.drafts", [
    { id: "draft-a", ownerId: "account-a" },
    { id: "draft-b", ownerId: "account-b" },
  ]);
  persistence.save("pit.follows", { "account-a": ["fan-a"], "account-b": ["fan-b"] });

  // The tab that initiated logout removes A first.
  purgeAccountLocalPrivacy({
    accountId: "account-a",
    load: persistence.load,
    save: persistence.save,
    remove: persistence.remove,
  });
  // A second open tab receives the cookie-change event and persists the outgoing
  // snapshots it still has in memory while adopting the locked guest state.
  persistence.save(accountAKeys[0], { owner: "account-a", rewrittenBySecondTab: true });
  persistence.save(accountAKeys.find((key) => key.startsWith("pit.comments.v2.")), { privateThread: true });
  persistence.save("pit.drafts", [
    { id: "draft-a", ownerId: "account-a" },
    { id: "draft-b", ownerId: "account-b" },
  ]);
  persistence.save("pit.follows", { "account-a": ["fan-a"], "account-b": ["fan-b"] });

  // The authoritative no-user result must finish with a second complete purge.
  purgeAccountLocalPrivacy({
    accountId: "account-a",
    drafts: persistence.load("pit.drafts", []),
    follows: persistence.load("pit.follows", {}),
    load: persistence.load,
    save: persistence.save,
    remove: persistence.remove,
  });

  for (const key of accountAKeys) assert.equal(persistence.values.has(key), false, key);
  assert.deepEqual(persistence.load("pit.drafts", []), [{ id: "draft-b", ownerId: "account-b" }]);
  assert.deepEqual(persistence.load("pit.follows", {}), { "account-b": ["fan-b"] });
});

test("Store wires the purge after personalized cache adoption and resets private memory", () => {
  const source = readFileSync(new URL("../store.js", import.meta.url), "utf8");
  const start = source.indexOf("const logout = () => {");
  const end = source.indexOf("const setAnalyticsEnabled", start);
  assert.ok(start >= 0 && end > start);
  const logout = source.slice(start, end);
  assert.ok(logout.indexOf("adoptFeedAccount(null)") < logout.indexOf("purgeAccountLocalPrivacy({"));
  assert.match(logout, /purgeProductAnalyticsAccount\(departingAccountId\)/);
  assert.match(logout, /draftsRef\.current = privacy\.drafts/);
  assert.match(logout, /setFollows\(privacy\.follows\)/);
  assert.match(logout, /setBlockedIds\(\[\]\)/);
  assert.match(logout, /setMyLikes\(\{\}\)/);
  assert.match(logout, /setRecommendationHiddenIds\(new Set\(\)\)/);
  assert.match(logout, /setPrivateListeningUntil\(0\)/);
  assert.match(logout, /setRecentSearchState\(\{ scope: "guest"/);
  assert.match(logout, /purgeLocalMediaDraftFiles\(departingAccountId\)/);
});

test("session revalidation retains the locked account until an authoritative boundary purges it", () => {
  const source = readFileSync(new URL("../store.js", import.meta.url), "utf8");
  const retireStart = source.indexOf("const retireRevalidatedAccount = (departingAccountId) => {");
  const retireEnd = source.indexOf("// Fold a server user", retireStart);
  assert.ok(retireStart >= 0 && retireEnd > retireStart);
  const retire = source.slice(retireStart, retireEnd);
  assert.ok(retire.indexOf("adoptFeedAccount(null)") < retire.indexOf("purgeAccountLocalPrivacy({"));
  assert.match(retire, /follows: blockedIdsRef\.follows/);
  assert.match(retire, /draftsRef\.current = privacy\.drafts/);
  assert.match(retire, /blockedIdsRef\.follows = privacy\.follows/);
  assert.match(retire, /purgeProductAnalyticsAccount\(id\)/);
  assert.match(retire, /purgeLocalMediaDraftFiles\(id\)/);

  const validationStart = source.indexOf("// Restore the session on reload.");
  const validationEnd = source.indexOf("// Server-first auth", validationStart);
  assert.ok(validationStart >= 0 && validationEnd > validationStart);
  const validation = source.slice(validationStart, validationEnd);
  assert.match(validation, /let lockedAccountId = null/);
  assert.match(validation, /const accountBeforeValidation = sessionRef\.current\?\.id \|\| lockedAccountId/);
  assert.match(validation, /String\(user\.id\) !== String\(departingAccountId\)/);
  assert.ok((validation.match(/retireRevalidatedAccount\(departingAccountId\)/g) || []).length >= 3);
  assert.match(validation, /event\.key !== AUTH_EPOCH_STORAGE_KEY/);
  assert.match(validation, /window\.addEventListener\("storage", onStorage\)/);
  assert.match(validation, /validate\(\{ force: true \}\)/);
  const requestBoundary = validation.slice(0, validation.indexOf('api("/api/me"'));
  assert.doesNotMatch(requestBoundary, /setSession\(null\)/,
    "a routine same-account focus check must not publish a false account exit");
});

test("permanent deletion adopts guest caches before its final comprehensive purge", () => {
  const source = readFileSync(new URL("../store.js", import.meta.url), "utf8");
  const start = source.indexOf("const deleteAccount = async (password) => {");
  const end = source.indexOf("const chooseTheme", start);
  assert.ok(start >= 0 && end > start);
  const deletion = source.slice(start, end);
  assert.match(deletion, /const devicePrivacy = accountPrivatePayloadsAfterLogout\(\{/);
  assert.ok(deletion.indexOf("adoptFeedAccount(null)") < deletion.lastIndexOf("purgeAccountLocalPrivacy({"));
  assert.match(deletion, /drafts: devicePrivacy\.drafts/);
  assert.match(deletion, /follows: devicePrivacy\.follows/);
  assert.match(deletion, /setPrivateListeningUntil\(0\)/);
  assert.match(deletion, /setRecentSearchState\(\{ scope: "guest"/);
  assert.match(deletion, /youtubeRejectedRef\.current = \{/);
  assert.ok(deletion.indexOf("purgeAccountLocalPrivacy({") < deletion.indexOf("await mediaDraftCleanup"),
    "account references must be purged before filesystem retry waits");
  assert.doesNotMatch(deletion, /save\((feedStorageKey|recommendationPreferenceStorageKey|recentSearchStorageKey)\(deleted\.id\), \[\]\)/);
  assert.doesNotMatch(deletion, /commentCache\.clearAccount\(deleted\.id\)/);
});

test("analytics retires the legacy unscoped retry queue on module load", () => {
  const source = readFileSync(new URL("../lib/productAnalytics.js", import.meta.url), "utf8");
  assert.match(source, /remove\(LEGACY_PRODUCT_ANALYTICS_STORAGE_KEY\)/);
  assert.match(source, /remove\(productAnalyticsStorageKey\(id\)\)/);
});

test("the player projects only the current account and never persists a mismatched render", () => {
  const source = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  assert.match(source, /const playerStateIsScoped = playerState\.accountId === playerAccountId/);
  assert.match(source, /const player = playerStateIsScoped \? playerState\.player : null/);
  assert.match(source, /if \(!web \|\| !authReady \|\| !playerStateIsScoped\) return/);
});

test("the shell discards composer and navigation memory before a confirmed account switch paints", () => {
  const source = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  assert.match(source, /useLayoutEffect\(\(\) => \{/);
  assert.match(source, /previousAccountId === nextAccountId/);
  assert.match(source, /remove\(ACTIVE_COMPOSER_KEY\)/);
  assert.match(source, /remove\(PENDING_COMPOSER_PICKER_KEY\)/);
  assert.match(source, /setPendingComposerPicker\(null\)/);
  assert.match(source, /setStack\(\[\{\}\]\)/);
});

test("the feed filter projects the incoming account before passive adoption", () => {
  const source = readFileSync(new URL("../screens/FeedScreen.jsx", import.meta.url), "utf8");
  assert.match(source, /const filterScope = feedFilterStorageKey\(accountId\)/);
  assert.match(source, /const filter = filterState\.scope === filterScope/);
  assert.match(source, /setFilterState\(\{ scope: filterScope, value: f \}\)/);
});
