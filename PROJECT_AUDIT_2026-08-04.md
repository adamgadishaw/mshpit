# Pit / mshpit.com — Independent Audit, 2026-08-04

Audited by Claude from a cold start (no assumptions from prior handoffs; every
claim below was re-verified against the actual repo, build, and live production).

---

## Executive summary

**The codebase is in good shape. The blockers are hosting and data-shape, not code quality.**

| Area | Status |
|---|---|
| Build / tests | ✅ Green — 185 tests, syntax (68 files), web export |
| Production site | 🔴 **DOWN** — 502, Render free tier |
| Uncommitted work | ⚠️ **Would hard-crash prod if deployed as-is** |
| Security | ⚠️ One real issue: unrestricted public Maps key |
| Dependencies | 🟡 12 advisories (1 high), all build-time, not runtime |
| Mobile performance | 🔴 4.19 MB single chunk, mostly bundled catalogue data |

---

## 1. Found and FIXED this session

### The build was broken (mojibake in the date test) — fixed, committed `cb16c70`

`src/domain/dates.test.mjs` asserted against `"2026 Â· 07 Â· 28"` — a UTF-8
middot (`·`) written as Latin-1, i.e. double-encoded. That is not a valid date
separator, so `toIsoDate` correctly returned `""` and `initialComposerDate`
preserved the raw string instead of silently dating the post today. The test
expected clean ISO, so it failed.

**The parser was right; only the test file was corrupt.** Verified directly:

- clean middot `2026 · 07 · 28` → `2026-07-28` ✅
- mojibake `2026 Â· 07 Â· 28` → `""`, original preserved ✅ (correct: never invent a date)

Lines 9 and 40 of that file keep `U+FFFD` **on purpose** — those are the
mangled-input cases and they pass. Only the double-encoded sequence was repaired.

> This is the third time encoding corruption has appeared in this repo. It comes
> from a tool writing UTF-8 bytes as Latin-1. Worth a pre-commit guard.

---

## 2. 🔴 CRITICAL — the uncommitted work will take the site down

There are **28 modified + 6 new files uncommitted** on branch
`codex/deep-bug-scrape` (ChatGPT/Codex ran out mid-session). The gate passes,
and most of it is genuinely good defensive work — but **it must not be deployed
to the current free-tier service.**

New `server/dataDirectory.js` makes production **refuse to boot** unless the
data directory exists and already contains `pit.db`. Verified by simulation:

| Environment | Result |
|---|---|
| prod + mounted disk + existing db | ✅ boots |
| prod + dir exists, no `pit.db` | ❌ throws (by design) |
| prod + `PIT_DATA_DIR=/data` **not mounted** | ❌ **throws — permanent 502** |
| prod + `PIT_ALLOW_EMPTY_DB_BOOTSTRAP=true` | ✅ boots |

**The intent is correct** — it stops production silently creating an empty
database, which is exactly what makes every account and post look deleted.

**The danger:** on the free tier `/data` is never mounted, so this converts
"sleeps and loses data" into "**never starts at all**". Today's outage is
intermittent; with this deployed it would be total.

**Rule: do not deploy this branch until the Render service is on a paid plan
with the disk mounted.** After that, it is a genuine improvement.

---

## 3. 🔴 Production is down — hosting, not code

- `www.mshpit.com/api/health` → **502** (3/3 probes)
- `mshpit.onrender.com/api/health` → **502**, header `x-render-routing: dynamic-paid-error`

The code is **not** at fault — it boots cleanly in production mode locally
against both a fresh disk and the existing database.

**Root cause: Render free tier** (owner confirmed: "I don't pay for Render").

1. **Spin-down** — free services sleep after ~15 min idle and 502 until woken
   (30–60 s cold start). That is why it "recovers then fails again."
2. **No persistent disk** — free tier ignores the `disk:` block in
   `render.yaml`, so the filesystem is ephemeral and **`pit.db` is wiped on
   every restart**. This is the real cause of data resetting, the artist count
   dropping, and the J. Cole post vanishing.

`render.yaml` is already correct (`plan: starter`, 1 GB disk at `/data`). The
**running service does not match the blueprint**.

**Fix (owner, Render dashboard — cannot be done in code):** upgrade the web
service to **Starter** (~$7/mo) and attach the disk at `/data`.

---

## 4. ⚠️ Security

### Real issue: the public Google Maps key is not referrer-restricted

`EXPO_PUBLIC_GOOGLE_MAPS_KEY` is embedded in the client bundle. **That part is
expected** — the `EXPO_PUBLIC_` prefix means "ship to the client", and browser
Maps keys are inherently public. It is only safe if the key is *restricted*.

Tested the live key directly:

- YouTube Data API → **403 blocked** ✅ (correctly API-restricted; the
  quota-critical YouTube key is a separate server-only key — good design)
- **Geocoding API → succeeded from an arbitrary machine** ❌

So anyone can lift the key from mshpit.com and bill Google Geocoding to your
project.

**Fix (owner, Google Cloud Console):** add an **HTTP referrer restriction** to
that key — `https://www.mshpit.com/*` and `https://mshpit.com/*` — and keep the
API restriction to only the Maps/Places APIs the app actually uses.

### Checked and clean

- ✅ No `.env` tracked in git.
- ✅ No Resend/AWS credentials in the bundle. (An automated scan flags `re_…`
  matches, but **all are false positives** — they are image filenames such as
  `Marquee_theatre_f8d7c5cd….jpg`, not Resend keys. Verified by context.)

---

## 5. 🟡 Dependencies — 12 advisories, none runtime-exposed

- **1 high**: `brace-expansion`, reached only via
  `expo → @expo/fingerprint → minimatch`. **Build-tooling only, not shipped to
  users.** A non-breaking lockfile fix is available.
- **11 moderate**: the known `@expo/config-plugins` chain. `npm audit fix --force`
  would **wrongly downgrade Expo to v46** — do not run it.

Low urgency; no user-facing exposure.

---

## 6. 🔴 Mobile performance — the lag has a measurable cause

The main chunk is **4.19 MB in a single file** (4.63 MB total across 39 chunks).
Code-splitting is working — 38 small route chunks exist — but the main chunk is
dominated by **bundled catalogue data**, not code:

| Inside the main chunk | Count |
|---|---|
| Photo URLs | **17,818** |
| Wikimedia URLs | 2,505 |
| `galleryPool` entries | 1,009 |
| Venue `capacity` fields | 1,011 |

Every phone downloads and parses **all 1,009 venue galleries** before the feed
paints, to show maybe five. That is the single biggest lever on mobile lag.

**Recommended fix (highest ROI):** move `galleryPool` / `photos` out of the
bundled catalogue and serve them per-venue from the existing API. Keep only
name, city, coords, capacity in the bundle. Estimated main-chunk reduction:
**~2–3 MB**.

Largest source files (refactor candidates, not urgent): `src/store.js` 170 KB,
`server/api.js` 159 KB, `PlayerBar.jsx` 70 KB.

---

## 7. What is genuinely healthy

Worth stating plainly, because the outage makes things look worse than they are:

- **185 tests pass**, covering real regressions: date identity, YouTube
  budget/zero-search resolution, Wikidata channel discovery, post idempotency,
  media policy, draft policy.
- **Crash containment is correct**: process-level `uncaughtException` /
  `unhandledRejection` handlers keep serving; a 25-errors-in-60 s valve does one
  clean restart; the burst counter **resets every 60 s** (verified — a missing
  reset would slowly self-terminate the process).
- **Post idempotency is correct**: the client sends
  `clientMutationId = local post id`, so an automatic network retry dedups
  server-side. This is the double-post fix, wired properly.
- **Database migrations are safe**: every `ALTER TABLE` is wrapped in
  `try { … } catch {}`; boots verified against both fresh and existing schemas.
- **Search quota architecture is sound**: only `search.list` consumes the small
  daily bucket; the channel/catalogue path is free, so a known channel resolves
  a song at budget = 0.

---

## Priority order

**Owner (outside the code — nothing else matters until #1):**
1. 🔴 Upgrade Render to Starter + mount the disk at `/data`. Fixes the 502s *and*
   the data loss.
2. ⚠️ Add an HTTP-referrer restriction to the public Google Maps key.

**Engineering:**
3. 🔴 Do **not** deploy `codex/deep-bug-scrape` until #1 is done. Then land it —
   it is good work.
4. 🔴 Move venue photo pools out of the bundle → the main mobile-lag win.
5. 🟡 Apply the non-breaking `brace-expansion` lockfile fix; leave the Expo chain.
6. 🟡 Add a pre-commit encoding guard so mojibake stops recurring.
