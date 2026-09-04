import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  HEALTH_RATE_LIMIT_MAX,
  HEALTH_RATE_LIMIT_WINDOW_MS,
  RUNTIME_READINESS_CACHE_MS,
  createSuccessfulReadinessCache,
  healthRateLimitPolicy,
} from "./healthAvailability.js";

test("public liveness and deployment-readiness probes use a dedicated per-IP allowance", () => {
  assert.deepEqual(healthRateLimitPolicy("203.0.113.10"), {
    key: "health:ip:203.0.113.10",
    max: HEALTH_RATE_LIMIT_MAX,
    windowMs: HEALTH_RATE_LIMIT_WINDOW_MS,
  });
  assert.notEqual(healthRateLimitPolicy("203.0.113.10").key, healthRateLimitPolicy("203.0.113.11").key);
  assert.ok(HEALTH_RATE_LIMIT_MAX >= 60, "normal platform probes retain ample headroom");
  assert.equal(HEALTH_RATE_LIMIT_WINDOW_MS, 60_000);

  const source = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(source, /if \(pathname === "\/api\/health" \|\| pathname === "\/api\/readiness"\) \{\s*const healthLimit = healthRateLimitPolicy\(ip\);\s*if \(!rateLimit\(healthLimit\.key, healthLimit\.max, healthLimit\.windowMs\)\)/);
});

test("private media probes degrade publishing without preventing core startup", () => {
  const source = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /throw new Error\(`Private media storage privacy check failed/);
  assert.match(
    source,
    /if \(PROD\) void startBackgroundRuntime\("\/startup\/private-media-probe", \(\) => refreshPrivateMediaIsolationSafely\("startup"\)\);/,
    "the production probe remains non-blocking and cannot escape its optional-runtime boundary",
  );
  assert.match(source, /private-storage privacy check failed closed: phase=\$\{phase\} code=\$\{status\.errorCode/);
  assert.match(source, /if \(status\?\.ready\) ensureLegacyImageRecoveryScheduler\(\)/,
    "legacy recovery starts only from a successful private-storage proof");
  assert.match(source, /legacyImageRecoveryEnabled\(process\.env\)/,
    "operators retain an explicit rollout and rollback switch");
});

test("successful readiness work is shared briefly and recomputed at expiry", () => {
  let at = 10_000;
  let checks = 0;
  const cache = createSuccessfulReadinessCache({ clock: () => at });
  const check = () => ({ generation: ++checks });

  assert.deepEqual(cache.get("runtime", check), { generation: 1 });
  at += RUNTIME_READINESS_CACHE_MS - 1;
  assert.deepEqual(cache.get("runtime", check), { generation: 1 });
  assert.equal(checks, 1);

  at += 1;
  assert.deepEqual(cache.get("runtime", check), { generation: 2 });
  assert.equal(checks, 2);
});

test("failed readiness checks are never cached", () => {
  let at = 20_000;
  let checks = 0;
  const cache = createSuccessfulReadinessCache({ clock: () => at });

  assert.throws(() => cache.get("runtime", () => {
    checks += 1;
    throw new Error("not ready");
  }), /not ready/);
  assert.deepEqual(cache.get("runtime", () => ({ generation: ++checks })), { generation: 2 });
  assert.equal(checks, 2);

  cache.clear();
  at += 1;
  assert.deepEqual(cache.get("runtime", () => ({ generation: ++checks })), { generation: 3 });
});
