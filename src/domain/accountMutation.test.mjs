import assert from "node:assert/strict";
import test from "node:test";
import { accountMutationIsCurrent, captureAccountMutation } from "./accountMutation.mjs";

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
