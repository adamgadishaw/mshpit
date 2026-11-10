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
