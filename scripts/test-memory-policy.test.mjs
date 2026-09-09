import assert from "node:assert/strict";
import test from "node:test";
import { memoryBoundedTestArguments } from "./test-memory-policy.mjs";

test("small hosted builds serialize test files without disabling real memory admission", () => {
  assert.deepEqual(memoryBoundedTestArguments(["server/imageProcessor.test.mjs"], 2 * 1024 ** 3),
    ["--test-concurrency=1", "server/imageProcessor.test.mjs"]);
  assert.deepEqual(memoryBoundedTestArguments([], 0), []);
  assert.deepEqual(memoryBoundedTestArguments([], 16 * 1024 ** 3), []);
  assert.deepEqual(memoryBoundedTestArguments(["--test-concurrency=2"], 2 * 1024 ** 3),
    ["--test-concurrency=2"]);
});
