# MSHpit Google Search launch checklist

This is the release gate for public search indexing. Complete it against `https://www.mshpit.com` after routing, canonical, sitemap, or public-document changes. A passing local suite does not replace production checks.

## 1. Pre-deploy gate

- [ ] `npm.cmd run check`, the production web export, and `npm.cmd run verify:seo` pass.
- [ ] The runtime SEO inventory completes without query errors, row caps, duplicate URLs, or incomplete snapshots.
- [ ] Sitemap health reports a successful current or last-known-good snapshot and known refresh timestamp.
- [ ] Every shard contains at most 50,000 URLs and is smaller than 50 MiB uncompressed.
- [ ] Sitemap URLs are unique, absolute canonical `https://www.mshpit.com` URLs with no fragments or tracking/filter parameters.
- [ ] Representative route URLs return `200`, one self-canonical, one indexable robots directive, visible primary content, and no login wall.
- [ ] Private, blocked, deleted, duplicate, malformed, empty, and below-quality pages fail closed through the defined redirect, real `404`/`410`, or `noindex` policy.
- [ ] Page 1 uses the clean collection URL. `/page/1`, sort/filter/query duplicates, and equivalent variants are not independently indexable.
- [ ] Pagination uses sequential ordinary anchors, unique self-canonical page URLs, and no orphaned valid page.
- [ ] City pages meet content thresholds and use structured venue city plus ISO country identity; no thin doorway pages are emitted.
- [ ] Artist concert archives exist only for indexable artists with eligible public concert content.
- [ ] `robots.txt` permits public crawling and advertises exactly the canonical sitemap index.
- [ ] No staging, preview, localhost, IP-address, or alternate-host URL appears in production documents or sitemaps.

## 2. Origin and canonical host

- [ ] `https://www.mshpit.com` is the only canonical origin.
- [ ] HTTP and apex-host requests use one-hop permanent redirects to matching canonical HTTPS URLs.
- [ ] TLS is valid and Cloudflare/origin rules do not loop or rewrite canonical paths.
- [ ] Googlebot can fetch public HTML, CSS, JavaScript, images, and sitemaps without authentication, bot challenges, or rate-limit blocks.
- [ ] CDN caching preserves status codes and never serves authenticated/private HTML from a public cache.

## 3. Google Search Console

- [ ] Verify the `mshpit.com` Domain property through DNS.
- [ ] Keep the founder-controlled Google Workspace account and one recovery owner as property owners.
- [ ] Submit `https://www.mshpit.com/sitemap.xml`; confirm **Success** and record discovered URL totals per family.
- [ ] Inspect representative home, discovery, directory, artist, event, venue, city, post, profile, and artist archive URLs.
- [ ] Run **Test live URL** for each representative and confirm Google's live canonical matches the declared canonical.
- [ ] Request indexing only for highest-value launch pages after live tests pass; requests do not replace crawlable links and sitemaps.
- [ ] Review Page indexing, Crawl stats, HTTPS, Core Web Vitals, Mobile Usability, Manual actions, and Security issues.
- [ ] Save the launch-day Search Console baseline for later coverage comparisons.

## 4. Structured data and content

- [ ] Validate representative pages with Google's Rich Results Test.
- [ ] Organization/WebSite, artist/music-group, event, breadcrumb, and profile data describe visible same-page content.
- [ ] Structured data uses canonical URLs and stable identifiers.
- [ ] Event dates, status, venue, location, performer, images, and offers are factual and current.
- [ ] Referenced images are crawlable, representative, licensed, and use stable absolute URLs.
- [ ] No fabricated ratings/reviews, misleading memorial facts, or markup for hidden content.
- [ ] Each indexable route has a unique descriptive title, description, visible H1, and useful body content.
- [ ] Artist, venue, city, event, archive, post, and profile pages differ through real content, not interchangeable templates.
- [ ] Directories and detail pages use crawlable reciprocal links where the relationship is genuine.
- [ ] Navigation and pagination do not depend solely on client-side click handlers or infinite scroll.
- [ ] Memorial/tribute content is verified, respectful, and never published from an unverified death report.
- [ ] User content cannot set canonical, robots, or structured-data fields.

## 5. Performance and rendering

- [ ] Test representative mobile templates with PageSpeed Insights and field data when available.
- [ ] Record LCP, INP, CLS, TTFB, transferred bytes, and main-thread work per public template.
- [ ] Public HTML contains primary text and links before application hydration.
- [ ] Images have intrinsic dimensions, responsive renditions, supported formats, below-fold lazy loading, and intentional LCP priority.
- [ ] Fonts do not block primary content or cause avoidable layout shifts.
- [ ] Sitemap responses come from the atomic last-known-good snapshot; no HTTP request performs a full database build.
- [ ] Sanitized health exposes snapshot age, duration, row/shard counts, failures, and refresh state.

## 6. Launch-day verification

- [ ] Deploy and wait for application/database readiness.
- [ ] Confirm the sitemap manager loaded a persisted snapshot or completed its first background refresh.
- [ ] Fetch `robots.txt`, the index, every shard, and first/middle/last URL samples from each shard.
- [ ] Re-run `npm.cmd run verify:seo` against production.
- [ ] Run the runtime indexable-count inventory and compare eligible totals with sitemap `<loc>` counts and Search Console discovered counts.
- [ ] Confirm no release-time error spike, memory spike, database saturation, or refresh retry storm.
- [ ] Submit the sitemap only after production verification is green.
- [ ] Record deployment SHA, snapshot generation, inventory, verifier result, and Search Console submission time.

## 7. Post-launch monitoring

- [ ] Check sitemap refresh health and public-route errors during the first hour and first day.
- [ ] Review Search Console after 24–72 hours, then weekly while coverage grows.
- [ ] Investigate mismatches among eligible inventory, sitemap, crawled, and indexed counts by route family.
- [ ] Watch duplicate canonical selection, crawled-currently-not-indexed clusters, soft 404s, redirects, blocked resources, and 5xx responses.
- [ ] Keep expired events and removed/private content accurate using redirects, `404`, or `410`; never leave misleading indexable shells.
- [ ] Use internal links and accurate `lastmod` for normal recrawls; reserve URL Inspection requests for exceptional launches/repairs.
- [ ] Treat rankings separately from indexability. First-page placement also requires original useful content, reputable mentions/links, partnerships, engagement, and reliable page experience.

## Primary Google references

- [Build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Sitemap protocol limits](https://www.sitemaps.org/protocol.html)
- [Canonical URL guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Pagination and incremental loading](https://developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading)
- [Faceted navigation](https://developers.google.com/search/docs/crawling-indexing/crawling-managing-faceted-navigation)
- [JavaScript SEO basics](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- [Search Essentials and spam policies](https://developers.google.com/search/docs/essentials)
- [Search Console getting started](https://developers.google.com/search/docs/monitor-debug/search-console-start)
- [Ask Google to recrawl URLs](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl)
- [Structured data guidelines](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
