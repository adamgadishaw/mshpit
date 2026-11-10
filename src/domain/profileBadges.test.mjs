import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { canonicalProfileBadges, displayedProfileBadges, toggleProfileBadge, profileBadgesSaveConfirmed } from "./profileBadges.mjs";
import { publicProfileCacheEntry } from "./dataPolicy.mjs";

test("default includes future awards while explicit selection and hide-all do not", () => {
  const earned = ["verified", "email-confirmed"];
  assert.deepEqual(displayedProfileBadges(earned, undefined), earned);
  assert.deepEqual(displayedProfileBadges(earned, null), earned);
  assert.deepEqual(displayedProfileBadges(earned, ["email-confirmed"]), ["email-confirmed"]);
  assert.deepEqual(displayedProfileBadges([...earned, "sponsor"], []), []);
  assert.deepEqual(displayedProfileBadges([...earned, "sponsor"], ["email-confirmed"]), ["email-confirmed"]);
});

test("selection never grants a badge and revoked or superseded awards stop displaying", () => {
  assert.deepEqual(displayedProfileBadges(["email-confirmed"], ["staff", "verified"]), []);
  assert.deepEqual(displayedProfileBadges(["first-wave"], ["email-confirmed"]), []);
  assert.deepEqual(displayedProfileBadges([], ["verified"]), []);
  assert.deepEqual(displayedProfileBadges(["made-up", "verified", "verified"], null), ["verified"]);
});

test("invalid IDs, duplicate IDs, malformed values and prototype names are rejected", () => {
  for (const value of ["verified", {}, false, ["invented"], ["toString"], ["__proto__"], [null], ["verified", "verified"]]) {
    assert.equal(canonicalProfileBadges(value), undefined);
    assert.deepEqual(displayedProfileBadges(["verified"], value), []);
  }
  const input = ["verified", "email-confirmed"];
  assert.deepEqual(canonicalProfileBadges(input), ["email-confirmed", "verified"]);
  assert.deepEqual(input, ["verified", "email-confirmed"]);
});

test("repeated toggles are stable, cannot add unearned IDs, and never mutate inputs", () => {
  const earned = ["verified", "email-confirmed"];
  const once = toggleProfileBadge(null, "verified", earned);
  assert.deepEqual(once, ["email-confirmed"]);
  assert.deepEqual(toggleProfileBadge(once, "verified", earned), ["email-confirmed", "verified"]);
  assert.deepEqual(once, ["email-confirmed"]);
  assert.equal(toggleProfileBadge(once, "staff", earned), once);
  assert.deepEqual(toggleProfileBadge([], "email-confirmed", earned), ["email-confirmed"]);
});

test("public cache preserves explicit empty/reset choices without private capability or account data", () => {
  for (const selection of [null, [], ["verified"]]) {
    const cached = publicProfileCacheEntry({ id: "a", profileBadges: selection, profileBadgeSelectionSupported: true, email: "private@example.test" });
    assert.deepEqual(cached, { id: "a", profileBadges: selection });
  }
  assert.deepEqual(publicProfileCacheEntry({ id: "a", profileBadges: ["invented"] }), { id: "a" });
});

test("receipt requires supported server, exact canonical value, and explicit clear acknowledgement", () => {
  for (const requested of [null, [], ["verified"]]) {
    assert.equal(profileBadgesSaveConfirmed({ profileBadgeSelectionSupported: true, profileBadges: requested }, requested), true);
    assert.equal(profileBadgesSaveConfirmed({}, requested), false);
    assert.equal(profileBadgesSaveConfirmed({ profileBadgeSelectionSupported: true }, requested), false);
    assert.equal(profileBadgesSaveConfirmed({ profileBadges: requested }, requested), false);
  }
  assert.equal(profileBadgesSaveConfirmed({ profileBadgeSelectionSupported: true, profileBadges: null }, []), false);
});

test("the shared web/Android profile renderer apply the preference without changing global badge eligibility", () => {
  for (const path of ["../screens/ProfileScreen.jsx"]) {
    assert.match(readFileSync(new URL(path, import.meta.url), "utf8"), /badges=\{displayedProfileBadges\(userBadges\(user\), user.profileBadges\)\}/u);
  }
  const store = readFileSync(new URL("../store.js", import.meta.url), "utf8");
  const eligibility = store.slice(store.indexOf("  const userBadges ="), store.indexOf("  // --- Gamification"));
  assert.doesNotMatch(eligibility, /profileBadges/u);
});
