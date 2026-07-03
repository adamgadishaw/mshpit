# Efficient storage — moving to on-device SQLite

Today the catalog lives in `src/seed/catalog.generated.json` and is loaded whole
into memory (via `store.js`). That's fine at prototype size but won't scale to the
artist/venue/event/photo volume we're heading toward — every launch parses one
large blob, every search scans arrays, and photo URLs are duplicated across events.

Target: an on-device **SQLite** database (like real music apps), normalized and
indexed, with images lazy-loaded and disk-cached. Scaffolded in
[`src/db/schema.js`](src/db/schema.js) — nothing imports it yet, so the app is
unaffected until we wire it in.

## Schema (normalized)

```
artists(id, key, name, genre, photo, updated_at)
venues (id, key, name, city, region, country, lat, lng, capacity, photo, updated_at)
events (id, artist_id→artists, venue_id→venues, date, ticket_url, sold_out, release_at)
photos (id, url UNIQUE, owner_kind, owner_id, source, credit, removed, ord)
meta   (k, v)
```

Wins over the JSON blob:
- **Events reference IDs**, not embedded copies of the artist+venue objects.
- **Photos are one row per URL** (deduped), with a `removed` flag → takedowns are
  a single `UPDATE`, and the gallery self-heals with a `WHERE removed=0` query.
- **Indexed** name/city/artist_id → search is a b-tree lookup, not a full scan.
- Screens read only the rows they show; memory stays flat as the catalog grows.

## Migration steps (incremental, low-risk)

1. `npx expo install expo-sqlite expo-image`
2. On first launch: `openDb()` → `seedFromCatalog(db, catalog)` (idempotent; sets
   `meta.seeded=1`). Ships the current JSON once, then the DB is the source of truth.
3. Add a thin `dbStore` with the same function names `useStore()` exposes
   (`searchVenues`, `artistGallery`, `topArtists`, …) backed by `queries.*`.
   Screens don't change — they already call those names.
4. Flip `useStore()` reads to `dbStore` one domain at a time (venues → artists →
   events → photos), keeping the in-memory store for session-only social state
   (feed, follows, DMs) until a real backend exists.
5. Point the **continuous scraper** at the DB: `scraper-worker.mjs` does
   `UPDATE artists SET … ; INSERT OR IGNORE INTO photos …` per record instead of
   rewriting a JSON file — which also removes the metro-rebundle churn.

## Images — lazy load + disk cache

Swap `Image` in [`SmartImage`](src/components/SmartImage.jsx) for `expo-image`:
- automatic **memory + disk cache** (`cachePolicy="memory-disk"`) so a photo is
  fetched once, then served locally — the biggest bandwidth/perf win.
- `recyclingKey={url}` + `transition` for smooth lists.
- Only the ~5 visible gallery photos load; the backfill pool stays as URLs in
  `photos` until needed.

## Note on web

`expo-sqlite` runs natively on iOS/Android and on web via wa-sqlite. Since we're
previewing on web, wire step 3 behind `Platform.OS` (native → SQLite; web → keep
the JSON store) until the web build is validated.
