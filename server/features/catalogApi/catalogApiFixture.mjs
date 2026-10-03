import { DatabaseSync } from "node:sqlite";
import { ensureApiGrantSchema } from "../apiGrants/apiGrantService.js";
import { ensureCatalogResearchSchema } from "../catalogResearch/catalogResearchService.js";
import { secretHash } from "../mediaApi/mediaApiPolicy.js";
import { ownerIdentity, storeOwnerIdentity } from "../../ownerIdentity.js";
import { CATALOG_SCOPES } from "./catalogApiPolicy.js";
import { createCatalogApiService } from "./catalogApiService.js";

export const AT = Date.parse("2026-10-02T12:00:00Z");
export const TOKEN = "synthetic_catalog_fixture_not_a_real_credential";
export const AUTH = `Bearer ${TOKEN}`;
export const SOURCE = "https://example.test/catalog-evidence";
export const ENABLED = { PIT_CATALOG_API_ENABLED: "true", PIT_CATALOG_API_COMMIT_ENABLED: "true" };
export function fixture(t, path = ":memory:") {
  const db = new DatabaseSync(path);
  t?.after(() => db.close());
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT NOT NULL,email_verified_at INTEGER,is_banned INTEGER DEFAULT 0,suspended_until INTEGER);
    CREATE TABLE artists(norm TEXT PRIMARY KEY,name TEXT NOT NULL,genre TEXT,bio TEXT,mbid TEXT,country TEXT,formed TEXT,
      source TEXT,data TEXT,rank_score INTEGER DEFAULT 0);
    CREATE TABLE artist_profiles(artist_key TEXT PRIMARY KEY,bio TEXT,owner_id TEXT,removed INTEGER DEFAULT 0,
      bio_staff_curated INTEGER DEFAULT 0,identity_review_status TEXT);
    CREATE TABLE tour_dates(id TEXT PRIMARY KEY,artist TEXT,artist_key TEXT,venue TEXT,date TEXT,owner_id TEXT,
      venue_city TEXT,venue_region TEXT,venue_country_code TEXT,venue_address_line1 TEXT,venue_provider_id TEXT,
      source TEXT,provider_event_id TEXT,event_name TEXT,start_date_time TEXT,event_status TEXT,ticket_url TEXT,
      sold_out INTEGER,event_kind TEXT,release_at INTEGER DEFAULT 0,provider_active INTEGER DEFAULT 1,
      music_qualified INTEGER DEFAULT 1,artist_identity_status TEXT);
    CREATE TABLE moderation_actions(id TEXT,actor_id TEXT,action TEXT,target_type TEXT,target_id TEXT,
      reason TEXT,prior_state TEXT,next_state TEXT,request_id TEXT,created_at INTEGER);`);
  ensureApiGrantSchema(db); ensureCatalogResearchSchema(db);
  db.prepare("INSERT INTO users(id,role,email_verified_at) VALUES ('owner','admin',?),('other','admin',?)").run(AT - 1, AT - 1);
  storeOwnerIdentity(db, ownerIdentity("owner@example.test", "owner", AT - 1));
  seedGrant(db);
  db.exec(`INSERT INTO artists(norm,name,source,rank_score) VALUES ('wet leg','Wet Leg','musicbrainz',100);
    INSERT INTO tour_dates(id,artist,artist_key,venue,date,venue_city,venue_country_code,venue_provider_id,source,
      provider_event_id,event_name,event_status,ticket_url,sold_out,event_kind)
    VALUES ('event-one','Wet Leg','wet leg','Test Hall','2027-01-01','Toronto','CA','venue-one','ticketmaster',
      'provider-one','Wet Leg Night','onsale','https://tickets.example.test/event-one',0,'concert');`);
  let clock = AT;
  const env = { ...ENABLED };
  const api = createCatalogApiService({ database: db, env, now: () => clock });
  const request = (body, idempotencyKey = "synthetic-key-0001", authorization = AUTH) => ({ authorization, body, idempotencyKey });
  const claim = (type = "artist", key = "wet leg", idem = "claim-key-0001") => {
    const page = api.read({ authorization: AUTH, type, key });
    return api.claim(request({ type, key, revision: page.revision, valueHash: page.valueHash, identityHash: page.identityHash }, idem));
  };
  const propose = (lease, patch, idem = "propose-key-0001") => api.propose(request({ type: lease.type, key: lease.key,
    nonce: lease.nonce, ...proposalInput(lease.type, patch, clock) }, idem));
  const approve = proposal => api.review({ ownerId: "owner", proposalId: proposal.id, payloadHash: proposal.payloadHash, approved: true });
  const commitInput = (lease, proposal, idem = "commit-key-0001") => request({ type: lease.type, key: lease.key,
    nonce: lease.nonce, proposalId: proposal.id, payloadHash: proposal.payloadHash }, idem);
  return { db, api, env, request, claim, propose, approve, commitInput, now: () => clock, advance: ms => { clock += ms; } };
}
export function seedGrant(db, { id = "catalog-grant", token = TOKEN, scopes = CATALOG_SCOPES, ownerId = "owner" } = {}) {
  db.prepare(`INSERT INTO api_grants(id,audience,owner_id,actor_type,actor_label,scopes,token_hash,status,issued_at,expires_at)
    VALUES (?,'pit-catalog-v1',?,'assistant','Synthetic dot',?,?,'active',?,?)`)
    .run(id, ownerId, JSON.stringify(scopes), secretHash(token), AT - 1, AT + 7 * 86_400_000);
}
export function proposalInput(type = "artist", patch, at = AT) {
  const name = type === "artist" ? "Wet Leg" : type === "venue" ? "Test Hall" : "Wet Leg Night";
  return { patch: patch || { summary: `${name} is the subject of this synthetic sourced music description used only in local automated tests.`,
    summarySources: [SOURCE], facts: [], images: [] },
    evidence: [{ url: SOURCE, title: "Synthetic fixture evidence", accessedAt: at, evidenceHash: "a".repeat(64) }] };
}
