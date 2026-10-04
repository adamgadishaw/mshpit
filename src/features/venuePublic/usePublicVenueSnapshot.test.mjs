import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import * as load from "../../domain/loadState.mjs";
import { accountTargetScope } from "../../domain/screenScope.mjs";
import { publicVenueRequestPath } from "../../domain/publicVenueSnapshot.mjs";

const source = readFileSync(new URL("./usePublicVenueSnapshot.js", import.meta.url), "utf8");
const declaration = parse(source, { sourceType: "module" }).program.body.find(node => node.type === "ExportDefaultDeclaration").declaration;
const settle = () => new Promise(resolve => setImmediate(resolve));
const props = { name: "Lee's Palace", identity: { source: "ticketmaster", providerVenueId: "rZ7HnEZaeot" }, accountId: null };
const page = (label, after = null) => ({ venue: { name: label }, events: [{ id: label }], after, nextCursor: "next", hasMore: true });
const failure = status => Object.assign(new Error("Unavailable"), { name: "AppError", code: "PIT-REQ-002", status, retryable: status >= 500 });

function fixture() {
  const states = [], refs = [], callbacks = [], calls = [];
  let stateIndex = 0, refIndex = 0, callbackIndex = 0, cleanup, pending, effectDeps;
  const bindings = { ...load, accountTargetScope, publicVenueRequestPath,
    useCallback(fn, deps) { const i = callbackIndex++; const prior = callbacks[i];
      if (!prior || deps.some((value, index) => !Object.is(value, prior.deps[index]))) callbacks[i] = { fn, deps };
      return callbacks[i].fn;
    },
    useRef: initial => refs[refIndex++] ||= { current: initial },
    useState(initial) { const i = stateIndex++; if (!(i in states)) states[i] = initial;
      return [states[i], value => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; },
    useEffect(effect, deps) { if (!effectDeps || deps.some((value, index) => !Object.is(value, effectDeps[index]))) { pending = effect; effectDeps = deps; } },
    fetchPublicVenueSnapshot: options => new Promise((resolve, reject) => calls.push({ ...options, resolve, reject })),
  };
  const hook = new Function(...Object.keys(bindings), `return (${source.slice(declaration.start, declaration.end)});`)(...Object.values(bindings));
  return { calls, render(input = props) { stateIndex = 0; refIndex = 0; callbackIndex = 0; return hook(input); },
    commit() { if (pending) { cleanup?.(); cleanup = pending(); pending = null; } }, unmount() { cleanup?.(); } };
}

test("cold guest loads one venue page; pagination replaces instead of growing the cache; refresh resets paging", async () => {
  const f = fixture(); assert.equal(f.render().resource.data, null); f.commit();
  assert.equal(f.calls[0].accountId, null); assert.equal(f.calls[0].path, "/venue/ticketmaster-rz7hnezaeot");
  f.calls[0].resolve(page("first")); await settle();
  const next = f.render().load({ after: "next" });
  assert.equal(f.calls[1].after, "next"); f.calls[1].resolve(page("second", "next")); await next;
  assert.deepEqual(f.render().resource.data.events, [{ id: "second" }]);
  const refresh = f.render().load(); assert.equal(f.calls[2].after, null);
  f.calls[2].resolve(page("refreshed")); await refresh; assert.equal(f.render().resource.data.after, null); f.unmount();
});

test("same-name provider changes and A-to-B-to-guest scopes hide old data before effects", async () => {
  const f = fixture(); const first = { ...props, accountId: "a" }; f.render(first); f.commit();
  f.calls[0].resolve(page("original")); await settle();
  // Same public slug, different exact provider ID: never reuse the old page.
  const second = { ...props, identity: { ...props.identity, providerVenueId: "rz7hnezaeot" }, accountId: "a" };
  assert.equal(f.render(second).resource.data, null); f.commit();
  assert.equal(f.calls[0].signal.aborted, true);
  f.calls[1].resolve(page("second provider")); await settle(); assert.equal(f.render(second).resource.data.venue.name, "second provider");
  const accountB = { ...second, accountId: "b" }; assert.equal(f.render(accountB).resource.data, null); f.commit();
  const guest = { ...second, accountId: null }; assert.equal(f.render(guest).resource.data, null);
  f.calls[2].resolve(page("late account B")); await settle(); assert.equal(f.render(guest).resource.data, null);
  f.commit(); f.calls[3].resolve(page("guest")); await settle(); assert.equal(f.render(guest).resource.data.venue.name, "guest"); f.unmount();
});

test("refresh beats stale pagination, retains same-page facts on network error, clears authoritative denial", async () => {
  const f = fixture(); f.render(); f.commit(); f.calls[0].resolve(page("first")); await settle();
  const paging = f.render().load({ after: "next" }); const refresh = f.render().load();
  assert.equal(f.calls[1].signal.aborted, true);
  f.calls[2].resolve(page("fresh")); await refresh; f.calls[1].resolve(page("late page")); await paging;
  assert.equal(f.render().resource.data.venue.name, "fresh");
  const retry = f.render().load(); f.calls[3].reject(failure(503)); await retry;
  assert.equal(f.render().resource.status, "error"); assert.equal(f.render().resource.data.venue.name, "fresh");
  const denied = f.render().load(); f.calls[4].reject(failure(404)); await denied;
  assert.equal(f.render().resource.data, null); f.unmount();
});

test("external refresh cancellation and unmount never become visible errors", async () => {
  const f = fixture(); f.render(); f.commit(); f.calls[0].resolve(page("first")); await settle();
  const controller = new AbortController(); const refreshing = f.render().load({ signal: controller.signal });
  controller.abort(); assert.equal(f.calls[1].signal.aborted, true);
  f.calls[1].reject(Object.assign(new Error("cancelled"), { name: "AbortError" })); await refreshing;
  assert.notEqual(f.render().resource.status, "error");
  const last = f.render().load(); f.unmount(); assert.equal(f.calls[2].signal.aborted, true);
  f.calls[2].resolve(page("after unmount")); await last; assert.equal(f.render().resource.data.venue.name, "first");
});
