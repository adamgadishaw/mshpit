# Authentication, session and media boundary deep audit

Date: 2026-09-08. Status: working-tree implementation; not a production release or security certification.

## Scope and approach

Reviewed authentication, account linking, session persistence, logout, account-bound reads, request authorization, password recovery/change, account export/deletion, Owner approvals, share rendering, artist-provider writes, uploads and profile media attachment. Existing uncommitted credential-form improvements were preserved and included in verification.

Three independent review tracks examined server authorization, client identity transitions, and media permissions/dependencies. The main review examined password execution, transaction boundaries and HTTP races, followed by an independent second review of those changes. Expo SDK 57 documentation and the Expo networking guidance informed cancellation and platform compatibility; the existing server-side session design was retained rather than introducing an unnecessary refresh-token mechanism.

Evidence includes executable before/after regressions, isolated SQLite databases, actual route handlers over HTTP with deliberately held request bodies, and exported-app browser tests. The new full-listener harness runs `server/index.js` with a temporary database, synthetic accounts and outbound networking disabled. It does not read deployment secrets, test real credentials, send mail, modify production data or contact production storage.

## Confirmed findings and implemented repairs

| Boundary | Finding | Repair and evidence |
| --- | --- | --- |
| Password processing / availability | HTTP handlers ran synchronous scrypt on the main server thread. Concurrent credential work delayed unrelated requests. | Async scrypt with two active operations and at most 32 waiting; excess admission returns a controlled 429. No password cache or plaintext persistence. Existing hash format and exact-password semantics remain compatible. Queue failure/recovery and event-loop tests added. |
| Explicitly account-bound API responses | Supplying `expectedAccountId` bypassed the client generation check. A valid old-account response could be applied after a switch, including A-to-B-to-A. | Both JSON and binary responses now check the captured generation even with an explicit account ID. Eight delayed-response regressions reproduced the defect and now pass. |
| Cross-tab authentication without Web Locks | A late older sign-in response could change the shared cookie after another tab completed sign-in while its permission state remained signed in. | Observable stale authentication completions now fail closed and queue logout compensation. Network/HTTP failures and identity-mismatch outcomes are included. This is not a guarantee for a terminated tab that cannot observe its response; see limitations. |
| Navigation during linked-account switch | The switcher created an abort controller but did not pass its signal through the Store authentication coordinator. Browser Back could still adopt the target account. | Signal reaches the coordinator; canceled switches clear private state and compensate late cookie writes. Stale completion cannot call a dismissed screen's navigation callback. Reproduced on the old bundle at mobile and desktop widths. |
| Corrupted local auth ordering | A maximum-safe-integer persisted order caused logout to throw before private-state cleanup. | Saturating order arithmetic and blocking-intent preference for conflicting equal-order revisions. Reload, cookie-write failure and same-revision phase updates have regression coverage. This required corrupted/manually altered local state, not an established remote exploit. |
| Authorization between body-read and dispatch | Synchronous rating/follow/message handlers could use an already-captured user after revocation at that boundary. | The shared session-user helper rechecks the original session. Real handler tests cover logout, expiry, removed verification and bans with no resulting writes. |
| Long-running share images | Session, block, post and attendance decisions were captured before document/artwork/render awaits. | Recheck session plus the relevant post/attendance snapshot before and after rendering. Reject changed, removed, newly blocked or no-longer-authorized material instead of releasing the old result. |
| Artist provider writes | Provider lookup could outlive its actor's session or permissions and then save data. | Session and authorization rechecked inside the final database transaction. Provider-wait tests revoke the session, verification or role before completion. |
| Image decoder dependency | Installed Sharp 0.35.3 was affected by the vendor's high-severity libheif advisory. | Updated to Sharp 0.35.4; loaded libheif 1.23.2 verified. Image regressions and a patched-runtime floor test added; dependency audit reports no known vulnerabilities at the time of this review. |
| Partial signup | Verification setup could fail after the account was committed but before its cookie reached the response. | Account, cancellation capability, verification token, session and linked grants now commit together. Verification/session/grant failure injection proves full rollback with no queued mail. Email starts after commit; delivery failure preserves the restricted account and never auto-verifies it. |
| Native account-data export | An archive fetched for one account could continue through native module/sharing awaits after logout or account switching. | Capture account and mutation generation; recheck after each await and before sharing. Create a unique non-overwriting temporary file and clean up only the file this invocation actually created. Fifteen extracted production-callback tests cover race, cleanup, failure and success paths. |

The Sharp finding and patch follow the [vendor advisory](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c). Moving expensive password work off the event loop follows [Node's server responsiveness guidance](https://nodejs.org/learn/asynchronous-work/dont-block-the-event-loop).

## Safeguards required by the async password change

Making password work asynchronous introduces legitimate interleaving points. These were treated as new authorization boundaries, not just mechanical `await` edits:

- Signup/login revalidate password and email snapshots before disclosing account choices or issuing sessions.
- Password change, data export, account deletion and Owner decisions revalidate the original session and credential proof after awaited work. Password/link/session writes are atomic.
- Expensive linked-account proof happens outside a database transaction; granting a proven link happens synchronously within session issuance. There is no awaited password operation after a replacement session is committed.
- A replaced password or consumed reset token cannot issue another old-proof session. Concurrent real HTTP reset requests produce one success and one rejection.
- Restricted members retain legitimate recovery, export and deletion rights; those exceptions do not unlock social/media writes.
- Signup cancellation awaits deletion and propagates failure. Its server-only capability bypass is not a request-body flag, cannot select an arbitrary account, and still requires the exact cancellation hash and unfinished-onboarding state inside the transaction.
- Sessions expire at the exact expiry boundary rather than one millisecond afterward.

## Photo and content connection review

No additional media ownership bypass was reproduced in this pass. Existing and extended tests cover foreign asset IDs and variants, owner-bound originals and revisions, retired descriptors, avatar/banner attachment, revoked-session finalization, blocked-profile boundaries, and deletion/orphan ledgers. Actual avatar/banner route tests now reject foreign or retired media without partially saving the surrounding profile edit.

On the client, returning photo and binary results remain tied to both the original account and its generation. Picker cancellation and account-switch tests cover stale progress, late completion and rejected publication. None of this changes a public photo into a private revocable document; delivery limitations below still apply.

An independent final review confirmed that unchanged real post projections produce stable share snapshots (no newly generated timestamps or signed tokens). The snapshot is deliberately conservative: a concurrent like or comment can also require reopening the share, even if the photo's privacy did not change.

## Local password-work measurement

Measured the existing synchronous helper and replacement async helper on the same machine, with at most ten producers and the same scrypt parameters. These are password operations, **not users or site requests**, and do not estimate Render capacity.

| Password operations | Old longest event-loop gap | New longest event-loop gap |
| ---: | ---: | ---: |
| 5 | 179 ms | 16 ms |
| 10 | 343 ms | 16 ms |
| 50 | 1,655 ms | 23 ms |
| 100 | 3,283 ms | 22 ms |

At 100 operations, total measured work was 3,267 ms synchronously versus 1,721 ms through the bounded workers. Hardware, contention and hosted worker settings affect these values. The relevant improvement is that unrelated event-loop work can proceed while password computation runs.

## Verification record

Commands and suite boundaries are documented in [the browser regression guide](auth-browser-regressions.md).

- Full application checks: `npm run check` passed: **3,712/3,712 tests**, dependency audit, syntax checks for 526 Node files, architecture checks and the production web export.
- Final web export: `index-0e97071193448eb2cf30ef377015eca5.js`; initial JavaScript 492.2 KiB gzip against the 512.0 KiB budget. This is a built artifact, not a deployed revision.
- Mocked failure-injection browser suite: **30/30 passed** on the final export at mobile/desktop widths, including credential-form submission, failed logout, offline recovery, expired sessions and Back cancellation. No uncaught page/runtime errors, app error boundaries or crash receipts occurred.
- Actual local server + browser: **9/9 passed** on the final export, with real HttpOnly cookies, account choice/switch/reload/logout, stale-cookie rejection, single-use reset and password-change revocation. The test-only listener was asserted to bind loopback, used exactly two UI login requests, recorded no runtime errors or outbound provider attempts, and removed its validated temporary database after shutdown.
- Separate-account `/api/me` reads at 5/10/50/100 simultaneous requests all returned the correct identity and `no-store`. Local p95 latencies were 4/5/23/45 ms; these synthetic reads do not establish production throughput or capacity for posting/media.
- Production dependency audit (`npm audit --omit=dev`): zero reported vulnerabilities after the Sharp patch.
- Production release: not committed, pushed or deployed during this audit.

## Remaining boundaries and follow-up

1. **Production and physical devices:** localhost Chromium is not iPhone Safari, native background/resume, production HTTPS, `__Host-` cookie enforcement by a browser, Cloudflare/Render proxy behaviour, or a hosted soak test. Production configuration and the deployed revision have not been certified here.
2. **Storage capabilities and caches:** a presigned upload already issued cannot be recalled by canceling a client fetch. Private originals remain private; stale sessions cannot finalize or attach them. Public sanitized derivatives can remain available through their existing URL/cache. Failed or detached uploads rely on durable orphan cleanup (default retention 48 hours); public caching is up to five minutes. Immediate revocation needs a private publication/delivery design and storage/CDN verification, not a claim that logout erases every URL.
3. **Closed-tab response ordering:** without a running JS context or browser-wide lock, a client cannot compensate a late cookie response it never observes. Expected-account checks, stale-session revocation and clearing private state remain necessary. Stronger cross-browser ordering would require a separately designed server-backed browser-session generation protocol.
4. **Rate limits and scale:** the password queue is bounded per process; existing in-memory rate counters reset on restart and are not globally shared between server instances. Multi-instance deployment requires shared limiter coordination and measured capacity. The tests do not authorize or establish production load limits.
5. **Recovery after a lost response:** a committed signup/reset/password change can lose its network response. Transactions prevent partial security writes, but cannot guarantee delivery to a disconnected device. Explicit login/recovery remains necessary; do not retry a sensitive write under another account.
6. **Audit coverage:** this is a deep targeted review, not a proof of every endpoint, operating-system library or third-party service. High-volume account exports, password work-factor policy, ongoing dependency updates and hosted cleanup execution deserve continuing review.
7. **Native export handoff:** once a user has handed an archive to the operating system's share sheet, the app cannot revoke a copy saved or sent elsewhere. The new checks prevent stale-account handoff before that point and clean up the app's own temporary file; cleanup failures retain diagnostics. Physical-device verification remains outstanding.

No production accounts, photos, venues, artists, sessions or database records were deleted or modified by these checks. Temporary fixture databases are disposable and removed only after their owning process closes.
