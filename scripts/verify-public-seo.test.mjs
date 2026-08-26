import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { formatReport, parseArguments, verifyPublicSeo } from "./verify-public-seo.mjs";

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
  redirectAlias = false,
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
      response.writeHead(200, { "content-type": "application/xml" }).end(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"><url><loc>${origin}/</loc><image:image><image:loc>https://media.example.test/public/cover.jpg</image:loc></image:image></url>${about}${duplicate}</urlset>`);
      return;
    }
    if (request.url === "/" || request.url === "/about") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        link: `<${origin}${request.url}>; rel="canonical"`,
      }).end(request.method === "HEAD" ? "" : page(origin, request.url, { shell, problem: pageProblem }));
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

test("the full public SEO contract passes and ignores off-origin media locs", async (context) => {
  const site = await fixture();
  closeAfter(context, site.server);
  const report = await verifyPublicSeo({ origin: site.origin, timeoutMs: 2_000 });
  assert.equal(report.ok, true, formatReport(report));
  assert.deepEqual(report.checks.map((item) => item.name), [
    "Canonical origin", "robots.txt", "Sitemaps", "Home HTML", "About HTML", "404 policy",
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
