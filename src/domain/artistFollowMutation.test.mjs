import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { artistFollowReceipt } from "./artistFollowFanClub.mjs";
import { captureAccountMutation, accountMutationIsCurrent } from "./accountMutation.mjs";
const source = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const mutationSource = source.slice(source.indexOf("  const setArtistFollowing ="), source.indexOf("  const updateProfile ="));
function harness() {
  const pending = [];
  const state = { session: { id: "A", favoriteArtists: [], profileUpdatedAt: 900 }, users: [{ id: "A" }] };
  const sessionRef = { current: state.session }, epoch = { current: 1 };
  const context = vm.createContext({
    currentMutationActor: () => sessionRef.current,
    captureAccountMutation, accountMutationIsCurrent, artistFollowReceipt,
    sessionRef, accountMutationEpochRef: epoch,
    saveArtistFollowing: (key, following, options) => new Promise((resolve, reject) => pending.push({ key, following, options, resolve, reject })),
    setSession: (update) => { state.session = update(state.session); },
    setUsers: (update) => { state.users = update(state.users); },
    publicProfileCacheEntry: (value) => value,
  });
  const action = vm.runInContext(mutationSource + "\nsetArtistFollowing", context);
  return { state, sessionRef, epoch, pending, action };
}
test("actual artist mutation adopts confirmed selections despite newer unrelated profile fields and rejects older replies", async () => {
  const h=harness(); const first=h.action("artist a",true); const second=h.action("artist b",true);
  assert.deepEqual(h.pending.map(request=>request.options.accountId),["A","A"]);
  h.pending[1].resolve({favoriteArtists:["Artist A","Artist B"],following:true,profileUpdatedAt:200});
  assert.equal((await second).ok,true);
  assert.deepEqual(Array.from(h.state.session.favoriteArtists),["Artist A","Artist B"]);
  assert.equal(h.state.session.profileUpdatedAt,900,"An unrelated newer profile version remains monotonic.");
  h.pending[0].resolve({favoriteArtists:["Artist A"],following:true,profileUpdatedAt:100});
  assert.equal((await first).ok,true);
  assert.deepEqual(Array.from(h.state.session.favoriteArtists),["Artist A","Artist B"]);
});
test("actual artist mutation never adopts another account or previous login response", async () => {
 for(const replacement of ["B","A",null]){
  const h=harness();const request=h.action("artist a",true);
  h.epoch.current=2;h.state.session=replacement?{id:replacement,favoriteArtists:[]}:null;h.sessionRef.current=h.state.session;
  h.pending[0].resolve({favoriteArtists:["Artist A"],following:true,profileUpdatedAt:1000});
  assert.equal((await request).stale,true);
  assert.deepEqual(h.state.session?.favoriteArtists || [],[]);
 }
});
test("failed artist write does not invent an optimistic subscription", async () => {
 const h=harness();const request=h.action("artist a",true);h.pending[0].reject(new Error("network"));
 assert.equal((await request).ok,false);assert.deepEqual(h.state.session.favoriteArtists,[]);
});
