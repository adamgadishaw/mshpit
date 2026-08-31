import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { initialLandingState, landingRenderSurface } from "./landingStartup.mjs";

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

test("a confirmed signed-in account keeps the intended in-app root flow", () => {
  assert.equal(landingRenderSurface({
    authReady: true,
    session: { id: "member_1" },
    landing: true,
  }), "app");
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
});
