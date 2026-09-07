import assert from "node:assert/strict";
import test from "node:test";

import {
  catalogEventTitleViolations,
  extractEventSitemapUrls,
  extractEventLinks,
  extractEventPaginationUrls,
  extractSitemapEventUrls,
  inspectEventDocument,
  parseArguments,
  stratifiedSample,
  verifyProductionSeoCatalog,
} from "./verify-production-seo-catalog.mjs";

const ORIGIN = "https://www.mshpit.com";

function eventPage(name, {
  startDate = "2030-09-05T19:30:00-04:00",
  endDate = null,
  noindex = false,
  robots = null,
  eventOverrides = {},
  canonical = `${ORIGIN}/event/tm_fixture`,
  headExtra = "",
} = {}) {
  const event = {
    "@context": "https://schema.org",
    "@type": "MusicEvent",
    name,
    startDate,
    ...(endDate ? { endDate } : {}),
    eventStatus: "https://schema.org/EventScheduled",
    location: {
      "@type": "Place",
      name: "History",
      address: {
        "@type": "PostalAddress",
        streetAddress: "1663 Queen St E",
        addressLocality: "Toronto",
        addressCountry: "CA",
      },
    },
    ...eventOverrides,
  };
  return `<!doctype html><html><head><meta name="robots" content="${robots || (noindex ? "noindex" : "index,follow")}"><link rel="canonical" href="${canonical}">${headExtra}<script type="application/ld+json">${JSON.stringify(event)}</script></head><body><h1>${name}</h1></body></html>`;
}

function fixtureFetch({ collectionTitle = "J. Cole at History", sitemapTitle = collectionTitle, eventOptions = {}, eventsHtml = null } = {}) {
  const requests = [];
  const fetchImpl = async (rawUrl) => {
    const url = new URL(rawUrl);
    requests.push(url.pathname);
    if (["/events", "/discover"].includes(url.pathname)) {
      return new Response(url.pathname === "/events" && eventsHtml != null
        ? eventsHtml
        : `<html><body><a href="/event/tm_fixture">${collectionTitle}</a></body></html>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (url.pathname === "/sitemap.xml") {
      return new Response(`<sitemapindex><sitemap><loc>${ORIGIN}/sitemaps/events.xml</loc></sitemap></sitemapindex>`, {
        status: 200,
        headers: { "content-type": "application/xml" },
      });
    }
    if (url.pathname === "/sitemaps/events.xml") {
      return new Response(`<urlset><url><loc>${ORIGIN}/event/tm_fixture</loc></url></urlset>`, {
        status: 200,
        headers: { "content-type": "application/xml" },
      });
    }
    if (url.pathname === "/event/tm_fixture") {
      return new Response(eventPage(sitemapTitle, eventOptions), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
  };
  return { fetchImpl, requests };
}

test("catalog title policy catches crawler-visible products without rejecting ordinary concert names", () => {
  for (const title of [
    "Entry to All Shows at the Blue Moon",
    "Three Day Weekend Wristband",
    "Plantasia TWO DAY PASS",
    "Rock & Roots Concert Package Event",
    "Koto Fall Introductory Class",
    "Parking Add-On for J. Cole",
    "Artist VIP Upgrade Package",
    "Melanie Martinez – HADES: THE SACRIFICE | VIP",
    "Evanescence | Box seat in the Ticketmaster Suite",
    "2026 Formula 1 MSC Cruises USGP - Friday Admission",
    "Evento Teste - 2025",
  ]) assert.ok(catalogEventTitleViolations(title).length > 0, title);
  assert.deepEqual(catalogEventTitleViolations("J. Cole: The Fall-Off Tour"), []);
  assert.deepEqual(catalogEventTitleViolations("The V.I.P.s Live"), []);
  assert.deepEqual(catalogEventTitleViolations("The Pass Live"), []);
  assert.deepEqual(catalogEventTitleViolations("Class of 2026 Reunion Concert"), []);
  assert.deepEqual(catalogEventTitleViolations("The Package Tour"), []);
  assert.ok(catalogEventTitleViolations("O.A.R. - Party Box Rental").length > 0);
  assert.ok(catalogEventTitleViolations("Premium Experience").length > 0);
});

test("event link and sitemap prefix readers keep only canonical same-origin event leaves", () => {
  const html = `<a href="/event/a">Alpha</a><a href="${ORIGIN}/event/b">Beta</a><a href="https://elsewhere.test/event/c">Away</a><a href="/artists">Artists</a>`;
  assert.deepEqual(extractEventLinks(html, ORIGIN), [
    { url: `${ORIGIN}/event/a`, title: "Alpha" },
    { url: `${ORIGIN}/event/b`, title: "Beta" },
  ]);
  assert.deepEqual(extractEventPaginationUrls(`<a href="/events/page/2">Next</a><a href="${ORIGIN}/events/page/487">Last</a><a href="/artists/page/2">Wrong directory</a><a href="https://elsewhere.test/events/page/4">Away</a>`, ORIGIN), [
    { page: 2, url: `${ORIGIN}/events/page/2` },
    { page: 487, url: `${ORIGIN}/events/page/487` },
  ]);
  const xml = `<urlset><url><loc>${ORIGIN}/event/a</loc></url><url><loc>${ORIGIN}/artist/no</loc></url><url><loc>${ORIGIN}/event/b</loc></url></urlset>`;
  assert.deepEqual(extractSitemapEventUrls(xml, ORIGIN, 2), [`${ORIGIN}/event/a`, `${ORIGIN}/event/b`]);
  const index = `<sitemapindex><sitemap><loc>${ORIGIN}/sitemaps/pages.xml</loc></sitemap><sitemap><loc>${ORIGIN}/sitemaps/events.xml</loc></sitemap><sitemap><loc>${ORIGIN}/sitemaps/events-2.xml</loc></sitemap><sitemap><loc>https://elsewhere.test/sitemaps/events-3.xml</loc></sitemap></sitemapindex>`;
  assert.deepEqual(extractEventSitemapUrls(index, ORIGIN), [
    `${ORIGIN}/sitemaps/events.xml`,
    `${ORIGIN}/sitemaps/events-2.xml`,
  ]);
  assert.deepEqual(stratifiedSample(["a", "b", "c", "d", "e"], 3), ["a", "c", "e"]);
});

test("event document inspection rejects implausible and expired scheduled ranges", () => {
  const long = inspectEventDocument(eventPage("Summer Series", {
    startDate: "2026-06-20T19:30:00-05:00",
    endDate: "2026-10-17",
  }), { now: Date.parse("2026-09-06T12:00:00Z") });
  assert.ok(long.issues.some((issue) => issue.includes("119 days")));
  const expired = inspectEventDocument(eventPage("One Night Only", {
    startDate: "2026-08-01T20:00:00-04:00",
  }), { now: Date.parse("2026-09-06T12:00:00Z") });
  assert.ok(expired.issues.some((issue) => issue.includes("expired event")));
});

test("event document inspection catches Google's exact required field failures", () => {
  const missingName = inspectEventDocument(eventPage("Visible heading", {
    eventOverrides: { name: undefined },
  }));
  assert.ok(missingName.issues.includes('missing MusicEvent "name"'));

  const missingPlace = inspectEventDocument(eventPage("Named show", {
    eventOverrides: { location: undefined },
  }));
  assert.ok(missingPlace.issues.some((issue) => issue.includes('"location" Place')));

  const missingVenueName = inspectEventDocument(eventPage("Named show", {
    eventOverrides: {
      location: {
        "@type": "Place",
        address: { "@type": "PostalAddress", streetAddress:"1 Main St", addressLocality:"Toronto", addressCountry:"CA" },
      },
    },
  }));
  assert.ok(missingVenueName.issues.includes('missing MusicEvent "location.name"'));

  const missingAddress = inspectEventDocument(eventPage("Named show", {
    eventOverrides: { location: { "@type":"Place", name:"History" } },
  }));
  assert.ok(missingAddress.issues.some((issue) => issue.includes('"location.address" PostalAddress')));

  const malformedDate = inspectEventDocument(eventPage("Named show", {
    startDate:"2030-09-05-not-a-date",
  }));
  assert.ok(malformedDate.issues.includes("missing or invalid MusicEvent startDate"));
});

test("event document inspection permits a proven fan-backed page without optional Event JSON-LD", () => {
  const result = inspectEventDocument("<!doctype html><html><body><h1>J. Cole at History</h1><section data-mshpit-fan-backed=\"true\"><article>A detailed fan review.</article></section></body></html>");
  assert.equal(result.title, "J. Cole at History");
  assert.deepEqual(result.issues, []);
  const thin = inspectEventDocument("<!doctype html><html><body><h1>J. Cole at History</h1></body></html>");
  assert.ok(thin.issues.some((issue) => issue.includes("substantive fan-backed evidence")));
});

test("event inspection ignores generic Event nodes and selects MusicEvent", () => {
  const musicEvent = {
    "@type": "MusicEvent",
    name: "J. Cole at History",
    startDate: "2030-09-05",
    location: {
      "@type": "Place", name: "History",
      address: { "@type": "PostalAddress", streetAddress: "1663 Queen St E", addressLocality: "Toronto", addressCountry: "CA" },
    },
  };
  const html = `<!doctype html><html><body><h1>J. Cole at History</h1><script type="application/ld+json">${JSON.stringify([
    { "@type": "Event", name: "Unrelated sports event" }, musicEvent,
  ])}</script></body></html>`;
  assert.deepEqual(inspectEventDocument(html).issues, []);
});

test("bounded verifier passes a clean fixture through the sitemap index", async () => {
  const fixture = fixtureFetch();
  const report = await verifyProductionSeoCatalog({
    origin: ORIGIN,
    sitemapSample: 1,
    fetchImpl: fixture.fetchImpl,
    now: Date.parse("2026-09-06T12:00:00Z"),
  });
  assert.equal(report.ok, true);
  assert.equal(report.requests, 6);
  assert.equal(report.sitemapCatalogEventUrls, 1);
  assert.equal(report.eventSitemapShards, 1);
  assert.deepEqual(fixture.requests, ["/events", "/discover", "/events/page/2", "/sitemap.xml", "/sitemaps/events.xml", "/event/tm_fixture"]);
});

test("bounded verifier samples across every indexed event sitemap shard", async () => {
  const requests = [];
  const fetchImpl = async (rawUrl) => {
    const url = new URL(rawUrl);
    requests.push(url.pathname);
    if (["/events", "/discover"].includes(url.pathname)) {
      return new Response("<html><body></body></html>", { status:200, headers:{ "content-type":"text/html" } });
    }
    if (url.pathname === "/sitemap.xml") {
      return new Response(`<sitemapindex><sitemap><loc>${ORIGIN}/sitemaps/events.xml</loc></sitemap><sitemap><loc>${ORIGIN}/sitemaps/events-2.xml</loc></sitemap></sitemapindex>`, { status:200, headers:{ "content-type":"application/xml" } });
    }
    if (url.pathname === "/sitemaps/events.xml") {
      return new Response(`<urlset><url><loc>${ORIGIN}/event/a</loc></url></urlset>`, { status:200, headers:{ "content-type":"application/xml" } });
    }
    if (url.pathname === "/sitemaps/events-2.xml") {
      return new Response(`<urlset><url><loc>${ORIGIN}/event/b</loc></url></urlset>`, { status:200, headers:{ "content-type":"application/xml" } });
    }
    if (url.pathname === "/event/a" || url.pathname === "/event/b") {
      return new Response(eventPage(url.pathname.endsWith("a") ? "Alpha Live" : "Beta Live", { canonical:url.href }), { status:200, headers:{ "content-type":"text/html" } });
    }
    return new Response("not found", { status:404, headers:{ "content-type":"text/plain" } });
  };
  const report = await verifyProductionSeoCatalog({
    origin:ORIGIN,
    sitemapSample:2,
    fetchImpl,
    now:Date.parse("2026-09-06T12:00:00Z"),
  });
  assert.equal(report.ok, true);
  assert.equal(report.eventSitemapShards, 2);
  assert.equal(report.sitemapCatalogEventUrls, 2);
  assert.deepEqual(requests, [
    "/events", "/discover", "/events/page/2", "/sitemap.xml", "/sitemaps/events.xml", "/sitemaps/events-2.xml", "/event/a", "/event/b",
  ]);
});

test("bounded verifier reports both collection products and bad sitemap event ranges", async () => {
  const fixture = fixtureFetch({
    collectionTitle: "Koto Fall Introductory Class",
    sitemapTitle: "Koto Fall Introductory Class",
    eventOptions: { startDate: "2026-06-20T19:30:00-05:00", endDate: "2026-10-17" },
  });
  const report = await verifyProductionSeoCatalog({
    origin: ORIGIN,
    sitemapSample: 1,
    fetchImpl: fixture.fetchImpl,
    now: Date.parse("2026-09-06T12:00:00Z"),
  });
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((finding) => finding.surface === "/events" && finding.reason.includes("class")));
  assert.ok(report.findings.some((finding) => finding.surface === "events.xml" && finding.reason.includes("days")));
});

test("bounded verifier samples first, middle, and final event directory pages", async () => {
  const requests = [];
  const lastPage = 7;
  const fetchImpl = async (rawUrl) => {
    const url = new URL(rawUrl);
    requests.push(url.pathname);
    if (url.pathname === "/events") {
      return new Response(`<html><body><a href="/event/root">Root concert</a><a href="/events/page/2">Next page</a></body></html>`, {
        status: 200, headers: { "content-type": "text/html" },
      });
    }
    if (url.pathname === "/discover") {
      return new Response("<html><body></body></html>", { status: 200, headers: { "content-type": "text/html" } });
    }
    if (url.pathname === "/sitemap.xml") {
      return new Response(`<sitemapindex><sitemap><loc>${ORIGIN}/sitemaps/events.xml</loc></sitemap></sitemapindex>`, { status: 200, headers: { "content-type": "application/xml" } });
    }
    if (url.pathname === "/sitemaps/events.xml") {
      return new Response(`<urlset><url><loc>${ORIGIN}/event/root</loc></url></urlset>`, { status: 200, headers: { "content-type": "application/xml" } });
    }
    if (url.pathname === "/event/root") {
      return new Response(eventPage("Root concert", { canonical: `${ORIGIN}/event/root` }), { status: 200, headers: { "content-type": "text/html" } });
    }
    const match = /^\/events\/page\/([1-9][0-9]*)$/u.exec(url.pathname);
    if (match && Number(match[1]) <= lastPage) {
      const page = Number(match[1]);
      const title = page === 4 ? "Lessons in Love Tour" : `Concert page ${page}`;
      return new Response(`<html><head><meta name="robots" content="noindex,follow"></head><body><a href="/event/page-${page}">${title}</a></body></html>`, { status: 200, headers: { "content-type": "text/html" } });
    }
    return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
  };
  const report = await verifyProductionSeoCatalog({
    origin: ORIGIN,
    sitemapSample: 1,
    fetchImpl,
    now: Date.parse("2026-09-06T12:00:00Z"),
  });
  assert.equal(report.ok, true);
  assert.deepEqual(report.paginatedEventPages, [2, 4, 7]);
  for (const page of [2, 4, 7]) assert.ok(requests.includes(`/events/page/${page}`), `page ${page}`);
});

test("bounded verifier reports an advertised page 2 that returns 404", async () => {
  const fixture = fixtureFetch({
    eventsHtml: `<html><body><a href="/event/tm_fixture">J. Cole at History</a><a href="/events/page/2">Next page</a></body></html>`,
  });
  const report = await verifyProductionSeoCatalog({
    origin: ORIGIN, sitemapSample: 1, fetchImpl: fixture.fetchImpl,
    now: Date.parse("2026-09-06T12:00:00Z"),
  });
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((finding) => finding.surface === "/events/page/2"
    && finding.reason.includes("advertises page 2")));
});

test("bounded verifier reports an accessible page 2 missing from root navigation", async () => {
  const fixture = fixtureFetch();
  const fetchImpl = async (rawUrl, options) => {
    const url = new URL(rawUrl);
    if (url.pathname === "/events/page/2") {
      return new Response('<html><head><meta name="robots" content="noindex,follow"></head><body><a href="/event/tm_fixture">J. Cole at History</a></body></html>', {
        status: 200, headers: { "content-type": "text/html" },
      });
    }
    return fixture.fetchImpl(rawUrl, options);
  };
  const report = await verifyProductionSeoCatalog({
    origin: ORIGIN, sitemapSample: 1, fetchImpl,
    now: Date.parse("2026-09-06T12:00:00Z"),
  });
  assert.ok(report.findings.some((finding) => finding.surface === "/events"
    && finding.reason.includes("missing from page 1 navigation")));
});

test("bounded verifier rejects an empty 200 pagination page", async () => {
  const fixture = fixtureFetch({
    eventsHtml: `<html><body><a href="/event/tm_fixture">J. Cole at History</a><a href="/events/page/2">Next page</a></body></html>`,
  });
  const fetchImpl = async (rawUrl, options) => {
    const url = new URL(rawUrl);
    if (url.pathname === "/events/page/2") {
      return new Response('<html><head><meta name="robots" content="noindex,follow"></head><body><p>No events found.</p></body></html>', {
        status: 200, headers: { "content-type": "text/html" },
      });
    }
    return fixture.fetchImpl(rawUrl, options);
  };
  const report = await verifyProductionSeoCatalog({
    origin: ORIGIN, sitemapSample: 1, fetchImpl,
    now: Date.parse("2026-09-06T12:00:00Z"),
  });
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((finding) => finding.surface === "/events/page/2"
    && finding.reason.includes("contains no canonical event links")));
});

test("bounded verifier rejects duplicate or malformed canonicals and robots none", async () => {
  const duplicate = await verifyProductionSeoCatalog({
    origin: ORIGIN, sitemapSample: 1,
    fetchImpl: fixtureFetch({
      eventOptions: { headExtra: `<link rel="canonical" href="${ORIGIN}/event/other">` },
    }).fetchImpl,
  });
  assert.ok(duplicate.findings.some((finding) => finding.reason.includes("exact self-canonical")));

  const malformed = await verifyProductionSeoCatalog({
    origin: ORIGIN, sitemapSample: 1,
    fetchImpl: fixtureFetch({
      eventOptions: { headExtra: '<link rel="canonical" href="http://[::1">' },
    }).fetchImpl,
  });
  assert.ok(malformed.findings.some((finding) => finding.reason.includes("exact self-canonical")));

  const missingHref = await verifyProductionSeoCatalog({
    origin: ORIGIN, sitemapSample: 1,
    fetchImpl: fixtureFetch({ eventOptions: { canonical: "" } }).fetchImpl,
  });
  assert.ok(missingHref.findings.some((finding) => finding.reason.includes("exact self-canonical")));

  const none = await verifyProductionSeoCatalog({
    origin: ORIGIN, sitemapSample: 1,
    fetchImpl: fixtureFetch({ eventOptions: { robots: "none" } }).fetchImpl,
  });
  assert.ok(none.findings.some((finding) => finding.reason.includes("marked noindex")));
});

test("CLI arguments cap sitemap samples and request timeouts", () => {
  assert.deepEqual(parseArguments(["--origin", ORIGIN, "--timeout-ms", "2500", "--sitemap-sample", "3"]), {
    help: false,
    origin: ORIGIN,
    timeoutMs: 2500,
    sitemapSample: 3,
  });
  assert.throws(() => parseArguments(["--sitemap-sample", "13"]), /1 to 12/u);
  assert.throws(() => parseArguments(["--timeout-ms", "100"]), /500 to 60000/u);
});
