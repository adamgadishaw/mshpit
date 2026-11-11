import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { canAccessTheme, THEME_KEYS, PRIMARY_THEME_KEYS, resolveAccountTheme } from "./themeAccess.mjs";
import { visibleThemeChoices } from "./themeChoices.mjs";
import { prepareThemeStartup, readStartupTheme } from "../lib/themeStartup.mjs";

test("only the existing admin/Pit Team role grants additional themes", () => {
  for (const role of [undefined, "fan", "artist", "editor", "moderator", "admin", "staff", "founder"]) {
    const account = { id: "a", role, verified: true, sponsor: true, badges: ["staff", "founder"] };
    for (const key of THEME_KEYS) assert.equal(canAccessTheme(key, account), role === "admin" || PRIMARY_THEME_KEYS.includes(key));
    const allowed = visibleThemeChoices(THEME_KEYS.map(key => ({ key })), { expanded: true, selectedKey: "forest", account });
    assert.deepEqual(allowed.map(t => t.key), role === "admin" ? THEME_KEYS : PRIMARY_THEME_KEYS);
  }
  assert.equal(canAccessTheme("neon", { role: "admin" }), false);
  for (const key of ["__proto__", "constructor", "unknown", null]) assert.equal(canAccessTheme(key, { id: "a", role: "admin" }), false);
  const theme = readFileSync(new URL("../theme.js", import.meta.url), "utf8");
  assert.deepEqual([...theme.matchAll(/^  (\w+): \{ name:/gm)].map(m => m[1]).sort(), [...THEME_KEYS].sort());
});

test("same-owner allowed choices survive; a stale restricted choice falls back to the account's public choice", () => {
  const local = { theme: "forest", ownerId: "a" };
  assert.equal(resolveAccountTheme({ id: "a", role: "admin", theme: "daylight" }, local), "forest");
  assert.equal(resolveAccountTheme({ id: "a", role: "fan", theme: "daylight" }, local), "daylight");
  assert.equal(resolveAccountTheme({ id: "b", role: "admin", theme: "daylight" }, local), "daylight");
  assert.equal(resolveAccountTheme(null, local), "stage");
  assert.deepEqual(local, { theme: "forest", ownerId: "a" });
});

test("startup uses fresh authority, never a cached role, and leaves stored preferences untouched", async () => {
  const selection = { theme: "forest", ownerId: "a", role: "admin" };
  for (const account of [null, { id: "a", role: "fan" }, { id: "a", role: "moderator" }, { id: "b", role: "admin", theme: "daylight" }, { id: "a", role: "admin" }]) {
    await prepareThemeStartup({ readSelection: () => selection, fetchAccount: async () => account, signedOut: () => false });
    assert.equal(readStartupTheme(), account?.id === "a" && account.role === "admin" ? "forest" : account?.theme || "stage");
  }
  await prepareThemeStartup({ readSelection: () => selection, fetchAccount: async () => { throw Error("offline"); }, signedOut: () => false });
  assert.equal(readStartupTheme(), "stage");
  assert.equal(selection.theme, "forest");
  for (const theme of PRIMARY_THEME_KEYS) {
    await prepareThemeStartup({ readSelection: () => ({ theme, ownerId: "a" }), fetchAccount: () => assert.fail("public choices need no additional startup request"), signedOut: () => false });
    assert.equal(readStartupTheme(), theme);
  }
});

test("logout before or during a startup request cannot revive team access", async () => {
  let blocked = true;
  const readSelection = () => ({ theme: "forest", ownerId: "a" });
  await prepareThemeStartup({ readSelection, signedOut: () => blocked, fetchAccount: () => assert.fail("signed out") });
  assert.equal(readStartupTheme(), "stage");
  blocked = false;
  let resolve;
  const pending = prepareThemeStartup({ readSelection, signedOut: () => blocked, fetchAccount: () => new Promise(r => { resolve = r; }) });
  assert.equal(readStartupTheme(), "stage", "pending authority cannot paint a restricted theme");
  blocked = true; resolve({ id: "a", role: "admin" }); await pending;
  assert.equal(readStartupTheme(), "stage");
});
