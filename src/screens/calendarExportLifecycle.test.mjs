import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { parse } from "@babel/parser";
import * as calendar from "../domain/calendarExport.mjs";

const require = createRequire(import.meta.url);
const { transformSync } = require("@babel/core");
const event = { artist: "Fixture Artist", venue: "Fixture Venue", date: "2027-07-15" };
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
function load(path, bindings) {
  const code = transformSync(read(path), {
    filename: path, babelrc: false, configFile: false,
    plugins: [require("@babel/plugin-transform-modules-commonjs")],
  }).code;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    assert.ok(Object.hasOwn(bindings, name), `Unexpected import: ${name}`);
    return bindings[name];
  }, module, module.exports);
  return module.exports;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let n = 0; n < 5; n++) await Promise.resolve(); };

const source = read("./CalendarScreen.jsx");
const screen = parse(source, { sourceType: "module", plugins: ["jsx"] }).program.body
  .find((node) => node.type === "ExportDefaultDeclaration").declaration;
const handler = screen.body.body.filter((node) => node.type === "VariableDeclaration")
  .flatMap((node) => node.declarations).find((node) => node.id.name === "saveCalendar").init;
const compileHandler = (bindings) => new Function(...Object.keys(bindings), `return (${source.slice(handler.start, handler.end)});`)(...Object.values(bindings));

// Real screen handler -> real platform hook -> real exporter -> mocked native
// boundaries. No private events, disk export, native UI or network are involved.
function nativeFixture(platform = "ios") {
  const availability = [], shares = [], files = [], deletes = [];
  const faults = {};
  const Sharing = {
    isAvailableAsync() { const wait = deferred(); availability.push(wait); return wait.promise; },
    shareAsync(uri, options) {
      if (faults.shareSync) throw new Error("share sync failed");
      const wait = deferred(); shares.push({ uri, options, ...wait }); return wait.promise;
    },
  };
  class File {
    constructor(_cache, name) {
      if (faults.construct) throw new Error("construct failed");
      this.uri = `file:///mock-cache/${name}`;
      files.push(this);
      faults.afterConstruct?.();
    }
    create(options) {
      this.options = options;
      if (faults.create) throw new Error("create failed");
      this.created = true;
      faults.afterCreate?.();
    }
    write(contents) {
      this.contents = contents;
      if (faults.write) throw new Error("write failed");
      faults.afterWrite?.();
    }
    delete() {
      deletes.push(this.uri);
      if (faults.cleanup) throw new Error("cleanup failed");
      this.deleted = true;
    }
  }
  const exporter = load(`../lib/calendarExport.${platform === "ios" ? "ios" : "native"}.js`, {
    "expo-file-system": { File, Paths: { cache: "mock-cache" } }, "expo-sharing": Sharing,
    "../domain/calendarExport.mjs": calendar,
  });
  return { availability, shares, files, deletes, faults, exporter };
}

function hookFixture(native, platform = "ios") {
  const slots = [], effects = [], updates = [];
  const listeners = new Set();
  const AppState = {
    currentState: "active",
    addEventListener(_type, listener) { listeners.add(listener); return { remove: () => listeners.delete(listener) }; },
  };
  let cursor = 0;
  const react = {
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], (next) => { slots[i] = next; updates.push(next); }];
    },
    useLayoutEffect(setup) { const i = cursor++; if (!effects[i]) effects[i] = { setup, cleanup: setup() }; },
  };
  const hook = load(`../hooks/useIOSCalendarExport${platform === "ios" ? ".ios" : ""}.js`, {
    react, "react-native": { AppState }, "../lib/calendarExport": native.exporter,
  }).default;
  let account = "a", epoch = 1;
  const legacy = { exportingKey: "", notice: null };
  return {
    updates,
    appState(state, notify = true) {
      AppState.currentState = state;
      if (notify) for (const listener of listeners) listener(state);
    },
    listeners,
    render(nextAccount = account, nextEpoch = epoch) {
      account = nextAccount; epoch = nextEpoch; cursor = 0;
      const action = hook(account, epoch);
      const saveCalendar = compileHandler({
        Platform: { OS: platform }, iosExport: action,
        exportingKey: legacy.exportingKey,
        setCalendarNotice: (value) => { legacy.notice = value; },
        setExportingKey: (value) => { legacy.exportingKey = value; },
        exportCalendarEvents: native.exporter.exportCalendarEvents,
      });
      return { ...action, saveCalendar, legacy };
    },
    unmount() { effects.forEach((effect) => effect?.cleanup()); },
    replayEffects() {
      effects.forEach((effect) => { effect?.cleanup(); if (effect) effect.cleanup = effect.setup(); });
    },
  };
}

test("screen wires iOS feedback and account/auth epoch while fallback is inert", () => {
  assert.match(source, /useIOSCalendarExport\(session\?\.id \?\? null, chatAuthEpoch\)/);
  assert.match(source, /Platform.OS === "ios" \? iosExport.calendarNotice : legacyCalendarNotice/);
  assert.match(source, /Platform.OS === "ios" \? iosExport.exportingKey : legacyExportingKey/);
  assert.match(source, /saveCalendar\(goingEvents, "all"\)/);
  assert.match(source, /saveCalendar\(ev, `event-/);
  assert.equal(load("../hooks/useIOSCalendarExport.js", {}).default(), null);
});

test("actual screen handler synchronously rejects same-frame same/different-button duplicates", async () => {
  const n = nativeFixture(), h = hookFixture(n), screen = h.render();
  const pending = screen.saveCalendar(event, "event-a");
  await screen.saveCalendar(event, "event-a");
  await screen.saveCalendar([event], "all");
  assert.equal(n.availability.length, 1);
  assert.equal(h.render().exportingKey, "event-a");
  n.availability[0].resolve(true); await flush();
  assert.equal(n.shares.length, 1);
  assert.equal(n.deletes.length, 0, "keep the file until native sharing settles");
  assert.equal(n.files[0].options.overwrite, false);
  assert.equal(n.files[0].contents.replace(/DTSTAMP:[^\r]+/, "DTSTAMP:fixed"), calendar.buildCalendarDocument(event).replace(/DTSTAMP:[^\r]+/, "DTSTAMP:fixed"));
  assert.equal(n.shares[0].options.UTI, "public.calendar-event");
  n.shares[0].resolve(); await pending;
  assert.deepEqual(n.deletes, [n.files[0].uri]);
  const done = h.render();
  assert.equal(done.exportingKey, "");
  assert.match(done.calendarNotice.text, /Check your chosen app/);
  const retry = done.saveCalendar(event, "event-a");
  n.availability[1].resolve(true); await flush();
  assert.notEqual(n.files[0].uri, n.files[1].uri);
  n.shares[1].resolve(); await retry;
});

for (const boundary of ["unmount", "logout", "account", "epoch", "round-trip", "batched-round-trip"]) {
  test(`pending availability cannot present or publish after ${boundary}`, async () => {
    const n = nativeFixture(), h = hookFixture(n), screen = h.render();
    const pending = screen.saveCalendar(event, "event-a");
    if (boundary === "unmount") h.unmount();
    if (boundary === "logout") h.render(null, 2);
    if (boundary === "account") h.render("b", 2);
    if (boundary === "epoch") h.render("a", 2);
    if (boundary === "round-trip") { h.render("b", 2); h.render("a", 3); }
    if (boundary === "batched-round-trip") h.render("a", 3);
    const count = h.updates.length;
    n.availability[0].resolve(true); await pending;
    assert.equal(n.files.length, 0);
    assert.equal(n.shares.length, 0);
    assert.equal(h.updates.length, count);
    await screen.saveCalendar(event, "stale-handler");
    assert.equal(n.availability.length, 1, "stale rendered callbacks cannot claim new ownership");
    if (boundary !== "unmount") {
      assert.equal(h.render().exportingKey, "");
      assert.equal(h.render().calendarNotice, null);
    }
  });
}

test("late old availability settlement cannot clear a new owner's operation", async () => {
  const n = nativeFixture(), h = hookFixture(n);
  const old = h.render().saveCalendar(event, "old");
  const next = h.render("b", 2).saveCalendar(event, "new");
  n.availability[0].reject(new Error("old failure")); await old;
  assert.equal(h.render().exportingKey, "new");
  assert.equal(h.render().calendarNotice, null);
  n.availability[1].resolve(true); await flush(); n.shares[0].resolve(); await next;
});

for (const step of ["afterConstruct", "afterCreate", "afterWrite"]) {
  test(`invalidation ${step} prevents sharing and only cleans a successfully created file`, async () => {
    const n = nativeFixture(), h = hookFixture(n);
    n.faults[step] = () => h.unmount();
    const pending = h.render().saveCalendar(event, "event-a");
    n.availability[0].resolve(true); await pending;
    assert.equal(n.shares.length, 0);
    assert.deepEqual(n.deletes, step === "afterConstruct" ? [] : [n.files[0].uri]);
  });
}

for (const boundary of ["unmount", "account", "epoch", "round-trip"]) {
  test(`already-presented sharing stays gated after ${boundary}, and late completion cannot publish`, async () => {
    const n = nativeFixture(), h = hookFixture(n);
    const old = h.render().saveCalendar(event, "old");
    n.availability[0].resolve(true); await flush();
    let current = h;
    if (boundary === "unmount") { h.unmount(); current = hookFixture(n); }
    if (boundary === "account") h.render("b", 2);
    if (boundary === "epoch") h.render("a", 2);
    if (boundary === "round-trip") { h.render("b", 2); h.render("a", 3); }
    const next = current.render().saveCalendar(event, "new");
    n.availability[1].resolve(true); await next;
    assert.equal(n.shares.length, 1);
    assert.equal(n.files.length, 1);
    assert.equal(n.deletes.length, 0);
    assert.match(current.render().calendarNotice.text, /dismiss the open share sheet/);
    const oldUpdates = h.updates.length, currentUpdates = current.updates.length;
    n.shares[0].resolve(); await old;
    assert.equal(h.updates.length, oldUpdates);
    assert.equal(current.updates.length, currentUpdates);
    assert.deepEqual(n.deletes, [n.files[0].uri]);
    const retry = current.render().saveCalendar(event, "retry");
    n.availability[2].resolve(true); await flush();
    assert.equal(n.shares.length, 2);
    assert.notEqual(n.files[0].uri, n.files[1].uri);
    assert.equal(n.files[1].deleted, undefined);
    n.shares[1].resolve(); await retry;
  });
}

for (const fault of ["unavailable", "availability", "construct", "create", "write", "shareSync", "shareAsync"]) {
  test(`${fault} failure is truthful, cleans only owned files, and permits deliberate retry`, async () => {
    const n = nativeFixture(), h = hookFixture(n);
    n.faults[fault] = true;
    const pending = h.render().saveCalendar(event, "event-a");
    if (fault === "availability") n.availability[0].reject(new Error("availability failed"));
    else n.availability[0].resolve(fault !== "unavailable");
    await flush();
    if (fault === "shareAsync") n.shares[0].reject(new Error("share failed"));
    await pending;
    const result = h.render();
    assert.equal(result.exportingKey, "");
    assert.equal(result.calendarNotice.ok, false);
    assert.deepEqual(n.deletes, ["write", "shareSync", "shareAsync"].includes(fault) ? [n.files[0].uri] : []);
    delete n.faults[fault];
    const retry = result.saveCalendar(event, "retry");
    n.availability[1].resolve(true); await flush(); n.shares.at(-1).resolve(); await retry;
    assert.equal(h.render().calendarNotice.ok, true);
  });
}

test("cleanup failure does not masquerade as calendar save success or poison the gate", async () => {
  const n = nativeFixture(), h = hookFixture(n);
  n.faults.cleanup = true;
  const pending = h.render().saveCalendar(event, "event-a");
  n.availability[0].resolve(true); await flush(); n.shares[0].resolve(); await pending;
  assert.match(h.render().calendarNotice.text, /temporary calendar file could not be removed/);
  assert.equal(h.render().calendarNotice.ok, false);
  n.faults.cleanup = false;
  const retry = h.render().saveCalendar(event, "retry");
  n.availability[1].resolve(true); await flush(); n.shares[1].resolve(); await retry;
  assert.notEqual(n.files[0].uri, n.files[1].uri);
  assert.equal(n.files[0].deleted, undefined, "retry never deletes another operation's file");
  assert.equal(n.files[1].deleted, true);
});

test("StrictMode layout cleanup/setup invalidates pending work and accepts a new action", async () => {
  const n = nativeFixture(), h = hookFixture(n);
  const old = h.render().saveCalendar(event, "old");
  h.replayEffects();
  assert.equal(h.listeners.size, 1);
  const nextScreen = h.render();
  assert.equal(nextScreen.exportingKey, "");
  const next = nextScreen.saveCalendar(event, "new");
  n.availability[0].resolve(true); await old;
  assert.equal(n.files.length, 0);
  assert.equal(h.render().exportingKey, "new");
  n.availability[1].resolve(true); await flush(); n.shares[0].resolve(); await next;
});

test("leaving foreground invalidates unpresented intent even after returning active", async () => {
  for (const state of ["inactive", "background"]) {
    const n = nativeFixture(), h = hookFixture(n);
    const old = h.render().saveCalendar(event, "old");
    h.appState(state);
    assert.equal(h.render().exportingKey, "");
    h.appState("active");
    n.availability[0].resolve(true); await old;
    assert.equal(n.shares.length, 0);
    assert.equal(n.files.length, 0);
    const retry = h.render().saveCalendar(event, "retry");
    n.availability[1].resolve(true); await flush(); n.shares[0].resolve(); await retry;
    h.unmount(); assert.equal(h.listeners.size, 0);
  }
});

test("queued old AppState listeners cannot revoke a replayed lifetime or update an unmounted screen", async () => {
  const n = nativeFixture(), h = hookFixture(n);
  h.render();
  const oldListener = [...h.listeners][0];
  h.replayEffects();
  const pending = h.render().saveCalendar(event, "fresh");
  const updates = h.updates.length;
  oldListener("inactive");
  assert.equal(h.updates.length, updates);
  assert.equal(h.render().exportingKey, "fresh");
  n.availability[0].resolve(true); await flush();
  assert.equal(n.shares.length, 1);
  const currentListener = [...h.listeners][0];
  h.unmount();
  const afterUnmount = h.updates.length;
  currentListener("inactive"); oldListener("background");
  n.shares[0].resolve(); await pending;
  assert.equal(h.updates.length, afterUnmount);
});

test("inactive state read before its event cancels and releases current busy feedback", async () => {
  const n = nativeFixture(), h = hookFixture(n);
  const pending = h.render().saveCalendar(event, "event-a");
  h.appState("inactive", false);
  n.availability[0].resolve(true); await pending;
  assert.equal(h.render().exportingKey, "");
  assert.equal(h.render().calendarNotice, null);
  assert.equal(n.files.length, 0);
  await h.render().saveCalendar(event, "inactive-press");
  assert.equal(n.availability.length, 1);
  h.appState("active");
  const retry = h.render().saveCalendar(event, "retry");
  n.availability[1].resolve(true); await flush(); n.shares[0].resolve(); await retry;
});

test("the presented sheet's inactive transition neither unlocks sharing nor reports cancellation", async () => {
  const n = nativeFixture(), h = hookFixture(n);
  const pending = h.render().saveCalendar(event, "event-a");
  n.availability[0].resolve(true); await flush();
  h.appState("inactive");
  assert.equal(h.render().exportingKey, "event-a");
  assert.equal(h.render().calendarNotice, null);
  assert.equal(n.deletes.length, 0);
  h.appState("active");
  await h.render().saveCalendar(event, "duplicate");
  assert.equal(n.availability.length, 1);
  n.shares[0].resolve(); await pending;
  assert.equal(h.render().exportingKey, "");
  assert.match(h.render().calendarNotice.text, /Check your chosen app/);
});

test("Android keeps the actual native exporter and legacy screen notice path", async () => {
  const n = nativeFixture("android"), h = hookFixture(n, "android");
  const screen = h.render(), pending = screen.saveCalendar(event, "event-a");
  n.availability[0].resolve(true); await flush();
  assert.equal(n.files[0].uri, `file:///mock-cache/${calendar.calendarExportFileName(event)}`);
  assert.equal(n.files[0].options.overwrite, true);
  n.shares[0].resolve(); await pending;
  assert.equal(screen.legacy.notice.text, `${calendar.calendarExportFileName(event)} is ready for your calendar.`);
  assert.equal(n.deletes.length, 0);
});

test("web keeps download behavior and does not invoke iOS sharing or hooks", async () => {
  const clicks = [], revoked = [], scheduled = [];
  const document = { body: { appendChild() {} }, createElement: () => ({ click() { clicks.push(this.download); }, remove() {} }) };
  const URL = { createObjectURL: () => "blob:fixture", revokeObjectURL: (url) => revoked.push(url) };
  const webSource = read("../lib/calendarExport.web.js").replace(/^import .*;\n/m, "").replace("export async function", "async function");
  const exportCalendarEvents = new Function("buildCalendarDocument", "calendarExportFileName", "document", "URL", "setTimeout", `${webSource}; return exportCalendarEvents;`)(calendar.buildCalendarDocument, calendar.calendarExportFileName, document, URL, (fn, ms) => scheduled.push({ fn, ms }));
  const h = hookFixture({ exporter: { exportCalendarEvents } }, "web"), screen = h.render();
  await screen.saveCalendar(event, "event-a");
  assert.deepEqual(clicks, [calendar.calendarExportFileName(event)]);
  assert.equal(screen.legacy.notice.text, `${calendar.calendarExportFileName(event)} is ready for your calendar.`);
  assert.equal(scheduled[0].ms, 5000); scheduled[0].fn();
  assert.deepEqual(revoked, ["blob:fixture"]);
});
