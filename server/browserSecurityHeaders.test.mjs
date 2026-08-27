import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./index.js", import.meta.url), "utf8");

test("browser isolation headers preserve OAuth/video popups without requiring cross-origin embedding", () => {
  assert.match(source, /"Cross-Origin-Opener-Policy":\s*"same-origin-allow-popups"/);
  assert.match(source, /"Cross-Origin-Resource-Policy":\s*"same-origin"/);
  assert.match(source, /"Origin-Agent-Cluster":\s*"\?1"/);
  assert.doesNotMatch(source, /"Cross-Origin-Embedder-Policy"/);
});

test("CSP permits Expo and Google scripts while gating dormant player providers", () => {
  const scriptDirective = source.match(/`script-src ([^`]+)`/)?.[1] || "";
  assert.ok(scriptDirective, "script-src directive should exist");
  assert.doesNotMatch(scriptDirective, /'unsafe-inline'/);
  assert.match(scriptDirective, /'self'/);
  assert.match(scriptDirective, /https:\/\/\*\.googleapis\.com/);
  assert.match(scriptDirective, /https:\/\/\*\.gstatic\.com/);
  assert.match(scriptDirective, /MUSIC_PLAYER_ENABLED \? " https:\/\/www\.youtube\.com https:\/\/s\.ytimg\.com" : ""/);
  assert.match(source, /"style-src 'self' 'unsafe-inline'"/);
});

test("CSP restricts remote media to HTTPS and closes plugin/base/form injection sinks", () => {
  assert.match(source, /"img-src 'self' https: data: blob:"/);
  assert.match(source, /"media-src 'self' https: blob:"/);
  assert.doesNotMatch(source, /"img-src \*/);
  assert.doesNotMatch(source, /"media-src \*/);
  assert.match(source, /"object-src 'none'"/);
  assert.match(source, /"base-uri 'self'"/);
  assert.match(source, /"form-action 'self'"/);
  assert.match(source, /"frame-ancestors 'none'"/);
});

test("the production request path reads only the __Host session cookie", () => {
  assert.match(source, /const ACTIVE_SESSION_COOKIE = sessionCookieName\(PROD\)/);
  assert.match(source, /parseCookies\(req\.headers\.cookie\)\[ACTIVE_SESSION_COOKIE\]/);
  assert.doesNotMatch(source, /parseCookies\(req\.headers\.cookie\)\[COOKIE\]/);
});

test("redirects retain global headers while suppressing referrer and caching", () => {
  const redirectBlock = source.match(/if \(result && result\.redirect\) \{([\s\S]*?)return res\.end\(\);\s*\}/)?.[1] || "";
  assert.match(redirectBlock, /\.\.\.HEADERS/);
  assert.match(redirectBlock, /"Cache-Control": "no-store"/);
  assert.match(redirectBlock, /"Referrer-Policy": "no-referrer"/);
  assert.match(redirectBlock, /Location: result\.redirect/);
});
