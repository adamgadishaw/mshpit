import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {transformSync} from "@babel/core";
import { reconcilePostAuthorBadges } from "../../domain/postBadgeBundle.mjs";
const require=createRequire(import.meta.url);
const compiled=transformSync(readFileSync(new URL("./useFollowingFeed.js",import.meta.url),"utf8"),{
  filename:"useFollowingFeed.js",babelrc:false,configFile:false,plugins:[require("@babel/plugin-transform-modules-commonjs")],
}).code;
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture() {
  const slots=[],effects=[],calls=[],listeners=new Set(),badgeListeners=new Set();let cursor=0;let props={accountId:"viewer",enabled:true,privacyScope:"clear"};
  const react={
    useRef(initial){const i=cursor++;return slots[i] ||= {current:initial};},
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==="function"?initial():initial;return[slots[i],v=>{slots[i]=typeof v==="function"?v(slots[i]):v;}];},
    useEffect(fn,deps){const i=cursor++;const old=slots[i];if(old && deps.every((v,j)=>Object.is(v,old.deps[j])))return;effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});},
  };
  const api={readLocalFeed:args=>new Promise((resolve,reject)=>calls.push({args:{...args,mode:"local"},resolve,reject})),readFollowingFeed:args=>new Promise((resolve,reject)=>calls.push({args,resolve,reject})),subscribeSocialReactionChanges:listener=>{listeners.add(listener);return()=>listeners.delete(listener);}};
  const module={exports:{}};
  new Function("require","module","exports","setInterval","clearInterval",compiled)(name=>name==="react"?react:name.includes("authorBadgeChanges")?{subscribeAuthorBadgeChanges:listener=>{badgeListeners.add(listener);return()=>badgeListeners.delete(listener);}}:name.includes("postBadgeBundle")?{reconcilePostAuthorBadges}:api,module,module.exports,()=>1,()=>{});
  return {calls,badges(event){for(const listener of badgeListeners)listener(event);},changed(accountId="viewer"){for(const listener of listeners)listener(accountId);},unmount(){for(const slot of slots)slot?.cleanup?.();},render(update={}){props={...props,...update};cursor=0;const result=module.exports.default(props);effects.splice(0).forEach(fn=>fn());return result;}};
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

test("Local uses independent city scope and refresh invalidates interrupted pagination",async()=>{
  const f=fixture(); f.render({mode:"local",homeCity:"Toronto"});
  assert.equal(f.calls[0].args.mode,"local");
  f.calls[0].resolve({posts:[{id:"one"}],nextCursor:"old"}); await settle();
  void f.render().loadMore(); const page=f.calls[1];
  void f.render().reload(); assert.equal(page.args.signal.aborted,true);
  f.calls[2].resolve({posts:[{id:"new"}],nextCursor:"new-cursor"}); await settle();
  page.resolve({posts:[{id:"obsolete"}],nextCursor:null}); await settle();
  assert.deepEqual(f.render().posts,[{id:"new"}]);
  assert.equal(f.render().nextCursor,"new-cursor");
  assert.deepEqual(f.render({homeCity:"Montreal"}).posts,[]);
  f.unmount();
});

test("confirmed badge changes reconcile loaded section cards and reject stale pages",async()=>{
  const f=fixture();f.render();
  f.calls[0].resolve({posts:[{id:"one",userId:"author",user:{sponsor:true}}],nextCursor:"older"});await settle();
  void f.render().loadMore();const old=f.calls[1];
  f.badges({accountId:"other",user:{id:"author",sponsor:false}});
  assert.equal(old.args.signal.aborted,false);
  f.badges({accountId:"viewer",user:{id:"author",sponsor:false}});
  assert.equal(old.args.signal.aborted,true);
  old.resolve({posts:[{id:"stale"}],nextCursor:null});await settle();
  assert.equal(f.render().posts[0].user.sponsor,false);
  assert.equal(f.render().nextCursor,"older");
  assert.equal(f.render().posts.length,1);f.unmount();
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

test("expanded 2505-card Local and Following histories stay isolated from late refresh pages and account changes",async()=>{
  for(const mode of ["local","following"]) {
    const f=fixture();f.render({mode,homeCity:"Toronto"});
    for(let offset=0;offset<2505;offset+=50) {
      const index=f.calls.length-1;
      const posts=Array.from({length:Math.min(50,2505-offset)},(_,i)=>({id:`large-${offset+i}`}));
      if(offset) posts.unshift({id:`large-${offset-1}`});
      f.calls[index].resolve({posts,nextCursor:`after-${offset+50}`});await settle();
      assert.equal(f.render().posts.length,Math.min(offset+50,2505));
      if(offset+50<2505) void f.render().loadMore();
    }
    assert.deepEqual(f.render().posts.map(p=>p.id),Array.from({length:2505},(_,i)=>`large-${i}`));
    void f.render().loadMore();const old=f.calls.at(-1);
    void f.render().reload();const fresh=f.calls.at(-1);
    assert.equal(old.args.signal.aborted,true);
    fresh.resolve({posts:[{id:"new-head"}],nextCursor:"fresh-cursor"});await settle();
    old.resolve({posts:[{id:"late-old-tail"}],nextCursor:null});await settle();
    assert.deepEqual(f.render().posts,[{id:"new-head"}]);
    assert.equal(f.render().nextCursor,"fresh-cursor");
    void f.render().loadMore();const priorAccount=f.calls.at(-1);
    assert.deepEqual(f.render({accountId:"other"}).posts,[]);
    priorAccount.resolve({posts:[{id:"private-old-card"}],nextCursor:null});await settle();
    assert.deepEqual(f.render().posts,[]);f.unmount();
  }
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
