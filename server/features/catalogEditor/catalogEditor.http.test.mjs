import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";

if (process.env.PIT_CATALOG_EDITOR_FIXTURE === "1") {
  const directory = resolve(process.env.PIT_DATA_DIR || ".");
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith("pit-catalog-editor-http-"));
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(typeof process.send, "function");
  const denied = () => { process.send({ kind: "outbound-blocked" }); throw new Error("Fixture outbound network disabled"); };
  globalThis.fetch = async () => denied();
  http.request = denied; http.get = denied; https.request = denied; https.get = denied;
  net.connect = denied; net.createConnection = denied; tls.connect = denied; net.Socket.prototype.connect = denied;
  const listen = net.Server.prototype.listen;
  net.Server.prototype.listen = function fixtureListen(port) {
    assert.equal(arguments.length, 1); assert.equal(port, Number(process.env.PORT));
    this.once("listening", () => process.send({ kind: "listener", port: this.address().port, address: this.address().address }));
    return listen.call(this, { port: 0, host: "127.0.0.1" });
  };
  syncBuiltinESMExports();
  const { db, q } = await import("../../db.js");
  const { createSession, destroySession, COOKIE } = await import("../../auth.js");
  const at = Date.now(), users = {};
  for (const [name, role] of [["admin", "admin"], ["moderator", "moderator"], ["editor", "editor"], ["fan", "fan"], ["unverified", "admin"], ["revoked", "admin"]]) {
    const id = `catalog_fixture_${name}`;
    q.insertUser.run(id, `${id}@example.test`, id, id, "synthetic-unused-hash", role, "Toronto", null, null, "NC", "#123456", at);
    db.prepare("UPDATE users SET email_verified_at=?,age_band='18_plus',onboarding_version=1 WHERE id=?").run(name === "unverified" ? 0 : at, id);
    const session = createSession(id); users[name] = { id, cookie: `${COOKIE}=${session.token}` };
    if (name === "revoked") destroySession(session.token);
  }
  db.prepare(`INSERT INTO artists(norm,name,public_slug,bio,mbid,source,created_at,updated_at)
    VALUES('catalog fixture','Catalog Fixture','catalog-fixture',NULL,'12345678-1234-4234-8234-123456789abc','musicbrainz',?,?)`).run(at, at);
  db.prepare(`INSERT INTO tour_dates(id,artist,artist_key,venue,place,date,source,updated_at,provider_event_id,venue_provider_id,
    venue_city,venue_country_code,venue_address_line1,event_name,music_qualified,artist_identity_status)
    VALUES('tm_catalog_fixture','Catalog Fixture','catalog fixture','Fixture Hall','Toronto, Canada','2027-05-01',
    'ticketmaster',?,'fixture-event','fixture-hall','Toronto','CA','1 Main Street','Catalog Fixture Live',1,'registered')`).run(at);
  const { createPublicDocumentService } = await import("../seo/publicDocuments.js");
  const { artistSitemapEntries } = await import("../seo/sitemapService.js");
  const before = JSON.stringify(db.prepare("SELECT * FROM tour_dates WHERE id='tm_catalog_fixture'").get());
  process.on("message", message => {
    if (message?.operation !== "snapshot") return;
    const documents = createPublicDocumentService({ database: db, origin: "https://www.mshpit.com" });
    const projected = [documents.artistDocument({ artistKey: "catalog fixture", at }),
      documents.venueDocument({ name: "Fixture Hall", source: "ticketmaster", providerVenueId: "fixture-hall", at }),
      documents.eventDocument({ id: "tm_catalog_fixture", at })];
    const htmlChecks = projected.map(doc => ({ kind: doc?.kind, hasText: !!doc?.catalogText?.summary,
      rendered: !!doc && documents.render(doc).includes('data-catalog-text="true"') }));
    const artistEntry = artistSitemapEntries(db, { now: at }).find(row => row.artistKey === "catalog fixture");
    process.send({ kind: "snapshot", htmlChecks, artistLastmod: artistEntry?.lastmod, auditCount: db.prepare("SELECT COUNT(*) n FROM moderation_actions WHERE action='catalog_text_save'").get().n,
      entries: db.prepare("SELECT entity_type,revision FROM catalog_editor_entries ORDER BY entity_type").all(),
      providerUnchanged: before === JSON.stringify(db.prepare("SELECT * FROM tour_dates WHERE id='tm_catalog_fixture'").get()),
      integrity: db.prepare("PRAGMA integrity_check").get().integrity_check,
      foreignKeys: db.prepare("PRAGMA foreign_key_check").all().length });
  });
  process.send({ kind: "fixture", users });
  await import("../../index.js");
} else {
  test("real isolated HTTP catalog editor authorizes staff, preserves facts and publishes sourced text without outbound work", { timeout: 45000 }, async t => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const directory = mkdtempSync(join(tmpdir(), "pit-catalog-editor-http-"));
    const env = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
    Object.assign(env, { NODE_ENV: "test", RENDER: "true", PORT: "3000", PUBLIC_ORIGIN: "http://127.0.0.1",
      PIT_DATA_DIR: directory, PIT_CATALOG_EDITOR_FIXTURE: "1", PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "true", ADMIN_EMAIL: "catalog_fixture_admin@example.test",
      NEWS_DESK_ENABLED: "false", ARTIST_KNOWLEDGE_ENABLED: "false", CATALOG_RESEARCH_ENABLED: "false", BACKUP_ENABLED: "false",
      EMAIL_CAMPAIGN_RECOVERY_ENABLED: "false", CACHE_WARM_ENABLED: "false", TOURDATE_REFRESH_ENABLED: "false" });
    const child = fork(fileURLToPath(import.meta.url), [], { cwd: root, env, execArgv: [], stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
    let output = "", fixture, listener, snapshot, outbound = 0, exited = false;
    for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { output = (output + data).slice(-8000); });
    child.on("message", message => {
      if (message.kind === "fixture") fixture = message;
      if (message.kind === "listener") listener = message;
      if (message.kind === "snapshot") snapshot = message;
      if (message.kind === "outbound-blocked") outbound++;
    });
    const exit = new Promise(done => child.once("exit", () => { exited = true; done(); }));
    t.after(async () => {
      if (!exited) child.kill(); await exit;
      assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
      rmSync(directory, { recursive: true, force: true });
    });
    const until = async predicate => {
      const deadline = Date.now() + 15000;
      while (!predicate()) {
        if (exited || Date.now() > deadline) throw new Error(`Fixture unavailable: ${output}`);
        await new Promise(done => setTimeout(done, 20));
      }
    };
    await until(() => fixture && listener);
    assert.equal(listener.address, "127.0.0.1");
    const origin = `http://127.0.0.1:${listener.port}`;
    const request = async (path, { actor = "admin", body, expected = 200, requestOrigin = "http://127.0.0.1" } = {}) => {
      const headers = { Origin: requestOrigin, "Content-Type": "application/json" };
      if (actor) { headers.Cookie = fixture.users[actor].cookie; headers["X-Pit-Expected-Account"] = fixture.users[actor].id; }
      const response = await fetch(origin + path, { method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(10000), headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const data = await response.json();
      assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)} ${response.status === 500 ? output : ""}`);
      return data;
    };
    const base = "/api/admin/catalog-editor";
    await request(`${base}/artist`, { actor: null, expected: 401 });
    assert.equal((await request(`${base}/artist`, { actor: "revoked", expected: 409 })).code, "IDENTITY_CHANGED");
    for (const actor of ["fan", "moderator", "editor"]) await request(`${base}/artist`, { actor, expected: 403 });
    const rows = [["artist", "catalog fixture"], ["venue", "ticketmaster:fixture-hall"], ["event", "tm_catalog_fixture"]];
    const drafts = [];
    for (const [type, key] of rows) {
      const current = await request(`${base}/${type}/${encodeURIComponent(key)}`);
      drafts.push({ type, key, expectedRevision: current.revision, expectedHash: current.expectedHash,
        summary: `Source-backed ${type} context written for this isolated synthetic catalog acceptance test.`,
        sources: [{ label: "Official fixture source", url: "https://www.mshpit.com/about" }], reason: "Synthetic acceptance test" });
    }
    await request(`${base}/prepare`, { actor: "unverified", body: { entries: drafts }, expected: 403 });
    await request(`${base}/prepare`, { body: { entries: drafts }, requestOrigin: "https://untrusted.invalid", expected: 403 });
    const preview = await request(`${base}/prepare`, { body: { entries: drafts } });
    assert.ok(preview.results.every(row => row.ok));
    for (const [index, draft] of drafts.entries()) {
      const body = { draft, idempotencyKey: `catalog-http-operation-${index}` };
      const result = await request(`${base}/save`, { body });
      assert.equal(result.revision, 1);
      assert.equal((await request(`${base}/save`, { body })).auditId, result.auditId);
      const view = await request(`/api/catalog-text/${draft.type}/${encodeURIComponent(draft.key)}`, { actor: null });
      assert.equal(view.text.summary, draft.summary); assert.equal(view.text.sources[0].label, "Official fixture source");
      assert.equal(view.text.updated_by, undefined);
    }
    await request(`${base}/save`, { body: { draft: drafts[0], idempotencyKey: "catalog-http-stale-key" }, expected: 409 });
    child.send({ operation: "snapshot" }); await until(() => snapshot);
    assert.deepEqual(snapshot.htmlChecks, ["artist", "venue", "event"].map(kind => ({ kind, hasText: true, rendered: true })));
    assert.ok(snapshot.artistLastmod > 0);
    assert.equal(snapshot.auditCount, 3); assert.equal(snapshot.entries.length, 3);
    assert.equal(snapshot.providerUnchanged, true); assert.equal(snapshot.integrity, "ok"); assert.equal(snapshot.foreignKeys, 0); assert.equal(outbound, 0);
  });
}
