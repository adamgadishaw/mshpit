# Pit — current engineering guide

Read these files before editing:

1. `AGENTS.md` — requires the exact Expo SDK 56 documentation.
2. `BRIEF.md` — product vision and the Performance/Artist/Venue data spine.
3. `HANDOFF.md` — current branch, completed work, validation, and blockers.
4. `SCALING.md`, `SECURITY.md`, and `MIGRATION.md` for longer-term constraints.
5. `ERROR_CATALOG.md` before changing API, upload, playback, persistence, or error handling.

## Product contract

Pit is a social network for music fans centered on concert logging and reviews.
The interface is established. Reliability, data integrity, accessibility, and
scale work must preserve the current visual design unless the owner explicitly
asks for a redesign.

The core entity is a **Performance**: artist + venue + date. Reviews, attendance,
photos, lounges, recommendations, and notifications should reference a canonical
performance ID instead of reconstructing identity from display strings.

## Current stack

- Expo SDK 56, React 19.2, React Native 0.85, React Native Web 0.21.
- SDK-matched native modules include Image Picker for uploads and FileSystem +
  Sharing for portable account exports. Check the exact SDK 56 page before using
  a newer/legacy API; `File`/`Paths` is the current filesystem surface.
- JavaScript/JSX and `StyleSheet`; no TypeScript or UI framework yet.
- `App.js` owns the existing overlay navigation and screen wiring.
- `src/store.js` is the legacy client facade. It mixes server hydration, cached
  state, mutations, player recommendations, and compatibility data; reduce it in
  small tested extractions rather than rewriting it in one pass.
- `src/lib/api.js` is the client API boundary.
- `src/lib/diagnostics.js` and `src/lib/errorCatalog.mjs` own failure capture and
  user copy. Components should not invent ad-hoc technical error messages.
- `src/lib/mediaUpload.js` and `server/media.js` own the durable upload contract.
- `server/` is the Node 24 HTTP API backed by SQLite on a persistent Render disk.
- `src/seed/catalog.generated.json` is legacy bundled catalog data. It is large;
  do not add new runtime data to it. Production growth belongs in the database.

## Non-negotiable data rules

- Never fabricate performances, sold-out status, ratings, reviews, attendance,
  users, posts, messages, or provider attribution in production.
- Keep demo data behind `EXPO_PUBLIC_ENABLE_DEMO_DATA=true` in development only.
- Upcoming dates must have a stable provider/source identity and must be future
  dates. Ticket search links are not evidence that a performance exists.
- MusicBrainz search tags are discovery hints, not canonical primary genres.
- Device-local `file:` and browser `blob:` URIs are not uploads. Production media
  must be stored durably before its URL is saved.
- Server responses are authoritative. Optimistic client actions need visible
  pending/failed states and reconciliation; do not silently swallow writes.
- Never save a selected device URI. Use `src/lib/mediaUpload.js` to upload first,
  then persist only the returned `http:`/`https:` object URL. Keep the form or
  draft intact when upload or save fails.
- Public failures use the existing stable `PIT-*` catalogue. Add a catalogue
  entry deliberately; do not surface raw server, provider, SQL, token, file-path,
  request-body, or stack-trace text. Include a short operation `context` on API
  writes so Diagnostics identifies the failure point without recording content.
- New list endpoints should use stable cursor ordering with a unique tie-breaker.
  Keep a compatibility offset only while an existing client still needs it.

## Code organization

- Screens: `src/screens/`
- Reusable UI: `src/components/`
- Provider/API adapters: `src/lib/`
- Pure domain helpers: `src/domain/`
- Demo and imported snapshots: `src/seed/`
- Server routes: `server/api.js`
- Database/schema/projections: `server/db.js`
- Ingestion/provider jobs: `scripts/`
- Regression tests: `*.test.mjs` using Node's built-in test runner where possible

Prefer a focused pure helper or provider adapter over adding another unrelated
responsibility to `src/store.js` or `server/api.js`. Do not perform a wholesale
state-management or navigation rewrite alongside a bug fix.

## Required checks

Before committing:

```text
npm run check
git diff --check
```

`npm run check` runs Node tests, server/script syntax checks, and the Expo web
production export. Add a regression test for every bug that can be isolated from
React Native rendering. Never commit `dist`, `.env`, secrets, or `server/data`.

## Publishing and handoff

- Update `HANDOFF.md` in the same commit as every behavior, schema, deployment,
  or provider change.
- State root cause, files changed, validation performed, migration/deployment
  requirements, and remaining risks.
- Build large or risky changes on a review branch, then merge to `master` and
  push without asking; that is the owner's standing instruction. `npm run check`
  must pass on the branch and again on `master` after the merge, since a master
  push auto-deploys. Do not silently mix unrelated user work into one branch.
- Current stabilization work is on `codex/stabilize-core`.
