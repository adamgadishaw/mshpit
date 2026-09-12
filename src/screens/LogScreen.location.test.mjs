import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./LogScreen.jsx", import.meta.url), "utf8");
const eligibility = source.match(/: (artist\.trim\(\).*computed\.overall > 0);/u)?.[1];
assert.ok(eligibility, "The in-person composer exposes its actual eligibility expression");
const canPost = new Function("artist", "venue", "city", "eventAddress", "computed", `return !!(${eligibility});`);

test("in-person composer accepts city without venue but never accepts address alone", () => {
  assert.equal(canPost("Artist", "", "Toronto, Ontario, Canada", "", { overall: 4 }), true);
  assert.equal(canPost("Artist", "", "Toronto, Ontario, Canada", "123 Main Street", { overall: 4 }), true);
  assert.equal(canPost("Artist", "Unknown room", "", "", { overall: 4 }), true);
  assert.equal(canPost("Artist", "", "", "123 Main Street", { overall: 4 }), false);
  assert.equal(canPost("Artist", "Room", "", "123 Main Street", { overall: 4 }), false);
  assert.equal(canPost("Artist", "", "", "", { overall: 4 }), false);
  assert.equal(canPost("", "", "Toronto", "", { overall: 4 }), false);
  assert.equal(canPost("Artist", "", "Toronto", "", { overall: 0 }), false);
});

test("address participates in edit hydration, checkpointing, recovery and in-person submit only", () => {
  assert.match(source, /editing\?\.eventAddress \|\| editing\?\.event_address \|\| prefill\?\.eventAddress/u);
  const draft = source.slice(source.indexOf("const currentDraft = useMemo"), source.indexOf("const draftFingerprint"));
  assert.match(draft, /city,\s+eventAddress,/u);
  assert.match(draft, /venue, city, eventAddress, tour/u);
  assert.match(source, /setEventAddress\(restored\.eventAddress \|\| ""\)/u);
  assert.match(source, /venue: venue\.trim\(\),\s+city: city\.trim\(\),\s+eventAddress: eventAddress\.trim\(\)/u);
  const submit = source.slice(source.indexOf("...(isOnlineReview ? {"), source.indexOf("media: publishedMedia,"));
  const online = submit.slice(0, submit.indexOf("} : {"));
  assert.equal(online.includes("eventAddress"), false);
});

test("venue selection preserves region and country and city input is separate from venue identity", () => {
  assert.match(source, /setCity\(hit\.place \|\| ""\)/u);
  assert.doesNotMatch(source, /setCity\(\(hit\.place \|\| ""\)\.split/u);
  assert.match(source, /<ConcertLocationFields city=\{city\} eventAddress=\{eventAddress\} onCityChange=\{setCity\} onEventAddressChange=\{setEventAddress\}/u);
  assert.match(source, /readCities=\{readCityDirectory\}/u);
});
