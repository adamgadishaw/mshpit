import assert from "node:assert/strict";
import test from "node:test";
import { publicCityMetadata, publicEventDateLabel, publicEventMetadata, publicEventTimeLabel, publicMetadataSummary, publicVenueMetadataName } from "./publicMetadataPresentation.js";

const event = (overrides = {}) => ({ name: "River Band at Main Hall", artist: "River Band", venue: "Main Hall", place: "Toronto, ON", date: "2026-09-08", statusLabel: "scheduled", ...overrides });
const today = "2026-09-01";

test("event metadata uses the actual event, venue, city and readable calendar date without invented content", () => {
  const metadata = publicEventMetadata(event(), { today });
  assert.equal(metadata.title, "River Band at Main Hall — Sep 8, 2026 | Mshpit");
  assert.match(metadata.description, /River Band at Main Hall in Toronto, ON — Sep 8, 2026/);
  assert.doesNotMatch(metadata.description, /tickets|memories|photos|reviews|brings live music/i);
  assert.equal(publicEventMetadata(event({ name: "River Festival" }), { today }).heading, "River Festival at Main Hall — Sep 8, 2026");
});

test("cancelled, postponed and rescheduled metadata communicates the known lifecycle before the event name", () => {
  for (const [statusLabel, label] of [["cancelled", "Cancelled"], ["postponed", "Postponed"], ["rescheduled", "Rescheduled"]]) {
    const metadata = publicEventMetadata(event({ statusLabel }), { today });
    assert.ok(metadata.title.startsWith(`${label}: River Band`));
    assert.ok(metadata.description.startsWith(`${label}: River Band`));
    assert.doesNotMatch(metadata.description, /upcoming|buy tickets|brings live music/i);
  }
  assert.match(publicEventMetadata(event({ status: "https://schema.org/EventCancelled" }), { today }).title, /^Cancelled:/);
});

test("past and ongoing multi-day events are distinguished using the last supported calendar date", () => {
  assert.match(publicEventMetadata(event({ date: "2026-08-20" }), { today }).description, /Past event details/);
  assert.doesNotMatch(publicEventMetadata(event({ date: "2026-08-20", soldOut: true }), { today }).title, /Sold out/);
  const festival = event({ name: "River Festival", date: "2026-08-30", endDate: "2026-09-02" });
  assert.doesNotMatch(publicEventMetadata(festival, { today }).description, /Past event/);
  assert.match(publicEventMetadata(festival, { today }).title, /Aug 30–Sep 2, 2026/);
  assert.match(publicEventMetadata(festival, { today: "2026-09-03" }).description, /Past event details/);
});

test("metadata calendar labels preserve date-only values and valid festival ranges", () => {
  assert.equal(publicEventDateLabel("2028-02-29"), "Feb 29, 2028");
  assert.equal(publicEventDateLabel("2026-02-29"), null);
  assert.equal(publicEventDateLabel("2026-09-01", "2026-09-04"), "Sep 1–4, 2026");
  assert.equal(publicEventDateLabel("2026-12-31", "2027-01-02"), "Dec 31, 2026–Jan 2, 2027");
  assert.equal(publicEventDateLabel("2026-09-08", "2026-09-01"), "Sep 8, 2026");
  assert.equal(publicEventDateLabel("2026-09-08T20:00:00"), null);
});

test("provider local-time strings render readable times without shifting calendar zones", () => {
  assert.equal(publicEventTimeLabel("2026-09-08T20:00:00"), "8 PM");
  assert.equal(publicEventTimeLabel("2026-09-08T19:30:00"), "7:30 PM");
  assert.equal(publicEventTimeLabel("00:00:00"), "12 AM");
  assert.equal(publicEventTimeLabel("12:05"), "12:05 PM");
  assert.equal(publicEventTimeLabel("09:00"), "9 AM");
  for (const invalid of [null, "", "TBA", "24:00", "20:60", "20:00:60", "2026-02-29T20:00:00", "2026-09-08T20:00:00Z", "<script>"]) {
    assert.equal(publicEventTimeLabel(invalid), null, `unsupported local time ${invalid} must not be printed raw`);
  }
});

test("fan-memory and photo promises require the matching public projected content", () => {
  const compact = event({ name: "Band", venue: "Hall", place: "" });
  const memory = publicEventMetadata(compact, { today, posts: [{ text: "A thoughtful live review.", media: [] }] });
  assert.match(memory.description, /Read fan memories/);
  assert.doesNotMatch(memory.description, /photos/);
  const photo = publicEventMetadata(compact, { today, posts: [{ text: "", media: [{ kind: "image" }] }] });
  assert.match(photo.description, /view concert photos/);
  assert.doesNotMatch(publicEventMetadata(compact, { today, posts: [{ text: "", media: [] }] }).description, /memories|photos/);
});

test("venue metadata distinguishes cities without inventing a location", () => {
  assert.equal(publicVenueMetadataName("Main Hall", "Toronto, Ontario, Canada"), "Main Hall in Toronto, Ontario");
  assert.equal(publicVenueMetadataName("Main Hall", "Portland, Maine"), "Main Hall in Portland, Maine");
  assert.equal(publicVenueMetadataName("Toronto Music Hall", "Toronto"), "Toronto Music Hall");
  assert.equal(publicVenueMetadataName("Unlocated Hall", null), "Unlocated Hall");
});

test("empty city metadata does not advertise missing concerts, reviews, history or fan photos", () => {
  const metadata = publicCityMetadata("Toronto, Ontario");
  assert.equal(metadata.title, "Toronto, Ontario live music guide");
  assert.doesNotMatch(metadata.description, /upcoming|reviews|photos|history|venues including/i);
});

test("city metadata selects its topic and details from actual public links and editorial content", () => {
  const venue = { name: "Main Hall", path: "/venue/main-hall" };
  assert.equal(publicCityMetadata("Toronto", { venues: [venue] }).title, "Toronto live music venues & guide");
  const metadata = publicCityMetadata("Toronto", { venues: [venue], upcoming: [{ path: "/event/1" }] });
  assert.equal(metadata.title, "Toronto concerts & live music venues");
  assert.match(metadata.description, /upcoming concert listings.*Main Hall/);
  assert.doesNotMatch(metadata.description, /photos|reviews|history/);
  assert.match(publicCityMetadata("Toronto", { editorial: { history: "Documented musical history." } }, [{ kind: "fan", path: "/post/1" }]).description, /history.*fan photos/);
  assert.doesNotMatch(publicCityMetadata("Toronto", { venues: [{ name: "Unsafe", path: "//outside.example" }], today: [{ path: "javascript:alert(1)" }] }, [{ kind: "city", path: "/post/1" }]).description, /upcoming|Unsafe|fan photos/);
});

test("metadata summaries normalize whitespace and shorten at a word boundary", () => {
  assert.equal(publicMetadataSummary(" A\n\tclear\u0000description. "), "A clear description.");
  const summary = publicMetadataSummary("An accurate description of the public concert and its local music community. ".repeat(5));
  assert.ok(summary.length <= 160);
  assert.ok(summary.endsWith("…"));
  assert.doesNotMatch(summary, /[\r\n\t]/);
});
