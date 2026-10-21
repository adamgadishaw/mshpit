import test from "node:test";
import assert from "node:assert/strict";
import { venueMapStyle } from "./mapLibreVenueMap.web.js";

test("known OpenFreeMap source retains required linked credits while unrelated attribution is preserved", () => {
  const style = venueMapStyle({ sources: {
    hosted: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
    other: { type: "vector", url: "https://example.test/tiles", attribution: "Other required credit" },
  }, layers: [] });
  assert.match(style.sources.hosted.attribution, /https:\/\/openmaptiles\.org\//);
  assert.match(style.sources.hosted.attribution, /https:\/\/www\.openstreetmap\.org\/copyright/);
  assert.doesNotMatch(style.sources.hosted.attribution, /OpenFreeMap/);
  assert.equal(style.sources.other.attribution, "Other required credit");
});

function browserFixture(t) {
  const window = new EventTarget(), inserted = [];
  t.mock.method(globalThis,"setTimeout",setTimeout);
  Object.defineProperty(globalThis,"window",{value:window,configurable:true});
  Object.defineProperty(globalThis,"document",{value:{querySelector:()=>null,createElement:tag=>({tag,dataset:{},remove(){}}),head:{appendChild:value=>inserted.push(value)}},configurable:true});
  t.after(()=>{delete globalThis.window;delete globalThis.document;});
  return {window,inserted};
}
test("unverified empty cards load only their local styling, without a renderer or external request",async t=>{
  const {inserted}=browserFixture(t);
  const adapter=await import("./mapLibreVenueMap.web.js?empty-case");
  adapter.ensureVenueMapCardStyle();
  assert.deepEqual(inserted.map(node=>node.href),["/mshpit-maplibre/card.css"]);
  assert.equal(inserted.some(node=>node.tag==="script"),false);
});
test("explicit retry can reuse a renderer that finished after the original caller deadline",async t=>{
  const {window}=browserFixture(t);
  t.mock.timers.enable({apis:["setTimeout"]});
  const adapter=await import("./mapLibreVenueMap.web.js?late-case");
  const signal=new AbortController().signal;
  const failed=assert.rejects(adapter.mountVenueMap({}, {signal}),/renderer-unavailable/);
  t.mock.timers.tick(15001);
  await failed;
  const engine={dispose(){}};
  window.__mshpitMapRenderer={createRenderer:()=>engine};
  t.mock.method(globalThis,"fetch",async()=>({ok:true,json:async()=>({version:8,sources:{},layers:[]})}));
  assert.equal(await adapter.mountVenueMap({}, {signal}),engine);
});
test("aborting a late style response never creates an orphan map",async t=>{
  const {window}=browserFixture(t);
  let creations=0,finish;
  window.__mshpitMapRenderer={createRenderer:()=>{creations++;return{};}};
  t.mock.method(globalThis,"fetch",()=>new Promise(resolve=>{finish=resolve;}));
  const adapter=await import("./mapLibreVenueMap.web.js?abort-case");
  const controller=new AbortController();
  const pending=adapter.mountVenueMap({}, {signal:controller.signal});
  await Promise.resolve();
  controller.abort();finish({ok:true,json:async()=>({layers:[]})});
  assert.equal(await pending,null);assert.equal(creations,0);
});
