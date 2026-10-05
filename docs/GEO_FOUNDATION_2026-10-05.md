# GEO foundation — October 5, 2026

Branch: `codex/geo-foundation-20261005`.
Base: `a056e64d13ab6185f4b91965060fc492fb110326` (master verified remotely).

## First batch and intended effect

This batch improves release verification. It preserves the site's existing
public content and helps detect when search discovery would see a blocked,
empty, incorrectly canonicalized or different public entity page. It does not
promise citations, rankings or additional traffic.

Files: `scripts/verify-public-seo.mjs`, its test, this audit and `STATUS.md`.
No runtime/schema/route changes, new bios, ratings, badges, disclaimers, AI-only
text files, analytics integrations, credentials or service settings are needed.
PR33's venue collision containment and both video branches remain separate.

## Existing foundation reused

- `server/features/seo/publicDocumentRepository.js`, `publicEntityPolicy.js`
  and the projector already filter public evidence and identity bindings.
  Personal/empty/moderated/identity-held pages retain their existing rules;
  a held artist binding can keep a useful event page while suppressing the
  incorrect artist/profile relationship.
- `publicDocumentRenderer.js` supplies escaped semantic text, review content,
  internal links, metadata and safe JSON-LD. Artist identity uses validated
  MusicBrainz/source facts. Event/Review data is conditional on real evidence;
  provider ticket links are not invented prices or availability.
- `server/seo.js`, public tracking-query policy and canonical-alias handling
  already agree on clean canonical identities. Attribution-only parameters
  retain the clean page policy; functional/unknown/private queries do not gain
  indexability. Staging remains excluded. No structural URL migration is needed.
- A single read of production `/robots.txt` returned HTTP 200 on October 5:
  `User-agent: *`, `Allow: /`, `Disallow: /api/`, canonical sitemap URL.
  There was no explicit GPTBot group in this retrieved file. This batch leaves
  that policy unchanged; it does not infer or alter any separate edge controls.

## Added checks

Run the existing public verifier with the optional extension:

```text
npm run verify:seo -- --geo --origin https://www.mshpit.com
```

The ordinary verifier still checks sitemaps and sampled indexable HTML. GEO
reuses passing samples: home, about, and at most one artist/event/venue leaf.
It reports missing entity coverage instead of inventing sample URLs. It adds
at most **nine sequential GETs**, a **30-second cumulative probe budget**, and
the existing per-request timeout and response-size caps: 256 KiB for robots,
2 MiB for each HTML response (at most 16.25 MiB additional response content).
These are additional bounds, not a claim that the entire existing sitemap
verification finishes in 30 seconds or uses only nine requests.

The header is explicitly labelled `Mshpit-SEO-Verification` with an
`OAI-SearchBot` policy-probe marker. It checks the distinct search product's
effective robots rules and compares stable titles/headings/canonicals and
primary schema identities with ordinary public responses. Volatile review
counts and whole HTML bytes are not compared. Named training-bot restrictions
are not mistaken for search-agent noindex directives.
When Fetch has combined repeated HTTP fields and a later bare noindex could be
generic or belong to another bot, verification reports the ambiguity and fails
closed. Image-preview `none` remains distinct from the indexing directive `none`.

The extension checks `utm_source=chatgpt.com`, a mixed functional query and
`/settings`. Allowed private-page probes must remain noindex/no-canonical (HTML and HTTP) and
no-store. Explicit robots exclusions are reported without fetching those paths.
Root/path exclusions, challenges, redirects, noindex, malformed schema,
identity mismatch and size/deadline failures are findings. Requests use no
cookies/authentication, manual redirects, and no alternate-agent retries.

The robots parser now correctly ignores blank lines/comments and unrelated
directives when grouping user agents, merges repeated exact product groups,
and handles wildcard/path specificity and percent-encoded matching. Tests lock
down separation of OAI-SearchBot and GPTBot. No robots policy is generated or
modified by these checks.

Limitations: a simulated header does not establish access from verified bot IPs,
actual indexation, ranking or citations. Sequential parity can flag an editorial
identity change made between reads; inspect such a result before changing policy.
The full `--geo` production run has not been performed in this batch.

## Referral measurement with existing data

The repository does **not** currently provide an AI-referral dimension:

- `src/domain/analyticsPolicy.mjs`: opt-in product events retain categorical
  app entry and internal screen referrers, not external referrer/UTM URLs.
  `server/analyticsService.js` enforces consent and the same allowlist.
- `guest_search_daily` retains day, search kind, result bucket, outcome and
  count. It has no person/device identifier or referral source.
- `server/requestMetrics.js` retains aggregate category/status/timing/byte
  counts, not individual request URLs, queries or referral headers. Its
  `crawler` category means robots/sitemap requests, not AI-search visits.

Therefore an AI-specific historic visit/conversion count cannot honestly be
reconstructed from these first-party tables/counters. Preserve the missing-data
result; do not substitute total requests, bots, internal searches or a GEO score.

The next read-only measurement step is to inspect an **already enabled** CDN or
analytics referral report, if the owner has one. Use exact referrer hostnames
and already-retained source tags, aggregate by day and canonical landing-page
class, keep bot fetches separate from human referrals, and label absent source
as unknown (not zero). ChatGPT-tagged links alone are not verified attribution;
tags can be edited and some visits carry no referrer. Do not export raw query
strings, user identifiers or join this data to member events in this batch.

Existing Search Console data can establish indexed public pages and search
click/impression trends. Use only dimensions actually available in that account;
an undifferentiated Web total must not be relabelled AI traffic. No such account
report was accessed here. If no existing referral report has the needed fields,
prospective categorical collection requires a separate privacy/consent decision;
this batch adds no tracking or third-party data sharing.

## Validation and release gates

Focused tests cover the verifier and existing public-document, canonical,
tracking-query and analytics privacy contracts. Regression cases include
agent/path exclusions, training/search separation, challenges, noindex,
canonical/identity mismatch, malformed JSON-LD, missing sample coverage,
private query handling, request caps and deadlines.

- **118/118 focused tests passed**, including all 39 verifier cases, using
  `scripts/run-tests.mjs --test-concurrency=1` with
  `scripts/verify-public-seo.test.mjs`,
  `server/features/seo/publicDocuments.test.mjs`, `server/seo.test.mjs`,
  `server/seoCanonicalAliases.test.mjs`,
  `src/domain/publicTrackingQuery.test.mjs`,
  `src/domain/analyticsPolicy.test.mjs` and
  `src/domain/guestSearchAnalytics.test.mjs`.
- Syntax checks for both changed JavaScript files, the architecture check and
  `git diff --check` passed. CLI help exposes the optional `--geo` flag.
- Independent review approved the four-file local scope after the HTTP
  canonical and crawler-header edge cases were fixed; the reviewer separately
  reran all 39 verifier cases and the whitespace check successfully. This is
  code review, not remote-push authorization or evidence of live bot access.

Only the public robots read used production. No broad live crawl, local browser,
heavy export/build, load benchmark, content publication, new resource, paid
service, credential, WAF change, merge or deployment occurred. Commit is local;
the prior remote-destination approval issue remains separate and unresolved.
Parent coordinates any later review-branch publication and cloud gates.

## Official sources checked

- [OpenAI crawler documentation](https://developers.openai.com/api/docs/bots):
  OAI-SearchBot controls search crawling independently of GPTBot training;
  ChatGPT-User is a separate user-triggered agent. This patch changes none of
  those site policies.
- [Google AI features and websites](https://developers.google.com/search/docs/appearance/ai-features):
  ordinary search eligibility, accessible text, internal links and accurate
  structured data remain relevant; no special AI file or schema is required.
- [Google structured-data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies):
  markup should represent visible, accurate page content.
- [Robots parsing specification](https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec):
  user-agent grouping, specific-group precedence, path matching and encoding.
- [Schema.org MusicGroup](https://schema.org/MusicGroup): includes solo musicians;
  the existing event performer type is not by itself a reason to rewrite schema.
- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/): checked as required by
  repository instructions; this batch does not modify Expo runtime code.
