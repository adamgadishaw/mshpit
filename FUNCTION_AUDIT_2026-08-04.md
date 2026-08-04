# Function-Level Audit — 2026-08-04

Inventory of **1,097 functions across 142 files**, scored for risk, then every
candidate hand-verified. This is a working list: check items off as they land.

> **Method note.** Automated pattern scans produce false positives. Every item
> in "Confirmed" below was opened and read. Everything disproved is listed in
> "Ruled out" rather than quietly dropped — so nobody re-investigates it later.

---

## Codebase shape

| Metric | Value |
|---|---|
| Functions | 1,097 |
| Files | 142 |
| `async` without `try/catch` | 110 |
| Empty `catch {}` blocks | 54 |
| Functions > 120 lines | 6 |
| `await` inside a loop | 20 |

Function density (refactor pressure):

| Count | File |
|---|---|
| **269** | `src/store.js` ← one file holds a quarter of the app |
| 63 | `server/musicProviders.js` |
| 61 | `server/api.js` |
| 45 | `App.js` |
| 24 | `src/components/PlayerBar.jsx` |

---

## Progress

| Item | Status |
|---|---|
| **B1** genre query | ✅ **FIXED** `1c05a98` — 32× fewer rows, + fixed a latent nondeterminism bug it exposed |
| **B2** theme atomicity | ✅ **FIXED** `1c05a98` — `src/domain/themeStorage.mjs`, 8 tests |
| **B3** rating race | ✅ **FIXED** `f25fd99` — `src/domain/latestWins.mjs`, 7 tests |
| **S4** upload latency | ⏸ **DEFERRED** — sequential is a *documented* mobile-memory decision; see below |
| **S2** player empty catches | ⬜ open |
| **S3** write-path async audit | ⬜ open |
| **S1** split `store.js` | ⬜ open (largest; do last) |

Test count: 185 → **201**.

### Note on S4 (photo upload latency)
The sequential loop in `addPhoto()` carries the comment *"Upload sequentially to
keep mobile memory predictable."* That is a deliberate tradeoff, and each upload
also resizes the image, so concurrency multiplies peak memory on exactly the old
phones most at risk. **I could not measure device memory from here**, so
overriding it would be a guess.

Recommended shape if pursued: bounded concurrency (2), not unbounded — it
recovers most of the latency while keeping peak memory to two buffers. Note it
weakens `shouldContinueMediaBatch`'s early-abort slightly, since one extra
request is already in flight when a systemic failure is detected.

---

## ✅ CONFIRMED BUGS — verified by reading the code

### B1 — `GET /api/discover/genres` loads the entire artist table per request
**`server/api.js:888`** · scale · **highest-value fix**

```js
db.prepare("SELECT genre FROM artists WHERE genre IS NOT NULL").all();
```

Pulls **every artist row** (2,658 today, 10k+ target) into JS on **every**
request, uncached, only to count them. It powers the Discover pie chart, so real
users hit it.

`canonGenre()` runs in JS, which is presumably why it wasn't a `GROUP BY` — but
that is solvable: group by the raw genre in SQL (~80 distinct values), then
canonicalize those ~80 rows instead of 2,658.

```sql
SELECT genre, COUNT(*) AS c FROM artists WHERE genre IS NOT NULL GROUP BY genre
```

Same output, ~33× less data today and ~125× at 10k artists.

---

### B2 — `persistTheme()` can half-write, un-scoping a theme across accounts
**`src/theme.js:151`** · correctness + mobile Safari

```js
if (typeof window === "undefined" || !window.localStorage) return false;
window.localStorage.setItem(THEME_STORAGE_KEY, next);   // ← can throw
window.localStorage.setItem(THEME_OWNER_KEY, ownerId || "guest");
```

The guard checks that `localStorage` **exists**, but in Safari private mode it
exists and `setItem` **throws** (`QuotaExceededError`). So the guard does not
protect the writes.

Two failure modes:
1. **Silent no-op** — both callers wrap in `try {} catch {}`, so the theme
   change just does nothing. At `theme.js:180` the `window.location.reload()`
   never runs, so the UI does not even reflect the attempt.
2. **Half-write (worse)** — if the *first* `setItem` succeeds and the second
   throws, the theme is stored **without its owner key**. The owner key is what
   scopes a theme to an account, so the next account on that browser can inherit
   it.

Note `storedThemeSelection()` immediately below *does* use `try` — reads were
guarded, writes were missed. Fix: wrap both writes in one `try`, and write the
owner key **first** so a partial failure never yields an unscoped theme.

---

### B3 — Rating GET can overwrite a fresher rating POST
**`src/store.js:2076` (`loadRating`) vs `2093` (`rate`)** · race · low impact

Both resolve into `setRatingAgg` under the same `aggKey`. If a slow
`loadRating` GET is in flight when the user rates, the GET can land *after* the
POST and overwrite `mine` with the pre-rating value — the star visibly reverts.

Bounded (same key, self-corrects on next load) but user-visible. Fix: a
per-key sequence number or drop stale GETs after a local write.

---

## 🔍 STRUCTURAL DEBT — not bugs, but they cause bugs

### S1 — `src/store.js` holds 269 functions in 170 KB
Every screen imports it, so any change risks the whole app and it is the hardest
file to test. Natural seams already exist: playback, playlists, feed, social,
ratings, search. Splitting is a large change — worth doing deliberately, not
opportunistically.

### S2 — `useYouTubePlayer()` is 403 lines with 13 empty `catch {}`
**`src/lib/youtubePlayer.js:82`** — the single riskiest function in the app.
The empty catches are *defensible* (the YouTube IFrame API throws on ordinary
races), but 13 of them means a real failure is indistinguishable from a benign
one. Recommend a tiny `swallow(reason)` helper that records to diagnostics at
debug level, so the intent stays explicit and failures stay visible.

### S3 — 110 `async` functions with no `try/catch`
Most are UI handlers where a rejection surfaces via the shared `api()` error
path, so this is not 110 bugs. But it is worth auditing the ~20 that perform
**writes** (`submit`, `doExport`, `toggleMembership`, `saveSnapshot`), where a
silent rejection means the user believes something saved that did not.

### S4 — `await` inside a loop in 20 places
Deliberate in the provider/warmer paths (rate-limit friendliness). Two worth a
look for user-facing latency: `uploadMediaAsset()` and `addPhoto()` upload
images **sequentially** — noticeable when posting several concert photos.

---

## ❌ RULED OUT — scanned as suspicious, verified as correct

Recorded so these are not re-investigated:

| Flagged | Verdict |
|---|---|
| `youtubePlayer.js:253-255` visibility/pagehide/pageshow listeners | ✅ removed at 388-390 |
| `useLiveChat.js:65` AppState listener | ✅ `subscription.remove()` at 79 |
| `store.js:465` feed-refresh listeners | ✅ both AppState **and** `visibilitychange` removed in cleanup |
| `db.js:616` lounge scan (no LIMIT) | ✅ one-time migration behind an `app_meta` marker |
| `api.js:569` `SELECT 1 AS ok` | ✅ health probe |
| `api.js:515` distinct-genre scan | ✅ cached in `_rawGenreCache` |
| `api.js:1833` DM thread query | ✅ windowed `ROW_NUMBER()`, bounded per thread |
| `App.js:327` `hardwareBackPress` | ⚠️ re-verify — RN subscription style differs |

**The listener-cleanup discipline in this codebase is genuinely good.** The scan
suggested 10 leaks; every one checked so far was already handled correctly.

---

## Suggested order

1. **B1** — one query rewrite, immediate Discover win, helps the scale goal.
2. **B2** — small, fixes a real mobile-Safari failure *and* a cross-account leak.
3. **S4 (uploads)** — parallelize photo upload; user-visible when posting.
4. **B3** — rating race guard.
5. **S2** — `swallow()` helper for the player's empty catches.
6. **S3** — audit the ~20 write-path async functions.
7. **S1** — split `store.js` (large, deliberate, do last).

> None of these are the reason the site is down. That remains the Render free
> tier — see `PROJECT_AUDIT_2026-08-04.md`.
