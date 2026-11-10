import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../screens/FeedScreen.jsx", import.meta.url), "utf8");
const start = source.indexOf("  const advanceFeed = async");
const end = source.indexOf("  const footer =", start);
assert.ok(start >= 0 && end > start);
const reader = source.slice(start, end);
function fixture(sectionFeed = null) {
  const state = { count: 8, error: false, posts: Array.from({length:8},(_,id)=>({id})), hasMore:true, loading:false };
  const pageRequestRef={current:null},pageScopeRef={current:"A:everyone"};
  const calls=[];
  const fetch=()=>new Promise((resolve,reject)=>calls.push({resolve,reject}));
  const render=()=>{
    const values={feedActive:true,newsTab:false,refreshing:false,effectiveLoading:state.loading,pageRequestRef,pageError:state.error,
      sectionFeed,full:state.posts,count:state.count,effectiveHasMore:state.hasMore,pageScope:pageScopeRef.current,pageScopeRef,
      setCount:fn=>{state.count=fn(state.count);},setPageError:value=>{state.error=value;},PAGE:8,onLoadMore:fetch};
    return new Function(...Object.keys(values),`${reader}; return advanceFeed;`)(...Object.values(values));
  };
  return {state,calls,render,pageScopeRef,pageRequestRef};
}

test("scroll reveals loaded cards, then requests pages until exhaustion",async()=>{
  assert.match(source,/onEndReached=\{\(\) => \{ void advanceFeed\(\); \}\}/);
  const f=fixture(); f.state.posts.push({id:9});
  await f.render()(); assert.equal(f.state.count,16);assert.equal(f.calls.length,0);
  const page=f.render()();assert.equal(f.calls.length,1);
  await f.render()();assert.equal(f.calls.length,1,"immediate lock stops duplicate scroll callbacks");
  f.calls[0].resolve(true);await page;assert.equal(f.state.count,24);
  f.state.hasMore=false;await f.render()();assert.equal(f.calls.length,1);
});

test("page errors keep cards and stop automatic retry until explicit retry",async()=>{
  const f=fixture();const page=f.render()();f.calls[0].resolve(false);await page;
  assert.equal(f.state.error,true);assert.equal(f.state.posts.length,8);
  await f.render()();assert.equal(f.calls.length,1);
  const retry=f.render()({retry:true});f.calls[1].resolve(true);await retry;
  assert.equal(f.state.error,false);assert.equal(f.state.count,16);
});

test("interrupted section pagination cannot change a new section's count/error",async()=>{
  const f=fixture();const old=f.render()();f.pageScopeRef.current="B:local";f.pageRequestRef.current=null;
  f.calls[0].resolve(false);await old;
  assert.equal(f.state.error,false);assert.equal(f.state.count,8);
});

test("expired pages keep cards and offer refresh without replaying the dead cursor",async()=>{
  const f=fixture();const page=f.render()();f.calls[0].resolve({ok:false,refreshRequired:true});await page;
  assert.equal(f.state.error,"refresh");assert.equal(f.state.posts.length,8);
  await f.render()();await f.render()({retry:true});assert.equal(f.calls.length,1);
  assert.match(source,/pageError === "refresh" \? \([\s\S]*?onPress=\{refresh\}[\s\S]*?accessibilityLabel="Refresh feed"/);
});

test("failed explicit refresh keeps the expired-page control until a new head succeeds",async()=>{
  const start=source.indexOf("  const refresh = async");
  const end=source.indexOf("  rowActionsRef.current =",start);
  assert.ok(start>=0 && end>start);
  for(const failure of [false,null,new Error("Offline")]) {
    const state={pageError:"refresh",refreshError:false,refreshing:false};
    const refreshControllerRef={current:null},pageRequestRef={current:null},pageScopeRef={current:"A:everyone"};
    let outcome=failure;
    const render=()=>{
      const values={refreshControllerRef,pageRequestRef,pageScopeRef,pageScope:"A:everyone",pageError:state.pageError,
        onRefresh:async()=>{if(outcome instanceof Error)throw outcome;return outcome;},filter:"everyone",introduction:{dismiss(){}},newsTab:false,sectionFeed:null,
        setPageError:value=>{state.pageError=value;},setRefreshing:value=>{state.refreshing=value;},setRefreshError:value=>{state.refreshError=value;}};
      return new Function(...Object.keys(values),`${source.slice(start,end)};return refresh;`)(...Object.values(values));
    };
    assert.equal(await render()(),false);assert.equal(state.pageError,"refresh");assert.equal(state.refreshError,true);assert.equal(state.refreshing,false);
    outcome=true;assert.equal(await render()(),true);assert.equal(state.pageError,false);assert.equal(state.refreshError,false);
  }
});
