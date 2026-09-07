import test from "node:test";
import assert from "node:assert/strict";
import { cityDateStamp, cityGalleryItems, cityShowNavigation, cityText, orderedCityPhotos, cityShowTime } from "./cityPresentation.mjs";
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
