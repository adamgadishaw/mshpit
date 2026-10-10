import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("real HTTP resolver context produces private correlated failures and bounded entry categories", { timeout: 60_000 }, async (t) => {
  const probe = createServer();
  await new Promise((done) => probe.listen(0, "127.0.0.1", done));
  const port = probe.address().port;
  await new Promise((done) => probe.close(done));
  const origin = `http://127.0.0.1:${port}`;
  const directory = mkdtempSync(join(tmpdir(), "pit-resolver-http-"));
  const preload = join(directory, "preload.mjs");
  const moduleUrl = (name) => JSON.stringify(pathToFileURL(join(root, "server", name)).href);
  // This generated fixture is outside the source tree. All real outbound
  // transports are denied; only the two in-memory provider responses are allowed.
  writeFileSync(preload, `
    import assert from "node:assert/strict";
    import http from "node:http";
    import https from "node:https";
    import net from "node:net";
    import tls from "node:tls";
    import { syncBuiltinESMExports } from "node:module";
    assert.equal(process.env.NODE_ENV, "test");
    assert.equal(typeof process.send, "function");
    let blocked = 0;
    const calls = { musicbrainz: 0, deezer: 0 };
    const deny = () => { blocked++; throw new Error("Resolver fixture forbids outbound network"); };
    http.request = deny; http.get = deny; https.request = deny; https.get = deny;
    net.connect = deny; net.createConnection = deny; tls.connect = deny; net.Socket.prototype.connect = deny;
    globalThis.fetch = async (input) => {
      const host = new URL(input).hostname;
      if (host === "musicbrainz.org") {
        calls.musicbrainz++;
        return new Response(JSON.stringify({ artists: [] }));
      }
      if (host === "api.deezer.com") {
        calls.deezer++;
        return new Response("Unavailable", { status: 503 });
      }
      return deny();
    };
    const listen = net.Server.prototype.listen;
    net.Server.prototype.listen = function fixtureListen(port) {
      assert.equal(arguments.length, 1);
      assert.equal(port, Number(process.env.PORT));
      this.once("listening", () => process.send({ kind: "listener", address: this.address().address }));
      return listen.call(this, { port, host: "127.0.0.1" });
    };
    syncBuiltinESMExports();
    const { artistStmts, artistRow } = await import(${moduleUrl("db.js")});
    artistStmts.upsert.run(artistRow("HTTP Saved Fixture", {
      name: "HTTP Saved Fixture", mbid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    }, "fixture"));
    const { artistResolverMetrics } = await import(${moduleUrl("artistResolverDiagnostics.js")});
    process.on("message", ({ kind }) => {
      if (kind === "snapshot") process.send({ kind: "snapshot", metrics: artistResolverMetrics.snapshot(), calls, blocked });
    });
  `);
  const environment = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA", "NODE_OPTIONS"]
    .filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
  Object.assign(environment, {
    NODE_ENV: "test", RENDER: "true", PORT: String(port), PUBLIC_ORIGIN: origin,
    PIT_DATA_DIR: directory, PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "true",
    ERROR_ALERTS_ENABLED: "false", NEWS_DESK_ENABLED: "false", PIT_MEDIA_API_ENABLED: "false",
    BACKUP_ENABLED: "false", EMAIL_CAMPAIGN_RECOVERY_ENABLED: "false",
    CACHE_WARM_ENABLED: "false", TOURDATE_REFRESH_ENABLED: "false",
  });
  const child = fork(join(root, "server/index.js"), [], {
    cwd: root, env: environment, execArgv: ["--max-old-space-size=192", "--import", pathToFileURL(preload).href],
    stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true,
  });
  let output = "", address, exited = false;
  const append = (data) => { output = (output + data).slice(-30_000); };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("message", (message) => { if (message.kind === "listener") address = message.address; });
  const exit = new Promise((done) => child.once("exit", () => { exited = true; done(); }));
  t.after(async () => {
    if (!exited) child.kill();
    await exit;
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  });
  const deadline = Date.now() + 25_000;
  while (!address || !output.includes(`up on http://localhost:${port}`)) {
    if (exited || Date.now() > deadline) assert.fail(`Resolver fixture did not start: ${output}`);
    await new Promise((done) => setTimeout(done, 25));
  }
  assert.equal(address, "127.0.0.1");
  const privateName = "HTTP Private Needle Alpha";
  const request = async (name, referer) => {
    const response = await fetch(`${origin}/api/artists/resolve?name=${encodeURIComponent(name)}`, {
      redirect: "error", signal: AbortSignal.timeout(10_000), headers: { Referer: referer },
    });
    return { status: response.status, requestId: response.headers.get("x-request-id"), body: await response.json() };
  };
  const first = await request(privateName, `${origin}/event/private-event-key?token=private-token`);
  const second = await request(privateName, "https://outside.example.test/event/private-event-key?token=private-token");
  const saved = await request("HTTP Saved Fixture", `${origin}/artist/private-artist-key`);
  assert.equal(first.status, 502);
  assert.equal(second.status, 502);
  assert.equal(first.body.code, "PROVIDER_UNAVAILABLE");
  assert.equal(second.body.code, "PROVIDER_UNAVAILABLE");
  assert.equal(saved.status, 200);
  assert.equal(saved.body.artist.name, "HTTP Saved Fixture");
  assert.equal(saved.body.created, false);
  assert.doesNotMatch(JSON.stringify([first.body, second.body, saved.body]), /resolver=|entryPoint|cacheWrite|private-token|private-event-key/);

  const snapshot = await new Promise((done, reject) => {
    const timer = setTimeout(() => { child.off("message", receive); reject(new Error("Resolver fixture snapshot timed out")); }, 5000);
    const receive = (message) => {
      if (message.kind !== "snapshot") return;
      clearTimeout(timer); child.off("message", receive); done(message);
    };
    child.on("message", receive);
    child.send({ kind: "snapshot" });
  });
  assert.deepEqual(snapshot.calls, { musicbrainz: 1, deezer: 1 }, "the second request reuses memoized work and the saved identity bypasses providers");
  assert.equal(snapshot.blocked, 0);
  assert.equal(snapshot.metrics.completed, 3);
  assert.equal(snapshot.metrics.storedMatches, 1);
  assert.equal(snapshot.metrics.entryPoints.event_page, 1);
  assert.equal(snapshot.metrics.entryPoints.unknown, 1);
  assert.equal(snapshot.metrics.entryPoints.artist_page, 1);
  assert.equal(snapshot.metrics.sources.catalog, 1);
  assert.equal(snapshot.metrics.outcomes.unavailable, 2);
  assert.doesNotMatch(JSON.stringify(snapshot.metrics), /Private Needle|Saved Fixture|private-token|private-event-key|outside\.example/);

  const lines = output.split(/\r?\n/).filter((line) => line.includes(" on GET /api/artists/resolve "));
  assert.equal(lines.length, 2, output);
  for (const [index, requestResult] of [first, second].entries()) {
    const line = lines.find((value) => value.includes(requestResult.requestId));
    assert.ok(line, "the existing failed-request log retains the response request ID");
    assert.match(line, / resolver=/, "actual API context must carry the capture callback into the resolver");
    assert.doesNotMatch(line, /Private Needle|Saved Fixture|private-token|private-event-key|outside\.example/);
    const detail = JSON.parse(line.slice(line.indexOf(" resolver=") + " resolver=".length));
    assert.equal(detail.entryPoint, index === 0 ? "event_page" : "unknown");
    assert.equal(detail.musicbrainz.outcome, "no_match");
    assert.equal(detail.deezer.outcome, "unavailable");
    assert.equal(detail.deezer.failure, "http_error", "preserve the existing Deezer provider classification");
    assert.equal(detail.musicbrainz.origin, index === 0 ? "new_work" : "memoized_result");
    assert.equal(detail.deezer.origin, index === 0 ? "new_work" : "memoized_error");
    assert.equal(detail.cacheWrite, "not_attempted");
    assert.ok(Number.isInteger(detail.elapsedMs));
  }
});
