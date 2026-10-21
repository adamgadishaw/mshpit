import test from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { createVenueMapCatalogueResponse, venueMapCatalogueResponsePayload } from "./venueMapCatalogueResponse.mjs";

const fixture = () => Object.freeze({ complete: true, venueMapCatalogue: true, tourDates: [], eventCount: 0, venueCount: 0, pages: 1, fetchedAt: "2026-10-21T14:00:00Z" });

test("only registered complete immutable snapshots use the map byte-response path", async () => {
  assert.equal(venueMapCatalogueResponsePayload({ bytes: Buffer.from("untrusted") }), null);
  for (const value of [null, {}, { ...fixture() }, Object.freeze({ ...fixture(), complete: false })]) {
    await assert.rejects(createVenueMapCatalogueResponse(value), /complete immutable/);
  }
});

test("snapshot compression is shared, JSON remains exact, and HTTP cannot extend its source clock", async () => {
  const projection = fixture();
  const [first, second] = await Promise.all([createVenueMapCatalogueResponse(projection), createVenueMapCatalogueResponse(projection)]);
  assert.equal(first, second);
  const raw = venueMapCatalogueResponsePayload(first), compressed = venueMapCatalogueResponsePayload(first, "gzip, deflate, br");
  assert.deepEqual(JSON.parse(raw.bytes), projection);
  assert.deepEqual(gunzipSync(compressed.bytes), raw.bytes);
  for (const result of [raw, compressed]) {
    assert.equal(result.status, 200); assert.equal(result.headers["Cache-Control"], "no-store");
    assert.equal(result.headers.Vary, "Accept-Encoding"); assert.equal(Number(result.headers["Content-Length"]), result.bytes.length);
  }
  assert.equal(compressed.headers["Content-Encoding"], "gzip");
  assert.equal(raw.headers["Content-Encoding"], undefined);
});

test("encoding quality, explicit exclusions and unacceptable encodings are honored", async () => {
  const response = await createVenueMapCatalogueResponse(fixture());
  for (const header of ["gzip;q=0", "GZIP;q=0, *;q=1", "gzip;q=0.1, identity;q=1", "gzip;q=invalid", "br"]) {
    assert.equal(venueMapCatalogueResponsePayload(response, header).headers["Content-Encoding"], undefined, header);
  }
  for (const header of ["GZIP", "*;q=1", "identity;q=0, gzip;q=0.5"]) {
    assert.equal(venueMapCatalogueResponsePayload(response, header).headers["Content-Encoding"], "gzip", header);
  }
  assert.equal(venueMapCatalogueResponsePayload(response, "identity;q=0,gzip;q=0").status, 406);
});

test("oversized complete snapshots fail closed before compression", async () => {
  await assert.rejects(createVenueMapCatalogueResponse(Object.freeze({ ...fixture(), tourDates: [{ text: "x".repeat(12 * 1024 * 1024) }] })), /byte budget/);
});
