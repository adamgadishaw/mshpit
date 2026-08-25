import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PUBLIC_PAGE_PATHS,
  SUPPORT_EMAIL,
  publicPageFor,
  publicPageSitemapEntries,
  renderPublicPage,
} from "./publicPages.js";

test("the four App Store public URLs resolve without accepting near misses", () => {
  for (const path of PUBLIC_PAGE_PATHS) {
    assert.equal(publicPageFor(path)?.path, path);
    assert.equal(publicPageFor(`${path}/`)?.path, path, "a trailing slash should keep the canonical document");
    assert.equal(publicPageFor(path.toUpperCase())?.path, path, "public document routes should be case tolerant");
  }

  for (const path of ["/", "/privacy-notice", "/support/ticket", "/account/delete", "/show/privacy"]) {
    assert.equal(publicPageFor(path), null, `${path} must remain on the normal SPA/static path`);
  }
});

test("public documents are complete standalone HTML with canonical metadata", () => {
  for (const path of PUBLIC_PAGE_PATHS) {
    const html = renderPublicPage(path, { PUBLIC_ORIGIN: "https://example.test/" });
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<meta name="viewport"/);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://example\\.test${path}"`));
    assert.match(html, /<main id="content">[\s\S]*<h1>/);
    assert.match(html, /<nav aria-label="Public information">/);
    assert.ok(!/<script\b/i.test(html), "public documents must not require JavaScript");
    assert.ok(!/\{\{[^}]+\}\}|__PLACEHOLDER__/i.test(html), "public documents must not expose unfinished placeholders");
    assert.ok(!/[^\x00-\x7f]/.test(html), "public documents stay ASCII-safe across deployment encodings");
    assert.ok(!/[\u00c2\u00c3\ufffd]|â(?:€|™)/.test(html), "public documents must not contain mojibake markers");
  }
});

test("privacy and terms mirror the dated in-app policies and expose support", () => {
  const privacy = renderPublicPage("/privacy");
  assert.match(privacy, /Last updated August 25, 2026/);
  assert.match(privacy, /rolling 30-day period/);
  assert.match(privacy, /product analytics enabled/);
  assert.match(privacy, /daily aggregate counters/);
  assert.match(privacy, /cannot identify a unique visitor/);
  assert.match(privacy, /suggestion box accepts an anonymous category/);
  assert.match(privacy, /Aggregate guest-search counters are retained for up to 90 days/);
  assert.match(privacy, /YouTube API Services/);
  assert.match(privacy, /Music catalogue and preview audio/);
  assert.match(privacy, /Deezer privacy policy/);
  assert.match(privacy, /durably queued for active object-storage deletion/);
  assert.match(privacy, new RegExp(`mailto:${SUPPORT_EMAIL.replace(".", "\\.")}`));

  const terms = renderPublicPage("/terms");
  assert.match(terms, /Last updated August 2026/);
  assert.match(terms, /Your content and licence/);
  assert.match(terms, /Moderation and enforcement/);
  assert.match(terms, /YouTube Terms of Service/);
  assert.match(terms, /Deezer developer terms/);
  assert.match(terms, /may in the future display advertising/);
  assert.doesNotMatch(terms, /is free and supported by advertising/);
  assert.doesNotMatch(terms, /building interest profiles and targeting/);
});

test("in-app legal copy matches the public provider disclosure and support route", async () => {
  const [privacySource, termsSource] = await Promise.all([
    readFile(new URL("../src/screens/PrivacyScreen.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/screens/TermsScreen.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(privacySource, /Music catalogue & preview audio/);
  assert.match(privacySource, /Deezer Privacy Policy/);
  assert.match(privacySource, /durably queued for active object-storage deletion/);
  assert.match(termsSource, /updated="August 2026"/);
  assert.match(termsSource, /Music catalogue & preview audio/);
  assert.match(termsSource, /Deezer Developer Terms/);
  assert.match(termsSource, /Open Support from Settings/);
  assert.doesNotMatch(termsSource, /from your profile/);
});

test("support and deletion pages provide actionable no-login information without requesting credentials", () => {
  const support = renderPublicPage("/support");
  assert.match(support, new RegExp(SUPPORT_EMAIL.replace(".", "\\.")));
  assert.match(support, /Forgot password/);
  assert.match(support, /Never send your password/);
  assert.match(support, /Account deletion instructions/);

  const deletion = renderPublicPage("/account-deletion");
  assert.match(deletion, /Settings/);
  assert.match(deletion, /Delete account permanently/);
  assert.match(deletion, /There is no recovery period/);
  assert.match(deletion, /If you cannot sign in/);
  assert.match(deletion, /durably queues Pit-owned uploaded photos and clips/i);
  assert.match(deletion, /Cleanup retries automatically but may not finish immediately/i);
  assert.match(deletion, /backups can remain until their retention period ends/i);
  assert.doesNotMatch(deletion, /detached from your account immediately/);
  assert.ok(!/<form\b/i.test(deletion), "the public page must never collect account credentials");
});

test("every public document is represented once in the sitemap source", () => {
  const entries = publicPageSitemapEntries();
  assert.deepEqual(entries.map((entry) => entry.path), PUBLIC_PAGE_PATHS);
  assert.equal(new Set(entries.map((entry) => entry.path)).size, PUBLIC_PAGE_PATHS.length);
  for (const entry of entries) {
    assert.match(entry.priority, /^0\.[0-9]$/);
    assert.equal(entry.changefreq, "monthly");
  }
});

test("the HTTP server answers public documents before the SPA fallback", async () => {
  const source = await readFile(new URL("./index.js", import.meta.url), "utf8");
  assert.match(source, /import \{ renderPublicPage \} from "\.\/publicPages\.js"/);
  const publicRoute = source.indexOf("if (servePublicPage(req, res, pathname)) return;");
  const staticAssets = source.indexOf("if (serveStatic(req, res, pathname)) return;", publicRoute);
  const publicAppRouter = source.indexOf("return serveSeoRoute(req, res, pathname);", publicRoute);
  assert.ok(publicRoute > 0, "the public-document route must be wired into the server");
  assert.ok(staticAssets > publicRoute, "legal documents must be answered before static assets");
  assert.ok(publicAppRouter > staticAssets, "only non-document, non-asset paths may reach the public app router");
});
