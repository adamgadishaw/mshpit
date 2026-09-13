import assert from "node:assert/strict";
import test from "node:test";
import {
  storedBillingAllowsArtistBinding,
  storedBillingMatchesArtist,
  ticketmasterAttractionMatchesArtist,
  ticketmasterBilledArtists,
} from "./artistBillingIdentity.js";

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

test("provider billing preserves identity-bearing terminal punctuation and reviewed aliases", () => {
  assert.equal(ticketmasterAttractionMatchesArtist({ name: "Sports" }, "sports."), false);
  assert.equal(ticketmasterAttractionMatchesArtist({ name: "Sports" }, "Sports"), true);
  assert.equal(ticketmasterAttractionMatchesArtist({ name: "sports." }, "sports."), true);
  assert.equal(storedBillingMatchesArtist("ticketmaster", "music", '["Jungle","Sports"]', "sports."), false);
  assert.equal(storedBillingMatchesArtist("ticketmaster", "music", '["Jungle","sports."]', "sports."), true);
  assert.equal(ticketmasterAttractionMatchesArtist({ name: "ASAP Rocky" }, "A$AP Rocky"), true);
  assert.deepEqual(ticketmasterBilledArtists([{ name: "Sports" }, { name: "sports." }]), ["Sports", "sports."]);
});

test("provider artist bindings preserve only empty legacy billing and otherwise require exact evidence", () => {
  for (const billed of [null, "", "  ", "[]", " [ ] "]) {
    assert.equal(storedBillingAllowsArtistBinding("ticketmaster", null, billed, "Alpha"), true);
  }
  assert.equal(storedBillingAllowsArtistBinding("local", null, "{", "Alpha"), true);
  assert.equal(storedBillingAllowsArtistBinding("ticketmaster", "music", '["Alpha"]', "Alpha"), true);
  assert.equal(storedBillingAllowsArtistBinding("ticketmaster", null, '["Alpha"]', "Alpha"), false);
  assert.equal(storedBillingAllowsArtistBinding("ticketmaster", "music", '["Sports"]', "sports."), false);
  for (const billed of ["{}", "null", "{", JSON.stringify("x".repeat(16_001))]) {
    assert.equal(storedBillingAllowsArtistBinding("ticketmaster", "music", billed, "Alpha"), false);
  }
});
