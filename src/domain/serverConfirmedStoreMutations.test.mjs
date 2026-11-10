import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const store = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const admin = readFileSync(new URL("../screens/AdminScreen.jsx", import.meta.url), "utf8");
const artistHub = readFileSync(new URL("../screens/ArtistHubScreen.jsx", import.meta.url), "utf8");
const notifications = readFileSync(new URL("../screens/NotificationsScreen.jsx", import.meta.url), "utf8");

function mutationSlice(startMarker, endMarker) {
  const start = store.indexOf(startMarker);
  const end = store.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing Store mutation slice: ${startMarker}`);
  return store.slice(start, end);
}

function assertServerFirst(source, stateCall, transport = "api") {
  const awaitServer = source.indexOf(`await ${transport}(`);
  const adoptState = source.indexOf(stateCall);
  assert.ok(awaitServer >= 0, "mutation must await the server");
  assert.ok(adoptState > awaitServer, `${stateCall} must occur only after server confirmation`);
  assert.match(source, /accountMutationIsCurrent/);
  assert.match(source, /return commandSuccess\(/);
  assert.match(source, /return commandError\(/);
  assert.doesNotMatch(source, /\.catch\(\(\) => \{\}\)/);
}

test("artist request decisions are server-first canonical commands", () => {
  const source = mutationSlice("const reviewArtistRequest =", "const approveArtist =");
  assertServerFirst(source, "setRequests(", "staffApi");
  assert.ok(source.indexOf("setUsers(") > source.indexOf("await staffApi("));
  assert.match(source, /const actor = currentMutationActor\(\)/);
  assert.match(source, /actor\.role !== "admin"/);
  assert.match(source, /staffScope !== staffScopeFor\(sessionRef\.current\)/);
  const transport = mutationSlice("const staffApi =", "const commitStaffAction =");
  assert.match(transport, /expectedAccountId: session\.id/);
  assert.equal((transport.match(/assertStaffMutation\(scope\)/g) || []).length, 2,
    "staff transport must assert the initiating scope before and after its request");
  const ownership = mutationSlice("const staffMutationStillOwned =", "const assertStaffMutation =");
  assert.match(ownership, /currentMutationActor\(\)/);
  assert.match(ownership, /renderedStaffEpoch === staffReadsRef\.current\.epoch/);
  assert.match(admin, /await \(action === "approve"[\s\S]*approveArtist\(request\.id, \{ \.\.\.evidence, signal: controller\.signal \}\)/);
  assert.match(admin, /That request was not[\s\S]*Nothing changed/);
  assert.match(admin, /error\?\.retryable/);
});

test("artist update deletion is server-first and exposes scoped retry feedback", () => {
  const source = mutationSlice("const removeArtistPost =", "// --- Ban / suspend");
  assertServerFirst(source, "setArtistPosts(");
  assert.match(source, /reconcileConfirmedArtistPostRemoval/);
  assert.match(artistHub, /await removeArtistPost\(artistName, postId, \{ signal: controller\.signal \}\)/);
  assert.match(artistHub, /artistPostMutation\.scope === artistPostScope/);
  assert.match(artistHub, /This artist post was not removed, so it is still visible/);
});

test("notification read lives in the scoped feature and only sends explicit IDs", () => {
  const state = readFileSync(new URL("../features/notifications/notificationActivityState.mjs", import.meta.url), "utf8");
  const transport = readFileSync(new URL("../features/notifications/notificationsApi.js", import.meta.url), "utf8");
  const command = readFileSync(new URL("../features/notifications/notificationReadCommand.mjs", import.meta.url), "utf8");
  assert.match(store, /useNotificationActivity/);
  assert.doesNotMatch(store, /api\("\/api\/me\/notifications\/read"/);
  assert.match(state, /markNotificationRows\(/);
  assert.match(command, /await writeReads\(/);
  assert.ok(command.indexOf("reconcileConfirmedNotificationReads(previous") > command.indexOf("await writeReads("));
  assert.match(command, /response\.notificationIds/);
  assert.match(transport, /\/api\/me\/notifications\/read\/scoped/);
  assert.match(notifications, /await markNotificationsRead\(\{ notificationIds:/);
  assert.match(notifications, /notificationReadState\?\.scope === notificationReadScope/);
  assert.match(notifications, /Only confirmed items have been updated/);
});

test("a post response cannot enter a different account's local feed", () => {
  const source = mutationSlice("const addLog =", "const reconcileEditedPost =");
  const success = source.slice(source.indexOf(".then(({ id, post })"), source.indexOf(".catch((error)"));
  const failure = source.slice(source.indexOf(".catch((error)"));

  assert.match(source, /const postingMutation = postingActor[\s\S]*captureAccountMutation\(postingActor\.id, accountMutationEpochRef\.current\)/);
  assert.match(source, /expectedAccountId: postingActor\.id/);
  assert.ok(success.indexOf("accountMutationIsCurrent(") < success.indexOf("setFeed("),
    "a stale success must be rejected before adopting the canonical post");
  assert.ok(failure.indexOf("accountMutationIsCurrent(") < failure.indexOf("setFeed("),
    "a stale failure must not remove content from the next account's feed");
  assert.match(success, /return \{ ok: true, id: id \|\| localId, post: null, stale: true \}/);
  assert.match(failure, /return \{ ok: false, error, stale: true \}/);
});


test("production Inbox badge uses server totals, not the one-message thread cache", () => {
  const source = mutationSlice("const inboxUnread =", "const requestCount =");
  const select = new Function("session", "ENABLE_DEMO_DATA", "notificationActivity", "mainThreads", `${source}; return inboxUnread();`);
  const onePreview = () => [{ unread: 1 }];
  assert.equal(select({ id: "A" }, false, { data: { inboxUnread: 126 } }, onePreview), 126);
  assert.equal(select({ id: "A" }, false, { data: { inboxUnread: 0 } }, onePreview), 0);
  assert.equal(select({ id: "B" }, false, { data: { inboxUnread: null } }, onePreview), 0);
  assert.equal(select(null, false, { data: { inboxUnread: 126 } }, onePreview), 0);
  assert.equal(select({ id: "demo" }, true, { data: { inboxUnread: null } }, onePreview), 1);
});
