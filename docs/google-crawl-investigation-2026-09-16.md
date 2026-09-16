# Google crawl availability and indexing investigation — 2026-09-16

## Evidence, not an all-clear

Search Console screenshots report 52,022 discovered/not-indexed URLs, 662
crawled/not-indexed URLs, 595 noindex exclusions, 197 not-found URLs, 125
redirects, 261 alternate canonical selections, and four URLs in the indexing
report's server-error group. The separate crawl-request report lists 91 error
examples. These are different report populations, not contradictory counts or
91 pages of results. They do not establish the reason Google excluded every URL.

The prior reliability release `6d5dab5` became live on Render on September 16 at
18:20:01.999 UTC. That fixes neither historical reporting nor every server issue.

### Confirmed September 15 deployment interruption

The screenshot's `/event/tm_1AdZZ_oGkRgzH-I` request is present in Render request
logs at `2026-09-15T18:09:14.522640544Z` (14:09 Toronto), HTTP 502. Its user agent
identifies as Googlebot; the matching Search Console example independently
supports the correlation. No identity/IP data is retained in this report.

| UTC time | Observed lifecycle |
| --- | --- |
| 18:08:32.991 | Old application logs shutdown |
| 18:09:14.522 | Reported event request receives 502 |
| 18:09:16.421 | Render starts the new start command |
| 18:09:23.727 | Local pre-migration backup verified |
| 18:09:26.292 | Application logs HTTP listening |
| 18:09:45.970 | Render marks deployment live |

The request failed before the replacement process even started. Another burst
at 19:01 coincided with that day's next deployment. The live service attaches a
5 GiB `/data` disk holding SQLite, so the old and new web instances cannot overlap.
[Render documents this limitation](https://render.com/docs/disks#disk-limitations-and-considerations).
Removing backup verification would not remove the approximately 43-second
old-shutdown-to-new-start interval. Keep the data-recovery safeguards.

### September 14 is a separate, unresolved historical cause

`/event/tm_vvG1HZbgBK01OI` received 502 at September 14 12:15:55.646 UTC (08:15
Toronto), matching the second screenshot example. Two other public requests
received 502 around 12:15:48–55. The application remained running, with no
deployment, process-fatal log, or public-projection exception in the inspected
12:10–12:20 window. Memory samples rose from 538 to 952 MiB against a 2048 MiB
limit, alongside background-work deferrals. This does not prove an OOM, and the
time correlation does not prove a background job caused the errors.

The existing HTTP policy closes completed-response idle connections after only
five seconds. [Render identifies short Node keepalive settings as a cause of
intermittent 502s](https://render.com/docs/troubleshooting-deploys#runtime-errors).
The accompanying fix keeps completed connections reusable for 120 seconds, with
Node's one-second buffer, without extending the 15-second header or 30-second
body-receive deadlines. It is a directly supported resilience correction, not
proof that this was the cause of those three historical requests. Regression
tests cover same-socket reuse, incomplete-header 408, and prompt idle shutdown.

## Current public checks (before this patch)

`node scripts/verify-public-seo.mjs --timeout-ms 10000` passed:

- Canonical HTTPS www origin and readable 97-byte robots file.
- Nine sitemap files containing 68,280 unique URLs; 24 sampled pages across
  eight URL classes returned semantic HTML with matching canonical/indexing
  metadata. This is a sample, not a validation of every URL's content.
- Home/about semantic HTML and proper 404/noindex for nonexistent routes.

The other three robots host/protocol variants redirect toward HTTPS www. The
HTTP apex takes two redirects; it does not currently return the old HTML robots
body shown in August's report. Do not add blanket disallow rules to hide errors.

Four former error examples (two events, Carhaix-Plouguer city, Spartanburg venue
directory) returned 200 with self-canonicals during the check. This proves only
present availability, not uninterrupted availability between checks.

Eight additional examples from the 662 crawled/not-indexed URLs returned 200,
self-canonical, index/follow:

- Glenorchy, Petaluma, Ergolding and Skagen city pages each expose one venue and
  one upcoming show; their visible copy is short and heavily templated.
- Romans-sur-Isere and Canakkale venue directories omit available show counts
  and next dates from their rendered HTML. The database already supplies these;
  projection/rendering drops them. The accompanying fix displays validated
  existing counts/dates, with no new provider fetch or invented editorial.
- The sampled Ray Volpe event contains a real date/time, street address and
  ticket link. Natalie's Grandview venue contains a street address and eight
  dated shows. Short text by itself does not establish an invalid page.

## Confirmed sitemap identity mismatch

A disposable database reproduces an event admitted to the sitemap using a
substantive review attached to a different artist with the same display name,
venue and date. The public document correctly rejects that unrelated review and
remains noindex when the event lacks complete standalone event evidence.

The accompanying fix aligns sitemap fan evidence with canonical artist identity,
preserves only unambiguous legacy null-key name evidence, and advances persisted
sitemap policy revision so older XML is rebuilt. It does not delete catalogue
records or loosen media/account privacy rules. This fixture proves a bug, not
its prevalence across the live catalogue or all 52,022 discovered URLs.

## Remaining work and safe boundaries

1. Deploy the combined verified fixes once; verify live commit, public checks,
   and request-error logs. Pushed is not the same as live.
2. Keep commit/push automatic per owner instruction, while grouping related
   verified changes into one release rather than serial production restarts.
3. Eliminating the attached-disk release gap needs an explicitly scoped data
   architecture migration (independently available database, then stateless web
   instances), restore testing, rollback and a cost review. Do not remove the
   disk, migrate live data, weaken backups or purchase services as an SEO patch.
4. Broader public caching requires a separate privacy/moderation-invalidation
   design; never cache private accounts, feeds or APIs to conceal downtime.
5. Improve sparse city pages using verified local facts and useful links, not
   bulk generated filler. Inspect Google's selected canonical for the duplicate
   group before inventing redirects or making valuable public pages noindex.
6. Request revalidation only after relevant live fixes. Validation is not a
   command to index all pages. Google can choose not to index a crawled URL.
   [Page indexing report documentation](https://support.google.com/webmasters/answer/7440203?hl=en).

No Search Console settings, database records, billing, cache configuration or
infrastructure were changed during this investigation.

## Local verification

- Full isolated regression suite: 5,072 passed, zero failures (82 seconds).
- Syntax: 627 Node files passed; architecture and whitespace checks passed.
- Focused sitemap/persistence suite: 50 passed, including identity/privacy parity
  and one streamed identity query for 2,000 events.
- Focused public-document/collection/city suites: 67 passed.
- Real loopback HTTP tests: reusable socket, incomplete-header 408, and prompt
  idle shutdown all passed. Receive deadlines remain unchanged.
- A fresh Render request-log query from September 16 18:21 UTC to the inspection
  time around 19:55 UTC returned no 500/502/503/504 entries. The query starts
  after the known deployment transition; this is a bounded observation, not a
  guarantee or evidence that the September 14 cause has been proven.

Production checks above describe release `6d5dab5`, before this patch. Keep the
subsequent commit, CI and deployment status separate when reporting completion.
