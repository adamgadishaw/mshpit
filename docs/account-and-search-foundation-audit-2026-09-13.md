# Mshpit account boundaries and search integrity

The follow-up found defects in the connections between components: retried comments could duplicate after a lost response, older staff callbacks could inherit a replacement account, and artist evidence could be assigned through an unsafe name fallback. The fixes make request ownership, write ordering, and concert identity explicit across those layers. The release retains the existing authentication architecture without deleting accounts or making private content public for Google.

The search investigation also found a legitimate music artist called `sports.` and a separate artist/date association problem. The user's follow-up screenshot confirms a Google-selected sitelink labelled `Sports. — music artist reviews ...` beneath the main Mshpit result, alongside Support, two city pages, Skip the Use, and Privacy policy. It does not show Google classifying Mshpit as a sports-streaming site; the concern is the unhelpful shortcut selection. The exact query, linked URL, and crawl date are not visible in that screenshot.

## Evidence and limits

This review follows the [September 12 account audit](account-foundation-security-audit-2026-09-12.md). It combines code inspection, isolated regression tests, a read-only persisted local database check, bounded public production requests, and primary Google/OWASP guidance. It is not a production penetration test, a production database audit, or a guarantee that all vulnerabilities have been eliminated.

At the start of this pass, production served `index-54fd89160d94e2da035fd42047a0a489.js`, confirming that the preceding account release had reached the public site. The homepage, `/artist/sports`, `robots.txt`, and sitemap index returned HTTP 200. The broader public verifier checked nine child sitemaps, 65,812 unique URLs, and 24 page samples spanning eight route classes; its canonical, semantic HTML, sitemap, robots, and real-404 checks passed.

A separate event-catalog probe made 20 bounded requests, inspected 48 directory event links and three later directory pages, and sampled four leaves from 52,749 event URLs across two sitemap shards. It found no sampled pass, parking, VIP, class, stale-date, or invalid-range leaks. These samples establish the observed responses, not correctness of every catalog record or sustained uptime.

The persisted local database again passed all 34 executed checks, with zero findings and no file-size or modification-time change. Three linked-account checks were skipped because that database does not contain the relevant tables. Those skipped checks are not passes, and no conclusion about production linked-account records follows from this local snapshot.

## Layer 1: account identity and account state

Mshpit uses server-owned opaque sessions, not a JWT access-token/refresh-token pair. The previous audit covered hashed session storage, cookie handling, revocation, credential-change races, and account-bound linked grants. Adding another token system would not fix a component that applies an old response to a new account; that needs ownership checks at the point of dispatch and response adoption.

Authentication and authorization must remain distinct: a valid session establishes an identity but does not grant access to every object or action. Roles, verification, account restrictions, ownership, and relationships still matter. OWASP recommends least privilege, denial by default, and checking permissions on every request, including object-level access. [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).

| Account state | Intended access | Boundary that must remain authoritative |
| --- | --- | --- |
| Logged out | Public artist, venue, city, show, and deliberately public shared-content snapshots | No member feed or account mutation; an interaction prompts authentication |
| Signed in, email unverified | Browsing, optional setup, and narrowly allowed recovery/privacy/safety actions | No posting, following, reacting, messaging, or public-profile edits |
| Verified member | Permitted social actions and the member's own settings/content | Server object ownership, visibility, blocks, and restrictions |
| Linked-account switch | Explicit switch between eligible, independently proven accounts | New session plus account/epoch isolation; a shared email alone grants nothing |
| Suspended, banned, or revoked | Only explicitly permitted recovery/safety rights, where applicable | Fresh server-side account/session state, not an old client object |
| Moderator/admin | Only actions permitted to that current role and rank | Both the intended actor and live server authority; no inherited stale callback |

The table is a product and testing contract, not a claim that a hidden button is a security control. A guest or restricted account can still send a handcrafted request; the server must reject it. Conversely, an authorized member must receive an intelligible failure and keep recoverable work when a request cannot complete.

## Layer 2: intent, clicks, and changing accounts

An account-bound interaction has four separate checkpoints: which account rendered the control, which account dispatches the request, which account the server authorizes, and which account may receive the result. The existing mutation epoch prevents an A-to-B-to-A sequence from making an old A callback look current merely because the ID matches again. This pass extends that mechanism to the remaining audited staff utilities and adds executable callback regressions.

```text
Rendered account + login generation
  -> current-actor check when clicked
  -> expected-account binding on the request
  -> fresh server session + object permission check
  -> atomic write
  -> adopt result only in the originating account generation
```

This is intentionally one chain rather than separate rules for every screen. It reduces the chance that a delayed moderation action, profile edit, rating, or comment updates the wrong view after logout or switching. It does not authorize a stale request simply because both accounts have staff privileges. Staff callbacks also capture the rendered role generation, so an admin-to-moderator-to-admin transition cannot revive an older callback within the same account.

Session rotation and expiry belong on the server; clearing a client object is not sufficient logout enforcement. OWASP also distinguishes absolute expiration from optional renewal and warns that renewal itself has race conditions. This application retains its existing session architecture and tests revocation instead of introducing an unrelated refresh-token mechanism. [OWASP session management guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## Layer 3: durable social actions and retries

The comment route previously prevented some double-clicks in the interface but had no durable submission identity. If SQLite committed a comment and the response was lost, a user could retry the same text and create another row and notification set. The repaired route accepts an owner-scoped mutation ID and a hash of the post, cleaned text, and originally requested parent.

The permission check, retry lookup, insertion, and notifications run inside an immediate write transaction. The same owner and same payload receive the existing comment ID; a reused key with different content fails with a conflict. Another account may use the same random key without gaining access to the first account's result, and blocked, removed, or revoked states do not become accessible through replay.

Retry metadata occupies at most one validated 100-character ID and one 64-character hash per retained comment. It is not a separate ever-growing receipt log and does not duplicate the body. Soft removal retains the identity so a delayed retry cannot silently republish a removed comment; existing author/post deletion cascades remove the associated metadata.

The client retains a retry identity for the same owner, post, text, and parent intent rather than inventing a new identity after every network failure. Success or an edited draft changes that lifecycle. This guarantees deduplication only when the same intent key is reused; older clients without keys and separately recreated submissions are not magically exactly-once.

The database tests include two independent SQLite writers racing the same submission and injected notification failures. The required result is one comment and one notification set, with no partial successful write behind an error. Database deduplication and the displayed comment count are checked separately: a replay must reconcile a canonical visible count rather than blindly incrementing or skipping an increment.

An independent review caught another ordering edge: two successful responses could arrive in reverse order and make a count go backwards. Comment creation and own-comment removal now share a per-post, account-bound queue in the Store, and the server supplies the authoritative count. Different posts remain independent. Removal may legitimately reduce the count; the client does not hide the problem with a maximum-value workaround. Account ownership is checked both when queued work begins and before its result is adopted.

## Layer 4: settings persistence and ordering

The earlier patch stopped stale whole-user responses from overwriting unrelated current fields. That did not solve two updates to the same preference arriving out of order. The follow-up adds a bounded, Store-owned per-preference write queue while allowing unrelated settings to remain independent.

Queued work checks the originating account before dispatch and is not stored for automatic replay after another login. Errors remain observable to the caller. The preference and comment queues each allow at most 16 pending writes by default, remove settled entries, and keep unrelated keys independent. This improves ordinary same-tab acknowledged ordering; it is not a general server revision protocol across devices, tabs, or an ambiguous timeout where the server may still be working.

That distinction matters for privacy. A spinner stopping or a failed request does not establish the final database value. After an uncertain save, confirm the persisted preference; cross-device conditional updates and durable command ordering remain a separate follow-up rather than an unearned guarantee in this release.

## Layer 5: database integrity and recovery

The comment migration is additive: it adds bounded nullable metadata columns and a unique owner/key index without rebuilding or erasing existing comment rows. Requests from older clients remain accepted. New schema tests exercise repeated migration, pre-existing rows, transaction rollback on failure, uniqueness, invalid metadata, and foreign-key integrity.

Logical integrity, permission correctness, and recoverability are different properties. A clean foreign-key check cannot prove that every expected historical post is present, that a public CDN has purged an image, or that an offsite backup restores correctly. The existing counts-only checker is useful for detecting structural problems without printing private account content, but production backup and restore evidence remain required.

No production users, posts, comments, or media were deleted during this review. The local persisted database was opened read-only, and fixture mutations ran only in isolated temporary test databases. Existing author-deletion retention rules, including soft-deleted comment text and notification excerpts, were not silently changed.

## Layer 6: artist identity and search meaning

The live `/artist/sports` page used a self-canonical URL and the title `sports. upcoming concerts & artist profile | Mshpit`. Its published identity corresponds to the US pop-punk band `sports.`, not a sports category; the artist identifier and disambiguation were checked against the [MusicBrainz artist record](https://musicbrainz.org/artist/57c7570b-599e-4a84-9c0b-27f4250e3e94). However, the page also listed `JUNGLE - World Tour 2027` dates; the investigation therefore distinguishes a legitimate ambiguous name from incorrect event association rather than suppressing the artist by name.

The artist/date review traces provider billing evidence through the final public projection. Broad normalization can help find candidates but is insufficient final proof when punctuation distinguishes identities such as `Sports` and `sports.`. Provider matching now preserves terminal punctuation distinctions and explicitly reviewed aliases. It preserves an actually billed supporting artist while rejecting a contradictory lineup, with the same evidence policy applied to artist date selection, counts, candidate lookup, and sitemap eligibility. This is a targeted identity correction, not proof that every pair of similarly named artists is resolved.

The shared public event projection also reaches interactive tour-date and Discover responses, not only search HTML. When stored artist identity conflicts with an evidenced provider lineup, it displays the first usable billed artist and the public document omits the unsupported artist-profile link. Exactly billed supporting artists and legacy rows with no billing payload retain their existing association; malformed nonempty evidence cannot regain that legacy exception. Existing records are filtered and projected safely without bulk rewriting the production catalog or deleting concerts.

Independent review then reproduced a cross-layer regression: the corrected event displayed Jungle, but marking Going still allocated the old artist-name chat alias, so the displayed concert's lounge rejected its attendee. The repair keeps the stable event/provider identity authoritative and derives attendance labels from the same projection. At most two old/new aliases are accepted, each independently proven against a bounded venue/day candidate set; ambiguous or incomplete matches do not grant access. Existing assigned rooms are not reassigned to another show. Tests cover existing attendance, legacy-only records, forged aliases, non-attendees, removal, and ambiguous same-day concerts. No bulk attendance migration or account merge is performed.

The sitemap had a separate confirmed mismatch. An explicitly stored but unresolved artist key could fall back to a matching display name, borrowing that artist's index eligibility and `lastmod`. The fixed rule treats a stored key as authoritative and allows name fallback only for a genuinely keyless, unambiguous legacy row; tests cover missing keys, empty keys, valid keys with changed names, eligibility, and modification dates.

Snapshot selection revision advances from 5 to 6 so previously generated XML cannot bypass the corrected identity rule merely because it is fresh. Existing bounded background snapshot generation and last-good behavior remain in place. Requests do not trigger a full synchronous sitemap rebuild.

## Layer 7: what Google receives

Google can choose a title from page titles, headings, visible text, and link text; a developer cannot directly set the title shown for every query. Concise, specific, mutually consistent descriptions are therefore preferable to repetitive keyword lists. Changes need recrawling and reprocessing before they can affect search appearance. [Google title-link guidance](https://developers.google.com/search/docs/appearance/title-link).

Snippets are also query-dependent and often come from visible page content rather than the meta description. The useful optimization is accurate page-specific content: the correct performer, concert dates, city, venue, and available fan material. Do not promise photos, reviews, streaming, or ticket availability that the destination does not actually provide. [Google snippet guidance](https://developers.google.com/search/docs/appearance/snippet).

The screenshot confirms that the reported artist label was a sitelink, which Google selects automatically from site structure. Clear headings and relevant internal links help, but there is no supported command to choose a replacement sitelink. Removing a legitimate artist from the site solely to change one observed label would discard useful music content without proving the underlying cause. [Google sitelink guidance](https://developers.google.com/search/docs/appearance/sitelinks).

Live HTML already provides direct homepage links to Artists, Upcoming shows, Venues, and Music cities. All four destination hubs returned HTTP 200, self-canonical URLs, indexable robots metadata, and specific music headings in the follow-up check. The current site hierarchy is therefore not missing those entry points; that does not establish what Google crawled when it selected the screenshot's shortcuts. Adding more duplicate navigation or noindexing Support and Privacy policy was not justified by this evidence.

Sitemap submission is a discovery hint, not an indexing guarantee. Keep only preferred canonical, public, eligible URLs and use modification dates for meaningful content changes; Google ignores sitemap `priority` and `changefreq`. This release fixes the identity-based timestamp error rather than making every page look newly edited each day. [Google sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).

Public HTML, canonical links, internal links, and sitemap URLs should agree on identity. Private member pages remain private, and noindex settings are not removed to inflate indexed totals. Google treats canonicalization as a collection of signals rather than a guarantee that a declared URL will always win. [Google canonicalization guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls).

The public snapshots already contain semantic HTML rather than relying only on an empty application shell. Preserve the same public information for unauthenticated visitors and crawlers; do not reveal a richer private view only to Googlebot. Server-rendered public content also reduces dependence on the crawler's later JavaScript rendering queue. [Google JavaScript SEO guidance](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics).

## Layer 8: availability and measuring recovery

The earlier Search Console screenshots show actual host failures. Today's successful samples do not erase those outages or prove that Google has finished recovering. Google documents that 5xx responses and 429 overload signals reduce crawling, with gradual recovery once successful responses return; persistent errors can eventually remove URLs from the index. [Google HTTP-status guidance](https://developers.google.com/crawling/docs/troubleshooting/http-status-codes).

Crawl capacity and crawl demand are separate. Stable server responses help capacity, while useful content, relevance, popularity, and an inventory without unnecessary duplicates influence demand. Increasing the sitemap from tens of thousands of URLs to more URLs does not by itself increase clicks, and a large provider catalog is not a substitute for distinct, useful pages. [Google crawl-budget guidance](https://developers.google.com/crawling/docs/crawl-budget).

Approximately four-fifths of the observed sitemap inventory consists of events. That is an inventory characteristic, not proof that all event pages should be deindexed. Prioritize accurate, useful city and venue guides and artist identity, measure their impressions and click-through separately, and avoid promising that every imported provider page will be indexed.

The local inventory reporter now counts city guides separately and correctly groups double-/triple-digit sitemap shards. Previously, an `events-10.xml` shard could be reported as a separate dataset instead of events, obscuring scale comparisons. This is an observability correction, not a direct ranking signal.

## Release checks and remaining work

The final frozen source passed the complete release gate and the hosted-build regression rerun. Independent review corrections are included: canonical comment counts, ordered create/remove responses, and coherent event-to-lounge identity. An early new integration fixture failed its artist foreign key and contaminated the next case; the fixture was repaired and the complete API suite and final integrated suites passed afterward. No assertion or production permission check was disabled to obtain a pass.

| Check | Observed result |
| --- | --- |
| Complete `npm run check` | 4,555 tests passed; dependency, syntax, architecture, web export, and bundle gates passed |
| Render-like build flags, `npm test` | 4,555 passed, zero failures; the existing runner still isolates the database, removes real mail credentials, and owns its test-mode environment |
| Browser interaction/form suite | 50 passed, zero failures, against the exported client |
| Real browser plus isolated server | 12 passed, zero failures; cookie rotation, logout/replay, password changes/reset, wrong-account/cross-site writes, and parallel authenticated reads |
| Read-only persisted local database | 34 executed checks passed with zero findings; three unavailable linked-account checks skipped; database size and modification time unchanged |
| Bounded public production probes | Nine sitemaps, 65,812 unique URLs, 24 representative page samples, plus the separate event-catalog sample described above |
| Exported client | `index-533c963e93eec423bcc44602de3dbdc5.js`; initial JavaScript 502.2 KiB gzip against a 512 KiB budget |

The real-server concurrency cases used 5, 10, 50, and 100 simultaneous authenticated reads on localhost. They establish fixture correctness, not production load capacity. Focused regression totals overlap the complete suite and must not be added as separate coverage. Public probes were read-only observations of the deployed baseline; release rollout and subsequent Google recrawling are separate operational events.

The next operational comparison should use Search Console's exact query, page URL, country, device, dates, selected canonical, and last crawl. Compare impressions and clicks over matched periods, not only the number of indexed URLs. Inspect a small representative set of repaired artist, city, venue, and event pages after deployment rather than submitting thousands of URLs indiscriminately.

Open security work from the preceding audit remains visible: benchmarked versioned password-cost migration, privileged-account MFA/passkeys, mailbox-proven recovery of occupied signup slots, cross-device conditional preference writes, public/private media lifetime verification, durable abuse counters for multi-instance operation, and an isolated production restore drill. These require explicit designs or operational evidence; none is falsely marked complete by successful page probes.

## Primary references

Guidance was checked for this review on September 13, 2026. Google and OWASP pages are living documentation; their guidance supports the interpretation above, while application-specific findings come from code, fixtures, and the stated public observations.

- Google Search Central: [Titles](https://developers.google.com/search/docs/appearance/title-link), [snippets](https://developers.google.com/search/docs/appearance/snippet), and [sitelinks](https://developers.google.com/search/docs/appearance/sitelinks).
- Google Search Central: [Sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap), [canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), and [JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics).
- Google Crawling Infrastructure: [Crawl budget](https://developers.google.com/crawling/docs/crawl-budget) and [HTTP status behavior](https://developers.google.com/crawling/docs/troubleshooting/http-status-codes).
- Google Search Central: [Event structured data](https://developers.google.com/search/docs/appearance/structured-data/event), reviewed for accurate music-event eligibility rather than indiscriminate event markup.
- OWASP: [Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html), [session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), and [authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).
- Expo: [SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/), consulted for the installed framework before implementation.
