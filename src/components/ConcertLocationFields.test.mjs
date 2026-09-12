import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync } from "@babel/core";
import { LIMITS } from "../domain/validation.mjs";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("./ConcertLocationFields.jsx", import.meta.url), "utf8");
const implementation = transformSync(source, {
  filename: "ConcertLocationFields.jsx", configFile: false, babelrc: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const sameDependencies = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

// Run the component's real hooks, async effects and input callbacks. Only host
// rendering, the clock, and the directory transport are substituted.
function fixture(initial = {}) {
  const slots = [], effects = [], calls = [], writes = [], changes = [], timers = new Map();
  let cursor = 0, sequence = 0, mounted = true, tree;
  const hooks = {
    useState(initialValue) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initialValue === "function" ? initialValue() : initialValue };
      return [slots[index].value, (next) => {
        writes.push({ mounted });
        slots[index].value = typeof next === "function" ? next(slots[index].value) : next;
      }];
    },
    useRef(initialValue) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: initialValue };
      return slots[index];
    },
    useEffect(create, dependencies) {
      const index = cursor++;
      if (slots[index] && sameDependencies(slots[index].dependencies, dependencies)) return;
      const previous = slots[index];
      slots[index] = { dependencies };
      effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = create(); });
    },
  };
  const mod = { exports: {} };
  const imports = (name) => {
    if (name === "react") return hooks;
    if (name === "react-native") return {
      View: "View", Text: "Text", TextInput: "TextInput", Pressable: "Pressable",
      StyleSheet: { create: (styles) => styles, hairlineWidth: 1 },
    };
    if (name === "../theme") return { colors: {}, mono: "mono", radius: {} };
    if (name === "../domain/validation.mjs") return { LIMITS };
    if (name === "./Icon") return "Icon";
    return require(name);
  };
  new Function("require", "module", "exports", "setTimeout", "clearTimeout", implementation)(
    imports, mod, mod.exports,
    (callback, delay) => { const id = ++sequence; timers.set(id, { callback, delay }); return id; },
    (id) => timers.delete(id),
  );
  let props = {
    city: "", eventAddress: "",
    readCities: (options) => {
      const response = deferred(); calls.push({ options, ...response }); return response.promise;
    },
    onCityChange: (value) => { changes.push({ city: value }); props.city = value; },
    onEventAddressChange: (value) => { changes.push({ eventAddress: value }); props.eventAddress = value; },
    ...initial,
  };
  const walk = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node)
    ? node.flatMap(walk) : [node, ...walk(node.props?.children)];
  const render = (update = {}) => {
    props = { ...props, ...update }; cursor = 0;
    tree = mod.exports.default(props);
    for (const effect of effects.splice(0)) effect();
  };
  const labelled = (label) => {
    const node = walk(tree).find((item) => item.props?.accessibilityLabel === label);
    assert.ok(node, `Missing actual control: ${label}`);
    return node.props;
  };
  const typeCity = (value) => { labelled("Concert city, region and country").onChangeText(value); render(); };
  const flushTimers = () => {
    for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); }
  };
  const text = () => JSON.stringify(walk(tree).filter((item) => item.type === "Text").map((item) => item.props.children));
  const buttons = () => walk(tree).filter((item) => item.type === "Pressable").map((item) => item.props);
  const unmount = () => { mounted = false; for (const slot of slots) slot?.cleanup?.(); };
  render();
  return { render, labelled, typeCity, flushTimers, timers, calls, writes, changes, text, buttons, unmount };
}

const toronto = { city: "Toronto", region: "Ontario", country: "Canada", countryCode: "CA", citySlug: "toronto" };

test("existing locations mount without an unnecessary search and use shared field bounds", () => {
  const f = fixture({ city: "Toronto, Ontario, Canada", eventAddress: "123 Queen Street" });
  f.flushTimers();
  assert.equal(f.calls.length, 0);
  assert.equal(f.labelled("Concert city, region and country").maxLength, LIMITS.city);
  const address = f.labelled("Public event address, optional");
  assert.equal(address.maxLength, LIMITS.eventAddress);
  assert.equal(address.autoComplete, "off");
  assert.match(address.accessibilityHint, /Do not add a private home address/);
  assert.match(f.text(), /map uses the city area, not this exact address/);
});

test("city search debounces, ignores a one-character query, and requests only five matches", () => {
  const f = fixture();
  f.typeCity("T"); f.flushTimers();
  assert.equal(f.calls.length, 0);
  f.typeCity("To");
  assert.equal([...f.timers.values()][0].delay, 250);
  f.typeCity("Tor");
  assert.equal(f.timers.size, 1);
  f.flushTimers();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].options.query, "Tor");
  assert.equal(f.calls[0].options.limit, 5);
});

test("leaving city input cancels the debounce synchronously before effect cleanup", () => {
  const f = fixture();
  f.typeCity("Tor");
  f.labelled("Public event address, optional").onFocus();
  // Deliberately do not render: cancellation must own this gap as well.
  f.flushTimers();
  assert.equal(f.calls.length, 0);
});

test("stale city responses cannot replace the active query", async () => {
  const f = fixture();
  f.typeCity("Tor"); f.flushTimers();
  f.typeCity("Par"); f.flushTimers();
  assert.equal(f.calls[0].options.signal.aborted, true);
  f.calls[1].resolve({ cities: [{ city: "Paris", country: "France", countryCode: "FR", citySlug: "paris" }] });
  await tick(); f.render();
  f.calls[0].resolve({ cities: [toronto] });
  await tick(); f.render();
  assert.deepEqual(f.buttons().map((button) => button.accessibilityLabel), ["Use Paris, France"]);
});

test("selection keeps the full qualified city and never replaces address or venue", async () => {
  const f = fixture({ eventAddress: "123 Queen Street" });
  f.typeCity("Tor"); f.flushTimers();
  f.calls[0].resolve({ cities: [toronto] });
  await tick(); f.render();
  f.labelled("Use Toronto, Ontario, Canada").onPress(); f.render();
  assert.equal(f.labelled("Concert city, region and country").value, "Toronto, Ontario, Canada");
  assert.equal(f.labelled("Public event address, optional").value, "123 Queen Street");
  assert.deepEqual(f.changes.at(-1), { city: "Toronto, Ontario, Canada" });
  assert.equal(f.buttons().length, 0);
  assert.equal(f.calls[0].options.signal.aborted, true);
});

test("oversized and malformed directory results stay bounded", async () => {
  const f = fixture();
  f.typeCity("City"); f.flushTimers();
  f.calls[0].resolve({ cities: [null, { city: "" }, ...Array.from({ length: 20 }, (_, index) => ({ city: `City ${index}`, country: "Canada" }))] });
  await tick(); f.render();
  assert.equal(f.buttons().length, 5);
});

test("lookup failures leave manual city and address entry usable without leaking error details", async () => {
  const f = fixture();
  f.typeCity("Small town, Ontario, Canada"); f.flushTimers();
  f.calls[0].reject(new Error("private upstream detail"));
  await tick(); f.render();
  assert.match(f.text(), /You can still type the city, region and country/);
  assert.doesNotMatch(f.text(), /private upstream/);
  f.labelled("Public event address, optional").onChangeText("123 Main Street"); f.render();
  assert.equal(f.labelled("Concert city, region and country").value, "Small town, Ontario, Canada");
  assert.deepEqual(f.changes.at(-1), { eventAddress: "123 Main Street" });
});

test("an address asks for a city, and focusing it cancels city suggestions", async () => {
  const f = fixture({ eventAddress: "123 Main Street" });
  assert.match(f.text(), /Add the city for this address before posting/);
  f.typeCity("Tor"); f.flushTimers();
  f.labelled("Public event address, optional").onFocus(); f.render();
  assert.equal(f.calls[0].options.signal.aborted, true);
  f.calls[0].resolve({ cities: [toronto] });
  await tick(); f.render();
  assert.equal(f.buttons().length, 0);
});

test("clearing the city and unmounting both retire pending requests", async () => {
  const f = fixture();
  f.typeCity("Tor"); f.flushTimers();
  f.typeCity("");
  assert.equal(f.calls[0].options.signal.aborted, true);
  f.typeCity("Paris"); f.flushTimers();
  f.unmount();
  assert.equal(f.calls[1].options.signal.aborted, true);
  const before = f.writes.length;
  f.calls[0].resolve({ cities: [toronto] });
  f.calls[1].reject(new Error("late response"));
  await tick();
  assert.equal(f.writes.length, before);
});
