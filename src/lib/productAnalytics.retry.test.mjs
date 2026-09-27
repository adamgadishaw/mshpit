import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";
import * as policy from "../domain/analyticsPolicy.mjs";
import * as privacy from "../domain/accountLocalPrivacy.mjs";
function harness(api) {
  const source=readFileSync(new URL("./productAnalytics.js",import.meta.url),"utf8");
  const ast=parse(source,{sourceType:"module"});
  const body=ast.program.body.flatMap(n=>n.type==="ImportDeclaration"?[]:[source.slice((n.type==="ExportNamedDeclaration"?n.declaration:n).start,n.end)]).join("\n");
  let time=100000,serial=0; const timers=new Map(),storage=new Map();
  const modules={"react-native":{AppState:{addEventListener:()=>({remove(){}})},Platform:{OS:"web"}},"./api":{api},
    "./persist":{load:(k,d)=>storage.get(k)||d,save:(k,v)=>storage.set(k,v),remove:k=>storage.delete(k)},
    "../domain/analyticsPolicy.mjs":policy,"../domain/accountLocalPrivacy.mjs":privacy};
  const bindings=Object.fromEntries(ast.program.body.filter(n=>n.type==="ImportDeclaration").flatMap(n=>n.specifiers.map(s=>[s.local.name,modules[n.source.value][s.imported.name]])));
  const localDate=class extends Date {static now(){return time;}};
  const service=new Function(...Object.keys(bindings),"setTimeout","clearTimeout","Date",body+"\nreturn {configureProductAnalytics,trackProductEvent,flushProductAnalytics,purgeProductAnalyticsAccount};")(
    ...Object.values(bindings),(fn,ms)=>{timers.set(++serial,{fn,due:time+ms});return serial;},id=>timers.delete(id),localDate);
  return {...service,timers,advance(ms){time+=ms;for(const [id,timer]of [...timers])if(timer.due<=time){timers.delete(id);timer.fn();}},now:()=>time};
}
const member=id=>({id,analyticsConsentAt:1});
test("failure backoff survives finally, new events, configure and manual flush",async()=>{
  let requests=0;
  const h=harness(async()=>{requests++;throw Error("offline");});
  h.configureProductAnalytics(member("one"));
  h.trackProductEvent("app_open",{platform:"web",entry:"launch"});
  await h.flushProductAnalytics();
  assert.equal(requests,1);
  assert.ok([...h.timers.values()].some(t=>t.due-h.now()===16000));
  for(let i=0;i<45;i++)h.trackProductEvent("app_open",{platform:"web",entry:"resume"});
  h.configureProductAnalytics(member("one"));await h.flushProductAnalytics();
  assert.equal(requests,1);
  h.advance(15999); await Promise.resolve(); assert.equal(requests,1);
  h.advance(1); await new Promise(resolve=>setImmediate(resolve)); assert.equal(requests,2);
  assert.ok([...h.timers.values()].some(t=>t.due-h.now()===32000));
  h.purgeProductAnalyticsAccount("one");
  assert.equal(h.timers.size,0);
});
test("a stale failed request does not impose its backoff on another account",async()=>{
  let rejectFirst,requests=0;
  const h=harness(()=>{requests++;return requests===1?new Promise((_,reject)=>{rejectFirst=reject;}):Promise.resolve({stored:1});});
  h.configureProductAnalytics(member("one"));h.trackProductEvent("app_open",{platform:"web",entry:"launch"});
  const pending=h.flushProductAnalytics();h.configureProductAnalytics(member("two"));
  h.trackProductEvent("app_open",{platform:"web",entry:"launch"});rejectFirst(Error("old failure"));await pending;
  await h.flushProductAnalytics();assert.equal(requests,2);
});
