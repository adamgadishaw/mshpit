import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {transformSync} from "@babel/core";
const require=createRequire(import.meta.url);
const compiled=transformSync(readFileSync(new URL("./useFollowingFeed.js",import.meta.url),"utf8"),{
  filename:"useFollowingFeed.js",babelrc:false,configFile:false,plugins:[require("@babel/plugin-transform-modules-commonjs")],
}).code;
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture() {
  const slots=[],effects=[],calls=[],listeners=new Set();let cursor=0;let props={accountId:"viewer",enabled:true,privacyScope:"clear"};
  const react={
    useRef(initial){const i=cursor++;return slots[i] ||= {current:initial};},
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==="function"?initial():initial;return[slots[i],v=>{slots[i]=typeof v==="function"?v(slots[i]):v;}];},
    useEffect(fn,deps){const i=cursor++;const old=slots[i];if(old && deps.every((v,j)=>Object.is(v,old.deps[j])))return;effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});},
  };
  const api={readFollowingFeed:args=>new Promise((resolve,reject)=>calls.push({args,resolve,reject})),subscribeSocialReactionChanges:listener=>{listeners.add(listener);return()=>listeners.delete(listener);}};
  const module={exports:{}};
  new Function("require","module","exports","setInterval","clearInterval",compiled)(name=>name==="react"?react:api,module,module.exports,()=>1,()=>{});
  return {calls,changed(accountId="viewer"){for(const listener of listeners)listener(accountId);},unmount(){for(const slot of slots)slot?.cleanup?.();},render(update={}){props={...props,...update};cursor=0;const result=module.exports.default(props);effects.splice(0).forEach(fn=>fn());return result;}};
}

test("Following hook clears authority failures but preserves transient-failure content with retry",async()=>{
  const f=fixture();f.render();assert.equal(f.calls.length,1);
  f.calls[0].resolve({posts:[{id:"one"}],nextCursor:"cursor"});await settle();
  assert.equal(f.render().posts.length,1);
  let result=f.render();void result.reload();f.calls[1].reject({status:500});await settle();
  result=f.render();assert.equal(result.status,"error");assert.equal(result.posts.length,1);
  void result.reload();f.calls[2].reject({status:403});await settle();
  result=f.render();assert.equal(result.status,"error");assert.deepEqual(result.posts,[]);assert.equal(result.nextCursor,null);
  void result.reload();assert.equal(f.calls.length,4);f.calls[3].resolve({posts:[{id:"back"}]});await settle();
  assert.equal(f.render().posts[0].id,"back");
});

test("Following hook scopes immediately across accounts/privacy and discards obsolete responses",async()=>{
  const f=fixture();f.render();const old=f.calls[0];
  const switched=f.render({accountId:"other"});assert.deepEqual(switched.posts,[]);assert.equal(old.args.signal.aborted,true);
  old.resolve({posts:[{id:"private_old"}]});f.calls[1].resolve({posts:[{id:"other"}],nextCursor:"two"});await settle();
  assert.deepEqual(f.render().posts.map(p=>p.id),["other"]);
  void f.render().loadMore();const more=f.calls[2];assert.equal(more.args.cursor,"two");
  assert.deepEqual(f.render({privacyScope:"blocked"}).posts,[]);
  more.resolve({posts:[{id:"stale_blocked"}]});f.calls[3].resolve({posts:[],nextCursor:null});await settle();
  assert.deepEqual(f.render().posts,[]);
});

test("Following hook deduplicates pages and does not send concurrent duplicate requests",async()=>{
  const f=fixture();f.render();f.calls[0].resolve({posts:[{id:"one"}],nextCursor:"two"});await settle();
  const current=f.render();void current.loadMore();void current.loadMore();assert.equal(f.calls.length,2);
  f.calls[1].resolve({posts:[{id:"one",updated:true},{id:"two"}]});await settle();
  assert.deepEqual(f.render().posts,[{id:"one",updated:true},{id:"two"}]);
});

test("Following coalesces mutation invalidations during pagination into one fresh read",async()=>{
  const f=fixture();f.render();f.calls[0].resolve({posts:Array.from({length:30},(_,i)=>({id:"p"+i})),nextCursor:"older"});await settle();
  void f.render().loadMore();const older=f.calls[1];
  f.changed();f.changed();f.changed();f.changed("another-account");
  assert.equal(f.calls.length,2,"No concurrent request or mutation replay");
  older.resolve({posts:Array.from({length:30},(_,i)=>({id:"p"+(i+30)})),nextCursor:null});await settle();
  assert.equal(f.calls.length,3,"One reconciliation survives the expanded-history polling limit");
  assert.equal(f.calls[2].args.cursor,null);
  f.calls[2].resolve({posts:[{id:"confirmed-after-mutation",reposts:4}]});await settle();
  assert.deepEqual(f.render().posts,[{id:"confirmed-after-mutation",reposts:4}]);
  assert.equal(f.calls.length,3);f.unmount();
});

test("queued Following invalidations cannot cross logout, re-entry, privacy changes or unmount",async()=>{
  for(const change of [{accountId:null,enabled:false},{accountId:"other"},{privacyScope:"new-block"},{enabled:false}]){
    const f=fixture();f.render();const old=f.calls[0];f.changed();
    assert.deepEqual(f.render(change).posts,[]);assert.equal(old.args.signal.aborted,true);
    const count=f.calls.length;old.resolve({posts:[{id:"stale-old-account"}]});await settle();
    assert.equal(f.calls.length,count,"No queued read after the old generation completes");
    assert.deepEqual(f.render().posts,[]);
    if(change.enabled===false || change.accountId===null){f.render({accountId:"viewer",enabled:true});assert.equal(f.calls.length,count+1);}
    f.unmount();
  }
  const f=fixture();f.render();f.changed();f.unmount();f.calls[0].resolve({posts:[{id:"late"}]});await settle();assert.equal(f.calls.length,1);
});
