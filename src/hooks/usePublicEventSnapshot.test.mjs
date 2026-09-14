import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import * as load from "../domain/loadState.mjs";
import { publicEventSnapshotScope } from "../domain/publicEventSnapshot.mjs";

const source = readFileSync(new URL("./usePublicEventSnapshot.js", import.meta.url), "utf8");
const declaration = parse(source, { sourceType: "module" }).program.body
  .find((node) => node.type === "ExportDefaultDeclaration").declaration;
const settle = () => new Promise((resolve) => setImmediate(resolve));

function fixture() {
  const states = [], refs = [], calls = [];
  let stateIndex = 0, refIndex = 0, cleanup, pending, effectDeps;
  const bindings = {
    ...load, publicEventSnapshotScope,
    useCallback: (fn) => fn,
    useRef: (initial) => refs[refIndex++] ||= { current: initial },
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (value) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
    },
    useEffect(effect, deps) {
      if (!effectDeps || deps.some((value, index) => !Object.is(value, effectDeps[index]))) {
        pending = effect;
        effectDeps = deps;
      }
    },
    readPublicEventSnapshot(options) {
      return new Promise((resolve, reject) => calls.push({ ...options, resolve, reject }));
    },
  };
  const hook = new Function(...Object.keys(bindings), `return (${source.slice(declaration.start, declaration.end)});`)(...Object.values(bindings));
  return {
    calls,
    render(props) { stateIndex = 0; refIndex = 0; return hook(props); },
    commit() { if (pending) { cleanup?.(); cleanup = pending(); pending = null; } },
    unmount() { cleanup?.(); },
  };
}

test("real snapshot hook isolates account/event changes before effects and rejects late responses", async () => {
  const f = fixture();
  f.render({ eventId: "event-a", accountId: "a" }); f.commit();
  const next = f.render({ eventId: "event-b", accountId: "b" });
  assert.equal(next.resource.data, null);
  f.commit();
  assert.equal(f.calls[0].signal.aborted, true);
  f.calls[0].resolve({ name: "Old event" });
  await settle();
  assert.equal(f.render({ eventId: "event-b", accountId: "b" }).resource.data, null);
  f.calls[1].resolve({ name: "Current event" });
  await settle();
  assert.equal(f.render({ eventId: "event-b", accountId: "b" }).resource.data.name, "Current event");
  assert.equal(f.render({ eventId: "event-b", accountId: null }).resource.data, null);
  f.unmount();
});

test("real hook preserves readable details during retry failure and removes them after authoritative denial", async () => {
  const f = fixture(); const props = { eventId: "event", accountId: null };
  f.render(props); f.commit(); f.calls[0].resolve({ name: "Known public event" }); await settle();
  let view = f.render(props);
  view.reload(); f.render(props); f.commit();
  assert.equal(f.render(props).resource.status, "refreshing");
  f.calls[1].reject(Object.assign(new Error("Retry later"), { name: "AppError", code: "PIT-REQ-002", retryable: true }));
  await settle(); view = f.render(props);
  assert.equal(view.resource.status, "error");
  assert.equal(view.resource.data.name, "Known public event");
  view.reload(); f.render(props); f.commit(); f.calls[2].resolve(null); await settle();
  assert.equal(f.render(props).resource.status, "ready");
  assert.equal(f.render(props).resource.data, null);
  f.unmount();
});

test("unmount cancellation does not publish errors, and no candidate causes no request", async () => {
  const f = fixture(); const props = { eventId: "event" };
  f.render(props); f.commit(); f.unmount();
  assert.equal(f.calls[0].signal.aborted, true);
  f.calls[0].reject(Object.assign(new Error("aborted"), { name: "AbortError" })); await settle();
  assert.notEqual(f.render(props).resource.status, "error");
  const empty = fixture(); empty.render({ eventId: null }); empty.commit();
  assert.equal(empty.calls.length, 0);
  assert.equal(empty.render({ eventId: null }).resource.data, null);
});
