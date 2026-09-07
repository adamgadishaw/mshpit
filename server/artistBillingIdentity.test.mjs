import assert from "node:assert/strict";
import test from "node:test";
import { storedBillingMatchesArtist, ticketmasterAttractionMatchesArtist, ticketmasterBilledArtists } from "./artistBillingIdentity.js";

test("exact billed identity and a verified joint attraction resolve individual performers", () => {
  const joint = { id: "K8vZ917LxIV", name: "USHER RAYMOND & CHRIS BROWN" };
  assert.equal(ticketmasterAttractionMatchesArtist(joint, "Chris Brown"), true);
  assert.equal(ticketmasterAttractionMatchesArtist(joint, "Usher"), true);
  assert.equal(ticketmasterAttractionMatchesArtist({ name: "USHER RAYMOND" }, "Usher"), true);
  assert.deepEqual(ticketmasterBilledArtists([joint]), [joint.name, "Usher", "Chris Brown"]);
  assert.equal(ticketmasterAttractionMatchesArtist({ ...joint, id: "unknown" }, "Usher"), false);
  assert.equal(ticketmasterAttractionMatchesArtist({ name: "Chris Brown tribute" }, "Chris Brown"), false);
  assert.equal(ticketmasterAttractionMatchesArtist({ name: "Usher & Somebody" }, "Usher"), false);
});

test("stored billing is bounded and fails closed for malformed or unsupported evidence", () => {
  assert.equal(storedBillingMatchesArtist("ticketmaster", "music", '["Beta","Alpha"]', "Alpha"), true);
  assert.equal(storedBillingMatchesArtist("ticketmaster", "music", '["Alpha tribute"]', "Alpha"), false);
  assert.equal(storedBillingMatchesArtist("ticketmaster", null, '["Alpha"]', "Alpha"), false);
  assert.equal(storedBillingMatchesArtist("unknown", "music", '["Alpha"]', "Alpha"), false);
  assert.equal(storedBillingMatchesArtist("ticketmaster", "music", "{", "Alpha"), false);
  assert.equal(storedBillingMatchesArtist("ticketmaster", "music", JSON.stringify([...Array(20).fill("Other"), "Alpha"]), "Alpha"), false);
});
