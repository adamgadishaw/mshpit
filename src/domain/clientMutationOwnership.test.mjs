import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { accountMutationIsCurrent, captureAccountMutation } from "./accountMutation.mjs";
import { clean, clampRating, LIMITS } from "./validation.mjs";
import { createChatClientMutationId } from "./chatDelivery.mjs";
import { createTicketRegistry } from "./latestWins.mjs";
import { createAccountPreferenceWrites } from "./accountPreferenceWrites.mjs";

// Run the production Store declarations, not reimplementations of their guards.
const source = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
const provider = ast.program.body.find((node) => node.declaration?.id?.name === "StoreProvider").declaration;
const declarations = provider.body.body.flatMap((node) => node.type === "VariableDeclaration" ? node.declarations : []);
const preferenceCases = [
  ["setProfileSearchIndexingEnabled", true, "updateProfileSearchIndexingPreference", "searchIndexingOptOut", false],
  ["setDirectMessagePolicy", "nobody", "updateDirectMessagePreference", "directMessagePolicy", "nobody"],
  ["setAgeBandClassification", "18_plus", "classifyAccountAgeBand", "ageBand", "18_plus"],
  ["setProfileAudience", "only_me", "updateProfileAudience", "profileAudience", "only_me"],
  ["setAnnouncementEmailsEnabled", false, "updateAnnouncementEmailPreference", "marketingOptOut", true],
];
const names = [
  "renderedAccountMutation", "currentMutationActor", "adoptAccountPreference", "writeAccountPreference",
  ...preferenceCases.map(([name]) => name), "exportMyData", "writePostComment", "addComment", "deleteOwnComment",
  "removeMyPostTag", "setGoingIntent", "addLoungeMessage", "addFanClubMessage", "sendDM",
  "rate", "markThreadRead", "joinFanClub", "addVenueReview", "applyMyAttendanceMutation",
  "updateProfile", "updateArtistProfile", "addArtistPost", "removeArtistPost",
  "chooseTheme",
  "claimRatingTicket", "ratingTicketIsCurrent", "loadRating",
  "aggRate",
];
const callbacks = names.map((name) => {
  const node = declarations.find((entry) => entry.id?.name === name);
  assert.ok(node, `Store must expose ${name}`);
  return `const ${source.slice(node.start, node.end)};`;
}).join("\n");
const owner = { id: "account-a", name: "A", ageBand: "unknown", profileAudience: "everyone", directMessagePolicy: "mutuals" };
const other = { id: "account-b", name: "B", ageBand: "unknown", profileAudience: "members", directMessagePolicy: "people_i_follow" };
const ratingKey = "Artist|Album";
const aggregateKey = (accountId) => `${accountId || "guest"}:album:${ratingKey}`;
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fixture({ actor = owner, ready = true, demo = false } = {}) {
  const calls = [], writes = [], effects = [];
  const sessionRef = { current: actor }, authReadyRef = { current: ready }, accountMutationEpochRef = { current: 1 };
  const state = { session: actor, users: actor ? [actor] : [], clubs: {}, directory: [{ artist: "Artist", members: 2 }], reviews: {} };
  state.comments = {};
  state.feed = [{ id: "post", comments: 0, commentPreview: [] }];
  state.albums = { [ratingKey]: { [owner.id]: 3 } };
  state.ratings = { [aggregateKey(actor?.id)]: { avg: 3, count: 1, mine: actor?.id ? 3 : 0 } };
  const ratingRegistry = createTicketRegistry();
  const update = (key) => (value) => { writes.push(key); state[key] = typeof value === "function" ? value(state[key]) : value; };
  const request = (name) => (...args) => new Promise((resolve, reject) => calls.push({ name, args, resolve, reject }));
  const dependencies = {
    session: actor, sessionRef, authReadyRef, accountMutationEpochRef,
    captureAccountMutation, accountMutationIsCurrent, clean, clampRating, LIMITS, createChatClientMutationId, createAccountPreferenceWrites,
    ENABLE_DEMO_DATA: demo, MEDIA_POST_MAX_ATTACHMENTS: 20,
    norm: (value) => String(value || "").trim().toLowerCase(), fcKey: (value) => String(value || "").trim().toLowerCase(),
    localCommandError: (code) => ({ ok: false, code }),
    commentCache: { capture: () => captureAccountMutation(sessionRef.current?.id, accountMutationEpochRef.current) },
    commentClaimIsCurrent: (claim) => accountMutationIsCurrent(claim, sessionRef.current?.id, accountMutationEpochRef.current),
    setComments: update("comments"), setFeed: update("feed"), feed: state.feed, feedMutationRevisionRef: { current: 0 },
    postOwner: () => "post-owner", notify: (...args) => effects.push(["notify", ...args]),
    setUsers: update("users"), setSession: update("session"), publicProfileCacheEntry: (user) => user,
    api: request("api"), track: (...args) => effects.push(args),
    applyTheme: (...args) => effects.push(["theme", ...args]),
    setFanClubs: update("clubs"), setFanClubDirectorySnapshot: update("directory"),
    fanClubDirectoryStatus: "ready", isFanClubMember: () => false,
    applyFanClubMembership: (rows, { joined }) => rows.map((row) => ({ ...row, joined })),
    setVenueReviews: update("reviews"),
    ratingTicketsRef: { current: ratingRegistry },
    rKey: (artist, title) => `${artist}|${title}`,
    ratingAggregateKey: (accountId, kind, artist, title) => `${accountId || "guest"}:${kind}:${artist}|${title}`,
    albumRatings: state.albums, songRatings: {}, ratingAgg: state.ratings, setRatingAgg: update("ratings"),
    ...Object.fromEntries(preferenceCases.map(([, , helper]) => [helper, request(helper)])),
  };
  const actions = new Function(...Object.keys(dependencies), `"use strict"; ${callbacks}\nreturn {${names.join(",")}};`)(...Object.values(dependencies));
  const adopt = (user, epoch = 1) => {
    sessionRef.current = user; state.session = user; accountMutationEpochRef.current += epoch;
  };
  return { actions, state, calls, writes, effects, adopt, sessionRef, ratingRegistry, setAlbums: update("albums") };
}

const commands = {
  ...Object.fromEntries(preferenceCases.map(([name, value]) => [name, (f) => f.actions[name](value)])),
  exportMyData: (f) => f.actions.exportMyData("private"),
  addComment: (f) => f.actions.addComment("post", "My comment"),
  deleteOwnComment: (f) => f.actions.deleteOwnComment("post", "comment"),
  removeMyPostTag: (f) => f.actions.removeMyPostTag("post"),
  setGoingIntent: (f) => f.actions.setGoingIntent({ artist: "Artist" }, true),
  addLoungeMessage: (f) => f.actions.addLoungeMessage("show", "Hello"),
  addFanClubMessage: (f) => f.actions.addFanClubMessage("Artist", "Hello"),
  sendDM: (f) => f.actions.sendDM(other.id, "Hello"),
  rate: (f) => f.actions.rate("album", () => assert.fail("no optimistic write"), "Artist", "Album", 4),
  markThreadRead: (f) => f.actions.markThreadRead(other.id),
  joinFanClub: (f) => f.actions.joinFanClub("Artist"),
  addVenueReview: (f) => f.actions.addVenueReview("Venue", { rating: 4, text: "Good room" }),
  applyMyAttendanceMutation: (f) => f.actions.applyMyAttendanceMutation({ id: "show" }, { showId: "show" }),
  updateProfile: (f) => f.actions.updateProfile({ bio: "New bio" }),
  updateArtistProfile: (f) => f.actions.updateArtistProfile("Artist", { bio: "New artist bio" }),
  addArtistPost: (f) => f.actions.addArtistPost("Artist", "New artist update"),
  removeArtistPost: (f) => f.actions.removeArtistPost("Artist", "post"),
};

for (const [name, invoke] of Object.entries(commands)) {
  test(`${name}: guest, unready and stale-render entrypoints cannot act as the next account`, async () => {
    for (const mode of ["guest", "unready", "logout", "switch", "roundtrip", "guest-login"]) {
      const f = fixture({ actor: mode.startsWith("guest") ? null : owner, ready: mode !== "unready" });
      if (mode === "logout") f.adopt(null);
      if (mode === "switch") f.adopt(other);
      if (mode === "roundtrip") { f.adopt(other); f.adopt({ ...owner }); }
      if (mode === "guest-login") f.adopt(owner);
      await invoke(f);
      assert.deepEqual(f.calls, [], mode);
      assert.deepEqual(f.writes, [], mode);
      assert.deepEqual(f.effects, [], mode);
    }
  });
}

for (const [name, value, helper, field, expected] of preferenceCases) {
  test(`${name}: binds its request and adopts only the server-confirmed preference`, async () => {
    const f = fixture(), pending = f.actions[name](value);
    assert.equal(f.calls[0].name, helper);
    assert.deepEqual(f.calls[0].args, [value, { expectedAccountId: owner.id }]);
    f.calls[0].resolve({ user: { ...owner, [field]: expected, name: "stale name", role: "admin" } });
    assert.equal((await pending).ok, true);
    assert.equal(f.state.session[field], expected);
    assert.equal(f.state.session.name, owner.name);
    assert.equal(f.state.session.role, undefined, "unrelated privilege fields cannot enter the session");
  });

  test(`${name}: rejects foreign/missing snapshots and late account epochs`, async () => {
    for (const mode of ["foreign", "missing-field", "logout", "switch", "roundtrip"]) {
      const f = fixture(), pending = f.actions[name](value);
      if (mode === "logout") f.adopt(null);
      if (mode === "switch") f.adopt(other);
      if (mode === "roundtrip") { f.adopt(other); f.adopt({ ...owner }); }
      const before = structuredClone(f.state);
      f.calls[0].resolve({ user: mode === "foreign" ? { ...other, [field]: expected }
        : mode === "missing-field" ? { id: owner.id } : { ...owner, [field]: expected } });
      assert.equal((await pending).ok, false);
      assert.deepEqual(f.state, before);
      assert.deepEqual(f.writes, []);
    }
  });
}

test("same-field privacy requests dispatch in user order without blocking independent fields", async () => {
  const f = fixture();
  const first = f.actions.setProfileAudience("members");
  const next = f.actions.setProfileAudience("only_me");
  const independent = f.actions.setDirectMessagePolicy("nobody");
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].name, "updateDirectMessagePreference");
  f.calls[1].resolve({ user: { ...owner, directMessagePolicy: "nobody" } });
  assert.equal((await independent).ok, true);
  f.calls[0].resolve({ user: { ...owner, profileAudience: "members" } });
  assert.equal((await first).ok, true);
  await tick();
  assert.equal(f.calls[2].args[0], "only_me");
  f.calls[2].resolve({ user: { ...owner, profileAudience: "only_me" } });
  assert.equal((await next).ok, true);
  assert.equal(f.state.session.profileAudience, "only_me");
  assert.equal(f.state.session.directMessagePolicy, "nobody");
});

test("failed second privacy write preserves the first confirmed value and a failed first does not block retry", async () => {
  for (const failFirst of [false, true]) {
    const f = fixture();
    const first = f.actions.setProfileAudience("members");
    const next = f.actions.setProfileAudience("only_me");
    if (failFirst) f.calls[0].reject(new Error("Rejected first choice"));
    else f.calls[0].resolve({ user: { ...owner, profileAudience: "members" } });
    await first; await tick();
    assert.equal(f.calls.length, 2);
    if (failFirst) f.calls[1].resolve({ user: { ...owner, profileAudience: "only_me" } });
    else f.calls[1].reject(new Error("Rejected second choice"));
    assert.equal((await next).ok, failFirst);
    assert.equal(f.state.session.profileAudience, failFirst ? "only_me" : "members");
  }
});

test("queued privacy requests cannot dispatch after logout or an account round trip", async () => {
  const f = fixture();
  const first = f.actions.setProfileAudience("members");
  const next = f.actions.setProfileAudience("only_me");
  f.adopt(other); f.adopt(owner);
  f.calls[0].resolve({ user: { ...owner, profileAudience: "members" } });
  assert.equal((await first).ok, false);
  assert.equal((await next).ok, false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.state.session.profileAudience, "everyone");
});

test("comment retry confirms the original row and authoritative count without repeated notification", async () => {
  const f = fixture();
  const options = { clientMutationId: "comment_retry_same_key" };
  const first = f.actions.addComment("post", "My comment", "missing-parent", options);
  assert.equal(f.calls[0].args[1].body.clientMutationId, options.clientMutationId);
  f.calls[0].reject(new Error("Server committed; connection lost before response"));
  assert.equal((await first).ok, false);
  assert.deepEqual(f.state.comments.post, []);
  const retry = f.actions.addComment("post", "My comment", "missing-parent", options);
  f.calls[1].resolve({ id: "server-comment", parentId: null, duplicate: true, commentCount: 1 });
  assert.equal((await retry).ok, true);
  assert.equal(f.state.comments.post.length, 1);
  assert.equal(f.state.comments.post[0].parentId, null);
  assert.equal(f.state.feed[0].comments, 1);
  assert.deepEqual(f.effects, []);
  // A retry after the canonical row was independently refreshed must also stay single.
  const duplicate = f.actions.addComment("post", "My comment", "missing-parent", options);
  f.calls[2].resolve({ id: "server-comment", parentId: null, duplicate: true, commentCount: 1 });
  await duplicate;
  assert.equal(f.state.comments.post.length, 1);
  assert.equal(f.state.feed[0].comments, 1);
});

test("per-post comment writes cannot return reversed counts and a later authoritative lower count is respected", async () => {
  const f = fixture();
  const first = f.actions.addComment("post", "First");
  const second = f.actions.addComment("post", "Second");
  assert.equal(f.calls.length, 1, "the second view queues its write rather than racing the first view");
  f.calls[0].resolve({ id: "first", parentId: null, commentCount: 1 });
  await first; await tick();
  assert.equal(f.state.feed[0].comments, 1);
  assert.equal(f.calls.length, 2);
  f.calls[1].resolve({ id: "second", parentId: null, commentCount: 2 });
  await second;
  assert.equal(f.state.feed[0].comments, 2);
  const remove = f.actions.deleteOwnComment("post", "first");
  const replay = f.actions.addComment("post", "Second", null, { clientMutationId: "comment_second_intent" });
  await tick();
  assert.equal(f.calls.length, 3, "a delete and a subsequent replay share the post's ordering boundary");
  f.calls[2].resolve({ tombstone: false });
  await remove; await tick();
  assert.equal(f.calls.length, 4);
  f.calls[3].resolve({ id: "second", parentId: null, duplicate: true, commentCount: 1 });
  await replay;
  assert.equal(f.state.feed[0].comments, 1, "canonical deletion counts must not be hidden by Math.max");
  assert.deepEqual(f.state.comments.post.map((comment) => comment.id), ["second"]);
});

test("comment writes for different posts stay independent and queued writes stop on account handoff", async () => {
  const f = fixture();
  const first = f.actions.addComment("post", "First");
  const queued = f.actions.addComment("post", "Second");
  const independent = f.actions.addComment("other-post", "Independent");
  assert.equal(f.calls.length, 2);
  f.adopt(other); f.adopt(owner);
  f.calls[0].resolve({ id: "first", parentId: null, commentCount: 1 });
  f.calls[1].resolve({ id: "other", parentId: null, commentCount: 1 });
  await Promise.all([first, queued, independent]);
  assert.equal(f.calls.length, 2);
});

test("new comments adopt authoritative counts and notify once, while late comment results stay out of replacement accounts", async () => {
  const f = fixture();
  const first = f.actions.addComment("post", "My comment");
  f.calls[0].resolve({ id: "server-comment", parentId: null, commentCount: 4 });
  assert.equal((await first).ok, true);
  assert.equal(f.state.feed[0].comments, 4);
  assert.equal(f.effects.filter(([name]) => name === "notify").length, 1);
  const second = f.actions.addComment("post", "Another comment");
  f.adopt(other); f.adopt(owner);
  const before = JSON.stringify(f.state);
  f.calls[1].resolve({ id: "stale-comment", parentId: null, commentCount: 5 });
  assert.equal((await second).stale, true);
  assert.equal(JSON.stringify(f.state), before);
});

test("concurrent independent privacy responses cannot undo a completed preference", async () => {
  const f = fixture();
  const dm = f.actions.setDirectMessagePolicy("nobody");
  const audience = f.actions.setProfileAudience("only_me");
  f.calls[1].resolve({ user: { ...owner, profileAudience: "only_me" } });
  assert.equal((await audience).ok, true);
  f.calls[0].resolve({ user: { ...owner, directMessagePolicy: "nobody" } });
  assert.equal((await dm).ok, true);
  assert.equal(f.state.session.profileAudience, "only_me");
  assert.equal(f.state.session.directMessagePolicy, "nobody");
});

test("a whole profile response cannot undo a newer privacy choice or adopt unrelated authority", async () => {
  for (const optimistic of [false, true]) {
    const f = fixture();
    const profile = f.actions.updateProfile({ concertMapVisible: false }, { optimistic });
    const privacy = f.actions.setProfileAudience("only_me");
    f.calls[1].resolve({ user: { ...owner, profileAudience: "only_me" } });
    assert.equal((await privacy).ok, true);
    f.calls[0].resolve({ user: { ...owner, concertMapVisible: false, profileAudience: "everyone", role: "admin", emailVerified: false, profileUpdatedAt: 10 } });
    const result = await profile;
    assert.equal(result.ok, true);
    assert.equal(result.user.profileAudience, "only_me");
    assert.equal(f.state.session.profileAudience, "only_me");
    assert.equal(f.state.session.concertMapVisible, false);
    assert.equal(f.state.session.role, undefined);
    assert.equal(f.state.session.emailVerified, undefined);
  }
});

test("failed optimistic profile edits preserve a separately confirmed privacy change", async () => {
  const f = fixture();
  const profile = f.actions.updateProfile({ bio: "Pending bio" });
  assert.equal(f.sessionRef.current.bio, "Pending bio");
  const privacy = f.actions.setDirectMessagePolicy("nobody");
  f.calls[1].resolve({ user: { ...owner, directMessagePolicy: "nobody" } });
  assert.equal((await privacy).ok, true);
  f.calls[0].reject(new Error("The bio save failed"));
  assert.equal((await profile).ok, false);
  assert.equal(f.state.session.directMessagePolicy, "nobody");
  assert.equal(f.sessionRef.current.directMessagePolicy, "nobody");
  assert.equal(Object.hasOwn(f.state.session, "bio"), false);
  assert.equal(Object.hasOwn(f.sessionRef.current, "bio"), false);
});

test("concurrent different profile fields merge independently and profile timestamps never move backwards", async () => {
  const f = fixture();
  const avatar = f.actions.updateProfile({ avatarUri: "https://media.example.test/new-avatar.jpg" }, { optimistic: false });
  const banner = f.actions.updateProfile({ banner: "https://media.example.test/new-banner.jpg" }, { optimistic: false });
  f.calls[1].resolve({ user: { ...owner, banner: "https://media.example.test/new-banner.jpg", profileUpdatedAt: 20 } });
  assert.equal((await banner).ok, true);
  f.calls[0].resolve({ user: { ...owner, avatarUri: "https://media.example.test/new-avatar.jpg", banner: null, profileUpdatedAt: 10 } });
  assert.equal((await avatar).ok, true);
  assert.equal(f.state.session.avatarUri, "https://media.example.test/new-avatar.jpg");
  assert.equal(f.state.session.banner, "https://media.example.test/new-banner.jpg");
  assert.equal(f.state.session.profileUpdatedAt, 20);
});

test("old profile rollback preserves a newer different field and a replaced same-field value", async () => {
  const f = fixture();
  const old = f.actions.updateProfile({ bio: "Old draft", avatarUri: "https://media.example.test/old.jpg" });
  const next = f.actions.updateProfile({ avatarUri: "https://media.example.test/new.jpg", banner: "https://media.example.test/banner.jpg" });
  f.calls[1].resolve({ user: { ...owner, avatarUri: "https://media.example.test/new.jpg", banner: "https://media.example.test/banner.jpg" } });
  assert.equal((await next).ok, true);
  f.calls[0].reject(new Error("Old save failed"));
  assert.equal((await old).ok, false);
  assert.equal(f.state.session.avatarUri, "https://media.example.test/new.jpg");
  assert.equal(f.state.session.banner, "https://media.example.test/banner.jpg");
  assert.equal(Object.hasOwn(f.state.session, "bio"), false);
});

test("music profile extras send only changed values, preserving explicit clears without echoing privacy", async () => {
  const f = fixture({ actor: { ...owner, theme: "stage", termsAcceptedAt: 100, analyticsOptOut: true, playlists: ["existing"] } });
  const pending = f.actions.updateProfile({ nowPlaying: null, playlists: [], role: "admin", analyticsOptOut: false }, { optimistic: false });
  assert.deepEqual(f.calls[0].args[1].body, { extras: { nowPlaying: null, playlists: [] } });
  f.calls[0].resolve({ user: { ...owner, nowPlaying: null, playlists: [], theme: "stale-theme", analyticsOptOut: false } });
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(f.state.session.theme, "stage");
  assert.equal(f.state.session.analyticsOptOut, true);
  assert.deepEqual(f.state.session.playlists, []);
  assert.equal(f.state.session.nowPlaying, null);
  assert.equal(f.state.session.role, undefined);
});

test("rating reads cannot publish into a returned account or guest epoch, even if ticket numbers repeat", async () => {
  for (const actor of [owner, null]) {
    for (const resetTickets of [false, true]) {
      const f = fixture({ actor });
      f.actions.loadRating("album", "Artist", "Album");
      assert.equal(f.calls[0].args[1].expectedAccountId, actor?.id || null);
      f.adopt(other); f.adopt(actor);
      if (resetTickets) {
        f.ratingRegistry.clear();
        assert.equal(f.actions.claimRatingTicket(aggregateKey(actor?.id)), 1, "the new epoch can reuse the old ticket number");
      }
      f.state.ratings = { fresh: { avg: 4, count: 8, mine: 4 } };
      const before = structuredClone(f.state.ratings);
      f.writes.length = 0;
      f.calls[0].resolve({ avg: 1, count: 1, mine: 1 });
      await tick();
      assert.deepEqual(f.state.ratings, before);
      assert.deepEqual(f.writes, []);
    }
  }
});

test("rating mutation success and failure cannot restore an old account epoch after a roundtrip", async () => {
  for (const failed of [false, true]) {
    for (const resetTickets of [false, true]) {
      const f = fixture();
      f.actions.rate("album", f.setAlbums, "Artist", "Album", 5);
      assert.equal(f.calls[0].args[1].expectedAccountId, owner.id);
      assert.equal(f.state.albums[ratingKey][owner.id], 5);
      f.adopt(other); f.adopt(owner);
      if (resetTickets) { f.ratingRegistry.clear(); f.actions.claimRatingTicket(aggregateKey(owner.id)); }
      f.state.albums = { fresh: { [owner.id]: 4 } };
      f.state.ratings = { fresh: { avg: 4, count: 8, mine: 4 } };
      const before = structuredClone(f.state);
      f.writes.length = 0;
      if (failed) f.calls[0].reject(new Error("Old rating failed"));
      else f.calls[0].resolve({ avg: 5, count: 1, mine: 5 });
      await tick();
      assert.deepEqual(f.state, before);
      assert.deepEqual(f.writes, []);
    }
  }
});

test("current-epoch ratings still adopt reads and successful writes, and roll back rejected writes", async () => {
  const read = fixture();
  read.actions.loadRating("album", "Artist", "Album");
  read.calls[0].resolve({ avg: 4, count: 2, mine: 3 });
  await tick();
  assert.deepEqual(read.state.ratings[aggregateKey(owner.id)], { avg: 4, count: 2, mine: 3 });
  for (const failed of [false, true]) {
    const f = fixture(), before = structuredClone(f.state);
    f.actions.rate("album", f.setAlbums, "Artist", "Album", 5);
    if (failed) f.calls[0].reject(new Error("Rejected"));
    else f.calls[0].resolve({ avg: 5, count: 1, mine: 5 });
    await tick();
    assert.deepEqual(f.state.albums, failed ? before.albums : { [ratingKey]: { [owner.id]: 5 } });
    assert.deepEqual(f.state.ratings, failed ? before.ratings : { [aggregateKey(owner.id)]: { avg: 5, count: 1, mine: 5 } });
  }
});

test("failed pre-handoff optimistic ratings cannot become a production fallback after account return", async () => {
  const f = fixture();
  f.actions.rate("album", f.setAlbums, "Artist", "Album", 5);
  assert.equal(f.state.albums[ratingKey][owner.id], 5);
  f.adopt(other); f.adopt(owner);
  f.state.ratings = {};
  f.calls[0].reject(new Error("The old rating never saved"));
  await tick();
  assert.deepEqual(f.actions.aggRate(f.state.albums, "Artist", "Album"), { avg: 0, count: 0, mine: 0 }, "an unconfirmed local map cannot fabricate a rating while the authoritative aggregate reloads");
});

test("explicit demo rating fallback retains its device-only sample aggregation", () => {
  const f = fixture({ demo: true });
  assert.deepEqual(f.actions.aggRate(f.state.albums, "Artist", "Album"), { avg: 3, count: 1, mine: 3 });
});

test("the account-transition boundary clears both production optimistic rating maps but preserves demo state", () => {
  const boundary = declarations.find((node) => node.id?.name === "adoptFeedAccount").init;
  const reset = boundary.body.body.find((node) => node.type === "IfStatement" && source.slice(node.start, node.end).includes("setAlbumRatings({})"));
  assert.ok(reset, "the actual identity boundary must retire both optimistic maps");
  const mutationEpoch = boundary.body.body.findIndex((node) => source.slice(node.start, node.end).includes("accountMutationEpochRef.current += 1"));
  assert.ok(boundary.body.body.indexOf(reset) > mutationEpoch, "the epoch closes before any old response can write back");
  for (const demo of [false, true]) {
    let albums = { old: { [owner.id]: 5 } }, songs = { old: { [owner.id]: 4 } };
    new Function("ENABLE_DEMO_DATA", "setAlbumRatings", "setSongRatings", source.slice(reset.start, reset.end))(
      demo, (value) => { albums = value; }, (value) => { songs = value; },
    );
    assert.deepEqual(albums, demo ? { old: { [owner.id]: 5 } } : {});
    assert.deepEqual(songs, demo ? { old: { [owner.id]: 4 } } : {});
  }
});

test("theme selection preserves deliberate guest use but rejects stale or unready account callbacks", async () => {
  const guest = fixture({ actor: null });
  assert.equal((await guest.actions.chooseTheme("light")).ok, true);
  assert.deepEqual(guest.calls, []);
  assert.deepEqual(guest.effects, [["theme", "light", null]]);
  for (const mode of ["unready", "logout", "switch", "roundtrip", "guest-login"]) {
    const f = fixture({ actor: mode === "guest-login" ? null : owner, ready: mode !== "unready" });
    if (mode === "logout") f.adopt(null);
    if (mode === "switch") f.adopt(other);
    if (mode === "roundtrip") { f.adopt(other); f.adopt(owner); }
    if (mode === "guest-login") f.adopt(owner);
    assert.equal((await f.actions.chooseTheme("light")).ok, false);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.effects, []);
  }
});

test("theme persistence binds the owner and cannot reload another account after late success or failure", async () => {
  for (const failed of [false, true]) {
    for (const changed of [false, true]) {
      const f = fixture(), pending = f.actions.chooseTheme("light");
      assert.equal(f.calls[0].args[1].expectedAccountId, owner.id);
      if (changed) { f.adopt(other); f.writes.length = 0; }
      if (failed) f.calls[0].reject(new Error("Offline"));
      else f.calls[0].resolve({});
      assert.equal((await pending).ok, !changed);
      assert.deepEqual(f.effects, changed ? [] : [["theme", "light", owner.id]]);
      if (changed) assert.deepEqual(f.writes, []);
    }
  }
});

for (const name of ["joinFanClub", "addVenueReview"]) {
  test(`${name}: transport is owner-bound and late success/failure cannot change the next account's cache`, async () => {
    for (const replacement of [null, other, { ...owner }]) {
      for (const failed of [false, true]) {
        const f = fixture(), pending = commands[name](f);
        assert.equal(f.calls.length, 1);
        assert.equal(f.calls[0].args[1].expectedAccountId, owner.id);
        assert.ok(f.writes.length > 0, "members keep optimistic feedback");
        f.adopt(replacement, replacement?.id === owner.id ? 2 : 1);
        f.state.clubs = { next: ["Another artist"] };
        f.state.directory = [{ artist: "Next artist", members: 3 }];
        f.state.reviews = { next: [{ id: "next-review" }] };
        const before = structuredClone(f.state);
        f.writes.length = 0;
        if (failed) f.calls[0].reject(new Error("Connection lost"));
        else f.calls[0].resolve({ id: "saved", joined: false });
        assert.equal((await pending).stale, true);
        assert.deepEqual(f.state, before);
        assert.deepEqual(f.writes, []);
        assert.deepEqual(f.effects, []);
      }
    }
  });

  test(`${name}: an active member's rejected request rolls back only its own optimistic row`, async () => {
    const f = fixture(), pending = commands[name](f);
    f.calls[0].reject(new Error("Rejected"));
    assert.equal((await pending).ok, false);
    if (name === "joinFanClub") assert.deepEqual(f.state.clubs[owner.id], []);
    else assert.deepEqual(f.state.reviews.venue, []);
  });
}

test("preference and tag/read transport helpers preserve explicit identity and cancellation", async () => {
  for (const [path, helperNames] of [
    ["../lib/accountPrivacyApi.js", preferenceCases.map(([, , helper]) => helper)],
    ["../features/chat/services/dmReadApi.mjs", ["writeDirectMessageRead"]],
    ["../features/postTags/services/postTagApi.mjs", ["removeMyPostTagRequest"]],
  ]) {
    const helperSource = readFileSync(new URL(path, import.meta.url), "utf8");
    const helperAst = parse(helperSource, { sourceType: "module" });
    const functions = helperAst.program.body.filter((node) => node.declaration?.type === "FunctionDeclaration")
      .map((node) => helperSource.slice(node.declaration.start, node.declaration.end)).join("\n");
    const calls = [];
    const helpers = new Function("api", `${functions}\nreturn {${helperNames.join(",")}};`)((...args) => { calls.push(args); return Promise.resolve({}); });
    for (const name of helperNames) {
      const signal = new AbortController().signal;
      await helpers[name]("value", { expectedAccountId: owner.id, signal });
      assert.equal(calls.at(-1)[1].expectedAccountId, owner.id);
      assert.equal(calls.at(-1)[1].signal, signal);
    }
  }
});
