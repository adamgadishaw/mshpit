import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./mediaUpload.js", import.meta.url), "utf8");

test("SDK 57 native uploads use a foreground cancellable progress task", () => {
  assert.match(source, /prepared\.body\.createUploadTask\(ticket\.uploadUrl/);
  assert.match(source, /sessionType:\s*"foreground"/);
  assert.match(source, /signal:\s*deadline\.signal/);
  assert.match(source, /onProgress:\s*reportProgress/);
  assert.match(source, /task\.uploadAsync\(\)/);
  assert.match(source, /task\.release\?\.\(\)/);
});

test("web uploads use the cancellable byte-progress transport and preserve retry-safe status policy", () => {
  assert.match(source, /uploadBinaryWithProgress\(\{/);
  assert.match(source, /expectedBytes:\s*prepared\.fileSize/);
  assert.match(source, /mediaPutStatusAccepted\(status\)/);
  assert.match(source, /mediaUploadTimeoutMs\(prepared\)/);
  assert.doesNotMatch(source, /expoFetch\(ticket\.uploadUrl/);
});
