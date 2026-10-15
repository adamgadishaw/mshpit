import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";
import * as domain from "../../domain/newsReaderState.mjs";
import { createNewsIntroductionSession } from "../../domain/newsIntroductionSession.mjs";

const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(file, sessionCoordinator=createNewsIntroductionSession()) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const declaration = parse(source, { sourceType: "module" }).program.body.find(n => n.type === "ExportDefaultDeclaration").declaration;
  const slots = [], pending = [], calls = [];
  let index = 0, sequence = 0, context = { session: { id: "a" }, authReady: true, blockedIds: [], followedArtists: ["Moon Walker"] };
  const same = (a,b) => a?.length === b?.length && a.every((v,i) => Object.is(v,b[i]));
  const bindings = {
    ...domain,
    newsIntroductionSession:sessionCoordinator,
    useNewsInteractions: () => context,
    createChatClientMutationId: () => `request-${++sequence}`,
    useState(initial) { const i=index++; slots[i] ||= { value: typeof initial === "function" ? initial() : initial }; return [slots[i].value, update => { slots[i].value = typeof update === "function" ? update(slots[i].value) : update; }]; },
    useRef(value) { const i=index++; return slots[i] ||= { current:value }; },
    useCallback(fn,deps) { const i=index++; if (!same(slots[i]?.deps,deps)) slots[i]={deps,fn}; return slots[i].fn; },
    useEffect(fn,deps) { const i=index++; if (!same(slots[i]?.deps,deps)) { pending.push(() => { slots[i]?.cleanup?.(); slots[i]={deps,cleanup:fn()}; }); } },
    fetchNewsDeskStories: options => new Promise((resolve,reject) => calls.push({...options,resolve,reject})),
    requestNewsIntroduction: options => new Promise((resolve,reject) => calls.push({...options,resolve,reject})),
  };
  const hook = new Function(...Object.keys(bindings), `return (${source.slice(declaration.start,declaration.end)});`)(...Object.values(bindings));
  return { calls, setContext(value) {context={...context,...value};}, render(props) {index=0;return hook(props);}, commit(){for(const fn of pending.splice(0))fn();}, unmount(){for(const slot of slots)slot?.cleanup?.();} };
}
test("real news hook removes old account/block scope before effects and ignores late success or errors", async () => {
  const f=fixture("./useNewsDeskStories.js");
  f.render({});f.commit();f.calls[0].resolve({stories:[{id:"a-story"}],nextCursor:"a-cursor"});await settle();
  assert.equal(f.render({}).stories[0].id,"a-story");f.commit();assert.equal(f.calls.length,1,"success does not restart the initial fetch");
  f.setContext({blockedIds:["author"]});let view=f.render({});assert.deepEqual(view.stories,[]);assert.equal(view.nextCursor,null);f.commit();
  f.setContext({session:{id:"b"},blockedIds:[]});assert.deepEqual(f.render({}).stories,[]);f.commit();
  f.calls[1].resolve({stories:[{id:"blocked-old-response"}]});await settle();assert.deepEqual(f.render({}).stories,[]);
  f.calls[2].resolve({stories:[{id:"b-story"}]});await settle();assert.equal(f.render({}).stories[0].id,"b-story");
  f.setContext({session:null});assert.deepEqual(f.render({}).stories,[]);f.commit();f.calls[3].reject(Error("offline"));await settle();
  assert.equal(f.render({}).status,"error");f.unmount();
});
test("real introduction hook runs only on actual For You entry; retries keep id and account switches fence responses", async () => {
  const f=fixture("./useNewsIntroduction.js");
  f.render(false);f.commit();assert.equal(f.calls.length,0);
  f.render(true);f.commit();const id=f.calls[0].requestId;f.calls[0].reject(Error("connection lost"));await settle();
  const retry=f.render(true).retry();assert.equal(f.calls[1].requestId,id);
  f.calls[1].resolve({post:{id:"news_a"}});await retry;assert.equal(f.render(true).post.id,"news_a");
  f.render(true).dismiss();assert.equal(f.render(true).post,null);f.commit();assert.equal(f.calls.length,2,"explicit refresh drops pin without requesting another receipt");
  f.setContext({session:{id:"b"}});assert.equal(f.render(true).post,null);f.commit();assert.equal(f.calls[2].accountId,"b");
  f.setContext({session:null});assert.equal(f.render(true).post,null);f.commit();
  f.calls[2].resolve({post:{id:"news_b"}});await settle();assert.equal(f.render(true).post,null);f.unmount();
});

test("deep-linked hidden feed and accounts without explicit follows never issue introduction commands", async () => {
  const f=fixture("./useNewsIntroduction.js");
  const surface={tab:"feed",web:true,pathname:"/post/news_one"};
  f.render(domain.newsFeedSurfaceVisible(surface));f.commit();assert.equal(f.calls.length,0);
  f.render(domain.newsFeedSurfaceVisible({...surface,pathname:"/feed"}));f.commit();assert.equal(f.calls.length,1);
  f.render(domain.newsFeedSurfaceVisible({...surface,pathname:"/feed",hasOverlay:true}));f.commit();
  assert.equal(f.calls[0].signal.aborted,true);
  f.calls[0].resolve({post:{id:"hidden-late-story"}});await settle();assert.equal(f.render(false).post,null);
  const empty=fixture("./useNewsIntroduction.js");empty.setContext({followedArtists:[]});empty.render(true);empty.commit();assert.equal(empty.calls.length,0);
});

test("a completed introduction is once per app runtime, not once per tab entry or component mount",async()=>{
  const coordinator=createNewsIntroductionSession();
  const f=fixture("./useNewsIntroduction.js",coordinator);
  f.render(true);f.commit();f.calls[0].resolve({post:{id:"news_once"}});await settle();
  assert.equal(f.render(true).post.id,"news_once");
  f.render(false);f.commit();assert.equal(f.render(false).post,null);
  f.render(true);f.commit();assert.equal(f.calls.length,1);assert.equal(f.render(true).post,null);
  f.setContext({followedArtists:["Moon Walker","Russ"]});f.render(true);f.commit();assert.equal(f.calls.length,1);
  f.setContext({session:{id:"b"}});f.render(true);f.commit();assert.equal(f.calls.length,2);
  f.calls[1].resolve({post:null});await settle();
  f.setContext({session:{id:"a"}});f.render(true);f.commit();assert.equal(f.calls.length,2);assert.equal(f.render(true).post,null);
  f.unmount();
  const remounted=fixture("./useNewsIntroduction.js",coordinator);remounted.render(true);remounted.commit();assert.equal(remounted.calls.length,0);
});

test("interrupted introduction retries its same identity; account capacity never evicts consumed identities",async()=>{
  const coordinator=createNewsIntroductionSession({maximumAccounts:1});
  const f=fixture("./useNewsIntroduction.js",coordinator);f.render(true);f.commit();const first=f.calls[0];
  f.render(false);f.commit();f.render(true);f.commit();assert.equal(f.calls[1].requestId,first.requestId);
  first.resolve({post:{id:"obsolete"}});f.calls[1].resolve({post:{id:"once"}});await settle();assert.equal(f.render(true).post.id,"once");
  f.setContext({session:{id:"b"}});f.render(true);f.commit();assert.equal(f.calls.length,2);
  f.setContext({session:{id:"a"}});f.render(true);f.commit();assert.equal(f.calls.length,2);
});
