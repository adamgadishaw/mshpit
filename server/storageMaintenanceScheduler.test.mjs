import assert from "node:assert/strict";
import test from "node:test";
import { startStorageMaintenance } from "./storageMaintenanceScheduler.js";

test("small cleanup runs per minute, measurements per five minutes, shutdown stops both", () => {
  let at = 1000, callback, cleared = false, pruned = 0, swept = 0, measured = 0;
  const messages = [];
  const scheduler = startStorageMaintenance({
    database: {}, databasePath: "private-path", now: () => at,
    pruneProviders: () => { pruned++; }, sweepSessions: () => { swept++; },
    collect: () => { measured++; return { status: "watch", issues: [], warnings: ["disk_space_low"], databaseBytes: null,
      walBytes: null, reusableBytes: null, freeBytes: null, freePercent: null, snapshotHeadroomBytes: null, databaseReadMs: null }; },
    logger: { log: x => messages.push(x), warn: x => messages.push(x), error: x => messages.push(x) },
    setIntervalImpl: (fn, delay) => { callback = fn; assert.equal(delay, 60000); return { unref() {} }; },
    clearIntervalImpl: () => { cleared = true; },
  });
  for (let index = 0; index < 5; index++) { at += 60000; callback(); }
  assert.equal(pruned, 6); assert.equal(swept, 6); assert.equal(measured, 2);
  assert.match(messages[0], /disk_space_low/);
  assert.doesNotMatch(messages.join(" "), /private-path/);
  scheduler.stop(); callback();
  assert.equal(cleared, true); assert.equal(pruned, 6);
});

test("one failed job cannot cancel observations or the other cleanup", () => {
  let swept = 0, measured = 0;
  const messages = [];
  const scheduler = startStorageMaintenance({
    pruneProviders: () => { throw new Error("secret member content"); },
    sweepSessions: () => { swept++; },
    collect: () => { measured++; throw new Error("secret private database path"); },
    logger: { error: x => messages.push(x) }, setIntervalImpl: () => 1, clearIntervalImpl() {},
  });
  assert.equal(swept, 1); assert.equal(measured, 1);
  assert.equal(messages.length, 2); assert.doesNotMatch(messages.join(" "), /secret|member content|database path/);
  scheduler.stop();
});
