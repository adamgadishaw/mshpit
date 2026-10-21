import test from "node:test";
import assert from "node:assert/strict";
import { snapshotVenueMapSelection, reconcileVenueMapSelection } from "./venueMapSelection.mjs";
const room = (id, extra = {}) => ({ id, name: "Fixture Room", place: "Toronto, Ontario, Canada", ...extra });

test("stable selected id survives refreshed objects without changing its qualified locality", () => {
  const snapshot = snapshotVenueMapSelection(room("stable"));
  assert.equal(reconcileVenueMapSelection([room("other"), room("stable")], snapshot), "stable");
  assert.equal(reconcileVenueMapSelection([room("stable", { place: "Paris, France" })], snapshot), null);
});

test("provider alias recovers the same room after catalogue hydration changes its id", () => {
  const snapshot = snapshotVenueMapSelection(room("provider:ticketmaster:room", { source: "ticketmaster", providerVenueId: "room", providerIdentities: ["provider:ticketmaster:room"] }));
  assert.equal(reconcileVenueMapSelection([room("catalogue:fixture", { providerIdentities: ["provider:ticketmaster:room"] })], snapshot), "catalogue:fixture");
  assert.equal(reconcileVenueMapSelection([room("wrong-city", { providerIdentities: ["provider:ticketmaster:room"], place: "Paris, France" })], snapshot), null);
});

test("unique exact qualified name and place recovers a row without provider aliases", () => {
  const snapshot = snapshotVenueMapSelection(room("old"));
  assert.equal(reconcileVenueMapSelection([room("new", { name: "  FIXTURE   ROOM ", place: "Toronto,  Ontario, Canada" }), room("elsewhere", { place: "London, England, United Kingdom" })], snapshot), "new");
  assert.equal(reconcileVenueMapSelection([room("unqualified", { place: "Toronto" })], snapshot), null);
});

test("ambiguous ids, provider aliases and name/place matches are never guessed", () => {
  assert.equal(reconcileVenueMapSelection([room("same"), room("same")], snapshotVenueMapSelection(room("same"))), null);
  const snapshot = snapshotVenueMapSelection(room("old", { providerIdentities: ["provider:fixture:room"] }));
  assert.equal(reconcileVenueMapSelection([room("a", { providerIdentities: ["provider:fixture:room"] }), room("b", { providerIdentities: ["provider:fixture:room"] })], snapshot), null);
  assert.equal(reconcileVenueMapSelection([room("a"), room("b")], snapshotVenueMapSelection(room("old"))), null);
});

test("city-only, absent-place and fuzzy names cannot recover a different row", () => {
  assert.equal(reconcileVenueMapSelection([room("new", { place: "Toronto" })], snapshotVenueMapSelection(room("old", { place: "Toronto" }))), null);
  assert.equal(reconcileVenueMapSelection([room("new", { place: "" })], snapshotVenueMapSelection(room("old", { place: "" }))), null);
  assert.equal(reconcileVenueMapSelection([room("new", { name: "The Fixture Room" })], snapshotVenueMapSelection(room("old"))), null);
  assert.equal(reconcileVenueMapSelection([room("new", { name: "Sond Room" })], snapshotVenueMapSelection(room("old", { name: "Sönd Room" }))), null);
});

test("provider source casing can normalize while opaque provider id casing never changes", () => {
  const snapshot = snapshotVenueMapSelection(room("old", { source: "Ticketmaster", providerVenueId: "KovZ917A-EJ", identity: "provider:ticketmaster:kovz917a-ej" }));
  assert.deepEqual(snapshot.providerIdentities, ["provider:ticketmaster:KovZ917A-EJ"]);
  const exact = room("correct", { source: "ticketmaster", providerVenueId: "KovZ917A-EJ" });
  const different = room("different", { source: "ticketmaster", providerVenueId: "KovZ917A-Ej" });
  assert.equal(reconcileVenueMapSelection([exact, different], snapshot), "correct");
  assert.equal(reconcileVenueMapSelection([different], snapshot), null);
});
