import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

function trackedPaths() {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, "the privacy gate must be able to inspect Git's tracked-file set");
  return result.stdout.split("\0").filter(Boolean);
}

test("Git never tracks databases, environment files, credentials, or backup artifacts", () => {
  const forbidden = trackedPaths().filter((path) => {
    const normalized = path.replaceAll("\\", "/");
    const name = normalized.split("/").at(-1) || "";
    return /^\.env(?:\.|$)/i.test(name)
      || /\.(?:db|db-wal|db-shm|sqlite|sqlite3|pem|p8|p12|jks|key)$/i.test(name)
      || /(?:^|\/)(?:backups?|credentials?|secrets?)(?:\/|$)/i.test(normalized);
  });

  assert.deepEqual(forbidden, [],
    `privacy-sensitive artifacts are tracked: ${forbidden.join(", ")}`);
});

test("tracked text does not contain recognized private credential formats", () => {
  const signatures = [
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
    /\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}\b/,
    /\bsk_live_[A-Za-z0-9]{16,}\b/,
    /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
    /\bglpat-[A-Za-z0-9_-]{20,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bRESEND_API_KEY\s*[:=]\s*["']re_[A-Za-z0-9_-]{20,}["']/,
  ];
  const allowedFixture = new Set(["server/media-errors.test.mjs"]);
  const violations = [];
  for (const path of trackedPaths()) {
    if (allowedFixture.has(path.replaceAll("\\", "/"))) continue;
    let data;
    try { data = readFileSync(new URL(path.replaceAll("\\", "/"), ROOT)); }
    catch { continue; }
    // Binary assets are outside a text-secret scanner; sensitive binary file
    // classes are already denied by the tracked-path gate above.
    if (data.includes(0)) continue;
    const source = data.toString("utf8");
    if (signatures.some((pattern) => pattern.test(source))) violations.push(path);
  }
  assert.deepEqual(violations, [], `recognized credentials are tracked in: ${violations.join(", ")}`);
});

test("the ignore policy covers local secrets, SQLite sidecars, and snapshots", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
  for (const rule of [".env*", "*.db", "*.db-wal", "*.db-shm", "backups/"]) {
    assert.match(source, new RegExp(`^${rule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"),
      `.gitignore must retain ${rule}`);
  }
});
