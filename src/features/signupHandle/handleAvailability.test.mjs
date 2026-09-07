import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createHandleAvailabilityController } from "./handleAvailabilityController.mjs";
import { signupAccountError, signupAriaProps, signupFormPayload, signupHandlePresentation, signupMusicError } from "../../domain/signupForm.mjs";

const asError = (error) => Object.assign(new Error("Could not check username"), {
  name: "AppError", code: "PIT-API-001", retryable: true, status: error.status || 0,
});
function fixture() {
  let sequence = 0;
  const scheduled = new Map(), calls = [];
  const controller = createHandleAvailabilityController({
    asError,
    read: (handle, options) => new Promise((resolve, reject) => calls.push({ handle, ...options, resolve, reject })),
    schedule: (callback, milliseconds) => { const id = ++sequence; scheduled.set(id, { callback, milliseconds }); return id; },
    unschedule: (id) => scheduled.delete(id),
  });
  const flush = () => { for (const [id, { callback }] of [...scheduled]) { scheduled.delete(id); callback(); } };
  return { controller, calls, scheduled, flush };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
const account = { name: "Alex", handle: "alex_live", email: "alex@example.com", password: "secure1234" };

test("availability coalesces typing and never requests too-short handles", async () => {
  const f = fixture();
  f.controller.setHandle("a"); f.flush(); assert.equal(f.calls.length, 0);
  f.controller.setHandle("alex"); f.controller.setHandle("alex_live");
  assert.equal(f.scheduled.size, 1);
  assert.equal([...f.scheduled.values()][0].milliseconds, 450);
  f.flush(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].handle, "alex_live");
  f.calls[0].resolve({ handle: "alex_live", available: true }); await settle();
  assert.equal(f.controller.getSnapshot().status, "ready");
  assert.equal(signupHandlePresentation(f.controller.getSnapshot(), "alex_live").tone, "good");
});

test("changed handles clear green status before a new response and reject late data", async () => {
  const f = fixture(); f.controller.setHandle("first"); f.flush();
  f.controller.setHandle("second");
  assert.equal(f.calls[0].signal.aborted, true);
  assert.equal(f.controller.getSnapshot().data, null);
  f.calls[0].resolve({ handle: "first", available: true }); await settle();
  assert.notEqual(signupHandlePresentation(f.controller.getSnapshot(), "second").tone, "good");
  f.flush(); f.calls[1].resolve({ handle: "second", available: false }); await settle();
  assert.equal(f.controller.getSnapshot().data.available, false);
  assert.equal(signupHandlePresentation(f.controller.getSnapshot(), "second").tone, "error");
});

test("errors and rate limits never become available and explicit retry clears stale success", async () => {
  const f = fixture(); f.controller.setHandle("first"); f.flush();
  f.calls[0].resolve({ handle: "first", available: true }); await settle();
  f.controller.retry(); assert.equal(f.controller.getSnapshot().data, null);
  f.calls[1].reject(Object.assign(new Error("limited"), { status: 429 })); await settle();
  assert.equal(f.controller.getSnapshot().status, "error");
  assert.equal(f.controller.getSnapshot().data, null);
  assert.match(signupHandlePresentation(f.controller.getSnapshot(), "first").message, /Too many checks/);
  assert.notEqual(signupHandlePresentation(f.controller.getSnapshot(), "first").tone, "good");
  f.controller.retry(); f.calls[2].reject(new Error("offline")); await settle();
  assert.match(signupHandlePresentation(f.controller.getSnapshot(), "first").message, /Couldn.t check/);
});

test("mismatched and malformed server responses fail closed", async () => {
  for (const payload of [{ handle: "other", available: true }, { handle: "valid", available: "true" }, {}]) {
    const f = fixture(); f.controller.setHandle("valid"); f.flush();
    f.calls[0].resolve(payload); await settle();
    assert.equal(f.controller.getSnapshot().status, "error");
    assert.equal(f.controller.getSnapshot().data, null);
  }
});

test("unmount cancels both timers and requests and strict lifecycle replay starts fresh", async () => {
  const f = fixture(); f.controller.setHandle("first"); f.controller.dispose(); f.flush();
  assert.equal(f.calls.length, 0);
  f.controller.resume(); f.controller.setHandle("second"); f.flush(); f.controller.dispose();
  assert.equal(f.calls[0].signal.aborted, true);
  f.calls[0].resolve({ handle: "second", available: true }); await settle();
  assert.equal(f.controller.getSnapshot().data, null);
  f.controller.resume(); f.controller.setHandle("third"); f.flush();
  f.calls[1].resolve({ handle: "third", available: false }); await settle();
  assert.equal(f.controller.getSnapshot().data.handle, "third");
});

test("render-time presentation refuses availability for a previous input", () => {
  const old = { scope: "first", status: "ready", data: { handle: "first", available: true } };
  assert.notEqual(signupHandlePresentation(old, "second").tone, "good");
  assert.notEqual(signupHandlePresentation(old, "a").tone, "good");
  const invalid = { scope: "first", status: "error", error: { status: 400, message: "Choose another username." } };
  assert.deepEqual(signupHandlePresentation(invalid, "first"), { tone: "error", message: "Choose another username." });
});

test("account validation uses existing input rules and only blocks an exact taken handle", () => {
  assert.equal(signupAccountError(account), null);
  for (const [field, value] of [["name", ""], ["handle", "a"], ["email", "not-email"], ["password", "letters-only"]]) {
    assert.equal(signupAccountError({ ...account, [field]: value }).field, field);
  }
  assert.equal(signupAccountError(account, { handle: "alex_live", available: false }).field, "handle");
  assert.equal(signupAccountError(account, { handle: "different", available: false }), null);
});

test("music step requires one to three genres, a coarse age band and terms", () => {
  const music = { genres: ["Jazz"], ageBand: "18_plus", agreed: true };
  assert.equal(signupMusicError(music), null);
  assert.equal(signupMusicError({ ...music, genres: [] }).field, "genres");
  assert.equal(signupMusicError({ ...music, genres: ["Jazz", "Rock", "Pop", "Electronic"] }).field, "genres");
  assert.equal(signupMusicError({ ...music, ageBand: null }).field, "ageBand");
  assert.equal(signupMusicError({ ...music, agreed: false }).field, "agreed");
});

test("payload keeps chosen handle, optional location and analytics off without birthdate or media", () => {
  const values = { ...account, name: " Alex ", handle: "ALEX_LIVE", email: "Alex@Example.COM", genres: ["Jazz"], ageBand: "13_17", agreed: true };
  const payload = signupFormPayload(values);
  assert.equal(payload.handle, "alex_live"); assert.equal(payload.email, "alex@example.com");
  assert.equal(payload.analyticsConsent, false); assert.equal(payload.location, null);
  assert.equal(payload.ageBand, "13_17"); assert.equal(payload.agreedToTerms, true);
  assert.equal(Object.hasOwn(payload, "birthDate"), false); assert.equal(Object.hasOwn(payload, "avatarUri"), false);
  const city = { city: "Toronto", state: "Ontario", country: "Canada" };
  assert.deepEqual(signupFormPayload({ ...values, city, analyticsConsent: true }).location, city);
  assert.equal(signupFormPayload({ ...values, analyticsConsent: true }).analyticsConsent, true);
  assert.throws(() => signupFormPayload({ ...values, agreed: false }));
});

test("web accessibility explicitly carries unchecked, checked, expanded, busy and progress state", () => {
  const state = { checked: false, disabled: false, busy: true, expanded: false };
  const progress = { min: 1, max: 2, now: 1, text: "Step 1 of 2: Account" };
  assert.deepEqual(signupAriaProps("ios", state, progress), {});
  assert.deepEqual(signupAriaProps("android", state, progress), {});
  assert.deepEqual(signupAriaProps("web", state, progress), {
    "aria-checked": false, "aria-disabled": false, "aria-busy": true, "aria-expanded": false,
    "aria-valuemin": 1, "aria-valuemax": 2, "aria-valuenow": 1, "aria-valuetext": "Step 1 of 2: Account",
  });
});

test("actual React Native Web emits explicit selection states and progress values", () => {
  const require = createRequire(import.meta.url);
  const React = require("react"), RN = require("react-native-web"), DOM = require("react-dom/server");
  for (const role of ["checkbox", "radio"]) for (const checked of [false, true]) for (const disabled of [false, true]) {
    const state = { checked, disabled };
    const html = DOM.renderToStaticMarkup(React.createElement(RN.Pressable, {
      accessibilityRole: role, accessibilityLabel: "Choice", accessibilityState: state, disabled,
      ...signupAriaProps("web", state),
    }, React.createElement(RN.Text, null, "Choice")));
    assert.match(html, new RegExp('aria-checked="' + checked + '"'));
    if (disabled) assert.match(html, /aria-disabled="true"/);
    else assert.doesNotMatch(html, /aria-disabled="true"/);
  }
  const progress = { min: 1, max: 2, now: 2, text: "Step 2 of 2: Music" };
  const html = DOM.renderToStaticMarkup(React.createElement(RN.View, {
    accessibilityRole: "progressbar", accessibilityValue: progress, ...signupAriaProps("web", {}, progress),
  }));
  assert.match(html, /aria-valuenow="2"/); assert.match(html, /aria-valuemin="1"/);
  assert.match(html, /aria-valuemax="2"/); assert.match(html, /aria-valuetext="Step 2 of 2: Music"/);
});

test("every Auth pressable uses the explicit web adapter without removing native accessibility state", () => {
  const source = readFileSync(new URL("../../screens/AuthScreen.jsx", import.meta.url), "utf8");
  assert.equal((source.match(/<Pressable\b/g) || []).length, 1, "only the shared adapter renders the native primitive");
  assert.match(source, /<Pressable[^\n]*accessibilityState=\{state\}[^\n]*signupAriaProps\(Platform\.OS, state\)/);
  for (const state of ["checked: selected", "checked: ageBand === value", "checked: agreed", "checked: analyticsConsent", "expanded: analyticsDetails", "busy: loading"]) assert.ok(source.includes(state));
  assert.match(source, /accessibilityValue=\{progress\}[^\n]*signupAriaProps\(Platform\.OS, \{\}, progress\)/);
  assert.ok(source.includes("They do not include the contents of authored posts or reviews, search terms, messages, or uploaded media."));
  assert.ok(source.includes("IP addresses are not stored with these analytics events."));
  assert.ok(source.includes("opting out deletes your raw product events."));
});
