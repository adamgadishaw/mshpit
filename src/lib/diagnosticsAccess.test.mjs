import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
const settings = readFileSync(new URL("../screens/SettingsScreen.jsx", import.meta.url), "utf8");
const feedback = readFileSync(new URL("../components/FeedbackHost.jsx", import.meta.url), "utf8");
const store = readFileSync(new URL("../store.js", import.meta.url), "utf8");

test("full diagnostic history is available only to moderator and admin role state", () => {
  assert.match(
    store,
    /export const isMod = \(role\) => role === "admin" \|\| role === "moderator";/,
    "the authoritative session helper denies guest, fan, and artist roles",
  );
  assert.match(app, /const canViewDiagnostics = isMod\(session\?\.role\);/);
  assert.match(
    settings,
    /isMod\(session\?\.role\) && <Row icon="discover" label="Diagnostics"/,
    "fan, artist, and guest Settings never render the full history entry",
  );
  assert.match(
    app,
    /else if \(nav\.diagnostics && canViewDiagnostics\) overlay = <DiagnosticsScreen/,
    "the renderer independently fails closed even if navigation state is forced",
  );
  assert.doesNotMatch(app, /else if \(nav\.diagnostics\) overlay = <DiagnosticsScreen/);
});

test("persisted diagnostic navigation is discarded before session restoration", () => {
  const restoreStart = app.indexOf('const saved = load("pit.stack", null);');
  const restoreEnd = app.indexOf("const nav = stack[stack.length - 1];", restoreStart);
  const restore = app.slice(restoreStart, restoreEnd);
  assert.match(restore, /if \(top\?\.diagnostics\) return \[\{\}\];/);
  assert.ok(
    restore.indexOf("if (top?.diagnostics)") < restore.lastIndexOf("return top &&"),
    "a forced saved route is rejected before it can become the active overlay",
  );
});

test("ordinary failure feedback exposes one support reference without history navigation", () => {
  assert.match(feedback, /canViewDiagnostics \? \(/);
  assert.match(feedback, /Support reference/);
  assert.match(feedback, /supportReferenceFor\(entry\)/);
  assert.match(app, /<FeedbackHost canViewDiagnostics=\{canViewDiagnostics\}/);
  assert.match(
    app,
    /onOpenDiagnostics=\{\(\) => \{ if \(canViewDiagnostics\) go\(\{ diagnostics: true \}\); \}\}/,
  );
});
