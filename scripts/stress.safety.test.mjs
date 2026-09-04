import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { capacityDatabaseProof } from "../server/capacityHandshake.js";

const SCRIPT = fileURLToPath(new URL("./stress.mjs", import.meta.url));
const execFileAsync = promisify(execFile);

function run(...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    timeout: 10_000,
  });
}

test("write stress refuses a non-local server before making a request", () => {
  const result = run(
    "--url", "https://www.mshpit.com",
    "--data-dir", process.cwd(),
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to stress a non-local server/);
});

test("write stress requires an explicitly isolated capacity database", () => {
  const missing = run("--url", "http://127.0.0.1:3137");
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /Pass --data-dir/);

  const unsafe = run(
    "--url", "http://127.0.0.1:3137",
    "--data-dir", process.cwd(),
  );
  assert.equal(unsafe.status, 2);
  assert.match(unsafe.stderr, /Refusing to write outside/);
});

test("write stress refuses a server bound to a different database before signup", async () => {
  const root = mkdtempSync(join(tmpdir(), "pit-stress-binding-"));
  const fixtureRoot = join(root, ".tmp");
  mkdirSync(fixtureRoot);
  const selectedDir = mkdtempSync(join(fixtureRoot, "capacity-selected-"));
  const otherDir = mkdtempSync(join(fixtureRoot, "capacity-other-"));
  const selectedDatabase = join(selectedDir, "pit.db");
  const otherDatabase = join(otherDir, "pit.db");
  writeFileSync(selectedDatabase, "");
  writeFileSync(otherDatabase, "");
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    if (request.url === "/api/dev/capacity-handshake") {
      const challenge = request.headers["x-pit-capacity-challenge"];
      const body = JSON.stringify({ proof: capacityDatabaseProof(otherDatabase, challenge) });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(body);
      return;
    }
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "unexpected request" }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    const result = await execFileAsync(process.execPath, [
      SCRIPT,
      "--url", `http://127.0.0.1:${address.port}`,
      "--data-dir", selectedDir,
      "--users", "1",
      "--rounds", "1",
    ], { encoding: "utf8", timeout: 10_000 }).catch((error) => error);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /running server is not using the supplied capacity database/);
    assert.deepEqual(requests, [{ method: "GET", url: "/api/dev/capacity-handshake" }]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});
