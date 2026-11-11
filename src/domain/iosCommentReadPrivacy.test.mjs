import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";
import { claimIOSCommentRead } from "../lib/iosCommentReadFence.ios.js";
import { getIOSDetailPrivacySnapshot, invalidateIOSDetailPrivacy } from "../lib/iosDetailPrivacy.ios.js";
import { createCommentAccountCoordinator, commentRequestCacheKey } from "./commentCache.mjs";
import { reconcileCommentRead } from "./commentReadProjection.mjs";
const source = readFileSync(new URL('../store.js', import.meta.url), 'utf8');
const provider = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body.find(node => node.declaration?.id?.name === 'StoreProvider').declaration;
const declarations = provider.body.body.flatMap(node => node.type === 'VariableDeclaration' ? node.declarations : []);
function production(names, dependencies) {
  const code = names.map(name => { const node = declarations.find(node => node.id?.name === name); assert.ok(node); return `const ${source.slice(node.start, node.end)};`; }).join('\n');
  return new Function(...Object.keys(dependencies), `${code}\nreturn {${names.join(',')}};`)(...Object.values(dependencies));
}
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise, resolve, reject}; }
function fixture(platform = 'ios') {
  const coordinator = createCommentAccountCoordinator('viewer'), accountMutationEpochRef = { current: 1 }, requests = [], writes = [];
  let account = 'viewer', comments = { post: [{ id: 'private', userId: 'author', text: 'Private thread', at: 1 }], other: [{ id: 'other-private' }] };
  const pending = new Map(), fresh = new Set();
  const commentCache = { ...coordinator, pendingRequest: key => pending.get(key), requestIsFresh: key => fresh.has(key),
    markRequestFresh: key => fresh.add(key), trackRequest: (key, request) => pending.set(key, request),
    releaseRequest: (key, request) => { if (pending.get(key) === request) pending.delete(key); } };
  const dependencies = { Platform: { OS: platform }, commentCache, accountMutationEpochRef, claimIOSCommentRead, commentRequestCacheKey, reconcileCommentRead,
    commentClaimIsCurrent: claim => coordinator.isCurrent(claim, account), commentsFor: id => comments[id] || [],
    api: (path, options) => { const r = { ...deferred(), path, options }; requests.push(r); return r.promise; },
    setComments: update => { writes.push(getIOSDetailPrivacySnapshot()); comments = update(comments); },
    invalidateIOSDetailPrivacy, currentMutationActor: () => ({ id: account }), writePostComment: (claim, id, write) => write(),
    commitStaffAction: async (request, accept) => { await request(); accept(); return {ok:true}; }, moderateContent: () => Promise.resolve(),
  };
  return { ...production(['loadComments', 'deleteOwnComment', 'removeComment'], dependencies), requests, writes, owner: accountMutationEpochRef,
    get comments() { return comments; },
    account(next) { account = next; coordinator.adopt(next); accountMutationEpochRef.current++; },
  };
}
for (const status of [403,404,410]) test(`real Store comment ${status} clears only exact thread, revokes Back before setters and fences old success`, async () => {
  const f = fixture(), proof = getIOSDetailPrivacySnapshot();
  const older = f.loadComments('post', {limit:50, force:true}), newer = f.loadComments('post', {limit:100, force:true});
  f.requests[1].reject(Object.assign(new Error('Denied'), {status}));
  assert.equal((await newer).denied, true);
  assert.deepEqual(f.comments.post, []); assert.deepEqual(f.comments.other, [{ id: 'other-private' }]);
  assert.equal(getIOSDetailPrivacySnapshot(), proof+1); assert.deepEqual(f.writes, [proof+1], 'queued Back was invalid before React cache writes');
  f.requests[0].resolve({ comments: [{id:'private', text:'Old private thread'}] }); assert.equal((await older).stale,true);
  assert.deepEqual(f.comments.post, []);
  const fresh = f.loadComments('post', {limit:50, force:true}); f.requests[2].resolve({comments:[{id:'fresh',text:'Fresh visible',createdAt:2}]});
  assert.equal((await fresh).ok,true); assert.deepEqual(f.comments.post.map(row=>row.id), ['fresh']);
});
test('real Store comment transient and obsolete errors keep existing thread and do not revoke detail privacy', async () => {
  for (const mode of ['503','401','abort','account','roundtrip','superseded']) {
    const f=fixture(), proof=getIOSDetailPrivacySnapshot(), controller=new AbortController();
    const read=f.loadComments('post',{force:true,signal:controller.signal});
    if(mode==='abort') controller.abort();
    if(mode==='account') f.account('other');
    if(mode==='roundtrip') { f.account('other'); f.account('viewer'); }
    if(mode==='superseded') f.owner.commentRevision=1;
    f.requests[0].reject(Object.assign(new Error('Error'),{status:Number(mode)||403})); await read;
    assert.equal(getIOSDetailPrivacySnapshot(),proof,mode); assert.equal(f.comments.post[0].id,'private');
  }
});
test('real Store successful comment omissions and tombstones retire older private snapshots', async () => {
  for (const tombstone of [false,true]) {
    const f=fixture(), proof=getIOSDetailPrivacySnapshot(); const old=f.loadComments('post',{limit:100,force:true}); const read=f.loadComments('post',{force:true});
    f.requests[1].resolve({comments:tombstone ? [{id:'private',deleted:true,text:'',userId:null,createdAt:1}] : []});
    assert.equal((await read).ok,true); assert.equal(getIOSDetailPrivacySnapshot(),proof+1);
    f.requests[0].resolve({comments:[{id:'private',text:'Old private thread'}]}); assert.equal((await old).stale,true);
    assert.equal(f.comments.post.some(row=>row.text==='Private thread'||row.text==='Old private thread'),false);
  }
});
test('real Store own/staff confirmed comment removal revokes retained private copies', async () => {
  const own=fixture(), ownProof=getIOSDetailPrivacySnapshot(), pending=own.deleteOwnComment('post','private');
  own.requests[0].resolve({tombstone:false}); assert.equal((await pending).ok,true);
  assert.equal(getIOSDetailPrivacySnapshot(),ownProof+1); assert.deepEqual(own.comments.post,[]);
  const staff=fixture(), staffProof=getIOSDetailPrivacySnapshot(); await staff.removeComment('post','private');
  assert.equal(getIOSDetailPrivacySnapshot(),staffProof+1); assert.deepEqual(staff.comments.post,[]);
});
for (const platform of ['web','android']) test(`${platform} comment failures retain the prior behavior and never load the iOS fence`, async()=>{
  const f=fixture(platform), proof=getIOSDetailPrivacySnapshot(), read=f.loadComments('post',{force:true});
  f.requests[0].reject(Object.assign(new Error('Denied'),{status:403})); const result=await read;
  assert.equal(result.denied,undefined); assert.equal(f.comments.post[0].id,'private'); assert.equal(getIOSDetailPrivacySnapshot(),proof);
});
