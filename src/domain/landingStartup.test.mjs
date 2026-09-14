import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "@babel/parser";

import { initialLandingState, landingRenderSurface } from "./landingStartup.mjs";
import { navigationFrameForAccount } from "./memberAccess.mjs";
import { updatedAuthFrame } from "./publicFrameNavigation.mjs";

async function actualAppFunction(name) {
  const source = await readFile(new URL("../../App.js", import.meta.url), "utf8");
  let initializer;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "VariableDeclarator" && node.id?.name === name) initializer = node.init;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  };
  visit(parse(source, { sourceType: "module", plugins: ["jsx"] }).program);
  assert.ok(initializer, `App must expose the real ${name} callback`);
  return source.slice(initializer.start, initializer.end);
}

test("a logged-out canonical root reload owns the landing regardless of persisted client state", () => {
  let reads = 0;
  const landing = initialLandingState({
    web: true,
    pathname: "/?from=private-tab",
    demoEnabled: true,
    readPersisted() {
      reads += 1;
      return { id: "stale-local-account" };
    },
  });

  assert.equal(landing, true);
  assert.equal(reads, 0, "canonical root must decide before consulting device storage");
  assert.equal(landingRenderSurface({ authReady: true, session: null, landing }), "landing");
});

test("pending or stale auth cannot paint the app before the cookie handshake is authoritative", () => {
  assert.equal(landingRenderSurface({ authReady: false, session: null, landing: true }), "pending");
  assert.equal(landingRenderSurface({
    authReady: false,
    session: { id: "stale-async-account" },
    landing: false,
  }), "pending");
  assert.equal(landingRenderSurface({ authReady: true, session: null, landing: true }), "landing");
});

test("an explicit Explore action enters the guest app for the current visit", () => {
  const landing = initialLandingState({ web: true, pathname: "/", readPersisted: () => true });
  assert.equal(landing, true);
  assert.equal(landingRenderSurface({ authReady: true, session: null, landing: false }), "app");
  assert.equal(initialLandingState({
    web: true,
    pathname: "/",
    readPersisted: (key) => key === "pit.entered",
  }), true, "a later full root reload returns to the landing");
});

test("a confirmed signed-in account can view canonical Intro and still enter its separate feed", () => {
  assert.equal(landingRenderSurface({
    authReady: true,
    session: { id: "member_1" },
    landing: true,
  }), "landing");
  assert.equal(landingRenderSurface({ authReady: true, session: { id: "member_1" }, landing: false }), "app");
  assert.equal(initialLandingState({ web: true, pathname: "/feed" }), false);
});

test("explicit public destinations still open inside the app for logged-out visitors", () => {
  for (const pathname of [
    "/artists",
    "/events",
    "/artist/turnstile",
    "/venue/history-toronto",
    "/@pitfan",
    "/event/provider_123",
    "/turnstile",
  ]) {
    const landing = initialLandingState({ web: true, pathname, readPersisted: () => false });
    assert.equal(landing, false, pathname);
    assert.equal(landingRenderSurface({ authReady: true, session: null, landing }), "app", pathname);
  }
});

test("private-like unavailable storage fails open to the landing without detection", () => {
  let reads = 0;
  const unavailable = () => {
    reads += 1;
    throw new Error("storage denied");
  };
  assert.equal(initialLandingState({ web: true, pathname: "/", readPersisted: unavailable }), true);
  assert.equal(reads, 0);
  assert.equal(initialLandingState({ web: false, readPersisted: unavailable }), true);
});

test("App delegates startup and auth rendering to the pure landing policy", async () => {
  const source = await readFile(new URL("../../App.js", import.meta.url), "utf8");
  assert.match(source, /initialLandingState\(\{[\s\S]*?web,[\s\S]*?pathname:[\s\S]*?readPersisted: load,[\s\S]*?\}\)/);
  assert.match(source, /landingRenderSurface\(\{ authReady, session, landing \}\)/);
  assert.match(source, /landingSurface === "pending"/);
  assert.match(source, /landingSurface === "landing"/);
  assert.match(source, /onHome=\{exitToLanding\}/);
  assert.match(source, /target\.type === "home"\) \{ exitToLanding\(\); return; \}/);
  assert.match(source, /onDone=\{finishAuthentication\} onCancel=\{back\}/);
});

test("actual commitGo marks only new Intro-origin auth frames and keeps the marker across mode changes", async () => {
  const construct = new Function("navigationFrameForAccount", "prepareAvailableNavigationFrame", "session", "stackRef", "navigationRef", "pathForFrame", "web", "serverDocumentNavigationPath", "writeNavigation", `return (${await actualAppFunction("commitGo")});`);
  for (const landing of [true, false]) {
    for (const candidate of [{ auth: true, authMode: "login" }, { auth: true, authMode: "signup" }, { directory: "events" }]) {
      const stack = landing ? [{}] : [{}, { show: { id: "context-event" } }];
      let committed;
      construct(navigationFrameForAccount, (frame) => frame, null, { current: stack }, { current: { stack, landing } },
        () => null, false, () => null, (next) => { committed = next; })(candidate);
      const frame = committed.stack.at(-1);
      assert.equal(frame.authFromLanding, landing && candidate.auth ? true : undefined);
      assert.equal(Object.hasOwn(candidate, "authFromLanding"), false, "do not mutate the caller's frame");
      if (frame.auth) assert.equal(updatedAuthFrame(frame, "signup").authFromLanding, frame.authFromLanding);
      assert.deepEqual(committed.stack.slice(0, -1), stack, "retain the exact contextual parent for cancellation");
    }
  }
});

test("actual authentication completion sends Intro/direct entry to Feed but preserves contextual parents without a stale session closure", async () => {
  const construct = new Function("web", "browserHistoryRef", "writeNavigation", "navigationRef", "MAIN_TAB_PATHS", "back", `return (${await actualAppFunction("finishAuthentication")});`);
  const cases = [
    { web: true, canGoBack: false, stack: [{}, { auth: true }], feed: true },
    { web: true, canGoBack: true, stack: [{}, { auth: true, authFromLanding: true }], feed: true },
    { web: false, canGoBack: false, stack: [{}, { auth: true, authFromLanding: true }], feed: true },
    { web: true, canGoBack: true, stack: [{}, { show: { id: "event" } }, { auth: true }], feed: false },
    { web: true, canGoBack: true, stack: [{}, { profileId: "public-member" }, { auth: true }], feed: false },
    { web: false, canGoBack: false, stack: [{}, { show: { id: "native-event" } }, { auth: true }], feed: false },
  ];
  for (const fixture of cases) {
    const calls = [];
    const current = { stack: fixture.stack, tab: "discover", landing: false, accountId: null };
    construct(fixture.web, { current: { canGoBack: () => fixture.canGoBack } },
      (next, path, mode) => calls.push({ next, path, mode }), { current }, { feed: "/feed" }, () => calls.push("back"))();
    assert.equal(calls.length, 1);
    if (!fixture.feed) { assert.equal(calls[0], "back"); continue; }
    assert.equal(calls[0].path, "/feed");
    assert.equal(calls[0].mode, "replace");
    assert.equal(calls[0].next.landing, false);
    assert.deepEqual(calls[0].next.stack, [{}]);
  }
});

test("actual password reset completion consumes its token before opening Feed independently of stale account state", async () => {
  const calls = [];
  const current = { stack: [{}], tab: "discover", landing: true, accountId: null };
  const complete = new Function("clearResetUrl", "writeNavigation", "navigationRef", "MAIN_TAB_PATHS", `return (${await actualAppFunction("finishPasswordReset")});`)(
    () => calls.push("clear-token"), (next, path, mode) => calls.push({ next, path, mode }), { current }, { feed: "/feed" },
  );
  complete();
  assert.equal(calls[0], "clear-token");
  assert.deepEqual(calls[1], { next: { stack: [{}], tab: "feed", landing: false, accountId: null }, path: "/feed", mode: "replace" });
  const source = await readFile(new URL("../../App.js", import.meta.url), "utf8");
  assert.match(source, /<ResetPasswordScreen token=\{resetToken\} onDone=\{finishPasswordReset\} onCancel=\{clearResetUrl\}/,
    "cancellation must only consume the reset token, never imply successful authentication");
});
