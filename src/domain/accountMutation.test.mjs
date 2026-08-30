import assert from "node:assert/strict";
import test from "node:test";
import { accountMutationIsCurrent, captureAccountMutation } from "./accountMutation.mjs";
import { reconcileConfirmedArtistPostRemoval } from "./artistPostMutation.mjs";
import { reconcileConfirmedNotificationReads } from "./notificationReadMutation.mjs";

test("a deferred account A mutation cannot be adopted after switching to B", async () => {
  const pending = captureAccountMutation("account-a", 4);
  assert.equal(accountMutationIsCurrent(pending, "account-a", 4), true);
  let accountId = "account-a";
  let epoch = 4;
  let resolveResponse;
  const response = new Promise((resolve) => { resolveResponse = resolve; });
  let adopted = null;
  const mutation = (async () => {
    const value = await response;
    if (!accountMutationIsCurrent(pending, accountId, epoch)) return { ok: false, stale: true };
    adopted = value;
    return { ok: true };
  })();
  accountId = "account-b";
  epoch = 5;
  resolveResponse({ id: "playlist-owned-by-a" });
  assert.deepEqual(await mutation, { ok: false, stale: true });
  assert.equal(adopted, null);
  assert.equal(accountMutationIsCurrent(pending, "account-a", 5), false);
});

test("stale account completion cannot delete an artist update or clear notifications", async () => {
  let accountId = "account-a";
  let epoch = 8;
  const pending = captureAccountMutation(accountId, epoch);
  let artistPosts = { slowdive: [{ id: "ap-a", text: "A-owned command" }] };
  let notifications = [{ id: "n-a", userId: "account-a", read: false }];
  let finish;
  const response = new Promise((resolve) => { finish = resolve; });
  const command = (async () => {
    await response;
    if (!accountMutationIsCurrent(pending, accountId, epoch)) return false;
    artistPosts = reconcileConfirmedArtistPostRemoval(artistPosts, { artistKey: "slowdive", postId: "ap-a" });
    notifications = reconcileConfirmedNotificationReads(notifications, { accountId: "account-a", notificationIds: ["n-a"] });
    return true;
  })();
  accountId = "account-b";
  epoch += 1;
  finish({ ok: true });
  assert.equal(await command, false);
  assert.equal(artistPosts.slowdive.length, 1);
  assert.equal(notifications[0].read, false);
});

test("a profile save completion or rollback from A can never overwrite active account B", async () => {
  const pending = captureAccountMutation("account-a", 12);
  let activeSession = { id: "account-b", name: "B stays signed in" };
  const applyProfileProjection = (profile) => {
    if (!accountMutationIsCurrent(pending, activeSession.id, 13)) return { ok: false, stale: true };
    activeSession = profile;
    return { ok: true };
  };

  assert.deepEqual(applyProfileProjection({ id: "account-a", name: "A server response" }), { ok: false, stale: true });
  assert.deepEqual(activeSession, { id: "account-b", name: "B stays signed in" });
  assert.deepEqual(applyProfileProjection({ id: "account-a", name: "A rollback snapshot" }), { ok: false, stale: true });
  assert.deepEqual(activeSession, { id: "account-b", name: "B stays signed in" });
});
