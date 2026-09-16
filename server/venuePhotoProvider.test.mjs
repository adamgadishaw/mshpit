import assert from "node:assert/strict";
import test from "node:test";
import { lookupVenuePhoto } from "./venuePhotoProvider.js";

const at = 1_800_000_000_000;
const venue = { name: "Fixture Concert Hall", city: "Toronto", country: "CA",
  place: "Toronto, Ontario, Canada", lat: 43.6, lng: -79.3 };
const page = {
  title: "File:Fixture Concert Hall entrance Toronto.jpg",
  imageinfo: [{ mime: "image/jpeg", url: "https://upload.wikimedia.org/fixture.jpg",
    thumburl: "https://upload.wikimedia.org/thumb/fixture.jpg/1280px-fixture.jpg",
    descriptionurl: "https://commons.wikimedia.org/wiki/File:Fixture_Concert_Hall.jpg",
    extmetadata: {
      ImageDescription: { value: "Fixture Concert Hall exterior building in Toronto" },
      Artist: { value: "<a>Fixture Photographer</a>" },
      LicenseShortName: { value: "CC BY 4.0" },
      LicenseUrl: { value: "https://creativecommons.org/licenses/by/4.0/" },
    } }],
};
const payload = (entry = page) => ({ batchcomplete: "", query: { pages: { 1: entry } } });
const fetchJson = (body, options = {}) => async () => new Response(JSON.stringify(body), options);

test("verified structural photos preserve exact source and reusable rights with bounded requests", async () => {
  const result = await lookupVenuePhoto(venue, { fetchImpl: async (url, options) => {
    assert.equal(url.origin, "https://commons.wikimedia.org");
    assert.equal(url.searchParams.get("maxlag"), "5");
    assert.equal(url.searchParams.get("gsrlimit"), "12");
    assert.equal(url.searchParams.get("iiurlwidth"), "1280");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(JSON.stringify(payload()));
  } });
  assert.equal(result.creator, "Fixture Photographer");
  assert.equal(result.license, "CC-BY-4.0");
  assert.equal(result.provenanceSource, "commons");
  assert.equal(result.uri, page.imageinfo[0].thumburl);
});

test("genuine empty generator results differ from malformed provider responses", async () => {
  assert.equal(await lookupVenuePhoto(venue, { fetchImpl: fetchJson({ batchcomplete: "" }) }), null);
  assert.equal(await lookupVenuePhoto(venue, { fetchImpl: fetchJson({ query: { pages: {} } }) }), null);
  for (const body of [null, [], {}, { query: {} }, { query: { pages: [] } }, { query: { pages: { 1: {} } } },
    { batchcomplete: "", warnings: { search: "temporary error" } }]) {
    await assert.rejects(lookupVenuePhoto(venue, { fetchImpl: fetchJson(body), now: () => at }), { code: "invalid_response" });
  }
});

test("HTTP and maxlag failures respect bounded Retry-After cooldowns", async () => {
  for (const options of [
    { status: 429, headers: { "retry-after": "7200" } },
    { status: 503, headers: { "retry-after": new Date(at + 7200_000).toUTCString() } },
    { status: 200, headers: { "retry-after": "7200" } },
  ]) {
    await assert.rejects(lookupVenuePhoto(venue, {
      fetchImpl: fetchJson({ error: { code: "maxlag" } }, options), now: () => at,
    }), error => error.retryAt === at + 7200_000);
  }
  await assert.rejects(lookupVenuePhoto(venue, {
    fetchImpl: fetchJson({}, { status: 429, headers: { "retry-after": "9999999999" } }), now: () => at,
  }), error => error.retryAt === at + 86400_000);
});

test("response byte and page ceilings fail rather than produce no-photo conclusions", async () => {
  await assert.rejects(lookupVenuePhoto(venue, {
    fetchImpl: fetchJson({ noise: "x".repeat(513 * 1024) }),
  }), { code: "response_too_large" });
  await assert.rejects(lookupVenuePhoto(venue, { fetchImpl: fetchJson({
    query: { pages: Object.fromEntries(Array.from({ length: 13 }, (_, n) => [n, page])) },
  }) }), /page bound/);
});

test("wrong subjects, locations, source hosts and incomplete rights never become profile photos", async () => {
  const variants = [
    { ...page, title: "File:Singer at Fixture Concert Hall Toronto.jpg" },
    { ...page, title: "File:Fixture Concert Hall entrance Ottawa.jpg",
      imageinfo: [{ ...page.imageinfo[0], extmetadata: { ...page.imageinfo[0].extmetadata,
        ImageDescription: { value: "Fixture Concert Hall exterior building in Ottawa" } } }] },
    { ...page, imageinfo: [{ ...page.imageinfo[0], thumburl: "https://unapproved.example/fixture.jpg" }] },
    { ...page, imageinfo: [{ ...page.imageinfo[0], descriptionurl: "https://unapproved.example/source" }] },
    { ...page, imageinfo: [{ ...page.imageinfo[0], extmetadata: { ...page.imageinfo[0].extmetadata,
      Artist: { value: "unknown" } } }] },
    { ...page, imageinfo: [{ ...page.imageinfo[0], extmetadata: { ...page.imageinfo[0].extmetadata,
      LicenseShortName: { value: "All rights reserved" } } }] },
  ];
  for (const variant of variants) {
    assert.equal(await lookupVenuePhoto(venue, { fetchImpl: fetchJson(payload(variant)) }), null);
  }
});

test("caller cancellation is preserved and does not turn into no match", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(lookupVenuePhoto(venue, {
    signal: controller.signal, fetchImpl: fetchJson(payload()),
  }), { name: "AbortError" });
});
