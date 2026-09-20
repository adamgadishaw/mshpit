import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
const hook = readFileSync(new URL("../hooks/useCanonicalArtistIdentity.js", import.meta.url), "utf8");

test("archive navigation carries a cached canonical key when one is available", () => {
  assert.match(app, /const cachedArtist = remoteArtistMeta\?\.\(name\)/);
  assert.match(app, /const resolvedArtistKey = artistKey \|\| storedArtist\?\.key \|\| storedArtist\?\.norm \|\| null/);
  assert.match(app, /artistArchive: \{ name, artistKey: resolvedArtistKey/);
});

test("archive clicks never promote cached provider previews to attached route identities", () => {
  const start = app.indexOf("  const openArtistArchive =");
  const end = app.indexOf("  const openArtistTour =", start);
  assert.ok(start >= 0 && end > start);
  const createOpenArchive = new Function("remoteArtistMeta", "go", "track",
    app.slice(start, end) + "\nreturn openArtistArchive;");
  const frames = [];
  const cached = { name: "Imran Khan", key: "imran khan", publicSlug: "imran-khan", transient: true };
  const openArchive = createOpenArchive(() => cached, (frame) => frames.push(frame), () => {});
  openArchive(cached.name);
  assert.deepEqual(frames.pop(), { artistArchive: { name: cached.name, artistKey: null } },
    "the existing public identity resolver must still validate a preview-only artist");
  openArchive(cached.name, "trusted-attached-key", "trusted-public-slug");
  assert.deepEqual(frames.pop(), { artistArchive: { name: cached.name, artistKey: "trusted-attached-key", publicSlug: "trusted-public-slug" } });
  cached.transient = false;
  openArchive(cached.name);
  assert.deepEqual(frames.pop(), { artistArchive: { name: cached.name, artistKey: cached.key, publicSlug: cached.publicSlug } });
});

test("name-only archive resolution is scoped, retryable, and never falls back to a display name", () => {
  assert.match(hook, /canonicalArtistIdentityScope\(\{ artistName, artistKey \}\)/);
  assert.match(hook, /Promise\.resolve\(resolverRef\.current\?\.\(cached\.artistName\)\)/);
  assert.match(hook, /status: identity\.artistKey \? "ready" : "unavailable"/);
  assert.match(hook, /retry: useCallback\(\(\) => setRevision/);
  assert.doesNotMatch(hook, /artistKey:\s*artistName/);
});
