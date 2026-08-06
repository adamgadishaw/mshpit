import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-environment-"));
process.env.PIT_DATA_DIR = dataDir;

const { pitEnv, isProduction } = await import("./environment.js");
const { nonProductionBlock } = await import("./emailService.js");
const { db } = await import("./db.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test("an unset PIT_ENV is production, so the real site is never half-muted", () => {
  assert.equal(pitEnv({}), "production");
  assert.equal(pitEnv({ PIT_ENV: "" }), "production");
  assert.equal(pitEnv({ PIT_ENV: "   " }), "production");
  assert.equal(isProduction({}), true);
  // NODE_ENV must not be able to answer this question: staging runs
  // NODE_ENV=production deliberately.
  assert.equal(isProduction({ NODE_ENV: "development" }), true);
});

test("PIT_ENV is case and whitespace tolerant", () => {
  assert.equal(pitEnv({ PIT_ENV: "  STAGING " }), "staging");
  assert.equal(isProduction({ PIT_ENV: "Production" }), true);
  assert.equal(isProduction({ PIT_ENV: "staging" }), false);
});

test("production never blocks a recipient", () => {
  assert.equal(nonProductionBlock("anyone@example.com", {}), null);
  assert.equal(nonProductionBlock("anyone@example.com", { PIT_ENV: "production" }), null);
});

test("staging with no allowlist sends to nobody", () => {
  // The failure that matters: staging restored from a production snapshot,
  // holding every real address, with someone testing a broadcast.
  const env = { PIT_ENV: "staging" };
  for (const to of ["real.user@gmail.com", "someone@else.com", ""]) {
    assert.equal(nonProductionBlock(to, env), "non-production-recipient");
  }
  assert.equal(nonProductionBlock("a@b.com", { PIT_ENV: "staging", EMAIL_ALLOWED_RECIPIENTS: "" }), "non-production-recipient");
  assert.equal(nonProductionBlock("a@b.com", { PIT_ENV: "staging", EMAIL_ALLOWED_RECIPIENTS: "   ,  , " }), "non-production-recipient");
});

test("staging mails only the addresses explicitly listed", () => {
  const env = { PIT_ENV: "staging", EMAIL_ALLOWED_RECIPIENTS: "dev@mshpit.com, QA@mshpit.com" };
  assert.equal(nonProductionBlock("dev@mshpit.com", env), null);
  assert.equal(nonProductionBlock("  DEV@MSHPIT.COM  ", env), null, "matching must ignore case and padding");
  assert.equal(nonProductionBlock("qa@mshpit.com", env), null);
  assert.equal(nonProductionBlock("real.user@gmail.com", env), "non-production-recipient");
  // A near miss must not pass: substring matching here would be a real leak.
  assert.equal(nonProductionBlock("dev@mshpit.com.attacker.test", env), "non-production-recipient");
  assert.equal(nonProductionBlock("xdev@mshpit.com", env), "non-production-recipient");
});

test("robots.txt keeps staging out of every index", async () => {
  const { robotsTxt } = await import("./seo.js");
  const previous = process.env.PIT_ENV;
  try {
    process.env.PIT_ENV = "staging";
    const staging = robotsTxt();
    assert.match(staging, /Disallow: \//);
    assert.ok(!/Allow: \//.test(staging), "staging must not advertise anything as crawlable");
    assert.ok(!/Sitemap:/.test(staging), "a staging sitemap would invite the crawl it just refused");

    delete process.env.PIT_ENV;
    assert.match(robotsTxt(), /Allow: \//);
  } finally {
    if (previous === undefined) delete process.env.PIT_ENV; else process.env.PIT_ENV = previous;
  }
});
