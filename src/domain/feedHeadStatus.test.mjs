import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "@babel/core";
import { createFeedHeadStatus, hasFeedHeadReceipt } from "./feedHeadStatus.mjs";
import * as pagination from "./feedPagination.mjs";
import * as feedExperience from "./feedExperience.mjs";
import * as placement from "./feedDiscoveryPlacement.mjs";
import * as home from "./homeJourney.mjs";
import * as inert from "../hooks/feedHeadStatus.js";
import * as endlessDomain from "./endlessFeed.mjs";

// Reuse the existing isolated actual-reader fixture without importing its test
// registrations. No replacement reader logic or network client is used.
const readerUrl = new URL("./feedPagination.test.mjs", import.meta.url);
let readerFixture = readFileSync(readerUrl, "utf8");
readerFixture = readerFixture.slice(readerFixture.indexOf("function deferred()"), readerFixture.indexOf('test("a late next page'))
  .replaceAll("import.meta.url", JSON.stringify(readerUrl.href))
  .replace("...refs, captureFeedRead, feedReadIsCurrent,", "...refs, captureFeedRead, feedReadIsCurrent, hasFeedHeadReceipt,");
const baseHarness = new Function("readFileSync", "assert", "captureFeedRead", "feedReadIsCurrent", "hasFeedHeadReceipt",
  readerFixture + "; return feedHarness;")(readFileSync, assert, pagination.captureFeedRead, pagination.feedReadIsCurrent, hasFeedHeadReceipt);
function harness({ observer = true, cold = true } = {}) {
  const h = baseHarness();
  h.owner = observer ? createFeedHeadStatus() : null;
  h.refs.feedRefreshRef.current.headStatus = h.owner;
  if (cold) Object.assign(h.state, { posts: [], cursor: null, hasMore: true });
  return h;
}
const good = { posts: [], nextCursor: null };
const failHead = async h => {
  h.calls.at(-1).reject(new Error("offline"));
  await Promise.resolve();
  h.calls.at(-1).reject(new Error("offline fallback"));
};
const status = h => h.owner.getSnapshot().status;
const fixtureUrl = new URL("./feedImageRetryIntegration.test.mjs", import.meta.url);
let screenFixture = readFileSync(fixtureUrl, "utf8").split("test('actual Feed emits")[0]
  .replace(/^import .*;\n/gm, "").replaceAll("import.meta.url", JSON.stringify(fixtureUrl.href));
screenFixture = screenFixture.replace("useRef(value){", "useSyncExternalStore(subscribe,getSnapshot){react.useLayoutEffect(()=>subscribe(()=>render()),[subscribe]);return getSnapshot();},useRef(value){")
  .replace("const retry=run(retryCodes[platform],()=>react);", "const retry=run(retryCodes[platform],()=>react); const head=run(compile(platform==='ios'?'../hooks/feedHeadStatus.ios.js':'../hooks/feedHeadStatus.js'),dep=>dep==='react'?react:headDomain);")
  .replace("return {useFeedHeadStatus:()=>null};", "return head;")
  .replace("if(dep.endsWith('/feedExperience.mjs'))", "if(dep.endsWith('/feedPagination.mjs'))return pagination; if(dep.endsWith('/feedExperience.mjs'))");
const { fixture, nodes } = new Function("readFileSync", "createRequire", "transformSync", "feedExperience", "placement", "home", "headDomain", "pagination", "endlessDomain", "assert",
  screenFixture + ";return {fixture,nodes};")(readFileSync, createRequire, transformSync, feedExperience, placement, home, {createFeedHeadStatus,hasFeedHeadReceipt}, pagination, endlessDomain, assert);
const list = f => f.tree.props.children.props.children.props.children;
const text = n => nodes(n).flatMap(x => typeof x.props?.children === "string" ? [x.props.children] : []);
const emptyText = f => text(list(f).props.ListEmptyComponent).join(" ");
const assertNoFooterControls = f => { assert.equal(nodes(list(f).props.ListFooterComponent).some(node => node.type === "Pressable"), false); assert.doesNotMatch(text(list(f).props.ListFooterComponent).join(" "), /caught up|older posts/i); };
const refreshButton = f => nodes(list(f).props.ListEmptyComponent).find(n => n.props?.label === "Refresh feed");
function screen(h, platform = "ios") {
  const f = fixture(platform);
  Object.assign(f.props, { headStatusOwner: h.owner, feed: h.state.posts, hasMore: h.state.hasMore, loadingMore: h.state.loading,
    onLoadMore: options => h.render().loadMoreFeed(options), onRefresh: options => h.render().hydrateFeed(options) });
  const sync = () => { Object.assign(f.props, { feed: h.state.posts, hasMore: h.state.hasMore, loadingMore: h.state.loading }); f.render(); };
  sync();
  return Object.assign(f, { sync });
}

test("observer is per-provider, carries no account/post data, and subscribers unsubscribe", () => {
  const a=createFeedHeadStatus(), b=createFeedHeadStatus(); let calls=0;
  const off=a.subscribe(()=>calls++), first=a.begin(); assert.equal(calls,1);
  a.settle(first,"ready"); assert.equal(calls,2); off(); a.reset(); assert.equal(calls,2);
  assert.equal(b.getSnapshot().status,"idle");
  assert.deepEqual(Object.keys(a.getSnapshot()).sort(),["scope","status","verified"]);
  assert.deepEqual(a.getSnapshot().scope,{});
});
test("default module is inert with no subscriptions or React imports", () => {
  assert.equal(inert.createFeedHeadStatus(),null);
  assert.equal(inert.useFeedHeadStatus({subscribe(){throw Error("should not subscribe");}}),null);
  assert.doesNotMatch(readFileSync(new URL("../hooks/feedHeadStatus.js",import.meta.url),"utf8"),/import |useEffect|useState|fetch\(/);
});
test("only a valid feed envelope verifies an empty receipt", () => {
  for(const value of [null,{},true,{posts:[]},{posts:[],nextCursor:4},{posts:[{}],nextCursor:null},{posts:[null],nextCursor:null}])assert.equal(hasFeedHeadReceipt(value),false);
  assert.equal(hasFeedHeadReceipt(good),true);
  assert.equal(hasFeedHeadReceipt({posts:[{id:"p_a"}],nextCursor:"next"}),true);
});
test("actual admitted initial head marks loading, duplicate/guest/preaborted reads do not start or settle it",async()=>{
  const h=harness(); const pending=h.render().hydrateFeed(); assert.equal(status(h),"loading");
  assert.equal(await h.render().hydrateFeed(),null); assert.equal(h.calls.length,1); assert.equal(status(h),"loading");
  h.calls[0].resolve(good);assert.equal(await pending,true); assert.equal(status(h),"ready");
  h.refs.authReadyRef.current=false;assert.equal(await h.render().hydrateFeed(),null);assert.equal(status(h),"ready");
  h.refs.authReadyRef.current=true;const controller=new AbortController();controller.abort();
  assert.equal(await h.render().hydrateFeed({signal:controller.signal}),null);assert.equal(h.calls.length,1);
});
test("actual cold failure renders error and Refresh, never the cursorless older dead end; successful refresh confirms empty",async()=>{
  const h=harness(), f=screen(h);const pending=h.render().hydrateFeed();f.sync();
  assert.match(emptyText(f),/Loading your feed/);assertNoFooterControls(f);
  await failHead(h);assert.equal(await pending,false);f.sync();assert.match(emptyText(f),/Your feed could not load/);
  assertNoFooterControls(f); assert.ok(refreshButton(f));
  const retry=refreshButton(f).props.onPress();assert.equal(h.calls.length,3);f.sync();assert.match(emptyText(f),/Loading your feed/);
  h.calls[2].resolve(good);await retry;f.sync();assert.match(emptyText(f),/No posts to show yet/);
  assert.doesNotMatch(emptyText(f),/No shows logged yet|could not load/);
});
test("Local uses the same head failure and retry, not an empty projection claim",async()=>{
  const h=harness(),f=screen(h);f.filter("Local");const pending=h.render().hydrateFeed();await failHead(h);await pending;f.sync();
  assert.match(emptyText(f),/Your feed could not load/);assert.doesNotMatch(emptyText(f),/No recent posts|Nothing in/);assertNoFooterControls(f);
});
test("actual failed refresh retains cached cards and prior receipt, then succeeds without moving the request owner",async()=>{
  const h=harness({cold:false}),f=screen(h);let pending=h.render().hydrateFeed();
  const row={id:"p_existing"};h.calls[0].resolve({posts:[row],nextCursor:"next"});await pending;f.sync();
  const previous=h.state.posts;pending=h.render().hydrateFeed();f.sync();assert.deepEqual(list(f).props.data,[row]);
  await failHead(h);await pending;f.sync();assert.equal(h.state.posts,previous);assert.equal(h.state.cursor,"next");
  assert.deepEqual(list(f).props.data,[row]);assert.equal(h.owner.getSnapshot().verified,true);
  assert.match(text(list(f).props.ListHeaderComponent).join(" "),/Your posts are kept/);
  assert.equal(status(h),"error");
});
test("truthy malformed head payload never produces verified empty despite legacy Store acceptance",async()=>{
  const h=harness(), f=screen(h);const pending=h.render().hydrateFeed();h.calls[0].resolve({posts:[],nextCursor:3});
  assert.equal(await pending,true);assert.equal(status(h),"error");assert.equal(h.owner.getSnapshot().verified,false);f.sync();
  assert.match(emptyText(f),/could not load/);assertNoFooterControls(f);
});
test("actual cancellation and mutation-obsolete null receipts end loading without verifying cold emptiness",async()=>{
  for(const cause of ["abort","mutation"]) {
    const h=harness(),controller=new AbortController();const pending=h.render().hydrateFeed({signal:controller.signal});
    if(cause==="abort")controller.abort();else h.refs.feedMutationRevisionRef.current++;
    h.calls[0].resolve(good);assert.equal(await pending,null);assert.equal(status(h),"idle");assert.equal(h.owner.getSnapshot().verified,false);
    const f=screen(h);assert.match(emptyText(f),/Refresh your feed/);assert.ok(refreshButton(f));assertNoFooterControls(f);
  }
});
test("stale error does not run fallback or overwrite replacement account/epoch status",async()=>{
  for(const account of ["B","A"]) {
    const h=harness();const old=h.render().hydrateFeed();h.refs.feedAccountIdRef.current=account;h.refs.accountMutationEpochRef.current++;
    h.owner.reset();h.refs.feedRefreshRef.current.sequence++;h.refs.feedRefreshRef.current.inFlight=false;
    const current=h.render().hydrateFeed();h.calls[1].resolve(good);await current;const receipt=h.owner.getSnapshot();
    h.calls[0].reject(new Error("late"));assert.equal(await old,null);assert.equal(h.calls.length,2);assert.equal(h.owner.getSnapshot(),receipt);
  }
});
test("stale success cannot overwrite a new failure or mark the new account verified",async()=>{
  const h=harness();const old=h.render().hydrateFeed();h.owner.reset();h.refs.accountMutationEpochRef.current++;
  h.refs.feedRefreshRef.current.sequence++;h.refs.feedRefreshRef.current.inFlight=false;const current=h.render().hydrateFeed();
  await failHead(h);await current;const receipt=h.owner.getSnapshot();h.calls[0].resolve(good);assert.equal(await old,null);
  assert.equal(h.owner.getSnapshot(),receipt);assert.equal(status(h),"error");assert.equal(receipt.verified,false);
});
test("observer leaves actual API order/options, feed data, return and pagination contracts unchanged",async()=>{
  for(const outcome of ["success","fallback","failure"]) {
    const transcript=[];
    for(const observer of [false,true]) {
      const h=harness({observer});const pending=h.render().hydrateFeed();
      if(outcome!=="success"){h.calls[0].reject(new Error("offline"));await Promise.resolve();}
      if(outcome==="failure")h.calls.at(-1).reject(new Error("offline"));
      else h.calls.at(-1).resolve({posts:[{id:"p_ok"}],nextCursor:"next"});
      const result=await pending;
      transcript.push({result,state:h.state,calls:h.calls.map(c=>({url:c.url,options:c.options})),events:h.events});
    }
    assert.deepEqual(transcript[1],transcript[0]);
  }
});
test("captured iOS retry rejects synchronous epoch reset, provider replacement, filter replacement and unmount",async()=>{
  for(const change of ["epoch","provider","filter","unmount"]) {
    const h=harness(),f=screen(h),old=refreshButton(f).props.onPress;
    if(change==="epoch")h.owner.reset();
    if(change==="provider"){f.props.headStatusOwner=createFeedHeadStatus();f.render(false);}
    if(change==="filter")f.filter("Local");
    if(change==="unmount")f.unmount();
    await old();assert.equal(h.calls.length,0,change);
  }
});
test("privacy filtering of a successfully read head never claims no shows were logged",async()=>{
  const h=harness(),f=screen(h);const pending=h.render().hydrateFeed();h.calls[0].resolve({posts:[{id:"p_private"}],nextCursor:null});await pending;
  f.props.feed=[];f.render();assert.match(emptyText(f),/No posts to show yet/);assert.doesNotMatch(emptyText(f),/No shows logged yet/);
  f.props.hasMore=false;f.filter("Local");assert.match(emptyText(f),/No posts from your city to show yet/);assert.doesNotMatch(emptyText(f),/Be the first/);
});
test("Following/News and Android/web retain their existing presentation and request behavior",()=>{
  for(const platform of ["android","web"]) {
    const h=harness(),f=screen(h,platform);assert.match(emptyText(f),/No shows logged yet/);
    assert.match(text(list(f).props.ListFooterComponent).join(" "),/Load older posts/);assert.equal(h.calls.length,0);
  }
  const h=harness(),f=screen(h);f.filter("Following");assert.match(emptyText(f),/Following/);assert.doesNotMatch(emptyText(f),/Refresh your feed/);
});
test("Store wiring resets status at both synchronous epoch boundaries and initial effect cleanup, with no additional hooks or loader",()=>{
  const store=readFileSync(new URL("../store.js",import.meta.url),"utf8");
  assert.equal((store.match(/accountMutationEpochRef.current \+= 1;\n    feedRefreshRef.current.headStatus\?\.reset\(\);/g)||[]).length,2);
  assert.match(store,/controller.abort\(\);\n      feedRefreshRef.current.headStatus\?\.reset\(\);\n      feedRefreshRef.current.sequence/);
  assert.match(store,/if \(!\("headStatus" in feedRefreshRef.current\)\) feedRefreshRef.current.headStatus = createFeedHeadStatus\(\)/);
  const app=readFileSync(new URL("../../App.js",import.meta.url),"utf8");assert.match(app,/headStatusOwner=\{feedHeadStatus\}/);
  assert.doesNotMatch(readFileSync(new URL("../hooks/feedHeadStatus.ios.js",import.meta.url),"utf8"),/fetch\(|api\(|setTimeout|hydrateFeed/);
});

test("iOS subscription updates status without a parent Store render and releases listeners on unmount", async () => {
  const h=harness();let subscribed=0;const original=h.owner.subscribe;
  h.owner.subscribe=listener=>{subscribed++;const off=original(listener);return()=>{subscribed--;off();};};
  const f=screen(h);assert.equal(subscribed,1);
  const pending=h.render().hydrateFeed();assert.match(emptyText(f),/Loading your feed/);
  await failHead(h);await pending;assert.match(emptyText(f),/Your feed could not load/);
  f.strictReplay();assert.equal(subscribed,1);f.unmount();assert.equal(subscribed,0);
});

test("a captured retry does not run sibling refresh loaders once the existing head is loading", async () => {
  const h=harness(), f=screen(h), retry=refreshButton(f).props.onPress;
  let refreshes=0;f.props.onRefresh=()=>{refreshes++;};f.render();
  const currentRetry=refreshButton(f).props.onPress;
  const pending=h.render().hydrateFeed();
  await retry();await currentRetry();assert.equal(h.calls.length,1);assert.equal(refreshes,0);
  h.calls[0].resolve(good);await pending;
});

test("unverified or refreshing cached rows automatically reveal without an older-page request", async () => {
  for (const state of ["unverified", "refreshing", "verified-refreshing"]) {
    const duringRefresh=state!=="unverified";
    const h=harness({cold:false});h.state.posts=Array.from({length:12},(_,i)=>({id:"p_"+i}));
    if(state==="verified-refreshing")h.owner.settle(h.owner.begin(),"ready");
    const f=screen(h);
    const pending=duringRefresh?h.render().hydrateFeed():null;
    assertNoFooterControls(f);
    f.endReached();f.tickPage();f.sync();assert.equal(list(f).props.data.length,12);
    assert.equal(h.calls.length,duringRefresh?1:0,"cached reveal never starts an older-page request");
    f.endReached();assert.equal(f.pagingTimers.size,0,"head verification gates transport after all cached rows are visible");
    if(pending){await failHead(h);await pending;f.sync();}
    assert.equal(list(f).props.data.length,12);assertNoFooterControls(f);f.unmount();
  }
});
