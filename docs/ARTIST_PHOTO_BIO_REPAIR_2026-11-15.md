# Artist photo edits and Broken Social Scene repair

The reported live observation was `artist.bio` and its Wikipedia source intact,
with `profile.bio = null`, `bioStaffCurated = true`, and an avatar populated.
There is no raw pre-save snapshot. This change does not claim to reconstruct one.

The editor sent an untouched empty biography on every save. The API correctly
interprets an explicit empty string from staff as an intentional clear. Public
SEO projection consequently suppresses the catalog biography and its credit.

## Prevention

`artistProfileEditorPatch` includes biography only after a biography input event,
feedEnabled only when changed from the editor's initial setting, and only
explicitly changed image slots. Failed or unconfirmed saves keep that intent for
retry. A synchronous save lock prevents duplicate submissions before rerender.
The authoritative response retains bioStaffCurated in the client cache, and an
intentional staff clear opens as blank instead of showing a catalog fallback.
The API's intentional-clear contract remains unchanged.

Other fields: avatar/banner already use explicit change flags. Feed visibility
was also always sent and could overwrite a concurrent change; it now uses the
initial editor baseline. The separate Catalog Editor stages reviewed text and
completion receipts; it is not this artist-profile PATCH flow. No unrelated
venue or catalog editing redesign is included.

## One-record restoration — prepared, NOT run

Do not run either command against production until the operator approves the
repair. First deploy the prevention fix, or stop photo saves using old clients.
Use the approved server access procedure and a verified current database backup.
The script opens the supplied SQLite database directly without importing the
application DB module, running migrations, seeding, or contacting providers.

1. On the approved database, inspect:
   `node scripts/repair-broken-social-scene-bio.mjs --inspect /absolute/database.sqlite`
2. Securely retain and review the full returned snapshot and SHA-256. Check the
   exact artist identity, avatar and uploader against the incident evidence.
   The script cannot distinguish an accidental clear from a newly intentional
   clear based on NULL alone; human review of this incident is required.
3. Only after authorization, apply with that reviewed hash and a NEW durable
   audit file outside the checkout:
   `node scripts/repair-broken-social-scene-bio.mjs --apply /absolute/database.sqlite REVIEWED_SHA256 /durable/audit/broken-social-scene.jsonl`
4. Check the committed receipt and database row, then the public profile API and
   artist HTML: biography and Wikipedia/revision/license credit restored;
   avatar unchanged; title, description, robots, and sitemap eligibility reflect
   the restored catalog biography. Follow established cache refresh procedures
   if public output remains stale. Do not claim recovery until these checks pass.

The transaction is restricted to `broken social scene`, with the exact name and
public slug, an unclaimed nonremoved/nonheld profile, NULL biography and author/
retention fields, existing avatar/uploader, and valid Wikipedia attribution bound
to the current artist MBID and catalog biography. The SHA-256 covers **both full
rows**, so intervening changes abort. It changes only `bio_staff_curated` from 1
to 0; timestamps, media/provenance, feed, ownership, catalog text, and source data
are preserved. No profile deletion, copied staff biography, global reset, or
schema/backfill is involved.

The audit file is exclusively created with mode 0600 and fsynced before the
write and before commit. Any pre-commit audit failure rolls back. If the process
stops after commit but before the final receipt, inspect the database and audit
before retrying: outcome may be uncertain. A repeated apply fails the incident
state guard once repaired. Do not automatically reverse the repair if any later
legitimate edit has occurred. Keep the before-image with the incident record.

## Validation

Regression coverage exercises omitted fallback biographies, explicit edits and
clears, retry payloads, authoritative readback, concurrent feed preservation,
media authorization, staff-clear SEO semantics, and exact one-field restoration
with original attribution. The repair is exercised only against temporary test
databases; snapshot mismatch, changed biography, repeat invocation, and audit
failures are rejected or rolled back.

Focused validation command (107 tests passed):

```sh
node --test src/domain/artistPageEditor.test.mjs src/domain/artistPageRuntime.integration.test.mjs src/domain/artistPageCache.test.mjs src/domain/profileImagePolicy.test.mjs server/authorizationPrivacy.test.mjs server/features/seo/catalogSeoPropagation.test.mjs server/features/seo/publicDocuments.test.mjs
```

The worktree used Node 24 at `/Users/adamgadishaw/.local/node24/bin/node`
and read existing checkout dependencies through a temporary node_modules symlink.
No browser/native UI, production repair, deployment, or merge was performed.
A release still requires normal CI/build checks and deployed-client validation.
