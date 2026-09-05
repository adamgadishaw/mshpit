import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
const hook = readFileSync(new URL("../hooks/useCanonicalArtistIdentity.js", import.meta.url), "utf8");

test("archive navigation carries a cached canonical key when one is available", () => {
  assert.match(app, /const cachedArtist = remoteArtistMeta\?\.\(name\)/);
  assert.match(app, /const resolvedArtistKey = artistKey \|\| cachedArtist\?\.key \|\| cachedArtist\?\.norm \|\| null/);
  assert.match(app, /artistArchive: \{ name, artistKey: resolvedArtistKey/);
});

test("name-only archive resolution is scoped, retryable, and never falls back to a display name", () => {
  assert.match(hook, /canonicalArtistIdentityScope\(\{ artistName, artistKey \}\)/);
  assert.match(hook, /Promise\.resolve\(resolverRef\.current\?\.\(cached\.artistName\)\)/);
  assert.match(hook, /status: identity\.artistKey \? "ready" : "unavailable"/);
  assert.match(hook, /retry: useCallback\(\(\) => setRevision/);
  assert.doesNotMatch(hook, /artistKey:\s*artistName/);
});
