import assert from "node:assert/strict";
import test from "node:test";
import { fixture, AUTH, AT, SOURCE, proposalInput } from "../catalogApi/catalogApiFixture.mjs";
import { createCatalogApiService } from "../catalogApi/catalogApiService.js";
import { catalogPhotoOptions } from "./catalogPhotoAttachments.js";
import { readCatalogEntity } from "../catalogApi/catalogApiInventory.js";
import { readPublicCatalogResearch } from "./catalogPublicResearch.js";

const photo = { uri: `https://images.example.test/venues/licensed/test-hall/${"a".repeat(48)}.webp`,
  title: "Synthetic Test Hall exterior", creator: "Synthetic photographer", license: "CC-BY-4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/", source: "commons",
  sourcePage: "https://commons.wikimedia.org/wiki/File:Synthetic_Test_Hall.jpg",
  modificationNotice: "Converted to WebP and resized by Mshpit." };

test("licensed attachment commits bind identity, complete provenance and safe existing delivery without fetch", t => {
  const f = fixture(t); let current = photo, outbound = 0;
  t.mock.method(globalThis, "fetch", () => { outbound++; throw Error("No external requests permitted"); });
  const photoOptions = { venuePhotos: (_name, options) => { assert.equal(options.providerVenueId, "venue-one"); return current ? [current] : []; } };
  const api = createCatalogApiService({ database: f.db, env: f.env, now: f.now, photoOptions });
  const page = api.read({ authorization: AUTH, type: "venue", key: "test hall|toronto|ca" });
  assert.equal(page.photoOptions.length, 1);
  const lease = f.claim("venue", page.key);
  const input = proposalInput("venue");
  input.patch.attachments = [{ sourcePage: photo.sourcePage, assetHash: page.photoOptions[0].assetHash }];
  input.evidence.push({ url: photo.sourcePage, title: "Synthetic license evidence", accessedAt: AT, evidenceHash: "b".repeat(64) });
  const proposal = api.propose(f.request({ type: "venue", key: page.key, nonce: lease.nonce, ...input }, "photo-propose"));
  f.approve(proposal);
  current = { ...photo, creator: "Changed creator" };
  assert.throws(() => api.commit(f.commitInput(lease, proposal)), error => error.status === 409);
  current = photo; api.commit(f.commitInput(lease, proposal));
  const read = () => readPublicCatalogResearch(f.db, { type: "venue", key: page.key, at: AT, photoOptions });
  assert.equal(read().attachments[0].creator, photo.creator);
  assert.equal(read().attachments[0].licenseUrl, photo.licenseUrl);
  current = null; assert.deepEqual(read().attachments, [], "rights removal hides the attachment on the next read");
  f.db.exec("UPDATE tour_dates SET venue_provider_id='changed-identity'");
  assert.equal(read(), null, "identity change hides old text and photos");
  assert.equal(outbound, 0);
});

test("photos reject arbitrary URLs, unsupported licenses, unknown identities, and event attachments", t => {
  const f = fixture(t), page = readCatalogEntity(f.db, { type: "venue", key: "test hall|toronto|ca", at: AT });
  for (const altered of [{ ...photo, uri: "https://example.test/photo.jpg" }, { ...photo, license: "all-rights-reserved" },
    { ...photo, modificationNotice: null }, { ...photo, sourcePage: "https://example.test/source" }]) {
    assert.deepEqual(catalogPhotoOptions(page, { venuePhotos: () => [altered] }), []);
  }
  const event = f.claim("event", "event-one");
  assert.throws(() => f.propose(event, { ...proposalInput("event").patch, attachments: [{ sourcePage: photo.sourcePage, assetHash: "a".repeat(64) }] }),
    error => error.status === 400);
});

test("public research hides unbound, protected, ineligible, hidden and identity-stale content", t => {
  const f = fixture(t), lease = f.claim(), proposal = f.propose(lease);
  f.approve(proposal); f.api.commit(f.commitInput(lease, proposal));
  const read = () => readPublicCatalogResearch(f.db, { type: "artist", key: "wet leg", at: AT });
  assert.ok(read()?.summary);
  f.db.exec("UPDATE artists SET bio='Existing biography must remain intact'"); assert.equal(read(), null);
  f.db.exec("UPDATE artists SET bio=NULL,mbid='changed'"); assert.equal(read(), null);
  f.db.exec("UPDATE artists SET mbid=NULL"); assert.ok(read());
  const unbound = { version: 1, summary: "Wet Leg is an unbound synthetic description that must not be adopted by a different identity.", summarySources: [SOURCE], facts: [], images: [] };
  f.db.prepare("UPDATE catalog_research SET findings=?").run(JSON.stringify(unbound)); assert.equal(read(), null);
});
