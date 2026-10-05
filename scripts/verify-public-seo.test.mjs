import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import {
  formatReport,
  parseArguments,
  searchCrawlerAllows,
  validateEventStructuredData,
  verifyPublicSeo,
} from "./verify-public-seo.mjs";

function page(origin, path, { shell = false, problem = "" } = {}) {
  const isHome = path === "/";
  const title = isHome ? "PIT - Your life's musical journey" : "About Mshpit";
  const description = "Mshpit is a community-built concert archive for discovering artists, documenting live shows, and preserving music memories.";
  const schemaTypes = isHome
    ? ["WebSite", "Organization"]
    : [problem === "wrong-about-schema" ? "WebPage" : "AboutPage", "Organization"];
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": schemaTypes.map((type) => ({ "@type": type })),
  });
  const social = problem === "missing-social"
    ? ""
    : `<meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${origin}${path}"><meta property="og:image" content="${origin}/og.png"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${origin}/og.png">`;
  const content = shell
    ? '<div id="root">You need to enable JavaScript to run this app.</div>'
    : isHome
      ? `<main><h1>Your life's musical journey</h1><p>Discover artists, document live shows, publish thoughtful reviews, and preserve the memories that make live music meaningful for fans everywhere.</p><nav><a href="/artists">Browse artists</a>${problem === "missing-events-anchor" ? "" : '<a href="/events">Find events</a>'}</nav></main>`
      : "<main><h1>About Mshpit</h1><p>Mshpit gives music fans a durable home for concert history, artist discovery, live event reviews, and the photos and stories surrounding each performance.</p></main>";
  return `<!doctype html><html lang="en"><head><title>${title}</title><meta name="description" content="${description}"><meta name="robots" content="index,follow"><link rel="canonical" href="${origin}${path}"><link rel="icon" href="/logo.svg">${social}<script type="application/ld+json">${jsonLd}</script></head><body>${content}</body></html>`;
}

async function fixture({
  shell = false,
  pageProblem = "",
  duplicatePublicUrl = false,
  omitAbout = false,
  nonCanonicalPageOne = false,
  redirectAlias = false,
  trackingProblem = "",
} = {}) {
  let origin;
  let aliasOrigin;
  const server = http.createServer((request, response) => {
    if (redirectAlias && request.headers.host?.startsWith("localhost:")) {
      response.writeHead(308, { location: `${origin}${request.url}` }).end();
      return;
    }
    if (request.url === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end(`User-agent: *
Allow: /
Sitemap: ${origin}/sitemap.xml
`);
      return;
    }
    if (request.url === "/sitemap.xml") {
      response.writeHead(200, { "content-type": "application/xml" }).end(`<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${origin}/sitemaps/pages.xml</loc></sitemap></sitemapindex>`);
      return;
    }
    if (request.url === "/sitemaps/pages.xml") {
      const duplicate = duplicatePublicUrl ? `<url><loc>${origin}/</loc></url>` : "";
      const about = omitAbout ? "" : `<url><loc>${origin}/about</loc></url>`;
      const pageOne = nonCanonicalPageOne ? `<url><loc>${origin}/artists/page/1</loc></url>` : "";
      response.writeHead(200, { "content-type": "application/xml" }).end(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"><url><loc>${origin}/</loc><image:image><image:loc>https://media.example.test/public/cover.jpg</image:loc></image:image></url>${about}${duplicate}${pageOne}</urlset>`);
      return;
    }
    if (request.url.startsWith("/?")) {
      const functional = request.url.includes("&q=");
      let html = page(origin, "/");
      const noindex = functional || trackingProblem === "noindex";
      if (noindex) html = html.replace('content="index,follow"', 'content="noindex,follow"').replace(/<link rel="canonical"[^>]*>/, "");
      if (!functional && trackingProblem === "wrong-canonical") html = html.replace(`href="${origin}/"`, `href="${origin}${request.url}"`);
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": functional && trackingProblem !== "privacy-cache" ? "no-store" : "public, max-age=0",
        "x-robots-tag": noindex ? "noindex,follow" : "index,follow",
        ...(noindex ? {} : { link: `<${origin}/>; rel="canonical"` }),
      }).end(html);
      return;
    }
    if (request.url === "/" || request.url === "/about") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        link: `<${origin}${request.url}>; rel="canonical"`,
      }).end(request.method === "HEAD" ? "" : page(origin, request.url, { shell, problem: pageProblem }));
      return;
    }
    if (request.url === "/settings") {
      response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store", "x-robots-tag": "noindex,follow" })
        .end('<html><head><meta name="robots" content="noindex,follow"></head><body>Settings</body></html>');
      return;
    }
    response.writeHead(404, {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex",
    }).end('<!doctype html><html lang="en"><head><title>Not found</title></head><body><h1>Not found</h1></body></html>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;
  aliasOrigin = `http://localhost:${address.port}`;
  return { origin: redirectAlias ? aliasOrigin : origin, canonicalOrigin: origin, server };
}

function closeAfter(context, server) {
  context.after(() => new Promise((resolve, reject) => {
    server.closeAllConnections?.();
    server.close((error) => error ? reject(error) : resolve());
  }));
}

function sitemapSamplingFetch(origin, { sampleProblem = "" } = {}) {
  const requests = [];
  const baseFetch = globalThis.fetch;
  const xml = (body) => new Response(body, {
    status: 200,
    headers: { "content-type": "application/xml" },
  });
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname;
    requests.push(path);
    if (path === "/sitemap.xml") {
      return xml(`<sitemapindex>
        <sitemap><loc>${origin}/sitemaps/pages.xml</loc></sitemap>
        <sitemap><loc>${origin}/sitemaps/artists-1.xml</loc></sitemap>
        <sitemap><loc>${origin}/sitemaps/artists-2.xml</loc></sitemap>
        <sitemap><loc>${origin}/sitemaps/events.xml</loc></sitemap>
      </sitemapindex>`);
    }
    if (path === "/sitemaps/pages.xml") {
      return xml(`<urlset><url><loc>${origin}/</loc></url><url><loc>${origin}/about</loc></url></urlset>`);
    }
    if (path === "/sitemaps/artists-1.xml" || path === "/sitemaps/events.xml") {
      return xml("<urlset></urlset>");
    }
    if (path === "/sitemaps/artists-2.xml") {
      return xml(`<urlset><url><loc>${origin}/artist/sample</loc></url></urlset>`);
    }
    if (path === "/artist/sample") {
      if (sampleProblem === "redirect") {
        return new Response("", {
          status: 302,
          headers: { location: `${origin}/artist/final` },
        });
      }
      let html = page(origin, path, { shell: sampleProblem === "shell" });
      if (sampleProblem === "missing-h1") html = html.replace("<h1>About Mshpit</h1>", "<p>About Mshpit</p>");
      if (sampleProblem === "duplicate-canonical") {
        html = html.replace("</head>", `<link rel="canonical" href="${origin}${path}"></head>`);
      }
      if (sampleProblem === "wrong-canonical") {
        html = html.replace(`href="${origin}${path}"`, `href="${origin}/about"`);
      }
      if (sampleProblem === "missing-meta-description") {
        html = html.replace(/<meta name="description"[^>]*>/, "");
      }
      return new Response(html, {
        status: 200,
        headers: {
          "content-type": sampleProblem === "content-type" ? "application/json" : "text/html; charset=utf-8",
          ...(sampleProblem === "noindex" ? { "x-robots-tag": "noindex" } : {}),
        },
      });
    }
    return baseFetch(url, options);
  };
  return { fetchImpl, requests };
}

test("argument parsing is strict, sanitized, and accepts a trailing slash", () => {
  assert.deepEqual(parseArguments(["--origin", "https://example.com/", "--timeout-ms=2500"]), {
    origin: "https://example.com",
    timeoutMs: 2500,
    help: false,
  });
  assert.throws(() => parseArguments(["--origin", "https://user:secret@example.com"]), /credentials/);
  assert.throws(() => parseArguments(["--origin", "https://example.com/private"]), /path/);
  assert.throws(() => parseArguments(["--unknown=secret"]), /^Error: unknown argument$/);
});

test("GEO is an explicit opt-in without expanding the default verification requests", () => {
  assert.equal(parseArguments(["--geo"]).geo, true);
  assert.equal(parseArguments([]).geo, undefined);
});

test("search crawler rules distinguish search from training and apply group and path precedence", () => {
  const rules = `User-agent: *
Disallow: /private
User-agent: GPTBot
Disallow: /
User-agent: OAI-SearchBot

# Blank lines/comments and unknown fields do not end a group.
Content-signal: search=yes, ai-train=no
Disallow: /artist/
Allow: /artist/allowed$
User-agent: OAI-SearchBot
Disallow: /event/*?*
Disallow: /venue/Caf%C3%A9
Disallow: /%61bout
`;
  assert.equal(searchCrawlerAllows(rules, "/"), true);
  assert.equal(searchCrawlerAllows(rules, "/private"), true, "specific rules override the wildcard group");
  assert.equal(searchCrawlerAllows(rules, "/artist/other"), false);
  assert.equal(searchCrawlerAllows(rules, "/artist/allowed"), true);
  assert.equal(searchCrawlerAllows(rules, "/artist/allowed-more"), false);
  assert.equal(searchCrawlerAllows(rules, "/event/one"), true);
  assert.equal(searchCrawlerAllows(rules, "/event/one?utm_source=chatgpt.com"), false);
  assert.equal(searchCrawlerAllows(rules, "/venue/Café"), false);
  assert.equal(searchCrawlerAllows(rules, "/venue/Caf%c3%a9"), false);
  assert.equal(searchCrawlerAllows(rules, "/about"), false);
  assert.equal(searchCrawlerAllows(rules, "/About"), true);
  assert.equal(searchCrawlerAllows("User-agent: *\nDisallow: /\nAllow: /artist/", "/artist/one"), true);
  assert.equal(searchCrawlerAllows("User-agent: *\nDisallow: /*\nAllow: /", "/"), true);
  assert.equal(searchCrawlerAllows("User-agent: *\nDisallow: /\nAllow: /$", "/artist/one"), false);
  assert.equal(searchCrawlerAllows("User-agent: GPTBot\nDisallow: /", "/artist/one"), true);
  assert.equal(searchCrawlerAllows("User-agent: *\nDisallow: /artist/\nAllow: /artist/", "/artist/one"), true);
  assert.equal(searchCrawlerAllows("User-agent: OAI-SearchBot\nSitemap: https://example.test/sitemap.xml\n\nUser-agent: Other\nDisallow: /", "/"), false);
});

function geoFetch(origin, { robots, problem = "", entities = true } = {}) {
  const calls = [], baseFetch = globalThis.fetch;
  const entityPaths = ["/artist/sample", "/event/sample", "/venue/sample"];
  const response = (body, type = "text/html", status = 200, headers = {}) => new Response(body, { status, headers: { "content-type": type, ...headers } });
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url), path = parsed.pathname, probe = options.headers["user-agent"].includes("OAI-SearchBot");
    calls.push({ path: path + parsed.search, probe, options });
    if (path === "/robots.txt") return response(robots || `User-agent: *\nAllow: /\nDisallow: /api/\nUser-agent: GPTBot\nDisallow: /\nSitemap: ${origin}/sitemap.xml`, "text/plain");
    if (entities && path === "/sitemap.xml") return response(`<sitemapindex>${["pages", "artists", "events", "venues"].map((kind) => `<sitemap><loc>${origin}/sitemaps/${kind}.xml</loc></sitemap>`).join("")}</sitemapindex>`, "application/xml");
    const entityIndex = ["/sitemaps/artists.xml", "/sitemaps/events.xml", "/sitemaps/venues.xml"].indexOf(path);
    if (entities && entityIndex >= 0) return response(`<urlset><url><loc>${origin}${entityPaths[entityIndex]}</loc></url></urlset>`, "application/xml");
    if (probe && path === "/artist/sample" && ["challenge", "redirect", "oversize"].includes(problem)) {
      return response("sensitive challenge body", "text/html", problem === "challenge" ? 403 : problem === "redirect" ? 302 : 200,
        problem === "redirect" ? { location: "https://untrusted.test/private?token=secret" } : problem === "oversize" ? { "content-length": "99999999" } : {});
    }
    let result = entities && entityPaths.includes(path) ? response(page(origin, path)
      .replace('"@type":"AboutPage"', `"@type":"AboutPage","@id":"${origin}${path}#page"`)) : await baseFetch(url, options);
    if (!probe) return result;
    let html = await result.text(), headers = new Headers(result.headers);
    if (path === "/artist/sample") {
      if (problem === "noindex") headers.set("x-robots-tag", "noindex");
      if (problem === "named-noindex") headers.set("x-robots-tag", "GPTBot: index, OAI-SearchBot: noindex, nofollow");
      if (problem === "training-noindex") headers.set("x-robots-tag", "GPTBot: noindex, nofollow");
      if (problem === "ambiguous-noindex") {
        headers.append("x-robots-tag", "GPTBot: nofollow"); headers.append("x-robots-tag", "noindex");
      }
      if (problem === "preview-none") {
        headers.set("x-robots-tag", "max-image-preview: none");
        html = html.replace('content="index,follow"', 'content="index,follow,max-image-preview: none"');
      }
      if (problem === "named-meta") html = html.replace("</head>", '<meta name="OAI-SearchBot" content="noindex"></head>');
      if (problem === "canonical") html = html.replace(`href="${origin}${path}"`, `href="${origin}/about"`);
      if (problem === "identity") html = html.replace("<h1>About Mshpit</h1>", "<h1>Different artist</h1>");
      if (problem === "schema-identity") html = html.replace(`${origin}${path}#page`, `${origin}/artist/wrong#page`);
      if (problem === "jsonld") html = html.replace('"@context":', '"@context":sensitive-malformed-json,');
      if (problem === "shell") html = page(origin, path, { shell: true });
    }
    if (parsed.search === "?utm_source=chatgpt.com" && problem === "tracking") html = html.replace('content="index,follow"', 'content="noindex,follow"');
    if (path === "/settings" && problem === "personal") { html = page(origin, path); headers.delete("x-robots-tag"); }
    if (path === "/settings" && problem === "private-header") headers.set("link", `<${origin}/settings>; rel="canonical"`);
    if (parsed.search.includes("&q=") && problem === "private-cache") headers.set("cache-control", "public, max-age=600");
    return new Response(html, { status: result.status, headers });
  };
  return { fetchImpl, calls };
}

test("GEO reuses three public entity samples and bounds extra probes without cookies or redirects", async (context) => {
  const site = await fixture(); closeAfter(context, site.server);
  const f = geoFetch(site.origin);
  const report = await verifyPublicSeo({ origin: site.origin, timeoutMs: 2000, fetchImpl: f.fetchImpl, geo: true });
  assert.equal(report.ok, true, formatReport(report));
  const probes = f.calls.filter((call) => call.probe);
  assert.equal(probes.length, 9);
  assert.equal(probes.filter((call) => call.path === "/artist/sample").length, 1);
  assert.ok(probes.every(({ options }) => options.method === "GET" && options.credentials === "omit" && options.redirect === "manual" && !options.headers.cookie && !options.headers.authorization));
  assert.match(report.checks.at(-1).detail, /simulated agent only, not verified bot-IP access or indexing/);
  assert.doesNotMatch(report.checks.at(-1).detail, /unsampled/);
});

test("GEO labels missing entity coverage and never invents pages to probe", async (context) => {
  const site = await fixture(); closeAfter(context, site.server); const f = geoFetch(site.origin, { entities: false });
  const report = await verifyPublicSeo({ origin: site.origin, fetchImpl: f.fetchImpl, geo: true });
  assert.equal(report.ok, true, formatReport(report));
  assert.equal(f.calls.filter((call) => call.probe).length, 6);
  assert.match(report.checks.at(-1).detail, /unsampled: artist, event, venue/);
});

test("training-bot noindex headers do not opt the distinct search agent out", async (context) => {
  const site = await fixture(); closeAfter(context, site.server); const f = geoFetch(site.origin, { problem: "training-noindex" });
  const report = await verifyPublicSeo({ origin: site.origin, fetchImpl: f.fetchImpl, geo: true });
  assert.equal(report.ok, true, formatReport(report));
});

test("image preview restrictions are not noindex directives", async (context) => {
  const site = await fixture(); closeAfter(context, site.server); const f = geoFetch(site.origin, { problem: "preview-none" });
  const report = await verifyPublicSeo({ origin: site.origin, fetchImpl: f.fetchImpl, geo: true });
  assert.equal(report.ok, true, formatReport(report));
});

test("explicit personal/query crawler exclusions are preserved and reported without fetching them", async (context) => {
  const site = await fixture(); closeAfter(context, site.server);
  const f = geoFetch(site.origin, { robots: `User-agent: *\nAllow: /\nUser-agent: OAI-SearchBot\nDisallow: /settings\nDisallow: /*?*\nSitemap: ${site.origin}/sitemap.xml` });
  const report = await verifyPublicSeo({ origin: site.origin, fetchImpl: f.fetchImpl, geo: true });
  assert.equal(report.ok, true, formatReport(report));
  assert.equal(f.calls.filter((call) => call.probe).length, 6);
  assert.ok(f.calls.filter((call) => call.probe).every(({ path }) => !path.includes("?") && path !== "/settings"));
  assert.match(report.checks.at(-1).detail, /robots-excluded \(HTML not probed\): attribution query, functional query, personal page/);
});

test("search probes stop when their cumulative thirty-second budget expires", async (context) => {
  const site = await fixture(); closeAfter(context, site.server); const f = geoFetch(site.origin);
  let clock = 0;
  context.mock.method(Date, "now", () => clock);
  const report = await verifyPublicSeo({ origin: site.origin, geo: true, fetchImpl: async (url, options) => {
    const response = await f.fetchImpl(url, options);
    if (options.headers["user-agent"].includes("OAI-SearchBot")) clock += 11_000;
    return response;
  } });
  assert.equal(report.ok, false); assert.match(report.checks.at(-1).detail, /request\/time budget/);
  assert.equal(f.calls.filter((call) => call.probe).length, 3);
});

test("a stalled search probe aborts at the request deadline without an alternate request", async (context) => {
  const site = await fixture(); closeAfter(context, site.server); const f = geoFetch(site.origin);
  let stalledSignal;
  const report = await verifyPublicSeo({ origin: site.origin, geo: true, timeoutMs: 500, fetchImpl: (url, options) => {
    if (options.headers["user-agent"].includes("OAI-SearchBot")) {
      assert.equal(stalledSignal, undefined); stalledSignal = options.signal;
      return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
    }
    return f.fetchImpl(url, options);
  } });
  assert.equal(report.ok, false); assert.equal(stalledSignal.aborted, true);
  assert.match(report.checks.at(-1).detail, /request exceeded 500ms/);
});

test("GEO detects search-specific and path-specific robot exclusions without changing training policy", async (context) => {
  const site = await fixture(); closeAfter(context, site.server);
  for (const path of ["/", "/artist/"]) {
    const f = geoFetch(site.origin, { robots: `User-agent: *\nAllow: /\nUser-agent: OAI-SearchBot\nDisallow: ${path}\nUser-agent: GPTBot\nDisallow: /\nSitemap: ${site.origin}/sitemap.xml` });
    const report = await verifyPublicSeo({ origin: site.origin, fetchImpl: f.fetchImpl, geo: true });
    assert.equal(report.ok, false); assert.match(report.checks.at(-1).detail, /robots.txt excludes .* OAI-SearchBot/);
    assert.equal(f.calls.filter((call) => call.probe).length, 1, "no blocked page is fetched");
  }
});

for (const [problem, expected] of [["challenge", /HTTP 403/], ["redirect", /HTTP 302/], ["oversize", /safe byte limit/],
  ["noindex", /noindex/], ["named-noindex", /noindex/], ["ambiguous-noindex", /ambiguous combined X-Robots-Tag/], ["named-meta", /noindex/], ["canonical", /canonical link/], ["identity", /ordinary public identity/], ["schema-identity", /ordinary public identity/], ["jsonld", /invalid JSON-LD/], ["shell", /shell/],
  ["tracking", /noindex/], ["personal", /noindex\/no-canonical/], ["private-header", /noindex\/no-canonical/], ["private-cache", /no-store/]]) {
  test(`GEO fails safely on ${problem} without fallback, body or query disclosure`, async (context) => {
    const site = await fixture(); closeAfter(context, site.server); const f = geoFetch(site.origin, { problem });
    const report = await verifyPublicSeo({ origin: site.origin, fetchImpl: f.fetchImpl, geo: true });
    assert.equal(report.ok, false); assert.match(report.checks.at(-1).detail, expected);
    assert.doesNotMatch(formatReport(report), /sensitive|malformed-json|token=|secret|private-query/);
    const firstProbe = f.calls.findIndex((call) => call.probe);
    assert.ok(f.calls.slice(firstProbe).every((call) => call.probe), "no alternate-agent retries");
    assert.ok(f.calls.filter((call) => call.probe).length <= 9);
  });
}

test("Event verification rejects phantom and incomplete nodes but resolves a complete same-page event", () => {
  const eventId = "https://www.example.com/event/one#event";
  assert.throws(() => validateEventStructuredData([{
    "@context": "https://schema.org",
    "@type": "MusicVenue",
    event: { "@id": eventId },
  }]), /undefined Event reference/);

  assert.throws(() => validateEventStructuredData([{
    "@context": "https://schema.org",
    "@type": "MusicEvent",
    "@id": eventId,
    name: "Example Artist Live",
  }]), /startDate, location/);

  const complete = {
    "@context": "https://schema.org",
    "@type": "MusicEvent",
    "@id": eventId,
    name: "Example Artist Live",
    startDate: "2030-09-01T20:00:00-04:00",
    location: {
      "@type": "Place",
      name: "Example Hall",
      address: {
        "@type": "PostalAddress",
        streetAddress: "1 Music Way",
        addressLocality: "Toronto",
        addressCountry: "CA",
      },
    },
  };
  assert.equal(validateEventStructuredData([{
    "@context": "https://schema.org",
    "@type": "MusicVenue",
    event: { "@id": eventId },
  }, complete]), true);
});

test("the full public SEO contract passes and ignores off-origin media locs", async (context) => {
  const site = await fixture();
  closeAfter(context, site.server);
  const report = await verifyPublicSeo({ origin: site.origin, timeoutMs: 2_000 });
  assert.equal(report.ok, true, formatReport(report));
  assert.deepEqual(report.checks.map((item) => item.name), [
    "Canonical origin", "robots.txt", "Sitemaps", "Home HTML", "About HTML", "Tracking URL policy", "404 policy",
  ]);
  assert.match(report.checks.find((item) => item.name === "Sitemaps").detail, /2 unique public URLs/);
});

test("robots.txt rejects effective root blocks for wildcard and Google crawlers", async (context) => {
  const site = await fixture();
  closeAfter(context, site.server);
  const baseFetch = globalThis.fetch;
  const robotsFetch = (body) => async (url, options) => {
    if (new URL(url).pathname === "/robots.txt") {
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return baseFetch(url, options);
  };

  const namedOnly = await verifyPublicSeo({
    origin: site.origin,
    timeoutMs: 2_000,
    fetchImpl: robotsFetch(`User-agent: *
Allow: /
Sitemap: ${site.origin}/sitemap.xml

User-agent: PrivatePreviewBot
Disallow: /
`),
  });
  assert.equal(namedOnly.ok, true, formatReport(namedOnly));

  const wildcardBlock = await verifyPublicSeo({
    origin: site.origin,
    timeoutMs: 2_000,
    fetchImpl: robotsFetch(`User-agent: PrivatePreviewBot
Disallow: /
User-agent: *
Allow: /
Disallow: / # accidental production maintenance rule
Sitemap: ${site.origin}/sitemap.xml
`),
  });
  assert.equal(wildcardBlock.ok, true, formatReport(wildcardBlock));

  const rootBlock = await verifyPublicSeo({
    origin: site.origin,
    timeoutMs: 2_000,
    fetchImpl: robotsFetch(`User-agent: *
Disallow: /
Sitemap: ${site.origin}/sitemap.xml
`),
  });
  assert.equal(rootBlock.ok, false);
  assert.match(rootBlock.checks.find((item) => item.name === "robots.txt").detail, /blocks the entire site/);

  for (const agent of ["Googlebot", "Googlebot-Smartphone"]) {
    const namedGoogleBlock = await verifyPublicSeo({
      origin: site.origin,
      timeoutMs: 2_000,
      fetchImpl: robotsFetch(`User-agent: *
Allow: /

User-agent: ${agent}
Disallow: /
Sitemap: ${site.origin}/sitemap.xml
`),
    });
    assert.equal(namedGoogleBlock.ok, false);
    assert.match(namedGoogleBlock.checks.find((item) => item.name === "robots.txt").detail, new RegExp(agent, "i"));
  }
});

test("every nonempty sitemap class contributes an indexable sample page", async (context) => {
  const site = await fixture();
  closeAfter(context, site.server);
  const sampling = sitemapSamplingFetch(site.origin);
  const report = await verifyPublicSeo({
    origin: site.origin,
    timeoutMs: 2_000,
    fetchImpl: sampling.fetchImpl,
  });
  assert.equal(report.ok, true, formatReport(report));
  assert.match(report.checks.find((item) => item.name === "Sitemaps").detail, /2 sampled classes/);
  assert.equal(sampling.requests.filter((path) => path === "/artist/sample").length, 1);
});

test("sitemap samples require final indexable semantic HTML with a self-canonical", async (context) => {
  for (const [sampleProblem, expected] of [
    ["redirect", /HTTP 302/],
    ["content-type", /Content-Type/],
    ["noindex", /noindex/],
    ["shell", /JavaScript-only/],
    ["missing-h1", /visible <h1>/],
    ["duplicate-canonical", /exactly once/],
    ["wrong-canonical", /canonical link/],
    ["missing-meta-description", /meta description/],
  ]) {
    const site = await fixture();
    closeAfter(context, site.server);
    const sampling = sitemapSamplingFetch(site.origin, { sampleProblem });
    const report = await verifyPublicSeo({
      origin: site.origin,
      timeoutMs: 2_000,
      fetchImpl: sampling.fetchImpl,
    });
    assert.equal(report.ok, false);
    assert.match(report.checks.find((item) => item.name === "Sitemaps").detail, expected);
  }
});

test("one canonical redirect is accepted and becomes the final report origin", async (context) => {
  const site = await fixture({ redirectAlias: true });
  closeAfter(context, site.server);
  const report = await verifyPublicSeo({ origin: site.origin, timeoutMs: 2_000 });
  assert.equal(report.ok, true, formatReport(report));
  assert.equal(report.origin, site.canonicalOrigin);
  assert.match(report.checks[0].detail, /one redirect/);
});

test("a JavaScript-only shell fails without echoing the response body", async (context) => {
  const site = await fixture({ shell: true });
  closeAfter(context, site.server);
  const report = await verifyPublicSeo({ origin: site.origin, timeoutMs: 2_000 });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.name === "Home HTML").ok, false);
  assert.match(formatReport(report), /JavaScript-only/);
  assert.doesNotMatch(formatReport(report), /enable JavaScript to run this app/);
});

test("off-origin sitemap data fails without printing a sensitive URL", async (context) => {
  const site = await fixture();
  closeAfter(context, site.server);
  const baseFetch = globalThis.fetch;
  const fetchImpl = async (url, options) => {
    if (new URL(url).pathname === "/sitemap.xml") {
      return new Response("<sitemapindex><sitemap><loc>https://elsewhere.example/private?token=hidden</loc></sitemap></sitemapindex>", {
        status: 200,
        headers: { "content-type": "application/xml" },
      });
    }
    return baseFetch(url, options);
  };
  const report = await verifyPublicSeo({ origin: site.origin, timeoutMs: 2_000, fetchImpl });
  assert.equal(report.ok, false);
  const detail = report.checks.find((item) => item.name === "Sitemaps").detail;
  assert.match(detail, /off-origin/);
  assert.doesNotMatch(detail, /token|hidden|private|elsewhere/);
});

test("duplicate or missing required sitemap URLs fail", async (context) => {
  const duplicateSite = await fixture({ duplicatePublicUrl: true });
  closeAfter(context, duplicateSite.server);
  const duplicateReport = await verifyPublicSeo({ origin: duplicateSite.origin, timeoutMs: 2_000 });
  assert.equal(duplicateReport.ok, false);
  assert.match(duplicateReport.checks.find((item) => item.name === "Sitemaps").detail, /duplicate public URL/);

  const missingSite = await fixture({ omitAbout: true });
  closeAfter(context, missingSite.server);
  const missingReport = await verifyPublicSeo({ origin: missingSite.origin, timeoutMs: 2_000 });
  assert.equal(missingReport.ok, false);
  assert.match(missingReport.checks.find((item) => item.name === "Sitemaps").detail, /required public URL \/about/);

  const pageOneSite = await fixture({ nonCanonicalPageOne: true });
  closeAfter(context, pageOneSite.server);
  const pageOneReport = await verifyPublicSeo({ origin: pageOneSite.origin, timeoutMs: 2_000 });
  assert.equal(pageOneReport.ok, false);
  assert.match(pageOneReport.checks.find((item) => item.name === "Sitemaps").detail, /noncanonical \/page\/1/);
});

test("social metadata, JSON-LD types, and crawlable directory anchors are enforced", async (context) => {
  for (const [problem, checkName, expected] of [
    ["missing-social", "Home HTML", /og:title/],
    ["wrong-about-schema", "About HTML", /AboutPage/],
    ["missing-events-anchor", "Home HTML", /crawlable \/events anchor/],
  ]) {
    const site = await fixture({ pageProblem: problem });
    closeAfter(context, site.server);
    const report = await verifyPublicSeo({ origin: site.origin, timeoutMs: 2_000 });
    assert.equal(report.ok, false);
    assert.match(report.checks.find((item) => item.name === checkName).detail, expected);
  }
});

test("tracking variants enforce canonical indexing without exposing functional queries", async (context) => {
  for (const [trackingProblem, expected] of [
    ["noindex", /noindex/],
    ["wrong-canonical", /canonical link/],
    ["privacy-cache", /must not be shared-cacheable/],
  ]) {
    const site = await fixture({ trackingProblem });
    closeAfter(context, site.server);
    const report = await verifyPublicSeo({ origin: site.origin, timeoutMs: 2_000 });
    assert.equal(report.ok, false);
    const check = report.checks.find((item) => item.name === "Tracking URL policy");
    assert.equal(check.ok, false);
    assert.match(check.detail, expected);
    assert.doesNotMatch(check.detail, /seo-verification-private-query/);
  }
});

test("oversized response declarations fail without downloading a body", async (context) => {
  const site = await fixture();
  closeAfter(context, site.server);
  const baseFetch = globalThis.fetch;
  const fetchImpl = async (url, options) => {
    if (new URL(url).pathname === "/robots.txt") {
      return new Response("not read", {
        status: 200,
        headers: { "content-type": "text/plain", "content-length": "999999" },
      });
    }
    return baseFetch(url, options);
  };
  const report = await verifyPublicSeo({ origin: site.origin, timeoutMs: 2_000, fetchImpl });
  assert.equal(report.ok, false);
  assert.match(report.checks.find((item) => item.name === "robots.txt").detail, /safe byte limit/);
});
