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

function assertServerFirst(source, stateCall) {
  const awaitServer = source.indexOf("await api(");
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
  assertServerFirst(source, "setRequests(");
  assert.ok(source.indexOf("setUsers(") > source.indexOf("await api("));
  assert.match(source, /staffScope !== staffScopeFor\(sessionRef\.current\)/);
  assert.match(admin, /await \(action === "approve"[\s\S]*approveArtist\(request\.id, \{ signal: controller\.signal \}\)/);
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

test("notification read is server-first and never clears uncaptured rows", () => {
  const source = mutationSlice("const markNotificationsRead =", "const postOwner =");
  assertServerFirst(source, "setNotifications(");
  assert.match(source, /reconcileConfirmedNotificationReads/);
  assert.match(source, /const notificationIds = notifications/);
  assert.match(notifications, /await markNotificationsRead\(\{ signal: controller\.signal \}\)/);
  assert.match(notifications, /notificationReadState\.scope === notificationReadScope/);
  assert.match(notifications, /unread badge is unchanged/);
});
