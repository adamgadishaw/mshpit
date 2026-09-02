import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SECURITY_TXT_EXPIRES,
  SECURITY_TXT_PATH,
  securityTxt,
  securityTxtResponse,
} from "./securityTxt.js";

test("security.txt publishes only monitored, canonical disclosure metadata", () => {
  const body = securityTxt();
  assert.equal(SECURITY_TXT_PATH, "/.well-known/security.txt");
  assert.match(body, /^Contact: mailto:support@mshpit\.com$/mu);
  assert.match(body, /^Canonical: https:\/\/www\.mshpit\.com\/\.well-known\/security\.txt$/mu);
  assert.match(body, /^Policy: https:\/\/www\.mshpit\.com\/support$/mu);
  assert.match(body, /^Preferred-Languages: en$/mu);
  assert.ok(Date.parse(SECURITY_TXT_EXPIRES) > Date.parse("2026-09-02T00:00:00Z"));
  assert.equal(body.endsWith("\n"), true);
});

test("security.txt response permits only GET and HEAD with bounded public caching", () => {
  const get = securityTxtResponse("GET");
  assert.equal(get.status, 200);
  assert.equal(get.body, securityTxt());
  assert.equal(get.headers["Cache-Control"], "public, max-age=3600");
  assert.equal(get.headers["X-Content-Type-Options"], "nosniff");

  const rejected = securityTxtResponse("POST");
  assert.equal(rejected.status, 405);
  assert.equal(rejected.headers.Allow, "GET, HEAD");
  assert.equal(rejected.headers["Cache-Control"], "no-store");
});

test("the HTTP server handles security.txt before API and SPA fallbacks", () => {
  const source = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(source, /pathname === SECURITY_TXT_PATH/);
  assert.match(source, /securityTxtResponse\(req\.method\)/);
  assert.match(source, /sendCrawlerText\(req, res, security\.status, security\.body, security\.headers\)/);
});
