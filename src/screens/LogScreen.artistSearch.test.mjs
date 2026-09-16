import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { createAccountTaskScope } from "../domain/accountTaskScope.mjs";
import { createArtistLookupController } from "../features/artistSearch/artistLookupController.mjs";
import { COMPOSER_ARTIST_SEARCH_LIMIT, artistLookupFailureMessage, fetchArtistSuggestions, fetchResolvedArtist } from "../features/artistSearch/artistSearchApi.mjs";

const source = readFileSync(new URL("./LogScreen.jsx", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
function find(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) {
      for (const item of child) { const result = find(item, predicate); if (result) return result; }
    } else if (child && typeof child === "object") {
      const result = find(child, predicate); if (result) return result;
    }
  }
  return null;
}
function compileNode(node) {
  assert.ok(node);
  return (bindings) => new Function(...Object.keys(bindings), `return (${source.slice(node.start, node.end)});`)(...Object.values(bindings));
}
const callback = (name) => compileNode(find(ast, (node) => node.type === "VariableDeclarator" && node.id?.name === name)?.init);
const compileDirectory = callback("searchBeyondCatalogue");
const compileChange = callback("changeArtistText");
const compileChoose = callback("chooseArtist");
const compileCatalogue = compileNode(find(ast, (node) => node.type === "CallExpression" && node.callee?.name === "useEffect"
  && source.slice(node.arguments[0].start, node.arguments[0].end).includes("remoteFallback: false"))?.arguments[0]);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture({ apiClient = async () => ({ artists: [] }), query = "Unknown Artist" } = {}) {
  const state = { artist: query, artistPicked: false, artistAttaching: false, artistLoading: false,
    artistDirectoryLoading: false, artistDirectoryRetryAt: 0, artistHits: [], artistKey: null, artistError: "", artistSearchNotice: "" };
  const events = [], accountTasks = createAccountTaskScope();
  accountTasks.setAccount("account-a"); accountTasks.mount();
  let now = 1_000, timer;
  const bindings = {
    session: { id: "account-a" }, accountTasks, COMPOSER_ARTIST_SEARCH_LIMIT, artistLookupFailureMessage,
    fetchResolvedArtist, api: apiClient,
    searchArtistsApi: (query, options) => fetchArtistSuggestions(query, { ...options, apiClient }),
    artistRequestRef: { current: 0 }, artistCatalogControllerRef: { current: null },
    artistDirectoryRef: { current: createArtistLookupController({ clock: () => now }) },
    artistAttachRef: { current: { sequence: 0, controller: null } },
    setTimeout: (fn, delay) => { assert.equal(delay, 320); timer = fn; return 1; },
    clearTimeout: () => { timer = null; },
  };
  for (const field of Object.keys(state)) {
    bindings[`set${field[0].toUpperCase()}${field.slice(1)}`] = (value) => {
      state[field] = typeof value === "function" ? value(state[field]) : value;
      events.push({ field, value: state[field] });
    };
  }
  const render = (compile, extra = {}) => compile({ ...bindings, ...state, ...extra });
  return { state, events, bindings, render, fireTimer: () => { const run = timer; timer = null; return run?.(); },
    setNow: (value) => { now = value; } };
}

test("paused partial typing only queries the saved catalogue, even when every response is empty", async () => {
  const requests = [];
  const f = fixture({ apiClient: async (path) => { requests.push(path); return { artists: [] }; } });
  for (const partial of ["Ea", "Ear", "Earl", "Earl Sweat", "Earl Sweatshirt"]) {
    f.render(compileChange)(partial);
    const cleanup = f.render(compileCatalogue)();
    assert.equal(f.state.artistLoading, true);
    await f.fireTimer(); cleanup();
    assert.equal(f.state.artistLoading, false);
  }
  assert.equal(requests.length, 5);
  assert.ok(requests.every((path) => path.startsWith("/api/artists?q=") && !path.includes("/resolve")));
  assert.equal(f.state.artist, "Earl Sweatshirt");
  assert.equal(f.state.artistError, "");
});

test("an explicit directory search merges the exact unknown artist with similar catalogue suggestions", async () => {
  const calls = [], saved = { name: "Unknown Orchestra", key: "saved-orchestra" };
  const exact = { name: "Unknown Artist", mbid: "unknown-mbid", key: "unknown-artist" };
  const f = fixture({ apiClient: async (path, options) => { calls.push({ path, options }); return { artist: exact, transient: true }; } });
  f.state.artistHits = [saved];
  await f.render(compileDirectory)();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/artists/resolve?name=Unknown%20Artist");
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.deepEqual(f.state.artistHits, [{ ...exact, transient: true }, saved]);
  assert.equal(f.state.artistKey, null, "preview cannot silently attach a provider identity");
  const attached = { ...exact, key: "durable-artist", transient: false };
  await f.render(compileChoose, { attachArtistSuggestionApi: async (candidate, options) => {
    assert.equal(candidate.transient, true); assert.ok(options.signal instanceof AbortSignal); return attached;
  } })(f.state.artistHits[0]);
  assert.equal(f.state.artistPicked, true);
  assert.equal(f.state.artistKey, "durable-artist");
});

test("two immediate directory presses share one pending request before React renders busy state", async () => {
  const pending = deferred(); let requests = 0;
  const f = fixture({ apiClient: () => { requests += 1; return pending.promise; } });
  const press = f.render(compileDirectory);
  const first = press(), second = press();
  assert.equal(requests, 1);
  pending.resolve({ artist: { name: "Unknown Artist", key: "new-artist" }, transient: true });
  await Promise.all([first, second]);
  assert.equal(f.state.artistDirectoryLoading, false);
});

test("a failed transient attachment keeps the name as unlinked free text and releases posting", async () => {
  const f = fixture();
  await f.render(compileChoose, { attachArtistSuggestionApi: async () => { throw new Error("Directory unavailable"); } })(
    { name: "Unknown Artist", key: "provider-preview", transient: true },
  );
  assert.equal(f.state.artist, "Unknown Artist");
  assert.equal(f.state.artistPicked, false);
  assert.equal(f.state.artistKey, null);
  assert.equal(f.state.artistAttaching, false);
  assert.match(f.state.artistError, /post without linking/u);
  assert.match(source, /artistKey: artistPicked \? artistKey : null/u, "review submission explicitly preserves an unbound identity");
});

test("a provider outage retains the draft and suggestions and enforces a 30-second manual cooldown across edits", async () => {
  let requests = 0;
  const f = fixture({ apiClient: async () => {
    requests += 1;
    if (requests === 1) throw Object.assign(new Error("Provider unavailable"), { serverCode: "PROVIDER_UNAVAILABLE", status: 503 });
    return { artist: { name: "Recovered Artist", key: "recovered" } };
  } });
  const saved = { name: "Unknown Orchestra", key: "saved" };
  f.state.artistHits = [saved];
  await f.render(compileDirectory)();
  assert.equal(f.state.artist, "Unknown Artist");
  assert.deepEqual(f.state.artistHits, [saved]);
  assert.equal(f.state.artistDirectoryLoading, false);
  assert.equal(f.state.artistDirectoryRetryAt, 31_000);
  assert.match(f.state.artistError, /temporarily unavailable/u);
  await f.render(compileDirectory)();
  f.render(compileChange)("Unknown Artists");
  await f.render(compileDirectory)();
  assert.equal(requests, 1, "editing a letter cannot bypass a provider cooldown");
  f.setNow(31_001);
  await f.render(compileDirectory)();
  assert.equal(requests, 2);
  assert.equal(f.state.artistError, "");
  assert.equal(f.state.artistHits[0].key, "recovered");
});

test("a confirmed no-match is distinct from failure and leaves free-text posting available", async () => {
  const f = fixture({ apiClient: async () => ({ artist: null }) });
  const saved = { name: "Unknown Orchestra", key: "saved" };
  f.state.artistHits = [saved];
  await f.render(compileDirectory)();
  assert.deepEqual(f.state.artistHits, [saved]);
  assert.equal(f.state.artist, "Unknown Artist");
  assert.equal(f.state.artistError, "");
  assert.match(f.state.artistSearchNotice, /post without linking/u);
});

test("text changes abort old directory work and reject late success or failure", async () => {
  for (const failure of [false, true]) {
    const pending = deferred(); let signal;
    const f = fixture({ apiClient: (_path, options) => { signal = options.signal; return pending.promise; } });
    const run = f.render(compileDirectory)();
    f.render(compileChange)("Different Artist");
    const before = f.events.length;
    assert.equal(signal.aborted, true);
    if (failure) pending.reject(Object.assign(new Error("Provider failure"), { code: "PROVIDER_UNAVAILABLE" }));
    else pending.resolve({ artist: { name: "Stale Artist", key: "stale" } });
    await run;
    assert.equal(f.events.length, before);
    assert.equal(f.state.artist, "Different Artist");
    assert.deepEqual(f.state.artistHits, []);
  }
});

test("catalogue and explicit lookup completions cannot cross logout, account switch, round trip or unmount", async () => {
  for (const boundary of ["logout", "switch", "round-trip", "unmount"]) {
    for (const mode of ["catalogue", "directory"]) {
      const pending = deferred();
      const f = fixture({ apiClient: () => pending.promise });
      let run, cleanup;
      if (mode === "catalogue") { cleanup = f.render(compileCatalogue)(); run = f.fireTimer(); }
      else run = f.render(compileDirectory)();
      if (boundary === "unmount") f.bindings.accountTasks.dispose();
      else {
        f.bindings.accountTasks.setAccount(boundary === "logout" ? null : "account-b");
        if (boundary === "round-trip") f.bindings.accountTasks.setAccount("account-a");
      }
      const before = f.events.length;
      pending.resolve({ artists: [{ name: "Old account result", key: "old" }], artist: { name: "Old account result", key: "old" } });
      await run; cleanup?.();
      assert.equal(f.events.length, before, `${mode}: ${boundary}`);
    }
  }
});

test("short names, linked artists, attachment work and active catalogue searches cannot start directory requests", async () => {
  for (const patch of [{ artist: "Ea" }, { artistPicked: true }, { artistAttaching: true }, { artistLoading: true }]) {
    let requests = 0;
    const f = fixture({ apiClient: async () => { requests += 1; return {}; } });
    Object.assign(f.state, patch);
    await f.render(compileDirectory)();
    assert.equal(requests, 0);
  }
});
