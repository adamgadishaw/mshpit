# Session Log — 2026-08-05 (Claude)

Cold-start audit → verified fixes. Every claim here was checked against the
actual repo, build, or live production; nothing is carried over on trust.

**Baseline at session start:** `2835347`
**HEAD at session end:** `2953f36` · pushed to `origin/master` · tree clean
**Tests:** 185 → **201** (all passing) · syntax 68 files · web export OK

---

## 1. Found the build broken (first action)

`npm run check` was **failing** before I changed anything.

`src/domain/dates.test.mjs` asserted against `"2026 Â· 07 Â· 28"` — a UTF-8
middot written as Latin-1 (double-encoded). Not a valid separator, so
`toIsoDate` correctly returned `""` and `initialComposerDate` preserved the raw
string rather than inventing a date. The test expected clean ISO → failed.

**The parser was right; only the test file was corrupt.** Proven directly:

| Input | Result |
|---|---|
| `2026 · 07 · 28` (clean middot) | `2026-07-28` ✅ |
| `2026 Â· 07 Â· 28` (mojibake) | `""`, original preserved ✅ |

Lines 9 and 40 keep `U+FFFD` **deliberately** — those are the mangled-input
cases and they pass. Only the double-encoded sequence was repaired.

→ `cb16c70`

> Third occurrence of encoding corruption in this repo. Root cause is a tool
> writing UTF-8 as Latin-1. A pre-commit guard is still open work.

---

## 2. Full independent audit → `PROJECT_AUDIT_2026-08-04.md` (`14983b3`)

Checked repo, production, security, dependencies, performance.

**Caught a deployment landmine.** 28 modified + 6 new files were sitting
uncommitted on `codex/deep-bug-scrape` (Codex ran out mid-session). The gate
passed and the work was good — but the new `server/dataDirectory.js` made
production **refuse to boot** unless the data disk was mounted. Simulated all
four environments:

| Environment | Result |
|---|---|
| prod + mounted disk + existing db | ✅ boots |
| prod + dir exists, no `pit.db` | ❌ throws (by design) |
| prod + `/data` **not mounted** | ❌ **throws — permanent 502** |
| prod + `PIT_ALLOW_EMPTY_DB_BOOTSTRAP=true` | ✅ boots |

Deploying that as-is would have converted an intermittent outage into a total
one. Fixed in `ee3339a` — **warn loudly instead of bricking** — which is why the
later deploy succeeded.

**Security:** the public Google Maps key is correctly **API-restricted**
(YouTube returns 403 — the quota-critical key is separate, good design) but was
**not referrer-restricted**: geocoding succeeded from an arbitrary machine.
Owner action, Google Cloud Console.
The apparent Resend-key leaks were **false positives** — image filenames like
`Marquee_theatre_f8d7c5cd….jpg`, verified by reading the surrounding context.

**Mobile lag, measured:** the 4.19 MB main chunk carries **17,818 photo URLs**
and **1,009 venue gallery pools**, all parsed before first paint.

---

## 3. Function-level audit → `FUNCTION_AUDIT_2026-08-04.md` (`8edc0e6`)

**1,097 functions across 142 files**, risk-scored, then every candidate opened
and read. Recorded what was **ruled out** as well as what was confirmed, so
nobody re-investigates: every listener "leak" the scan flagged was already
cleaned up correctly.

---

## 4. Fixes shipped

### B1 — Discover loaded the whole artist table per request → `1c05a98`
`SELECT genre FROM artists` pulled **every row** (2,658 today, 10k+ target) into
JS on every request, uncached, just to count. Now `GROUP BY` in SQL.

**Proved equivalence empirically against the real 2,658-row catalogue before
changing anything** — and the first run **failed**, which was the valuable part:
counts matched but *tie order* differed (England: `Electronic` vs `Dance-Punk`,
both count = 1). Ties resolved by insertion order — i.e. arbitrary DB row order
— meaning **the existing pie chart could already reshuffle between identical
requests**. Adding a deterministic name tiebreak fixed both.

Result: **2,658 → 83 rows scanned (32×)**, output identical across every country
and every `n`.

### B2 — Theme could half-write and leak across accounts → `1c05a98`
`persistTheme` checked that `localStorage` *exists*, but in Safari private mode
it exists and `setItem` **throws**. Two failure modes: silent no-op, and — worse
— first write succeeds, second throws, leaving a theme stored **without its
owner key**, so the next account on that browser inherits it.
Extracted to `src/domain/themeStorage.mjs`, owner key written **first**, both
writes in one guard. 8 tests.

### B3 — A slow rating GET could undo a newer rating → `f25fd99`
`loadRating` could resolve after `rate`'s POST and overwrite `mine` with the
pre-rating value, so the star visibly reverted. `src/domain/latestWins.mjs`,
7 tests.

### S2 — Playback failures made diagnosable → `afce0a1`
The player had **14 empty `catch {}`**, so a real failure was indistinguishable
from the ordinary races the IFrame API throws. Rather than log all 14 and create
noise, classified them:

| Kind | Sites | Decision |
|---|---|---|
| **User-initiated** — `playVideo`, `toggle`, `seekTo` | 3 | ✅ recorded as `PIT-MEDIA-001` |
| Teardown (destroy/remove on unmount) | 5 | silent — object already going |
| Cosmetic (`setSize`, `setVolume`) | 3 | silent |
| 500 ms position poll | 1 | silent — **would fire 2×/sec and bury the signal** |
| Automatic pause (visibility/observers) | 2 | silent — benign lifecycle |

Only what a *person* just did is traced. Verified the context strings shipped in
the bundle and the app boots with no console errors — the real risk was an
import cycle, which the build alone would not catch.

### S3 — Abuse reports were being silently discarded → `2953f36`
**The most consequential find of the session.**

`reportContent()` fired its POST with `.catch(() => {})` and returned
`{ ok: true }` **before the request resolved**. `ReportScreen` then displayed
*"this post was sent to the admin report queue"* **unconditionally**. If the
request failed, **no moderator ever saw the report** and the only trace was a
local entry on that one device.

Now awaits the write and reports honestly; the screen tracks
sending/sent/failed, disables the reasons in flight, and on failure says
*"Your report wasn't sent, so no moderator has seen it yet"* — not the generic
"could not finish that action", which never conveyed the report was lost.

**Verified both paths in-browser:** forced 503 → no false confirmation, explicit
failure, retry works. Real request → still confirms.

---

## 5. Where my own audit was WRONG (recorded on purpose)

S3's original framing — "~20 unguarded write paths" — was **mostly wrong**.
`api()` already toasts mutations by default, so a missing `try` is not itself a
bug. Of **68 writes**, only 7 suppress the toast and **all 7 are correct**
because the form shows a better error. Two are exemplary:

- **Account deletion** distinguishes an ambiguous network failure from a real
  server verdict, then **re-verifies the session** before claiming success.
- **`/api/forgot`** always returns `ok` deliberately — otherwise it would be
  account enumeration.

The real risk class was **fire-and-forget writes**, and only one mattered
(reports, above). The rest — analytics, play history, logout,
mark-notifications-read — are correctly best-effort and self-correcting.

---

## 6. Deferred, with reasons (not skipped)

**S4 — sequential photo upload.** The loop carries the comment *"Upload
sequentially to keep mobile memory predictable."* Each upload also resizes the
image, so concurrency multiplies peak memory on exactly the old phones most at
risk. **I could not measure device memory from here**, so overriding a
documented tradeoff would have been a guess. If pursued: bounded concurrency
(2), not unbounded — and note it slightly weakens `shouldContinueMediaBatch`'s
early abort, since one request is already in flight when a systemic failure is
detected.

**S1 — split `src/store.js` (269 functions, 170 KB).** Largest and riskiest;
every screen imports it. Genuinely the "do last" item.

---

## 7. Production status at session end

**UP and healthy** — `https://www.mshpit.com/api/health` → **200**, `database:
true`, `youtubeConfigured: true`, 7 YouTube searches used today.

Earlier in this session it was **502** with `x-render-routing:
dynamic-paid-error`. **Do not assume that is permanently resolved.** On Render's
free tier the service sleeps after ~15 min idle and 502s until woken, so a 200
can simply mean it woke up. The two free-tier consequences remain unless the
plan was upgraded:

1. **Spin-down** → intermittent 502s and 30–60 s cold starts.
2. **No persistent disk** → `pit.db` wiped on restart (the cause of data
   "resetting" and the J. Cole post vanishing).

**How the next session can tell the difference:** note the artist/post count,
then check again after a restart or a long idle. If it resets, the disk is still
ephemeral and the plan still needs upgrading.

---

## 8. Housekeeping

`2e15ce1` — stopped tracking `.tmp/` scratch; a **16 MB test database** had
slipped into a commit.
