import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createPasswordWorkQueue } from "./passwordWork.js";

test("password work bounds active and waiting requests, rejects excess, and drains after failures", async () => {
  const enqueue = createPasswordWorkQueue({ concurrency: 1, maxQueued: 1 });
  let release;
  let running = 0;
  let peak = 0;
  const first = enqueue(async () => {
    running++; peak = Math.max(peak, running);
    await new Promise((resolve) => { release = resolve; });
    running--; throw new Error("fixture failure");
  });
  const failed = assert.rejects(first, /fixture failure/);
  const second = enqueue(() => { running++; peak = Math.max(peak, running); running--; return "next"; });
  await assert.rejects(enqueue(() => "must never run"), (error) => error.status === 429 && error.code === "RATE_LIMITED");
  release();
  await failed;
  assert.equal(await second, "next");
  assert.equal(await enqueue(() => "recovered"), "recovered");
  assert.equal(peak, 1);
});

test("password queue releases slots when a job throws synchronously", async () => {
  const enqueue = createPasswordWorkQueue({ concurrency: 1, maxQueued: 1 });
  await assert.rejects(enqueue(() => { throw new Error("sync failure"); }), /sync failure/);
  assert.equal(await enqueue(() => 42), 42);
});

test("HTTP credential boundaries never import blocking password helpers", () => {
  const api = readFileSync(new URL("./api.js", import.meta.url), "utf8");
  assert.match(api, /hashPasswordAsync as hashPassword/);
  assert.match(api, /verifyPasswordAsync as verifyPassword/);
  assert.match(api, /verifyPasswordForUserAsync as verifyPasswordForUser/);
  const owner = readFileSync(new URL("./features/ownerApprovals/ownerApprovalRoutes.js", import.meta.url), "utf8");
  assert.match(owner, /verifyPasswordForUserAsync/);
});
