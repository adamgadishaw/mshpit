import assert from "node:assert/strict";
import test from "node:test";
import { projectCityGuideDocument, projectCityDirectoryDocument } from "./cityGuideDocument.js";
import { renderPublicDocumentMain, renderPublicDocumentHead } from "./publicDocumentRenderer.js";
import { DEFAULT_CITY_COPY } from "../cities/cityCopy.js";
import { cityPath, parseCityPath } from "../../../src/domain/urls.mjs";

const city = { city: "Toronto", citySlug: "toronto", countryCode: "CA", country: "Canada" };
const guide = (overrides = {}) => ({ city, copy: DEFAULT_CITY_COPY, editorial: {}, photos: [], venues: [], artists: [], today: [], upcoming: [], ...overrides });

test("city routes use explicit countries, canonical slugs, and no extra path segments", () => {
  assert.equal(cityPath(city), "/city/ca/toronto");
  assert.deepEqual(parseCityPath("/City/CA/Toronto?from=search"), { countryCode: "ca", citySlug: "toronto" });
  assert.equal(parseCityPath("/city/ca/toronto/more"), null);
  assert.equal(parseCityPath("/city/ca/%2e%2e"), null);
});
test("city documents keep public fan photos first and only one stock image", () => {
  const doc = projectCityGuideDocument(guide({ venues: [{ name: "RBC Amphitheatre", path: "/venue/rbc-amphitheatre" }],
    photos: [{kind:"city",url:"/images/cities/ca-toronto.webp",credit:"Photographer",sourceUrl:"https://commons.wikimedia.org/wiki/File:Toronto.jpg",licenseUrl:"https://creativecommons.org/licenses/by/4.0"},
      {kind:"fan",url:"https://cdn.mshpit.com/verified.webp"}, {kind:"city",url:"https://cdn.mshpit.com/extra.webp"}] }));
  assert.equal(doc.canonicalPath, "/city/ca/toronto");
  assert.equal(doc.indexable, true);
  assert.equal(doc.image, "https://cdn.mshpit.com/verified.webp");
  assert.equal(doc.cityGuide.photos.length, 2);
  assert.match(renderPublicDocumentMain(doc), /Photo license/);
  assert.match(renderPublicDocumentHead(doc), /index,follow/);
});
test("empty city shells stay noindex; real history or venues permit indexing", () => {
  const empty = projectCityGuideDocument(guide());
  assert.equal(empty.indexable, false);
  assert.match(renderPublicDocumentHead(empty), /noindex,follow/);
  assert.equal(empty.title, "Toronto live music guide | Mshpit");
  assert.doesNotMatch(empty.description, /upcoming|reviews|photos|history/i);
  assert.equal(projectCityGuideDocument(guide({editorial:{history:"A documented city music history with original researched context. ".repeat(3)}})).indexable, true);
});

test("default city metadata describes available venues and concerts without inventing community content", () => {
  const venue = { name: "Main Hall", path: "/venue/main-hall" };
  const venues = projectCityGuideDocument(guide({ venues: [venue] }));
  assert.equal(venues.title, "Toronto live music venues & guide | Mshpit");
  assert.match(venues.description, /Main Hall/);
  assert.doesNotMatch(venues.description, /upcoming|reviews|photos|history/i);
  const shows = projectCityGuideDocument(guide({ venues: [venue], upcoming: [{ artist: "Band", path: "/event/1" }] }));
  assert.equal(shows.title, "Toronto concerts & live music venues | Mshpit");
  assert.match(shows.description, /upcoming concert listings/);
  assert.doesNotMatch(shows.description, /reviews|photos|history/i);
});

test("managed default city copy remains authoritative over evidence-aware fallback metadata", () => {
  const doc = projectCityGuideDocument(guide({ copy: { ...DEFAULT_CITY_COPY,
    citySeoTitle: "{city} independent music guide", citySeoDescription: "The edited guide to {city}." },
    venues: [{ name: "Main Hall", path: "/venue/main-hall" }],
  }));
  assert.equal(doc.title, "Toronto independent music guide | Mshpit");
  assert.equal(doc.description, "The edited guide to Toronto.");
  assert.equal(doc.indexable, true);
});
test("city HTML escapes moderation content and does not invent incomplete Event objects", () => {
  const doc = projectCityGuideDocument(guide({ editorial: {title:'<script>alert("x")</script>',history:"<img src=x onerror=alert(1)>"},
    venues:[{name:"Hall",path:"/venue/hall"}], today:[{id:"e",artist:"Band",path:"/event/e",date:"2026-09-07",venue:"Hall"}],
    artists:[{name:"Artist",path:"javascript:alert(1)"}] }));
  const html = renderPublicDocumentMain(doc);
  assert.doesNotMatch(html, /<script|<img src=x|href="javascript:/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(JSON.stringify(doc.jsonLd), /"@type":"(?:MusicEvent|Event)"/);
  assert.match(html, /href="\/event\/e"/);
});
test("cities directory produces crawlable city links and managed descriptions", () => {
  const doc = projectCityDirectoryDocument({cities:[{...city,venueCount:4,upcomingCount:2}],copy:{...DEFAULT_CITY_COPY,citiesDescription:"Edited directory description"}});
  assert.equal(doc.canonicalPath, "/cities");
  assert.equal(doc.description, "Edited directory description");
  assert.match(renderPublicDocumentMain(doc), /href="\/city\/ca\/toronto"/);
  assert.equal(doc.jsonLd[0].mainEntity.numberOfItems, 1);
});

test("city metadata stays short without truncating moderator introduction in page content", () => {
  const intro = "A complete first-hand introduction. ".repeat(25) + "Last paragraph detail.";
  const doc = projectCityGuideDocument(guide({ editorial: { intro } }));
  assert.equal(doc.description.length, 300);
  assert.match(renderPublicDocumentMain(doc), /Last paragraph detail\./);
});

test("city search metadata is independently editable without changing visible programme copy", () => {
  const doc = projectCityGuideDocument(guide({ editorial: {
    title: "Toronto, on stage", intro: "The full city introduction stays on the page.",
    seoTitle: "Toronto concerts and live music venues", seoDescription: "Find Toronto shows, concert venues and the city's music history.",
  } }));
  assert.equal(doc.title, "Toronto concerts and live music venues | Mshpit");
  assert.equal(doc.heading, "Toronto, on stage");
  assert.equal(doc.description, "Find Toronto shows, concert venues and the city's music history.");
  assert.match(renderPublicDocumentMain(doc), /<h1>Toronto, on stage<\/h1>/);
  assert.match(renderPublicDocumentMain(doc), /The full city introduction stays on the page/);
  const fallback = projectCityGuideDocument(guide({ copy: { ...DEFAULT_CITY_COPY, citySeoTitle: "{city} gigs and music venues" } }));
  assert.equal(fallback.title, "Toronto gigs and music venues | Mshpit");
});

test("city programme is artist-led, formats managed headings and links public gallery reviews", () => {
  const doc = projectCityGuideDocument(guide({
    copy: { ...DEFAULT_CITY_COPY, todayTitle: "Concerts in {city} today", openReview: "Read this review" },
    today: [{ artist: "J. Cole", eventName: "Festival set", path: "/event/concert1", venue: "Scotiabank Arena", venuePath: "/venue/arena", date: "2026-09-07", startLocalTime: "2026-09-07T20:00:00" }],
    photos: [{ kind: "fan", url: "/media/concert.webp", alt: "J. Cole at Scotiabank Arena", path: "/post/review1" }],
  }));
  const html = renderPublicDocumentMain(doc);
  assert.match(html, /<h2>Concerts in Toronto today<\/h2>/);
  assert.match(html, /<h3><a href="\/event\/concert1">J\. Cole<\/a><\/h3><p>Festival set<\/p>/);
  assert.match(html, /href="\/post\/review1" aria-label="Read this review: J\. Cole at Scotiabank Arena"/);
  assert.match(html, /href="\/venue\/arena"/);
  assert.match(html, /Scotiabank Arena<\/a> · 8 PM/);
  assert.doesNotMatch(html, /2026-09-07T20:00:00/);
  assert.match(html, /fetchpriority="high"/);
  assert.equal(doc.imageAlt, "J. Cole at Scotiabank Arena");
  assert.equal((html.match(/<h1>/g) || []).length, 1);
});

test("city schemas distinguish regions and cite researched sources without fake review or event data", () => {
  const doc = projectCityGuideDocument(guide({ city: { city: "Portland", region: "Maine", countryCode: "US", country: "United States", citySlug: "portland-maine" },
    editorial: { history: "Documented history. ".repeat(10), sources: [
      { title: "Official city guide", url: "https://example.org/music" },
      { title: "Unsafe", url: "javascript:alert(1)" },
    ] },
  }));
  assert.equal(doc.jsonLd[0].about.containedInPlace.name, "Maine");
  assert.equal(doc.jsonLd[0].about.containedInPlace.containedInPlace.name, "United States");
  assert.deepEqual(doc.jsonLd[0].citation, ["https://example.org/music"]);
  assert.equal(doc.jsonLd[0].about["@id"], "https://www.mshpit.com/city/us/portland-maine#city");
  assert.doesNotMatch(JSON.stringify(doc.jsonLd), /aggregateRating|"@type":"(?:MusicEvent|Event)"/);
});

test("city photo anchors reject untrusted destinations and retain actual photograph alt text", () => {
  const doc = projectCityGuideDocument(guide({ photos: [
    { kind: "fan", url: "/media/photo.webp", alt: "<stage>", path: "//outside.example/post/a" },
    { kind: "city", url: "/images/cities/ca-toronto.webp", alt: "Toronto skyline", path: "/post/a" },
  ] }));
  const html = renderPublicDocumentMain(doc);
  assert.doesNotMatch(html, /href="\/\/outside|href="\/post\/a"/);
  assert.match(html, /alt="&lt;stage&gt;"/);
  assert.match(renderPublicDocumentHead(doc), /property="og:image:alt" content="&lt;stage&gt;"/);
});
