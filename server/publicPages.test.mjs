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

function structuredGraph(html) {
  const match = html.match(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  assert.ok(match, "the page must include structured data");
  return JSON.parse(match[1])["@graph"];
}

test("public trust and App Store URLs resolve without accepting near misses", () => {
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
    assert.match(html, /<link rel="icon" href="\/logo\.svg" type="image\/svg\+xml"/);
    assert.match(html, /<main id="content">[\s\S]*<h1>/);
    assert.match(html, /<nav aria-label="Public information">/);
    const scripts = [...html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
    assert.equal(scripts.length, 1, "the only script is inert structured data");
    assert.doesNotMatch(html.replace(scripts[0][0], ""), /<script\b/i, "public documents must not run JavaScript");
    assert.doesNotThrow(() => JSON.parse(scripts[0][1]));
    assert.ok(!/\{\{[^}]+\}\}|__PLACEHOLDER__/i.test(html), "public documents must not expose unfinished placeholders");
    assert.ok(!/[^\x00-\x7f]/.test(html), "public documents stay ASCII-safe across deployment encodings");
    assert.ok(!/[\u00c2\u00c3\ufffd]|â(?:€|™)/.test(html), "public documents must not contain mojibake markers");
  }
});

test("staging trust pages contain one non-conflicting noindex directive", () => {
  const staging = renderPublicPage("/about", {
    PUBLIC_ORIGIN: "https://staging.example.test",
    PIT_ENV: "staging",
  });
  const robots = [...staging.matchAll(/<meta\s+name="robots"\s+content="([^"]+)"\s*\/>/gi)];
  assert.equal(robots.length, 1);
  assert.equal(robots[0][1], "noindex,nofollow");
  assert.doesNotMatch(staging, /content="index,follow/);

  const production = renderPublicPage("/about", { PIT_ENV: "production" });
  assert.match(production, /<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1"/);
});

test("trust-page metadata is canonical, brand-consistent, and does not invent policy dates", () => {
  const origin = { PUBLIC_ORIGIN: "https://example.test/untrusted-path?ignored=1" };
  const about = renderPublicPage("/about", origin);
  const aboutGraph = structuredGraph(about);
  const organization = aboutGraph.find((node) => node["@type"] === "Organization");
  const aboutPage = aboutGraph.find((node) => node["@type"] === "AboutPage");
  const breadcrumbs = aboutGraph.find((node) => node["@type"] === "BreadcrumbList");

  assert.match(about, /<title>About Mshpit<\/title>/);
  assert.doesNotMatch(about, /About Mshpit \| Mshpit/);
  assert.match(about, /<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1"/);
  assert.match(about, /<link rel="canonical" href="https:\/\/example\.test\/about"/);
  assert.equal(organization.name, "Mshpit");
  assert.equal(organization.alternateName, "PIT");
  assert.equal(organization.logo.url, "https://example.test/logo.svg");
  assert.equal(organization.contactPoint.email, SUPPORT_EMAIL);
  assert.equal(aboutPage.url, "https://example.test/about");
  assert.equal(aboutPage.publisher["@id"], "https://example.test/#organization");
  assert.deepEqual(breadcrumbs.itemListElement.map((item) => item.item), [
    "https://example.test/",
    "https://example.test/about",
  ]);

  const privacyPage = structuredGraph(renderPublicPage("/privacy"))
    .find((node) => node["@id"].endsWith("#page"));
  assert.equal(privacyPage.dateModified, "2026-08-27", "an exact published policy day is safe to expose");

  for (const path of ["/community-guidelines", "/ratings-methodology", "/terms"]) {
    const html = renderPublicPage(path);
    const page = structuredGraph(html).find((node) => node["@id"].endsWith("#page"));
    assert.match(html, /Last updated August 2026/);
    assert.equal(Object.hasOwn(page, "dateModified"), false,
      `${path} must not turn a month-only display label into a fabricated first day`);
    assert.doesNotMatch(html, /"dateModified":"2026-08-01"/);
  }
});

test("privacy and terms mirror the dated in-app policies and expose support", () => {
  const privacy = renderPublicPage("/privacy");
  assert.match(privacy, /Last updated August 27, 2026/);
  assert.match(privacy, /rolling 30-day period/);
  assert.match(privacy, /product analytics enabled/);
  assert.match(privacy, /daily aggregate counters/);
  assert.match(privacy, /cannot identify a unique visitor/);
  assert.match(privacy, /suggestion box accepts an anonymous category/);
  assert.match(privacy, /Aggregate guest-search counters are retained for up to 90 days/);
  assert.match(privacy, /YouTube links shared in posts/);
  assert.match(privacy, /YouTube(?:'|&#39;)s oEmbed service/);
  assert.match(privacy, /Music catalogue metadata/);
  assert.match(privacy, /Deezer privacy policy/);
  assert.doesNotMatch(privacy, /embedded YouTube player|preview audio|playback milestones|listening history/i);
  assert.match(privacy, /durably queued for active object-storage deletion/);
  assert.match(privacy, /keep your personal member profile out of search-engine results/);
  assert.match(privacy, /does not make public posts private/);
  assert.match(privacy, new RegExp(`mailto:${SUPPORT_EMAIL.replace(".", "\\.")}`));

  const terms = renderPublicPage("/terms");
  assert.match(terms, /Last updated August 2026/);
  assert.match(terms, /Your content and licence/);
  assert.match(terms, /Moderation and enforcement/);
  assert.match(terms, /YouTube Terms of Service/);
  assert.match(terms, /Deezer developer terms/);
  assert.match(terms, /YouTube links in posts/);
  assert.match(terms, /Music catalogue metadata/);
  assert.doesNotMatch(terms, /YouTube playback|preview recordings|full recordings/i);
  assert.match(terms, /may in the future display advertising/);
  assert.doesNotMatch(terms, /is free and supported by advertising/);
  assert.doesNotMatch(terms, /building interest profiles and targeting/);
});

test("in-app legal copy matches the public provider disclosure and support route", async () => {
  const [privacySource, termsSource] = await Promise.all([
    readFile(new URL("../src/screens/PrivacyScreen.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/screens/TermsScreen.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(privacySource, /YouTube links shared in posts/);
  assert.match(privacySource, /Music catalogue metadata/);
  assert.match(privacySource, /Deezer Privacy Policy/);
  assert.doesNotMatch(privacySource, /embedded YouTube player|preview audio|playback milestones/i);
  assert.match(privacySource, /durably queued for active object-storage deletion/);
  assert.match(privacySource, /PROFILE_SEARCH_INDEXING_DISCLOSURE/);
  assert.match(termsSource, /updated="August 2026"/);
  assert.match(termsSource, /YouTube links in posts/);
  assert.match(termsSource, /Music catalogue metadata/);
  assert.match(termsSource, /Deezer Developer Terms/);
  assert.doesNotMatch(termsSource, /YouTube playback|preview recordings|full recordings/i);
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
  assert.match(deletion, /durably queues Mshpit-owned uploaded photos and clips/i);
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
  assert.match(source, /import \{ publicPageFor, renderPublicPage \} from "\.\/publicPages\.js"/);
  const publicRoute = source.indexOf("if (servePublicPage(req, res, pathname)) return;");
  const staticAssets = source.indexOf("if (serveStatic(req, res, pathname)) return;", publicRoute);
  const publicAppRouter = source.indexOf("return serveSeoRoute(req, res, pathname, { hasQueryString });", publicRoute);
  assert.ok(publicRoute > 0, "the public-document route must be wired into the server");
  assert.ok(staticAssets > publicRoute, "legal documents must be answered before static assets");
  assert.ok(publicAppRouter > staticAssets, "only non-document, non-asset paths may reach the public app router");
});

test("public SEO responses are cacheable, canonical, and fail closed during projection outages", async () => {
  const source = await readFile(new URL("./index.js", import.meta.url), "utf8");
  assert.match(source, /function serveCrawlerFile[\s\S]*?req\.method !== "GET" && req\.method !== "HEAD"[\s\S]*?Allow: "GET, HEAD"/);
  assert.match(source, /if \(pathname !== page\.path\)[\s\S]*?res\.writeHead\(301,[\s\S]*?Location: page\.path/,
    "case and trailing-slash variants permanently redirect to one trust-page URL");
  assert.match(source, /public, max-age=0, s-maxage=60, must-revalidate/);
  assert.match(source, /"X-Robots-Tag": htmlRobotsDirective\(\{ indexable: publicDocument \}\)/,
    "the HTTP header must share the tested environment-aware indexing policy");
  assert.match(source, /Link: `<\$\{plan\.document\.canonicalUrl\}>; rel="canonical"`/);
  assert.match(source, /function servePublicPage[\s\S]*?"X-Robots-Tag": htmlRobotsDirective\(\{ indexable: true \}\)/,
    "standalone trust pages use the shared production/staging header policy");
  assert.match(source, /function serveWebShell[\s\S]*?"X-Robots-Tag": htmlRobotsDirective\(\{ indexable: publicDocument \}\)/,
    "public entity and app shells choose indexing through the shared policy");
  assert.match(source, /if \(!isProduction\(\)\) html = enforceHtmlRobotsMeta\(html\);[\s\S]*?"X-Robots-Tag": htmlRobotsDirective\(\)/,
    "static staging HTML keeps both metadata and response headers fail-closed");
  assert.match(source, /if \(plan\.type === "unavailable"\)[\s\S]*?status: 503,[\s\S]*?cacheControl: "no-store",[\s\S]*?retryAfter: 300/);
  assert.match(source, /"Retry-After": String\(retryAfter\)/);
  assert.match(source, /const responsePlan = hasQueryString \? \{ \.\.\.plan, indexable: false \} : plan/);
  assert.match(source, /serveSeoRoute\(req, res, pathname, \{ hasQueryString \}\)/,
    "query/filter duplicates render their clean canonical document with noindex metadata and header");
  assert.match(source, /function sendCrawlerText\(req, res, status, body, extra = \{\}\)[\s\S]*?if \(req\.method === "HEAD"\) return res\.end\(\)/,
    "crawler error responses answer HEAD with headers and no response body");
  assert.match(source, /scheduleSitemapRetry\(result\.retryAt\)/,
    "the scheduler retries at the manager's actual backoff time");
  assert.match(source, /const sitemapRefreshStop = drainSitemapSnapshotRefresh\(\)[\s\S]*?await sitemapRefreshStop/,
    "graceful shutdown drains the active sitemap refresh before closing the database");
});

test("trust pages explain the product, conduct, ratings, and monitored contact route", () => {
  assert.match(renderPublicPage("/about"), /live-music social network/i);
  assert.match(renderPublicPage("/about"), /independent fan community/i);
  assert.match(renderPublicPage("/contact"), new RegExp(SUPPORT_EMAIL.replace(".", "\\.")));
  assert.match(renderPublicPage("/community-guidelines"), /Review shows honestly/);
  assert.match(renderPublicPage("/community-guidelines"), /No spam or artificial reach/);
  assert.match(renderPublicPage("/ratings-methodology"), /arithmetic mean/);
  assert.match(renderPublicPage("/ratings-methodology"), /rating count/);
});

test("crawler files have a dedicated per-IP flood guard before sitemap work", async () => {
  const source = await readFile(new URL("./index.js", import.meta.url), "utf8");
  assert.match(
    source,
    /import \{ crawlerFileRateLimitPolicy \} from "\.\/crawlerFileRateLimit\.js"/,
  );
  const policy = source.indexOf("crawlerFileRateLimitPolicy(clientIp(req))");
  const serve = source.indexOf("return serveCrawlerFile(req, res, pathname);", policy);
  assert.ok(policy > 0, "crawler files must use the trusted client-IP resolver");
  assert.ok(serve > policy, "the flood guard must run before sitemap materialization");
  assert.match(source.slice(policy, serve), /rateLimit\(crawlerLimit\.key, crawlerLimit\.max, crawlerLimit\.windowMs\)/);
  assert.match(source.slice(policy, serve), /"Retry-After"/);
});
