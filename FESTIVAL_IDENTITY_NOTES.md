# Festival identity and confirmed dates

This patch was based on these primary sources checked October 8, 2026:

- https://bootsandhearts.com/ — August 6–8, 2027, Burl's Creek, Ontario.
- https://bootsandhearts.com/west/ — separate West event, August 28–29, 2026, Fan Park at Ice District, Edmonton.
- https://bootsandhearts.com/lineup/ — describes 2026; no 2027 lineup imported.
- https://www.lostlandsfestival.com/ — September 18–20, 2026, with “see you next year”; no verified 2027 dates.

Ontario's canonical slug remains `boots-and-hearts`; Edmonton uses `boots-and-hearts-west`. Only this family opts into geographic disambiguation. Bare names without sufficient location evidence remain unassigned. Saved ambiguous rows remain in storage. Read projections show independently identifiable history under the appropriate festival without changing saved IDs. Forecasts no longer lead festival API, HTML, metadata or app answers; unannounced dates produce no future Festival/Event schema.

`festivalAnnouncements.js` records date-only source evidence. Readers apply it consistently, retaining saved edition IDs and plans when provider dates disagree, while suppressing lineup/ticket details attached to those conflicting dates. Announcements do not create database rows, plans, ticket inventory, times or lineups. Once passed, the announced dates remain in history. Existing plans with old days are retained unchanged; members can correct them using the existing plan editor. Multiple independently identified saved rows remain separate and retain their IDs rather than being merged.

## Reconciliation preparation — not executed in production

`reconcileBootsAndHearts(database)` defaults to a transactional dry run and returns proposed edition/listing slug changes plus skipped rows. Explicit `{ apply: true }` updates only `festival_slug` on narrowly evidenced saved rows. It requires independently agreeing edition identity and saved listing evidence at the same venue/city and dates; conflicting, ambiguous or unsupported rows are retained and reported. It never deletes/recreates editions or changes their IDs, ticket fields, plans or user posts. It is not called from schema setup, scans, reads or deployment.

Before any separately approved production repair, inspect a backed-up live snapshot, review the dry-run report against provider IDs and official location evidence, and compare edition IDs, all plan rows, ticket fields and user posts before/after. Unknown live rows cannot be inferred from the observed public page. Also inspect any existing 2027 Ontario rows and plans whose saved days differ from the confirmed dates. A fresh ingest can update a listing's slug; rebuilds skip duplication of its legacy edition while explicit reconciliation is pending. Ambiguous saved-ID collisions are skipped unchanged.

This branch is independent of Newsroom importer PR #36. It does not deploy or run a production data migration. Owner release control remains the normal GitHub PR merge process.
