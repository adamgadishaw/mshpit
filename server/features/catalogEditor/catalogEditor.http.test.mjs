import assert from "node:assert/strict";
import { fork } from "node:child_process";
import childProcess from "node:child_process";
import fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";

const FIXTURE_ORIGIN = "https://catalog-fixture.example.com";

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
  // Serve the smallest possible app shell through the real HTTP/SEO handlers.
  // Do not build, overwrite dist/, or alter the routing/projection under test.
  const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../../../dist");
  const existsSync = fs.existsSync, readFileSync = fs.readFileSync;
  fs.existsSync = path => [dist, join(dist, "index.html")].includes(String(path)) || existsSync(path);
  fs.readFileSync = (path, ...args) => String(path) === join(dist, "index.html")
    ? '<!doctype html><html><head><title>Fixture shell</title></head><body><div id="root"></div></body></html>'
    : readFileSync(path, ...args);
  // The real sitemap runs in a read-only child process; deny network there too.
  const networkGuard = join(directory, "deny-network.mjs");
  fs.writeFileSync(networkGuard, `import http from 'node:http'; import https from 'node:https';
    import net from 'node:net'; import tls from 'node:tls'; import { syncBuiltinESMExports } from 'node:module';
    const deny = () => { process.send?.({ kind: 'outbound-blocked' }); throw new Error('Fixture outbound network disabled'); };
    globalThis.fetch = async () => deny(); http.request = deny; http.get = deny; https.request = deny; https.get = deny;
    net.connect = deny; net.createConnection = deny; tls.connect = deny; net.Socket.prototype.connect = deny;
    syncBuiltinESMExports();`);
  const forkWorker = childProcess.fork;
  childProcess.fork = (path, args, options) => {
    assert.equal(resolve(path), resolve(dirname(fileURLToPath(import.meta.url)), "../seo/sitemapWorker.js"));
    const worker = forkWorker(path, args, { ...options, execArgv: [...options.execArgv, "--import", pathToFileURL(networkGuard).href] });
    worker.on("message", message => { if (message?.kind === "outbound-blocked") process.send(message); });
    return worker;
  };
  const listen = net.Server.prototype.listen;
  net.Server.prototype.listen = function fixtureListen(port) {
    assert.equal(arguments.length, 1); assert.equal(port, Number(process.env.PORT));
    this.once("listening", () => process.send({ kind: "listener", port: this.address().port, address: this.address().address }));
    return listen.call(this, { port: 0, host: "127.0.0.1" });
  };
  syncBuiltinESMExports();
  const { db, q } = await import("../../db.js");
  const { createSession, destroySession, COOKIE } = await import("../../auth.js");
  const at = Date.now(), users = {}, eventDate = new Date(at + 30 * 86400000).toISOString().slice(0, 10);
  for (const [name, role] of [["admin", "admin"], ["moderator", "moderator"], ["editor", "editor"], ["fan", "fan"], ["unverified", "admin"], ["revoked", "admin"]]) {
    const id = `catalog_fixture_${name}`;
    q.insertUser.run(id, `${id}@example.test`, id, id, "synthetic-unused-hash", role, "Toronto", null, null, "NC", "#123456", at);
    db.prepare("UPDATE users SET email_verified_at=?,age_band='18_plus',onboarding_version=1 WHERE id=?").run(name === "unverified" ? 0 : at, id);
    const session = createSession(id); users[name] = { id, cookie: `${COOKIE}=${session.token}` };
    if (name === "revoked") destroySession(session.token);
  }
  db.prepare(`INSERT INTO artists(norm,name,public_slug,bio,mbid,source,created_at,updated_at)
    VALUES('catalog fixture','Catalog Fixture','catalog-fixture',NULL,'12345678-1234-4234-8234-123456789abc','musicbrainz',?,?)`).run(at, at);
  db.prepare(`INSERT INTO artists(norm,name,public_slug,bio,mbid,source,created_at,updated_at)
    VALUES('catalog text only','Catalog Text Only','catalog-text-only',NULL,'22345678-1234-4234-8234-123456789abc','musicbrainz',?,?)`).run(at, at);
  const queueArtist = db.prepare(`INSERT INTO artists(norm,name,public_slug,bio,mbid,source,created_at,updated_at)
    VALUES(?,?,?,?,?,'musicbrainz',?,?)`);
  for (let index = 0; index < 156; index++) {
    const suffix = String(index).padStart(3, "0"), key = `queue-${suffix}`;
    queueArtist.run(key, `Queue acceptance ${suffix}`, key, index < 155 ? "Existing provider biography." : null,
      `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, at, at);
  }
  db.prepare(`INSERT INTO tour_dates(id,artist,artist_key,venue,place,date,source,updated_at,provider_event_id,venue_provider_id,
    venue_city,venue_country_code,venue_address_line1,event_name,music_qualified,artist_identity_status,ticket_url,event_status)
    VALUES('tm_catalog_fixture','Catalog Fixture','catalog fixture','Fixture Hall','Toronto, Canada',?,
    'ticketmaster',?,'fixture-event','fixture-hall','Toronto','CA','1 Main Street','Catalog Fixture Live',1,'registered',
    'https://www.ticketmaster.com/event/fixture-event','onsale')`).run(eventDate, at);
  const { createPublicDocumentService } = await import("../seo/publicDocuments.js");
  const { artistSitemapEntries } = await import("../seo/sitemapService.js");
  const before = JSON.stringify(db.prepare("SELECT * FROM tour_dates WHERE id='tm_catalog_fixture'").get());
  const artistRows = () => db.prepare("SELECT * FROM artists WHERE norm IN ('catalog fixture','catalog text only') ORDER BY norm").all();
  const artistBefore = JSON.stringify(artistRows());
  process.on("message", async message => {
    if (message?.operation === "refresh-sitemap") {
      try {
        const { refreshSitemapSnapshot } = await import("../../seo.js");
        const result = await refreshSitemapSnapshot({ force: true });
        process.send({ kind: "sitemap-refreshed", ok: result.ok, reason: result.reason });
      } catch (error) { process.send({ kind: "sitemap-refreshed", ok: false, reason: error.message }); }
      return;
    }
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
      artistUnchanged: artistBefore === JSON.stringify(artistRows()),
      integrity: db.prepare("PRAGMA integrity_check").get().integrity_check,
      foreignKeys: db.prepare("PRAGMA foreign_key_check").all().length });
  });
  process.send({ kind: "fixture", users, eventDate });
  await import("../../index.js");
} else {
  test("real isolated HTTP catalog editor authorizes staff, preserves facts and publishes sourced text without outbound work", { timeout: 45000 }, async t => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const directory = mkdtempSync(join(tmpdir(), "pit-catalog-editor-http-"));
    const env = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
    Object.assign(env, { NODE_ENV: "test", RENDER: "true", PORT: "3000", PUBLIC_ORIGIN: FIXTURE_ORIGIN,
      PIT_DATA_DIR: directory, PIT_CATALOG_EDITOR_FIXTURE: "1", PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "true", ADMIN_EMAIL: "catalog_fixture_admin@example.test",
      NEWS_DESK_ENABLED: "false", ARTIST_KNOWLEDGE_ENABLED: "false", CATALOG_RESEARCH_ENABLED: "false", BACKUP_ENABLED: "false",
      EMAIL_CAMPAIGN_RECOVERY_ENABLED: "false", CACHE_WARM_ENABLED: "false", TOURDATE_REFRESH_ENABLED: "false" });
    const child = fork(fileURLToPath(import.meta.url), [], { cwd: root, env, execArgv: [], stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
    let output = "", fixture, listener, snapshot, sitemapRefresh, outbound = 0, exited = false;
    for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { output = (output + data).slice(-8000); });
    child.on("message", message => {
      if (message.kind === "fixture") fixture = message;
      if (message.kind === "listener") listener = message;
      if (message.kind === "snapshot") snapshot = message;
      if (message.kind === "sitemap-refreshed") sitemapRefresh = message;
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
    const publicOrigin = FIXTURE_ORIGIN;
    const publicPaths = ["/artist/catalog-fixture", "/venue/ticketmaster-fixture-hall", "/event/tm_catalog_fixture"];
    const publicGet = async path => {
      const response = await fetch(origin + path, { redirect: "manual", signal: AbortSignal.timeout(10000),
        headers: { Accept: path.endsWith(".xml") ? "application/xml" : "text/html", "User-Agent": "Isolated catalog HTTP fixture" } });
      const text = await response.text();
      assert.equal(response.status, 200, `${path}: ${text.slice(0, 500)} ${response.status === 500 ? output : ""}`);
      return { response, text };
    };
    const refreshSitemap = async () => {
      sitemapRefresh = null; child.send({ operation: "refresh-sitemap" }); await until(() => sitemapRefresh);
      assert.equal(sitemapRefresh.ok, true, `${sitemapRefresh.reason}: ${output}`);
    };
    const assertNoPrivateText = text => {
      for (const marker of ["PRIVATE_DRAFT_", "PRIVATE_REASON_", "UNAUTHORIZED_TEXT_", "catalog_fixture_admin",
        "expectedHash", "identity_hash", "updated_by", "catalog-http-operation-"]) assert.ok(!text.includes(marker), marker);
    };
    const request = async (path, { actor = "admin", body, expected = 200, requestOrigin = FIXTURE_ORIGIN } = {}) => {
      const headers = { Origin: requestOrigin, "Content-Type": "application/json" };
      if (actor) { headers.Cookie = fixture.users[actor].cookie; headers["X-Pit-Expected-Account"] = fixture.users[actor].id; }
      const response = await fetch(origin + path, { method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(10000), headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const data = await response.json();
      assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)} ${response.status === 500 ? output : ""}`);
      return data;
    };
    const base = "/api/admin/catalog-editor";
    await refreshSitemap(); // Wait for any initial materialization before changing the fixture.
    await request(`${base}/artist`, { actor: null, expected: 401 });
    assert.equal((await request(`${base}/artist`, { actor: "revoked", expected: 409 })).code, "IDENTITY_CHANGED");
    for (const actor of ["fan", "moderator", "editor"]) await request(`${base}/artist`, { actor, expected: 403 });
    await t.test("authenticated empty queue advances a bounded cursor to the remaining gap", async () => {
      const first = await request(`${base}/artist?q=Queue%20acceptance&missing=true`);
      assert.deepEqual(first.items, []);
      assert.equal(first.nextCursor, "queue-149"); assert.equal(first.scanLimitReached, true);
      const next = await request(`${base}/artist?q=Queue%20acceptance&missing=true&cursor=${first.nextCursor}`);
      assert.deepEqual(next.items.map(row => row.key), ["queue-155"]);
      assert.equal(next.nextCursor, null); assert.equal(next.scanLimitReached, false);
    });
    const rows = [["artist", "catalog fixture"], ["venue", "ticketmaster:fixture-hall"], ["event", "tm_catalog_fixture"]];
    const drafts = [];
    for (const [type, key] of rows) {
      const current = await request(`${base}/${type}/${encodeURIComponent(key)}`);
      drafts.push({ type, key, expectedRevision: current.revision, expectedHash: current.expectedHash,
        summary: `Source-backed ${type} context written for this isolated synthetic catalog acceptance test.`,
        sources: [{ label: "Official fixture source", url: "https://www.mshpit.com/about" }], reason: "PRIVATE_REASON_synthetic acceptance test" });
    }
    await request(`${base}/prepare`, { actor: "unverified", body: { entries: drafts }, expected: 403 });
    await request(`${base}/prepare`, { body: { entries: drafts }, requestOrigin: "https://untrusted.invalid", expected: 403 });
    const preview = await request(`${base}/prepare`, { body: { entries: drafts } });
    assert.ok(preview.results.every(row => row.ok));
    await t.test("prepared and unauthorized drafts never reach public HTML or API", async () => {
      for (const [index, draft] of drafts.entries()) {
        await request(`${base}/save`, { actor: "fan", body: { draft: { ...draft, summary: `UNAUTHORIZED_TEXT_${draft.type}` },
          idempotencyKey: `catalog-denied-operation-${index}` }, expected: 403 });
        const { text } = await publicGet(publicPaths[index]);
        assert.ok(!text.includes(draft.summary)); assert.ok(!text.includes('data-catalog-text="true"')); assertNoPrivateText(text);
        assert.equal((await request(`/api/catalog-text/${draft.type}/${encodeURIComponent(draft.key)}`, { actor: null })).text, null);
      }
    });
    const saved = [];
    for (const [index, draft] of drafts.entries()) {
      const body = { draft, idempotencyKey: `catalog-http-operation-${index}` };
      const result = await request(`${base}/save`, { body });
      saved.push(result);
      assert.equal(result.revision, 1);
      assert.equal((await request(`${base}/save`, { body })).auditId, result.auditId);
      const view = await request(`/api/catalog-text/${draft.type}/${encodeURIComponent(draft.key)}`, { actor: null });
      assert.equal(view.text.summary, draft.summary); assert.equal(view.text.sources[0].label, "Official fixture source");
      assert.equal(view.text.updated_by, undefined);
    }
    await t.test("real public entity routes expose canonical metadata, sources and unchanged provider identities", async () => {
      for (const [index, draft] of drafts.entries()) {
        const { response, text } = await publicGet(publicPaths[index]);
        const canonical = publicOrigin + publicPaths[index];
        assert.match(response.headers.get("content-type"), /^text\/html/);
        assert.equal(response.headers.get("link"), `<${canonical}>; rel="canonical"`);
        assert.match(response.headers.get("x-robots-tag"), /^index,follow/);
        assert.ok(text.includes(`<link rel="canonical" href="${canonical}"`));
        assert.ok(text.includes(`<meta property="og:url" content="${canonical}"`));
        assert.match(text, /<meta name="robots" content="index,follow/);
        assert.ok(text.includes('data-catalog-text="true"')); assert.ok(text.includes(draft.summary));
        assert.ok(text.includes('href="https://www.mshpit.com/about"')); assert.ok(text.includes("Official fixture source"));
        assertNoPrivateText(text);
        const nodes = [...text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
          .flatMap(match => JSON.parse(match[1]));
        if (draft.type === "artist") {
          const description = text.match(/<meta name="description" content="([^"]+)"/)?.[1];
          assert.match(description, /Catalog Fixture.*tour/); // Existing tour facts still lead metadata.
          const artist = nodes.find(node => node.about?.["@id"] === `${canonical}#artist`)?.about;
          assert.equal(artist.name, "Catalog Fixture");
          assert.deepEqual(artist.sameAs, ["https://musicbrainz.org/artist/12345678-1234-4234-8234-123456789abc"]);
        } else if (draft.type === "venue") {
          const venue = nodes.find(node => node["@type"] === "MusicVenue");
          assert.equal(venue.name, "Fixture Hall"); assert.equal(venue.url, canonical);
          assert.equal(venue.address.addressLocality, "Toronto");
        } else {
          const event = nodes.find(node => node["@type"] === "MusicEvent");
          assert.equal(event.name, "Catalog Fixture"); assert.equal(event.url, canonical);
          assert.equal(event.startDate, fixture.eventDate); assert.equal(event.location.name, "Fixture Hall");
          assert.equal(event.location.url, publicOrigin + publicPaths[1]);
          assert.equal(event.location.address.streetAddress, "1 Main Street");
          assert.equal(event.performer[0].name, "Catalog Fixture");
          assert.equal(event.offers.url, "https://www.ticketmaster.com/event/fixture-event");
        }
      }
    });
    await t.test("real sitemap index and shards retain canonical identities after publication", async () => {
      await refreshSitemap();
      const { response, text: index } = await publicGet("/sitemap.xml");
      assert.match(response.headers.get("content-type"), /xml/); assert.match(index, /<sitemapindex/);
      for (const [number, kind] of ["artists", "venues", "events"].entries()) {
        const path = `/sitemaps/${kind}.xml`;
        assert.ok(index.includes(`<loc>${publicOrigin}${path}</loc>`));
        const { text } = await publicGet(path);
        assert.match(text, /<urlset/); assert.ok(text.includes(`<loc>${publicOrigin}${publicPaths[number]}</loc>`));
        assert.ok(!text.includes(`${publicOrigin}/artist/catalog-text-only`));
        assertNoPrivateText(text);
      }
    });
    await t.test("new unpublished revisions cannot replace public text or leak private source URLs", async () => {
      const pending = drafts.map((draft, index) => ({ ...draft, expectedRevision: saved[index].saved.revision,
        expectedHash: saved[index].saved.expectedHash, summary: `PRIVATE_DRAFT_${draft.type} additional unapproved context`,
        sources: [{ label: "PRIVATE_DRAFT_SOURCE", url: "https://www.mshpit.com/PRIVATE_DRAFT_SOURCE" }] }));
      const prepared = await request(`${base}/prepare`, { body: { entries: pending } });
      assert.ok(prepared.results.every(row => row.ok));
      await refreshSitemap();
      for (const [index, draft] of drafts.entries()) {
        const { text } = await publicGet(publicPaths[index]); assert.ok(text.includes(draft.summary)); assertNoPrivateText(text);
        const publicText = await request(`/api/catalog-text/${draft.type}/${encodeURIComponent(draft.key)}`, { actor: null });
        assert.equal(publicText.text.summary, draft.summary); assertNoPrivateText(JSON.stringify(publicText));
      }
      assertNoPrivateText((await publicGet("/sitemaps/artists.xml")).text);
    });
    await request(`${base}/save`, { body: { draft: drafts[0], idempotencyKey: "catalog-http-stale-key" }, expected: 409 });
    child.send({ operation: "snapshot" }); await until(() => snapshot);
    assert.deepEqual(snapshot.htmlChecks, ["artist", "venue", "event"].map(kind => ({ kind, hasText: true, rendered: true })));
    assert.ok(snapshot.artistLastmod > 0);
    assert.equal(snapshot.auditCount, 3); assert.equal(snapshot.entries.length, 3);
    assert.equal(snapshot.providerUnchanged, true); assert.equal(snapshot.artistUnchanged, true);
    assert.equal(snapshot.integrity, "ok"); assert.equal(snapshot.foreignKeys, 0); assert.equal(outbound, 0);
    await t.test("text-only artist publication and hiding reach real metadata and sitemap routes", async () => {
      const key = "catalog text only", path = "/artist/catalog-text-only", canonical = publicOrigin + path;
      const current = await request(`${base}/artist/${encodeURIComponent(key)}`);
      const draft = { type: "artist", key, expectedRevision: current.revision, expectedHash: current.expectedHash,
        summary: "This artist's carefully sourced catalog context describes its original music and recorded work for this isolated test.",
        sources: drafts[0].sources, reason: "PRIVATE_REASON_text-only publication" };
      const result = await request(`${base}/save`, { body: { draft, idempotencyKey: "catalog-text-only-publish" } });
      const published = await publicGet(path);
      assert.equal(published.response.headers.get("link"), `<${canonical}>; rel="canonical"`);
      const description = published.text.match(/<meta name="description" content="([^"]+)"/)?.[1];
      assert.ok(description?.includes("carefully sourced catalog context")); assertNoPrivateText(published.text);
      await refreshSitemap();
      const xml = (await publicGet("/sitemaps/artists.xml")).text;
      const lastmod = new Date(result.saved.updatedAt).toISOString().slice(0, 10);
      assert.ok(xml.includes(`<loc>${canonical}</loc>\n    <lastmod>${lastmod}</lastmod>`));
      await request(`${base}/save`, { body: { draft: { ...draft, hidden: true,
        expectedRevision: result.saved.revision, expectedHash: result.saved.expectedHash }, idempotencyKey: "catalog-text-only-hide" } });
      const hiddenResponse = await publicGet(path), hidden = hiddenResponse.text;
      assert.ok(!hidden.includes("carefully sourced catalog context")); assert.ok(!hidden.includes('data-catalog-text="true"'));
      assert.equal(hiddenResponse.response.headers.get("x-robots-tag"), "noindex,follow");
      assert.equal(hiddenResponse.response.headers.get("link"), null); assert.ok(!hidden.includes('rel="canonical"'));
      assert.equal((await request(`/api/catalog-text/artist/${encodeURIComponent(key)}`, { actor: null })).text, null);
      await refreshSitemap();
      assert.ok(!(await publicGet("/sitemaps/artists.xml")).text.includes(`<loc>${canonical}</loc>`));
    });
    snapshot = null; child.send({ operation: "snapshot" }); await until(() => snapshot);
    assert.equal(snapshot.auditCount, 5); assert.equal(snapshot.providerUnchanged, true); assert.equal(snapshot.artistUnchanged, true);
    assert.equal(snapshot.integrity, "ok"); assert.equal(snapshot.foreignKeys, 0); assert.equal(outbound, 0);
  });
}
