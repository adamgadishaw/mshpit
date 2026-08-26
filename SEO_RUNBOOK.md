# Public SEO verification runbook

Run the verifier after every production deployment and after changing redirects, public routes, metadata, robots rules, sitemaps, or rendering:

```powershell
npm run verify:seo
```

To verify a preview or local deployment:

```powershell
npm run verify:seo -- --origin https://preview.example.com
```

The command performs read-only `HEAD` and `GET` requests with a 10-second timeout and bounded response bodies. It verifies:

- the supplied origin is final or reaches its canonical origin in one redirect;
- `robots.txt` is plain text and advertises the canonical sitemap index;
- the sitemap index and every child map are same-origin, well-formed XML within Google's 50 MiB and 50,000-entry limits;
- all primary sitemap URLs are canonical, same-origin, unique, and include `/` and `/about`; off-origin image and video asset locations remain valid;
- `/` and `/about` return indexable server-rendered semantic HTML with complete canonical, robots, social-card, favicon, and JSON-LD metadata;
- the home page exposes real crawlable artist and event directory links;
- an unknown URL returns a real HTTP 404 with `noindex`.

A failed check exits with status 1. An invalid command exits with status 2. The report omits query strings, credentials, response bodies, and request headers so deployment logs do not expose secrets. This is an operational smoke test, not a network step in `npm test` or the production build.

## Deployment checklist

1. Deploy the application and wait for the platform health check to pass.
2. Run `npm run verify:seo`. Do not submit the deployment to Google while any check fails.
3. Open [Google Search Console](https://search.google.com/search-console), inspect the final public URL, and request indexing for the home page and representative artist, event, venue, concert, and public-post pages.
4. Submit `https://www.mshpit.com/sitemap.xml` once. Google will revisit it; resubmit only when troubleshooting.
5. Validate representative rich-result pages with [Google's Rich Results Test](https://search.google.com/test/rich-results) after structured-data changes.
6. Record the deploy date and verifier result so later traffic or indexing changes can be tied to a release.

## Monthly SEO cadence

- Compare Search Console queries and landing pages month over month: impressions, clicks, click-through rate, average position, branded versus non-branded demand, and pages losing visibility.
- Triage Page indexing, HTTPS, sitemap, Event, Video, and other rich-result errors. Inspect representative URLs after fixes.
- Review Core Web Vitals and field performance by device; prioritize regressions affecting the most landing-page traffic.
- Retire or accurately mark stale and cancelled events, refresh changed venue details, and confirm event dates, status, performer, location, and ticket links.
- Crawl for broken internal links, redirect chains, accidental `noindex`, orphan pages, duplicate canonicals, and missing media.
- Publish or materially improve original artist, event, tour, venue, and concert-archive pages using firsthand fan contributions and cited factual sources.
- Earn legitimate links and mentions through artist, venue, festival, local press, community, and music-organization relationships. Track the page and editorial reason for each link.

## Practices we will not use

Do not keyword-stuff titles or copy, create doorway or near-duplicate city pages, fabricate artist biographies or fan reviews, or buy, trade, automate, or otherwise manipulate links. Those shortcuts make the product worse and can trigger spam actions rather than durable rankings.

The verifier establishes crawlability and technical eligibility. It cannot guarantee first-page placement. Competitive rankings also require useful original pages, accurate event data, strong internal linking, fast real-user performance, legitimate editorial links, and sustained artist, venue, and community authority.
