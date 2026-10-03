import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, seedGrant, proposalInput, AT, AUTH, SOURCE, ENABLED } from "./catalogApiFixture.mjs";
import { createCatalogApiService } from "./catalogApiService.js";
import { CATALOG_LIMITS, CATALOG_SCOPES } from "./catalogApiPolicy.js";
import { ensureApiGrantSchema } from "../apiGrants/apiGrantService.js";
import { ensureMediaApiSchema, secretHash } from "../mediaApi/mediaApiPolicy.js";
import { ensureCatalogWorkSchema } from "../catalogResearch/catalogWorkQueue.js";
import { hideCatalogResearch, nextVenueResearchSubject, runCatalogResearchPass } from "../catalogResearch/catalogResearchService.js";
import { catalogResearchRoutes } from "../catalogResearch/catalogResearchRoutes.js";
import { ApiError } from "../../errors.js";
import { CATALOG_KNOWLEDGE_KEY, ensureCatalogKnowledgeControl, setCatalogKnowledgeMode } from "../../catalogKnowledgeControl.js";
const rejects = (fn, status) => assert.throws(fn, error => error.status === status);

const pilotSelection = [{ type: "artist", key: "wet leg" }, { type: "event", key: "event-one" }];
function pairPilot(f, changes = {}) {
  const pairing = f.api.issuePairing({ ownerId: "owner", input: { actorLabel: "Synthetic pilot",
    entities: pilotSelection, scopes: ["artist", "event"].flatMap(type => ["read", "propose", "commit"].map(action => `catalog:${type}:${action}`)),
    commitLimit: 1, ...changes } });
  const grant = f.api.exchangePairing({ pairingCode: pairing.pairingCode });
  return { pairing, grant, authorization: `Bearer ${grant.accessToken}` };
}

test("issued pilot access is hash-only, single-use, limited by record, audience, quota and expiry", t => {
  const f = fixture(t), { pairing, grant, authorization } = pairPilot(f);
  assert.equal(grant.expiresAt - f.now(), 30 * 60_000);
  assert.equal(pairing.expiresAt - f.now(), 5 * 60_000);
  assert.ok(!JSON.stringify(f.db.prepare("SELECT * FROM catalog_pairings").all()).includes(pairing.pairingCode));
  assert.ok(!JSON.stringify(f.db.prepare("SELECT * FROM api_grants").all()).includes(grant.accessToken));
  rejects(() => f.api.exchangePairing({ pairingCode: pairing.pairingCode }), 401);
  const read = key => f.api.read({ authorization, type: "artist", key });
  rejects(() => read("private"), 403);
  assert.deepEqual(f.api.inventory({ authorization, type: "artist" }).items.map(row => row.key), ["wet leg"]);
  rejects(() => f.api.inventory({ authorization, type: "venue" }), 403);
  const page = read("wet leg");
  const request = (body, idempotencyKey) => ({ authorization, body, idempotencyKey });
  const lease = f.api.claim(request({ type: "artist", key: page.key, revision: page.revision,
    valueHash: page.valueHash, identityHash: page.identityHash }, "pilot-claim"));
  const proposal = f.api.propose(request({ type: "artist", key: page.key, nonce: lease.nonce, ...proposalInput() }, "pilot-propose"));
  rejects(() => f.api.review({ ownerId: "owner", proposalId: proposal.id, payloadHash: "wrong", approved: true }), 409);
  f.approve(proposal);
  const commit = request({ type: "artist", key: page.key, nonce: lease.nonce, proposalId: proposal.id, payloadHash: proposal.payloadHash }, "pilot-commit");
  const saved = f.api.commit(commit);
  assert.deepEqual(f.api.commit(commit), saved);
  assert.equal(f.api.status({ authorization, type: "artist" }).grant.commits, 1);
  const secondPage = f.api.read({ authorization, type: "event", key: "event-one" });
  const secondLease = f.api.claim(request({ type: "event", key: secondPage.key, revision: secondPage.revision,
    valueHash: secondPage.valueHash, identityHash: secondPage.identityHash }, "pilot-event-claim"));
  const secondProposal = f.api.propose(request({ type: "event", key: secondPage.key, nonce: secondLease.nonce,
    ...proposalInput("event") }, "pilot-event-propose")); f.approve(secondProposal);
  rejects(() => f.api.commit(request({ type: "event", key: secondPage.key, nonce: secondLease.nonce,
    proposalId: secondProposal.id, payloadHash: secondProposal.payloadHash }, "pilot-event-commit")), 429);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM catalog_event_enrichment").get().n, 0);
  f.advance(CATALOG_LIMITS.grantMs);
  rejects(() => read("wet leg"), 401); rejects(() => f.api.commit(commit), 401);
});

test("pairing and grant limits fail closed; revocation cancels pending owner pairings", t => {
  const f = fixture(t);
  const input = { actorLabel: "Synthetic", scopes: ["catalog:artist:read"], entities: [{ type: "artist", key: "wet leg" }], commitLimit: 0 };
  for (const changes of [{ entities: [...input.entities, ...input.entities] }, { entities: Array(7).fill(input.entities[0]) },
    { commitLimit: 7 }, { scopes: ["news:write"] }, { scopes: ["catalog:artist:commit"] }]) {
    rejects(() => f.api.issuePairing({ ownerId: "owner", input: { ...input, ...changes } }), 400);
  }
  rejects(() => f.api.issuePairing({ ownerId: "other", input }), 403);
  const expired = f.api.issuePairing({ ownerId: "owner", input });
  f.advance(CATALOG_LIMITS.pairingMs); rejects(() => f.api.exchangePairing({ pairingCode: expired.pairingCode }), 401);
  const active = f.api.issuePairing({ ownerId: "owner", input });
  f.api.revoke({ ownerId: "owner", grantId: "catalog-grant" });
  rejects(() => f.api.exchangePairing({ pairingCode: active.pairingCode }), 401);
  const fresh = f.api.issuePairing({ ownerId: "owner", input });
  f.db.exec("UPDATE users SET role='fan' WHERE id='owner'");
  rejects(() => f.api.exchangePairing({ pairingCode: fresh.pairingCode }), 403);
  assert.equal(f.db.prepare("SELECT status FROM catalog_pairings WHERE id=?").get(fresh.pairingId).status, "pending");
});

test("owner correction restores an absent prior record atomically and fences stale or changed identities", t => {
  const f = fixture(t), lease = f.claim("event", "event-one"), proposal = f.propose(lease);
  f.approve(proposal); f.api.commit(f.commitInput(lease, proposal));
  const read = () => f.api.ownerRead({ ownerId: "owner", type: "event", key: "event-one" });
  const page = read();
  const correction = { ownerId: "owner", type: page.type, key: page.key, revision: page.revision,
    valueHash: page.valueHash, identityHash: page.identityHash, action: "hide" };
  f.api.correct(correction);
  rejects(() => f.api.correct(correction), 409);
  const hidden = read(); assert.equal(hidden.hidden, true);
  const restore = { ...correction, revision: hidden.revision, valueHash: hidden.valueHash, action: "restore", changeId: proposal.id };
  f.db.exec("CREATE TEMP TRIGGER reject_restore BEFORE INSERT ON catalog_work_audit WHEN NEW.action='restore' BEGIN SELECT RAISE(ABORT,'restore failure'); END");
  assert.throws(() => f.api.correct(restore), /restore failure/);
  assert.equal(read().hidden, true);
  f.db.exec("DROP TRIGGER reject_restore"); f.api.correct(restore);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM catalog_event_enrichment").get().n, 0);
  rejects(() => f.api.correct(restore), 409);
  assert.equal(f.db.prepare("SELECT status FROM catalog_work_items").get().status, "quarantined");
});

test("correction restores prior research bytes and dormant owners cannot pair or use grants", t => {
  const f = fixture(t), firstLease = f.claim(), firstProposal = f.propose(firstLease);
  f.approve(firstProposal); f.api.commit(f.commitInput(firstLease, firstProposal));
  const prior = f.db.prepare("SELECT * FROM catalog_research WHERE entity_key='wet leg'").get();
  const lease = f.claim("artist", "wet leg", "second-claim-0001");
  const patch = { ...proposalInput().patch, summary: "Wet Leg has this updated synthetic description for a reversible local correction test only." };
  const proposal = f.propose(lease, patch, "second-propose-0001"); f.approve(proposal);
  f.api.commit(f.commitInput(lease, proposal, "second-commit-0001"));
  const page = f.api.ownerRead({ ownerId: "owner", type: "artist", key: "wet leg" });
  f.api.correct({ ownerId: "owner", ...page, action: "restore", changeId: proposal.id });
  const restored = f.db.prepare("SELECT * FROM catalog_research WHERE entity_key='wet leg'").get();
  assert.deepEqual({ ...restored }, { ...prior, claim_token: null });
  f.db.exec("ALTER TABLE users ADD COLUMN dormant_at INTEGER; UPDATE users SET dormant_at=1 WHERE id='owner'");
  rejects(() => f.api.read({ authorization: AUTH, type: "artist", key: "wet leg" }), 403);
  rejects(() => pairPilot(f), 403);
});

test("catalog defaults off; audience, entity scopes, current owner status and exact bearer are enforced", t => {
  const f = fixture(t), read = () => f.api.read({ authorization: AUTH, type: "artist", key: "wet leg" });
  delete f.env.PIT_CATALOG_API_ENABLED;
  rejects(read, 404); f.env.PIT_CATALOG_API_ENABLED = "true";
  for (const authorization of ["", "Basic invalid", AUTH.toLowerCase(), `${AUTH} other`]) {
    rejects(() => f.api.read({ authorization, type: "artist", key: "wet leg" }), 401);
  }
  ensureMediaApiSchema(f.db);
  const mediaToken = "synthetic_media_only_token_not_catalog_access";
  f.db.prepare(`INSERT INTO media_api_grants(id,owner_id,actor_type,actor_label,scopes,token_hash,status,issued_at,expires_at,updated_at)
    VALUES ('media','owner','assistant','Synthetic','["news:write"]',?,'active',?,?,?)`).run(secretHash(mediaToken), AT - 1, AT + 99_999, AT);
  rejects(() => f.api.read({ authorization: `Bearer ${mediaToken}`, type: "artist", key: "wet leg" }), 401);
  f.db.prepare("UPDATE api_grants SET scopes=?").run('["catalog:venue:read"]'); rejects(read, 403);
  f.db.prepare("UPDATE api_grants SET scopes=?").run(JSON.stringify(CATALOG_SCOPES));
  for (const sql of ["role='member'", "email_verified_at=NULL", "is_banned=1", `suspended_until=${AT + 1000}`]) {
    f.db.exec(`UPDATE users SET ${sql} WHERE id='owner'`); rejects(read, 403);
    f.db.prepare("UPDATE users SET role='admin',email_verified_at=?,is_banned=0,suspended_until=NULL WHERE id='owner'").run(AT - 1);
  }
  f.db.exec("UPDATE api_grants SET owner_id='other'"); rejects(read, 403);
  f.db.exec("UPDATE api_grants SET owner_id='owner',expires_at='invalid timestamp'"); rejects(read, 401);
  f.db.prepare("UPDATE api_grants SET expires_at=?,issued_at=?").run(AT + 1000, AT + 1); rejects(read, 401);
  f.db.prepare("UPDATE api_grants SET issued_at=?,expires_at=?").run(AT - 1, AT); rejects(read, 401);
  assert.equal(f.db.prepare("SELECT scopes FROM media_api_grants").get().scopes, '["news:write"]');
});

test("inventory cursor is complete, bounded and excludes private rows and raw provenance", t => {
  const f = fixture(t);
  for (let i = 0; i < 121; i++) f.db.prepare("INSERT INTO artists(norm,name,source,data) VALUES (?,?,?,?)")
    .run(`artist-${String(i).padStart(3, "0")}`, `Artist ${i}`, "musicbrainz", '{"privateEmail":"DO-NOT-LEAK"}');
  f.db.exec("INSERT INTO artists(norm,name,source) VALUES ('private','Private','artist-created')");
  let cursor = null; const keys = [];
  do {
    const page = f.api.ownerInventory({ ownerId: "owner", type: "artist", cursor, limit: 7 });
    assert.ok(page.items.length <= 7); assert.ok(!JSON.stringify(page).includes("DO-NOT-LEAK"));
    keys.push(...page.items.map(row => row.key)); cursor = page.nextCursor;
  } while (cursor);
  assert.equal(keys.length, 122); assert.equal(new Set(keys).size, 122); assert.deepEqual(keys, [...keys].sort());
  for (const limit of [0, 51, Infinity, 2.5]) rejects(() => f.api.ownerInventory({ ownerId: "owner", type: "artist", limit }), 400);
  rejects(() => f.api.ownerInventory({ ownerId: "owner", type: "artist", cursor: "garbage" }), 400);
  const otherCursor = f.api.ownerInventory({ ownerId: "owner", type: "artist", limit: 1 }).nextCursor;
  rejects(() => f.api.ownerInventory({ ownerId: "owner", type: "venue", cursor: otherCursor }), 400);
  for (const key of ["字".repeat(600), "界".repeat(600)]) f.db.prepare("INSERT INTO artists(norm,name,source) VALUES (?,?,?)")
    .run(key, key, "musicbrainz");
  const afterAscii = Buffer.from(JSON.stringify({ v: 1, type: "artist", after: "wet leg" })).toString("base64url");
  const unicodePage = f.api.ownerInventory({ ownerId: "owner", type: "artist", cursor: afterAscii, limit: 1 });
  assert.ok(unicodePage.nextCursor.length > 2400, "maximum Unicode keys need their full encoded cursor");
  assert.equal(f.api.ownerInventory({ ownerId: "owner", type: "artist", cursor: unicodePage.nextCursor, limit: 1 }).items.length, 1);
  f.db.exec("UPDATE tour_dates SET owner_id='private-owner'");
  assert.equal(f.api.ownerInventory({ ownerId: "owner", type: "event" }).items.length, 0);
  assert.equal(f.api.ownerInventory({ ownerId: "owner", type: "venue" }).items.length, 0);
});

test("approved commit writes research and distinct attribution with atomic replay", t => {
  const f = fixture(t), lease = f.claim(), proposal = f.propose(lease), input = f.commitInput(lease, proposal);
  rejects(() => f.api.commit(input), 409);
  rejects(() => f.api.review({ ownerId: "other", proposalId: proposal.id, payloadHash: proposal.payloadHash, approved: true }), 403);
  f.approve(proposal); delete f.env.PIT_CATALOG_API_COMMIT_ENABLED; rejects(() => f.api.commit(input), 403);
  f.env.PIT_CATALOG_API_COMMIT_ENABLED = "true";
  const committed = f.api.commit(input);
  assert.equal(committed.revision, 1); assert.deepEqual(f.api.commit(input), committed);
  const stored = JSON.parse(f.db.prepare("SELECT findings FROM catalog_research").get().findings);
  assert.equal(stored.provenance.actorType, "assistant"); assert.equal(stored.provenance.actorLabel, "Synthetic dot");
  assert.equal(stored.provenance.evidence[0].verification, "submitted");
  assert.equal(f.db.prepare("SELECT bio FROM artists").get().bio, null);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM catalog_work_audit WHERE action='committed'").get().n, 1);
  rejects(() => f.api.commit({ ...input, body: { ...input.body, payloadHash: "wrong" } }), 409);
  assert.ok(!JSON.stringify(f.api.read({ authorization: AUTH, type: "artist", key: "wet leg" })).includes("provenance"));
});

test("events enrich separately without changing provider facts or creating entities", t => {
  const f = fixture(t), before = f.db.prepare("SELECT * FROM tour_dates").get();
  const lease = f.claim("event", "event-one"), proposal = f.propose(lease);
  f.approve(proposal); f.api.commit(f.commitInput(lease, proposal));
  assert.deepEqual(f.db.prepare("SELECT * FROM tour_dates").get(), before);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM catalog_event_enrichment").get().n, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM catalog_research").get().n, 0);
  rejects(() => f.claim("event", "nonexistent", "missing-event-key"), 404);
});

test("field patches preserve existing findings and forbid provider or unsupported fields", t => {
  const f = fixture(t), lease = f.claim(), proposal = f.propose(lease);
  f.approve(proposal); f.api.commit(f.commitInput(lease, proposal));
  const before = f.api.read({ authorization: AUTH, type: "artist", key: "wet leg" }).findings;
  const next = f.claim("artist", "wet leg", "claim-second-key");
  const updated = f.propose(next, { facts: [{ field: "origin", value: "Isle of Wight", source: SOURCE }] }, "proposal-second-key");
  f.approve(updated); f.api.commit(f.commitInput(next, updated, "commit-second-key"));
  const after = f.api.read({ authorization: AUTH, type: "artist", key: "wet leg" }).findings;
  assert.equal(after.summary, before.summary); assert.deepEqual(after.images, before.images);
  assert.equal(after.facts[0].value, "Isle of Wight");
  const venue = f.claim("venue", "test hall|toronto|ca", "claim-venue-key");
  rejects(() => f.propose(venue, { ...proposalInput("venue").patch, facts: [{ field: "address", value: "Other", source: SOURCE }] }, "bad-address-key"), 400);
  rejects(() => f.propose(venue, { ticketUrl: "https://example.test" }, "bad-provider-key"), 400);
});

test("untrusted source evidence and image candidates are bounded and never fetched", t => {
  const f = fixture(t), lease = f.claim();
  let outbound = 0; t.mock.method(globalThis, "fetch", () => { outbound++; throw new Error("network disabled"); });
  const input = proposalInput();
  const propose = (value, key) => f.api.propose(f.request({ type: lease.type, key: lease.key, nonce: lease.nonce, ...value }, key));
  for (const url of ["http://example.test", "https://127.0.0.1/", "https://a:b@example.test/", "file:///x"]) {
    rejects(() => propose({ ...input, evidence: [{ ...input.evidence[0], url }] }, "bad-evidence-key"), 400);
  }
  rejects(() => propose({ ...input, patch: { ...input.patch, images: ["https://example.test/image.jpg"] } }, "bad-image-key"), 400);
  rejects(() => propose({ ...input, evidence: [{ ...input.evidence[0], accessedAt: AT + 1 }] }, "future-evidence-key"), 400);
  const proposal = propose(input, "valid-proposal-key"); f.approve(proposal); f.api.commit(f.commitInput(lease, proposal));
  assert.equal(outbound, 0);
});

test("audit failure rolls back research, revision, counters, proposal and receipt together", t => {
  const f = fixture(t), lease = f.claim(), proposal = f.propose(lease); f.approve(proposal);
  const input = f.commitInput(lease, proposal);
  f.db.exec("CREATE TEMP TRIGGER reject_catalog_audit BEFORE INSERT ON catalog_work_audit WHEN NEW.action='committed' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
  assert.throws(() => f.api.commit(input), /synthetic audit failure/);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM catalog_research").get().n, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM catalog_entity_versions").get().n, 0);
  assert.equal(f.db.prepare("SELECT commits FROM catalog_work_control").get().commits, 0);
  assert.equal(f.db.prepare("SELECT status FROM catalog_proposals").get().status, "approved");
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM catalog_api_receipts WHERE operation='commit'").get().n, 0);
  f.db.exec("DROP TRIGGER reject_catalog_audit"); assert.equal(f.api.commit(input).revision, 1);
});

test("revocation, scope changes, owner demotion, protection, identity and current values fence commits", async t => {
  const mutations = [
    ["revoked", "UPDATE api_grants SET status='revoked'", 401],
    ["scope narrowed", `UPDATE api_grants SET scopes='["catalog:artist:commit"]'`, 403],
    ["actor changed", "UPDATE api_grants SET actor_label='Another assistant'", 409],
    ["owner demoted", "UPDATE users SET role='member' WHERE id='owner'", 403],
    ["biography filled", "UPDATE artists SET bio='Protected staff biography'", 409],
    ["identity changed", "UPDATE artists SET mbid='new-provider-identity'", 409],
    ["canonical changed", "UPDATE artists SET country='Canada'", 409],
    ["revision changed", "INSERT INTO catalog_entity_versions VALUES ('artist','wet leg',1)", 409],
    ["claimed artist", "INSERT INTO artist_profiles(artist_key,owner_id) VALUES ('wet leg','someone')", 409],
    ["staff protected", "UPDATE artists SET data='{\"biographyStaff\":{}}'", 409],
  ];
  for (const [name, sql, status] of mutations) await t.test(name, t => {
    const f = fixture(t), lease = f.claim(), proposal = f.propose(lease); f.approve(proposal);
    f.db.exec(sql); rejects(() => f.api.commit(f.commitInput(lease, proposal)), status);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM catalog_research").get().n, 0);
  });
});

test("pause/resume invalidates old claims and preserves budget counters", t => {
  const f = fixture(t), lease = f.claim(), proposal = f.propose(lease); f.approve(proposal);
  f.api.control({ ownerId: "owner", paused: true, expectedRevision: 0 });
  rejects(() => f.api.commit(f.commitInput(lease, proposal)), 409);
  f.api.control({ ownerId: "owner", paused: false, expectedRevision: 1 });
  rejects(() => f.api.commit(f.commitInput(lease, proposal)), 409);
  assert.equal(f.db.prepare("SELECT claims FROM catalog_work_control").get().claims, 1);
  rejects(() => f.api.control({ ownerId: "owner", paused: false, expectedRevision: 0 }), 409);
});

test("lease expiry, takeover, bounded renewal and stale cleanup cannot affect another worker", t => {
  const f = fixture(t), old = f.claim(); f.advance(CATALOG_LIMITS.leaseMs + 1);
  const newer = f.claim("artist", "wet leg", "takeover-key-0001"); assert.notEqual(newer.nonce, old.nonce);
  rejects(() => f.api.finish(f.request({ type: old.type, key: old.key, nonce: old.nonce, outcome: "failed" }, "old-finish-key")), 409);
  assert.equal(f.db.prepare("SELECT nonce FROM catalog_work_items").get().nonce, newer.nonce);
  for (let i = 0; i < 3; i++) {
    f.advance(10 * 60_000);
    f.api.renew(f.request({ type: newer.type, key: newer.key, nonce: newer.nonce }, `renew-key-${i}`));
  }
  assert.ok(f.db.prepare("SELECT lease_until FROM catalog_work_items").get().lease_until <= AT + CATALOG_LIMITS.leaseMs + 1 + CATALOG_LIMITS.maxLeaseMs);
  f.advance(CATALOG_LIMITS.maxLeaseMs);
  rejects(() => f.api.renew(f.request({ type: newer.type, key: newer.key, nonce: newer.nonce }, "expired-renew-key")), 409);
});

test("two connections and restart preserve exclusivity, approval and receipt replay", t => {
  const dir = mkdtempSync(join(tmpdir(), "pit-catalog-connections-"));
  const path = join(dir, "fixture.db"), f = fixture(null, path);
  const second = new DatabaseSync(path); second.exec("PRAGMA busy_timeout=5000");
  t.after(() => { second.close(); f.db.close(); rmSync(dir, { recursive: true, force: true }); });
  const other = createCatalogApiService({ database: second, env: ENABLED, now: () => AT });
  const page = other.read({ authorization: AUTH, type: "artist", key: "wet leg" });
  const lease = f.claim();
  rejects(() => other.claim(f.request({ type: page.type, key: page.key, revision: page.revision,
    valueHash: page.valueHash, identityHash: page.identityHash }, "competing-key")), 409);
  const proposal = f.propose(lease); f.approve(proposal);
  const committed = other.commit(f.commitInput(lease, proposal));
  const reopened = new DatabaseSync(path);
  try { assert.deepEqual(createCatalogApiService({ database: reopened, env: ENABLED, now: () => AT })
    .commit(f.commitInput(lease, proposal)), committed); } finally { reopened.close(); }
});

test("queue/status/counters are bounded; no grant can read another grant's work", t => {
  const f = fixture(t); f.claim();
  seedGrant(f.db, { id: "second-grant", token: "another_synthetic_catalog_token_for_fixture" });
  const authorization = "Bearer another_synthetic_catalog_token_for_fixture";
  assert.equal(f.api.status({ authorization, type: "artist" }).items.length, 0);
  const status = f.api.status({ authorization: AUTH, type: "artist", limit: 1 });
  assert.equal(status.items.length, 1); assert.ok(!JSON.stringify(status).includes("owner"));
  rejects(() => f.api.status({ authorization: AUTH, type: "artist", limit: 51 }), 400);
  f.db.prepare("UPDATE catalog_work_control SET claims=?").run(CATALOG_LIMITS.dailyClaims);
  rejects(() => f.claim("event", "event-one", "over-budget-key"), 429);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM catalog_work_items").get().n, 1);
});

test("audit exhaustion preserves bounded owner pause and revocation while refusing new authority", t => {
  const f = fixture(t), lease = f.claim();
  seedGrant(f.db, { id: "second-grant", token: "another_synthetic_catalog_token_for_fixture" });
  f.db.prepare(`WITH RECURSIVE sequence(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM sequence WHERE n<?)
    INSERT INTO catalog_work_audit(id,actor_type,actor_label,action,created_at)
    SELECT 'capacity-'||n,'assistant','Synthetic fixture','claimed',? FROM sequence`)
    .run(CATALOG_LIMITS.auditRows - 1, AT);
  const count = () => f.db.prepare("SELECT COUNT(*) n FROM catalog_work_audit").get().n;
  assert.equal(count(), CATALOG_LIMITS.auditRows);
  rejects(() => f.claim("event", "event-one", "capacity-new-claim"), 429);
  assert.equal(f.db.prepare("SELECT claims FROM catalog_work_control").get().claims, 1);
  assert.deepEqual(f.api.control({ ownerId: "owner", paused: true, expectedRevision: 0 }), { paused: true, revision: 1 });
  assert.equal(count(), CATALOG_LIMITS.auditRows + 1);
  for (let index = 0; index < 3; index++) {
    assert.deepEqual(f.api.control({ ownerId: "owner", paused: true, expectedRevision: 1 }), { paused: true, revision: 1 });
    rejects(() => f.api.control({ ownerId: "owner", paused: false, expectedRevision: 1 }), 429);
  }
  assert.equal(count(), CATALOG_LIMITS.auditRows + 1);
  for (const grantId of ["catalog-grant", "second-grant"]) {
    for (let index = 0; index < 3; index++) assert.deepEqual(f.api.revoke({ ownerId: "owner", grantId }), { id: grantId, status: "revoked" });
  }
  assert.equal(count(), CATALOG_LIMITS.auditRows + 3);
  assert.equal(f.db.prepare("SELECT paused FROM catalog_work_control").get().paused, 1);
  assert.equal(f.db.prepare("SELECT lease_until FROM catalog_work_items WHERE nonce=?").get(lease.nonce).lease_until, 0);
  rejects(() => f.api.read({ authorization: AUTH, type: "artist", key: "wet leg" }), 401);
});

test("venue ambiguity uses the provider namespace, including unknown bindings, before claims or Claude selection", async t => {
  for (const source of ["another-provider", null, ""]) await t.test(String(source), t => {
    const f = fixture(t);
    f.db.prepare(`INSERT INTO tour_dates(id,artist,venue,date,venue_city,venue_country_code,source,venue_provider_id)
      VALUES ('colliding-room','Wet Leg','Test Hall','2027-01-02','Toronto','CA',?,'venue-one')`).run(source);
    f.db.exec(`INSERT INTO tour_dates(id,artist,venue,date,venue_city,venue_country_code,source,venue_provider_id)
      VALUES ('next-room','Wet Leg','Next Room','2027-01-03','Toronto','CA','ticketmaster','next')`);
    const page = f.api.inventory({ authorization: AUTH, type: "venue" }).items.find(row => row.key === "test hall|toronto|ca");
    assert.equal(page.identity.providerCount, 2);
    assert.equal(page.protected, true); assert.equal(page.eligible, false);
    rejects(() => f.claim("venue", page.key), 409);
    assert.equal(nextVenueResearchSubject(f.db, { at: AT }).key, "next room|toronto|ca");
  });
});

test("repeated venue rows share a normalized provider binding; null and empty legacy bindings agree", t => {
  const f = fixture(t);
  f.db.exec(`INSERT INTO tour_dates(id,artist,venue,date,venue_city,venue_country_code,source,venue_provider_id)
    VALUES ('same-room','Wet Leg','Test Hall','2027-01-02','Toronto','CA',' Ticketmaster ',' VENUE-ONE ')`);
  let page = f.api.read({ authorization: AUTH, type: "venue", key: "test hall|toronto|ca" });
  assert.equal(page.identity.providerCount, 1); assert.equal(page.eligible, true);
  f.db.exec("UPDATE tour_dates SET source=NULL,venue_provider_id=NULL WHERE id='event-one'; UPDATE tour_dates SET source='',venue_provider_id='' WHERE id='same-room'");
  page = f.api.read({ authorization: AUTH, type: "venue", key: "test hall|toronto|ca" });
  assert.equal(page.identity.providerCount, 1); assert.equal(page.eligible, true);
});

test("additive initialization preserves unrelated grants and transaction rollback removes partial migration", t => {
  const f = fixture(t); ensureMediaApiSchema(f.db);
  f.db.exec("INSERT INTO media_api_grants(id,owner_id,actor_type,actor_label,scopes,status,issued_at,expires_at,updated_at) VALUES ('prior','owner','assistant','Prior','[\"news:write\"]','active',1,9999999999999,1)");
  ensureApiGrantSchema(f.db); ensureCatalogWorkSchema(f.db);
  assert.equal(f.db.prepare("SELECT scopes FROM media_api_grants").get().scopes, '["news:write"]');
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM api_grants").get().n, 1);
  const blank = new DatabaseSync(":memory:");
  try {
    blank.exec("BEGIN IMMEDIATE"); ensureApiGrantSchema(blank); ensureCatalogWorkSchema(blank); blank.exec("ROLLBACK");
    assert.equal(blank.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n, 0);
  } finally { blank.close(); }
});

test("Claude shares the lease and rechecks protection or pause after awaited work", async t => {
  for (const mutation of ["UPDATE artists SET bio='Staff changed this during research'", "UPDATE catalog_work_control SET paused=1,revision=revision+1"]) {
    const f = fixture(t);
    const outcome = await runCatalogResearchPass({ database: f.db, env: { ANTHROPIC_API_KEY: "synthetic-unused" }, now: f.now, maxItems: 1,
      research: async () => {
        rejects(() => f.claim(), 409); f.db.exec(mutation);
        return { findings: { ...proposalInput().patch, match: "confident" }, searchedUrls: [SOURCE], costMicroUsd: 10, model: "synthetic" };
      } });
    assert.equal(outcome.researched, 1); assert.equal(outcome.published, 0);
    assert.equal(f.db.prepare("SELECT findings FROM catalog_research").get().findings, null);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM catalog_work_audit WHERE action='committed'").get().n, 0);
  }
});

test("dot claims prevent Claude calls and staff hide plus audit rolls back atomically", async t => {
  const f = fixture(t); f.db.exec("DELETE FROM tour_dates"); const lease = f.claim(); let calls = 0;
  const outcome = await runCatalogResearchPass({ database: f.db, env: { ANTHROPIC_API_KEY: "synthetic-unused" }, now: f.now, maxItems: 1,
    research: async () => { calls++; throw new Error("should not call a provider"); } });
  assert.equal(calls, 0); assert.equal(outcome.published, 0);
  const proposal = f.propose(lease); f.approve(proposal); f.api.commit(f.commitInput(lease, proposal));
  const routes = catalogResearchRoutes({ database: f.db, ApiError, rateLimit() {}, requireAdmin: () => ({ id: "owner" }), now: f.now });
  f.db.exec("CREATE TEMP TRIGGER reject_hide_audit BEFORE INSERT ON moderation_actions BEGIN SELECT RAISE(ABORT,'synthetic hide failure'); END");
  assert.throws(() => routes["POST /api/moderation/catalog-research/hide"]({ body: { type: "artist", key: "wet leg" } }), /synthetic hide failure/);
  assert.equal(f.db.prepare("SELECT status FROM catalog_research").get().status, "found");
  f.db.exec("DROP TRIGGER reject_hide_audit");
  hideCatalogResearch(f.db, { type: "artist", key: "wet leg", at: AT });
  rejects(() => f.claim("artist", "wet leg", "hidden-claim-key"), 409);
});

test("Claude skips quarantined and protected top artists and continues the eligible backlog", async t => {
  for (const protection of ["quarantined", "removed", "staff", "created"]) await t.test(protection, async t => {
    const f = fixture(t);
    f.db.exec("DELETE FROM tour_dates; INSERT INTO artists(norm,name,source,rank_score,data) VALUES ('next band','Next Band','musicbrainz',1,'malformed legacy json')");
    if (protection === "quarantined") {
      const lease = f.claim();
      f.api.finish(f.request({ type: lease.type, key: lease.key, nonce: lease.nonce, outcome: "quarantined" }, "quarantine-key"));
    } else if (protection === "removed") f.db.exec("INSERT INTO artist_profiles(artist_key,removed) VALUES ('wet leg',1)");
    else if (protection === "staff") f.db.exec("UPDATE artists SET data='{\"biographyStaff\":null}' WHERE norm='wet leg'");
    else f.db.exec("UPDATE artists SET source='artist-created' WHERE norm='wet leg'");
    const calls = [];
    const result = await runCatalogResearchPass({ database: f.db, env: { ANTHROPIC_API_KEY: "synthetic-unused" }, now: f.now, maxItems: 1,
      research: async subject => { calls.push(subject.key); return { costMicroUsd: 0, findings: { match: "not_found" } }; } });
    assert.deepEqual(calls, ["next band"]); assert.equal(result.researched, 1);
  });
});

test("Claude venue selection skips quarantined and ambiguous rooms", async t => {
  const f = fixture(t); f.db.exec("UPDATE artists SET bio='Existing provider biography'");
  const lease = f.claim("venue", "test hall|toronto|ca");
  f.api.finish(f.request({ type: lease.type, key: lease.key, nonce: lease.nonce, outcome: "quarantined" }, "quarantine-venue-key"));
  f.db.exec(`INSERT INTO tour_dates(id,artist,venue,date,venue_city,venue_country_code,source,venue_provider_id) VALUES
    ('ambiguous-a','Wet Leg','A Room','2027-01-01','Toronto','CA','ticketmaster','a'),
    ('ambiguous-b','Wet Leg','A Room','2027-01-02','Toronto','CA','ticketmaster','b'),
    ('next-room','Wet Leg','Next Room','2027-01-03','Toronto','CA','ticketmaster','next')`);
  const calls = [];
  const result = await runCatalogResearchPass({ database: f.db, env: { ANTHROPIC_API_KEY: "synthetic-unused" }, now: f.now, maxItems: 1,
    research: async subject => { calls.push(subject.key); return { costMicroUsd: 0, findings: { match: "not_found" } }; } });
  assert.deepEqual(calls, ["next room|toronto|ca"]); assert.equal(result.researched, 1);
});

test("an upgraded unexpired legacy Claude lease fences dot until its original expiry", t => {
  const f = fixture(t);
  f.db.prepare(`INSERT INTO catalog_research(entity_type,entity_key,identity,status,next_attempt_at,claim_token)
    VALUES ('artist','wet leg','{}','leased',?,'old-worker-nonce')`).run(AT + CATALOG_LIMITS.leaseMs);
  rejects(() => f.claim(), 409);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM catalog_work_items").get().n, 0);
  assert.equal(f.db.prepare("SELECT claims FROM catalog_work_control").get().claims, 0);
  f.advance(CATALOG_LIMITS.leaseMs + 1);
  assert.notEqual(f.claim().nonce, "old-worker-nonce");
});

test("receipt retention expires explicitly and cleanup is bounded without resetting active counters", t => {
  const f = fixture(t), lease = f.claim();
  assert.deepEqual(f.claim(), lease);
  assert.equal(f.db.prepare("SELECT claims FROM catalog_work_control").get().claims, 1);
  f.advance(CATALOG_LIMITS.retentionMs + 1);
  const next = f.claim(); assert.notEqual(next.nonce, lease.nonce);
  assert.equal(f.db.prepare("SELECT claims FROM catalog_work_control").get().claims, 1, "new UTC day resets the daily count");
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM catalog_api_receipts").get().n, 1);
  const receipt = f.db.prepare("SELECT created_at,expires_at FROM catalog_api_receipts").get();
  assert.equal(receipt.expires_at - receipt.created_at, CATALOG_LIMITS.retentionMs);
});

test("a failed work-schema initialization rolls back every newly created table", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE catalog_proposals(incompatible TEXT)");
    assert.throws(() => ensureCatalogWorkSchema(db), /no such column/);
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name), ["catalog_proposals"]);
    assert.equal(db.isTransaction, false);
  } finally { db.close(); }
});

test("Claude continuation admission stops after pause without booking another paid reservation", async t => {
  const f = fixture(t); let continuations = 0;
  const result = await runCatalogResearchPass({ database: f.db, env: { ANTHROPIC_API_KEY: "synthetic-unused" }, now: f.now, maxItems: 1,
    research: async (_subject, options) => {
      options.admitRequest({ turn: 0, reserveMicroUsd: 200_000 });
      f.db.exec("UPDATE catalog_work_control SET paused=1,revision=revision+1");
      rejects(() => options.admitRequest({ turn: 1, reserveMicroUsd: 200_000 }), 409);
      continuations++;
      return { costMicroUsd: 10, findings: { match: "not_found" } };
    } });
  assert.equal(continuations, 1); assert.equal(result.published, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM catalog_research_spend").get().n, 1);
});

test("same-tick legacy pause/resume invalidates claims and malformed control fails closed", t => {
  const f = fixture(t);
  ensureCatalogKnowledgeControl(f.db, { env: {}, at: AT });
  const lease = f.claim(), proposal = f.propose(lease); f.approve(proposal);
  setCatalogKnowledgeMode(f.db, "paused", { env: {}, at: AT });
  setCatalogKnowledgeMode(f.db, "maintenance", { env: {}, at: AT });
  rejects(() => f.api.commit(f.commitInput(lease, proposal)), 409);
  f.db.prepare("UPDATE app_meta SET value=? WHERE key=?").run('{"mode":"maintenance","version":999}', CATALOG_KNOWLEDGE_KEY);
  rejects(() => f.claim("event", "event-one", "malformed-control-key"), 409);
  assert.equal(f.db.prepare("SELECT claims FROM catalog_work_control").get().claims, 1);
});
