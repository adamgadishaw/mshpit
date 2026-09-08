import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { createJsonPersistence } from "./persistenceAdapter.mjs";
import { createAuthIntentPersistence } from "./authIntentPersistence.mjs";
import { AUTH_INTENT_KEY, createAuthTransitions } from "../domain/authTransitions.mjs";

// Re-execute the actual native adapter for each simulated process. Only its
// SQLite backing survives; the adapter's volatile Map and all auth memory die.
const source = readFileSync(new URL("./persist.native.js", import.meta.url), "utf8");
const body = parse(source, { sourceType: "module" }).program.body
  .filter((node) => node.type !== "ImportDeclaration")
  .map((node) => node.type === "ExportNamedDeclaration" ? node.declaration : node)
  .map((node) => source.slice(node.start, node.end)).join("\n");
const loadNativeAdapter = new Function("Storage", "createJsonPersistence", "AUTH_INTENT_KEY", `${body}\nreturn { load, save };`);

function device() {
  const disk = new Map();
  const storage = {
    getItemSync: (key) => disk.get(key) ?? null,
    setItemSync: (key, value) => disk.set(key, value),
    removeItemSync: (key) => disk.delete(key),
  };
  const restart = (revoke) => {
    const persistence = loadNativeAdapter(storage, createJsonPersistence, AUTH_INTENT_KEY);
    return createAuthTransitions({
      ...createAuthIntentPersistence({
        readStored: () => persistence.load(AUTH_INTENT_KEY, null),
        writeStored: (value) => persistence.save(AUTH_INTENT_KEY, value),
      }),
      revoke,
    });
  };
  return { disk, restart };
}

test("offline native logout stays blocked after process recreation and revokes on reconnect", async () => {
  const f = device();
  const first = f.restart(async () => { throw new Error("offline"); });
  assert.equal((await first.signOut()).kind, "pending");
  assert.equal(first.blocked(), true);
  assert.equal(f.disk.has(AUTH_INTENT_KEY), true);
  let revocations = 0;
  const restarted = f.restart(async () => { revocations += 1; });
  assert.equal(restarted.blocked(), true, "A still-valid cookie must not restore the signed-out account");
  assert.equal((await restarted.reconcile()).kind, "revoked");
  assert.equal(revocations, 1);
  assert.equal(restarted.blocked(), true, "Acknowledgment alone cannot unlock a late cookie");
});

test("process death during native sign-in preserves the pending-cookie barrier", async () => {
  const f = device(), first = f.restart(async () => {});
  void first.run({ request: () => new Promise(() => {}), accept: () => assert.fail("Process died before adoption") });
  assert.equal(first.pending(), true);
  const restarted = f.restart(async () => {});
  assert.equal(restarted.pending(), false);
  assert.equal(restarted.blocked(), true);
  assert.equal((await restarted.reconcile()).kind, "revoked");
});

test("deliberate successful native sign-in unlocks durably without persisting account data", async () => {
  const f = device(), first = f.restart(async () => {});
  await first.signOut();
  const signedIn = f.restart(async () => {});
  const result = await signedIn.run({
    request: async () => ({ user: { id: "private-account-identity" } }),
    accept: () => ({ ok: true }),
  });
  assert.equal(result.ok, true);
  const restarted = f.restart(async () => assert.fail("Successful sign-in must not be revoked"));
  assert.equal(restarted.blocked(), false);
  assert.equal((await restarted.reconcile()).kind, "skipped");
  assert.equal(f.disk.get(AUTH_INTENT_KEY).includes("private-account-identity"), false);
});
