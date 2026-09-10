import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { accountMutationIsCurrent, captureAccountMutation } from "./accountMutation.mjs";
import { normalizeArtistCampaign } from "./artistCampaignPost.mjs";
import { normalizeTaggedPeople, taggedUserIdsFromPeople } from "./postFriendTags.mjs";
import { deliverPostCreate } from "./postDelivery.mjs";
import { buildMemoryCreateBody, buildReviewCreateBody, cleanArtistKey } from "./post-payload.mjs";
import { clean, clampRating, LIMITS } from "./validation.mjs";

// Execute the actual Store callbacks and their rendered-account guard. Only
// React state, transport, and cache/analytics side effects are replaced.
const source = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
const provider = ast.program.body.find((node) => node.declaration?.id?.name === "StoreProvider").declaration;
const names = ["renderedAccountMutation", "currentMutationActor", "addLog", "toggleLike", "deleteOwnPost", "toggleMediaReaction"];
const declarations = provider.body.body.flatMap((node) => node.type === "VariableDeclaration" ? node.declarations : []);
const callbacks = names.map((name) => declarations.find((node) => node.id?.name === name))
  .filter(Boolean).map((node) => `const ${source.slice(node.start, node.end)};`).join("\n");
const owner = { id: "account-a" };
const other = { id: "account-b" };
const seedPost = { id: "post-1", userId: owner.id, kind: "status", review: "An excellent night", likes: 4 };
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fixture({ actor = owner, ready = true, demo = false } = {}) {
  const state = { feed: [structuredClone(seedPost)], myLikes: {}, likes: {}, media: { photo: { count: 3, mine: false } } };
  const writes = [], calls = [], effects = [];
  const sessionRef = { current: actor }, authReadyRef = { current: ready };
  const accountMutationEpochRef = { current: 1 }, feedMutationRevisionRef = { current: 0 };
  const update = (key) => (value) => { writes.push(key); state[key] = typeof value === "function" ? value(state[key]) : value; };
  const dependencies = {
    session: actor, sessionRef, authReadyRef, accountMutationEpochRef, feedMutationRevisionRef,
    captureAccountMutation, accountMutationIsCurrent,
    clean, clampRating, LIMITS, cleanArtistKey, normalizeArtistCampaign,
    normalizeTaggedPeople, taggedUserIdsFromPeople, buildMemoryCreateBody, buildReviewCreateBody,
    deliverPostCreate: (options) => deliverPostCreate({ ...options, retryDelaysMs: [] }),
    normalizeServerPost: (post) => post,
    AppError: class extends Error { constructor(message, options) { super(message); Object.assign(this, options); } },
    ENABLE_DEMO_DATA: demo,
    feed: state.feed, myLikes: state.myLikes, likes: state.likes,
    setFeed: update("feed"), setMyLikes: update("myLikes"), setLikes: update("likes"), setMediaReactions: update("media"),
    upsertProfileHistoryPost: (...args) => effects.push(["upsert", ...args]),
    removeProfileHistoryPost: (...args) => effects.push(["remove", ...args]),
    track: (...args) => effects.push(["track", ...args]),
    notify: (...args) => effects.push(["notify", ...args]), postOwner: () => owner.id,
    api: (path, options) => new Promise((resolve, reject) => calls.push({ path, options, resolve, reject })),
  };
  const actions = new Function(...Object.keys(dependencies), `"use strict"; ${callbacks}\nreturn { addLog, toggleLike, deleteOwnPost, toggleMediaReaction };`)(...Object.values(dependencies));
  const adopt = (user, epoch = 1) => { sessionRef.current = user; accountMutationEpochRef.current += epoch; };
  return { actions, state, calls, writes, effects, adopt, authReadyRef, sessionRef, accountMutationEpochRef, feedMutationRevisionRef };
}

const commands = {
  addLog: (f) => f.actions.addLog({ id: "draft-1", kind: "status", review: "New update" }),
  toggleLike: (f) => f.actions.toggleLike(seedPost.id, 4),
  deleteOwnPost: (f) => f.actions.deleteOwnPost(seedPost.id),
  toggleMediaReaction: (f) => f.actions.toggleMediaReaction("photo", seedPost.id),
};

for (const [name, invoke] of Object.entries(commands)) {
  test(`${name}: guests and stale render callbacks cannot mutate or dispatch`, async () => {
    for (const mode of ["guest", "demo-guest", "logout", "switch", "reentered", "unready", "guest-then-login"]) {
      const f = fixture({ actor: mode.includes("guest") ? null : owner, demo: mode === "demo-guest", ready: mode !== "unready" });
      if (mode === "logout") f.adopt(null);
      if (mode === "switch") f.adopt(other);
      if (mode === "reentered") f.adopt({ ...owner }, 2);
      if (mode === "guest-then-login") f.adopt(owner);
      const before = structuredClone(f.state);
      const result = invoke(f);
      assert.deepEqual(f.writes, [], mode);
      assert.deepEqual(f.effects, [], mode);
      assert.equal(f.feedMutationRevisionRef.current, 0, mode);
      assert.deepEqual(f.state, before, mode);
      assert.deepEqual(f.calls, [], mode);
      assert.equal((await result)?.ok, false, mode);
    }
  });

  test(`${name}: an active member retains optimistic behavior and actor-bound requests`, async () => {
    const f = fixture(), pending = invoke(f);
    assert.ok(f.writes.length > 0);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].options.expectedAccountId, owner.id);
    f.calls[0].resolve({ id: "canonical-1", liked: true, count: 4 });
    const result = await pending;
    assert.equal(result.ok, true);
    if (name === "addLog") assert.equal(f.state.feed[0].userId, owner.id);
  });

  test(`${name}: late success or failure cannot publish into a changed account epoch`, async () => {
    for (const replacement of [null, other, { ...owner }]) {
      for (const failed of [false, true]) {
        const f = fixture(), pending = invoke(f);
        assert.equal(f.calls.length, 1);
        f.adopt(replacement, replacement?.id === owner.id ? 2 : 1);
        f.state.feed = [{ id: "replacement-post" }];
        f.state.myLikes = { replacement: true };
        f.state.likes = { replacement: 2 };
        f.state.media = { replacement: { count: 7, mine: true } };
        const before = structuredClone(f.state), revision = f.feedMutationRevisionRef.current;
        f.writes.length = 0; f.effects.length = 0;
        if (failed) f.calls[0].reject(Object.assign(new Error("Rejected"), { status: 403 }));
        else f.calls[0].resolve({ id: "canonical-1", post: { ...seedPost, id: "canonical-1" }, liked: true, count: 4 });
        await pending; await tick();
        assert.deepEqual(f.state, before);
        assert.deepEqual(f.writes, []);
        assert.deepEqual(f.effects, []);
        assert.equal(f.feedMutationRevisionRef.current, revision);
      }
    }
  });

  test(`${name}: active-account rejection restores the optimistic state`, async () => {
    const f = fixture(), before = structuredClone(f.state), pending = invoke(f);
    const error = Object.assign(new Error("Rejected"), { status: 403 });
    f.calls[0].reject(error);
    const result = await pending; await tick();
    assert.equal(result.ok, false);
    if (name === "toggleLike") assert.equal(!!f.state.myLikes[seedPost.id], false);
    else assert.deepEqual(name === "toggleMediaReaction" ? f.state.media : f.state.feed, name === "toggleMediaReaction" ? before.media : before.feed);
  });
}

test("post authentication failures preserve the composer's structured error contract", async () => {
  const f = fixture({ actor: null });
  const result = await commands.addLog(f);
  assert.equal(result.ok, false);
  assert.equal(result.error.status, 401);
  assert.equal(result.error.serverCode, "AUTH_REQUIRED");
});

test("same-account profile refreshes do not invalidate legitimate actions", async () => {
  const f = fixture();
  f.adopt({ ...owner, emailVerified: true }, 0);
  const pending = commands.addLog(f);
  assert.equal(f.calls.length, 1);
  f.calls[0].resolve({ id: "canonical-1" });
  assert.equal((await pending).ok, true);
});

test("identity readiness resumes on a fresh tap without replaying a rejected action", async () => {
  for (const invoke of Object.values(commands)) {
    const f = fixture({ ready: false });
    assert.equal((await invoke(f)).ok, false);
    assert.equal(f.calls.length, 0);
    f.authReadyRef.current = true;
    await tick();
    assert.equal(f.calls.length, 0, "identity confirmation must not replay the old intent");
    const pending = invoke(f);
    assert.equal(f.calls.length, 1);
    f.calls[0].resolve({ id: "canonical-1", liked: true, count: 4 });
    assert.equal((await pending).ok, true);
  }
});

test("the account guard does not introduce new verification or onboarding restrictions", async () => {
  for (const invoke of Object.values(commands)) {
    const f = fixture({ actor: { ...owner, emailVerified: false, onboardingVersion: 0 } });
    const pending = invoke(f);
    assert.equal(f.calls.length, 1, "the server retains ownership of member eligibility policy");
    f.calls[0].resolve({ id: "canonical-1", liked: true, count: 4 });
    assert.equal((await pending).ok, true);
  }
});
