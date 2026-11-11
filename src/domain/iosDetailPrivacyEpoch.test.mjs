import { claimIOSProfileRead } from "../lib/iosProfileReadFence.ios.js";
import { createIOSArtistSeenCount, createIOSArtistRatingLoader } from "../features/artistOverview/artistDetailReadsService.ios.js";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";
import { createIOSDetailPrivacyEpoch } from "./iosDetailPrivacyEpoch.mjs";
import { artistPageAccessDenied } from "./artistPageRead.mjs";
import { artistPageResourceKind } from "./artistPageCache.mjs";
import { accountMutationIsCurrent, captureAccountMutation } from "./accountMutation.mjs";
import { assertCurrentProfileRead, profileFailureOutcome, unavailableProfileOutcome, withoutUnavailableProfile, withoutUnavailableProfilePosts } from "./profileReadState.mjs";
import * as defaultPrivacy from "../lib/iosDetailPrivacy.js";
import * as iosPrivacy from "../lib/iosDetailPrivacy.ios.js";

const source = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const provider = parse(source, { sourceType: "module", plugins: ["jsx"] }).program.body
  .find((node) => node.declaration?.id?.name === "StoreProvider").declaration;
const declarations = provider.body.body.flatMap((node) => node.type === "VariableDeclaration" ? node.declarations : []);
function production(names, dependencies) {
  dependencies = { Platform: { OS: "ios" }, createIOSArtistSeenCount, createIOSArtistRatingLoader, ...dependencies };
  const body = names.map((name) => {
    const node = declarations.find((entry) => entry.id?.name === name);
    assert.ok(node, `Missing production Store function: ${name}`);
    return `const ${source.slice(node.start, node.end)};`;
  }).join("\n");
  return new Function(...Object.keys(dependencies), `${body}\nreturn { ${names.join(",")} };`)(...Object.values(dependencies));
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

// Mount privacy proof is immutable. A still-visible pane can stay mounted, but
// admitting fresh commands does not bless its old payload for later retention.
test("privacy generations synchronously invalidate an old occurrence without restamping it", () => {
  const epoch = createIOSDetailPrivacyEpoch();
  const mountedProof = epoch.getSnapshot();
  let commandAdmission = mountedProof;
  const notices = [];
  const unsubscribe = epoch.subscribe((...args) => notices.push({ revision: epoch.getSnapshot(), args }));
  assert.equal(epoch.invalidate(), mountedProof + 1);
  assert.deepEqual(notices, [{ revision: 1, args: [] }]);
  commandAdmission = epoch.getSnapshot();
  assert.equal(commandAdmission, 1);
  assert.notEqual(mountedProof, epoch.getSnapshot(), "fresh active commands cannot restore retention eligibility");
  const queuedBack = () => mountedProof === epoch.getSnapshot();
  assert.equal(queuedBack(), false, "queued Back fails before any React commit");
  unsubscribe();
  unsubscribe();
  assert.equal(epoch.invalidate(), 2);
  assert.equal(notices.length, 1);
});

test("only the iOS adapter publishes generations and subscribers receive no private payload", () => {
  let iosNotices = 0, otherNotices = 0;
  const offIOS = iosPrivacy.subscribeIOSDetailPrivacy((...args) => { assert.deepEqual(args, []); iosNotices++; });
  const offOther = defaultPrivacy.subscribeIOSDetailPrivacy(() => otherNotices++);
  const revision = iosPrivacy.getIOSDetailPrivacySnapshot();
  iosPrivacy.invalidateIOSDetailPrivacy();
  defaultPrivacy.invalidateIOSDetailPrivacy();
  assert.equal(iosPrivacy.getIOSDetailPrivacySnapshot(), revision + 1);
  assert.equal(defaultPrivacy.getIOSDetailPrivacySnapshot(), 0);
  assert.equal(iosNotices, 1);
  assert.equal(otherNotices, 0);
  offIOS(); offOther();
});

function profileFixture() {
  const epoch = createIOSDetailPrivacyEpoch(), request = deferred();
  const sessionRef = { current: { id: "viewer" } }, accountMutationEpochRef = { current: 1 };
  const writes = [], absorbed = [];
  const dependencies = {
    claimIOSProfileRead, session: sessionRef.current, sessionRef, accountMutationEpochRef,
    captureAccountMutation, assertCurrentProfileRead, profileFailureOutcome, unavailableProfileOutcome,
    withoutUnavailableProfile, withoutUnavailableProfilePosts,
    invalidateIOSDetailPrivacy: epoch.invalidate,
    userById: () => ({ id: "target", name: "Cached person" }),
    api: () => request.promise,
    setUsers: () => writes.push(["users", epoch.getSnapshot()]),
    setFeed: () => writes.push(["feed", epoch.getSnapshot()]),
    setUserStats: () => writes.push(["stats", epoch.getSnapshot()]),
    absorbUsers: (users) => absorbed.push(users), follows: { viewer: [] }, setFollows: () => {},
  };
  return { ...production(["loadUser"], dependencies), epoch, request, sessionRef, accountMutationEpochRef, writes, absorbed };
}

test("real profile quarantine fences retained payload before React setters run", async () => {
  for (const response of [403, 404, 410, "missing"]) {
    const f = profileFixture(), pending = f.loadUser("target");
    assert.equal(f.epoch.getSnapshot(), 0);
    if (response === "missing") f.request.resolve({ user: null });
    else f.request.reject(Object.assign(new Error("Unavailable"), { status: response }));
    assert.equal((await pending).evict, true);
    assert.equal(f.epoch.getSnapshot(), 1);
    assert.deepEqual(f.writes, [["users", 1], ["feed", 1], ["stats", 1]]);
  }
});

test("successful profile loads and transient failures preserve nested Profile continuity", async () => {
  const f = profileFixture(), pending = f.loadUser("target");
  f.request.resolve({ user: { id: "target", name: "Updated name" } });
  assert.equal((await pending).status, "ready");
  assert.equal(f.epoch.getSnapshot(), 0);
  assert.equal(f.absorbed.length, 1);
  const failed = profileFixture(), reading = failed.loadUser("target");
  failed.request.reject(Object.assign(new Error("Offline"), { status: 503 }));
  assert.equal((await reading).status, "stale");
  assert.equal(failed.epoch.getSnapshot(), 0);
  assert.deepEqual(failed.writes, []);
});

test("late profile denial cannot invalidate a replacement or returned account", async () => {
  for (const mode of ["switch", "roundtrip", "cancel"]) {
    const f = profileFixture(), controller = new AbortController();
    const pending = f.loadUser("target", { signal: controller.signal });
    if (mode === "switch") f.sessionRef.current = { id: "other" };
    if (mode === "roundtrip") f.accountMutationEpochRef.current += 2;
    if (mode === "cancel") controller.abort();
    f.request.reject(Object.assign(new Error("Unavailable"), { status: 403 }));
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(f.epoch.getSnapshot(), 0);
    assert.deepEqual(f.writes, []);
  }
});

test("block mutations rotate synchronously at both optimistic and settled boundaries", () => {
  const epoch = createIOSDetailPrivacyEpoch(), writes = [], aborts = [];
  const venuePhotoCacheRef = { current: { entries: new Map([["cached", {}]]), privacyEpoch: 0,
    privacy: { accountId: "viewer", blockGraphAuthoritative: true, pendingMutations: new Set(), revision: 0 } } };
  const venuePhotoInflightRef = { current: new Map([["read", { controller: { abort: () => aborts.push(epoch.getSnapshot()) } }]]) };
  const actions = production(["rotateVenuePhotoPrivacyScope", "beginVenuePhotoPrivacyMutation", "finishVenuePhotoPrivacyMutation"], {
    sessionRef: { current: { id: "viewer" } }, venuePhotoCacheRef, venuePhotoInflightRef,
    invalidateIOSDetailPrivacy: epoch.invalidate, setVenuePhotoPools: () => writes.push(epoch.getSnapshot()),
  });
  actions.beginVenuePhotoPrivacyMutation("hidden-person");
  assert.equal(epoch.getSnapshot(), 1);
  assert.equal(venuePhotoCacheRef.current.privacy.pendingMutations.has("hidden-person"), true);
  assert.deepEqual(aborts, [1]);
  actions.finishVenuePhotoPrivacyMutation("hidden-person");
  assert.equal(epoch.getSnapshot(), 2);
  assert.equal(venuePhotoCacheRef.current.privacy.pendingMutations.size, 0);
  assert.deepEqual(writes, [1, 2]);
});

test("muted identity sets invalidate only when their membership changes", () => {
  const epoch = createIOSDetailPrivacyEpoch(), blockedIdsRef = { mutedIds: [] };
  const { setMutedIds } = production(["setMutedIds"], { blockedIdsRef,
    invalidateIOSDetailPrivacy: epoch.invalidate, setBlockedIds: () => {} });
  setMutedIds([]);
  assert.equal(epoch.getSnapshot(), 0);
  setMutedIds(["one", "two"]);
  assert.equal(epoch.getSnapshot(), 1);
  setMutedIds(["two", "one"]);
  assert.equal(epoch.getSnapshot(), 1);
  setMutedIds((ids) => ids.filter((id) => id !== "one"));
  assert.equal(epoch.getSnapshot(), 2);
});

test("post removal fences its original route payload before queued feed updates and again on settle", async () => {
  for (const success of [true, false]) {
    const epoch = createIOSDetailPrivacyEpoch(), request = deferred(), writes = [];
    let feed = [{ id: "post", userId: "viewer" }];
    const { deleteOwnPost } = production(["deleteOwnPost"], {
      currentMutationActor: () => ({ id: "viewer" }), sessionRef: { current: { id: "viewer" } },
      accountMutationEpochRef: { current: 1 }, feedMutationRevisionRef: { current: 0 },
      captureAccountMutation, accountMutationIsCurrent, invalidateIOSDetailPrivacy: epoch.invalidate,
      setFeed: (update) => { writes.push(epoch.getSnapshot()); feed = update(feed); },
      setRemovedIds: () => writes.push(epoch.getSnapshot()), api: () => request.promise,
      removeProfileHistoryPost: () => {}, upsertProfileHistoryPost: () => {}, track: () => {},
    });
    const pending = deleteOwnPost("post");
    assert.equal(epoch.getSnapshot(), 1);
    assert.deepEqual(writes, [1]);
    if (success) request.resolve({ ok: true }); else request.reject(new Error("Rejected"));
    assert.equal((await pending).ok, success);
    assert.equal(epoch.getSnapshot(), 2);
    assert.deepEqual(writes, [1, 2]);
  }
});

test("authoritative feed removals fence before either state update while ordinary validation is inert", async () => {
  for (const invalidPostIds of [[], ["p_removed"]]) {
    const epoch = createIOSDetailPrivacyEpoch(), writes = [];
    const { revalidateCachedFeed } = production(["revalidateCachedFeed"], {
      sessionRef: { current: { id: "viewer" } }, authReadyRef: { current: true },
      feedRef: { current: [{ id: "p_removed" }] }, feedRevalidationOffsetRef: { current: 0 },
      feedMutationRevisionRef: { current: 0 }, api: async () => ({ invalidPostIds }),
      invalidateIOSDetailPrivacy: epoch.invalidate,
      setFeed: () => writes.push(epoch.getSnapshot()), setRemovedIds: () => writes.push(epoch.getSnapshot()),
    });
    assert.equal(await revalidateCachedFeed(), true);
    assert.equal(epoch.getSnapshot(), invalidPostIds.length ? 1 : 0);
    assert.deepEqual(writes, invalidPostIds.length ? [1, 1] : []);
  }
});

test("photo removal and restoration fence before deferred React updates", () => {
  const epoch = createIOSDetailPrivacyEpoch(), writes = [];
  const actions = production(["removePhoto", "restorePhoto"], {
    invalidateIOSDetailPrivacy: epoch.invalidate, setRemovedPhotos: () => writes.push(epoch.getSnapshot()),
  });
  actions.removePhoto("private-uri");
  actions.restorePhoto("private-uri");
  assert.deepEqual(writes, [1, 2]);
});

test("remaining real Store privacy boundaries keep synchronous notifications and no new hooks", () => {
  const checks = {
    resetStaffState: "staffReadsRef.current.reset()",
    logout: "authValidationSequenceRef.current += 1",
    invalidateArtistPageCache: "artistPageCache.invalidate()",
    refreshBlockedDirectory: 'blockedIdsRef.status = "loading"',
    adoptAccountPreference: "sessionRef.current = merged",
    moderateReport: "await staffApi(",
    moderateContent: "await staffApi(",
    patchStaffMember: "setAdminMembers(",
  };
  for (const [name, write] of Object.entries(checks)) {
    const node = declarations.find((entry) => entry.id?.name === name);
    const callback = source.slice(node.start, node.end);
    const fence = callback.indexOf("invalidateIOSDetailPrivacy()");
    assert.ok(fence >= 0 && callback.indexOf(write) > fence, `${name} must fence before ${write}`);
  }
  const absorb = declarations.find((entry) => entry.id?.name === "absorbUsers");
  assert.doesNotMatch(source.slice(absorb.start, absorb.end), /invalidateIOSDetailPrivacy/);
  assert.match(source, /const invalidateIOSDetailPrivacy = Platform\.OS === "ios" \? require\("\.\/lib\/iosDetailPrivacy"\)\.invalidateIOSDetailPrivacy : null/);
  assert.doesNotMatch(source, /useSyncExternalStore/);
});


test("artist reads forward occurrence cancellation and discard late personal seen counts", async () => {
  for (const mode of ["cancel", "roundtrip", "success"]) {
    const request = deferred(), calls = [], seenCountCache = { current: new Map() };
    const accountMutationEpochRef = { current: 1 }, controller = new AbortController();
    const { artistSeenCount } = production(["artistSeenCount"], {
      sessionRef: { current: { id: "viewer" } }, accountMutationEpochRef, seenCountCache,
      accountTargetScope: (id, target) => `${id}:${target}`, norm: (s) => s.toLowerCase(),
      captureAccountMutation, accountMutationIsCurrent,
      api: (...args) => { calls.push(args); return request.promise; },
    });
    const pending = artistSeenCount("Artist", { signal: controller.signal });
    assert.equal(calls[0][1].signal, controller.signal);
    assert.equal(calls[0][1].expectedAccountId, "viewer");
    if (mode === "cancel") controller.abort();
    if (mode === "roundtrip") accountMutationEpochRef.current += 2;
    request.resolve({ count: 4 });
    assert.deepEqual(await pending, mode === "success" ? { count: 4 } : null);
    assert.equal(seenCountCache.current.size, mode === "success" ? 1 : 0);
  }
});

test("artist rating reads stop before dispatch when aborted and ignore late success after cover", async () => {
  const request = deferred(), calls = [], writes = [], controller = new AbortController();
  const { loadRating } = production(["loadRating"], {
    sessionRef: { current: { id: "viewer" } }, accountMutationEpochRef: { current: 1 },
    captureAccountMutation, accountMutationIsCurrent,
    ratingAggregateKey: () => "viewer:rating", rKey: () => "artist|album",
    claimRatingTicket: () => 1, ratingTicketIsCurrent: () => true,
    api: (...args) => { calls.push(args); return request.promise; }, setRatingAgg: (...args) => writes.push(args),
  });
  loadRating("album", "Artist", "Album", { signal: controller.signal });
  assert.equal(calls[0][1].signal, controller.signal);
  controller.abort();
  loadRating("album", "Artist", "Album", { signal: controller.signal });
  assert.equal(calls.length, 1);
  request.resolve({ avg: 4, count: 10, mine: 3 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, []);
});


function artistPageFixture({ profile = { bio: "Owner biography", feedEnabled: true }, posts = [{ id: "update" }] } = {}) {
  const epoch = createIOSDetailPrivacyEpoch(), request = deferred(), writes = [];
  const owner = { current: true }, sessionRef = { current: { id: "viewer" } };
  const { loadArtistPage } = production(["loadArtistPage"], {
    norm: (name) => name.toLowerCase(), sessionRef,
    accountTargetScope: (accountId, target) => `${accountId}:${target}`,
    artistPageResourceKind, artistPageAccessDenied, invalidateIOSDetailPrivacy: epoch.invalidate,
    artistProfiles: { artist: profile }, artistPosts: { artist: posts },
    artistPageCache: {
      claim: () => ({}), isCurrent: () => owner.current,
      resolveRefresh: () => { if (!owner.current) return false; writes.push(epoch.getSnapshot()); return true; },
    },
    api: () => request.promise, ago: () => "now", cacheArtists: () => {},
    commandSuccess: (value) => ({ ok: true, value }), commandError: (error) => ({ ok: false, error }),
    localCommandError: (code) => ({ ok: false, code }),
  });
  return { loadArtistPage, epoch, request, writes, owner, sessionRef };
}

test("artist snapshots only fence withdrawn cached posts, owner overlays, or publication permission", async () => {
  const snapshots = [
    [{ bio: "Owner biography", feedEnabled: true }, [{ id: "update" }], 0],
    [{ bio: "New biography", feedEnabled: true }, [{ id: "update" }, { id: "new" }], 0],
    [{ bio: "Owner biography", feedEnabled: true }, [], 1],
    [{}, [{ id: "update" }], 1],
    [{ bio: "Owner biography", feedEnabled: false }, [{ id: "update" }], 1],
  ];
  for (const [profile, posts, revision] of snapshots) {
    const f = artistPageFixture(), pending = f.loadArtistPage("Artist");
    f.request.resolve({ profile, posts, legacyProfile: false });
    assert.equal((await pending).ok, true);
    assert.equal(f.epoch.getSnapshot(), revision);
    assert.deepEqual(f.writes, [revision], "withdrawal notification precedes the cache commit");
  }
});

test("only a current artist access denial fences retained local content", async () => {
  for (const mode of ["current", "obsolete", "account", "cancel", "transient"]) {
    const f = artistPageFixture(), controller = new AbortController();
    const pending = f.loadArtistPage("Artist", { signal: controller.signal });
    if (mode === "obsolete") f.owner.current = false;
    if (mode === "account") f.sessionRef.current = { id: "other" };
    if (mode === "cancel") controller.abort();
    f.request.reject(Object.assign(new Error("Unavailable"), { status: mode === "transient" ? 503 : 403 }));
    assert.equal((await pending).ok, false);
    assert.equal(f.epoch.getSnapshot(), mode === "current" ? 1 : 0);
  }
});


test("web and Android keep ordinary Store writes without evaluating iOS privacy fences", () => {
  for (const OS of ["web", "android"]) {
    const writes = [];
    const blockedIdsRef = { mutedIds: [] };
    const actions = production(["setMutedIds", "removePhoto", "restorePhoto", "invalidateArtistPageCache"], {
      Platform: { OS }, blockedIdsRef,
      invalidateIOSDetailPrivacy: () => assert.fail(`${OS} must not call the iOS privacy adapter`),
      setBlockedIds: () => writes.push("muted"), setRemovedPhotos: () => writes.push("photos"),
      artistPageCache: { invalidate: () => writes.push("artist") },
    });
    actions.setMutedIds(["one"]);
    assert.deepEqual(blockedIdsRef.mutedIds, ["one"]);
    actions.removePhoto("uri"); actions.restorePhoto("uri"); actions.invalidateArtistPageCache();
    assert.deepEqual(writes, ["muted", "photos", "photos", "artist"]);
  }
});


test("web and Android select the original artist read implementations and transport options", async () => {
  for (const OS of ["web", "android"]) {
    const calls = [], writes = [], controller = new AbortController();
    controller.abort();
    const { artistSeenCount, loadRating } = production(["artistSeenCount", "loadRating"], {
      Platform: { OS }, sessionRef: { current: { id: "viewer" } }, accountMutationEpochRef: { current: 1 },
      accountTargetScope: (account, target) => `${account}:${target}`, norm: value => value.toLowerCase(),
      seenCountCache: { current: new Map() }, captureAccountMutation, accountMutationIsCurrent,
      ratingAggregateKey: () => "rating", rKey: () => "artist|album", claimRatingTicket: () => 1, ratingTicketIsCurrent: () => true,
      api: async (...args) => { calls.push(args); return args[0].startsWith("/api/artists/seen") ? { count: 4 } : { avg: 4, count: 3, mine: 4 }; },
      setRatingAgg: update => writes.push(update({})),
    });
    assert.deepEqual(await artistSeenCount("Artist", { signal: controller.signal }), { count: 4 });
    assert.deepEqual(calls[0][1], { silent: true });
    loadRating("album", "Artist", "Album", { signal: controller.signal });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls[1][1], { expectedAccountId: "viewer" });
    assert.deepEqual(writes, [{ rating: { avg: 4, count: 3, mine: 4 } }]);
  }
});
