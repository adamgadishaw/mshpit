import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { discoverPhotosPresentation, discoverPhotosScope } from "./discoverPhotosApi.mjs";

const source = readFileSync(new URL("./useDiscoverPhotos.js", import.meta.url), "utf8");
const declaration = parse(source, { sourceType: "module" }).program.body.find(node => node.type === "ExportNamedDeclaration").declaration;
const panel = readFileSync(new URL("./DiscoverPhotoPanel.jsx", import.meta.url), "utf8");
const panelDeclaration = parse(panel, { sourceType: "module", plugins: ["jsx"] }).program.body.find(node => node.type === "ExportDefaultDeclaration").declaration;
const registration = panelDeclaration.body.body.find(node => node.expression?.callee?.name === "useEffect").expression.arguments[0];
const settle = () => new Promise(resolve => setImmediate(resolve));
const props = { accountId: "member", region: "Canada", city: "" };
const photos = id => [{ id, uri: `https://photos.example/${id}.jpg` }];

function fixture() {
  const states = [], refs = [], callbacks = [], calls = [];
  let stateIndex = 0, refIndex = 0, callbackIndex = 0, effectDeps, pending, cleanup;
  const bindings = {
    discoverPhotosPresentation, discoverPhotosScope,
    useCallback(fn, deps) {
      const index = callbackIndex++, prior = callbacks[index];
      if (!prior || deps.some((value, i) => !Object.is(value, prior.deps[i]))) callbacks[index] = { fn, deps };
      return callbacks[index].fn;
    },
    useRef: initial => refs[refIndex++] ||= { current: initial },
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
    },
    useEffect(effect, deps) {
      if (!effectDeps || deps.some((value, index) => !Object.is(value, effectDeps[index]))) { pending = effect; effectDeps = deps; }
    },
    loadDiscoverPhotos: options => new Promise((resolve, reject) => calls.push({ ...options, resolve, reject })),
  };
  const hook = new Function(...Object.keys(bindings), `return (${source.slice(declaration.start, declaration.end)});`)(...Object.values(bindings));
  return {
    calls,
    render(input = props) { stateIndex = 0; refIndex = 0; callbackIndex = 0; return hook(input); },
    commit() { if (pending) { cleanup?.(); cleanup = pending(); pending = null; } },
    unmount() { cleanup?.(); },
  };
}

test("Photos registers an awaited refresh that preserves loaded photos through failure and retry", async () => {
  const f = fixture(); f.render(); f.commit();
  f.calls[0].resolve(photos("first")); await settle();
  let registered;
  const register = new Function("gallery", "registerRefresh", `return (${panel.slice(registration.start, registration.end)});`)(f.render(), value => { registered = value; });
  const unregister = register();
  assert.equal(registered, f.render().refresh);
  const refresh = registered();
  assert.equal(f.calls.length, 2, "the registered operation actually starts another photo request");
  assert.deepEqual(f.render().photos, photos("first"));
  f.calls[1].reject(new Error("fixture offline"));
  assert.equal(await refresh, false);
  assert.equal(f.render().error, true);
  assert.deepEqual(f.render().photos, photos("first"));
  const retry = f.render().retry();
  assert.deepEqual(f.render().photos, photos("first"));
  f.calls[2].resolve(photos("fresh"));
  assert.equal(await retry, true);
  assert.equal(f.render().error, false);
  assert.deepEqual(f.render().photos, photos("fresh"));
  const empty = registered(); f.calls[3].resolve([]); assert.equal(await empty, true);
  assert.deepEqual(f.render().photos, [], "a successful empty refresh is authoritative");
  unregister(); assert.equal(registered, null); f.unmount();
});

test("repeated Photos refresh, external cancellation and unmount reject stale results", async () => {
  const f = fixture(); f.render(); f.commit(); f.calls[0].resolve(photos("first")); await settle();
  const earlier = f.render().refresh(), newer = f.render().refresh();
  assert.equal(f.calls[1].signal.aborted, true);
  f.calls[2].resolve(photos("newer")); assert.equal(await newer, true);
  f.calls[1].resolve(photos("late")); assert.equal(await earlier, null);
  assert.deepEqual(f.render().photos, photos("newer"));
  const controller = new AbortController(), cancelled = f.render().refresh({ signal: controller.signal });
  controller.abort(); assert.equal(f.calls[3].signal.aborted, true);
  f.calls[3].reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
  assert.equal(await cancelled, null); assert.equal(f.render().error, false);
  assert.deepEqual(f.render().photos, photos("newer"));
  const unmounted = f.render().refresh(); f.unmount(); assert.equal(f.calls[4].signal.aborted, true);
  f.calls[4].resolve(photos("after unmount")); assert.equal(await unmounted, null);
  assert.deepEqual(f.render().photos, photos("newer"));
});

test("Photos account and area changes hide old rows before effects and fence late results", async () => {
  const f = fixture(); f.render(); f.commit(); f.calls[0].resolve(photos("canada")); await settle();
  const oldRefresh = f.render().refresh();
  const next = { ...props, accountId: "another", region: "France" };
  assert.deepEqual(f.render(next).photos, []);
  f.calls[1].resolve(photos("late canada")); assert.equal(await oldRefresh, null);
  assert.deepEqual(f.render(next).photos, []);
  f.commit(); assert.equal(f.calls[2].region, "France");
  f.calls[2].resolve(photos("france")); await settle();
  assert.deepEqual(f.render(next).photos, photos("france"));
  const controller = new AbortController(); controller.abort();
  assert.equal(await f.render(next).refresh({ signal: controller.signal }), null);
  assert.equal(f.calls.length, 3, "an already-cancelled operation cannot start a request");
  f.unmount();
});
