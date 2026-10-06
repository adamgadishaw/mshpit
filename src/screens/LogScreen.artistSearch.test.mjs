import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { normalizeComposerDraft, composerDraftFingerprint } from "../domain/composerDraft.mjs";
import { composerCloseDecision } from "../domain/composerClosePolicy.mjs";
import { buildReviewCreateBody } from "../domain/post-payload.mjs";
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
const compileKeepName = callback("keepArtistName");
const compileStep = callback("goToLogStep");
const compileClose = compileNode(find(ast, node => node.type === "AssignmentExpression"
  && node.left?.object?.name === "requestCloseRef" && node.left?.property?.name === "current")?.right);
const compileCatalogue = compileNode(find(ast, (node) => node.type === "CallExpression" && node.callee?.name === "useEffect"
  && source.slice(node.arguments[0].start, node.arguments[0].end).includes("remoteFallback: false"))?.arguments[0]);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture({ apiClient = async () => ({ artists: [] }), query = "Unknown Artist" } = {}) {
  const state = { artist: query, artistPicked: false, artistNameConfirmed: false, artistAttaching: false, artistLoading: false,
    artistDirectoryLoading: false, artistDirectoryRetryAt: 0, artistHits: [], artistKey: null, artistError: "", artistSearchNotice: "" };
  const events = [], accountTasks = createAccountTaskScope();
  accountTasks.setAccount("account-a"); accountTasks.mount();
  let now = 1_000, timer;
  const bindings = {
    session: { id: "account-a" }, accountTasks, COMPOSER_ARTIST_SEARCH_LIMIT, artistLookupFailureMessage, isFestival: false,
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
  bindings.changeArtistText = value => render(compileChange)(value);
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
  for (const patch of [{ artist: "Ea" }, { artistPicked: true }, { artistNameConfirmed: true }, { artistAttaching: true }, { artistLoading: true }]) {
    let requests = 0;
    const f = fixture({ apiClient: async () => { requests += 1; return {}; } });
    Object.assign(f.state, patch);
    await f.render(compileDirectory)();
    assert.equal(requests, 0);
  }
});

test("keeping an entered name works with no results, similar names or a namesake without attaching any identity", async () => {
  for (const artists of [[], [{ name: "Unknown Orchestra", key: "similar" }], [{ name: "Unknown Artist", key: "different-band" }]]) {
    let searches = 0;
    const f = fixture({ apiClient: async () => { searches++; return { artists }; } });
    const cleanup = f.render(compileCatalogue)(); await f.fireTimer();
    assert.deepEqual(f.state.artistHits, artists);
    const keep = f.render(compileKeepName); keep(); keep();
    assert.equal(f.state.artist, "Unknown Artist");
    assert.equal(f.state.artistKey, null);
    assert.equal(f.state.artistPicked, false);
    assert.equal(f.state.artistNameConfirmed, true);
    assert.deepEqual(f.state.artistHits, []);
    const afterChoice = f.render(compileCatalogue)(); await f.fireTimer();
    await f.render(compileDirectory)();
    assert.equal(searches, 1, "confirming or pressing twice must not create/attach/search an artist");
    cleanup(); afterChoice();
  }
});

test("confirmed free names preserve short and punctuated names but reject blank or festival choices", () => {
  for (const name of ["X", "  Écho & The Satellites!  "]) {
    const f = fixture({ query: name }); f.render(compileKeepName)();
    assert.equal(f.state.artist, name.trim()); assert.equal(f.state.artistNameConfirmed, true);
  }
  for (const extra of [{ artist: "   " }, { isFestival: true }]) {
    const f = fixture(); f.render(compileKeepName, extra)();
    assert.equal(f.state.artistNameConfirmed, false);
  }
});

test("keeping a name cancels catalogue, directory and attachment work and ignores late results", async () => {
  for (const mode of ["catalogue", "directory", "attachment"]) {
    const pending = deferred(); let signal;
    const f = fixture({ apiClient: (_path, options) => { signal = options.signal; return pending.promise; } });
    let run, cleanup;
    if (mode === "catalogue") { cleanup = f.render(compileCatalogue)(); run = f.fireTimer(); }
    else if (mode === "directory") run = f.render(compileDirectory)();
    else run = f.render(compileChoose, { attachArtistSuggestionApi: (_candidate, options) => { signal = options.signal; return pending.promise; } })({ name: "Unknown Artist", transient: true });
    f.render(compileKeepName)();
    const before = f.events.length;
    assert.equal(signal.aborted, true, mode);
    pending.resolve({ name: "Wrong late name", key: "wrong-key", artists: [{ name: "Wrong late name", key: "wrong-key" }], artist: { name: "Wrong late name", key: "wrong-key" } });
    await run; cleanup?.();
    assert.equal(f.events.length, before, mode);
    assert.equal(f.state.artist, "Unknown Artist"); assert.equal(f.state.artistKey, null);
    assert.equal(f.state.artistNameConfirmed, true); assert.equal(f.state.artistAttaching, false);
  }
});

test("changing a confirmed name restores search and choosing a catalog namesake remains explicit", async () => {
  const f = fixture(); f.render(compileKeepName)();
  f.render(compileChange)("Unknown Artist");
  assert.equal(f.state.artistNameConfirmed, false);
  assert.equal(f.state.artistKey, null);
  await f.render(compileChoose)({ name: "Unknown Artist", key: "reviewed-namesake" });
  assert.equal(f.state.artistKey, "reviewed-namesake"); assert.equal(f.state.artistPicked, true);
  f.render(compileChange)("Different Unknown Artist"); f.render(compileKeepName)();
  assert.equal(f.state.artistKey, null, "an edited name never inherits the last selected page");
});

test("back navigation, draft persistence and reload keep an unlinked review's text and retry identity", () => {
  const f = fixture(); f.render(compileKeepName)();
  const draft = normalizeComposerDraft({ ...f.state, id: "draft_local_band", submissionId: "post_local_band_001", city: "Toronto", dims: { experience: 5 }, review: "Our local band's first show." });
  const before = { ...f.state }; let step = 2;
  const go = f.render(compileStep, { logSteps: ["The show", "Where and when", "The music", "Your story"], setLogStep: value => { step = value; }, requestAnimationFrame: fn => fn(), composerScrollRef: { current: null } });
  go(1); assert.equal(step, 1); go(2); assert.deepEqual(f.state, before);
  assert.equal(composerCloseDecision({ busy: false, editing: false, dirty: true, hasContent: true, hasDraft: true }), "confirm-draft-close");
  const restored = normalizeComposerDraft(JSON.parse(JSON.stringify(draft)));
  assert.equal(composerDraftFingerprint(restored), composerDraftFingerprint(draft));
  const resume = find(ast, node => node.type === "VariableDeclarator" && node.id?.name === "resume").init;
  for (const statement of resume.body.body) {
    const call = statement.expression;
    if (call?.type === "CallExpression" && ["changeArtistText", "setArtistPicked", "setArtistKey", "setArtistNameConfirmed"].includes(call.callee?.name)) {
      compileNode({ start: call.start, end: call.end })({ restored, ...f.bindings });
    }
  }
  assert.equal(f.state.artistNameConfirmed, true); assert.equal(f.state.artistKey, null);
  assert.equal(f.state.artist, "Unknown Artist");
  const body = buildReviewCreateBody({ ...restored, id: restored.submissionId, overall: restored.dims.experience });
  assert.equal(body.artistKey, null); assert.equal(body.artist, "Unknown Artist");
  assert.equal(body.review, draft.review); assert.equal(body.clientMutationId, draft.submissionId);
});

test("cancelling Close on web or native keeps the entered band and review and checkpoints a recoverable draft", () => {
  for (const os of ["web", "ios"]) {
    const f = fixture(); f.render(compileKeepName)();
    const draft = normalizeComposerDraft({ ...f.state, id: "draft_local", submissionId: "post_local_001", review: "The local band's first show." });
    const saved = []; let proceeded = 0, cancelled = 0;
    const before = { ...f.state };
    const close = compileClose({
      allowNextCloseRef: { current: false }, closePromptOpenRef: { current: false }, hasUnpersistablePendingMedia: false,
      composerCloseDecision, submitBusy: false, editing: null, effectiveComposerDirty: true, effectiveHasContent: true,
      draftIdRef: { current: draft.id }, currentDraft: draft, Platform: { OS: os },
      persistDraftSnapshot: value => saved.push(JSON.parse(JSON.stringify(value))),
      window: { confirm: message => { assert.match(message, /draft is saved/); return false; } },
      Alert: { alert: (_title, _message, actions) => actions.find(action => action.text === "Keep editing").onPress() },
      discardCurrentDraft: () => assert.fail("Cancel must not discard the draft"),
    });
    close({ proceed: () => proceeded++, cancel: () => cancelled++ });
    assert.equal(proceeded, 0); assert.equal(cancelled, 1);
    assert.deepEqual(f.state, before);
    assert.equal(saved[0].artist, draft.artist); assert.equal(saved[0].artistKey, null);
    assert.equal(saved[0].review, draft.review); assert.equal(saved[0].submissionId, draft.submissionId);
  }
});
