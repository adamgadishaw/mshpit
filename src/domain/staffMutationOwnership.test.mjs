import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { captureAccountMutation, accountMutationIsCurrent } from "./accountMutation.mjs";
import { staffScopeFor } from "./staffReadCoordinator.mjs";
import { confirmedRoleMutationPatch } from "./moderationConsole.mjs";
import { clean, LIMITS } from "./validation.mjs";
import { commandSuccess } from "./commandResult.mjs";
import * as artistAccountApi from "../features/artistPage/artistAccountApi.mjs";
import { ARTIST_REQUEST_CONFIRMATION_ERROR, artistRequestFailureMessage, confirmedArtistRequest, mergeConfirmedArtistRequest, reconcileConfirmedArtistRequestDecision } from "./artistRequestMutation.mjs";

const source = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const provider = parse(source, { sourceType: "module", plugins: ["jsx"] }).program.body
  .find((node) => node.declaration?.id?.name === "StoreProvider").declaration;
const declarations = provider.body.body.flatMap((node) => node.type === "VariableDeclaration" ? node.declarations : []);
const names = ["renderedAccountMutation", "currentMutationActor", "renderedStaffEpoch", "staffMutationStillOwned", "assertStaffMutation", "staffApi", "commitStaffAction",
  "adminSetTrackVideo", "removeTrackOverride", "moderateReport", "moderateContent", "actionReport", "dismissReport", "removeContent", "restoreContent",
  "banUser", "unbanUser", "suspendUser", "liftSuspension", "setUserRole", "setVerified", "markEmailVerified", "setSponsor",
  "enrichArtists", "purgeArtist", "startCatalogSeed", "stopCatalogSeed", "removeLoungeMessage", "removeFanClubMessage", "removeComment", "prepareMemorialArtist",
  "artistAccountCommand", "requestArtist", "reviewArtistRequest", "approveArtist", "rejectArtist", "reviewArtistIdentity"];
const callbacks = names.map((name) => {
  const node = declarations.find((entry) => entry.id?.name === name);
  assert.ok(node, name);
  return `const ${source.slice(node.start, node.end).replace('import("./features/artistPage/artistAccountApi.mjs")', 'importArtistAccount()')};`;
}).join("\n");
const admin = { id: "staff-a", role: "admin" };
const fan = { id: "fan", role: "fan" };
const callsFor = {
  adminSetTrackVideo: (a) => a.adminSetTrackVideo({ title: "Song", artist: "Artist", none: true }),
  removeTrackOverride: (a) => a.removeTrackOverride({ title: "Song", artist: "Artist" }),
  moderateReport: (a) => a.moderateReport({ action: "remove", reportId: "report" }),
  moderateContent: (a) => a.moderateContent("post", "post", true),
  actionReport: (a) => a.actionReport("report"), dismissReport: (a) => a.dismissReport("report"),
  removeContent: (a) => a.removeContent("post"), restoreContent: (a) => a.restoreContent("post"),
  banUser: (a) => a.banUser("target"), unbanUser: (a) => a.unbanUser("target"),
  suspendUser: (a) => a.suspendUser("target", 3), liftSuspension: (a) => a.liftSuspension("target"),
  setUserRole: (a) => a.setUserRole("target", "artist"), setVerified: (a) => a.setVerified("target", true),
  markEmailVerified: (a) => a.markEmailVerified("target"), setSponsor: (a) => a.setSponsor("target", true),
  enrichArtists: (a) => a.enrichArtists(["Artist"]), purgeArtist: (a) => a.purgeArtist("artist"),
  startCatalogSeed: (a) => a.startCatalogSeed(10), stopCatalogSeed: (a) => a.stopCatalogSeed(),
  removeLoungeMessage: (a) => a.removeLoungeMessage("show", "message"),
  removeFanClubMessage: (a) => a.removeFanClubMessage("artist", "message"),
  removeComment: (a) => a.removeComment("post", "comment"),
  prepareMemorialArtist: (a) => a.prepareMemorialArtist("Artist"),
  approveArtist: (a) => a.approveArtist("artist-request"),
  rejectArtist: (a) => a.rejectArtist("artist-request"),
  reviewArtistIdentity: (a) => a.reviewArtistIdentity("artist", "hold", { reason: "Possible impersonation under review." }),
};

function fixture(actor = admin, ready = true) {
  const calls = [], effects = [];
  const staffCoordinator = { epoch: 0, invalidate: () => effects.push("invalidate") };
  const sessionRef = { current: actor }, accountMutationEpochRef = { current: 1 };
  const state = { reports: [{ id: "report", targetId: "post", targetType: "post" }], removed: [],
    moderation: { reports: [{ id: "report" }], summary: { open: 1 } }, comments: {}, lounge: {}, clubs: {}, users: [], session: actor };
  state.requests = [{ id: "artist-request", userId: "artist-owner", artistName: "Artist", status: "pending" }];
  state.users = [{ id: "artist-owner", role: "fan" }];
  const setter = (key) => (next) => { effects.push(key); state[key] = typeof next === "function" ? next(state[key]) : next; };
  const request = (...args) => new Promise((resolve, reject) => calls.push({ args, resolve, reject }));
  const dependencies = {
    session: actor, sessionRef, authReadyRef: { current: ready }, accountMutationEpochRef,
    captureAccountMutation, accountMutationIsCurrent, staffScopeFor, confirmedRoleMutationPatch,
    clean, LIMITS, ARTIST_REQUEST_CONFIRMATION_ERROR, artistRequestFailureMessage, confirmedArtistRequest, mergeConfirmedArtistRequest, reconcileConfirmedArtistRequestDecision,
    commandSuccess, commandError: (error) => ({ ok: false, error }), localCommandError: (code) => ({ ok: false, code }),
    importArtistAccount: async () => artistAccountApi, absorbServerUser: (user) => effects.push(user),
    isLoadCancellation: (_error, signal) => !!signal?.aborted, requests: state.requests, setRequests: setter("requests"),
    api: request, AppError: class extends Error { constructor(message, data) { super(message); Object.assign(this, data); } },
    staffReadsRef: { current: staffCoordinator },
    loadModerationConsole: async () => { effects.push("refresh"); },
    reports: state.reports, setReports: setter("reports"), setModerationConsole: setter("moderation"), setRemovedIds: setter("removed"),
    setLounge: setter("lounge"), setFanClubMsgs: setter("clubs"), setComments: setter("comments"), setUsers: setter("users"), setSession: setter("session"),
    invalidateStaffMemberReads: () => effects.push("invalidate"), patchStaffMember: (...args) => effects.push(args),
    isStaff: (role) => ["admin", "moderator"].includes(role), adminMembersRef: { current: [{ id: "target", handle: "target" }] },
    commentCache: { capture: () => ({}) }, commentClaimIsCurrent: () => true,
    artistMemorialPreparationName: (value) => value, prepareArtistMemorialCandidate: request, cacheArtists: (...args) => effects.push(args),
  };
  const actions = new Function(...Object.keys(dependencies), `${callbacks}\nreturn {${names.join(",")}};`)(...Object.values(dependencies));
  return { actions, calls, effects, state, adopt(user, bump = true) {
    if (staffScopeFor(user) !== staffScopeFor(sessionRef.current)) staffCoordinator.epoch += 1;
    sessionRef.current = user;
    if (bump) accountMutationEpochRef.current += 1;
  } };
}
const settle = async (promise) => { try { return await promise; } catch (error) { return { ok: false, error }; } };
const result = { ok: true, role: "artist", handle: "target", enriched: 1, started: true, suspendedUntil: 123 };

for (const [name, invoke] of Object.entries(callsFor)) {
  test(`${name} refuses stale, guest, unready, demoted and nonstaff controls before dispatch`, async () => {
    for (const scenario of ["guest", "fan", "unready", "logout", "switch", "return", "demotion", "role-return"]) {
      const f = fixture(scenario === "guest" ? null : scenario === "fan" ? fan : admin, scenario !== "unready");
      if (scenario === "logout") f.adopt(null);
      if (scenario === "switch") f.adopt({ id: "staff-b", role: "admin" });
      if (scenario === "return") { f.adopt(fan); f.adopt(admin); }
      if (scenario === "demotion") f.adopt({ ...admin, role: "moderator" }, false);
      if (scenario === "role-return") { f.adopt({ ...admin, role: "moderator" }, false); f.adopt(admin, false); }
      const pending = settle(invoke(f.actions));
      for (const call of f.calls) call.resolve(result);
      await pending;
      assert.equal(f.calls.length, 0, scenario);
      assert.deepEqual(f.effects, [], scenario);
    }
  });

  test(`${name} binds active dispatch and ignores late completion after an account or role returns`, async () => {
    for (const roleOnly of [false, true]) {
    const f = fixture();
    const pending = settle(invoke(f.actions));
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].args[1].expectedAccountId, admin.id);
    if (roleOnly) { f.adopt({ ...admin, role: "moderator" }, false); f.adopt(admin, false); }
    else { f.adopt(fan); f.adopt(admin); }
    f.calls[0].resolve(result);
    const returned = await pending;
    assert.deepEqual(f.effects, []);
    assert.notEqual(returned, true);
    assert.notEqual(returned?.ok, true);
    }
  });
}

test("moderation wrappers recheck identity after the inner write resolves", async () => {
  const f = fixture();
  let finish;
  const request = new Promise((resolve) => { finish = resolve; });
  const pending = f.actions.commitStaffAction(() => request, () => f.effects.push("unsafe commit"));
  finish(); f.adopt(fan);
  assert.equal(await pending, false);
  assert.deepEqual(f.effects, []);
});

test("active moderation still applies confirmed patches and removes only the intended content", async () => {
  const f = fixture();
  const pending = f.actions.removeContent("post");
  f.calls[0].resolve({ ok: true });
  assert.equal(await pending, true);
  assert.deepEqual(f.state.removed, ["post"]);
});

test("artist request approval and rejection publish only confirmed canonical decisions", async () => {
  for (const decision of ["approved", "rejected"]) {
    const f = fixture();
    const pending = f.actions.reviewArtistRequest("artist-request", decision);
    assert.deepEqual(f.effects, [], "no role or request status may change while the server is pending");
    assert.equal(f.calls[0].args[1].expectedAccountId, admin.id);
    f.calls[0].resolve({ ok: true });
    assert.deepEqual(await pending, { ok: true, value: { requestId: "artist-request", status: decision } });
    assert.equal(f.state.requests[0].status, decision);
    assert.equal(f.state.users[0].role, decision === "approved" ? "artist" : "fan");
  }
});

test("artist request decisions preserve pending state on server rejection or missing confirmation", async () => {
  for (const reject of [false, true]) {
    const f = fixture();
    const pending = f.actions.approveArtist("artist-request");
    if (reject) f.calls[0].reject(new Error("Server refused approval"));
    else f.calls[0].resolve({ ok: false });
    assert.equal((await pending).ok, false);
    assert.equal(f.state.requests[0].status, "pending");
    assert.equal(f.state.users[0].role, "fan");
    assert.deepEqual(f.effects, []);
  }
});

test("member artist requests are account-bound and late confirmation cannot create a replacement account's local request", async () => {
  const f = fixture(fan);
  const pending = f.actions.requestArtist("New Artist", "Management contact available");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.effects, []);
  assert.equal(f.calls[0].args[1].expectedAccountId, fan.id);
  f.adopt(admin); f.adopt(fan);
  f.calls[0].resolve({ id: "confirmed-request" });
  assert.equal((await pending).stale, true);
  assert.deepEqual(f.effects, []);
  const stale = await f.actions.requestArtist("Another Artist", "Note");
  assert.equal(stale.ok, false);
  assert.equal(f.calls.length, 1);
  const active = fixture(fan);
  const request = active.actions.requestArtist("New Artist", "Note");
  await new Promise((resolve) => setImmediate(resolve));
  active.calls[0].resolve({ id: "confirmed-request" });
  assert.equal((await request).ok, true);
  assert.equal(active.state.requests[0].id, "confirmed-request");
  assert.equal(active.state.requests[0].userId, fan.id);
});
