import assert from "node:assert/strict";
import test from "node:test";
import { applyPageHead, createPageHeadController, parsePageHead, readPageHead } from "./pageHeadController.mjs";

// A tiny DOM double keeps policy/cancellation tests independent of a browser.
// Browser smoke coverage also exercises the real DOMParser and live head.
function fakeDocument(entries = [], fixtureHeads = new Map()) {
  const document = {};
  const nodes = [];
  const makeNode = (tag, attributes = {}, text = "") => ({
    tag, attributes: { ...attributes }, textContent: text,
    getAttribute(name) { return this.attributes[name] ?? null; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    remove() { const index = nodes.indexOf(this); if (index >= 0) nodes.splice(index, 1); },
  });
  const matches = (node, selector) => {
    const [, tag, attribute, value] = selector.match(/^([\w-]+)(?:\[([^=\]]+)(?:="([^"]*)")?\])?$/) || [];
    return node.tag === tag && (!attribute || (value === undefined ? node.getAttribute(attribute) != null : node.getAttribute(attribute) === value));
  };
  document.head = {
    querySelectorAll(selector) { return nodes.filter((node) => selector.split(",").some((part) => matches(node, part))); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    appendChild(node) { nodes.push(node); },
  };
  document.createElement = (tag) => makeNode(tag);
  for (const entry of entries) nodes.push(makeNode(...entry));
  document.defaultView = { DOMParser: class {
    parseFromString(html) {
      for (const [key, value] of fixtureHeads) if (html.includes(key)) return fakeDocument(value);
      return fakeDocument([]);
    }
  } };
  document.nodes = nodes;
  return document;
}

const origin = "https://www.mshpit.com";
const head = (title, path, robots = "index,follow") => [
  ["title", {}, title], ["meta", { name: "robots", content: robots }],
  ["meta", { name: "description", content: `${title} description` }],
  ["meta", { property: "og:url", content: origin + path }],
  ["link", { rel: "canonical", href: origin + path }],
  ["script", { type: "application/ld+json" }, JSON.stringify({ "@type": "MusicEvent", name: title })],
];
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const titleOf = (document) => document.head.querySelector("title")?.textContent;
const robotsOf = (document) => document.head.querySelector('meta[name="robots"]')?.getAttribute("content");

test("head parsing retains only inert allowlisted data and same-origin canonical URLs", () => {
  const document = fakeDocument([
    ...head("Public concert", "/event/1"),
    ["script", {}, "window.pwned = true"],
    ["meta", { "http-equiv": "refresh", content: "0;url=https://evil.example" }],
    ["meta", { name: "not-allowed", content: "secret" }],
    ["meta", { property: "og:url", content: "https://evil.example/" }],
    ["script", { type: "application/ld+json" }, "bad-json"],
    ["script", { type: "application/ld+json" }, "null"],
  ]);
  const result = readPageHead(document, origin);
  assert.equal(result.title, "Public concert");
  assert.equal(result.canonical, origin + "/event/1");
  assert.equal(result.meta.some((meta) => meta.content?.includes("evil.example")), false);
  assert.equal(result.meta.some((meta) => meta.name === "not-allowed"), false);
  assert.equal(result.jsonLd.length, 1);
  const foreignCanonical = fakeDocument([["title", {}, "Foreign"], ["meta", { name: "robots", content: "index,follow" }], ["link", { rel: "canonical", href: "https://evil.example/" }]]);
  assert.equal(readPageHead(foreignCanonical, origin).canonical, null);
  foreignCanonical.head.querySelector('link[rel="canonical"]').remove();
  assert.equal(readPageHead(foreignCanonical, origin).canonical, null, "absent canonical must not be invented as home");
});

test("noindex metadata drops any inherited canonical and oversized input never reaches the parser", () => {
  assert.equal(readPageHead(fakeDocument(head("Private", "/you", "noindex,follow")), origin).canonical, null);
  class NoParser { constructor() { throw new Error("must not parse"); } }
  assert.equal(parsePageHead("a".repeat(128_001), { origin, DOMParser: NoParser }), null);
  assert.equal(readPageHead(fakeDocument([["title", {}, "Unverified"]]), origin), null);
});

test("tracking-only navigation reuses clean public identity and never sends click IDs to the server", async () => {
  const document = fakeDocument(head("Home", "/"), new Map([["PUBLIC_HEAD", head("Artist", "/artist/one")]]));
  const calls = [];
  const location = { origin, pathname: "/", search: "?utm_source=google" };
  const controller = createPageHeadController({ document, location, apiCall: async (url) => {
    calls.push(url);
    return { path: "/artist/one", head: "PUBLIC_HEAD" };
  } });
  assert.equal(await controller.sync("/?utm_source=google"), true);
  assert.equal(calls.length, 0);
  assert.equal(await controller.sync("/artist/one?gclid=private-click-id&utm_campaign=tour"), true);
  assert.deepEqual(calls, ["/api/page-head?path=%2Fartist%2Fone"]);
  assert.equal(document.head.querySelector('link[rel="canonical"]').getAttribute("href"), origin + "/artist/one");
  assert.doesNotMatch(JSON.stringify(document.nodes), /private-click-id|utm_campaign/);
  assert.equal(await controller.sync("/artist/one?utm_source=new-campaign"), true);
  assert.equal(calls.length, 1, "all tracking variants share one clean metadata cache key");
  assert.equal(location.search, "?utm_source=google", "metadata does not rewrite attribution in the address bar");
});

test("tracking does not make private/thin pages or mixed functional queries indexable", async () => {
  const document = fakeDocument(head("Home", "/"), new Map([["THIN_HEAD", head("Thin artist", "/artist/thin", "noindex,follow")], ["SEARCH_HEAD", head("Search", "/search", "noindex,follow")]]));
  let calls = 0;
  const controller = createPageHeadController({ document, location: { origin, pathname: "/" }, apiCall: async (url) => {
    calls += 1; const path = new URL(url, origin).searchParams.get("path");
    return { path, head: path === "/search" ? "SEARCH_HEAD" : "THIN_HEAD" };
  } });
  assert.equal(await controller.sync("/artist/thin?gclid=x"), true);
  assert.match(robotsOf(document), /noindex/);
  for (const path of ["/login?gclid=x", "/search?utm_source=google", "/artist/one?gclid=x&token=private-token",
    "/artist/one?utm_source=google&city=Toronto", "/artist/one?utm_unknown=value"]) {
    assert.equal(await controller.sync(path), true);
    assert.match(robotsOf(document), /noindex/);
    assert.equal(document.head.querySelector('link[rel="canonical"]'), null);
    assert.doesNotMatch(JSON.stringify(document.nodes), /private-token|utm_unknown/);
  }
  assert.equal(calls, 2, "only the two clean public projections are requested");
});

test("applying metadata removes the previous identity but preserves unrelated scripts and resources", () => {
  const document = fakeDocument([...head("Old artist", "/artist/old"), ["script", { src: "/bundle.js" }], ["link", { rel: "stylesheet", href: "/app.css" }]]);
  const next = readPageHead(fakeDocument(head("New concert", "/event/new")), origin);
  assert.equal(applyPageHead(document, next), true);
  assert.equal(titleOf(document), "New concert");
  assert.equal(document.head.querySelectorAll("title").length, 1);
  assert.equal(document.head.querySelectorAll('script[type="application/ld+json"]').length, 1);
  assert.ok(document.head.querySelector('script[src="/bundle.js"]'));
  assert.ok(document.head.querySelector('link[rel="stylesheet"]'));
  assert.equal(JSON.stringify(document.nodes).includes("Old artist"), false);
});

test("initial SSR metadata is reused without another request; Intro gets its own metadata and Back uses cache", async () => {
  const fixtures = new Map([["HOME_HEAD", head("Mshpit home", "/")]]);
  const document = fakeDocument(head("Opening event", "/event/one"), fixtures);
  const calls = [];
  const controller = createPageHeadController({ document, location: { origin, pathname: "/event/one" }, apiCall: async (url) => { calls.push(url); return { path: "/", head: "HOME_HEAD" }; } });
  assert.equal(await controller.sync("/event/one"), true);
  assert.equal(calls.length, 0);
  assert.equal(await controller.sync("/"), true);
  assert.equal(titleOf(document), "Mshpit home");
  assert.equal(document.head.querySelector('link[rel="canonical"]').getAttribute("href"), origin + "/");
  assert.equal(await controller.sync("/event/one"), true);
  assert.equal(titleOf(document), "Opening event");
  assert.equal(calls.length, 1);
  controller.dispose();
});

test("private pages immediately drop public JSON-LD/canonical without a request or typed-query disclosure", async () => {
  const document = fakeDocument(head("Public artist", "/artist/one"));
  let calls = 0;
  const controller = createPageHeadController({ document, location: { origin, pathname: "/artist/one" }, apiCall: async () => { calls += 1; } });
  for (const path of ["/feed", "/you", "/login", "/signup", "/settings", "/search?q=private-email%40example.com"]) {
    assert.equal(await controller.sync(path), true);
    assert.match(robotsOf(document), /noindex/);
    assert.equal(document.head.querySelector('link[rel="canonical"]'), null);
    assert.equal(document.head.querySelectorAll('script[type="application/ld+json"]').length, 0);
    assert.equal(JSON.stringify(document.nodes).includes("private-email"), false);
  }
  assert.equal(calls, 0);
});

test("late public responses cannot put old artist metadata back onto login after navigation", async () => {
  const response = deferred();
  const document = fakeDocument(head("Home", "/"), new Map([["ARTIST_HEAD", head("Late artist", "/artist/late")]]));
  let requestSignal;
  const controller = createPageHeadController({ document, location: { origin, pathname: "/" }, apiCall: (url, options) => { requestSignal = options.signal; return response.promise; } });
  const work = controller.sync("/artist/late");
  assert.match(robotsOf(document), /noindex/);
  await controller.sync("/login");
  assert.equal(requestSignal.aborted, true);
  response.resolve({ path: "/artist/late", head: "ARTIST_HEAD" });
  assert.equal(await work, false);
  assert.equal(titleOf(document), "Log in | Mshpit");
});

test("same-path loading and resolved renders share one pending metadata request", async () => {
  const response = deferred();
  const document = fakeDocument(head("Home", "/"), new Map([["ARTIST_HEAD", head("Artist", "/artist/one")]]));
  let calls = 0, signal;
  const controller = createPageHeadController({ document, location: { origin, pathname: "/" }, apiCall: (url, options) => {
    calls += 1; signal = options.signal; return response.promise;
  } });
  const loading = controller.sync("/artist/one");
  const resolved = controller.sync("/artist/one");
  assert.equal(calls, 1);
  assert.equal(signal.aborted, false);
  response.resolve({ path: "/artist/one", head: "ARTIST_HEAD" });
  assert.deepEqual(await Promise.all([loading, resolved]), [true, true]);
  assert.equal(titleOf(document), "Artist");
});

test("failed, mismatched or malformed metadata stays safely noindex without interrupting navigation", async () => {
  for (const response of [null, { path: "/artist/wrong", head: "GOOD" }, { path: "/artist/next", head: "MISSING_ROBOTS" }]) {
    const document = fakeDocument(head("Home", "/"));
    const controller = createPageHeadController({ document, location: { origin, pathname: "/" }, apiCall: async () => response });
    assert.equal(await controller.sync("/artist/next"), false);
    assert.match(robotsOf(document), /noindex/);
    assert.equal(document.head.querySelector('link[rel="canonical"]'), null);
  }
});

test("external paths are refused and disposal aborts pending work", async () => {
  const work = deferred();
  const document = fakeDocument(head("Home", "/"));
  let calls = 0, signal;
  const controller = createPageHeadController({ document, location: { origin, pathname: "/" }, apiCall: (url, options) => { calls += 1; signal = options.signal; return work.promise; } });
  assert.equal(await controller.sync("//evil.example"), false);
  assert.equal(await controller.sync("https://evil.example"), false);
  assert.equal(calls, 0);
  const pending = controller.sync("/artist/next");
  controller.dispose();
  assert.equal(signal.aborted, true);
  work.resolve({ path: "/artist/next", head: "LATE" });
  assert.equal(await pending, false);
  assert.equal(await controller.sync("/"), false);
});

test("bounded navigation cache expires and evicts oldest pages", async () => {
  let at = 100, calls = 0;
  const fixtures = new Map([1, 2, 3].map((n) => [`HEAD_${n}`, head(`Artist ${n}`, `/artist/${n}`)]));
  const document = fakeDocument(head("Home", "/"), fixtures);
  const controller = createPageHeadController({ document, location: { origin, pathname: "/" }, now: () => at, cacheLimit: 2, cacheTtlMs: 100, apiCall: async (url) => {
    calls += 1; const path = new URL(url, origin).searchParams.get("path"); return { path, head: `HEAD_${path.slice(-1)}` };
  } });
  await controller.sync("/artist/1");
  await controller.sync("/artist/2");
  await controller.sync("/artist/1");
  assert.equal(calls, 2);
  await controller.sync("/artist/3");
  await controller.sync("/artist/2");
  assert.equal(calls, 4, "least recent public head was evicted");
  at += 101;
  await controller.sync("/artist/1");
  assert.equal(calls, 5);
});
