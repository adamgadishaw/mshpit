import test from "node:test";
import assert from "node:assert/strict";
import { cityDateStamp, cityGalleryItems, cityLocalClock, cityShowNavigation, cityText, orderedCityPhotos, cityShowTime } from "./cityPresentation.mjs";
import { venuePhotoAttribution } from "../../domain/venuePhotoProvenance.mjs";
import { prepareShowNavigation } from "../../domain/showNavigation.mjs";

test("city gallery puts unique fan photos before exactly one city photo", () => {
  const gallery = orderedCityPhotos([
    { kind: "city", url: "city-a" }, { kind: "fan", url: "fan-a" },
    { kind: "fan", url: "fan-a" }, { kind: "fan", url: "fan-b" }, { kind: "city", url: "city-b" },
  ], { url: "chosen-city" });
  assert.deepEqual(gallery.map((photo) => photo.url), ["fan-a", "fan-b", "chosen-city"]);
  assert.equal(gallery.at(-1).kind, "city");
});
test("city gallery stays bounded and rejects missing or unrelated media kinds", () => {
  assert.equal(orderedCityPhotos(Array.from({ length: 30 }, (_, index) => ({ kind: "fan", url: `fan-${index}` })), { url: "city" }).length, 9);
  assert.deepEqual(orderedCityPhotos([null, {}, { kind: "private", url: "hidden" }]), []);
});
test("managed wording interpolates only known tokens and preserves an explicit empty value", () => {
  assert.equal(cityText({ title: "Welcome to {city} · {count}" }, "title", { city: "Montréal", count: 0 }), "Welcome to Montréal · 0");
  assert.equal(cityText({ title: "" }, "title", { city: "Toronto" }), "");
  assert.equal(cityText({}, "unknown"), "");
});
test("show date formatting retains the event's local clock time", () => {
  assert.match(cityShowTime({ date: "2026-09-07", startLocalTime: "20:30:00", timeZone: "Europe/Paris" }), /20:30$/);
  assert.equal(cityShowTime({ date: "unknown", startLocalTime: "18:00" }), "18:00");
});

test("city clocks support provider local datetimes without displaying the year as a time", () => {
  for (const value of ["20:30", "20:30:00", "2026-09-07T20:30:00", "2026-09-07 20:30:00", "2026-09-07T20:30:00.000"]) {
    assert.equal(cityLocalClock(value), "20:30", value);
  }
  assert.equal(cityLocalClock("00:00:00"), "00:00");
  assert.equal(cityLocalClock(" 8:05 "), "08:05");
  for (const timeZone of ["Pacific/Auckland", "America/Toronto", "Europe/Paris"]) {
    for (const suffix of ["", "Z", "-04:00", "+1300"]) {
      const show = { date: "2026-09-07", startLocalTime: `2026-09-07T20:30:00${suffix}`, timeZone };
      assert.match(cityShowTime(show), /20:30$/);
      assert.equal(cityLocalClock(show.startLocalTime), "20:30", "preserve the supplied venue clock, not the viewer's timezone");
    }
  }
});

test("date-only and malformed local-time values never become misleading clock labels", () => {
  for (const value of [null, undefined, 2026, {}, "", "2026-09-07", "TBA", "2026-", "24:00", "12:60", "12:30:99", "2026-02-31T19:00:00", "2026-09-07T19:00:00junk", "before 19:00", "2026-09-07T19:00:00+99:00"]) {
    assert.equal(cityLocalClock(value), "", String(value));
  }
  assert.equal(cityShowTime({ date: "2026-02-31", startLocalTime: "19:00" }), "19:00");
  assert.doesNotMatch(cityShowTime({ date: "2026-09-07", startLocalTime: "2026-09-07" }), /2026-/);
});
test("ticket date stubs preserve local dates and reject impossible calendar dates", () => {
  assert.deepEqual(cityDateStamp("2026-09-07"), { month: "SEP", day: "07", year: "2026" });
  assert.equal(cityDateStamp("2026-02-31"), null);
  assert.equal(cityDateStamp("TBA"), null);
});
test("city gallery preserves credits, source, and license for full-screen photos", () => {
  const [photo] = cityGalleryItems([{ url: "https://images.mshpit.com/city.jpg", kind: "city", alt: "Toronto skyline", credit: "City photographer", sourceUrl: "https://commons.wikimedia.org/wiki/File:City.jpg", licenseUrl: "https://creativecommons.org/licenses/by/4.0/" }]);
  assert.equal(photo.altText, "Toronto skyline");
  assert.equal(venuePhotoAttribution(photo)?.creator, "City photographer");
  assert.equal(venuePhotoAttribution(photo)?.license, "CC BY 4.0");
});
test("city show navigation keeps provider events out of post routes and preserves location", () => {
  const show = cityShowNavigation({ id: "tm-123", artist: "Artist", venue: "Venue", url: "https://tickets.example.com/event" }, { city: "Toronto", countryCode: "CA" });
  assert.equal(prepareShowNavigation(show).kind, "performance");
  assert.equal(show.tourDateId, "tm-123");
  assert.equal(show.city, "Toronto");
  assert.equal(show.ticketUrl, "https://tickets.example.com/event");
});
