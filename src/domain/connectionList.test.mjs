import assert from "node:assert/strict";
import test from "node:test";
import { resolveLoadState } from "./loadState.mjs";
const error = (status) => Object.assign(new Error("Unavailable"), { name: "AppError", code: "PIT-NET-001", retryable: true, status });
import { connectionScope, visibleConnectionList, connectionFailure, mergeConnectionRows } from "./connectionList.mjs";
test("connection rows are synchronously quarantined across account/search/filter/block changes",()=>{
 const input={accountId:"A",userId:"owner",kind:"followers",query:"",filter:"all",blockedIds:[]};
 const scope=connectionScope(input);const state=resolveLoadState({scope,data:{rows:[{id:"private"}],nextCursor:"next"}});
 for(const patch of [{accountId:"B"},{accountId:null},{kind:"artists"},{query:"new"},{filter:"verified"},{blockedIds:["private"]},{epoch:1}])assert.deepEqual(visibleConnectionList(state,connectionScope({...input,...patch})).data.rows,[]);
 assert.equal(visibleConnectionList(state,scope),state);
});
test("authorization failure evicts rows and cursor while network retry preserves known rows",()=>{
 const scope="A";const state=resolveLoadState({scope,data:{rows:[{id:"visible"}],nextCursor:"next"}});
 assert.equal(connectionFailure(state,scope,error(503)).data.rows.length,1);
 for(const status of [401,403,404]){const failed=connectionFailure(state,scope,error(status));assert.deepEqual(failed.data.rows,[]);assert.equal(failed.data.nextCursor,null);}
});
test("cursor merges do not duplicate rows after concurrent insertions",()=>{
 assert.deepEqual(mergeConnectionRows([{id:"a",name:"old"},{id:"b"}],[{id:"a",name:"new"},{id:"c"}]),[{id:"a",name:"new"},{id:"b"},{id:"c"}]);
});
