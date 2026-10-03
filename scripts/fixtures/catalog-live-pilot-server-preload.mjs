// Owned scratch database and loopback listener only; never imported in production.
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { basename, dirname } from "node:path";
import { tmpdir } from "node:os";
import { syncBuiltinESMExports } from "node:module";
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
import dns from "node:dns";
import childProcess from "node:child_process";
import workerThreads from "node:worker_threads";

const directory = realpathSync(process.env.PIT_DATA_DIR || ".");
assert.equal(process.env.PIT_CATALOG_BROWSER_FIXTURE, "1");
assert.equal(process.env.NODE_ENV, "test");
assert.equal(typeof process.send, "function");
assert.equal(directory.toLowerCase(), realpathSync(tmpdir()).toLowerCase());
assert.equal(dirname(directory).toLowerCase(), realpathSync(process.env.PIT_CATALOG_TEMP_PARENT).toLowerCase());
assert.ok(basename(directory).startsWith("pit-catalog-browser-"));
const denied = () => { process.send({ kind: "outbound-blocked", stack: new Error().stack.split("\n").slice(1, 5).join("\n") }); throw new Error("Fixture outbound disabled"); };
const deniedHelper = () => { process.send({ kind: "helper-blocked" }); throw new Error("Fixture nested helpers disabled"); };
for (const key of ["spawn", "spawnSync", "fork", "exec", "execSync", "execFile", "execFileSync"]) childProcess[key] = deniedHelper;
childProcess.ChildProcess.prototype.spawn = deniedHelper;
workerThreads.Worker = class DisabledFixtureWorker { constructor() { deniedHelper(); } };
globalThis.fetch = async () => denied();
http.request = http.get = https.request = https.get = http2.connect = denied;
net.connect = net.createConnection = tls.connect = dgram.createSocket = denied;
net.Socket.prototype.connect = denied;
dgram.Socket.prototype.send = dgram.Socket.prototype.connect = denied;
const lookup = dns.lookup;
for (const key of Object.keys(dns)) if (/^(lookup|resolve|reverse)/u.test(key) && typeof dns[key] === "function") dns[key] = denied;
dns.lookup = function literal(host, ...args) { return host === "127.0.0.1" ? lookup.call(this, host, ...args) : denied(); };
for (const key of Object.keys(dns.promises)) if (/^(lookup|resolve|reverse)/u.test(key) && typeof dns.promises[key] === "function") dns.promises[key] = async () => denied();
for (const Resolver of [dns.Resolver, dns.promises.Resolver]) for (const key of Object.getOwnPropertyNames(Resolver.prototype)) {
  if (/^(resolve|reverse)/u.test(key) && typeof Resolver.prototype[key] === "function") Resolver.prototype[key] = denied;
}
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function loopback(port) {
  assert.equal(arguments.length, 1); assert.equal(port, Number(process.env.PORT));
  this.once("listening", () => process.send({ kind: "listener-bound", address: this.address().address }));
  return listen.call(this, { host: "127.0.0.1", port });
};
syncBuiltinESMExports();

const { db, q } = await import("../../server/db.js");
const { COOKIE, createSession, hashPassword } = await import("../../server/auth.js");
const { LEGAL_ACCEPTANCE_VERSION } = await import("../../src/domain/privacyDisclosures.mjs");
const { ownerIdentity, storeOwnerIdentity } = await import("../../server/ownerIdentity.js");
const { ensureVenuePhotoEnrichmentSchema } = await import("../../server/venuePhotoEnrichment.js");
const { createRuntimeVenuePhotoReader } = await import("../../server/runtimeVenuePhotoReader.js");
const { registerRuntimeVenuePhotoReader } = await import("../../server/venuePhotoCatalog.js");
const at = Date.now(), id = "pilot_owner";
q.insertUser.run(id, "pilot-owner@example.test", "Synthetic Pilot Owner", "pilotowner",
  hashPassword("Synthetic-pilot-password1"), "admin", "Toronto", 43.65, -79.38, "SP", "#123456", at);
db.prepare("UPDATE users SET email_verified_at=?,onboarding_version=1,age_band='18_plus',extras=? WHERE id=?")
  .run(at, JSON.stringify({ termsAcceptedAt: at, termsVersion: LEGAL_ACCEPTANCE_VERSION, analyticsOptOut: true }), id);
storeOwnerIdentity(db, ownerIdentity("pilot-owner@example.test", id, at));
const artist = { type: "artist", key: "00 pilot artist", name: "00 Pilot Artist", path: "/artist/pilot-artist" };
const protectedArtist = { type: "artist", key: "00 preserved artist", name: "00 Preserved Artist" };
for (const [record, bio] of [[artist, null], [protectedArtist, "Synthetic existing biography must remain unchanged."]]) {
  db.prepare("INSERT INTO artists(norm,name,public_slug,mbid,bio,source,created_at,updated_at) VALUES (?,?,?,?,?,'musicbrainz',?,?)")
    .run(record.key, record.name, record === artist ? "pilot-artist" : "preserved-artist", record === artist ? "12345678-1234-4234-8234-123456789abc" : null, bio, at, at);
}
const venue = { type: "venue", key: "00 pilot hall|toronto|ca", name: "00 Pilot Hall", path: "/venue/ticketmaster-pilot-venue" };
const event = { type: "event", key: "pilot-event", name: "Synthetic Pilot Concert", path: "/event/pilot-event" };
db.prepare(`INSERT INTO tour_dates(id,artist,artist_key,venue,date,place,lat,lng,venue_city,venue_country_code,venue_provider_id,
  source,provider_event_id,event_name,event_status,event_kind,music_qualified,provider_active,updated_at)
  VALUES (?,?,?,?,?,'Toronto, Canada',43.65,-79.38,'Toronto','CA','pilot-venue','ticketmaster','synthetic-provider-event',?,'onsale','concert',1,1,?)`)
  .run(event.key, artist.name, artist.key, venue.name, new Date(at + 10 * 86_400_000).toISOString().slice(0, 10), event.name, at);
ensureVenuePhotoEnrichmentSchema(db);
const digest = "a".repeat(64), objectKey = `venues/licensed/pilot-venue/${digest.slice(0, 48)}.webp`;
const photo = { uri: `${process.env.MEDIA_PUBLIC_BASE_URL}/${objectKey}`, title: "Synthetic venue exterior fixture", creator: "Synthetic Fixture Creator",
  source: "commons", sourcePage: "https://commons.wikimedia.org/wiki/File:Synthetic_pilot_fixture.webp",
  license: "CC-BY-4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  modificationNotice: "Converted to WebP and resized when needed by MSHpit for delivery.",
  mirroredFrom: "https://upload.wikimedia.org/synthetic-fixture.webp",
  mirror: { objectKey, sha256: digest, byteSize: 100, width: 320, height: 180, contentType: "image/webp" } };
db.prepare("INSERT INTO venue_photo_enrichment(venue_key,identity,status,attempted_at,next_attempt_at,photo_json) VALUES (?,?,'filled',?,?,?)")
  .run("provider:ticketmaster:pilot-venue", JSON.stringify([venue.name.toLowerCase(), "toronto", "ca"]), at, at + 86_400_000, JSON.stringify(photo));
registerRuntimeVenuePhotoReader(createRuntimeVenuePhotoReader(db));
process.on("message", message => {
  if (message?.kind !== "inspect") return;
  process.send({ kind: "inspection", integrity: db.prepare("PRAGMA integrity_check").get().integrity_check,
    foreignKeyViolations: db.prepare("PRAGMA foreign_key_check").all().length,
    commits: db.prepare("SELECT COUNT(*) n FROM catalog_work_audit WHERE action='committed'").get().n,
    preservedBiography: db.prepare("SELECT bio FROM artists WHERE norm=?").get(protectedArtist.key).bio });
});
process.send({ kind: "fixture", ownerId: id, cookieName: COOKIE, cookie: `${COOKIE}=${createSession(id).token}`,
  artist, venue, event, protectedArtist, photo, at });
