import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { buildArtistSummary } from "../../domain/artistSummary.mjs";
import { createArtistOverviewController } from "./artistOverviewController.mjs";
import { fetchResolvedArtist } from "../artistSearch/artistSearchApi.mjs";

const require = createRequire(import.meta.url);
const hookSource = require("@babel/core").transformSync(
  readFileSync(new URL("./useArtistOverview.js", import.meta.url), "utf8"), {
    babelrc: false, configFile: false,
    plugins: [require.resolve("@babel/plugin-transform-modules-commonjs")],
  },
).code;

class AppError extends Error {
  constructor(message, options = {}) {
    super(message || "Could not load"); this.name = "AppError";
    this.retryable = false; Object.assign(this, options);
  }
}

// Exercise the real hook's memo/effect dependency wiring and real controller.
// The tiny React adapter lets each render/effect/response be ordered explicitly;
// it does not replace the loading, identity, cancellation, or failure logic.
function harness() {
  let memo, memoDeps, effectDeps, cleanup, nextEffect;
  const calls = [];
  const same = (before, after) => before && before.length === after.length
    && before.every((value, index) => Object.is(value, after[index]));
  const react = {
    useMemo(factory, deps) {
      if (!same(memoDeps, deps)) { memo = factory(); memoDeps = deps; }
      return memo;
    },
    useEffect(effect, deps) {
      if (!same(effectDeps, deps)) { nextEffect = effect; effectDeps = deps; }
    },
    useSyncExternalStore(_subscribe, snapshot) { return snapshot(); },
  };
  const module = { exports: {} };
  const dependencies = {
    react,
    "../../lib/diagnostics": { AppError },
    "./artistOverviewController.mjs": { createArtistOverviewController },
    "./services/artistOverviewApi.mjs": {
      readArtistOverview: (args) => new Promise((resolve, reject) => calls.push({ args, resolve, reject })),
    },
  };
  new Function("require", "module", "exports", hookSource)((name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected hook dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return {
    calls,
    render(artist) {
      const summary = buildArtistSummary({ name: "A$AP Rocky", key: "a$ap rocky", remoteArtist: artist });
      const state = module.exports.useArtistOverview({ artistKey: summary.profileKey });
      if (nextEffect) { cleanup?.(); cleanup = nextEffect(); nextEffect = null; }
      return state;
    },
    dispose() { cleanup?.(); },
  };
}

const persisted = { name: "A$AP Rocky", key: "artist/verified-rocky", transient: false };
const result = (id) => ({
  artist: { key: persisted.key, name: persisted.name },
  reputation: { ratingCount: 0, reviewCount: 0, showCount: 0, average: null },
  schedule: { items: [{ id }], total: 1, nextCursor: null, hasMore: false, legacy: false, coverage: { status: "fresh" } },
});
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("Store public lookup preserves the response transient marker before summary adoption", async () => {
  const source = readFileSync(new URL("../../store.js", import.meta.url), "utf8");
  const start = source.indexOf("  const resolveArtist = async (name,");
  const end = source.indexOf("  const remoteArtistMeta =", start);
  assert.ok(start >= 0 && end > start, "The real Store artist resolver must be available");
  const createResolver = new Function("remoteArtists", "norm", "api", "cacheArtists", "fetchResolvedArtist",
    source.slice(start, end) + "\nreturn resolveArtist;");
  for (const transient of [true, false]) {
    const cache = [];
    const lookup = createResolver({}, (name) => name.trim().toLowerCase(),
      async () => ({ artist: { name: persisted.name, key: persisted.key }, transient }),
      (artists) => cache.push(...artists), fetchResolvedArtist);
    const artist = await lookup(persisted.name);
    assert.equal(artist.transient, transient);
    assert.equal(cache[0].transient, transient);
    assert.equal(buildArtistSummary({ name: persisted.name, key: "a$ap rocky", remoteArtist: artist }).profileKey,
      transient ? "a$ap rocky" : persisted.key);
  }
  const unavailable = new AppError("Provider unavailable", { serverCode: "PROVIDER_UNAVAILABLE", retryable: true });
  const lookup = createResolver({}, (name) => name.trim().toLowerCase(),
    async () => { throw unavailable; }, () => assert.fail("failures must not cache a fake artist"), fetchResolvedArtist);
  assert.equal(await lookup("Optional metadata"), null, "an optional enrichment cannot remove the existing page");
  await assert.rejects(lookup("Interactive search", { throwOnError: true }), (error) => error === unavailable,
    "interactive lookup must not mislabel an outage as a missing artist");
});

test("a persisted canonical key arriving after initial 404 restarts the actual overview hook", async () => {
  const h = harness();
  try {
    h.render(null);
    assert.equal(h.calls[0].args.artistKey, "a$ap rocky");
    h.calls[0].reject(new AppError("Missing artist", { code: "PIT-REQ-002" }));
    await settle();
    assert.equal(h.render(null).resource.error.code, "PIT-REQ-002");
    const hydrated = h.render(persisted);
    assert.equal(hydrated.resource.status, "loading");
    assert.equal(hydrated.resource.data, null);
    assert.equal(hydrated.resource.error, null);
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[1].args.artistKey, persisted.key);
    h.calls[1].resolve(result("canonical-show")); await settle();
    assert.equal(h.render(persisted).resource.data.schedule.items[0].id, "canonical-show");
    assert.equal(h.calls.length, 2);
  } finally { h.dispose(); }
});

test("an explicit artist retry refreshes a cached provider preview and adopts the imported page", async () => {
  const source = readFileSync(new URL("../../store.js", import.meta.url), "utf8");
  const start = source.indexOf("  const resolveArtist = async (name,");
  const end = source.indexOf("  const remoteArtistMeta =", start);
  assert.ok(start >= 0 && end > start);
  const createResolver = new Function("remoteArtists", "norm", "api", "cacheArtists", "fetchResolvedArtist",
    source.slice(start, end) + "\nreturn resolveArtist;");
  const normalize = (name) => name.trim().toLowerCase();
  const preview = { name: "Imran Khan", key: "imran khan", publicSlug: "imran-khan", transient: true };
  const catalog = { [normalize(preview.name)]: preview };
  const cached = [];
  const calls = [];
  const unavailable = new AppError("Temporary network failure", { code: "PIT-NET-001", retryable: true });
  let response = unavailable;
  const lookup = createResolver(catalog, normalize, async (path, options) => {
    calls.push({ path, options });
    if (response instanceof Error) throw response;
    return response;
  }, (artists) => {
    cached.push(...artists);
    for (const artist of artists) catalog[normalize(artist.name)] = artist;
  }, fetchResolvedArtist);

  assert.equal(await lookup(preview.name), null, "a failed retry cannot pass the old preview as persisted identity");
  assert.equal(catalog[normalize(preview.name)], preview, "optional metadata stays available after a transport failure");
  assert.equal(cached.length, 0);
  response = { artist: { ...preview, transient: false }, transient: false };
  const controller = new AbortController();
  const recovered = await lookup(preview.name, { signal: controller.signal });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].path, "/api/artists/resolve?name=Imran%20Khan");
  assert.equal(calls[1].options.signal, controller.signal);
  assert.equal(recovered.transient, false);
  assert.equal(recovered.publicSlug, "imran-khan");
  assert.equal(cached.length, 1);
  assert.equal(await lookup(preview.name), recovered, "durable catalogue entries still use the local cache");
  assert.equal(calls.length, 2, "rendering a stored artist must not restart provider lookups");
});

test("transient hydration never changes scope and a late name-key response cannot replace canonical dates", async () => {
  const h = harness();
  try {
    h.render(null);
    h.render({ ...persisted, transient: true });
    assert.equal(h.calls.length, 1);
    h.render(persisted);
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[0].args.signal.aborted, true);
    h.calls[1].resolve(result("canonical-show")); await settle();
    h.calls[0].resolve(result("obsolete-show")); await settle();
    assert.equal(h.render(persisted).resource.data.schedule.items[0].id, "canonical-show");
  } finally { h.dispose(); }
});
