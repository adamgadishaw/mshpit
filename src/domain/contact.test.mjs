import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { APPEALS_EMAIL, SUPPORT_EMAIL, SUPPORT_URL } from "./contact.mjs";

test("public support and appeals stay on the official monitored domain", () => {
  assert.equal(SUPPORT_EMAIL, "support@mshpit.com");
  assert.equal(APPEALS_EMAIL, SUPPORT_EMAIL);
  assert.equal(SUPPORT_URL, "https://www.mshpit.com/support");
});

test("account and settings surfaces consume the shared contact policy", async () => {
  const [gate, settings, publicPages] = await Promise.all([
    readFile(new URL("../screens/AccountGate.jsx", import.meta.url), "utf8"),
    readFile(new URL("../screens/SettingsScreen.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../server/publicPages.js", import.meta.url), "utf8"),
  ]);
  assert.match(gate, /APPEALS_EMAIL/);
  assert.doesNotMatch(gate, /@pit\.app/);
  assert.match(settings, /SUPPORT_EMAIL, SUPPORT_URL/);
  assert.match(publicPages, /domain\/contact\.mjs/);
});
