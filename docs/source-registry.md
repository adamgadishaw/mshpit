# Sources registry — local implementation

Public entry: `/promotion-sources`, displayed as **Sources**. The route and base
canonical URL are unchanged. Exact attribution views use `?post=<post-id>` and
`?edition=<immutable-slug>`. Search/filter/page links preserve that target.
No current real edition or source data is included in this change.

## Coverage

| Existing source family | Master directory behavior | Provenance and limits |
| --- | --- | --- |
| Published news reporting citations (`news_stories.sources`) | Projected into each public article's Reporting group | Exact accepted original URL/name/credit; original JSON is never rewritten. Only article/unspecified and photo source kinds are projected. |
| Published news photo credits in the same JSON | Projected into Photographs | No inferred photographer, licence or permission. Existing article/photo credits remain visible in place. |
| Supplemental reporting, photographs, video, music, data | Admin-managed credit rows attached to an article, an edition, or both | Independent revision, order, public credit text and known licence/required attribution text. Exact duplicates are rejected; different creator, credit, licence or edition variants survive. |
| Standalone editions | Separate title, stable slug and draft/published/withdrawn visibility | Can contain clip/music/photo credits without a news article. Article-linked entries still require an available public article. |
| Registered mirrored artist share-card photographs | Paginated Catalogue photographs collection | Reuses `photoCredits.js`'s validated historical/current registry; links to existing `/photo-credits/<id>` pages with creator, exact licence, original source and modification details. No second inventory or browser download of the full registry. |
| Other public artist galleries, venue and city photographs | Linked from Catalogue photographs to the existing public artist/venue/city directories | Per-asset credits remain on those pages. Their historical database/photo pools are **not** imported into the master registry. |
| MusicBrainz, Wikidata, YouTube, Deezer, Ticketmaster, Setlist.fm, Wikimedia Commons, Openverse | Small searchable Data providers index | Provider names/usages are drawn from the existing `DATA_SOURCES.md` and product attribution/terms facilities. Links do not replace per-asset licences, provider branding or source links. |
| Event images, provider image URLs, user uploads, private media, evidence, drafts, legacy scraped/unverified images | No automatic import | Existing public display/credit controls remain authoritative. No scan of arbitrary database URLs, media objects, signed URLs, private correspondence or evidence files. |

Historical query-bearing links are intentionally omitted, except a YouTube
`/watch?v=<11-character-id>` link with exactly that one parameter. URLs must pass
the existing manual citation validator: HTTPS, public-style hostname, no
credentials/port. Known internal/private/evidence/admin/draft path segments are
also rejected, including percent-encoded segments. This is conservative URL
admission, not a way to verify a remote page's actual permissions or ownership.

The original citations remain the source of truth. An exact projected duplicate
can display once with `published article + registry` provenance while both
underlying records remain intact. Adding a missing licence is supplemental;
it never rewrites original citation evidence. Unknown licence fields stay blank.
Presence in Sources provides no clearance badge or automatic licence compliance.

## Admin workflow

Sign in with a verified **full administrator** session, then open Settings →
Newsroom → Sources. Editors and remembered-only Newsroom sessions cannot use the
admin endpoints. Article, media and publication controls retain their existing
authorization boundaries.

- **Article:** paste an existing public story link and load credits. Add a source
  or add details alongside a projected historical citation. Select a kind, enter
  creator/source name and original link, enter known credit/licence details, and
  save. Display order is a bounded integer. Optionally attach an existing edition
  by its stable link name.
- **Edition:** enter a lowercase hyphenated link name and readable title, save a
  draft, then load its credits. Add credits without creating an article. Save the
  edition as published when its public credits are approved; withdrawn/draft
  editions and their related supplemental credits are excluded publicly.
- Use “Open this edition's sources” to copy its exact link. On mobile, controls
  wrap and credit/licence fields support multiline text. Existing slugs cannot be
  renamed by the editor; title/visibility remain editable with revision checks.

Writes use the existing API adapter's expected-account identity binding and
server origin/CSRF protection, full admin checks, verification, rate limits and
moderation audit. A second session/role check immediately before commit rejects
revocation during audit and rolls back the audit and credit together. No source
endpoint is added to the remembered Newsroom allowlist. All admins may manage
site attribution; post authorship is not a grant of source-management rights.

Reads use parameterized SQL with escaped LIKE patterns. At most 20 articles and
20 editions per page are returned, each with at most 100 supplemental credits
and 100 historical citation candidates. Page is capped at 10,000 and queries at
160 characters. The fixed provider list and existing validated photo registry
are server-owned; only a 20-photo page reaches the browser. Search uses SQLite
filtering, not a new FTS index/trigger or a full-catalog startup download.

Admin state is mounted under an account key and removed when the role is no
longer admin. Loads use a request serial; changing article/edition mode prevents
an earlier load from taking over. Saves are serialized in the UI and revision
checked in SQLite. Reload credits after a conflict or uncertain network result;
an exact repeated add is rejected rather than silently creating a duplicate.

## Additive schema v1 and rollback

`ensureSourceRegistrySchema` creates only `news_source_editions`,
`news_source_credits` and their three indexes, inside the existing synchronous
IMMEDIATE transaction helper. It is idempotent and runs during route setup,
never from a public GET. The credit table references existing posts with
`ON DELETE CASCADE`; standalone edition credits have a null post reference.
Existing tables, columns, post URLs, article body, photos, engagement, citation
JSON and schema/user version are unchanged. There is no backfill, trigger,
provider fetch, paid call, dependency addition or production migration performed
by this task.

Before any separately approved release, review the additive DDL against a backup
of the target database and run existing deployment checks. This work is local
and is not a release approval.

**Normal rollback restores the older application and leaves both supplemental
tables and all rows in place. No destructive downgrade is required.** Old code
ignores these new tables, and existing article/photo credits continue to work.
Reapplying this code exposes the retained supplemental records again. Reopening
an existing fixture database and re-running initialization is tested. A destructive
drop is exercised only in an in-memory compatibility test, not offered as the
operational rollback. If public promotions later depend on supplemental deep
links, their continued attribution availability must be considered during release
rollback review; the previous policy-only page cannot display those records.

## Deliberate limits

No automatic permission adjudication, real-source seeding, original-credit
removal, bulk URL import, original story editing, member source submissions or
source deletion UI. There is no exhaustive per-asset provider/event/gallery
inventory. Admins can correct/order credits and withdraw an edition. Search is
bounded in returned data but may scan matching SQLite rows; a larger index would
need measured justification. Native APK acceptance and production rollout are
outside this task.
