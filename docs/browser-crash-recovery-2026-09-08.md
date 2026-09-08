# Browser crash diagnostics and recovery — 2026-09-08

## What the original alert means

The report `FATAL POST /client/landing PIT-APP-001 (RenderError.Web)` with request
`6d77b04d-5334-45f8-87f9-8fab09b78e05` identifies an accepted web render-crash report.
It does **not** identify the throwing component, exception message, variable, or
source location, and it does not establish that the original incident is solved.

`POST /client/landing` is a synthetic operational bucket, not the HTTP endpoint
that crashed. The browser posts telemetry to `/api/client-errors`; `landing` was
derived from the current pathname. `RenderError.Web` was synthesized from report
kind and platform, not taken from the actual exception class. The UUID belongs to
that telemetry request, not an earlier application request.

Legacy reporting discarded the original exception and component stack before
transmission. Persisted local diagnostics also contain catalogue text rather than
the original message or stack. The original exception cannot be recovered from
the email or error ledger. It might remain in the original open page's memory or
in independently retained browser diagnostics, but reload/retry can discard it.

The legacy fingerprint grouped all web landing render failures together, including
different causes and builds. The ledger keeps aggregate counts, first/last times,
hourly counts and the latest request UUID, not every occurrence or request UUID.
Client deduplication and server rate limits mean these are accepted-report counts,
not unique affected users or a count of every crash.

## New, bounded diagnostic identity

The reporter now extracts only a fixed exception category, a finite diagnosis
bucket, and (when available) a first-party emitted JavaScript asset location.
Examples of category labels in the stored cause include `Type`, `Ref`, `Range`,
`Syntax`, `Error`, and `Unknown`. Known minified React markers can add `react130`,
`react185`, `react301`, `react310`, or `react321`. They identify an error family;
they do not prove the complete root cause.

Location extraction accepts only same-origin browser stack frames under
`/_expo/static/js/web/`, with a compiled basename ending in a 32-character lowercase
hex asset hash and `.js`. Function names, complete URLs, queries, fragments, source
paths and the rest of the stack are discarded locally. The server then requires
that exact basename to exist as a regular, non-symlink file in its actual
`dist/_expo/static/js/web/` directory. Invalid or missing assets produce class-only
diagnostics. Native reports likewise do not retain a web location.

No raw message, stack, arbitrary message hash, account identifier, user-authored
content, cookies or authorization header is sent by this reporter. Web requests
use `credentials: "omit"` and `referrerPolicy: "no-referrer"`. Reporting has a
five-second completion deadline and a bounded deduplication cache, and must never
prevent recovery when the endpoint is unavailable.

The existing error ledger and alert email retain the additional identity inside
the `cause` field, without a database migration. A location-bearing cause has this
shape:

```text
RenderError.Web.Ref/b<assetHashBase36>.<lineBase36>.<columnBase36>
```

The `b` suffix contains the **full 128-bit hash from the emitted asset filename**,
losslessly represented in base 36; this is not a hash of a message or user content.
Line and column are the browser's generated-bundle coordinates, also in base 36.
Each is an integer from 1 through 9,999,999. The complete suffix is at most 38
characters, matching the existing cause-field sanitizer.

An asset hash identifies the compiled asset involved, not necessarily a unique
whole-application release: unchanged chunks can be reused between deployments.
Keep the matching release artifacts when investigating a report. If an older
browser reports an asset already removed from the server's current `dist`, the
location is deliberately rejected. There is no stale-build lookup or automatic
historical-artifact retrieval in this change.

## Decode a location without executing report content

Use only the suffix after `/` from an internal cause value. In a Node REPL opened
at the repository root, the following helper validates and decodes the value and
lists matching regular files. It only reads directory entries; it does not execute
the reported value, open URLs, read user data, or write anything.

```js
async function findCrashAsset(suffix) {
  const match = /^b([0-9a-z]{1,25})\.([0-9a-z]{1,5})\.([0-9a-z]{1,5})$/.exec(suffix);
  if (!match) throw new Error("Invalid diagnostic suffix");
  let value = 0n;
  for (const digit of match[1]) value = value * 36n + BigInt(parseInt(digit, 36));
  const line = parseInt(match[2], 36);
  const column = parseInt(match[3], 36);
  if (value > 0xffffffffffffffffffffffffffffffffn
    || ![line, column].every((n) => n >= 1 && n <= 9_999_999)) {
    throw new Error("Diagnostic value exceeds allowed bounds");
  }
  const hash = value.toString(16).padStart(32, "0");
  const { readdir } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const directory = resolve("dist/_expo/static/js/web");
  const entries = await readdir(directory, { withFileTypes: true });
  const assets = entries.filter((entry) => entry.isFile()
    && /^[A-Za-z_][A-Za-z0-9_-]{0,63}-[a-f0-9]{32}\.js$/.test(entry.name)
    && entry.name.endsWith(`-${hash}.js`)).map((entry) => entry.name);
  return { hash, line, column, directory, assets };
}
```

Call `await findCrashAsset("<validated suffix from the cause>")`. An empty `assets`
list means the matching artifact is not in this checkout's current build. Do not
substitute a different build's source map or infer the original location from a
similar filename. Any source-map lookup must use the exact matching release's
privately retained artifacts. This change neither publishes source maps nor adds
an endpoint exposing diagnostic records or source files.

## Support reference and recovery

The HTTP boundary generates the response's `X-Request-Id`. The reporter accepts
only a UUID-shaped value from that header and returns `{ requestId }` on successful
transport; skipped or failed reports return `false`. The crash boundary uses that
receipt for the same active crash so the displayed reference can match the ledger
and alert. A late response must not overwrite a retried or unmounted boundary.
Legacy or headerless responses do not manufacture a server reference.

Use retry/reload before a local-data reset where appropriate. A local-data reset
requires explicit confirmation and clears local app state, including the session;
it is a recovery action, not evidence of a diagnosed cause. Reproduce suspected
causes locally and verify their fixes separately. Improved reporting will make a
future recurrence more identifiable; it cannot retroactively reconstruct the
original incident.

## Duplicate-digest correction

The previous digest checkpoint was rounded down to an hourly occurrence bucket.
Consequently, a new error could trigger an email that repeated an already-reported
older crash, with the same request UUID and unchanged `1x` count. In-memory
checkpoint loss on process restart could also replay recent records. Seeing that
old reference again was not proof of another occurrence or increased traffic.

Delivery now uses additive, private bookkeeping tables:

- A per-fingerprint acknowledged count separates historical volume from newly
  reportable occurrences. Only the captured counts advance after the mail service
  confirms successful delivery. A new occurrence arriving during delivery remains
  pending, including when it shares the same fingerprint.
- A successful-send timestamp preserves the cooldown across process restarts.
  Manual force bypasses cooldown only; it cannot resend acknowledged occurrences.
- A bounded frozen batch contains at most 20 rows of the existing safe diagnostic
  fields and counts. The same batch and content-derived provider idempotency key
  survive retries and restarts, even if additional errors arrive. Skipped or failed
  sends do not acknowledge anything. A local checkpoint failure after provider
  success also keeps that stable retry batch.

On the first upgraded boot, older ledger history is used as the baseline and is
not replayed. Recent serious faults within the configured initial cooldown
lookback are conservatively retained for an **Initial catch-up** digest because
legacy delivery history cannot establish which were successfully reported. Their
counts use the retained hourly buckets, so the boundary bucket can include older
occurrences; if recent legacy rows have no buckets, their unknown counts are kept
rather than silently acknowledged. This one-time catch-up can therefore repeat a
legacy alert. It does not erase the ledger or label an unknown recent fault as
successfully delivered. Subsequent acknowledged counts do not replay.

This correction does not add a continuous retry worker. The existing scheduler
drains when another alert trigger occurs; a trigger rejected during cooldown does
not automatically schedule a wakeup at cooldown expiry. Pending counts remain
available for a later trigger or an authorized manual test, subject to the existing
ledger retention policy. Provider idempotency also has the provider's own retention
and delivery guarantees; the application cannot promise indefinite exactly-once
email across an arbitrarily long uncertain provider outage.

## Separately reproduced startup defects fixed in this release

- A saved `pit.feed.preferences.v1.<accountId>` value of `{}` or `42` caused
  `new Set(noniterable)` during account adoption. Validation had already advanced
  its sequence, so its failure looked stale and left the app loading indefinitely.
  Saved hidden-post IDs are now projected through an array/string validator before
  creating the Set. Valid choices are preserved and malformed server responses do
  not overwrite valid device preferences.
- An unknown or malformed saved `pit.tab` selected no screen and showed an empty
  shell. Startup now accepts only the four existing main tabs, otherwise Feed.
- Injecting `upcomingEvents: [null]` into the optional landing sidebar reproduced
  a web render crash at the event-key expression. The landing preview now skips
  invalid rows before taking its three-item limit. This is a regression safeguard,
  not a claim that the production API emitted null during the reported incident.

These changes do not reset accounts, delete posts or uploads, change passwords,
or alter production database records. Fault reproduction uses synthetic accounts,
isolated browser storage, and intercepted network requests.

## Release validation

- Full release check: 3,509 tests passed; production dependency audit reported
  zero vulnerabilities; syntax, architecture and production web export passed.
- Initial web JavaScript: 487.8 KiB gzip within the existing 512 KiB budget.
- Final built-app startup matrix: 19 of 19 cases passed explicit content and
  hydration assertions. This covered malformed saved preferences, histories,
  feeds and tabs, unavailable photos, a sidebar 503 and a null event row. No
  unexpected browser exceptions, crash reports or recovery boundaries occurred.
- Built-app crash/receipt checks at 390px and 1280px induced a local render failure,
  verified anonymous metadata-only reporting and server asset validation, matched
  the recovery reference, and recovered with Try again. All requests were local
  or intercepted; no production alerts were generated by these tests.
- Fresh live public browser checks of the mobile landing, desktop landing and
  public feed observed no render errors, with all write requests blocked. This is
  a sample, not proof that every production account or device is unaffected.
